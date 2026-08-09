// RAPTOR settings (phase 15): one persisted, corrupt-safe record for the
// player-facing knobs the quality tiers don't own — FOV, mixer levels, motion
// reduction, subtitle scale, colorblind-safe marker palettes — plus the manual
// tier pick (delegated to quality.js, which stays the single source of truth
// for the tier key) and an optional render-scale override.
//
// Live-apply contract: main.js calls bindLive({ renderer, camera, audio,
// gunFlash, baseTier, hudLive }) once at boot; from then on every menu edit
// re-applies immediately wherever a target is bound. Anything not bound is a
// stored value only (the menu labels those rows STORED, honestly). Per-frame
// consumers (subtitle scale, marker palette, motion-reduce on the vignette)
// read current()/getPalette() directly from main.js's render loop.

import { TIERS, tierParams, setTier, clearBench, hasManualTier, detectTier } from "../engine/quality.js";

export const KEY = "raptor.settings.v1";

// HUD accent sets. "default" is the shipped palette verbatim (main.js arcade
// layers). The alternates are qualitative colorblind-safe picks: deuteranopia
// (red/green-blind) moves the warn color off the red axis and keeps the
// enemy/friendly pair on the orange-vs-blue axis; tritanopia (blue/yellow-
// blind) carries the signal on the red-vs-green axis instead.
export const PALETTES = {
  default:      { enemy: "#ff8a5c", friendly: "#7fb4e8", warn: "#ff5a3c", lock: "#ffd27a", good: "#9be89b" },
  deuteranopia: { enemy: "#ffa03c", friendly: "#4fa8ff", warn: "#ffe14d", lock: "#ffffff", good: "#bfe0ff" },
  tritanopia:   { enemy: "#ff4d6b", friendly: "#3fc46e", warn: "#ff2e2e", lock: "#ffffff", good: "#e8e6df" },
};

export const DEFAULTS = Object.freeze({
  tier: "AUTO",        // "AUTO" | LOW | MED | HIGH | ULTRA (manual pick lives in quality.js)
  renderScale: null,   // null = the active tier's default; 0.5-1.5 overrides it
  fov: 60,             // degrees; 45-90 (main.js constructs the camera at 60)
  masterVol: 1,        // 0-1, scales AudioBus.master (x0.9 shipped headroom)
  engineVol: 1,        // 0-1 -> EngineVoice.dry
  uiVol: 1,            // 0-1 -> LockTones.dry (RWR/seeker beeps)
  motionReduce: false, // kills hit-flash vignette + muzzle-flash pulse
  subtitleScale: 1,    // 0.8-1.6, scales the comms-feed font in the HUD
  markerPalette: "default",
});

const num = (v, lo, hi, dflt) =>
  (typeof v === "number" && isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : dflt;

// Every field is clamped/defaulted independently, so a corrupt or hostile
// blob can never brick the boot — worst case is factory defaults.
export function validate(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    tier: (r.tier === "AUTO" || TIERS[r.tier]) ? r.tier : DEFAULTS.tier,
    renderScale: (r.renderScale === null || r.renderScale === undefined)
      ? null : num(r.renderScale, 0.5, 1.5, null),
    fov: num(r.fov, 45, 90, DEFAULTS.fov),
    masterVol: num(r.masterVol, 0, 1, DEFAULTS.masterVol),
    engineVol: num(r.engineVol, 0, 1, DEFAULTS.engineVol),
    uiVol: num(r.uiVol, 0, 1, DEFAULTS.uiVol),
    motionReduce: !!r.motionReduce,
    subtitleScale: num(r.subtitleScale, 0.8, 1.6, DEFAULTS.subtitleScale),
    markerPalette: PALETTES[r.markerPalette] ? r.markerPalette : DEFAULTS.markerPalette,
  };
}

let cache = null; // last validated settings
let live = null;  // bindLive ctx

export function loadSettings() {
  let raw = null, stored = false;
  try {
    const s = localStorage.getItem(KEY);
    if (s !== null) { stored = true; raw = JSON.parse(s); }
  } catch (_) { raw = null; } // corrupt JSON / storage denied -> defaults
  cache = validate(raw);
  // first run: adopt a pre-existing manual tier (set via __RAPTOR.setTier or
  // older builds) so the menu reflects reality instead of claiming AUTO
  if (!stored && hasManualTier()) cache.tier = detectTier({});
  return cache;
}

export function current() { return cache || loadSettings(); }

export function saveSettings(patch = {}) {
  const prev = current();
  const next = validate({ ...prev, ...patch });
  if ("tier" in patch || next.tier !== prev.tier) {
    // quality.js owns the manual-tier key. AUTO = drop the manual pick; the
    // only public door is clearBench(), which also drops the stale bench —
    // honest semantics: the next boot re-benchmarks the live scene.
    if (next.tier === "AUTO") { if (hasManualTier()) clearBench(); }
    else setTier(next.tier);
  }
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (_) { /* session-only */ }
  if (live) applySettings(next, live);
  return next;
}

// Reset-to-Auto: clearBench() (manual tier + bench both gone -> true re-bench
// next boot) + factory defaults, live-applied where bound.
export function resetSettings() {
  clearBench();
  try { localStorage.removeItem(KEY); } catch (_) {}
  cache = { ...DEFAULTS };
  if (live) applySettings(cache, live);
  return cache;
}

// ---- live-apply -------------------------------------------------------------
// ctx = { renderer, camera, audio, gunFlash, baseTier, hudLive }
//   renderer  -> pixelRatio from the effective render scale (tier default or override)
//   camera    -> fov + updateProjectionMatrix
//   audio     -> AudioBus gains (master / engine.dry / locks.dry)
//   gunFlash  -> player.gun.flash (InstancedMesh) hidden under motion-reduce
//   baseTier  -> the boot-resolved tier name, used while tier === "AUTO"
//   hudLive   -> flag: main.js's render loop consumes subtitleScale/palette/
//                motionReduce per frame (lights those menu rows LIVE)
export function bindLive(ctx) {
  live = ctx || null;
  if (live) applySettings(current(), live);
}

export function hasLive(name) { return !!(live && live[name]); }
export function getLiveCtx() { return live; }

export function effectiveRenderScale(s = current(), baseTier) {
  const tierName = s.tier !== "AUTO" ? s.tier
    : (baseTier || (live && live.baseTier) || "MED");
  return s.renderScale !== null ? s.renderScale : tierParams(tierName).renderScale;
}

export function applySettings(s, ctx = live) {
  s = validate(s);
  if (!ctx) return s;
  if (ctx.camera) {
    ctx.camera.fov = s.fov;
    ctx.camera.updateProjectionMatrix();
  }
  if (ctx.renderer) {
    ctx.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, 2) * effectiveRenderScale(s, ctx.baseTier));
  }
  if (ctx.audio && ctx.audio.ctx) {
    const a = ctx.audio, t0 = a.ctx.currentTime;
    a.master.gain.setTargetAtTime(0.9 * s.masterVol, t0, 0.02); // 0.9 = shipped headroom
    if (a.engine && a.engine.dry) a.engine.dry.gain.setTargetAtTime(s.engineVol, t0, 0.02);
    if (a.locks && a.locks.dry) a.locks.dry.gain.setTargetAtTime(s.uiVol, t0, 0.02);
  }
  if (ctx.gunFlash) ctx.gunFlash.visible = !s.motionReduce;
  return s;
}

export function getPalette(name) {
  return PALETTES[name || current().markerPalette] || PALETTES.default;
}

export function subtitleScale() { return current().subtitleScale; }
