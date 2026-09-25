import test from 'node:test';
import assert from 'node:assert/strict';
import { Cockpit, flightContinuation } from '../src/game/cockpit.js';
import * as settings from '../src/game/settings.js';
import { markDone } from '../src/campaign/authored.js';
import { campaignProgress, operationSummary } from '../src/game/pilotlog.js';
import { PREFLIGHT_KEY } from '../src/game/flightplan.js';
import { freshSave, genMission, reduceCampaign, saveSave, loadSave } from '../src/campaign/engine.js';

function storage() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
  };
  settings.bindLive(null); settings.loadSettings();
  return data;
}

// Exercise the production menu methods without a renderer or browser. These
// sinks retain markup and callbacks; native <details> layout is browser QA.
class Node extends EventTarget {
  constructor() { super(); this.nodes = new Map(); this.children = []; this.innerHTML = ''; this.open = false; }
  setAttribute() {}
  append(child) { this.children.push(child); }
  focus() {}
  remove() {}
  querySelectorAll() { return []; }
  querySelector(selector) {
    const attr = selector.match(/^\[([^=\]]+)\]$/)?.[1];
    if (attr && !this.innerHTML.includes(attr)) return null;
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Node());
    return this.nodes.get(selector);
  }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
}

function harness({ reason = 'manual', practice = false, flags = '', over = 0, saved, inputSaved = true } = {}) {
  const dialogs = [];
  globalThis.document = { createElement: () => new Node(), body: { append: el => dialogs.push(el) } };
  const body = new Node(), el = new Node();
  const calls = { recover: 0, replay: 0, clear: 0, navigate: 0, reload: 0, destinations: [], confirmation: null };
  globalThis.location = { reload: () => { calls.navigate++; calls.reload++; }, assign: url => { calls.navigate++; calls.destinations.push(url); } };
  const cockpit = Object.assign(Object.create(Cockpit.prototype), {
    paused: true, reason, practice, flags: new URLSearchParams(flags),
    state: { tier: 'HIGH', match: over ? { over } : null, progressSaved: saved },
    controls: { open: false }, guide: { open: false }, log: { open: false },
    input: { storageAvailable: inputSaved, actions: {
      throttle_up: { binds: [['KeyW']] }, throttle_down: { binds: [['KeyS']] },
      recenter_aim: { binds: [['KeyR']] }, roll_left: { binds: [['KeyA']] }, roll_right: { binds: [['KeyD']] },
    } },
    pauseDialog: { body, el, open: false, show() { this.open = true; } },
    coach: { course: { status: 'complete', record: {}, elapsed: 12 }, replay() { calls.replay++; } },
    renderFlightBrief: () => '',
    recoverPractice() { calls.recover++; },
    pause() { this.paused = true; },
    confirmLeave(action, title, options) { calls.confirmation = { action, title, options }; },
  });
  return { cockpit, body, calls, dialogs };
}

test('campaign continuation follows the persisted next mission, never the current or an unsaved result', () => {
  storage();
  const flight = { flags: new URLSearchParams('sortie=N01'), match: { over: 1 }, progressSaved: false };
  assert.equal(campaignProgress().next.id, 'N01');
  assert.equal(flightContinuation(flight, campaignProgress().next).nextMission, null);
  markDone('N01'); flight.progressSaved = true;
  assert.equal(flightContinuation(flight, campaignProgress().next).nextMission.id, 'N02');
  for (const progressSaved of [false, undefined, null]) {
    assert.equal(flightContinuation({ ...flight, progressSaved }, campaignProgress().next).nextMission, null);
  }
  assert.equal(flightContinuation(flight, { id: 'N01', front: 'NELLIS' }).nextMission, null);
  assert.equal(flightContinuation({ ...flight, match: { over: -1 } }, campaignProgress().next).nextMission, null);
  assert.equal(flightContinuation(flight).nextMission, null);
});

