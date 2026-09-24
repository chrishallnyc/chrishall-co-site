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
import * as SETTINGS from "./game/settings.js";
import { showFlightdeck } from "./game/flightdeck.js";
import { hasFlightRequest } from "./game/flightplan.js";
import { loadRequestedFlight, FlightLoadError, bootFailureMessage } from "./game/flightload.js";
import { Cockpit } from "./game/cockpit.js";
import { Atmosphere } from "./world/daycycle.js";
import { Terrain } from "./world/terrain.js";
import { Water } from "./world/water.js";
import { Clouds, makeCloudShadowNode } from "./world/clouds.js";
import { HUD } from "./game/hud.js";
import { FlightFX } from "./game/flightfx.js";
import { AircraftLighting } from "./aircraft/lighting.js";
import { updateF22Visuals } from "./aircraft/f22-lod.js";
import { installWebGLIndexStateGuard } from "./engine/webgl-index-state.js";
import { installReversedDepthOrderGuard } from "./engine/reversed-depth-order.js";

const VERSION = "1.2.0";
const PHASE = 12;

// WebGPU and reverse-depth WebGL use [0,1]; ordinary WebGL uses [-1,1].
// Behind-camera markers must be rejected under either projection convention.
function projectedDepthVisible(z, camera) {
  return z <= 1 && z >= (camera.reversedDepth || camera.coordinateSystem === THREE.WebGPUCoordinateSystem ? 0 : -1);
}

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
  version: VERSION, phase: PHASE, ready: false, paused: false, backend: null, tier: null,
  failure: null,
};
window.__RAPTOR = state;
function bootStage(name,label,detail) {
  state.bootStage=name;
  const veil=document.getElementById('veil');
  if(!veil)return;
  veil.querySelector('.status').textContent=label;
  if(detail)veil.querySelector('.boot-status-detail').textContent=detail;
  const steps=[...veil.querySelectorAll('[data-boot-step]')];
  const active=steps.findIndex(step=>step.dataset.bootStep===name);
  for(const [index,step] of steps.entries()) {
    step.dataset.state=index<active?'complete':index===active?'current':'pending';
    if(index===active)step.setAttribute('aria-current','step');
    else step.removeAttribute('aria-current');
  }
}

// A canvas is one-context-forever: a failed webgpu attempt poisons it for
// webgl2, so probe the adapter BEFORE construction and re-canvas on fallback.
function freshCanvas(old) {
  const c = old.cloneNode(false);
  old.replaceWith(c);
  return c;
}

async function makeRenderer(canvas) {
  // Metre-scale aircraft surfaces need precision at kilometre distances.
  const reverseDepth = new URLSearchParams(location.search).get("reverseDepth") !== "0";
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
        canvas, antialias: false, reversedDepthBuffer: reverseDepth,
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
  const r = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: true, reversedDepthBuffer: reverseDepth });
  await r.init();
  return { renderer: r, backend: "webgl", canvas };
}

