// Campaign engine (phase 11 INC-3): the persistent dynamic operation.
// CAMPAIGN-DESIGN.md Part A §2 (generator) + §4 (front-line axis,
// localStorage persistence). This is the META WORLD — it touches the sim
// through exactly one door (the MissionSpec out of genMission) and hears
// back through exactly one door (the SortieResult into reduceCampaign).
// The sim never reads the save; the save never holds sim state.
//
// Purity doctrine (design §0 consequence 2): genMission(save) and
// reduceCampaign(save, spec, result) are PURE — no Date, no Math.random,
// no localStorage inside them. All generator randomness comes from a local
// SfcRng seeded fnv(save.seed, save.sortieIndex, round(frontKm*2)) — the
// quantized frontKm means float drift can never fork the chain. Same seed
// + same outcomes => same war, replayable headless in Node (t22).
//
// PRNG: SfcRng imported from engine/rng.js (already exported there —
// sim.js is NOT touched; its own import comes from the same module, so the
// generator draws the exact sequence the sim would).
//
// INC-3 SCOPE CUT: the generator emits STRIKE / SEAD / ANTI-SHIP only, all
// against STANDING boot placements via bfIdx groups (units/paths/bandits
// stay empty — the INC-1 loader contract). CONVOY + spawned-unit missions
// join in INC-4 when the tag column replaces bfIdx in specs. ANTI-SHIP only
// exists on fronts whose FRONTS tables have hulls (VALDEZ, MARIANAS).

import { SfcRng } from "../engine/rng.js";
import { TRIG, specHash } from "../game/missions.js";
import { ZONES, SHOOTERS, FRONT_PRESETS } from "./zones.js";

const SAVE_PREFIX = "raptor.op.v1:"; // + front (one campaign per front, §4)
const CORRUPT_KEY = "raptor.op.corrupt";
const DEFAULT_SEED = 0x7a3f19b2; // §4's example seed — fixed default so hangar-created campaigns are reproducible
const WIN_KM = 16, LOSE_KM = -16; // §4: frontKm ∈ [−16,+16]; ±16 ends the operation (≈8–16 sorties)
const LOG_CAP = 64;               // §4: log capped 64, newest last
const TIME_LIMIT_S = 1500;        // amendment 4: generator lose-timer default
const MAX_SHOOTERS = 4;           // amendment 5: <= 4 simultaneous shooters
const SHOOTER_R = 5000;           // "within ~5 km of zoneCenter"
const INGRESS_R = 2500;           // reach_zone radius (INC-1 authored-spec scale)
// §4 type weights: STRIKE/SEAD 2.0, ANTI-SHIP 2.5 (front-line swing per sortie)
const SCORE_KM = { strike: 2.0, sead: 2.0, anti_ship: 2.5, intercept: 2.0, cap: 2.0 };
const AFFORD_TYPE = { strike: "strike", sead: "sead", antiship: "anti_ship" };

// Amendment-8 comms floor for generated ops: a per-type table so Operation
// sorties are never dead air. RENDER-SIDE TEXT ONLY — specs carry the ids;
// the orchestrator's HUD merges OP_LINES over missions.js COMMS_LINES
// (ids 200+ so the blocks never collide; within a block: x0 briefing,
// x1 ingress flavor, x2 tally call, x3 victory, x4 timeout — the
// COMMS_LINES allocation convention).
export const OP_LINES = {
  200: "OVERLORD: Raptor 1-1, enemy supply group dug in ahead of the line. Kill every vehicle on the plot — the front moves tonight.",
  201: "OVERLORD: Picture is clean to the ingress point. Gun cover is dug in around the target — respect the tracers.",
  202: "RAPTOR 1-1: Overhead the ingress point. Targets ahead — rolling in.",
  203: "OVERLORD: Target group destroyed — the line is moving. Outstanding, Raptor 1-1. RTB when ready.",
  204: "OVERLORD: Out of time — pull off the target and get home. We pay for this one on the map.",
  210: "OVERLORD: Raptor 1-1, SAM site radiating ahead of the line — radar and launchers on the plot. Put the site down.",
  211: "OVERLORD: They will launch the moment you cross into the envelope. Keep your energy up and break late.",
  212: "RAPTOR 1-1: Contact — dish and launchers ahead. Engaging.",
  213: "OVERLORD: Site is down and blind. Magnum work, Raptor 1-1 — RTB when ready.",
  214: "OVERLORD: Negative effect — the site is still radiating and we are out of time. RTB.",
  220: "OVERLORD: Raptor 1-1, enemy hulls holding station ahead of the line. Send every one of them to the bottom.",
  221: "OVERLORD: Big hulls soak fire — plan on multiple passes and use the pad to rearm.",
  222: "RAPTOR 1-1: Tally hulls on the water. Beginning my run.",
  223: "OVERLORD: Scratch the group — they are going under. Outstanding, Raptor 1-1. RTB when ready.",
  224: "OVERLORD: The hulls are still afloat and we are out of time. Break off and RTB.",
  230: "OVERLORD: Raptor 1-1, POP-UP GROUP — drone raid inbound to your field from up the axis. Splash every airframe before the fence.",
  231: "OVERLORD: raid tracking steady. Arm hot, burn north.",
  232: "OVERLORD: merge plot. Guns and Foxes free.",
  233: "OVERLORD: raid destroyed. Field secure — the line holds tonight.",
  234: "OVERLORD: too slow — they're over the fence. RTB.",
  240: "OVERLORD: Raptor 1-1, hostile sweep over the range. Clear the air and come home.",
  241: "OVERLORD: bandits hold their sweep line. They haven't seen you yet.",
  242: "OVERLORD: tally the merge.",
  243: "OVERLORD: picture clean. The sky is yours, Raptor.",
  244: "OVERLORD: sweep expired and they know the range now. Tomorrow costs more.",
};
const OP_COMMS = {
  strike: [200, 201, 202, 203, 204],
  sead: [210, 211, 212, 213, 214],
  anti_ship: [220, 221, 222, 223, 224],
  intercept: [230, 231, 232, 233, 234],
  cap: [240, 241, 242, 243, 244],
};

