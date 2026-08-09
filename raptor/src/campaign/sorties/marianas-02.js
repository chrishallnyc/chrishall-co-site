// M02 "THE HORNET'S NEST" — carrier strike with the SHRIKE set-piece
// (phase 11 INC-7). Fantasy: the biggest target in the theater dies under
// your gun — and the moment it starts going down, the haze answers. SHRIKE
// (engine.js ACES MARIANAS id 4, "gun ambusher out of the haze") kept his
// flight back for exactly this. TYPHOON stays finale-only per the plan.
//
// 7-BEAT SHEET:
//   1 BRIEF      351-353 — the group, the hull math, the name in the haze
//   2 SPAWN      ON_START 351
//   3 INGRESS    spawn (8000,-14000) -> push point (-8000,-2000) ≈ 20 km ≈
//                90 s, carrier station 24 km beyond; 354 at t25, 359 at t70
//   4 OBJ A      obj 2: carrier (hp 250) + destroyer screen (hp 120) —
//                boot rows 0,1; a real multi-pass rearm mission in play
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 355 + SHRIKE guard taunt 388.
//                AMBUSH TIMING TRICK: SHRIKE + 2 wingmen spawn at START in
//                the far NE haze; loiter legs stay >= 16 km from the
//                carrier until ~49 km cumulative (≈ 205 s at cruise 240),
//                then the route descends to a 4-9 km ring over the station
//                (~280-320 s) — arriving as a competent group kill lands —
//                and HOLDS it to ≈ 805 s (panel MUST-4 lap extension).
//                ENGAGE (10 km commit) fires when you're there; the turn
//                line is the reveal of a flight that was always airborne.
//   6 CLIMAX     obj 4: beat the ambush — destroy_tag air need 1 on
//                SHRIKE's own tag counts !live, so killing him OR putting
//                a 9X into him and watching the smoking BINGO run (one hit
//                = 30 hp < 40, amendment 1) both complete it. The beat is
//                mandatory and can only resolve through the fight, so the
//                victory line never fires in a doomed run (a survive_until
//                anchor would self-complete on the clock even in losses).
//                obj 3 (kill_ace SHRIKE) stays OPTIONAL GLORY — outside
//                winWhen/loseWhen: the kill pays 391, the escape pays 390,
//                neither is ever a fail state.
//   7 RESOLUTION 356 victory once the group is sunk and SHRIKE is out of
//                the fight / 357 timeout
//
// GUARDRAILS: obj-2 phase shooters = 0 ground (Tinian guns are 15+ km
// away) + 0 air (SHRIKE's flight >= 16 km by route until ~205 s). Turn
// phase = SHRIKE + 2 wingmen = 3 <= 4. Bandits 3 <= 8. Difficulty is pure
// composition: tier-3 ace + tier-2 wingmen, no stat inflation.

import { TRIG } from "../../game/missions.js";

// n racetrack laps between two waypoints, as plain [[x,y],...] data
const laps = (a, b, n) => Array.from({ length: n }, () => [a, b]).flat();

export default {
  id: "M02",
  front: "MARIANAS",
  titleId: 350,
  briefingIds: [351, 352, 353],
  meta: { turnObj: 2, turnLineId: 355, victoryLineId: 356, defeatLineId: 357 },
  spec: {
    v: 1, kind: "authored",
    front: "MARIANAS",
    type: "anti_ship",
    seed: 0x54121e,
    todH: 15.5, weatherIdx: 0,
    playerSpawn: { x: 8000, y: -14000, alt: 3600, headingDeg: 141.7, speed: 220 },
    airfield: { x: -3200, y: -8000, r: 600 },
    units: [],
    paths: {},
    // SHRIKE's flight: haze loiter (every leg >= 16 km from the carrier
    // until ~205 s), then the descent ring (4-9 km) over the station.
    // Ring legs are ~8.5 km ≈ 35 s each; 6 extra lap pairs per airframe
    // (panel MUST-4) hold the flight on station to ≈ 805 s — obj 4 is
    // win-required and line 352 sends players on a ~280-500 s Andersen
    // rearm round trip, so route exhaustion at ~451 s was an escape hole.
    bandits: [
      { kind: "fighter", tier: 3, aceId: 4, engage: true, tag: 40, side: 0,
        x: -18000, y: 24000, z: 4800, headingDeg: -10, speed: 260,
        wpts: [[-8000, 26000], [-2000, 20000], [-12000, 22000], [-4000, 16000], [-14000, 18000], [-16000, 10000], [-10000, 4000], [-16000, -2000], [-10000, 4000], [-16000, 10000],
          ...laps([-10000, 4000], [-16000, -2000], 6)] },
      { kind: "fighter", tier: 2, engage: true, tag: 41, side: 0,
        x: -22000, y: 26000, z: 4200, headingDeg: -10, speed: 250,
        wpts: [[-9500, 27500], [-3500, 21500], [-13500, 23500], [-5500, 17500], [-15500, 19500], [-17500, 11500], [-11500, 5500], [-17500, -500], [-11500, 5500], [-17500, 11500],
          ...laps([-11500, 5500], [-17500, -500], 6)] },
      { kind: "fighter", tier: 2, engage: true, tag: 41, side: 0,
        x: -14000, y: 27000, z: 5400, headingDeg: -10, speed: 250,
        wpts: [[-6500, 24500], [-500, 18500], [-10500, 20500], [-2500, 14500], [-12500, 16500], [-14500, 8500], [-8500, 2500], [-14500, -3500], [-8500, 2500], [-14500, 8500],
          ...laps([-8500, 2500], [-14500, -3500], 6)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: -8000, y: -2000, r: 2500 } },  // the push point
      { id: 2, kind: "destroy_tag", bfIdx: [0, 1], need: 2 },                // carrier + screen (boot rows)
      { id: 3, kind: "kill_ace", aceId: 4 },                                 // OPTIONAL: SHRIKE himself, for keeps
      { id: 4, kind: "destroy_tag", air: true, tag: 40, need: 1 },           // the ambush beaten (SHRIKE dead or driven off)
    ],
    winWhen: [2, 4], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 351 },
      { on: TRIG.ON_TIME, t: 25, lineId: 354 },
      { on: TRIG.ON_TIME, t: 70, lineId: 359 },              // the screen wakes up
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 358 },   // tally the group
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 355 },   // THE TURN
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 388 },   // SHRIKE on guard
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 4, lineId: 356 },   // victory
      { on: TRIG.ON_TIME, t: 1500, lineId: 357 },            // timeout defeat
      { on: TRIG.ON_ACE_STATE, aceId: 4, aceState: "smoking", lineId: 389 },
      { on: TRIG.ON_ACE_STATE, aceId: 4, aceState: "escaped", lineId: 390 },
      { on: TRIG.ON_ACE_STATE, aceId: 4, aceState: "killed", lineId: 391 },
    ],
    scoreKm: 2.5,
  },
};
