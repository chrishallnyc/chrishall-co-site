// N02 "JACKAL'S HOUR" — SEAD under a hostile CAP umbrella (phase 11 INC-7).
// Fantasy: magnum work with a named aggressor prowling overhead — kill the
// site fast, then live through his hour. First authored ace encounter
// (JACKAL, engine.js ACES NELLIS id 1 — TYPHOON stays finale-only).
//
// 7-BEAT SHEET:
//   1 BRIEF      311-313 — the site, JACKAL's sweep, the warning
//   2 SPAWN      ON_START 311
//   3 INGRESS    spawn (-16000,-14000) -> site (4200,-9800) ≈ 20.6 km
//                ≈ 90 s; 314 at t25, 319 at t90 (RWR flavor)
//   4 OBJ A      obj 2: radar + both TELs (boot rows 6,7,8 — the site
//                already shoots back; noaaa only exists in batteries)
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 315: JACKAL turns in.
//                AMBUSH TIMING TRICK: JACKAL spawns at START 30 km NE with a
//                ~102 km sweep route whose every pre-ring leg stays >= 14 km
//                from the site (outside his 10 km ENGAGE commit while you
//                fight the site); the route enters a 7-10 km ring around the
//                site at ≈ 425 s (101.9 km at cruise 240 — panel MUST-2
//                pushed entry +26 km / +110 s so an average site kill is
//                long done, not just a fast one). Once ringed, the player
//                at the site is inside ENGAGE_R and he commits himself.
//                The turn line is the reveal.
//   6 CLIMAX     obj 3: take JACKAL off the board — destroy_tag air need 1
//                on his tag counts !live, so a KILL (383) and a smoking
//                BINGO ESCAPE over the fence (382, amendment 1) BOTH
//                complete it: one 9X puts him at 30 hp and he runs. The
//                objective can only resolve through the fight, so the
//                victory line can never fire in a doomed run (the
//                survive_until anchor was rejected for exactly that —
//                it self-completes on the clock even in losses).
//   7 RESOLUTION 316 victory once the site is dark and JACKAL is gone /
//                317 timeout
//
// GUARDRAILS: obj-2 phase shooters = zsu 4 + zsu 5 + TEL 7 + TEL 8 = 4
// (the NELLIS exactly-4 precedent); JACKAL's route keeps him >= 14 km out
// until ring entry at ≈ 425 s — roughly twice a competent site kill, so on
// the designed pace the count never exceeds 4. HONEST SLOW-PATH NOTE
// (panel MUST-2 ruling): timing cannot cover every pace — a player still
// facing a fully intact site past 425 s can transiently see 5 telegraphed
// shooters. Mitigation is composition, not stats: every radar/TEL kill
// subtracts a shooter (the dish dies first in practice), JACKAL commits
// from 10 km behind the loudest telegraph on the map (ace diamond + RWR),
// and the count self-corrects with the player's own progress. The t26
// audit models the designed phase order. obj-3 phase = zsu 4 + zsu 5 +
// JACKAL = 3 (TELs dead — objective order doing the composition work).
// Bandit count 1 <= 8; engage-capable 1 <= 4.

import { TRIG } from "../../game/missions.js";

// n laps of the 7-10 km ring around the SAM site, as plain [[x,y],...] data
const ringLaps = (n) => Array.from({ length: n },
  () => [[10000, -14000], [-2000, -14000], [-2000, -4000], [12000, -4000]]).flat();

export default {
  id: "N02",
  front: "NELLIS",
  titleId: 310,
  briefingIds: [311, 312, 313],
  meta: { turnObj: 2, turnLineId: 315, victoryLineId: 316, defeatLineId: 317 },
  spec: {
    v: 1, kind: "authored",
    front: "NELLIS",
    type: "sead",
    seed: 0x0aceb1,
    todH: 18.8, weatherIdx: 0,
    playerSpawn: { x: -16000, y: -14000, alt: 3600, headingDeg: 11.7, speed: 220 },
    airfield: { x: -3000, y: -8700, r: 900 },
    units: [],
    paths: {},
    // JACKAL: tier-3 ace, explicit A3 opt-in. Sweep legs (cumulative km at
    // cruise 240): 14.1 / 26.8 / 37.6 / 46.5 / 54.7 / 62.0 / 72.2 / 87.8 /
    // 101.9 -> ring entry ≈ 425 s (the +26 km panel MUST-2 extension is the
    // (26000,0) + (14000,10000) leg pair); then THREE 46.2 km ring laps
    // (≈ 192 s each) around the site cover the slow path to ≈ 1000 s
    // before egress. Pre-ring min distance to the site: 14.3 km.
    bandits: [
      { kind: "fighter", tier: 3, aceId: 1, engage: true, tag: 6, side: 0,
        x: 20000, y: 16000, z: 5200, headingDeg: -150, speed: 260,
        wpts: [[6000, 14000], [18000, 10000], [8000, 6000], [16000, 2000], [18000, -6000], [24000, -10000],
          [26000, 0], [14000, 10000], [12000, -4000],
          ...ringLaps(3)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 900, y: -10500, r: 2500 } },  // the run-in point
      { id: 2, kind: "destroy_tag", bfIdx: [6, 7, 8], need: 3 },            // radar + both TELs
      { id: 3, kind: "destroy_tag", air: true, tag: 6, need: 1 },           // JACKAL off the board (kill or driven off)
    ],
    winWhen: [2, 3], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 311 },
      { on: TRIG.ON_TIME, t: 25, lineId: 314 },
      { on: TRIG.ON_TIME, t: 45, lineId: 380 },              // JACKAL on guard
      { on: TRIG.ON_TIME, t: 90, lineId: 319 },              // RWR flavor
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 318 },   // contact the site
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 315 },   // THE TURN
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 316 },   // victory
      { on: TRIG.ON_TIME, t: 1500, lineId: 317 },            // timeout defeat
      { on: TRIG.ON_ACE_STATE, aceId: 1, aceState: "smoking", lineId: 381 },
      { on: TRIG.ON_ACE_STATE, aceId: 1, aceState: "escaped", lineId: 382 },
      { on: TRIG.ON_ACE_STATE, aceId: 1, aceState: "killed", lineId: 383 },
    ],
    scoreKm: 2.0,
  },
};
