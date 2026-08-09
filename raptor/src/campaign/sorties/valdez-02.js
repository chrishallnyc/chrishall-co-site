// V02 "RACE THE SOUND" — valley intercept footrace (phase 11 INC-7).
// Fantasy: pure speed — drones are already through the passes and the only
// variable is how fast you close. Then the second stream brings a shadow:
// BOREAS (engine.js ACES VALDEZ id 2), the high-altitude slasher.
//
// 7-BEAT SHEET:
//   1 BRIEF      331-333 — the raid, the fence, the footrace
//   2 SPAWN      ON_START 331 (scramble fiction: you launch off the pad)
//   3 INGRESS    the intercept IS the ingress: stream one spawns ~28 km NE
//                (D-073 SHOULD: +5 km along its own axis = ~+28 s of
//                runway; position only, still spawns at START), 180 m/s
//                direct-ish -> fence in ≈ 155-170 s. Closing at 420+ m/s
//                you merge inside 80 s. 334 at t20, 338 "Judy" at t40
//                (the player finally speaks — D-073 orphan wired), 339 at
//                t45 (moved off t60 so it can't count down a dead raid).
//   4 OBJ A      obj 1: splash stream one (3 drones, tag 30)
//   5 THE TURN   ON_OBJECTIVE_DONE(1) -> 335 + BOREAS taunt 384. AMBUSH
//                TIMING TRICK: stream two + BOREAS spawn at START in the
//                far NW on ~64-75 km dog-legs (≈ 360-420 s at drone cruise
//                180) — while you race stream one they are crossing the
//                glacier line; the turn reveals what was always inbound.
//                395 at t330 is the state-agnostic stream-two clock.
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
      // stream one (tag 30): ~28 km out (spawns pushed +5 km up their own
      // axis, D-073 SHOULD), direct for the fence — the race. Fence walks
      // at 180: d1 15.8+12.0 = 27.9 km ≈ 155 s · d2 15.7+12.4 = 28.1 km
      // ≈ 156 s · d3 17.8+12.6 = 30.4 km ≈ 169 s.
      { kind: "drone", tier: 1, x: 17000, y: 16000, z: 3200, headingDeg: -128, speed: 180, tag: 30, side: 0,
        wpts: [[8000, 3000], [0, -6000]] },
      { kind: "drone", tier: 1, x: 19000, y: 14500, z: 3400, headingDeg: -128, speed: 180, tag: 30, side: 0,
        wpts: [[9500, 2000], [0, -6000]] },
      { kind: "drone", tier: 1, x: 18000, y: 18500, z: 3000, headingDeg: -128, speed: 180, tag: 30, side: 0,
        wpts: [[7000, 4500], [0, -6000]] },
      // stream two (tag 31): NW dog-legs ~71 km (≈ 395 s at 180) — inbound
      // from spawn, revealed at the turn
      { kind: "drone", tier: 1, x: -20000, y: 16000, z: 3600, headingDeg: -20, speed: 180, tag: 31, side: 0,
        wpts: [[-8000, 10000], [-16000, 2000], [-4000, 6000], [-12000, -2000], [-2000, -1000], [0, -6000]] },
      { kind: "drone", tier: 1, x: -22000, y: 14000, z: 3900, headingDeg: -20, speed: 180, tag: 31, side: 0,
        wpts: [[-9500, 8800], [-17500, 800], [-5500, 4800], [-13500, -3200], [-3500, -2200], [0, -6000]] },
      { kind: "drone", tier: 1, x: -18000, y: 18000, z: 3300, headingDeg: -20, speed: 180, tag: 31, side: 0,
        wpts: [[-6500, 11200], [-14500, 3200], [-2500, 7200], [-10500, -800], [-500, 200], [0, -6000]] },
      // BOREAS (tag 33): shadows stream two 2.5 km above — engages himself
      // when you come for his drones. D-073 SHOULD: route lengthened
      // +19.4 km with two NW dog-legs so his fence arrival MATCHES his
      // drones instead of leading them by ~80 s. Cum walk at cruise 240:
      // 14.4/24.4/34.8/46.1/58.8/70.8/80.9/85.8 km -> fence ≈ 357 s vs
      // stream two ≈ 356-417 s. His mid-route still rides the NW-push
      // track (legs 3-7 are the drone dog-legs offset ~2 km), so he still
      // crosses ENGAGE_R (10 km) of the intercept — re-verified.
      { kind: "fighter", tier: 3, aceId: 2, engage: true, tag: 33, side: 0,
        x: -24000, y: 18000, z: 6000, headingDeg: -20, speed: 260,
        wpts: [[-12000, 26000], [-4000, 20000], [-10000, 11500], [-18000, 3500], [-6000, 7500], [-14000, -1500], [-4000, -500], [-2000, -5000]] },
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
      { on: TRIG.ON_TIME, t: 40, lineId: 338 },              // "Judy." — the player speaks (D-073 orphan wired)
      { on: TRIG.ON_TIME, t: 45, lineId: 339 },              // the clock talks (moved off t60, D-073 SHOULD)
      { on: TRIG.ON_TIME, t: 330, lineId: 395 },             // stream-two clock, state-agnostic (D-073 SHOULD)
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