test('a standalone direct link pauses for its named briefing before the mission starts', () => {
  storage();
  const h=harness({flags:'sortie=Y01&front=NEWYORK',reason:'scenario'});
  let reason;
  h.cockpit.pause=value=>{reason=value;};
  h.cockpit.onReady();
  assert.equal(reason,'scenario');
  h.cockpit.showPause();
  assert.equal(h.cockpit.pauseDialog.el.querySelector('h2').textContent,'Harbor Watch');
  assert.equal(h.cockpit.pauseDialog.el.querySelector('.eyebrow').textContent,'Alternate history · Standalone scenario');
  assert.match(h.body.innerHTML,/mission clock is paused/);
  assert.match(h.body.innerHTML,/Begin Harbor Watch/);
  assert.doesNotMatch(h.body.innerHTML,/Quick battle|data-next/);
});

test('standalone success and failure offer replay without campaign continuation or misleading progress copy', () => {
  for(const over of [1,-1]) {
    storage();
    const h=harness({flags:'sortie=Y01&front=NEWYORK',reason:'result',over,saved:over===1?true:undefined});
    h.cockpit.showPause();
    assert.match(h.body.innerHTML,/Replay Harbor Watch/);
    assert.match(h.body.innerHTML,/campaign progress is unchanged/);
    assert.doesNotMatch(h.body.innerHTML,/data-next|Complete its objectives to advance/);
    if(over<0)assert.match(h.body.innerHTML,/before any impact is depicted/);
    h.body.querySelector('[data-restart]').onclick();
    assert.equal(h.calls.confirmation.title,'Replay Harbor Watch?');
    assert.equal(h.calls.confirmation.options.label,'Replay Harbor Watch');
    h.calls.confirmation.action();
    assert.equal(h.calls.reload,1);
  }
});

test('operation continuation describes the next generated sortie only after the front is persisted', () => {
  storage();
  const before = freshSave('NELLIS'), mission = genMission(before);
  const after = reduceCampaign(before, mission, { over: 1, blueLeft: 20, redLeft: 0 });
  saveSave(after);
  const flight = { flags: new URLSearchParams('op=1&front=NELLIS'), match: { over: 1 }, progressSaved: true, operationStatus: operationSummary('NELLIS').status };
  const action = flightContinuation(flight);
  assert.equal(action.restartLabel, 'Continue operation');
  assert.match(action.consequence, /next sortie.*saved front line/);
  assert.equal(loadSave('NELLIS').sortieIndex, before.sortieIndex + 1);
  assert.notDeepEqual(genMission(loadSave('NELLIS')), mission);
  assert.equal(flightContinuation({ ...flight, match: { over: -1 } }).restartLabel, 'Continue operation', 'persisted losses also advance the operation');
  assert.equal(flightContinuation({ ...flight, match: { over: 0 } }).restartLabel, 'Restart this flight');
});

test('won and lost operations return to their preflight region without another sortie or replacing the saved result', () => {
  for (const [front, over, status] of [['NELLIS', 1, 'won'], ['VALDEZ', -1, 'lost']]) {
    storage();
    let save = freshSave(front);
    for (let i = 0; i < 100 && save.status === 'live'; i++) {
      save = reduceCampaign(save, genMission(save), { over, blueLeft: over === 1 ? 20 : 0, redLeft: over === 1 ? 0 : 20 });
    }
    assert.equal(save.status, status); saveSave(save);
    const key = 'raptor.op.v1:' + front, persisted = localStorage.getItem(key);
    localStorage.setItem(PREFLIGHT_KEY, JSON.stringify({ mode: 'practice', front: 'MARIANAS', time: 'golden' }));
    const h = harness({ reason: 'result', flags: 'op=1&front=' + front.toLowerCase(), over, saved: true });
    const decision = flightContinuation({ flags: h.cockpit.flags, match: { over }, progressSaved: true });
    assert.equal(decision.operationComplete, true);
    assert.equal(decision.restartLabel, 'Back to preflight');
    h.cockpit.showPause();
    assert.equal(h.cockpit.pauseDialog.el.querySelector('h2').textContent, 'Operation ' + status);
    assert.match(h.body.innerHTML, /data-restart>Back to preflight/);
    assert.doesNotMatch(h.body.innerHTML, /Continue operation|Retry operation sortie/);
    assert.match(h.body.innerHTML, /stays saved until you confirm its replacement/);
    h.body.querySelector('[data-restart]').onclick();
    assert.equal(h.calls.navigate, 0);
    assert.equal(h.calls.confirmation.title, 'Return to preflight?');
    h.calls.confirmation.action();
    assert.equal(h.calls.reload, 0); assert.deepEqual(h.calls.destinations, ['/']);
    assert.equal(localStorage.getItem(key), persisted, 'terminal save remains byte-for-byte unchanged');
    assert.deepEqual(JSON.parse(localStorage.getItem(PREFLIGHT_KEY)), { mode: 'operation', front, time: 'golden' });
    assert.equal(operationSummary(front).status, status, 'preflight will offer its existing confirmed Start new operation flow');
  }
});

