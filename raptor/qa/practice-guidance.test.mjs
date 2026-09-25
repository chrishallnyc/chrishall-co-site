import test from 'node:test';
import assert from 'node:assert/strict';
import { practiceGuidance, practiceGearGuidance } from '../src/game/practiceguidance.js';
import { TrainingCourse, FlightCoach, LESSONS, FLIGHT_SCHOOL_KEY } from '../src/game/flightcoach.js';

const flight = (patch = {}) => ({ heading: 90, altFt: 11000, pitch: 0, roll: 0, speedKt: 380, throttle: 80, aglFt: 2000, verticalSpeedFpm: 0, crashes: 0, ...patch });
const hold = (course, seconds, telemetry) => { for (let frame = 0; frame < seconds * 60; frame++) course.update(1 / 60, telemetry); };

test('terrain takes precedence over low-speed and lesson advice without a nose-down instruction', () => {
  const lesson = { status: 'active', id: 'climb', targetAltitude: 12000 };
  const cue = practiceGuidance(flight({ speedKt: 120, aglFt: 200 }), lesson);
  assert.equal(cue.id, 'terrain');
  assert.equal(cue.tone, 'danger');
  assert.match(cue.feedback, /Add power.*level the wings.*reset/i);
  assert.doesNotMatch(cue.feedback, /lower|nose down|raise the nose/i);
  assert.equal(practiceGuidance(flight({ speedKt: 120, aglFt: 600 })).id, 'low-slow');
  assert.equal(practiceGuidance(flight({ speedKt: 120 })).id, 'airspeed');
});

test('measured descent provides early clearance cues without inventing terrain ahead', () => {
  assert.equal(practiceGuidance(flight({ aglFt: 1000, verticalSpeedFpm: -6000 })).id, 'descent');
  assert.equal(practiceGuidance(flight({ aglFt: 750, verticalSpeedFpm: -6000 })).id, 'terrain');
  assert.equal(practiceGuidance(flight({ aglFt: 1000, verticalSpeedFpm: 6000 })).id, 'climbing');
  assert.equal(practiceGuidance(flight({ aglFt: 4000, verticalSpeedFpm: -6000 })).id, 'descending');
  assert.equal(practiceGuidance(flight({ aglFt: undefined, verticalSpeedFpm: -6000 })).id, 'descending');
  assert.equal(practiceGuidance(flight({ aglFt: 1000, verticalSpeedFpm: NaN })).id, 'steady');
  assert.equal(practiceGuidance(flight({ aglFt: -10 })).id, 'terrain');
  assert.equal(practiceGuidance(null), null);
  assert.equal(practiceGuidance(flight({ speedKt: NaN })), null);
});

test('a shallow descent toward terrain cannot complete an exercise while recovery guidance is active', () => {
  const course = new TrainingCourse({ storage: null });
  for (let frame = 0; frame < 4 * 60; frame++) {
    const telemetry = flight({ speedKt: 350, pitch: -3, verticalSpeedFpm: -1000, aglFt: 400 - frame * (1000 / 60 / 60) });
    course.update(1 / 60, telemetry);
    assert.equal(practiceGuidance(telemetry, course.snapshot()).id, 'terrain');
    assert.equal(course.inTarget, false);
  }
  assert.equal(course.snapshot().id, 'steady');
  assert.equal(course.held, 0);
  hold(course, 4, flight({ aglFt: 1200 }));
  assert.equal(course.snapshot().id, 'throttle', 'the exercise continues normally after restoring clearance');
});

test('low-speed caution remains advisory above the training minimum', () => {
  const course = new TrainingCourse({ storage: null });
  const telemetry = flight({ speedKt: 175 });
  assert.equal(practiceGuidance(telemetry).id, 'slow');
  hold(course, 4, telemetry);
  assert.equal(course.snapshot().id, 'throttle');
});

test('high angle of attack calls for recovery even at normal airspeed and cannot earn a lesson', () => {
  const course = new TrainingCourse({ storage: null });
  const highAlpha = flight({ speedKt: 350, aoa: 40, aglFt: 20000, verticalSpeedFpm: -20000 });
  const cue = practiceGuidance(highAlpha, course.snapshot());
  assert.equal(cue.id, 'high-alpha');
  assert.equal(cue.action, 'recenter_aim');
  assert.match(cue.feedback, /flight path.*power.*speed/i);
  assert.doesNotMatch(cue.feedback, /stall|pull up|climb now/i);
  hold(course, 5, highAlpha);
  assert.equal(course.held, 0);
  assert.equal(course.inTarget, false);
  hold(course, 4, flight({ aoa: 5 }));
  assert.equal(course.snapshot().id, 'throttle', 'normal training resumes after unloading the aircraft');
  for (const aoa of [34.9, -10, NaN, undefined]) {
    assert.equal(practiceGuidance(flight({ aoa })).id, 'steady', `${aoa} is not a high positive angle of attack`);
  }
});

