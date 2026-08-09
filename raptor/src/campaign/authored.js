// Authored campaign (phase-11 INC-7): the scripted set-piece chain. Six
// sorties for now (2 per front), unlocking linearly; INC-8 batches grow the
// registry to 30+. Sortie MODULES (spec + lineIds) live in ./sorties/ and are
// the content agent's lane; this file is the registry, the unlock chain, and
// the raptor.auth.v1 save. Meta-world: strings and localStorage are fine
// here — the sim only ever sees the validated MissionSpec.

import { loadMission } from "../game/missions.js";

export const CAMPAIGN = [
  { id: "N01", front: "NELLIS" },
  { id: "N02", front: "NELLIS" },
  { id: "V01", front: "VALDEZ" },
  { id: "V02", front: "VALDEZ" },
  { id: "M01", front: "MARIANAS" },
  { id: "M02", front: "MARIANAS" },
];

const FILE = { N01: "nellis-01", N02: "nellis-02", V01: "valdez-01", V02: "valdez-02", M01: "marianas-01", M02: "marianas-02" };
const KEY = "raptor.auth.v1";

export function loadAuth() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || "null");
    if (a && a.v === 1 && a.done && typeof a.done === "object") return a;
  } catch (_) { /* fall through to fresh */ }
  return { v: 1, done: {} };
}

export function saveAuth(a) {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (_) { /* private mode: session-only */ }
}

// linear chain: a sortie is unlocked when every earlier one is done
export function isUnlocked(auth, idx) {
  for (let i = 0; i < idx; i++) if (!auth.done[CAMPAIGN[i].id]) return false;
  return true;
}

export function markDone(id) {
  const a = loadAuth();
  if (!a.done[id]) { a.done[id] = 1; saveAuth(a); }
  return a;
}

// resolves the module, validates its spec through the one door, and hands
// back the comms text table for the HUD. Throws on unknown id / invalid spec.
export async function loadSortie(id) {
  const file = FILE[id];
  if (!file) throw new Error("unknown sortie " + id);
  const [mod, L] = await Promise.all([
    import(`./sorties/${file}.js`),
    import("./sorties/lines.js"),
  ]);
  const s = mod.default;
  return { id, meta: s, spec: loadMission(s.spec), lines: L.LINES || L.default || {} };
}
