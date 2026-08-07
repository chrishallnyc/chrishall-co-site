// RAPTOR boot: renderer (WebGPU with WebGL2 fallback), sim, input, debug, hooks.

import * as THREE from "three";
import { SimCore, determinismProbe, DT } from "./engine/sim.js";
import { Input } from "./engine/input.js";
import { GamepadInput } from "./engine/gamepad.js";
import { detectTier, tierParams, setTier, TIERS, savedBench, saveBench, benchPick, clearBench, hasManualTier } from "./engine/quality.js";
import { DebugOverlay } from "./engine/debug.js";
import { TestWorld } from "./game/testworld.js";
import { ControlsMenu } from "./game/controlsmenu.js";
import { Atmosphere } from "./world/daycycle.js";
import { Terrain } from "./world/terrain.js";

const VERSION = "0.3.0";
const PHASE = 2;

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
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 120000);

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;

  const flags = new URLSearchParams(location.search);
  const atmosphere = new Atmosphere(scene, (flags.get("front") || "NELLIS").toUpperCase());
  atmosphere.initIBL(renderer);
  if (flags.get("tod")) atmosphere.setTime(parseFloat(flags.get("tod")));

  const sim = new SimCore(1);
  const world = new TestWorld(scene);
  sim.addSystem(world);

  // real-Earth ground (NELLIS baked; other fronts arrive in later blocks).
  // ?noterrain=1 = QA flag: sky/boot batteries skip the 21MB ground so
  // SwiftShader timings measure what they intend to.
  let terrain = null;
  if (atmosphere.frontName === "NELLIS" && flags.get("noterrain") !== "1") {
    const vs = document.querySelector("#veil .status");
    if (vs) vs.innerHTML = "<b>LOADING NEVADA</b> — real USGS terrain";
    try {
      terrain = await Terrain.load("/assets/terrain/nellis");
      scene.add(terrain.group);
      world.setGround(terrain);
    } catch (err) {
      console.warn("terrain unavailable, flying over water:", err && err.message);
    }
  }

  const input = new Input(window);
  const gamepad = new GamepadInput();
  const controls = new ControlsMenu(input);
  const dbg = new DebugOverlay();
  document.getElementById("controlsLink")?.addEventListener("click", (e) => { e.preventDefault(); controls.show(); });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // public hooks (QA + future phases)
  Object.assign(state, {
    sim, input, gamepad, controls, dbg, atmosphere, terrain,
    setTimeOfDay: (h) => atmosphere.setTime(h),
    setFront: (f) => atmosphere.setFront(String(f).toUpperCase()),
    hash: () => sim.stateHash(),
    determinismProbe,
    setSeed: (s) => sim.reset(s),
    setTimescale: (t) => { sim.timescale = t; },
    setTier: (t) => setTier(t) && location.reload(),
    rebench: () => { clearBench(); location.reload(); },
    bench: savedBench(),
    tiers: Object.keys(TIERS),
    dt: DT,
  });

  // measured auto-bench: first run only — sample the live scene, pick the tier
  let benchSamples = (!hasManualTier() && !savedBench()) ? [] : null;
  let frameNo = 0;

  let last = performance.now();
  let firstFrame = true;
  function frame(now) {
    requestAnimationFrame(frame);
    const dtMs = Math.min(now - last, 250);
    last = now;
    frameNo++;
    if (benchSamples && frameNo > 20) {
      benchSamples.push(dtMs);
      if (benchSamples.length >= 80) {
        const sorted = [...benchSamples].sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1];
        const tier = benchPick(median, state.backend);
        const rec = { ms: +median.toFixed(2), backend: state.backend, tier };
        saveBench(rec);
        state.bench = rec;
        if (tier !== state.tier) {
          state.tier = tier;
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * tierParams(tier).renderScale);
        }
        benchSamples = null;
      }
    }
    gamepad.update();
    if (input.pressed("menu")) controls.toggle();
    if (input.pressed("debug")) dbg.toggle();
    const alpha = sim.advance(dtMs / 1000);
    world.render(alpha, camera);
    terrain?.update(camera);
    atmosphere.update(camera);
    renderer.toneMappingExposure = atmosphere.exposure;
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