async function boot() {
  const flags = new URLSearchParams(location.search);
  bootStage('mission','Checking your flight plan…','Preparing the flight you selected. Your aircraft stays on standby until everything is ready.');
  const requested = await loadRequestedFlight(flags);
  // A shared mission link may omit its region; the validated mission owns it.
  if (requested?.spec.front) flags.set("front", requested.spec.front);
  bootStage('graphics-device','Connecting to your graphics system…','Choosing the graphics renderer for this browser and your display settings.');
  const { renderer, backend, canvas } = await makeRenderer(document.getElementById("game"));
  installWebGLIndexStateGuard(renderer);
  installReversedDepthOrderGuard(renderer);
  bootStage('landscape','Preparing the landscape…','Loading the terrain, sky and lighting for your chosen region.');
  state.backend = backend;
  state.tier = detectTier({ backend });
  const params = tierParams(state.tier);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * params.renderScale);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 120000);
  const _bv = new THREE.Vector3(); // HUD projection scratch

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;

  const usePost = backend === "webgpu" && flags.get("post") !== "0" && (params.post || flags.get("post") === "1");
  const useVolume = usePost && flags.get("vclouds") !== "0" && (["HIGH", "ULTRA"].includes(state.tier) || flags.get("vclouds") === "1");
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
  const world = new TestWorld(scene, { aircraftQuality: state.tier });
  const aircraftFrame = { projectedPixels: Infinity, maxQuality: state.tier };
  const aircraftLighting = new AircraftLighting({ renderer, atmosphere, params,
    aerial: flags.get("aircraftAir") === "0" ? null : atmoH?.aerial,
    shadows: flags.get("aircraftShadows") !== "0" });
  aircraftLighting.register(world.jet);
  sim.addSystem(world);

  // real-Earth ground for all three fronts. ?noterrain=1 = QA flag: sky/boot
  // batteries skip the ground so SwiftShader timings measure what they intend.
  const FRONT_GROUND = {
    NELLIS: { asset: "nellis", ocean: false, baseAlt: 3400, label: "NEVADA" },
    VALDEZ: { asset: "valdez", ocean: true, baseAlt: 2800, label: "PRINCE WILLIAM SOUND" },
    MARIANAS: { asset: "marianas", ocean: true, baseAlt: 1400, label: "THE MARIANAS" },
  };
  let terrain = null, water = null;
  // PHASE 12 item 4: on the volumetric path, ground shadows come from the
  // SAME coverage field the march breathes (volclouds noise hoisted here —
  // terrain materials bake their shadow node at construction, so this must
  // exist pre-Terrain.load; the post chain reuses volPre, no double bake).
  // ?cloudshadow=old keeps the billboard projector for A/B.
  let volPre = null;
  if (useVolume) {
    try {
      const VC = await import("./world/volclouds.js");
      volPre = { VC, noise: VC.makeCloudNoise(1337) };
    } catch (err) { console.warn("volumetric clouds unavailable, billboards stay:", err && err.message); }
  }
  const volShadow = (volPre && volPre.VC.makeVolCloudShadowNode && flags.get("cloudshadow") !== "old")
    ? volPre.VC.makeVolCloudShadowNode({ noise: volPre.noise, front: atmosphere.frontName, uSunDir: atmosphere.sky.uSunDir })
    : null;
  const fg = FRONT_GROUND[atmosphere.frontName];
  if (fg && flags.get("noterrain") !== "1") {
    bootStage('landscape',`Loading ${fg.label.toLowerCase()}…`,'Preparing real terrain and surface imagery. The first visit to a region may take a little longer.');
    try {
      // drape: 16k imagery on webgpu; 4k on the webgl fallback (SwiftShader
      // tops out at 8192); ?drape=0 keeps the procedural ramps for QA
      const drape = flags.get("drape") === "0" ? null : (backend === "webgpu" && ["HIGH", "ULTRA"].includes(state.tier) ? "16k" : "4k");
      terrain = await Terrain.load("/assets/terrain/" + fg.asset, atmosphere.frontName,
        volShadow || makeCloudShadowNode(clouds.shared), { drape, aerial: atmoH?.aerial });
      scene.add(terrain.group);
      if (fg.ocean && flags.get("nowater") !== "1") {
        try {
          // MAXFI A4: FFT ocean on webgpu (?ocean=gerstner reverts)
          let fft = null;
          if (backend === "webgpu" && params.post && flags.get("ocean") !== "gerstner") {
            try {
              const { createFFTOcean } = await import("./world/fftocean.js");
              fft = createFFTOcean(renderer, { front: atmosphere.frontName });
            } catch (err) { console.warn("fft ocean unavailable, Gerstner stays:", err && err.message); }
          }
          state.fftOcean = !!fft;
          if (fft) fft.update(0); // pre-compile the 19 compute pipelines behind the veil
          water = new Water(atmosphere.frontName, terrain, atmoH?.aerial, fft,
            { cloudShadow: volShadow || makeCloudShadowNode(clouds.shared) });
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

  bootStage('systems','Preparing your aircraft and objectives…','Setting up flight controls, aircraft systems and the selected flight.');

  // PHASE 9: targets on the ground. ?nobattle=1 for clean scenery QA shots.
  let battlefield = null;
  if (flags.get("nobattle") !== "1") {
    const { Battlefield } = await import("./game/battlefield.js");
    battlefield = new Battlefield(scene, terrain, (flags.get("front") || "NELLIS").toUpperCase());
    sim.addSystem(battlefield);
  }

  // PHASE 11 INC-4: enemy air. Flag-gated while the module lands (no 404s in
  // normal boots); flips always-on at integration. Tick order per design §0:
  // battlefield -> bandits -> player -> script -> match.
  let bandits = null, directory = null;
  if (battlefield && flags.get("bandits") !== "0") {
    try {
      const BD = await import("./game/bandits.js");
      const TG = await import("./game/targets.js");
      bandits = new BD.Bandits(scene, { terrain, battlefield, quality: state.tier });
      sim.addSystem(bandits);
      directory = TG.makeDirectory({ battlefield, bandits });
    } catch (err) { bandits = null; directory = null; console.warn("bandits unavailable:", err && err.message); }
  }

  // PHASE 7: you fly. ?demo=1 keeps the old scripted circle for QA baselines.
  if (bandits) aircraftLighting.register(bandits.root);
  aircraftLighting.receiveGround(terrain?.group);
  aircraftLighting.receiveGround(world.sea);
  aircraftLighting.receiveGround(battlefield?.root);
  let player = null;
  if (flags.get("demo") !== "1") {
    world.playerMode = true;
    world.trailMesh.visible = false; // FM-driven trail is a polish item
    world.pylons.visible = false; // phase-1 scale pylons — PASS-1 item 8: they render as needle spikes at distance (and stand ON the ocean)
    player = new Player(scene, {
      jet: world.jet, terrain, battlefield, directory,
      spawn: { x: 0, y: -6000, alt: (fg?.baseAlt || 3400) + 200, headingRad: 0, speed: 200 },
    });
    sim.addSystem(player);
    // the war shoots back (?noaaa=1 for scenery QA — no player ref, guns idle)
    if (battlefield && flags.get("noaaa") !== "1") battlefield.player = player;
    if (bandits) bandits.player = player; // A3 weapons target the player (INC-5)
  }
  // PHASE 10: the war has rules (?nomatch=1 keeps the free-flight sandbox)
  // PHASE 11 INC-1: ?mission=<name> loads a MissionSpec; the Script system
  // ticks AFTER player (observes the completed combat tick), BEFORE match
  // (which scores it). Script owns win/lose; match keeps tickets/rearm/boundary.
  let match = null, script = null, missionData = null, campaign = null, authored = null;
  if (player && battlefield && flags.get("nomatch") !== "1") {
    const { Match } = await import("./game/match.js");
    const BF = await import("./game/battlefield.js");
    const pad = BF.FRONT_AIRFIELDS ? BF.FRONT_AIRFIELDS[atmosphere.frontName] : null; // INC-2 per-front pads
    match = new Match(battlefield, player, { airfield: pad });
    if (requested) {
      try {
        const { Script } = await import("./game/script.js");
        const { spec } = requested;
        authored = requested.authored;
        campaign = requested.campaign;
        if (!flags.get("tod") && spec.todH !== undefined) atmosphere.setTime(spec.todH);
        script = new Script(spec, { battlefield, player, match, terrain, bandits });
        match.scripted = true;
        if (spec.airfield) match.airfield = spec.airfield;
        missionData = { spec, lines: requested.lines };
        if (spec.playerSpawn) {
          const ps = spec.playerSpawn;
          player.spawn = { x: ps.x, y: ps.y, alt: ps.alt, headingRad: (ps.headingDeg || 0) * Math.PI / 180, speed: ps.speed || 200 };
          player.debugCommand({ pos: ps, throttle: 0.8 });
        }
        sim.addSystem(script);
      } catch (cause) {
        throw new FlightLoadError('The selected mission could not be started.', { cause, request: requested.request });
      }
    }
    sim.addSystem(match);
  }
  // AB plume + wingtip vortices (nests under jetGroup — post-boot top-level
  // scene.add is silently dropped by this renderer build; see flightfx.js)
  const flightfx = player ? new FlightFX(scene, { jetGroup: world.jet, parts: world.f22parts }) : null;

  const input = new Input(window);
  input.suspended = true; // Loading-screen input must never steer the first frame.
  const gamepad = new GamepadInput();
  input.attachGamepad(gamepad);
  let cockpit = null;
  const controls = new ControlsMenu(input, {
    onShow: () => cockpit?.onControlsOpen(),
    onClose: () => cockpit?.onControlsClose(),
  });
  const dbg = new DebugOverlay();
  const hud = new HUD({ parent: document.body });
  hud.setMode("arcade");
  if (flags.get("hud") === "0") {
    if (hud.canvas) hud.canvas.style.display = "none"; else if (hud.svg) hud.svg.style.display = "none"; // QA: clean scenery shots
  }
  if (flags.get("hud") === "0" || flags.get("chrome") === "0") {
    const chrome = document.getElementById("chrome");
    if (chrome) chrome.style.display = "none"; // PASS-3 item 1: HUD-mode demo captures need bare frames too
  }

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
      if (projectedDepthVisible(pv.z, camera)) {
        const px = (pv.x * 0.5 + 0.5) * w, py = (1 - (pv.y * 0.5 + 0.5)) * h;
        if (px > 8 && py > 8 && px < w - 8 && py < h - 8) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(px - 8, py); ctx.lineTo(px - 3, py);
          ctx.moveTo(px + 3, py); ctx.lineTo(px + 8, py);
          ctx.moveTo(px, py - 8); ctx.lineTo(px, py - 3);
          ctx.moveTo(px, py + 3); ctx.lineTo(px, py + 8);
          ctx.globalCompositeOperation = "source-over";
          ctx.strokeStyle = "rgba(0,10,0,0.75)"; ctx.lineWidth = 4.6; ctx.globalAlpha = 1; ctx.stroke(); // halo (PASS-2 item 2)
          ctx.strokeStyle = "#ffb000"; ctx.lineWidth = 2.2; ctx.globalAlpha = 0.95; ctx.stroke();
          ctx.restore();
        }
      }

      const cp = Math.cos(player.aimPitch), sp = Math.sin(player.aimPitch);
      aimV.set(Math.cos(player.aimHeading) * cp, sp, Math.sin(player.aimHeading) * cp)
        .multiplyScalar(6000).add(camera.position);
      const v = aimV.project(camera);
      if (!projectedDepthVisible(v.z, camera)) return;
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
        if (projectedDepthVisible(tv.z, camera)) {
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
      // PHASE 11 INC-4: bandit diamonds — project live bandits, dashed
      // diamond + range; blue for friendlies. Render-side only.
      if (bandits && bandits.aliveCount() > 0) {
        const st = player.fm.state;
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.6;
        ctx.font = "10px ui-monospace, Menlo, monospace";
        ctx.textAlign = "center";
        for (let i = 0; i < 8; i++) {
          if (!bandits.live[i]) continue;
          const o = i * 14;
          const bx = bandits.state[o], by = bandits.state[o + 1], bz = bandits.state[o + 2];
          // detection gate (D-073 panel enabler): a contact earns its diamond
          // by closing inside 18 km or by maneuvering against you — so an
          // authored "pop-up" reveal can actually pop. ?alldiamonds=1 reverts.
          if (!seenB[i] && flags.get("alldiamonds") !== "1") {
            const bs = bandits.state[o + 7];
            const close = Math.hypot(bx - st[0], by - st[1], bz - st[2]) < 18000;
            if (close || (bs >= 1 && bs <= 3)) seenB[i] = 1;
            else continue;
          }
          _bv.set(bx, bz, by).project(camera); // ENU -> three -> NDC
          if (!projectedDepthVisible(_bv.z, camera)) continue;
          const sx = (_bv.x * 0.5 + 0.5) * w, sy = (-_bv.y * 0.5 + 0.5) * h;
          if (sx < -30 || sx > w + 30 || sy < -30 || sy > h + 30) continue;
          const col = bandits.side[i] === 1 ? SETTINGS.getPalette().friendly : SETTINGS.getPalette().enemy;
          ctx.strokeStyle = col;
          ctx.beginPath();
          ctx.moveTo(sx, sy - 12); ctx.lineTo(sx + 12, sy); ctx.lineTo(sx, sy + 12); ctx.lineTo(sx - 12, sy);
          ctx.closePath(); ctx.stroke();
          const km = Math.hypot(bx - st[0], by - st[1], bz - st[2]) / 1000;
          ctx.fillStyle = col;
          ctx.fillText(km.toFixed(1), sx, sy + 26);
          if (bandits.aceId[i] >= 0) ctx.fillText("★", sx, sy - 18); // the named one
        }
        ctx.restore();
      }

      // taking fire: red vignette pulse
      if (player.hitFlash > 0) {
        player.hitFlash = Math.max(0, player.hitFlash - 1 / 60);
        if (!SETTINGS.current().motionReduce) {
        ctx.save();
        const a = Math.min(player.hitFlash * 0.9, 0.4);
        const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.42, w / 2, h / 2, h * 0.75);
        grad.addColorStop(0, "rgba(200,40,20,0)");
        grad.addColorStop(1, `rgba(200,40,20,${a})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
        }
      }
    };

    // top layer: threat warnings draw OVER all symbology (PASS-2 item 2 —
    // the pitch ladder was drawing across the MISSILE text); outline never
    // blinks below 0.6, fill pulses, round joins kill the miter spikes
    hud.arcadeTopLayer = (ctx) => {
      const w = ctx.canvas.width / (window.devicePixelRatio || 1);
      const h = ctx.canvas.height / (window.devicePixelRatio || 1);
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.lineJoin = "round"; ctx.miterLimit = 2; ctx.textAlign = "center";

      // ticket bars: blue (you) left, red (them) right — WT-style
      if (match) {
        const bw = Math.min(170,(w-90)/2), bh = 7, gap = 14;
        const y0 = Math.max(86,70*(hud.uiScale||1)+12,(cockpit?.toolbarBottom||0)+9);
        const blueF = match.blue / match.blueMax, redF = match.red / match.redMax;
        ctx.fillStyle = "rgba(0,10,0,0.5)";
        ctx.fillRect(w / 2 - bw - gap / 2 - 2, y0 - 2, bw + 4, bh + 4);
        ctx.fillRect(w / 2 + gap / 2 - 2, y0 - 2, bw + 4, bh + 4);
        ctx.fillStyle = "#7fb4e8";
        ctx.fillRect(w / 2 - gap / 2 - bw * blueF, y0, bw * blueF, bh);
        ctx.fillStyle = "#ff5a3c";
        ctx.fillRect(w / 2 + gap / 2, y0, bw * redF, bh);
        ctx.font = "10px ui-monospace, Menlo, monospace";
        ctx.fillStyle = "#9be89b";
        ctx.fillText(String(Math.round(match.blue)), w / 2 - bw - gap / 2 - 16, y0 + bh);
        ctx.fillText(String(Math.round(match.red)), w / 2 + bw + gap / 2 + 16, y0 + bh);

        if (match.rearming) {
          ctx.font = "bold 14px ui-monospace, Menlo, monospace";
          ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.85)";
          const msg = "REARMING " + Math.round(match.rearmT / 4 * 100) + "%";
          ctx.strokeText(msg, w / 2, h * 0.62);
          ctx.fillStyle = "#9be89b";
          ctx.fillText(msg, w / 2, h * 0.62);
        }
        if (match.outside && match.over === 0) {
          const pulse2 = Math.floor(performance.now() / 300) % 2 === 0 ? 1.0 : 0.55;
          ctx.font = "bold 26px ui-monospace, Menlo, monospace";
          ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,0.9)";
          ctx.strokeText("RETURN TO THE BATTLE", w / 2, h * 0.24);
          ctx.globalAlpha = pulse2;
          ctx.fillStyle = SETTINGS.getPalette().warn;
          ctx.fillText("RETURN TO THE BATTLE", w / 2, h * 0.24);
          ctx.globalAlpha = 1;
        }
        if (match.over !== 0) {
          ctx.fillStyle = "rgba(10,10,14,0.55)";
          ctx.fillRect(0, 0, w, h);
          ctx.font = "bold 44px ui-monospace, Menlo, monospace";
          ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,0.9)";
          const title = match.over > 0 ? "VICTORY" : "DEFEAT";
          ctx.strokeText(title, w / 2, h * 0.42);
          ctx.fillStyle = match.over > 0 ? "#9be89b" : "#ff5a3c";
          ctx.fillText(title, w / 2, h * 0.42);
          ctx.font = "13px ui-monospace, Menlo, monospace";
          ctx.fillStyle = "#e8e6df";
          // D-079 end-card un-mask: the comms feed hides at match.over, which
          // ate every authored victory/defeat line. The line written on the
          // SAME sim tick as the outcome is the mission's closing words —
          // render it as the card's sub-text (up to 3 wrapped rows).
          if (overSimT === null) overSimT = sim.time;
          let rows = null;
          if (script && missionData) {
            const c0 = script.readComms()[0];
            if (c0 && Math.abs(c0.t - overSimT) <= 0.25 && missionData.lines[c0.lineId]) {
              const words = missionData.lines[c0.lineId].split(" ");
              rows = [""];
              for (const wd of words) {
                if ((rows[rows.length - 1] + " " + wd).length > 90 && rows.length < 3) rows.push(wd);
                else rows[rows.length - 1] = (rows[rows.length - 1] ? rows[rows.length - 1] + " " : "") + wd;
              }
            }
          }
          if (!rows) rows = [script ? (match.over > 0 ? "mission complete" : "mission failed")
            : match.over > 0 ? "the ground war is broken — every target destroyed" : "no aircraft remaining — the war goes on without you"];
          ctx.lineWidth = 3;
          rows.forEach((r, ri) => {
            ctx.strokeText(r, w / 2, h * 0.42 + 34 + ri * 18);
            ctx.fillText(r, w / 2, h * 0.42 + 34 + ri * 18);
          });
        }
      }

      // PHASE 11 INC-1: mission objectives (top-left) + comms feed (bottom-left)
      if (script && missionData && (!match || match.over === 0)) {
        ctx.textAlign = "left";
        const VERB = { destroy_tag: "DESTROY", reach_zone: "REACH", survive_until: "HOLD", protect_tag: "PROTECT", kill_ace: "KILL" };
        let oy = Math.max(100,(cockpit?.toolbarBottom||0)+20);
        ctx.font = "10px ui-monospace, Menlo, monospace";
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,10,0,0.8)";
        for (const o of script.objectiveSummary()) {
          const mark = o.done ? "✓" : o.failed ? "✗" : "◦";
          const count = o.need > 1 ? ` ${o.count}/${o.need}` : "";
          // D-078 enabler: authored labels beat bare verbs; PROTECT rows are
          // lose-conditions, not tasks — amber while pending
          const label = (o.labelId !== undefined && missionData.lines[o.labelId]) || VERB[o.kind] || o.kind.toUpperCase();
          const line = `${mark} ${label}${count}`;
          ctx.strokeText(line, 18, oy);
          const pending = o.kind === "protect_tag" ? "#e8b46f" : "#9be89b";
          ctx.fillStyle = o.done ? "rgba(155,232,155,0.55)" : o.failed ? SETTINGS.getPalette().warn : pending;
          ctx.fillText(line, 18, oy);
          oy += 15;
        }
        const nowS = performance.now() / 1000;
        if (script._commsShown === undefined) script._commsShown = new Map(); // render-side age memory
        let cy = h - 64;
        const cx = 96; // clear of the G/M/AOA block in the corner
        for (const c of script.readComms().slice(0, 3)) {
          const key = c.lineId + ":" + c.t;
          if (!script._commsShown.has(key)) script._commsShown.set(key, nowS);
          const age = nowS - script._commsShown.get(key);
          if (age > 9) continue;
          const text = missionData.lines[c.lineId];
          if (!text) continue;
          ctx.globalAlpha = Math.min(1, Math.max(0, (9 - age) / 2));
          const subS = SETTINGS.subtitleScale();
          ctx.font = Math.round(11 * subS) + "px ui-monospace, Menlo, monospace";
          ctx.strokeText("» " + text, cx, cy);
          ctx.fillStyle = "#cfe8cf";
          ctx.fillText("» " + text, cx, cy);
          ctx.globalAlpha = 1;
          cy -= Math.round(16 * subS);
        }
        ctx.textAlign = "center";
      }

      // MISSILE warning (over everything but the end card)
      const airInbound = bandits && bandits.mslInboundPlayer ? bandits.mslInboundPlayer() : false;
      if (battlefield && (battlefield.samInbound() || airInbound) && (!match || match.over === 0)) {
        const pulse = Math.floor(performance.now() / 250) % 2 === 0 ? 1.0 : 0.6;
        ctx.font = "bold 30px ui-monospace, Menlo, monospace";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.strokeText("MISSILE", w / 2, h * 0.3);
        ctx.globalAlpha = pulse;
        ctx.fillStyle = SETTINGS.getPalette().warn;
        ctx.fillText("MISSILE", w / 2, h * 0.3);
      }
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
  // PHASE 13 VOICE SPIKE: the radio gets a voice (settings toggle, default
  // OFF). Voice reads settings.current() per utterance, so the bindLive ctx
  // entry is only the LIVE-chip honesty signal for the menu row — it stays
  // null (row honestly STORED) in free flight / when speechSynthesis is absent.
  let voice = null;
  if (script && missionData && "speechSynthesis" in window) {
    try {
      const V = await import("./game/voice.js");
      voice = new V.Voice(SETTINGS);
      V.hookComms(script, missionData, voice); // 300ms poll on script.commsHead
    } catch (err) { console.warn("voice unavailable:", err && err.message); }
  }
  // PHASE 15: settings go live (fov/renderScale/volumes/muzzle-flash gate)
  SETTINGS.bindLive({ renderer, camera, audio, input, hud, gunFlash: player ? player.gun.flash : null, baseTier: state.tier, hudLive: true, voice });
  // MAXFI A1: TRAA + bloom + flare post chain (WebGPU only; ?post=0 keeps
  // the plain pipe for QA baselines and numeric oracles)
  let post = null;
  let vol = null;
  if (usePost) {
    // volumetric clouds ride the post chain (?vclouds=0 keeps billboards);
    // module + noise were hoisted pre-terrain (volPre) for the shadow node
    if (volPre) {
      vol = {
        VC: volPre.VC,
        noise: volPre.noise,
        uTime: uniform(0),
        uCamPos: atmoH ? atmoH.uCamPos : uniform(new THREE.Vector3(0, 3400, 0)),
      };
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

  cockpit = new Cockpit({ state, input, controls, audio, hud, flags });
  state.cockpit = cockpit;
  renderer.domElement.tabIndex = -1;

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // public hooks (QA + future phases)

  // PHASE 12: kill cam — render-side only. On death: 4s orbit of the crash
  // point (captured from the last frame BEFORE the sim reset teleported the
  // jet home). On match end: a continuous victory/defeat orbit of the jet.
  let killCam = null; // { c: Vector3, until: ms }
  const seenB = new Uint8Array(8); // HUD detection latch per bandit slot (render-side; slots never recycle)
  let overSimT = null; // sim.time latched at match.over — the end-card un-mask window (D-079)
  let kcCrashes = player ? player.crashes : 0;
  const lastJetPos = new THREE.Vector3();
  const kcPos = new THREE.Vector3();

  Object.assign(state, {
    rendering: { renderer, scene, camera, world, aircraftLighting, projectedDepthVisible },
    sim, input, gamepad, controls, dbg, atmosphere, terrain, water, clouds, hud, player, battlefield, match, script, bandits, directory,
    kc: () => killCam,
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

  // Meter a small GPU target asynchronously. The old canvas readback stalled
  // the render thread every twelfth frame; adaptation stays off that path.
  let meter = null;
  if (post && flags.get("autoexp") !== "0") {
    try {
      const { AsyncExposure } = await import("./engine/exposure.js");
      meter = new AsyncExposure(renderer, post.meterNode);
      await meter.init();
    } catch (err) {
      meter?.dispose(); meter = null;
      console.warn("Exposure metering unavailable, calibrated exposure stays:", err?.message || err);
    }
  }
  state.autoExposure = !!meter;
  state.meter = meter;
  bootStage('warmup','Preparing a smooth first frame…','Warming up the graphics before handing you the controls. Your flight has not started yet.');

  // Prepare the actual spawn view while the loading screen is still up.
  // In particular, this keeps LOW/MED scene compilation out of the first
  // interactive frame, when the pilot is already trying the flight controls.
  if (player) {
    const parked=world.fixYaw!==null;
    if (parked) world.renderParkedCamera(camera);
    player.render(1,camera,parked,0);
  } else world.render(0,camera);
  battlefield?.render(0,camera);
  bandits?.render(1,camera);
  terrain?.update(camera);
  water?.update(camera,0);
  clouds.update(camera,0);
  if (vol) { vol.uTime.value=0; vol.VC.updateCamera?.(camera); }
  atmosphere.update(camera);
  aircraftLighting.update(world.jet, terrain);
  if (atmoH) atmoH.uCamPos.value.copy(camera.position);
  renderer.toneMappingExposure=atmosphere.exposure;
  if (!post) await renderer.compileAsync(scene,camera);
  // Real draws cover the post graph's own MRT, temporal and shadow variants.
  // No physics, input, audio or weapon effects advance during this warmup.
  for(let pass=0;pass<2;pass++) {
    await new Promise(requestAnimationFrame);
    if(post)post.post.render();else renderer.render(scene,camera);
  }
  await renderer.backend.device?.queue.onSubmittedWorkDone();
  cockpit.clearInput();

  let last = performance.now();
  let firstFrame = true;
  let waterClock = 0; // render-side only — the sim never reads water
  let cloudClock = 0; // same convention; drives clouds AND their shadows
  function frame(now) {
    requestAnimationFrame(frame);
    let dtMs = state.resetFrameClock ? 0 : Math.min(now - last, 250);
    state.resetFrameClock = false;
    last = now;
    gamepad.update();
    const pauseRequested=input.pressed("menu") || gamepad.pressed("menu") || input.pressed("game_pause");
    if (pauseRequested && !controls.open && !cockpit.guide.open && !cockpit.log.open) cockpit.toggle();
    if (input.pressed("help")) cockpit.openGuide();
    if (cockpit.paused) {
      input.clear();
      return; // No sim catch-up, camera drift, GPU rendering or weapon aging while paused.
    }
    // A gamepad can resume inside this very frame, after the clock was read.
    if (state.resetFrameClock) { dtMs=0; state.resetFrameClock=false; }
    input.sampleGamepad(dtMs / 1000);
    if (input.pressed("hide_hud")) cockpit.toggleHUD();
    if (input.pressed("recenter_aim")) { player?.recenterAim(); cockpit.toast("Aim aligned with your aircraft."); }
    frameNo++;
    if (benchSamples && frameNo > 20) {
      benchSamples.push(dtMs);
      if (benchSamples.length >= 80) {
        const sorted = [...benchSamples].sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1];
        const tier = benchPick(median, state.backend, state.tier);
        const rec = { ms: +median.toFixed(2), backend: state.backend, tier };
        saveBench(rec);
        state.bench = rec;
        // A quality tier owns materials and render passes, not just resolution.
        // Apply the measured recommendation on the next launch; keep the live
        // tier label truthful and avoid reallocating GPU targets during flight.
        state.recommendedTier = tier;
        benchSamples = null;
      }
    }
    if (input.pressed("debug")) dbg.toggle();
    player?.feedInput(input);
    const alpha = sim.advance(dtMs / 1000);
    if (player) {
      // kill cam trigger: crashes incremented this frame -> orbit where the
      // jet WAS (lastJetPos still holds the pre-reset position)
      if (player.crashes !== kcCrashes) {
        kcCrashes = player.crashes;
        killCam = { c: lastJetPos.clone(), until: now + 4000 };
      }
      if (killCam && killCam.until && now > killCam.until) killCam = null;
      if (authored && match && match.over === 1 && !authored.saved) {
        authored.saved = true;
        try {
          authored.A.markDone(authored.id);
          state.progressSaved = authored.A.authSaveSucceeded();
        } catch (err) { state.progressSaved = false; console.warn("authored save failed:", err && err.message); }
      }
      if (campaign && match && match.over !== 0 && !campaign.saved) {
        campaign.saved = true; // one write, render-side: sim never reads the save
        try {
          const aceUnit = campaign.spec.bandits && campaign.spec.bandits.find((b) => b.aceId >= 0);
          campaign.save = campaign.E.reduceCampaign(campaign.save, campaign.spec,
            { over: match.over, blueLeft: match.blue, redLeft: match.red,
              ace: aceUnit && bandits ? { id: aceUnit.aceId, status: bandits.aceStatus(aceUnit.aceId) } : undefined });
          campaign.E.saveSave(campaign.save);
          state.progressSaved = true;
        } catch (err) { state.progressSaved = false; console.warn("campaign save failed:", err && err.message); }
      }
      const matchOrbit = match && match.over !== 0;
      const cine = !!killCam || matchOrbit;
      const parked = world.fixYaw !== null;
      if (parked) world.renderParkedCamera(camera);
      player.render(alpha, camera, parked || cine, dtMs / 1000 * sim.timescale);
      if (!parked && cine) {
        const center = matchOrbit ? world.jet.position : killCam.c;
        const th = now * 0.00045;
        kcPos.set(center.x + Math.cos(th) * 170, center.y + 55, center.z + Math.sin(th) * 170);
        camera.position.lerp(kcPos, 0.08);
        camera.up.set(0, 1, 0);
        camera.lookAt(center);
      }
      if (!cine) lastJetPos.copy(world.jet.position);
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
    bandits?.render(alpha, camera);
    aircraftFrame.projectedPixels = Math.max(world.f22.userData.aircraft.length, world.f22.userData.aircraft.span)
      * Math.abs(camera.projectionMatrix.elements[5]) * window.innerHeight
      / (2 * Math.max(1, world.jet.position.distanceTo(camera.position)));
    aircraftFrame.maxQuality = state.tier;
    updateF22Visuals(world.f22, aircraftFrame);
    terrain?.update(camera);
    waterClock += dtMs / 1000;
    water?.update(camera, waterClock);
    cloudClock += dtMs / 1000;
    clouds.update(camera, cloudClock);
    if (vol) { vol.uTime.value = cloudClock; vol.VC.updateCamera?.(camera); }
    const hudEl = hud.canvas || hud.svg;
    if (hudEl && flags.get("hud") !== "0" && flags.get("chrome") !== "0") {
      if (!hudEl.style.transition) hudEl.style.transition = "opacity 0.3s";
      hudEl.style.opacity = killCam ? "0" : "1"; // death cinematic flies clean
    }
    hud.update(player ? player.hudState() : testworldHudState(world, alpha));
    atmosphere.update(camera);
    aircraftLighting.update(world.jet, terrain);
    if (atmoH) atmoH.uCamPos.value.copy(camera.position);
    renderer.toneMappingExposure = atmosphere.exposure * (meter ? meter.mult : 1);
    if (post) post.post.render();
    else renderer.render(scene, camera);
    if (meter) meter.step(dtMs / 1000);
    dbg.frame(dtMs, { backend: state.backend, tier: state.tier, sim });
    cockpit.update(now, dtMs);
    input.consumeFrame();
    if (firstFrame) {
      firstFrame = false;
      state.ready = true;
      state.bootStage='ready';
      document.getElementById('veil')?.setAttribute('aria-busy','false');
      input.suspended = false;
      document.getElementById("veil")?.classList.add("lift");
      setTimeout(() => document.getElementById("veil")?.remove(), 900);
      cockpit.onReady();
    }
  }
  requestAnimationFrame(frame);
}

// A bare URL (or an analytics-only query) opens preflight. Explicit flight
// and development links remain directly launchable for repeatable QA.
if (!hasFlightRequest(new URLSearchParams(location.search))) showFlightdeck(state);
else boot().catch((err) => {
  state.failure = String(err && err.stack || err);
  console.error("RAPTOR boot failure:", err);
  const v = document.getElementById("veil");
  if (v) {
    const message = bootFailureMessage(err, state.bootStage);
    v.setAttribute('aria-busy','false');
    v.dataset.failed='true';
    v.querySelector(".status").textContent = message.title;
    const detail = v.querySelector(".boot-status-detail");
    if (detail) detail.textContent = message.detail;
    const currentStep=v.querySelector('[aria-current="step"]');
    if(currentStep)currentStep.dataset.state='failed';
    const retry = document.createElement("button");
    retry.className = "ui-button primary"; retry.textContent = message.retry;
    retry.onclick = () => location.reload();
    v.querySelector(".boot-actions")?.append(retry);
    retry.focus();
  }
});
