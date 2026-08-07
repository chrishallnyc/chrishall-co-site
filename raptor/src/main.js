// RAPTOR boot: renderer (WebGPU with WebGL2 fallback), sim, input, debug, hooks.

import * as THREE from "three";
import { SimCore, determinismProbe, DT } from "./engine/sim.js";
import { Input } from "./engine/input.js";
import { GamepadInput } from "./engine/gamepad.js";
import { detectTier, tierParams, setTier, TIERS } from "./engine/quality.js";
import { DebugOverlay } from "./engine/debug.js";
import { TestWorld } from "./game/testworld.js";

const VERSION = "0.1.0";
const PHASE = 1;

const state = {
  version: VERSION, phase: PHASE, ready: false, backend: null, tier: null,
  failure: null,
};
window.__RAPTOR = state;

// A canvas is one-context-forever: a failed webgpu attempt poisons it for
// webgl2, so probe the adapter BEFORE construction and re-canvas on fallback.
function freshCanvas(old) {
  const c = old.cloneNode(false);
  old.replaceWith(c);
  return c;
}

async function makeRenderer(canvas) {
  let adapter = null;
  if (navigator.gpu && new URLSearchParams(location.search).get("gl") !== "1") {
    try { adapter = await navigator.gpu.requestAdapter(); } catch (_) { adapter = null; }
  }
  if (adapter) {
    try {
      const r = new THREE.WebGPURenderer({ canvas, antialias: true });
      await r.init();
      return { renderer: r, backend: "webgpu", canvas };
    } catch (err) {
      console.warn("WebGPU init failed, falling back to WebGL2:", err && err.message);
      canvas = freshCanvas(canvas);
    }
  }
  const r = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: true });
  await r.init();
  return { renderer: r, backend: "webgl", canvas };
}

async function boot() {
  const canvas = document.getElementById("game");
  const { renderer, backend } = await makeRenderer(canvas);
  state.backend = backend;
  state.tier = detectTier({ backend });
  const params = tierParams(state.tier);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * params.renderScale);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 80000);

  const sim = new SimCore(1);
  const world = new TestWorld(scene);
  sim.addSystem(world);

  const input = new Input(window);
  const gamepad = new GamepadInput();
  const dbg = new DebugOverlay();

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // public hooks (QA + future phases)
  Object.assign(state, {
    sim, input, gamepad, dbg,
    hash: () => sim.stateHash(),
    determinismProbe,
    setSeed: (s) => sim.reset(s),
    setTimescale: (t) => { sim.timescale = t; },
    setTier: (t) => setTier(t) && location.reload(),
    tiers: Object.keys(TIERS),
    dt: DT,
  });

  let last = performance.now();
  let firstFrame = true;
  function frame(now) {
    requestAnimationFrame(frame);
    const dtMs = Math.min(now - last, 250);
    last = now;
    gamepad.update();
    if (input.pressed("debug")) dbg.toggle();
    const alpha = sim.advance(dtMs / 1000);
    world.render(alpha, camera);
    renderer.render(scene, camera);
    dbg.frame(dtMs, { backend: state.backend, tier: state.tier, sim });
    input.consumeFrame();
    if (firstFrame) {
      firstFrame = false;
      state.ready = true;
      document.getElementById("veil")?.classList.add("lift");
      setTimeout(() => document.getElementById("veil")?.remove(), 900);
    }
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  state.failure = String(err && err.stack || err);
  console.error("RAPTOR boot failure:", err);
  const v = document.getElementById("veil");
  if (v) v.querySelector(".status").textContent = "BOOT FAILURE — " + (err && err.message || err);
});
