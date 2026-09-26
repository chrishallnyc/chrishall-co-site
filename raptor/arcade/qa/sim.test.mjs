import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WIDTH, HEIGHT, STAGES, UPGRADE_CHOICES,
  createGame, stepGame, useMissile, useRoll, chooseUpgrade,
} from '../src/sim.js';

function advance(s, seconds, input = {}, fps = 60) {
  for (let i = 0; i < Math.round(seconds * fps); i++) stepGame(s, input, 1 / fps);
  return s;
}

function hostile(s, x = s.player.x, y = s.player.y) {
  s.bullets.push({ id: -1, kind: 'shot', side: 'enemy', x, y, vx: 0, vy: 0, r: 3, age: 0 });
}

// This pilot only reads the visible scene and sends the controls available in the browser.
// It never edits state, teleports, grants health, or injects kills in the full-flight test.
function fly(s) {
  const p = s.player;
  const targets = s.enemies.filter(e => e.y > 0 && e.y < p.y - 45)
    .sort((a,b) => (b.kind === 'boss') - (a.kind === 'boss') || b.y - a.y);
  const target = targets[0];
  const pickup = s.pickups.find(item => item.kind === 'power' || item.kind === 'repair');
  if (s.enemies.some(e => e.y > 0)) useMissile(s);
  if (s.bullets.some(b => b.side === 'enemy' && Math.hypot(b.x - p.x, b.y - p.y) < 50)) useRoll(s);
  stepGame(s, {
    pointer: true,
    targetX: pickup?.x ?? (target ? target.x + target.vx * .25 : 320),
    targetY: pickup ? Math.max(240, pickup.y) : 320,
  }, 1 / 60);
}

test('starts a four-city campaign with a forgiving hitbox and explicit difficulty', () => {
  const s = createGame();
  assert.equal(WIDTH, 640); assert.equal(HEIGHT, 400);
  assert.deepEqual(STAGES.map(({ id, name, bossType, bossName }) => [id, name, bossType, bossName]), [
    ['new-york', 'New York City', 'carrier', 'Harbor Warden'],
    ['san-francisco', 'San Francisco', 'leviathan', 'Fog Phantom'],
    ['austin', 'Austin', 'mantis', 'Copper Viper'],
    ['washington-dc', 'Washington, DC', 'sentinel', 'Capital Sentinel'],
  ]);
  assert.equal(s.mode, 'campaign'); assert.equal(s.stage, 0); assert.equal(s.startStage, 0);
  assert.equal(s.phase, 'playing'); assert.equal(s.player.r, 4);
  assert.equal(s.player.hp, 6); assert.equal(s.player.maxHp, 6);
  assert.equal(createGame({ difficulty: 'relaxed' }).player.maxHp, 8);
  assert.equal(createGame({ difficulty: 'unexpected' }).difficulty, 'arcade');
});

test('standalone cities start with a combat-ready loadout; invalid selections fall back safely', () => {
  for (const [index, stage] of STAGES.entries()) {
    const s = createGame({ mode: 'city', stageId: stage.id });
    assert.equal(s.mode, 'city'); assert.equal(s.stage, index); assert.equal(s.startStage, index);
    assert.equal(s.player.weapon, 3); assert.equal(s.player.hp, 8); assert.equal(s.player.maxHp, 8);
    assert.ok(s.player.fireRate > 1.2); assert.ok(s.player.missileMax < 5.4);
    assert.equal(s.player.missileCooldown, 0); assert.equal(s.player.rollCooldown, 0);
    assert.deepEqual(s.player.upgrades, []);
    assert.equal(createGame({ mode: 'city', stageId: stage.id, difficulty: 'relaxed' }).player.maxHp, 10);
  }
  for (const stageId of [undefined, null, '', 'chicago', 3, {}, '__proto__']) {
    const s = createGame({ mode: 'city', stageId });
    assert.equal(s.mode, 'city'); assert.equal(s.stage, 0); assert.equal(s.startStage, 0);
    assert.doesNotThrow(() => advance(s, 2));
  }
  for (const mode of [undefined, 'campaign', 'invalid', null]) {
    const s = createGame({ mode, stageId: 'washington-dc' });
    assert.equal(s.mode, 'campaign'); assert.equal(s.stage, 0); assert.equal(s.startStage, 0);
    assert.equal(s.player.weapon, 1);
  }
});

