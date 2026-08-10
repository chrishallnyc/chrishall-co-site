// M10 "TYPHOON" — THE CAMPAIGN FINALE (phase 11 INC-8 batch 4, sortie 30
// of 30): the last boss over the sinking flagship, per the PLAN's phase-11
// line ("finale: TYPHOON duel over the sinking flagship") and
// CAMPAIGN-DESIGN §5 (TYPHOON = the MARIANAS finale boss, react 0.35).
// The reserve held for 24 shipped sorties is spent here: TYPHOON
// (engine.js ACES MARIANAS id 5) flies at last — aceId 5, tier 4, engage,
// reactS 0.35 through the spawnFlight passthrough (bandits.js: aces floor
// at 0.4, spawn config may pass faster). ONE bandit. The whole sortie is
// one man, one fleet, one golden hour.
//
// THE ONLY MANDATORY ACE KILL OF THE CAMPAIGN: kill_ace(5) sits in BOTH
// winWhen AND loseWhen — his kill is required, and his BINGO escape
// FAILS the objective (script.js: aceStatus "escaped" -> objState 2 ->
// loseWhen -> DEFEAT). Every prior ace was optional glory or
// kill-or-driven-off; here, driven off IS the loss — the campaign's
// cruelest lose, and the radio carries it honestly: 652/653 brief the
// mechanic in fiction terms (one clean hit sends an ace cold for the map
// edge — amendment 1's 120->30 skips the smoking band straight to BINGO),
// 666 is the chase call that actually RENDERS (the escaped/failed lines
// land on the lose tick, masked by main.js at match.over — accepted,
// banner + 668 written for the ring and any future debrief un-masking).
// The chase math is real and documented: from the fleet the nearest fence
// is ~17.1 km west ≈ 41+ s at his opened 420 dash — catchable, barely,
// which is the design.
//
// 7-BEAT SHEET (amended envelope: 6-12 min median, turn 30-60%):
//   1 BRIEF      651-653 — the flagship, the mandate (HIM, in the water),
//                the file (get close before you get greedy)
//   2 SPAWN      ON_START 651; 664 TYPHOON's first words on guard at t45
//   3 INGRESS    spawn (8000,-16000) -> datum (-10000,-7000) r2500
//                ≈ 20.1 km ≈ 91 s at 220; 654 at t25 (with the honest
//                Saipan-gun transit note: the pad->fleet straight line
//                passes 1.4 km from boot zsu 8 — dogleg your rearm runs).
//                658 at the datum is written in conditional-survival
//                form ("if the file is right, he's up there somewhere")
//                — true at the 91 s median (he's ~36 km out, unpainted),
//                on slow paths (he may already be painted and
//                descending), and on the perverse chase-first path (he
//                may be dead).
//   4 OBJ A      obj 2 THE SCREEN — boot destroyer row 1 + spawned oiler
//                (-13600,2600) and destroyer (-12200,2500) (both cells
//                probed real water, heightAt -15) around the boot
//                flagship — WHILE the duel arrives: TYPHOON leaves the
//                storm line at ≈ 119 s (CLOCK-driven), crosses the 18 km
//                gate ≈ 164 s, enters a 10 km fleet ring ≈ 198 s
//                (measured) — on the heels of your first strike pass. The
//                un-gated 669 at t=150 calls the descent BEFORE the HUD
//                can paint him. The strike and the duel INTERLEAVE by
//                geometry: his ring laps sit directly over the hulls, so
//                every gun run on the screen happens under his engage
//                radius. (t26's static phase model books engage air
//                post-turn; this header carries the real overlap, the
//                M07/N02 precedent.)
//   5 THE TURN   ON_OBJECTIVE_DONE(2) -> 655 ("the flagship is alone...
//                whatever the sky above her still holds" — TYPHOON-state
//                agnostic: he may already be dead on a duel-first path).
//   6 CLIMAX     obj 3 THE FLAGSHIP (boot carrier row 0, hp 250 — the
//                M02 multi-pass rearm fantasy at finale scale) and obj 4
//                TYPHOON, in whichever order the fight allows. 659
//                (flagship going down) and 656 (TYPHOON confirmed) are
//                both scoped and path-true so the interleave reads
//                whichever way it lands; 667 is RAPTOR's kill line and
//                spends the '...' pivot tic — its FOURTH AND FINAL use,
//                on the war's last kill, per the D-078 chair's ruling.
//   7 RESOLUTION winWhen [2,3,4] — the median run completes kill_ace
//                last, so the true win tick shows the banner (accepted
//                per D-078: win-tick lines never render); the READABLE
//                victory beats land on 655/659/656/667 as the
//                second-to-last objectives complete. 657 timeout defeat
//                (offense anti_ship; varied-shape t=1200 clock 670).
// ENVELOPE: median session ≈ 10-11.5 min (datum 91 s, duel joins ~198 s,
// screen 150-400 s = THE TURN ≈ 40-55% of median, rearm ~400-520 s,
// flagship 500-700 s, TYPHOON resolution threaded throughout).
//
// ROUTE LAW (D-073): the hulls are naval (never despawn). TYPHOON is
// win-required via kill_ace — which resolves on killed and FAILS on
// escaped, so the only stranding risk is route exhaustion with him
// untouched: his route is hold + descent + EIGHT 48 km fleet-ring laps
// = 425.3 km ≈ 1772 s > 1500 s (the V08/BOREAS letter of the LAW), and
// he is ENGAGE-capable and self-commits whenever the player is inside
// 10 km — which over this fleet is always. No stranding path.
//
// GUARDRAILS (amendment 5): TYPHOON is the ONLY shooter in the sortie —
// census 1 <= 4 everywhere, always (the fleet's guns are hitpoints, not
// weapons; boot zsu 8 is 5.8 km from the datum and outside every ring —
// only the BRIEFED rearm-lane graze at 1.4 km can ever put tracers up,
// 654's honest note). Difficulty is PURE composition: tier-4 gMax,
// react 0.35, ace hp — no stat inflation beyond the shipped amendment-1
// ace block. Bandits 1 <= 8; engage 1 <= 4. Ambush honesty: he spawns
// 36.9/31.4 km from datum/fleet, and his storm-line hold legs sit
// >= 28.7 km from the play line — outside the 18 km gate until the
// announced descent (measured). LINE AUDIT: no "Five minutes" opener
// (670 varied), no "half a minute" (666 "a minute, maybe less" — the
// honest chase bound), no "...is empty" reveal shape (669 varied);
// the '...' tic used EXACTLY ONCE, in 667, by RAPTOR.
//
// POOL/capacity (MARIANAS n=10): 1 cargo_ship -> reserve slot 46 (of 1);
// 1 destroyer -> slot 47 (of 1) — the front's entire ship reserve, spent
// on the last fleet. destroy bfIdx below mixes boot rows (0/1, the
// t17/t20 index contract) with that deterministic assignment.

