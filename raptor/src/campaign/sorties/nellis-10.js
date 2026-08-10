// N10 "PAID IN FULL" — the NELLIS FINALE (phase 11 INC-8 batch 4, sortie
// 26): the front-closing set-piece per CAMPAIGN-DESIGN §6 (fiction reads
// frontKm >= +14 — the front is at the enemy's door; the unlock stays
// linear). Dawn. OUR assault column rolls for the eastern tunnel and the
// whole NELLIS campaign converges on one screen: the convoy war (N01/N03/
// N05/N06), SEAD (N02), and the paint (N02/N04/N06) — a spawned scratch
// belt on the door, two raider waves hunting the column, and JACKAL
// (engine.js ACES NELLIS id 1) flying his last top cover. For the FIRST
// time on this front his tag is WIN-REQUIRED (the N02 grammar returns for
// the finale: kill or driven off); kill_ace stays the optional
// for-keeps debt. The raider-vs-truck grammar is V01/N03's ASHM bridge
// pointed at OUR ground for the first time on NELLIS.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      611-613 — the column, the belt, the waves, the paint
//   2 SPAWN      ON_START 611; 619 JACKAL guard taunt at t45
//                (ledger-agnostic: "whoever you think is flying it")
//   3 INGRESS    spawn (-14000,-18000) -> gate (-4000,-6000) ≈ 15.6 km
//                ≈ 71 s at 220; 614 at t25; gate -> belt 17.0 km. The
//                column (4 side-1 flatbeds, tag 84) drives a 20.3 km road
//                to the tunnel ≈ 2536 s at 8 m/s — rolling past ANY
//                resolution (route LAW; at t=1500 the lead is 12.0 km in,
//                honest in 617).
//   4 OBJ A      obj 2 THE DOOR BELT — spawned radar + 2 rails on the
//                probed shelf cell (7000,7000) (heightAt across the three
//                placements 1392.9-1453.0 m, span 60.1 m; each unit
//                terrain-snaps individually — probed 2026-08-09 live
//                grid), 16.5+ km from every boot shooter. Meanwhile wave
//                1 (tag 87, tier-1 raiders, attackTag 84) commits on the
//                column at ≈ 219-229 s (measured; un-gated 673 at t=170
//                calls it) — the strike and the escort job interleave
//                from the first minute.
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 615 (conditional-survival on the
//                paint — he is killable pre-turn only by a >18 km chase,
//                and his descent is CLOCK-driven: sweep legs end
//                ≈ 270-315 s, 11 km corridor-ring entry ≈ 341 s — the
//                un-gated 682 at t=305 carries the movement call, the
//                turn line never claims it).
//   6 CLIMAX     obj 3 THE PAINT (destroy_tag need 1 on JACKAL's tag —
//                WIN-REQUIRED, kill or smoking BINGO escape) fought while
//                wave 2 (tag 88, tier-2 raiders) commits at ≈ 390-396 s
//                (un-gated 674 at t=355): the duel and the defense share
//                one sky. obj 5 kill_ace aceId 1 stays OUTSIDE
//                winWhen/loseWhen — the debt, optional to the very end.
//                obj 6/7 (waves) are OPTIONAL ledger rows: launched-and-
//                egressed raiders leave the map alive, so they are never
//                win-required (the V01/N03 defense-type lesson applied to
//                an offense sortie — only ground and the self-committing
//                ace gate the win).
//   7 RESOLUTION 616 victory (obj 3 — sky-scoped, kill-or-escape agnostic
//                AND wave-agnostic: "whatever their strike wings have
//                left") / 675 column loss (protect need 2) / 617 timeout
//                (state-agnostic: "a door we couldn't clear in time";
//                varied-shape t=1200 clock 677)
// ENVELOPE: median session ≈ 9.5-10.5 min (gate 71 s, wave-1 intercept
// 150-230 s, belt 230-330 s = THE TURN ≈ 40-55% of median, JACKAL 341 s,
// wave 2 390-396 s, duel + defense to ~520-620 s).
//
// ROUTE LAW (D-073): the belt and column are ground. JACKAL is
// win-required need-1: resolves on !live AND his route outlives the
// timer — sweep + SEVEN 46 km ring laps = 415.4 km ≈ 1731 s > 1500 s.
// The raiders are NOT win-required (see beat 6). No stranding path.
//
// GUARDRAILS (amendment 5): the belt is 2 shooters (rails; the dish
// senses), its own phase 2 <= 4. Raiders NEVER shoot the player
// (engage-less A1, briefed by 612). HONEST WORST CASE, documented: a
// player fighting over the live belt after JACKAL descends faces 2 rails
// + 1 ace = 3 <= 4, all telegraphed (RWR + launch warning + livery +
// 682). Boot shooters: zsu 11 is 5.3 km from the column spawn and 6.8 km
// from the gate; zsu 5 / tel 7 are 16.5/17.2 km from the belt — outside
// every 5 km ring. Bandits 5 <= 8; engage 1 <= 4. Ambush honesty: JACKAL
// spawns 36.1/35.4 km from gate/belt; his six pre-descent legs hold
// >= 18.6 km from the play line (measured); wave spawns are 25-36 km out.
// LINE AUDIT: no "Five minutes" opener (677 varied), no "half a minute"
// (673/674 varied), '...' tic NOT used; 619/676/716/678/679 close
// JACKAL's ledger with finale-specific lines (no fourth verbatim 382/383
// reuse). PANEL MUST-2 (D-079): the bingo hook (716) is the duel's
// rendered beat — on the median 9X path 120 -> 30 skips the smoking band
// (676 never fires) and JACKAL's tag objective completes the win, so
// 616/678/679 land ON the win tick: readable via the orchestrator's
// end-card un-mask (panel MUST-1), while 716 renders live ~40+ s before
// any resolution on every hit path.
//
// POOL/capacity (NELLIS n=12): 4 supply_truck -> reserve slots
// 12,13,15,18 (of 16); 1 sam_radar -> slot 19 (of 4); 2 sam_tel -> slots
// 17,23 (of 6). protect/destroy bfIdx below ARE that deterministic
// first-free-typed assignment (trucks listed first).

import { TRIG } from "../../game/missions.js";

// n laps of the 46 km ring over the column corridor
const ringLaps = (n) => Array.from({ length: n },
  () => [[8000, 6000], [-4000, 6000], [-4000, -6000], [8000, -6000]]).flat();

export default {
  id: "N10",
  front: "NELLIS",
  titleId: 610,
  briefingIds: [611, 612, 613],
  meta: { turnObj: 2, turnLineId: 615, victoryLineId: 616, defeatLineId: 617 },
  spec: {
    v: 1, kind: "authored",
    front: "NELLIS",
    type: "convoy",
    seed: 0xdeb7f1,
    todH: 7.5, weatherIdx: 0,
    playerSpawn: { x: -14000, y: -18000, alt: 3600, headingDeg: 50.2, speed: 220 },
    airfield: { x: -3000, y: -8700, r: 900 },
    // OUR column (side 1, tag 84, driving) + the scratch belt on the door
    // shelf (spawned in this order for the slot math)
    units: [
      ["supply_truck", -6000, -6000, 0.8, 1, 84],
      ["supply_truck", -6100, -6100, 0.8, 1, 84],
      ["supply_truck", -6200, -6200, 0.8, 1, 84],
      ["supply_truck", -6300, -6300, 0.8, 1, 84],
      ["sam_radar", 7000, 7000, 0.3, 0, 85],
      ["sam_tel", 7350, 6750, 1.0, 0, 85],
      ["sam_tel", 6650, 7300, -0.5, 0, 85],
    ],
    // 20.3 km road northeast for the tunnel ≈ 2536 s at 8 m/s — the
    // column outlives every resolution (route LAW)
    paths: { 84: [[0, -2000], [4000, 2000], [7000, 4000], [10000, 6000]] },
    bandits: [
      // wave 1 (tag 87): tier-1 raiders on the column (attackTag 84).
      // Cum walks at cruise 240: 8.5/19.7/28.9/37.4/46.9 -> 8 km dive
      // commit at 52.5/54.9 km ≈ 219/229 s (measured vs the column's
      // ~200 s position).
      { kind: "fighter", tier: 1, x: -27000, y: 6000, z: 2600, headingDeg: 45, speed: 250, tag: 87, side: 0, attackTag: 84,
        wpts: [[-21000, 12000], [-26000, 2000], [-19000, -4000], [-25000, -10000], [-16000, -13000], [-10000, -8500]] },
      { kind: "fighter", tier: 1, x: -28000, y: 2000, z: 2800, headingDeg: 45, speed: 250, tag: 87, side: 0, attackTag: 84,
        wpts: [[-22000, 8000], [-27000, -2000], [-20000, -8000], [-26000, -14000], [-17000, -16000], [-11000, -10000]] },
      // wave 2 (tag 88): tier-2 raiders, long NW dog-legs — 8 km dive
      // commit at 93.7/95.1 km ≈ 390/396 s (measured vs the column's
      // ~440 s position).
      { kind: "fighter", tier: 2, x: -26000, y: 20000, z: 3000, headingDeg: 22, speed: 250, tag: 88, side: 0, attackTag: 84,
        wpts: [[-16000, 24000], [-24000, 26000], [-14000, 20000], [-22000, 22000], [-12000, 16000], [-20000, 18000], [-13000, 10000], [-21000, 12000], [-14000, 4000], [-7000, -500]] },
      { kind: "fighter", tier: 2, x: -27000, y: 24000, z: 3200, headingDeg: 22, speed: 250, tag: 88, side: 0, attackTag: 84,
        wpts: [[-17000, 26000], [-25000, 28000], [-15000, 22000], [-23000, 24000], [-13000, 18000], [-21000, 20000], [-14000, 12000], [-22000, 14000], [-15000, 5500], [-8000, 1000]] },
      // JACKAL (tag 86): tier-4 ace, explicit A3 opt-in, the last top
      // cover. Sweep walk at cruise 240: 10.4/21.5/32.2/43.2/54.0/65.0 km
      // (all six legs >= 18.6 km from the play line), then the announced
      // descent (legs 7-8) to an 11 km corridor-ring entry at 81.9 km
      // ≈ 341 s; then SEVEN 46 km ring laps to 415.4 km ≈ 1731 s of total
      // route — outlives the 1500 s timer (route LAW; win-required tag).
      { kind: "fighter", tier: 4, aceId: 1, engage: true, tag: 86, side: 0,
        x: -24000, y: 24000, z: 5400, headingDeg: 17, speed: 260,
        wpts: [[-14000, 27000], [-21000, 18500], [-11000, 22500], [-18000, 14000], [-8000, 18000], [-16000, 10500], [-5000, 13500], [1500, 9800],
          ...ringLaps(7)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", labelId: 690, zone: { x: -4000, y: -6000, r: 2500 } },   // the gate over the column
      { id: 2, kind: "destroy_tag", labelId: 702, bfIdx: [19, 17, 23], need: 3 },           // the door belt (spawned slots)
      { id: 3, kind: "destroy_tag", labelId: 713, air: true, tag: 86, need: 1 },            // the paint off the board (kill or driven off)
      { id: 6, kind: "destroy_tag", labelId: 714, air: true, tag: 87, need: 2 },            // OPTIONAL ledger: wave 1
      { id: 7, kind: "destroy_tag", labelId: 715, air: true, tag: 88, need: 2 },            // OPTIONAL ledger: wave 2
      { id: 4, kind: "protect_tag", labelId: 695, bfIdx: [12, 13, 15, 18], need: 2 },       // the column (amber row; one loss survivable)
      { id: 5, kind: "kill_ace", labelId: 703, aceId: 1 },                                  // OPTIONAL: the debt, for keeps
    ],
    winWhen: [2, 3], loseWhen: [4],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 611 },
      { on: TRIG.ON_TIME, t: 25, lineId: 614 },
      { on: TRIG.ON_TIME, t: 45, lineId: 619 },              // the paint on guard (finale, ledger-agnostic)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 618 },   // over the column
      { on: TRIG.ON_TIME, t: 170, lineId: 673 },             // wave-1 clock, un-gated (commit ≈ 219-229 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 615 },   // THE TURN
      { on: TRIG.ON_TIME, t: 305, lineId: 682 },             // JACKAL descent backstop, un-gated (descent ≈ 270-315 s, ring ≈ 341 s)
      { on: TRIG.ON_TIME, t: 355, lineId: 674 },             // wave-2 backstop, un-gated (commit ≈ 390-396 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 616 },   // victory (sky-scoped, agnostic)
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 4, lineId: 675 }, // column loss
      { on: TRIG.ON_TIME, t: 1200, lineId: 677 },            // clock warning (varied shape)
      { on: TRIG.ON_TIME, t: 1500, lineId: 617 },            // timeout defeat
      { on: TRIG.ON_ACE_STATE, aceId: 1, aceState: "smoking", lineId: 676 }, // finale smoking taunt (gun path only: 40 <= hp < 60)
      { on: TRIG.ON_ACE_STATE, aceId: 1, aceState: "bingo", lineId: 716 },   // the bingo beat (panel MUST-2 — renders on every hit path)
      { on: TRIG.ON_ACE_STATE, aceId: 1, aceState: "escaped", lineId: 678 }, // the ledger closes either way
      { on: TRIG.ON_ACE_STATE, aceId: 1, aceState: "killed", lineId: 679 },  // paid
    ],
    scoreKm: 2.0,
  },
};
