import { WIDTH, HEIGHT, STAGES, UPGRADE_CHOICES, createGame, stepGame, useMissile, useRoll, chooseUpgrade } from './sim.js';
import { createRenderer } from './art.js';
import { ArcadeAudio } from './audio.js';
import { canvasPoint, readController } from './input.js';

const $ = id => document.getElementById(id);
const key = 'raptor.arcade.v1';
let persistent = true;
const defaults = { best: 0, runs: 0, wins: 0, difficulty: 'arcade', muted: false, reduced: null };
let preferences;
try { preferences = { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }; }
catch { preferences = { ...defaults }; persistent = false; }
if (!Number.isFinite(preferences.best) || preferences.best < 0) preferences.best = 0;
if (!['arcade', 'relaxed'].includes(preferences.difficulty)) preferences.difficulty = 'arcade';
for (const field of ['runs', 'wins']) {
  if (!Number.isSafeInteger(preferences[field]) || preferences[field] < 0) preferences[field] = 0;
}
if (typeof preferences.muted !== 'boolean') preferences.muted = false;
if (typeof preferences.reduced !== 'boolean') preferences.reduced = null;
const save = () => { try { localStorage.setItem(key, JSON.stringify(preferences)); persistent = true; } catch { persistent = false; } };
const canvas = $('game'), screen = $('screen'), renderer = createRenderer(canvas);
const audio = new ArcadeAudio();
audio.setMuted(preferences.muted);
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const portraitScreen = matchMedia('(max-width:480px) and (orientation:portrait)');
const reduced = () => preferences.reduced ?? motionPreference.matches;
const scoreText = value => Math.floor(value || 0).toString().padStart(6, '0');
const stageName = index => STAGES[index]?.name || ['Pacific Coast', 'Red Canyon', 'Neon Harbor'][index] || 'Sky clear';
let state = createGame({ difficulty: preferences.difficulty });
let view = 'title', paused = false, previousPhase = 'playing', recorded = false;
let menuTime = 0, menuStage = 0, last = performance.now(), uiClock = 0;
let controllerPause = false, pointerId = null;
const keys = new Set(), pointer = { active: false, x: WIDTH / 2, y: HEIGHT * .8 };
const telemetry = { frames: 0, lastFrameMs: 0, maxFrameMs: 0, errors: [] };
const overlayNames = ['title', 'pause', 'upgrade', 'result'];
const neutralInput = { x: 0, y: 0, pointer: false, missile: false, roll: false };

function clearInput() {
  keys.clear(); pointer.active = false;
  if (pointerId !== null) { try { canvas.releasePointerCapture(pointerId); } catch {} }
  pointerId = null;
}

function setView(next) {
  view = next; screen.dataset.view = next;
  for (const name of overlayNames) $(name + '-screen').hidden = name !== next;
  $('flight-hud').hidden = next !== 'playing';
  clearInput();
  if (next === 'playing') canvas.focus({ preventScroll: true });
}

async function wakeAudio() {
  try { await audio.start(); audio.setMuted(preferences.muted); audio.setPaused(paused || view !== 'playing'); }
  catch (error) { telemetry.errors.push('Audio unavailable: ' + error.message); }
}

function updatePreferences() {
  $('title-best').textContent = scoreText(preferences.best);
  $('sound').setAttribute('aria-pressed', String(!preferences.muted));
  $('sound').setAttribute('aria-label', preferences.muted ? 'Sound off. Turn sound on' : 'Sound on. Mute sound');
  $('sound').querySelector('span').textContent = preferences.muted ? 'Sound off' : 'Sound on';
  $('motion').textContent = `Reduced effects: ${reduced() ? 'on' : 'off'}`;
  $('motion').setAttribute('aria-pressed', String(reduced()));
  for (const button of document.querySelectorAll('[data-difficulty]')) button.setAttribute('aria-pressed', String(button.dataset.difficulty === preferences.difficulty));
  $('difficulty-note').textContent = preferences.difficulty === 'relaxed' ? 'More armor. Slower enemy fire. Same big adventure.' : 'Chase the score. Make every dodge count.';
}

function begin() {
  if (!$('help-dialog').open) {
    state = createGame({ difficulty: preferences.difficulty });
    previousPhase = state.phase; recorded = false; paused = false; controllerPause = false;
    last = performance.now(); uiClock = 0;
    audio.setStage(0); audio.setPaused(false);
    setView('playing'); updateHUD(); wakeAudio();
    $('announcement').textContent = 'Flight started. Pacific Coast. Cannons fire automatically.';
  }
}

