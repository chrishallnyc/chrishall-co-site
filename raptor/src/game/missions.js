// Mission specs + loader (phase 11 INC-1). The MissionSpec is the single
// door between the meta world (briefings, campaign persistence) and the sim
// world (the Script system): plain data, fixed field order per
// CAMPAIGN-DESIGN.md Part A §2. specHash() pins the exact sortie definition
// for the replay header and the campaign log.
//
// INC-1 STAND-IN (the INC-2 upgrade point): battlefield.js has no tag/side
// columns yet, so destroy_tag objectives reference explicit battlefield
// indices (`bfIdx` = row order in battlefield.js FRONTS) instead of a `tag`.
// INC-2 adds the tag column + spawnGroup; specs then swap bfIdx -> tag with
// no Script change (Script already treats the list as opaque unit indices).
//
// `units`/`paths`/`bandits` are declared per §2 but must be EMPTY in INC-1 —
// missions run against the battlefield's own standing placements. The loader
// rejects non-empty ones (units/paths need INC-2 spawnGroup; bandits INC-4).

// Trigger vocabulary — numeric kinds (ids-not-strings doctrine: sim state
// carries no text). INC-1 ships 4 triggers toward the design's closed
// 6-trigger vocabulary (§3: t, zone, objDone/objFailed, groupDead,
// playerHpBelow, aceState): ON_START is `t:0` sugar, ON_TIME covers `t`,
// ON_OBJECTIVE_DONE/FAILED cover objDone/objFailed. Zone-enter as a bare
// trigger + groupDead land with INC-2 (tags), playerHpBelow with the HUD
// pass, aceState with INC-6.
export const TRIG = { ON_START: 0, ON_OBJECTIVE_DONE: 1, ON_TIME: 2, ON_OBJECTIVE_FAILED: 3 };

// Objective kinds, §2 table order. INC-1 implements destroy_tag / reach_zone
// / survive_until; protect_tag (ESCORT, INC-4) and kill_ace (INC-6) are
// validate-rejected until their increments land.
export const OBJ_KIND = { destroy_tag: 0, protect_tag: 1, reach_zone: 2, survive_until: 3, kill_ace: 4 };
const INC1_KINDS = new Set(["destroy_tag", "reach_zone", "survive_until"]);

// numeric lineId -> subtitle text. RENDER-SIDE ONLY — the Script's comms ring
// stores ids; the HUD looks text up here; phase 13 bakes VO onto the same
// ids. Allocation: 100-109 nellis-strike-01, 110-119 nellis-sead-01; within
// a block: x0 briefing, x1 ingress flavor, x2 tally call, x3 victory,
// x4 timeout. (AMENDMENT 8 comms floor: every mission carries ingress flavor
// + objective calls — no dead air.)
export const COMMS_LINES = {
  100: "OVERLORD: Raptor 1-1, four-truck convoy on the eastern basin road. Kill every vehicle — the line moves tonight.",
  101: "OVERLORD: Ingress looks clean. ZSU escort is dug in near the road — respect the tracers.",
  102: "RAPTOR 1-1: Tally convoy. Four movers on the road, rolling in.",
  103: "OVERLORD: Convoy destroyed — that cargo is nobody's problem now. Outstanding, Raptor 1-1. RTB when ready.",
  104: "OVERLORD: Out of time — the convoy's through the pass. Abort and return to base.",
  110: "OVERLORD: Raptor 1-1, SA-8 site on the flat south of the convoy road — one radar, two TELs. Put the site down.",
  111: "OVERLORD: They will launch the moment you cross six klicks. Keep your energy up and break late.",
  112: "RAPTOR 1-1: Contact — dish and launchers on the flat. Engaging.",
  113: "OVERLORD: Site's down and blind. Magnum work, Raptor 1-1 — RTB when ready.",
  114: "OVERLORD: Negative effect — the site is still radiating and we're out of time. RTB.",
};

