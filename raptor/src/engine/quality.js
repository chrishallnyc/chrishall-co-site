// Quality tiers. Auto-pick on first run from cheap heuristics; a real measured
// auto-benchmark replaces the heuristic once a representative scene exists
// (journaled — phase 1 block B). Manual override always wins and persists.

const STORE_KEY = "raptor:quality:v1";

export const TIERS = {
  LOW:   { renderScale: 0.75, shadows: false, shadowSize: 0,    scatter: 0.25, clouds: "sky",       post: false },
  MED:   { renderScale: 1.0,  shadows: true,  shadowSize: 1024, scatter: 0.5,  clouds: "billboard", post: false },
  HIGH:  { renderScale: 1.0,  shadows: true,  shadowSize: 2048, scatter: 1.0,  clouds: "imposter",  post: true },
  ULTRA: { renderScale: 1.0,  shadows: true,  shadowSize: 4096, scatter: 1.0,  clouds: "volumetric", post: true },
};

export function detectTier({ backend } = {}) {
  const saved = localStorage.getItem(STORE_KEY);
  if (saved && TIERS[saved]) return saved;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8; // absent on Safari/FF → assume mid
  const coarse = matchMedia("(any-pointer: coarse)").matches;
  if (backend === "webgl" || coarse) return cores >= 8 ? "MED" : "LOW";
  if (cores >= 10 && mem >= 8) return "HIGH"; // ULTRA is opt-in until the bench lands
  if (cores >= 8) return "MED";
  return "LOW";
}

export function setTier(name) {
  if (!TIERS[name]) return false;
  localStorage.setItem(STORE_KEY, name);
  return true;
}

export function tierParams(name) { return TIERS[name] || TIERS.MED; }
