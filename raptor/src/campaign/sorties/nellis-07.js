// N07 "BIG FRIENDS" — escort YOUR strike package through THEIR intercept
// (phase 11 INC-8 batch 3, brief item b). Fantasy: the front is nearly won
// and for the first time the war goes NORTH on our terms — three friendly
// heavies (tag 60, the campaign's first side-1 OFFENSIVE air) push up the
// corridor to put ordnance on the enemy marshalling yard, and the ENEMY
// runs the intercept for once: a committed pair from the east, and their
// best element held on a southern standoff for the moment the bombers are
// heaviest. V04 guarded a static racetrack over friendly water; N07 walks
// the escort DEEP into enemy sky behind freight that cannot run and cannot
// shoot back. The banked escort SHOULD is designed in: both intercept
// waves' terminal legs RIDE the bombers' own play line into the bomber
// wheel — the guns arrive over the freight, not beside it.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      531-533 — the package, the east pair, the southern element
//   2 SPAWN      ON_START 531
//   3 INGRESS    spawn (-18000,-20000) -> rendezvous (-10000,-8000)
//                ≈ 14.4 km ≈ 65 s at 220; 534 at t25. The bombers pass the
//                rendezvous at ≈ 71 s — you join ON the package (measured).
//   4 OBJ A      obj 2: wave A (tag 70) — two tier-2 ENGAGE fighters
//                converging on the bomber wheel from NE and ESE on
//                68.9/65.0 km routes; wheel-box entry (r 4000 at
//                (14000,14000)) at 65.0/61.0 km ≈ 271/254 s (measured),
//                every pre-terminal leg >= 5.6 km OUTSIDE the box (no
//                accidental early denial). Un-gated 590 at t=175 is the
//                merge clock (79-96 s to the box: "under two minutes").
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 535. AMBUSH TIMING TRICK: wave B
//                (tag 71) — two tier-3 ENGAGE — spawned at START on far-SE
//                holds (5 hold legs each; every hold leg >= 29.7/30.1 km
//                from the player's whole play line, measured — far outside
//                the 18 km detection gate, so the southern element stays a
//                briefing rumor until it moves). They leave the hold at
//                ≈ 267/283 s — on the heels of a competent wave-A kill —
//                and their cut's final legs ride the corridor into the
//                wheel: box entry ≈ 457/462 s. Un-gated 591 at t=395.
//   6 CLIMAX     obj 3: wave B killed over/short of the bomber wheel while
//                the heavies make their runs.
//   7 RESOLUTION 536 victory (obj 3) / 537 zone denial (obj 4/5, shared
//                lineId — the V02/N05 pattern) / 539 friendly loss (obj 6,
//                the V04 418 beat — only the player can kill a bomber).
//                NO t=1500 row: wave A trips the wheel at ≈ 271 s and wave
//                B at ≈ 457 s unopposed, and a dead intercept IS the win —
//                the clock can never expire first (N05 precedent). Type
//                escort = defense timeout WOULD be victory; unreachable,
//                documented.
// ENVELOPE: median session ≈ 8-9 min (join ~65 s, wave-A merge from
// ~130 s, killed ~200-280 s, wave-B cut ~267-283 s, killed ~460-540 s);
// THE TURN ≈ 45-55% of median.
//
// ORDER NOTE (the M06 anvil-first lesson, designed against): killing wave
// B before wave A requires flying past a committed wave A into a >= 29 km
// standoff the HUD cannot even see — while wave A trips the wheel at
// ≈ 271 s for a near-certain loss. 535/536 are written to survive the
// perverse path anyway (past-tense + conditional clauses).
//
// ROUTE LAW (D-073): both win-required waves TERMINATE inside the wheel
// denial zone — unopposed they end the sortie (loseWhen 4/5), so route
// exhaustion can never strand the win. The bombers (side 1, NOT
// win-required) fly 277.4 km ≈ 1849 s — on-map past any resolution; their
// protect row (need 1) watches deaths only, and nothing red can shoot
// them: the check-fire stakes are real (V04 grammar) AND TELEGRAPHED —
// the 9X seeker has no side filter and obj 6 is a one-shot loss, so 533
// carries the check-fire warning up front (batch-3 panel MUST-4).
//
// GUARDRAILS (amendment 5): the waves are the ONLY shooters — engage
// census 2+2 = 4 <= 4, THE CEILING, honestly counted: a slow player who
// lets wave B arrive with a wave-A survivor airborne faces exactly 4, all
// air, all telegraphed (531/532 brief both waves, 590/591 call the
// clocks). Every engage spawn is >= 20.1 km from every pre-turn center
// (wave A's own converging spawns straddle the map — the M06 rule) and
// >= 33 km from the rendezvous. No boot shooter within 6.0 km of any
// center (nearest: zsu 11 at 6.02 km from the rendezvous). Bandits
// 3+2+2 = 7 <= 8. LINE AUDIT (batch-3 SHOULD): no "Whatever the state",
// no "doesn't care", no "All of it." closer, no "ninety seconds", no
// "Fight's on".

import { TRIG } from "../../game/missions.js";

// n racetrack laps between two waypoints, as plain [[x,y],...] data
const laps = (a, b, n) => Array.from({ length: n }, () => [a, b]).flat();