test('an unsaved terminal result retries the last live front rather than claiming a saved operation completion', () => {
  storage();
  let save = freshSave('NELLIS'), terminal;
  while (save.status === 'live') {
    terminal = reduceCampaign(save, genMission(save), { over: 1, blueLeft: 20, redLeft: 0 });
    if (terminal.status !== 'live') break;
    save = terminal;
  }
  saveSave(save);
  assert.equal(terminal.status, 'won');
  localStorage.setItem = () => { throw Error('storage full'); };
  assert.throws(() => saveSave(terminal));
  const h = harness({ reason: 'result', flags: 'op=1', over: 1, saved: false });
  h.cockpit.showPause();
  assert.match(h.body.innerHTML, /Retry operation sortie/);
  assert.match(h.body.innerHTML, /This unsaved result will be lost/);
  assert.equal(operationSummary('NELLIS').status, 'live');
  assert.notEqual(h.cockpit.pauseDialog.el.querySelector('h2').textContent, 'Operation won');
  h.body.querySelector('[data-restart]').onclick();
  assert.equal(h.calls.navigate, 0);
  h.calls.confirmation.action();
  assert.equal(h.calls.reload, 1); assert.deepEqual(h.calls.destinations, []);
  assert.equal(loadSave('NELLIS').sortieIndex, save.sortieIndex);
});

test('failed operation save retries the old front and warns before navigation', () => {
  storage();
  const before = freshSave('NELLIS'); saveSave(before);
  const after = reduceCampaign(before, genMission(before), { over: -1, blueLeft: 0, redLeft: 20 });
  localStorage.setItem = () => { throw Error('storage full'); };
  assert.throws(() => saveSave(after));
  const h = harness({ reason: 'result', flags: 'op=1', over: -1, saved: false });
  h.cockpit.showPause();
  assert.match(h.body.innerHTML, /Retry operation sortie/);
  assert.match(h.body.innerHTML, /last saved front line.*unsaved result will be lost/);
  assert.doesNotMatch(h.body.innerHTML, /Continue operation|data-next/);
  h.body.querySelector('[data-restart]').onclick();
  assert.equal(h.calls.navigate, 0, 'reload waits for confirmation');
  assert.equal(h.calls.confirmation.title, 'Retry this operation sortie?');
  assert.equal(h.calls.confirmation.options.label, 'Retry operation sortie');
  assert.equal(loadSave('NELLIS').sortieIndex, before.sortieIndex);
  Cockpit.prototype.confirmLeave.call(h.cockpit, h.calls.confirmation.action, h.calls.confirmation.title, h.calls.confirmation.options);
  const confirmation = h.dialogs.at(-1).querySelector('.dialog-body');
  assert.match(confirmation.innerHTML, /Leaving will lose this result/);
  assert.match(confirmation.innerHTML, /last saved front line/);
  assert.equal(h.calls.navigate, 0);
  confirmation.querySelector('[data-confirm]').onclick();
  assert.equal(h.calls.navigate, 1);
});

