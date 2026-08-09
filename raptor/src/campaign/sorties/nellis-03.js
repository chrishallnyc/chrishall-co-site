// N03 "LIFELINE" — friendly convoy escort (phase 11 INC-8 batch 1).
// Fantasy: four FRIENDLY movers crawling the south basin road with the
// front's ammunition aboard, raiders coming for them in waves, and you as
// the rolling umbrella. The campaign's first blue ground war (side-1 trucks
// DRIVING a path — the V01 raider grammar re-aimed at a moving column).
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      361-363 — the column, the raid warning, the two-truck rule
//   2 SPAWN      ON_START 361
//   3 INGRESS    spawn (6000,-2000) -> column overhead (-10000,-9200)
//                ≈ 17.5 km ≈ 75-85 s; 364 at t25
//   4 OBJ A      obj 2: the SCOUT — one tier-1 raider (tag 20) off the NE
//                on a 39.2 km dog-leg (≈ 164 s at cruise 240). His route
//                crosses ATTACK_R (8 km from the lead truck) at ≈ 34.3 km
//                ≈ 143 s -> dive + launch ≈ 161 s, impact ≈ 166 s: an
//                unopposed scout costs ONE truck — a gut punch, never the
//                mission (protect need 2). Mid-route wpts hold >= 14 km
//                from the road (M01 MUST-3 anticipation rule).
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 365: the second package turns in.
//                AMBUSH TIMING TRICK: wave 2 (tag 21, 3 tier-2 raiders)
//                spawns at START far NW on 73-75 km dog-legs; the routes
//                cross ATTACK_R at ≈ 65.4-67.9 km ≈ 273-283 s (measured)
//                -> dives + launches ≈ 291-301 s, impacts from ≈ 296 s.
//                Every mid-route wpt holds >= 9.5 km from the road (the
//                M01 standoff rule); ON_TIME t=250 backstop 369 announces
//                the push even if obj 2 froze on a scout egresser.
//   6 CLIMAX     obj 3: three raiders on the deck, one moving column, and
//                arithmetic — each carries exactly one shot (A1: launch
//                then EGRESS) and each shot is a truck.
//   7 RESOLUTION 366 victory / 367 two movers lost / 442 t=1500 defense
//                timeout = VICTORY flavor (escort type: the raid ran out
//                of ordnance first)
// ENVELOPE: median session ≈ 6.5-7 min (join ~80 s, scout ~150-180 s,
// push dives ~280-300 s, resolution ~360-420 s); THE TURN ≈ 40% of median.
//
// ROUTE LAW (D-073): both waves carry attackTag 12 — their routes RESOLVE
// at the column (route done or ATTACK_R -> committed dive -> launch ->
// EGRESS), so route exhaustion cannot strand a win-required objective
// while the column lives; if the column dies instead, loseWhen(4) ends the
// sortie. Post-launch egressers are the V01-template tail: alive, slower
// than you (VMAX 330), HUD-tracked — a chase, not a soft-lock.
//
// GUARDRAILS (amendment 5): NOTHING in N03 ever shoots at the player —
// raiders are engage-less A1 (tier 1/2), the column is blue, and every
// boot shooter is >= 5 km from every objective center (depot zsu 11 is
// 7.2 km from the column spawn; the eastern guns 12+ km). 0 <= 4.
// Bandits 1+3 = 4 <= 8.
//
// POOL/capacity (NELLIS n=12): 4 supply_truck -> reserve slots 12,13,15,18
// (of 16 reserve trucks). protect bfIdx below IS that deterministic
// assignment (same typed demands as N01 — different sortie, same math).

import { TRIG } from "../../game/missions.js";

