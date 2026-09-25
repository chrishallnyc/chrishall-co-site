import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { TrainingCourse, FlightCoach, LESSONS, FLIGHT_SCHOOL_KEY, headingDifference, readSchoolRecord } from '../src/game/flightcoach.js';

const telemetry = (patch = {}) => ({ heading: 90, altFt: 11000, pitch: 2, roll: 0, speedKt: 380, throttle: 80, aglFt: 2000, crashes: 0, ...patch });
const hold = (course, seconds, data, options) => { for (let i = 0; i < Math.round(seconds * 60); i++) course.update(1 / 60, data, options); };
const storageFixture = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
};
const fresh = options => new TrainingCourse({ storage: storageFixture(), now: () => 1234567890, ...options });

test('heading guidance takes the short route through north in either direction', () => {
  assert.equal(headingDifference(5, 355), 10);
  assert.equal(headingDifference(355, 5), -10);
  assert.equal(headingDifference(720 + 5, -5), 10);
  assert.equal(headingDifference(90, 90), 0);
});

test('a lesson needs a sustained aircraft attitude, with actual seconds rather than key presses', () => {
  const course = fresh();
  hold(course, 4, telemetry({ roll: 40 }));
  assert.equal(course.snapshot().step, 1);
  assert.equal(course.held, 0);
  hold(course, 3.9, telemetry());
  assert.equal(course.snapshot().step, 1);
  hold(course, .1, telemetry());
  assert.equal(course.snapshot().id, 'throttle');
  hold(course, 5, telemetry());
  assert.equal(course.snapshot().id, 'throttle', 'default spawn power does not pass the throttle exercise');
  hold(course, 3, telemetry({ throttle: 65 }));
  assert.equal(course.snapshot().id, 'turn');
});

test('a brief wobble keeps progress and a sustained miss drains it gradually', () => {
  const course = fresh();
  hold(course, 2, telemetry());
  const earned = course.held;
  hold(course, .5, telemetry({ roll: 30 }));
  assert.equal(course.held, earned);
  hold(course, 1, telemetry({ roll: 30 }));
  assert.ok(course.held < earned && course.held > 1, 'the pilot keeps most progress after a small correction');
  hold(course, 20, telemetry({ roll: 30 }));
  assert.equal(course.held, 0);
});

test('pause, invalid telemetry, and a large frame cannot advance unseen training time', () => {
  const course = fresh();
  hold(course, 3, telemetry());
  const held = course.held, elapsed = course.elapsed;
  course.setPaused(true);
  hold(course, 20, telemetry());
  assert.equal(course.held, held);
  assert.equal(course.elapsed, elapsed);
  course.setPaused(false);
  course.update(60, telemetry());
  assert.equal(course.snapshot().step, 1);
  assert.ok(course.held < held + .3);
  const after = course.held;
  for (const dt of [-1, NaN, Infinity, 0]) course.update(dt, telemetry());
  course.update(1 / 60, telemetry({ heading: NaN }));
  course.update(1 / 60, null);
  course.update(1 / 60, telemetry(), { paused: true });
  assert.equal(course.held, after);
});

test('the wobble grace and decay are independent of screen refresh rate', () => {
  const values = [30, 60, 120, 144].map(hz => {
    const course = fresh();
    for (let i = 0; i < hz * 2; i++) course.update(1 / hz, telemetry());
    for (let i = 0; i < hz * 2; i++) course.update(1 / hz, telemetry({ roll: 30 }));
    return course.held;
  });
  for (const value of values) assert.ok(Math.abs(value - 1.09) < 1e-8, `${value} should retain the same progress`);
});

test('turn target wraps north and requires a settled aircraft, then climb uses achieved altitude', () => {
  const course = fresh();
  hold(course, 4, telemetry({ heading: 355 }));
  hold(course, 3, telemetry({ heading: 355, throttle: 65 }));
  assert.equal(course.snapshot().targetHeading, 25);
  hold(course, 4, telemetry({ heading: 25, roll: 40 }));
  assert.equal(course.snapshot().id, 'turn');
  hold(course, 3, telemetry({ heading: 27, altFt: 11225 }));
  assert.equal(course.snapshot().id, 'climb');
  assert.equal(course.snapshot().targetAltitude, 11700);
  hold(course, 10, telemetry({ heading: 27, altFt: 11225 }));
  assert.equal(course.snapshot().id, 'climb');
  hold(course, 3, telemetry({ altFt: 11700, pitch: 25 }));
  assert.equal(course.snapshot().id, 'climb', 'passing through altitude with nose up is not level flight');
  hold(course, 3, telemetry({ altFt: 11700 }));
  assert.equal(course.snapshot().id, 'cruise');
});

