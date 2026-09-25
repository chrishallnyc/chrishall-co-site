import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Missiles } from '../src/game/missiles.js';
import { Cockpit } from '../src/game/cockpit.js';
import { FlightModel } from '../src/sim/flight.js';

globalThis.document = { getElementById: () => null, createElement: () => ({ getContext: () => ({
  createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
}) }) };
globalThis.localStorage = { setItem() {} };

function fixture() {
  const weapon = new Missiles(new THREE.Scene()), fm = new FlightModel();
  fm.initFlight({ x: 0, y: 0, alt: 3000, headingRad: 0, speed: 200 });
  const battlefield = { n: 1, state: new Float64Array([1500, 0, 3000, 0, 100]), damage() {} };
  return { weapon, fm, battlefield,
    tick: fire => weapon.tick(null, 1 / 120, fm, battlefield, fire),
  };
}

function cockpit(weapon) {
  const messages = [];
  const cockpit = Object.assign(Object.create(Cockpit.prototype), {
    state: { ready: true, player: { missiles: weapon } }, paused: false,
    samples: [], lastStatus: 0, performance: {},
    missileLaunchSequence: 0, lastMissileFeedback: -Infinity,
    input: {}, controls: {}, guide: {}, log: {}, pauseDialog: { open: false },
    clearInput() {}, quiet() {}, applyOptions() {}, showPause() {}, renderPractice() {},
    toast(message, duration) {
      this.toastEl?.remove();
      const entry = { message, duration, removed: false, remove() { this.removed = true; } };
      messages.push(entry); this.toastEl = entry;
    },
  });
  return { cockpit, messages };
}

test('rejections report the actual post-seeker launch decision without changing weapon state', () => {
  const rejected = fixture(), idle = fixture();
  rejected.tick(true); idle.tick(false);
  assert.equal(rejected.weapon.launchOutcome, 'no-lock');
  assert.equal(rejected.weapon.launchSequence, 1);
  assert.equal(idle.weapon.launchSequence, 0);
  assert.equal(rejected.weapon.ammo, 4);
  assert.deepEqual(rejected.weapon.live, idle.weapon.live);
  assert.deepEqual(rejected.weapon.r, idle.weapon.r);
  assert.equal(rejected.weapon.hash(2166136261), idle.weapon.hash(2166136261),
    'render-only rejection feedback does not enter the simulation hash');
  for (let tick = 0; tick < 8; tick++) rejected.tick(false);
  assert.equal(rejected.weapon.launchSequence, 1, 'ticks without a command never repeat feedback');
  rejected.weapon.ammo = 0; rejected.tick(true);
  assert.equal(rejected.weapon.launchOutcome, 'empty', 'empty ammo takes precedence over no lock');
  assert.equal(rejected.weapon.launchSequence, 2);
});

test('a lock acquired on the launch tick is accepted and the final missile never reports empty', () => {
  const f = fixture();
  f.weapon.ammo = 1; f.weapon.lockTarget = 0; f.weapon.lockProgress = .695;
  assert.equal(f.weapon.locked(), false);
  f.tick(true);
  assert.equal(f.weapon.ammo, 0); assert.equal(f.weapon.live[0], 1);
  assert.equal(f.weapon.launchOutcome, 'launched'); assert.equal(f.weapon.launchSequence, 1);
  f.tick(true);
  assert.equal(f.weapon.launchOutcome, 'empty'); assert.equal(f.weapon.launchSequence, 2);
});

test('a target lost on the launch tick rejects honestly and consecutive valid commands have no invented cooldown', () => {
  const lost = fixture();
  lost.weapon.lockTarget = 0; lost.weapon.lockProgress = 1; lost.battlefield.n = 0;
  lost.tick(true);
  assert.equal(lost.weapon.launchOutcome, 'no-lock'); assert.equal(lost.weapon.ammo, 4);
  const valid = fixture();
  valid.weapon.lockTarget = 0; valid.weapon.lockProgress = 1;
  valid.tick(true); valid.tick(true);
  assert.equal(valid.weapon.ammo, 2); assert.equal(valid.weapon.launchOutcome, 'launched');
  assert.equal(valid.weapon.launchSequence, 2);
});

