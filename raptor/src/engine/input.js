// Browser input, persisted multi-binding layouts, and the controls editor's
// conflict model share one validated action vocabulary. Escape is always a
// reliable way out. Menus and focus changes clear both held and queued input.
import { ACTIVE_ACTIONS } from "./binds.js";

export const STORE_KEY = "raptor:binds:v3";
export const LEGACY_STORE_KEY = "raptor:binds:v2";
const CODE = /^(?:Key[A-Z]|Digit[0-9]|Arrow(?:Up|Down|Left|Right)|F(?:[1-9]|1[0-9]|2[0-4])|Mouse[0-4]|Wheel(?:Up|Down)|Numpad[A-Za-z0-9]+|(?:Shift|Control|Alt|Meta)(?:Left|Right)|Space|Escape|Tab|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|NumLock|ScrollLock|Pause|PrintScreen|ContextMenu|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|IntlBackslash|IntlRo|IntlYen|Semicolon|Quote|Comma|Period|Slash)$/;
const fromUI = (e) => !!e.target?.closest?.("input, select, textarea, button, a, dialog, [data-game-ui], [contenteditable='true'], [role='dialog']");
const defaults = () => Object.fromEntries(Object.entries(ACTIVE_ACTIONS).map(([id, a]) => [id, { ...a, binds: a.binds.map((c) => [...c]) }]));
// These keyboard alternatives were added after v3 shipped. A saved action
// already using either key takes precedence over the newly added default.
const ADDED_DEFAULT_KEYS = { fire_mguns: "KeyF", help: "KeyH" };
const isMeta = (code) => code === "MetaLeft" || code === "MetaRight";
const hasMeta = (codes) => codes.has("MetaLeft") || codes.has("MetaRight");

export function validChord(chord) {
  return Array.isArray(chord) && chord.length > 0 && chord.length <= 4
    && chord.every((c) => typeof c === "string" && CODE.test(c)) && new Set(chord).size === chord.length;
}
export function chordIdentity(chord) {
  return [...chord.slice(0, -1).sort(), chord.at(-1)].join("+");
}
function uniqueBindings(binds) {
  const seen = new Set();
  return binds.filter(chord => {
    const identity = chordIdentity(chord);
    if (seen.has(identity)) return false;
    seen.add(identity); return true;
  }).map(chord => [...chord]);
}
function validBindings(id, binds) {
  return Array.isArray(binds) && binds.length <= 4 && binds.every((chord) => validChord(chord)
    && (!chord.includes("Escape") || (id === "menu" && chord.length === 1))
    && (!ACTIVE_ACTIONS[id]?.hold || !chord.some((code) => code.startsWith("Wheel"))));
}

