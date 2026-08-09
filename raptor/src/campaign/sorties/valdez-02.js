// V02 "RACE THE SOUND" — valley intercept footrace (phase 11 INC-7).
// Fantasy: pure speed — drones are already through the passes and the only
// variable is how fast you close. Then the second stream brings a shadow:
// BOREAS (engine.js ACES VALDEZ id 2), the high-altitude slasher.
//
// 7-BEAT SHEET:
//   1 BRIEF      331-333 — the raid, the fence, the footrace
//   2 SPAWN      ON_START 331 (scramble fiction: you launch off the pad)
//   3 INGRESS    the intercept IS the ingress: stream one spawns ~23 km NE,
//                180 m/s direct-ish -> fence in ≈ 130-150 s. Closing at
//                420+ m/s you merge inside 60 s. 334 at t20, 339 at t60.
//   4 OBJ A      obj 1: splash stream one (3 drones, tag 30)
//   5 THE TURN   ON_OBJECTIVE_DONE(1) -> 335 + BOREAS taunt 384. AMBUSH
//                TIMING TRICK: stream two + BOREAS spawn at START in the
//                far NW on ~64-75 km dog-legs (≈ 360-420 s at drone cruise
//                180) — while you race stream one they are crossing the
//                glacier line; the turn reveals what was always inbound.
//   6 CLIMAX     obj 2: stream two with BOREAS riding 2.5 km above it —
//                his engage commit (10 km) triggers exactly when you come
//                for his drones. Kill him for 387, or he BINGOs out (386).
//   7 RESOLUTION 336 victory / 337 fence-crossed defeat (zone denial)
//
// GUARDRAILS: exactly ONE thing ever shoots at the player (BOREAS; drones
// are unarmed, no ground shooters within 5 km of the pad). Bandits
// 3+3+1 = 7 <= 8. Player supercruise outruns everything (dash cap 420).

import { TRIG } from "../../game/missions.js";

export default {
  id: "V02",
  front: "VALDEZ",
  titleId: 330,
  briefingIds: [331, 332, 333],
  meta: { turnObj: 1, turnLineId: 335, victoryLineId: 336, defeatLineId: 337 },
  spec: {
    v: 1, kind: "authored",
    front: "VALDEZ",
    type: "intercept",
    seed: 0xd201e5,
    todH: 12, weatherIdx: 0,
    playerSpawn: { x: 0, y: -6000, alt: 3600, headingDeg: 52.1, speed: 240 },
    airfield: { x: 0, y: -6000, r: 600 },
    units: [],
    paths: {},
    bandits: [
      // stream one (tag 30): ~23 km out, direct for the fence — the race
      { kind: "drone", tier: 1, x: 14000, y: 12000, z: 3200, headingDeg: -128, speed: 180, tag: 30, side: 0,
        wpts: [[8000, 3000], [0, -6000]] },
      { kind: "drone", tier: 1, x: 16000, y: 10500, z: 3400, headingDeg: -128, speed: 180, tag: 30, side: 0,
        wpts: [[9500, 2000], [0, -6000]] },
      { kind: "drone", tier: 1, x: 15000, y: 14500, z: 3000, headingDeg: -128, speed: 180, tag: 30, side: 0,
        wpts: [[7000, 4500], [0, -6000]] },
      // stream two (tag 31): NW dog-legs ~71 km (≈ 395 s at 180) — inbound
      // from spawn, revealed at the turn
      { kind: "drone", tier: 1, x: -20000, y: 16000, z: 3600, headingDeg: -20, speed: 180, tag: 31, side: 0,
        wpts: [[-8000, 10000], [-16000, 2000], [-4000, 6000], [-12000, -2000], [-2000, -1000], [0, -6000]] },
      { kind: "drone", tier: 1, x: -22000, y: 14000, z: 3900, headingDeg: -20, speed: 180, tag: 31, side: 0,
        wpts: [[-9500, 8800], [-17500, 800], [-5500, 4800], [-13500, -3200], [-3500, -2200], [0, -6000]] },
      { kind: "drone", tier: 1, x: -18000, y: 18000, z: 3300, headingDeg: -20, speed: 180, tag: 31, side: 0,
        wpts: [[-6500, 11200], [-14500, 3200], [-2500, 7200], [-10500, -800], [-500, 200], [0, -6000]] },
      // BOREAS (tag 33): shadows stream two 2.5 km above, ~26 km behind the
      // player's first merge — engages himself when you come for his drones
      { kind: "fighter", tier: 3, aceId: 2, engage: true, tag: 33, side: 0,
        x: -24000, y: 18000, z: 6000, headingDeg: -20, speed: 260,
        wpts: [[-10000, 11500], [-18000, 3500], [-6000, 7500], [-14000, -1500], [-4000, -500], [-2000, -5000]] },
    ],
    objectives: [
      { id: 1, kind: "destroy_tag", air: true, tag: 30, need: 3 },   // stream one
      { id: 2, kind: "destroy_tag", air: true, tag: 31, need: 3 },   // stream two
      { id: 3, kind: "protect_tag", air: true, tag: 30, zone: { x: 0, y: -6000, r: 3000 } }, // fence denial
      { id: 4, kind: "protect_tag", air: true, tag: 31, zone: { x: 0, y: -6000, r: 3000 } },
    ],
    winWhen: [1, 2], loseWhen: [3, 4],
    timeLimitS: 900,
    comms: [
      { on: TRIG.ON_START, lineId: 331 },
      { on: TRIG.ON_TIME, t: 20, lineId: 334 },
      { on: TRIG.ON_TIME, t: 60, lineId: 339 },              // the clock talks
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 335 },   // THE TURN
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 384 },   // BOREAS on guard
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 336 },   // victory
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 3, lineId: 337 }, // over the fence
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 4, lineId: 337 },
      { on: TRIG.ON_ACE_STATE, aceId: 2, aceState: "smoking", lineId: 385 },
      { on: TRIG.ON_ACE_STATE, aceId: 2, aceState: "escaped", lineId: 386 },
      { on: TRIG.ON_ACE_STATE, aceId: 2, aceState: "killed", lineId: 387 },
    ],
    scoreKm: 1.5,
  },
};
