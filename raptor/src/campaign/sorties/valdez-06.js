// V06 "HOLD UNTIL RELIEVED" — the station marathon (phase 11 INC-8
// batch 2, the batch's LONG SORTIE — brief item c, the amendment-4
// documented exception). Fantasy: the relief squadron is ferrying in and
// lands in twenty-five minutes; until the wheels touch, YOU are the
// Sound's entire air force. The enemy knows the window and feeds three
// relays at the station in sequence — probes first, then shooters, then
// their best pair as the WAVE-3 CODA. An endurance piece: the fight
// breathes in three swells with authored clock-talk in the troughs.
//
// DELIBERATE >12 MIN (amendment 4 exception clause, documented): median
// session ≈ 13-14.5 min (station ~60 s, relay-1 kill ~200-260 s, relay-2
// kill ~460-540 s, coda kill ~730-830 s, resolution). THE TURN: the
// reveal LINE fires on obj 2 (~225 s ≈ 26% of median — early by the
// 6-12-min contract, documented here as part of the same exception); the
// turn's ESCALATION — the first relay that shoots back arriving on
// station — lands at ≈ 420-424 s ≈ 50% of median, inside the window
// where it counts.
//
// 7-BEAT SHEET:
//   1 BRIEF      481-483 — the window, the three relays, the relief
//   2 SPAWN      ON_START 481
//   3 INGRESS    spawn (0,-6000) -> station (1500,-19000) ≈ 13.1 km
//                ≈ 60 s; 484 at t25
//   4 OBJ A      obj 2: relay one — two tier-1 probes off the NE on
//                40.3/40.5 km runs, station ring (r 8000) at ≈ 168/169 s
//                (measured), then racetrack loiter to ≈ 1039/1041 s
//                (D-073 route LAW: win-required + engage-less = the
//                loiter outlasts a slow player). They jink, never shoot.
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 485: relay two committing EARLY —
//                and these are shooters. AMBUSH TIMING TRICK: two tier-2
//                ENGAGE fighters (tag 61) spawned at START far NW on
//                100.9/101.7 km glacier-line weaves (pre-entry legs
//                >= 13.6 km from the station, measured per leg), station
//                ring at ≈ 420/424 s, then ring laps to ≈ 1113/1117 s.
//                ON_TIME t=370 backstop 513 calls them un-gated.
//   6 CLIMAX     obj 4: the WAVE-3 CODA — their best pair (tier 3,
//                ENGAGE, tag 62) holds a far-north racetrack (hold legs
//                >= 34 km out) until ≈ 570 s, descends, and hits the
//                station ring at ≈ 680/694 s; its total route runs
//                ≈ 1512/1513 s — it OUTLIVES the 1500 s lose timer at the
//                letter of the D-073 LAW. 489 fires on obj 3 (the coda
//                reveal); 514 at t=640 is the un-gated descent call; 515
//                at t=900 is the relief clock.
//   7 RESOLUTION 486 victory (the relief flight is on the pad) / 487
//                timeout (t=1200 warning 516)
//
// GUARDRAILS (amendment 5): engage census = relay-2 pair + coda pair = 4
// <= 4 — and because relay 2 loiters to ~1113 s while the coda arrives at
// ~680 s, the WORST-CASE simultaneous shooter count for a slow player is
// exactly 4, the ceiling, all air, all telegraphed (this is the batch's
// endurance climax and it is counted honestly). Relay 1 is tier-1 A2 and
// never fires. Zero ground shooters within 5 km of any center (nearest
// boot gun 10.8 km). Bandits 2+2+2 = 6 <= 8.

import { TRIG } from "../../game/missions.js";

// n racetrack laps between two waypoints, as plain [[x,y],...] data
const laps = (a, b, n) => Array.from({ length: n }, () => [a, b]).flat();
// n laps of a 4-corner station ring
const ringLaps = (pts, n) => Array.from({ length: n }, () => pts).flat();

