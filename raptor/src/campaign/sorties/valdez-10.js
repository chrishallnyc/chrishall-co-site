// V10 "THE HOMECOMING" — the VALDEZ FINALE (phase 11 INC-8 batch 4,
// sortie 28): the front-closing set-piece. The fleet V07 promised comes
// home to V01's EXACT water: the blue hulls below are V01's rows verbatim
// — ANCHORAGE and her two tankers on the proven anchorage cells (probed
// water, heightAt -15) — and the station zone is V01's station zone. The
// deliberate bookend: the campaign's first sortie held this water; its
// VALDEZ finale hands it back for good. The enemy spends EVERYTHING:
// EIGHT raiders (the bandit pool's absolute cap — the campaign's only
// 8-airframe screen) in three waves on three axes, plus the picket hulks
// they abandoned at our anchorage (boot rows 0/1 — V05 sank hulls at
// these moorings once; these are the last two, skeleton iron, guns cold)
// to be swept so the fleet can call the water home. No ace: BOREAS's
// ledger closed in V08 ("however the wind went out, it's out") and the
// fiction honors it.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median; this is a documented
// LONG finale — see ENVELOPE):
//   1 BRIEF      631-633 — the fleet, the three raids, the hulks + the
//                CHECK-FIRE telegraph (the N07 panel lesson: the 9X
//                seeker has no side filter and the hulks ride 0.9-1.2 km
//                off the blue hulls — 633 briefs "guns for the hulks,
//                nothing loose near the big hulls" up front)
//   2 SPAWN      ON_START 631
//   3 INGRESS    spawn (0,-6000) -> station (1500,-25200) r3000 ≈ 19.3 km
//                ≈ 88 s at 220 (V01's leg, V01's heading); 634 at t25
//   4 OBJ A      wave 1 (tag 20): two tier-1 raiders off the west arm at
//                ANCHORAGE (attackTag 11) — 8 km dive commit at
//                20.0/20.9 km ≈ 84/87 s (measured): the fight starts the
//                moment you arrive, V01's opening tempo. The V01 GRACE
//                MATH holds: the escort (hp 120) survives both hits even
//                unopposed — 632 briefs the arithmetic out loud ("a
//                tanker takes one, ANCHORAGE two, nothing takes three").
//                Meanwhile obj 2 THE PICKETS (boot rows 0/1, gun work
//                between waves) and the rearm trade: the pad is 19.3 km
//                north — the wave spacing below is TUNED for one honest
//                rearm cycle (the V06 483 doctrine).
//   5 THE TURN   ON_OBJECTIVE_DONE(4) -> 635 on wave 2's death (median
//                ~470-520 s ≈ 40-50% of median): the last-wave reveal is
//                a past-tense spawn-fact ("everything left is committed
//                down the long axis" — true from t=0) with a
//                count-conditional close ("however many they are when
//                they reach you"). Wave 2 (tag 21, three tier-2 at the
//                tankers) commits ≈ 420-429 s (un-gated 683 at t=390);
//                its west-arm dog-legs are VISIBLE on approach by design
//                — no hidden-reveal claim is ever made for it.
//   6 CLIMAX     wave 3 (tag 22): three raiders down the EAST COAST — the
//                third axis — every pre-descent leg >= 21.6 km from the
//                station (outside the 18 km HUD gate, measured: gate
//                crossing ≈ 465-470 s, AFTER the median turn) with dive
//                commits at ≈ 508-512 s: two at the tankers, one at
//                ANCHORAGE — the wound arithmetic from 632 comes due.
//                Un-gated 684 at t=490.
//   7 RESOLUTION 636 victory (wave-scoped + egresser-honest: "spent,
//                empty, and running") / 637 hull loss (protect need 1) /
//                685 defense-timeout VICTORY flavor (fleet_defense: the
//                399 pattern — the one designed V01 echo, "the narrows
//                held")
// ENVELOPE: median session ≈ 11-12.5 min (station 88 s, wave 1 90-150 s,
// pickets 150-350 s, rearm window 350-420 s, wave 2 420-500 s, wave 3
// 508-650 s, sweep-up to ~700-760 s) — a DELIBERATE >12-min-capable
// finale, documented per the V06/amendment-4 exception clause; THE TURN
// ≈ 40-50% of median.
//
// ROUTE LAW (D-073): fleet_defense — timeout with the protect intact is
// VICTORY, so launched-and-egressed raiders can never strand the win
// (the V01 grammar); the pickets are ground/naval and never despawn. No
// stranding path. Wave objectives stay win-required BECAUSE the type is
// defensive: every unkilled raider either dies, or launches and egresses
// spent — and 685 tells that ending honestly.
//
// GUARDRAILS (amendment 5): ZERO shooters ever target the player — all
// eight raiders are engage-less A1 (briefed by 632's "no manners"), and
// no boot shooter is within 5 km of any center (tel 6 is 9.7 km from the
// station, 9.4 km from the pickets; zsu 4 is 13.5+ km). The only fire
// risk over the fleet is the player's own — hence the 633 check-fire
// brief. Bandits 8 <= 8 (THE CAP, the finale statement); engage 0 <= 4.
// LINE AUDIT: no "Five minutes" opener, no "half a minute" (683 "sixty
// seconds", 639 "a heartbeat"), '...' tic NOT used; 638 pays V01's lamp
// (328) and 685 closes on V01's motto — both DESIGNED callbacks,
// documented here.
//
// POOL/capacity (VALDEZ n=7): 2 cargo_ship -> reserve slots 43,45 (2 of
// 2); 1 destroyer -> slot 44 (of 2). protect bfIdx below IS that
// deterministic assignment — V01's rows verbatim. Pickets are boot rows
// 0/1 (the t17/t20 index contract).