test('welcome puts the primary action before collapsed setup and uses the selected pointing device', () => {
  storage(); settings.saveSettings({ pointingDevice: 'trackpad' });
  const h = harness({ reason: 'welcome', practice: true });
  h.cockpit.showPause();
  assert.match(h.body.innerHTML, /Slide one finger.*without clicking/);
  assert.match(h.body.innerHTML, /<kbd>W<\/kbd> \/ <kbd>S<\/kbd>/);
  assert.doesNotMatch(h.body.innerHTML, /pause-overview|data-school-start/);
  assert.ok(h.body.innerHTML.indexOf('data-resume') < h.body.innerHTML.indexOf('data-quick-tune'));
  assert.match(h.body.innerHTML, /<details class="pause-options" >/);
  assert.equal(h.body.querySelector('[data-quick-tune]').children[0].open, false);
});

test('new-pilot handoff restores coaching and reminders, resets the aircraft, and stays paused', () => {
  storage(); settings.saveSettings({ showChecklist: false, showHints: false });
  const h = harness({ practice: true });
  h.cockpit.showPause();
  assert.match(h.body.innerHTML, /New pilot\?/);
  assert.match(h.body.innerHTML, /data-school-start>Replay flight school/);
  assert.equal(h.body.innerHTML.match(/data-recover/g).length, 1);
  assert.ok(h.body.innerHTML.indexOf('data-recover') < h.body.innerHTML.indexOf('pause-options'));
  h.body.querySelector('[data-school-start]').dispatchEvent(new Event('click'));
  assert.equal(h.calls.recover, 1); assert.equal(h.calls.replay, 1);
  assert.equal(settings.current().showChecklist, true); assert.equal(settings.current().showHints, true);
  assert.equal(h.cockpit.paused, true); assert.equal(h.cockpit.reason, 'welcome');
  assert.match(h.body.innerHTML, /Start flying/);
});

test('practice reminders omit weapons and pause copy does not promise unavailable storage', () => {
  storage();
  const h = harness({ practice: true, inputSaved: false });
  h.cockpit.hints = new Node(); h.cockpit.renderHints();
  assert.match(h.cockpit.hints.innerHTML, /Throttle.*Roll.*Center aim/);
  assert.doesNotMatch(h.cockpit.hints.innerHTML, /Cannon|Missile/);
  h.cockpit.showPause();
  assert.match(h.body.innerHTML, /Some settings are available for this session only/);
  assert.doesNotMatch(h.body.innerHTML, /Controls and settings save in this browser/);
  h.cockpit.input.storageAvailable = true;
  h.cockpit.refreshSaveNote();
  assert.match(h.body.querySelector('[data-settings-save]').textContent, /save in this browser/);
  localStorage.setItem = () => { throw Error('storage full'); };
  settings.saveSettings({ mouseSensitivity: .8 });
  h.cockpit.refreshSaveNote();
  assert.match(h.body.querySelector('[data-settings-save]').textContent, /this session only/);
});

test('debrief buttons retain truthful continuation after visiting another menu', () => {
  storage(); markDone('N01');
  const campaign = harness({ reason: 'controls', flags: 'sortie=N01', over: 1, saved: true });
  campaign.cockpit.showPause();
  assert.match(campaign.body.innerHTML, /data-next>Fly next campaign mission/);
  assert.match(campaign.body.innerHTML, /Return to flight view/);
  campaign.body.querySelector('[data-next]').dispatchEvent(new Event('click'));
  assert.equal(campaign.calls.navigate, 1);
  const failed = harness({ flags: 'sortie=N01', over: 1, saved: false });
  failed.cockpit.showPause();
  assert.doesNotMatch(failed.body.innerHTML, /data-next|This result is saved/);
  assert.match(failed.body.innerHTML, /This result is not saved/);
  const operation = harness({ reason: 'controls', flags: 'op=1', over: -1, saved: true });
  operation.cockpit.showPause();
  assert.match(operation.body.innerHTML, /data-restart>Continue operation/);
  operation.body.querySelector('[data-restart]').onclick();
  assert.equal(operation.calls.navigate, 0);
  assert.equal(operation.calls.confirmation.options.label, 'Continue operation');
  assert.match(operation.calls.confirmation.options.detail, /next sortie/);
});
