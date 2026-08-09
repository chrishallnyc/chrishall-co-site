// M08 "TWO DOORS" — the two-axis breakout with REAL escape lose-states
// (phase 11 INC-8 batch 3, brief item c — the batch-2 chase critique
// answered IN THE DESIGN, not retrofitted). Fantasy: the eye is gone and
// the theater is running — four heavies off the north field in two pairs,
// two lanes: west for the open strait, south down the island line, a
// tier-3 gun welded over each lane. Where M05's ground scatter could only
// park (trucks have no escape mechanic), M08's chase grammar is complete:
// each stream's route TERMINATES inside its own door zone, so anything you
// don't kill actually ESCAPES and you actually LOSE. The M05-banked HUD
// split ships here as designed-in grammar: two need-2 destroy objectives,
// one per lane, so the HUD mirrors the two axes (the now-ALLOWED batch-3
// pattern).
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      581-583 — the runners, the two doors, the arithmetic
//   2 SPAWN      ON_START 581
//   3 INGRESS    spawn (-3200,-8000) -> datum (7000,2000) ≈ 14.3 km,
//                r2500 ≈ 55-65 s; 584 at t25. At the datum the south pair
//                is inside the 18 km gate (13.7 km) and the west pair is
//                NOT (23 km) — 597 says exactly that out loud.
//   4/6 THE FORK obj 2 WEST (tag 70, need 2) + obj 3 SOUTH (tag 71,
//                need 2) — the split HUD. Two honest clocks, briefed to
//                the half-minute (582): west door (r3000 at (-24000,6000))
//                trips at ≈ 399/408 s, south door (r3000 at (2000,-26000))
//                at ≈ 459/468 s (measured). FEASIBILITY (both orders,
//                measured): canonical = west first (the short clock; kill
//                by ~250 s, cross ~30 km at supercruise, merge the south
//                lane ~310-340 s against a 459 s door); reverse = south
//                first by ~250 s, then the west merge ~320-350 s against
//                a 399 s door — tight and honest, either way around. 589
//                at t=150 tracks both lanes; un-gated 588 at t=295 is the
//                per-door clock (west 104-113 s, south 164-173 s —
//                arithmetic-true).
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 585, written order-safe ("half
//                their getaway just became salvage" is true whenever obj 2
//                completes, whatever became of obj 3).
//   7 RESOLUTION 586 victory (south-scoped + order-safe) / 587 either door
//                (shared lineId on both denial rows, axis-agnostic — the
//                V02/N05 pattern). NO t=1500 row: unopposed freight trips
//                a door by ≈ 408 s and dead freight IS the win — the clock
//                can never expire first (N05 precedent; type intercept =
//                defense timeout WOULD be victory; unreachable).
// ENVELOPE: median session ≈ 6.5-7 min (datum ~60 s, lane one ~140-250 s,
// the turn, lane two ~310-390 s); THE TURN ≈ 40-55% of median (canonical
// west-first order; the objectives are order-free by design and every
// resolution line survives the flip).
//
// ROUTE LAW (D-073): both win-required streams TERMINATE inside their door
// zones — unopposed they end the sortie (loseWhen 4/5); no route
// exhaustion can strand the win. The escorts are NOT win-required (alive
// at the win = they turned back alone — the M04 precedent); their routes
// TRACE the lanes to the doors and then HOLD THE DOORS on loiter laps to
// ≈ 923/1004 s (batch-3 panel MUST-5 — the pre-panel routes exhausted at
// ~184-196 s and the briefed cover egressed before any median merge). The
// honest cover geometry (the banked N05-cover SHOULD): route-SHAPE overlap
// with the freight's lane is total, but at cruise 240 over freight 150 the
// gun runs ~9-13 km ahead in time — the intercepting player meets the gun
// ON the lane, first or over the freight, and always meets it at the door.
//
// GUARDRAILS (amendment 5): the escorts are the ONLY shooters — 2 tier-3
// ENGAGE, one per lane, so the true worst case anywhere is 2 <= 4 (and
// the per-lane fight is 1). Escort spawns are >= 20.6 km from the datum
// and >= 27.7 km from the stream spawn centroid (ambush honesty); the
// east escort's approach legs hold >= 10.9 km from the datum until it is
// south of the fork (measured) — nothing can jump you while you read the
// picture. Ground: the datum sits 6.7 km from zsu 3 and 5.5 km from tel 7
// (both > 5 km rings); the lanes run over water. Bandits 4+2 = 6 <= 8;
// engage 2 <= 4. LINE AUDIT (batch-3 SHOULD): no calcified formulas
// (the one conditional-form clock, 588, is the honest N05 shape, used
// once).

import { TRIG } from "../../game/missions.js";

// n racetrack laps between two waypoints, as plain [[x,y],...] data
const laps = (a, b, n) => Array.from({ length: n }, () => [a, b]).flat();

export default {
  id: "M08",
  front: "MARIANAS",
  titleId: 580,
  briefingIds: [581, 582, 583],
  meta: { turnObj: 2, turnLineId: 585, victoryLineId: 586, defeatLineId: 587 },
  spec: {
    v: 1, kind: "authored",
    front: "MARIANAS",
    type: "intercept",
    seed: 0x2d0025,
    todH: 15.5, weatherIdx: 0,
    playerSpawn: { x: -3200, y: -8000, alt: 3600, headingDeg: 45.6, speed: 240 },
    airfield: { x: -3200, y: -8000, r: 600 },
    units: [],
    paths: {},
    bandits: [
      // stream WEST (tag 70): two heavies for the strait mouth. Cum walks
      // at transport cruise 150: W1 6.3/13.9/22.4/29.2/37.3/43.6/51.8/58.1
      // -> door ring 59.9 km ≈ 399 s; W2 -> 61.2 km ≈ 408 s. Routes
      // TERMINATE inside the west door (route LAW).
      { kind: "transport", tier: 0, x: 11500, y: 18500, z: 2400, headingDeg: -61, speed: 150, tag: 70, side: 0,
        wpts: [[6000, 21500], [-1000, 24500], [-9000, 21500], [-3500, 17500], [-11000, 14500], [-5500, 11500], [-13500, 9500], [-19500, 7500], [-24000, 6000]] },
      { kind: "transport", tier: 0, x: 12500, y: 19500, z: 2800, headingDeg: -61, speed: 150, tag: 70, side: 0,
        wpts: [[7000, 22500], [0, 25500], [-8000, 22500], [-2500, 18500], [-10000, 15500], [-4500, 12500], [-12500, 10500], [-18500, 8500], [-24000, 6000]] },
      // stream SOUTH (tag 71): two heavies down the east island line
      // (every early leg >= 10 km from the datum, inside the 18 km gate
      // from it — 597's "on my scope already"). Cum walks: S1 6.4/13.5/
      // 20.2/27.0/33.4/40.7/47.1/54.0/59.7/66.4 -> door ring 68.8 km
      // ≈ 459 s; S2 -> 70.2 km ≈ 468 s. Routes TERMINATE inside the door.
      { kind: "transport", tier: 0, x: 12500, y: 17500, z: 2200, headingDeg: 141, speed: 150, tag: 71, side: 0,
        wpts: [[16500, 12500], [11000, 8000], [16000, 3500], [10500, -500], [15500, -4500], [9500, -8500], [14500, -12500], [8500, -16000], [12500, -20000], [6500, -23000], [2000, -26000]] },
      { kind: "transport", tier: 0, x: 13500, y: 18500, z: 2600, headingDeg: 141, speed: 150, tag: 71, side: 0,
        wpts: [[17500, 13500], [12000, 9000], [17000, 4500], [11500, 500], [16500, -3500], [10500, -7500], [15500, -11500], [9500, -15000], [13500, -19000], [7500, -22000], [2000, -26000]] },
      // the GUNS (tag 72): one tier-3 ENGAGE flying each lane — spawned
      // far off-axis (ambush honesty), tracing its stream's route down the
      // lane (route-shape overlap; at cruise 240 over freight 150 the gun
      // runs ~9-13 km AHEAD in time), then HOLDING THE DOOR on loiter laps
      // (batch-3 panel MUST-5: without the laps both guns route-exhausted
      // at ~184-196 s and egressed off-map before any median merge — the
      // briefed cover never materialized). West gun: 47.1 km lane + 20
      // door-lap pairs -> 221.5 km ≈ 923 s; south gun: 45.9 km lane
      // (approach legs >= 10.9 km from the datum) + 20 door-lap pairs ->
      // 240.9 km ≈ 1004 s (measured). Guns are tag 72, so the tag-70/71 door-denial
      // rows can never trip on them.
      { kind: "fighter", tier: 3, engage: true, x: -16000, y: 26000, z: 4200, headingDeg: 114, speed: 250, tag: 72, side: 0,
        wpts: [[-8000, 22500], [-2500, 19000], [-8000, 16000], [-4000, 13000], [-12000, 11000], [-18000, 8500], [-23500, 6500],
          ...laps([-23500, 6500], [-19500, 8500], 20)] },
      { kind: "fighter", tier: 3, engage: true, x: 26000, y: -6000, z: 4800, headingDeg: -35, speed: 250, tag: 72, side: 0,
        wpts: [[21000, -1000], [17000, 2500], [15000, -3500], [11000, -9500], [13500, -15500], [8000, -19500], [3500, -24500],
          ...laps([3500, -24500], [7500, -21500], 20)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 7000, y: 2000, r: 2500 } },    // the datum at the fork
      { id: 2, kind: "destroy_tag", air: true, tag: 70, need: 2 },           // WEST lane
      { id: 3, kind: "destroy_tag", air: true, tag: 71, need: 2 },           // SOUTH lane
      { id: 4, kind: "protect_tag", air: true, tag: 70, zone: { x: -24000, y: 6000, r: 3000 } }, // the west door
      { id: 5, kind: "protect_tag", air: true, tag: 71, zone: { x: 2000, y: -26000, r: 3000 } }, // the south door
    ],
    winWhen: [2, 3], loseWhen: [4, 5],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 581 },
      { on: TRIG.ON_TIME, t: 25, lineId: 584 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 597 },   // "I pick both." (gate-honest)
      { on: TRIG.ON_TIME, t: 150, lineId: 589 },             // both-lanes tracking + honest clock
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 585 },   // THE TURN (west lane shut, order-safe)
      { on: TRIG.ON_TIME, t: 295, lineId: 588 },             // combined door clock, un-gated
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 586 },   // victory (south lane, order-safe)
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 4, lineId: 587 }, // a heavy is through
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 5, lineId: 587 },
    ],
    scoreKm: 2.0,
  },
};
