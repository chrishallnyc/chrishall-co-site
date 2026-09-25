/** Deterministic, renderer-independent arcade flight simulation. All distances are pixels. */
export const WIDTH = 640;
export const HEIGHT = 400;

export const STAGES = Object.freeze([
  Object.freeze({ id: 'pacific', name: 'Pacific Coast', subtitle: 'Sunrise over the islands', bossName: 'Iron Gull', bossType: 'carrier', duration: 56, color: '#56d8cb' }),
  Object.freeze({ id: 'canyon', name: 'Red Canyon', subtitle: 'Through the copper corridor', bossName: 'Sand Mantis', bossType: 'mantis', duration: 58, color: '#ffb769' }),
  Object.freeze({ id: 'harbor', name: 'Neon Harbor', subtitle: 'One last flight over the city', bossName: 'Night Leviathan', bossType: 'leviathan', duration: 60, color: '#b59dff' }),
]);

export const UPGRADE_CHOICES = Object.freeze([
  Object.freeze({ id: 'overdrive', name: 'Overdrive', description: 'Cannons fire 22% faster. Restore 2 armor.' }),
  Object.freeze({ id: 'armor', name: 'Extra armor', description: 'Add one armor segment. Restore 2 armor.' }),
  Object.freeze({ id: 'rockets', name: 'Wing rockets', description: 'Missile cooldown 23% shorter. Restore 2 armor.' }),
]);

const STEP = 1 / 120;
const CLEAR_DURATION = 1.2;
const TAU = Math.PI * 2;
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const sq = v => v * v;
const distance2 = (a, b) => sq(a.x - b.x) + sq(a.y - b.y);
const COLORS = { cyan: '#aef8ff', gold: '#ffe9a6', hot: '#ff7186', white: '#fff6db' };
const ENEMY = {
  scout: { hp: 3, r: 11, speed: 62, score: 100, fire: 2.8 },
  striker: { hp: 7, r: 15, speed: 42, score: 180, fire: 2.2 },
  gunship: { hp: 24, r: 22, speed: 26, score: 400, fire: 1.9 },
  ace: { hp: 10, r: 14, speed: 51, score: 250, fire: 1.7 },
};

// Each formation has an arrival, a readable rhythm, and room to pass between groups.
const WAVES = [
  [[1.4,'scout',4,.24],[5.5,'scout',4,.76],[10,'striker',3,.5],[15,'scout',5,.5],[20,'gunship',1,.32],[23,'scout',4,.72],[28,'ace',2,.35],[33,'striker',4,.52],[38,'gunship',1,.72],[41,'scout',5,.3],[46,'ace',3,.54],[51,'striker',3,.5]],
  [[1.4,'ace',3,.28],[5.8,'scout',5,.68],[10,'striker',4,.5],[15,'gunship',2,.5],[20,'ace',3,.7],[25,'scout',6,.5],[30,'striker',4,.3],[35,'gunship',2,.5],[40,'ace',4,.5],[45,'striker',4,.65],[50,'scout',6,.5],[54,'ace',2,.28]],
  [[1.4,'striker',4,.5],[5.8,'ace',3,.7],[10,'gunship',2,.5],[15,'scout',6,.5],[20,'ace',4,.35],[25,'striker',5,.5],[30,'gunship',2,.5],[35,'ace',4,.65],[40,'scout',6,.5],[45,'gunship',2,.5],[50,'striker',5,.5],[55,'ace',3,.5]],
];

