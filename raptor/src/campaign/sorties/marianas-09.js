// M09 "IN KIND" — the last push, MARIANAS (phase 11 INC-8 batch 4, sortie
// 29). Fantasy: the eye is dead (M07), the doors are shut (M08) — so the
// enemy's naval-air remnant turns around and comes for OUR fuel: a
// revenge raid on the Andersen flightline, off the same north field their
// heavies ran from. The first defense of home plate on MARIANAS, and the
// front's first BLUE GROUND to protect (four spawned bowsers on the
// probed pad-edge cell) — the V01/N03 raider-vs-surface grammar pointed
// at the player's own field. Riding wide of the raid: "the two fighters
// nobody believed they still had" (642 owns the M08 'their last two
// fighters' continuity out loud) — tier-4 non-ace, the N08 normalization.
// Sets M10's table: this raid is what a cornered theater does the week
// its flagship runs.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      641-643 — the raid, the two pulses, the bowser math
//   2 SPAWN      ON_START 641
//   3 INGRESS    spawn (-3200,-8000) -> station (9000,3000) r2500
//                ≈ 16.4 km ≈ 68 s at 240; 644 at t25
//   4 OBJ A      obj 2 FIRST WAVE — the lead pair (tag 60, tier-2
//                raiders, attackTag 90) down the island line: 8 km dive
//                commit at 48.3/48.7 km ≈ 201/203 s (measured; un-gated
//                649 at t=165). THE FLIGHTLINE (obj 3, amber protect row,
//                need 2): four bowsers at (-2800,-8300) (heightAt across
//                the four placements 4.0-6.9 m — probed 2026-08-09 live
//                grid, the pad-edge flat); every leaked launch kills one
//                bowser, two dead bowsers = defeat — 643 briefs the
//                arithmetic exactly.
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 645 (spawn-fact: "the main raid
//                is still coming" is true from t=0; the fighters clause
//                is state-agnostic "choosing their moment" — their cut is
//                CLOCK-driven at ≈ 235-251 s, so at a fast turn they are
//                still holding). Un-gated 689 at t=255 carries their
//                movement (11 km station-ring entry ≈ 281/286 s,
//                measured) — the guns sweep in AHEAD of the freight.
//   6 CLIMAX     obj 4 SECOND WAVE — three raiders wide across the gap,
//                8 km dive commits ≈ 374-382 s (un-gated 688 at t=340),
//                fought through the tier-4 pair. The escorts are NOT
//                win-required and carry no objective row (the M04/N05
//                escort precedent: alive at the win = nothing left to
//                escort).
//   7 RESOLUTION 646 victory (raid-scoped, escort-agnostic: "whatever
//                their fighters do now, they do it for nobody") / 647
//                flightline loss (protect need 2) / 687 defense-timeout
//                VICTORY flavor (intercept: the 399 pattern — launched-
//                and-egressed raiders are "spent")
// ENVELOPE: median session ≈ 8.5-9.5 min (station 68 s, wave-1 intercept
// 120-200 s = THE TURN ≈ 30-40% of median, escorts 281-286 s, wave 2
// 374-450 s, sweep-up to ~520-580 s).
//
// ROUTE LAW (D-073): intercept — defense timeout with the protect intact
// is VICTORY, so launched-and-egressed raiders can never strand the
// win-required wave objectives (the V01 grammar). The escorts are
// ENGAGE-capable, not win-required, and loiter DISTINCT northeast boxes
// ((16000,5000)-(8000,7500) / (15000,9500)-(7000,12000) — clear of the
// waves' terminal lanes, the batch-2 distinct-loiter SHOULD) to
// ≈ 1121/1126 s of total route. No stranding path.
//
// GUARDRAILS (amendment 5): the escorts are the ONLY shooters — 2 tier-4
// ENGAGE = 2 <= 4, telegraphed (642 briefs them, 689 calls the sweep,
// RWR + diamonds at the 18 km gate). Raiders never shoot the player
// (engage-less A1). Ground: boot zsu 8 sits 4.8 km from the flightline
// centroid (counted: worst phase = 1 ground + 2 air = 3 <= 4) but
// OUTSIDE its own 2.6 km AAA reach of the pad (the D-061 probe truth —
// rearm stays unshelled); the station is 5.7/7.1 km from boot tel 7 /
// zsu 3. Bandits 7 <= 8; engage 2 <= 4. Ambush honesty: escort spawns
// are 21.5/21.5 km from the station, 31.4/37.5 km from the flightline,
// 33.6/17.3 km from the wave-1 spawn centroid (all >= 15), and every
// hold leg sits >= 19.1/20.7 km from the play line (outside the 18 km
// gate until the announced cut, measured). Tier 4 is composition, not
// stats. LINE AUDIT: no "Five minutes" opener, no "half a minute" (649
// "under a minute" / 688 "a minute wide" — idioms varied), no "...is
// empty" shape, '...' tic NOT used.
//
// POOL/capacity (MARIANAS n=10): 4 supply_truck -> reserve slots
// 10,11,13,16 (of 16). protect bfIdx below IS that deterministic
// first-free-typed assignment.

import { TRIG } from "../../game/missions.js";

// n racetrack laps between two waypoints, as plain [[x,y],...] data
const laps = (a, b, n) => Array.from({ length: n }, () => [a, b]).flat();

export default {
  id: "M09",
  front: "MARIANAS",
  titleId: 640,
  briefingIds: [641, 642, 643],
  meta: { turnObj: 2, turnLineId: 645, victoryLineId: 646, defeatLineId: 647 },
  spec: {
    v: 1, kind: "authored",
    front: "MARIANAS",
    type: "intercept",
    seed: 0x7a7f09,
    todH: 12, weatherIdx: 0,
    playerSpawn: { x: -3200, y: -8000, alt: 3600, headingDeg: 42.0, speed: 240 },
    airfield: { x: -3200, y: -8000, r: 600 },
    // OUR flightline: four fuel bowsers on the pad-edge flat (side 1,
    // tag 90 — the wave targeting)
    units: [
      ["supply_truck", -2850, -8350, 0.5, 1, 90],
      ["supply_truck", -2750, -8300, 0.5, 1, 90],
      ["supply_truck", -2800, -8250, 0.5, 1, 90],
      ["supply_truck", -2700, -8380, 0.5, 1, 90],
    ],
    paths: {},
    bandits: [
      // FIRST WAVE (tag 60): the lead pair off the north field, down the
      // island line at the bowsers (attackTag 90). Cum walks at cruise
      // 240: 7.8/16.4/25.4/33.2/41.7 -> 8 km dive commit at 48.3/48.7 km
      // ≈ 201/203 s (measured).
      { kind: "fighter", tier: 2, x: 14000, y: 26000, z: 1100, headingDeg: -140, speed: 250, tag: 60, side: 0, attackTag: 90,
        wpts: [[8000, 21000], [15000, 16000], [7000, 12000], [13000, 7000], [5000, 4000], [500, -2500], [-1500, -5500]] },
      { kind: "fighter", tier: 2, x: 17000, y: 24000, z: 1300, headingDeg: -140, speed: 250, tag: 60, side: 0, attackTag: 90,
        wpts: [[11000, 19000], [18000, 14000], [10000, 10000], [16000, 5000], [8000, 2000], [2000, -3500], [-500, -6000]] },
      // SECOND WAVE (tag 61): three raiders on wide east loops — 8 km
      // dive commits at 89.7/90.3/91.7 km ≈ 374/376/382 s (measured).
      { kind: "fighter", tier: 2, x: 26000, y: 22000, z: 1200, headingDeg: 153, speed: 250, tag: 61, side: 0, attackTag: 90,
        wpts: [[18000, 26000], [26000, 20000], [16000, 24000], [24000, 16000], [14000, 20000], [20000, 10000], [10000, 12000], [4000, 4000], [-500, -4500]] },
      { kind: "fighter", tier: 2, x: 28000, y: 18000, z: 1500, headingDeg: 143, speed: 250, tag: 61, side: 0, attackTag: 90,
        wpts: [[20000, 24000], [28000, 18000], [18000, 22000], [26000, 14000], [16000, 18000], [22000, 8000], [12000, 10000], [6000, 2000], [500, -5500]] },
      { kind: "fighter", tier: 2, x: 27000, y: 25000, z: 1800, headingDeg: 159, speed: 250, tag: 61, side: 0, attackTag: 90,
        wpts: [[19000, 28000], [27000, 22000], [17000, 26000], [25000, 18000], [15000, 22000], [21000, 12000], [11000, 14000], [5000, 6000], [-1500, -3500]] },
      // the ESCORTS (tag 62): the two fighters nobody believed they still
      // had — tier-4 ENGAGE on far-east holds (every hold leg >= 20.7/
      // 19.1 km from the play line), off the hold ≈ 235/251 s, 11 km
      // station-ring entry ≈ 281/286 s (sweeping in AHEAD of the
      // freight), then DISTINCT northeast loiter boxes to ≈ 1121/1126 s
      // of total route. NOT win-required.
      { kind: "fighter", tier: 4, engage: true, x: 28500, y: -6000, z: 5200, headingDeg: 99, speed: 260, tag: 62, side: 0,
        wpts: [[29000, -3000], [26000, -10000], [29000, -3000], [26000, -10000], [29000, -3000], [26000, -10000], [29000, -3000], [26000, -10000],
          [21000, -3000], [15000, 1000], ...laps([16000, 5000], [8000, 7500], 12)] },
      { kind: "fighter", tier: 4, engage: true, x: 28000, y: 13000, z: 5600, headingDeg: -175, speed: 260, tag: 62, side: 0,
        wpts: [[28500, 6000], [25500, 13000], [28500, 6000], [25500, 13000], [28500, 6000], [25500, 13000], [28500, 6000], [25500, 13000],
          [20000, 9000], [14000, 6000], ...laps([15000, 9500], [7000, 12000], 12)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", labelId: 708, zone: { x: 9000, y: 3000, r: 2500 } },     // on station in the gap
      { id: 2, kind: "destroy_tag", labelId: 692, air: true, tag: 60, need: 2 },            // the lead pair
      { id: 3, kind: "protect_tag", labelId: 697, bfIdx: [10, 11, 13, 16], need: 2 },       // the flightline (amber row; one loss survivable)
      { id: 4, kind: "destroy_tag", labelId: 693, air: true, tag: 61, need: 3 },            // the main raid
    ],
    winWhen: [2, 4], loseWhen: [3],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 641 },
      { on: TRIG.ON_TIME, t: 25, lineId: 644 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 648 },   // the commute is theirs
      { on: TRIG.ON_TIME, t: 165, lineId: 649 },             // wave-1 clock, un-gated (commit ≈ 201-203 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 645 },   // THE TURN
      { on: TRIG.ON_TIME, t: 255, lineId: 689 },             // escort sweep call, un-gated (off hold ≈ 235-251 s, ring ≈ 281-286 s)
      { on: TRIG.ON_TIME, t: 340, lineId: 688 },             // wave-2 backstop, un-gated (commit ≈ 374-382 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 4, lineId: 646 },   // victory (raid-scoped)
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 3, lineId: 647 }, // the flightline burns
      { on: TRIG.ON_TIME, t: 1500, lineId: 687 },            // defense timeout = VICTORY flavor (the 399 pattern)
    ],
    scoreKm: 1.5,
  },
};
