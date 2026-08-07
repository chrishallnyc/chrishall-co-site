// Debug overlay: backend, tier, fps + frame-time sparkline, sim tick/hash.
// Enabled by ?debug=1 or the backquote key. Zero cost when hidden.

export class DebugOverlay {
  constructor() {
    this.el = document.createElement("div");
    this.el.id = "dbg";
    this.el.innerHTML =
      `<div id="dbgTxt"></div><canvas id="dbgGraph" width="220" height="44"></canvas>`;
    document.body.appendChild(this.el);
    this.txt = this.el.querySelector("#dbgTxt");
    this.graph = this.el.querySelector("#dbgGraph").getContext("2d");
    this.samples = new Float32Array(110);
    this.si = 0;
    this.frames = 0;
    this.fps = 0;
    this.lastFpsAt = performance.now();
    this.hash = "…";
    this.lastHashAt = 0;
    this.visible = new URLSearchParams(location.search).get("debug") === "1";
    this.el.style.display = this.visible ? "block" : "none";
  }

  toggle() { this.visible = !this.visible; this.el.style.display = this.visible ? "block" : "none"; }

  frame(dtMs, { backend, tier, sim }) {
    this.frames++;
    const now = performance.now();
    if (now - this.lastFpsAt >= 1000) {
      this.fps = Math.round(this.frames * 1000 / (now - this.lastFpsAt));
      this.frames = 0; this.lastFpsAt = now;
    }
    if (!this.visible) return;
    this.samples[this.si] = dtMs;
    this.si = (this.si + 1) % this.samples.length;
    if (now - this.lastHashAt > 1000 && sim) { this.hash = sim.stateHash(); this.lastHashAt = now; }
    this.txt.textContent =
      `${backend} · ${tier} · ${this.fps} fps · tick ${sim ? sim.tickCount : 0} · #${this.hash}`;
    const g = this.graph;
    g.clearRect(0, 0, 220, 44);
    g.fillStyle = "#e8b46f";
    for (let i = 0; i < this.samples.length; i++) {
      const v = this.samples[(this.si + i) % this.samples.length];
      const h = Math.min(42, v * 1.5); // 16.7ms ≈ 25px, 28ms hits the top
      g.fillRect(i * 2, 44 - h, 1.6, h);
    }
    g.fillStyle = "rgba(232,230,223,.35)";
    g.fillRect(0, 44 - 16.7 * 1.5, 220, 1); // 60fps line
  }
}
