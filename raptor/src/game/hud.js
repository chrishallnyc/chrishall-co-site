// RAPTOR HUD v2 — F-22 symbology fused with War Thunder arcade readability.
// Pure UI module: NO three.js / engine / game imports. Consumes a flat state
// object via update(state); everything else (resize, DOM) is self-contained.
//
// v2 renders to a single transparent <canvas> 2D context instead of an SVG
// overlay. The SVG version cost ~80fps in-game (26fps with vs 109 without at
// 1280x800 headed) because every update() rebuilt ~150 DOM nodes; a canvas
// redraw is a fraction of a millisecond with zero DOM churn. The canvas is
// devicePixelRatio-aware (backing store scaled by dpr, all drawing in CSS px)
// so text/lines stay crisp on a 1x laptop panel and a 3x phone alike.
//
// Layers (back to front, one immediate-mode pass per update()): (a) F-22 core
// flight symbology — pitch ladder, flight-path marker, boresight, speed/alt
// tapes, heading tape, G/Mach/AoA block, throttle block; (b) WT-arcade hooks —
// draw-callback registry (see arcadeLayer/arcadeTopLayer on the class) —
// empty until sensors/weapons (phase 8), skipped outside arcade mode.
//
// See .context/raptor/design/HUD-INTEGRATION.md for the main.js wiring seam
// and .context/raptor/qa/hud-math.mjs for numeric proof of the ladder geometry
// below (imported directly from this file — one source of truth, DOM-free).

const GREEN = "#9be89b";
const GREEN_DIM = "rgba(155,232,155,.6)";
const FONT = "'SF Mono', ui-monospace, Menlo, Consolas, monospace";
const TAU = Math.PI * 2;
const DASH = [7, 6];
const NO_DASH = [];

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
// right) which, in a y-down/clockwise-positive screen space (SVG and canvas
// alike), means rotating the ladder by -rollDeg: rotate(-rollDeg) turns local
// +x (right) toward -y (up on screen). That is the entire sign convention
// this file uses.
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
// canvas helpers
// ---------------------------------------------------------------------------

const font = (size, weight = 400) => `${weight} ${size}px ${FONT}`;

