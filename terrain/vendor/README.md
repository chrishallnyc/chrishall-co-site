# Terrain viewer dependencies

Vendored on 2026-09-14 so the page has no JavaScript CDN dependency or build step.

- MapLibre GL JS **6.9.0**: `maplibre-gl.mjs`, `maplibre-gl-shared.mjs`, `maplibre-gl-worker.mjs`, and `maplibre-gl.css` from the published npm package. See `MAPLIBRE-LICENSE.txt`.
- maplibre-contour **0.1.0**: `maplibre-contour.mjs` from the published npm package. See `CONTOUR-LICENSE.txt`.
- Three.js **0.186.0**: `three.module.js`, `three.core.js`, and `OrbitControls.js` from the published npm package. OrbitControls imports the local module in place of the package name. See `THREE-LICENSE.txt` (MIT).
- Cormorant Garamond **300 and 400**: local WOFF2 fonts, converted losslessly with fontTools from Google Fonts' original TTF files. See `CORMORANT-LICENSE.txt` (SIL Open Font License 1.1) and the [upstream font package](https://github.com/google/fonts/tree/main/ofl/cormorantgaramond).

Primary implementation references:

- https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/
- https://maplibre.org/maplibre-gl-js/docs/examples/add-a-color-relief-layer/
- https://maplibre.org/maplibre-gl-js/docs/examples/add-contour-lines/
- https://github.com/onthegomap/maplibre-contour
- https://threejs.org/docs/#PerspectiveCamera
- https://threejs.org/docs/#MeshStandardMaterial
- https://threejs.org/docs/#OrbitControls
- https://openfreemap.org/quick_start/
- https://openmaptiles.org/schema/#water

Three.js renders the finite state overviews from [locally baked elevation rasters](../data/relief/README.md) and Census polygons. The top is an elevation-displaced mesh, the outline is clipped to the real boundary, and the decorative strata are illustrative. The displayed 1–30× exaggeration changes measured terrain height, not horizontal geography. Satellite textures are optional: failed requests retain the elevation-derived surface palette. Selecting a city or historical site opens the finer streamed MapLibre terrain camera with 2× elevation exaggeration.

The streamed elevation tiles come from [Mapzen Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/), using Terrarium RGB encoding, up to tile zoom 15. The underlying source resolution varies; zooming farther does not manufacture new terrain measurements. Terrain is bare earth, rather than a photogrammetric building model. Elevation colors and contour lines are derived from the same elevation data; the relief control changes displayed vertical scale only.

[Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) supplies satellite/aerial imagery; coverage and resolution vary by location. Imagery and terrain stream on demand and require an internet connection. Source attribution is retained in the interactive map.

Detailed natural views blend imagery with elevation colors and apply a dark teal fill to actual water polygons from [OpenFreeMap](https://openfreemap.org/quick_start/), using the documented `https://tiles.openfreemap.org/planet` vector TileJSON and OpenMapTiles `water` layer. This reduces conspicuous acquisition seams across oceans and lakes without mistaking below-sea-level land for water. The fill excludes covered/tunnel and intermittent water; mapped bridge lines from the `transportation` layer remain visible over the water. Failed water requests leave the underlying imagery visible. Attribution credits OpenFreeMap, OpenMapTiles, and OpenStreetMap contributors. The overview imagery itself can still show variation between acquisitions.

Elevation source credits and terms: https://github.com/tilezen/joerd/blob/master/docs/attribution.md. USGS 3DEP, GMTED2010, and SRTM data are used for U.S. terrain, with NOAA ETOPO1 bathymetry; northern Alaska also uses ArcticDEM. Surrounding regions may include Canadian CDEM and INEGI Mexican elevation data. See the full source attribution document for source-specific credits.