function pause() {
  if (view !== 'playing' || state.phase !== 'playing') return;
  paused = true; audio.setPaused(true); setView('pause');
  $('resume').focus({ preventScroll: true });
}

function resume() {
  if (view !== 'pause' || $('help-dialog').open) return;
  paused = false; last = performance.now(); setView('playing'); audio.setPaused(false); wakeAudio();
}

function title() {
  paused = false; audio.setPaused(true); menuTime = 0; setView('title');
  updatePreferences(); $('launch').focus({ preventScroll: true });
}

function recordRun() {
  if (recorded) return;
  recorded = true;
  const best = state.score > preferences.best;
  preferences.best = Math.max(preferences.best, state.score);
  preferences.runs = Math.max(0, Number(preferences.runs) || 0) + 1;
  if (state.phase === 'won') preferences.wins = Math.max(0, Number(preferences.wins) || 0) + 1;
  save();
  const won = state.phase === 'won';
  $('result-kicker').textContent = won ? 'ALL THREE SKIES ARE YOURS' : 'EVERY GREAT PILOT STARTS SOMEWHERE';
  $('result-title').textContent = won ? 'Ace of the skies.' : 'One more flight?';
  $('result-copy').textContent = won ? 'Coast, canyon, harbor. A little jet just did a very big thing.' : 'Keep moving, roll through the tight spots, and let those missiles fly.';
  $('final-score').textContent = scoreText(state.score);
  $('final-kills').textContent = state.kills;
  const time = Math.floor(state.time);
  $('final-time').textContent = `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`;
  $('new-best').textContent = best ? (persistent ? '✦ A NEW PERSONAL BEST ✦' : '✦ SESSION BEST · STORAGE UNAVAILABLE') : `PERSONAL BEST ${scoreText(preferences.best)}${persistent ? '' : ' · THIS SESSION'}`;
  $('announcement').textContent = `${won ? 'All sectors cleared.' : 'Flight ended.'} Score ${Math.floor(state.score)}.`;
  setView('result'); $('retry').focus({ preventScroll: true });
}

function upgrade() {
  setView('upgrade');
  $('next-region').textContent = `UP NEXT · ${stageName(state.stage + 1).toUpperCase()}`;
  const container = $('upgrade-options'); container.replaceChildren();
  UPGRADE_CHOICES.forEach((choice, index) => {
    const button = document.createElement('button'); button.className = 'upgrade-option'; button.dataset.upgrade = choice.id;
    const icon = document.createElement('span'); icon.className = 'upgrade-icon'; icon.textContent = ['»', '+', '↟'][index]; icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('b'); name.textContent = choice.name;
    const description = document.createElement('small'); description.textContent = choice.description;
    const action = document.createElement('span'); action.className = 'choose'; action.textContent = 'EQUIP & FLY ↗';
    button.append(icon, name, description, action);
    button.onclick = () => {
      chooseUpgrade(state, choice.id); previousPhase = state.phase; paused = false;
      audio.setStage(state.stage); audio.setPaused(false); last = performance.now();
      setView('playing'); updateHUD(); wakeAudio();
      $('announcement').textContent = `${choice.name} equipped. ${stageName(state.stage)}.`;
    };
    container.append(button);
  });
  container.querySelector('button')?.focus({ preventScroll: true });
}

