# Geography data and attribution

This directory contains an offline selection of real geographic data for the
American terrain explorer. No runtime geocoding API is needed.

## State boundaries

- Source: [US Census Bureau, 2024 cartographic boundary files](https://www.census.gov/geographies/mapping-files/2024/geo/carto-boundary-file.html).
- Download: [`cb_2024_us_state_5m.zip`](https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_5m.zip), fetched September 14, 2026.
- Scale: 1:5,000,000. These are generalized cartographic outlines, not cadastral
  boundaries or the source of the 3D elevation model.
- Conversion: filter `STUSPS` to the 50 states; convert the shapefile to GeoJSON;
  simplify at 0.002 degrees with topology preservation; round coordinates to
  five decimal places. Preserve all polygons supplied for those states.
- Feature properties: `code` is the two-letter postal abbreviation; `name` is
  the state name. Feature `id` is the numeric Census state FIPS code.
- Alaska: positive eastern-hemisphere longitudes have 360 subtracted. Its
  western Aleutians therefore use longitudes below -180. This keeps geometry
  continuous across the antimeridian and gives map bounds of approximately
  `[-187.54, 51.22]` to `[-129.97, 71.35]`. Do not normalize those longitudes
  individually before fitting bounds or drawing the polygons.
- Hawaii: the source includes the main islands. Small remote northwestern
  islets absent from this generalized source are not fabricated or added.
- `STATES` is alphabetized by state name. Bounds come from the converted
  geometry; centers are polygon centroids, with an editorial Alaska anchor
  near the main landmass. These are viewing anchors, not official state centers.

## Cities and geographic features

- Source: [GeoNames](https://www.geonames.org/), primarily integrating USGS GNIS
  for US place names. See [GeoNames data sources](https://www.geonames.org/datasources/).
- Download: [`US.zip`](https://download.geonames.org/export/dump/US.zip), fetched
  September 14, 2026. Its [format and license](https://download.geonames.org/export/dump/readme.txt)
  document the WGS84 latitude and longitude fields.
- License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
  Keep visible attribution to GeoNames in the explorer's credits or Sources.
- Every city and feature includes a `sourceUrl` pointing to its individual
  GeoNames record. Its numeric ID is retained in `city-…` or `feature-…`.
- `CITIES` contains 265 editorially selected major population centers: at least
  five per state, plus every state capital. Populations helped select initial
  candidates; nested neighborhoods, duplicate boroughs, and ambiguous records
  were curated. This is **not** a claim about current population rankings or
  municipal incorporation. Population figures are deliberately not published.
- `FEATURES` contains 114 geographic anchors, with at least two per state.
  California, Texas, and New York include extra local features around San
  Francisco, Austin, and New York City. Feature coordinates are copied from
  the cited records, with same-name places disambiguated by state and type.
- Short display names, `kind`, state introductions, and feature descriptions
  are editorial. Regional labels use representative anchors: they do not
  identify an entrance, route, precise boundary, or an entire feature's extent.
  Park-based coordinates frame terrain; subterranean cave geometry is not
  included in the surface elevation model.
- Some GeoNames records retain older national-park designations. Current short
  display names were checked against the National Park Service for
  [Indiana Dunes](https://www.nps.gov/indu/),
  [White Sands](https://www.nps.gov/whsa/), and
  [New River Gorge](https://www.nps.gov/neri/).

## Validation

The extraction was checked for exactly 50 unique states and 50 matching valid
polygon geometries, unique point IDs, at least five city anchors and two
geographic features per state, exactly one capital per state, finite WGS84
coordinates, and point proximity to its assigned state (allowing generalized
shorelines and water features). All 50 polygon geometries remained valid after
simplification and rounding. The boundary GeoJSON is approximately 808 KB.

Terrain tiles, map imagery, and historical entries have separate attribution;
the data in these files does not supply those layers.
