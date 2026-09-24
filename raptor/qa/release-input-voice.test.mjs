import test from 'node:test';
import assert from 'node:assert/strict';
import { Input, STORE_KEY, LEGACY_STORE_KEY } from '../src/engine/input.js';
import { ACTIVE_ACTIONS } from '../src/engine/binds.js';
import { BindingHistory, bindingSnapshot, planActionRestore } from '../src/game/controlhistory.js';
import { Voice } from '../src/game/voice.js';

function fixture(saved = {}, key = STORE_KEY) {
  const store = new Map([[key, JSON.stringify(saved)]]);
  globalThis.localStorage = {getItem: name => store.get(name) ?? null, setItem: (name, value) => store.set(name, value)};
  return {input:new Input(new EventTarget()), store};
}

for (const [code, owner] of [['KeyF', 'fire_mguns'], ['KeyH', 'help']]) {
  test(`explicit sharing of default ${code} survives a real save/reload`, () => {
    const {input, store} = fixture();
    assert.equal(input.setBinding('gear', 0, [code], {resolve:'share'}), true);
    const live = input.matchingActions(code);
    assert.ok(live.includes(owner)); assert.ok(live.includes('gear'));
    assert.deepEqual(JSON.parse(store.get(STORE_KEY))[owner], ACTIVE_ACTIONS[owner].binds);
    const reloaded = new Input(new EventTarget());
    assert.deepEqual(reloaded.matchingActions(code), live);
    assert.deepEqual(reloaded.actions[owner].binds, ACTIVE_ACTIONS[owner].binds);
  });
  test(`Undo restores deliberate default ${code} sharing after reload`, () => {
    const {input} = fixture();
    input.setBinding('gear', 0, [code], {resolve:'share'});
    const before = bindingSnapshot(input), history = new BindingHistory(input);
    history.change('change gear', () => input.setBinding('gear', 0, ['KeyU']));
    assert.equal(history.undo(), 'change gear');
    assert.deepEqual(bindingSnapshot(new Input(new EventTarget())), before);
  });
  test(`older custom ${code} ownership still takes precedence over the added default`, () => {
    const {input} = fixture({gear:[[code]]});
    assert.deepEqual(input.matchingActions(code), ['gear']);
    assert.equal(input.actions[owner].binds.some(chord => chord.length === 1 && chord[0] === code), false);
    input.setBinding('recenter_aim', 0, ['KeyU']);
    assert.deepEqual(new Input(new EventTarget()).matchingActions(code), ['gear']);
  });
}

for (const key of [STORE_KEY, LEGACY_STORE_KEY]) {
  test(`${key} duplicate chords normalize before unrelated Undo and Restore`, () => {
    const {input} = fixture({gear:[['KeyG'], ['KeyG']], help:[['KeyJ']]}, key);
    assert.deepEqual(input.actions.gear.binds, [['KeyG']]);
    const before = bindingSnapshot(input), history = new BindingHistory(input);
    history.change('change cannon', () => input.setBinding('fire_mguns', 0, ['KeyU']));
    assert.equal(history.undo(), 'change cannon');
    assert.deepEqual(bindingSnapshot(input), before);
    assert.equal(input.replaceBindings(planActionRestore(input, 'help').layout), true);
    assert.deepEqual(input.actions.help.binds, ACTIVE_ACTIONS.help.binds);
    assert.deepEqual(new Input(new EventTarget()).actions.gear.binds, [['KeyG']]);
  });
}

test('duplicate modifier-order identities retain the first binding and distinct alternates', () => {
  const {input} = fixture({gear:[['ShiftLeft','AltLeft','KeyU'], ['AltLeft','ShiftLeft','KeyU'], ['KeyI']]});
  assert.deepEqual(input.actions.gear.binds, [['ShiftLeft','AltLeft','KeyU'], ['KeyI']]);
  assert.equal(input.replaceBindings(bindingSnapshot(input)), true);
});

test('duplicate legacy cannon aliases do not crowd out a valid new default', () => {
  const {input} = fixture({fire_cannons:[['KeyU'], ['KeyU']]}, LEGACY_STORE_KEY);
  assert.deepEqual(input.actions.fire_mguns.binds, [['KeyF'], ['Mouse0'], ['Digit1'], ['KeyU']]);
});

function radio(options) {
  const utterances = [];
  const settings = {...options};
  const voice = new Voice({current:() => settings}, {
    synth:{getVoices:() => [], speak:utterance => utterances.push(utterance), cancel:() => {}},
    Utterance:class { constructor(text) { this.text = text; } },
  });
  return {voice, settings, utterances};
}

test('spoken radio follows both master and radio gains', () => {
  const {voice, utterances} = radio({voice:true, masterVol:.25, uiVol:.4});
  voice.speak(200, 'OVERLORD: Check radio volume.');
  assert.equal(utterances.length, 1);
  assert.equal(utterances[0].volume, .1);
});

test('muted, disabled, or zero-volume radio queues no utterance', () => {
  for (const patch of [{muted:true}, {voice:false}, {masterVol:0}, {uiVol:0}, {masterVol:-1}]) {
    const {voice, utterances} = radio({voice:true, masterVol:1, uiVol:1, ...patch});
    assert.equal(voice.enabled(), false);
    voice.speak(200, 'OVERLORD: This line should stay silent.');
    assert.equal(utterances.length, 0);
    assert.equal(voice._cur, null); assert.equal(voice._next, null);
  }
});

test('old radio settings without master volume retain their intended gain', () => {
  for (const [settings, expected] of [[{voice:true}, 1], [{voice:true, uiVol:.4}, .4], [{voice:true, masterVol:2, uiVol:.4}, .4], [{voice:true, masterVol:NaN, uiVol:.4}, .4]]) {
    const {voice, utterances} = radio(settings);
    voice.speak(200, 'OVERLORD: Legacy radio check.');
    assert.equal(utterances[0].volume, expected);
  }
});

test('re-enabling audio starts fresh rather than replaying a muted line', () => {
  const {voice, settings, utterances} = radio({voice:true, masterVol:0, uiVol:1});
  voice.speak(200, 'OVERLORD: This happened while muted.');
  settings.masterVol = .5;
  voice.speak(201, 'OVERLORD: This is the fresh line.');
  assert.equal(utterances.length, 1);
  assert.equal(utterances[0].volume, .5);
  assert.match(utterances[0].text, /fresh line/);
});
