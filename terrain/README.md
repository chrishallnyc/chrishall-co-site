# TERRAIN — an American atlas

A static, interactive geography and history explorer at **chall.net/terrain/**. The Terrain Theater presents each state as a finite, floating landscape: measured elevation, a Census-clipped silhouette, decorative rock sides, warm directional light, and a dark stage. Large Cormorant typography and a compact city preview keep the opening view focused on the sculpture. Cities and historical places open a separate streamed terrain camera for closer detail.

## Explore

- All **50 states**, with real Census outlines, **265 city locations**, and **123 geographic features** (including nine city-detail labels). Alaska includes an antimeridian-safe Aleutian extent; Hawaii includes the main islands in the source boundary data.
- Real 3D state sculptures with pan, zoom, 360° rotation, tilt, automatic rotation, and fullscreen. Drag a sculpture to rotate; right-drag pans. The city/detail camera uses drag to pan and right-drag to turn, with its own distance scale. The visible gesture hint follows the active renderer.
- Natural colors with satellite texture, elevation colors, and contours derived from measured elevation. Overview relief defaults to **20×** for a readable miniature and is adjustable from **1× to 30×**. Cutaway sides are decorative, not geological reconstructions. City/detail terrain uses **2×**, shown separately; its finer streamed elevations are independent of the overview exaggeration.
- Search states, cities, landmarks, and historical places. SF, NYC, and LA abbreviations work. SF, Austin, and NYC have specific camera regions and nearby features, including all five NYC boroughs. City selection moves into a closer regional view; it does not load a 3D-building model.
- **78 curated historical places**, **9 themes**, **6 eras**, and **6 guided journeys**. Every state has at least one historical place; California and Texas have deeper opening collections.
- Each historical place includes a period, a sourced account, a short explanation of why geography mattered, and a direct source link.
- History themes and eras intersect. Long-running stories can appear in multiple eras. No-match selections explain the result and offer a reset.
- Guided journeys preserve their sequence across state boundaries. Lines connect related stories; they are not reconstructed historical paths or directions.
- Shareable links preserve the state, layer, filters, selected place, journey, terrain appearance, and relief. Camera bearing and exact zoom are intentionally not serialized.
- Keyboard-accessible lists, search, dialogs, source links, and controls; reduced-motion support; a compact mobile explorer with scrollable story sheets. Selected places appear in the left reading column on desktop; changing places resets the story scroll position and closing a story returns focus to its visible trigger.

## Starting journeys

- `?state=CA&layer=history&theme=gold-rush` — California's gold discovery, river commerce, mining towns, industrial extraction, and environmental consequences.
- `?journey=california-gold` — the five-place Gold Rush journey.
- `?state=TX&layer=history&theme=cowboys` — working cattle routes, rail connections, Mexican ranching traditions, and Panhandle ranch life.
- `?journey=texas-cowboys` — four connected Texas stories.
- `?journey=freedom-landscape` — five states connected through emancipation, equal education, and voting rights.
- `?journey=living-homelands` — distinct Indigenous communities, living traditions, and sovereignty.
- `?journey=new-york-stories` — African New York, immigrant arrivals, women's rights, and LGBTQ+ rights.
- `?journey=water-and-invention` — how rivers enabled industrial and technological change.

History is a growing editorial collection, not a complete inventory or a ranking of historical importance. It sits on today's map and imagery; borders and landscapes are not animated reconstructions of the past. Dates belong to the associated story, and some markers identify a regional site or interpretive venue rather than an exact original-event location.

## Data and rendering

- **Overview models:** all 50 states have compact local elevation rasters. California uses 1,024 samples along its longest axis; the other states use 768. Desktop/mobile meshes use suitable levels of detail. See [relief data, processing, attribution, and rebuild instructions](data/relief/README.md).
- **Detailed terrain:** [AWS Terrain Tiles / Mapzen](https://registry.opendata.aws/terrain-tiles/), served in Terrarium format. Source resolution varies geographically. Tiles are requested through zoom 15; zooming further can reveal finer imagery without adding new elevation measurements. These are terrain surfaces, not photogrammetric buildings.
- **Imagery:** Esri World Imagery. Provider attribution is visible on the map; the source mosaics images captured at different times and can show seams. Detailed natural views blend the imagery with elevation colors; actual water polygons from [OpenFreeMap](https://openfreemap.org/quick_start/) / OpenMapTiles / OpenStreetMap receive a consistent dark teal fill, with mapped bridge lines retained. This water styling falls back to the underlying imagery if its provider is unavailable.
- **Boundaries:** U.S. Census Bureau 2024 cartographic boundaries, 1:5,000,000, baked locally. See [GEOGRAPHY-SOURCES.md](data/GEOGRAPHY-SOURCES.md).
- **Cities and features:** [GeoNames](https://www.geonames.org/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Names and coordinates selected and reformatted for this atlas; city selection is editorial, not a current population ranking. Source URLs accompany each record.
- **History:** primary official park, state, museum, and site sources. See [history-sources.md](data/history-sources.md) for all sources, period conventions, and the distinction between sourced history and editorial geographic interpretation.
- **City detail labels:** official NPS, NOAA, USGS, and NYC DCP sources accompany records in [city-details.js](data/city-details.js). NYC borough anchors are verified against official land polygons.
- **Renderer:** locally vendored Three.js for state sculptures; MapLibre GL JS and maplibre-contour for streamed detail. [Versions, licenses, and official references](vendor/README.md).

No API keys, package install, or build step are required to serve the page. WebGL 2 is required. State outlines, overview elevations, interface, and place collection are local. Satellite imagery and closer terrain require an internet connection. Persistent imagery failure falls back to elevation colors; errors include a retry action, and historical reading remains available if map tiles fail.

## Run and verify

Serve the **repository root**, since the page uses `/terrain/` as its base and shares the site's font files:

```sh
python3 -m http.server 8080
# Open http://localhost:8080/terrain/
node --test terrain/qa/data.test.mjs
```

The browser integration battery uses an existing Playwright installation (not needed by the site). Install Playwright in your test environment, or point to its module:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
TERRAIN_BROWSER_CHANNEL=chrome \
node terrain/qa/browser.mjs
```

The battery starts its own local server and checks live terrain loading, filters, empty states, journeys, cross-state movement, URL restoration, city focus, surface controls, rotation, keyboard focus, mobile layout, and remote-tile failure. Data tests check state completeness, coordinates, boundary rings, antimeridian handling, city priorities, themes, eras, sources, and journey references. Browser screenshots are written to the gitignored `.context/terrain-qa/` directory.

## Maintain

`app.js` controls the interface and URL state. `style.css` supplies shared interface styles and `theater.css` sets the gallery composition. `map.js` coordinates two renderers: `diorama.js` owns finite state models and `detail-map.js` owns streamed city/site views. Data are independent ES modules in `data/`. Add a historical place with a stable ID, state, coordinates, a documented time window, primary theme, brief summary, geographic connection, and official source. Add its ID to a journey only when it supports that journey's narrative. Run both batteries after changing the data or navigation logic.
