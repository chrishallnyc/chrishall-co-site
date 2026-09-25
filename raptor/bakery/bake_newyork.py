#!/usr/bin/env python3
"""Bake Raptor's geographic New York region from public-domain USGS services.

Requires Python 3, numpy, Pillow, scipy, tifffile and requests. No credentials required.
  python bake_newyork.py --download --source .context/nyc/source
  python bake_newyork.py --source .context/nyc/source --out /tmp/nyc-check

The first command caches the exact F32 DEM and source-locked NAIP exports.
Subsequent bakes verify the pinned source SHA256 values before decoding them.
Image rows run north to south; world X is east and world Z is north.
"""
from pathlib import Path
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import io
import json
import math
import time

import numpy as np
from PIL import Image
import requests
import tifffile
from scipy.ndimage import gaussian_filter

LAT, LON, SIZE, GRID, IMAGE_GRID = 40.70, -74.00, 65536, 4096, 16384
MP_LAT, MP_LON = 111132.0, 111320.0 * math.cos(math.radians(LAT))
DEM = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer'
NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer'
ROOT = Path(__file__).resolve().parents[1]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def save_image(image, destination, **options):
    """Keep a running local game from observing a half-encoded texture."""
    temporary = destination.with_name(destination.name + '.tmp')
    formats = {'.png': 'PNG', '.jpg': 'JPEG', '.webp': 'WEBP'}
    try:
        image.save(temporary, format=formats[destination.suffix], **options)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def bbox(x0, z0, x1, z1):
    return [LON + x0 / MP_LON, LAT + z0 / MP_LAT,
            LON + x1 / MP_LON, LAT + z1 / MP_LAT]


