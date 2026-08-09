// V01 "HOLD THE NARROWS" — fjord convoy protection (phase 11 INC-7).
// Fantasy: three friendly hulls at anchor in golden light, sea-skimming
// raiders coming down the Sound in waves, and you as the only umbrella.
// First blue naval units in the campaign (amendment 7's ASHM bridge: the
// raiders are A1 SAM-clone shooters re-aimed at side-1 ships).
//
// 7-BEAT SHEET:
//   1 BRIEF      321-323 — the convoy, the skimmers, the stakes
//   2 SPAWN      ON_START 321
//   3 INGRESS    spawn (0,-6000) -> convoy (~1500,-25500) ≈ 19.6 km down
//                the Sound ≈ 85-90 s at speed; 324 at t25, 329 at t80
//   4 OBJ A      obj 2: splash wave 1 — two raiders on a ~29 km run
//                (≈ 121 s at cruise 240, ATTACK dive from 8 km at ~ 88 s,
//                launch ≈ 110-120 s): the race is honest — they target the
//                DESTROYER (hp 120: survives both missiles even unopposed,
//                so an imperfect first intercept wounds, never loses)
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 325: the second stream was always
//                airborne. AMBUSH TIMING TRICK: wave 2 spawns at START on
//                ~75 km glacier-line dog-legs. DIVE COMMIT ≈ 281 s: the
//                route crosses ATTACK_R (8 km from the tankers) at ~67 km
//                cumulative, on the (-12000,-27000)->(-4000,-25000) leg —
//                the full 75.4 km route-to-target figure (≈ 314 s) is the
//                UNCOMMITTED walk, not the dive (D-073 SHOULD: this header
//                is the template for the next 24 sorties — document the
//                commit crossing, not the terminus). The push lands at
//                ~4.7 min targeting the TANKERS (hp 80: two hits kill —
//                now the intercept has to be clean). ON_TIME t=270
//                backstop 394 announces it even if obj 2 froze on a
//                wave-1 egresser (D-073 SHOULD).
//   6 CLIMAX     obj 3: three-ship stream against the tankers
//   7 RESOLUTION 326 victory / 327 hull-loss defeat (protect need 1)
//
// GUARDRAILS: zero shooters ever target the player (raiders are engage-less
// A1; VALDEZ boot zsu/TEL are 9-14 km east of the anchorage). Bandits
// 2+3 = 5 <= 8.
//
// POOL/capacity (VALDEZ n=7): cargo_ship -> slots 43,45 (2 of 2 reserve),
// destroyer -> slot 44 (1 of 2). protect bfIdx below IS that deterministic
// assignment. Anchorage cells probed real water (heightAt = -15 m).

import { TRIG } from "../../game/missions.js";

export default {
  id: "V01",
  front: "VALDEZ",
  titleId: 320,
  briefingIds: [321, 322, 323],
  meta: { turnObj: 2, turnLineId: 325, victoryLineId: 326, defeatLineId: 327 },
  spec: {
    v: 1, kind: "authored",
    front: "VALDEZ",
    type: "fleet_defense",
    seed: 0x5ea11d,
    todH: 21.4, weatherIdx: 0,
    playerSpawn: { x: 0, y: -6000, alt: 3600, headingDeg: -85.6, speed: 220 },
    airfield: { x: 0, y: -6000, r: 600 },
    // the convoy: tankers tag 10, escort destroyer tag 11 (wave targeting)
    units: [
      ["cargo_ship", 1500, -25500, 0.9, 1, 10],
      ["cargo_ship", 1800, -26800, 1.1, 1, 10],
      ["destroyer", 1200, -24500, 0.8, 1, 11],
    ],
    paths: {},
    bandits: [
      // wave 1 (tag 20): ~29 km run at the ESCORT (attackTag 11)
      { kind: "fighter", tier: 1, x: -27000, y: -24000, z: 900, headingDeg: -15, speed: 250, tag: 20, side: 0, attackTag: 11,
        wpts: [[-16000, -27000], [-6000, -25200], [1200, -24500]] },
      { kind: "fighter", tier: 1, x: -26000, y: -27500, z: 1100, headingDeg: 0, speed: 250, tag: 20, side: 0, attackTag: 11,
        wpts: [[-14000, -26500], [-4000, -24800], [1200, -24500]] },
      // wave 2 (tag 21): ~75 km glacier-line dog-legs at the TANKERS
      // (cumulative km: 8.2/19.9/31.2/42.0/51.4/61.6/69.9/75.4; ATTACK_R
      // crossed at ~67.3 km on the 7th leg -> dive commit ≈ 281 s)
      { kind: "fighter", tier: 2, x: -28000, y: -22000, z: 1000, headingDeg: 20, speed: 250, tag: 21, side: 0, attackTag: 10,
        wpts: [[-26000, -14000], [-16000, -8000], [-24000, -16000], [-14000, -20000], [-22000, -25000], [-12000, -27000], [-4000, -25000], [1500, -25500]] },
      { kind: "fighter", tier: 2, x: -29000, y: -20500, z: 1300, headingDeg: 20, speed: 250, tag: 21, side: 0, attackTag: 10,
        wpts: [[-26800, -13200], [-16800, -7200], [-24800, -15200], [-14800, -19200], [-22800, -24200], [-12800, -26400], [-4800, -24600], [1500, -25500]] },
      { kind: "fighter", tier: 2, x: -27200, y: -23400, z: 1600, headingDeg: 20, speed: 250, tag: 21, side: 0, attackTag: 10,
        wpts: [[-25200, -14800], [-15200, -8800], [-23200, -16800], [-13200, -20800], [-21200, -25800], [-11200, -27600], [-3200, -25400], [1500, -25500]] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 1500, y: -25200, r: 3000 } },  // on station over the convoy
      { id: 2, kind: "destroy_tag", air: true, tag: 20, need: 2 },           // wave 1
      { id: 3, kind: "destroy_tag", air: true, tag: 21, need: 3 },           // wave 2 (the real push)
      { id: 4, kind: "protect_tag", bfIdx: [43, 45, 44], need: 1 },          // any hull lost = defeat
    ],
    winWhen: [2, 3], loseWhen: [4],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 321 },
      { on: TRIG.ON_TIME, t: 25, lineId: 324 },
      { on: TRIG.ON_TIME, t: 80, lineId: 329 },              // skimmers confirmed
      { on: TRIG.ON_TIME, t: 270, lineId: 394 },             // wave-2 backstop, un-gated (D-073 SHOULD)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 328 },   // on station
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 325 },   // THE TURN
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 326 },   // victory
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 4, lineId: 327 }, // hull loss
      { on: TRIG.ON_TIME, t: 1500, lineId: 399 },            // defense timeout = VICTORY flavor (D-073 SHOULD)
    ],
    scoreKm: 2.5,
  },
};