export class Input {
  constructor(target = window) {
    this.target = target;
    this.storageAvailable = true;
    this.actions = this._load();
    this.down = new Set();
    this.edge = new Set();
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, dx: 0, dy: 0, wheel: 0 };
    this.options = { mouseSensitivity: 1, gamepadSensitivity: 1, invertY: false };
    this._byTrigger = new Map();
    this._boundCodes = new Set();
    this._rebuildIndex();
    this._suspended = false;
    this._pointerReady = true;
    this._kd = (e) => {
      if (this.suspended || (fromUI(e) && e.code !== "Escape") || !CODE.test(e.code)) return;
      // Command shortcuts belong to the browser unless the pilot explicitly
      // assigned that Meta chord. Modifier flags also repair missed keyups.
      if (!isMeta(e.code) && e.metaKey === false && hasMeta(this.down)) this.down.clear();
      if (e.metaKey && !isMeta(e.code) && !hasMeta(this.down)) this.down.clear();
      if (e.code !== "Escape" && (isMeta(e.code) || e.metaKey || hasMeta(this.down))) {
        const assigned = (this._byTrigger.get(e.code) || []).some(({ chord }) =>
          chord.some(isMeta) && chord.slice(0, -1).every((code) => this.down.has(code)));
        if (!assigned) {
          if (isMeta(e.code)) this.down.add(e.code);
          return;
        }
      }
      // Only assigned controls suppress browser defaults. In particular an
      // unbound Tab must still reach the accessible flight toolbar. Repeats
      // keep suppressing defaults without creating additional action edges.
      if (this._boundCodes.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this._resolveEdge(e.code);
    };
    this._ku = (e) => {
      // A browser shortcut can omit the letter's keyup. Releasing Command
      // must not revive its ordinary flight binding. Keep intentional press
      // edges until consumeFrame, including a quickly tapped custom shortcut.
      if (isMeta(e.code) || (e.metaKey === false && hasMeta(this.down))) this.down.clear();
      else this.down.delete(e.code);
    };
    this._md = (e) => {
      if (this.suspended || fromUI(e)) return;
      const code = "Mouse" + e.button;
      this.down.add(code); this._resolveEdge(code);
      if (e.button > 0 && this._byTrigger.has(code)) e.preventDefault();
    };
    this._mu = (e) => {
      const code = "Mouse" + e.button;
      this.down.delete(code);
      if (!this.suspended && !fromUI(e) && e.button > 0 && this._byTrigger.has(code)) e.preventDefault();
    };
    this._aux = (e) => { if (!this.suspended && !fromUI(e) && this._byTrigger.has("Mouse" + e.button)) e.preventDefault(); };
    this._mm = (e) => {
      if (this.suspended || fromUI(e)) { this._pointerReady = false; return; }
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.mouse.nx = (e.clientX / (globalThis.innerWidth || 1)) * 2 - 1;
      this.mouse.ny = -((e.clientY / (globalThis.innerHeight || 1)) * 2 - 1);
      // Moving back from a menu is cursor placement, not a steering command.
      // Pointer lock supplies relative travel and needs no entry baseline.
      const relative = !!globalThis.document?.pointerLockElement;
      if (!this._pointerReady && !relative) { this._pointerReady = true; return; }
      this._pointerReady = true;
      this.mouse.dx += (e.movementX || 0) * this.options.mouseSensitivity;
      this.mouse.dy += (e.movementY || 0) * this.options.mouseSensitivity * (this.options.invertY ? -1 : 1);
    };
    this._wh = (e) => {
      if (this.suspended || fromUI(e) || !e.deltaY) return;
      const code = e.deltaY < 0 ? "WheelUp" : "WheelDown";
      this.mouse.wheel += -Math.sign(e.deltaY);
      this.down.add(code); this._resolveEdge(code);
      if (this._byTrigger.has(code)) e.preventDefault();
    };
    this._cm = (e) => { if (!this.suspended && !fromUI(e)) e.preventDefault(); };
    this._bl = () => this.clear();
    this._visibility = () => { if (globalThis.document?.hidden) this.clear(); };
    for (const [name, listener] of [["keydown", this._kd], ["keyup", this._ku], ["mousedown", this._md], ["mouseup", this._mu], ["auxclick", this._aux], ["mousemove", this._mm], ["wheel", this._wh], ["contextmenu", this._cm], ["blur", this._bl]]) {
      target.addEventListener(name, listener, name === "wheel" ? { passive: false } : undefined);
    }
    globalThis.document?.addEventListener("visibilitychange", this._visibility);
  }

  get suspended() { return this._suspended; }
  set suspended(value) { this._suspended = !!value; if (value) this.clear(); }

  setOptions(options = {}) {
    const previous = { ...this.options };
    if (Number.isFinite(options.mouseSensitivity)) this.options.mouseSensitivity = Math.max(0.35, Math.min(2, options.mouseSensitivity));
    if (Number.isFinite(options.gamepadSensitivity)) this.options.gamepadSensitivity = Math.max(0.35, Math.min(2, options.gamepadSensitivity));
    if (typeof options.invertY === "boolean") this.options.invertY = options.invertY;
    // Deltas already include the previous gain/inversion. Never replay them
    // after a profile change, and never disturb held flight keys for a slider.
    if (Object.keys(previous).some((key) => previous[key] !== this.options[key])) {
      this.mouse.dx = this.mouse.dy = 0;
    }
  }