test('every city retains identical simulation at 30, 60, and 120 render frames per second', () => {
  const publicState = s => ({
    mode: s.mode, startStage: s.startStage, stage: s.stage, time: s.time,
    player: s.player, enemies: s.enemies, bullets: s.bullets,
    pickups: s.pickups, score: s.score, kills: s.kills, rng: s._rng,
  });
  for (const options of [{}, ...STAGES.map(stage => ({ mode: 'city', stageId: stage.id }))]) {
    const snapshots = [30,60,120].map(fps => publicState(advance(createGame({ ...options, seed: 42 }), 8, { x: 1, y: -.1 }, fps)));
    assert.deepEqual(snapshots[0], snapshots[1], options.stageId);
    assert.deepEqual(snapshots[1], snapshots[2], options.stageId);
  }
});

test('identical seeds reproduce authored waves and different seeds vary their flight timing', () => {
  const one = advance(createGame({ seed: 7 }), 4);
  const two = advance(createGame({ seed: 7 }), 4);
  const other = advance(createGame({ seed: 9 }), 4);
  assert.deepEqual(one, two);
  assert.notDeepEqual(one.enemies.map(e => e.x), other.enemies.map(e => e.x));
});

test('diagonal movement is normalized; pointer movement is fast but cannot teleport offscreen', () => {
  const axis = createGame(), diagonal = createGame();
  stepGame(axis, { x: 1 }, .1); stepGame(diagonal, { x: 1, y: 1 }, .1);
  assert.ok(Math.abs(Math.hypot(diagonal.player.x - 320, diagonal.player.y - 320) - (axis.player.x - 320)) < 1e-8);
  const pointer = createGame();
  stepGame(pointer, { pointer: true, targetX: 9000, targetY: -9000 }, .1);
  assert.ok(Math.hypot(pointer.player.x - 320, pointer.player.y - 320) <= 24.8 + 1e-8);
  advance(pointer, 3, { pointer: true, targetX: 9000, targetY: -9000 });
  assert.equal(pointer.player.x, 618); assert.equal(pointer.player.y, 28);
});

test('large time gaps are discarded and invalid input never corrupts the flight', () => {
  const s = createGame();
  stepGame(s, { x: NaN, y: Infinity, pointer: true, targetX: NaN, targetY: Infinity }, 600);
  assert.ok(s.time <= .10000001);
  assert.ok(Number.isFinite(s.player.x)); assert.ok(Number.isFinite(s.player.y));
  const oldTime = s.time;
  for (const dt of [0,-1,NaN,Infinity]) stepGame(s, {}, dt);
  assert.equal(s.time, oldTime);
});

test('cannons fire automatically and collected power creates a wider useful volley', () => {
  const s = createGame();
  stepGame(s, {}, 1 / 120);
  assert.equal(s.bullets.filter(b => b.side === 'player').length, 2);
  assert.ok(s.events.some(e => e.type === 'shoot'));
  s.player.weapon = 3; s._fire = 0; s.bullets.length = 0;
  stepGame(s, {}, 1 / 120);
  assert.equal(s.bullets.filter(b => b.side === 'player').length, 4);
  assert.ok(s.bullets.some(b => b.vx < 0)); assert.ok(s.bullets.some(b => b.vx > 0));
});

test('missile and roll helpers queue exactly one action and retain their audio events', () => {
  const s = createGame();
  assert.equal(useMissile(s), true); assert.equal(useMissile(s), false);
  assert.equal(useRoll(s), true); assert.equal(useRoll(s), false);
  assert.equal(s.player.missileCooldown, 0);
  stepGame(s, {}, 1 / 60);
  assert.equal(s.bullets.filter(b => b.kind === 'missile').length, 2);
  assert.equal(s.events.filter(e => e.type === 'missile').length, 1);
  assert.equal(s.events.filter(e => e.type === 'roll').length, 1);
  assert.ok(s.player.missileCooldown > 6.9); assert.ok(s.player.rollCooldown > 2.9);
  assert.equal(useMissile(s), false); assert.equal(useRoll(s), false);
  stepGame(s, {}, 1 / 60);
  assert.ok(!s.events.some(e => e.type === 'missile' || e.type === 'roll'));
});

test('held action buttons are edge-triggered and release permits the next action', () => {
  const s = createGame();
  let rolls = 0;
  for (let n = 0; n < 4 * 60; n++) {
    stepGame(s, { roll: true }, 1 / 60);
    rolls += s.events.filter(e => e.type === 'roll').length;
  }
  assert.equal(rolls, 1);
  stepGame(s, { roll: false }, 1 / 60);
  stepGame(s, { roll: true }, 1 / 60);
  assert.ok(s.events.some(e => e.type === 'roll'));
});

