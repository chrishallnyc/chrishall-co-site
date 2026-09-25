// Standalone alternate history. Coordinates are ENU metres relative to
// 40.70 N / 74.00 W. The two invented flights approach protected airspace;
// a fence breach ends the sortie before any building-impact simulation.
import { TRIG } from '../../game/missions.js';

const lines = {
  1000: 'Harbor Watch',
  1001: 'September 11, 2001. The World Trade Center has been struck. New York’s airspace is closed. Emergency crews are working below.',
  1002: 'In this alternate history, you are already airborne over New York Harbor in an F-22. Establish overwatch south of Manhattan. The city is a protected civilian area.',
  1003: 'Two additional transport aircraft have been hijacked and are inbound toward Lower Manhattan and Midtown. Control has identified both hostile tracks. Intercept them before either enters protected airspace.',
  1004: 'Fly through the harbor overwatch marker, then follow the target cue. Keep a hostile aircraft ahead until LOCK appears and launch a missile. Both aircraft must be intercepted; a protected-airspace breach or the eight-minute deadline ends the mission.',
  1005: 'CONTROL: Raptor 1-1, establish harbor overwatch. Two additional hostile tracks are confirmed inbound. Keep them outside the city protection zones.',
  1006: 'CONTROL: First track is approaching from the southeast. Second track is northeast of the city. Confirmed hostile transports. Remaining airspace is clear.',
  1007: 'RAPTOR 1-1: On station over the harbor. Moving to intercept the two confirmed hostile tracks.',
  1008: 'CONTROL: Both hostile tracks are neutralized. Maintain the harbor screen. Emergency crews have clear airspace.',
  1009: 'CONTROL: A hostile track crossed the protection boundary. Interception window closed. End the exercise.',
  1010: 'CONTROL: The interception window has expired. End the exercise and return to standby.',
  1011: 'CONTROL: Protect both districts. Intercept the approaching tracks before they reach the marked boundaries.',
  1012: 'Establish harbor overwatch',
  1013: 'Intercept both additional hostile aircraft',
  1014: 'Protect Lower Manhattan airspace',
  1015: 'Protect Midtown airspace',
  1016: 'This is a fictional scenario. The aircraft deployment and additional threats are invented. The historical attacks remain offscreen and are not recreated.',
};

export default {
  id: 'Y01', front: 'NEWYORK', titleId: 1000,
  briefingIds: [1001, 1002, 1003, 1004],
  contentNoteId: 1016,
  meta: { turnObj: 1, turnLineId: 1007, victoryLineId: 1008, defeatLineId: 1009, standalone: true },
  lines,
  spec: {
    v: 1, kind: 'authored', front: 'NEWYORK', type: 'intercept', seed: 0x4e594301,
    todH: 11.1, weatherIdx: 0,
    playerSpawn: { x: -2200, y: -14000, alt: 2200, headingDeg: 84, speed: 230 },
    airfield: { x: 18680, y: -6520, r: 900 },
    units: [], paths: {},
    bandits: [
      // Southeastern approach runs through the outer harbor. The second
      // longer approach leaves time to intercept each track in sequence.
      { kind: 'transport', tier: 0, x: 26000, y: -17000, z: 2300, headingDeg: 158, speed: 150,
        tag: 90, side: 0, wpts: [[12000, -11500], [1000, -3500], [-900, 1200]] },
      { kind: 'transport', tier: 0, x: 28000, y: 25000, z: 2600, headingDeg: -94, speed: 150,
        tag: 90, side: 0, wpts: [[27000, 10000], [21000, 3500], [11000, 6500], [1100, 5400]] },
    ],
    objectives: [
      { id: 1, kind: 'reach_zone', zone: { x: -1300, y: -5000, r: 1800 }, labelId: 1012 },
      { id: 2, kind: 'destroy_tag', air: true, tag: 90, need: 2, labelId: 1013 },
      { id: 3, kind: 'protect_tag', air: true, tag: 90, zone: { x: -900, y: 1200, r: 2400 }, labelId: 1014 },
      { id: 4, kind: 'protect_tag', air: true, tag: 90, zone: { x: 1100, y: 5400, r: 2300 }, labelId: 1015 },
    ],
    winWhen: [1, 2], loseWhen: [3, 4],
    timeLimitS: 480,
    // This mission requires both interceptions. The default defensive
    // timeout victory would incorrectly reward a patrol that never engaged.
    timeoutOutcome: -1,
    comms: [
      { on: TRIG.ON_START, lineId: 1005 },
      { on: TRIG.ON_TIME, t: 14, lineId: 1006 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 1007 },
      { on: TRIG.ON_TIME, t: 70, lineId: 1011 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 2, lineId: 1008 },
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 3, lineId: 1009 },
      { on: TRIG.ON_OBJECTIVE_FAILED, obj: 4, lineId: 1009 },
      { on: TRIG.ON_TIME, t: 480, lineId: 1010 },
    ],
    scoreKm: 0,
  },
};