import { TRIG } from "../../game/missions.js";

export default {
  id: "V10",
  front: "VALDEZ",
  titleId: 630,
  briefingIds: [631, 632, 633],
  meta: { turnObj: 4, turnLineId: 635, victoryLineId: 636, defeatLineId: 637 },
  spec: {
    v: 1, kind: "authored",
    front: "VALDEZ",
    type: "fleet_defense",
    seed: 0x0f1ee7,
    todH: 21.4, weatherIdx: 0,
    playerSpawn: { x: 0, y: -6000, alt: 3600, headingDeg: -85.5, speed: 220 },
    airfield: { x: 0, y: -6000, r: 600 },
    // the fleet: V01's rows verbatim — tankers tag 10, ANCHORAGE tag 11
    // (wave targeting), on the proven anchorage water
    units: [
      ["cargo_ship", 1500, -25500, 0.9, 1, 10],
      ["cargo_ship", 1800, -26800, 1.1, 1, 10],
      ["destroyer", 1200, -24500, 0.8, 1, 11],
    ],
    paths: {},
    bandits: [
      // wave 1 (tag 20): tier-1 pair off the west arm at the escort
      // (attackTag 11). Cum walks at cruise 240: 11.5/20.7 -> 8 km dive
      // commit at 20.9/20.0 km ≈ 87/84 s. V01's opening, V01's grace.
      { kind: "fighter", tier: 1, x: -27000, y: -23000, z: 900, headingDeg: -18, speed: 250, tag: 20, side: 0, attackTag: 11,
        wpts: [[-16000, -26500], [-7000, -24800], [1200, -24500]] },
      { kind: "fighter", tier: 1, x: -26500, y: -26500, z: 1100, headingDeg: -5, speed: 250, tag: 20, side: 0, attackTag: 11,
        wpts: [[-15000, -27500], [-6000, -25400], [1200, -24500]] },
      // wave 2 (tag 21): three tier-2 at the tankers (attackTag 10) on
      // long west-arm dog-legs — 8 km dive commits at 102.9/100.7/102.9 km
      // ≈ 429/420/429 s (measured). Visible on approach by design.
      { kind: "fighter", tier: 2, x: -28000, y: -20000, z: 1000, headingDeg: 39, speed: 250, tag: 21, side: 0, attackTag: 10,
        wpts: [[-24000, -12000], [-16000, -8000], [-26000, -10000], [-18000, -6000], [-26000, -14000], [-18000, -10000], [-24000, -18000], [-14000, -21000], [-22000, -25500], [-12000, -27000], [-4000, -25000], [1650, -26150]] },
      { kind: "fighter", tier: 2, x: -27000, y: -17000, z: 1300, headingDeg: 39, speed: 250, tag: 21, side: 0, attackTag: 10,
        wpts: [[-23000, -10500], [-15000, -6500], [-25000, -8500], [-17000, -4500], [-25000, -12500], [-17000, -8500], [-23000, -16500], [-13000, -19500], [-21000, -24000], [-11000, -26500], [-3000, -24600], [1650, -26150]] },
      { kind: "fighter", tier: 2, x: -26000, y: -21500, z: 1600, headingDeg: 39, speed: 250, tag: 21, side: 0, attackTag: 10,
        wpts: [[-25000, -13500], [-17000, -9500], [-27000, -11500], [-19000, -7500], [-27000, -15500], [-19000, -11500], [-25000, -19500], [-15000, -22500], [-23000, -27000], [-13000, -27500], [-5000, -25400], [1650, -26150]] },
      // wave 3 (tag 22): the LAST WAVE, down the east coast — the third
      // axis. Every pre-descent leg >= 21.6 km from the station (18 km
      // gate crossing ≈ 465-470 s, measured); 8 km dive commits at
      // ≈ 508-512 s. Two at the tankers, one at ANCHORAGE — the 632
      // arithmetic's collectors.
      { kind: "fighter", tier: 2, x: 10000, y: 28000, z: 2800, headingDeg: -22, speed: 250, tag: 22, side: 0, attackTag: 10,
        wpts: [[20000, 24000], [14000, 18000], [22000, 13000], [14000, 9000], [22000, 5000], [14000, 1000], [23000, 1000], [16000, -4000], [24000, -8000], [17000, -12000], [24000, -16000], [19000, -19000], [23000, -22000], [16000, -24000], [9000, -26000], [1650, -26150]] },
      { kind: "fighter", tier: 2, x: 14000, y: 26000, z: 3000, headingDeg: -22, speed: 250, tag: 22, side: 0, attackTag: 10,
        wpts: [[21500, 23000], [15500, 17000], [23500, 12000], [15500, 8000], [23500, 4000], [15500, 0], [24500, 0], [17500, -5000], [25500, -9000], [18500, -13000], [25500, -17000], [20500, -20000], [24500, -23000], [18000, -25500], [11000, -27000], [1650, -26150]] },
      { kind: "fighter", tier: 3, x: 12000, y: 29000, z: 2600, headingDeg: -22, speed: 250, tag: 22, side: 0, attackTag: 11,
        wpts: [[20800, 25500], [14800, 19500], [22800, 14500], [14800, 10500], [22800, 6500], [14800, 2500], [23800, 2500], [16800, -2500], [24800, -6500], [17800, -10500], [24800, -14500], [19800, -17500], [23800, -20500], [17000, -22500], [10000, -24500], [1200, -24500]] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", labelId: 708, zone: { x: 1500, y: -25200, r: 3000 } },   // on station — V01's zone verbatim
      { id: 2, kind: "destroy_tag", labelId: 707, bfIdx: [0, 1], need: 2 },                 // the picket hulks (boot rows)
      { id: 3, kind: "destroy_tag", labelId: 692, air: true, tag: 20, need: 2 },            // wave 1
      { id: 4, kind: "destroy_tag", labelId: 693, air: true, tag: 21, need: 3 },            // wave 2
      { id: 5, kind: "destroy_tag", labelId: 694, air: true, tag: 22, need: 3 },            // the last wave
      { id: 6, kind: "protect_tag", labelId: 696, bfIdx: [43, 45, 44], need: 1 },           // any hull lost = defeat (amber row)
    ],
    winWhen: [2, 3, 4, 5], loseWhen: [6],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 631 },
      { on: TRIG.ON_TIME, t: 25, lineId: 634 },
      { on: TRIG.ON_TIME, t: 70, lineId: 639 },              // wave-1 push clock, un-gated (commit ≈ 84-87 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 638 },   // the lamp again (V01 328 paid off)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 686 },   // the anchorage is a home port (mid-sortie beat)
      { on: TRIG.ON_TIME, t: 390, lineId: 683 },             // wave-2 backstop, un-gated (commit ≈ 420-429 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 4, lineId: 635 },   // THE TURN (the last wave, spawn-fact form)
      { on: TRIG.ON_TIME, t: 490, lineId: 684 },             // wave-3 backstop, un-gated (gate ≈ 465-470 s, commit ≈ 508-512 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 5, lineId: 636 },   // victory (wave-scoped, egresser-honest)
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 6, lineId: 637 }, // hull loss
      { on: TRIG.ON_TIME, t: 1500, lineId: 685 },            // defense timeout = VICTORY flavor (the 399 pattern)
    ],
    scoreKm: 2.5,
  },
};