function random(s) {
  let t = s._rng += 0x6d2b79f5;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

function emit(s, type, props = {}) { s.events.push({ type, ...props }); }
function id(s) { return ++s._id; }

export function createGame({ seed = 0x52415054, difficulty = 'arcade' } = {}) {
  const relaxed = difficulty === 'relaxed';
  return {
    phase: 'playing', difficulty: relaxed ? 'relaxed' : 'arcade', stage: 0,
    time: 0, stageTime: 0, scroll: 0, stageProgress: 0, stageCleared: false, clearTime: 0,
    player: {
      id: 0, kind: 'player', x: 320, y: 320, vx: 0, vy: 0, r: 4, age: 0,
      hp: relaxed ? 8 : 6, maxHp: relaxed ? 8 : 6, invulnerable: 1.2,
      rollTime: 0, rollCooldown: 0, rollMax: 3, missileCooldown: 0, missileMax: 7,
      weapon: 1, bank: 0, flash: 0, fireRate: 1, upgrades: [],
    },
    enemies: [], bullets: [], pickups: [], particles: [], floaters: [], telegraphs: [],
    score: 0, kills: 0, combo: 0, multiplier: 1, boss: null, events: [],
    shots: 0, damageTaken: 0, bestCombo: 0,
    _rng: Number(seed) >>> 0, _id: 0, _accumulator: 0, _wave: 0, _bossSpawned: false,
    _fire: 0, _comboTime: 0, _powerDrops: 0, _clearBurst: 0, _pendingMissile: false, _pendingRoll: false,
    _lastMissile: false, _lastRoll: false, _queuedEvents: [],
  };
}

/** Queue an impulse for the next simulation tick; audio events remain in that tick. */
export function useMissile(s) {
  if (s.phase !== 'playing' || s.stageCleared || s.player.missileCooldown > 0 || s._pendingMissile) return false;
  s._pendingMissile = true;
  return true;
}

export function useRoll(s) {
  if (s.phase !== 'playing' || s.stageCleared || s.player.rollCooldown > 0 || s._pendingRoll) return false;
  s._pendingRoll = true;
  return true;
}

export function chooseUpgrade(s, upgradeId) {
  if (s.phase !== 'upgrade' || !UPGRADE_CHOICES.some(choice => choice.id === upgradeId)) return false;
  const p = s.player;
  if (upgradeId === 'overdrive') p.fireRate *= 1 / .82;
  if (upgradeId === 'armor') p.maxHp++;
  if (upgradeId === 'rockets') p.missileMax *= .77;
  p.hp = Math.min(p.maxHp, p.hp + 2);
  p.upgrades.push(upgradeId);
  p.x = 320; p.y = 320; p.vx = 0; p.vy = 0;
  p.invulnerable = 1.8; p.rollCooldown = 0; p.missileCooldown = 0;
  s.stage++; s.phase = 'playing'; s.stageTime = 0; s.stageProgress = 0;
  s.stageCleared = false; s.clearTime = 0; s._clearBurst = 0;
  s.enemies.length = 0; s.bullets.length = 0; s.pickups.length = 0; s.telegraphs.length = 0;
  s.particles.length = 0; s.floaters.length = 0;
  s.boss = null; s._wave = 0; s._bossSpawned = false; s._fire = 0;
  s._pendingMissile = false; s._pendingRoll = false;
  s._lastMissile = false; s._lastRoll = false; s._accumulator = 0;
  s._queuedEvents.push({ type: 'stage', stage: s.stage });
  return true;
}

function spawnWave(s, wave) {
  const [,kind,count,center] = wave;
  const config = ENEMY[kind];
  const spacing = kind === 'gunship' ? 210 : kind === 'ace' ? 118 : 64;
  for (let n = 0; n < count && s.enemies.length < 28; n++) {
    const x = clamp(center * WIDTH + (n - (count - 1) / 2) * spacing, 42, WIDTH - 42);
    const stageScale = 1 + s.stage * .15;
    const hp = Math.ceil(config.hp * stageScale);
    s.enemies.push({
      id: id(s), kind, x, y: -32 - Math.abs(n - (count - 1) / 2) * 21,
      vx: 0, vy: config.speed, hp, maxHp: hp, r: config.r, age: 0,
      bank: 0, flash: 0, windup: 0, _originX: x, _phase: random(s) * TAU,
      _fire: .8 + n * .25 + random(s) * .8, _fireMax: config.fire,
      _score: config.score, _shoots: 0,
    });
  }
}

function spawnBoss(s) {
  const stage = STAGES[s.stage];
  const hp = [500, 800, 1100][s.stage];
  const boss = {
    id: id(s), kind: 'boss', bossType: stage.bossType, name: stage.bossName,
    x: 320, y: -80, vx: 0, vy: 0, hp, maxHp: hp, r: [36,40,44][s.stage],
    rx: [64,70,79][s.stage], ry: [32,37,39][s.stage], age: 0, bank: 0, flash: 0,
    windup: 0, pattern: 'arrival', _fire: 3.1, _cycle: 0, _warning: false,
    _aim: Math.PI / 2, _gap: 320, _score: 3000 + s.stage * 2000,
  };
  s._bossSpawned = true; s.boss = boss; s.enemies.push(boss);
  // A boss gets a clean entrance: no leftover aimed volley hidden by the title card.
  s.bullets = s.bullets.filter(b => b.side === 'player');
  s.enemies = s.enemies.filter(e => e === boss || e.y > 240);
  emit(s, 'boss', { stage: s.stage });
}

function particle(s, x, y, color, count = 10, size = 3, speed = 70) {
  for (let n = 0; n < count; n++) {
    const a = random(s) * TAU, velocity = speed * (.35 + random(s));
    const life = .25 + random(s) * .4;
    s.particles.push({ x, y, vx: Math.cos(a) * velocity, vy: Math.sin(a) * velocity,
      life, maxLife: life, color, size: size * (.5 + random(s)) });
  }
}

function floater(s, x, y, text, color = COLORS.gold, size = 9) {
  s.floaters.push({ x, y, text, color, size, life: 1.05, maxLife: 1.05 });
}

function shot(s, x, y, angle, speed, radius = 3, kind = 'shot') {
  if (s.bullets.length >= 350) return;
  const velocity = speed * (s.difficulty === 'relaxed' ? .76 : 1);
  s.bullets.push({ id: id(s), x, y, vx: Math.cos(angle) * velocity,
    vy: Math.sin(angle) * velocity, r: radius, side: 'enemy', kind, age: 0,
    color: kind === 'lance' ? '#ff94df' : '#ffb769', damage: 1 });
}

function fan(s, e, angle, count, spread, speed, radius = 3) {
  for (let n = 0; n < count; n++) shot(s, e.x, e.y + e.r * .55,
    angle + (n - (count - 1) / 2) * spread, speed, radius);
}

function warnBoss(s, e) {
  e._warning = true;
  e._aim = Math.atan2(s.player.y - e.y, s.player.x - e.x);
  e._gap = clamp(s.player.x, 80, 560);
  const pattern = s.stage === 0 ? (e._cycle % 2 ? 'sweep' : 'fan')
    : s.stage === 1 ? (e._cycle % 2 ? 'fan' : 'curtain')
      : ['ring', 'curtain', 'lance'][e._cycle % 3];
  e.pattern = pattern;
  if (pattern === 'curtain') {
    for (let x = 24; x < WIDTH; x += 40) {
      if (Math.abs(x - e._gap) < 63) continue;
      s.telegraphs.push({ kind: 'line', x, y: 68, x2: x, y2: HEIGHT,
        life: .65, maxLife: .65, color: '#ffb769' });
    }
  } else if (pattern === 'ring') {
    s.telegraphs.push({ kind: 'circle', x: e.x, y: e.y, r: e.r + 17,
      life: .65, maxLife: .65, color: '#ff94df' });
  } else {
    s.telegraphs.push({ kind: 'line', x: e.x, y: e.y + 20,
      x2: e.x + Math.cos(e._aim) * 460, y2: e.y + Math.sin(e._aim) * 460,
      life: .65, maxLife: .65, color: '#ffb769' });
  }
}

function fireBoss(s, e) {
  const desperate = e.hp < e.maxHp * .4;
  const speed = 102 + s.stage * 11 + (desperate ? 10 : 0);
  if (e.pattern === 'curtain') {
    for (let x = 24; x < WIDTH; x += 40) {
      if (Math.abs(x - e._gap) < 63) continue;
      shot(s, x, 72, Math.PI / 2, speed + 13, 3, 'lance');
    }
  } else if (e.pattern === 'ring') {
    const count = desperate ? 24 : 20;
    for (let n = 0; n < count; n++) shot(s, e.x, e.y, n / count * TAU + e.age * .18, speed - 14, 3.5);
  } else if (e.pattern === 'lance') {
    for (const offset of [-38, 0, 38]) {
      for (let n = 0; n < 3; n++) shot(s, e.x + offset, e.y + 24 - n * 12, e._aim, speed + 28, 3, 'lance');
    }
    fan(s, e, Math.PI / 2, 7, .26, speed - 12, 3);
  } else if (e.pattern === 'sweep') {
    fan(s, { ...e, x: e.x - 34 }, Math.PI / 2 + .14, 5, .18, speed, 3);
    fan(s, { ...e, x: e.x + 34 }, Math.PI / 2 - .14, 5, .18, speed, 3);
  } else {
    fan(s, e, e._aim, 7 + s.stage * 2, .16, speed, 3.5);
  }
  e._warning = false; e.windup = 0; e._cycle++;
  e._fire = (2.2 - s.stage * .17) * (desperate ? .9 : 1);
}

function moveEnemies(s, dt) {
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    e.age += dt; e.flash = Math.max(0, e.flash - dt);
    const oldX = e.x;
    if (e.kind === 'boss') {
      e.y += (76 - e.y) * (1 - Math.exp(-1.25 * dt));
      const extent = [152, 192, 158][s.stage];
      e.x = 320 + Math.sin(Math.max(0, e.age - 1.5) * [.42,.6,.48][s.stage]) * extent;
      e._fire -= dt;
      if (!e._warning && e._fire <= .65) warnBoss(s, e);
      if (e._warning) e.windup = clamp(1 - e._fire / .65, 0, 1);
      if (e._fire <= 0) fireBoss(s, e);
    } else {
      const config = ENEMY[e.kind];
      e.y += (e.kind === 'gunship' && e.y > 84 && e.age < 11 ? 4 : config.speed) * dt;
      const amplitude = e.kind === 'ace' ? 95 : e.kind === 'striker' ? 26 : e.kind === 'gunship' ? 14 : 18;
      e.x = clamp(e._originX + Math.sin(e.age * (e.kind === 'ace' ? 1.8 : .9) + e._phase) * amplitude, 22, WIDTH - 22);
      e._fire -= dt;
      e.windup = e.y > 25 && e.y < s.player.y - 70 ? clamp(1 - e._fire / .35, 0, 1) : 0;
      if (e._fire <= 0 && e.y > 30 && e.y < s.player.y - 55) {
        const aim = Math.atan2(s.player.y - e.y, s.player.x - e.x);
        const speed = 90 + s.stage * 12;
        if (e.kind === 'gunship') fan(s, e, aim, 5, .19, speed);
        else if (e.kind === 'striker') fan(s, e, aim, 3, .18, speed + 4);
        else fan(s, e, aim, 1, 0, speed + (e.kind === 'ace' ? 22 : 0));
        e._fire = e._fireMax * (1 - s.stage * .06); e._shoots++;
      }
    }
    e.vx = (e.x - oldX) / dt;
    e.bank += (clamp(e.vx / 120, -1, 1) - e.bank) * Math.min(1, dt * 8);
  }
}

