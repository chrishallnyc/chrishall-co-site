// N05 "THE AIR BRIDGE" — strangle the airlift (phase 11 INC-8 batch 2).
// Fantasy: dusk over the range and the enemy is trying to LAND a war — heavy
// transports coming down the northern corridor in two waves to put a
// battalion on the desert LZ, with a pair of hired tier-3 guns sweeping
// ahead of the second wave. Nothing about this is a footrace (V02) or a
// single courier hunt (M04): it is a stream of heavies descending on a
// point, and you close the door. First tier-3 opposition of the batch.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      451-453 — the airlift, the two waves, the guns
//   2 SPAWN      ON_START 451
//   3 INGRESS    spawn (-14000,-10000) -> vector gate (-8000,4000)
//                ≈ 15.2 km ≈ 69 s; 454 at t25
//   4 OBJ A      obj 2: wave 1 — two heavies off the NE on 47.6-49.0 km
//                dog-legs; the LZ ring (r 3000 at (-4000,14000)) trips at
//                ≈ 44.6-46.0 km ≈ 297-306 s unopposed (measured). Mid-route
//                wpts hold >= 10.8 km from the LZ (M01 MUST-3 standoff).
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 455: wave two confirmed — and it
//                sent its GUNS ahead. AMBUSH TIMING TRICK: the tier-3
//                cover pair (tag 22) spawned at START far SE on 53.1/58.8 km
//                sweeps whose pre-entry legs hold >= 19.0 km from the LZ;
//                they enter an 11 km ring at ≈ 221/245 s — on the heels of
//                a competent wave-1 kill — then ride 8 racetrack lap pairs
//                (11.3 km legs) out to ≈ 950/958 s of total route (D-073
//                route LAW comfort; they are engage-capable and commit
//                themselves regardless). ON_TIME t=205 cover call 459 is
//                un-gated so a stalled wave-1 kill never mutes the reveal.
//   6 CLIMAX     obj 3: wave 2 — two more heavies on 67.4-68.4 km weaves,
//                LZ ring at ≈ 64.4-65.4 km ≈ 429-436 s (measured), fought
//                through the cover pair. 519 at t=385 is the un-gated
//                wave-2 clock.
//   7 RESOLUTION 456 victory / 457 wheels-down defeat (zone denial — same
//                lineId on both denial rows, the V02 pattern). No t=1500
//                row: any live heavy trips the ring by ~520 s and a dead
//                airlift IS the win, so the clock can never expire first
//                (the V02 intercept precedent).
// ENVELOPE: median session ≈ 8-8.5 min (gate ~70 s, wave-1 kill
// ~150-220 s, cover duel ~240-400 s, wave-2 kill ~400-500 s); THE TURN
// ≈ 40-45% of median.
//
// ROUTE LAW (D-073): both transport waves TERMINATE inside the LZ denial
// ring — unopposed they end the sortie (loseWhen 4/5), so the win-required
// air objectives can never be stranded by route exhaustion. The cover pair
// is NOT win-required (alive guns at the win are the fiction: they ran
// when the airlift died — the M04 escort precedent).
//
// GUARDRAILS (amendment 5): the cover pair is the ONLY thing that ever
// shoots at the player — 2 tier-3 ENGAGE fighters (t26 phase model:
// post-turn), spawned 35+ km from every pre-turn center. The heavies are
// unarmed; no boot shooter is within 5 km of any objective center (zsu 11
// is 6.2 km from the gate, everything else 10+). Max 2 <= 4. Bandits
// 2+2+2 = 6 <= 8; engage 2 <= 4. Difficulty via composition: tier 3 flies
// better geometry, same honest airframe.

import { TRIG } from "../../game/missions.js";

// n racetrack laps between two waypoints, as plain [[x,y],...] data
const laps = (a, b, n) => Array.from({ length: n }, () => [a, b]).flat();

