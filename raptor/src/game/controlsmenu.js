// Controls screen — WT-style: category sections, every action's binds shown as
// key chips, click a row to capture a new chord (held modifiers + final key,
// mouse buttons allowed, Escape cancels). Duplicate chords introduced by USER
// rebinds get a "shared" chip; WT's own shipped overlaps (Mouse0, Space, T…)
// are intentional and stay quiet. Esc (WT "menu") toggles the screen.
//
// PHASE 15: a SETTINGS section rides at the top of the same screen — tier
// picker, render scale, FOV, audio mixer, motion reduction, subtitle scale,
// colorblind marker palettes. Settings rows use .srow (NOT .row) so the bind
// capture machinery and the dupe scan never see them. Each row wears an honest
// LIVE/STORED chip: LIVE only when settings.bindLive() has a target for it.

import { ACTIONS } from "../engine/binds.js";
import { current, saveSettings, resetSettings, hasLive } from "./settings.js";
import { TIERS, tierParams, hasManualTier, savedBench } from "../engine/quality.js";

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

  _fmtVal(key, v) {
    if (key === "fov") return Math.round(v) + "°";
    if (key === "renderScale") return v.toFixed(2) + "×";
    if (key === "subtitleScale") return v.toFixed(1) + "×";
    return Math.round(v * 100) + "%";
  }

  _settingsHtml() {
    const s = current();
    const boot = (window.__RAPTOR && window.__RAPTOR.tier) || null; // boot-resolved tier
    // honest reload accounting: render scale / pixelRatio applies live (when
    // bound); shadows/clouds/post only read tierParams at boot -> reload chip
    // whenever the picked tier resolves differently from the one running now
    let reloadNote = "";
    if (boot) {
      if (s.tier === "AUTO") {
        const b = savedBench();
        if (hasManualTier() || !b || b.tier !== boot) reloadNote = "re-benchmarks after reload";
      } else if (s.tier !== boot) {
        reloadNote = "shadows/clouds/post after reload";
      }
    }
    const liveChip = (on) => `<span class="chip${on ? " live" : ""}">${on ? "live" : "stored"}</span>`;
    const tierChips = ["AUTO", ...Object.keys(TIERS)].map((t) => {
      const label = t === "AUTO" && boot && s.tier === "AUTO" ? `AUTO (${boot})` : t;
      return `<button type="button" class="chip tierchip${s.tier === t ? " sel" : ""}" data-tier="${t}">${label}</button>`;
    }).join("");
    const rsBase = tierParams(s.tier === "AUTO" ? (boot || "MED") : s.tier).renderScale;
    const rsVal = s.renderScale === null ? rsBase : s.renderScale;
    const slider = (key, label, lo, hi, step, val, txt, on) =>
      `<div class="srow"><span class="rlabel">${label}</span><span class="schips">${liveChip(on)}<input type="range" class="srange" id="set-${key}" data-key="${key}" min="${lo}" max="${hi}" step="${step}" value="${val}"><span class="sval" id="sval-${key}">${txt}</span></span></div>`;
    const audioOn = hasLive("audio");
    const hudOn = hasLive("hudLive");
    let h = `<div class="csec">SETTINGS</div>`;
    h += `<div class="srow"><span class="rlabel">GRAPHICS QUALITY${reloadNote ? ` <span class="chip warn">${reloadNote}</span>` : ""}</span>
      <span class="schips">${tierChips}</span></div>`;
    h += slider("renderScale", "RENDER SCALE", 0.5, 1.5, 0.05, rsVal,
      (s.renderScale === null ? "auto " : "") + rsVal.toFixed(2) + "×", hasLive("renderer"));
    h += slider("fov", "FIELD OF VIEW", 45, 90, 1, s.fov, Math.round(s.fov) + "°", hasLive("camera"));
    h += slider("masterVol", "MASTER VOLUME", 0, 1, 0.05, s.masterVol, Math.round(s.masterVol * 100) + "%", audioOn);
    h += slider("engineVol", "ENGINE VOLUME", 0, 1, 0.05, s.engineVol, Math.round(s.engineVol * 100) + "%", audioOn);
    h += slider("uiVol", "UI / TONES VOLUME", 0, 1, 0.05, s.uiVol, Math.round(s.uiVol * 100) + "%", audioOn);
    h += `<div class="srow"><span class="rlabel">MOTION REDUCTION</span><span class="schips">${liveChip(hudOn || hasLive("gunFlash"))}
      <button type="button" class="chip motionchip${!s.motionReduce ? " sel" : ""}" data-v="0">OFF</button>
      <button type="button" class="chip motionchip${s.motionReduce ? " sel" : ""}" data-v="1">ON</button></span></div>`;
    h += slider("subtitleScale", "SUBTITLE SCALE", 0.8, 1.6, 0.1, s.subtitleScale, s.subtitleScale.toFixed(1) + "×", hudOn);
    h += `<div class="srow"><span class="rlabel">MARKER PALETTE</span><span class="schips">${liveChip(hudOn)}
      ${["default", "deuteranopia", "tritanopia"].map((p) =>
        `<button type="button" class="chip palchip${s.markerPalette === p ? " sel" : ""}" data-pal="${p}">${p.toUpperCase()}</button>`).join("")}</span></div>`;
    h += `<div class="srow"><span class="rlabel">RESET</span><span class="schips"><button type="button" class="sreset" id="setReset">reset to auto (re-bench + defaults)</button></span></div>`;
    return h;
  }

  _wireSettings() {
    this.el.querySelectorAll(".tierchip").forEach((b) =>
      b.addEventListener("click", () => { saveSettings({ tier: b.dataset.tier }); this._render(); }));
    this.el.querySelectorAll(".motionchip").forEach((b) =>
      b.addEventListener("click", () => { saveSettings({ motionReduce: b.dataset.v === "1" }); this._render(); }));
    this.el.querySelectorAll(".palchip").forEach((b) =>
      b.addEventListener("click", () => { saveSettings({ markerPalette: b.dataset.pal }); this._render(); }));
    this.el.querySelectorAll(".srange").forEach((r) =>
      r.addEventListener("input", () => {
        const key = r.dataset.key;
        const s = saveSettings({ [key]: parseFloat(r.value) });
        const sv = this.el.querySelector("#sval-" + key);
        if (sv) sv.textContent = this._fmtVal(key, s[key]); // no re-render mid-drag
      }));
    this.el.querySelector("#setReset")?.addEventListener("click", () => { resetSettings(); this._render(); });
  }

  _render() {
    if (!this.el) return;
    const dupes = this._dupes();
    let html = `<div class="cwrap"><div class="chead"><span class="ctitle">SETTINGS · CONTROLS</span>
      <span class="cnote">click a row · press keys to bind · esc closes</span>
      <button class="creset" type="button">reset to war thunder defaults</button></div>`;
    html += this._settingsHtml();
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
    this._wireSettings();
  }
}
