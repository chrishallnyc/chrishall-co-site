// M03 "THE LAST LIGHTER" — evacuation denial at golden hour (phase 11
// INC-8 batch 1). Fantasy: Tinian is trying to leave — one lighter loading
// the strip's ordnance at the anchorage, a truck column crawling the pier
// road to feed her, and an alert pair held back over the northern water
// for exactly this raid. Nothing gets off the island. Uses the CONVOY
// grammar offensively (a DRIVING red column via paths) against a BOOT
// naval row — M01 already spent the front's ship reserve (slots 46/47),
// so the lighter is FRONTS row 2, not a spawn.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      421-423 — the lighter, the column, the alert pair
//   2 SPAWN      ON_START 421
//   3 INGRESS    spawn (-9000,-14000) -> run-in (2000,2500) ≈ 19.8 km
//                ≈ 90 s; 424 at t25
//   4 OBJ A      obj 2: the lighter (boot row 2, hp 80 — one 9X or a long
//                gun pass) under the strip's live umbrella (zsu 3.2 km +
//                radar-gated TEL 3.0 km)
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 425: the alert pair commits.
//                AMBUSH TIMING TRICK: two tier-2 ENGAGE fighters (tag 45)
//                spawn at START over the far northern water on ~74-76 km
//                weaves whose every pre-entry LEG holds >= 13.5 km from
//                the anchorage (measured per-leg — outside their 10 km
//                ENGAGE commit while you work the lighter); they enter an
//                11 km ring at ≈ 309/318 s — on the heels of a competent
//                lighter kill (~200-280 s) — then ride FOUR 40 km ring
//                laps (≈ 167 s each) out to ≈ 990/1000 s of total route
//                (D-073 route LAW: win-required + slow player still gets
//                the fight). ON_TIME t=275 backstop 429 announces the
//                descent un-gated, before entry.
//   6 CLIMAX     obj 4: beat the alert pair over the anchorage. obj 3
//                (the crawling column) is OPTIONAL LEDGER outside winWhen
//                — a sunk lighter strands the cargo either way, and the
//                victory line must anchor on the objective that lands
//                LAST on every path (the pair arrives at the turn; the
//                column can be finished before or after at will, 445
//                pays it).
//   7 RESOLUTION 426 victory / 427 timeout (offense strike; t=1200 clock
//                warning 447)
// ENVELOPE: median session ≈ 7-8 min (run-in ~90 s, lighter ~200-280 s,
// pair arrives ~310 s, fight + optional column ~380-470 s); THE TURN
// ≈ 50-55% of median.
//
// ROUTE LAW (D-073): the alert pair is engage-capable (they commit
// themselves whenever you are near the anchorage) AND their route loiters
// to ≈ 990-1000 s; the lighter is a boot row; the optional column resolves
// on the ground. No win-required objective can be stranded.
//
// GUARDRAILS (amendment 5): phase shooters — obj 2 (lighter): strip zsu
// (boot 3, 3.2 km) + radar-gated TEL (boot 7, 3.0 km) = 2; obj 3 (column,
// post-turn): the same 2 boot guns near the road + the committed pair
// = 4 (the NELLIS exactly-4 precedent, and every kill subtracts one);
// obj 4: pair only = 2. All <= 4. Bandits 2 <= 8; engage 2 <= 4. The
// column itself is unarmed (no escort zsu — the alert pair IS its escort).
//
// POOL/capacity (MARIANAS n=10): 4 supply_truck -> reserve slots
// 10,11,13,16 (of 16 reserve trucks); NO ships spawned (M01 consumed the
// front's cargo/destroyer reserve — audited). destroy bfIdx below IS the
// deterministic slot assignment.

import { TRIG } from "../../game/missions.js";

// n laps of the 7-10 km ring around the anchorage
const ringLaps = (n) => Array.from({ length: n },
  () => [[9000, 9000], [-3000, 9000], [-3000, 1000], [9000, 1000]]).flat();

export default {
  id: "M03",
  front: "MARIANAS",
  titleId: 420,
  briefingIds: [421, 422, 423],
  meta: { turnObj: 2, turnLineId: 425, victoryLineId: 426, defeatLineId: 427 },
  spec: {
    v: 1, kind: "authored",
    front: "MARIANAS",
    type: "strike",
    seed: 0x1a5713,
    todH: 17.8, weatherIdx: 0,
    playerSpawn: { x: -9000, y: -14000, alt: 3600, headingDeg: 56.3, speed: 220 },
    airfield: { x: -3200, y: -8000, r: 600 },
    // the pier column: four red movers (tag 13) crawling from the strip
    // down to the lighter at 8 m/s — ~6.5 km of road ≈ 815 s
    units: [
      ["supply_truck", 8200, 9800, -2.5, 0, 13],
      ["supply_truck", 8300, 9900, -2.5, 0, 13],
      ["supply_truck", 8400, 10000, -2.5, 0, 13],
      ["supply_truck", 8500, 10100, -2.5, 0, 13],
    ],
    paths: { 13: [[6500, 9200], [5200, 8300], [4200, 6800], [3600, 5600]] },
    bandits: [
      // the alert pair (tag 45): tier-2, explicit A3 opt-in, held over the
      // far northern water. Measured: 11 km ring entry at ≈ 76.2/74.2 km
      // ≈ 318/309 s; every pre-entry leg >= 13.5 km from the anchorage
      // (3000,5000); then FOUR 40 km ring laps (≈ 167 s each) out to
      // ≈ 1001/989 s of total route.
      { kind: "fighter", tier: 2, engage: true, tag: 45, side: 0,
        x: -4000, y: 27000, z: 4600, headingDeg: -4, speed: 250,
        wpts: [[10000, 26000], [-8000, 24000], [10000, 21000], [-8000, 19000],
          ...ringLaps(4)] },
      { kind: "fighter", tier: 2, engage: true, tag: 45, side: 0,
        x: 0, y: 28500, z: 5200, headingDeg: -4, speed: 250,
        wpts: [[11500, 27500], [-6500, 25500], [11500, 22500], [-6500, 20500],
          ...ringLaps(4)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 2000, y: 2500, r: 2500 } },    // the run-in over the water
      { id: 2, kind: "destroy_tag", bfIdx: [2], need: 1 },                   // the lighter (boot row)
      { id: 3, kind: "destroy_tag", bfIdx: [10, 11, 13, 16], need: 4 },      // OPTIONAL: the pier column (spawned slots)
      { id: 4, kind: "destroy_tag", air: true, tag: 45, need: 2 },           // the alert pair
    ],
    winWhen: [2, 4], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 421 },
      { on: TRIG.ON_TIME, t: 25, lineId: 424 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 428 },   // tally the pier
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 425 },   // THE TURN
      { on: TRIG.ON_TIME, t: 275, lineId: 429 },             // alert-pair backstop, un-gated (ring entry ≈ 309-318 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 445 },   // the column ledger
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 4, lineId: 426 },   // victory
      { on: TRIG.ON_TIME, t: 1200, lineId: 447 },            // 5-min clock warning
      { on: TRIG.ON_TIME, t: 1500, lineId: 427 },            // timeout defeat
    ],
    scoreKm: 2.5,
  },
};