export default {
  id: "N07",
  front: "NELLIS",
  titleId: 530,
  briefingIds: [531, 532, 533],
  meta: { turnObj: 2, turnLineId: 535, victoryLineId: 536, defeatLineId: 537 },
  spec: {
    v: 1, kind: "authored",
    front: "NELLIS",
    type: "escort",
    seed: 0xb16f12,
    todH: 15.5, weatherIdx: 0,
    playerSpawn: { x: -18000, y: -20000, alt: 3600, headingDeg: 33.7, speed: 240 },
    airfield: { x: -3000, y: -8700, r: 900 },
    units: [],
    paths: {},
    bandits: [
      // the PACKAGE (tag 60, side 1): three heavies, loose trail, corridor
      // SW->NE then a 14-lap-pair wheel over the yard. Cum walk (150 m/s):
      // rendezvous 10.7 km ≈ 71 s, IP 22.7 ≈ 151 s, push 35.5 ≈ 237 s,
      // wheel 44.0 km ≈ 293 s; total 277.4 km ≈ 1849 s (outlives the timer).
      { kind: "transport", tier: 0, x: -19000, y: -15000, z: 5200, headingDeg: 41, speed: 150, tag: 60, side: 1,
        wpts: [[-10500, -8500], [-2000, 0], [8000, 8000], [14000, 14000], ...laps([17000, 17000], [11000, 11000], 14)] },
      { kind: "transport", tier: 0, x: -20000, y: -13500, z: 5000, headingDeg: 41, speed: 150, tag: 60, side: 1,
        wpts: [[-11500, -7000], [-3000, 1500], [7000, 9500], [13000, 15500], ...laps([16000, 18500], [10000, 12500], 14)] },
      { kind: "transport", tier: 0, x: -17500, y: -16500, z: 5400, headingDeg: 41, speed: 150, tag: 60, side: 1,
        wpts: [[-9000, -10000], [-500, -1500], [9500, 6500], [15500, 12500], ...laps([18500, 15500], [12500, 9500], 14)] },
      // wave A (tag 70): tier-2 ENGAGE, converging NE + ESE (spawns
      // straddle so each is 20.1 km from their own centroid (24000,4000) —
      // the M06 ambush-honesty trick). Cum walks at cruise 240: A-NE
      // 12.4/23.5/33.6/44.1/51.7/58.9 km -> wheel-box entry 65.0 km
      // ≈ 271 s; A-ESE 11.2/20.1/29.3/37.4/45.9/52.2/59.4 km -> entry
      // 61.0 km ≈ 254 s. Both terminal at (14000,14000); pre-terminal
      // legs >= 5.6 km outside the r4000 box.
      { kind: "fighter", tier: 2, engage: true, x: 26000, y: 24000, z: 5000, headingDeg: -76, speed: 250, tag: 70, side: 0,
        wpts: [[14000, 27000], [24000, 22000], [14000, 22500], [23000, 17000], [26000, 10000], [20000, 6000], [15200, 12200], [14000, 14000]] },
      { kind: "fighter", tier: 2, engage: true, x: 22000, y: -16000, z: 4600, headingDeg: 27, speed: 250, tag: 70, side: 0,
        wpts: [[27000, -6000], [19000, -2000], [26000, 4000], [18000, 3000], [24000, 9000], [26000, 15000], [19000, 16500], [14000, 14000]] },
      // wave B (tag 71): tier-3 ENGAGE on far-SE holds — 5 hold legs each
      // (every hold leg >= 29.7/30.1 km from the play line, measured), off
      // the hold at ≈ 267/283 s, then the cut whose final legs ride the
      // corridor: wheel-box entry ≈ 457/462 s; totals 113.6/115.0 km.
      { kind: "fighter", tier: 3, engage: true, x: 26000, y: -22000, z: 5600, headingDeg: -153, speed: 250, tag: 71, side: 0,
        wpts: [[25000, -24000], [13000, -27000], [25000, -24000], [13000, -27000], [25000, -24000], [13000, -27000], [19000, -14000], [23000, -4000], [16000, 2000], [19500, 9000], [14000, 14000]] },
      { kind: "fighter", tier: 3, engage: true, x: 20000, y: -27000, z: 6000, headingDeg: -95, speed: 250, tag: 71, side: 0,
        wpts: [[14000, -26500], [26000, -23500], [14000, -26500], [26000, -23500], [14000, -26500], [26000, -23500], [21000, -16000], [25000, -6000], [18000, 0], [21500, 7000], [14000, 14000]] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: -10000, y: -8000, r: 2500 } }, // join the package
      { id: 2, kind: "destroy_tag", air: true, tag: 70, need: 2 },           // wave A
      { id: 3, kind: "destroy_tag", air: true, tag: 71, need: 2 },           // wave B
      { id: 4, kind: "protect_tag", air: true, tag: 70, zone: { x: 14000, y: 14000, r: 4000 } }, // the bomber wheel
      { id: 5, kind: "protect_tag", air: true, tag: 71, zone: { x: 14000, y: 14000, r: 4000 } },
      { id: 6, kind: "protect_tag", air: true, tag: 60, need: 1 },           // the heavies (only you can fail this)
    ],
    winWhen: [2, 3], loseWhen: [4, 5, 6],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 531 },
      { on: TRIG.ON_TIME, t: 25, lineId: 534 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 538 },   // joined on the package
      { on: TRIG.ON_TIME, t: 175, lineId: 590 },             // wave-A merge clock, un-gated (entry ≈ 271-287 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 535 },   // THE TURN
      { on: TRIG.ON_TIME, t: 395, lineId: 591 },             // wave-B backstop, un-gated (entry ≈ 457-462 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 536 },   // victory
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 4, lineId: 537 }, // through the sweep
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 5, lineId: 537 },
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 6, lineId: 539 }, // friendly loss
    ],
    scoreKm: 2.0,
  },
};
