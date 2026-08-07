// RAPTOR boot: renderer (WebGPU with WebGL2 fallback), sim, input, debug, hooks.

import * as THREE from "three";
import { uniform, pow, vec3, Fn } from "three/tsl";
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

const VERSION = "0.16.2";
const PHASE = 14;

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
      // antialias off: TRAA replaces MSAA (the TRAA node requires it off).
      // 16k texture limit is the A2 NAIP-drape prereq — clamped to what the
      // adapter actually offers so SwiftShader/low-end never fails init.
      const r = new THREE.WebGPURenderer({
        canvas, antialias: false,
        requiredLimits: {
          maxTextureDimension2D: Math.min(adapter.limits.maxTextureDimension2D, 16384),
          // the 16k albedo upload stages through a 1GB buffer — the default
          // 256MB cap rejects it (adapter-clamped so init never fails)
          maxBufferSize: Math.min(adapter.limits.maxBufferSize, 4294967296),
        },
      });
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

  // MAXFI A3: Hillaire physical atmosphere — LUT-driven sky march + in-material
  // aerial perspective replacing FogExp2. WebGPU only; ?atmo=preetham reverts.
  let atmoH = null;
  if (backend === "webgpu" && flags.get("atmo") !== "preetham") {
    try {
      const H = await import("./world/hillaire.js");
      const luts = await H.loadAtmo("/assets/atmo");
      if (luts) {
        const uSunI = uniform(36.0);
        const uCamPos = uniform(new THREE.Vector3(0, 3400, 0));
        const nodeArgs = { tTex: luts.tTex, msTex: luts.msTex, uSunDir: atmosphere.sky.uSunDir, uCamPos };
        // per-front air mass: the LUTs bake a STANDARD atmosphere; Nevada's
        // dry desert air scatters far less (PASS-1 item 2: foreground desert
        // measured B−R +44 — blue wash with zero depth grading). trans^k with
        // k<1 = optically thinner air; ins scales with it.
        const airK = { NELLIS: 0.42, VALDEZ: 0.8, MARIANAS: 1.0 }[atmosphere.frontName] ?? 1.0;
        const baseTrans = H.aerialTransNode(nodeArgs), baseIns = H.aerialInscatterNode(nodeArgs);
        atmoH = {
          uCamPos, uSunI,
          aerial: {
            trans: airK === 1.0 ? baseTrans : (wp) => pow(baseTrans(wp), vec3(airK, airK, airK)),
            ins: airK === 1.0 ? baseIns : (wp) => baseIns(wp).mul(airK),
            uSunI,
          },
        };
        atmosphere.sky.setHillaire(H.skySkyNode(nodeArgs), uSunI);
        scene.fog = null; // per-pixel aerial perspective replaces the single-color fog
        atmosphere.hillaire = true; // exposure palette gets a twilight floor (tuned for Preetham otherwise)
        atmosphere.setTime(atmosphere.hours); // re-derive with the floor active
      }
    } catch (err) { console.warn("hillaire atmosphere unavailable, Preetham stays:", err && err.message); }
  }
  state.hillaire = !!atmoH;

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
      // drape: 16k imagery on webgpu; 4k on the webgl fallback (SwiftShader
      // tops out at 8192); ?drape=0 keeps the procedural ramps for QA
      const drape = flags.get("drape") === "0" ? null : (backend === "webgpu" ? "16k" : "4k");
      terrain = await Terrain.load("/assets/terrain/" + fg.asset, atmosphere.frontName,
        makeCloudShadowNode(clouds.shared), { drape, aerial: atmoH?.aerial });
      scene.add(terrain.group);
      if (fg.ocean && flags.get("nowater") !== "1") {
        try {
          // MAXFI A4: FFT ocean on webgpu (?ocean=gerstner reverts)
          let fft = null;
          if (backend === "webgpu" && flags.get("ocean") !== "gerstner") {
            try {
              const { createFFTOcean } = await import("./world/fftocean.js");
              fft = createFFTOcean(renderer, { front: atmosphere.frontName });
            } catch (err) { console.warn("fft ocean unavailable, Gerstner stays:", err && err.message); }
          }
          state.fftOcean = !!fft;
          if (fft) fft.update(0); // pre-compile the 19 compute pipelines behind the veil
          water = new Water(atmosphere.frontName, terrain, atmoH?.aerial, fft);
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

  // PHASE 9: targets on the ground. ?nobattle=1 for clean scenery QA shots.
  let battlefield = null;
  if (flags.get("nobattle") !== "1") {
    const { Battlefield } = await import("./game/battlefield.js");
    battlefield = new Battlefield(scene, terrain, (flags.get("front") || "NELLIS").toUpperCase());
    sim.addSystem(battlefield);
  }

  // PHASE 7: you fly. ?demo=1 keeps the old scripted circle for QA baselines.
  let player = null;
  if (flags.get("demo") !== "1") {
    world.playerMode = true;
    world.trailMesh.visible = false; // FM-driven trail is a polish item
    player = new Player(scene, {
      jet: world.jet, terrain, battlefield,
      spawn: { x: 0, y: -6000, alt: (fg?.baseAlt || 3400) + 200, headingRad: 0, speed: 200 },
    });
    sim.addSystem(player);
    // the war shoots back (?noaaa=1 for scenery QA — no player ref, guns idle)
    if (battlefield && flags.get("noaaa") !== "1") battlefield.player = player;
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
    const pipV = new THREE.Vector3();
    const pipQ = new THREE.Quaternion();
    hud.arcadeLayer = (ctx) => {
      const w = ctx.canvas.width / (window.devicePixelRatio || 1);
      const h = ctx.canvas.height / (window.devicePixelRatio || 1);

      // gun pipper: where rounds actually go — boresight (nose) + ballistic
      // drop at 900m convergence. The stream rides above the aim circle
      // (instructor droop + alpha); this cross is the honest firing solution.
      const st = player.fm.state;
      pipQ.set(st[4], st[5], st[6], st[3]); // (x,y,z,w)
      pipV.set(1, 0, 0).applyQuaternion(pipQ); // nose in ENU
      const CONV = 900;
      const v0 = player.fm.out.V + 1050, sK = CONV * 0.00035;
      const tof = (Math.exp(sK) - 1) / (0.00035 * v0);
      const drop = 4.9 * tof * tof;
      // ENU -> three (east, up, north)
      pipV.set(st[0] + pipV.x * CONV, st[2] + pipV.z * CONV - drop, st[1] + pipV.y * CONV);
      const pv = pipV.project(camera);
      if (pv.z < 1 && pv.z > -1) {
        const px = (pv.x * 0.5 + 0.5) * w, py = (1 - (pv.y * 0.5 + 0.5)) * h;
        if (px > 8 && py > 8 && px < w - 8 && py < h - 8) {
          ctx.save();
          ctx.strokeStyle = "#ffb000"; ctx.lineWidth = 2.2; ctx.globalAlpha = 0.95; // saturated pipper (panel: 1.06:1 amber was invisible)
          ctx.beginPath();
          ctx.moveTo(px - 8, py); ctx.lineTo(px - 3, py);
          ctx.moveTo(px + 3, py); ctx.lineTo(px + 8, py);
          ctx.moveTo(px, py - 8); ctx.lineTo(px, py - 3);
          ctx.moveTo(px, py + 3); ctx.lineTo(px, py + 8);
          ctx.stroke();
          ctx.restore();
        }
      }

      const cp = Math.cos(player.aimPitch), sp = Math.sin(player.aimPitch);
      aimV.set(Math.cos(player.aimHeading) * cp, sp, Math.sin(player.aimHeading) * cp)
        .multiplyScalar(6000).add(camera.position);
      const v = aimV.project(camera);
      if (v.z > 1 || v.z < -1) return; // behind the camera
      const sx = (v.x * 0.5 + 0.5) * w, sy = (1 - (v.y * 0.5 + 0.5)) * h;
      if (sx < 8 || sy < 8 || sx > w - 8 || sy > h - 8) return;
      ctx.save();
      ctx.strokeStyle = "#9be89b"; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(sx, sy, 1.4, 0, Math.PI * 2); ctx.fillStyle = "#9be89b"; ctx.fill();
      // ammo + score + airframe readout, WT-style bottom-center
      ctx.font = "12px ui-monospace, Menlo, monospace";
      ctx.fillStyle = player.gun.ammo > 0 ? "#9be89b" : "#d08770";
      ctx.textAlign = "center";
      const score = battlefield && battlefield.kills > 0 ? "   KILLS " + battlefield.kills : "";
      const dmg = player.hp < 100 ? "   HULL " + Math.max(player.hp, 0) + "%" : "";
      ctx.fillText("GUN " + player.gun.ammo + "   AAM " + player.missiles.ammo + score + dmg, w / 2, h - 34);
      ctx.restore();

      // seeker box on the IR target: dashed while acquiring, solid when locked
      const MS = player.missiles;
      if (battlefield && MS.lockTarget >= 0) {
        const to = MS.lockTarget * 5;
        pipV.set(battlefield.state[to], battlefield.state[to + 2], battlefield.state[to + 1]);
        const tv = pipV.project(camera);
        if (tv.z < 1 && tv.z > -1) {
          const tx = (tv.x * 0.5 + 0.5) * w, ty = (1 - (tv.y * 0.5 + 0.5)) * h;
          ctx.save();
          const locked = MS.locked();
          ctx.strokeStyle = locked ? "#ffd27a" : "#9be89b";
          ctx.lineWidth = locked ? 2 : 1.2;
          if (!locked) ctx.setLineDash([4, 4]);
          ctx.strokeRect(tx - 14, ty - 14, 28, 28);
          if (locked) { ctx.font = "10px ui-monospace, Menlo, monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#ffd27a"; ctx.fillText("LOCK", tx, ty - 20); }
          ctx.restore();
        }
      }
      // SAM inbound: MISSILE warning — alpha-modulated blink (never fully
      // absent from a frame; the panel found 0 warning pixels in a frozen
      // combat still) with a hard black outline for contrast anywhere
      if (battlefield && battlefield.samInbound()) {
        ctx.save();
        const pulse = Math.floor(performance.now() / 250) % 2 === 0 ? 1.0 : 0.35;
        ctx.globalAlpha = pulse;
        ctx.font = "bold 30px ui-monospace, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.strokeText("MISSILE", w / 2, h * 0.3);
        ctx.fillStyle = "#ff5a3c";
        ctx.fillText("MISSILE", w / 2, h * 0.3);
        ctx.restore();
      }
      // taking fire: red vignette pulse
      if (player.hitFlash > 0) {
        player.hitFlash = Math.max(0, player.hitFlash - 1 / 60);
        ctx.save();
        const a = Math.min(player.hitFlash * 0.9, 0.4);
        const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.42, w / 2, h / 2, h * 0.75);
        grad.addColorStop(0, "rgba(200,40,20,0)");
        grad.addColorStop(1, `rgba(200,40,20,${a})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
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
  // MAXFI A1: TRAA + bloom + flare post chain (WebGPU only; ?post=0 keeps
  // the plain pipe for QA baselines and numeric oracles)
  let post = null;
  let vol = null;
  if (backend === "webgpu" && flags.get("post") !== "0") {
    // volumetric clouds ride the post chain (?vclouds=0 keeps billboards)
    if (flags.get("vclouds") !== "0") {
      try {
        const VC = await import("./world/volclouds.js");
        vol = {
          VC,
          noise: VC.makeCloudNoise(1337),
          uTime: uniform(0),
          uCamPos: atmoH ? atmoH.uCamPos : uniform(new THREE.Vector3(0, 3400, 0)),
        };
      } catch (err) { vol = null; console.warn("volumetric clouds unavailable, billboards stay:", err && err.message); }
    }
    try {
      const { buildPost } = await import("./engine/post.js");
      post = buildPost(renderer, scene, camera, {
        flare: flags.get("flare") !== "0",
        gtao: flags.get("ao") === "1", // default off until eyeball-passed
        chain: flags.get("chain") || "full",
        makeClouds: vol ? ({ beauty, depth }) => vol.VC.volCloudsNode({
          beauty, depth, camera,
          uSunDir: atmosphere.sky.uSunDir, uCamPos: vol.uCamPos, uTime: vol.uTime,
          front: atmosphere.frontName, noise: vol.noise, aerial: atmoH?.aerial ?? null,
        }) : null,
      });
    } catch (err) { console.warn("post chain unavailable, plain render:", err && err.message); }
    // billboards hide when the volumetrics own the sky; their shadow field
    // stays live (clouds.update keeps feeding the shared shadow uniforms)
    if (vol && post) clouds.group.visible = false;
    state.volClouds = !!(vol && post);
  }
  state.post = !!post;

  document.getElementById("controlsLink")?.addEventListener("click", (e) => { e.preventDefault(); controls.show(); });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // public hooks (QA + future phases)
  Object.assign(state, {
    sim, input, gamepad, controls, dbg, atmosphere, terrain, water, clouds, hud, player, battlefield,
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
        // launch warning owns the tones over the seeker
        const seekMode = battlefield && battlefield.samInbound() ? "launch"
          : player.missiles.locked() ? "lock" : (player.missiles.lockTarget >= 0 ? "scan" : "off");
        if (audio.locks.mode !== seekMode) audio.locks.setMode(seekMode);
      }
    } else {
      world.render(alpha, camera);
    }
    battlefield?.render(dtMs / 1000, camera);
    terrain?.update(camera);
    waterClock += dtMs / 1000;
    water?.update(camera, waterClock);
    cloudClock += dtMs / 1000;
    clouds.update(camera, cloudClock);
    if (vol) { vol.uTime.value = cloudClock; vol.VC.updateCamera?.(camera); }
    hud.update(player ? player.hudState() : testworldHudState(world, alpha));
    atmosphere.update(camera);
    if (atmoH) atmoH.uCamPos.value.copy(camera.position);
    renderer.toneMappingExposure = atmosphere.exposure;
    if (post) post.post.render();
    else renderer.render(scene, camera);
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
