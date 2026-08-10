// Authored campaign (phase-11 INC-7): the scripted set-piece chain —
// COMPLETE at 30 sorties (10 per front) as of INC-8 batch 4 (the finale
// trio closes each front; TYPHOON flies in M10 and nowhere else). Sortie
// MODULES (spec + lineIds) live in ./sorties/ and are the content agent's
// lane; this file is the registry, the unlock chain, and the
// raptor.auth.v1 save. Meta-world: strings and localStorage are fine
// here — the sim only ever sees the validated MissionSpec.

import { loadMission } from "../game/missions.js";

export const CAMPAIGN = [
  { id: "N01", front: "NELLIS" },
  { id: "N02", front: "NELLIS" },
  { id: "V01", front: "VALDEZ" },
  { id: "V02", front: "VALDEZ" },
  { id: "M01", front: "MARIANAS" },
  { id: "M02", front: "MARIANAS" },
  // INC-8 batch 1 (D-073 NEXT): the second circuit of the fronts
  { id: "N03", front: "NELLIS" },
  { id: "N04", front: "NELLIS" },
  { id: "V03", front: "VALDEZ" },
  { id: "V04", front: "VALDEZ" },
  { id: "M03", front: "MARIANAS" },
  { id: "M04", front: "MARIANAS" },
  // INC-8 batch 2 (D-074 NEXT): the escalation circuit — the middle third
  { id: "N05", front: "NELLIS" },
  { id: "N06", front: "NELLIS" },
  { id: "V05", front: "VALDEZ" },
  { id: "V06", front: "VALDEZ" },
  { id: "M05", front: "MARIANAS" },
  { id: "M06", front: "MARIANAS" },
  // INC-8 batch 3 (D-076 NEXT): the tightening third — the enemy desperate
  { id: "N07", front: "NELLIS" },
  { id: "N08", front: "NELLIS" },
  { id: "V07", front: "VALDEZ" },
  { id: "V08", front: "VALDEZ" },
  { id: "M07", front: "MARIANAS" },
  { id: "M08", front: "MARIANAS" },
  // INC-8 batch 4 (D-078 NEXT): THE FINALE — the last pushes (25-27) and
  // the front-closing trio (28-30; fiction reads frontKm >= +14, the
  // unlock stays linear; TYPHOON unsealed in M10 only)
  { id: "N09", front: "NELLIS" },
  { id: "N10", front: "NELLIS" },
  { id: "V09", front: "VALDEZ" },
  { id: "V10", front: "VALDEZ" },
  { id: "M09", front: "MARIANAS" },
  { id: "M10", front: "MARIANAS" },
];

const FILE = {
  N01: "nellis-01", N02: "nellis-02", V01: "valdez-01", V02: "valdez-02", M01: "marianas-01", M02: "marianas-02",
  N03: "nellis-03", N04: "nellis-04", V03: "valdez-03", V04: "valdez-04", M03: "marianas-03", M04: "marianas-04",
  N05: "nellis-05", N06: "nellis-06", V05: "valdez-05", V06: "valdez-06", M05: "marianas-05", M06: "marianas-06",
  N07: "nellis-07", N08: "nellis-08", V07: "valdez-07", V08: "valdez-08", M07: "marianas-07", M08: "marianas-08",
  N09: "nellis-09", N10: "nellis-10", V09: "valdez-09", V10: "valdez-10", M09: "marianas-09", M10: "marianas-10",
};
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
