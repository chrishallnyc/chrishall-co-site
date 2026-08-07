// Gamepad scaffold on WT's own pc_xinput_ma_ver1 preset. Polled per frame;
// merges into the same action-id vocabulary as keyboard input. Axis routing
// into the flight model arrives with phase 7; HOTAS axis-mapping UI phase 15.

import { WT_GAMEPAD_MA } from "./binds.js";

const DEAD = 0.12;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : v);

export class GamepadInput {
  constructor(mapping = WT_GAMEPAD_MA) {
    this.map = mapping;
    this.connected = false;
    this.axes = { roll: 0, throttleRel: 0, aimX: 0, aimY: 0 };
    this.heldActions = new Set();
    this.edgeActions = new Set();
    this._prevHeld = new Set();
  }

  update() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    this.connected = !!pad;
    this.heldActions.clear();
    this.edgeActions.clear();
    if (!pad) { this._prevHeld.clear(); return; }

    const A = this.map.axes;
    this.axes.roll = dz(pad.axes[A.roll] || 0);
    this.axes.throttleRel = -dz(pad.axes[A.throttleRel] || 0); // stick up = +throttle
    this.axes.aimX = dz(pad.axes[A.aimX] || 0);
    this.axes.aimY = dz(pad.axes[A.aimY] || 0);

    const pressed = (i) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5);
    for (const [action, idx] of Object.entries(this.map.buttons))
      if (pressed(idx)) this.heldActions.add(action);
    for (const [action, chord] of Object.entries(this.map.chords))
      if (chord.every(pressed)) {
        this.heldActions.add(action);
        for (const [other, idx] of Object.entries(this.map.buttons))
          if (chord.includes(idx)) this.heldActions.delete(other); // chord wins
      }
    for (const a of this.heldActions) if (!this._prevHeld.has(a)) this.edgeActions.add(a);
    this._prevHeld = new Set(this.heldActions);
  }

  held(actionId) { return this.heldActions.has(actionId); }
  pressed(actionId) { return this.edgeActions.has(actionId); }
}
