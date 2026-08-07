// RAPTOR boot: renderer (WebGPU with WebGL2 fallback), sim, input, debug, hooks.

import * as THREE from "three";
import { SimCore, determinismProbe, DT } from "./engine/sim.js";
import { Input } from "./engine/input.js";
import { GamepadInput } from "./engine/gamepad.js";
import { detectTier, tierParams, setTier, TIERS, savedBench, saveBench, benchPick, clearBench, hasManualTier } from "./engine/quality.js";
import { DebugOverlay } from "./engine/debug.js";
import { TestWorld } from "./game/testworld.js";
import { Player } from "./game/player.js";
import { ControlsMenu } from "./game/controlsmenu.js";
import { Atmosphere } from "./world/daycycle.js";
import { Terrain } from "./world/terrain.js";
import { Water } from "./world/water.js";
import { Clouds, makeCloudShadowNode } from "./world/clouds.js";
import { HUD } from "./game/hud.js";
import { FlightFX } from "./game/flightfx.js";

const VERSION = "0.7.0";
const PHASE = 8;

// HUD placeholder feed for TestWorld — replace wholesale once flight.js
// (phase 7, FM-PLAN.md) is wired into gameplay. Fields not derivable from
// testworld's own kinematics are marked PLACEHOLDER.
function testworldHudState(world, alpha) {
  const a = world.prev, b = world.state;
  const ang = a[0] + (b[0] - a[0]) * alpha;
  const radius = a[1] + (b[1] - a[1]) * alpha;
  const alt = a[2] + (b[2] - a[2]) * alpha;
  const speed = a[3] + (b[3] - a[3]) * alpha; // m/s
  const bank = a[4] + (b[4] - a[4]) * alpha;  // rad, magnitude-only
  const omega = speed / radius;
  const climbRate = 280 * omega * Math.cos(2 * ang); // exact d/dt of the weave
  const heading = Math.atan2(-Math.cos(ang), Math.sin(ang));
  return {
    speedKt: speed * 1.94384,
    altFt: alt * 3.28084,
    heading: (heading * 180 / Math.PI + 360) % 360,
    pitch: Math.atan2(climbRate, speed) * 180 / Math.PI,
    roll: bank * 180 / Math.PI,
    g: 1 / Math.cos(bank),
    mach: speed / 340, // PLACEHOLDER: no ISA here
    aoa: 2.5,          // PLACEHOLDER
    throttle: 60,      // PLACEHOLDER
  };
}

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

  // clouds (phase 5a/5b/5c): coverage + shadows on every tier; billboard
  // field past LOW. atmosphere.sky.uSunDir is passed BY REFERENCE so sky,
  // clouds, and ground shadows share one sun uniform — zero-copy, no drift.
  const clouds = new Clouds(atmosphere.frontName, params, atmosphere.sky.uSunDir);
  scene.add(clouds.group);

  const sim = new SimCore(1);
  const world = new TestWorld(scene);
  sim.addSystem(world);

  // real-Earth ground for all three fronts. ?noterrain=1 = QA flag: sky/boot
  // batteries skip the ground so SwiftShader timings measure what they intend.
  const FRONT_GROUND = {
    NELLIS: { asset: "nellis", ocean: false, baseAlt: 3400, label: "NEVADA" },
    VALDEZ: { asset: "valdez", ocean: true, baseAlt: 2800, label: "PRINCE WILLIAM SOUND" },
    MARIANAS: { asset: "marianas", ocean: true, baseAlt: 1400, label: "THE MARIANAS" },
  };
  let terrain = null, water = null;
  const fg = FRONT_GROUND[atmosphere.frontName];
  if (fg && flags.get("noterrain") !== "1") {
    const vs = document.querySelector("#veil .status");
    if (vs) vs.innerHTML = `<b>LOADING ${fg.label}</b> — real USGS terrain`;
    try {
      terrain = await Terrain.load("/assets/terrain/" + fg.asset, atmosphere.frontName,
        makeCloudShadowNode(clouds.shared));
      scene.add(terrain.group);
      if (fg.ocean && flags.get("nowater") !== "1") {
        try {
          water = new Water(atmosphere.frontName, terrain);
          scene.add(water.group);
        } catch (err) {
          console.warn("water unavailable, placeholder sea stays:", err && err.message);
        }
      }
      // the placeholder sea survives only if the real water failed
      world.setGround(terrain, { ...fg, ocean: fg.ocean && !water });
    } catch (err) {
      console.warn("terrain unavailable, flying over water:", err && err.message);
    }
  }

  // PHASE 7: you fly. ?demo=1 keeps the old scripted circle for QA baselines.
  let player = null;
  if (flags.get("demo") !== "1") {
    world.playerMode = true;
    world.trailMesh.visible = false; // FM-driven trail is a polish item
    player = new Player(scene, {
      jet: world.jet, terrain,
      spawn: { x: 0, y: -6000, alt: (fg?.baseAlt || 3400) + 200, headingRad: 0, speed: 200 },
    });
    sim.addSystem(player);
  }
  // AB plume + wingtip vortices (nests under jetGroup — post-boot top-level
  // scene.add is silently dropped by this renderer build; see flightfx.js)
  const flightfx = player ? new FlightFX(scene, { jetGroup: world.jet, parts: world.f22parts }) : null;

  const input = new Input(window);
  const gamepad = new GamepadInput();
  const controls = new ControlsMenu(input);
  const dbg = new DebugOverlay();
  const hud = new HUD({ parent: document.body });
  hud.setMode("arcade");
  if (flags.get("hud") === "0") hud.canvas ? (hud.canvas.style.display = "none") : hud.svg && (hud.svg.style.display = "none"); // QA: clean scenery shots

  // WT-style mouse-aim marker: where the instructor is being told to fly.
  // FM heading convention: 0 = east (+x ENU), measured toward north (+y).
  if (player) {
    const aimV = new THREE.Vector3();
    hud.arcadeLayer = (ctx) => {
      const cp = Math.cos(player.aimPitch), sp = Math.sin(player.aimPitch);
      aimV.set(Math.cos(player.aimHeading) * cp, sp, Math.sin(player.aimHeading) * cp)
        .multiplyScalar(6000).add(camera.position);
      const v = aimV.project(camera);
      if (v.z > 1 || v.z < -1) return; // behind the camera
      const w = ctx.canvas.width / (window.devicePixelRatio || 1);
      const h = ctx.canvas.height / (window.devicePixelRatio || 1);
      const sx = (v.x * 0.5 + 0.5) * w, sy = (1 - (v.y * 0.5 + 0.5)) * h;
      if (sx < 8 || sy < 8 || sx > w - 8 || sy > h - 8) return;
      ctx.save();
      ctx.strokeStyle = "#9be89b"; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(sx, sy, 1.4, 0, Math.PI * 2); ctx.fillStyle = "#9be89b"; ctx.fill();
      // ammo readout, WT-style bottom-center
      ctx.font = "12px ui-monospace, Menlo, monospace";
      ctx.fillStyle = player.gun.ammo > 0 ? "#9be89b" : "#d08770";
      ctx.textAlign = "center";
      ctx.fillText("GUN " + player.gun.ammo, w / 2, h - 34);
      ctx.restore();
    };
  }

  // audio: F119 engine tracks the throttle, M61 gates on firing (phase 13
  // first wiring; gesture-gated resume inside AudioBus)
  let audio = null;
  if (player && flags.get("audio") !== "0") {
    try {
      const { AudioBus } = await import("./engine/audio.js");
      audio = new AudioBus(); // builds engine/gun/lock voices itself
    } catch (err) { console.warn("audio unavailable:", err && err.message); }
  }
  document.getElementById("controlsLink")?.addEventListener("click", (e) => { e.preventDefault(); controls.show(); });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // public hooks (QA + future phases)
  Object.assign(state, {
    sim, input, gamepad, controls, dbg, atmosphere, terrain, water, clouds, hud, player,
    cloudImmersion: () => clouds.immersion,
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
  let waterClock = 0; // render-side only — the sim never reads water
  let cloudClock = 0; // same convention; drives clouds AND their shadows
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
    player?.feedInput(input);
    const alpha = sim.advance(dtMs / 1000);
    if (player) {
      const parked = world.fixYaw !== null;
      if (parked) world.renderParkedCamera(camera);
      player.render(alpha, camera, parked);
      flightfx?.update(player.fm.out, player.throttleCmd, dtMs / 1000, camera);
      if (audio) {
        audio.engine.setState({
          throttle: Math.min(player.throttleCmd, 1),
          ab: Math.max(0, (player.throttleCmd - 1) / 0.1),
          ias: player.fm.out.V * 1.94384,
        });
        if (player.gun.firing !== audio.gun.firing) audio.gun.fire(player.gun.firing);
      }
    } else {
      world.render(alpha, camera);
    }
    terrain?.update(camera);
    waterClock += dtMs / 1000;
    water?.update(camera, waterClock);
    cloudClock += dtMs / 1000;
    clouds.update(camera, cloudClock);
    hud.update(player ? player.hudState() : testworldHudState(world, alpha));
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