test('a player hit costs one armor and grants hurt grace; a roll dodges the same bullet', () => {
  const s = createGame(); s.player.invulnerable = 0;
  hostile(s); stepGame(s, {}, 1 / 120);
  assert.equal(s.player.hp, 5); assert.equal(s.damageTaken, 1);
  hostile(s); stepGame(s, {}, 1 / 120);
  assert.equal(s.player.hp, 5); assert.ok(s.player.invulnerable > 1.6);
  const dodge = createGame(); dodge.player.invulnerable = 0;
  useRoll(dodge); hostile(dodge); stepGame(dodge, {}, 1 / 120);
  assert.equal(dodge.player.hp, 6); assert.ok(dodge.player.rollTime > .5);
});

test('pickup collection increases firepower, repairs armor, and respects score multiplier', () => {
  const s = createGame(); s.player.hp = 4;
  s.combo = 10; s.multiplier = 3; s._comboTime = 4;
  for (const kind of ['power','repair','score']) s.pickups.push({ id: -1, kind,
    x: s.player.x, y: s.player.y, vx: 0, vy: 38, r: 8, age: 0, color: '#ffffff' });
  stepGame(s, {}, 1 / 120);
  assert.equal(s.player.weapon, 2); assert.equal(s.player.hp, 5); assert.equal(s.score, 600);
  assert.equal(s.pickups.length, 0);
  assert.deepEqual(s.events.filter(e => e.type === 'pickup').map(e => e.kind), ['power','repair','score']);
});

test('all three upgrades make distinct persistent improvements and restore two armor', () => {
  assert.equal(UPGRADE_CHOICES.length, 3);
  for (const { id } of UPGRADE_CHOICES) {
    const s = createGame(); s.phase = 'upgrade'; s.player.hp = 3;
    s.particles.push({ life: 1 }); s.floaters.push({ life: 1 });
    s.stageCleared = true; s.clearTime = 1.2;
    assert.equal(chooseUpgrade(s, 'invalid'), false);
    assert.equal(chooseUpgrade(s, id), true);
    assert.equal(s.stage, 1); assert.equal(s.stageTime, 0); assert.equal(s.player.hp, 5);
    assert.equal(s.stageCleared, false); assert.equal(s.clearTime, 0);
    assert.equal(s.particles.length, 0); assert.equal(s.floaters.length, 0);
    assert.equal(s.phase, 'playing'); assert.equal(chooseUpgrade(s, id), false);
    if (id === 'overdrive') assert.ok(s.player.fireRate > 1.2);
    if (id === 'armor') assert.equal(s.player.maxHp, 7);
    if (id === 'rockets') assert.ok(s.player.missileMax < 5.4);
    stepGame(s, {}, 1 / 120);
    assert.ok(s.events.some(e => e.type === 'stage' && e.stage === 1));
  }
});

test('upgrades cannot advance a standalone sortie or run beyond the final campaign city', () => {
  for (const stage of STAGES) {
    const s = createGame({ mode: 'city', stageId: stage.id });
    s.phase = 'upgrade';
    const before = structuredClone(s);
    assert.equal(chooseUpgrade(s, 'armor'), false);
    assert.deepEqual(s, before);
  }
  const s = createGame(); s.stage = STAGES.length - 1; s.phase = 'upgrade';
  assert.equal(chooseUpgrade(s, 'armor'), false); assert.equal(s.stage, 3);
});

test('every city has distinct opening formations', () => {
  const openings = STAGES.map(stage => {
    const s = advance(createGame({ mode: 'city', stageId: stage.id, seed: 42 }), 1.5);
    assert.ok(s.enemies.length > 0);
    return s.enemies.map(enemy => [enemy.kind, Math.round(enemy.x)]);
  });
  assert.equal(new Set(openings.map(opening => JSON.stringify(opening))).size, STAGES.length);
});

