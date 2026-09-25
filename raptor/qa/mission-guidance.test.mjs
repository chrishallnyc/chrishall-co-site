import test from 'node:test';
import assert from 'node:assert/strict';
import { missionObjectiveRows, missionNavigation } from '../src/game/missionguidance.js';
import { flightBrief } from '../src/game/flightbrief.js';
import { loadSortie } from '../src/campaign/authored.js';

function fixture(definitions, positions = []) {
  const summaries = definitions.map(definition => ({ ...definition, done: false, failed: false, count: 0, need: definition.need || 1 }));
  const pool = { state: new Float64Array(positions.length * 5), types: [], tag: [], slotUsed: [], n: positions.length,
    alive(slot) { return this.state[slot * 5 + 4] > 0; },
  };
  positions.forEach((position, slot) => {
    pool.state.set([position.x, position.y, 0, 0, position.hp ?? 100], slot * 5);
    pool.types[slot] = position.type || 'supply_truck'; pool.tag[slot] = position.tag || 0; pool.slotUsed[slot] = 1;
  });
  return { player: { fm: { state: new Float64Array([0, 0, 3000]) } }, battlefield: pool,
    missionData: { spec: { objectives: definitions }, lines: {} },
    script: { spec: { objectives: definitions }, objectiveSummary: () => summaries }, match: { over: 0 }, summaries,
  };
}

test('opening campaign has descriptive tasks and a real compass course to its ingress area', async () => {
  const sortie = await loadSortie('N01');
  const state = fixture(sortie.spec.objectives);
  state.missionData.spec = state.script.spec = sortie.spec;
  state.missionData.lines = sortie.lines;
  state.player.fm.state.set([-12000, -2000, 3600]);
  for (const slot of [12, 13, 15, 18]) state.battlefield.types[slot] = 'supply_truck';
  const rows = missionObjectiveRows(state);
  assert.deepEqual(rows.map(row => row.label), ['Reach the mission area', 'Destroy the convoy trucks', 'Destroy enemy aircraft']);
  const navigation = missionNavigation(state, rows);
  assert.equal(navigation.objectiveId, 1);
  assert.match(navigation.text, /^Heading 120° · 23\.7 km$/);
  assert.ok(navigation.bearing > 119 && navigation.bearing < 121);
  assert.equal(flightBrief(state).objectives[1].label, rows[1].label);
});

test('navigation follows living moving objectives and does not mutate combat state', () => {
  const state = fixture([{ id: 1, kind: 'destroy_tag', bfIdx: [0, 1], need: 2 }], [{ x: 1000, y: 0 }, { x: 3000, y: 0 }]);
  const before = [...state.battlefield.state];
  assert.equal(missionNavigation(state).text, 'Heading 090° · 1.0 km');
  assert.deepEqual([...state.battlefield.state], before);
  state.battlefield.state[0] = 500;
  state.battlefield.state[1] = -500;
  assert.equal(missionNavigation(state).text, 'Heading 135° · 0.7 km');
  state.battlefield.state[4] = 0;
  assert.equal(missionNavigation(state).text, 'Heading 090° · 3.0 km');
  state.battlefield.state[9] = 0;
  assert.equal(missionNavigation(state), null);
});

test('missing or vanished current targets never expose a later pending wave', () => {
  const state = fixture([
    { id: 1, kind: 'destroy_tag', bfIdx: [0], need: 1 },
    { id: 2, kind: 'reach_zone', zone: { x: 0, y: 10000, r: 1000 } },
  ], [{ x: 1000, y: 0, hp: 0 }]);
  assert.equal(missionNavigation(state), null);
  state.summaries[0].done = true;
  assert.equal(missionNavigation(state).objectiveId, 2);
  state.summaries[1].done = true;
  assert.equal(missionNavigation(state), null);
  state.summaries[1].done = false;
  state.match.over = -1;
  assert.equal(missionNavigation(state), null);
});

test('air objectives use the mission pool slots and hold later waves until the current objective completes', () => {
  const state = fixture([
    { id: 1, kind: 'destroy_tag', air: true, tag: 4, need: 1 },
    { id: 2, kind: 'destroy_tag', air: true, tag: 5, need: 1 },
  ]);
  state.missionData.spec.winWhen = [1, 2];
  state.bandits = { live: [1, 1, 1], tag: [4, 5, 4], state: new Float64Array(42), alive(slot) { return this.live[slot] === 1; } };
  state.script._bSlots = [0, 1];
  state.bandits.state.set([0, 2000, 3000], 0);
  state.bandits.state.set([-2000, 0, 3000], 14);
  state.bandits.state.set([100, 0, 3000], 28); // same tag, outside this mission
  assert.equal(missionNavigation(state).text, 'Heading 000° · 2.0 km');
  state.bandits.live[0] = 0;
  assert.equal(missionNavigation(state), null);
  state.summaries[0].done = true;
  assert.equal(missionNavigation(state).text, 'Heading 270° · 2.0 km');
});

