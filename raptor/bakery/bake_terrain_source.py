#!/usr/bin/env python3
"""Rebuild the shipped 16 km Valdez source field from the pinned USGS export.

Requires Python 3, NumPy and Pillow. The input is a real F32 GeoTIFF; no
synthetic elevation, sharpening or inferred geography is introduced.

  python raptor/bakery/bake_terrain_source.py --source-tiff /path/to/export.tif

The source request and original product are recorded in the shipped
manifest/provenance. A changed source hash is rejected for explicit review.
Use --out for an isolated deterministic regeneration before replacing assets.
"""
from pathlib import Path
import argparse
import hashlib
import io
import json
import time

import numpy as np
from PIL import Image


def sha(data):
    return hashlib.sha256(data).hexdigest()


def png_bytes(pixels):
    out = io.BytesIO()
    Image.fromarray(pixels).save(out, format='PNG', optimize=True)
    return out.getvalue()


def main():
    asset_dir = Path(__file__).resolve().parents[1] / 'assets/terrain/source'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-tiff', type=Path, required=True)
    parser.add_argument('--manifest', type=Path,
                        default=asset_dir / 'valdez-inland-16km.json')
    parser.add_argument('--out', type=Path, default=asset_dir)
    args = parser.parse_args()
    meta = json.loads(args.manifest.read_text())
    start = time.perf_counter()
    raw = args.source_tiff.read_bytes()
    if sha(raw) != meta['provenance']['exportSHA256']:
        raise ValueError('Source export hash changed; review provenance before rebaking')
    with Image.open(io.BytesIO(raw)) as image:
        height = np.array(image, dtype=np.float32)
    del raw
    if height.shape != (3200, 3200) or not np.isfinite(height).all():
        raise ValueError('Expected complete, finite 3200 x 3200 F32 source')
    if (meta['width'], meta['height'], meta['spacingM']) != (3200, 3200, 5):
        raise ValueError('Only the accepted monolithic 16 km recipe is supported')
    lo, hi = float(height.min()), float(height.max())
    if (lo, hi) != (meta['minH'], meta['maxH']) or lo < 400:
        raise ValueError('Unexpected inland source range')
    quantized = np.round((height.astype(np.float64)-lo)/(hi-lo)*65535).astype(np.uint16)
    rgb = np.zeros((3200, 3200, 3), np.uint8)
    rgb[:,:,0] = quantized >> 8
    rgb[:,:,1] = quantized & 255
    decoded = quantized.astype(np.float64) * ((hi-lo)/65535) + lo
    south, east = np.gradient(decoded, meta['spacingM'])
    length = np.sqrt(east*east + south*south + 1)
    # PNG channels: east, north, up. Runtime swizzles to X, Y(up), Z(north).
    normal = np.stack([-east/length, south/length, 1/length], axis=-1)
    normal_rgb = np.round(np.clip((normal*.5+.5)*255, 0, 255)).astype(np.uint8)
    normal_rgba = np.full((3200, 3200, 4), 255, np.uint8)
    normal_rgba[:,:,:3] = normal_rgb
    height_png, normal_png = png_bytes(rgb), png_bytes(normal_rgb)
    actual = dict(heightSHA256=sha(height_png),
                  heightPackedSHA256=sha(rgb[:,:,:2].tobytes()),
                  normalSHA256=sha(normal_png),
                  normalPixelsSHA256=sha(normal_rgba.tobytes()))
    for key, value in actual.items():
        if value != meta[key]:
            raise ValueError(f'{key} differs from accepted bake; do not silently replace assets')
    # All recipe/hash checks finish before any output file is replaced.
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / meta['heightFile']).write_bytes(height_png)
    (args.out / meta['normalFile']).write_bytes(normal_png)
    (args.out / args.manifest.name).write_bytes(args.manifest.read_bytes())
    print(json.dumps(dict(pass_=True, seconds=time.perf_counter()-start,
                          heightBytes=len(height_png), normalBytes=len(normal_png),
                          downloadBytes=len(height_png)+len(normal_png),
                          maxQuantizationErrorM=float(np.abs(decoded-height).max()),
                          hashes=actual), indent=2))


if __name__ == '__main__':
    main()
