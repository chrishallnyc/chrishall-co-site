import './register-three.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { missileEnvelope, selectMissileAdvisory } from '../src/game/weaponenvelope.js';
import { drawMissileEnvelopeCue } from '../src/game/combathud.js';
const { Missiles, SEEK_MIN, SEEK_MAX, SEEK_COS } = await import('../src/game/missiles.js');
const limits = { min: SEEK_MIN, max: SEEK_MAX, cos: SEEK_COS };

function player(heading = 0) {
  const state = new Float64Array(10);
  state[2] = 3000; state[3] = Math.cos(heading / 2); state[6] = Math.sin(heading / 2);
  state[7] = 200;
  return state;
}

function seekerAcquires(own, position) {
  // Run the production seeker decision without allocating render assets.
  const weapon = Object.assign(Object.create(Missiles.prototype), {
    lockTarget: -1, lockProgress: 0, ammo: 4,
    live: new Uint8Array(4), r: new Float64Array(36), _tp: new Float64Array(3), _tv: new Float64Array(3),
  });
  const battlefield = { n: 1, state: new Float64Array([...position, 10, 100]) };
  weapon.tick(null, 1 / 120, { state: own }, battlefield, false);
  return weapon.lockTarget === 0;
}

test('advisory classification matches the real seeker at range and cone boundaries across headings', () => {
  for (const heading of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const own = player(heading);
    for (const distance of [SEEK_MIN - .01, SEEK_MIN, SEEK_MIN + .01, 2000, SEEK_MAX - .01, SEEK_MAX, SEEK_MAX + .01]) {
      for (const angle of [0, 24.999, 25, 25.001, 50, 100]) {
        const direction = heading + angle * Math.PI / 180;
        const position = [Math.cos(direction) * distance, Math.sin(direction) * distance, 3000];
        const cue = missileEnvelope(own, ...position, limits);
        assert.equal(cue.reason === 'in-envelope', seekerAcquires(own, position), `${heading}, ${distance}, ${angle}`);
      }
    }
  }
});

test('envelope respects body pitch and 3D range, with no closure-speed or camera substitution', () => {
  const own = player();
  own[3] = Math.cos(Math.PI / 8); own[5] = -Math.sin(Math.PI / 8); // nose climbs 45 degrees in ENU
  const aligned = missileEnvelope(own, 2000, 0, 5000, limits);
  assert.equal(aligned.reason, 'in-envelope');
  assert.ok(Math.abs(aligned.distanceM - Math.sqrt(8e6)) < 1e-8);
  assert.equal(missileEnvelope(own, 2000, 0, 3000, limits).reason, 'off-axis');
  own[7] = -900;
  assert.deepEqual(missileEnvelope(own, 2000, 0, 5000, limits), aligned, 'flight velocity cannot rotate the seeker cone');
  assert.equal(missileEnvelope(own, NaN, 0, 5000, limits), null);
  assert.equal(missileEnvelope(own, 0, 0, 3000, limits).reason, 'near');
});

function bandits() {
  const pool = { live: new Uint8Array(8), side: new Uint8Array(8), state: new Float64Array(8 * 14) };
  for (let slot = 0; slot < 8; slot++) {
    pool.live[slot] = 1;
    pool.state.set([10000, slot * 100, 3000, 0, 0, 0, 100], slot * 14);
  }
  return pool;
}

test('selection excludes undetected/off-screen mask slots, friendly aircraft, dead aircraft, and contacts behind the nose', () => {
  const own = player(), pool = bandits(), out = {}, scratch = {};
  pool.side[0] = 1;
  pool.live[1] = 0;
  pool.state[2 * 14 + 6] = 0;
  pool.state[3 * 14] = -10000;
  // Slot four is closer to the nose but did not pass the main HUD's visibility
  // and detection gates. Slot five is the first actual advisory candidate.
  const visible = 0b11101111;
  assert.equal(selectMissileAdvisory(own, pool, visible, limits, out, scratch), out);
  assert.equal(out.slot, 5); assert.equal(out.reason, 'far');
  assert.equal(selectMissileAdvisory(own, pool, 0b00001111, limits, out, scratch), null);
  assert.equal(selectMissileAdvisory(own, pool, 0, limits, out, scratch), null, 'stale output is never presented without a visible target');
});

