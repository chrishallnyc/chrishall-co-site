import test from 'node:test';
import assert from 'node:assert/strict';
import { captureTacticalMap, renderTacticalMapSVG } from '../src/game/tacticalmap.js';
import { missionNavigation } from '../src/game/missionguidance.js';
import { CAMPAIGN, SCENARIOS, loadSortie } from '../src/campaign/authored.js';
import { Script } from '../src/game/script.js';
import { FlightModel } from '../src/sim/flight.js';
import { BOUNDARY } from '../src/game/match.js';

function fixture(objectives = [], positions = []) {
  const fm = new FlightModel(); fm.initFlight({ x: 0, y: 0, headingRad: Math.PI / 2 });
  const spec = { objectives, winWhen: objectives.filter(row => row.kind !== 'protect_tag').map(row => row.id) };
  const summaries = objectives.map(row => ({ ...row, done: false, failed: false }));
  const battlefield = { state: new Float64Array(positions.length * 5), types: [], n: positions.length,
    alive(slot) { return this.state[slot * 5 + 4] > 0; } };
  positions.forEach(([x, y, hp = 100], slot) => {
    battlefield.state.set([x, y, 0, 0, hp], slot * 5); battlefield.types.push('supply_truck');
  });
  return { player: { fm }, battlefield, missionData: { spec, lines: {} },
    match: { over: 0, airfield: { x: -3000, y: -8700, r: 900 } },
    script: { spec, objectiveSummary: () => summaries }, summaries };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} should equal ${expected}`);

test('all campaign and standalone sorties use the actual objective state, static zones and current HUD navigation', async () => {
  for (const mission of [...CAMPAIGN,...SCENARIOS]) {
    const sortie = await loadSortie(mission.id), fm = new FlightModel();
    const spawn = sortie.spec.playerSpawn;
    fm.initFlight({ x: spawn.x, y: spawn.y, alt: spawn.alt, headingRad: spawn.headingDeg * Math.PI / 180 });
    const state = { player: { fm }, missionData: sortie, match: { over: 0, airfield: sortie.spec.airfield } };
    state.script = new Script(sortie.spec, { player: state.player, match: state.match });
    const before = state.script.hash(2166136261), specBefore = JSON.stringify(sortie.spec);
    const snapshot = captureTacticalMap(state), navigation = missionNavigation(state);
    assert.equal(snapshot.navigation?.objectiveId, navigation?.objectiveId, mission.id);
    assert.equal(snapshot.objectives.length, sortie.spec.objectives.length);
    const zones = sortie.spec.objectives.filter(row => ['reach_zone', 'protect_tag'].includes(row.kind) && row.zone);
    assert.equal(snapshot.markers.length, zones.length, `${mission.id}: unspawned dynamic targets have no marker`);
    for (const marker of snapshot.markers) {
      const definition = sortie.spec.objectives.find(row => row.id === marker.objectiveId);
      assert.equal(marker.x, definition.zone.x); assert.equal(marker.y, definition.zone.y); assert.equal(marker.radiusM, definition.zone.r);
      assert.equal(snapshot.objectives.find(row => row.id === marker.objectiveId).markerNumber, marker.number);
    }
    assert.equal(state.script.hash(2166136261), before); assert.equal(JSON.stringify(sortie.spec), specBefore);
    assert.ok(!/NaN|Infinity/.test(renderTacticalMapSVG(snapshot)), mission.id);
  }
});

test('map headings follow the real ENU flight quaternion across compass directions and pitch', () => {
  const state = fixture();
  for (const [headingRad, expected] of [[0, 90], [Math.PI / 2, 0], [Math.PI, 270], [-Math.PI / 2, 180]]) {
    for (const fpaRad of [0, .4, -.6]) {
      state.player.fm.initFlight({ headingRad, fpaRad, alphaDeg: 5 });
      near(captureTacticalMap(state).ownship.headingDeg, expected);
      assert.match(renderTacticalMapSVG(captureTacticalMap(state)), new RegExp(`rotate\\(${expected}\\)`));
    }
  }
  state.player.fm.state.fill(0, 3, 7);
  assert.equal(captureTacticalMap(state).ownship.headingDeg, null, 'an invalid quaternion never fabricates a course');
});

test('north renders above south, east right of west, with equal scales and an outside aircraft inside bounds', () => {
  const state = fixture([
    { id: 1, kind: 'reach_zone', zone: { x: -2000, y: 6000, r: 4000 } },
    { id: 2, kind: 'protect_tag', air: true, tag: 4, zone: { x: 5000, y: -2000, r: 900 } },
  ]);
  state.player.fm.state.set([BOUNDARY * 2, -BOUNDARY * 1.5]);
  const snapshot = captureTacticalMap(state), bounds = snapshot.bounds;
  assert.equal(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  assert.ok(bounds.maxX > state.player.fm.state[0] && bounds.minY < state.player.fm.state[1]);
  assert.ok(bounds.minX < -BOUNDARY && bounds.maxY > BOUNDARY);
  for (const marker of snapshot.markers) {
    assert.ok(bounds.minX < marker.x - marker.radiusM && bounds.maxX > marker.x + marker.radiusM);
    assert.ok(bounds.minY < marker.y - marker.radiusM && bounds.maxY > marker.y + marker.radiusM);
  }
  const svg = renderTacticalMapSVG(snapshot);
  const circles = [...svg.matchAll(/data-map-kind="(reach|protect)-zone" cx="([\d.]+)" cy="([\d.]+)"/g)];
  assert.equal(circles.length, 2); assert.ok(+circles[0][2] < +circles[1][2]); assert.ok(+circles[0][3] < +circles[1][3]);
  const [x, y] = svg.match(/data-map-kind="ownship" transform="translate\(([\d.]+) ([\d.]+)\)"/).slice(1).map(Number);
  assert.ok(x > 48 && x < 592 && y > 48 && y < 592);
});

test('only the current navigable target is plotted; later waves, optional contacts and dead targets stay hidden', () => {
  const state = fixture([
    { id: 1, kind: 'destroy_tag', bfIdx: [0], need: 1 },
    { id: 2, kind: 'destroy_tag', air: true, tag: 8, need: 1 },
    { id: 3, kind: 'kill_ace', aceId: 3 },
  ], [[4000, -2000]]);
  state.missionData.spec.winWhen = [1, 2];
  state.bandits = { live: [1, 1, 1], tag: [8, 0, 8], aceId: [0, 3, 0], state: new Float64Array(42), alive(slot) { return this.live[slot] === 1; } };
  state.bandits.state.set([9000, 8000, 3000]); state.bandits.state.set([-1000, 0, 3000], 14);
  state.bandits.state.set([100, 0, 3000], 28); // Same tag but outside this mission's slots.
  state.script._bSlots = [0, 1];
  let map = captureTacticalMap(state);
  assert.equal(map.markers.length, 1); assert.equal(map.markers[0].objectiveId, 1);
  near(map.navigation.x, 4000); near(map.navigation.y, -2000);
  state.battlefield.state[4] = 0;
  map = captureTacticalMap(state);
  assert.equal(map.navigation, null); assert.deepEqual(map.markers, [], 'a missing current target does not reveal the next wave');
  state.summaries[0].done = true;
  map = captureTacticalMap(state);
  assert.equal(map.markers.length, 1); assert.equal(map.markers[0].objectiveId, 2);
  near(map.navigation.x, 9000); near(map.navigation.y, 8000);
  state.summaries[1].done = true;
  assert.equal(captureTacticalMap(state).navigation, null, 'optional ace does not replace completed victory conditions');
  assert.equal(captureTacticalMap(state).objectives[2].markerNumber, null);
});

test('static zone status and immutable snapshots track completion and failure without writing to simulation state', () => {
  const state = fixture([
    { id: 1, kind: 'reach_zone', zone: { x: 1000, y: 2000, r: 300 } },
    { id: 2, kind: 'protect_tag', air: true, tag: 4, zone: { x: -1000, y: 0, r: 1000 } },
  ]);
  const prior = captureTacticalMap(state), before = [...state.player.fm.state];
  assert.equal(prior.markers[0].status, 'pending'); assert.equal(prior.markers[1].status, 'holding');
  state.summaries[0].done = true; state.summaries[1].failed = true;
  const current = captureTacticalMap(state);
  assert.equal(current.markers[0].status, 'complete'); assert.equal(current.markers[1].status, 'failed');
  assert.match(renderTacticalMapSVG(current), /✓ 1/); assert.match(renderTacticalMapSVG(current), /× 2/);
  assert.equal(prior.markers[0].status, 'pending'); assert.equal(prior.markers[1].status, 'holding');
  assert.deepEqual([...state.player.fm.state], before);
  assert.ok(Object.isFrozen(prior) && Object.isFrozen(prior.markers) && prior.markers.every(Object.isFrozen));
  state.match.over = 1; state.summaries[0].done = false;
  assert.equal(captureTacticalMap(state).navigation, null, 'finished matches have no active course');
});

test('practice and missing systems remain readable without touching unrelated aircraft or leaking raw SVG labels', () => {
  const fm = new FlightModel(); fm.initFlight({ x: 1000, y: -2000 });
  const practice = { player: { fm }, get bandits() { throw new Error('no radar access'); } };
  const map = captureTacticalMap(practice);
  assert.equal(map.boundary, null); assert.equal(map.airfield, null); assert.deepEqual(map.markers, []);
  assert.ok(!/NaN|Infinity/.test(renderTacticalMapSVG(captureTacticalMap())));
  const state = fixture([{ id: 1, kind: 'reach_zone', labelId: 1, zone: { x: 0, y: 0, r: 100 } }]);
  state.missionData.lines[1] = '<img src=x onerror="alert(1)"> & \'hostile\'';
  const svg = renderTacticalMapSVG(captureTacticalMap(state), { idPrefix: '"><script>alert(1)</script>' });
  assert.match(svg, /role="img" aria-labelledby="scriptalert1script-title scriptalert1script-description"/);
  assert.match(svg, /Tactical map, north up/); assert.match(svg, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#39;hostile&#39;/);
  assert.doesNotMatch(svg, /<img|<script/);
});
