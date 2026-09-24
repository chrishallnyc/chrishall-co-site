// Standard controllers use the browser's standard mapping. Unmapped HOTAS
// devices are detected but never guessed at. Disconnects clear every axis.
import { RAPTOR_GAMEPAD } from "./binds.js";

export const DEADZONE = 0.12;
export const deadzone = (value, threshold = DEADZONE) => Math.abs(value) <= threshold ? 0
  : Math.sign(value) * Math.min(1, (Math.abs(value) - threshold) / (1 - threshold));

export class GamepadInput {
  constructor(mapping = RAPTOR_GAMEPAD) {
    this.map = mapping;
    this.connected = false;
    this.supported = false;
    this.name = "";
    this.axes = { roll: 0, throttleRel: 0, aimX: 0, aimY: 0 };
    this.heldActions = new Set();
    this.edgeActions = new Set();
    this._prevHeld = new Set();
    this._index = null;
  }
  update() {
    let pads = [];
    try { pads = globalThis.navigator?.getGamepads?.() || []; } catch (_) { /* browser policy can disable controllers */ }
    const available = [...pads].filter((pad) => pad?.connected);
    const pad = available.find((candidate) => candidate.mapping === "standard") || available[0];
    this.connected = !!pad;
    this.supported = pad?.mapping === "standard";
    this.name = pad?.id || "";
    this.heldActions.clear(); this.edgeActions.clear();
    for (const key of Object.keys(this.axes)) this.axes[key] = 0;
    if (!pad || !this.supported) { this._prevHeld.clear(); this._index = null; return; }
    if (this._index !== pad.index) { this._prevHeld.clear(); this._index = pad.index; }
    for (const [name, axis] of Object.entries(this.map.axes)) {
      const raw = Number.isFinite(pad.axes[axis]) ? pad.axes[axis] : 0;
      this.axes[name] = deadzone(raw) * (name === "throttleRel" ? -1 : 1);
    }
    const pressed = (index) => !!pad.buttons[index] && (pad.buttons[index].pressed || pad.buttons[index].value > 0.5);
    for (const [action, index] of Object.entries(this.map.buttons)) if (pressed(index)) this.heldActions.add(action);
    for (const [action, chord] of Object.entries(this.map.chords || {})) {
      if (!chord.every(pressed)) continue;
      this.heldActions.add(action);
      for (const [other, index] of Object.entries(this.map.buttons)) if (chord.includes(index)) this.heldActions.delete(other);
    }
    for (const action of this.heldActions) if (!this._prevHeld.has(action)) this.edgeActions.add(action);
    this._prevHeld = new Set(this.heldActions);
  }
  held(id) { return this.heldActions.has(id); }
  pressed(id) { return this.edgeActions.has(id); }
}
