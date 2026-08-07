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

Usage:
  bake_terrain.py <tile.tif>[,tile2.tif,...] <centerLat> <centerLon> <sizeKm>
                  <grid> <outdir>/<name> [--sea]
Multiple tiles mosaic (each carries its own geo transform; the sampler picks
the covering tile per output row band). --sea fills nodata with 0m (ocean
fronts); default fills with the local median (land voids).
"""
import json, sys
import numpy as np
import tifffile
from PIL import Image

class Tile:
    def __init__(self, path):
        with tifffile.TiffFile(path) as tf:
            page = tf.pages[0]
            self.dem = page.asarray().astype(np.float32)
            tags = {t.name: t.value for t in page.tags.values()}
            tie = tags["ModelTiepointTag"]     # (i,j,k, lon0, lat0, 0)
            scale = tags["ModelPixelScaleTag"] # (dLon, dLat, 0)
            self.lon0, self.lat0 = tie[3], tie[4]
            self.d_lon, self.d_lat = scale[0], scale[1]
        self.h, self.w = self.dem.shape
        self.dem[self.dem < -1000] = np.nan
        # interior extent (with a 1px guard for bilinear)
        self.lat_min = self.lat0 - (self.h - 1) * self.d_lat
        self.lon_max = self.lon0 + (self.w - 1) * self.d_lon
        print(f"tile {path.split('/')[-1]}: {self.w}x{self.h} "
              f"lat {self.lat_min:.4f}..{self.lat0:.4f} lon {self.lon0:.4f}..{self.lon_max:.4f}")

    def covers(self, lat, lon):
        return self.lat_min <= lat <= self.lat0 and self.lon0 <= lon <= self.lon_max

    def sample_rows(self, lats, lons):
        rows = (self.lat0 - lats) / self.d_lat
        cols = (lons - self.lon0) / self.d_lon
        r0 = np.clip(np.floor(rows).astype(int), 0, self.h - 1)
        c0 = np.clip(np.floor(cols).astype(int), 0, self.w - 1)
        fr = np.clip(rows - r0, 0, 1)[:, None]
        fc = np.clip(cols - c0, 0, 1)[None, :]
        r1 = np.clip(r0 + 1, 0, self.h - 1); c1 = np.clip(c0 + 1, 0, self.w - 1)
        d = self.dem
        return ((d[np.ix_(r0, c0)] * (1 - fr) * (1 - fc)) +
                (d[np.ix_(r0, c1)] * (1 - fr) * fc) +
                (d[np.ix_(r1, c0)] * fr * (1 - fc)) +
                (d[np.ix_(r1, c1)] * fr * fc))

def main():
    tif_paths, lat_c, lon_c, size_km, grid, out = (
        sys.argv[1].split(","), float(sys.argv[2]), float(sys.argv[3]),
        float(sys.argv[4]), int(sys.argv[5]), sys.argv[6])
    sea = "--sea" in sys.argv

    tiles = [Tile(p) for p in tif_paths]

    size_m = size_km * 1000.0
    m_per_deg_lat = 111132.0
    m_per_deg_lon = 111320.0 * np.cos(np.radians(lat_c))
    half_lat = (size_m / 2) / m_per_deg_lat
    half_lon = (size_m / 2) / m_per_deg_lon

    # sample grid: row 0 = NORTH edge
    lats = np.linspace(lat_c + half_lat, lat_c - half_lat, grid)
    lons = np.linspace(lon_c - half_lon, lon_c + half_lon, grid)

    # mosaic: fill from each tile where it covers; later tiles only fill gaps
    hgt = np.full((grid, grid), np.nan, dtype=np.float32)
    for tile in tiles:
        got = tile.sample_rows(lats, lons)
        # mask samples outside this tile's true extent
        lat_ok = (lats <= tile.lat0) & (lats >= tile.lat_min)
        lon_ok = (lons >= tile.lon0) & (lons <= tile.lon_max)
        m = lat_ok[:, None] & lon_ok[None, :]
        take = m & np.isnan(hgt) & ~np.isnan(got)
        hgt[take] = got[take]

    uncovered = int((~np.isfinite(hgt)).sum())
    if uncovered:
        frac = uncovered / hgt.size
        # ocean cells sit at -15m — BELOW any wave trough, or the seafloor
        # z-fights up through the animated surface (learned the hard way)
        fill = -15.0 if sea else float(np.nanmedian(hgt))
        kind = "sea floor (-15m)" if sea else f"median {fill:.0f}m"
        print(f"nodata/uncovered: {uncovered} px ({frac*100:.1f}%) -> {kind}")
        if frac > 0.02 and not sea:
            sys.exit("more than 2% uncovered on a land bake — check tile set / AOI")
        hgt = np.where(np.isfinite(hgt), hgt, fill)
    if sea:
        # some tiles chart the water SURFACE near 0m (Alaska fjords) — those
        # cells must also sink to the floor or wave troughs expose them
        hgt = np.where(hgt < 0.4, -15.0, hgt)
        hgt = np.maximum(hgt, -15.0)

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