def request(url, params):
    for attempt in range(4):
        try:
            response = requests.get(url, params=params, timeout=(20, 180))
            response.raise_for_status()
            if 'json' in response.headers.get('Content-Type', ''):
                data = response.json()
                if 'error' in data:
                    raise ValueError(data['error'])
            return response
        except (requests.RequestException, ValueError):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def download(source):
    source.mkdir(parents=True, exist_ok=True)
    provenance_path = source / 'newyork-source.json'
    accepted_path = ROOT / 'assets/terrain/newyork-provenance.json'
    previous = json.loads(provenance_path.read_text()) if provenance_path.exists() else (
        json.loads(accepted_path.read_text()) if accepted_path.exists() else {})
    requests_by_name = {r['file']: r for r in previous.get('exports', [])}
    exports = []

    def checkpoint(record):
        requests_by_name[record['file']] = record
        temporary = provenance_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(dict(previous, exports=list(requests_by_name.values())), indent=2) + '\n')
        temporary.replace(provenance_path)

    def fetch(name, service, params):
        path = source / name
        record = requests_by_name.get(name)
        if path.exists() and record and sha(path.read_bytes()) == record['sha256']:
            print('cached', name, flush=True)
            return record
        # Request the export manifest, then its file. Large synchronous image
        # responses can exceed a gateway limit even when the export succeeds.
        actual_params = dict(params, f='json')
        response = request(service + '/exportImage', actual_params)
        exported = response.json()
        if not exported.get('href'):
            raise ValueError('Export did not produce a source image: ' + str(exported))
        raw = request(exported['href'], {}).content
        if record and sha(raw) != record['sha256']:
            raise ValueError('Upstream source changed; explicitly review before replacing ' + name)
        if name.endswith('.tiff'):
            with tifffile.TiffFile(io.BytesIO(raw)) as decoded:
                dimensions = [decoded.pages[0].imagewidth, decoded.pages[0].imagelength]
        else:
            with Image.open(io.BytesIO(raw)) as decoded:
                decoded.load()
                dimensions = list(decoded.size)
        path.write_bytes(raw)
        print('downloaded', name, len(raw), dimensions, flush=True)
        return dict(file=name, url=response.url, sha256=sha(raw), bytes=len(raw),
                    dimensions=dimensions, parameters=actual_params, exportResponse=exported)

    # The renderer's height samples include the two endpoints. ArcGIS samples
    # pixel centres, so extend the request by half a grid interval each side.
    half = SIZE / 2
    step = SIZE / (GRID - 1)
    # Lock the two continuous 1/3 arc-second products. The service's default
    # mixed-project mosaic can select much larger 1m rasters and time out.
    extent = bbox(-half - step / 2, -half - step / 2, half + step / 2, half + step / 2)
    dem_params = dict(f='json', bbox=','.join(map(str, extent)), bboxSR=4326,
                      imageSR=4326, size='4096,4096', format='tiff', pixelType='F32',
                      renderingRule=json.dumps({'rasterFunction': 'None'}),
                      mosaicRule=json.dumps({'mosaicMethod': 'esriMosaicLockRaster',
                                             'lockRasterIds': [4841, 5224]}),
                      adjustAspectRatio='false')
    dem_result = fetch('newyork-dem-locked.tiff', DEM, dem_params)
    exports.append(dem_result)
    checkpoint(dem_result)

    records_path = source / 'newyork-naip-records.json'
    if records_path.exists():
        records = json.loads(records_path.read_text())
    elif previous.get('sourceRecords'):
        records = previous['sourceRecords']
        records_path.write_text(json.dumps(records, indent=2) + '\n')
    else:
        records, offset = [], 0
        while True:
            query = dict(f='json', where='Category=1', geometry=','.join(map(str, bbox(-half, -half, half, half))),
                         geometryType='esriGeometryEnvelope', inSR=4326, outSR=4326,
                         spatialRel='esriSpatialRelIntersects', outFields='*', returnGeometry='true',
                         resultOffset=offset, resultRecordCount=50, orderByFields='OBJECTID')
            page = request(NAIP + '/query', query).json()
            records.extend(page['features'])
            if not page.get('exceededTransferLimit'):
                break
            offset += len(page['features'])
        records_path.write_text(json.dumps(records, indent=2) + '\n')
    print('NAIP source records:', len(records), flush=True)
    if not records:
        raise ValueError('No NAIP records intersect the New York region')
    source_bounds = []
    for record in records:
        points = [p for ring in record['geometry']['rings'] for p in ring]
        source_bounds.append((record['attributes']['OBJECTID'],
                              min(p[0] for p in points), min(p[1] for p in points),
                              max(p[0] for p in points), max(p[1] for p in points)))

    jobs = []
    for row in range(8):
        for col in range(8):
            extent = bbox(-half + col * 8192, half - (row + 1) * 8192,
                          -half + (col + 1) * 8192, half - row * 8192)
            ids = [item[0] for item in source_bounds if item[1] < extent[2] and item[3] > extent[0]
                   and item[2] < extent[3] and item[4] > extent[1]]
            if len(ids) > 50:
                raise ValueError('Export intersects more source rasters than the service supports')
            name = f'newyork-naip-r{row}-c{col}.png'
            if not ids:
                raw = io.BytesIO()
                Image.new('RGBA', (2048, 2048)).save(raw, format='PNG')
                data = raw.getvalue()
                (source / name).write_bytes(data)
                exports.append(dict(file=name, sha256=sha(data), bytes=len(data),
                                    dimensions=[2048, 2048], blank=True))
                continue
            params = dict(f='image', bbox=','.join(map(str, extent)), bboxSR=4326,
                          imageSR=4326, size='2048,2048', format='png32',
                          interpolation='RSP_BilinearInterpolation', adjustAspectRatio='false',
                          renderingRule=json.dumps({'rasterFunction': 'NaturalColor'}),
                          mosaicRule=json.dumps({'mosaicMethod': 'esriMosaicLockRaster',
                                                 'lockRasterIds': sorted(ids),
                                                 'mosaicOperation': 'MT_FIRST'}))
            jobs.append((name, NAIP, params))
    # Limit concurrent upstream requests; all retained geographic data is real.
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(fetch, *job) for job in jobs]
        failures = []
        for future in as_completed(futures):
            try:
                result = future.result()
                exports.append(result)
                checkpoint(result)
            except Exception as error:
                failures.append(error)
        if failures:
            raise failures[0]
    provenance = dict(schema=1, region='NEWYORK',
                      coordinateSystem=dict(centerLat=LAT, centerLon=LON, sizeM=SIZE,
                                            metresPerDegreeLatitude=MP_LAT, metresPerDegreeLongitude=MP_LON,
                                            imageRowZero='north', worldX='east', worldZ='north'),
                      elevationService=DEM, imageryService=NAIP,
                      elevationSources=[
                          dict(objectId=4841, name='n41w075',
                               url='https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n41w075/USGS_13_n41w075.tif'),
                          dict(objectId=5224, name='n41w074',
                               url='https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n41w074/USGS_13_n41w074.tif')],
                      sourceRecords=records, exports=sorted(exports, key=lambda r: r['file']),
                      rights=dict(license='public domain',
                                  elevation='USGS National Map 3D Elevation Program (3DEP)',
                                  imagery='USGS, USDA, The National Map: Orthoimagery'))
    provenance_path.write_text(json.dumps(provenance, indent=2) + '\n')


