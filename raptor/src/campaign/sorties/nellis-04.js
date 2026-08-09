// N04 "JACKAL'S DEBT" — the nemesis rematch (phase 11 INC-8 batch 1).
// Fantasy: a staged air duel. Someone wearing JACKAL's paint (engine.js
// ACES NELLIS id 1 — the brief hedges "the man or a copycat" so the sortie
// reads true whether N02 ended in a kill or an escape) sweeps the north
// range with two students on the racetrack as BAIT. Take the bait fast;
// the paint comes down to collect. TYPHOON stays finale-only.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      371-373 — the paint, the students, the debt
//   2 SPAWN      ON_START 371; 441 return taunt on guard at t45
//   3 INGRESS    spawn (-10000,-8000) -> gate (2000,4000) ≈ 16.9 km
//                ≈ 75 s; 374 at t25
//   4 OBJ A      obj 2: the students — two TIER-1 fighters (all paint, no
//                teeth: A2-capped, they jink and never shoot) on a range
//                racetrack. 10 lap pairs of the 10.8 km leg hold them to
//                ≈ 885 s before egress (measured walk; D-073 route LAW:
//                win-required + engage-less = the loiter must outlast a
//                slow player — inside the house 800-1000 s window).
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 375: the paint turns in.
//                AMBUSH TIMING TRICK: JACKAL (tier 4, engage, aceId 1)
//                spawns at START in the far NE on an 88.3 km sweep whose
//                every pre-entry LEG (measured per-leg, not per-waypoint)
//                holds >= 15.9 km from the racetrack fight (outside his
//                10 km ENGAGE commit while you work the students); he
//                enters an 11 km ring around the range at ≈ 87.3 km
//                ≈ 364 s — on pace you kill the pair at ~200-280 s and
//                he arrives on the turn's heels — then rides 3 ring laps
//                (56 km ≈ 233 s each) out to ≈ 1068 s total route.
//   6 CLIMAX     obj 3: the duel — destroy_tag air need 1 on his tag
//                counts !live, so a KILL (383) and a smoking BINGO escape
//                over the fence (382, amendment 1) BOTH complete it (the
//                N02 grammar: the objective only resolves through the
//                fight). obj 4 kill_ace stays OPTIONAL GLORY outside
//                winWhen/loseWhen — the kill is for keeps, the escape is
//                never a fail state.
//   7 RESOLUTION 376 victory / 377 timeout (offense cap: the clock warns
//                at t=1200 via 379)
// ENVELOPE: median session ≈ 8-9 min (gate ~80 s, students ~200-280 s,
// JACKAL arrives ~364 s, duel ~420-540 s); THE TURN ≈ 45-50% of median.
//
// GUARDRAILS (amendment 5): exactly ONE thing in N04 ever shoots at the
// player — JACKAL (tier-4 AAM env 3400 + gun, dash cap 420 intact). The
// students are tier-1 A2 (CANNOT engage, never fire). No boot shooter is
// within 12 km of any objective center. Max simultaneous = 1 <= 4.
// Bandits 3 <= 8; engage-capable 1 <= 4. Difficulty via composition:
// tier 4 is the nemesis-return escalation (amendment 1's +tier fiction
// made data), not a stat override.

import { TRIG } from "../../game/missions.js";

// n racetrack laps between two waypoints, as plain [[x,y],...] data
const laps = (a, b, n) => Array.from({ length: n }, () => [a, b]).flat();
// n laps of the 10 km ring around the north range
const ringLaps = (n) => Array.from({ length: n },
  () => [[14000, 16000], [-2000, 16000], [-2000, 4000], [14000, 4000]]).flat();

export default {
  id: "N04",
  front: "NELLIS",
  titleId: 370,
  briefingIds: [371, 372, 373],
  meta: { turnObj: 2, turnLineId: 375, victoryLineId: 376, defeatLineId: 377 },
  spec: {
    v: 1, kind: "authored",
    front: "NELLIS",
    type: "cap",
    seed: 0x1ace04,
    todH: 18.8, weatherIdx: 0,
    playerSpawn: { x: -10000, y: -8000, alt: 3600, headingDeg: 45, speed: 240 },
    airfield: { x: -3000, y: -8700, r: 900 },
    units: [],
    paths: {},
    bandits: [
      // the students (tag 25): tier-1 bait on the range racetrack —
      // 10.8 km legs ≈ 45 s each, 10 lap pairs hold them to ≈ 885 s
      { kind: "fighter", tier: 1, x: 4000, y: 14000, z: 4200, headingDeg: -45, speed: 240, tag: 25, side: 0,
        wpts: [...laps([10000, 8000], [0, 12000], 10)] },
      { kind: "fighter", tier: 1, x: 7000, y: 15500, z: 3800, headingDeg: -58, speed: 240, tag: 25, side: 0,
        wpts: [...laps([11000, 9000], [1000, 13000], 10)] },
      // JACKAL (tag 26): tier-4 ace, explicit A3 opt-in. Sweep legs
      // (cumulative km at cruise 240): 12.6/28.3/38.3/55.4/65.4/73.8 ->
      // 11 km ring entry at ≈ 87.3 km ≈ 364 s; every pre-entry leg's
      // closest approach to the racetrack fight (5000,11750) is 15.9 km
      // (measured per leg, not per waypoint); then THREE 56 km ring laps
      // (≈ 233 s each) cover the slow path to ≈ 1068 s of total route.
      { kind: "fighter", tier: 4, aceId: 1, engage: true, tag: 26, side: 0,
        x: 26000, y: 24000, z: 5600, headingDeg: 160, speed: 260,
        wpts: [[14000, 28000], [26000, 18000], [20000, 26000], [26000, 10000], [20000, 2000], [26000, -4000], [14000, 4000],
          ...ringLaps(3)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 2000, y: 4000, r: 2500 } },   // the gate below the range
      { id: 2, kind: "destroy_tag", air: true, tag: 25, need: 2 },          // the students
      { id: 3, kind: "destroy_tag", air: true, tag: 26, need: 1 },          // the paint off the board (kill or driven off)
      { id: 4, kind: "kill_ace", aceId: 1 },                                // OPTIONAL: the debt, for keeps
    ],
    winWhen: [2, 3], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 371 },
      { on: TRIG.ON_TIME, t: 25, lineId: 374 },
      { on: TRIG.ON_TIME, t: 45, lineId: 441 },              // the paint on guard
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 378 },   // through the gate
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 375 },   // THE TURN
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 376 },   // victory
      { on: TRIG.ON_TIME, t: 1200, lineId: 379 },            // 5-min clock warning
      { on: TRIG.ON_TIME, t: 1500, lineId: 377 },            // timeout defeat
      { on: TRIG.ON_ACE_STATE, aceId: 1, aceState: "smoking", lineId: 381 },
      { on: TRIG.ON_ACE_STATE, aceId: 1, aceState: "escaped", lineId: 382 },
      { on: TRIG.ON_ACE_STATE, aceId: 1, aceState: "killed", lineId: 383 },
    ],
    scoreKm: 2.0,
  },
};