function fireCannons(s) {
  const p = s.player;
  const power = p.weapon;
  const lanes = power === 1 ? [-5,5] : power === 2 ? [-9,0,9] : [-13,-5,5,13];
  for (const offset of lanes) {
    const spread = power === 3 && Math.abs(offset) === 13 ? offset * 1.5 : 0;
    s.bullets.push({ id: id(s), kind: 'cannon', side: 'player', x: p.x + offset,
      y: p.y - 22, vx: spread, vy: -620, r: 2, damage: 1, color: '#d9fff6', age: 0 });
  }
  s.shots++; emit(s, 'shoot', { weapon: power });
  s._fire += .115 / p.fireRate;
}

function launchMissiles(s) {
  const p = s.player;
  p.missileCooldown = p.missileMax;
  const targets = s.enemies.filter(e => e.hp > 0 && e.y > -40 && e.y < p.y)
    .sort((a,b) => (a.kind === 'boss' ? -1 : 0) - (b.kind === 'boss' ? -1 : 0) || distance2(a,p) - distance2(b,p));
  for (const [index,offset] of [-18,18].entries()) {
    const target = targets[index % Math.max(1, targets.length)];
    s.bullets.push({ id: id(s), kind: 'missile', side: 'player', x: p.x + offset,
      y: p.y - 5, vx: offset * 3, vy: -280, r: 3, damage: 30,
      color: COLORS.cyan, age: 0, _targetId: target?.id ?? null, _trail: 0 });
  }
  emit(s, 'missile');
}