test('all four bosses cycle telegraphed attacks and stay alive until genuinely damaged', () => {
  const expected = {
    carrier: ['fan', 'sweep'],
    leviathan: ['ring', 'lance', 'curtain'],
    mantis: ['curtain', 'fan', 'crossfire'],
    sentinel: ['pincer', 'curtain', 'ring', 'lance'],
  };
  for (const stage of STAGES) {
    // Isolate each boss: no ordinary formations, friendly fire, or player death.
    const s = createGame({ mode: 'city', stageId: stage.id });
    s.stageTime = stage.duration; s._wave = 1000;
    s._fire = Infinity; s.player.invulnerable = Infinity;
    const patterns = new Set(); let sawBullets = false;
    for (let frame = 0; frame < 30 * 60; frame++) {
      const lastId = s._id;
      stepGame(s, {}, 1 / 60);
      const boss = s.boss;
      assert.equal(boss.bossType, stage.bossType); assert.equal(boss.name, stage.bossName);
      if (boss.pattern !== 'arrival') patterns.add(boss.pattern);
      if (boss.pattern === 'curtain' && s.telegraphs.length) {
        assert.ok(s.telegraphs.every(line => Math.abs(line.x - boss._gap) >= 63));
      }
      if (boss.pattern === 'pincer' && s.telegraphs.length) {
        assert.equal(s.telegraphs.length, 2);
        assert.deepEqual(s.telegraphs.map(line => line.x2), [boss._gap - 64, boss._gap + 64]);
      }
      if (boss.pattern === 'crossfire' && s.telegraphs.length) {
        assert.equal(s.telegraphs.length, 2);
        assert.ok(Math.abs(s.telegraphs[1].x - s.telegraphs[0].x - 96) < 1e-8);
        if (boss._warning) {
          assert.equal(s.telegraphs[0].x, boss.x - 48);
          assert.equal(s.telegraphs[0].y, boss.y + boss.r * .55);
        }
      }
      if (boss.pattern === 'pincer') {
        for (const bullet of s.bullets.filter(bullet => bullet.id > lastId)) {
          const bottomX = bullet.x + (HEIGHT - bullet.y) * bullet.vx / bullet.vy;
          assert.ok(Math.abs(Math.abs(bottomX - boss._gap) - 64) < 1e-8,
            'every trailing shot follows its warning line and preserves the escape corridor');
        }
      }
      sawBullets ||= s.bullets.length > 0;
      assert.ok(s.bullets.every(bullet => [bullet.x, bullet.y, bullet.vx, bullet.vy].every(Number.isFinite)));
      assert.ok(s.bullets.length <= 400 && s.telegraphs.length <= 32);
    }
    assert.equal(s.boss.hp, s.boss.maxHp); assert.ok(s.boss.hp > 0);
    assert.equal(s.phase, 'playing'); assert.equal(s.stageCleared, false);
    assert.deepEqual([...patterns], expected[stage.bossType]); assert.ok(sawBullets);
  }
});

test('inaction can really lose; a finished game cannot keep causing damage or scoring', () => {
  const s = createGame();
  let lossEvents = 0;
  for (let frame = 0; frame < 120 * 60 && s.phase === 'playing'; frame++) {
    stepGame(s, {}, 1 / 60);
    lossEvents += s.events.filter(e => e.type === 'lose').length;
  }
  assert.equal(s.phase, 'lost'); assert.equal(s.player.hp, 0); assert.equal(lossEvents, 1);
  const [time,score,kills] = [s.time,s.score,s.kills];
  advance(s, 3, { x: 1, missile: true, roll: true });
  assert.deepEqual([s.time,s.score,s.kills], [time,score,kills]);
  assert.equal(useMissile(s), false); assert.equal(useRoll(s), false);
});

test('a real boss defeat gets a safe 1.2-second celebration before the upgrade screen', () => {
  const s = createGame({ seed: 1991 });
  for (let frame = 0; frame < 120 * 60 && !s.stageCleared && s.phase === 'playing'; frame++) fly(s);
  assert.equal(s.boss.hp, 0); assert.equal(s.stageCleared, true);
  assert.equal(s.phase, 'playing'); assert.ok(s.clearTime < .02);
  assert.equal(s.enemies.length, 0); assert.equal(s.bullets.length, 0);
  assert.ok(s.particles.some(p => p.kind === 'explosion'));
  assert.ok(!s.events.some(e => e.type === 'stage' || e.type === 'win'));
  assert.equal(useMissile(s), false); assert.equal(useRoll(s), false);
  const [hp,score,kills] = [s.player.hp,s.score,s.kills];
  advance(s, .6, { x: 1, missile: true, roll: true });
  assert.equal(s.phase, 'playing'); assert.ok(s.particles.some(p => p.kind === 'explosion'));
  assert.equal(s.enemies.length, 0); assert.equal(s.bullets.length, 0);
  assert.deepEqual([s.player.hp,s.score,s.kills], [hp,score,kills]);
  while (s.clearTime < 1.1) stepGame(s, {}, 1 / 120);
  assert.equal(s.phase, 'playing');
  while (s.phase === 'playing') stepGame(s, {}, 1 / 120);
  assert.equal(s.phase, 'upgrade'); assert.ok(Math.abs(s.clearTime - 1.2) < 1e-8);
  assert.equal(s.events.filter(e => e.type === 'stage').length, 1);
  assert.equal(chooseUpgrade(s, 'overdrive'), true);
  assert.equal(s.stageCleared, false); assert.equal(s.clearTime, 0);
  assert.equal(s.particles.length, 0); assert.equal(s.floaters.length, 0);
});

