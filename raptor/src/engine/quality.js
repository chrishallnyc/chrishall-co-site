// Quality tiers. Start from cheap device heuristics, then measure the warmed
// scene. Frame intervals include display vsync, so a steady 60 Hz display
// must not be mistaken for a slow GPU. Manual overrides always win.

const STORE_KEY = "raptor:quality:v1";
const BENCH_KEY = "raptor:bench:v3";

export const TIERS = {
  LOW:   { renderScale: 0.75, shadows: false, shadowSize: 0,    scatter: 0.25, clouds: "volumetric", cloudScale: .5,  cloudNoise: "standard", post: true },
  MED:   { renderScale: 1.0,  shadows: true,  shadowSize: 1024, scatter: 0.5,  clouds: "volumetric", cloudScale: .67, cloudNoise: "standard", post: true },
  HIGH:  { renderScale: 1.0,  shadows: true,  shadowSize: 2048, scatter: 1.0,  clouds: "volumetric", cloudScale: .75, cloudNoise: "standard", post: true },
  ULTRA: { renderScale: 1.25, shadows: true,  shadowSize: 4096, scatter: 1.0,  clouds: "volumetric", cloudScale: 1,   cloudNoise: "ultra", post: true },
};

export function savedBench() {
  try { return JSON.parse(localStorage.getItem(BENCH_KEY) || "null"); } catch (_) { return null; }
}

export function saveBench(rec) { localStorage.setItem(BENCH_KEY, JSON.stringify(rec)); }

export function clearBench() { localStorage.removeItem(BENCH_KEY); localStorage.removeItem(STORE_KEY); }

// Median frame ms from a measured run of the live scene → tier.
export function benchPick(medianMs, backend) {
  // 60/90/120/144 Hz all retain native resolution. Vsync measurements do
  // not prove enough spare GPU time for supersampling, so ULTRA is opt-in.
  if (backend === "webgpu" && medianMs <= 18.5) return "HIGH";
  if (medianMs <= 30) return "MED";
  return "LOW";
}

export function isCompatibleBench(bench, { backend, profile } = {}) {
  return !!(bench && TIERS[bench.tier] && bench.backend === backend
    && (profile === undefined || bench.profile === profile));
}

export function detectTier({ backend, profile } = {}) {
  const saved = localStorage.getItem(STORE_KEY);
  if (saved && TIERS[saved]) return saved;
  const bench = savedBench();
  if (isCompatibleBench(bench, { backend, profile })) return bench.tier;
  return deviceTier({ backend });
}

// Fixed boot assets use the device/manual class, never a cached render tier.
export function bootAssetTier({ backend } = {}) {
  const manual = localStorage.getItem(STORE_KEY);
  return TIERS[manual] ? manual : deviceTier({ backend });
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

export function hasManualTier() { return !!TIERS[localStorage.getItem(STORE_KEY)]; }

export function setTier(name) {
  if (!TIERS[name]) return false;
  localStorage.setItem(STORE_KEY, name);
  return true;
}

export function tierParams(name) { return TIERS[name] || TIERS.MED; }