function movePlayer(s, input, dt) {
  const p = s.player;
  p.age += dt;
  p.invulnerable = Math.max(0, p.invulnerable - dt);
  p.rollTime = Math.max(0, p.rollTime - dt);
  p.rollCooldown = Math.max(0, p.rollCooldown - dt);
  p.missileCooldown = Math.max(0, p.missileCooldown - dt);
  p.flash = Math.max(0, p.flash - dt);
  if (s._pendingRoll && p.rollCooldown <= 0) {
    p.rollTime = .52; p.rollCooldown = p.rollMax;
    p.invulnerable = Math.max(p.invulnerable, .62);
    emit(s, 'roll');
    particle(s, p.x, p.y, COLORS.cyan, 12, 2, 85);
  }
  if (s._pendingMissile && p.missileCooldown <= 0) launchMissiles(s);
  s._pendingRoll = false; s._pendingMissile = false;
  let x = Number.isFinite(input.x) ? clamp(input.x, -1, 1) : 0;
  let y = Number.isFinite(input.y) ? clamp(input.y, -1, 1) : 0;
  const speed = (p.rollTime > 0 ? 1.55 : 1) * 248;
  if (input.pointer && Number.isFinite(input.targetX) && Number.isFinite(input.targetY)) {
    const dx = clamp(input.targetX, 22, WIDTH - 22) - p.x;
    const dy = clamp(input.targetY, 28, HEIGHT - 24) - p.y;
    const distance = Math.hypot(dx, dy);
    const move = Math.min(speed * dt, distance);
    x = distance > .05 ? dx / distance : 0;
    y = distance > .05 ? dy / distance : 0;
    p.vx = x * move / dt; p.vy = y * move / dt;
  } else {
    const norm = Math.max(1, Math.hypot(x, y));
    p.vx = x / norm * speed; p.vy = y / norm * speed;
  }
  p.x = clamp(p.x + p.vx * dt, 22, WIDTH - 22);
  p.y = clamp(p.y + p.vy * dt, 28, HEIGHT - 24);
  p.bank += (clamp(p.vx / 230, -1, 1) - p.bank) * Math.min(1, dt * 12);
  s._fire -= dt;
  if (s._fire <= 0) fireCannons(s);
}

