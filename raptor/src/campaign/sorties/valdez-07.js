// V07 "THE BELT" — the two-site SEAD gauntlet (phase 11 INC-8 batch 3).
// Fantasy: the western narrows are locked by a missile BELT — two mutually
// covering sites on probed flats either side of the water (the campaign's
// first spawned ground war on VALDEZ), and the fleet comes home through
// those narrows next week. Crack all six pieces, then meet the pair they
// scramble when the belt dies. VALDEZ's first sead (the front had none in
// 24 sorties of shelf). HONESTY NOTE: radar-gates-TEL is NOT implemented
// (missions.js: "lands with AMENDMENT 6") — no line ever claims a dead
// dish blinds a rail; 552 says the opposite out loud.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      551-553 — the belt, the six pieces, the promised answer
//   2 SPAWN      ON_START 551
//   3 INGRESS    spawn (0,-6000) -> run-in (8000,-19000) ≈ 15.3 km ≈ 69 s;
//                554 at t25. The run-in center sits 4.2 km from site A's
//                near rail — INSIDE its 6 km envelope, briefed (554).
//   4 OBJ A/B    obj 2: THE BELT, one objective, need 6 — site A on the
//                east shore flat (5000,-16000: dish + 2 rails, probed span
//                47 m) and site B on the west flat (-10000,-14000: dish +
//                rail + zsu, probed span 38 m), 15.1 km apart across the
//                water. One counter, two locations, player's order.
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 555: the air answers. AMBUSH
//                TIMING TRICK: two tier-3 ENGAGE fighters (tag 56) spawned
//                at START far north behind the glacier line on 312.7/
//                312.4 km routes; every HOLD leg >= 18.1/19.9 km from the
//                player's whole play line (measured vs the polyline —
//                outside the 18 km gate), then a two-leg descent into a
//                10 km belt ring at ≈ 321/337 s — on the heels of a
//                competent belt kill (~250-330 s). Un-gated 593 at t=290.
//   6 CLIMAX     obj 3: the pair over the dead belt — destroy_tag need 2
//                counts !live.
//   7 RESOLUTION 556 victory (pair-scoped, true even on a duel-first
//                path) / 557 timeout (state-agnostic "contested"; offense
//                sead; t=1200 clock 559)
// ENVELOPE: median session ≈ 7.5-8 min (run-in ~69 s, site A ~130-210 s,
// crossing ~45 s, site B ~250-330 s, pair ~340-470 s); THE TURN
// re-documented ≈ 52-70% of median (D-078 header-truth rider — a
// documented exception past the 30-60% window, the V05 precedent): the
// belt IS the sortie, the air answer is its coda. The 220 s mid-belt
// trough is filled by 599 at t=160 (the chair's id assignment, the V06
// trough law).
//
// ROUTE LAW (D-073): the belt is ground (never despawns); the win-required
// pair is ENGAGE-capable AND rides FOUR 58 km belt-ring laps to
// ≈ 1302/1303 s of total route. No stranding path.
//
// GUARDRAILS (amendment 5): phase model — run-in phase: site A's 2 rails
// inside 5 km of the run-in center (4.2/4.3 km, briefed by 554) = 2 <= 4;
// belt centroid phase (the t26 ring at (-2517,-15017), mid-water): 0
// within 5 km — HONEST PER-SITE COUNTS: at site A the player faces 2
// rails; at site B 1 rail + 1 gun; both boot shooters (zsu 4 at 8.7 km,
// tel 6 at 5.8 km from the run-in) sit outside every ring. Worst case a
// player who drags the pair down onto a live site faces 2 rails + 2
// fighters = 4 <= 4, the ceiling, all telegraphed. Bandits 2 <= 8; engage
// 2 <= 4. LINE AUDIT (batch-3 SHOULD): no calcified formulas; 556/557
// written order-agnostic at write time (the D-076 law).
//
// POOL/capacity (VALDEZ n=7): 2 sam_radar -> reserve slots 14,23 (of 4);
// 3 sam_tel -> slots 12,18,24 (of 6); 1 zsu -> slot 9 (of 10). destroy
// bfIdx below IS that deterministic first-free-typed assignment, in
// authored units order [radarA, telA1, telA2, radarB, telB, zsuB] ->
// [14, 12, 18, 23, 24, 9]. Terrain probed 2026-08-09 (live heightAt grid):
// site A cell 669-716 m span 47 m; site B cell 436-474 m span 38 m.

