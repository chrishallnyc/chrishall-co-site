// V04 "SOULS ABOARD" — friendly-air escort at golden hour (phase 11 INC-8
// batch 1). Fantasy: three FRIENDLY transports (the campaign's first
// side-1 air) hold a racetrack over the Sound while hostile fighters race
// to cut the corridor gate at its head. You are the shepherd: kill the
// cut, and check your fire around the big wings.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      411-413 — the souls, the gate, the check-fire rule
//   2 SPAWN      ON_START 411
//   3 INGRESS    spawn (0,-6000) -> transports (1500,-21000) ≈ 15.1 km
//                ≈ 70 s; 414 at t25
//   4 OBJ A      obj 2: the PICKETS — two tier-1 fighters off the NE on
//                ~59 km dog-legs to the gate; the denial ring (r 3500)
//                trips at ≈ 56 km ≈ 235 s unopposed. They are the first
//                clock, briefed up front.
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 415: the sweep breaks out of the
//                weather. AMBUSH TIMING TRICK: three tier-2 ENGAGE
//                fighters (tag 51) spawn at START in the far NW on
//                ~101-103 km dog-legs — the gate ring trips ≈ 413-419 s
//                (measured), landing ~2.5 min after a competent picket
//                kill. ON_TIME t=355 backstop 443 calls the last fjord
//                un-gated, a minute before the ring.
//   6 CLIMAX     obj 3: the sweep fights back (the pickets never could) —
//                three committed fighters between the transports and
//                golden water.
//   7 RESOLUTION 416 victory / 417 gate breached / 418 friendly loss
//                (the only thing that can kill a transport is you)
// ENVELOPE: median session ≈ 8 min (join ~70 s, pickets ~200-250 s, sweep
// fight ~380-460 s, resolution ~470-510 s); THE TURN ≈ 47-50% of median.
//
// ROUTE LAW (D-073): picket and sweep routes TERMINATE inside the gate
// denial zone — unopposed they end the sortie (loseWhen 4/5), so the
// win-required air objectives can never be stranded by route exhaustion.
// DESIGNED SKILL RULE (new to this sortie, document for the panel): the
// sweep is ENGAGE-capable — a committed fighter chases the PLAYER, so a
// player who dogfights on top of the gate can DRAG a live hostile into
// the ring and lose mid-fight. Honest and telegraphed (the gate is the
// briefed protect-object; 415/443 both name it): fight them in the
// fjords, not over the gate.
// The transports lap ~150 km (≈ 1020 s at 150 m/s) — on-map far past any
// resolution; their protect objective (need 1) watches deaths only, and
// nothing red can shoot them: the check-fire rule is real, not decorative.
//
// GUARDRAILS (amendment 5): the sweep is the ONLY thing that ever shoots
// at the player — 3 engage fighters, post-turn (t26 phase model), <= 4.
// Both denial waves spawn 47+ km from every pre-turn objective center
// (ambush honesty); no boot shooter is within 10 km of any center.
// Bandits 2+3+3 = 8 == pool cap (audited exact). Engage 3 <= 4.

import { TRIG } from "../../game/missions.js";

// n racetrack laps between two waypoints, as plain [[x,y],...] data
const laps = (a, b, n) => Array.from({ length: n }, () => [a, b]).flat();

