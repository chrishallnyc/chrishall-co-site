// M06 "FOUR CORNERS" — the committed 4-v-1 (phase 11 INC-8 batch 2).
// Fantasy: their varsity — a four-ship of the theater's best, no ace
// callsigns, just discipline — sweeps the strait at high noon to take the
// picture back, converging on the merge from four points of the compass.
// You accept it alone. This is the campaign's first FULL-CEILING air
// fight: four engage-capable fighters, the amendment-5 maximum, counted
// honestly and telegraphed everywhere. No ground war, no escort, no
// timer race — one merge and everything it brings.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      501-503 — the four-ship, the axes, the merge
//   2 SPAWN      ON_START 501
//   3 INGRESS    spawn (-3200,-8000) -> merge datum (10000,2000)
//                ≈ 16.6 km ≈ 76 s; 504 at t25
//   4 OBJ A      obj 2: the PINCER — two tier-2 ENGAGE fighters closing
//                the datum from NE and NW on converging 45.8/51.4 km
//                routes; 11 km merge-ring entry at ≈ 191/214 s
//                (measured), merge-ring laps to ≈ 1001/994 s after. The
//                player reaches the datum at ~76 s and watches them
//                close — the anticipation IS the picture.
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 505: the pincer is in the water —
//                and the ANVIL comes off its southern standoff. AMBUSH
//                TIMING TRICK: two tier-3 ENGAGE fighters (tag 51)
//                spawned at START in the far SE/SW ride wide southern
//                racetracks (standoff legs >= 17.9/13.6 km from the
//                merge, measured per leg) until ≈ 250 s, then cut north:
//                ring entry at ≈ 291/294 s — on the heels of a competent
//                pincer kill — then merge-ring laps to ≈ 1109/1125 s of
//                total route. ON_TIME t=255 backstop 509 calls the cut
//                un-gated.
//   6 CLIMAX     obj 3: the anvil — tier 3, better geometry, same honest
//                airframes; destroy_tag need 2 counts !live.
//   7 RESOLUTION 506 victory / 507 timeout (offense; t=1200 warning 518)
// ENVELOPE: median session ≈ 7.5-8 min (datum ~76 s, pincer fight
// ~190-300 s, anvil ~300-470 s); THE TURN ≈ 45-55% of median.
//
// ROUTE LAW (D-073): every win-required flight is ENGAGE-capable (commits
// itself whenever the player is inside 10 km) AND loiters the merge ring
// to ≈ 994-1125 s. No stranding path.
//
// GUARDRAILS (amendment 5): engage census = 4 <= 4 — THE CEILING, BY
// DESIGN, and the accounting is honest: pre-turn the true count is the
// pincer pair (2; the t26 phase model books engage air post-turn, the
// N02 precedent — header carries the truth), and the worst-case overlap
// (anvil arriving with a pincer survivor airborne) is exactly 4, all
// air, all telegraphed (diamonds + AAM launch warnings + the 509 call).
// Zero ground shooters within 5 km of any center (nearest boot gun
// 7.1 km). Every engage spawn is 24+ km from every pre-turn center
// (pincer included — the converging pair is the objective, and even they
// spawn beyond the ambush-honesty ring). Bandits 4 <= 8. Third and
// fourth tier-3 airframes of the batch.

import { TRIG } from "../../game/missions.js";

// n racetrack laps between two waypoints, as plain [[x,y],...] data
const laps = (a, b, n) => Array.from({ length: n }, () => [a, b]).flat();
// n laps of the 48 km merge ring
const ringLaps = (n) => Array.from({ length: n },
  () => [[16000, 8000], [4000, 8000], [4000, -4000], [16000, -4000]]).flat();

export default {
  id: "M06",
  front: "MARIANAS",
  titleId: 500,
  briefingIds: [501, 502, 503],
  meta: { turnObj: 2, turnLineId: 505, victoryLineId: 506, defeatLineId: 507 },
  spec: {
    v: 1, kind: "authored",
    front: "MARIANAS",
    type: "cap",
    seed: 0x4c04e2,
    todH: 12, weatherIdx: 0,
    playerSpawn: { x: -3200, y: -8000, alt: 3600, headingDeg: 37.1, speed: 240 },
    airfield: { x: -3200, y: -8000, r: 600 },
    units: [],
    paths: {},
    bandits: [
      // the PINCER (tag 50): tier-2 ENGAGE, converging NE + NW. Cum walks
      // at cruise 240: NE 10.0/22.8/34.5/47.9 -> 11 km merge-ring entry at
      // 51.4 km ≈ 214 s; NW 10.2/21.9/32.1/42.1 -> entry 45.8 km ≈ 191 s;
      // then merge-ring laps to ≈ 994/1001 s. Spawns 24.1+ km from every
      // pre-turn center.
      { kind: "fighter", tier: 2, engage: true, x: 26000, y: 20000, z: 4600, headingDeg: 143, speed: 250, tag: 50, side: 0,
        wpts: [[18000, 26000], [26000, 16000], [16000, 22000], [22000, 10000], [14000, 7000], ...ringLaps(4)] },
      { kind: "fighter", tier: 2, engage: true, x: -22000, y: 24000, z: 4200, headingDeg: 11, speed: 250, tag: 50, side: 0,
        wpts: [[-12000, 26000], [-18000, 16000], [-8000, 18000], [-2000, 10000], [6000, 8000], ...ringLaps(4)] },
      // the ANVIL (tag 51): tier-3 ENGAGE, wide southern standoff (2
      // racetrack lap pairs, standoff legs >= 17.9 km SE / >= 13.6 km SW
      // from the merge) to ≈ 250 s, then the cut north: ring entry at
      // 69.9 km ≈ 291 s (SE) / 70.6 km ≈ 294 s (SW); merge-ring laps to
      // ≈ 1109/1125 s of total route.
      { kind: "fighter", tier: 3, engage: true, x: 26000, y: -24000, z: 5400, headingDeg: 108, speed: 260, tag: 51, side: 0,
        wpts: [...laps([24000, -18000], [12000, -26000], 2), [18000, -14000], [14000, -6000], ...ringLaps(4)] },
      { kind: "fighter", tier: 3, engage: true, x: -24000, y: -26000, z: 5800, headingDeg: 56, speed: 260, tag: 51, side: 0,
        wpts: [...laps([-20000, -20000], [-8000, -26000], 2), [-4000, -14000], [2000, -9000], ...ringLaps(4)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 10000, y: 2000, r: 2500 } },   // the merge datum
      { id: 2, kind: "destroy_tag", air: true, tag: 50, need: 2 },           // the pincer
      { id: 3, kind: "destroy_tag", air: true, tag: 51, need: 2 },           // the anvil
    ],
    winWhen: [2, 3], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 501 },
      { on: TRIG.ON_TIME, t: 25, lineId: 504 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 508 },   // on the datum: four groups, four corners
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 505 },   // THE TURN
      { on: TRIG.ON_TIME, t: 255, lineId: 509 },             // anvil cut, un-gated (ring ≈ 291-294 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 506 },   // victory
      { on: TRIG.ON_TIME, t: 1200, lineId: 518 },            // 5-min clock warning
      { on: TRIG.ON_TIME, t: 1500, lineId: 507 },            // timeout defeat
    ],
    scoreKm: 1.0,
  },
};
