// Regional labels for the three city-focus views, verified 2026-09-14.
// Coordinates are longitude/latitude in WGS84. These are label anchors for
// geographic areas, not surveyed boundaries, structures, or building models.
// NYC anchors: Shapely representative_point() on the NYC DCP 26b land-only
// borough polygons at https://data.cityofnewyork.us/resource/gthc-hcne.geojson.
// This puts every borough label on its land instead of a county water centroid.
// USGS anchors use each monitoring location's published WGS84 coordinates;
// Angel Island uses NOAA's East Garrison tide-station location on the island.

const NYC_BOUNDARIES = 'https://data.cityofnewyork.us/City-Government/Borough-Boundaries/gthc-hcne';
const NYC_BOROUGHS = 'https://portal.311.nyc.gov/article/?kanumber=KA-02877';

export const CITY_DETAILS = [
  {
    id: 'detail-sf-angel-island', cityId: 'city-5391959', state: 'CA',
    name: 'Angel Island', type: 'feature', kind: 'island', labelPriority: 8,
    lat: 37.8633, lng: -122.42,
    description: 'An island landscape in the central bay, with wooded slopes, coastal trails, and the former immigration station.',
    sourceUrl: 'https://www.parks.ca.gov/?page_id=468',
    coordinateSourceUrl: 'https://tidesandcurrents.noaa.gov/benchmarks/9414818.html',
    coordinateNote: 'NOAA East Garrison tide-station location; an island label anchor, not its centroid.',
  },
  {
    id: 'detail-sf-alcatraz', cityId: 'city-5391959', state: 'CA',
    name: 'Alcatraz Island', type: 'feature', kind: 'island', labelPriority: 7,
    lat: 37.8266636, lng: -122.4230122,
    description: 'A small island in San Francisco Bay whose military, prison, and Indigenous occupation histories connect the city to the wider country.',
    sourceUrl: 'https://www.nps.gov/places/alcatraz-island.htm',
    coordinateSourceUrl: 'https://npgallery.nps.gov/AssetDetail?assetID=b4669471-e847-4ccb-8ee9-4f1b242a3289',
    coordinateNote: 'National Park Service Alcatraz Island location metadata.',
  },
  {
    id: 'detail-austin-lake-austin', cityId: 'city-4671654', state: 'TX',
    name: 'Lake Austin', type: 'feature', kind: 'lake', labelPriority: 8,
    lat: 30.3149283, lng: -97.7863958,
    description: 'The Colorado River reservoir winding through the hills northwest of central Austin.',
    sourceUrl: 'https://waterdata.usgs.gov/monitoring-location/USGS-08154900/',
    coordinateSourceUrl: 'https://waterdata.usgs.gov/monitoring-location/USGS-08154900/',
    coordinateNote: 'USGS Lake Austin monitoring-location anchor; published accuracy ±5 arcseconds.',
  },
  {
    id: 'detail-austin-colorado-river', cityId: 'city-4671654', state: 'TX',
    name: 'Colorado River', type: 'feature', kind: 'river', labelPriority: 8,
    lat: 30.2461389, lng: -97.6800556,
    description: 'The Texas Colorado River continues southeast from Lady Bird Lake through the lower ground east of Austin.',
    sourceUrl: 'https://waterdata.usgs.gov/monitoring-location/USGS-08158000/',
    coordinateSourceUrl: 'https://waterdata.usgs.gov/monitoring-location/USGS-08158000/',
    coordinateNote: 'Current USGS Colorado River at Austin monitoring-location anchor.',
  },
  {
    id: 'detail-nyc-manhattan', cityId: 'city-5128581', state: 'NY',
    name: 'Manhattan', type: 'feature', kind: 'borough', labelPriority: 12,
    lat: 40.7887087, lng: -73.9602511,
    description: 'New York County, one of New York City’s five boroughs. Its long main island lies between the Hudson and East rivers.',
    sourceUrl: NYC_BOROUGHS, coordinateSourceUrl: NYC_BOUNDARIES,
    coordinateNote: 'On-land representative point derived from the NYC DCP 26b Manhattan polygon.',
  },
  {
    id: 'detail-nyc-brooklyn', cityId: 'city-5128581', state: 'NY',
    name: 'Brooklyn', type: 'feature', kind: 'borough', labelPriority: 12,
    lat: 40.6543334, lng: -73.9486437,
    description: 'Kings County, one of New York City’s five boroughs, occupies the western end of Long Island beside the harbor.',
    sourceUrl: NYC_BOROUGHS, coordinateSourceUrl: NYC_BOUNDARIES,
    coordinateNote: 'On-land representative point derived from the NYC DCP 26b Brooklyn polygon.',
  },
  {
    id: 'detail-nyc-queens', cityId: 'city-5128581', state: 'NY',
    name: 'Queens', type: 'feature', kind: 'borough', labelPriority: 12,
    lat: 40.704093, lng: -73.8198711,
    description: 'Queens County, one of New York City’s five boroughs, stretches across western Long Island east of Brooklyn and the East River.',
    sourceUrl: NYC_BOROUGHS, coordinateSourceUrl: NYC_BOUNDARIES,
    coordinateNote: 'On-land representative point derived from the NYC DCP 26b Queens polygon.',
  },
  {
    id: 'detail-nyc-bronx', cityId: 'city-5128581', state: 'NY',
    name: 'The Bronx', type: 'feature', kind: 'borough', labelPriority: 12,
    lat: 40.8560724, lng: -73.8663318,
    description: 'Bronx County, one of New York City’s five boroughs, lies north of Manhattan across the Harlem River.',
    sourceUrl: NYC_BOROUGHS, coordinateSourceUrl: NYC_BOUNDARIES,
    coordinateNote: 'On-land representative point derived from the NYC DCP 26b Bronx polygon.',
  },
  {
    id: 'detail-nyc-staten-island', cityId: 'city-5128581', state: 'NY',
    name: 'Staten Island', type: 'feature', kind: 'borough', labelPriority: 12,
    lat: 40.5724907, lng: -74.1456425,
    description: 'Richmond County, one of New York City’s five boroughs, is the large island southwest of the Upper Bay.',
    sourceUrl: NYC_BOROUGHS, coordinateSourceUrl: NYC_BOUNDARIES,
    coordinateNote: 'On-land representative point derived from the NYC DCP 26b Staten Island polygon.',
  },
];