export default {
  id: "V06",
  front: "VALDEZ",
  titleId: 480,
  briefingIds: [481, 482, 483],
  meta: { turnObj: 2, turnLineId: 485, victoryLineId: 486, defeatLineId: 487 },
  spec: {
    v: 1, kind: "authored",
    front: "VALDEZ",
    type: "cap",
    seed: 0x4e11ef,
    todH: 12, weatherIdx: 0,
    playerSpawn: { x: 0, y: -6000, alt: 3600, headingDeg: -83.4, speed: 240 },
    airfield: { x: 0, y: -6000, r: 600 },
    units: [],
    paths: {},
    bandits: [
      // relay ONE (tag 60): tier-1 probes. Cum walks at cruise 240:
      // 11.7/21.7/32.4/36.0 -> 8 km station ring at 40.5/40.3 km
      // ≈ 168/169 s; then 11 racetrack lap pairs (9.85 km legs) loiter to
      // ≈ 1041/1039 s. Mid wpts hold >= 12.3 km from the station.
      { kind: "fighter", tier: 1, x: 27000, y: 10000, z: 3600, headingDeg: -149, speed: 250, tag: 60, side: 0,
        wpts: [[17000, 4000], [23000, -4000], [13000, -8000], [11000, -11000], ...laps([6000, -16000], [-3000, -20000], 11)] },
      { kind: "fighter", tier: 1, x: 29000, y: 7000, z: 3200, headingDeg: -149, speed: 250, tag: 60, side: 0,
        wpts: [[19000, 1000], [25000, -7000], [15000, -11000], [12500, -13500], ...laps([7000, -17000], [-2000, -21000], 11)] },
      // relay TWO (tag 61): tier-2 ENGAGE — the first teeth. Cum walks:
      // b1 12.6/25.5/37.6/50.4/61.2/74.0/84.2/95.6 -> 9 km ring at
      // 101.7 km ≈ 424 s; b2 -> 100.9 km ≈ 420 s. Pre-entry legs
      // >= 13.9/13.6 km from the station; then station ring laps to
      // ≈ 1113/1117 s.
      { kind: "fighter", tier: 2, engage: true, x: -26000, y: 12000, z: 4200, headingDeg: 18, speed: 250, tag: 61, side: 0,
        wpts: [[-14000, 16000], [-22000, 6000], [-10000, 8000], [-18000, -2000], [-8000, 2000], [-16000, -8000], [-6000, -6000], [-13000, -15000], [-5000, -17000],
          ...ringLaps([[7000, -15000], [-4000, -15000], [-4000, -24000], [7000, -24000]], 4)] },
      { kind: "fighter", tier: 2, engage: true, x: -28000, y: 9000, z: 4600, headingDeg: 18, speed: 250, tag: 61, side: 0,
        wpts: [[-16000, 13000], [-24000, 3000], [-12000, 5000], [-20000, -5000], [-10000, -1000], [-18000, -11000], [-8000, -9000], [-14000, -17000], [-6000, -18500],
          ...ringLaps([[8000, -14000], [-3000, -14000], [-3000, -23000], [8000, -23000]], 4)] },
      // the CODA (tag 62): their best pair, tier-3 ENGAGE. Far-north hold
      // (4 racetrack lap pairs, hold legs >= 34 km from the station) to
      // ≈ 570 s, then the descent: 9 km ring at 163.3/166.4 km
      // ≈ 680/694 s; total route 1512/1513 s — OUTLIVES the 1500 s timer.
      { kind: "fighter", tier: 3, engage: true, x: -8000, y: 27000, z: 5800, headingDeg: -7, speed: 260, tag: 62, side: 0,
        wpts: [...laps([-15000, 25000], [1000, 27000], 4), [-6000, 15000], [2000, 3000], [-2000, -9000],
          ...ringLaps([[7000, -15000], [-4000, -15000], [-4000, -24000], [7000, -24000]], 5)] },
      { kind: "fighter", tier: 3, engage: true, x: -2000, y: 28500, z: 6200, headingDeg: -7, speed: 260, tag: 62, side: 0,
        wpts: [...laps([-11000, 26500], [5000, 28500], 4), [-2000, 16000], [5000, 4000], [1000, -8000],
          ...ringLaps([[8000, -14000], [-3000, -14000], [-3000, -23000], [8000, -23000]], 5)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 1500, y: -19000, r: 3000 } },  // on station
      { id: 2, kind: "destroy_tag", air: true, tag: 60, need: 2 },           // relay one
      { id: 3, kind: "destroy_tag", air: true, tag: 61, need: 2 },           // relay two
      { id: 4, kind: "destroy_tag", air: true, tag: 62, need: 2 },           // the coda
    ],
    winWhen: [2, 3, 4], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 481 },
      { on: TRIG.ON_TIME, t: 25, lineId: 484 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 488 },   // the watch begins
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 485 },   // THE TURN (reveal)
      { on: TRIG.ON_TIME, t: 300, lineId: 521 },             // trough-2 clock, un-gated (panel MUST-4)
      { on: TRIG.ON_TIME, t: 370, lineId: 513 },             // relay-2 backstop, un-gated (ring ≈ 420-424 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 489 },   // the coda reveal
      { on: TRIG.ON_TIME, t: 640, lineId: 514 },             // coda descent, un-gated (ring ≈ 680-694 s)
      { on: TRIG.ON_TIME, t: 900, lineId: 515 },             // the relief clock
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 4, lineId: 486 },   // victory
      { on: TRIG.ON_TIME, t: 1200, lineId: 516 },            // 5-min clock warning
      { on: TRIG.ON_TIME, t: 1500, lineId: 487 },            // timeout defeat
    ],
    scoreKm: 1.5,
  },
};