function dropPickup(s, e, kind) {
  if (s.pickups.length >= 30) return;
  s.pickups.push({ id: id(s), kind, x: e.x, y: e.y, vx: 0, vy: 38, r: 8, age: 0,
    color: kind === 'power' ? COLORS.cyan : kind === 'repair' ? '#ff94bc' : COLORS.gold });
}

function defeat(s, e) {
  if (e._dead) return;
  e._dead = true; e.hp = 0;
  s.kills++; s.combo++; s._comboTime = 4;
  s.bestCombo = Math.max(s.bestCombo, s.combo);
  s.multiplier = Math.min(5, 1 + Math.floor(s.combo / 5));
  const points = e._score * s.multiplier;
  s.score += points;
  floater(s, e.x, e.y - 12, `+${points}`);
  particle(s, e.x, e.y, COLORS.gold, e.kind === 'boss' ? 70 : 16, e.kind === 'boss' ? 5 : 3, 90);
  s.particles.push({ kind: 'explosion', x: e.x, y: e.y, vx: 0, vy: 0,
    life: .48, maxLife: .48, color: COLORS.gold, size: e.r * (e.kind === 'boss' ? 2.1 : 1.5) });
  emit(s, 'explosion', { x: e.x, y: e.y, size: e.kind === 'boss' || e.kind === 'gunship' ? 'large' : 'small' });
  if (e.kind === 'boss') {
    s.bullets.length = 0;
    s.telegraphs.length = 0;
    for (const other of s.enemies) other.hp = 0;
    s.stageProgress = 1;
    s.stageCleared = true; s.clearTime = 0; s._clearBurst = 0;
    s._pendingMissile = false; s._pendingRoll = false;
  } else if (s.kills % 7 === 0 && s.player.weapon < 3) {
    dropPickup(s, e, 'power'); s._powerDrops++;
  } else if (s.kills % 17 === 0 && s.player.hp < s.player.maxHp) {
    dropPickup(s, e, 'repair');
  } else if (s.kills % 3 === 0 || e.kind === 'ace' || e.kind === 'gunship') dropPickup(s, e, 'score');
}