let healthSignature = '';
function updateHUD() {
  const p = state.player;
  $('score').textContent = scoreText(state.score);
  $('streak').textContent = state.multiplier > 1 ? `×${state.multiplier} · ${state.combo} CHAIN` : 'Find your rhythm';
  $('stage-number').textContent = `SECTOR ${String(state.stage + 1).padStart(2, '0')} / 03`;
  $('stage-name').textContent = stageName(state.stage).toUpperCase();
  $('stage-progress').style.width = `${Math.max(0, Math.min(1, state.stageProgress || 0)) * 100}%`;
  const health = `${p.hp}/${p.maxHp}`;
  if (healthSignature !== health) {
    healthSignature = health; const hearts = $('hearts'); hearts.replaceChildren();
    for (let i = 0; i < p.maxHp; i++) { const segment = document.createElement('i'); segment.className = i >= p.hp ? 'empty' : i >= 6 ? 'extra' : ''; segment.setAttribute('aria-hidden', 'true'); hearts.append(segment); }
    hearts.setAttribute('aria-label', `Airframe: ${p.hp} of ${p.maxHp}`);
  }
  $('weapon-level').textContent = ['I', 'II', 'III', 'IV'][Math.min(3, Math.max(0, (p.weapon || 1) - 1))];
  for (const [id, value, total] of [['missile', p.missileCooldown || 0, p.missileMax || 7], ['roll', p.rollCooldown || 0, p.rollMax || 3]]) {
    const button = $(id), ready = value <= 0;
    button.setAttribute('aria-disabled', String(!ready));
    button.querySelector('small').textContent = ready ? 'READY' : `${value.toFixed(1)}s`;
    button.querySelector('.ability-meter').style.width = `${100 * Math.max(0, Math.min(1, 1 - value / total))}%`;
  }
  const boss = state.boss;
  $('boss-hud').hidden = !boss || boss.hp <= 0;
  if (boss && boss.hp > 0) {
    $('boss-name').textContent = boss.name || ['TIDEBREAKER', 'IRON WING', 'ARCLIGHT'][state.stage];
    $('boss-health').style.width = `${Math.max(0, boss.hp / boss.maxHp) * 100}%`;
  }
  const banner = state.stageCleared ? 'SECTOR CLEAR · WELL FLOWN' : state.stageTime < 3.2 ? `${String(state.stage + 1).padStart(2, '0')} / ${stageName(state.stage).toUpperCase()}` : '';
  if ($('stage-banner').textContent !== banner) $('stage-banner').textContent = banner;
  $('first-tip').hidden = state.stage !== 0 || state.stageTime > 8 || !!boss;
}

function inputFrame() {
  const pad = [...(navigator.getGamepads?.() || [])].find(p => p?.connected);
  const controller = readController(pad);
  if (controller.pause && !controllerPause) { if (view === 'playing') pause(); else if (view === 'pause') resume(); }
  controllerPause = controller.pause;
  const x = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'));
  const y = Number(keys.has('ArrowDown') || keys.has('KeyS')) - Number(keys.has('ArrowUp') || keys.has('KeyW'));
  return { x: x || controller.x, y: y || controller.y, pointer: pointer.active && !x && !y && !controller.x && !controller.y,
    targetX: pointer.x, targetY: pointer.y,
    missile: keys.has('Space') || controller.missile, roll: keys.has('ShiftLeft') || keys.has('ShiftRight') || controller.roll };
}

function draw(now) {
  const elapsed = (now - last) / 1000; last = now;
  const dt = Math.min(.05, Math.max(0, elapsed));
  telemetry.frames++; telemetry.lastFrameMs = elapsed * 1000;
  if (view === 'playing') telemetry.maxFrameMs = Math.max(telemetry.maxFrameMs, elapsed * 1000);
  const input = inputFrame();
  if (view === 'playing' && !paused && !document.hidden) {
    stepGame(state, input, dt);
    audio.update(state);
    for (const event of state.events) audio.event(event);
    if (state.phase !== previousPhase) {
      previousPhase = state.phase;
      if (state.phase === 'upgrade') upgrade();
      else if (state.phase === 'won' || state.phase === 'lost') recordRun();
    }
    uiClock += dt; if (uiClock >= .05) { uiClock = 0; updateHUD(); }
  }
  if (view === 'title') {
    menuTime += dt;
    const scene = { ...state, phase: 'playing', stage: menuStage, time: menuTime, stageTime: menuTime, scroll: menuTime * 25,
      player: { ...state.player, x: (portraitScreen.matches ? 375 : 460) + Math.sin(menuTime * .6) * 14, y: (portraitScreen.matches ? 300 : 245) + Math.sin(menuTime * .8) * 7, hp: 6, invulnerable: 0, rollTime: 0 },
      enemies: [], bullets: [], particles: [], floaters: [], pickups: [], telegraphs: [], boss: null };
    renderer.render(scene, { attract: true, reducedMotion: reduced() });
  } else renderer.render(state, { reducedMotion: reduced() });
  requestAnimationFrame(draw);
}