// ---- seed mixing + save integrity ----

// FNV-1a over the little-endian bytes of three int32s — the §2 generator
// seed: fnv(campaignSeed, sortieIndex, round(frontKm*2)).
function fnvMix(a, b, c) {
  let h = 0x811c9dc5 >>> 0;
  for (const n of [a | 0, b | 0, c | 0]) {
    for (let s = 0; s < 32; s += 8) h = Math.imul(h ^ ((n >>> s) & 0xff), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// canonical serialization (missions.js specHash pattern): fixed top-level
// field order, sorted keys below — same save, same sum, forever.
const SAVE_FIELDS = ["v", "front", "seed", "sortieIndex", "frontKm", "status", "log", "nemesisId"];
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
function computeSum(save) {
  const s = SAVE_FIELDS.map((f) => f + "=" + canon(save[f])).join(";");
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ---- the save (schema per design §4, key "raptor.op.v1:"+front) ----

export function freshSave(front, seed = DEFAULT_SEED) {
  if (!ZONES[front]) throw new Error("engine: unknown front " + front);
  const save = {
    v: 1, front, seed: seed >>> 0,
    sortieIndex: 0,        // completed sorties — generator input
    frontKm: 0,            // 1-D front-line axis, + = pushing into enemy ground
    status: "live",        // "live" | "won" | "lost"
    log: [],               // [{specHash, result, simHash?}], capped 64
    nemesisId: -1,         // reserved for INC-6 (aces)
  };
  save.sum = computeSum(save);
  return save;
}

// ---- amendment-5 guardrail ----

// Boot-state shooters (zsu / sam_tel rows mirrored from FRONTS into
// zones.js SHOOTERS) within ~5 km of the zone's center. Every boot row
// spawns alive, so at generation time placed == alive; the generator only
// ever sees the pre-sortie world.
export function shooterCount(front, zone) {
  const list = SHOOTERS[front] || [];
  let c = 0;
  for (const s of list) {
    if (Math.hypot(s.x - zone.zoneCenter.x, s.y - zone.zoneCenter.y) <= SHOOTER_R) c++;
  }
  return c;
}

// ---- the generator (§2) — PURE function of the save ----

// Shared core: summarize() needs the chosen zone's name (meta-only — the
// spec itself carries no strings beyond enum-checked kind/front/type).
function gen(save) {
  const zones = ZONES[save.front];
  const preset = FRONT_PRESETS[save.front];
  if (!zones || !preset) throw new Error("engine: unknown front " + save.front);
  const rng = new SfcRng(fnvMix(save.seed, save.sortieIndex, Math.round(save.frontKm * 2)));

  // zone: nearest enemy-held zone ahead of the line (tables are axis-
  // sorted). Past the deepest zone the final push repeats it (frontKm caps
  // at WIN_KM, so this only spans the closing sorties).
  const ahead = zones.filter((z) => z.axisKm > save.frontKm);
  const cands = ahead.length ? ahead : [zones[zones.length - 1]];
  // guardrail (amendment 5): skip zones with > 4 boot shooters in range; if
  // every candidate is over-defended, take the least defended and trim the
  // objective's need to 1 (a partial strike — get in, kill one, get out).
  // Current tables max out at exactly 4 (NELLIS), so the trim branch is a
  // future-table safety net; t22 asserts the invariant on every spec.
  let zone = cands.find((z) => shooterCount(save.front, z) <= MAX_SHOOTERS);
  let need;
  if (zone) need = zone.bfIdx.length;
  else {
    zone = cands.reduce((a, b) => (shooterCount(save.front, b) < shooterCount(save.front, a) ? b : a));
    need = 1;
  }

  // fixed draw order (zone choice above is draw-free): type, tod, seed,
  // then the INC-5 air draws — ALWAYS drawn so the stream never forks on
  // the branch (quantized-seed doctrine, D-069)
  let type = AFFORD_TYPE[zone.affords[rng.int(zone.affords.length)]];
  const todH = preset.tods[rng.int(preset.tods.length)];
  const sortieSeed = rng.u32();
  const airP = Math.min(0.15 + 0.05 * save.sortieIndex, 0.6); // §2 bandit-presence curve
  const airRoll = rng.f();
  const airKindDraw = rng.int(2);          // 0 intercept, 1 cap
  const airCountDraw = 2 + rng.int(2);     // 2-3 airframes (guardrail headroom)
  const isAir = airRoll < airP;
  // tier from front-line pressure — deterministic, no draw
  const airTier = Math.max(1, Math.min(4, 1 + Math.round(save.frontKm / 6) + (save.sortieIndex >= 12 ? 1 : 0)));

  const sp = preset.spawn, zc = zone.zoneCenter;
  const dx = zc.x - sp.x, dy = zc.y - sp.y, d = Math.hypot(dx, dy) || 1;
  // FM heading convention: 0 = east (+x ENU), positive toward north
  const headingDeg = Math.round(Math.atan2(dy, dx) * 180 / Math.PI * 10) / 10;
  // ingress waypoint: on the spawn->target line, short of the target — the
  // reach_zone leg that makes beat 3 (INGRESS) a navigation act, then the
  // tally call fires as you cross it (no dead air, amendment 8)
  const back = Math.min(3500, d * 0.4);
  const ingress = { x: Math.round(zc.x - (dx / d) * back), y: Math.round(zc.y - (dy / d) * back), r: INGRESS_R };
  const L = OP_COMMS[type];

  const spec = {
    v: 1, kind: "operation",
    front: save.front,
    type,
    seed: sortieSeed,
    todH, weatherIdx: preset.weatherIdx,
    playerSpawn: { x: sp.x, y: sp.y, alt: sp.alt, headingDeg, speed: sp.speed },
    airfield: { x: preset.airfield.x, y: preset.airfield.y, r: preset.airfield.r },
    units: [], paths: {}, bandits: [], // INC-3 scope cut: standing placements only
    objectives: [
      { id: 1, kind: "reach_zone", zone: ingress },
      { id: 2, kind: "destroy_tag", bfIdx: zone.bfIdx.slice(), need },
    ],
    winWhen: [2], loseWhen: [],
    timeLimitS: TIME_LIMIT_S,
    comms: [
      { on: TRIG.ON_START, lineId: L[0] },                  // briefing
      { on: TRIG.ON_TIME, t: 20, lineId: L[1] },            // ingress flavor (first event <= 90 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: L[2] }, // tally at the ingress point
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: L[3] }, // victory
      { on: TRIG.ON_TIME, t: TIME_LIMIT_S, lineId: L[4] },  // timeout/defeat
    ],
    scoreKm: SCORE_KM[type],
  };

  // INC-5: air sortie override — the ground mission yields to the air war.
  // Intercept: a raid runs down the axis at the blue airfield (denial zone).
  // Cap: a fighter sweep holds mid-range waypoints until killed.
  if (isAir) {
    type = airKindDraw === 0 ? "intercept" : "cap";
    const af = spec.airfield;
    const bandits = [];
    if (type === "intercept") {
      for (let i = 0; i < airCountDraw; i++) {
        const off = (i - (airCountDraw - 1) / 2) * 2400;
        bandits.push({ kind: "drone", tier: Math.max(1, airTier - 1), x: af.x + off + 4000, y: af.y + 21000, z: 3000 + i * 300,
          headingDeg: -90, speed: 180, tag: 5, side: 0, wpts: [[af.x + off * 0.3, af.y]] });
      }
      spec.objectives = [
        { id: 1, kind: "destroy_tag", air: true, tag: 5, need: airCountDraw },
        { id: 2, kind: "protect_tag", air: true, tag: 5, zone: { x: af.x, y: af.y, r: 3000 } },
      ];
      spec.winWhen = [1]; spec.loseWhen = [2];
    } else {
      for (let i = 0; i < airCountDraw; i++) {
        const off = i * 2600;
        bandits.push({ kind: "fighter", tier: airTier, x: zc.x + off, y: zc.y + 12000, z: 3800 + i * 400,
          headingDeg: -90, speed: 240, tag: 6, side: 0, engage: true, // A3 opt-in (D-071)
          wpts: [[zc.x + off, zc.y - 9000], [zc.x + off - 7000, zc.y - 9000], [zc.x + off - 7000, zc.y + 12000]] });
      }
      spec.objectives = [{ id: 1, kind: "destroy_tag", air: true, tag: 6, need: airCountDraw }];
      spec.winWhen = [1]; spec.loseWhen = [];
    }
    const AL = OP_COMMS[type];
    spec.type = type;
    spec.bandits = bandits;
    spec.comms = [
      { on: TRIG.ON_START, lineId: AL[0] },
      { on: TRIG.ON_TIME, t: 20, lineId: AL[1] },
      { on: TRIG.ON_TIME, t: 60, lineId: AL[2] },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: AL[3] },
      { on: type === "intercept" ? TRIG.ON_OBJECTIVE_FAILED : TRIG.ON_TIME, ...(type === "intercept" ? { obj: 2 } : { t: TIME_LIMIT_S }), lineId: AL[4] },
    ];
    spec.scoreKm = SCORE_KM[type];
  }
  return { spec, zone };
}

export function genMission(save) { return gen(save).spec; }

// ---- the reducer (§4) — PURE fold of one sortie result into the save ----

// result = { over: 1|-1, blueLeft, redLeft, simHash? } (simHash optional —
// the free longitudinal determinism audit trail when the caller has it).
export function reduceCampaign(save, spec, result) {
  const delta = result.over === 1 ? spec.scoreKm : -spec.scoreKm;
  const frontKm = Math.max(LOSE_KM, Math.min(WIN_KM, save.frontKm + delta));
  const entry = { specHash: specHash(spec), result: result.over };
  if (result.simHash !== undefined) entry.simHash = result.simHash;
  const next = {
    v: 1, front: save.front, seed: save.seed,
    sortieIndex: save.sortieIndex + 1,
    frontKm,
    // won/lost latch (the operation is decided); otherwise §4 thresholds
    status: save.status !== "live" ? save.status
      : frontKm >= WIN_KM ? "won" : frontKm <= LOSE_KM ? "lost" : "live",
    log: save.log.concat([entry]).slice(-LOG_CAP),
    nemesisId: save.nemesisId,
  };
  next.sum = computeSum(next);
  return next;
}

// ---- persistence (browser-side; the only impure edge of this module) ----

// Corrupted / unknown / sum-mismatched blobs are archived under
// raptor.op.corrupt and replaced by a fresh campaign — never crash, never
// silently trust corruption (§4, t22 gate). `seed` only applies to fresh
// creation (deterministic tests).
export function loadSave(front, seed = DEFAULT_SEED) {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_PREFIX + front); } catch (_) { return freshSave(front, seed); }
  if (raw === null || raw === undefined) return freshSave(front, seed);
  let save = null;
  try { save = JSON.parse(raw); } catch (_) { save = null; }
  const good = save && typeof save === "object" && save.v === 1 && save.front === front &&
    Array.isArray(save.log) && typeof save.sum === "string" && computeSum(save) === save.sum;
  if (good) return save;
  try {
    localStorage.setItem(CORRUPT_KEY, raw);
    localStorage.removeItem(SAVE_PREFIX + front);
  } catch (_) {}
  return freshSave(front, seed);
}

// Written exactly once per sortie, meta-side, after match.over sticks
// (main.js owns the moment). The sim NEVER reads this back mid-sortie.
export function saveSave(save) {
  localStorage.setItem(SAVE_PREFIX + save.front, JSON.stringify(save));
}

// ---- hangar card feed ----

// The operation card's one-line tease: where the war stands and what the
// generator will hand you next (calls the pure generator — cheap, no I/O).
export function summarize(save) {
  const g = gen(save);
  return {
    front: save.front,
    frontKm: save.frontKm,
    sortieIndex: save.sortieIndex,
    status: save.status,
    nextType: g.spec.type,
    nextZoneName: g.zone.name,
  };
}
