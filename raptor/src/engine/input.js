// Action-map input system. War Thunder's default air binds, taken exactly.
// CORE binds below are the WT layout confirmed from muscle memory + docs;
// the LONG TAIL (radar, weapon select, countermeasures, trim, airbrake...)
// lands from the verified bind-table research (.context/raptor/WT-CONTROLS.md)
// before those systems are coded — placeholders here are marked PENDING.

const STORE_KEY = "raptor:binds:v1";

// action id -> { key: KeyboardEvent.code | "MouseN" | "WheelUp/Down", label }
export const DEFAULT_BINDS = {
  // -- flight (WT mouse-aim scheme: mouse = pitch/roll target via instructor) --
  throttle_up:   { key: "KeyW", label: "throttle up" },
  throttle_down: { key: "KeyS", label: "throttle down" },
  rudder_left:   { key: "KeyA", label: "rudder left" },
  rudder_right:  { key: "KeyD", label: "rudder right" },
  roll_left:     { key: "KeyQ", label: "roll left" },
  roll_right:    { key: "KeyE", label: "roll right" },
  // -- weapons --
  fire_mg:       { key: "Mouse0", label: "fire machine guns" },
  fire_cannon:   { key: "Space", label: "fire cannons" },
  // PENDING research: missile fire, weapon selector, bomb/rocket, countermeasures
  // -- aircraft systems --
  gear:          { key: "KeyG", label: "landing gear" },
  flaps:         { key: "KeyF", label: "flaps" },
  // -- view --
  view_change:   { key: "KeyV", label: "change view" },
  freelook:      { key: "KeyC", label: "free look (hold)" },
  // -- interface --
  scoreboard:    { key: "Tab", label: "scoreboard" },
  map:           { key: "KeyM", label: "map" },
  pause:         { key: "Escape", label: "menu" },
  debug:         { key: "Backquote", label: "debug overlay" },
};

export class Input {
  constructor(target = window) {
    this.binds = this._load();
    this.down = new Set();        // currently-held bind keys
    this.pressedEdge = new Set(); // keys pressed since last consumeFrame()
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, dx: 0, dy: 0, wheel: 0 };
    this._keyToActions = new Map();
    this._rebuildIndex();

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressedEdge.add(e.code);
      if (this._keyToActions.has(e.code) && e.code !== "F5" && e.code !== "F12") {
        if (e.code === "Tab" || e.code === "Space") e.preventDefault();
      }
    };
    this._onKeyUp = (e) => this.down.delete(e.code);
    this._onMouseDown = (e) => { this.down.add("Mouse" + e.button); this.pressedEdge.add("Mouse" + e.button); };
    this._onMouseUp = (e) => this.down.delete("Mouse" + e.button);
    this._onMouseMove = (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.mouse.nx = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.ny = -((e.clientY / window.innerHeight) * 2 - 1);
      this.mouse.dx += e.movementX || 0; this.mouse.dy += e.movementY || 0;
    };
    this._onWheel = (e) => { this.mouse.wheel += Math.sign(e.deltaY); };
    this._onBlur = () => { this.down.clear(); };

    target.addEventListener("keydown", this._onKeyDown);
    target.addEventListener("keyup", this._onKeyUp);
    target.addEventListener("mousedown", this._onMouseDown);
    target.addEventListener("mouseup", this._onMouseUp);
    target.addEventListener("mousemove", this._onMouseMove);
    target.addEventListener("wheel", this._onWheel, { passive: true });
    target.addEventListener("blur", this._onBlur);
  }

  _load() {
    const binds = {};
    for (const [id, def] of Object.entries(DEFAULT_BINDS)) binds[id] = { ...def };
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      for (const [id, key] of Object.entries(saved)) if (binds[id]) binds[id].key = key;
    } catch (_) { /* fresh defaults */ }
    return binds;
  }

  _rebuildIndex() {
    this._keyToActions.clear();
    for (const [id, b] of Object.entries(this.binds)) {
      if (!this._keyToActions.has(b.key)) this._keyToActions.set(b.key, []);
      this._keyToActions.get(b.key).push(id);
    }
  }

  rebind(actionId, key) {
    if (!this.binds[actionId]) return false;
    this.binds[actionId].key = key;
    this._rebuildIndex();
    const out = {};
    for (const [id, b] of Object.entries(this.binds))
      if (b.key !== DEFAULT_BINDS[id]?.key) out[id] = b.key;
    localStorage.setItem(STORE_KEY, JSON.stringify(out));
    return true;
  }

  resetBinds() { localStorage.removeItem(STORE_KEY); this.binds = this._load(); this._rebuildIndex(); }

  held(actionId) { const b = this.binds[actionId]; return !!b && this.down.has(b.key); }
  pressed(actionId) { const b = this.binds[actionId]; return !!b && this.pressedEdge.has(b.key); }

  // Call once per rendered frame AFTER game code has sampled input.
  consumeFrame() {
    this.pressedEdge.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }
}
