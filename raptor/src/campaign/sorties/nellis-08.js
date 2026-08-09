// N08 "FUMES" — the dawn mood piece (phase 11 INC-8 batch 3, brief item d).
// Fantasy: the enemy air arm is running on fumes — the last of their jet
// fuel sits in four bowsers at a dispersal yard in the north basin, pumping
// into bladders at first light. Fly the quietest strike of the war, and
// meet the answer: their alert pair, the first NON-ACE tier-4s of the
// campaign (brief item e — tier-4 opposition is normal now), spending
// everything they have left to reach you. The mood is MECHANICAL TRUTH,
// the V05 method on a new front and a new hour: nothing that shoots is
// within 14.1 km of the yard (nearest boot gun, measured), so the entire
// first half happens without a tracer — and the tod is 7.5, the DAWN hour
// proven by the BUILTIN nellis-sead-01 under t20 since INC-1 but never
// used by an authored sortie: a proven tod, finally used for what it is.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      541-543 — the fuel, the naked yard, the one answer left
//   2 SPAWN      ON_START 541
//   3 INGRESS    spawn (-3000,-8700) -> run-in (-6000,6000) ≈ 15.0 km
//                ≈ 68 s; 544 at t25 (sparse radio — the quiet is the point)
//   4 OBJ A      obj 2: the fuel — four spawned bowsers parked nose-to-tail
//                at the yard (-8000,12000), probed flat (span 20 m across
//                the cell), 14.1 km from the nearest shooter. Guns-only
//                work in dead air.
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 545: the alert pair answers.
//                AMBUSH TIMING TRICK: two tier-4 ENGAGE fighters (tag 34)
//                spawned at START over the far east range on 244.8/246.0 km
//                weaves whose every pre-cut leg holds >= 19.1/21.2 km from
//                the player's whole play line (spawn -> run-in -> yard,
//                measured against the polyline — outside the 18 km
//                detection gate, so they stay a briefing rumor); they cross
//                the gate at ≈ 206-220 s and enter an 11 km yard ring at
//                ≈ 235/249 s — on the heels of a competent fuel kill
//                (~135-190 s) — then ride THREE 64 km yard-ring laps
//                (≈ 267 s each) out to ≈ 1020/1025 s of total route.
//                Un-gated 592 at t=200 calls the descent BEFORE the HUD
//                can see them.
//   6 CLIMAX     obj 3: the pair over the burning yard — tier 4 flown by
//                composition (the N04/N06 nemesis-tier precedent made
//                ordinary): better reactions, same honest airframe,
//                destroy_tag need 2 counts !live.
//   7 RESOLUTION 546 victory (pair-scoped, true even on the duel-first
//                path) / 547 timeout (offense; t=1200 clock 549)
// ENVELOPE: median session ≈ 6.5-7.5 min (run-in ~68 s, fuel ~135-190 s,
// pair gate ~206-220 s, duel ~250-420 s); THE TURN ≈ 35-45% of median.
//
// ROUTE LAW (D-073): the fuel is ground (never despawns); the win-required
// pair is ENGAGE-capable (self-commits inside 10 km) AND loiters the yard
// ring to ≈ 1020 s. No stranding path.
//
// GUARDRAILS (amendment 5): ZERO shooters during the entire fuel phase —
// nearest boot gun (zsu 11) is 14.1 km from the yard and 8.7 km from the
// run-in (both > 5 km rings, measured). Post-turn: the pair = 2 <= 4,
// telegraphed by 592 + RWR + diamonds at the 18 km gate. Bandits 2 <= 8;
// engage 2 <= 4. Difficulty via composition: tier 4 is reactions and
// geometry, never hp. LINE AUDIT (batch-3 SHOULD): fresh dawn register,
// no calcified formulas (no "Fight's on", no "Rolling in", no
// five-minutes boilerplate shape on 549).
//
// POOL/capacity (NELLIS n=12): 4 supply_truck -> reserve slots 12,13,15,18
// (of 16). destroy bfIdx below IS that deterministic first-free-typed
// assignment.

