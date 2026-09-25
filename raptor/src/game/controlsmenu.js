// Accessible flight setup. The same component works before engine boot and
// during a paused flight. Bindings save immediately; conflicts need a choice.
import { ACTIVE_ACTIONS, chordName, keyName } from "../engine/binds.js";
import { validChord, chordIdentity } from "../engine/input.js";
import { current, saveSettings, resetSettings, hasLive, storageAvailable, getAimOptions, getPalette } from "./settings.js";
import { TIERS, tierParams } from "../engine/quality.js";
import { BindingHistory, planActionRestore, missingEssentialActions } from "./controlhistory.js";

const MODS = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"]);
const CATEGORIES = { essentials: "Start here", missing: "Needs a key", all: "All controls", flight: "Flying", weapons: "Weapons", systems: "Aircraft", interface: "Interface" };
const TABS = { controls: "Controls", display: "Display", audio: "Audio", accessibility: "Accessibility" };
const KEYBOARD_ROWS = [
  ["Escape", "Backquote", ..."1234567890".split("").map(n => "Digit" + n), "Minus", "Equal"],
  [..."QWERTYUIOP"].map(key => "Key" + key),
  [..."ASDFGHJKL"].map(key => "Key" + key),
  [..."ZXCVBNM"].map(key => "Key" + key),
  ["ControlLeft", "AltLeft", "MetaLeft", "Space", "MetaRight", "AltRight", "ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight"],
];
const POINTER_CODES = ["Mouse0", "Mouse1", "Mouse2", "WheelUp", "WheelDown"];
const SHORT_ACTIONS = { throttle_up: "THR +", throttle_down: "THR −", roll_left: "BANK L", roll_right: "BANK R", pitch_up: "NOSE ↑", pitch_down: "NOSE ↓", yaw_left: "YAW L", yaw_right: "YAW R", fire_mguns: "CANNON", fire_aam: "MISSILE", gear: "GEAR", wheel_brakes: "BRAKE", menu: "PAUSE", game_pause: "PAUSE", help: "GUIDE", recenter_aim: "CENTER", hide_hud: "HUD", debug: "DETAILS" };
const compactKey = code => ({ ControlLeft: "ctrl", AltLeft: "⌥", AltRight: "⌥", MetaLeft: "⌘", MetaRight: "⌘", Mouse0: "Left click", Mouse1: "Middle", Mouse2: "Right click" }[code] || keyName(code));

// A preset is a starting point for one device, never a separate saved state.
// Derive its name from the actual gain so slider edits cannot leave a stale badge.
export function aimPresetState(settings) {
  const trackpad = settings.pointingDevice === "trackpad";
  const key = trackpad ? "trackpadSensitivity" : "mouseSensitivity";
  const presets = [
    { id: "precise", label: "Precise", note: "Finer corrections", value: trackpad ? 0.45 : 0.65 },
    { id: "balanced", label: "Balanced", note: "A good starting point", value: trackpad ? 0.65 : 1 },
    { id: "responsive", label: "Responsive", note: "Turn with less travel", value: trackpad ? 1 : 1.4 },
  ];
  const selected = presets.find(preset => Math.abs(preset.value - settings[key]) < 0.0001);
  return { key, presets, selected: selected?.id || "custom", label: selected?.label || "Custom", value: settings[key] };
}

// Index by trigger, not every member of a chord. Option + Z belongs on Z;
// clicking that key still exposes the complete chord and all shared actions.
export function mappedControls(actions) {
  const inputs = new Map();
  for (const [id, action] of Object.entries(actions)) {
    action.binds.forEach((chord, slot) => {
      const code = chord.at(-1);
      if (!inputs.has(code)) inputs.set(code, []);
      inputs.get(code).push({ id, slot, chord, label: action.label, locked: action.lockedPrimary && slot === 0 });
    });
  }
  return inputs;
}
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nice = (chord) => esc(chordName(chord));
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), summary, [tabindex="0"]';
const valueLabel = (key, value) => key === "fov" ? Math.round(value) + "°"
  : ["renderScale", "hudScale", "subtitleScale", "mouseSensitivity", "trackpadSensitivity", "gamepadSensitivity"].includes(key) ? Number(value).toFixed(2).replace(/0$/, "") + "×"
    : Math.round(value * 100) + "%";

export class ControlsMenu {
  constructor(input, { onShow, onClose } = {}) {
    this.input = input;
    this.onShow = onShow;
    this.onClose = onClose;
    this.open = false;
    this.tab = "controls";
    this.category = "essentials";
    this.query = "";
    this.selectedCode = "KeyW";
    this.layoutOpen = true;
    this.capturing = null;
    this.pending = null;
    this.confirming = null;
    this.restoring = null;
    this.history = new BindingHistory(input);
    this.lastTest = null;
    this.testing = false;
    this.testDown = new Set();
    this._heldMods = [];
    this.notice = "";
    if (!document.querySelector('link[data-raptor-controls]')) {
      const style = document.createElement("link");
      style.rel = "stylesheet"; style.href = new URL("./controls.css", import.meta.url).href;
      style.dataset.raptorControls = ""; document.head.appendChild(style);
    }
    // Native modal semantics keep the background out of keyboard navigation
    // and the accessibility tree, including content added while setup is open.
    this.el = document.createElement("dialog");
    this.el.id = "controls";
    this.el.className = "flight-setup";
    this.el.hidden = true;
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-modal", "true");
    this.el.setAttribute("aria-labelledby", "setupTitle");
    document.body.appendChild(this.el);
    this._keyDown = (event) => this._onKey(event);
    this._keyUp = (event) => this._onKeyUp(event);
    this._mouseDown = (event) => this._onMouse(event);
    this._mouseUp = (event) => {
      if (!this.open) return;
      event.stopPropagation();
      if (this.testing) { this.testDown.delete("Mouse" + event.button); this._updateTest(); }
    };
    this._wheel = (event) => this._onWheel(event);
    this._blur = () => {
      this._heldMods = []; this.testDown.clear();
      this._cancelAimHold?.();
      if (this.capturing) this._cancelCapture("Binding canceled because the window lost focus.");
      this._updateTest();
    };
    window.addEventListener("keydown", this._keyDown, true);
    window.addEventListener("keyup", this._keyUp, true);
    window.addEventListener("mousedown", this._mouseDown, true);
    window.addEventListener("mouseup", this._mouseUp, true);
    window.addEventListener("wheel", this._wheel, { capture: true, passive: false });
    window.addEventListener("blur", this._blur);
    this.el.addEventListener("contextmenu", (event) => event.preventDefault());
    this._render();
  }

  toggle() { this.open ? this.close() : this.show(); }
  show(section = "controls") {
    this.tab = section === "settings" ? "display" : (TABS[section] ? section : "controls");
    if (!this.open) {
      this._returnFocus = document.activeElement;
      this._previousSuspended = this.input.suspended;
      this.open = true;
      this.input.suspended = true;
      this.onShow?.(this.tab);
      this._statusInterval = setInterval(() => this._updateController(), 500);
    }
    this.el.hidden = false;
    this.el.classList.add("open");
    if (!this.el.open) this.el.showModal();
    this._render();
    this.el.querySelector(`[data-tab="${this.tab}"]`)?.focus();
  }
  close() {
    if (!this.open) return;
    this.open = false; this.capturing = this.pending = this.confirming = this.restoring = null;
    this.lastTest = null;
    this.testing = false; this.testDown.clear(); this._heldMods = [];
    this._cancelAimHold?.();
    clearInterval(this._statusInterval);
    this.input.clear();
    this.input.suspended = this._previousSuspended;
    this.el.close();
    this.el.hidden = true; this.el.classList.remove("open");
    this.onClose?.();
    if (this._returnFocus?.isConnected) this._returnFocus.focus({ preventScroll: true });
  }

