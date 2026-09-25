// Quality tiers. Start from cheap device heuristics, then measure the warmed
// scene. Frame intervals include display vsync, so a steady 60 Hz display
// must not be mistaken for a slow GPU. Manual overrides always win.

const STORE_KEY = "raptor:quality:v1";
const BENCH_KEY = "raptor:bench:v3";
let sessionTier = null, sessionBench = null;
const validTier = name => typeof name === 'string' && Object.hasOwn(TIERS, name);
function manualTier() {
  try { const name=localStorage.getItem(STORE_KEY); return validTier(name)?name:null; } catch { return sessionTier; }
}

export const TIERS = {
  LOW:   { renderScale: 0.75, shadows: false, shadowSize: 0,    scatter: 0.25, clouds: "volumetric", cloudScale: .5,  cloudNoise: "standard", post: true },
  MED:   { renderScale: 1.0,  shadows: true,  shadowSize: 1024, scatter: 0.5,  clouds: "volumetric", cloudScale: .67, cloudNoise: "standard", post: true },
  HIGH:  { renderScale: 1.0,  shadows: true,  shadowSize: 2048, scatter: 1.0,  clouds: "volumetric", cloudScale: .75, cloudNoise: "high", post: true },
  ULTRA: { renderScale: 1.25, shadows: true,  shadowSize: 4096, scatter: 1.0,  clouds: "volumetric", cloudScale: 1,   cloudNoise: "ultra", post: true },
};

export function savedBench() {
  try {
    const value=JSON.parse(localStorage.getItem(BENCH_KEY) || 'null');
    return value && validTier(value.tier) && ['webgpu','webgl'].includes(value.backend) && Number.isFinite(value.ms) && value.ms>0 ? value : null;
  } catch (_) { return sessionBench; }
}

export function saveBench(rec) {
  if(!rec || !validTier(rec.tier) || !['webgpu','webgl'].includes(rec.backend) || !Number.isFinite(rec.ms) || rec.ms<=0)return;
  sessionBench={...rec};
  try {localStorage.setItem(BENCH_KEY, JSON.stringify(rec));}catch {}
}

export function clearBench() {
  sessionTier=null;sessionBench=null;
  try {localStorage.removeItem(BENCH_KEY);localStorage.removeItem(STORE_KEY);}catch {}
}

// Median frame ms from a measured run of the live scene → tier.
export function benchPick(medianMs, backend, activeTier) {
  if (!Number.isFinite(medianMs) || medianMs <= 0) return "LOW";
  // An already measured live preset can retain its display-limited result.
  if (validTier(activeTier)) {
    if (medianMs <= 18.5) return activeTier;
    if (medianMs > 34) return "LOW";
    return ["HIGH", "ULTRA"].includes(activeTier) ? "MED" : "LOW";
  }
  // Vsync alone never establishes spare capacity for supersampling.
  // Preserve native output at 60/90/120/144 Hz; ULTRA remains opt-in.
  if (backend === "webgpu" && medianMs <= 18.5) return "HIGH";
  if (medianMs <= 30) return "MED";
  return "LOW";
}

export function isCompatibleBench(bench, { backend, profile } = {}) {
  return !!(bench && validTier(bench.tier) && bench.backend === backend
    && Number.isFinite(bench.ms) && bench.ms > 0
    && (profile === undefined || bench.profile === profile));
}

export function detectTier({ backend, profile } = {}) {
  const saved = manualTier();
  if (saved) return saved;
  const bench = savedBench();
  if (isCompatibleBench(bench, { backend, profile })) return bench.tier;
  return deviceTier({ backend });
}

// Fixed boot assets use the device/manual class, never a cached render tier.
export function bootAssetTier({ backend } = {}) {
  const manual = manualTier();
  return manual || deviceTier({ backend });
}

export function deviceTier({ backend } = {}) {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8; // absent on Safari/FF → assume mid
  const coarse = matchMedia("(any-pointer: coarse)").matches;
  if (backend === "webgl" || coarse) return cores >= 8 ? "MED" : "LOW";
  if (cores >= 10 && mem >= 8) return "HIGH"; // ULTRA is opt-in until the bench lands
  if (cores >= 8) return "MED";
  return "LOW";
}

export function hasManualTier() { return !!manualTier(); }

export function setTier(name) {
  if (!validTier(name)) return false;
  sessionTier=name;
  try {localStorage.setItem(STORE_KEY, name);}catch {}
  return true;
}

export function tierParams(name) { return validTier(name) ? TIERS[name] : TIERS.MED; }