import { TRIG } from "../../game/missions.js";

// n laps of the 64 km yard ring
const ringLaps = (n) => Array.from({ length: n },
  () => [[0, 20000], [-16000, 20000], [-16000, 4000], [0, 4000]]).flat();
const ringLaps2 = (n) => Array.from({ length: n },
  () => [[1000, 21000], [-15000, 21000], [-15000, 5000], [1000, 5000]]).flat();

export default {
  id: "N08",
  front: "NELLIS",
  titleId: 540,
  briefingIds: [541, 542, 543],
  meta: { turnObj: 2, turnLineId: 545, victoryLineId: 546, defeatLineId: 547 },
  spec: {
    v: 1, kind: "authored",
    front: "NELLIS",
    type: "strike",
    seed: 0xf03e55,
    todH: 7.5, weatherIdx: 0,
    playerSpawn: { x: -3000, y: -8700, alt: 3600, headingDeg: -11.5, speed: 220 },
    airfield: { x: -3000, y: -8700, r: 900 },
    // the last fuel: four bowsers nose-to-tail at the bladder farm — parked
    // (no paths: they are pumping, not driving)
    units: [
      ["supply_truck", -8200, 11800, 0.65, 0, 33],
      ["supply_truck", -8100, 11900, 0.65, 0, 33],
      ["supply_truck", -8000, 12000, 0.65, 0, 33],
      ["supply_truck", -7900, 12100, 0.65, 0, 33],
    ],
    paths: {},
    bandits: [
      // the alert pair (tag 34): tier-4 ENGAGE, held over the far east
      // range. Cum walks at cruise 240: P1 10.6/19.2/29.2/37.7/46.9/51.5/
      // 63.9 -> 18 km gate at 52.7 km ≈ 220 s, 11 km yard ring at 59.8 km
      // ≈ 249 s; P2 9.2/17.7/26.1/33.9/46.2 -> gate 49.4 km ≈ 206 s, ring
      // 56.4 km ≈ 235 s. Every pre-cut leg >= 19.1/21.2 km from the play
      // line (measured vs the spawn->run-in->yard polyline); then THREE
      // 64 km ring laps to ≈ 1020/1025 s of total route.
      { kind: "fighter", tier: 4, engage: true, x: 27000, y: 14000, z: 5200, headingDeg: -49, speed: 260, tag: 34, side: 0,
        wpts: [[19000, 21000], [26000, 26000], [16000, 26000], [22000, 20000], [13000, 22000], [10000, 18500], [-2000, 15500], ...ringLaps(3)] },
      { kind: "fighter", tier: 4, engage: true, x: 28000, y: 6000, z: 5600, headingDeg: -49, speed: 260, tag: 34, side: 0,
        wpts: [[21000, 12000], [27000, 18000], [19000, 15500], [24000, 21500], [12000, 19000], [-3000, 14000], ...ringLaps2(3)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: -6000, y: 6000, r: 2500 } },   // the run-in at first light
      { id: 2, kind: "destroy_tag", bfIdx: [12, 13, 15, 18], need: 4 },      // the fuel (spawned slots)
      { id: 3, kind: "destroy_tag", air: true, tag: 34, need: 2 },           // the answer
    ],
    winWhen: [2, 3], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 541 },
      { on: TRIG.ON_TIME, t: 25, lineId: 544 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 548 },   // the whisper on the run-in
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 545 },   // THE TURN
      { on: TRIG.ON_TIME, t: 200, lineId: 592 },             // pair backstop, un-gated (gate ≈ 206-220 s, ring ≈ 235-249 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 546 },   // victory
      { on: TRIG.ON_TIME, t: 1200, lineId: 549 },            // 5-min clock warning
      { on: TRIG.ON_TIME, t: 1500, lineId: 547 },            // timeout defeat
    ],
    scoreKm: 2.0,
  },
};