test('cockpit consumes each outcome once and rate-limits brief rejection status without delayed repeats', () => {
  const f = fixture(), ui = cockpit(f.weapon);
  ui.cockpit.update(0, 16); assert.equal(ui.messages.length, 0);
  f.tick(true); ui.cockpit.update(16, 16);
  assert.equal(ui.messages.length, 1);
  assert.equal(ui.messages[0].message, 'No missile lock. Keep a target ahead until LOCK appears.');
  assert.equal(ui.messages[0].duration, 1800);
  for (let frame = 2; frame <= 100; frame++) {
    f.tick(true); ui.cockpit.update(frame * 16, 16);
  }
  assert.equal(ui.messages.length, 1, 'rapid repeat commands do not reset or stack the toast');
  ui.cockpit.update(2100, 16);
  assert.equal(ui.messages.length, 1, 'suppressed feedback is consumed, not queued');
  f.weapon.ammo = 0; f.tick(true); ui.cockpit.update(2116, 16);
  assert.equal(ui.messages.length, 2); assert.equal(ui.messages[1].message, 'No missiles remaining.');
});

test('accepted launches clear only missile rejection feedback and unavailable weapons stay quiet', () => {
  const f = fixture(), ui = cockpit(f.weapon);
  f.tick(true); ui.cockpit.update(0, 16);
  const rejection = ui.messages[0];
  f.weapon.lockTarget = 0; f.weapon.lockProgress = 1;
  f.tick(true); ui.cockpit.update(16, 16);
  assert.equal(rejection.removed, true); assert.equal(ui.messages.length, 1);
  const unrelated = { removed: false, remove() { this.removed = true; } };
  ui.cockpit.toastEl = unrelated;
  f.tick(true); ui.cockpit.update(32, 16);
  assert.equal(unrelated.removed, false, 'a launch does not dismiss another cockpit status');
  ui.cockpit.state.player.missiles = null; ui.cockpit.update(48, 16);
  ui.cockpit.state.player.missiles = { launchSequence: 100, launchOutcome: 'unavailable' };
  ui.cockpit.update(64, 16);
  assert.equal(ui.messages.length, 1, 'unknown and absent weapons cannot imply no lock');
});

test('a practice crash discards the current frame outcome before pause and accepts fresh feedback after resuming', () => {
  const f = fixture(), ui = cockpit(f.weapon);
  ui.cockpit.practice = true;
  f.tick(true); // The command is resolved before the same frame detects a crash.
  ui.cockpit.onPracticeCrash();
  assert.equal(ui.cockpit.paused, true);
  assert.equal(ui.cockpit.missileLaunchSequence, f.weapon.launchSequence);
  ui.cockpit.update(16, 16);
  ui.cockpit.resume(); ui.cockpit.update(32, 16);
  assert.equal(ui.messages.length, 0, 'the pre-crash rejection never appears after recovery');
  assert.equal(ui.cockpit.state.resetFrameClock, true);
  f.tick(true); ui.cockpit.update(48, 16);
  assert.equal(ui.messages.length, 1, 'a new post-recovery command is still acknowledged');
});

test('pausing clears only a missile status and resets its rate limit for the next flight input', () => {
  const f = fixture(), ui = cockpit(f.weapon);
  f.tick(true); ui.cockpit.update(0, 16);
  const rejection = ui.messages[0];
  ui.cockpit.pause('focus', false);
  assert.equal(rejection.removed, true); assert.equal(ui.cockpit.missileFeedbackToast, null);
  ui.cockpit.resume();
  f.tick(true); ui.cockpit.update(32, 16);
  assert.equal(ui.messages.length, 2, 'fresh input after a quick pause is not suppressed by old feedback');
  const unrelated = { removed: false, remove() { this.removed = true; } };
  ui.cockpit.toastEl = unrelated;
  ui.cockpit.pause('manual', false);
  assert.equal(unrelated.removed, false, 'other cockpit status remains untouched');
  assert.equal(ui.cockpit.missileFeedbackToast, null);
  ui.cockpit.resume(); ui.cockpit.update(64, 16);
  assert.equal(ui.messages.length, 2, 'discarding old feedback does not replay it after resume');
});
