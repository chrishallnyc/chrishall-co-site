// Input v2 — chord-capable action map with WT semantics.
// A bind is a chord array; last code = trigger, the rest must be held.
// Edge resolution on a trigger event: among all binds whose trigger matches
// and whose held-set is satisfied, the LONGEST chords win (Alt+F beats F) —
// ties all fire, matching WT's shipped overlaps (Space, T, Mouse0…).
// held() evaluates each action's chords directly (flight keys keep working
// under modifiers). Rebinds persist as chord strings ("AltLeft+KeyX").

import { ACTIONS } from "./binds.js";

const STORE_KEY = "raptor:binds:v2";

// keys the browser must not act on while flying
const PREVENT = new Set(["Tab", "Space", "AltLeft", "AltRight", "Quote", "Slash", "Backquote", "CapsLock", "F1", "F2", "F3", "F4", "F5", "F7"]);

export class Input {
  constructor(target = window) {
    this.actions = this._load();
    this.down = new Set();
    this.edge = new Set();          // action ids fired since last consumeFrame
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, dx: 0, dy: 0, wheel: 0 };
    this._byTrigger = new Map();    // trigger code -> [{id, chord}]
    this._rebuildIndex();

    this.suspended = false; // controls menu owns input while open
    this._kd = (e) => {
      if (e.repeat || this.suspended) return;
      this.down.add(e.code);
      this._resolveEdge(e.code);
      if (PREVENT.has(e.code)) e.preventDefault();
    };
    this._ku = (e) => this.down.delete(e.code);
    this._md = (e) => { if (this.suspended) return; const c = "Mouse" + e.button; this.down.add(c); this._resolveEdge(c); };
    this._mu = (e) => this.down.delete("Mouse" + e.button);
    this._mm = (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.mouse.nx = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.ny = -((e.clientY / window.innerHeight) * 2 - 1);
      this.mouse.dx += e.movementX || 0; this.mouse.dy += e.movementY || 0;
    };
    this._wh = (e) => { if (this.suspended) return; this.mouse.wheel += -Math.sign(e.deltaY); }; // up = +throttle, WT wheel-throttle
    this._cm = (e) => e.preventDefault();                            // RMB is a game control
    this._bl = () => this.down.clear();

    target.addEventListener("keydown", this._kd);
    target.addEventListener("keyup", this._ku);
    target.addEventListener("mousedown", this._md);
    target.addEventListener("mouseup", this._mu);
    target.addEventListener("mousemove", this._mm);
    target.addEventListener("wheel", this._wh, { passive: true });
    target.addEventListener("contextmenu", this._cm);
    target.addEventListener("blur", this._bl);
  }

  _load() {
    const actions = {};
    for (const [id, a] of Object.entries(ACTIONS))
      actions[id] = { ...a, binds: a.binds.map((c) => [...c]) };
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      for (const [id, chordStr] of Object.entries(saved))
        if (actions[id]) actions[id].binds = [chordStr.split("+")];
    } catch (_) { /* defaults */ }
    return actions;
  }

  _rebuildIndex() {
    this._byTrigger.clear();
    for (const [id, a] of Object.entries(this.actions)) {
      for (const chord of a.binds) {
        const trigger = chord[chord.length - 1];
        if (!this._byTrigger.has(trigger)) this._byTrigger.set(trigger, []);
        this._byTrigger.get(trigger).push({ id, chord });
      }
    }
  }

  _resolveEdge(trigger) {
    const cands = this._byTrigger.get(trigger);
    if (!cands) return;
    let best = 0;
    const satisfied = [];
    for (const c of cands) {
      let ok = true;
      for (let i = 0; i < c.chord.length - 1; i++)
        if (!this.down.has(c.chord[i])) { ok = false; break; }
      if (ok) { satisfied.push(c); if (c.chord.length > best) best = c.chord.length; }
    }
    for (const c of satisfied) if (c.chord.length === best) this.edge.add(c.id);
  }

  held(actionId) {
    const a = this.actions[actionId];
    if (!a) return false;
    outer: for (const chord of a.binds) {
      for (const code of chord) if (!this.down.has(code)) continue outer;
      return true;
    }
    return false;
  }

  pressed(actionId) { return this.edge.has(actionId); }

  // Signed wheel ticks accumulated since last consumeFrame (WT: wheel = throttle).
  wheelDelta() { return this.mouse.wheel; }

  rebind(actionId, chord) {
    if (!this.actions[actionId] || !chord?.length) return false;
    this.actions[actionId].binds = [chord];
    this._rebuildIndex();
    const out = {};
    for (const [id, a] of Object.entries(this.actions)) {
      const def = ACTIONS[id].binds.map((c) => c.join("+")).join(",");
      const cur = a.binds.map((c) => c.join("+")).join(",");
      if (def !== cur) out[id] = a.binds[0].join("+");
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(out));
    return true;
  }

  resetBinds() {
    localStorage.removeItem(STORE_KEY);
    this.actions = this._load();
    this._rebuildIndex();
  }

  bindsOf(actionId) { return this.actions[actionId]?.binds.map((c) => c.join("+")) || []; }

  consumeFrame() {
    this.edge.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }
}
