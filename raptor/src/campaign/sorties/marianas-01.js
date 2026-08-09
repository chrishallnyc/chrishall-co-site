// M01 "REEF LINE" — fleet defense over the reef (phase 11 INC-7).
// Fantasy: golden-hour anchorage, sea-skimmers running the reef line in
// waves, both hulls still swinging at anchor when it's over. The MARIANAS
// mirror of V01 with its own geometry: raiders come off open water on two
// different axes, so every intercept is a fresh picture.
//
// 7-BEAT SHEET:
//   1 BRIEF      341-343 — the freighter IS the campaign
//   2 SPAWN      ON_START 341
//   3 INGRESS    spawn (-6000,-16000) -> anchorage (~-600,150) ≈ 17 km
//                ≈ 75-85 s; 344 at t25, 349 at t85
//   4 OBJ A      obj 2: wave 1 — two raiders off the EASTERN approach
//                (~26 km, dive at ~75 s, launch ≈ 100-110 s) targeting the
//                DESTROYER screen (hp 120: survives both even unopposed)
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 345. AMBUSH TIMING TRICK: wave 2
//                spawns at START far NORTH on ~67-70 km dog-legs, dive
//                commit ≈ 280-290 s — a new axis, aimed at the FREIGHTER
//                (hp 80: two hits kill). Every MID-ROUTE waypoint holds
//                >= 9.5 km from the anchorage so only the FINAL leg crosses
//                ATTACK_R (8 km) — panel MUST-3: the old route grazed
//                2.8-6.3 km mid-route and committed the dive at ~200 s,
//                erasing the anticipation beat. The turn reveals the wave,
//                never spawns it (pool doctrine: all slots activate at boot).
//   6 CLIMAX     obj 3: the three-ship stream from the north
//   7 RESOLUTION 346 victory / 347 hull-loss defeat (protect need 1)
//
// GUARDRAILS: zero shooters target the player (raiders are engage-less A1;
// nearest boot shooter — the Saipan zsu — is 5.7 km from the anchorage,
// outside the 5 km ring). Bandits 2+3 = 5 <= 8.
//
// POOL/capacity (MARIANAS n=10): cargo_ship -> slot 46 (1 of 1 reserve),
// destroyer -> slot 47 (1 of 1). protect bfIdx below IS that deterministic
// assignment. Anchorage cells probed real water (heightAt = -15 m).

import { TRIG } from "../../game/missions.js";

export default {
  id: "M01",
  front: "MARIANAS",
  titleId: 340,
  briefingIds: [341, 342, 343],
  meta: { turnObj: 2, turnLineId: 345, victoryLineId: 346, defeatLineId: 347 },
  spec: {
    v: 1, kind: "authored",
    front: "MARIANAS",
    type: "fleet_defense",
    seed: 0x2eef11,
    todH: 17.8, weatherIdx: 0,
    playerSpawn: { x: -6000, y: -16000, alt: 3600, headingDeg: 71.5, speed: 220 },
    airfield: { x: -3200, y: -8000, r: 600 },
    // the resupply pair: freighter tag 10, destroyer screen tag 11
    units: [
      ["cargo_ship", 0, 0, 0.4, 1, 10],
      ["destroyer", -1200, 300, 0.6, 1, 11],
    ],
    paths: {},
    bandits: [
      // wave 1 (tag 20): eastern approach, on the deck, at the SCREEN
      { kind: "fighter", tier: 1, x: 24000, y: 6000, z: 700, headingDeg: 165, speed: 250, tag: 20, side: 0, attackTag: 11,
        wpts: [[12000, 2600], [-1200, 300]] },
      { kind: "fighter", tier: 1, x: 25000, y: 3500, z: 900, headingDeg: 170, speed: 250, tag: 20, side: 0, attackTag: 11,
        wpts: [[13000, 1500], [-1200, 300]] },
      // wave 2 (tag 21): northern axis at the FREIGHTER. Cum-distance walk
      // (cruise 240, commit at 8 km along the final leg):
      //   w2a 14.6/28.0/42.5/53.9/64.2 + 3.0  -> 67.2 km ≈ 280 s
      //   w2b 15.3/28.7/43.3/54.6/64.9 + 4.8  -> 69.7 km ≈ 290 s
      //   w2c 14.6/28.0/42.6/54.8/65.2 + 2.2  -> 67.4 km ≈ 281 s
      // All mid-route waypoints >= 9.5 km from (0,0) — only the final leg
      // crosses ATTACK_R (panel MUST-3 route fix).
      { kind: "fighter", tier: 2, x: 8000, y: 24000, z: 1000, headingDeg: -155, speed: 250, tag: 21, side: 0, attackTag: 10,
        wpts: [[-6000, 20000], [6000, 14000], [-8000, 10000], [-500, 18500], [5000, 9800], [0, 0]] },
      { kind: "fighter", tier: 2, x: 10000, y: 26000, z: 1300, headingDeg: -155, speed: 250, tag: 21, side: 0, attackTag: 10,
        wpts: [[-4500, 21200], [7500, 15200], [-6500, 11200], [1000, 19700], [6500, 11000], [0, 0]] },
      { kind: "fighter", tier: 2, x: 5500, y: 25500, z: 1600, headingDeg: -155, speed: 250, tag: 21, side: 0, attackTag: 10,
        wpts: [[-7500, 18800], [4500, 12800], [-9500, 8800], [-2000, 18400], [3500, 9600], [0, 0]] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: -600, y: 150, r: 3000 } },   // on station over the reef
      { id: 2, kind: "destroy_tag", air: true, tag: 20, need: 2 },         // wave 1
      { id: 3, kind: "destroy_tag", air: true, tag: 21, need: 3 },         // wave 2
      { id: 4, kind: "protect_tag", bfIdx: [46, 47], need: 1 },            // any hull lost = defeat
    ],
    winWhen: [2, 3], loseWhen: [4],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 341 },
      { on: TRIG.ON_TIME, t: 25, lineId: 344 },
      { on: TRIG.ON_TIME, t: 85, lineId: 349 },              // contacts east
      { on: TRIG.ON_TIME, t: 255, lineId: 393 },             // wave-2 backstop, un-gated (D-073 SHOULD; dive ≈ 280-290 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 348 },   // on station
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 345 },   // THE TURN
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 346 },   // victory
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 4, lineId: 347 }, // hull loss
      { on: TRIG.ON_TIME, t: 1500, lineId: 440 },            // defense timeout = VICTORY flavor (D-073 SHOULD)
    ],
    scoreKm: 2.5,
  },
};