// stroke a batch of disjoint segments [x1,y1,x2,y2, ...] as ONE path — the
// per-stroke() fixed cost, not path length, dominates canvas 2D line drawing.
function strokeSegs(ctx, segs, width) {
  if (!segs.length) return;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let i = 0; i < segs.length; i += 4) {
    ctx.moveTo(segs[i], segs[i + 1]);
    ctx.lineTo(segs[i + 2], segs[i + 3]);
  }
  ctx.stroke();
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

    // WT-arcade layer hooks (phase 8/9): assign draw callbacks fn(ctx, hud).
    // Both are skipped outside arcade mode (setMode). Coordinates are CSS px
    // (dpr transform already applied); stroke/fill start as HUD green.
    //  - arcadeLayer: mid layer — enemy markers + lead indicator. Drawn OVER
    //    the ladder/FPM but UNDER the tapes/blocks (which must stay readable).
    //  - arcadeTopLayer: corner layer — damage silhouette / ammo / kill feed.
    //    Drawn last, over everything (HUD chrome, not mid-screen elements).
    this.arcadeLayer = null;
    this.arcadeTopLayer = null;

    // Additive vs plain alpha: measured in hudlab ?bench=1&blend=... —
    // 'lighter' 53.5k updates/s (0.0177ms/redraw) vs 'source-over' 55.3k
    // (0.0173ms), a ~3% delta, so the additive feel is kept. Overlapping
    // green strokes (line crossings, FPM over ladder) sum toward white like
    // a real phosphor HUD.
    this.composite = "lighter";

    const canvas = document.createElement("canvas");
    canvas.id = "raptorHud";
    // z-index:3 is explicit on purpose — sits above #game (implicit 0) and
    // below index.html's #chrome(5)/#dbg(6)/#controls(8)/#veil(10), without
    // depending on DOM insertion order. See HUD-INTEGRATION.md.
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;";
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    parent.appendChild(canvas);

    this._lastState = null;
    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    this.resize();
    this.setMode(this.mode);
  }

  // recompute layout metrics + backing-store size from the parent's current
  // box. Cheap; call on resize only, never per-frame.
  resize() {
    const r = this.parent.getBoundingClientRect ? this.parent.getBoundingClientRect() : null;
    const W = (r && r.width) || window.innerWidth;
    const H = (r && r.height) || window.innerHeight;
    this.W = W; this.H = H;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(W * this.dpr));
    this.canvas.height = Math.max(1, Math.round(H * this.dpr));
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
    this.clipBox = { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };

    // setting canvas.width wipes the bitmap — repaint rather than flash blank
    if (this._lastState) this._draw(this._lastState);
  }

  setMode(mode) {
    this.mode = mode === "realistic" ? "realistic" : "arcade";
    if (this._lastState) this._draw(this._lastState);
  }

  dispose() {
    window.removeEventListener("resize", this._onResize);
    this.canvas.remove();
  }

  // ---- per-frame ----
  update(state = {}) {
    const s = {
      speedKt: 0, altFt: 0, heading: 0, pitch: 0, roll: 0,
      g: 1, mach: 0, aoa: 0, throttle: 0, ...state,
    };
    this._lastState = s;
    this._draw(s);
  }

  _draw(s) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H); // clearRect ignores composite op
    ctx.globalCompositeOperation = this.composite;
    // (PASS-1 item 4: canvas shadowBlur halo measured -3fps headless — the
    // systemic halo moved to targeted plates; see _plate + deferred list)
    ctx.strokeStyle = GREEN;
    ctx.fillStyle = GREEN;

    // clipped center window: ladder + FPM only
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.clipBox.x, this.clipBox.y, this.clipBox.w, this.clipBox.h);
    ctx.clip();
    this._drawLadder(ctx, s.pitch, s.roll);
    this._drawFpm(ctx, s.roll, s.aoa);
    ctx.restore();

    // WT-arcade mid layer: over the ladder, under the tapes/blocks
    if (this.mode === "arcade" && this.arcadeLayer) {
      ctx.save(); this.arcadeLayer(ctx, this); ctx.restore();
    }

    this._drawBoresight(ctx);
    this._drawSpeedTape(ctx, s.speedKt);
    this._drawAltTape(ctx, s.altFt);
    this._drawHeadingTape(ctx, s.heading);
    this._drawGma(ctx, s.g, s.mach, s.aoa);
    this._drawThrottle(ctx, s.throttle);

    // WT-arcade corner layer: over everything
    if (this.mode === "arcade" && this.arcadeTopLayer) {
      ctx.save(); this.arcadeTopLayer(ctx, this); ctx.restore();
    }
  }

  // -- pitch ladder ---------------------------------------------------------
  _drawLadder(ctx, pitchDeg, rollDeg) {
    const { cx, cy, pxPerDeg } = this;
    const half = VFOV_DEG / 2 + LADDER_RUNG_STEP * 2;
    const lo = Math.ceil((pitchDeg - half) / LADDER_RUNG_STEP) * LADDER_RUNG_STEP;
    const hi = Math.floor((pitchDeg + half) / LADDER_RUNG_STEP) * LADDER_RUNG_STEP;

    // batch into 3 stroke passes (solid rungs+ticks 1.4 / dashed sub-horizon
    // rungs 1.4 / horizon 2) + one text pass
    const solid = [], dashed = [], horizon = [], labels = [];

    for (let r = lo; r <= hi; r += LADDER_RUNG_STEP) {
      if (r < -90 || r > 90) continue;
      const isHorizon = r === 0;
      const tickLen = isHorizon ? 0 : 9;
      const tickDir = r > 0 ? 1 : -1; // end-caps bend TOWARD the horizon

      for (const side of [-1, 1]) {
        const innerX = side * LADDER_GAP;
        const outerX = side * (LADDER_GAP + LADDER_HALF_W);
        const p1 = rungPoint(r, pitchDeg, rollDeg, cx, cy, pxPerDeg, innerX);
        const p2 = rungPoint(r, pitchDeg, rollDeg, cx, cy, pxPerDeg, outerX);
        (isHorizon ? horizon : r < 0 ? dashed : solid).push(p1.x, p1.y, p2.x, p2.y);

        if (tickLen) {
          const p3 = rungPoint(r, pitchDeg, rollDeg, cx, cy, pxPerDeg, outerX, tickDir * tickLen);
          solid.push(p2.x, p2.y, p3.x, p3.y); // end-cap ticks are always solid
          // label stands off PAST the tick tip along the tick's own direction
          // (not along the rung line) — a fixed clear gap at every roll angle,
          // since "further along the line" collapses to near-zero separation
          // once the roll rotates the tick to be nearly parallel with the line.
          const lp = rungPoint(r, pitchDeg, rollDeg, cx, cy, pxPerDeg, outerX, tickDir * (tickLen + 11));
          labels.push(lp.x, lp.y, Math.abs(r), side); // text upright at the rotated anchor
        }
      }
    }

    strokeSegs(ctx, solid, 1.4);
    if (dashed.length) {
      ctx.setLineDash(DASH);
      strokeSegs(ctx, dashed, 1.4);
      ctx.setLineDash(NO_DASH);
    }
    strokeSegs(ctx, horizon, 2);

    ctx.font = font(11);
    ctx.textBaseline = "middle";
    for (let i = 0; i < labels.length; i += 4) {
      ctx.textAlign = labels[i + 3] < 0 ? "right" : "left";
      ctx.fillText(String(labels[i + 2]), labels[i], labels[i + 1]);
    }
  }

  // -- flight-path marker (velocity vector) ---------------------------------
  _drawFpm(ctx, rollDeg, aoaDeg) {
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
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.moveTo(L.x, L.y); ctx.lineTo(Li.x, Li.y);
    ctx.moveTo(R.x, R.y); ctx.lineTo(Ri.x, Ri.y);
    ctx.moveTo(T.x, T.y); ctx.lineTo(Ti.x, Ti.y);
    ctx.stroke();
  }

  // -- boresight cross (airframe-fixed — never rotates/translates) ----------
  _drawBoresight(ctx) {
    const { cx, cy } = this;
    const gap = 5, len = 9;
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - gap - len, cy); ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
    ctx.moveTo(cx, cy - gap - len); ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
    ctx.stroke();
  }

  // -- airspeed tape (left, kt) ----------------------------------------------
  _drawSpeedTape(ctx, speedKt) {
    this._drawVTape(ctx, this.spdX, speedKt, {
      pxPerUnit: 2.1, minorStep: 20, majorStep: 100, halfRangeUnits: 140,
      min: 0, boxDecimals: 0,
    });
  }

  // -- altitude tape (right, ft) ---------------------------------------------
  _drawAltTape(ctx, altFt) {
    this._drawVTape(ctx, this.altX, altFt, {
      pxPerUnit: 0.42, minorStep: 100, majorStep: 500, halfRangeUnits: 1400,
      min: -1000, boxDecimals: 0,
    });
  }

  // shared vertical-tape renderer: scrolling ticks + a boxed current value
  // pinned at cy. Higher value = higher on screen (climb/accelerate = up).
  // No continuous rail is drawn (ticks only) — a fixed-length spine would
  // mismatch whatever range is actually visible, so it's simpler to skip it.
  _drawVTape(ctx, x, value, { pxPerUnit, minorStep, majorStep, halfRangeUnits, min, boxDecimals }) {
    const { cy } = this;
    const boxW = 58, boxH = 22;
    const exclude = boxH / 2 + 5; // the box sits over the tape — don't draw ticks/labels under it
    const lo = Math.ceil(Math.max(min, value - halfRangeUnits) / minorStep) * minorStep;
    const hi = Math.floor((value + halfRangeUnits) / minorStep) * minorStep;

    const minor = [], major = [], labels = [];
    for (let v = lo; v <= hi; v += minorStep) {
      const y = cy - (v - value) * pxPerUnit;
      if (Math.abs(y - cy) < exclude) continue;
      const isMajor = Math.round(v / majorStep) * majorStep === v;
      const w = isMajor ? 14 : 7;
      (isMajor ? major : minor).push(x - w, y, x + w, y);
      if (isMajor) labels.push(x - w - 6, y, Math.round(v));
    }
    strokeSegs(ctx, minor, 1);
    strokeSegs(ctx, major, 1.6);

    ctx.font = font(11);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i < labels.length; i += 3) {
      ctx.fillText(String(labels[i + 2]), labels[i], labels[i + 1]);
    }

    ctx.lineWidth = 1.6;
    ctx.save(); ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = "rgba(0,12,0,0.55)"; ctx.fillRect(x - boxW / 2, cy - boxH / 2, boxW, boxH); ctx.restore(); // PASS-1: plate keeps the value >=3:1 over bright cloud (additive dark = no-op, hence source-over)
    ctx.strokeRect(x - boxW / 2, cy - boxH / 2, boxW, boxH);
    ctx.font = font(15, 700);
    ctx.textAlign = "center";
    ctx.fillText(fmt(value, boxDecimals), x, cy);
  }

  // -- heading tape (top) -----------------------------------------------------
  // Layout, top to bottom, all within the viewport (nothing above y=4):
  // major-tick labels (y=hdgY-6) -> tick row (y=hdgY..+12) -> up-caret
  // (hdgY+16..+26) -> boxed 3-digit readout (hdgY+30..+50). resize() keeps
  // the ladder clip clear of all of it (top = hdgY+64).
  _drawHeadingTape(ctx, headingDeg) {
    const { cx, hdgY } = this;
    const pxPerDeg = 4, step = 10, halfRange = 65;
    const hdg = ((headingDeg % 360) + 360) % 360;

    const minor = [], major = [], labels = [];
    for (let d = -halfRange; d <= halfRange; d += step) {
      const tickHdg = (Math.round((hdg + d) / step) * step + 3600) % 360;
      const delta = angDelta(tickHdg, hdg);
      if (Math.abs(delta) > halfRange) continue;
      const x = cx + delta * pxPerDeg;
      const isMajor = tickHdg % 30 === 0;
      (isMajor ? major : minor).push(x, hdgY, x, hdgY + (isMajor ? 12 : 6));
      if (isMajor && Math.abs(x - cx) > 18) { // the box below stands in for a label at dead center
        labels.push(x, tickHdg);
      }
    }
    strokeSegs(ctx, minor, 1);
    strokeSegs(ctx, major, 1.6);

    ctx.font = font(11);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i < labels.length; i += 2) {
      ctx.fillText(String(Math.round(labels[i + 1] / 10)).padStart(2, "0"), labels[i], hdgY - 6);
    }

    // up-caret (points into the tick row from below) + boxed 3-digit readout
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - 6, hdgY + 26);
    ctx.lineTo(cx, hdgY + 16);
    ctx.lineTo(cx + 6, hdgY + 26);
    ctx.stroke();
    const boxW = 44, boxH = 20, by = hdgY + 30;
    ctx.save(); ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = "rgba(0,12,0,0.55)"; ctx.fillRect(cx - boxW / 2, by, boxW, boxH); ctx.restore();
    ctx.strokeRect(cx - boxW / 2, by, boxW, boxH);
    ctx.font = font(13, 700);
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.round(hdg)).padStart(3, "0"), cx, by + boxH / 2);
  }

  // -- G / Mach / AoA block (lower-left) --------------------------------------
  _drawGma(ctx, g, mach, aoa) {
    const x0 = 20, rows = this.H - 84;
    const lines = [
      ["G", fmt(g, 1)],
      ["M", fmt(mach, 2)],
      ["AOA", fmt(aoa, 1)],
    ];
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i < lines.length; i++) {
      const y = rows + i * 22;
      ctx.font = font(11);
      ctx.fillStyle = GREEN_DIM;
      ctx.fillText(lines[i][0], x0, y);
      ctx.font = font(15, 700);
      ctx.fillStyle = GREEN;
      ctx.fillText(lines[i][1], x0 + 40, y);
    }
  }

  // -- throttle % (lower-right; >100% = afterburner) --------------------------
  _drawThrottle(ctx, throttle) {
    const x1 = this.W - 20, y0 = this.H - 84;
    const ab = throttle > 100;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.font = font(11);
    ctx.fillStyle = GREEN_DIM;
    ctx.fillText("THR", x1, y0);
    ctx.font = font(19, 700);
    ctx.fillStyle = GREEN;
    ctx.fillText(ab ? "AB" : `${Math.round(throttle)}%`, x1, y0 + 24);
    if (ab) {
      ctx.font = font(10);
      ctx.fillStyle = GREEN_DIM;
      ctx.fillText(`${Math.round(throttle)}%`, x1, y0 + 40);
      ctx.fillStyle = GREEN;
    }
  }
}