def bake(source, out, preview):
    provenance = json.loads((source / 'newyork-source.json').read_text())
    for record in provenance['exports']:
        raw = (source / record['file']).read_bytes()
        if sha(raw) != record['sha256']:
            raise ValueError('Pinned source hash changed: ' + record['file'])
    out.mkdir(parents=True, exist_ok=True)
    step = SIZE / (GRID - 1)
    # tifffile handles tiled F32 data correctly; Pillow's decoder can return
    # scrambled floating-point values for this USGS uncompressed TIFF layout.
    with tifffile.TiffFile(source / 'newyork-dem-locked.tiff') as tif:
        page = tif.pages[0]
        scale, tie = page.tags['ModelPixelScaleTag'].value, page.tags['ModelTiepointTag'].value
        expected = bbox(-SIZE / 2 - step / 2, -SIZE / 2 - step / 2,
                        SIZE / 2 + step / 2, SIZE / 2 + step / 2)
        actual = [tie[3], tie[4] - GRID * scale[1], tie[3] + GRID * scale[0], tie[4]]
        if not np.allclose(actual, expected, rtol=0, atol=1e-10):
            raise ValueError('DEM geographic extent changed; refusing a stretched or shifted bake')
        height = page.asarray().astype(np.float32)
    if height.shape != (GRID, GRID):
        raise ValueError('Unexpected DEM dimensions')
    # USGS charts tidal water at sea level or NoData. Sink that floor below
    # every wave trough, matching the canonical coastal-front convention.
    water = (~np.isfinite(height)) | (height < 0.4)
    height[water] = -15
    if not (100 < float(height.max()) < 1000):
        raise ValueError('Unexpected New York elevation range')
    lo, hi = float(height.min()), float(height.max())
    witnesses = []
    for name, lat, lon, is_water in [
        ('Empire State Building ground', 40.74844, -73.98566, False),
        ('Battery Park', 40.7033, -74.0170, False),
        ('Central Park', 40.7812, -73.9665, False),
        ('Liberty Island', 40.6892, -74.0445, False),
        ('JFK airfield', 40.639, -73.778, False),
        ('Newark airfield', 40.683, -74.172, False),
        ('Hudson River', 40.738, -74.024, True),
        ('East River', 40.728, -73.966, True),
        ('Upper Bay', 40.66, -74.04, True),
        ('Lower Bay', 40.52, -74.07, True),
    ]:
        gx = round(((lon - LON) * MP_LON / SIZE + .5) * (GRID - 1))
        gy = round((.5 - (lat - LAT) * MP_LAT / SIZE) * (GRID - 1))
        value = float(height[gy, gx])
        if (value < 0) != is_water:
            raise ValueError(f'Geographic witness failed at {name}: {value}m')
        witnesses.append(dict(name=name, lat=lat, lon=lon, heightM=round(value, 3), water=is_water))
    quantized = np.round((height - lo) / (hi - lo) * 65535).astype(np.uint16)
    packed = np.zeros((GRID, GRID, 3), np.uint8)
    packed[:, :, 0], packed[:, :, 1] = quantized >> 8, quantized & 255
    save_image(Image.fromarray(packed), out / 'newyork_h.png', optimize=True)

    albedo = Image.new('RGB', (IMAGE_GRID, IMAGE_GRID), (28, 52, 55))
    coverage = Image.new('L', (IMAGE_GRID, IMAGE_GRID), 0)
    for row in range(8):
        for col in range(8):
            image = Image.open(source / f'newyork-naip-r{row}-c{col}.png').convert('RGBA')
            alpha = image.getchannel('A')
            albedo.paste(image.convert('RGB'), (col * 2048, row * 2048), alpha)
            coverage.paste(alpha, (col * 2048, row * 2048))
    # Urban roof/road texture has much more entropy than the other fronts.
    # Progressive 4:2:0 preserves the complete 4m grid within the download
    # budget; the lossless upstream PNGs remain available for future rebakes.
    save_image(albedo, out / 'newyork_albedo_16k.jpg', quality=82, subsampling=2,
               progressive=True, optimize=True)
    save_image(albedo.resize((4096, 4096), Image.Resampling.LANCZOS),
               out / 'newyork_albedo_4k.jpg', quality=80, subsampling=2, progressive=True, optimize=True)
    save_image(coverage.resize((4096, 4096), Image.Resampling.BOX), out / 'newyork_cover.png', optimize=True)

    south, east = np.gradient(height, SIZE / (GRID - 1))
    length = np.sqrt(east * east + south * south + 1)
    # Terrain shader expects east, north, up packed into RGB before its swizzle.
    normals = np.stack([-east / length, south / length, 1 / length], axis=-1)
    normal_pixels = np.round(np.clip(normals * .5 + .5, 0, 1) * 255).astype(np.uint8)
    save_image(Image.fromarray(normal_pixels).resize((8192, 8192), Image.Resampling.BILINEAR),
               out / 'newyork_n_8k.jpg', quality=90, subsampling=0, optimize=True)
    depression = np.maximum(0, gaussian_filter(height, 8) - height)
    ao = np.clip(1 - depression * .012, .55, 1)
    ao[water] = 1
    save_image(Image.fromarray(np.round(ao * 255).astype(np.uint8)).resize((8192, 8192), Image.Resampling.BILINEAR),
               out / 'newyork_ao_8k.jpg', quality=88, optimize=True)
    light = np.clip(normals @ np.array([-.5, .5, math.sqrt(.5)]), 0, 1)
    save_image(Image.fromarray(np.round(light * 255).astype(np.uint8)).resize((1024, 1024), Image.Resampling.LANCZOS),
               out / 'newyork_shade.png')
    meta = dict(sizeM=SIZE, grid=GRID, minH=round(lo, 4), maxH=round(hi, 4),
                centerLat=LAT, centerLon=LON, mPerPx=SIZE / GRID,
                source='USGS 3DEP bare-earth elevation; USDA NAIP imagery (public domain)',
                drape=['albedo_16k', 'albedo_4k', 'cover', 'n_8k', 'ao_8k'])
    (out / 'newyork_meta.json').write_text(json.dumps(meta, indent=2) + '\n')
    # The card is a geographic crop of Manhattan, the East/Hudson rivers and
    # Upper Bay, retaining the same north-up mapping as the flight terrain.
    def pixel(lon, lat):
        return ((lon - LON) * MP_LON / SIZE * IMAGE_GRID + IMAGE_GRID / 2,
                IMAGE_GRID / 2 - (lat - LAT) * MP_LAT / SIZE * IMAGE_GRID)
    cx, cy = pixel(-74.005, 40.735)
    width = 17000 / SIZE * IMAGE_GRID
    card_bounds = tuple(round(v) for v in (cx - width / 2, cy - width / 2, cx + width / 2, cy + width / 2))
    card = albedo.crop(card_bounds).resize((720, 720), Image.Resampling.LANCZOS)
    # Adjacent acquisition years photograph the Hudson at very different
    # exposures. The live ocean replaces that water in flight; give the card
    # the same clean harbor surface, using the real DEM shoreline as its mask.
    water_card = Image.fromarray(water.astype(np.uint8) * 255).crop(
        tuple(round(v * GRID / IMAGE_GRID) for v in card_bounds)).resize((720, 720), Image.Resampling.LANCZOS)
    card.paste(Image.new('RGB', card.size, (31, 73, 86)), (0, 0), water_card)
    preview.parent.mkdir(parents=True, exist_ok=True)
    save_image(card, preview, quality=88, method=6)
    provenance['bake'] = dict(heightGrid=GRID, imageryGrid=IMAGE_GRID,
                              imageryMetresPerPixel=SIZE / IMAGE_GRID,
                              heightPixelCentres='Endpoint-corrected bbox extended by half a sample',
                              waterPolicy='USGS no-data or elevation below 0.4m set to -15m seafloor',
                              terrainWaterFraction=float(water.mean()), minH=lo, maxH=hi,
                              geographicWitnesses=witnesses,
                              sourceImageryDates=sorted({r['attributes'].get('Year') for r in provenance['sourceRecords']}),
                              historicalReconstruction=False)
    provenance['outputs'] = [dict(file=p.name, bytes=p.stat().st_size, sha256=sha(p.read_bytes()))
                             for p in sorted(out.glob('newyork*')) if p.is_file() and p.suffix != '.json']
    provenance['preflight'] = dict(file='assets/preflight/newyork.webp',
                                  waterPresentation='DEM-classified tidal water recolored #1f4956; land imagery preserved',
                                  bytes=preview.stat().st_size, sha256=sha(preview.read_bytes()))
    (out / 'newyork-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(json.dumps(dict(heightRange=[lo, hi], waterFraction=float(water.mean()),
                          outputBytes=sum(r['bytes'] for r in provenance['outputs'])), indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('.context/nyc/source'))
    parser.add_argument('--out', type=Path, default=ROOT / 'assets/terrain')
    parser.add_argument('--preview', type=Path, default=ROOT / 'assets/preflight/newyork.webp')
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    if args.download:
        download(args.source)
    bake(args.source, args.out, args.preview)


if __name__ == '__main__':
    main()