export default {
  id: "N05",
  front: "NELLIS",
  titleId: 450,
  briefingIds: [451, 452, 453],
  meta: { turnObj: 2, turnLineId: 455, victoryLineId: 456, defeatLineId: 457 },
  spec: {
    v: 1, kind: "authored",
    front: "NELLIS",
    type: "intercept",
    seed: 0xa16b21,
    todH: 18.8, weatherIdx: 0,
    playerSpawn: { x: -14000, y: -10000, alt: 3600, headingDeg: 66.8, speed: 240 },
    airfield: { x: -3000, y: -8700, r: 900 },
    units: [],
    paths: {},
    bandits: [
      // wave 1 (tag 20): two heavies off the NE corner. Cum walks at
      // transport cruise 150: w1a 12.6/22.6/36.8/49.0 km -> LZ ring 46.0 km
      // ≈ 306 s; w1b 12.6/22.6/36.8/47.6 -> ring 44.6 km ≈ 297 s. Mid wpts
      // >= 10.8 km from the LZ.
      { kind: "transport", tier: 0, x: 28000, y: 26000, z: 2600, headingDeg: -162, speed: 150, tag: 20, side: 0,
        wpts: [[16000, 22000], [22000, 14000], [8000, 16000], [-4000, 14000]] },
      { kind: "transport", tier: 0, x: 26000, y: 28000, z: 3000, headingDeg: -162, speed: 150, tag: 20, side: 0,
        wpts: [[14000, 24000], [20000, 16000], [6000, 18000], [-4000, 14000]] },
      // wave 2 (tag 21): two heavies off the east on longer weaves. Cum
      // walks: w2a 10.0/20.0/32.2/42.2/54.5/68.4 -> ring 65.4 km ≈ 436 s;
      // w2b 11.3/21.3/33.5/43.5/56.0/67.4 -> ring 64.4 km ≈ 429 s.
      // Pre-final legs hold >= 11.4 km from the LZ.
      { kind: "transport", tier: 0, x: 28000, y: -2000, z: 2400, headingDeg: 143, speed: 150, tag: 21, side: 0,
        wpts: [[20000, 4000], [26000, 12000], [14000, 10000], [20000, 18000], [8000, 21000], [-4000, 14000]] },
      { kind: "transport", tier: 0, x: 26000, y: -6000, z: 2800, headingDeg: 135, speed: 150, tag: 21, side: 0,
        wpts: [[18000, 2000], [24000, 10000], [12000, 8000], [18000, 16000], [6000, 19500], [-4000, 14000]] },
      // the COVER (tag 22): two tier-3 ENGAGE fighters sweeping ahead of
      // wave 2. Cum walks at cruise 240: c1 10.0/22.3/32.3/44.3 -> 11 km
      // LZ-ring entry 53.1 km ≈ 221 s; c2 12.0/23.7/33.7/46.3 -> entry
      // 58.8 km ≈ 245 s. Pre-entry legs >= 19.0 km from the LZ; then 8
      // racetrack lap pairs (11.3 km legs ≈ 47 s) to ≈ 950/958 s total.
      { kind: "fighter", tier: 3, engage: true, x: 26000, y: -8000, z: 5200, headingDeg: 96, speed: 260, tag: 22, side: 0,
        wpts: [[27000, 2000], [20000, 12000], [26000, 20000], [14000, 20000], ...laps([0, 20000], [-8000, 12000], 8)] },
      { kind: "fighter", tier: 3, engage: true, x: 28000, y: -12000, z: 5600, headingDeg: 90, speed: 260, tag: 22, side: 0,
        wpts: [[28000, 0], [22000, 10000], [28000, 18000], [16000, 22000], ...laps([2000, 22000], [-6000, 14000], 8)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: -8000, y: 4000, r: 2500 } },   // the vector gate
      { id: 2, kind: "destroy_tag", air: true, tag: 20, need: 2 },           // wave 1
      { id: 3, kind: "destroy_tag", air: true, tag: 21, need: 2 },           // wave 2
      { id: 4, kind: "protect_tag", air: true, tag: 20, zone: { x: -4000, y: 14000, r: 3000 } }, // LZ denial
      { id: 5, kind: "protect_tag", air: true, tag: 21, zone: { x: -4000, y: 14000, r: 3000 } },
    ],
    winWhen: [2, 3], loseWhen: [4, 5],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 451 },
      { on: TRIG.ON_TIME, t: 25, lineId: 454 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 458 },   // picture from the gate
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 455 },   // THE TURN
      { on: TRIG.ON_TIME, t: 205, lineId: 459 },             // cover call, un-gated (entry ≈ 221-245 s)
      { on: TRIG.ON_TIME, t: 245, lineId: 520 },             // wave-1 wheels-down clock, un-gated (panel MUST-3; ring ≈ 297-306 s)
      { on: TRIG.ON_TIME, t: 385, lineId: 519 },             // wave-2 clock, un-gated (ring ≈ 429-436 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 456 },   // victory
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 4, lineId: 457 }, // wheels down
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 5, lineId: 457 },
    ],
    scoreKm: 1.5,
  },
};
