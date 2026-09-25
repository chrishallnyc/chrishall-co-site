import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from '../src/game/script.js';
import { TRIG } from '../src/game/missions.js';
import { radioHistory, formatRadioTime, wrapRadioText, drawRadioFeed } from '../src/game/radiolog.js';

function mission() {
  const lines = { 100: 'OVERLORD: Hold your course.', 101: 'RAPTOR: Tally the convoy.', 102: 'OVERLORD: Mission complete.' };
  const spec = { type: 'strike', objectives: [{ id: 1, kind: 'survive_until', t: 300 }], bandits: [],
    winWhen: [1], loseWhen: [], timeLimitS: 400, comms: [
      { on: TRIG.ON_START, lineId: 100 }, { on: TRIG.ON_TIME, t: 10, lineId: 101 },
      { on: TRIG.ON_OBJECTIVE_DONE, obj: 1, lineId: 102 },
    ] };
  return { sim: { time: 0 }, script: new Script(spec, { match: { over: 0, blue: 30 } }), missionData: { lines } };
}

function context() {
  const marks = [], stack = [];
  return { marks, stack, measures: 0, font: '12px monospace', globalAlpha: 1, textAlign: 'right', textBaseline: 'middle',
    measureText(text) { this.measures++; return { width: Array.from(text).length * parseFloat(this.font) * .6 }; },
    save() { stack.push({ font: this.font, globalAlpha: this.globalAlpha, fillStyle: this.fillStyle,
      textAlign: this.textAlign, textBaseline: this.textBaseline }); },
    restore() { Object.assign(this, stack.pop()); },
    fillRect(x, y, width, height) { marks.push({ type: 'rect', x, y, width, height, alpha: this.globalAlpha }); },
    fillText(text, x, y) { marks.push({ type: 'text', text, x, y, width: Array.from(text).length * parseFloat(this.font) * .6,
      height: parseFloat(this.font), alpha: this.globalAlpha }); },
  };
}
const options = { timeS: 0, width: 1280, height: 800, toolbarBottom: 70, top: 180 };

test('radio history contains only emitted Script lines and never changes deterministic mission state', () => {
  const state = mission();
  assert.deepEqual(radioHistory(state), []);
  state.script.tick(state.sim, 1 / 120);
  const hash = state.script.hash(2166136261), first = radioHistory(state);
  assert.deepEqual(first, [{ lineId: 100, timeS: 0, text: state.missionData.lines[100] }]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first[0]), true);
  for (let frame = 0; frame < 120; frame++) assert.equal(radioHistory(state), first);
  assert.equal(state.script.hash(2166136261), hash);
  assert.equal('_commsShown' in state.script, false);
  state.sim.time = 10; state.script.tick(state.sim, 1 / 120);
  const second = radioHistory(state);
  assert.deepEqual(second.map(row => row.lineId), [101, 100]);
  assert.equal(first.length, 1, 'an existing paused snapshot remains immutable');
  assert.equal(second.some(row => row.lineId === 102), false, 'future authored victory text is absent');
  assert.deepEqual(second.map(({ lineId, timeS }) => ({ lineId, t: timeS })), state.script.readComms());
});

test('ring wrap, reset, same-head changes, unknown IDs and future timestamps do not leak stale calls', () => {
  const state = mission(), script = state.script;
  state.sim.time = 100;
  for (let i = 0; i < 40; i++) {
    state.missionData.lines[i] = `Call ${i}`;
    script.commsLine[i % 32] = i; script.commsT[i % 32] = i; script.commsHead++;
  }
  assert.deepEqual(radioHistory(state).map(row => row.lineId), Array.from({ length: 32 }, (_, i) => 39 - i));
  script.reset(); assert.deepEqual(radioHistory(state), []);
  script.commsLine[0] = 100; script.commsT[0] = 0; script.commsHead = 1;
  const before = radioHistory(state);
  script.commsLine[0] = 101;
  assert.equal(radioHistory(state)[0].lineId, 101, 'same head after reset must not reuse stale text');
  assert.equal(before[0].lineId, 100);
  state.missionData.lines[101] = 'Updated briefing';
  assert.equal(radioHistory(state)[0].text, 'Updated briefing');
  script.commsLine[0] = 999; assert.deepEqual(radioHistory(state), []);
  Object.setPrototypeOf(state.missionData.lines, { 999: 'Inherited text is not a radio line' });
  assert.deepEqual(radioHistory(state), []);
  script.commsLine[0] = 101; script.commsT[0] = 101;
  assert.deepEqual(radioHistory(state), [], 'rewound time cannot expose a later timestamp');
  state.sim.time = 101; assert.equal(radioHistory(state)[0].timeS, 101);
  script.commsT[0] = NaN; assert.deepEqual(radioHistory(state), []);
  script.commsT[0] = -1; assert.deepEqual(radioHistory(state), []);
  script.commsT[0] = 0; state.missionData.lines[101] = { text: 'Not a string' };
  assert.deepEqual(radioHistory(state), []);
});

test('long calls wrap within measured width, including unspaced words and Unicode', () => {
  const measure = text => Array.from(text).length * 7;
  for (const text of ['OVERLORD: ' + 'Reach the convoy before it escapes. '.repeat(12), 'A'.repeat(1000), '航行注意'.repeat(50), '🚀'.repeat(200)]) {
    const rows = wrapRadioText(text, 140, measure, 4);
    assert.ok(rows.length > 0 && rows.length <= 4);
    assert.ok(rows.every(row => measure(row) <= 140));
    assert.ok(rows.at(-1).endsWith('…'), 'a shortened call is visibly marked');
    assert.ok(rows.every(row => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(row)));
  }
  const text = 'OVERLORD: Convoy ahead. Hold fire until cleared.';
  assert.equal(wrapRadioText(text, 140, measure, 8).join(' '), text);
  assert.deepEqual(wrapRadioText(text, 0, measure), []);
});

