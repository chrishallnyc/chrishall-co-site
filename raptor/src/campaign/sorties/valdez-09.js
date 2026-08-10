// V09 "DEADBOLT" — the last push, VALDEZ (phase 11 INC-8 batch 4, sortie
// 27). Fantasy: V07 broke the belt and promised "the fleet comes home
// through those narrows next week" — so the enemy spends its last week
// RELOCKING the door: two minelayer hulls stopped in the homecoming lane
// (the campaign's first spawned RED hulls on VALDEZ) and a scratch rail
// going onto the belt's old site-B bones on the west flat. VALDEZ's first
// combined-arms strike: SEAD + anti-ship in one screen, player's order,
// then the glacier-line answer — the front's first NON-ACE tier-4 pair
// (the N08 normalization arrives on VALDEZ). Sets V10's table: the lane
// must be clean before the fleet stands in.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      621-623 — the layers, the rail on old bones, the answer
//   2 SPAWN      ON_START 621
//   3 INGRESS    spawn (0,-6000) -> run-in (2000,-19000) ≈ 13.2 km ≈ 60 s
//                at 220; 624 at t25. Run-in -> battery 12.9 km; battery ->
//                hulls 19.0 km (the trade 622 briefs).
//   4 OBJ A/B    obj 2 THE BATTERY — spawned radar + rail on V07's probed
//                site-B cell (-10000,-14000, heightAt 446.8-466.1 m span
//                19.3 m, re-probed 2026-08-09: "the belt's old bones" is
//                geometry-true) — and obj 3 THE MINELAYERS — spawned
//                cargo hull (3000,-26500) + escort destroyer (5000,-27200),
//                both cells probed real water (heightAt -15). One job,
//                two locations, player's order (622); un-gated 681 at
//                t=170 is the state-agnostic count clock (the 599 trough
//                law).
//   5 THE TURN   ON_OBJECTIVE_DONE(3) -> 625: the answer moves. The pair
//                leaves its glacier hold at ≈ 192 s (CLOCK-driven — and
//                because 192 s precedes every plausible turn, the turn
//                line's "their air is off the glacier line" is TRUE on
//                every path, fast or slow: run-in 60 s + 19 km transit
//                bounds the earliest hulls-kill ≈ 220 s). Un-gated 629 at
//                t=290 carries the descent (10 km anchorage-ring entry
//                ≈ 321/354 s, measured).
//   6 CLIMAX     obj 4 THE ANSWER — tier-4 pair over the dead lane,
//                destroy_tag need 2 counts !live.
//   7 RESOLUTION 626 victory (pair-scoped, order-agnostic: "whatever's
//                left on your list") / 627 timeout (state-agnostic "half
//                a lock still stops a fleet"; offense anti_ship;
//                varied-shape t=1200 clock 680)
// ENVELOPE: median session ≈ 8-8.5 min (run-in 60 s, battery 120-200 s,
// hulls 260-340 s = THE TURN ≈ 55-65% of median — the sead-then-answer
// shape re-documented per the V05/V07 exception precedent (D-078 rider:
// V07's own envelope reads ~52-70%), pair 321-354 s, killed ~380-500 s).
//
// ROUTE LAW (D-073): battery and hulls are ground/naval (never despawn).
// The win-required pair is ENGAGE-capable (self-commits inside 10 km) AND
// rides FIVE 46 km anchorage-ring laps to ≈ 1280/1271 s of total route
// (the V07-pair 1302 s / V08-hunters 986 s precedent band). No stranding
// path.
//
// GUARDRAILS (amendment 5): battery phase = its own rail (1 shooter,
// briefed live by 622/624; the dish senses). Hull phase = 0 shooters
// (nearest boot shooter tel 6 is 7.0-8.6 km from the hull cells, 10.4 km
// from the run-in; boot zsu 4 is 12.2+ km — outside every 5 km ring; the
// boot red hulls at (2000,-24000)/(2000,-28000) are scenery, 2.6-3.5 km
// off the lane, unnamed by the radio). Worst case: a player who drags
// the tier-4 pair over a still-live battery faces 1 rail + 2 fighters
// = 3 <= 4, all telegraphed. Bandits 2 <= 8; engage 2 <= 4. Ambush
// honesty: pair spawns 42-55 km from every pre-turn center; hold legs
// >= 19.9/22.4 km from the whole play line (measured) until the
// announced descent. Tier 4 is composition, not stats. LINE AUDIT: no
// "Five minutes" opener (680 varied), no "half a minute" (629 "inside a
// minute"), no "...is empty" shape, '...' tic NOT used; 681 varied off
// the 599 arithmetic line it descends from.
//
// POOL/capacity (VALDEZ n=7): 1 sam_radar -> reserve slot 14 (of 4);
// 1 sam_tel -> slot 12 (of 6); 1 cargo_ship -> slot 43 (of 2);
// 1 destroyer -> slot 44 (of 2). destroy bfIdx below IS that
// deterministic first-free-typed assignment.

