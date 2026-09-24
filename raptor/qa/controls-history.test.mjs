import test from 'node:test';
import assert from 'node:assert/strict';
import { Input, STORE_KEY } from '../src/engine/input.js';
import { ACTIVE_ACTIONS } from '../src/engine/binds.js';
import { BindingHistory, bindingSnapshot, planActionRestore, missingEssentialActions } from '../src/game/controlhistory.js';
import { ControlsMenu } from '../src/game/controlsmenu.js';

function fixture(seed = {}) {
  const store = new Map([[STORE_KEY, JSON.stringify(seed)]]);
  const writes = [];
  globalThis.localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { writes.push([key, value]); store.set(key, value); },
  };
  const input = new Input(new EventTarget());
  return { input, store, writes, history: new BindingHistory(input) };
}

test('one-step undo restores primary and alternate keys, runtime matching, and the saved layout', () => {
  const { input, history, writes } = fixture({ throttle_up: [['KeyU'], ['KeyI']] });
  assert.equal(history.canUndo, false);
  assert.equal(history.change('change throttle', () => input.setBinding('throttle_up', 0, ['KeyO'])), true);
  assert.equal(history.canUndo, true);
  assert.deepEqual(input.matchingActions('KeyO'), ['throttle_up']);
  const beforeUndo = writes.length;
  assert.equal(history.undo(), 'change throttle');
  assert.equal(writes.length - beforeUndo, 1, 'undo persists the complete layout once');
  assert.deepEqual(input.actions.throttle_up.binds, [['KeyU'], ['KeyI']]);
  assert.deepEqual(input.matchingActions('KeyO'), []);
  assert.deepEqual(input.matchingActions('KeyU'), ['throttle_up']);
  assert.deepEqual(new Input(new EventTarget()).actions.throttle_up.binds, [['KeyU'], ['KeyI']]);
  assert.equal(history.canUndo, false);
  assert.equal(history.undo(), false);
});

test('undo returns all actions affected by an explicitly moved key', () => {
  const { input, history } = fixture();
  const before = bindingSnapshot(input);
  assert.equal(history.change('move gear key', () => input.setBinding('fire_aam', 0, ['KeyG'], {resolve:'replace'})), true);
  assert.deepEqual(input.actions.gear.binds, []);
  assert.deepEqual(input.matchingActions('KeyG'), ['fire_aam']);
  assert.equal(history.undo(), 'move gear key');
  assert.deepEqual(bindingSnapshot(input), before);
  assert.deepEqual(input.matchingActions('KeyG'), ['gear']);
});

test('failed edits and no-op edits preserve the last successful undo step', () => {
  const { input, history } = fixture();
  history.change('change gear', () => input.setBinding('gear', 0, ['KeyU']));
  assert.equal(history.change('steal W', () => input.setBinding('gear', 0, ['KeyW'])), false);
  assert.equal(history.change('same key', () => input.setBinding('gear', 0, ['KeyU'])), true);
  assert.equal(history.undo(), 'change gear');
  assert.deepEqual(input.actions.gear.binds, [['KeyG']]);
});

test('an external layout change cannot be overwritten by stale undo history', () => {
  const { input, history } = fixture();
  history.change('change gear', () => input.setBinding('gear', 0, ['KeyU']));
  input.setBinding('help', 0, ['KeyO']);
  assert.equal(history.canUndo, false);
  assert.equal(history.undo(), false);
  assert.deepEqual(input.actions.help.binds[0], ['KeyO']);
});

test('restoring an action plans explicit conflicts without mutation and preserves other custom keys', () => {
  const { input, history, writes } = fixture({
    gear: [], fire_aam: [['KeyG']], help: [['KeyU']], fire_mguns: [['KeyI'], ['Mouse0']],
  });
  const before = bindingSnapshot(input);
  const plan = planActionRestore(input, 'gear');
  assert.deepEqual(bindingSnapshot(input), before);
  assert.equal(writes.length, 0, 'opening the restore confirmation must not save anything');
  assert.deepEqual(plan.conflicts.map(c => c.id), ['fire_aam']);
  assert.deepEqual(plan.unbound, ['fire_aam']);
  assert.equal(history.change('restore gear', () => input.replaceBindings(plan.layout)), true);
  assert.deepEqual(input.actions.gear.binds, [['KeyG']]);
  assert.deepEqual(input.actions.fire_aam.binds, []);
  assert.deepEqual(input.actions.help.binds, [['KeyU']]);
  assert.deepEqual(input.actions.fire_mguns.binds, [['KeyI'], ['Mouse0']]);
  assert.equal(history.undo(), 'restore gear');
  assert.deepEqual(bindingSnapshot(input), before);
});

test('restore conflict planning detects when several default keys exhaust one action', () => {
  const { input } = fixture({ fire_mguns: [], help: [['KeyF'], ['Mouse0']] });
  const plan = planActionRestore(input, 'fire_mguns');
  assert.equal(plan.conflicts.length, 2);
  assert.deepEqual(plan.unbound, ['help']);
  assert.deepEqual(plan.layout.fire_mguns, ACTIVE_ACTIONS.fire_mguns.binds);
  assert.equal(planActionRestore(input, 'not-an-action'), null);
});