function damageEnemy(s, e, amount) {
  if (e.hp <= 0 || e._dead) return;
  e.hp -= amount; e.flash = .065;
  emit(s, 'hit', { side: 'enemy', x: e.x, y: e.y });
  if (e.hp <= 0) defeat(s, e);
}

function hurtPlayer(s) {
  const p = s.player;
  if (p.invulnerable > 0 || p.rollTime > 0 || s.phase !== 'playing' || s.stageCleared) return;
  p.hp--; s.damageTaken++; p.invulnerable = 1.65; p.flash = .25;
  s.combo = 0; s.multiplier = 1; s._comboTime = 0;
  particle(s, p.x, p.y, COLORS.hot, 18, 3, 85);
  emit(s, 'hit', { side: 'player', x: p.x, y: p.y });
  // A hit clears a small breathing pocket rather than chaining damage immediately.
  for (const b of s.bullets) if (b.side === 'enemy' && distance2(b,p) < sq(50)) b._dead = true;
  if (p.hp <= 0) {
    s.phase = 'lost';
    particle(s, p.x, p.y, COLORS.gold, 50, 4, 105);
    s.particles.push({ kind: 'explosion', x: p.x, y: p.y, vx: 0, vy: 0,
      life: .55, maxLife: .55, color: COLORS.gold, size: 40 });
    emit(s, 'explosion', { x: p.x, y: p.y, size: 'large' }); emit(s, 'lose');
  }
}

function hitsEnemy(b, e) {
  if (e.rx) return sq((b.x - e.x) / (e.rx + b.r)) + sq((b.y - e.y) / (e.ry + b.r)) < 1;
  return distance2(b,e) < sq(b.r + e.r);
}

