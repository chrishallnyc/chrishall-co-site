// N06 "THE COUNTERPUSH" — the ground war under the hammer (phase 11 INC-8
// batch 2, the batch's JACKAL sortie). Fantasy: the enemy's armored
// counterattack is rolling for the eastern pass — four loaded movers behind
// two dug-in overwatch guns — and the paint that owes this range a debt
// (engine.js ACES NELLIS id 1; the man or whoever inherited the airplane —
// the briefing hedges, so the sortie reads true whether JACKAL is fresh,
// escaped-before, or long dead) is flying TOP COVER FOR THE IRON. Unlike
// N02/N04 the win never requires touching him: kill the column while he
// hunts you, and settle the debt only if you want it. kill_ace is OPTIONAL
// GLORY, full stop. TYPHOON stays finale-only.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      461-463 — the iron, the guns, the paint overhead
//   2 SPAWN      ON_START 461; 510 guard taunt at t45 (ledger-agnostic:
//                he talks about the RANGE, not the last fight)
//   3 INGRESS    spawn (-12000,-8000) -> pass gate (6000,1000) ≈ 20.1 km
//                ≈ 91 s; 464 at t25
//   4 OBJ A      obj 2: the overwatch guns — two spawned red ZSUs dug in
//                on the road bends at (13000,11000)/(10500,8000). Only
//                supply_trucks drive (battlefield contract), so the
//                "leapfrogging escort" is data-true: guns hold, iron rolls.
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 465: the paint turns in for the
//                column. AMBUSH TIMING TRICK: JACKAL (tier 4, engage,
//                aceId 1) spawns at START in the far NW on a 68.4 km sweep
//                whose every pre-entry leg holds >= 14.4 km from the
//                column corridor (11000,8500) and >= 18.8 km from the gate
//                (measured per leg); he enters an 11 km ring around the
//                corridor at ≈ 285 s — on the heels of a competent gun
//                kill (~180-250 s) — then rides THREE 48 km ring laps
//                (≈ 200 s each) to ≈ 877 s of total route (house 800-1000
//                window; he is engage-capable and commits himself anyway).
//                ON_TIME t=240 backstop 469 calls his descent un-gated.
//   6 CLIMAX     obj 3: the column — four movers crawling a 16.7 km road
//                (8 m/s ≈ 2084 s, still rolling at the timer: the timeout
//                IS the tunnel mouth) killed under a live ace's hammer.
//                obj 4 kill_ace stays OUTSIDE winWhen/loseWhen: the kill
//                pays 383, the smoking BINGO escape pays 382 (amendment 1),
//                and neither is ever required or a fail state.
//   7 RESOLUTION 466 victory / 467 timeout (the column reaches the tunnel
//                approach as the clock dies; t=1200 clock warning 511)
// ENVELOPE: median session ≈ 7.5-8 min (gate ~91 s, guns ~180-250 s,
// JACKAL arrives ~285 s, column under the hammer ~300-430 s, optional
// duel after); THE TURN ≈ 45-50% of median.
//
// ROUTE LAW (D-073): nothing win-required flies — the guns and the column
// are ground (never despawn; the column holds position at path end), and
// JACKAL is optional. His 877 s route + self-committing ENGAGE close the
// only air loop.
//
// GUARDRAILS (amendment 5): obj-2 phase = the two overwatch guns
// themselves = 2; post-turn column phase = 0 ground (guns dead by
// objective order) + JACKAL = 1. HONEST SLOW-PATH NOTE: a player who
// skips the guns and goes straight for the movers faces 2 ZSU + JACKAL
// = 3 <= 4, every one telegraphed (tracers + ace diamond + RWR). No boot
// shooter is within 10 km of any center. Bandits 1 <= 8; engage 1 <= 4.
// Tier 4 is composition (the N04 nemesis-escalation precedent), not a
// stat override.
//
// POOL/capacity (NELLIS n=12): 4 supply_truck -> reserve slots 12,13,15,18
// (of 16); 2 zsu -> slots 14,16 (of 10). destroy bfIdx below IS that
// deterministic first-free-typed assignment (trucks listed first).

