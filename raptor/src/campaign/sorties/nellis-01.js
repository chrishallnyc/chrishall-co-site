// N01 "FIRST BLOOD" — the campaign's opening sortie (phase 11 INC-7).
// Fantasy: your first pull of the war — a moving convoy kill that turns into
// your first air-to-air blood. Early-campaign seal-clubbing per Part B: the
// bandits are tier-1 liners (they jink, they never shoot back).
//
// 7-BEAT SHEET (Part B §0, binding):
//   1 BRIEF      lines 301-303 (card) — moving column, ZSU escort, stakes
//   2 SPAWN      ON_START 301 at t≈0
//   3 INGRESS    spawn (-12000,-2000) -> column (~9.5,-14.5) km ≈ 24.9 km
//                ≈ 100-110 s at 220-250 m/s; flavor 304 at t25, 309 at t75
//   4 OBJ A      obj 2: destroy the DRIVING column (units+paths — the trucks
//                crawl the southeast road at 8 m/s toward the pass). The
//                column runs the SE basin, deliberately 7+ km clear of the
//                standing SAM site — N01 never mixes rails into first blood.
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 305: two-ship already inbound.
//                AMBUSH TIMING TRICK (spec.bandits spawn at START): the pair
//                launches from the NE corner with a ~68 km dog-leg ingress —
//                at fighter cruise 240 m/s that's ≈ 283 s to the column
//                area, i.e. they ARRIVE around the time a competent convoy
//                kill lands (ingress ~105 s + gun passes ~2-3 min). The turn
//                comms is the reveal, not the spawn: the threat was always
//                airborne (pool doctrine — no trigger ever spawns geometry).
//   6 CLIMAX     obj 3: first air kills — tier-1 liners on a racetrack
//                over the column: ~56 s/lap, laps authored out to ≈ 832 s
//                sim (panel MUST-1: engage-less tier-1s EGRESS off-map
//                forever once their route runs dry — despawn is BINGO-only
//                — so the loiter must outlast a slow player, not a fast one)
//   7 RESOLUTION 306 victory on obj 3 / 307 timeout
//
// GUARDRAILS (amendment 5): the only shooter within 5 km of any N01
// objective is the column's own spawned ZSU escort (boot zsu 4/5 and the
// SAM site TELs are all 7+ km from the column line) = 1 <= 4. The bandit
// pair is tier 1 (A2-capped — CANNOT engage, never fires: they jink, you
// learn). Bandit count 2 <= 8.
//
// POOL/capacity (verified vs battlefield.js RESERVE_TYPES, NELLIS n=12):
// 4 supply_truck -> slots 12,13,15,18 (of 16 reserve trucks); 1 zsu -> slot
// 14 (of 10). destroy bfIdx below IS that deterministic slot assignment.

import { TRIG } from "../../game/missions.js";

// n racetrack laps between two waypoints, as plain [[x,y],...] data
const laps = (a, b, n) => Array.from({ length: n }, () => [a, b]).flat();

export default {
  id: "N01",
  front: "NELLIS",
  titleId: 300,
  briefingIds: [301, 302, 303],
  // meta-world battery/HUD hints (not part of the validated MissionSpec)
  meta: { turnObj: 2, turnLineId: 305, victoryLineId: 306, defeatLineId: 307 },
  spec: {
    v: 1, kind: "authored",
    front: "NELLIS",
    type: "strike",
    seed: 0x1b100d,
    todH: 15.5, weatherIdx: 0,
    playerSpawn: { x: -12000, y: -2000, alt: 3600, headingDeg: -30.2, speed: 220 },
    airfield: { x: -3000, y: -8700, r: 900 },
    // second-echelon column: 4 movers + gun truck, driving for the pass
    units: [
      ["supply_truck", 9500, -14500, -2.2, 0, 3],
      ["supply_truck", 9560, -14440, -2.2, 0, 3],
      ["supply_truck", 9620, -14380, -2.2, 0, 3],
      ["supply_truck", 9680, -14320, -2.2, 0, 3],
      ["zsu", 9600, -14600, 0.4, 0, 3],
    ],
    paths: { 3: [[5200, -12800], [2600, -12000], [0, -12500]] }, // SE road, west for the pass
    // THE TURN pair: NE-corner spawn, ~68 km ingress (≈283 s at cruise 240),
    // then racetrack laps over the column area — 13.5 km ≈ 56 s per lap,
    // 10 lap pairs authored: loiter holds to ≈ 832 s (b1) / ≈ 812 s (b2)
    // before egress (panel MUST-1 soft-lock fix: obj 3 is win-required, so
    // the pair must still be on-map for slow players)
    bandits: [
      { kind: "fighter", tier: 1, x: 24000, y: 20000, z: 4200, headingDeg: -135, speed: 240, tag: 5, side: 0,
        wpts: [[24000, 6000], [14000, 16000], [24000, -2000], [16000, -10000], [9000, -13500],
          ...laps([6000, -16000], [11000, -11500], 10)] },
      { kind: "fighter", tier: 1, x: 26000, y: 18000, z: 3800, headingDeg: -135, speed: 240, tag: 5, side: 0,
        wpts: [[26000, 7000], [16000, 15000], [25000, -3500], [17000, -11000], [10000, -14500],
          ...laps([7000, -17000], [12000, -12500], 10)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 8600, y: -13800, r: 2500 } },      // eyes on the road
      { id: 2, kind: "destroy_tag", bfIdx: [12, 13, 15, 18], need: 4 },          // the driving column (spawned slots)
      { id: 3, kind: "destroy_tag", air: true, tag: 5, need: 2 },                // first blood
    ],
    winWhen: [2, 3], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 301 },
      { on: TRIG.ON_TIME, t: 25, lineId: 304 },              // ingress flavor (first event <= 90 s)
      { on: TRIG.ON_TIME, t: 75, lineId: 309 },              // the column is MOVING
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 308 },   // tally call
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 305 },   // THE TURN
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 306 },   // victory
      { on: TRIG.ON_TIME, t: 1200, lineId: 396 },            // 5-min clock warning (D-073 SHOULD)
      { on: TRIG.ON_TIME, t: 1500, lineId: 307 },            // timeout defeat (state-agnostic reword, D-073 SHOULD)
    ],
    scoreKm: 2.0,
  },
};