import { TRIG } from "../../game/missions.js";

// n laps of a 4-corner ring
const ringLaps = (pts, n) => Array.from({ length: n }, () => pts).flat();

export default {
  id: "V09",
  front: "VALDEZ",
  titleId: 620,
  briefingIds: [621, 622, 623],
  meta: { turnObj: 3, turnLineId: 625, victoryLineId: 626, defeatLineId: 627 },
  spec: {
    v: 1, kind: "authored",
    front: "VALDEZ",
    type: "anti_ship",
    seed: 0xdeadb1,
    todH: 15.5, weatherIdx: 0,
    playerSpawn: { x: 0, y: -6000, alt: 3600, headingDeg: -81.3, speed: 220 },
    airfield: { x: 0, y: -6000, r: 600 },
    // the relock: the scratch battery on site B's old bones + the two
    // layers stopped in the lane (spawned in this order for the slot math)
    units: [
      ["sam_radar", -10000, -14000, 0.8, 0, 37],
      ["sam_tel", -9700, -13800, 1.4, 0, 37],
      ["cargo_ship", 3000, -26500, 2.2, 0, 38],
      ["destroyer", 5000, -27200, 0.6, 0, 38],
    ],
    paths: {},
    bandits: [
      // the ANSWER (tag 56): tier-4 NON-ACE pair behind the glacier line.
      // Hold walks at cruise 240: 10.8/19.3/29.8/38.0/46.1 km -> off the
      // hold ≈ 192 s (both); descent to a 10 km anchorage ring at
      // 77.1/85.0 km ≈ 321/354 s; then FIVE 46 km ring laps to
      // ≈ 307.3/305.1 km ≈ 1280/1271 s of total route. Every hold leg
      // >= 19.9/22.4 km from the play line (measured).
      { kind: "fighter", tier: 4, engage: true, x: -8000, y: 27000, z: 5000, headingDeg: -22, speed: 260, tag: 56, side: 0,
        wpts: [[2000, 23000], [-6000, 20000], [4000, 17000], [-4000, 15000], [4000, 13500], [6000, 2000], [3000, -10000], [3500, -17000],
          ...ringLaps([[11000, -20000], [-4000, -20000], [-4000, -28000], [11000, -28000]], 5)] },
      { kind: "fighter", tier: 4, engage: true, x: 0, y: 28000, z: 5400, headingDeg: -22, speed: 260, tag: 56, side: 0,
        wpts: [[10000, 24000], [2000, 21000], [12000, 18000], [4000, 16000], [12000, 14500], [13000, 3000], [9000, -9000], [7500, -16500],
          ...ringLaps([[12000, -19000], [-3000, -19000], [-3000, -27000], [12000, -27000]], 5)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", labelId: 691, zone: { x: 2000, y: -19000, r: 2500 } },   // the run-in over the Sound
      { id: 2, kind: "destroy_tag", labelId: 704, bfIdx: [14, 12], need: 2 },               // the battery (spawned slots)
      { id: 3, kind: "destroy_tag", labelId: 705, bfIdx: [43, 44], need: 2 },               // the minelayers (spawned slots)
      { id: 4, kind: "destroy_tag", labelId: 706, air: true, tag: 56, need: 2 },            // the answer
    ],
    winWhen: [2, 3, 4], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 621 },
      { on: TRIG.ON_TIME, t: 25, lineId: 624 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 628 },   // tally the layers
      { on: TRIG.ON_TIME, t: 170, lineId: 681 },             // count clock, un-gated, state-agnostic (trough law)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 625 },   // THE TURN (hulls — the louder kill)
      { on: TRIG.ON_TIME, t: 290, lineId: 629 },             // pair backstop, un-gated (off hold ≈ 192 s, ring ≈ 321-354 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 4, lineId: 626 },   // victory (pair-scoped)
      { on: TRIG.ON_TIME, t: 1200, lineId: 680 },            // clock warning (varied shape)
      { on: TRIG.ON_TIME, t: 1500, lineId: 627 },            // timeout defeat
    ],
    scoreKm: 2.5,
  },
};
