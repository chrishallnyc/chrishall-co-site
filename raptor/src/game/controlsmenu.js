// Controls screen — WT-style: category sections, every action's binds shown as
// key chips, click a row to capture a new chord (held modifiers + final key,
// mouse buttons allowed, Escape cancels). Duplicate chords introduced by USER
// rebinds get a "shared" chip; WT's own shipped overlaps (Mouse0, Space, T…)
// are intentional and stay quiet. Esc (WT "menu") toggles the screen.

import { ACTIONS } from "../engine/binds.js";

const CAT_ORDER = ["flight", "weapons", "countermeasures", "sensors", "view", "systems", "interface", "raptor"];
const CAT_LABEL = {
  flight: "FLIGHT", weapons: "WEAPONS", countermeasures: "COUNTERMEASURES",
  sensors: "RADAR / SENSORS", view: "VIEW / TARGETING", systems: "AIRCRAFT SYSTEMS",
  interface: "INTERFACE", raptor: "RAPTOR",
};
const MODS = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"]);

const NICE = { Mouse0: "LMB", Mouse1: "MMB", Mouse2: "RMB", Mouse3: "MOUSE 4", Mouse4: "MOUSE 5" };
function keyName(code) {
  if (NICE[code]) return NICE[code];
  return code
    .replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "NUM ")
    .replace("ShiftLeft", "LSHIFT").replace("ShiftRight", "RSHIFT")
    .replace("ControlLeft", "LCTRL").replace("ControlRight", "RCTRL")
    .replace("AltLeft", "LALT").replace("AltRight", "RALT")
    .replace("ArrowUp", "UP").replace("ArrowDown", "DOWN")
    .replace("ArrowLeft", "LEFT").replace("ArrowRight", "RIGHT")
    .replace("BracketLeft", "[").replace("BracketRight", "]")
    .replace("Backquote", "`").replace("Semicolon", ";").replace("Quote", "'")
    .replace("Period", ".").replace("Minus", "-").replace("Equal", "=")
    .toUpperCase();
}
const chordName = (chord) => chord.map(keyName).join(" + ");

// chords that ship duplicated in WT's own defaults — never warn on these
const SHIPPED = new Set();
for (const a of Object.values(ACTIONS))
  for (const c of a.binds) {
    const s = c.join("+");
    if (SHIPPED.has("seen:" + s)) SHIPPED.add(s);
    SHIPPED.add("seen:" + s);
  }

export class ControlsMenu {
  constructor(input) {
    this.input = input;
    this.open = false;
    this.capturing = null; // action id while waiting for a chord
    this._heldMods = [];

    this.el = document.createElement("div");
    this.el.id = "controls";
    document.body.appendChild(this.el);

    // capture-phase listeners so the game never sees menu interactions
    window.addEventListener("keydown", (e) => this._onKey(e), true);
    window.addEventListener("keyup", (e) => { if (this.capturing) e.stopPropagation(); }, true);
    window.addEventListener("mousedown", (e) => this._onMouse(e), true);
    this._render();
  }

  toggle() { this.open ? this.close() : this.show(); }

  show() {
    this.open = true;
    this.input.suspended = true;
    this.el.classList.add("open");
    this._render();
  }

  close() {
    this.open = false;
    this.capturing = null;
    this.input.suspended = false;
    this.input.down.clear(); // no stale held keys leak back into the game
    this.el.classList.remove("open");
  }

  _onKey(e) {
    if (!this.open) return;
    e.stopPropagation();
    if (this.capturing) {
      e.preventDefault();
      if (e.code === "Escape") { this.capturing = null; this._heldMods = []; this._render(); return; }
      if (MODS.has(e.code)) {
        if (!this._heldMods.includes(e.code)) this._heldMods.push(e.code);
        this._render();
        return;
      }
      this._finish([...this._heldMods, e.code]);
      return;
    }
    if (e.code === "Escape") { e.preventDefault(); this.close(); }
  }

  _onMouse(e) {
    if (!this.open || !this.capturing) return;
    if (e.target.closest("#controls .row")) return; // row clicks handled below
    e.stopPropagation(); e.preventDefault();
    this._finish([...this._heldMods, "Mouse" + e.button]);
  }

  _finish(chord) {
    this.input.rebind(this.capturing, chord);
    this.capturing = null;
    this._heldMods = [];
    this._render();
  }

  _dupes() {
    const seen = new Map(), dupes = new Set();
    for (const [id, a] of Object.entries(this.input.actions))
      for (const c of a.binds) {
        const s = c.join("+");
        if (SHIPPED.has(s)) continue;
        if (seen.has(s)) { dupes.add(id); dupes.add(seen.get(s)); }
        seen.set(s, id);
      }
    return dupes;
  }

  _render() {
    if (!this.el) return;
    const dupes = this._dupes();
    let html = `<div class="cwrap"><div class="chead"><span class="ctitle">CONTROLS</span>
      <span class="cnote">click a row · press keys to bind · esc closes</span>
      <button class="creset" type="button">reset to war thunder defaults</button></div>`;
    for (const cat of CAT_ORDER) {
      const rows = Object.entries(this.input.actions).filter(([, a]) => a.cat === cat);
      if (!rows.length) continue;
      html += `<div class="csec">${CAT_LABEL[cat]}</div>`;
      for (const [id, a] of rows) {
        const capturing = this.capturing === id;
        const chips = capturing
          ? `<span class="chip live">${this._heldMods.length ? chordName(this._heldMods) + " + …" : "press a key…"}</span>`
          : a.binds.map((c) => `<span class="chip">${chordName(c)}</span>`).join("");
        html += `<div class="row${capturing ? " cap" : ""}" data-id="${id}">
          <span class="rlabel">${a.label}${dupes.has(id) ? ` <span class="chip warn">shared</span>` : ""}</span>
          <span class="rbinds">${chips}</span></div>`;
      }
    }
    html += `</div>`;
    this.el.innerHTML = html;
    this.el.querySelectorAll(".row").forEach((r) =>
      r.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        this.capturing = r.dataset.id;
        this._heldMods = [];
        this._render();
      }));
    this.el.querySelector(".creset")?.addEventListener("click", () => {
      this.input.resetBinds();
      this._render();
    });
  }
}