export default {
  id: "V04",
  front: "VALDEZ",
  titleId: 410,
  briefingIds: [411, 412, 413],
  meta: { turnObj: 2, turnLineId: 415, victoryLineId: 416, defeatLineId: 417 },
  spec: {
    v: 1, kind: "authored",
    front: "VALDEZ",
    type: "escort",
    seed: 0x5041b4,
    todH: 21.4, weatherIdx: 0,
    playerSpawn: { x: 0, y: -6000, alt: 3600, headingDeg: -84.3, speed: 220 },
    airfield: { x: 0, y: -6000, r: 600 },
    units: [],
    paths: {},
    bandits: [
      // the transports (tag 60, side 1): three big wings holding the lower
      // Sound racetrack — 12.0 km legs ≈ 80 s each at cruise 150, 6 lap
      // pairs ≈ 1020 s on-map (far past any resolution)
      { kind: "transport", tier: 0, x: 2500, y: -27000, z: 1500, headingDeg: 96, speed: 150, tag: 60, side: 1,
        wpts: [[1500, -18000], ...laps([1000, -10000], [2000, -22000], 6)] },
      { kind: "transport", tier: 0, x: 1000, y: -25500, z: 1700, headingDeg: 96, speed: 150, tag: 60, side: 1,
        wpts: [[500, -17000], ...laps([0, -9000], [1000, -21000], 6)] },
      { kind: "transport", tier: 0, x: 3500, y: -24500, z: 1300, headingDeg: 96, speed: 150, tag: 60, side: 1,
        wpts: [[2500, -16500], ...laps([2000, -8500], [3000, -20500], 6)] },
      // the PICKETS (tag 50): tier-1 probes off the NE. Cum walk at cruise
      // 240: 11.7/21.7/32.4/42.4/53.2/59.1 km; the gate ring (r 3500 at
      // (0,-14000)) trips at ≈ 56.2 km ≈ 235 s unopposed.
      { kind: "fighter", tier: 1, x: 22000, y: 12000, z: 2600, headingDeg: -149, speed: 250, tag: 50, side: 0,
        wpts: [[12000, 6000], [18000, -2000], [8000, -6000], [16000, -12000], [6000, -16000], [500, -13800]] },
      { kind: "fighter", tier: 1, x: 24000, y: 14500, z: 3000, headingDeg: -149, speed: 250, tag: 50, side: 0,
        wpts: [[14000, 8500], [20000, 500], [10000, -3500], [18000, -9500], [8000, -14500], [900, -14400]] },
      // the SWEEP (tag 51): three tier-2 ENGAGE fighters far NW — dog-legs
      // 101.4-102.5 km; the gate ring (r 3500) trips at ≈ 99.1-100.7 km
      // ≈ 413-419 s across the trail (measured); every spawn 47+ km from
      // the pre-turn centers.
      { kind: "fighter", tier: 2, engage: true, x: -24000, y: 20000, z: 3600, headingDeg: 18, speed: 250, tag: 51, side: 0,
        wpts: [[-12000, 24000], [-20000, 14000], [-8000, 16000], [-16000, 6000], [-6000, 8000], [-14000, -2000], [-4000, -4000], [-10000, -12000], [-1500, -14500]] },
      { kind: "fighter", tier: 2, engage: true, x: -26000, y: 17000, z: 4000, headingDeg: 18, speed: 250, tag: 51, side: 0,
        wpts: [[-14000, 21000], [-22000, 11000], [-10000, 13000], [-18000, 3000], [-8000, 5000], [-16000, -5000], [-6000, -7000], [-11500, -13500], [-2200, -15600]] },
      { kind: "fighter", tier: 2, engage: true, x: -22000, y: 23000, z: 3200, headingDeg: 18, speed: 250, tag: 51, side: 0,
        wpts: [[-10000, 27000], [-18000, 17000], [-6000, 19000], [-14000, 9000], [-4000, 11000], [-12000, 1000], [-3000, -1500], [-8500, -10500], [-800, -13000]] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 1500, y: -21000, r: 3000 } },  // joined on the transports
      { id: 2, kind: "destroy_tag", air: true, tag: 50, need: 2 },           // the pickets
      { id: 3, kind: "destroy_tag", air: true, tag: 51, need: 3 },           // the sweep
      { id: 4, kind: "protect_tag", air: true, tag: 50, zone: { x: 0, y: -14000, r: 3500 } }, // gate denial
      { id: 5, kind: "protect_tag", air: true, tag: 51, zone: { x: 0, y: -14000, r: 3500 } },
      { id: 6, kind: "protect_tag", air: true, tag: 60, need: 1 },           // souls aboard (only you can fail this)
    ],
    winWhen: [2, 3], loseWhen: [4, 5, 6],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 411 },
      { on: TRIG.ON_TIME, t: 25, lineId: 414 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 419 },   // the corridor watch
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 415 },   // THE TURN
      { on: TRIG.ON_TIME, t: 355, lineId: 443 },             // sweep backstop, un-gated (gate ring ≈ 413-419 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 416 },   // victory
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 4, lineId: 417 }, // gate breached
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 5, lineId: 417 },
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 6, lineId: 418 }, // friendly loss
    ],
    scoreKm: 2.5,
  },
};
