// V08 "SECOND WIND" — the ace RETURN as the centerpiece (phase 11 INC-8
// batch 3, brief item a). Fantasy: the guard channel finds a ghost —
// BOREAS (engine.js ACES VALDEZ id 2), the high shadow from V02, is
// checking in over the Sound again. LEDGER-AGNOSTIC per the N06 model:
// the brief hedges "same voice... whether it's the same hands, nobody
// will swear to" (561), so the sortie reads true whether the V02 ledger
// says fresh, escaped, or KIA. STRUCTURALLY INVERTED from N04's bait-duel:
// there the minions were passive bait and the ace turned in at the turn;
// here his hunters COME FOR YOU as the first fight (converging tier-2
// ENGAGE), and the ace himself is a briefed perch that descends — the
// player is the flushed quarry, not the trap-setter. His tag objective is
// win-required via the N02/N04 grammar (destroy_tag need 1 counts !live:
// kill or a smoking BINGO escape both resolve it); kill_ace stays OPTIONAL
// glory, the debt-for-keeps.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      561-563 — the ghost, the pattern, the file
//   2 SPAWN      ON_START 561; 569 guard taunt at t45 (ledger-agnostic:
//                the wind "never files a claim twice — it just collects")
//   3 INGRESS    spawn (0,-6000) -> station (6000,-17000) ≈ 12.5 km,
//                r3000 ring trips ≈ 43-57 s; 564 at t25
//   4 OBJ A      obj 2: the HUNTERS (tag 57) — two tier-2 ENGAGE
//                converging on the station from NE and SW (spawns straddle
//                so each is 28.4 km from their own centroid — the M06
//                ambush-honesty trick); 8 km station-ring entry at
//                ≈ 173/164 s (measured), then a NW loiter box to
//                ≈ 993/986 s of total route.
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 565 ("expect the wind" — NO
//                position claim, so it is true on every path). BOREAS
//                (tag 58, tier 4, aceId 2, engage, z 7000) holds a far-NW
//                perch (hold legs 49.2-52.0 km from the station — far
//                outside the 18 km gate, unhuntable) until ≈ 222 s, then
//                descends: gate crossing ≈ 365 s, 9 km station ring
//                ≈ 403 s. D-078 HEADER-TRUTH RIDER: his descent is
//                CLOCK-driven at ≈ 222 s, NOT turn-gated — the turn line
//                reveals it, it does not cause it. Un-gated 594 at t=330
//                calls the descent BEFORE the HUD can paint him (568
//                sets that up in fiction).
//   6 CLIMAX     obj 3: the wind himself — tier 4 (the amendment-1
//                +tier return escalation on his V02 tier 3), destroy_tag
//                need 1 on his tag counts !live (kill 387 / smoking BINGO
//                escape 386, both resolve). obj 4 kill_ace aceId 2 stays
//                OUTSIDE winWhen/loseWhen — optional, for keeps.
//   7 RESOLUTION 566 victory (kill-or-escape agnostic: "however the wind
//                went out, it's out") / 567 timeout (state-agnostic:
//                someone IS still up there whenever the win never landed;
//                offense cap; t=1200 clock 595)
// ENVELOPE: median session ≈ 8.5-9 min (station ~50 s, hunters arrive
// ~164-173 s, killed ~210-280 s, BOREAS gate ~365 s, duel ~410-540 s);
// THE TURN ≈ 42-52% of median.
//
// ROUTE LAW (D-073): both win-required air objectives are ENGAGE-capable;
// the hunters loiter to ≈ 986/993 s and BOREAS's route runs 411.3 km
// ≈ 1714 s — it OUTLIVES the 1500 s timer (the V06 coda letter-of-the-LAW
// precedent). No stranding path. STACKED-LOITER NOTE (re-documented,
// D-078 header-truth rider): the hunters' loiter box sits INSIDE the
// footprint of BOREAS's wider SE ring — the separation is TEMPORAL, not
// geometric: his descent is on the 222 s clock and his ring laps begin
// ≈ 403 s, after the median hunters kill; on slow paths the waves CAN
// share that airspace (see the guardrail census below).
//
// GUARDRAILS (amendment 5, census re-documented per the D-078
// header-truth rider): hunters phase 2 <= 4, BOREAS phase 1 <= 4 — and
// because his descent is clock-driven, the honest SLOW-PATH worst case
// is both hunters still alive when he reaches the station ring at
// ≈ 403 s: 2 + 1 = 3 <= 4, all telegraphed. Zero ground shooters
// within 5 km of any center (nearest boot: tel 6 at 8.6 km from the
// station). Bandits 3 <= 8; engage 3 <= 4. Tier 4 is composition (the
// return escalation), not a stat override. LINE AUDIT (batch-3 SHOULD):
// no calcified formulas; 568 is honest about the detection gate ("one
// more up high I won't see until he wants me to").

import { TRIG } from "../../game/missions.js";

// n racetrack laps between two waypoints, as plain [[x,y],...] data
const laps = (a, b, n) => Array.from({ length: n }, () => [a, b]).flat();
// n laps of a 4-corner ring
const ringLaps = (pts, n) => Array.from({ length: n }, () => pts).flat();

export default {
  id: "V08",
  front: "VALDEZ",
  titleId: 560,
  briefingIds: [561, 562, 563],
  meta: { turnObj: 2, turnLineId: 565, victoryLineId: 566, defeatLineId: 567 },
  spec: {
    v: 1, kind: "authored",
    front: "VALDEZ",
    type: "cap",
    seed: 0x5ec01d,
    todH: 12, weatherIdx: 0,
    playerSpawn: { x: 0, y: -6000, alt: 3600, headingDeg: 151.4, speed: 240 },
    airfield: { x: 0, y: -6000, r: 600 },
    units: [],
    paths: {},
    bandits: [
      // the HUNTERS (tag 57): tier-2 ENGAGE, converging NE + SW (spawns
      // 28.4 km from their own centroid (2000,-8000), 32.4/27.5 km from
      // the station). Cum walks at cruise 240: NE 10.8/20.0/29.0/36.2 ->
      // 8 km station ring at 41.6 km ≈ 173 s; SW 9.2/18.4/26.5/34.3 ->
      // ring at 39.5 km ≈ 164 s; then a shared NW loiter box (10.2 km
      // legs) to ≈ 993/986 s of total route.
      { kind: "fighter", tier: 2, engage: true, x: 24000, y: 10000, z: 4200, headingDeg: -124, speed: 250, tag: 57, side: 0,
        wpts: [[15000, 4000], [21000, -3000], [13000, -7000], [17000, -13000], [10000, -11000], ...laps([11000, -11000], [1000, -13000], 10)] },
      { kind: "fighter", tier: 2, engage: true, x: -20000, y: -26000, z: 4600, headingDeg: 49, speed: 250, tag: 57, side: 0,
        wpts: [[-13000, -20000], [-19000, -13000], [-11000, -14000], [-6000, -20000], [-1000, -16000], ...laps([0, -14000], [10000, -12000], 10)] },
      // BOREAS (tag 58): tier-4 ace, explicit A3 opt-in, the far-NW perch
      // at z 7000. Hold: 4 perch legs (12.65 km each; every hold leg
      // 49.2-52.0 km from the station) to ≈ 222 s; descent legs cross the
      // 18 km gate at 87.6 km ≈ 365 s, 9 km station ring at 96.7 km
      // ≈ 403 s; then SIX 52 km SE ring laps to 411.3 km ≈ 1714 s of
      // total route — OUTLIVES the 1500 s timer.
      { kind: "fighter", tier: 4, aceId: 2, engage: true, tag: 58, side: 0,
        x: -24000, y: 26000, z: 7000, headingDeg: -135, speed: 260,
        wpts: [[-26000, 24000], [-14000, 28000], [-26000, 24000], [-14000, 28000], [-26000, 24000], [-16000, 14000], [-8000, 2000], [-1000, -9500], [2000, -14000],
          ...ringLaps([[12000, -11000], [-2000, -11000], [-2000, -23000], [12000, -23000]], 6)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", zone: { x: 6000, y: -17000, r: 3000 } },  // the station
      { id: 2, kind: "destroy_tag", air: true, tag: 57, need: 2 },           // the hunters
      { id: 3, kind: "destroy_tag", air: true, tag: 58, need: 1 },           // the wind off the board (kill or driven off)
      { id: 4, kind: "kill_ace", aceId: 2 },                                 // OPTIONAL: for keeps
    ],
    winWhen: [2, 3], loseWhen: [],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 561 },
      { on: TRIG.ON_TIME, t: 25, lineId: 564 },
      { on: TRIG.ON_TIME, t: 45, lineId: 569 },              // the wind on guard (ledger-agnostic)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 568 },   // on station (detection-gate honest)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 565 },   // THE TURN
      { on: TRIG.ON_TIME, t: 330, lineId: 594 },             // descent call, un-gated (gate ≈ 365 s, ring ≈ 403 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 566 },   // victory
      { on: TRIG.ON_TIME, t: 1200, lineId: 595 },            // 5-min clock warning
      { on: TRIG.ON_TIME, t: 1500, lineId: 567 },            // timeout defeat
      { on: TRIG.ON_ACE_STATE, aceId: 2, aceState: "smoking", lineId: 385 },
      { on: TRIG.ON_ACE_STATE, aceId: 2, aceState: "escaped", lineId: 386 },
      { on: TRIG.ON_ACE_STATE, aceId: 2, aceState: "killed", lineId: 387 },
    ],
    scoreKm: 2.0,
  },
};