$('launch').onclick = begin; $('retry').onclick = begin; $('resume').onclick = resume;
$('back-title').onclick = title; $('quit').onclick = title; $('pause').onclick = pause;
$('missile').onclick = () => { if (view === 'playing') useMissile(state); };
$('roll').onclick = () => { if (view === 'playing') useRoll(state); };
$('sound').onclick = () => { preferences.muted = !preferences.muted; save(); audio.setMuted(preferences.muted); updatePreferences(); if (!preferences.muted) wakeAudio(); };
$('motion').onclick = () => { preferences.reduced = !reduced(); save(); updatePreferences(); };
for (const button of document.querySelectorAll('[data-difficulty]')) button.onclick = () => { preferences.difficulty = button.dataset.difficulty; save(); updatePreferences(); };
for (const button of document.querySelectorAll('[data-preview]')) button.onclick = () => {
  menuStage = Number(button.dataset.preview);
  for (const candidate of document.querySelectorAll('[data-preview]')) candidate.setAttribute('aria-pressed', String(candidate === button));
};
$('help').onclick = () => { if (view === 'playing') pause(); $('help-dialog').showModal(); };
for (const button of document.querySelectorAll('.dialog-close,.dialog-close-button')) button.onclick = () => $('help-dialog').close();

const movementKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space']);
addEventListener('keydown', event => {
  if ($('help-dialog').open) return;
  if (event.code === 'Escape' || event.code === 'KeyP') {
    event.preventDefault(); if (event.repeat) return;
    if (view === 'playing') pause(); else if (view === 'pause') resume(); return;
  }
  if (view !== 'playing') return;
  if (event.target.closest?.('button') && (event.code === 'Space' || event.code === 'Enter')) return;
  if (movementKeys.has(event.code)) { event.preventDefault(); keys.add(event.code); }
});
addEventListener('keyup', event => keys.delete(event.code));
addEventListener('blur', () => { clearInput(); pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); pause(); } last = performance.now(); });
canvas.addEventListener('pointerdown', event => {
  if (view !== 'playing' || event.button > 0 || pointerId !== null) return;
  event.preventDefault(); pointerId = event.pointerId; canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true });
  movePointer(event); pointer.active = true;
});
function movePointer(event) {
  const point = canvasPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), WIDTH, HEIGHT);
  pointer.x = Math.max(12, Math.min(WIDTH - 12, point.x));
  pointer.y = Math.max(28, Math.min(HEIGHT - 18, point.y - (event.pointerType === 'touch' ? 24 : 0)));
}
canvas.addEventListener('pointermove', event => { if (event.pointerId === pointerId) { event.preventDefault(); movePointer(event); } });
const release = event => { if (event.pointerId === pointerId) { pointer.active = false; pointerId = null; } };
canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release); canvas.addEventListener('lostpointercapture', release);
if (matchMedia('(pointer:coarse)').matches) {
  $('control-hint').textContent = 'Drag the sky to fly · Tap Missiles or Dodge';
  $('first-tip').textContent = 'Drag to fly. Your jet stays just above your finger.';
}
addEventListener('pagehide', event => {
  if (event.persisted) { pause(); audio.setPaused(true); }
  else audio.destroy();
});
updatePreferences(); setView('title');
$('launch').disabled = false; $('launch').innerHTML = 'Take flight <span aria-hidden="true">↗</span>';
// Read-only diagnostics are useful during browser QA and live support. The
// mutable simulation is exposed only under an explicit local QA flag.
window.__PIXEL_RAPTOR = {
  get ready() { return true; }, get view() { return view; }, get phase() { return state.phase; },
  get snapshot() { return { stage: state.stage, time: state.time, score: state.score, kills: state.kills, player: { ...state.player, upgrades: [...state.player.upgrades] }, enemies: state.enemies.length, bullets: state.bullets.length, boss: state.boss ? { name: state.boss.name, hp: state.boss.hp } : null }; },
  get performance() { return { ...telemetry, errors: [...telemetry.errors] }; },
};
if (new URLSearchParams(location.search).has('qa')) Object.assign(window.__PIXEL_RAPTOR, {
  getState: () => state,
  getAudio: () => ({ state: audio.context?.state || 'uninitialized', muted: audio.muted, voices: audio._voices.size, musicActive: audio._timer !== null }),
  advance(seconds, input = neutralInput) { for (let t = 0; t < seconds; t += 1 / 120) { stepGame(state, input, 1 / 120); if (state.phase !== 'playing') break; } },
});
requestAnimationFrame(draw);