function moveBullets(s, dt) {
  for (const b of s.bullets) {
    if (b._dead) continue;
    b.age += dt;
    if (b.kind === 'missile') {
      let target = s.enemies.find(e => e.id === b._targetId && e.hp > 0 && e.y > -50);
      if (!target) {
        target = s.enemies.filter(e => e.hp > 0 && e.y > -50 && e.y < b.y + 50)
          .sort((a,c) => distance2(a,b) - distance2(c,b))[0];
        b._targetId = target?.id ?? null;
      }
      if (target) {
        const dx = target.x - b.x, dy = target.y - b.y, length = Math.max(1, Math.hypot(dx,dy));
        const blend = Math.min(1, dt * 8);
        b.vx += (dx / length * 390 - b.vx) * blend;
        b.vy += (dy / length * 390 - b.vy) * blend;
      }
      b._trail -= dt;
      if (b._trail <= 0) {
        s.particles.push({ x: b.x, y: b.y + 4, vx: -b.vx * .06, vy: 40,
          life: .2, maxLife: .2, color: COLORS.cyan, size: 2 });
        b._trail = .025;
      }
      if (b.age > 4) b._dead = true;
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.side === 'player') {
      for (const e of s.enemies) {
        if (e.hp <= 0 || e.y < -35 || !hitsEnemy(b,e)) continue;
        b._dead = true;
        if (b.kind === 'missile') {
          particle(s, b.x, b.y, COLORS.cyan, 16, 3, 85);
          s.particles.push({ kind: 'explosion', x: b.x, y: b.y, vx: 0, vy: 0,
            life: .32, maxLife: .32, color: COLORS.cyan, size: 28 });
          damageEnemy(s, e, b.damage);
          if (s.phase !== 'playing' || s.stageCleared) return;
          for (const near of s.enemies) if (near !== e && near.hp > 0 && distance2(near,b) < sq(48 + near.r)) damageEnemy(s, near, 12);
          for (const hostile of s.bullets) if (hostile.side === 'enemy' && distance2(hostile,b) < sq(42)) hostile._dead = true;
        } else damageEnemy(s, e, b.damage);
        break;
      }
    } else if (distance2(b,s.player) < sq(b.r + s.player.r)) {
      b._dead = true; hurtPlayer(s);
    }
    if (s.phase !== 'playing' || s.stageCleared) return;
  }
  for (const e of s.enemies) if (e.hp > 0 && e.y > 0 && hitsEnemy(s.player,e)) hurtPlayer(s);
}

function movePickups(s, dt) {
  for (const item of s.pickups) {
    item.age += dt;
    const distance = Math.sqrt(distance2(item,s.player));
    const magnet = item.kind === 'score' ? 82 : 138;
    if (distance < magnet && distance > 1) {
      const strength = (1 - distance / magnet) * 530 + 85;
      item.vx = (s.player.x - item.x) / distance * strength;
      item.vy = (s.player.y - item.y) / distance * strength;
    } else { item.vx *= Math.max(0, 1 - dt * 4); item.vy += (38 - item.vy) * Math.min(1, dt * 4); }
    item.x += item.vx * dt; item.y += item.vy * dt;
    if (distance < 18) {
      item._dead = true;
      if (item.kind === 'power') {
        s.player.weapon = Math.min(3, s.player.weapon + 1);
        floater(s, s.player.x, s.player.y - 30, `POWER ${s.player.weapon}`, COLORS.cyan, 11);
      } else if (item.kind === 'repair') {
        s.player.hp = Math.min(s.player.maxHp, s.player.hp + 1);
        floater(s, s.player.x, s.player.y - 30, '+1 ARMOR', '#ff94bc');
      } else {
        const points = 200 * s.multiplier;
        s.score += points; s._comboTime = Math.max(s._comboTime, 3);
        floater(s, item.x, item.y, `+${points}`);
      }
      particle(s, item.x, item.y, item.color, 8, 2, 50);
      emit(s, 'pickup', { kind: item.kind });
    }
  }
}