import { TRIG } from "../../game/missions.js";

// n laps of the 11 km ring around the column corridor
const ringLaps = (n) => Array.from({ length: n },
  () => [[16000, 14000], [4000, 14000], [4000, 2000], [16000, 2000]]).flat();

export default {
  id: "N06",
  front: "NELLIS",
  titleId: 460,
  briefingIds: [461, 462, 463],
  meta: { turnObj: 2, turnLineId: 465, victoryLineId: 466, defeatLineId: 467 },
  spec: {
    v: 1, kind: "authored",
    front: "NELLIS",
    type: "convoy",
    seed: 0xc07e12,
    todH: 12, weatherIdx: 0,
    playerSpawn: { x: -12000, y: -8000, alt: 3600, headingDeg: 26.6, speed: 220 },
    airfield: { x: -3000, y: -8700, r: 900 },
    // the counterpush: four loaded movers (tag 30, driving) + two dug-in
    // overwatch ZSUs on the road bends (static — only trucks drive)
    units: [
      ["supply_truck", 16000, 14000, -2.4, 0, 30],
      ["supply_truck", 16100, 14100, -2.4, 0, 30],
      ["supply_truck", 16200, 14200, -2.4, 0, 30],
      ["supply_truck", 16300, 14300, -2.4, 0, 30],
      ["zsu", 13000, 11000, -2.4, 0, 31],
      ["zsu", 10500, 8000, -2.4, 0, 31],
    ],
    // 16.7 km road southwest for the pass ≈ 2084 s at 8 m/s — the column
    // is still rolling when the clock dies (the timeout IS the escape)
    paths: { 30: [[12000, 10000], [9000, 6500], [6200, 4200], [4000, 2500]] },
    bandits: [
      // JACKAL (tag 32): tier-4 ace, explicit A3 opt-in, top cover for the
      // iron. Sweep legs (cumulative km at cruise 240): 12.2/23.6/35.0/
      // 45.0/56.1/64.0 -> 11 km corridor-ring entry at 68.4 km ≈ 285 s;
      // every pre-entry leg's closest approach: corridor 14.4 km, gate
      // 18.8 km (measured per leg). Then THREE 48 km ring laps (≈ 200 s
      // each) to ≈ 877 s of total route.
      { kind: "fighter", tier: 4, aceId: 1, engage: true, tag: 32, side: 0,
        x: -24000, y: 24000, z: 5400, headingDeg: 9.5, speed: 260,
        wpts: [[-12000, 26000], [-19000, 17000], [-8000, 20000], [-14000, 12000], [-4000, 17000], [3000, 20500],
          ...ringLaps(3)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 6000, y: 1000, r: 2500 } },    // the pass gate
      { id: 2, kind: "destroy_tag", bfIdx: [14, 16], need: 2 },              // the overwatch guns (spawned slots)
      { id: 4, kind: "kill_ace", aceId: 1 },                                 // OPTIONAL: the debt, for keeps
      { id: 3, kind: "destroy_tag", bfIdx: [12, 13, 15, 18], need: 4 },      // the column (spawned slots)
    ],
    winWhen: [2, 3], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 461 },
      { on: TRIG.ON_TIME, t: 25, lineId: 464 },
      { on: TRIG.ON_TIME, t: 45, lineId: 510 },              // the paint on guard (ledger-agnostic)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 468 },   // tally the column
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 465 },   // THE TURN
      { on: TRIG.ON_TIME, t: 240, lineId: 469 },             // JACKAL descent backstop, un-gated (entry ≈ 285 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 466 },   // victory
      { on: TRIG.ON_TIME, t: 1200, lineId: 511 },            // 5-min clock warning
      { on: TRIG.ON_TIME, t: 1500, lineId: 467 },            // timeout defeat
      { on: TRIG.ON_ACE_STATE, aceId: 1, aceState: "smoking", lineId: 381 },
      { on: TRIG.ON_ACE_STATE, aceId: 1, aceState: "escaped", lineId: 382 },
      { on: TRIG.ON_ACE_STATE, aceId: 1, aceState: "killed", lineId: 383 },
    ],
    scoreKm: 1.5,
  },
};
