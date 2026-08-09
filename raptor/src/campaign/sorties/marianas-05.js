// M05 "SCATTER" — SEAD, then the ground chase (phase 11 INC-8 batch 2).
// Fantasy: the Tinian site is the shield over the pier road — and the
// moment you made landfall, the strip knew what was coming: the loaded
// ordnance movers BOLTED in two directions (they are driving from t=0,
// pool doctrine — the brief says so, the HUD tracks them, nothing pops
// up). Kill the dish and the rail, then run down a convoy that is
// actively scattering into the island — the driving-column grammar used
// as a CHASE, not a crawl (N01 killed a column in file; M03 ledgered one;
// M05's two half-columns diverge). One alert sentinel comes down from the
// northern water when the site goes dark.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      491-493 — the site, the bolting movers, the sentinel
//   2 SPAWN      ON_START 491
//   3 INGRESS    spawn (-6000,-16000) -> run-in over the water
//                (-1000,3000) ≈ 19.7 km ≈ 89 s; 494 at t25
//   4 OBJ A      obj 2: the site — boot rows 6 (radar) + 7 (TEL), zone 3,
//                under the strip zsu's live umbrella
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 495: the site is dark and the
//                scatter is now YOUR problem. AMBUSH TIMING TRICK: the
//                sentinel (tag 46, tier-2 ENGAGE) spawned at START over
//                the far northern water on a 77.2 km weave whose every
//                pre-entry leg holds >= 14.8 km from the site (measured
//                per leg); he enters an 11 km ring at ≈ 322 s — on the
//                heels of a competent site kill (~200-260 s) — then rides
//                FIVE 36 km strip-ring laps (≈ 150 s each) to ≈ 1085 s of
//                total route. ON_TIME t=275 backstop 499 calls his descent
//                un-gated.
//   6 CLIMAX     obj 3: the scatter — two pairs of movers on DIVERGING
//                roads (west pair 11.8 km ≈ 1470 s of drive, north pair
//                12.1 km ≈ 1513 s: both still moving at the five-minute
//                warning, the north pair at the timer itself), killed
//                under the sentinel's eye.
//   7 RESOLUTION 496 victory / 497 timeout (offense; t=1200 warning 517)
// ENVELOPE: median session ≈ 7-7.5 min (run-in ~89 s, site ~200-260 s,
// scatter chase + sentinel ~280-450 s); THE TURN ≈ 50% of median.
//
// ROUTE LAW (D-073): nothing win-required flies — the site and the movers
// are ground (movers hold position at path end, never despawn). The
// sentinel is NOT win-required (alive at the win = he broke off — the
// M04 escort precedent) and his 1085 s route + self-committing ENGAGE
// close the loop anyway.
//
// GUARDRAILS (amendment 5): obj-2 site phase = TEL 7 (0.1 km) + strip zsu
// 3 (1.4 km) = 2; obj-3 scatter phase = zsu 3 (0.5 km from the mover
// centroid; the TEL is dead by objective order) + the sentinel = 2.
// HONEST SLOW-PATH NOTE: a player who chases movers with the site still
// up faces zsu + TEL + sentinel = 3 <= 4. All telegraphed. Bandits 1 <= 8;
// engage 1 <= 4.
//
// POOL/capacity (MARIANAS n=10): 4 supply_truck -> reserve slots
// 10,11,13,16 (of 16 reserve trucks); no ships, no guns spawned. destroy
// bfIdx below IS that deterministic assignment (the M03 math, different
// war).

import { TRIG } from "../../game/missions.js";

// n laps of the 36 km strip ring
const ringLaps = (n) => Array.from({ length: n },
  () => [[9000, 11000], [-1000, 11000], [-1000, 3000], [9000, 3000]]).flat();

export default {
  id: "M05",
  front: "MARIANAS",
  titleId: 490,
  briefingIds: [491, 492, 493],
  meta: { turnObj: 2, turnLineId: 495, victoryLineId: 496, defeatLineId: 497 },
  spec: {
    v: 1, kind: "authored",
    front: "MARIANAS",
    type: "sead",
    seed: 0x5ca77e,
    todH: 17.8, weatherIdx: 0,
    playerSpawn: { x: -6000, y: -16000, alt: 3600, headingDeg: 75.3, speed: 220 },
    airfield: { x: -3200, y: -8000, r: 600 },
    // the scatter: two half-columns bolting from the strip yard on
    // diverging roads — west pair (tag 14) for the pier tunnels, north
    // pair (tag 15) up the island line. Driving from t=0 at 8 m/s.
    units: [
      ["supply_truck", 3300, 7700, -2.4, 0, 14],
      ["supply_truck", 3400, 7800, -2.4, 0, 14],
      ["supply_truck", 3600, 7900, 0.8, 0, 15],
      ["supply_truck", 3700, 8000, 0.8, 0, 15],
    ],
    paths: {
      14: [[1800, 6200], [0, 4800], [-1800, 3200], [-3400, 1400], [-5200, -400]],   // 11.8 km ≈ 1470 s
      15: [[5400, 9600], [7000, 11200], [8800, 13000], [10400, 14800], [12000, 16600]], // 12.1 km ≈ 1513 s
    },
    bandits: [
      // the sentinel (tag 46): tier-2, explicit A3 opt-in, held over the
      // far northern water. Cum walk at cruise 240: 11.1/30.2/48.2/66.3 ->
      // 11 km ring entry at 77.2 km ≈ 322 s; every pre-entry leg >= 14.8 km
      // from the site (5070,7060) and >= 18.4 km from the run-in gate;
      // then FIVE 36 km ring laps (≈ 150 s each) to ≈ 1085 s total route.
      { kind: "fighter", tier: 2, engage: true, tag: 46, side: 0,
        x: 2000, y: 27000, z: 4800, headingDeg: -8, speed: 250,
        wpts: [[13000, 25500], [-6000, 24000], [12000, 22500], [-6000, 21000], [10000, 16500],
          ...ringLaps(5)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: -1000, y: 3000, r: 2500 } },   // the run-in over the water
      { id: 2, kind: "destroy_tag", bfIdx: [6, 7], need: 2 },                // the site: dish + rail (boot rows)
      { id: 3, kind: "destroy_tag", bfIdx: [10, 11, 13, 16], need: 4 },      // the scatter (spawned slots)
    ],
    winWhen: [2, 3], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 491 },
      { on: TRIG.ON_TIME, t: 25, lineId: 494 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 498 },   // tally the yard
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 495 },   // THE TURN
      { on: TRIG.ON_TIME, t: 275, lineId: 499 },             // sentinel backstop, un-gated (entry ≈ 322 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 496 },   // victory
      { on: TRIG.ON_TIME, t: 1200, lineId: 517 },            // 5-min clock warning
      { on: TRIG.ON_TIME, t: 1500, lineId: 497 },            // timeout defeat
    ],
    scoreKm: 2.0,
  },
};
