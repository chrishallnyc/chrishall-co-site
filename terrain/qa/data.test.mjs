import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATES, CITIES, FEATURES } from '../data/geography.js';
import { HISTORY_PLACES, HISTORY_THEMES, HISTORY_ERAS, HISTORY_TRAILS } from '../data/history.js';
import { CITY_DETAILS, CITY_FOCUS } from '../data/city-details.js';

const stateCodes = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ').sort();
const boundaries = JSON.parse(readFileSync(new URL('../data/states.geojson', import.meta.url), 'utf8'));
const stateByCode = new Map(STATES.map(state => [state.code, state]));
const geometryByCode = new Map(boundaries.features.map(feature => [feature.properties.code, feature.geometry]));
const historyById = new Map(HISTORY_PLACES.map(place => [place.id, place]));
const allPlaces = [...CITIES, ...FEATURES, ...CITY_DETAILS, ...HISTORY_PLACES];

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

function polygons(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Sufficient for checking nearby state/shoreline placement. This projects each
// segment locally around the point; it is not a navigation-distance calculation.
function distanceToSegmentKm(point, a, b) {
  const xScale = Math.cos(point[1] * Math.PI / 180) * 111.32;
  const ax = (a[0] - point[0]) * xScale;
  const ay = (a[1] - point[1]) * 111.32;
  const bx = (b[0] - point[0]) * xScale;
  const by = (b[1] - point[1]) * 111.32;
  const dx = bx - ax, dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function distanceToStateKm(place) {
  const point = [place.lng, place.lat];
  const parts = polygons(geometryByCode.get(place.state));
  for (const [shell, ...holes] of parts) {
    if (inRing(point, shell) && !holes.some(hole => inRing(point, hole))) return 0;
  }
  let distance = Infinity;
  for (const polygon of parts) for (const ring of polygon) {
    for (let i = 1; i < ring.length; i++) distance = Math.min(distance, distanceToSegmentKm(point, ring[i - 1], ring[i]));
  }
  return distance;
}

test('all 50 states have a matching outline, city destinations, geographic features, and history', () => {
  assert.deepEqual(STATES.map(state => state.code).sort(), stateCodes);
  assert.deepEqual(boundaries.features.map(feature => feature.properties.code).sort(), stateCodes);
  assert.deepEqual([...new Set(HISTORY_PLACES.map(place => place.state))].sort(), stateCodes);
  for (const { code, name } of STATES) {
    assert.ok(CITIES.filter(place => place.state === code).length >= 5, `${name}: at least five city destinations`);
    assert.equal(CITIES.filter(place => place.state === code && place.capital).length, 1, `${name}: exactly one capital`);
    assert.ok(FEATURES.filter(place => place.state === code).length >= 2, `${name}: at least two geographic features`);
  }
});

test('polygon rings and overview bounds preserve Alaska and Hawaii without antimeridian jumps', () => {
  for (const feature of boundaries.features) {
    const { code } = feature.properties;
    assert.match(feature.geometry.type, /^(MultiPolygon|Polygon)$/);
    const { bounds } = stateByCode.get(code);
    assert.ok(bounds[0][0] < bounds[1][0] && bounds[0][1] < bounds[1][1], `${code}: ordered bounds`);
    for (const polygon of polygons(feature.geometry)) for (const ring of polygon) {
      assert.ok(ring.length >= 4, `${code}: ring needs at least three edges`);
      assert.deepEqual(ring[0], ring.at(-1), `${code}: rings must close`);
      for (let i = 0; i < ring.length; i++) {
        const [lng, lat] = ring[i];
        assert.ok(Number.isFinite(lng) && Number.isFinite(lat), `${code}: finite geometry`);
        assert.ok(lng >= bounds[0][0] && lng <= bounds[1][0] && lat >= bounds[0][1] && lat <= bounds[1][1], `${code}: outline fits its overview bounds`);
        if (i) assert.ok(Math.abs(lng - ring[i - 1][0]) < 180, `${code}: no edge crosses the whole world`);
      }
    }
  }
  assert.ok(stateByCode.get('AK').bounds[0][0] < -180, 'western Aleutians must remain present');
  assert.ok(stateByCode.get('AK').bounds[1][0] - stateByCode.get('AK').bounds[0][0] < 65, 'Alaska must fit as one region');
  assert.ok(polygons(geometryByCode.get('HI')).length >= 6, 'Hawaii must retain its separate main islands');
});

test('place IDs are unique and coordinates remain close to the assigned state', () => {
  unique(allPlaces.map(place => place.id), 'place IDs');
  for (const place of allPlaces) {
    assert.ok(stateByCode.has(place.state), `${place.id}: recognized state`);
    assert.ok(Number.isFinite(place.lng) && Number.isFinite(place.lat), `${place.id}: finite coordinates`);
    assert.ok(Math.abs(place.lng) <= 180 && Math.abs(place.lat) <= 90, `${place.id}: WGS84 point range`);
    assert.ok(typeof place.name === 'string' && place.name.trim(), `${place.id}: display name`);
    // Census's 1:5m outlines omit small islands and simplify tidal shorelines.
    // Three kilometres allows Alcatraz, Fort Sumter, and Sand Island Light.
    // Bay anchors may sit farther offshore because these are land outlines.
    // This still catches reversed coordinates and distant state assignments.
    const distance = distanceToStateKm(place);
    const toleranceKm = place.kind === 'bay' ? 5 : 3;
    assert.ok(distance <= toleranceKm, `${place.id}: ${distance.toFixed(2)} km outside ${place.state}`);
  }
});

test('San Francisco, Austin, and New York City have distinct, prioritized destinations', () => {
  const required = [
    ['San Francisco', 'CA', [-122.55, 37.65, -122.3, 37.85]],
    ['Austin', 'TX', [-97.9, 30.1, -97.6, 30.5]],
    ['New York City', 'NY', [-74.3, 40.5, -73.6, 41]],
  ];
  for (const [name, state, [west, south, east, north]] of required) {
    const places = CITIES.filter(place => place.name === name && place.state === state);
    assert.equal(places.length, 1, `${name}: one destination`);
    const place = places[0];
    assert.ok(place.lng >= west && place.lng <= east && place.lat >= south && place.lat <= north, `${name}: expected metro area`);
    assert.ok(place.labelPriority > 0, `${name}: labels must survive ordinary city decluttering`);
  }
});

test('city focus regions resolve their local features and keep every new anchor in its city region', () => {
  const byId = new Map(allPlaces.map(place => [place.id, place]));
  for (const [cityId, focus] of Object.entries(CITY_FOCUS)) {
    assert.equal(byId.get(cityId)?.state, focus.state);
    assert.ok(focus.featureIds.length >= 4);
    unique(focus.featureIds, `${cityId}: regional features`);
    for (const id of focus.featureIds) assert.equal(byId.get(id)?.state, focus.state, `${id}: referenced feature in correct state`);
  }
  for (const place of CITY_DETAILS) {
    const focus = CITY_FOCUS[place.cityId];
    assert.ok(focus?.featureIds.includes(place.id), `${place.id}: discoverable from its city`);
    const [[west, south], [east, north]] = focus.bounds;
    assert.ok(place.lng >= west && place.lng <= east && place.lat >= south && place.lat <= north, `${place.id}: within camera region`);
    assert.equal(new URL(place.coordinateSourceUrl).protocol, 'https:');
  }
  assert.equal(CITY_DETAILS.filter(place => place.kind === 'borough').length, 5, 'all five NYC boroughs are labeled');
});

test('history themes and contiguous eras support every story', () => {
  unique(HISTORY_THEMES.map(theme => theme.id), 'theme IDs');
  unique(HISTORY_ERAS.map(era => era.id), 'era IDs');
  const themeIds = new Set(HISTORY_THEMES.map(theme => theme.id));
  const eras = [...HISTORY_ERAS].sort((a, b) => a.start - b.start);
  for (const [index, era] of eras.entries()) {
    assert.ok(Number.isInteger(era.start) && Number.isInteger(era.end) && era.start <= era.end, `${era.id}: ordered years`);
    if (index) assert.equal(eras[index - 1].end + 1, era.start, 'era ranges must have no gaps or overlaps');
  }
  for (const place of HISTORY_PLACES) {
    assert.ok(themeIds.has(place.theme), `${place.id}: known theme`);
    assert.ok(Number.isInteger(place.startYear) && Number.isInteger(place.endYear) && place.startYear <= place.endYear, `${place.id}: ordered narrative years`);
    assert.ok(place.startYear >= eras[0].start && place.endYear <= eras.at(-1).end, `${place.id}: dates covered by era filters`);
    for (const field of ['period', 'summary', 'landscape']) assert.ok(typeof place[field] === 'string' && place[field].trim(), `${place.id}: ${field}`);
  }
});

test('story trails resolve to unique places and accurately list their states', () => {
  unique(HISTORY_TRAILS.map(trail => trail.id), 'trail IDs');
  for (const trail of HISTORY_TRAILS) {
    assert.ok(trail.placeIds.length >= 2, `${trail.id}: needs multiple stops`);
    unique(trail.placeIds, `${trail.id} stop IDs`);
    unique(trail.states, `${trail.id} state codes`);
    for (const id of trail.placeIds) assert.ok(historyById.has(id), `${trail.id}: missing stop ${id}`);
    const actualStates = [...new Set(trail.placeIds.map(id => historyById.get(id).state))].sort();
    assert.deepEqual([...trail.states].sort(), actualStates, `${trail.id}: states must match its destinations`);
  }
});

test('California Gold Rush and Texas cowboy trails retain the core requested history', () => {
  const required = [
    ['california-gold', 'CA', 'gold-rush', ['coloma', 'columbia', 'empire-mine', 'malakoff', 'old-sacramento']],
    ['texas-cowboys', 'TX', 'cowboys', ['king-ranch', 'fort-worth-stockyards', 'fort-griffin', 'goodnight-ranch']],
  ];
  for (const [id, state, theme, stops] of required) {
    const trail = HISTORY_TRAILS.find(item => item.id === id);
    assert.ok(trail, `${id}: available story trail`);
    for (const stop of stops) {
      assert.ok(trail.placeIds.includes(stop), `${id}: missing ${stop}`);
      assert.equal(historyById.get(stop)?.state, state);
      assert.equal(historyById.get(stop)?.theme, theme);
    }
  }
  // These regional bounds independently prevent the two flagship destinations
  // from drifting to a similarly named place while retaining the right state.
  const coloma = historyById.get('coloma');
  assert.ok(coloma.lat > 38.79 && coloma.lat < 38.82 && coloma.lng > -120.92 && coloma.lng < -120.88, 'Coloma: American River discovery landscape');
  const stockyards = historyById.get('fort-worth-stockyards');
  assert.ok(stockyards.lat > 32.78 && stockyards.lat < 32.8 && stockyards.lng > -97.36 && stockyards.lng < -97.33, 'Stockyards: north Fort Worth district');
});

test('every place carries a usable source link and every historical source has a label', () => {
  for (const place of allPlaces) {
    const raw = place.sourceUrl || place.source?.url;
    assert.ok(raw, `${place.id}: source link`);
    const url = new URL(raw);
    assert.equal(url.protocol, 'https:', `${place.id}: HTTPS source`);
    assert.ok(url.hostname.includes('.') && !url.hostname.endsWith('.example') && !url.hostname.endsWith('example.com'), `${place.id}: real source domain`);
    assert.equal(url.username + url.password, '', `${place.id}: no credentials in source links`);
    if (place.source) assert.ok(place.source.label.trim(), `${place.id}: named historical source`);
  }
});