test('ordinary controls complete all four city bosses in a genuine five-minute campaign', () => {
  const s = createGame({ seed: 1991 });
  const bosses = new Set(); const patterns = new Set(); const upgrades = [];
  let maxBullets = 0, maxParticles = 0, maxEnemies = 0;
  for (let frame = 0; frame < 60 * 360; frame++) {
    if (s.phase === 'upgrade') {
      upgrades.push(s.stage);
      assert.equal(s.boss.hp, 0);
      assert.equal(chooseUpgrade(s, ['overdrive', 'rockets', 'armor'][s.stage]), true);
    }
    if (s.phase !== 'playing') break;
    fly(s);
    if (s.boss) { bosses.add(s.boss.bossType); patterns.add(s.boss.pattern); }
    maxBullets = Math.max(maxBullets,s.bullets.length);
    maxParticles = Math.max(maxParticles,s.particles.length);
    maxEnemies = Math.max(maxEnemies,s.enemies.length);
  }
  assert.equal(s.phase, 'won'); assert.equal(s.stage, 3); assert.equal(s.boss.hp, 0);
  assert.equal(s.mode, 'campaign'); assert.equal(s.startStage, 0);
  assert.ok(Math.abs(s.clearTime - 1.2) < 1e-8, 'final victory also waits for its celebration');
  assert.deepEqual(upgrades, [0,1,2]);
  assert.deepEqual(s.player.upgrades, ['overdrive', 'rockets', 'armor']);
  assert.deepEqual([...bosses], ['carrier','leviathan','mantis','sentinel']);
  assert.ok(['fan','sweep','curtain','ring','lance','crossfire','pincer'].every(pattern => patterns.has(pattern)));
  assert.ok(s.time > 280 && s.time < 330, `campaign duration ${s.time}`);
  assert.ok(s.kills >= 160); assert.equal(s.player.weapon, 3); assert.ok(s.player.hp > 0);
  assert.ok(s.score > 80000); assert.ok(s.damageTaken > 0, 'pilot is mortal and takes genuine damage');
  assert.ok(maxBullets <= 400 && maxParticles <= 300 && maxEnemies <= 29);
  assert.ok(s.events.some(e => e.type === 'win'));
});

for (const [index, stage] of STAGES.entries()) {
  test(`ordinary controls win ${stage.name} alone, with no campaign upgrades or extra city`, () => {
    for (const options of [{ seed: 1991 }, { seed: 42 }, { seed: 7, difficulty: 'relaxed' }]) {
      const s = createGame({ ...options, mode: 'city', stageId: stage.id });
      const bosses = new Set(); let winEvents = 0;
      for (let frame = 0; frame < 60 * 120 && s.phase === 'playing'; frame++) {
        fly(s);
        if (s.boss) bosses.add(s.boss.bossType);
        winEvents += s.events.filter(event => event.type === 'win').length;
        assert.ok(!s.events.some(event => event.type === 'stage'));
        assert.equal(s.stage, index); assert.equal(s.startStage, index);
        assert.ok(s.bullets.length <= 400 && s.enemies.length <= 29 && s.particles.length <= 300);
        assert.ok(s.pickups.length <= 30 && s.floaters.length <= 24 && s.telegraphs.length <= 32);
      }
      assert.equal(s.phase, 'won', `${stage.id}, seed ${options.seed}`);
      assert.equal(s.mode, 'city'); assert.equal(s.boss.hp, 0); assert.equal(winEvents, 1);
      assert.deepEqual([...bosses], [stage.bossType]); assert.deepEqual(s.player.upgrades, []);
      assert.ok(s.time > stage.duration + 5 && s.time < stage.duration + 40);
      assert.ok(Math.abs(s.clearTime - 1.2) < 1e-8);
      assert.ok(s.player.hp > 0 && s.kills >= 35 && s.score > 15000);
      assert.equal(chooseUpgrade(s, 'overdrive'), false);
      const before = [s.time, s.score, s.kills, s.stage, s.player.hp];
      advance(s, 3, { x: 1, missile: true, roll: true });
      assert.deepEqual([s.time, s.score, s.kills, s.stage, s.player.hp], before);
      assert.equal(s.phase, 'won'); assert.equal(useMissile(s), false); assert.equal(useRoll(s), false);
    }
  });
}
