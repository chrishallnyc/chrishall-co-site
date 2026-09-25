import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, REARM_AGL_MAX, REARM_SPEED_MAX, REARM_TIME, BOUNDARY, BOUNDARY_GRACE } from '../src/game/match.js';
import { airfieldGuidance, boundaryGuidance, drawAirfieldGuidance, drawBoundaryGuidance } from '../src/game/matchguidance.js';
import { nearestMissileThreat, drawMissileWarning } from '../src/game/combathud.js';

const DT = 1 / 120;
function fixture() {
  const state = new Float64Array(10);
  state[0] = 100; state[2] = 200; state[3] = 1; state[7] = 100;
  const player = { fm: { state, out: { agl: 9999, v: 9999 } }, crashes: 0,
    gun: { ammo: 200 }, missiles: { ammo: 2 }, hp: 75,
    terrain: { heightAt: () => 100 }, takeHit(value) { this.hp -= value; } };
  const match = new Match(null, player, { airfield: { x: 0, y: 0, r: 900 } });
  match.scripted = true;
  return { match, player, state, tick: (dt = DT) => match.tick(null, dt) };
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} vs ${expected}`);

test('rearm cue uses the exact strict zone, clearance and total-speed rules used by Match.tick', () => {
  for (const patch of [
    { x: 899.99 }, { x: 900 }, { x: 900.01 },
    { altitude: 100 + REARM_AGL_MAX - .01 }, { altitude: 100 + REARM_AGL_MAX }, { altitude: 100 + REARM_AGL_MAX + .01 },
    { speed: REARM_SPEED_MAX - .01 }, { speed: REARM_SPEED_MAX }, { speed: REARM_SPEED_MAX + .01 },
    { altitude: 100 + REARM_AGL_MAX, speed: REARM_SPEED_MAX },
  ]) {
    const { match, player, state, tick } = fixture();
    state[0] = patch.x ?? state[0]; state[2] = patch.altitude ?? state[2]; state[7] = patch.speed ?? state[7];
    const cue = airfieldGuidance(match);
    tick();
    assert.equal(cue.eligible, match.rearming, JSON.stringify(patch));
    assert.equal(airfieldGuidance(match, player).rearming, match.rearming);
  }
});

test('rearm reads current terrain and 3D world velocity, including vertical motion and sea-level ground clamping', () => {
  const { match, player, state, tick } = fixture();
  state[7] = 90; state[9] = 90;
  player.fm.out.v = 10; player.fm.out.agl = 5;
  const cue = airfieldGuidance(match);
  close(cue.speedMs, Math.sqrt(90 ** 2 * 2));
  assert.equal(cue.reason, 'fast', 'horizontal speed and stale derived airspeed cannot imply eligibility');
  tick(); assert.equal(match.rearming, false);
  state[9] = 0; player.terrain.heightAt = () => -200; state[2] = REARM_AGL_MAX - 1;
  assert.equal(airfieldGuidance(match).aglM, REARM_AGL_MAX - 1);
  tick(); assert.equal(match.rearming, true);
});

test('airfield navigation uses the actual per-match pad and distinguishes each actionable blocker', () => {
  const { match, state } = fixture();
  match.airfield = { x: 4100, y: 3000, r: 1000 };
  const cue = airfieldGuidance(match);
  assert.equal(cue.distanceM, 5000); close(cue.heading, 53.13010235415598);
  assert.equal(cue.reason, 'outside'); assert.equal(cue.radiusM, 1000);
  state[0] = 4100; state[1] = 3000; state[2] = 100 + REARM_AGL_MAX;
  assert.equal(airfieldGuidance(match).reason, 'high');
  state[7] = REARM_SPEED_MAX;
  assert.equal(airfieldGuidance(match).reason, 'high-fast');
  state[2] = 200;
  assert.equal(airfieldGuidance(match).reason, 'fast');
  state[7] = 100;
  assert.equal(airfieldGuidance(match).reason, 'ready');
});

test('rearm progress matches the real four-second refill, resets immediately outside conditions and never changes simulation state', () => {
  const { match, player, state, tick } = fixture(), out = {};
  for (let i = 0; i < 240; i++) tick();
  const before = { hash: match.hash(2166136261), state: state.slice(), gun: player.gun.ammo, aam: player.missiles.ammo, hp: player.hp };
  assert.equal(airfieldGuidance(match, player, out), out);
  close(out.progress, .5); close(out.remainingS, REARM_TIME / 2);
  assert.deepEqual({ hash: match.hash(2166136261), state, gun: player.gun.ammo, aam: player.missiles.ammo, hp: player.hp }, before);
  state[7] = REARM_SPEED_MAX; tick();
  assert.equal(airfieldGuidance(match).progress, 0);
  state[7] = 100;
  for (let i = 0; i <= Math.ceil(REARM_TIME / DT); i++) tick();
  assert.deepEqual([player.gun.ammo, player.missiles.ammo, player.hp], [480, 4, 100]);
  assert.equal(airfieldGuidance(match), null, 'completed supplies cannot show a new 0% rearm cycle');
});

test('airfield card stays quiet after minor expenditure and surfaces for low stores, damage, or an approaching refill', () => {
  const { match, player, state } = fixture();
  state[0] = 5000; player.gun.ammo = 479; player.missiles.ammo = 4; player.hp = 100;
  assert.equal(airfieldGuidance(match).visible, false);
  player.gun.ammo = 120; assert.equal(airfieldGuidance(match).visible, true);
  player.gun.ammo = 479; player.missiles.ammo = 0; assert.equal(airfieldGuidance(match).visible, true);
  player.missiles.ammo = 4; player.hp = 50; assert.equal(airfieldGuidance(match).visible, true);
  player.hp = 100; state[0] = 2000; assert.equal(airfieldGuidance(match).visible, true);
  match.outside = true; assert.equal(airfieldGuidance(match).visible, false);
});

test('boundary navigation points toward the nearest safe edge or corner in all quadrants', () => {
  const { match, state } = fixture();
  for (const [x, y, heading] of [
    [BOUNDARY + 1000, 4000, 270], [-BOUNDARY - 1000, 4000, 90],
    [4000, BOUNDARY + 1000, 180], [4000, -BOUNDARY - 1000, 0],
    [BOUNDARY + 1000, BOUNDARY + 1000, 225], [-BOUNDARY - 1000, -BOUNDARY - 1000, 45],
  ]) {
    state[0] = x; state[1] = y;
    const cue = boundaryGuidance(match);
    close(cue.heading, heading);
    const destinationX = x + Math.sin(cue.heading * Math.PI / 180) * cue.distanceM;
    const destinationY = y + Math.cos(cue.heading * Math.PI / 180) * cue.distanceM;
    assert.ok(Math.abs(destinationX) < BOUNDARY && Math.abs(destinationY) < BOUNDARY);
    assert.ok(cue.distanceM < 1600, 'return course does not waste the grace period pointing at the arena center');
  }
  state[0] = BOUNDARY; state[1] = 0;
  assert.equal(boundaryGuidance(match), null, 'the exact boundary remains legal like Match.tick');
});

test('boundary countdown and damage state agree with real Match ticks and disappear immediately on reentry', () => {
  const { match, player, state, tick } = fixture(); state[0] = BOUNDARY + 50;
  assert.equal(boundaryGuidance(match).remainingS, BOUNDARY_GRACE);
  tick(BOUNDARY_GRACE);
  assert.equal(boundaryGuidance(match).penalty, false, 'grace is strict greater-than in the rules');
  assert.equal(player.hp, 75);
  tick(.25);
  assert.equal(boundaryGuidance(match).penalty, true); assert.equal(player.hp, 74);
  state[0] = BOUNDARY - 1;
  assert.equal(boundaryGuidance(match), null);
  tick(); assert.equal(match.boundaryT, 0);
});

test('ended matches and invalid telemetry never create navigation coordinates', () => {
  const { match, state } = fixture(); match.over = 1;
  assert.equal(airfieldGuidance(match), null); assert.equal(boundaryGuidance(match), null);
  match.over = 0; state[0] = NaN;
  assert.equal(airfieldGuidance(match), null); assert.equal(boundaryGuidance(match), null);
  assert.equal(airfieldGuidance(null), null); assert.equal(boundaryGuidance(null), null);
});

const palette = { good: '#9be89b', lock: '#ffd27a', warn: '#ff5a3c' };
function context() {
  const marks = [], stack = [];
  return { marks, stack, font: '11px monospace', globalAlpha: 1,
    save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); },
    measureText(value) { return { width: value.length * 6.5 }; },
    fillText(value, x, y, maxWidth) { marks.push({ type: 'text', value, x, y, maxWidth, alpha: this.globalAlpha }); },
    strokeText() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {},
    fillRect(x, y, width, height) { marks.push({ type: 'rect', x, y, width, height }); },
  };
}

test('rearm drawing exposes conditions, accurate progress, and actual pad navigation inside narrow screens', () => {
  const { match, tick } = fixture(); tick(1.5);
  for (const [width, height] of [[1280, 800], [390, 550], [390, 320]]) {
    const ctx = context(); drawAirfieldGuidance(ctx, airfieldGuidance(match), { width, height, palette });
    const labels = ctx.marks.filter(mark => mark.type === 'text');
    assert.ok(labels.some(mark => /AIRFIELD.*270°.*100 M/.test(mark.value)));
    assert.ok(labels.some(mark => /REARMING 37%.*2.5s/.test(mark.value)));
    assert.ok(labels.some(mark => /1,312 ft AGL.*233 kt/.test(mark.value)));
    assert.ok(labels.every(mark => mark.y > 0 && mark.y < height - 100 && mark.maxWidth <= width - 24));
    assert.equal(ctx.stack.length, 0);
  }
});

test('boundary and incoming-missile warnings stack without overlap and stay steady with reduced motion', () => {
  const { match, state, tick } = fixture(); state[0] = BOUNDARY + 1000; tick(2);
  for (const [width, height, top] of [[1280, 800, 100], [390, 550, 150], [390, 320, 150]]) {
    const ctx = context();
    const bottom = drawBoundaryGuidance(ctx, boundaryGuidance(match), { width, height, top, palette, time: 350, motionReduce: true });
    drawMissileWarning(ctx, { count: 1, clock: 6, bearing: Math.PI, rangeM: 1000 },
      { width, height, color: palette.warn, top: bottom + 6, time: 350, motionReduce: true });
    const plates = ctx.marks.filter(mark => mark.type === 'rect' && mark.width > 100);
    assert.equal(plates.length, 2);
    assert.ok(plates[0].y + plates[0].height < plates[1].y, 'the actionable boundary course stays clear of the missile warning');
    assert.ok(plates.every(mark => mark.x >= 12 && mark.x + mark.width <= width - 12 && mark.y >= 0 && mark.y + mark.height <= height));
    const labels = ctx.marks.filter(mark => mark.type === 'text');
    assert.ok(labels.some(mark => /270°.*1.1 KM to safety/.test(mark.value)));
    assert.ok(labels.some(mark => /6s until hull damage/.test(mark.value)));
    assert.ok(labels.every(mark => mark.alpha === 1));
    assert.equal(ctx.stack.length, 0);
  }
});

test('airfield guidance yields to an actual incoming missile on a short viewport', () => {
  const { match, state, tick } = fixture(); tick(1.5);
  const incoming = { samLive: new Uint8Array([1]), sam: new Float64Array(11) };
  incoming.sam[0] = 300; incoming.sam[2] = 200;
  const threat = nearestMissileThreat(state, incoming, null);
  assert.equal(threat.count, 1);
  const ctx = context(), width = 390, height = 320, toolbarBottom = 116;
  const ticketY = Math.max(86, 82, toolbarBottom + 9);
  assert.equal(drawAirfieldGuidance(ctx, airfieldGuidance(match), {
    width, height, top: ticketY + 24, bottom: 100, incomingMissile: !!threat, palette,
  }), false);
  drawMissileWarning(ctx, threat, { width, height, top: toolbarBottom + 35, color: palette.warn, motionReduce: true });
  const plates = ctx.marks.filter(mark => mark.type === 'rect' && mark.width > 100);
  assert.equal(plates.length, 1, 'the airfield plate cannot sit beneath the urgent warning');
  assert.ok(ctx.marks.some(mark => mark.type === 'text' && mark.value === 'MISSILE'));
  assert.equal(ctx.marks.some(mark => mark.type === 'text' && mark.value.includes('AIRFIELD')), false);
});

test('airfield plates respect toolbar, tickets and bottom reserves, compact or hide as needed', () => {
  const { match, tick } = fixture(); tick(1.5);
  const width = 390, height = 320;
  for (const [toolbarBottom, bottom, expectedHeight] of [[116, 100, 60], [150, 100, null], [150, 68, 60]]) {
    const ticketY = Math.max(86, 82, toolbarBottom + 9), top = ticketY + 24;
    const ctx = context();
    const drawn = drawAirfieldGuidance(ctx, airfieldGuidance(match), { width, height, top, bottom, palette });
    assert.equal(drawn, expectedHeight !== null);
    if (!drawn) { assert.equal(ctx.marks.length, 0, 'insufficient space must not paint over existing controls'); continue; }
    const plate = ctx.marks.find(mark => mark.type === 'rect');
    assert.equal(plate.height, expectedHeight);
    assert.ok(plate.y >= top && plate.y > ticketY + 9 && plate.y > toolbarBottom);
    assert.ok(plate.y + plate.height <= height - bottom);
    const labels = ctx.marks.filter(mark => mark.type === 'text');
    assert.equal(labels.length, 3, 'compact mode preserves navigation, action and eligibility conditions');
    assert.ok(labels.some(mark => /REARMING 37%.*2.5s/.test(mark.value)));
    assert.ok(labels.some(mark => /1,312 ft AGL.*233 kt/.test(mark.value)));
    assert.ok(labels.every(mark => mark.y > plate.y && mark.y < plate.y + plate.height));
    assert.equal(ctx.stack.length, 0);
  }
});

test('compact boundary and missile plates stay below captured-pointer controls and tickets', () => {
  const { match, state, tick } = fixture(); state[0] = BOUNDARY + 1000; tick(2);
  const width = 390, height = 320, toolbarBottom = 150;
  const ticketY = toolbarBottom + 9, top = ticketY + 24;
  const ctx = context();
  const bottom = drawBoundaryGuidance(ctx, boundaryGuidance(match), {
    width, height, top, reserveMissile: true, palette, time: 350, motionReduce: true,
  });
  drawMissileWarning(ctx, { count: 1, clock: 6, bearing: Math.PI, rangeM: 1000 }, {
    width, height, top: Math.max(toolbarBottom + 35, bottom + 8), color: palette.warn, motionReduce: true,
  });
  const plates = ctx.marks.filter(mark => mark.type === 'rect' && mark.width > 100);
  assert.equal(plates.length, 2);
  assert.equal(plates[0].height, 48);
  assert.ok(plates[0].y >= top && plates[0].y > ticketY + 9, 'boundary cannot clamp upward across the tickets');
  assert.equal(bottom, plates[0].y + plates[0].height);
  assert.ok(plates[1].y >= bottom + 6);
  assert.ok(plates[1].y + plates[1].height <= height - 12);
  assert.ok(ctx.marks.some(mark => mark.type === 'text' && /270°.*1.1 KM to safety/.test(mark.value)));
  assert.ok(ctx.marks.some(mark => mark.type === 'text' && /6s until hull damage/.test(mark.value)));
  const tooShort = context();
  assert.equal(drawBoundaryGuidance(tooShort, boundaryGuidance(match), {
    width, height: 280, top, reserveMissile: true, palette,
  }), null);
  assert.equal(tooShort.marks.length, 0, 'an impossible stack leaves the available space to the missile warning');
});

test('stacked boundary and missile warnings leave the narrow key reminders unobscured', () => {
  const { match, state, tick } = fixture(); state[0] = BOUNDARY + 1000; tick(2);
  const ctx = context(), width = 390, height = 320, toolbarBottom = 116;
  const boundaryBottom = drawBoundaryGuidance(ctx, boundaryGuidance(match), {
    width, height, top: toolbarBottom + 33, bottom: 48, reserveMissile: true, palette,
  });
  drawMissileWarning(ctx, { count: 1, clock: 6, bearing: Math.PI, rangeM: 1000 }, {
    width, height, top: Math.max(toolbarBottom + 35, boundaryBottom + 8), color: palette.warn,
  });
  const plates = ctx.marks.filter(mark => mark.type === 'rect' && mark.width > 100);
  assert.equal(plates.length, 2);
  assert.equal(plates[0].height, 48);
  assert.ok(plates[1].y > plates[0].y + plates[0].height);
  assert.ok(plates[1].y + plates[1].height <= height - 48);
});
