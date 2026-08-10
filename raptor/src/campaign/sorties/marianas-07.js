// M07 "THE EYE" — the guarded high-value orbiter (phase 11 INC-8 batch 3).
// Fantasy: the reason the enemy answers every move before it finishes is a
// converted heavy orbiting the strait at 25,000 ft — their last airborne
// radar picture. It never runs (it can't do its job anywhere else); it is
// simply GUARDED: two tier-3 close guards bracket the orbit one high side
// each, and a ready pair holds low over the southern water for exactly
// this day. Fight up through the stack and put the eye out. Distinct from
// M04 (the courier RAN; the eye stands its post) and from M06 (a sweep
// converged on YOU; here you climb into a fortress).
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      571-573 — the eye, the guards, the ready pair
//   2 SPAWN      ON_START 571
//   3 INGRESS    spawn (-3200,-8000) -> datum (10000,-6000) ≈ 13.4 km,
//                r2500 ring ≈ 50-61 s; 574 at t25. The eye's orbit line is
//                8.1 km from the datum — inside the 18 km gate, so 578's
//                "I can see it" is HUD-true at the datum (measured).
//   4 OBJ A      obj 2: the GUARDS (tag 48) — two tier-3 ENGAGE bracketing
//                the orbit, one flank track each: north track legs
//                (21000,10000)-(12000,9000), south track legs
//                (17000,-2000)-(6000,-4000) — they converge on the datum
//                area from spawns that straddle the map (each 21.4 km from
//                their own centroid (20000,-1000) — the M06 rule; the near
//                guard meets you ~80-100 s: beat 4 IS the merge, the t26
//                phase model books engage air post-turn, header carries
//                the truth per the N02/M06 precedent). Both loiter their
//                flank tracks to ≈ 1051/1219 s (route LAW).
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 575 ("already moving" — motion is
//                trivially true of an airborne hold; no position claim).
//                AMBUSH TIMING TRICK: the READY PAIR (tag 49) — two more
//                tier-3 ENGAGE, low south over the water (z 1200/1400) —
//                hold a far-south racetrack (every hold leg >= 18.7/
//                19.7 km from the player's whole play line, measured:
//                outside the 18 km gate) until ≈ 250 s, then cut north:
//                11 km orbit-ring entry at ≈ 331/341 s — on the heels of a
//                competent guard kill (~200-280 s). Un-gated 596 at t=300.
//                Their post-entry loiter boxes are DISTINCT from the
//                guard tracks — RE-SCOPED per the D-078 header-truth
//                rider: the separation claim holds against the NORTH
//                flank track and the orbit line (5+ km), but the second
//                pair member's box sits 4.7 km minimum from the SOUTH
//                flank track — inside ENGAGE_R 10 km — so peel-by-
//                geometry is guaranteed only against the north track;
//                the census stays 4 <= 4 either way.
//   6 CLIMAX     obj 3: THE EYE — destroy_tag need 1 on the orbiter, a
//                25,000 ft climb with whatever is left of the stack on
//                your back. The ready pair is NOT win-required (alive at
//                the win = nothing left to see for — the M04 escort
//                precedent); they pressure the endgame, they never gate it.
//   7 RESOLUTION 576 victory (eye-scoped, true even on an eye-first path) /
//                577 timeout (someone IS still flying whenever the win
//                never landed; offense cap; t=1200 clock 579)
// ENVELOPE: median session ≈ 7-8 min (datum ~55 s, guards ~200-280 s,
// ready pair ~331-341 s, the climb + eye ~300-450 s); THE TURN
// re-documented ≈ 44-62% of median (D-078 header-truth rider — the top
// edge is a documented exception, the V05/V07 precedent).
//
// ROUTE LAW (D-073): the win-required guards are ENGAGE-capable AND loiter
// to ≈ 1051/1219 s (the 1041 figure was a transcription slip — D-078
// header-truth rider); the win-required EYE is engage-less, so its route must
// outlive the timer — 259.8 km at transport cruise 150 ≈ 1732 s > 1500 s
// (measured). No stranding path.
//
// GUARDRAILS (amendment 5): engage census = guards 2 + ready pair 2 =
// 4 <= 4 — THE CEILING, honestly counted: worst case for a slow player is
// both guards alive when the ready pair arrives = exactly 4, all air, all
// telegraphed (572 briefs all three elements, 596 calls the pair). The
// eye is unarmed. Zero ground shooters within 5 km of any center (orbit
// spawn is 6.4 km from tel 7 and 7.8 km from zsu 3; both flank tracks
// hold >= 7.1/11.1 km from tel 7 — outside the 6 km SAM envelope, so the
// stack fight stays over water, measured). Bandits 1+2+2 = 5 <= 8. LINE
// AUDIT (batch-3 SHOULD, amended by the D-078 riders): "the better half"
// jargon lesson applied (572 says "the best sticks they have left");
// 574's "the plot is honest", 575's pre-killable deck-pair claim, 577's
// "whoever's still flying" and 596's "half a minute" were all varied or
// hedged by the batch-4 calcification sweep, and 579 is now the table's
// ONE surviving "Five minutes" clock (panel-accepted single use — 549
// and 559 varied).

import { TRIG } from "../../game/missions.js";

// n racetrack laps between two waypoints, as plain [[x,y],...] data
const laps = (a, b, n) => Array.from({ length: n }, () => [a, b]).flat();

export default {
  id: "M07",
  front: "MARIANAS",
  titleId: 570,
  briefingIds: [571, 572, 573],
  meta: { turnObj: 2, turnLineId: 575, victoryLineId: 576, defeatLineId: 577 },
  spec: {
    v: 1, kind: "authored",
    front: "MARIANAS",
    type: "cap",
    seed: 0x73e3e1,
    todH: 17.8, weatherIdx: 0,
    playerSpawn: { x: -3200, y: -8000, alt: 3600, headingDeg: 81.4, speed: 240 },
    airfield: { x: -3200, y: -8000, r: 600 },
    units: [],
    paths: {},
    bandits: [
      // THE EYE (tag 47): converted heavy at z 7600 (25,000 ft), lapping a
      // 12.37 km orbit line east over the strait — 21 legs = 259.8 km
      // ≈ 1732 s at cruise 150: the engage-less win-required route OUTLIVES
      // the 1500 s timer (D-073 LAW). Spawn 6.4 km from tel 7 (> 5 km ring).
      { kind: "transport", tier: 0, x: 9000, y: 2000, z: 7600, headingDeg: 76, speed: 150, tag: 47, side: 0,
        wpts: [[21000, 5000], ...laps([9000, 2000], [21000, 5000], 10)] },
      // the GUARDS (tag 48): tier-3 ENGAGE, one flank track each (north +
      // south of the orbit line, 7.1/11.1 km from tel 7 — outside the SAM
      // envelope). Cum walks at cruise 240: north 8.9/16.8 km -> track,
      // laps to 252.2 km ≈ 1051 s; south 8.1/16.6/24.2 km -> track, laps
      // to 292.5 km ≈ 1219 s (24.2 corrected per the D-078 header-truth
      // rider). Spawns straddle: each 21.4 km from their
      // centroid (20000,-1000), 29.5/17.1 km from the datum, 23.8+ km
      // from the player spawn.
      { kind: "fighter", tier: 3, engage: true, x: 24000, y: 20000, z: 5400, headingDeg: -117, speed: 260, tag: 48, side: 0,
        wpts: [[16000, 16000], [21000, 10000], ...laps([12000, 9000], [21000, 10000], 13)] },
      { kind: "fighter", tier: 3, engage: true, x: 16000, y: -22000, z: 5000, headingDeg: 23, speed: 260, tag: 48, side: 0,
        wpts: [[20000, -15000], [14000, -9000], [17000, -2000], ...laps([6000, -4000], [17000, -2000], 12)] },
      // the READY PAIR (tag 49): tier-3 ENGAGE, low over the southern
      // water (z 1200/1400). Far-south hold (4 racetrack legs, every hold
      // leg >= 18.7/19.7 km from the whole play line) to ≈ 250 s, then the
      // cut: 11 km orbit-ring entry at 79.4/81.8 km ≈ 331/341 s; then a
      // DISTINCT south loiter box to ≈ 1122/1116 s of total route.
      { kind: "fighter", tier: 3, engage: true, x: 18000, y: -26000, z: 1200, headingDeg: 45, speed: 250, tag: 49, side: 0,
        wpts: [[20000, -24000], [6000, -27000], [20000, -24000], [6000, -27000], [20000, -24000], [14000, -16000], [17000, -8000], [13000, -2000],
          ...laps([19000, -10000], [9000, -12000], 9)] },
      { kind: "fighter", tier: 3, engage: true, x: 8000, y: -28000, z: 1400, headingDeg: -45, speed: 250, tag: 49, side: 0,
        wpts: [[6000, -26000], [20000, -23000], [6000, -26000], [20000, -23000], [6000, -26000], [12000, -18000], [15000, -10000], [11000, -4000],
          ...laps([16000, -7000], [6000, -9000], 9)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 10000, y: -6000, r: 2500 } },  // the datum under the orbit
      { id: 2, kind: "destroy_tag", air: true, tag: 48, need: 2 },           // the guards
      { id: 3, kind: "destroy_tag", air: true, tag: 47, need: 1 },           // THE EYE
    ],
    winWhen: [2, 3], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 571 },
      { on: TRIG.ON_TIME, t: 25, lineId: 574 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 578 },   // the fat silver cross (gate-honest)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 575 },   // THE TURN
      { on: TRIG.ON_TIME, t: 300, lineId: 596 },             // ready-pair backstop, un-gated (ring ≈ 331-341 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 576 },   // victory
      { on: TRIG.ON_TIME, t: 1200, lineId: 579 },            // 5-min clock warning
      { on: TRIG.ON_TIME, t: 1500, lineId: 577 },            // timeout defeat
    ],
    scoreKm: 1.5,
  },
};
