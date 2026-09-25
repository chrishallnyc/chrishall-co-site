import test from 'node:test';
import assert from 'node:assert/strict';
import { captureFlightDebrief, flightDuration } from '../src/game/flightdebrief.js';
import { Cockpit } from '../src/game/cockpit.js';
import { Match } from '../src/game/match.js';
import { Script } from '../src/game/script.js';

function fixture({ type = 'strike', objectives = [], winWhen = [], loseWhen = [], timeLimitS = 300 } = {}) {
  const player = { crashes: 0, hp: 74, gun: { ammo: 211 }, missiles: { ammo: 2 }, fm: { state: new Float64Array(32) } };
  player.fm.state[2] = 3000; player.fm.state[7] = 200;
  const battlefield = { n: 1, kills: 0, blueLosses: 0, types: ['supply_truck'], state: new Float64Array([0, 0, 0, 5, 10]), alive(i) { return this.state[i * 5 + 4] > 0; } };
  const match = new Match(battlefield, player);
  const spec = { type, objectives, winWhen, loseWhen, timeLimitS, bandits: [], comms: [] };
  const script = new Script(spec, { battlefield, player, match });
  return { player, battlefield, bandits: { kills: 2, blueLosses: 1 }, match, script, sim: { time: 65.8 }, missionData: { spec, lines: { 100: 'Destroy the convoy' } } };
}

test('a real scripted completion yields actual sortie metrics without personal kill attribution', () => {
  const state = fixture({ objectives: [{ id: 1, kind: 'destroy_tag', bfIdx: [0], need: 1, labelId: 100 }], winWhen: [1] });
  assert.equal(captureFlightDebrief(state), null);
  state.battlefield.state[4] = 0; state.battlefield.kills = 1;
  state.script.tick(state.sim, 1 / 120);
  assert.equal(state.match.over, 1);
  const report = captureFlightDebrief(state);
  assert.deepEqual(report.metrics, [
    { label: 'Flight time', value: '1:05' },
    { label: 'Enemy aircraft lost', value: 2 },
    { label: 'Enemy surface losses', value: 1 },
    { label: 'Your aircraft lost', value: 0 },
  ]);
  assert.deepEqual(report.objectives, [{ label: 'Destroy the convoy', status: 'complete', detail: '' }]);
  assert.equal(report.friendlyLosses, 1);
  assert.deepEqual(report.aircraft, { hull: 74, cannon: 211, missiles: 2 });
  assert.doesNotMatch(JSON.stringify(report), /accuracy|shots fired|personal|best|lifetime/i);
});

test('terminal match defeat reports exhausted aircraft without the cosmetic respawn hull or ammunition', () => {
  const state = fixture();
  state.player.crashes = 3; state.player.hp = 100;
  state.player.gun.ammo = 480; state.player.missiles.ammo = 4;
  state.match.tick(state.sim, 1 / 120);
  assert.equal(state.match.over, -1);
  const report = captureFlightDebrief(state);
  assert.equal(report.noAircraft, true);
  assert.equal(report.aircraft, null);
  assert.equal(report.metrics.find(metric => metric.label === 'Your aircraft lost').value, 3);
  const cockpit = Object.assign(Object.create(Cockpit.prototype), { state, practice: false });
  const html = cockpit.renderDebrief();
  assert.match(html, /No aircraft remaining/);
  assert.doesNotMatch(html, /100% hull|480 cannon|4 missiles/);
});

test('defensive timeout wins retain incomplete optional tasks and protected objectives without inventing completion', () => {
  const state = fixture({ type: 'escort', timeLimitS: 60,
    objectives: [{ id: 1, kind: 'destroy_tag', bfIdx: [0], need: 3 }, { id: 2, kind: 'protect_tag', bfIdx: [0], need: 1 }],
    winWhen: [1], loseWhen: [2],
  });
  state.script.tick(state.sim, 1 / 120);
  assert.equal(state.match.over, 1);
  const report = captureFlightDebrief(state);
  assert.equal(report.won, true);
  assert.deepEqual(report.objectives.map(objective => [objective.status, objective.detail]), [['incomplete', '0 / 3'], ['protected', '']]);
});

test('failed mission objectives preserve authored labels and expose failure, not a live countdown', () => {
  const state = fixture({ objectives: [{ id: 1, kind: 'protect_tag', bfIdx: [0], labelId: 100 }], winWhen: [1], loseWhen: [1] });
  state.battlefield.state[4] = 0;
  state.script.tick(state.sim, 1 / 120);
  assert.equal(state.match.over, -1);
  state.missionData.lines[100] = '<img src=x onerror=alert(1)> Protect convoy';
  const cockpit = Object.assign(Object.create(Cockpit.prototype), { state, practice: false });
  const html = cockpit.renderDebrief();
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; Protect convoy/);
  assert.match(html, /Failed/);
  assert.match(html, /sortie-objectives" open/);
  assert.doesNotMatch(html, /<img|remaining ·|Keep safe/);
});

test('debrief statistics freeze at the first completed observation across final-orbit and menu changes', () => {
  const state = fixture();
  const cockpit = Object.assign(Object.create(Cockpit.prototype), { state, practice: false });
  assert.equal(cockpit.captureDebrief(), null);
  state.match.over = 1;
  const report = cockpit.captureDebrief();
  const before = cockpit.renderDebrief();
  state.sim.time += 80; state.player.hp = 20; state.player.crashes = 2;
  state.battlefield.kills += 4; state.bandits.kills += 1;
  assert.equal(cockpit.captureDebrief(), report);
  assert.equal(cockpit.renderDebrief(), before);
  assert.throws(() => { report.metrics[0].value = '9:99'; }, TypeError);
});

test('practice, ongoing flights and unavailable telemetry never invent a sortie report or zero counters', () => {
  const cockpit = Object.assign(Object.create(Cockpit.prototype), { state: fixture(), practice: true });
  cockpit.state.match.over = 1;
  assert.equal(cockpit.captureDebrief(), null);
  assert.equal(captureFlightDebrief({}), null);
  assert.equal(captureFlightDebrief({ match: { over: 0 } }), null);
  const report = captureFlightDebrief({ match: { over: -1 }, sim: { time: NaN }, battlefield: { kills: NaN }, bandits: { blueLosses: 1 } });
  assert.deepEqual(report.metrics, []);
  assert.equal(report.aircraft, null);
  assert.equal(report.friendlyLosses, null);
  assert.equal(flightDuration(-2), null); assert.equal(flightDuration(Infinity), null);
  assert.equal(flightDuration(0), '0:00'); assert.equal(flightDuration(3661.9), '1:01:01');
});