test('N06 keeps ingress and required gun/convoy order while its optional ace remains alive', async () => {
  const sortie = await loadSortie('N06');
  const state = fixture(sortie.spec.objectives, Array.from({ length: 19 }, (_, slot) => ({
    x: 1000 + slot * 100, y: 2000, type: [14, 16].includes(slot) ? 'zsu' : 'supply_truck',
  })));
  state.missionData.spec = state.script.spec = sortie.spec;
  state.bandits = { live: [1], aceId: [1], tag: [32], state: new Float64Array([500, 0, 4000]), alive(slot) { return this.live[slot] === 1; } };
  assert.equal(missionNavigation(state).objectiveId, 1, 'optional ingress still leads into the mission');
  state.summaries.find(row => row.id === 1).done = true;
  assert.equal(missionNavigation(state).objectiveId, 2, 'first required target remains first');
  state.summaries.find(row => row.id === 2).done = true;
  assert.equal(missionNavigation(state).objectiveId, 3, 'required convoy takes priority over the earlier optional ace');
  assert.equal(state.summaries.find(row => row.id === 4).done, false);
  for (const slot of [12, 13, 15, 18]) state.battlefield.state[slot * 5 + 4] = 0;
  assert.equal(missionNavigation(state), null, 'a vanished required target does not switch to the optional ace');
});

test('M03 directs the pilot to required fighters after the ship, without requiring its optional pier column', async () => {
  const sortie = await loadSortie('M03');
  const state = fixture(sortie.spec.objectives, Array.from({ length: 17 }, (_, slot) => ({
    x: 1000 + slot * 100, y: 0, type: slot === 2 ? 'cargo_ship' : 'supply_truck',
  })));
  state.missionData.spec = state.script.spec = sortie.spec;
  state.bandits = { live: [1, 1], tag: [45, 45], state: new Float64Array(28), alive(slot) { return this.live[slot] === 1; } };
  state.bandits.state.set([0, 3000, 4000]); state.bandits.state.set([-5000, 0, 4000], 14);
  state.script._bSlots = [0, 1];
  assert.equal(missionNavigation(state).objectiveId, 1);
  state.summaries.find(row => row.id === 1).done = true;
  assert.equal(missionNavigation(state).objectiveId, 2);
  state.summaries.find(row => row.id === 2).done = true;
  const navigation = missionNavigation(state);
  assert.equal(navigation.objectiveId, 4);
  assert.equal(navigation.text, 'Heading 000° · 3.0 km');
  assert.equal(state.summaries.find(row => row.id === 3).done, false, 'optional trucks are still alive');
  state.bandits.live.fill(0);
  assert.equal(missionNavigation(state), null, 'missing required fighters do not send the pilot back to optional trucks');
});

test('authored labels win and protection objectives never become attack navigation', () => {
  const state = fixture([
    { id: 1, kind: 'protect_tag', air: true, tag: 2, zone: { x: 0, y: 1000, r: 500 } },
    { id: 2, kind: 'protect_tag', bfIdx: [0], need: 1 },
    { id: 3, kind: 'destroy_tag', bfIdx: [1], need: 1, labelId: 9 },
  ], [{ x: 2000, y: 0, type: 'cargo_ship' }, { x: -1000, y: 0, type: 'sam_radar' }]);
  state.missionData.lines[9] = 'Silence the radar';
  const rows = missionObjectiveRows(state);
  assert.equal(rows[0].label, 'Keep enemy aircraft out of the protected area');
  assert.equal(rows[1].label, 'Protect friendly ships');
  assert.equal(rows[2].label, 'Silence the radar');
  assert.equal(missionNavigation(state, rows).objectiveId, 3);
});

test('reach-area altitude gates explain why arriving overhead has not completed the objective', () => {
  const state = fixture([{ id: 1, kind: 'reach_zone', zone: { x: 0, y: 0, r: 1000, aglMax: 400 } }]);
  assert.equal(missionNavigation(state).text, 'In mission area · Below 1,312 ft above terrain');
  state.player.fm.state[0] = -3000;
  assert.equal(missionNavigation(state).text, 'Heading 090° · 3.0 km');
});

test('ace navigation follows only the named live ace and tolerates absent mission systems', () => {
  const state = fixture([{ id: 1, kind: 'kill_ace', aceId: 7 }]);
  state.bandits = { live: [1, 1], aceId: [3, 7], state: new Float64Array(28), alive(slot) { return this.live[slot] === 1; } };
  state.bandits.state.set([1000, 0, 3000]); state.bandits.state.set([0, -5000, 3000], 14);
  assert.equal(missionNavigation(state).text, 'Heading 180° · 5.0 km');
  state.bandits.live[1] = 0;
  assert.equal(missionNavigation(state), null);
  assert.deepEqual(missionObjectiveRows({}), []);
  assert.equal(missionNavigation({}), null);
});