test('advisory targets the nearest nose angle with stable slot ties and leaves all gameplay state intact', () => {
  const own = player(), pool = bandits(), out = {}, scratch = {};
  pool.state[0] = 10000; pool.state[1] = 1000;
  pool.state[14] = 8000; pool.state[15] = 0;
  pool.state[28] = 6000; pool.state[29] = 0;
  const before = structuredClone({ own, pool });
  for (let frame = 0; frame < 60; frame++) assert.equal(selectMissileAdvisory(own, pool, 7, limits, out, scratch).slot, 1);
  assert.equal(out.reason, 'in-envelope');
  assert.deepEqual({ own, pool }, before);
  pool.state[14] = NaN;
  assert.equal(selectMissileAdvisory(own, pool, 7, limits, out, scratch).slot, 2, 'malformed contact data cannot hide another valid contact');
});

function context() {
  const marks = [], stack = [];
  return { marks, stack, font: '11px monospace',
    save() { stack.push(1); }, restore() { stack.pop(); },
    measureText(message) { return { width: message.length * 6.7 }; },
    strokeText() {},
    fillText(message, x, y, maxWidth) { marks.push({ message, x, y, width: Math.min(message.length * 6.7, maxWidth) }); },
  };
}
const palette = { lock: '#ffd27a' };
function draw(reason, patch = {}) {
  const ctx = context();
  const rendered = drawMissileEnvelopeCue(ctx, { reason }, { x: 640, y: 400, width: 1280, height: 800,
    limits, gunAmmo: 100, palette, ...patch });
  return { ctx, rendered, labels: ctx.marks.map(mark => mark.message) };
}

test('envelope text explains recovery without implying a lock or promising a launch', () => {
  assert.deepEqual(draw('far').labels, ['MISSILE · OUT OF RANGE', 'Close within 8.0 KM']);
  assert.deepEqual(draw('near').labels, ['MISSILE · TOO CLOSE', 'Use cannon, or open to 400 M']);
  assert.deepEqual(draw('near', { gunAmmo: 0 }).labels, ['MISSILE · TOO CLOSE', 'Open range to 400 M']);
  assert.deepEqual(draw('off-axis').labels, ['MISSILE · OUTSIDE SEEKER', 'Turn toward the target']);
  assert.deepEqual(draw('in-envelope').labels, ['MISSILE · HOLD TARGET AHEAD', 'Keep steady for acquisition']);
  assert.deepEqual(draw('far', { showHints: false }).labels, ['MISSILE · OUT OF RANGE']);
  for (const reason of ['near', 'far', 'off-axis', 'in-envelope']) assert.ok(draw(reason).labels.every(label => !/LOCK|launch/i.test(label)));
});

test('advisory labels avoid the diamond range/ace rows and honor viewport margins without obscuring crowded contacts', () => {
  for (const x of [17, 195, 373]) {
    for (const y of [120, 300, 500]) {
      const { ctx, rendered } = draw('far', { x, y, width: 390, height: 650, top: 100 });
      assert.equal(rendered, true);
      assert.ok(ctx.marks.every(mark => mark.x - mark.width / 2 >= 12 && mark.x + mark.width / 2 <= 378));
      assert.ok(ctx.marks.every(mark => mark.y >= 112 && mark.y <= 550));
      assert.ok(ctx.marks.every(mark => Math.abs(mark.y - (y + 26)) >= 14 && Math.abs(mark.y - (y - 18)) >= 14));
      assert.equal(ctx.stack.length, 0);
    }
  }
  assert.equal(draw('far', { x: 10 }).rendered, false, 'the existing partially visible diamond remains untouched');
  assert.equal(draw('far', { x: 195, y: 175, width: 390, height: 320, top: 150 }).rendered, false,
    'suppress optional advice when there is no room without hiding the contact or controls');
});