test('unsafe low altitude or low airspeed never earns training progress', () => {
  const course = fresh();
  hold(course, 6, telemetry({ speedKt: 140 }));
  hold(course, 6, telemetry({ aglFt: 200 }));
  assert.equal(course.held, 0);
  const oldTelemetry = telemetry(); delete oldTelemetry.aglFt;
  hold(course, 4, oldTelemetry);
  assert.equal(course.snapshot().step, 2, 'optional AGL can be absent before a simulator has produced it');
});

test('retry preserves the exercise, clears its hold, and reanchors to the actual recovered aircraft', () => {
  const course = fresh();
  hold(course, 4, telemetry());
  hold(course, 3, telemetry({ throttle: 65 }));
  hold(course, 1, telemetry({ heading: 120 }));
  assert.ok(course.held > .9);
  course.reset({ telemetry: telemetry({ heading: 310, altFt: 22000 }) });
  assert.equal(course.snapshot().id, 'turn');
  assert.equal(course.held, 0);
  assert.equal(course.snapshot().targetHeading, 340);
  hold(course, 3, telemetry({ heading: 340, altFt: 22000 }));
  assert.equal(course.snapshot().id, 'climb');
  assert.equal(course.snapshot().targetAltitude, 22400);
});

test('automatic crash recovery clears prior progress and does not count the crash frame', () => {
  const course = fresh();
  hold(course, 3.9, telemetry());
  assert.equal(course.update(.1, telemetry({ crashes: 1 })), true);
  assert.equal(course.snapshot().id, 'steady');
  assert.equal(course.held, 0);
  assert.equal(course.recoveries, 1);
  hold(course, 4, telemetry({ crashes: 1 }));
  assert.equal(course.snapshot().id, 'throttle');
});

function graduate(course) {
  hold(course, LESSONS[0].seconds, telemetry());
  hold(course, LESSONS[1].seconds, telemetry({ throttle: 65 }));
  hold(course, LESSONS[2].seconds, telemetry({ heading: 120 }));
  hold(course, LESSONS[3].seconds, telemetry({ heading: 120, altFt: 11400 }));
  hold(course, LESSONS[4].seconds, telemetry({ heading: 120, altFt: 11400, throttle: 90 }));
}

test('all five real maneuvers earn a persisted achievement; replay never erases it', () => {
  const storage = storageFixture();
  const course = fresh({ storage });
  graduate(course);
  assert.equal(course.status, 'complete');
  assert.equal(course.saved, true);
  assert.deepEqual(readSchoolRecord(storage), { version: 1, completedAt: 1234567890, completions: 1 });
  const again = fresh({ storage });
  assert.equal(again.status, 'complete', 'returning pilot sees their achievement with an explicit replay choice');
  assert.equal(again.snapshot().progress, 1);
  again.reset({ replay: true, telemetry: telemetry() });
  assert.equal(again.status, 'active');
  assert.equal(again.index, 0);
  assert.equal(again.snapshot().earned, true);
  graduate(again);
  assert.equal(readSchoolRecord(storage).completions, 2);
  hold(again, 40, telemetry());
  assert.equal(readSchoolRecord(storage).completions, 2, 'completion is saved once');
});

test('free flight never grants completion and replay starts cleanly', () => {
  const storage = storageFixture(), course = fresh({ storage });
  hold(course, 3, telemetry());
  course.freeFlight();
  graduate(course);
  assert.equal(course.status, 'free');
  assert.equal(readSchoolRecord(storage), null);
  course.reset({ replay: true, telemetry: telemetry() });
  assert.equal(course.status, 'active');
  assert.equal(course.held, 0);
  graduate(course);
  assert.equal(course.status, 'complete');
});

test('denied or corrupt storage never blocks training and never claims a saved achievement', () => {
  const denied = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } };
  const course = fresh({ storage: denied });
  graduate(course);
  assert.equal(course.status, 'complete');
  assert.equal(course.saved, false);
  assert.equal(course.snapshot().earned, true, 'session completion remains useful even when persistence fails');
  const absent = fresh({ storage: null }); graduate(absent);
  assert.equal(absent.saved, false);
  const storage = storageFixture();
  for (const data of ['bad json', 'null', '{"version":1,"completedAt":4,"completions":-2}', '{"version":2,"completedAt":4,"completions":1}', '{"version":1,"completedAt":"4","completions":1}']) {
    storage.setItem(FLIGHT_SCHOOL_KEY, data);
    assert.equal(readSchoolRecord(storage), null);
  }
});

