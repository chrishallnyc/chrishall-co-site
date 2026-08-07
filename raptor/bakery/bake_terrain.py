#!/usr/bin/env python3
"""RAPTOR terrain bakery v1 — USGS 3DEP GeoTIFF -> browser heightmap.

Cuts a square AOI (kilometers) around a lat/lon center from a 1x1-degree
USGS 1/3 arc-second DEM tile, resamples to a power-of-two grid in local
meters, and writes:
  <name>_h.png    height, 16-bit packed R=hi G=lo, scaled minH..maxH
  <name>_meta.json  { sizeM, grid, minH, maxH, centerLat, centerLon, mPerPx }
  <name>_shade.png  hillshade preview (for eyeballing/judges, not shipped)

No GDAL: pure numpy + tifffile. USGS 13 tiles are EPSG:4269 geographic,
float32 meters, 10812x10812 incl. 6-px collar. Local flat-earth meters are
fine at 65 km extents (distortion << mesh LOD error).

Usage: bake_terrain.py <tile.tif> <centerLat> <centerLon> <sizeKm> <grid> <outdir>/<name>
"""
import json, sys
import numpy as np
import tifffile
from PIL import Image

def main():
    tif_path, lat_c, lon_c, size_km, grid, out = (
        sys.argv[1], float(sys.argv[2]), float(sys.argv[3]),
        float(sys.argv[4]), int(sys.argv[5]), sys.argv[6])

    with tifffile.TiffFile(tif_path) as tf:
        page = tf.pages[0]
        dem = page.asarray().astype(np.float32)
        # ModelTiepoint + ModelPixelScale give the geo transform
        tags = {t.name: t.value for t in page.tags.values()}
        tie = tags["ModelTiepointTag"]     # (i,j,k, lon0, lat0, 0)
        scale = tags["ModelPixelScaleTag"] # (dLon, dLat, 0)
        lon0, lat0 = tie[3], tie[4]
        d_lon, d_lat = scale[0], scale[1]

    h, w = dem.shape
    print(f"tile {w}x{h} origin ({lat0:.4f},{lon0:.4f}) step ({d_lat:.6f},{d_lon:.6f})")

    # nodata: USGS uses large negative sentinel
    dem[dem < -1000] = np.nan

    size_m = size_km * 1000.0
    m_per_deg_lat = 111132.0
    m_per_deg_lon = 111320.0 * np.cos(np.radians(lat_c))
    half_lat = (size_m / 2) / m_per_deg_lat
    half_lon = (size_m / 2) / m_per_deg_lon

    # sample grid: row 0 = NORTH edge (v grows southward = +Z north flip later)
    lats = np.linspace(lat_c + half_lat, lat_c - half_lat, grid)
    lons = np.linspace(lon_c - half_lon, lon_c + half_lon, grid)

    # fractional pixel coords into the tile (row 0 = lat0 at top)
    rows = (lat0 - lats) / d_lat
    cols = (lons - lon0) / d_lon
    if rows.min() < 0 or rows.max() >= h or cols.min() < 0 or cols.max() >= w:
        sys.exit(f"AOI leaves tile bounds: rows {rows.min():.0f}..{rows.max():.0f} cols {cols.min():.0f}..{cols.max():.0f}")

    r0 = np.floor(rows).astype(int); c0 = np.floor(cols).astype(int)
    fr = (rows - r0)[:, None]; fc = (cols - c0)[None, :]
    r1 = np.clip(r0 + 1, 0, h - 1); c1 = np.clip(c0 + 1, 0, w - 1)
    # bilinear gather
    hgt = ((dem[np.ix_(r0, c0)] * (1 - fr) * (1 - fc)) +
           (dem[np.ix_(r0, c1)] * (1 - fr) * fc) +
           (dem[np.ix_(r1, c0)] * fr * (1 - fc)) +
           (dem[np.ix_(r1, c1)] * fr * fc))

    n_nan = int(np.isnan(hgt).sum())
    if n_nan:
        print(f"WARNING: {n_nan} nan samples — filling with local median")
        hgt = np.where(np.isnan(hgt), np.nanmedian(hgt), hgt)

    mn, mx = float(hgt.min()), float(hgt.max())
    print(f"heights {mn:.1f}..{mx:.1f} m over {size_km:.1f} km ({size_m/grid:.1f} m/px)")

    q = np.round((hgt - mn) / (mx - mn) * 65535.0).astype(np.uint32)
    rgb = np.zeros((grid, grid, 3), dtype=np.uint8)
    rgb[..., 0] = (q >> 8) & 0xFF
    rgb[..., 1] = q & 0xFF
    Image.fromarray(rgb, "RGB").save(out + "_h.png", optimize=True)

    meta = {"sizeM": size_m, "grid": grid, "minH": round(mn, 2), "maxH": round(mx, 2),
            "centerLat": lat_c, "centerLon": lon_c, "mPerPx": size_m / grid,
            "source": "USGS 3DEP 1/3 arc-second (public domain)"}
    json.dump(meta, open(out + "_meta.json", "w"), indent=1)

    # hillshade preview (NW sun) for eyeballing
    gy, gx = np.gradient(hgt, size_m / grid)
    az, alt = np.radians(315), np.radians(45)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    shade = np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect)
    shade = np.clip((shade + 1) / 2 * 255, 0, 255).astype(np.uint8)
    Image.fromarray(shade, "L").resize((1024, 1024)).save(out + "_shade.png")
    print("baked:", out + "_h.png", "+ meta + shade preview")

if __name__ == "__main__":
    main()
