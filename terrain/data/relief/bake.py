#!/usr/bin/env python3
"""Bake finite overview DEMs from public Mapzen/AWS Terrarium tiles.

Run from anywhere with Python 3.9+, numpy, scipy, pillow, and requests:
  python terrain/data/relief/bake.py
  python terrain/data/relief/bake.py --states CA TX --force
No cloud credentials are required. Source tiles are cached in .context.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from io import BytesIO
import json
import math
from pathlib import Path
import subprocess
import time

import numpy as np
from PIL import Image
import requests
from scipy.ndimage import median_filter

DEST = Path(__file__).resolve().parent
ROOT = DEST.parents[2]
CACHE = ROOT / '.context' / 'terrain-dem-cache'
SOURCE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
TILE_SIZE = 256


def mercator(lng, lat):
    """Normalized slippy-map Mercator; y increases south; x can be negative."""
    phi = math.radians(lat)
    return (lng + 180.0) / 360.0, (1 - math.asinh(math.tan(phi)) / math.pi) / 2


def source_tile(task):
    z, unwrapped_x, y = task
    x = unwrapped_x % (1 << z)
    file = CACHE / str(z) / str(x) / f'{y}.png'
    if file.exists():
        payload = file.read_bytes()
    else:
        for attempt in range(4):
            try:
                response = requests.get(SOURCE.format(z=z, x=x, y=y), timeout=(10, 35))
                response.raise_for_status()
                payload = response.content
                # Validate before caching so a transient HTML error cannot poison it.
                with Image.open(BytesIO(payload)) as image:
                    image.verify()
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(payload)
                break
            except (requests.RequestException, OSError):
                if attempt == 3:
                    raise
                time.sleep(attempt + 1)
    with Image.open(BytesIO(payload)) as image:
        rgb = np.asarray(image.convert('RGB'), dtype=np.float32)
    if rgb.shape != (TILE_SIZE, TILE_SIZE, 3):
        raise ValueError(f'Unexpected tile dimensions for {task}: {rgb.shape}')
    heights = rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768
    if not np.isfinite(heights).all() or heights.min() < -12000 or heights.max() > 9000:
        raise ValueError(f'Invalid or no-data elevations in source tile {task}')
    return unwrapped_x, y, heights


def bake(state, longest, workers):
    code = state['code']
    (west, south), (east, north) = state['bounds']
    x0, y0 = mercator(west, north)
    x1, y1 = mercator(east, south)
    dx, dy = x1 - x0, y1 - y0
    width = max(2, round(longest * dx / max(dx, dy)))
    height = max(2, round(longest * dy / max(dx, dy)))
    # Select a source grid at least as dense as the output, usually 1–2x denser.
    z = max(0, math.ceil(math.log2(max(width / dx, height / dy) / TILE_SIZE)))
    scale = (1 << z) * TILE_SIZE
    px0, py0, px1, py1 = x0 * scale, y0 * scale, x1 * scale, y1 * scale
    # A one-pixel halo gives the resampler adjacent samples at bbox boundaries.
    tx0, ty0 = math.floor((px0 - 1) / TILE_SIZE), math.floor((py0 - 1) / TILE_SIZE)
    tx1, ty1 = math.floor((px1 + 1) / TILE_SIZE), math.floor((py1 + 1) / TILE_SIZE)
    tasks = [(z, tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    mosaic = np.empty(((ty1 - ty0 + 1) * TILE_SIZE, (tx1 - tx0 + 1) * TILE_SIZE), dtype=np.float32)
    print(f'{code}: {width}×{height}, zoom {z}, {len(tasks)} source tiles', flush=True)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for tx, ty, data in pool.map(source_tile, tasks):
            left, top = (tx - tx0) * TILE_SIZE, (ty - ty0) * TILE_SIZE
            mosaic[top:top + TILE_SIZE, left:left + TILE_SIZE] = data
    # Source tiles contain occasional isolated spikes/pits. Reject only extreme
    # departures from nearby values; rough mountain terrain raises the threshold.
    # This is not blanket smoothing: all other source samples remain unchanged.
    local_median = median_filter(mosaic, size=5, mode='nearest')
    deviation = np.abs(mosaic - local_median)
    local_mad = median_filter(deviation, size=5, mode='nearest')
    artifacts = deviation > np.maximum(300, 6 * local_mad)
    artifact_count = int(artifacts.sum())
    mosaic[artifacts] = local_median[artifacts]
    crop = (px0 - tx0 * TILE_SIZE, py0 - ty0 * TILE_SIZE, px1 - tx0 * TILE_SIZE, py1 - ty0 * TILE_SIZE)
    # Float-valued bilinear filtering during resize avoids interpolating encoded
    # RGB bytes and applies Pillow's scaled filter footprint when downsampling.
    raster = np.asarray(Image.fromarray(mosaic).resize((width, height), Image.Resampling.BILINEAR, box=crop))
    encoded = np.rint(raster).astype('<i2')
    if encoded.size != width * height or not np.isfinite(raster).all():
        raise ValueError(f'Invalid output raster: {code}')
    file = DEST / f'{code}.bin'
    file.write_bytes(encoded.tobytes(order='C'))
    return {
        'file': file.name,
        'encoding': 'int16-le-meters',
        'width': width,
        'height': height,
        'bounds': [west, south, east, north],
        'mercatorBounds': [x0, y0, x1, y1],
        'sampleAlignment': 'pixel-centers',
        'rowOrder': 'north-to-south',
        'scale': 1,
        'offset': 0,
        'min': int(encoded.min()),
        'max': int(encoded.max()),
        'sourceZoom': z,
        'sourceTileSize': TILE_SIZE,
        'sourceTileCount': len(tasks),
        'artifactFilter': '5x5 median replacement only where abs(residual) > max(300m, 6x local MAD)',
        'sourcePixelsFiltered': artifact_count,
        'sourcePixels': int(mosaic.size),
        'source': SOURCE,
        'accessed': date.today().isoformat(),
        'bytes': file.stat().st_size,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--states', nargs='*', help='Two-letter state codes; default all 50, California first')
    parser.add_argument('--size', type=int, default=768, help='Longest raster axis (California has minimum 1024)')
    parser.add_argument('--workers', type=int, default=10)
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    if args.size < 32 or args.workers < 1:
        parser.error('size must be >=32 and workers >=1')
    states = json.loads(subprocess.check_output([
        'node', '--input-type=module', '-e',
        'import {STATES} from "./terrain/data/geography.js";process.stdout.write(JSON.stringify(STATES));',
    ], cwd=ROOT, text=True))
    selected = {code.upper() for code in args.states} if args.states else None
    if selected and not selected <= {state['code'] for state in states}:
        parser.error('Unrecognized state code')
    states.sort(key=lambda state: (state['code'] != 'CA', state['code']))
    manifest_file = DEST / 'states.json'
    manifest = json.loads(manifest_file.read_text()) if manifest_file.exists() else {}
    for state in states:
        code = state['code']
        if selected and code not in selected:
            continue
        if not args.force and code in manifest and (DEST / manifest[code]['file']).exists():
            print(f'{code}: already baked', flush=True)
            continue
        manifest[code] = bake(state, max(1024, args.size) if code == 'CA' else args.size, args.workers)
        # Atomic progressive publication lets the renderer use California while
        # the remaining states are being baked.
        temporary = DEST / 'states.json.tmp'
        temporary.write_text(json.dumps(dict(sorted(manifest.items())), indent=2) + '\n')
        temporary.replace(manifest_file)
        record = manifest[code]
        print(f'  wrote {record["bytes"]:,} bytes; bbox elevations {record["min"]} to {record["max"]} m', flush=True)
    print(f'Done: {len(manifest)} states, {sum(v["bytes"] for v in manifest.values()):,} raster bytes.', flush=True)


if __name__ == '__main__':
    main()
