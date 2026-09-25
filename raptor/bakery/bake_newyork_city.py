#!/usr/bin/env python3
"""Bake bounded, reproducible NYC OTI footprints into Raptor skyline instances.

The city data is a simplified visual massing model, not a navigational survey.
The source footprint's minimum-area rectangle preserves its street alignment;
roof height is converted from source US feet to metres. Tiny outlying houses
are sampled on a 38 m grid, while Manhattan and every >=24 m building survive.
Run from the repo root; --source reuses a downloaded raw snapshot offline.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request

SOURCE = "https://data.cityofnewyork.us/resource/5zhs-2jue.json"
WHERE = ("height_roof > 25 AND feature_code = 2100 AND "
         "((bin >= 1000000 AND bin < 2000000 AND within_box(the_geom,40.835,-74.025,40.700,-73.92)) "
         "OR within_box(the_geom,40.735,-74.025,40.665,-73.940) "
         "OR within_box(the_geom,40.780,-73.975,40.735,-73.925))")
LON_M = 111320 * math.cos(math.radians(40.70))
LAT_M = 111132


def hull(points):
    points = sorted(set(points))
    def cross(o, a, b):
        return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    sides = []
    for run in (points, points[::-1]):
        side = []
        for point in run:
            while len(side) >= 2 and cross(side[-2], side[-1], point) <= 0:
                side.pop()
            side.append(point)
        sides.append(side[:-1])
    return sides[0] + sides[1]


def rectangle(ring):
    points = hull([((p[0]+74.0)*LON_M, (p[1]-40.70)*LAT_M) for p in ring])
    if len(points) < 3:
        return None
    best = None
    for a, b in zip(points, points[1:] + points[:1]):
        angle = math.atan2(b[1]-a[1], b[0]-a[0])
        c, s = math.cos(angle), math.sin(angle)
        xs = [p[0]*c+p[1]*s for p in points]
        zs = [-p[0]*s+p[1]*c for p in points]
        lo_x, hi_x, lo_z, hi_z = min(xs), max(xs), min(zs), max(zs)
        area = (hi_x-lo_x)*(hi_z-lo_z)
        if best is None or area < best[0]:
            mx, mz = (hi_x+lo_x)/2, (hi_z+lo_z)/2
            best = (area, mx*c-mz*s, mx*s+mz*c, hi_x-lo_x, hi_z-lo_z, angle)
    return best[1:]


def bake(rows):
    candidates = []
    for row in rows:
        if row.get("last_status_type") in ("Demolition", "Marked For Demolition"):
            continue
        polygons = row.get("the_geom", {}).get("coordinates", [])
        if not polygons:
            continue
        # The largest outer ring represents multipart buildings for the flight
        # scale model; courtyard and rooftop detail are deliberately omitted.
        rectangles = [rectangle(p[0]) for p in polygons if p]
        rectangles = [r for r in rectangles if r]
        if not rectangles:
            continue
        x, north, width, depth, angle = max(rectangles, key=lambda r:r[2]*r[3])
        if min(width, depth) < 3 or max(width, depth) > 360:
            continue
        height = max(3, min(float(row.get("height_roof", 35)) * .3048, 510))
        year = int(float(row.get("construction_year", 0)))
        ground = max(0, float(row.get("ground_elevation", 0)) * .3048)
        # Three's positive rotation about Y runs opposite to geographic ENU.
        record = [round(x,1), round(north,1), round(width*.94,1), round(depth*.94,1),
                  round(height,1), round(-angle,4), year, round(ground,1), int(row['doitt_id'])]
        candidates.append((int(row.get('bin',0)), record))
    # Retain the tallest small building in a cell instead of dependent API order.
    candidates.sort(key=lambda item:(-item[1][4], item[1][8]))
    cells, records = set(), []
    for bin_id, record in candidates:
        x, north, _, _, height = record[:5]
        if not 1000000 <= bin_id < 2000000 and height < 24:
            key = (math.floor(x/38), math.floor(north/38))
            if key in cells:
                continue
            cells.add(key)
        records.append(record)
    records.sort(key=lambda row:row[8])
    return records


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path)
    parser.add_argument('--output', type=Path, default=Path('raptor/assets/city/newyork-buildings.json'))
    args = parser.parse_args()
    query = {'$select':'the_geom,height_roof,construction_year,bin,ground_elevation,doitt_id,last_status_type',
             '$where':WHERE, '$limit':100000, '$order':'doitt_id'}
    url = SOURCE + '?' + urllib.parse.urlencode(query)
    raw = args.source.read_bytes() if args.source else urllib.request.urlopen(url,timeout=240).read()
    rows = json.loads(raw)
    if not 10000 < len(rows) < 100000:
        raise RuntimeError(f'Unexpected source row count: {len(rows)}; inspect query pagination before shipping')
    buildings = bake(rows)
    result = {'version':1, 'center':[40.70,-74.00], 'metresPerDegree':[LAT_M,LON_M],
              'columns':['east','north','width','depth','roofHeight','rotationY','constructionYear','groundHeight','id'],
              'buildings':buildings}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,separators=(',',':'))+'\n')
    provenance = {'dataset':'NYC OTI Building Footprints', 'source':SOURCE,
                  'datasetPage':'https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue',
                  'metadata':'https://github.com/CityOfNewYork/nyc-geo-metadata/blob/master/Metadata/Metadata_BuildingFootprints.md',
                  'retrieved':'2026-09-24', 'sourceRows':len(rows), 'instances':len(buildings),
                  'sourceSHA256':hashlib.sha256(raw).hexdigest(), 'query':query,
                  'representation':'Minimum-area rectangles, 94% footprint dimensions; simplified roof massing. Heights and ground elevations converted from US feet to metres. Contemporary source filtered by construction year for the fictional 2001 aftermath; not an exact historical reconstruction.'}
    args.output.with_name('newyork-buildings.provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    print(f'{len(rows)} source buildings → {len(buildings)} instances; {args.output.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