  _onKey(event) {
    if (!this.open) return;
    event.stopPropagation();
    if (event.code === "Escape") {
      event.preventDefault();
      if (this.capturing || this.pending) this._cancelCapture("Binding unchanged.");
      else if (this.restoring) this._cancelRestore();
      else if (this.confirming) { this.confirming = null; this._render(); }
      else if (this.testing) { this.testing = false; this.testDown.clear(); this._render("test-controls"); }
      else this.close();
      return;
    }
    if (this.capturing && !this.pending) {
      event.preventDefault();
      if (event.repeat) return;
      if (MODS.has(event.code)) {
        if (!this._heldMods.includes(event.code)) this._heldMods.push(event.code);
        this._updateCapture();
      } else this._offer([...this._heldMods, event.code]);
      return;
    }
    if (this.testing && this.el.querySelector(".input-test") === document.activeElement) {
      if (event.code === "Tab") { this.testDown.clear(); this._updateTest(); }
      else {
        event.preventDefault(); this.testDown.add(event.code); this._updateTest(event.code); return;
      }
    }
    if (event.key === "Tab") this._trapFocus(event);
  }
  _onKeyUp(event) {
    if (!this.open) return;
    event.stopPropagation();
    if (this.capturing && !this.pending && MODS.has(event.code)) {
      event.preventDefault();
      // Modifier-only chords (for example the older Ctrl + Alt missile key)
      // complete on release, so the last pressed modifier remains the trigger.
      const chord = [...this._heldMods];
      this._heldMods = this._heldMods.filter((code) => code !== event.code);
      if (chord.length) this._offer(chord);
    }
    if (this.testing) { this.testDown.delete(event.code); this._updateTest(); }
  }
  _onMouse(event) {
    if (!this.open) return;
    if (this.capturing && !this.pending && !event.target.closest?.("[data-capture-control]")) {
      event.stopPropagation(); event.preventDefault(); this._offer([...this._heldMods, "Mouse" + event.button]);
    } else if (this.testing && event.target.closest?.(".input-test") && !event.target.closest?.("button")) {
      event.stopPropagation(); event.preventDefault();
      this.el.querySelector(".input-test").focus();
      const code = "Mouse" + event.button; this.testDown.add(code); this._updateTest(code);
    }
  }
  _onWheel(event) {
    if (!this.open || !event.deltaY) return;
    if (this.capturing && !this.pending) {
      event.stopPropagation(); event.preventDefault();
      this._offer([...this._heldMods, event.deltaY < 0 ? "WheelUp" : "WheelDown"]);
    } else if (this.testing && event.target.closest?.(".input-test")) {
      event.stopPropagation(); event.preventDefault();
      const code = event.deltaY < 0 ? "WheelUp" : "WheelDown";
      this.testDown.add(code); this._updateTest(code);
      clearTimeout(this._testWheelTimeout);
      this._testWheelTimeout = setTimeout(() => { this.testDown.delete(code); this._updateTest(); }, 500);
    }
  }
  _trapFocus(event) {
    const scope = this.el.querySelector(".setup-modal") || this.el;
    const elements = [...scope.querySelectorAll(FOCUSABLE)].filter((element) => element.getClientRects().length);
    if (!elements.length) return;
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  }

  _beginCapture(id, slot, returnFocus = "") {
    this.capturing = { id, slot }; this.pending = null; this.testing = false;
    this.captureReturnFocus = returnFocus; this.testDown.clear();
    this._heldMods = []; this.captureError = "";
    this._render();
  }
  _cancelCapture(message) {
    const focus = this.captureReturnFocus || (this.capturing ? `bind-${this.capturing.id}-${this.capturing.slot}` : "");
    this.capturing = this.pending = null; this._heldMods = [];
    this.notice = message; this._render(focus);
  }
  _offer(chord) {
    if (!this.capturing || !validChord(chord)) return;
    const { id, slot } = this.capturing, action = this.input.actions[id];
    if (action.hold && chord.some((code) => code.startsWith("Wheel"))) {
      this.captureError = "This action needs a held key or mouse button. The wheel works for single-press actions such as launching a missile.";
      this._heldMods = []; this._updateCapture(); return;
    }
    if (action.binds.some((existing, index) => index !== slot && chordIdentity(existing) === chordIdentity(chord))) {
      this.captureError = "This action already uses that binding. Choose a different key or cancel.";
      this._heldMods = []; this._updateCapture(); return;
    }
    const conflicts = this.input.findConflicts(id, chord);
    if (conflicts.length) { this.pending = { chord, conflicts }; this._render(); }
    else this._commit(chord);
  }
  _commit(chord, resolve = "reject") {
    const { id, slot } = this.capturing;
    if (this.history.change(`change ${this.input.actions[id].label}`, () => this.input.setBinding(id, slot, chord, { resolve }))) {
      this.notice = `${this.input.actions[id].label} → ${chordName(chord)}. ${this.input.storageAvailable ? "Saved on this browser." : "Session only. This binding resets when you launch or reload."}`;
      if (this.captureReturnFocus) this.selectedCode = chord.at(-1);
      this.capturing = this.pending = null; this._heldMods = []; this._render(this.captureReturnFocus ? `map-edit-${id}-${slot}` : `bind-${id}-${slot}`);
    }
  }
  showMissingControls() {
    this.show("controls");
    this._showMissing();
  }
  _showMissing() {
    this.tab = "controls"; this.category = "missing"; this.query = ""; this.testing = false;
    this._render("category-missing");
    const first = this.el.querySelector("[data-bind]");
    first?.scrollIntoView({block:"center"}); first?.focus({preventScroll:true});
  }
  _beginRestore(id) {
    const plan = planActionRestore(this.input, id);
    if (!plan) return;
    if (plan.conflicts.length) { this.restoring = plan; this._render(); }
    else this._restoreAction(plan);
  }
  _cancelRestore() {
    const id = this.restoring?.id;
    this.restoring = null; this.notice = "Control keys unchanged.";
    this._render(`restore-${id}`);
  }
  _restoreAction(plan) {
    // Re-plan at confirmation time: never apply an old snapshot over a layout
    // changed elsewhere while the confirmation was open.
    const fresh = planActionRestore(this.input, plan.id);
    if (!fresh) return;
    const signature = conflicts => conflicts.map(({id, chord}) => `${id}:${chordIdentity(chord)}`).sort().join("|");
    if (signature(fresh.conflicts) !== signature(plan.conflicts)) { this.restoring = fresh; this._render(); return; }
    const label = this.input.actions[plan.id].label;
    if (this.history.change(`restore ${label}`, () => this.input.replaceBindings(fresh.layout))) {
      this.restoring = null;
      this.notice = `${label}: default keys restored. ${this.input.storageAvailable ? "Undo is available below." : "Session only; browser storage is unavailable."}`;
      this._render(this.category === "missing" ? "category-missing" : `bind-${plan.id}-0`);
    }
  }
  _updateCapture() {
    const keys = this.el.querySelector("#captureKeys"), message = this.el.querySelector("#captureFeedback");
    if (keys) keys.textContent = this._heldMods.length ? chordName(this._heldMods) + " + …" : "Press a key";
    if (message) message.textContent = this.captureError || "You can also click a mouse button or turn the wheel. Escape cancels.";
  }