export default {
  id: "N03",
  front: "NELLIS",
  titleId: 360,
  briefingIds: [361, 362, 363],
  meta: { turnObj: 2, turnLineId: 365, victoryLineId: 366, defeatLineId: 367 },
  spec: {
    v: 1, kind: "authored",
    front: "NELLIS",
    type: "escort",
    seed: 0x11fe11,
    todH: 12, weatherIdx: 0,
    playerSpawn: { x: 6000, y: -2000, alt: 3600, headingDeg: -155.7, speed: 220 },
    airfield: { x: -3000, y: -8700, r: 900 },
    // the lifeline: four FRIENDLY movers (side 1, tag 12) driving east for
    // the field at 8 m/s — ~6.5 km of road ≈ 810 s of crawl
    units: [
      ["supply_truck", -11000, -9000, 1.8, 1, 12],
      ["supply_truck", -11080, -9080, 1.8, 1, 12],
      ["supply_truck", -11160, -9160, 1.8, 1, 12],
      ["supply_truck", -11240, -9240, 1.8, 1, 12],
    ],
    paths: { 12: [[-8500, -9600], [-6500, -8900], [-4800, -8300]] },
    bandits: [
      // the SCOUT (tag 20): one tier-1 raider off the NE. Cum walk at
      // cruise 240: 12.8/28.4/39.2 km; ATTACK_R (8 km from the lead truck)
      // crossed at ≈ 34.3 km ≈ 143 s -> launch ≈ 161 s. Mid wpts >= 14 km
      // from the road.
      { kind: "fighter", tier: 1, x: 24000, y: 16000, z: 900, headingDeg: -142, speed: 250, tag: 20, side: 0, attackTag: 12,
        wpts: [[14000, 8000], [2000, -2000], [-7000, -8000]] },
      // the PUSH (tag 21): three tier-2 raiders far NW, length-tuned to
      // dive as a competent scout kill lands +100 s. Cum walk (w2a):
      // 12.6/23.5/35.6/47.0/54.3/63.2/74.1 km; ATTACK_R crossed at
      // ≈ 65.4-67.9 km ≈ 273-283 s across the trail (measured). Every
      // pre-commit leg >= 9.7 km from the road (M01 MUST-3 standoff).
      { kind: "fighter", tier: 2, x: -27000, y: 20000, z: 1000, headingDeg: -20, speed: 250, tag: 21, side: 0, attackTag: 12,
        wpts: [[-15000, 16000], [-24000, 10000], [-12000, 8000], [-21000, 1000], [-14000, -1000], [-20000, -7500], [-9200, -9400]] },
      { kind: "fighter", tier: 2, x: -28500, y: 18500, z: 1300, headingDeg: -20, speed: 250, tag: 21, side: 0, attackTag: 12,
        wpts: [[-16500, 14500], [-25500, 8500], [-13500, 6500], [-22500, -500], [-15500, -2500], [-21500, -9000], [-9400, -9700]] },
      { kind: "fighter", tier: 2, x: -25500, y: 21500, z: 1600, headingDeg: -20, speed: 250, tag: 21, side: 0, attackTag: 12,
        wpts: [[-13500, 17500], [-22500, 11500], [-10500, 9500], [-19500, 2500], [-12500, 500], [-18500, -6000], [-9000, -9100]] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: -10000, y: -9200, r: 2500 } },  // overhead the column
      { id: 2, kind: "destroy_tag", air: true, tag: 20, need: 1 },            // the scout
      { id: 3, kind: "destroy_tag", air: true, tag: 21, need: 3 },            // the push
      { id: 4, kind: "protect_tag", bfIdx: [12, 13, 15, 18], need: 2 },       // two movers lost = the push dies
    ],
    winWhen: [2, 3], loseWhen: [4],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 361 },
      { on: TRIG.ON_TIME, t: 25, lineId: 364 },
      { on: TRIG.ON_TIME, t: 250, lineId: 369 },             // wave-2 backstop, un-gated (dive ≈ 280 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 368 },   // the watch begins
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 365 },   // THE TURN
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 366 },   // victory
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 4, lineId: 367 }, // two movers down
      { on: TRIG.ON_TIME, t: 1500, lineId: 442 },            // defense timeout = VICTORY flavor
    ],
    scoreKm: 2.0,
  },
};
