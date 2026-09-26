import assert from 'node:assert/strict';
import test from 'node:test';
import { STAGES } from '../src/sim.js';
import { CITY_IDS, CITY_HEIGHT, CITY_VISTAS, cityCameraOffset } from '../src/city-scenes.js';

test('each playable city has a scene and a preview inside the authored strip', () => {
  assert.deepEqual(STAGES.map(stage => stage.id), CITY_IDS);
  assert.equal(CITY_VISTAS.length, STAGES.length);
  for (const offset of CITY_VISTAS) assert.ok(offset >= 0 && offset + 400 <= CITY_HEIGHT);
});

test('city camera covers the full route once and never wraps during a long boss fight', () => {
  for (const stage of STAGES) {
    assert.equal(cityCameraOffset(0, stage.duration), CITY_HEIGHT - 400);
    let previous = CITY_HEIGHT - 400;
    for (let second = 0; second <= stage.duration + 180; second += .25) {
      const offset = cityCameraOffset(second, stage.duration);
      assert.ok(Number.isInteger(offset) && offset >= 0 && offset <= previous);
      previous = offset;
    }
    assert.equal(cityCameraOffset(stage.duration, stage.duration), 0);
    assert.equal(cityCameraOffset(stage.duration + 180, stage.duration), 0);
  }
});

test('invalid or pre-start time cannot leave an unpainted gap in the canvas', () => {
  for (const time of [undefined, NaN, Infinity, -50]) {
    assert.equal(cityCameraOffset(time, 54), CITY_HEIGHT - 400);
  }
  for (const duration of [0, -1, undefined, NaN, Infinity]) {
    const offset = cityCameraOffset(.5, duration);
    assert.ok(offset >= 0 && offset <= CITY_HEIGHT - 400);
  }
});