  _slider(key, label, description, min, max, step, value) {
    return `<label class="setup-setting" for="setup-${key}"><span><strong>${label}</strong><small>${description}</small></span><span class="setup-range"><input id="setup-${key}" data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output for="setup-${key}" id="value-${key}">${valueLabel(key, value)}</output></span></label>`;
  }
  _toggle(key, label, description, value) {
    return `<label class="setup-setting setup-toggle" for="setup-${key}"><span><strong>${label}</strong><small>${description}</small></span><input id="setup-${key}" data-setting="${key}" type="checkbox" ${value ? "checked" : ""}><span class="toggle-track" aria-hidden="true"></span></label>`;
  }
  _aimPresetsHtml() {
    const state = aimPresetState(current());
    return `<div class="aim-presets"><div class="aim-preset-heading"><strong>Start with a feel</strong><output data-aim-preset-status aria-live="polite">${state.label} · ${valueLabel(state.key, state.value)}</output></div><div class="aim-preset-options" role="group" aria-label="Aiming sensitivity presets">${state.presets.map(preset => `<button type="button" data-aim-preset="${preset.id}" aria-pressed="${state.selected === preset.id}"><strong>${preset.label}</strong><small>${preset.note}</small><span>${valueLabel(state.key, preset.value)}</span></button>`).join("")}</div></div>`;
  }
  _updateAimPresets() {
    const state = aimPresetState(current());
    this.el.querySelectorAll("[data-aim-preset]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.aimPreset === state.selected)));
    const output = this.el.querySelector("[data-aim-preset-status]");
    if (output) output.textContent = `${state.label} · ${valueLabel(state.key, state.value)}`;
  }
  _layoutInspectorHtml() {
    const entries = mappedControls(this.input.actions).get(this.selectedCode) || [];
    if (!entries.length) return `<div class="layout-empty">Choose a lit key to see its action and change its binding. Every tile reflects your saved setup.</div>`;
    return `<div class="layout-inspector-title"><strong>${esc(keyName(this.selectedCode))}</strong><span>${entries.length > 1 ? "All bindings using this trigger" : "Your current binding"}</span></div>${entries.map((entry, index) => `<div class="layout-action"><div><strong>${esc(entry.label)}</strong><span>${nice(entry.chord)}${entry.chord.length > 1 ? " · hold the full shortcut" : ""}</span></div>${entry.locked ? '<span class="layout-fixed">Always available</span>' : `<button type="button" class="setup-button" data-layout-edit="${entry.id}" data-slot="${entry.slot}" data-focus="map-edit-${entry.id}-${entry.slot}">Change key</button>`}${this.input.actions[entry.id].binds.length < 4 && entries.findIndex(item => item.id === entry.id) === index ? `<button type="button" class="setup-text-button" data-layout-add="${entry.id}" data-focus="map-add-${entry.id}" aria-label="Add an alternate key for ${esc(entry.label)}">+ Add key</button>` : ""}</div>`).join("")}<p class="layout-inspector-note">Add a key to keep the current binding. Your last key change can always be undone below.</p><button type="button" class="setup-text-button" data-action="all-keys">Search all actions ↓</button>`;
  }
  _keyboardHtml() {
    const mapped = mappedControls(this.input.actions);
    const key = (code, extra = false) => {
      const entries = mapped.get(code) || [];
      const labels = [...new Set(entries.map(entry => entry.label))];
      const action = entries[0]?.id;
      const category = action ? this.input.actions[action].cat : "";
      const caption = labels.length > 1 ? `${labels.length} ACTIONS` : SHORT_ACTIONS[action] || "";
      const label = extra ? keyName(code) : compactKey(code);
      const modifier = part => /^Control/.test(part) ? "⌃" : /^Alt/.test(part) ? "⌥" : /^Meta/.test(part) ? "⌘" : /^Shift/.test(part) ? "⇧" : compactKey(part);
      const displayLabel = entries.length === 1 && entries[0].chord.length > 1 ? `${entries[0].chord.slice(0, -1).map(modifier).join("")} + ${label}` : label;
      const attrs = `class="layout-key ${category ? `key-${category}` : "key-unused"}${code === "Space" ? " key-space" : ""}${extra ? " key-extra" : ""}"`;
      return entries.length ? `<button type="button" ${attrs} data-map-key="${code}" data-focus="map-${code}" aria-pressed="${code === this.selectedCode}" aria-label="${esc(keyName(code))}: ${esc(entries.map(entry => `${entry.label}${entry.chord.length > 1 ? ` (${chordName(entry.chord)})` : ""}`).join("; "))}. ${entries.every(entry => entry.locked) ? "Always available." : "Configure this key."}"><strong>${esc(displayLabel)}</strong><small>${esc(caption)}</small></button>` : `<span ${attrs} aria-hidden="true"><strong>${esc(label)}</strong></span>`;
    };
    const shown = new Set([...KEYBOARD_ROWS.flat(), ...POINTER_CODES]);
    const extras = [...mapped.keys()].filter(code => !shown.has(code));
    return `<details class="keyboard-layout" ${this.layoutOpen ? "open" : ""}><summary><span><strong>Your keyboard & pointer map</strong><small>Choose a lit key to change its action</small></span><span class="layout-legend" aria-hidden="true"><i></i> Controls <i></i> Weapons</span></summary><div class="keyboard-body"><div class="keyboard-rows" aria-label="Current keyboard bindings, QWERTY positions">${KEYBOARD_ROWS.map((row, index) => `<div class="keyboard-row keyboard-row-${index}">${row.map(code => key(code)).join("")}</div>`).join("")}</div><div class="pointer-map"><div class="pointer-map-title"><strong>${current().pointingDevice === "trackpad" ? "Trackpad or mouse movement" : "Mouse or trackpad movement"}</strong><span>Aim the nose · no click needed</span></div><div class="pointer-buttons" aria-label="Current mouse and wheel bindings">${POINTER_CODES.map(code => key(code)).join("")}</div></div>${extras.length ? `<div class="layout-extra"><span>Additional inputs</span>${extras.map(code => key(code, true)).join("")}</div>` : ""}<p class="layout-reference">QWERTY key positions · ⌥ Option · ⌃ Control · ⇧ Shift · ⌘ Command. Select a key for its complete shortcut.</p><section class="layout-inspector" aria-label="Selected control">${this._layoutInspectorHtml()}</section></div></details>`;
  }
  _controlsHtml() {
    const settings = current();
    const trackpad = settings.pointingDevice === "trackpad";
    const gain = trackpad ? "trackpadSensitivity" : "mouseSensitivity";
    return `<div class="setup-controls-top"><div class="setup-intro"><span class="setup-kicker">YOUR AIRCRAFT. YOUR CONTROLS.</span><h2>A few keys. The whole sky.</h2><p>Aim with a mouse or one finger on your trackpad. Your keyboard handles the rest.</p></div><div class="setup-controls-actions"><button class="setup-button" data-action="keys">Edit keys <span aria-hidden="true">↓</span></button><button class="setup-button" data-focus="test-controls" data-action="test">${this.testing ? "Finish testing" : "Test your controls"}<span aria-hidden="true">↗</span></button></div></div>
      <section class="setup-device" aria-label="Aiming setup"><div class="device-heading"><strong>Choose your aiming feel</strong><span>Each sensitivity saves separately. Your keys stay the same.</span></div><div class="device-options" role="group" aria-label="Pointing device">${[["mouse", "Mouse + keyboard", "Full-range aiming · click or use a key to fire"], ["trackpad", "MacBook trackpad + keyboard", "Gentler aiming · steer without clicking or dragging"]].map(([id,title,note]) => `<button type="button" data-device="${id}" data-focus="device-${id}" aria-pressed="${settings.pointingDevice === id}"><span class="device-check" aria-hidden="true">${settings.pointingDevice === id ? "✓" : "○"}</span><span><strong>${title}</strong><small>${note}</small></span></button>`).join("")}</div><p class="device-note">${trackpad ? "Slide one finger to steer; lift and reposition between strokes. Use a keyboard binding for cannon fire. Two fingers scroll menus." : "Move the mouse to steer. Use your cannon binding to fire; add a mouse button or keyboard alternate below."} Both devices work in either profile; switch here to use their saved sensitivity.</p></section>
      ${this._aimPresetsHtml()}<div class="setup-mouse-card">${this._slider(gain, trackpad ? "Trackpad sensitivity" : "Mouse sensitivity", "Fine-tune your feel. Your other device keeps its own setting.", 0.35, 2, 0.05, settings[gain])}${this._toggle("invertY", "Invert vertical aim", "Move up to aim the nose down.", settings.invertY)}</div>
      ${this.testing ? `<div class="input-test" tabindex="0" role="group" aria-label="Controls test area. Move your pointer, press keys or click here. Escape ends the test."><div class="test-heading"><span class="setup-kicker">SAFE INPUT TEST</span><span>Flight stays paused · Esc to finish</span><button type="button" class="setup-text-button" data-test-recenter>Center preview</button></div><div class="aim-test-surface" aria-label="Aim preview"><span class="aim-test-center" aria-hidden="true"></span><span class="aim-test-target" hidden aria-hidden="true"></span><span class="aim-test-dot" aria-hidden="true"></span><output class="aim-test-reading">Move here to try your sensitivity</output></div><div class="aim-exercise"><output data-aim-exercise-status aria-live="polite">Want to check your feel? Gently follow five targets.</output><button type="button" class="setup-button" data-test-targets>Try aim targets</button></div><strong id="testKeys">Press a key or mouse button</strong><p id="testActions">See which action your input triggers. Nothing fires or moves.</p><div class="test-last-input"><span>LAST INPUT</span><output id="testLastInput" aria-live="polite">Tap a key to keep its result here.</output></div></div>` : ""}
      <details class="setup-controller-options"><summary>Controller aiming</summary>${this._slider("gamepadSensitivity", "Right-stick sensitivity", "Independent of mouse and trackpad aiming. Vertical inversion applies to all devices.", 0.35, 2, 0.05, settings.gamepadSensitivity)}</details>
      ${this._keyboardHtml()}
      <div class="setup-binding-layout"><aside class="setup-categories" aria-label="Control categories">${Object.entries(CATEGORIES).map(([id, label]) => `<button data-category="${id}" data-focus="category-${id}" class="${this.category === id ? "selected" : ""}" aria-pressed="${this.category === id}">${label}<span>${this._categoryCount(id)}</span></button>`).join("")}<div class="controller-card"><span class="controller-light"></span><strong id="controllerTitle">Keyboard & mouse ready</strong><small id="controllerDetail">Connect a standard controller and press a button to detect it.</small></div><button class="setup-text-button" data-action="reset-binds">Restore default keys</button></aside>
      <section class="setup-bindings"><div class="bindings-toolbar"><label class="setup-search"><span aria-hidden="true">⌕</span><input id="controlSearch" type="search" value="${esc(this.query)}" placeholder="Find an action or key…" aria-label="Search control actions or keys"></label><span id="bindingCount"></span></div><div id="bindingRows">${this._rowsHtml()}</div><p class="bindings-help">Click a key to change it. <strong>+ Add key</strong> keeps your current binding. Escape always opens the flight menu.</p></section></div>`;
  }
  _matchesCategory(category, action) {
    return category === "all" || (category === "missing" ? action.essential && !action.binds.length
      : category === "essentials" ? action.essential
        : category === "interface" ? ["interface", "raptor", "view"].includes(action.cat) : action.cat === category);
  }
  _categoryCount(category) { return Object.values(this.input.actions).filter(action => this._matchesCategory(category, action)).length; }
  _visibleActions() {
    const query = this.query.toLowerCase().trim();
    return Object.entries(this.input.actions).filter(([id, action]) => {
      const category = this._matchesCategory(this.category, action);
      const match = `${id} ${action.label} ${action.description} ${action.binds.map(chordName).join(" ")}`.toLowerCase().includes(query);
      // A search reaches every implemented action, regardless of category.
      return query ? match : category;
    });
  }
  _rowsHtml() {
    const actions = this._visibleActions();
    if (!actions.length) return this.category === "missing" && !this.query.trim() ? `<div class="setup-empty"><strong>Every essential action has a key.</strong><p>Your keyboard layout is ready. Choose Start here to review the essentials.</p></div>` : `<div class="setup-empty"><strong>No controls found.</strong><p>Try “throttle”, “missile”, or a key such as “Space”.</p></div>`;
    return actions.map(([id, action]) => {
      const conflicts = action.binds.flatMap((chord) => this.input.findConflicts(id, chord));
      const status = !action.binds.length ? `<span class="binding-badge missing">Unbound</span>` : conflicts.length ? `<span class="binding-badge shared">Shared key</span>` : this.input.customized(id) ? `<span class="binding-badge">Custom</span>` : "";
      return `<div class="binding-row${!action.binds.length ? " unbound" : ""}" data-action-id="${id}"><div class="binding-label"><strong>${esc(action.label)} ${status}</strong><p>${esc(action.description)}</p><span class="binding-mode">${action.hold ? "HOLD" : "PRESS"}</span>${this.input.customized(id) ? `<button type="button" class="setup-text-button binding-restore" data-restore-action="${id}" data-focus="restore-${id}" aria-label="Restore default keys for ${esc(action.label)}">Restore action</button>` : ""}</div><div class="binding-keys">${action.binds.map((chord, slot) => `<div class="binding-slot"><button class="binding-key" data-bind="${id}" data-slot="${slot}" data-focus="bind-${id}-${slot}" ${action.lockedPrimary && slot === 0 ? "disabled" : ""} aria-label="${esc(action.label)}: ${nice(chord)}. ${slot === 0 ? "Primary" : "Alternate"} key${action.lockedPrimary && slot === 0 ? ", always available" : ", change binding"}."><span>${nice(chord)}</span>${slot === 0 ? `<small>${action.lockedPrimary ? "always available" : "primary"}</small>` : ""}</button>${action.lockedPrimary && slot === 0 ? "" : `<button class="binding-remove" data-remove="${id}" data-slot="${slot}" aria-label="Remove ${nice(chord)} from ${esc(action.label)}" title="Remove this binding">×</button>`}</div>`).join("")}${action.binds.length < 4 ? `<button class="binding-add" data-bind="${id}" data-slot="${action.binds.length}" data-focus="bind-${id}-${action.binds.length}" aria-label="Add a key for ${esc(action.label)}">+ Add key</button>` : ""}</div></div>`;
    }).join("");
  }
  _graphicsStatusHtml() {
    const state=window.__RAPTOR, options=current();
    if(!state?.ready)return '';
    const next=options.tier==='AUTO'?(state.recommendedTier||state.tier):options.tier;
    // Live render controls can match the selection while fixed boot assets do not.
    const needsRestart=next!==state.tier || state.assetReloadRequired===true;
    const persisted=storageAvailable();
    const title=needsRestart ? 'Full graphics detail needs a new flight' : `${esc(state.tier)} is running`;
    const note=needsRestart ? (persisted ? 'Restart applies the full preset. Your unfinished flight will start over.' : 'Browser storage is unavailable, so a new flight may use your previous graphics settings.') : 'Field of view and resolution appear when you resume.';
    return `<div class="graphics-status" role="status"><div><strong>${title}</strong><p>${note}${options.tier==='AUTO'&&state.recommendedTier ? ` Auto measured this scene and recommends ${esc(state.recommendedTier)}.` : ''}</p></div>${needsRestart&&persisted ? '<button type="button" class="setup-button" data-review-restart>Review restart ↗</button>' : ''}</div>`;
  }
  _instrumentPreviewHtml() {
    const s=current(), palette=getPalette();
    return `<figure class="instrument-preview" aria-label="Example instrument size and target colors"><div class="instrument-sample" style="--instrument-scale:${s.hudScale};--radio-scale:${s.subtitleScale}"><div class="sample-readouts"><span>420 <small>KT</small></span><span>090°</span><span>12,500 <small>FT</small></span></div><div class="sample-targets"><span style="color:${palette.friendly}">◇ Friendly</span><span style="color:${palette.enemy}">△ Enemy</span><span style="color:${palette.lock}">◎ Locked</span></div><p class="sample-radio">Control: clear skies ahead.</p></div><figcaption>Size & color preview · example readings</figcaption></figure>`;
  }
  _updateInstrumentPreview() {
    const sample=this.el.querySelector('.instrument-sample');
    if(sample){sample.style.setProperty('--instrument-scale',current().hudScale);sample.style.setProperty('--radio-scale',current().subtitleScale);}
  }
  _settingsHtml() {
    const settings = current(), boot = window.__RAPTOR?.tier;
    if (this.tab === "display") {
      const resolution = settings.renderScale ?? tierParams(settings.tier === "AUTO" ? boot || "MED" : settings.tier).renderScale;
      return `<div class="setup-section-heading"><span class="setup-kicker">A CLEARER VIEW</span><h2>Find your smooth spot.</h2><p>Start with Auto. Lower render resolution first if your flight feels slow.</p></div><section class="setup-settings-card"><div class="quality-heading"><div><strong>Graphics quality</strong><p>Resolution, terrain detail and shadow rendering adjust now. A new flight applies loaded detail and shadow-map resolution.</p></div><span class="setup-badge">${boot ? `Running ${esc(boot)}` : "Applies on launch"}</span></div><div class="quality-options">${["AUTO", ...Object.keys(TIERS)].map((tier) => `<button data-quality="${tier}" data-focus="quality-${tier}" aria-pressed="${settings.tier === tier}" class="${settings.tier === tier ? "selected" : ""}"><strong>${tier === "MED" ? "Medium" : tier[0] + tier.slice(1).toLowerCase()}</strong><small>${{ AUTO: "Recommended", LOW: "Fastest flight", MED: "Balanced", HIGH: "Rich detail", ULTRA: "Maximum detail" }[tier]}</small></button>`).join("")}</div>${this._graphicsStatusHtml()}${this._slider("renderScale", "Render resolution", "Lower uses fewer pixels. Flight instruments remain crisp.", 0.5, 1.5, 0.05, resolution)}${this._slider("fov", "Field of view", "Wider shows more sky; narrower brings targets closer. See the view when you resume.", 45, 90, 1, settings.fov)}${this._toggle("showFps", "Frame rate", "Show a small FPS readout while flying.", settings.showFps)}</section>`;
    }
    if (this.tab === "audio") return `<div class="setup-section-heading"><span class="setup-kicker">HEAR WHAT MATTERS</span><h2>Your cockpit mix.</h2><p>Keep warning tones clear, tune the engine roar, and choose whether radio messages are spoken.</p></div><section class="setup-settings-card">${this._toggle("muted", "Mute all audio", "Engine, weapons, warning tones and spoken radio. Menus stay quiet; resume to hear your changes.", settings.muted)}${this._slider("masterVol", "Master volume", "The volume of all game audio.", 0, 1, 0.05, settings.masterVol)}${this._slider("engineVol", "Engine", "Jet engine, airflow, airframe and nearby aircraft.", 0, 1, 0.05, settings.engineVol)}${this._slider("weaponsVol", "Weapons & effects", "Cannon, missiles, explosions and airframe strikes.", 0, 1, 0.05, settings.weaponsVol)}${this._slider("uiVol", "Warnings & radio", "Missile lock tones, launch warnings, and spoken radio.", 0, 1, 0.05, settings.uiVol)}${this._toggle("voice", "Spoken radio", "Uses a voice available in your browser. Radio text remains visible.", settings.voice)}</section><p class="setup-footnote" data-audio-storage>${this._audioStorageNote()}</p>`;
    return `<div class="setup-section-heading"><span class="setup-kicker">BUILT AROUND YOU</span><h2>Make the sky easier to read.</h2><p>Reduce visual noise, make instruments larger, and keep the information you need.</p></div>${this._instrumentPreviewHtml()}<section class="setup-settings-card">${this._slider("hudScale", "Flight instruments", "Scale key HUD readings for comfortable viewing.", 0.8, 1.4, 0.05, settings.hudScale ?? 1)}${this._slider("subtitleScale", "Radio text size", "Make incoming radio messages easier to read.", 0.8, 1.6, 0.1, settings.subtitleScale)}${this._toggle("showHints", "Control reminders", "Show a compact reminder of your current keys in flight.", settings.showHints !== false)}${this._toggle("showChecklist", "Flight coach", "Keep flight school guidance separate from your key reminders.", settings.showChecklist)}${this._toggle("motionReduce", "Reduce combat flashes", "Hide hit flashes and cannon muzzle flashes while flying.", settings.motionReduce)}<div class="setup-setting palette-setting"><span><strong>Target colors</strong><small>Preview friendly, enemy, and locked targets below.</small></span><div class="palette-options">${[["default", "Standard", "#7fb4e8", "#ff8a5c", "#ffd27a"], ["deuteranopia", "Red / green support", "#4fa8ff", "#ffa03c", "#fff"], ["tritanopia", "Blue / yellow support", "#3fc46e", "#ff4d6b", "#fff"]].map(([id, label, friendly, enemy, lock]) => `<button data-palette="${id}" data-focus="palette-${id}" aria-pressed="${settings.markerPalette === id}" class="${settings.markerPalette === id ? "selected" : ""}"><span class="palette-swatches" aria-hidden="true"><i style="color:${friendly}">◇</i><i style="color:${enemy}">△</i><i style="color:${lock}">◎</i></span>${label}</button>`).join("")}</div></div></section>`;
  }
  _modalHtml() {
    if (this.restoring) {
      const plan = this.restoring, action = this.input.actions[plan.id];
      const names = [...new Set(plan.conflicts.map(conflict => conflict.label))];
      return `<div class="setup-scrim"><section class="setup-modal" role="alertdialog" aria-modal="true" aria-labelledby="restoreTitle"><span class="setup-kicker">RESTORE ONE ACTION</span><h2 id="restoreTitle">Restore ${esc(action.label)}?</h2><p>Its default keys are ${ACTIVE_ACTIONS[plan.id].binds.map(nice).join(", ")}. ${names.length ? `Some now control <strong>${names.map(esc).join(", ")}</strong>. Moving them will remove those bindings from these actions.` : "These keys are now available."}</p>${plan.unbound.length ? `<p class="conflict-caution">This will leave ${plan.unbound.map(id => esc(this.input.actions[id].label)).join(", ")} without a key. Undo will restore your previous layout.</p>` : ""}<div class="modal-buttons"><button type="button" class="setup-button" data-restore-choice="cancel">Keep my setup</button><button type="button" class="setup-button primary" data-restore-choice="move">${names.length ? "Move keys & restore" : "Restore action"}</button></div></section></div>`;
    }
    if (this.confirming) {
      const keys = this.confirming === "binds";
      return `<div class="setup-scrim"><section class="setup-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle"><span class="setup-kicker">RESTORE DEFAULTS</span><h2 id="confirmTitle">${keys ? "Reset your control keys?" : "Reset game options?"}</h2><p>${keys ? "This replaces your custom keyboard and mouse bindings with the recommended flight layout. Your game options and existing progress are kept." : "This resets display, audio, accessibility, and aiming preferences. Your control keys and existing progress are kept."}</p><div class="modal-buttons"><button class="setup-button" data-confirm="cancel">Keep my setup</button><button class="setup-button primary" data-confirm="reset">${keys ? "Restore default keys" : "Restore game options"}</button></div></section></div>`;
    }
    if (!this.capturing) return "";
    const action = this.input.actions[this.capturing.id];
    if (this.pending) {
      const names = [...new Set(this.pending.conflicts.map((conflict) => conflict.label))];
      const unbound = [...new Set(this.pending.conflicts.filter((conflict) => this.input.actions[conflict.id].binds.length === 1).map((conflict) => conflict.label))];
      return `<div class="setup-scrim"><section class="setup-modal" role="alertdialog" aria-modal="true" aria-labelledby="conflictTitle"><span class="setup-kicker">SHARED KEY</span><h2 id="conflictTitle">${nice(this.pending.chord)} already has a job.</h2><p>It currently controls <strong>${names.map(esc).join(", ")}</strong>. Choose how it should work with <strong>${esc(action.label)}</strong>.</p>${unbound.length ? `<p class="conflict-caution">Moving this key will leave ${unbound.map(esc).join(", ")} unbound. You can assign a new key afterward.</p>` : ""}<div class="conflict-choices"><button class="setup-choice" data-resolve="replace"><strong>Move key to ${esc(action.label)}</strong><small>Remove it from ${names.map(esc).join(", ")}.</small></button><button class="setup-choice" data-resolve="share"><strong>Use it for both</strong><small>Both actions will respond to this key.</small></button><button class="setup-choice" data-resolve="retry"><strong>Choose a different key</strong><small>Keep the existing controls unchanged.</small></button></div><button class="setup-text-button" data-cancel-capture data-capture-control>Cancel · Esc</button></section></div>`;
    }
    return `<div class="setup-scrim"><section class="setup-modal capture-surface" role="dialog" aria-modal="true" aria-labelledby="captureTitle"><span class="setup-kicker">${this.capturing.slot === 0 ? "PRIMARY" : "ALTERNATE"} BINDING</span><h2 id="captureTitle">${esc(action.label)}</h2><div id="captureKeys" class="capture-keys">Press a key</div><p id="captureFeedback" aria-live="polite">You can also click a mouse button or turn the wheel. Escape cancels.</p><p class="setup-footnote">For a shortcut, hold a modifier and press another key. System shortcuts may be intercepted by your computer.</p><button class="setup-button" data-cancel-capture data-capture-control>Cancel · Esc</button></section></div>`;
  }
  _render(focusKey = "") {
    clearTimeout(this._aimHoldTimeout);
    this._cancelAimHold = null;
    const oldFocus = focusKey || document.activeElement?.dataset?.focus;
    const context = `${this.tab}:${this.category}`;
    const scrollTop = this._renderedContext === context ? this.el.querySelector(".setup-content")?.scrollTop || 0 : 0;
    this._renderedContext = context;
    const modified = Object.keys(this.input.actions).filter((id) => this.input.customized(id)).length;
    const missing = this.tab === "controls" ? missingEssentialActions(this.input).length : 0;
    const storage = this._storageState();
    this.el.innerHTML = `<div class="setup-shell"><header class="setup-header"><div><span class="setup-kicker">RAPTOR / FLIGHT SETUP</span><h1 id="setupTitle">Ready on your terms.</h1></div><button class="setup-close" data-action="close" aria-label="Close flight setup">Done <span>Esc</span></button></header><nav class="setup-tabs" aria-label="Flight setup sections">${Object.entries(TABS).map(([id, label]) => `<button data-tab="${id}" data-focus="tab-${id}" aria-current="${this.tab === id ? "page" : "false"}" class="${this.tab === id ? "selected" : ""}">${label}</button>`).join("")}</nav><div class="setup-content">${this.tab === "controls" ? this._controlsHtml() : this._settingsHtml()}</div><footer class="setup-footer"><div><span class="save-indicator${missing || !storage.available ? " caution" : ""}"></span><span data-storage-status>${storage.text}</span>${missing ? `<button type="button" class="binding-badge missing missing-action" data-action="missing" data-focus="missing-actions">${missing} essential ${missing === 1 ? "action needs" : "actions need"} a key · Fix</button>` : ""}${this.tab === "controls" && modified ? `<span class="custom-count">${modified} customized</span>` : ""}</div>${this.tab !== "controls" ? `<button class="setup-text-button" data-action="reset-settings">Restore game options</button>` : `<button type="button" class="setup-button undo-keys" data-action="undo-keys" data-focus="undo-keys" ${this.history.canUndo ? "" : "disabled"} title="${this.history.canUndo ? esc(`Undo ${this.history.previous.label}`) : "Your last key change can be undone here"}">↶ Undo last key change</button>`}</footer><div class="setup-notice" role="status" aria-live="polite">${esc(this.notice)}</div></div>${this._modalHtml()}`;
    this._wire(); this._updateController(); this._updateCount(); this._updateTest();
    this.el.querySelector(".setup-content").scrollTop = scrollTop;
    const modal = this.el.querySelector(".setup-modal");
    this.el.querySelector('.setup-shell').inert=!!modal;
    if (modal) modal.querySelector(FOCUSABLE)?.focus();
    else if (this.testing) this.el.querySelector(".input-test")?.focus();
    else if (oldFocus) this.el.querySelector(`[data-focus="${oldFocus}"]`)?.focus({ preventScroll: true });
  }
  _wireRows() {
    this.el.querySelectorAll("[data-bind]").forEach((button) => button.addEventListener("click", () => this._beginCapture(button.dataset.bind, Number(button.dataset.slot))));
    this.el.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => {
      const id = button.dataset.remove, action = this.input.actions[id];
      if (!this.history.change(`remove a key from ${action.label}`, () => this.input.setBinding(id, Number(button.dataset.slot), null))) return;
      this.notice = action.binds.length ? `${action.label}: key removed.` : `${action.label} is now unbound. Use Add key to assign it.`;
      this._render(`bind-${id}-${action.binds.length}`);
    }));
    this.el.querySelectorAll("[data-restore-action]").forEach(button => button.addEventListener("click", () => this._beginRestore(button.dataset.restoreAction)));
  }
  _wireLayoutInspector() {
    this.el.querySelectorAll("[data-layout-edit]").forEach(button => button.addEventListener("click", () => this._beginCapture(button.dataset.layoutEdit, Number(button.dataset.slot), button.dataset.focus)));
    this.el.querySelectorAll("[data-layout-add]").forEach(button => button.addEventListener("click", () => this._beginCapture(button.dataset.layoutAdd, this.input.actions[button.dataset.layoutAdd].binds.length, button.dataset.focus)));
    this.el.querySelectorAll('[data-action="all-keys"]').forEach(button => button.addEventListener("click", () => { const search = this.el.querySelector("#controlSearch"); search?.scrollIntoView({block:"center"}); search?.focus({preventScroll:true}); }));
  }
  _wire() {
    this._wireRows();
    this._wireLayoutInspector();
    this.el.querySelector(".keyboard-layout")?.addEventListener("toggle", event => { this.layoutOpen = event.target.open; });
    this.el.querySelectorAll("[data-map-key]").forEach(button => button.addEventListener("click", () => {
      this.selectedCode = button.dataset.mapKey;
      this.el.querySelectorAll("[data-map-key]").forEach(key => key.setAttribute("aria-pressed", String(key.dataset.mapKey === this.selectedCode)));
      const inspector = this.el.querySelector(".layout-inspector");
      inspector.innerHTML = this._layoutInspectorHtml(); this._wireLayoutInspector();
      inspector.scrollIntoView({ block: "nearest" });
      inspector.querySelector("button")?.focus({ preventScroll: true });
    }));
    this.el.querySelectorAll("[data-aim-preset]").forEach(button => button.addEventListener("click", () => {
      const state = aimPresetState(current()), preset = state.presets.find(item => item.id === button.dataset.aimPreset);
      const settings = saveSettings({ [state.key]: preset.value });
      this.input.setOptions(getAimOptions(settings));
      this.el.querySelector(`[data-setting="${state.key}"]`).value = settings[state.key];
      this.el.querySelector(`#value-${state.key}`).textContent = valueLabel(state.key, settings[state.key]);
      this._updateAimPresets();
      this.notice = `${preset.label} aiming applied. ${storageAvailable() ? "Saved for this device profile." : "Session only; browser storage is unavailable."}`;
      this._updateStorageStatus();
    }));
    this.el.querySelectorAll("[data-device]").forEach((button) => button.addEventListener("click", () => {
      const settings = saveSettings({ pointingDevice: button.dataset.device });
      this.input.setOptions(getAimOptions(settings));
      this.notice = storageAvailable() ? `${settings.pointingDevice === "trackpad" ? "Trackpad" : "Mouse"} aiming selected. Your control keys are unchanged.` : "Aiming updated for this session. Browser storage is unavailable.";
      this._render(`device-${button.dataset.device}`);
    }));
    const preview = this.el.querySelector(".aim-test-surface");
    if (preview) {
      const aim = { x: 0, y: 0 };
      let entered = false;
      const dot = preview.querySelector(".aim-test-dot"), reading = preview.querySelector("output");
      const target = preview.querySelector(".aim-test-target"), feedback = this.el.querySelector("[data-aim-exercise-status]");
      const targetButton = this.el.querySelector("[data-test-targets]");
      // Keep every target reachable in one stroke even at the minimum gain
      // on a narrow screen; a setup exercise must not require pointer capture.
      const targets = [{ x: 6, y: 0, direction: "right" }, { x: -6, y: 0, direction: "left" }, { x: 0, y: -3, direction: "up" }, { x: 0, y: 3, direction: "down" }, { x: 0, y: 0, direction: "to the center" }];
      let targetIndex = -1;
      const cancelHold = () => { clearTimeout(this._aimHoldTimeout); this._aimHoldTimeout = null; target.classList.remove("on-target"); };
      this._cancelAimHold = () => { entered = false; cancelHold(); };
      const showTarget = () => {
        const goal = targets[targetIndex];
        target.hidden = !goal;
        if (goal) {
          target.style.left = `${50 + goal.x * 2.1}%`; target.style.top = `${50 + goal.y * 2.1}%`;
          feedback.textContent = `Target ${targetIndex + 1} of 5 · move ${goal.direction}, then align the dot with the target briefly.`;
        } else {
          feedback.textContent = "Comfort check complete. Overshooting? Try Precise. Running out of room? Try Responsive.";
          targetButton.textContent = "Try again";
        }
      };
      const checkTarget = () => {
        const goal = targets[targetIndex];
        if (!goal || Math.hypot(aim.x - goal.x, aim.y - goal.y) > 1.4) { cancelHold(); return; }
        target.classList.add("on-target");
        if (this._aimHoldTimeout) return;
        this._aimHoldTimeout = setTimeout(() => { cancelHold(); targetIndex++; showTarget(); }, 350);
      };
      const redraw = () => {
        dot.style.left = `${50 + aim.x * 2.1}%`;
        dot.style.top = `${50 + aim.y * 2.1}%`;
        reading.textContent = `${Math.abs(aim.x).toFixed(1)}° ${aim.x < 0 ? "left" : "right"} · ${Math.abs(aim.y).toFixed(1)}° ${aim.y < 0 ? "up" : "down"}`;
      };
      preview.addEventListener("mouseenter", () => { entered = false; });
      preview.addEventListener("mouseleave", () => { entered = false; cancelHold(); });
      preview.addEventListener("mousemove", (event) => {
        // Returning from a slider or the center button must not count the
        // distance traveled outside the preview as an aiming stroke.
        if (!entered) { entered = true; return; }
        const options = getAimOptions(), degrees = options.mouseSensitivity * 0.0028 * 180 / Math.PI;
        aim.x = Math.max(-20, Math.min(20, aim.x + (event.movementX || 0) * degrees));
        aim.y = Math.max(-20, Math.min(20, aim.y + (event.movementY || 0) * degrees * (options.invertY ? -1 : 1)));
        redraw(); checkTarget();
      });
      this.el.querySelector("[data-test-recenter]").onclick = () => { aim.x = aim.y = 0; cancelHold(); redraw(); };
      targetButton.onclick = () => { cancelHold(); aim.x = aim.y = 0; targetIndex = 0; entered = false; redraw(); showTarget(); targetButton.textContent = "Start over"; this.el.querySelector(".input-test").focus({ preventScroll: true }); };
    }
    this.el.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "close") this.close();
      else if (action === "keys") { const layout = this.el.querySelector(".keyboard-layout"); layout.open = true; this.layoutOpen = true; layout.scrollIntoView({block:"start"}); layout.querySelector("summary").focus({preventScroll:true}); }
      else if (action === "all-keys") { /* wired with the replaceable map inspector */ }
      else if (action === "test") { this.testing = !this.testing; this.testDown.clear(); this.lastTest = null; this._render("test-controls"); }
      else if (action === "missing") this._showMissing();
      else if (action === "undo-keys") {
        const label = this.history.undo();
        this.notice = label ? `Undid ${label}. ${this.input.storageAvailable ? "Previous keys saved." : "Previous keys restored for this session only."}` : "Your layout changed elsewhere; there is no previous edit to undo.";
        this._render("tab-controls");
      }
      else { this.confirming = action === "reset-binds" ? "binds" : "settings"; this._render(); }
    }));
    this.el.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { this.tab = button.dataset.tab; this.testing = false; this.notice = ""; this._render(`tab-${this.tab}`); }));
    this.el.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => { this.category = button.dataset.category; this.query = ""; this.testing = false; this._render(`category-${this.category}`); }));
    this.el.querySelector("#controlSearch")?.addEventListener("input", (event) => {
      this.query = event.target.value; this.el.querySelector("#bindingRows").innerHTML = this._rowsHtml(); this._wireRows(); this._updateCount();
    });
    this.el.querySelectorAll("[data-setting]").forEach((element) => element.addEventListener("input", () => {
      const key = element.dataset.setting, value = element.type === "checkbox" ? element.checked : Number(element.value);
      const settings = saveSettings({ [key]: value });
      this.input.setOptions(getAimOptions(settings));
      const output = this.el.querySelector(`#value-${key}`);
      if (output) output.textContent = valueLabel(key, settings[key] ?? value);
      this.notice = storageAvailable() ? "Preferences saved." : "Session only. These options reset when you launch or reload.";
      this._updateStorageStatus();
      this._updateInstrumentPreview();
      this._updateAimPresets();
    }));
    this.el.querySelector("[data-review-restart]")?.addEventListener("click",()=>this.close());
    this.el.querySelectorAll("[data-quality]").forEach((button) => button.addEventListener("click", () => { saveSettings({ tier: button.dataset.quality }); this.notice = storageAvailable() ? "Quality saved. Start a new flight to apply all graphics changes." : "Graphics preferences could not be saved. Changes apply only on this page."; this._render(`quality-${button.dataset.quality}`); }));
    this.el.querySelectorAll("[data-palette]").forEach((button) => button.addEventListener("click", () => { saveSettings({ markerPalette: button.dataset.palette }); this.notice = storageAvailable() ? "Target colors saved." : "Target colors applied for this session. They reset when you launch or reload."; this._render(`palette-${button.dataset.palette}`); }));
    this.el.querySelectorAll("[data-cancel-capture]").forEach((button) => button.addEventListener("click", () => this._cancelCapture("Binding unchanged.")));
    this.el.querySelectorAll("[data-resolve]").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.resolve === "retry") { this.pending = null; this._heldMods = []; this._render(); }
      else this._commit(this.pending.chord, button.dataset.resolve);
    }));
    this.el.querySelectorAll("[data-restore-choice]").forEach(button => button.addEventListener("click", () => {
      if (button.dataset.restoreChoice === "cancel") this._cancelRestore();
      else this._restoreAction(this.restoring);
    }));
    this.el.querySelectorAll("[data-confirm]").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.confirm === "reset") {
        if (this.confirming === "binds") { this.history.change("restore all default keys", () => this.input.resetBinds()); this.notice = this.input.storageAvailable ? "Default keys restored." : "Default keys applied for this session. Your saved layout could not be updated."; }
        else { this.input.setOptions(getAimOptions(resetSettings())); this.notice = storageAvailable() ? "Default game options restored." : "Default options applied for this session. Your saved options could not be cleared."; }
      }
      this.confirming = null; this._render();
    }));
  }
  _storageState() {
    const options = storageAvailable();
    if (this.tab !== "controls") return { available: options, text: options ? "Options save automatically" : "Options: session only · reset on launch or reload" };
    const keys = this.input.storageAvailable;
    if (keys && options) return { available: true, text: "Controls and aim options save automatically" };
    if (!keys && !options) return { available: false, text: "Session only · controls and options reset on reload" };
    return { available: false, text: keys ? "Keys saved · aim options are session only" : "Keys are session only · aim options saved" };
  }
  _audioStorageNote() {
    if (hasLive("audio")) return "Volume changes apply immediately.";
    return storageAvailable() ? "Your mix applies when you start a flight." : "Session only. This mix cannot carry into a new flight while storage is blocked.";
  }
  _updateStorageStatus() {
    const status = this._storageState();
    const text = this.el.querySelector("[data-storage-status]");
    if (text) text.textContent = status.text;
    const missing = this.tab === "controls" && Object.values(this.input.actions).some((action) => action.essential && !action.binds.length);
    this.el.querySelector(".save-indicator")?.classList.toggle("caution", !status.available || missing);
    const notice = this.el.querySelector(".setup-notice");
    if (notice) notice.textContent = this.notice;
    const audio = this.el.querySelector("[data-audio-storage]");
    if (audio) audio.textContent = this._audioStorageNote();
  }
  _updateCount() { const node = this.el.querySelector("#bindingCount"); if (node) node.textContent = `${this._visibleActions().length} actions`; }
  _updateTest(trigger) {
    if (!this.testing) return;
    const keyNode = this.el.querySelector("#testKeys"), actionNode = this.el.querySelector("#testActions");
    if (!keyNode || !actionNode) return;
    keyNode.textContent = this.testDown.size ? [...this.testDown].map(keyName).join(" + ") : "Press a key or mouse button";
    const ids = new Set(trigger ? this.input.matchingActions(trigger, this.testDown) : []);
    for (const [id, action] of Object.entries(this.input.actions)) if (action.hold && this.input.keyboardHeld(id, this.testDown)) ids.add(id);
    actionNode.textContent = ids.size ? [...ids].map((id) => this.input.actions[id].label).join(" · ") : this.testDown.size ? "No action uses this input. Assign it in the list below." : "No keys held. Nothing fires or moves.";
    if (trigger) {
      const chord = [...this.testDown].filter(code => MODS.has(code) && code !== trigger).concat(trigger);
      const triggered = this.input.matchingActions(trigger, this.testDown);
      this.lastTest = `${chordName(chord)} → ${triggered.length ? triggered.map(id => this.input.actions[id].label).join(" · ") : "No action assigned"}`;
    }
    const lastNode = this.el.querySelector("#testLastInput");
    if (lastNode) lastNode.textContent = this.lastTest || "Tap a key to keep its result here.";
    this.el.querySelectorAll?.("[data-map-key]").forEach(key => key.classList.toggle("key-held", this.testDown.has(key.dataset.mapKey)));
  }
  _updateController() {
    const title = this.el.querySelector("#controllerTitle"), detail = this.el.querySelector("#controllerDetail");
    if (!title || !detail) return;
    let pads = [];
    try { pads = [...(navigator.getGamepads?.() || [])].filter((pad) => pad?.connected); } catch (_) { /* denied by browser */ }
    const standard = pads.find((pad) => pad.mapping === "standard");
    title.textContent = standard ? "Controller connected" : pads.length ? "Controller detected" : current().pointingDevice === "trackpad" ? "Trackpad setup ready" : "Mouse setup ready";
    detail.textContent = standard ? "Left stick: bank / throttle. Right stick: aim. RT: cannon. RB: missile. A: gear. Y: recenter. Start: pause."
      : pads.length ? "This device has no standard mapping. Custom HOTAS mapping is not configured; use your keyboard with a mouse or trackpad."
        : "Connect a standard controller and press a button to detect it.";
    title.closest(".controller-card")?.classList.toggle("connected", !!standard);
  }
  dispose() {
    this.close();
    window.removeEventListener("keydown", this._keyDown, true); window.removeEventListener("keyup", this._keyUp, true);
    window.removeEventListener("mousedown", this._mouseDown, true); window.removeEventListener("mouseup", this._mouseUp, true);
    window.removeEventListener("wheel", this._wheel, true); window.removeEventListener("blur", this._blur);
    clearTimeout(this._testWheelTimeout); clearTimeout(this._aimHoldTimeout); this.el.remove();
  }
}