test('low-clearance recovery never asks the pilot to center aim into a descending flight path', () => {
  const nearGround = practiceGuidance(flight({ aoa: 40, aglFt: 600 }));
  assert.equal(nearGround.id, 'high-alpha-low');
  assert.equal(nearGround.action, undefined);
  assert.match(nearGround.feedback, /power.*level the wings.*Reset/);
  assert.doesNotMatch(nearGround.feedback, /center aim|lower the nose/i);
  assert.equal(practiceGuidance(flight({ aoa: 40, aglFt: 200 })).id, 'terrain');
  assert.equal(practiceGuidance(flight({ aoa: 40, aglFt: 800, verticalSpeedFpm: -6000 })).id, 'terrain');
  assert.equal(practiceGuidance(flight({ aoa: 40, aglFt: 600, speedKt: 120 })).id, 'low-slow');
});

test('gear guidance distinguishes the actuator from its command and avoids retraction advice during recovery or an approach', () => {
  const deployed = flight({ gearDown: true, gearPosition: 1 });
  assert.equal(practiceGearGuidance(flight()), null);
  assert.equal(practiceGearGuidance({ ...deployed, gearPosition: NaN }), null);
  assert.equal(practiceGearGuidance({ ...deployed, gearPosition: 2 }), null);
  assert.equal(practiceGearGuidance({ ...deployed, gearDown: false, gearPosition: 0 }), null);
  assert.deepEqual(practiceGearGuidance(deployed), { id: 'gear-down', title: 'Gear down', retract: true });
  assert.equal(practiceGearGuidance({ ...deployed, gearPosition: .5 }).id, 'gear-extending');
  assert.deepEqual(practiceGearGuidance({ ...deployed, gearDown: false, gearPosition: .5 }), { id: 'gear-retracting', title: 'Gear retracting', retract: false });
  for (const patch of [{ aglFt: 300 }, { aglFt: undefined }, { speedKt: 150 }, { aoa: 40 }, { aglFt: 1200, verticalSpeedFpm: -12000 }]) {
    assert.equal(practiceGearGuidance({ ...deployed, ...patch }).retract, false);
  }
  const course = new TrainingCourse({ storage: null });
  hold(course, 4, deployed);
  assert.equal(course.snapshot().id, 'throttle', 'configuration advice does not block an otherwise safe maneuver');
});

test('climb guidance anticipates level-off in both directions using actual vertical speed', () => {
  const lesson = { status: 'active', id: 'climb', targetAltitude: 11400 };
  assert.match(practiceGuidance(flight({ altFt: 11150, verticalSpeedFpm: 3000 }), lesson).feedback, /Start leveling off/);
  assert.match(practiceGuidance(flight({ altFt: 11150, verticalSpeedFpm: 300 }), lesson).feedback, /Raise the nose/);
  assert.match(practiceGuidance(flight({ altFt: 11700, verticalSpeedFpm: -4200 }), lesson).feedback, /Start leveling off/);
  assert.match(practiceGuidance(flight({ altFt: 11400, verticalSpeedFpm: 1800 }), lesson).feedback, /vertical speed settle/);
  assert.match(practiceGuidance(flight({ altFt: 11400, verticalSpeedFpm: 0 }), { ...lesson, inTarget: true }).feedback, /On target/);
});

test('the climb lesson requires settled vertical motion, not a pass through the altitude band', () => {
  const course = new TrainingCourse({ storage: null });
  course.index = LESSONS.findIndex(lesson => lesson.id === 'climb');
  course.anchor(flight());
  const target = course.targetAltitude;
  hold(course, 4, flight({ altFt: target, verticalSpeedFpm: 2400 }));
  assert.equal(course.snapshot().id, 'climb');
  assert.equal(course.held, 0);
  hold(course, 3, flight({ altFt: target, verticalSpeedFpm: 400 }));
  assert.equal(course.snapshot().id, 'cruise');
});

test('free flight and completed courses keep live telemetry without awarding training or rewriting achievements', () => {
  let writes = 0;
  const record = { version: 1, completedAt: 1234, completions: 2 };
  const storage = { getItem: key => key === FLIGHT_SCHOOL_KEY ? JSON.stringify(record) : null, setItem: () => { writes++; } };
  for (const status of ['complete', 'free']) {
    const course = new TrainingCourse({ storage });
    if (status === 'free') course.freeFlight();
    const initial = course.snapshot();
    const newest = flight({ speedKt: 410, verticalSpeedFpm: 2500 });
    course.update(1 / 60, newest);
    assert.equal(course.telemetry, newest);
    assert.equal(course.status, status);
    assert.equal(course.elapsed, 0);
    assert.equal(course.held, initial.held);
    assert.equal(writes, 0);
    course.update(1 / 60, flight({ speedKt: 100 }), { paused: true });
    assert.equal(course.telemetry, newest, 'paused data cannot change the flight condition');
  }
});