  attachGamepad(gamepad) { this.gamepad = gamepad; }
  sampleGamepad(dt) {
    if (this.suspended || !this.gamepad?.supported) return;
    const seconds = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.05));
    this.mouse.dx += this.gamepad.axes.aimX * 620 * seconds * this.options.gamepadSensitivity;
    this.mouse.dy += this.gamepad.axes.aimY * 620 * seconds * this.options.gamepadSensitivity * (this.options.invertY ? -1 : 1);
  }
  axis(name) { return !this.suspended && this.gamepad?.supported ? this.gamepad.axes[name] || 0 : 0; }

  _load() {
    const actions = defaults();
    let serialized, legacy = false;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw !== null) serialized = raw;
      else {
        serialized = localStorage.getItem(LEGACY_STORE_KEY);
        legacy = serialized !== null;
      }
    } catch (_) { this.storageAvailable = false; }
    try {
      const saved = JSON.parse(serialized || "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        const explicitActions = new Set();
        const explicitAddedKeys = new Set();
        for (const [id, value] of Object.entries(saved)) {
          if (!Object.hasOwn(actions, id)) continue;
          const binds = typeof value === "string" ? (value ? [value.split("+")] : []) : value;
          if (!validBindings(id, binds)) continue; // one corrupt action must not discard other valid edits
          actions[id].binds = uniqueBindings(binds);
          explicitActions.add(id);
        }
        // Older builds OR'ed machine-gun and cannon actions. Fold that old
        // effective layout into visible alternates exactly once, rather than
        // keeping a hidden fire_cannons alias after the pilot edits this one.
        // A v3 empty array is always authoritative; explicitly empty legacy
        // records also stay empty instead of acquiring a default fire key.
        if (legacy) {
          const value = Object.hasOwn(saved, "fire_cannons") ? saved.fire_cannons : [["Mouse0"], ["Digit2"]];
          const cannon = typeof value === "string" ? (value ? [value.split("+")] : []) : value;
          if (validBindings("fire_mguns", cannon)) {
            const uniqueCannon = uniqueBindings(cannon);
            const visible = actions.fire_mguns.binds;
            const missing = uniqueCannon.filter((chord) => !visible.some((existing) => chordIdentity(existing) === chordIdentity(chord)));
            // An added default must not consume a slot that an older pilot's
            // explicit cannon alternate used before this migration.
            if (!explicitActions.has("fire_mguns") && visible.length + missing.length > 4) {
              const added = visible.findIndex((chord) => chord.length === 1 && chord[0] === ADDED_DEFAULT_KEYS.fire_mguns);
              if (added !== -1) visible.splice(added, 1);
            }
            for (const chord of uniqueCannon) {
              if (visible.length < 4 && !visible.some((existing) => chordIdentity(existing) === chordIdentity(chord))) visible.push([...chord]);
            }
            if (Object.hasOwn(saved, "fire_cannons")
              && cannon.some((chord) => chord.length === 1 && chord[0] === ADDED_DEFAULT_KEYS.fire_mguns)) explicitAddedKeys.add("fire_mguns");
          }
        }
        for (const [id, code] of Object.entries(ADDED_DEFAULT_KEYS)) {
          if (explicitActions.has(id) || explicitAddedKeys.has(id)) continue;
          const alreadyAssigned = [...explicitActions].some((other) => other !== id
            && actions[other].binds.some((chord) => chord.length === 1 && chord[0] === code));
          if (alreadyAssigned) actions[id].binds = actions[id].binds.filter((chord) => chord.length !== 1 || chord[0] !== code);
        }
      }
    } catch (_) { /* malformed JSON recovers to defaults; storage can still work */ }
    // Escape can never be lost to an old layout, bad import, or a conflict move.
    actions.menu.binds = [["Escape"], ...actions.menu.binds.filter((c) => !c.includes("Escape"))].slice(0, 4);
    return actions;
  }

  _persist() {
    const changed = {};
    for (const [id, action] of Object.entries(this.actions)) {
      // An explicitly shared new default belongs to both actions. Persist
      // its owner even when that action otherwise equals factory defaults,
      // so the older-layout F/H migration cannot remove it after reload.
      const added = ADDED_DEFAULT_KEYS[id];
      const sharedDefault = added && action.binds.some(chord => chord.length === 1 && chord[0] === added)
        && this.findConflicts(id, [added]).length > 0;
      if (sharedDefault || JSON.stringify(action.binds) !== JSON.stringify(ACTIVE_ACTIONS[id].binds)) changed[id] = action.binds;
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(changed));
      this.storageAvailable = true;
    } catch (_) { this.storageAvailable = false; }
    this._rebuildIndex();
    this.clear();
    if (globalThis.window?.dispatchEvent && typeof CustomEvent !== "undefined") window.dispatchEvent(new CustomEvent("raptor-bindings-change"));
    return this.storageAvailable;
  }

  _rebuildIndex() {
    this._byTrigger.clear();
    this._boundCodes.clear();
    for (const [id, action] of Object.entries(this.actions)) {
      for (const chord of action.binds) {
        for (const code of chord) this._boundCodes.add(code);
        const trigger = chord.at(-1);
        if (!this._byTrigger.has(trigger)) this._byTrigger.set(trigger, []);
        this._byTrigger.get(trigger).push({ id, chord });
      }
    }
  }

  matchingActions(trigger, heldCodes = this.down) {
    const candidates = (this._byTrigger.get(trigger) || []).filter(({ chord }) =>
      (trigger === "Escape" || !hasMeta(heldCodes) || chord.some(isMeta))
      && chord.slice(0, -1).every((code) => heldCodes.has(code)));
    const longest = Math.max(0, ...candidates.map(({ chord }) => chord.length));
    return [...new Set(candidates.filter(({ chord }) => chord.length === longest).map(({ id }) => id))];
  }
  _resolveEdge(trigger) { for (const id of this.matchingActions(trigger)) this.edge.add(id); }
  keyboardHeld(id, heldCodes = this.down) {
    return !!this.actions[id]?.binds.some((chord) => {
      if (hasMeta(heldCodes) && !chord.includes("Escape") && !chord.some(isMeta)) return false;
      if (!chord.every((code) => heldCodes.has(code))) return false;
      // A custom Shift+W shortcut must not secretly accelerate through W.
      // Match edge resolution: the longest satisfied chord for this trigger
      // wins, while deliberate same-length shared bindings remain shared.
      return !(this._byTrigger.get(chord.at(-1)) || []).some((candidate) =>
        candidate.chord.length > chord.length && candidate.chord.every((code) => heldCodes.has(code)));
    });
  }
  held(id) { return !this.suspended && (this.keyboardHeld(id) || !!this.gamepad?.held(id)); }
  pressed(id) { return !this.suspended && (this.edge.has(id) || !!this.gamepad?.pressed(id)); }
  wheelDelta() { return this.suspended ? 0 : this.mouse.wheel; }

  findConflicts(actionId, chord) {
    if (!validChord(chord)) return [];
    const signature = chordIdentity(chord), conflicts = [];
    for (const [id, action] of Object.entries(this.actions)) {
      if (id === actionId) continue;
      action.binds.forEach((existing, slot) => {
        if (chordIdentity(existing) === signature) conflicts.push({ id, slot, label: action.label, chord: [...existing] });
      });
    }
    return conflicts;
  }

  // Individual slots survive reloads. Conflicting edits are rejected unless the
  // caller explicitly chooses "replace" or "share" after showing the conflict.
  setBinding(actionId, slot, chord, { resolve = "reject" } = {}) {
    const action = this.actions[actionId];
    if (!action || !Number.isInteger(slot) || slot < 0 || slot > action.binds.length || slot >= 4) return false;
    if (actionId === "menu" && slot === 0) return false;
    if (chord !== null && !validBindings(actionId, [chord])) return false;
    if (chord) {
      const identity = chordIdentity(chord);
      if (action.binds.some((c, index) => index !== slot && chordIdentity(c) === identity)) return false;
      const conflicts = this.findConflicts(actionId, chord);
      if (conflicts.length && !["replace", "share"].includes(resolve)) return false;
      if (resolve === "replace") {
        for (const { id } of conflicts) this.actions[id].binds = this.actions[id].binds.filter((c) => chordIdentity(c) !== identity);
      }
      action.binds[slot] = [...chord];
    } else {
      if (slot >= action.binds.length) return false;
      action.binds.splice(slot, 1);
    }
    this._persist();
    return true;
  }

  // Older debug callers keep a primary-key API; alternates are no longer lost.
  rebind(actionId, chord) { return this.setBinding(actionId, 0, chord); }
  // Editor transactions restore complete layouts in one write/event. Validate
  // every action before mutating anything; previous intentional sharing across
  // actions is preserved, but duplicate slots within one action are rejected.
  replaceBindings(layout) {
    if (!layout || typeof layout !== "object" || Array.isArray(layout)) return false;
    const ids = Object.keys(this.actions);
    if (Object.keys(layout).length !== ids.length) return false;
    for (const id of ids) {
      if (!Object.hasOwn(layout, id) || !validBindings(id, layout[id])) return false;
      if (!Array.from(layout[id]).every(chord => validChord(chord)
        && Array.from(chord).every(code => typeof code === "string"))) return false;
      if (new Set(layout[id].map(chordIdentity)).size !== layout[id].length) return false;
    }
    if (layout.menu[0]?.length !== 1 || layout.menu[0][0] !== "Escape") return false;
    for (const id of ids) this.actions[id].binds = layout[id].map(chord => [...chord]);
    this._persist();
    return true;
  }
  resetAction(actionId) {
    if (!this.actions[actionId]) return false;
    this.actions[actionId].binds = ACTIVE_ACTIONS[actionId].binds.map((c) => [...c]);
    this._persist(); return true;
  }
  resetBinds() { this.actions = defaults(); this._persist(); }
  bindsOf(id) { return this.actions[id]?.binds.map((c) => c.join("+")) || []; }
  customized(id) { return JSON.stringify(this.actions[id]?.binds) !== JSON.stringify(ACTIVE_ACTIONS[id]?.binds); }

  clear() {
    this.down?.clear(); this.edge?.clear();
    this._pointerReady = false;
    if (this.mouse) this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0;
  }
  consumeFrame() {
    this.edge.clear(); this.down.delete("WheelUp"); this.down.delete("WheelDown");
    this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0;
  }
  dispose() {
    for (const [name, listener] of [["keydown", this._kd], ["keyup", this._ku], ["mousedown", this._md], ["mouseup", this._mu], ["auxclick", this._aux], ["mousemove", this._mm], ["wheel", this._wh], ["contextmenu", this._cm], ["blur", this._bl]]) this.target.removeEventListener(name, listener);
    globalThis.document?.removeEventListener("visibilitychange", this._visibility);
    this.clear();
  }
}
