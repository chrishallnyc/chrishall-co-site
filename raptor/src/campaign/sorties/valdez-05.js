// V05 "STILL WATER" — the midnight-sun harbor raid (phase 11 INC-8
// batch 2, the batch's MOOD PIECE — brief item d). Fantasy: 21.4 on the
// clock and the light never quite dies over the Sound. Two enemy hulls
// swing at anchor in the glass — a destroyer and the freighter she
// shepherds — decks dark, guns cold, nothing on the radio. Sink them in
// the silence, and meet what the silence was hiding: their night patrol
// coming back down the gulf. The mood is MECHANICAL TRUTH, not set
// dressing: no gun on the map can reach the anchorage (nearest boot
// shooter 9.4 km), so the entire harbor run happens without one tracer —
// until the turn. Comms are deliberately sparse: four voice lines before
// the turn, and two of them are whispers.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      471-473 — the hulls, the light, the one warning
//   2 SPAWN      ON_START 471
//   3 INGRESS    spawn (0,-6000) -> run-in (1500,-18500) ≈ 12.6 km ≈ 57 s
//                down the glass; 474 at t25 (the only ingress line — the
//                quiet is the point)
//   4 OBJ A      obj 2: the anchorage pair — boot rows 0 (destroyer,
//                hp 120: she takes more than one 9X) and 1 (freighter,
//                hp 80), 4 km apart on the water; a small multi-pass
//                gun-and-rails study with nothing shooting back
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 475: the patrol answers. AMBUSH
//                TIMING TRICK: two tier-3 ENGAGE fighters (tag 55) spawned
//                at START far east over the gulf on 74.3/75.8 km weaves
//                whose every pre-entry leg holds >= 14.1 km from the
//                anchorage (measured per leg); they enter a 10 km ring at
//                ≈ 310/316 s — on the heels of a competent two-hull kill
//                (~180-280 s) — then ride FOUR anchorage ring laps out to
//                ≈ 957/946 s of total route (D-073 route LAW window; they
//                are engage-capable and commit themselves regardless).
//                ON_TIME t=265 backstop 479 breaks the silence un-gated.
//   6 CLIMAX     obj 3: the night patrol over the glass — destroy_tag
//                need 2 counts !live, so kills and a smoking BINGO run
//                over the fence both resolve it; the fight happens in the
//                long gold light the sortie was built for.
//   7 RESOLUTION 476 victory / 477 timeout (offense; t=1200 warning 512)
// ENVELOPE: median session ≈ 7-7.5 min (run-in ~60 s, hulls ~180-280 s,
// patrol arrives ~310 s, duel ~340-450 s); THE TURN ≈ 50-60% of median
// (top of the window by design — the mood piece spends its first half on
// the quiet).
//
// ROUTE LAW (D-073): the win-required patrol is engage-capable (resolves
// through the fight whenever the player is within 10 km) AND loiters the
// anchorage ring to ≈ 950 s; the hulls are boot rows. No stranding path.
//
// GUARDRAILS (amendment 5): ZERO shooters during the entire harbor phase —
// the hulls are scenery-with-hitpoints, VALDEZ boot zsu 4 is 13.1 km out,
// TEL 6 is 9.4 km out (both > 5 km ring). Post-turn: the patrol pair = 2
// <= 4, telegraphed by ace-free RWR + diamonds. Bandits 2 <= 8; engage
// 2 <= 4. Second tier-3 sortie of the batch.

import { TRIG } from "../../game/missions.js";

// n laps of the anchorage ring, as plain [[x,y],...] data
const ringLaps = (pts, n) => Array.from({ length: n }, () => pts).flat();

export default {
  id: "V05",
  front: "VALDEZ",
  titleId: 470,
  briefingIds: [471, 472, 473],
  meta: { turnObj: 2, turnLineId: 475, victoryLineId: 476, defeatLineId: 477 },
  spec: {
    v: 1, kind: "authored",
    front: "VALDEZ",
    type: "anti_ship",
    seed: 0x511170,
    todH: 21.4, weatherIdx: 0,
    playerSpawn: { x: 0, y: -6000, alt: 3600, headingDeg: -83.2, speed: 220 },
    airfield: { x: 0, y: -6000, r: 600 },
    units: [],
    paths: {},
    bandits: [
      // the night patrol (tag 55): two tier-3s coming home down the gulf.
      // Cum walks at cruise 240: p1 10.8/20.8/29.0/40.3/47.9/60.0/69.2 ->
      // 10 km ring entry 74.3 km ≈ 310 s; p2 10.8/20.8/29.3/40.6/49.2/
      // 60.5/69.8 -> entry 75.8 km ≈ 316 s. Pre-entry legs hold >= 14.1 /
      // 15.0 km from the anchorage (2000,-26000); then FOUR ring laps
      // (40/43.5 km) to ≈ 957/946 s of total route.
      { kind: "fighter", tier: 3, engage: true, x: 26000, y: -4000, z: 4800, headingDeg: -158, speed: 260, tag: 55, side: 0,
        wpts: [[16000, -8000], [24000, -14000], [16000, -12000], [24000, -20000], [17000, -17000], [25000, -26000], [16000, -24000],
          ...ringLaps([[8000, -21000], [-4000, -21000], [-4000, -29000], [8000, -29000]], 4)] },
      { kind: "fighter", tier: 3, engage: true, x: 28000, y: -8000, z: 5400, headingDeg: -158, speed: 260, tag: 55, side: 0,
        wpts: [[18000, -12000], [26000, -18000], [18000, -15000], [26000, -23000], [18000, -20000], [26000, -28000], [17000, -25500],
          ...ringLaps([[9000, -22000], [-3000, -22000], [-3000, -29500], [9000, -29500]], 4)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 1500, y: -18500, r: 2500 } },  // the run-in on the glass
      { id: 2, kind: "destroy_tag", bfIdx: [0, 1], need: 2 },                // destroyer + freighter (boot rows)
      { id: 3, kind: "destroy_tag", air: true, tag: 55, need: 2 },           // the night patrol
    ],
    winWhen: [2, 3], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 471 },
      { on: TRIG.ON_TIME, t: 25, lineId: 474 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 478 },   // the whisper on the run-in
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 475 },   // THE TURN
      { on: TRIG.ON_TIME, t: 265, lineId: 479 },             // patrol backstop, un-gated (entry ≈ 310-316 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 476 },   // victory
      { on: TRIG.ON_TIME, t: 1200, lineId: 512 },            // 5-min clock warning
      { on: TRIG.ON_TIME, t: 1500, lineId: 477 },            // timeout defeat
    ],
    scoreKm: 2.5,
  },
};
