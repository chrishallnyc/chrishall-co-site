// M04 "THE COURIER" — offensive hunt down the chain (phase 11 INC-8
// batch 1). Fantasy: a heavy transport is RUNNING — command staff and
// codebooks aboard, pickets sanitizing his road, close escort welded to
// his wings — and the map's southern channel is his finish line. V02
// defended a fence; M04 attacks one: the denial zone belongs to the ENEMY
// and the chase clock is his route.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      431-433 — the courier, the screen, the channel
//   2 SPAWN      ON_START 431
//   3 INGRESS    spawn (-3200,-8000) -> datum (10000,0) ≈ 15.4 km ≈ 70 s;
//                434 at t25
//   4 OBJ A      obj 2: the SCREEN — two tier-1 weavers holding a 10.8 km
//                racetrack across the middle passage; 11 lap pairs hold
//                them to ≈ 990 s (D-073 route LAW for win-required +
//                engage-less air).
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 435: the picture resolves. The
//                courier (tag 40, transport at 150 m/s) spawned at START
//                in the NE corner on a 78.7 km route down the island
//                line — he brushes the datum corridor from ≈ 178 s and is
//                crossing the middle passage as a competent screen kill
//                lands, with two tier-3 ENGAGE escorts (tag 42) in trail
//                high cover cutting in on the turn's heels (they commit
//                themselves when you close). Detection gate keeps him a
//                radar rumor until ~18 km — 438 foreshadows the returns.
//   6 CLIMAX     obj 4: run him down through the escort before the
//                southern channel — gate ring (r 3000) trips at ≈ 512 s
//                unopposed; 439 calls the ninety-second warning at t=420.
//   7 RESOLUTION 436 victory / 437 he's through (zone denial) / defense
//                timeout with the courier dead = VICTORY (446 flavor —
//                type intercept, the screen stragglers can live)
// ENVELOPE: median session ≈ 7 min (datum ~70 s, screen ~200-240 s,
// escort duel + courier kill ~300-420 s); THE TURN ≈ 52-55% of median.
//
// ROUTE LAW (D-073): the courier's route TERMINATES inside the channel
// denial zone — unopposed he ends the sortie (loseWhen 3); the screen
// loiters to ≈ 990 s; the escorts are NOT win-required (alive escorts at
// the win are the fiction: they ran home). No stranding path.
//
// GUARDRAILS (amendment 5): the escorts are the ONLY shooters — 2 tier-3
// ENGAGE fighters (post-turn phase), spawned 28+ km from every pre-turn
// center. The screen is tier-1 A2 (never fires); the courier is unarmed;
// no boot shooter within 8.6 km of any center. Max 2 <= 4. Bandits
// 1+2+2 = 5 <= 8; engage 2 <= 4.

import { TRIG } from "../../game/missions.js";

// n racetrack laps between two waypoints, as plain [[x,y],...] data
const laps = (a, b, n) => Array.from({ length: n }, () => [a, b]).flat();

export default {
  id: "M04",
  front: "MARIANAS",
  titleId: 430,
  briefingIds: [431, 432, 433],
  meta: { turnObj: 2, turnLineId: 435, victoryLineId: 436, defeatLineId: 437 },
  spec: {
    v: 1, kind: "authored",
    front: "MARIANAS",
    type: "intercept",
    seed: 0xc0431e,
    todH: 12, weatherIdx: 0,
    playerSpawn: { x: -3200, y: -8000, alt: 3600, headingDeg: 31.2, speed: 240 },
    airfield: { x: -3200, y: -8000, r: 600 },
    units: [],
    paths: {},
    bandits: [
      // the COURIER (tag 40): heavy transport on the deck weeds, 150 m/s.
      // Cum walk: 11.7/22.4/33.2/43.2/50.4/61.2/70.4/78.7 km -> the
      // channel gate ring (r 3000 at (-14000,-24000)) trips at ≈ 76.8 km
      // ≈ 512 s unopposed; he crosses the datum corridor (~36 km) ≈ 240 s.
      { kind: "transport", tier: 0, x: 24000, y: 22000, z: 900, headingDeg: -149, speed: 150, tag: 40, side: 0,
        wpts: [[14000, 16000], [18000, 6000], [8000, 2000], [16000, -4000], [10000, -8000], [0, -12000], [-6000, -19000], [-13200, -23200]] },
      // the SCREEN (tag 41): tier-1 weavers already forward on the middle
      // passage — 10.8 km racetrack legs ≈ 45 s each, 11 lap pairs ≈ 990 s
      { kind: "fighter", tier: 1, x: 12000, y: 2000, z: 2800, headingDeg: -45, speed: 240, tag: 41, side: 0,
        wpts: [...laps([15000, -1000], [5000, 3000], 11)] },
      { kind: "fighter", tier: 1, x: 9000, y: -2000, z: 3200, headingDeg: -45, speed: 240, tag: 41, side: 0,
        wpts: [...laps([14000, -2500], [4000, 1500], 11)] },
      // the ESCORT (tag 42): two tier-3 ENGAGE fighters flying TRAIL HIGH
      // COVER — a NE racetrack (every point >= 24 km from the datum) for
      // the first ≈ 230 s while the courier makes the middle passage, then
      // the CUT southwest that first crosses 14 km of the datum fight at
      // ≈ 66 km ≈ 276 s (measured) — right on the turn's heels, the
      // ambush-timing house pattern — closing to ~9 km off the courier's
      // wing by ≈ 260 s and pacing him to the channel (~118 km ≈ 493 s at
      // cruise 240 vs his 78.7 km at 150). They commit themselves
      // (ENGAGE_R 10 km) when you come for him. Spawns 28+ km from every
      // pre-turn objective center (ambush honesty).
      { kind: "fighter", tier: 3, engage: true, tag: 42, side: 0,
        x: 25500, y: 24000, z: 2400, headingDeg: -95, speed: 250,
        wpts: [...laps([26000, 18000], [17000, 22000], 3),
          [20000, -2000], [12000, -6000], [2000, -10000], [-4000, -17000], [-12500, -22000]] },
      { kind: "fighter", tier: 3, engage: true, tag: 42, side: 0,
        x: 23000, y: 25500, z: 3000, headingDeg: -80, speed: 250,
        wpts: [...laps([24000, 20000], [15000, 24000], 3),
          [18000, 0], [10000, -4000], [0, -12000], [-6000, -19000], [-14500, -20500]] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 10000, y: 0, r: 2500 } },      // the datum
      { id: 2, kind: "destroy_tag", air: true, tag: 41, need: 2 },           // the screen
      { id: 3, kind: "protect_tag", air: true, tag: 40, zone: { x: -14000, y: -24000, r: 3000 } }, // the channel (his finish line)
      { id: 4, kind: "destroy_tag", air: true, tag: 40, need: 1 },           // the courier
    ],
    winWhen: [2, 4], loseWhen: [3],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 431 },
      { on: TRIG.ON_TIME, t: 25, lineId: 434 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 438 },   // the picture builds
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 435 },   // THE TURN
      { on: TRIG.ON_TIME, t: 420, lineId: 439 },             // ninety seconds to the channel (gate ≈ 512 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 4, lineId: 436 },   // victory
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 3, lineId: 437 }, // he's through
      { on: TRIG.ON_TIME, t: 1500, lineId: 446 },            // defense timeout = VICTORY flavor (courier already dead)
    ],
    scoreKm: 2.5,
  },
};