function effects(s, dt) {
  for (const p of s.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  for (const f of s.floaters) { f.life -= dt; f.y -= dt * 22; }
  for (const t of s.telegraphs) t.life -= dt;
  s.particles = s.particles.filter(p => p.life > 0).slice(-300);
  s.floaters = s.floaters.filter(f => f.life > 0).slice(-24);
  s.telegraphs = s.telegraphs.filter(t => t.life > 0).slice(-32);
}

function tick(s, input, dt) {
  if (s.stageCleared) {
    s.time += dt; s.stageTime += dt; s.clearTime += dt; s.scroll += 30 * dt;
    const p = s.player;
    p.age += dt; p.vx = (320 - p.x) * 1.4; p.vy = (290 - p.y) * 1.4;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.bank += (clamp(p.vx / 230, -1, 1) - p.bank) * Math.min(1, dt * 8);
    p.flash = Math.max(0, p.flash - dt); p.rollTime = Math.max(0, p.rollTime - dt);
    p.invulnerable = Math.max(0, p.invulnerable - dt);
    // Small delayed bursts let the destroyed hull finish its last animation before the menu.
    if (s._clearBurst < 3 && s.clearTime >= .18 + s._clearBurst * .18) {
      const x = s.boss.x + (s._clearBurst - 1) * 32;
      const y = s.boss.y + (s._clearBurst % 2 ? -14 : 12);
      particle(s, x, y, COLORS.gold, 12, 3, 75);
      s.particles.push({ kind: 'explosion', x, y, vx: 0, vy: 0,
        life: .34, maxLife: .34, color: COLORS.gold, size: 26 });
      s._clearBurst++;
    }
    effects(s, dt);
    if (s.clearTime >= CLEAR_DURATION - 1e-10) {
      s.phase = s.stage === STAGES.length - 1 ? 'won' : 'upgrade';
      emit(s, s.phase === 'won' ? 'win' : 'stage', { stage: s.stage });
    }
    return;
  }
  s.time += dt; s.stageTime += dt; s.scroll += (s.boss ? 35 : 64 + s.stage * 6) * dt;
  s._comboTime -= dt;
  if (s._comboTime <= 0) { s.combo = 0; s.multiplier = 1; }
  const waves = WAVES[s.stage];
  while (s._wave < waves.length && s.stageTime >= waves[s._wave][0]) spawnWave(s, waves[s._wave++]);
  if (!s._bossSpawned && s.stageTime >= STAGES[s.stage].duration) spawnBoss(s);
  s.stageProgress = s.boss ? .85 + .15 * (1 - s.boss.hp / s.boss.maxHp)
    : Math.min(.85, s.stageTime / STAGES[s.stage].duration * .85);
  movePlayer(s, input, dt);
  moveEnemies(s, dt);
  moveBullets(s, dt);
  if (s.phase === 'playing' && !s.stageCleared) movePickups(s, dt);
  effects(s, dt);
  s.enemies = s.enemies.filter(e => e.hp > 0 && e.y < HEIGHT + 70 && e.age < (e.kind === 'boss' ? Infinity : 24));
  s.bullets = s.bullets.filter(b => !b._dead && b.x > -40 && b.x < WIDTH + 40 && b.y > -90 && b.y < HEIGHT + 50 && b.age < 12).slice(-400);
  s.pickups = s.pickups.filter(p => !p._dead && p.y < HEIGHT + 35 && p.age < 12);
}

/** Call with elapsed seconds. Large background-tab gaps are intentionally discarded. */
export function stepGame(s, input = {}, dt = 1 / 60) {
  s.events = s._queuedEvents.splice(0);
  if (s.phase !== 'playing') return s;
  if (!Number.isFinite(dt) || dt <= 0) return s;
  if (input.missile && !s._lastMissile) useMissile(s);
  if (input.roll && !s._lastRoll) useRoll(s);
  s._lastMissile = !!input.missile; s._lastRoll = !!input.roll;
  s._accumulator += Math.min(dt, .1);
  while (s._accumulator >= STEP - 1e-10 && s.phase === 'playing') {
    s._accumulator -= STEP;
    tick(s, input, STEP);
  }
  return s;
}