import { TRIG } from "../../game/missions.js";

// n laps of the 48 km ring over the fleet
const ringLaps = (n) => Array.from({ length: n },
  () => [[-6000, 8000], [-19000, 8000], [-19000, -3000], [-6000, -3000]]).flat();

export default {
  id: "M10",
  front: "MARIANAS",
  titleId: 650,
  briefingIds: [651, 652, 653],
  meta: { turnObj: 2, turnLineId: 655, victoryLineId: 656, defeatLineId: 657 },
  spec: {
    v: 1, kind: "authored",
    front: "MARIANAS",
    type: "anti_ship",
    seed: 0x7af00e,
    todH: 17.8, weatherIdx: 0,
    playerSpawn: { x: 8000, y: -16000, alt: 3600, headingDeg: 153.4, speed: 220 },
    airfield: { x: -3200, y: -8000, r: 600 },
    // the last fleet: the spawned half of the screen — an oiler and a
    // destroyer on probed water beside the boot flagship group
    units: [
      ["cargo_ship", -13600, 2600, 0.7, 0, 95],
      ["destroyer", -12200, 2500, 1.2, 0, 95],
    ],
    paths: {},
    bandits: [
      // TYPHOON (tag 90): the last name on the board. Storm-line hold
      // north of the fleet (3 legs, each >= 28.7 km from the play line)
      // to ≈ 119 s, the announced descent (18 km gate ≈ 164 s), a 10 km
      // fleet-ring entry at 47.5 km ≈ 198 s, then EIGHT 48 km ring laps
      // directly over the hulls to 425.3 km ≈ 1772 s of total route —
      // outlives the 1500 s timer (route LAW). reactS 0.35 rides the
      // spawnFlight ace passthrough (CAMPAIGN-DESIGN §5 / Part B).
      { kind: "fighter", tier: 4, aceId: 5, reactS: 0.35, engage: true, tag: 90, side: 0,
        x: 10000, y: 24000, z: 7400, headingDeg: 159, speed: 260,
        wpts: [[2000, 27000], [12000, 26000], [2000, 27000], [-3000, 19000], [-9000, 11000],
          ...ringLaps(8)] },
    ],
    objectives: [
      { id: 1, kind: "reach_zone", labelId: 712, zone: { x: -10000, y: -7000, r: 2500 } },  // the datum
      { id: 2, kind: "destroy_tag", labelId: 709, bfIdx: [1, 47, 46], need: 3 },            // the screen (boot row 1 + spawned slots)
      { id: 3, kind: "destroy_tag", labelId: 710, bfIdx: [0], need: 1 },                    // the flagship (boot row 0, hp 250)
      { id: 4, kind: "kill_ace", labelId: 711, aceId: 5 },                                  // TYPHOON — MANDATORY, and his escape is the loss
    ],
    winWhen: [2, 3, 4], loseWhen: [4],
    timeLimitS: 1500,
    comms: [
      { on: TRIG.ON_START, lineId: 651 },
      { on: TRIG.ON_TIME, t: 25, lineId: 654 },
      { on: TRIG.ON_TIME, t: 45, lineId: 664 },              // TYPHOON's first words
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 658 },   // the datum (conditional-survival form)
      { on: TRIG.ON_TIME, t: 150, lineId: 669 },             // descent backstop, un-gated (gate ≈ 164 s, ring ≈ 198 s)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 655 },   // THE TURN (ace-state agnostic)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 3, lineId: 659 },   // the flagship goes down (scoped, path-true)
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 4, lineId: 656 },   // confirmed (scoped; masked when it is the win tick)
      { on: TRIG.ON_TIME, t: 1200, lineId: 670 },            // clock warning (varied shape)
      { on: TRIG.ON_TIME, t: 1500, lineId: 657 },            // timeout defeat
      { on: TRIG.ON_ACE_STATE, aceId: 5, aceState: "smoking", lineId: 665 }, // gun-path only (40 <= hp < 60)
      { on: TRIG.ON_ACE_STATE, aceId: 5, aceState: "bingo", lineId: 666 },   // THE CHASE — the beat that renders
      { on: TRIG.ON_ACE_STATE, aceId: 5, aceState: "escaped", lineId: 668 }, // masked at the lose tick; written for the ring
      { on: TRIG.ON_ACE_STATE, aceId: 5, aceState: "killed", lineId: 667 },  // RAPTOR's line; the '...' spend
    ],
    scoreKm: 2.5,
  },
};
