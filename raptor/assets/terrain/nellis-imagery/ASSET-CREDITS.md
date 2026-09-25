# Nellis aerial imagery

Public-domain USDA NAIP imagery is distributed by the [USGS NAIP ImageServer](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer). Four locked source records, 134696, 134697, 134699 and 134701, were acquired on 2022-07-04 at native 0.6 m resolution. The delivered tiles are resampled to nominal 1 m in the game's geographic coordinate mapping; they do not claim 0.6 m output resolution.

`manifest.json` records exact world/geographic extents, image dimensions, transparent coverage, decoded placement and compressed hashes. `source-provenance.json` records requests, acquisition dates, source raster names and original download links. The six-by-six grid covers x=[-6144,6144], z=[-10240,2048] metres. Thirty source-bearing images total 22,074,890 bytes; six blank cells make no request. Each 2048 m interior includes an eight-metre real source gutter on all sides.

Forty-eight neighboring source-overlap checks cover 1,407,933 valid pixels: alpha agrees exactly and RGB differs by at most one code value from export rounding. Sixteen missing alpha pixels in one gutter were replaced with valid pixels at the identical geographic coordinates from the adjacent export; this is recorded in the manifest. Six unwitnessed holes remain transparent. No synthetic geographic content was introduced.

## Corrected base imagery

The Nellis 16K and 4K base JPEGs also retain their original geographic extent. Older 2048-pixel NAIP export blocks had their requested angular extent expanded to a square by the source service. The correction inverts the measured 1.243509522 aspect factor per block; boundary blocks use new, source-locked exports where the original image lacks data. The requested geographic coordinates are preserved with `adjustAspectRatio=false`.

The geographic correction updates 70.40% of the base image. Original Sentinel fill, its geographic mapping, the coverage mask, elevations and normals are preserved. Legacy feather data remains across 0.241% of the full area where original source radiance cannot be recovered. This correction changes image placement, not terrain geometry.

Independent one-metre geographic witnesses show a median normalized image correlation of 0.961 after correction and 79.3% lower high-pass alignment error. These are sampled image-registration checks, not a whole-scene realism score.
