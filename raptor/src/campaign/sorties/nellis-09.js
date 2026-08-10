// N09 "THE SCHOOLHOUSE" — the last push, NELLIS (phase 11 INC-8 batch 4,
// sortie 25). Fantasy: the front is at the enemy's fence (the operations
// map reads +14 — fiction only, the unlock stays linear) and their last
// armored reserve is laagered under camouflage nets at the old western
// depot. Their air arm is ash (N08); what still flies is THE SCHOOLHOUSE —
// the aggressor squadron itself — and its founder, VIPER (engine.js ACES
// NELLIS id 0, the roster's 25-sortie unspent thread, introduced HERE),
// flies the watch with his last two students held in reserve. INVERTED
// from every prior NELLIS ace sortie: JACKAL always arrived at THE TURN —
// VIPER is briefed INBOUND FROM THE START and reaches the laager about
// when you do, so the strike happens under the duel, not before it.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      601-603 — the netted reserve, VIPER, the last class
//   2 SPAWN      ON_START 601; 660 VIPER guard taunt at t45; 609 un-gated
//                VIPER inbound call at t60 (past-tense spawn-fact: he is
//                airborne from t=0)
//   3 INGRESS    spawn (0,-18000) -> gate (-4000,-4000) ≈ 14.6 km ≈ 66 s
//                at 220; 604 at t25; gate -> laager 12.8 km
//   4 OBJ A      obj 2: THE RESERVE — 4 netted transporters + 1 flak
//                wagon spawned on the probed laager cell (-12000,6000)
//                (heightAt across the five placements 1007.5-1020.7 m,
//                span 13.2 m — probed 2026-08-09 live grid), killed UNDER
//                VIPER: his approach walk 10.4/19.9/28.8 km -> 11 km
//                laager-ring entry at 29.6 km ≈ 123 s (measured) — the
//                603 "two minutes of empty sky" is honest and mostly
//                spent on your own transit. His third approach leg dips
//                to 11.6 km from the play line: he crosses the 18 km
//                HUD gate mid-approach BY DESIGN — he is announced (609),
//                not hidden; detection honesty is for units the radio
//                calls a rumor.
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 605 (reserve-scoped; the
//                students clause is state-agnostic — their cut is
//                CLOCK-driven, hold ends ≈ 237-239 s, so at a fast turn
//                they may still be holding and at a slow one inbound:
//                "whatever its final pair is doing right now" covers
//                every path). Un-gated 672 at t=310 carries the real
//                movement call (past-tense: they left ≈ 237-239 s).
//   6 CLIMAX     obj 3 THE WATCH (destroy_tag need 1 on VIPER's tag —
//                the V08 grammar: kill or a smoking BINGO escape both
//                resolve on !live) + obj 4 THE LAST CLASS (tier-3 pair,
//                ring entry ≈ 382/401 s on the heels of a median turn).
//                obj 5 kill_ace aceId 0 stays OUTSIDE winWhen/loseWhen —
//                optional, for keeps (the N06/V08 ledger).
//   7 RESOLUTION 606 victory (students-scoped, VIPER/reserve-agnostic:
//                "the range is almost quiet" hedges the perverse orders) /
//                607 timeout (state-agnostic ground+air hedges; offense
//                strike; varied-shape t=1200 clock 671)
// ENVELOPE: median session ≈ 9-9.5 min (gate 66 s, laager ~125 s, strike
// under the duel 125-330 s, turn ~250-330 s ≈ 45-55% of median, students
// 382-401 s, killed ~420-560 s).
//
// ROUTE LAW (D-073): the reserve is ground (never despawns). VIPER is
// win-required need-1: resolves on !live (kill or escape) AND his route
// outlives the timer — approach + EIGHT 48 km ring laps = 404.8 km
// ≈ 1687 s > 1500 s (the V08/BOREAS letter-of-the-LAW precedent). The
// students are win-required need-2, ENGAGE-capable (self-commit inside
// 10 km) and loiter DISTINCT north boxes ((-8000,18000)-(-16000,16000) /
// (-7000,16500)-(-15000,14500) — 4-6 km clear of VIPER's ring top at
// y=12000, the batch-2 distinct-loiter SHOULD) to ≈ 1179/1185 s of total
// route (the V08-hunters 986-993 s / M07 1051-1219 s precedent band).
//
// GUARDRAILS (amendment 5): laager phase = its own flak wagon (1 ground,
// telegraphed by 601 + tracers; nearest boot shooter zsu 11 is 8.4 km
// from the laager, 5.9 km from the gate — outside every 5 km ring) +
// VIPER arriving ≈ 123 s. HONEST WORST CASE, documented: a slow player
// who leaves the flak wagon alive into the student window faces zsu +
// VIPER + 2 students = 4 <= 4, THE CEILING — every one telegraphed
// (tracers, ace livery + 609/660, 672). Bandits 3 <= 8; engage 3 <= 4.
// Ambush honesty: VIPER spawns 35.6/38.0 km from gate/laager; students
// 34.2-48.2 km, hold legs >= 22.8 km from the whole play line (measured
// vs the spawn->gate->laager polyline — outside the 18 km gate until
// their announced cut). Tier 4 is composition, not stats. LINE AUDIT:
// no "Five minutes" opener (671 varied), no "half a minute", no
// "...is empty" reveal shape (672 varied), '...' tic NOT used.
//
// POOL/capacity (NELLIS n=12): 4 supply_truck -> reserve slots
// 12,13,15,18 (of 16); 1 zsu -> slot 14 (of 10). destroy bfIdx below IS
// that deterministic first-free-typed assignment.

import { TRIG } from "../../game/missions.js";

// n racetrack laps between two waypoints, as plain [[x,y],...] data
const laps = (a, b, n) => Array.from({ length: n }, () => [a, b]).flat();
// n laps of the 48 km ring around the laager
const ringLaps = (n) => Array.from({ length: n },
  () => [[-6000, 12000], [-18000, 12000], [-18000, 0], [-6000, 0]]).flat();

export default {
  id: "N09",
  front: "NELLIS",
  titleId: 600,
  briefingIds: [601, 602, 603],
  meta: { turnObj: 2, turnLineId: 605, victoryLineId: 606, defeatLineId: 607 },
  spec: {
    v: 1, kind: "authored",
    front: "NELLIS",
    type: "strike",
    seed: 0x5c0019,
    todH: 18.8, weatherIdx: 0,
    playerSpawn: { x: 0, y: -18000, alt: 3600, headingDeg: 105.9, speed: 220 },
    airfield: { x: -3000, y: -8700, r: 900 },
    // the reserve: four netted transporters + the flak wagon, laagered on
    // the probed cell (parked — no paths: they are hiding, not driving)
    units: [
      ["supply_truck", -12050, 5950, 0.4, 0, 42],
      ["supply_truck", -11950, 6050, 0.4, 0, 42],
      ["supply_truck", -12100, 6100, 0.4, 0, 42],
      ["supply_truck", -11900, 5900, 0.4, 0, 42],
      ["zsu", -12150, 6150, 1.1, 0, 42],
    ],
    paths: {},
    bandits: [
      // VIPER (tag 44): tier-4 ace, explicit A3 opt-in, INBOUND from t=0.
      // Cum walk at cruise 240: 10.4/19.9/28.8 km -> 11 km laager-ring
      // entry at 29.6 km ≈ 123 s; then EIGHT 48 km ring laps to 404.8 km
      // ≈ 1687 s of total route — outlives the 1500 s timer (route LAW).
      { kind: "fighter", tier: 4, aceId: 0, engage: true, tag: 44, side: 0,
        x: 24000, y: 18000, z: 6200, headingDeg: 163, speed: 260,
        wpts: [[14000, 21000], [6000, 16000], [-2000, 12000], ...ringLaps(8)] },
      // the LAST CLASS (tag 45): tier-3 pair on far-SE holds (7 hold legs
      // each, every hold leg >= 22.8 km from the play line, measured);
      // off the hold ≈ 237/239 s, 11 km laager-ring entry ≈ 382/401 s,
      // then DISTINCT north loiter boxes to ≈ 1179/1185 s of total route.
      { kind: "fighter", tier: 3, engage: true, x: 28000, y: -16000, z: 4800, headingDeg: -127, speed: 250, tag: 45, side: 0,
        wpts: [[22000, -24000], [28000, -19000], [22000, -24000], [28000, -19000], [22000, -24000], [28000, -19000], [22000, -24000],
          [12000, -14000], [2000, -4000], [-5000, 5000], ...laps([-8000, 18000], [-16000, 16000], 11)] },
      { kind: "fighter", tier: 3, engage: true, x: 24000, y: -26000, z: 5200, headingDeg: 45, speed: 250, tag: 45, side: 0,
        wpts: [[28000, -22000], [21000, -27000], [28000, -22000], [21000, -27000], [28000, -22000], [21000, -27000], [28000, -22000],
          [16000, -16000], [6000, -6000], [-2000, 3000], ...laps([-7000, 16500], [-15000, 14500], 11)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", labelId: 690, zone: { x: -4000, y: -4000, r: 2500 } },   // the gate
      { id: 2, kind: "destroy_tag", labelId: 698, bfIdx: [12, 13, 15, 18, 14], need: 5 },   // the reserve (spawned slots)
      { id: 3, kind: "destroy_tag", labelId: 699, air: true, tag: 44, need: 1 },            // VIPER off the board (kill or driven off)
      { id: 4, kind: "destroy_tag", labelId: 700, air: true, tag: 45, need: 2 },            // the last class
      { id: 5, kind: "kill_ace", labelId: 701, aceId: 0 },                                  // OPTIONAL: the syllabus, for keeps
    ],
    winWhen: [2, 3, 4], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 601 },
      { on: TRIG.ON_TIME, t: 25, lineId: 604 },
      { on: TRIG.ON_TIME, t: 45, lineId: 660 },              // VIPER on guard
      { on: TRIG.ON_TIME, t: 60, lineId: 609 },              // the watch inbound, un-gated spawn-fact (entry ≈ 123 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 608 },   // tally the depot
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 605 },   // THE TURN
      { on: TRIG.ON_TIME, t: 310, lineId: 672 },             // students backstop, un-gated (they left ≈ 237-239 s; ring ≈ 382-401 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 4, lineId: 606 },   // victory (students-scoped)
      { on: TRIG.ON_TIME, t: 1200, lineId: 671 },            // clock warning (varied shape)
      { on: TRIG.ON_TIME, t: 1500, lineId: 607 },            // timeout defeat
      { on: TRIG.ON_ACE_STATE, aceId: 0, aceState: "smoking", lineId: 661 },
      { on: TRIG.ON_ACE_STATE, aceId: 0, aceState: "escaped", lineId: 662 },
      { on: TRIG.ON_ACE_STATE, aceId: 0, aceState: "killed", lineId: 663 },
    ],
    scoreKm: 2.0,
  },
};
