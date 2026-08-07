// RAPTOR HUD v1 — F-22 symbology fused with War Thunder arcade readability.
// Pure UI module: NO three.js / engine / game imports. Consumes a flat state
// object via update(state); everything else (resize, DOM) is self-contained.
//
// Renders as an SVG overlay rather than canvas: vector paths rasterize at the
// browser's native device-pixel-ratio with zero extra code, so text/lines stay
// crisp on a 1x laptop panel and a 3x phone alike — a canvas 2D HUD would need
// manual devicePixelRatio scaling to match.
//
// Layers (back to front): (a) F-22 core flight symbology — pitch ladder,
// flight-path marker, boresight, speed/alt tapes, heading tape, G/Mach/AoA
// block, throttle block; (b) WT-arcade hooks — enemy markers + lead indicator
// (mid-screen, under the tapes) and damage silhouette + ammo + kill feed
// (corners, over the tapes) — empty groups until sensors/weapons (phase 8),
// toggled together by setMode().
//
// See .context/raptor/design/HUD-INTEGRATION.md for the main.js wiring seam
// and .context/raptor/qa/hud-math.mjs for numeric proof of the ladder geometry
// below (imported directly from this file — one source of truth, DOM-free).

const SVGNS = "http://www.w3.org/2000/svg";
const GREEN = "#9be89b";
const GREEN_DIM = "rgba(155,232,155,.6)";
const FONT = "'SF Mono', ui-monospace, Menlo, Consolas, monospace";

// ---------------------------------------------------------------------------
// Pure geometry. No DOM references anywhere in this section — importable
// straight into Node for the qa battery. This is the ONLY place ladder/FPM
// screen math is computed; the class below calls these, never reimplements.
// ---------------------------------------------------------------------------

export const VFOV_DEG = 40;        // pitch degrees spanning the full screen height
export const LADDER_RUNG_STEP = 5; // degrees between rungs
export const LADDER_GAP = 34;      // px either side of boresight left un-drawn
export const LADDER_HALF_W = 130;  // px length of each rung segment beyond the gap
export const FPM_CAGE_PX = 150;    // px — FPM pins near the reticle at extreme AoA

// pixels per degree of pitch, from viewport height.
export function pxPerDegree(heightPx, vfovDeg = VFOV_DEG) {
  return heightPx / vfovDeg;
}