test('live coach actions restore keyboard flight focus while paused actions retain dialog focus', () => {
  const previousDocument = globalThis.document;
  let focused = 0, modalOpen = false, activeTarget = 'coach button';
  globalThis.document = {
    querySelector: () => modalOpen ? {} : null,
    getElementById: id => id === 'game' ? { focus: () => { focused++; activeTarget = 'game'; } } : null,
  };
  try {
    const coach = Object.assign(Object.create(FlightCoach.prototype), {
      state: { paused: false }, paused: false, course: fresh(),
      onRecover: () => {}, reset: () => { activeTarget = 'coach button'; }, refresh: () => { activeTarget = 'coach button'; },
    });
    for (const method of ['retry', 'replay', 'freeFlight']) {
      coach[method]();
      assert.equal(activeTarget, 'game', `${method} restores flight focus after its final render`);
    }
    assert.equal(focused, 3, 'each gameplay action hands keyboard input back to the canvas');
    coach.state.paused = true;
    coach.retry(); coach.replay(); coach.freeFlight();
    assert.equal(focused, 3, 'pause-menu actions retain their native dialog focus');
    coach.state.paused = false; coach.paused = true;
    coach.focusFlight();
    coach.paused = false; modalOpen = true;
    coach.focusFlight();
    assert.equal(focused, 3, 'the local pause boundary and any open modal also prevent a focus escape');
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('a real Player can complete the course with gentle pointer aim and held throttle controls', async context => {
  // This is a native flight-model integration check, not a browser playthrough:
  // no teleports, invented telemetry, modified attitudes, or course shortcuts.
  // The only DOM stub paints the weapons' procedural sprite at construction.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'three') return { url: new URL('../vendor/three.core.min.js', import.meta.url).href, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };
  try {
    const THREE = await import('../vendor/three.core.min.js');
    const { Player } = await import('../src/game/player.js');
    const { SimCore, DT } = await import('../src/engine/sim.js');
    const player = new Player(new THREE.Scene(), { jet: new THREE.Group(), spawn: { x: 0, y: -6000, alt: 3400, headingRad: 0, speed: 200 } });
    const sim = new SimCore(7); sim.addSystem(player);
    const course = fresh(), completed = [];
    const heldKeys = new Set();
    const input = { mouse: { dx: 0, dy: 0 }, held: key => heldKeys.has(key), pressed: () => false, axis: () => 0, wheelDelta: () => 0 };
    let desiredHeading = 0, desiredPitch = 0, lastIndex = 0;
    const clamp = (v, limit) => Math.max(-limit, Math.min(limit, v));
    for (let i = 0; i < 120 * 180 && course.status === 'active'; i++) {
      const lesson = course.snapshot();
      const data = player.hudState();
      const power = lesson.id === 'steady' ? .8 : lesson.id === 'cruise' ? .9 : .65;
      heldKeys.clear();
      if (player.throttleCmd > power + .004) heldKeys.add('throttle_down');
      else if (player.throttleCmd < power - .004) heldKeys.add('throttle_up');
      if (lesson.id === 'turn') desiredHeading = (90 - lesson.targetHeading) * Math.PI / 180;
      if (lesson.id === 'climb') {
        // A mild climb, followed by small corrections as the target nears.
        desiredPitch = Math.max(-3, Math.min(5, (lesson.targetAltitude - data.altFt) * .035)) * Math.PI / 180;
      } else desiredPitch = 0;
      const headingError = headingDifference(desiredHeading * 180 / Math.PI, player.aimHeading * 180 / Math.PI) * Math.PI / 180;
      input.mouse.dx = -clamp(headingError, 6 * Math.PI / 180 * DT) / .0028;
      input.mouse.dy = -clamp(desiredPitch - player.aimPitch, 4 * Math.PI / 180 * DT) / .0028;
      player.feedInput(input);
      sim.tick();
      const measured = { ...player.hudState(), aglFt: player.fm.out.agl * 3.28084, crashes: player.crashes };
      course.update(DT, measured);
      if (course.index !== lastIndex || course.status === 'complete') {
        completed.push({ lesson: LESSONS[lastIndex].id, time: Math.round(sim.time * 10) / 10, speed: Math.round(measured.speedKt), pitch: Math.round(measured.pitch), roll: Math.round(measured.roll), altitude: Math.round(measured.altFt) });
        lastIndex = course.index;
      }
    }
    assert.equal(player.crashes, 0, 'ordinary training maneuvers remain safely airborne');
    assert.equal(course.status, 'complete', JSON.stringify({ completed, current: course.snapshot(), aircraft: player.hudState() }));
    assert.deepEqual(completed.map(value => value.lesson), LESSONS.map(value => value.id));
    assert.ok(sim.time < 120, `guided maneuvers should be approachable within two minutes, took ${sim.time}s`);
    context.diagnostic(`Native flight-model milestones: ${completed.map(value => `${value.lesson} ${value.time}s`).join(', ')}; no crashes.`);
  } finally {
    hooks.deregister();
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
