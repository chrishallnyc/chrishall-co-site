// Quality tiers. Auto-pick on first run from cheap heuristics; a real measured
// auto-benchmark replaces the heuristic once a representative scene exists
// (journaled — phase 1 block B). Manual override always wins and persists.

const STORE_KEY = "raptor:quality:v1";
const BENCH_KEY = "raptor:bench:v1";
let sessionTier = null, sessionBench = null;
const validTier = name => typeof name === 'string' && Object.hasOwn(TIERS, name);
function manualTier() {
  try { const name=localStorage.getItem(STORE_KEY); return validTier(name)?name:null; } catch { return sessionTier; }
}

export const TIERS = {
  LOW:   { renderScale: 0.75, shadows: false, shadowSize: 0,    scatter: 0.25, clouds: "sky",       post: false },
  MED:   { renderScale: 1.0,  shadows: true,  shadowSize: 1024, scatter: 0.5,  clouds: "billboard", post: false },
  HIGH:  { renderScale: 1.0,  shadows: true,  shadowSize: 2048, scatter: 1.0,  clouds: "imposter",  post: true },
  ULTRA: { renderScale: 1.0,  shadows: true,  shadowSize: 4096, scatter: 1.0,  clouds: "volumetric", post: true },
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
  // requestAnimationFrame is display-limited. A stable 60 Hz HIGH scene is
  // already meeting its budget; 16.7 ms is not evidence it needs downgrading.
  if (validTier(activeTier) && Number.isFinite(medianMs) && medianMs > 0) {
    if (medianMs <= 18.5) return activeTier;
    if (medianMs > 34) return 'LOW';
    return ['HIGH','ULTRA'].includes(activeTier) ? 'MED' : 'LOW';
  }
  if (backend === "webgpu" && medianMs < 5) return "ULTRA";
  if (medianMs < 9) return "HIGH";
  if (medianMs < 17) return "MED";
  return "LOW";
}

export function detectTier({ backend } = {}) {
  const saved = manualTier();
  if (saved) return saved;
  const bench = savedBench();
  if (bench && TIERS[bench.tier] && bench.backend === backend) return bench.tier;
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
