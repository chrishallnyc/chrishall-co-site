#!/usr/bin/env python3
"""Validate baked DEM byte/layout contracts and representative terrain samples."""
import json
import math
from pathlib import Path
import subprocess

import numpy as np

DEST = Path(__file__).resolve().parent
ROOT = DEST.parents[2]
manifest = json.loads((DEST / 'states.json').read_text())
states = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    'import {STATES} from "./terrain/data/geography.js";process.stdout.write(JSON.stringify(STATES));',
], cwd=ROOT, text=True))
assert set(manifest) == {state['code'] for state in states}, 'All 50 states must be present'
rasters = {}
for state in states:
    code = state['code']
    info = manifest[code]
    width, height = info['width'], info['height']
    (west, south), (east, north) = state['bounds']
    assert info['bounds'] == [west, south, east, north], f'{code}: exact state bounds'
    assert info['encoding'] == 'int16-le-meters', f'{code}: encoding'
    payload = (DEST / info['file']).read_bytes()
    assert len(payload) == width * height * 2 == info['bytes'], f'{code}: byte length'
    raster = np.frombuffer(payload, dtype='<i2').reshape(height, width)
    assert int(raster.min()) == info['min'] and int(raster.max()) == info['max'], f'{code}: extrema'
    assert raster.min() > -12000 and raster.max() < 9000, f'{code}: no sentinel or implausible global height'
    assert 0 <= info['sourcePixelsFiltered'] < info['sourcePixels'] * .02, f'{code}: filter is conservative'
    x0, y0, x1, y1 = info['mercatorBounds']
    assert x0 < x1 and y0 < y1, f'{code}: axis order'
    assert abs(width / height - (x1 - x0) / (y1 - y0)) < .01, f'{code}: Mercator aspect ratio'
    assert max(width, height) == (1024 if code == 'CA' else 768), f'{code}: expected resolution'
    rasters[code] = raster

assert manifest['AK']['mercatorBounds'][0] < 0, 'Alaska must preserve unwrapped western Aleutians'


def sample(code, lat, lng):
    info = manifest[code]
    x0, y0, x1, y1 = info['mercatorBounds']
    x = (lng + 180) / 360
    if code == 'AK' and x > x1:
        x -= 1
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2
    i = min(info['width'] - 1, max(0, int((x - x0) / (x1 - x0) * info['width'])))
    j = min(info['height'] - 1, max(0, int((y - y0) / (y1 - y0) * info['height'])))
    return int(rasters[code][j, i])


# Broad ranges detect axis/endianness mistakes without pretending the overview
# raster resolves exact ground elevations at named summits or street addresses.
checks = [
    ('CA', 'San Francisco', 37.7749, -122.4194, -20, 150),
    ('CA', 'Bakersfield', 35.3733, -119.0187, 70, 220),
    ('CA', 'Mount Whitney area', 36.5785, -118.2923, 3000, 4450),
    ('CA', 'Badwater Basin', 36.2401, -116.8258, -100, -20),
    ('HI', 'Mauna Kea area', 19.8207, -155.4681, 3000, 4250),
    ('TX', 'Austin', 30.2672, -97.7431, 70, 300),
    ('NY', 'Lower Manhattan', 40.7128, -74.006, -30, 150),
]
for code, name, lat, lng, low, high in checks:
    value = sample(code, lat, lng)
    assert low <= value <= high, f'{name}: unexpected overview sample {value}m'
    print(f'{name}: {value}m (overview sample)')
print(f'Validated {len(manifest)} rasters and {sum(record["bytes"] for record in manifest.values()):,} bytes.')