test('live feed preserves simulation-time age while paused and retains expired calls in history', () => {
  const state = mission(); state.script.tick(state.sim, 1 / 120);
  const history = radioHistory(state), ctx = context();
  const first = drawRadioFeed(ctx, history, { ...options, timeS: 7.5 });
  assert.equal(ctx.marks.find(mark => mark.type === 'text').alpha, .75);
  const measures = ctx.measures;
  for (let frame = 0; frame < 120; frame++) {
    ctx.marks.length = 0;
    assert.equal(drawRadioFeed(ctx, history, { ...options, timeS: 7.5 }), first);
    assert.equal(ctx.marks.find(mark => mark.type === 'text').alpha, .75);
  }
  assert.equal(ctx.measures, measures, 'unchanged paused frames do not remeasure/wrap text');
  ctx.marks.length = 0;
  assert.equal(drawRadioFeed(ctx, history, { ...options, timeS: 9 }), null);
  assert.equal(ctx.marks.length, 0);
  assert.equal(radioHistory(state), history, 'the paused log retains calls after subtitle expiry');
  assert.equal(ctx.globalAlpha, 1); assert.equal(ctx.textAlign, 'right'); assert.equal(ctx.font, '12px monospace');
  assert.equal(ctx.stack.length, 0);
});

test('radio panel clears viewport, toolbar, objectives, scaled instruments, ammunition and hints', () => {
  const history = Object.freeze(Array.from({ length: 4 }, (_, i) => ({ lineId: i, timeS: 4 - i,
    text: `OVERLORD ${i}: ` + 'Check your bearing and remain clear of the defended valley. '.repeat(5) })));
  for (const [width, height] of [[1440, 1000], [1280, 800], [768, 600], [390, 667], [320, 568], [390, 360], [320, 220]]) {
    for (const hudScale of [.8, 1, 1.4]) for (const subtitleScale of [.8, 1, 1.6, 100]) for (const showHints of [false, true]) {
      const ctx = context(), toolbarBottom = width < 760 ? 116 : 70, top = toolbarBottom + 80;
      const layout = drawRadioFeed(ctx, history, { width, height, hudScale, subtitleScale, showHints, toolbarBottom, top, timeS: 4 });
      if (!layout) { assert.equal(ctx.marks.length, 0); continue; }
      assert.ok(layout.messages.length <= 3);
      assert.equal(layout.messages[0].entry, history[0], 'newest call has first claim on space');
      assert.ok(layout.messages.reduce((sum, message) => sum + message.rows.length, 0) <= 6);
      for (const mark of ctx.marks) {
        assert.ok(mark.x >= 16 && mark.x + mark.width <= width - 16 + .01, `horizontal fit ${width}×${height}`);
        assert.ok(mark.y >= top, `top reserved ${width}×${height}`);
        assert.ok(mark.y + mark.height <= height - Math.max(108 * hudScale, showHints ? 100 : 60) + .01,
          `lower instruments reserved ${width}×${height}, HUD ${hudScale}, subtitles ${subtitleScale}`);
      }
      assert.equal(ctx.stack.length, 0);
    }
  }
});

test('newest three calls display in chronological reading order and cached layouts invalidate with changes', () => {
  const ctx = context(), history = Array.from({ length: 4 }, (_, i) => ({ lineId: i, timeS: 4 - i, text: `Call ${i}` }));
  const first = drawRadioFeed(ctx, history, { ...options, timeS: 4 });
  assert.deepEqual(ctx.marks.filter(mark => mark.type === 'text').map(mark => mark.text), ['» Call 2', '» Call 1', '» Call 0']);
  const measures = ctx.measures;
  assert.equal(drawRadioFeed(ctx, history, { ...options, timeS: 5 }), first);
  assert.equal(ctx.measures, measures);
  const aged = drawRadioFeed(ctx, history, { ...options, timeS: 11 });
  assert.notEqual(aged, first); assert.equal(aged.messages.length, 2);
  const resized = drawRadioFeed(ctx, history, { ...options, timeS: 11, width: 390 });
  assert.notEqual(resized, aged);
  const scaled = drawRadioFeed(ctx, history, { ...options, timeS: 11, width: 390, subtitleScale: 1.6 });
  assert.notEqual(scaled, resized);
  assert.equal(formatRadioTime(7.9), '00:07');
  assert.equal(formatRadioTime(125), '02:05');
  assert.equal(formatRadioTime(3601), '1:00:01');
});

test('threat, boundary and rearm priority suppress live subtitles without consuming radio history', () => {
  const state = mission(); state.script.tick(state.sim, 1 / 120);
  const ctx = context(), history = radioHistory(state);
  assert.ok(drawRadioFeed(ctx, history, options));
  ctx.marks.length = 0;
  for (let frame = 0; frame < 120; frame++) assert.equal(drawRadioFeed(ctx, radioHistory(state), { ...options, priorityCue: true }), null);
  assert.equal(ctx.marks.length, 0, 'a priority card cannot be masked by radio text or its backing plate');
  assert.equal(radioHistory(state), history);
  assert.ok(drawRadioFeed(ctx, history, { ...options, timeS: 2 }));
  assert.equal(ctx.marks.filter(mark => mark.type === 'text').map(mark => mark.text).join(' '), '» ' + history[0].text);
});
