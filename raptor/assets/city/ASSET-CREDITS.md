# New York city geometry

The building locations, footprint alignment, roof heights, ground elevations,
and construction years are derived from the **New York City Office of Technology
and Innovation Building Footprints** dataset, downloaded September 24, 2026.

- Dataset: https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue
- Official metadata: https://github.com/CityOfNewYork/nyc-geo-metadata/blob/master/Metadata/Metadata_BuildingFootprints.md
- Public open data information: https://www.nyc.gov/opendata/get-started/what-is-open-data-
- Source query, SHA-256 digest, row counts, and transformations are recorded in
  `newyork-buildings.provenance.json`. The reproducible bakery is
  `bakery/bake_newyork_city.py`.

Source roof heights and ground elevations are in US feet and converted to
metres. Footprints are simplified into oriented rectangular masses; selected
small buildings outside Manhattan are thinned on a 38 m grid. Roof setbacks,
facade colors, windows, and authored landmark/bridge silhouettes are original
procedural game art, not official surveyed 3-D data. This is a visual flight
environment and is not suitable for navigation.

The fictional 2001 aftermath filters the contemporary snapshot by construction
year and removes the World Trade Center site. Unknown dates and historic
demolitions cannot be reconstructed from this snapshot; it is not a complete
historical reconstruction.

Architectural scale references:

- Empire State Building, 443 m overall:
  https://www.esbnyc.com/about/facts-figures
- Statue of Liberty, 92.99 m ground to torch, 46.05 m statue:
  https://www.nps.gov/stli/learn/historyculture/statue-statistics.htm
- One World Trade Center:
  https://wtcprod.panynj.gov/en/local/learn-about-wtc/one-world-trade-center.html
- Brooklyn Bridge main span and clearance:
  https://www.nyc.gov/html/dot/html/bridges/brooklyn_bridge.shtml
- Williamsburg Bridge main span and tower height:
  https://www.nyc.gov/html/dot/html/infrastructure/williamsburg-bridge.shtml

No third-party photographs, facade images, or commercial landmark models are
used by the city geometry module.
