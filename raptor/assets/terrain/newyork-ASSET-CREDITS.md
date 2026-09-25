# New York terrain and aerial imagery

The 65.536 km New York region uses real geographic data from two public-domain
federal sources:

- Bare-earth elevations: [USGS 3DEP Dynamic Elevation Service](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer).
  USGS states that [3DEP products are available without use restrictions](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services).
- Natural-color aerial photography: USDA NAIP, distributed by the
  [USGS NAIP ImageServer](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer).
  Its service description identifies the imagery as public domain.

Credit: USGS National Map 3D Elevation Program; USGS, USDA, The National Map:
Orthoimagery.

`newyork-provenance.json` records the precise geographic bounds, original
source raster names and acquisition metadata, locked export requests, source
SHA256 values and shipped output hashes. Its 137 intersecting NAIP records
include New York imagery acquired in 2019 and New Jersey/Connecticut imagery
acquired in 2023, at native 0.6 m and 0.3 m respectively. These are resampled to
the stated output spacing. The imagery is modern; it is **not**
an aerial reconstruction of September 2001. The game's era-specific buildings
and story are authored separately.

The elevation export locks the two canonical USGS 1/3 arc-second products
`n41w075` and `n41w074` (service records 4841 and 5224). These products resolve
approximately 10 m north/south before sampling onto the game's 16 m grid.

The terrain origin is 40.70° north, 74.00° west. X increases eastward and Z
increases northward, with the first image row at the north edge. The heightfield
contains 4096 endpoint samples per axis; its export includes a half-sample
collar so ArcGIS pixel centers coincide with the game's mesh vertices. The
16,384-pixel aerial drape resolves nominal 4 m output pixels. Explicit geographic
aspect handling prevents the service from stretching or recentering the coast.

Tidal water and missing ocean elevation samples are set to a -15 m rendering
floor, following the other coastal Raptor regions. That floor is a rendering
convention, not measured bathymetry. No synthetic roads, islands, coastlines or
photographic detail were added to the aerial imagery. Missing image coverage
remains marked by the coverage mask so the terrain renderer can supply its
ordinary fallback. The preflight image crops the same land imagery; its
DEM-classified tidal water is colored a consistent harbor blue to remove
exposure seams between aerial acquisition years. The real shoreline is retained.

Rebuild using `raptor/bakery/bake_newyork.py`. Its `--download` option requests
the pinned source rasters; offline rebakes validate the source hashes before
decoding. Any upstream change to a pinned response is rejected for review.
Raw source exports belong in the ignored `.context/nyc/source` directory.