test('urgent free-flight cues update immediately while instrument values remain on their quiet 4 Hz cadence', () => {
  const nodes = Object.fromEntries(['speed', 'clearance', 'vertical', 'condition', 'advice', 'announcement'].map(name => [`[data-coach-${name}]`, { textContent: '' }]));
  const classes = new Map();
  const coach = Object.assign(Object.create(FlightCoach.prototype), {
    course: new TrainingCourse({ storage: null }), state: {}, paused: false, visible: true, paintElapsed: 0,
    el: { querySelector: selector => nodes[selector], classList: { toggle: (name, on) => classes.set(name, on) } },
  });
  coach.course.freeFlight();
  coach.update(1 / 120, flight());
  assert.equal(nodes['[data-coach-speed]'].textContent, '380 kt');
  assert.equal(nodes['[data-coach-condition]'].textContent, 'Steady flight');
  coach.update(1 / 120, flight({ speedKt: 120, aglFt: 200 }));
  assert.equal(nodes['[data-coach-condition]'].textContent, 'Climb away from terrain');
  assert.equal(nodes['[data-coach-speed]'].textContent, '380 kt', 'numeric repaint waits until its scheduled frame');
  assert.equal(classes.get('coach-danger'), true);
  assert.match(nodes['[data-coach-announcement]'].textContent, /Add power/);
  coach.update(.25, flight({ speedKt: 125, aglFt: 210, verticalSpeedFpm: -1249 }));
  assert.equal(nodes['[data-coach-speed]'].textContent, '125 kt');
  assert.equal(nodes['[data-coach-vertical]'].textContent, '−1,250 fpm');
  coach.update(1 / 120, flight());
  assert.equal(classes.get('coach-danger'), false);
  assert.equal(nodes['[data-coach-announcement]'].textContent, 'Flight condition recovered.');
});

test('recovery and gear hints honor customized or unassigned controls without replacing the lesson or rebuilding nodes', () => {
  const nodes = Object.fromEntries(['speed', 'clearance', 'vertical', 'condition', 'advice', 'announcement', 'configuration'].map(name => [`[data-coach-${name}]`, { textContent: '', hidden: true }]));
  const coach = Object.assign(Object.create(FlightCoach.prototype), {
    course: new TrainingCourse({ storage: null }), state: {}, paused: false, visible: true, paintElapsed: 0,
    input: { actions: { recenter_aim: { binds: [['KeyU']] }, gear: { binds: [['ShiftLeft', 'KeyG']] } } },
    el: { querySelector: selector => nodes[selector], classList: { toggle() {} } },
  });
  coach.course.freeFlight();
  coach.update(1 / 120, flight());
  assert.equal(nodes['[data-coach-configuration]'].hidden, true);
  coach.update(1 / 120, flight({ gearDown: true, gearPosition: .01 }));
  assert.equal(nodes['[data-coach-configuration]'].hidden, false);
  assert.match(nodes['[data-coach-configuration]'].textContent, /Gear extending.*Left Shift \+ G retracts/);
  assert.equal(nodes['[data-coach-condition]'].textContent, 'Steady flight');
  assert.ok(coach.paintElapsed < .25, 'configuration changes paint immediately without waiting for the numeric cadence');
  coach.update(1 / 120, flight({ aoa: 40, gearDown: true, gearPosition: 1 }));
  assert.match(nodes['[data-coach-advice]'].textContent, /U centers aim/);
  assert.match(nodes['[data-coach-announcement]'].textContent, /U centers aim/);
  assert.equal(nodes['[data-coach-configuration]'].textContent, 'Gear down', 'gear instructions yield to recovery');
  coach.input.actions.recenter_aim.binds = [];
  coach.paintTelemetry({ numeric: false });
  assert.match(nodes['[data-coach-advice]'].textContent, /Assign Center aim in controls/);
  assert.doesNotMatch(nodes['[data-coach-advice]'].textContent, /Unassigned/);
  coach.input.actions.gear.binds = [];
  coach.update(.25, flight({ gearDown: true, gearPosition: 1 }));
  assert.match(nodes['[data-coach-configuration]'].textContent, /Assign a gear key in controls/);
  coach.update(1 / 120, flight({ gearDown: false, gearPosition: .95 }));
  assert.equal(nodes['[data-coach-configuration]'].textContent, 'Gear retracting');
  coach.update(1 / 120, flight({ gearDown: false, gearPosition: 0 }));
  assert.equal(nodes['[data-coach-configuration]'].hidden, true);
});