// Two authored specs on the CURRENT NELLIS standing placements
// (battlefield.js FRONTS.NELLIS row order — all rows spawn alive at boot):
//   0-3 supply_truck (eastern basin convoy)   4,5 zsu (escort)
//   6 sam_radar  7,8 sam_tel (SAM site)       9-11 western depot pair + zsu
export const BUILTIN = {
  // STRIKE: kill the eastern basin convoy (trucks 0-3; the ZSU escort at
  // 4/5 defends but is not an objective).
  "nellis-strike-01": {
    v: 1, kind: "authored",
    front: "NELLIS",
    type: "strike",
    seed: 0x57c1ce,
    todH: 15.5, weatherIdx: 0,
    playerSpawn: { x: 0, y: -6000, alt: 3600, headingDeg: -40, speed: 220 },
    airfield: { x: -3000, y: -8700, r: 900 },   // the probed NELLIS pad (match.js D-061)
    units: [],                                   // INC-1: standing battlefield only
    paths: {},
    bandits: [],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 2500, y: -8100, r: 2500 } },   // eyes on the convoy
      { id: 2, kind: "destroy_tag", bfIdx: [0, 1, 2, 3], need: 4 },          // kill all four trucks
    ],
    winWhen: [2], loseWhen: [],
    timeLimitS: 600,
    comms: [
      { on: TRIG.ON_START, lineId: 100 },
      { on: TRIG.ON_TIME, t: 20, lineId: 101 },              // ingress flavor
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 102 },   // tally call
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 103 },   // victory
      { on: TRIG.ON_TIME, t: 600, lineId: 104 },             // fires as the clock expires
    ],
    scoreKm: 2.0,
  },

  // SEAD: kill the SAM site — radar 6 + TELs 7/8 (radar-gates-TEL lands with
  // AMENDMENT 6; for INC-1 the win is the whole site dead).
  "nellis-sead-01": {
    v: 1, kind: "authored",
    front: "NELLIS",
    type: "sead",
    seed: 0x5ead01,
    todH: 7.5, weatherIdx: 0,
    playerSpawn: { x: 0, y: -6000, alt: 3600, headingDeg: -42, speed: 220 },
    airfield: { x: -3000, y: -8700, r: 900 },
    units: [],
    paths: {},
    bandits: [],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 4200, y: -9800, r: 3000 } },   // inside the site's envelope
      { id: 2, kind: "destroy_tag", bfIdx: [6, 7, 8], need: 3 },             // radar + both TELs
    ],
    winWhen: [2], loseWhen: [],
    timeLimitS: 600,
    comms: [
      { on: TRIG.ON_START, lineId: 110 },
      { on: TRIG.ON_TIME, t: 20, lineId: 111 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 112 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 113 },
      { on: TRIG.ON_TIME, t: 600, lineId: 114 },
    ],
    scoreKm: 2.0,
  },
};

// ---- loader ----

// canonical field order (§2) — serialization + validation both walk this
const SPEC_FIELDS = [
  "v", "kind", "front", "type", "seed", "todH", "weatherIdx", "playerSpawn",
  "airfield", "units", "paths", "bandits", "objectives", "winWhen",
  "loseWhen", "timeLimitS", "comms", "scoreKm",
];
const SPEC_KINDS = new Set(["quick", "operation", "authored"]);
const FRONT_NAMES = new Set(["NELLIS", "VALDEZ", "MARIANAS"]);
const MISSION_TYPES = new Set(["strike", "sead", "anti_ship", "convoy", "intercept", "escort", "fleet_defense", "cap"]);
const MAX_OBJECTIVES = 16;   // Script.objState capacity
const MAX_COMMS = 32;        // Script.trigFired capacity (one flag per row)

const bad = (msg) => { throw new Error("missions: " + msg); };
const num = (v) => typeof v === "number" && Number.isFinite(v);

