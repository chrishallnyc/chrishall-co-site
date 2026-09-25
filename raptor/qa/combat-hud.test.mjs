import test from 'node:test';
import assert from 'node:assert/strict';
import {
  targetKinematics, nearestMissileThreat, formatCombatRange, drawSeekerCue, drawMissileWarning,
  drawMissileEnvelopeCue, ticketBarTop, combatLabelTop,
} from '../src/game/combathud.js';

function player(heading = 0) {
  const state = new Float64Array(13);
  state[2] = 3000;
  state[3] = Math.cos(heading / 2); state[6] = Math.sin(heading / 2);
  state[7] = Math.cos(heading) * 200; state[8] = Math.sin(heading) * 200;
  return state;
}

test('target closure uses relative radial velocity, including crossing and departing targets', () => {
  const own = player(), position = new Float64Array([2000, 0, 3000]);
  const velocity = new Float64Array([-100, 0, 0]), out = {};
  assert.equal(targetKinematics(own, position, velocity, out), out, 'caller reuses its record');
  assert.deepEqual(out, { rangeM: 2000, closingMs: 300 });
  velocity[0] = 400;
  assert.equal(targetKinematics(own, position, velocity, out).closingMs, -200);
  velocity.set([200, 400, 0]);
  assert.equal(targetKinematics(own, position, velocity, out).closingMs, 0, 'crossing speed is not closing speed');
  position.set([0, 0, 3100]); velocity.set([0, 0, -50]);
  assert.deepEqual(targetKinematics(own, position, velocity, out), { rangeM: 100, closingMs: 50 });
  position[2] = 3000;
  assert.deepEqual(targetKinematics(own, position, velocity, out), { rangeM: 0, closingMs: 0 });
});

test('target readout is translation invariant and never mutates flight or directory arrays', () => {
  const own = player(), position = new Float64Array([2000, -1000, 3500]);
  const velocity = new Float64Array([-200, 50, 10]);
  const before = [own.slice(), position.slice(), velocity.slice()];
  const first = targetKinematics(own, position, velocity);
  assert.deepEqual([own, position, velocity], before);
  for (let axis = 0; axis < 3; axis++) { own[axis] += 999999; position[axis] += 999999; }
  assert.deepEqual(targetKinematics(own, position, velocity), first);
  position[0] = NaN;
  assert.equal(targetKinematics(own, position, velocity), null);
});

function missilePools() {
  return {
    battlefield: { samLive: new Uint8Array(4), sam: new Float64Array(44) },
    bandits: { mLive: new Uint8Array(8), msl: new Float64Array(96) },
  };
}

test('missile warning selects nearest live player threat across pools without warning for surface attacks', () => {
  const own = player(), { battlefield, bandits } = missilePools(), out = {};
  assert.equal(nearestMissileThreat(own, battlefield, bandits, out), null);
  bandits.mLive[0] = 1; bandits.msl.set([50, 0, 3000]); bandits.msl[11] = 4;
  assert.equal(nearestMissileThreat(own, battlefield, bandits, out), null, 'ground-target bandit missile is not incoming');
  battlefield.samLive[0] = 1; battlefield.sam.set([-2000, 0, 3000]);
  bandits.mLive[1] = 1; bandits.msl.set([0, -1000, 3000], 12); bandits.msl[23] = -2;
  const before = [battlefield.sam.slice(), bandits.msl.slice()];
  assert.equal(nearestMissileThreat(own, battlefield, bandits, out), out);
  assert.equal(out.rangeM, 1000); assert.equal(out.count, 2); assert.equal(out.clock, 3);
  assert.deepEqual([battlefield.sam, bandits.msl], before);
  bandits.mLive[1] = 0;
  assert.equal(nearestMissileThreat(own, battlefield, bandits, out).clock, 6);
  battlefield.samLive[0] = 0;
  assert.equal(nearestMissileThreat(own, battlefield, bandits, out), null, 'destroyed missiles never leave stale warnings');
  assert.equal(out.count, 0);
});

test('air-to-air incoming warnings work without a battlefield and invalid missile slots are ignored', () => {
  const own = player(), { bandits } = missilePools();
  bandits.mLive[0] = 1; bandits.msl.set([500, 0, 3000]); bandits.msl[11] = -2;
  assert.equal(nearestMissileThreat(own, null, bandits).clock, 12);
  bandits.mLive[1] = 1; bandits.msl[12] = NaN; bandits.msl[23] = -2;
  assert.equal(nearestMissileThreat(own, null, bandits).count, 1);
});

