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

const VERSION = "0.28.0";
const PHASE = 12;

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
  const _bv = new THREE.Vector3(); // HUD projection scratch

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
  // PHASE 12 item 4: on the volumetric path, ground shadows come from the
  // SAME coverage field the march breathes (volclouds noise hoisted here —
  // terrain materials bake their shadow node at construction, so this must
  // exist pre-Terrain.load; the post chain reuses volPre, no double bake).
  // ?cloudshadow=old keeps the billboard projector for A/B.
  let volPre = null;
  if (backend === "webgpu" && flags.get("post") !== "0" && flags.get("vclouds") !== "0") {
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
    const vs = document.querySelector("#veil .status");
    if (vs) vs.innerHTML = `<b>LOADING ${fg.label}</b> — real USGS terrain`;
    try {
      // drape: 16k imagery on webgpu; 4k on the webgl fallback (SwiftShader
      // tops out at 8192); ?drape=0 keeps the procedural ramps for QA
      const drape = flags.get("drape") === "0" ? null : (backend === "webgpu" ? "16k" : "4k");
      terrain = await Terrain.load("/assets/terrain/" + fg.asset, atmosphere.frontName,
        volShadow || makeCloudShadowNode(clouds.shared), { drape, aerial: atmoH?.aerial });
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
      bandits = new BD.Bandits(scene, { terrain, battlefield });
      sim.addSystem(bandits);
      directory = TG.makeDirectory({ battlefield, bandits });
    } catch (err) { bandits = null; directory = null; console.warn("bandits unavailable:", err && err.message); }
  }

  // PHASE 7: you fly. ?demo=1 keeps the old scripted circle for QA baselines.
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
  let match = null, script = null, missionData = null, campaign = null;
  if (player && battlefield && flags.get("nomatch") !== "1") {
    const { Match } = await import("./game/match.js");
    const BF = await import("./game/battlefield.js");
    const pad = BF.FRONT_AIRFIELDS ? BF.FRONT_AIRFIELDS[atmosphere.frontName] : null; // INC-2 per-front pads
    match = new Match(battlefield, player, { airfield: pad });
    const mname = flags.get("mission");
    const opFront = !mname && flags.get("op") ? atmosphere.frontName : null;
    if (mname || opFront) {
      try {
        const M = await import("./game/missions.js");
        const { Script } = await import("./game/script.js");
        let spec, extraLines = null;
        if (opFront) { // INC-3: generated operation sortie — save -> spec, one door in
          const E = await import("./campaign/engine.js");
          const save = E.loadSave(opFront);
          spec = M.loadMission(E.genMission(save));
          extraLines = E.OP_LINES || null;
          campaign = { E, save, spec, saved: false };
          if (!flags.get("tod") && spec.todH !== undefined) atmosphere.setTime(spec.todH);
        } else {
          spec = M.loadMission(mname);
        }
        script = new Script(spec, { battlefield, player, match, terrain, bandits });
        match.scripted = true;
        if (spec.airfield) match.airfield = spec.airfield; // mission pad overrides
        missionData = { spec, lines: extraLines ? { ...M.COMMS_LINES, ...extraLines } : M.COMMS_LINES };
        if (spec.playerSpawn) {
          const ps = spec.playerSpawn; // mission spawn is also the respawn point
          player.spawn = { x: ps.x, y: ps.y, alt: ps.alt, headingRad: (ps.headingDeg || 0) * Math.PI / 180, speed: ps.speed || 200 };
          player.debugCommand({ pos: ps, throttle: 0.8 });
        }
        sim.addSystem(script);
      } catch (err) { campaign = null; console.warn("mission unavailable, quick match stays:", err && err.message); }
    }
    sim.addSystem(match);
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
      if (pv.z < 1 && pv.z > -1) {
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
          _bv.set(bx, bz, by).project(camera); // ENU -> three -> NDC
          if (_bv.z > 1) continue; // behind the camera plane
          const sx = (_bv.x * 0.5 + 0.5) * w, sy = (-_bv.y * 0.5 + 0.5) * h;
          if (sx < -30 || sx > w + 30 || sy < -30 || sy > h + 30) continue;
          const col = bandits.side[i] === 1 ? "#7fb4e8" : "#ff8a5c";
          ctx.strokeStyle = col;
          ctx.beginPath();
          ctx.moveTo(sx, sy - 12); ctx.lineTo(sx + 12, sy); ctx.lineTo(sx, sy + 12); ctx.lineTo(sx - 12, sy);
          ctx.closePath(); ctx.stroke();
          const km = Math.hypot(bx - st[0], by - st[1], bz - st[2]) / 1000;
          ctx.fillStyle = col;
          ctx.fillText(km.toFixed(1), sx, sy + 26);
        }
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
        const bw = 170, bh = 7, gap = 14, y0 = 58;
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
          ctx.fillStyle = "#ff5a3c";
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
          const sub = script ? (match.over > 0 ? "mission complete" : "mission failed")
            : match.over > 0 ? "the ground war is broken — every target destroyed" : "no aircraft remaining — the war goes on without you";
          ctx.lineWidth = 3; ctx.strokeText(sub, w / 2, h * 0.42 + 34);
          ctx.fillText(sub, w / 2, h * 0.42 + 34);
        }
      }

      // PHASE 11 INC-1: mission objectives (top-left) + comms feed (bottom-left)
      if (script && missionData && (!match || match.over === 0)) {
        ctx.textAlign = "left";
        const VERB = { destroy_tag: "DESTROY", reach_zone: "REACH", survive_until: "HOLD", protect_tag: "PROTECT", kill_ace: "KILL" };
        let oy = 92;
        ctx.font = "10px ui-monospace, Menlo, monospace";
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,10,0,0.8)";
        for (const o of script.objectiveSummary()) {
          const mark = o.done ? "✓" : o.failed ? "✗" : "◦";
          const count = o.need > 1 ? ` ${o.count}/${o.need}` : "";
          const line = `${mark} ${VERB[o.kind] || o.kind.toUpperCase()}${count}`;
          ctx.strokeText(line, 18, oy);
          ctx.fillStyle = o.done ? "rgba(155,232,155,0.55)" : o.failed ? "#ff5a3c" : "#9be89b";
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
          ctx.font = "11px ui-monospace, Menlo, monospace";
          ctx.strokeText("» " + text, cx, cy);
          ctx.fillStyle = "#cfe8cf";
          ctx.fillText("» " + text, cx, cy);
          ctx.globalAlpha = 1;
          cy -= 16;
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
        ctx.fillStyle = "#ff5a3c";
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
  // MAXFI A1: TRAA + bloom + flare post chain (WebGPU only; ?post=0 keeps
  // the plain pipe for QA baselines and numeric oracles)
  let post = null;
  let vol = null;
  if (backend === "webgpu" && flags.get("post") !== "0") {
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

  document.getElementById("controlsLink")?.addEventListener("click", (e) => { e.preventDefault(); controls.show(); });

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
  let kcCrashes = player ? player.crashes : 0;
  const lastJetPos = new THREE.Vector3();
  const kcPos = new THREE.Vector3();

  Object.assign(state, {
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

  // PHASE 12: auto-exposure metering (closes the golden-triptych
  // LIVE-WITH-IT). Every 12 frames, blit the finished canvas into a 16x16
  // 2D canvas, take log-average luminance, and drive an exposure multiplier
  // toward mid-gray with eye-like adaptation (fast to brighten into shadow,
  // slower to recover from glare). Multiplies the PALETTE exposure — night
  // stays night via clamps. WebGPU+post only; ?autoexp=0 reverts.
  let meter = null;
  if (post && flags.get("autoexp") !== "0") {
    const mc = document.createElement("canvas");
    mc.width = 16; mc.height = 16;
    meter = { ctx: mc.getContext("2d", { willReadFrequently: true }), mult: 1, frame: 0 };
  }
  state.autoExposure = !!meter;
  state.meter = meter; // QA: adaptation multiplier visibility
  function meterStep(dtSec) {
    meter.frame++;
    if (meter.frame % 12 !== 0) return;
    try {
      meter.ctx.drawImage(renderer.domElement, 0, 0, 16, 16);
      const px = meter.ctx.getImageData(0, 0, 16, 16).data;
      let logSum = 0;
      for (let i = 0; i < px.length; i += 4) {
        const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
        logSum += Math.log(Math.max(l, 1e-3));
      }
      const avg = Math.exp(logSum / 256);
      const target = 0.42;
      const desired = Math.min(Math.max(meter.mult * Math.pow(target / Math.max(avg, 1e-3), 0.6), 0.55), 2.3);
      // adaptation: ~1s brightening, ~3s dimming (12-frame cadence)
      const k = desired > meter.mult ? Math.min(dtSec * 12 / 1.0, 1) : Math.min(dtSec * 12 / 3.0, 1);
      meter.mult += (desired - meter.mult) * k;
    } catch (_) { /* canvas readback denied — palette exposure carries on */ }
  }

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
      // kill cam trigger: crashes incremented this frame -> orbit where the
      // jet WAS (lastJetPos still holds the pre-reset position)
      if (player.crashes !== kcCrashes) {
        kcCrashes = player.crashes;
        killCam = { c: lastJetPos.clone(), until: now + 4000 };
      }
      if (killCam && killCam.until && now > killCam.until) killCam = null;
      if (campaign && match && match.over !== 0 && !campaign.saved) {
        campaign.saved = true; // one write, render-side: sim never reads the save
        try {
          campaign.save = campaign.E.reduceCampaign(campaign.save, campaign.spec,
            { over: match.over, blueLeft: match.blue, redLeft: match.red });
          campaign.E.saveSave(campaign.save);
        } catch (err) { console.warn("campaign save failed:", err && err.message); }
      }
      const matchOrbit = match && match.over !== 0;
      const cine = !!killCam || matchOrbit;
      const parked = world.fixYaw !== null;
      if (parked) world.renderParkedCamera(camera);
      player.render(alpha, camera, parked || cine);
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
    if (atmoH) atmoH.uCamPos.value.copy(camera.position);
    renderer.toneMappingExposure = atmosphere.exposure * (meter ? meter.mult : 1);
    if (post) post.post.render();
    else renderer.render(scene, camera);
    if (meter) meterStep(dtMs / 1000);
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

// PHASE 12: hangar — a bare URL gets the front picker before any engine
// spend; ANY query param (QA flags included) flies straight in unchanged.
function hangar() {
  document.getElementById("veil")?.remove();
  const chrome = document.getElementById("chrome");
  if (chrome) chrome.style.display = "none"; // the hangar carries its own brand
  const el = document.getElementById("hangar");
  el.style.display = "flex";
  const cards = [...el.querySelectorAll(".fcard")];
  const chips = [...el.querySelectorAll(".todchip")];
  const GOLDEN = { NELLIS: 18.8, VALDEZ: 21.4, MARIANAS: 17.8 }; // solar-elevation-matched (LATITUDE LAW)
  const TOD = { noon: () => 12, afternoon: () => 15.5, golden: (f) => GOLDEN[f] };
  let front = "NELLIS", tod = "noon";
  const sync = () => {
    for (const c of cards) c.classList.toggle("sel", c.dataset.front === front);
    for (const c of chips) c.classList.toggle("sel", c.dataset.tod === tod);
  };
  const fly = () => { location.href = "?front=" + front + "&tod=" + TOD[tod](front); };
  // INC-3: persistent operation card — the war you left is still there
  const opBox = document.getElementById("opRow");
  const flyOp = () => { location.href = "?front=" + front + "&op=1"; };
  let opSum = null;
  const syncOp = async () => {
    if (!opBox) return;
    try {
      const E = await import("./campaign/engine.js");
      opSum = E.summarize(E.loadSave(front));
      const km = opSum.frontKm > 0 ? "+" + opSum.frontKm : String(opSum.frontKm);
      opBox.innerHTML = opSum.status !== "live"
        ? `OPERATION ${opSum.status.toUpperCase()} — front line ${km} km · <button id="opFly">START ANEW</button>`
        : `OPERATION · front line ${km} km · sortie ${opSum.sortieIndex + 1} · next: ${opSum.nextType ? opSum.nextType.toUpperCase() : "?"}${opSum.nextZoneName ? " — " + opSum.nextZoneName : ""} · <button id="opFly">FLY THE OPERATION</button>`;
      opBox.style.display = "block";
      document.getElementById("opFly")?.addEventListener("click", () => {
        if (opSum.status !== "live") { try { localStorage.removeItem("raptor.op.v1:" + front); } catch (_) {} }
        flyOp();
      });
    } catch (_) { opBox.style.display = "none"; } // engine not landed yet — hide
  };
  syncOp();
  for (const c of cards) c.addEventListener("click", () => { front = c.dataset.front; sync(); syncOp(); });
  for (const c of cards) c.addEventListener("dblclick", fly);
  for (const c of chips) c.addEventListener("click", () => { tod = c.dataset.tod; sync(); });
  document.getElementById("flyBtn").addEventListener("click", fly);
  addEventListener("keydown", (e) => {
    const i = ["Digit1", "Digit2", "Digit3"].indexOf(e.code);
    if (i >= 0) { front = cards[i].dataset.front; sync(); syncOp(); }
    else if (e.code === "KeyT") { tod = chips[(chips.findIndex((c) => c.dataset.tod === tod) + 1) % chips.length].dataset.tod; sync(); }
    else if (e.code === "Enter" || e.code === "Space") fly();
  });
  state.hangar = true; // QA: visible without booting
}

if (!location.search) hangar();
else boot().catch((err) => {
  state.failure = String(err && err.stack || err);
  console.error("RAPTOR boot failure:", err);
  const v = document.getElementById("veil");
  if (v) v.querySelector(".status").textContent = "BOOT FAILURE — " + (err && err.message || err);
});
