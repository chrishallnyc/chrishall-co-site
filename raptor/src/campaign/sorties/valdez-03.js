// V03 "BACKDRAFT" — deep strike, then the race home (phase 11 INC-8
// batch 1). Fantasy: OUT-AND-BACK — burn the shore depot 20 km up the
// Sound, and the moment it dies the other shoe drops: a drone raid is
// tracking for YOUR field and you are on the wrong side of the water.
// The 30 km map used lengthwise, twice.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      401-403 — the depot, the battery, the radio traffic
//   2 SPAWN      ON_START 401
//   3 INGRESS    spawn (0,-6000) -> run-in (11500,-22500) ≈ 20.1 km
//                ≈ 90 s; 404 at t25
//   4 OBJ A      obj 2: the depot pair (boot rows 2,3) under the east
//                shore battery's live umbrella (zsu 1.2 km, radar-gated
//                TEL 3.1 km — the spice of the strike)
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 405: raid warning RED. AMBUSH
//                TIMING TRICK: three tier-1 drones (tag 30) spawn at START
//                in the far NW on ~98.7 km dog-legs (fence ≈ 548 s, denial
//                ring ≈ 532 s, measured) — while you strike the depot they cross the
//                glacier line; the turn reveals a fence clock that was
//                always running. ON_TIME t=350 backstop 409 announces the
//                descent even if the depot run stalled (un-gated), and the
//                drones stay >= 20 km from the player's ingress track, so
//                the detection gate keeps the reveal genuine.
//   6 CLIMAX     obj 3: the race — 23.6 km home at supercruise against
//                drones ~40 km out at the turn on pace; arrive with
//                ~3 min of margin, spend it on three clean kills.
//   7 RESOLUTION 406 victory / 444 fence crossed (zone denial) / 407
//                timeout (offense strike; t=1200 clock warning 448)
// ENVELOPE: median session ≈ 7-8 min (run-in ~90 s, depot ~200-260 s,
// race home ~300 s, three kills ~380-470 s); THE TURN ≈ 50% of median.
//
// ROUTE LAW (D-073): the drone routes TERMINATE inside the fence denial
// zone — unopposed they end the sortie (loseWhen 4), so a win-required air
// objective can never be stranded by route exhaustion (the V02 fence
// grammar, re-aimed at an out-and-back).
//
// GUARDRAILS (amendment 5): the only shooters in V03 are the depot's own
// umbrella — zsu (boot 4, 1.2 km) + radar-gated TEL (boot 6, 3.1 km) = 2
// <= 4 at the depot phase; the drones are unarmed and NOTHING shoots
// during the race home. Bandits 3 <= 8; engage-capable 0.

import { TRIG } from "../../game/missions.js";

export default {
  id: "V03",
  front: "VALDEZ",
  titleId: 400,
  briefingIds: [401, 402, 403],
  meta: { turnObj: 2, turnLineId: 405, victoryLineId: 406, defeatLineId: 407 },
  spec: {
    v: 1, kind: "authored",
    front: "VALDEZ",
    type: "strike",
    seed: 0x0bacd3,
    todH: 15.5, weatherIdx: 0,
    playerSpawn: { x: 0, y: -6000, alt: 3600, headingDeg: -53.5, speed: 220 },
    airfield: { x: 0, y: -6000, r: 600 },
    units: [],
    paths: {},
    bandits: [
      // the raid (tag 30): three drones, far NW at START, length-tuned so
      // the fence arrives ~9 min unopposed. Measured cum walks at 180 m/s:
      //   d1 15.2/28.0/42.2/56.3/68.5/81.3/91.5/98.7 km -> fence ≈ 548 s
      //   d2 ≈ 98.8 km -> ≈ 549 s · d3 ≈ 98.7 km -> ≈ 549 s
      // (the denial ring r 3000 trips at ≈ 95.7 km ≈ 532 s, all three)
      { kind: "drone", tier: 1, x: -26000, y: 28000, z: 3400, headingDeg: -25, speed: 180, tag: 30, side: 0,
        wpts: [[-12000, 22000], [-22000, 14000], [-8000, 16000], [-18000, 6000], [-6000, 8000], [-14000, -2000], [-4000, 0], [0, -6000]] },
      { kind: "drone", tier: 1, x: -27500, y: 26000, z: 3700, headingDeg: -25, speed: 180, tag: 30, side: 0,
        wpts: [[-13500, 20500], [-23500, 12500], [-9500, 14500], [-19500, 4500], [-7500, 6500], [-15500, -3500], [-5000, -1200], [0, -6000]] },
      { kind: "drone", tier: 1, x: -24500, y: 29500, z: 3100, headingDeg: -25, speed: 180, tag: 30, side: 0,
        wpts: [[-10500, 23500], [-20500, 15500], [-6500, 17500], [-16500, 7500], [-4500, 9500], [-12500, -500], [-3000, 1200], [0, -6000]] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 11500, y: -22500, r: 2500 } },  // the run-in point
      { id: 2, kind: "destroy_tag", bfIdx: [2, 3], need: 2 },                 // the depot pair (boot rows)
      { id: 3, kind: "destroy_tag", air: true, tag: 30, need: 3 },            // the raid
      { id: 4, kind: "protect_tag", air: true, tag: 30, zone: { x: 0, y: -6000, r: 3000 } }, // fence denial
    ],
    winWhen: [2, 3], loseWhen: [4],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 401 },
      { on: TRIG.ON_TIME, t: 25, lineId: 404 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 408 },   // tally the depot
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 405 },   // THE TURN
      { on: TRIG.ON_TIME, t: 350, lineId: 409 },             // raid backstop, un-gated
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 406 },   // victory
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 4, lineId: 444 }, // over the fence
      { on: TRIG.ON_TIME, t: 1200, lineId: 448 },            // 5-min clock warning
      { on: TRIG.ON_TIME, t: 1500, lineId: 407 },            // timeout defeat
    ],
    scoreKm: 2.0,
  },
};