// These are editorial camera regions, not administrative boundaries.
// featureIds mixes the NEW detail IDs above with the existing geography.js IDs.
// Resolve them against [...FEATURES, ...CITY_DETAILS] to avoid duplicate places.
// Keep CITY_DETAILS out of state-wide lists until the related city is focused.
export const CITY_FOCUS = {
  'city-5391959': {
    state: 'CA', name: 'San Francisco', region: 'Bay Area',
    description: 'A closer look at the land beneath the city.',
    bounds: [[-122.56, 37.68], [-122.18, 37.94]],
    featureIds: [
      'feature-5352838', // Golden Gate
      'feature-5404318', // Twin Peaks
      'feature-5370478', // Marin Headlands
      'detail-sf-angel-island',
      'detail-sf-alcatraz',
      'feature-5391961', // San Francisco Bay
    ],
  },
  'city-4671654': {
    state: 'TX', name: 'Austin', region: 'Austin',
    description: 'Where the hills meet the river.',
    bounds: [[-97.88, 30.20], [-97.64, 30.39]],
    featureIds: [
      'feature-4737237', // Lady Bird Lake
      'feature-4672493', // Barton Creek
      'detail-austin-lake-austin',
      'detail-austin-colorado-river',
    ],
    // The existing Hill Country point is west of San Antonio. Do not relocate
    // that broad-region gazetteer point to imply an Austin landmark.
  },
  'city-5128581': {
    state: 'NY', name: 'New York City', region: 'New York City',
    description: 'Five boroughs, one extraordinary harbor.',
    bounds: [[-74.27, 40.49], [-73.69, 40.92]],
    featureIds: [
      'detail-nyc-manhattan',
      'detail-nyc-brooklyn',
      'detail-nyc-queens',
      'detail-nyc-bronx',
      'detail-nyc-staten-island',
      'feature-5121521', // Hudson River
      'feature-5116041', // East River
      'feature-5142010', // New York Harbor
      'feature-5112085', // Central Park
    ],
  },
};
