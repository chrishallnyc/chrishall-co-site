# Terrain viewer dependencies

Vendored on 2026-09-14 so the page has no JavaScript CDN dependency or build step.

- MapLibre GL JS **6.9.0**: `maplibre-gl.mjs`, `maplibre-gl-shared.mjs`, `maplibre-gl-worker.mjs`, and `maplibre-gl.css` from the published npm package. See `MAPLIBRE-LICENSE.txt`.
- maplibre-contour **0.1.0**: `maplibre-contour.mjs` from the published npm package. See `CONTOUR-LICENSE.txt`.

Primary implementation references:

- https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/
- https://maplibre.org/maplibre-gl-js/docs/examples/add-a-color-relief-layer/
- https://maplibre.org/maplibre-gl-js/docs/examples/add-contour-lines/
- https://github.com/onthegomap/maplibre-contour

The streamed elevation tiles come from [Mapzen Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/), using Terrarium RGB encoding, up to tile zoom 15. The underlying source resolution varies; zooming farther does not manufacture new terrain measurements. Terrain is bare earth, rather than a photogrammetric building model. Elevation colors and contour lines are derived from the same elevation data; the relief control changes displayed vertical scale only.

[Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) supplies satellite/aerial imagery; coverage and resolution vary by location. Imagery and terrain stream on demand and require an internet connection. Source attribution is retained in the interactive map.

Elevation source credits and terms: https://github.com/tilezen/joerd/blob/master/docs/attribution.md. USGS 3DEP, GMTED2010, and SRTM data are used for U.S. terrain, with NOAA ETOPO1 bathymetry; northern Alaska also uses ArcticDEM. Surrounding regions may include Canadian CDEM and INEGI Mexican elevation data. See the full source attribution document for source-specific credits.