test('undo restores intentional shared bindings and unbound actions exactly', () => {
  const { input, history } = fixture({ gear: [], fire_aam: [['KeyU']], help: [['KeyU']] });
  const before = bindingSnapshot(input);
  history.change('reset keys', () => input.resetBinds());
  assert.equal(history.undo(), 'reset keys');
  assert.deepEqual(bindingSnapshot(input), before);
  assert.deepEqual(input.matchingActions('KeyU'), ['fire_aam', 'help']);
});

test('atomic layout replacement rejects malformed layouts before any mutation or persistence', () => {
  const { input, writes } = fixture();
  const before = bindingSnapshot(input);
  const invalid = [];
  let candidate = structuredClone(before); delete candidate.gear; invalid.push(candidate);
  candidate = structuredClone(before); candidate.secret_action = []; invalid.push(candidate);
  candidate = structuredClone(before); candidate.gear = [['Escape']]; invalid.push(candidate);
  candidate = structuredClone(before); candidate.menu = []; invalid.push(candidate);
  candidate = structuredClone(before); candidate.menu = [['KeyU'], ['Escape']]; invalid.push(candidate);
  candidate = structuredClone(before); candidate.gear = [['KeyG'], ['KeyG']]; invalid.push(candidate);
  candidate = structuredClone(before); candidate.gear = [['ShiftLeft', 'AltLeft', 'KeyU'], ['AltLeft', 'ShiftLeft', 'KeyU']]; invalid.push(candidate);
  candidate = structuredClone(before); candidate.gear = [['KeyG'], ['KeyU'], ['KeyI'], ['KeyO'], ['KeyJ']]; invalid.push(candidate);
  candidate = structuredClone(before); candidate.throttle_up = [['WheelUp']]; invalid.push(candidate);
  candidate = structuredClone(before); candidate.gear = [new Array(1)]; invalid.push(candidate);
  candidate = structuredClone(before); candidate.gear = new Array(1); invalid.push(candidate);
  for (const value of [null, [], ...invalid]) {
    assert.equal(input.replaceBindings(value), false);
    assert.deepEqual(bindingSnapshot(input), before);
  }
  assert.equal(writes.length, 0);
});

test('layout replacement clones the input and clears queued input', () => {
  const { input } = fixture();
  const layout = bindingSnapshot(input);
  layout.gear = [['KeyU']];
  input.down.add('KeyW'); input.edge.add('fire_aam'); input.mouse.dx = 80;
  assert.equal(input.replaceBindings(layout), true);
  layout.gear[0][0] = 'KeyI';
  assert.deepEqual(input.actions.gear.binds, [['KeyU']]);
  assert.equal(input.down.size, 0); assert.equal(input.edge.size, 0); assert.equal(input.mouse.dx, 0);
});

test('undo remains available for live session changes when browser storage fails', () => {
  const { input, history } = fixture();
  globalThis.localStorage.setItem = () => { throw new Error('storage denied'); };
  assert.equal(history.change('change gear', () => input.setBinding('gear', 0, ['KeyU'])), true);
  assert.equal(input.storageAvailable, false);
  assert.equal(history.undo(), 'change gear');
  assert.deepEqual(input.actions.gear.binds, [['KeyG']]);
  assert.equal(input.storageAvailable, false);
});

test('missing essentials lists only actionable unbound essentials and updates after repair', () => {
  const { input } = fixture({ throttle_up: [], fire_mguns: [], gear: [], help: [] });
  assert.deepEqual(missingEssentialActions(input).map(([id]) => id), ['throttle_up', 'fire_mguns']);
  input.setBinding('fire_mguns', 0, ['KeyU']);
  assert.deepEqual(missingEssentialActions(input).map(([id]) => id), ['throttle_up']);
});

test('safe input test keeps a tapped action result after keyup while clearing held feedback', () => {
  const { input } = fixture();
  const nodes = Object.fromEntries(['#testKeys', '#testActions', '#testLastInput'].map(id => [id, {textContent:''}]));
  const menu = Object.create(ControlsMenu.prototype);
  Object.assign(menu, {input, testing:true, testDown:new Set(['Space']), lastTest:null, el:{querySelector:selector => nodes[selector]}});
  menu._updateTest('Space');
  assert.equal(nodes['#testLastInput'].textContent, 'Space → Launch missile');
  menu.testDown.clear(); menu._updateTest();
  assert.equal(nodes['#testLastInput'].textContent, 'Space → Launch missile');
  assert.equal(nodes['#testActions'].textContent, 'No keys held. Nothing fires or moves.');
  menu.testDown.add('KeyU'); menu._updateTest('KeyU');
  assert.equal(nodes['#testLastInput'].textContent, 'U → No action assigned');
});