// Rotate a boresight-relative offset (dx,dy) by rollDeg and place it in screen
// space at (cx,cy). Screen convention: +rollDeg = right bank (right wing
// down). A right bank must lift the RIGHT end of the horizon line (true on
// every ADI/HUD ever built — bank right and the horizon tilts up to your
// right) which, in SVG's y-down/clockwise-positive rotate(), means rotating
// the ladder by -rollDeg: rotate(-rollDeg) turns local +x (right) toward
// -y (up on screen). That is the entire sign convention this file uses.
export function rotateAround(dx, dy, rollDeg, cx, cy) {
  const th = -rollDeg * Math.PI / 180;
  const c = Math.cos(th), s = Math.sin(th);
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

// Screen point for one sample along a ladder rung line at world pitch angle
// `rungPitchDeg`, given the aircraft's current pitch/roll. `localX` is the
// signed distance from the boresight along the rung (0 = center); `localYOff`
// is an extra pre-rotation vertical nudge (used for the small end-cap ticks).
// A rung drawn horizontally in the aircraft's own pitch-plane, at height
// (pitchDeg - rungPitchDeg)*pxPerDeg above the boresight, reproduces the
// classic "ladder scrolls opposite pitch, spins with roll" behavior.
export function rungPoint(rungPitchDeg, pitchDeg, rollDeg, cx, cy, pxPerDeg, localX = 0, localYOff = 0) {
  const localY = (pitchDeg - rungPitchDeg) * pxPerDeg + localYOff;
  return rotateAround(localX, localY, rollDeg, cx, cy);
}

// Flight-path marker: offset from the boresight by AoA — the nose (boresight)
// sits `aoa` degrees ABOVE the true flight path in the zero-sideslip case (no
// beta in the v1 state vector), so the FPM sags below the boresight by AoA.
// It rotates with roll (it lives in the aircraft's pitch plane, same as the
// ladder) and is caged near the boresight past cageRadiusPx, matching real
// FPM behavior at extreme AoA (post-stall the marker pins near the reticle
// edge rather than wandering off-screen).
export function fpmPoint(aoaDeg, rollDeg, cx, cy, pxPerDeg, cageRadiusPx = FPM_CAGE_PX) {
  let dy = aoaDeg * pxPerDeg;
  if (dy > cageRadiusPx) dy = cageRadiusPx;
  if (dy < -cageRadiusPx) dy = -cageRadiusPx;
  return rotateAround(0, dy, rollDeg, cx, cy);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function el(tag, attrs, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  for (const k of kids) e.appendChild(k);
  return e;
}

function txt(x, y, s, attrs = {}) {
  const t = el("text", { x, y, fill: GREEN, "font-family": FONT, "font-size": 11, ...attrs });
  t.textContent = s;
  return t;
}

// normalize an angle delta to (-180, 180]
function angDelta(a, b) {
  return ((a - b + 540) % 360) - 180;
}

const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : (0).toFixed(d));

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

export class HUD {
  constructor({ parent = document.body } = {}) {
    this.parent = parent;
    this.mode = "arcade";
    this.uid = "hud" + Math.random().toString(36).slice(2, 8);

    const svg = el("svg", {
      id: "raptorHud",
      // z-index:3 is explicit on purpose — sits above #game (implicit 0) and
      // below index.html's #chrome(5)/#dbg(6)/#controls(8)/#veil(10), without
      // depending on DOM insertion order. See HUD-INTEGRATION.md.
      style: "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;",
    });

    const defs = el("defs", {});
    this.clipRect = el("rect", { x: 0, y: 0, width: 0, height: 0 });
    defs.appendChild(el("clipPath", { id: this.uid + "-clip" }, this.clipRect));
    svg.appendChild(defs);

    svg.appendChild(el("style", {}, document.createTextNode(
      `#raptorHud text{fill:${GREEN};font-family:${FONT};}` +
      `#raptorHud .dim{fill:${GREEN_DIM};}` +
      `#raptorHud line,#raptorHud path,#raptorHud rect{vector-effect:non-scaling-stroke;}`
    )));

    // -- core layer, back-to-front. Built as siblings directly on <svg> (not
    // nested under one "core" group) so the WT-arcade mid layer below can sit
    // between the ladder and the tapes/blocks in actual DOM z-order.
    const centerClip = el("g", { "clip-path": `url(#${this.uid}-clip)` });
    this.ladderG = el("g", { class: "hud-ladder", stroke: GREEN, fill: "none" });
    this.fpmG = el("g", { class: "hud-fpm", stroke: GREEN, fill: "none" });
    centerClip.appendChild(this.ladderG);
    centerClip.appendChild(this.fpmG);
    svg.appendChild(centerClip);

    // -- WT-arcade hooks, mid layer: empty until phase 8/9 wire sensors +
    // weapons. Sits over the ladder but UNDER the tapes/blocks (which must
    // always stay readable). Toggled with the corner layer below via setMode().
    this.arcadeMid = el("g", { class: "hud-arcade-mid" });
    this.leadG = el("g", { class: "hud-lead", "data-hud-layer": "leadIndicator" });
    this.enemiesG = el("g", { class: "hud-enemies", "data-hud-layer": "enemyMarkers" });
    this.arcadeMid.appendChild(this.leadG);
    this.arcadeMid.appendChild(this.enemiesG);
    svg.appendChild(this.arcadeMid);

    this.boresightG = el("g", { class: "hud-boresight", stroke: GREEN, fill: "none" });
    this.spdG = el("g", { class: "hud-tape-spd", stroke: GREEN, fill: "none" });
    this.altG = el("g", { class: "hud-tape-alt", stroke: GREEN, fill: "none" });
    this.hdgG = el("g", { class: "hud-tape-hdg", stroke: GREEN, fill: "none" });
    this.gmaG = el("g", { class: "hud-block-gma" });
    this.thrG = el("g", { class: "hud-block-throttle" });
    svg.appendChild(this.boresightG);
    svg.appendChild(this.spdG);
    svg.appendChild(this.altG);
    svg.appendChild(this.hdgG);
    svg.appendChild(this.gmaG);
    svg.appendChild(this.thrG);

    // -- WT-arcade hooks, corner layer: damage silhouette / ammo / kill feed
    // sit OVER the tapes/blocks (HUD chrome, not mid-screen game elements).
    this.arcadeTop = el("g", { class: "hud-arcade-top" });
    this.damageG = el("g", { class: "hud-damage", "data-hud-layer": "damageSilhouette", transform: "translate(0,0)" });
    this.ammoG = el("g", { class: "hud-ammo", "data-hud-layer": "ammoCounts", transform: "translate(0,0)" });
    this.killfeedG = el("g", { class: "hud-killfeed", "data-hud-layer": "killFeed", transform: "translate(0,0)" });
    this.arcadeTop.appendChild(this.damageG);
    this.arcadeTop.appendChild(this.ammoG);
    this.arcadeTop.appendChild(this.killfeedG);
    svg.appendChild(this.arcadeTop);

    this.svg = svg;
    parent.appendChild(svg);

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    this.resize();
    this.setMode(this.mode);
  }

  // recompute layout metrics from the parent's current box. Cheap; call on
  // resize only, never per-frame.
  resize() {
    const r = this.parent.getBoundingClientRect ? this.parent.getBoundingClientRect() : null;
    const W = (r && r.width) || window.innerWidth;
    const H = (r && r.height) || window.innerHeight;
    this.W = W; this.H = H;
    this.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    this.cx = W / 2;
    this.cy = H / 2;
    this.pxPerDeg = pxPerDegree(H);

    this.spdX = 74;
    this.altX = W - 74;
    this.hdgY = 20; // heading tick row baseline — see HDG_* layout in _drawHeadingTape

    // ladder/fpm clip: a centered window that stays clear of both tapes, the
    // heading tape (labels+ticks+caret+box bottom edge = hdgY+50), and the
    // bottom corner blocks, at every pitch/roll.
    const left = this.spdX + 56, right = this.altX - 56;
    const top = this.hdgY + 64, bottom = H - 96;
    this.clipRect.setAttribute("x", left);
    this.clipRect.setAttribute("y", top);
    this.clipRect.setAttribute("width", Math.max(0, right - left));
    this.clipRect.setAttribute("height", Math.max(0, bottom - top));
  }

  setMode(mode) {
    this.mode = mode === "realistic" ? "realistic" : "arcade";
    const show = this.mode === "arcade" ? "inline" : "none";
    this.arcadeMid.style.display = show;
    this.arcadeTop.style.display = show;
  }

  dispose() {
    window.removeEventListener("resize", this._onResize);
    this.svg.remove();
  }

  // ---- per-frame ----
  update(state = {}) {
    const s = {
      speedKt: 0, altFt: 0, heading: 0, pitch: 0, roll: 0,
      g: 1, mach: 0, aoa: 0, throttle: 0, ...state,
    };
    this._drawLadder(s.pitch, s.roll);
    this._drawFpm(s.pitch, s.roll, s.aoa);
    this._drawBoresight();
    this._drawSpeedTape(s.speedKt);
    this._drawAltTape(s.altFt);
    this._drawHeadingTape(s.heading);
    this._drawGma(s.g, s.mach, s.aoa);
    this._drawThrottle(s.throttle);
  }

  // -- pitch ladder --------------------------------------------------------
  _drawLadder(pitchDeg, rollDeg) {
    const g = this.ladderG;
    g.textContent = "";
    const { cx, cy, pxPerDeg } = this;
    const half = VFOV_DEG / 2 + LADDER_RUNG_STEP * 2;
    const lo = Math.ceil((pitchDeg - half) / LADDER_RUNG_STEP) * LADDER_RUNG_STEP;
    const hi = Math.floor((pitchDeg + half) / LADDER_RUNG_STEP) * LADDER_RUNG_STEP;

    for (let r = lo; r <= hi; r += LADDER_RUNG_STEP) {
      if (r < -90 || r > 90) continue;
      const horizon = r === 0;
      const dash = r < 0 ? "7,6" : null;
      const tickLen = horizon ? 0 : 9;
      const tickDir = r > 0 ? 1 : -1; // end-caps bend TOWARD the horizon

      for (const side of [-1, 1]) {
        const innerX = side * LADDER_GAP;
        const outerX = side * (LADDER_GAP + LADDER_HALF_W);
        const p1 = rungPoint(r, pitchDeg, rollDeg, cx, cy, pxPerDeg, innerX);
        const p2 = rungPoint(r, pitchDeg, rollDeg, cx, cy, pxPerDeg, outerX);
        const line = el("line", {
          x1: p1.x.toFixed(1), y1: p1.y.toFixed(1), x2: p2.x.toFixed(1), y2: p2.y.toFixed(1),
          "stroke-width": horizon ? 2 : 1.4,
        });
        if (dash) line.setAttribute("stroke-dasharray", dash);
        g.appendChild(line);

        if (tickLen) {
          const p3 = rungPoint(r, pitchDeg, rollDeg, cx, cy, pxPerDeg, outerX, tickDir * tickLen);
          g.appendChild(el("line", {
            x1: p2.x.toFixed(1), y1: p2.y.toFixed(1), x2: p3.x.toFixed(1), y2: p3.y.toFixed(1),
            "stroke-width": 1.4,
          }));
          // label stands off PAST the tick tip along the tick's own direction
          // (not along the rung line) — a fixed clear gap at every roll angle,
          // since "further along the line" collapses to near-zero separation
          // once the roll rotates the tick to be nearly parallel with the line.
          const lp = rungPoint(r, pitchDeg, rollDeg, cx, cy, pxPerDeg, outerX, tickDir * (tickLen + 11));
          g.appendChild(txt(lp.x, lp.y, String(Math.abs(r)), {
            "text-anchor": side < 0 ? "end" : "start", "dominant-baseline": "middle", "font-size": 11,
          }));
        }
      }
    }
  }

  // -- flight-path marker (velocity vector) --------------------------------
  _drawFpm(pitchDeg, rollDeg, aoaDeg) {
    const g = this.fpmG;
    g.textContent = "";
    const { cx, cy, pxPerDeg } = this;
    const p = fpmPoint(aoaDeg, rollDeg, cx, cy, pxPerDeg);
    const wing = 15, tail = 11, r = 6;
    // wings + tail drawn in the FPM's own local frame, then rotated with roll
    // (same reasoning as the ladder: this symbol lives in the pitch plane).
    const L = rotateAround(-(r + wing), 0, rollDeg, p.x, p.y);
    const Li = rotateAround(-r, 0, rollDeg, p.x, p.y);
    const R = rotateAround(r + wing, 0, rollDeg, p.x, p.y);
    const Ri = rotateAround(r, 0, rollDeg, p.x, p.y);
    const T = rotateAround(0, -(r + tail), rollDeg, p.x, p.y);
    const Ti = rotateAround(0, -r, rollDeg, p.x, p.y);
    g.appendChild(el("circle", { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r, "stroke-width": 1.6 }));
    g.appendChild(el("line", { x1: L.x.toFixed(1), y1: L.y.toFixed(1), x2: Li.x.toFixed(1), y2: Li.y.toFixed(1), "stroke-width": 1.6 }));
    g.appendChild(el("line", { x1: R.x.toFixed(1), y1: R.y.toFixed(1), x2: Ri.x.toFixed(1), y2: Ri.y.toFixed(1), "stroke-width": 1.6 }));
    g.appendChild(el("line", { x1: T.x.toFixed(1), y1: T.y.toFixed(1), x2: Ti.x.toFixed(1), y2: Ti.y.toFixed(1), "stroke-width": 1.6 }));
  }

  // -- boresight cross (airframe-fixed — never rotates/translates). Redrawn
  // each update() (cheap, 5 elements) rather than cached, so it tracks cx/cy
  // correctly if a resize happens between frames.
  _drawBoresight() {
    const { cx, cy } = this;
    const g = this.boresightG;
    g.textContent = "";
    const gap = 5, len = 9;
    g.appendChild(el("circle", { cx, cy, r: 2, fill: GREEN, stroke: "none" }));
    g.appendChild(el("line", { x1: cx - gap - len, y1: cy, x2: cx - gap, y2: cy, "stroke-width": 1.4 }));
    g.appendChild(el("line", { x1: cx + gap, y1: cy, x2: cx + gap + len, y2: cy, "stroke-width": 1.4 }));
    g.appendChild(el("line", { x1: cx, y1: cy - gap - len, x2: cx, y2: cy - gap, "stroke-width": 1.4 }));
    g.appendChild(el("line", { x1: cx, y1: cy + gap, x2: cx, y2: cy + gap + len, "stroke-width": 1.4 }));
  }

  // -- airspeed tape (left, kt) --------------------------------------------
  _drawSpeedTape(speedKt) {
    this._drawVTape(this.spdG, this.spdX, speedKt, {
      pxPerUnit: 2.1, minorStep: 20, majorStep: 100, halfRangeUnits: 140,
      min: 0, boxDecimals: 0,
    });
  }

  // -- altitude tape (right, ft) -------------------------------------------
  _drawAltTape(altFt) {
    this._drawVTape(this.altG, this.altX, altFt, {
      pxPerUnit: 0.42, minorStep: 100, majorStep: 500, halfRangeUnits: 1400,
      min: -1000, boxDecimals: 0,
    });
  }

  // shared vertical-tape renderer: scrolling ticks + a boxed current value
  // pinned at cy. Higher value = higher on screen (climb/accelerate = up).
  // No continuous rail is drawn (ticks only) — a fixed-length spine would
  // mismatch whatever range is actually visible, so it's simpler to skip it.
  _drawVTape(g, x, value, { pxPerUnit, minorStep, majorStep, halfRangeUnits, min, boxDecimals }) {
    g.textContent = "";
    const { cy } = this;
    const boxW = 58, boxH = 22;
    const exclude = boxH / 2 + 5; // the box sits over the tape — don't draw ticks/labels under it
    const lo = Math.ceil(Math.max(min, value - halfRangeUnits) / minorStep) * minorStep;
    const hi = Math.floor((value + halfRangeUnits) / minorStep) * minorStep;
    for (let v = lo; v <= hi; v += minorStep) {
      const y = cy - (v - value) * pxPerUnit;
      if (Math.abs(y - cy) < exclude) continue;
      const major = Math.round(v / majorStep) * majorStep === v;
      const w = major ? 14 : 7;
      g.appendChild(el("line", { x1: x - w, y1: y.toFixed(1), x2: x + w, y2: y.toFixed(1), "stroke-width": major ? 1.6 : 1 }));
      if (major) {
        g.appendChild(txt(x - w - 6, y, String(Math.round(v)), { "text-anchor": "end", "dominant-baseline": "middle", "font-size": 11 }));
      }
    }
    g.appendChild(el("rect", { x: x - boxW / 2, y: cy - boxH / 2, width: boxW, height: boxH, "stroke-width": 1.6 }));
    g.appendChild(txt(x, cy, fmt(value, boxDecimals), {
      "text-anchor": "middle", "dominant-baseline": "middle", "font-size": 15, "font-weight": 700,
    }));
  }

  // -- heading tape (top) ---------------------------------------------------
  // Layout, top to bottom, all within the viewport (nothing above y=4):
  // major-tick labels (y=hdgY-6) -> tick row (y=hdgY..+12) -> up-caret
  // (hdgY+16..+26) -> boxed 3-digit readout (hdgY+30..+50). resize() keeps
  // the ladder clip clear of all of it (top = hdgY+64).
  _drawHeadingTape(headingDeg) {
    const g = this.hdgG;
    g.textContent = "";
    const { cx, hdgY } = this;
    const pxPerDeg = 4, step = 10, halfRange = 65;
    const hdg = ((headingDeg % 360) + 360) % 360;

    for (let d = -halfRange; d <= halfRange; d += step) {
      const tickHdg = (Math.round((hdg + d) / step) * step + 3600) % 360;
      const delta = angDelta(tickHdg, hdg);
      if (Math.abs(delta) > halfRange) continue;
      const x = cx + delta * pxPerDeg;
      const major = tickHdg % 30 === 0;
      g.appendChild(el("line", { x1: x.toFixed(1), y1: hdgY, x2: x.toFixed(1), y2: hdgY + (major ? 12 : 6), "stroke-width": major ? 1.6 : 1 }));
      if (major && Math.abs(x - cx) > 18) { // the box below stands in for a label at dead center
        const label = String(Math.round(tickHdg / 10)).padStart(2, "0");
        g.appendChild(txt(x, hdgY - 6, label, { "text-anchor": "middle", "font-size": 11 }));
      }
    }

    // up-caret (points into the tick row from below) + boxed 3-digit readout
    g.appendChild(el("path", { d: `M${cx - 6},${hdgY + 26} L${cx},${hdgY + 16} L${cx + 6},${hdgY + 26}`, "stroke-width": 1.6 }));
    const boxW = 44, boxH = 20, by = hdgY + 30;
    g.appendChild(el("rect", { x: cx - boxW / 2, y: by, width: boxW, height: boxH, "stroke-width": 1.6 }));
    g.appendChild(txt(cx, by + boxH / 2, String(Math.round(hdg)).padStart(3, "0"), {
      "text-anchor": "middle", "dominant-baseline": "middle", "font-size": 13, "font-weight": 700,
    }));
  }

  // -- G / Mach / AoA block (lower-left) -----------------------------------
  _drawGma(g, mach, aoa) {
    const grp = this.gmaG;
    grp.textContent = "";
    const x0 = 20, rows = this.H - 84;
    const lines = [
      ["G", fmt(g, 1)],
      ["M", fmt(mach, 2)],
      ["AOA", fmt(aoa, 1)],
    ];
    lines.forEach(([label, val], i) => {
      const y = rows + i * 22;
      grp.appendChild(txt(x0, y, label, { class: "dim", "font-size": 11 }));
      grp.appendChild(txt(x0 + 40, y, val, { "font-size": 15, "font-weight": 700 }));
    });
  }

  // -- throttle % (lower-right; >100% = afterburner) -----------------------
  _drawThrottle(throttle) {
    const grp = this.thrG;
    grp.textContent = "";
    const x1 = this.W - 20, y0 = this.H - 84;
    const ab = throttle > 100;
    grp.appendChild(txt(x1, y0, "THR", { class: "dim", "text-anchor": "end", "font-size": 11 }));
    grp.appendChild(txt(x1, y0 + 24, ab ? "AB" : `${Math.round(throttle)}%`, {
      "text-anchor": "end", "font-size": 19, "font-weight": 700,
    }));
    if (ab) {
      grp.appendChild(txt(x1, y0 + 40, `${Math.round(throttle)}%`, { class: "dim", "text-anchor": "end", "font-size": 10 }));
    }
  }
}