function validate(spec) {
  if (!spec || typeof spec !== "object") bad("spec is not an object");
  for (const f of SPEC_FIELDS) if (spec[f] === undefined) bad(`missing field "${f}"`);
  if (spec.v !== 1) bad(`unknown spec version ${spec.v}`);
  if (!SPEC_KINDS.has(spec.kind)) bad(`unknown kind "${spec.kind}"`);
  if (!FRONT_NAMES.has(spec.front)) bad(`unknown front "${spec.front}"`);
  if (!MISSION_TYPES.has(spec.type)) bad(`unknown type "${spec.type}"`);
  if (!num(spec.seed) || !num(spec.todH) || !num(spec.weatherIdx)) bad("seed/todH/weatherIdx must be numbers");
  if (!num(spec.timeLimitS) || spec.timeLimitS <= 0) bad("timeLimitS must be > 0");
  if (!num(spec.scoreKm)) bad("scoreKm must be a number");
  const ps = spec.playerSpawn;
  if (!ps || !num(ps.x) || !num(ps.y) || !num(ps.alt) || !num(ps.headingDeg) || !num(ps.speed)) bad("playerSpawn needs numeric {x,y,alt,headingDeg,speed}");
  const af = spec.airfield;
  if (!af || !num(af.x) || !num(af.y) || !num(af.r)) bad("airfield needs numeric {x,y,r}");
  // INC-1: standing battlefield only (see header)
  if (!Array.isArray(spec.units) || spec.units.length) bad("INC-1: units must be [] (spawnGroup lands in INC-2)");
  if (!spec.paths || typeof spec.paths !== "object" || Object.keys(spec.paths).length) bad("INC-1: paths must be {} (convoy drive lands in INC-2)");
  if (!Array.isArray(spec.bandits) || spec.bandits.length) bad("INC-1: bandits must be [] (air lands in INC-4)");

  if (!Array.isArray(spec.objectives) || !spec.objectives.length) bad("objectives must be a non-empty array");
  if (spec.objectives.length > MAX_OBJECTIVES) bad(`more than ${MAX_OBJECTIVES} objectives`);
  const ids = new Set();
  for (const o of spec.objectives) {
    if (!o || !num(o.id)) bad("objective needs a numeric id");
    if (ids.has(o.id)) bad(`duplicate objective id ${o.id}`);
    ids.add(o.id);
    if (OBJ_KIND[o.kind] === undefined) bad(`objective ${o.id}: unknown kind "${o.kind}"`);
    if (!INC1_KINDS.has(o.kind)) bad(`objective ${o.id}: kind "${o.kind}" is not in INC-1 (protect_tag: INC-4, kill_ace: INC-6)`);
    if (o.kind === "destroy_tag") {
      if (!Array.isArray(o.bfIdx) || !o.bfIdx.length || !o.bfIdx.every(num)) bad(`objective ${o.id}: destroy_tag needs a non-empty numeric bfIdx list (INC-1 tag stand-in)`);
      if (!num(o.need) || o.need < 1 || o.need > o.bfIdx.length) bad(`objective ${o.id}: need must be 1..bfIdx.length`);
    } else if (o.kind === "reach_zone") {
      const z = o.zone;
      if (!z || !num(z.x) || !num(z.y) || !num(z.r) || z.r <= 0) bad(`objective ${o.id}: reach_zone needs zone {x,y,r>0}`);
      if (z.aglMax !== undefined && !num(z.aglMax)) bad(`objective ${o.id}: aglMax must be a number`);
    } else if (o.kind === "survive_until") {
      if (!num(o.t) || o.t < 0) bad(`objective ${o.id}: survive_until needs t >= 0`);
    }
  }
  if (!Array.isArray(spec.winWhen) || !spec.winWhen.length) bad("winWhen must be a non-empty array of objective ids");
  if (!Array.isArray(spec.loseWhen)) bad("loseWhen must be an array");
  for (const id of spec.winWhen.concat(spec.loseWhen)) if (!ids.has(id)) bad(`winWhen/loseWhen references unknown objective ${id}`);

  if (!Array.isArray(spec.comms)) bad("comms must be an array");
  if (spec.comms.length > MAX_COMMS) bad(`more than ${MAX_COMMS} comms rows`);
  for (const c of spec.comms) {
    if (!c || !num(c.on) || c.on < 0 || c.on > 3) bad("comms row needs on in 0..3 (TRIG)");
    if (!num(c.lineId)) bad("comms row needs a numeric lineId");
    if (c.on === TRIG.ON_TIME && (!num(c.t) || c.t < 0)) bad("ON_TIME comms row needs t >= 0");
    if ((c.on === TRIG.ON_OBJECTIVE_DONE || c.on === TRIG.ON_OBJECTIVE_FAILED) && !ids.has(c.obj)) bad(`comms row references unknown objective ${c.obj}`);
  }
  return spec;
}

// name (BUILTIN key) or a raw spec object -> validated spec; throws on
// unknown name / missing or malformed fields.
export function loadMission(nameOrSpec) {
  if (typeof nameOrSpec === "string") {
    const spec = BUILTIN[nameOrSpec];
    if (!spec) bad(`unknown mission "${nameOrSpec}"`);
    return validate(spec);
  }
  return validate(nameOrSpec);
}

// FNV-1a uint32 over a canonical serialization: top level walks SPEC_FIELDS
// in fixed order; nested objects serialize with sorted keys — same spec,
// same hash, forever (replay header + campaign log doctrine, §0/§2).
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

export function specHash(spec) {
  const s = SPEC_FIELDS.map((f) => f + "=" + canon(spec[f])).join(";");
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}