test('clock bearings follow the aircraft nose across headings and vertical threats are labeled honestly', () => {
  const { battlefield } = missilePools(); battlefield.samLive[0] = 1;
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const own = player(heading);
    for (const clock of [12, 3, 6, 9]) {
      const angle = heading - clock * Math.PI / 6;
      battlefield.sam.set([Math.cos(angle) * 1000, Math.sin(angle) * 1000, 3000]);
      const threat = nearestMissileThreat(own, battlefield, null);
      assert.equal(threat.clock, clock, `heading ${heading}, clock ${clock}`);
      assert.equal(threat.vertical, null);
    }
  }
  battlefield.sam.set([0, 0, 2000]);
  assert.equal(nearestMissileThreat(player(), battlefield, null).vertical, 'BELOW');
  battlefield.sam[2] = 4000;
  assert.equal(nearestMissileThreat(player(), battlefield, null).vertical, 'ABOVE');
});

const palette = { good: '#9be89b', lock: '#ffd27a', friendly: '#7fb4e8', warn: '#ff5a3c' };
function context() {
  const marks = [], stack = [];
  const ctx = {
    marks, stack, globalAlpha: 1, font: '11px monospace',
    save() { stack.push({ globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, stack.pop()); },
    measureText(message) { return { width: message.length * Number(this.font.match(/(\d+)px/)[1]) * .61 }; },
    fillText(message, x, y, maxWidth) {
      marks.push({ type: 'text', message, x, y, color: this.fillStyle, alpha: this.globalAlpha,
        fontSize: Number(this.font.match(/(\d+)px/)[1]),
        width: Math.min(this.measureText(message).width, maxWidth ?? Infinity) });
    },
    strokeText() {}, setLineDash() {}, strokeRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {},
    fillRect(x, y, width, height) { marks.push({ type: 'rect', x, y, width, height, color: this.fillStyle }); },
  };
  return ctx;
}
function seeker(ctx, patch = {}) {
  drawSeekerCue(ctx, { x: 640, y: 400, width: 1280, height: 800,
    rangeM: 2400, closingMs: 100, locked: true, progress: 1, ammo: 4, palette, ...patch });
  return ctx.marks.filter(mark => mark.type === 'text').map(mark => mark.message);
}

test('seeker feedback distinguishes acquisition, actual launch availability, friendly aircraft, and missing bindings', () => {
  const ready = context();
  assert.deepEqual(seeker(ready, { launchKey: 'Left Ctrl + K' }), ['LOCK', '2.4 KM · CLOSING 190 KT', 'Left Ctrl + K · launch missile']);
  const acquiring = context();
  assert.deepEqual(seeker(acquiring, { locked: false, progress: .5 }), ['ACQUIRING', '2.4 KM · CLOSING 190 KT', 'Keep target ahead']);
  assert.ok(acquiring.marks.some(mark => mark.type === 'rect' && mark.width === 15 && mark.height === 3));
  assert.deepEqual(seeker(context(), { friendly: true }), ['FRIENDLY', '2.4 KM · CLOSING 190 KT', 'HOLD FIRE']);
  assert.deepEqual(seeker(context(), { ammo: 0 }), ['NO MISSILES', '2.4 KM · CLOSING 190 KT']);
  assert.ok(seeker(context(), { launchKey: 'Unassigned' }).includes('Assign a missile key in Controls'));
  assert.ok(seeker(context(), { ace: true }).includes('★ LOCK'), 'selected aces retain their identity marker');
  assert.deepEqual(seeker(context(), { showHints: false }), ['LOCK', '2.4 KM · CLOSING 190 KT']);
  assert.ok(seeker(context(), { friendly: true, showHints: false }).includes('HOLD FIRE'), 'friendly-fire warning stays visible without hints');
  assert.ok(seeker(context(), { closingMs: -100 }).some(label => label.includes('OPENING 190 KT')));
  assert.ok(seeker(context(), { closingMs: 1 }).some(label => label.includes('RANGE STEADY')));
});

test('seeker labels stay within a narrow viewport and clear toolbar and lower controls', () => {
  for (const x of [17, 195, 373]) for (const y of [20, 280, 530]) {
    const ctx = context();
    seeker(ctx, { x, y, width: 390, height: 550, top: 150, bottom: 100 });
    for (const mark of ctx.marks.filter(mark => mark.type === 'text')) {
      assert.ok(mark.x - mark.width / 2 >= 11.9 && mark.x + mark.width / 2 <= 378.1, `${mark.message} fits horizontally`);
      assert.ok(mark.y >= 164 && mark.y <= 450, `${mark.message} clears the toolbar and lower controls: ${mark.y}`);
    }
    assert.equal(ctx.stack.length, 0);
  }
  assert.deepEqual(seeker(context(), { x: -100 }), [], 'off-screen contacts do not leave orphan text');
});

test('seeker and envelope labels clear ticket bars at every HUD scale and retain the old no-match reserve', () => {
  for (const scale of [.8, 1, 1.4]) for (const toolbar of [0, 70, 116, 150]) {
    const ticketBottom = ticketBarTop(toolbar, scale) + 9;
    const top = combatLabelTop(toolbar, scale, true);
    for (const y of [136, 154, 200, 280, 450]) {
      const seekerContext = context();
      seeker(seekerContext, { x: 195, y, width: 390, height: 650, top });
      const advisoryContext = context();
      drawMissileEnvelopeCue(advisoryContext, { reason: 'far' }, { x: 195, y, width: 390, height: 650,
        limits: { min: 400, max: 8000 }, palette, top });
      for (const mark of [...seekerContext.marks, ...advisoryContext.marks].filter(mark => mark.type === 'text')) {
        assert.ok(mark.y - mark.fontSize > ticketBottom,
          `${mark.message} at scale ${scale}, toolbar ${toolbar}, contact y${y} clears ticket bar y${ticketBottom}`);
      }
    }
    assert.equal(combatLabelTop(toolbar, scale, false), (toolbar || 70) + 20,
      'without match tickets, labels keep their existing toolbar reserve at every scale');
  }
  assert.equal(ticketBarTop(70, 1.4), 110, 'enlarged flight instruments raise the tickets above the toolbar reserve');
  assert.equal(combatLabelTop(70, 1.4, true), 134);
});

test('seeker reports whether it replaced the contact, preserving fallback diamonds at each viewport edge', () => {
  const options = { x: 195, y: 280, width: 390, height: 550,
    rangeM: 2400, closingMs: 100, locked: true, ammo: 4, palette };
  for (const point of [{ x: 10 }, { x: 380 }, { y: 10 }, { y: 540 }, { x: NaN }]) {
    const ctx = context();
    assert.equal(drawSeekerCue(ctx, { ...options, ...point }), false,
      'a partially visible contact still needs its existing diamond and range');
    assert.equal(ctx.marks.length, 0);
    assert.equal(ctx.stack.length, 0);
  }
  const ctx = context();
  assert.equal(drawSeekerCue(ctx, options), true, 'a visible seeker takes ownership of the contact');
  assert.ok(ctx.marks.some(mark => mark.message === 'LOCK'));
});

test('compact-height seeker labels stay between controls and retain friendly warnings when hints cannot fit', () => {
  const ctx = context();
  const options = { x: 195, y: 175, width: 390, height: 320, top: 150, bottom: 100 };
  assert.equal(seeker(ctx, options).length, 3);
  for (const mark of ctx.marks.filter(mark => mark.type === 'text')) {
    assert.ok(mark.y >= 164 && mark.y <= 220, `${mark.message} remains between toolbar and controls`);
  }
  const crowded = context();
  assert.deepEqual(seeker(crowded, { ...options, top: 186, friendly: true }), ['FRIENDLY · HOLD FIRE', '2.4 KM · CLOSING 190 KT']);
  assert.ok(crowded.marks.filter(mark => mark.type === 'text').every(mark => mark.y >= 200 && mark.y <= 220));
});

test('threat cue repeats bearing in text, counts missiles, and is steady with reduced motion', () => {
  const threat = { count: 2, rangeM: 830, clock: 6, bearing: Math.PI, vertical: null };
  for (const time of [0, 300]) {
    const ctx = context();
    drawMissileWarning(ctx, threat, { width: 390, height: 550, top: 150, color: palette.warn, time, motionReduce: true });
    const messages = ctx.marks.filter(mark => mark.type === 'text');
    assert.deepEqual(messages.map(mark => mark.message), ['MISSILES ×2', "6 O'CLOCK · 830 M · BREAK TURN"]);
    assert.ok(messages.every(mark => mark.alpha === 1));
    assert.ok(messages.every(mark => mark.x - mark.width / 2 >= 12 && mark.x + mark.width / 2 <= 378));
    assert.equal(ctx.stack.length, 0);
  }
  const noThreat = context();
  drawMissileWarning(noThreat, null, { width: 390, height: 550 });
  assert.equal(noThreat.marks.length, 0);
  assert.equal(formatCombatRange(999), '1000 M');
  assert.equal(formatCombatRange(1000), '1.0 KM');
});