import { TRIG } from "../../game/missions.js";

// n laps of the 58 km belt ring
const ringLaps = (pts, n) => Array.from({ length: n }, () => pts).flat();

export default {
  id: "V07",
  front: "VALDEZ",
  titleId: 550,
  briefingIds: [551, 552, 553],
  meta: { turnObj: 2, turnLineId: 555, victoryLineId: 556, defeatLineId: 557 },
  spec: {
    v: 1, kind: "authored",
    front: "VALDEZ",
    type: "sead",
    seed: 0xbe1707,
    todH: 15.5, weatherIdx: 0,
    playerSpawn: { x: 0, y: -6000, alt: 3600, headingDeg: 148.4, speed: 220 },
    airfield: { x: 0, y: -6000, r: 600 },
    // the belt: site A (east shore flat) dish + 2 rails; site B (west
    // flat) dish + rail + gun — spawned in this order for the slot math
    units: [
      ["sam_radar", 5000, -16000, 0.3, 0, 35],
      ["sam_tel", 5300, -15800, 0.8, 0, 35],
      ["sam_tel", 4700, -16300, -0.4, 0, 35],
      ["sam_radar", -10000, -14000, 1.6, 0, 36],
      ["sam_tel", -9700, -14200, 2.1, 0, 36],
      ["zsu", -10400, -13800, 0.9, 0, 36],
    ],
    paths: {},
    bandits: [
      // the answer (tag 56): tier-3 ENGAGE pair behind the glacier line.
      // Cum walks at cruise 240: Q1 holds north of y=12000 for 6 legs
      // (10.8/19.7/30.5/40.7/50.7/58.7 km), two-leg descent, 10 km
      // belt-ring entry at 77.1 km ≈ 321 s; Q2 entry 80.8 km ≈ 337 s.
      // Every hold leg >= 18.1/19.9 km from the play line (measured); then
      // FOUR 58 km belt-ring laps to ≈ 312.7/312.4 km ≈ 1303/1302 s.
      { kind: "fighter", tier: 3, engage: true, x: -6000, y: 27000, z: 4800, headingDeg: 112, speed: 260, tag: 56, side: 0,
        wpts: [[4000, 23000], [-4000, 19000], [6000, 15000], [-4000, 13000], [6000, 12500], [-2000, 12000], [2000, 0], [-1500, -8000], [-2000, -12000],
          ...ringLaps([[6000, -9000], [-11000, -9000], [-11000, -21000], [6000, -21000]], 4)] },
      { kind: "fighter", tier: 3, engage: true, x: 2000, y: 28000, z: 5200, headingDeg: 112, speed: 260, tag: 56, side: 0,
        wpts: [[12000, 24000], [4000, 20000], [14000, 16000], [4000, 14000], [14000, 13500], [6000, 13000], [9000, 1000], [3000, -8000], [2000, -12000],
          ...ringLaps([[7000, -8000], [-10000, -8000], [-10000, -20000], [7000, -20000]], 4)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 8000, y: -19000, r: 2500 } },  // the run-in into the bowl
      { id: 2, kind: "destroy_tag", bfIdx: [14, 12, 18, 23, 24, 9], need: 6 }, // THE BELT (both sites, spawned slots)
      { id: 3, kind: "destroy_tag", air: true, tag: 56, need: 2 },           // the answer
    ],
    winWhen: [2, 3], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 551 },
      { on: TRIG.ON_TIME, t: 25, lineId: 554 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 558 },   // tally both sites
      { on: TRIG.ON_TIME, t: 160, lineId: 599 },             // mid-belt clock, un-gated, state-agnostic (D-078 chair rider)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 555 },   // THE TURN
      { on: TRIG.ON_TIME, t: 290, lineId: 593 },             // pair backstop, un-gated (ring ≈ 321-337 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 556 },   // victory
      { on: TRIG.ON_TIME, t: 1200, lineId: 559 },            // 5-min clock warning
      { on: TRIG.ON_TIME, t: 1500, lineId: 557 },            // timeout defeat
    ],
    scoreKm: 2.0,
  },
};
