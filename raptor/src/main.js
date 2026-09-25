import { loadTerrainImagery } from "./world/terrain-imagery-loader.js";
import { installReversedDepthSort } from "./engine/reverseddepth.js";
// RAPTOR boot: renderer (WebGPU with WebGL2 fallback), sim, input, debug, hooks.

import * as THREE from "three";
import { installWebGLIndexStateFix } from "./engine/webglindexstate.js";
import { uniform, pow, vec3, Fn, If, positionWorld } from "three/tsl";
import { SimCore, determinismProbe, DT } from "./engine/sim.js";
import { Input } from "./engine/input.js";
import { GamepadInput } from "./engine/gamepad.js";
import { detectTier, isCompatibleBench, deviceTier, bootAssetTier as chooseBootAssetTier, tierParams, setTier, TIERS, savedBench, saveBench, clearBench, hasManualTier } from "./engine/quality.js";
import { cloudQuality, cloudOptionsFromFlags, qualityProfile, qualityWorkload } from "./engine/cloudquality.js";
import { cirrusAtlasResolution, oceanFineResolution, terrainSourcePreset, requestedBootAssets, describeBootAssets, assetsNeedReload } from "./engine/bootassets.js";
import { QualityBenchmark } from "./engine/qualitybench.js";
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
import { surfaceCelestialTransport } from "./world/celestial-surface.js";
import { Terrain } from "./world/terrain.js";
import { Water } from "./world/water.js";
import { PlanetCurvature } from "./world/planetcurvature.js";
import { PlanetObjectBender, attachRaptorPlanetObjects } from "./world/planetobjects.js";
import { Clouds, makeCloudShadowNode } from "./world/clouds.js";
import { HUD } from "./game/hud.js";
import { FlightFX } from "./game/flightfx.js";
import { AircraftLighting } from "./aircraft/lighting.js";
import { updateF22Visuals } from "./aircraft/f22-lod.js";
import { Soundscape } from "./game/soundscape.js";

const VERSION = "1.4.0";
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
  // Float depth keeps distant terrain/cloud intersections precise on WebGPU.
  // ?reversedepth=0 retains the forward path; WebGL construction stays below.
  const depthFlags = new URLSearchParams(location.search);
  const reversedDepth = (depthFlags.get("reversedepth") ?? depthFlags.get("reverseDepth")) !== "0";
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
        reversedDepthBuffer: reversedDepth,
        requiredLimits: {
          maxTextureDimension2D: Math.min(adapter.limits.maxTextureDimension2D, 16384),
          // the 16k albedo upload stages through a 1GB buffer — the default
          // 256MB cap rejects it (adapter-clamped so init never fails)
          maxBufferSize: Math.min(adapter.limits.maxBufferSize, 4294967296),
        },
      });
      await r.init();
      if (reversedDepth && !r.backend.isWebGPUBackend) {
        r.dispose();
        throw new Error("Reversed scene depth is only supported on WebGPU.");
      }
      installReversedDepthSort(r);
      return { renderer: r, backend: "webgpu", canvas };
    } catch (err) {
      console.warn("WebGPU init failed, falling back to WebGL2:", err && err.message);
      canvas = freshCanvas(canvas);
    }
  }
  // Log depth avoids distant coast/sea-floor conflicts in WebGL's depth24
  // buffer. Keep an ordinary-depth comparison and compatibility opt-out.
  const r = new THREE.WebGPURenderer({
    canvas, antialias: true, forceWebGL: true,
    logarithmicDepthBuffer: new URLSearchParams(location.search).get("logdepth") !== "0",
  });
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
  if (backend === "webgl") installWebGLIndexStateFix(renderer);
  bootStage('landscape','Preparing the landscape…','Loading the terrain, sky and lighting for your chosen region.');
  state.backend = backend;
  state.depthMode = renderer.reversedDepthBuffer ? "reversed-float32" : renderer.logarithmicDepthBuffer ? "logarithmic" : "forward";
  const cloudOptions = cloudOptionsFromFlags(flags);
  const bootRenderScale = SETTINGS.current().renderScale;
  // Select static assets before consulting cached frame timings. Auto's
  // measured render tier cannot change the source/FFT workload next boot.
  const autoAssetTier = deviceTier({ backend });
  const bootAssetTier = chooseBootAssetTier({ backend });
  state.bootAssetTier = bootAssetTier;
  state.tier = bootAssetTier; // provisional render settings behind the veil
  const bootCloudQuality = cloudQuality(state.tier, cloudOptions);
  const params = tierParams(state.tier);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * params.renderScale);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 120000);
  const _bv = new THREE.Vector3(); // HUD projection scratch

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;

  // Terrain, water, clouds and aircraft share the same local planet frame.
  // The flat-map renderer remains available for controlled QA comparisons.
  const curvature = flags.get("curvature") !== "0" ? new PlanetCurvature() : null;
  state.curvature = curvature;
  const usePost = backend === "webgpu" && flags.get("post") !== "0" && (params.post || flags.get("post") === "1");
  const useVolume = usePost && flags.get("vclouds") !== "0";
  const textureLimit = renderer.backend.device?.limits.maxTextureDimension2D
    ?? renderer.backend.gl?.getParameter(renderer.backend.gl.MAX_TEXTURE_SIZE) ?? 2048;
  const atmosphere = new Atmosphere(scene, (flags.get("front") || "NELLIS").toUpperCase(),
    { cirrusResolution: cirrusAtlasResolution(bootAssetTier, textureLimit) });
  atmosphere.initIBL(renderer);
  if (flags.get("tod")) atmosphere.setTime(parseFloat(flags.get("tod")));

  // One scene-linear source bundle: these are shared uniform references,
  // including pre-exposed irradiance/ambient. Probe captures clone values.
  const sourceUniforms = {
    uSunDir: atmosphere.sky.uSunDir,
    uSunI: atmosphere.sky.uSceneIrradiance || uniform(36.0),
  };
  for (const key of ["uMoonDir", "uMoonRatio", "uMoonColor", "uExposureGain", "uNightSkyRadiance", "uKeyLightDir"]) {
    if (atmosphere.sky[key]) sourceUniforms[key] = atmosphere.sky[key];
  }
  const celestial = sourceUniforms.uMoonDir ? sourceUniforms : null;
  const keyLightDir = atmosphere.sky.uKeyLightDir || atmosphere.sky.uSunDir;

  // MAXFI A3: Hillaire physical atmosphere — LUT-driven sky march + in-material
  // aerial perspective. Both node backends support its ordinary texture/loop
  // path; ?atmo=preetham retains the lightweight analytic fallback.
  let atmoH = null;
  if (flags.get("atmo") !== "preetham") {
    try {
      const H = await import("./world/hillaire.js");
      const luts = await H.loadAtmo("/assets/atmo");
      if (luts) {
        const uSunI = sourceUniforms.uSunI;
        const uCamPos = uniform(new THREE.Vector3(0, 3400, 0));
        const nodeArgs = { tTex: luts.tTex, msTex: luts.msTex, ...sourceUniforms, uCamPos };
        // per-front air mass: the LUTs bake a STANDARD atmosphere; Nevada's
        // dry desert air scatters far less (PASS-1 item 2: foreground desert
        // measured B−R +44 — blue wash with zero depth grading). trans^k with
        // k<1 = optically thinner air; ins scales with it.
        const airK = { NELLIS: 0.42, VALDEZ: 0.8, MARIANAS: 1.0 }[atmosphere.frontName] ?? 1.0;
        const baseTrans = H.aerialTransNode(nodeArgs), baseIns = H.aerialInscatterNode(nodeArgs);
        atmoH = {
          H, luts, sourceUniforms, airK, uCamPos, uSunI,
          aerial: {
            trans: airK === 1.0 ? baseTrans : (wp) => pow(baseTrans(wp), vec3(airK, airK, airK)),
            ins: airK === 1.0 ? baseIns : (wp) => baseIns(wp).mul(airK),
            uSunI,
            composite: H.aerialCompositeNode(nodeArgs, uSunI, airK),
            sourceTransport: flags.get("cloudtransport") === "legacy" ? null
              : { luts, calibrateDay: flags.get("cloudtransport") !== "toa",
                  relativeOmission: ["strict", "toa"].includes(flags.get("cloudtransport")) ? 0 : .001 },
            celestial,
          },
        };
        const { makeSkyRadiance } = await import("./world/sky-radiance.js");
        let skyViewCache = null;
        if (backend === "webgpu" && flags.get("skycache") !== "0") {
          const { ObserverSkyViewCache } = await import("./world/sky-view-cache.js");
          skyViewCache = new ObserverSkyViewCache({ renderer, luts, sourceUniforms, uFrameOrigin: uCamPos });
          atmoH.skyViewCache = skyViewCache; state.skyViewCache = skyViewCache.stats;
          window.addEventListener("pagehide", event => { if (!event.persisted) skyViewCache.dispose(); });
        }
        const sharedSky = makeSkyRadiance({ luts, sourceUniforms, uFrameOrigin: uCamPos,
          scatteringRadiance: skyViewCache?.radiance,
          cirrusAtlas: atmosphere.sky.cirrusAtlas, includeSolarDisc: true });
        atmosphere.sky.setHillaire(H.skySkyNode(nodeArgs), uSunI, sharedSky);
        // IBL's cube cameras are at the origin; only their ray direction is
        // used. Both observer and planet frame stay at the actual main view.
        const iblSky = makeSkyRadiance({ luts, sourceUniforms, uFrameOrigin: uCamPos,
          cirrusAtlas: atmosphere.sky.cirrusAtlas, includeSolarDisc: false });
        atmosphere.setIBLSkyRadiance(iblSky, uCamPos);
        // Terrain/water use physical transport. The WebGL card/aircraft
        // fallback still needs its inexpensive distance haze.
        if (backend === "webgpu") scene.fog = null;
        atmosphere.hillaire = true; // exposure palette gets a twilight floor (tuned for Preetham otherwise)
        if (atmosphere.setHillaireLuts) atmosphere.setHillaireLuts(luts);
        else atmosphere.setTime(atmosphere.hours); // re-derive with the physical path active
      }
    } catch (err) { console.warn("hillaire atmosphere unavailable, Preetham stays:", err && err.message); }
  }
  state.hillaire = !!atmoH;

  // Cloud illumination also needs the night source when the physical
  // atmosphere is disabled. Identity air preserves that fallback's fog.
  const cloudAerial = atmoH?.aerial || (celestial ? {
    trans: () => vec3(1), ins: () => vec3(0), uSunI: sourceUniforms.uSunI, celestial,
  } : null);
  // The fallback's directional billows and shadow projector follow the
  // same dominant Sun/Moon direction; its optional source bundle sets energy.
  const clouds = new Clouds(atmosphere.frontName, params, keyLightDir, celestial ? atmosphere.sky : null, curvature);
  scene.add(clouds.group);

  const sim = new SimCore(1);
  const world = new TestWorld(scene, { aircraftQuality: state.tier });
  const aircraftFrame = { projectedPixels: Infinity, maxQuality: state.tier };
  const aircraftLighting = new AircraftLighting({ renderer, atmosphere, params,
    aerial: flags.get("aircraftAir") === "0" ? null : atmoH?.aerial,
    shadows: flags.get("aircraftShadows") !== "0", curvature });
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
      // Choose once, before cloud-shadow materials capture the coverage
      // threshold. Neither the live benchmark nor menu swaps compiled noise.
      const noise = await VC.loadCloudNoise({ seed: 1337, resolution: bootCloudQuality.noise,
        onFallback: ({ from, to, error }) => console.warn(`Cloud noise ${from} → ${to}:`, error.message),
      });
      volPre = { VC, noise };
      state.cloudNoise = { requested: bootCloudQuality.noise, resolution: noise.resolution,
        source: noise.source, version: noise.version, seed: noise.seed, normalization: noise.normalization,
        baseN: noise.baseN, detailN: noise.detailN };
    } catch (err) { console.warn("volumetric clouds unavailable, billboards stay:", err && err.message); }
  }
  // Each source projects the same cloud density along its own direction.
  // The receiver's planetary horizon is separate from cloud visibility.
  const makeSourceCloudShadow = (direction) => {
    if (volPre?.VC.makeVolCloudShadowNode && flags.get("cloudshadow") !== "old") {
      return volPre.VC.makeVolCloudShadowNode({ noise: volPre.noise,
        front: atmosphere.frontName, uSunDir: direction, curvature });
    }
    return makeCloudShadowNode({ ...clouds.shared, uSunDir: direction }, curvature);
  };
  const groundCloudShadow = makeSourceCloudShadow(atmosphere.sky.uSunDir);
  const moonCloudShadow = makeSourceCloudShadow(atmosphere.sky.uMoonDir);
  const uMoonAngularRadius = uniform(atmosphere.moonState.angularRadius);
  sourceUniforms.uMoonAngularRadius = uMoonAngularRadius;
  const solarTransport = surfaceCelestialTransport({ direction: atmosphere.sky.uSunDir, curvature });
  const lunarTransport = surfaceCelestialTransport({ direction: atmosphere.sky.uMoonDir,
    angularRadius: uMoonAngularRadius, curvature, lunarTransmission: true });
  // Skip coverage sampling for a source hidden by the local planet limb.
  const sourceVisibility = (projector, transport) => Fn(() => {
    const transmission = transport(positionWorld).toVar();
    const visibility = vec3(0).toVar();
    If(transmission.x.add(transmission.y).add(transmission.z).greaterThan(1e-8), () => {
      visibility.assign(projector(positionWorld).mul(transmission));
    });
    return visibility;
  })();
  renderer.shadowMap.enabled = true;
  atmosphere.sun.castShadow = true;
  aircraftLighting.setSunVisibility(sourceVisibility(groundCloudShadow, solarTransport));
  atmosphere.moonLight.castShadow = true;
  atmosphere.moonLight.shadow.shadowNode = sourceVisibility(moonCloudShadow, lunarTransport);
  atmosphere.setReceiverCelestialTransport(true);
  const fg = FRONT_GROUND[atmosphere.frontName];
  if (fg && flags.get("noterrain") !== "1") {
    bootStage('landscape',`Loading ${fg.label.toLowerCase()}…`,'Preparing real terrain and surface imagery. The first visit to a region may take a little longer.');
    try {
      // drape: 16k imagery on webgpu; 4k on the webgl fallback (SwiftShader
      // tops out at 8192); ?drape=0 keeps the procedural ramps for QA
      const drape = flags.get("drape") === "0" ? null : (backend === "webgpu" && ["HIGH", "ULTRA"].includes(bootAssetTier) ? "16k" : "4k");
      const sourcePreset = terrainSourcePreset(bootAssetTier, flags.get("terrainsource"), atmosphere.frontName, backend);
      // The complete field loads before ground placement and stays fixed
      // through later Auto/menu render-quality changes.
      const sourceManifest = sourcePreset === "16" ? "/assets/terrain/source/valdez-inland-16km.json" : null;
      const geographicImagery = atmosphere.frontName === "NELLIS" && drape && backend === "webgpu"
        && ["HIGH", "ULTRA"].includes(bootAssetTier) && flags.get("geographicdetail") !== "0"
        ? loadTerrainImagery({
          manifestURL: new URL("/assets/terrain/nellis-imagery/manifest.json", location.href),
          maxTextureSize: textureLimit,
          maxTextureArrayLayers: renderer.backend.device.limits.maxTextureArrayLayers,
          onFailure: error => { state.terrainImageryFailure = String(error.message || error); },
        }).then(stream => {
          if (stream) window.addEventListener("pagehide", event => { if (!event.persisted) stream.dispose(); });
          return stream;
        }) : null;
      terrain = await Terrain.load("/assets/terrain/" + fg.asset, atmosphere.frontName,
        groundCloudShadow, { drape, aerial: atmoH?.aerial, curvature, sourceManifest, geographicImagery,
          photoDetail: { tier: bootAssetTier,
            requested: flags.get("terrainphoto") !== "0" && flags.get("terrainmaterials") !== "0" } });
      window.addEventListener("pagehide", event => { if (!event.persisted) terrain?.photoDetail?.dispose(); });
      scene.add(terrain.group);
      if (fg.ocean && flags.get("nowater") !== "1") {
        let fft = null;
        try {
          // MAXFI A4: FFT ocean on webgpu (?ocean=gerstner reverts)
          if (backend === "webgpu" && flags.get("ocean") !== "gerstner") {
            try {
              const { createFFTOcean } = await import("./world/fftocean.js");
              const fineN = oceanFineResolution(bootAssetTier, flags.get("waterfine"));
              fft = createFFTOcean(renderer, { front: atmosphere.frontName, motionHistory: !!curvature, fineN });
              if (fft) fft.update(0); // Compile macro + fine behind the loading veil.
            } catch (err) {
              fft?.dispose?.(); fft = null;
              console.warn("fft ocean unavailable, Gerstner stays:", err && err.message);
            }
          }
          state.fftOcean = !!fft;
          state.fineOcean = fft?.fine ? { N: fft.fine.N, tileM: fft.fine.tileM,
            resolvedVariance: fft.fine.resolvedVariance, tailVariance: fft.fine.tailVariance } : null;
          water = new Water(atmosphere.frontName, terrain, atmoH?.aerial, fft,
            { cloudShadow: groundCloudShadow, curvature });
          scene.add(water.group);
        } catch (err) {
          fft?.dispose?.();
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

  const planetObjects = curvature ? new PlanetObjectBender(curvature) : null;
  if (planetObjects) attachRaptorPlanetObjects(planetObjects, { world, player, battlefield, bandits });
  // Boot creates the ordinary aircraft/prop pools up front. Their direct
  // light needs the same local planetary visibility as terrain and water;
  // unlit sky/FX do not participate. No shadow map or frame traversal is added.
  scene.traverse(object => {
    if (!object.isMesh || object === water?.mesh || object === water?.far) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some(material => material?.isMeshStandardMaterial || material?.isMeshPhysicalMaterial
      || material?.isMeshLambertMaterial || material?.isMeshPhongMaterial || material?.isMeshToonMaterial
      || material?.lights === true)) object.receiveShadow = true;
  });

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
    const seekerPosition = new Float64Array(3);
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
      const pv = curvature ? curvature.project(pipV, camera, pipV) : pipV.project(camera);
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
      if (MS.lockTarget >= 0 && (directory ? directory.alive(MS.lockTarget) : battlefield?.alive(MS.lockTarget))) {
        // Unified seeker IDs include air targets at 4096 + slot. Resolve
        // ENU through the same directory as the seeker before planet projection.
        if (directory) {
          directory.pos(MS.lockTarget, seekerPosition);
          pipV.set(seekerPosition[0], seekerPosition[2], seekerPosition[1]);
        } else {
          const to = MS.lockTarget * 5;
          pipV.set(battlefield.state[to], battlefield.state[to + 2], battlefield.state[to + 1]);
        }
        const tv = curvature ? curvature.project(pipV, camera, pipV) : pipV.project(camera);
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
          _bv.set(bx, bz, by); // ENU -> flat map -> rendered planet -> NDC
          if (curvature) curvature.project(_bv, camera, _bv); else _bv.project(camera);
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

  // Sound direction reads combat/flight state after camera placement; all
  // sound remains render-side and outside the deterministic simulation.
  let audio = null, soundscape = null;
  if (player && flags.get("audio") !== "0") {
    try {
      const { AudioBus } = await import("./engine/audio.js");
      audio = new AudioBus({ paused: true }); // saved mixer binds before the first audible frame
      soundscape = new Soundscape(audio, { player, battlefield, bandits });
    } catch (err) { console.warn("audio unavailable:", err && err.message); }
  }
  // PHASE 13 VOICE SPIKE: the radio gets a voice (settings toggle, default
  // OFF). Voice reads settings.current() per utterance, so the bindLive ctx
  // entry is only the LIVE-chip honesty signal for the menu row — it stays
  // null (row honestly STORED) in free flight / when speechSynthesis is absent.
  let voice = null, commsAudio = null, radioSuspended = false;
  if (script && missionData && "speechSynthesis" in window) {
    try {
      const V = await import("./game/voice.js");
      voice = new V.Voice({ current: () => {
        const mix = SETTINGS.current();
        // Voice owns master/radio gain multiplication. Keep its settings
        // contract intact and add the live audio and flight-pause gates.
        return { ...mix, muted: mix.muted || !!audio?.muted,
          voice: mix.voice && !radioSuspended && !cockpit?.paused };
      } });
      commsAudio = V.hookComms(script, missionData, voice, { intervalMs: 0 });
    } catch (err) { console.warn("voice unavailable:", err && err.message); }
  }
  // PHASE 15: settings go live (fov/renderScale/volumes/muzzle-flash gate)
  SETTINGS.bindLive({ renderer, camera, audio, input, hud, gunFlash: player ? player.gun.flash : null, baseTier: state.tier, hudLive: true, voice });
  // A hidden tab may stop requesting frames entirely, so silence it here.
  document.addEventListener("visibilitychange", () => {
    audio?.setPaused(document.hidden || !!cockpit?.paused || controls.open || sim.timescale === 0);
    if (document.hidden) { radioSuspended = true; voice?.cancel(); }
  });
  window.addEventListener("pagehide", () => { audio?.setPaused(true); voice?.cancel(); });
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
      let CloudPass = null;
      if (vol) {
        try {
          if (bootCloudQuality.mode === "adaptive") {
            ({ AdaptiveCloudPass: CloudPass } = await import("./world/adaptivecloudpass.js"));
          } else ({ SpatialCloudPass: CloudPass } = await import("./world/spatialcloudpass.js"));
        }
        catch (err) { console.warn("cloud composition unavailable, billboards stay:", err && err.message); }
      }
      post = buildPost(renderer, scene, camera, {
        // Synthetic lens ghosts duplicate the Moon's disc/terminator.
        // Keep the natural bloom; the stylized flare remains opt-in.
        flare: flags.get("flare") === "1",
        gtao: flags.get("ao") === "1", // default off until eyeball-passed
        rawDepthSelection: renderer.reversedDepthBuffer && flags.get("rawtaa") !== "0",
        chain: flags.get("chain") || "full",
        makeClouds: CloudPass ? ({ beauty, depth, velocity }) => new CloudPass({
          beauty, depth, velocity, camera,
          ...(bootCloudQuality.mode === "adaptive" ? { cloudScale: bootCloudQuality.scale } : {}),
          uSunDir: atmosphere.sky.uSunDir, uCamPos: vol.uCamPos, uTime: vol.uTime,
          front: atmosphere.frontName, noise: vol.noise, aerial: cloudAerial, curvature,
        }) : null,
      });
    } catch (err) { console.warn("post chain unavailable, plain render:", err && err.message); }
    // billboards hide when the volumetrics own the sky; their shadow field
    // stays live (clouds.update keeps feeding the shared shadow uniforms)
    if (post?.hasClouds) clouds.group.visible = false;
    state.volClouds = !!post?.hasClouds;
  }
  state.post = !!post;
  // Loaders have settled: profile the actual field/textures/FFT, including
  // coherent fallbacks, then resolve cached render quality for that workload.
  await atmosphere.sky.cirrusAtlas.userData.ready;
  const assetContext = { backend, front: atmosphere.frontName, flags, textureLimit,
    hasTerrain: !!terrain, hasOcean: !!fg?.ocean && flags.get("nowater") !== "1",
    sourceEnabled: !!terrain && "sourceField" in terrain };
  const bootAssetRequest = requestedBootAssets(bootAssetTier, assetContext);
  state.bootAssetRequest = bootAssetRequest;
  state.bootAssets = describeBootAssets({ bootTier: bootAssetTier, terrain, water, sky: atmosphere.sky,
    fftOcean: state.fftOcean, fineOcean: state.fineOcean, cloudNoise: state.cloudNoise,
    cloudMode: post?.cloudPass?.mode || "billboard" });
  const benchProfile = qualityProfile({ backend, mode: cloudOptions.mode,
    renderScale: bootRenderScale, pixelRatio: window.devicePixelRatio,
    scale: cloudOptions.scale, noise: cloudOptions.noise,
    front: atmosphere.frontName, workload: qualityWorkload(flags), assets: state.bootAssets,
    width: window.innerWidth, height: window.innerHeight });
  state.tier = detectTier({ backend, profile: benchProfile });
  const liveQuality = SETTINGS.getLiveCtx();
  if (liveQuality) {
    liveQuality.baseTier = state.tier;
    liveQuality.applyTerrainQuality = tier => terrain?.setDetailTier(tier);
    liveQuality.applyAssetQuality = () => {
      const selected = SETTINGS.current().tier;
      const desiredTier = selected === "AUTO" ? autoAssetTier : selected;
      const shadowParams = tierParams(desiredTier);
      // Compare with the next boot's allocation, not Auto's benchmarked live
      // tier: restarting can change the former but reproduce the latter.
      state.assetReloadRequired = assetsNeedReload(bootAssetRequest,
        requestedBootAssets(desiredTier, assetContext), {
          allocatedShadowSize: aircraftLighting.stats.allocatedShadowSize,
          requestedShadowSize: aircraftLighting.shadowRequested && shadowParams.shadows
            ? shadowParams.shadowSize : 0,
        });
    };
    liveQuality.applyCloudQuality = (tier) => {
      state.tier = tier; // effective live quality; bootAssetTier stays fixed
      aircraftLighting.setQuality(tierParams(tier));
      const next = cloudQuality(tier, cloudOptions);
      post?.cloudPass?.setCloudScale?.(next.scale);
      state.cloudRendering = { mode: post?.cloudPass?.mode || "billboard",
        scale: post?.cloudPass?.cloudScale ?? null,
        requestedNoise: next.noise, actualNoise: volPre?.noise?.resolution ?? null,
        noiseReloadRequired: !!volPre && next.noise !== volPre.noise.resolution };
    };
    SETTINGS.applySettings(SETTINGS.current(), liveQuality);
  }

  // A water-specific sea-level source replaces the old extra emissive mirror.
  // The existing scene IBL still serves terrain/aircraft; water overrides it.
  let waterSkyEnvironment = null;
  if (water && atmoH && flags.get("waterenv") !== "0") {
    try {
      const { WaterSkyEnvironment } = await import("./world/sky-environment.js");
      waterSkyEnvironment = new WaterSkyEnvironment({
        renderer, water, luts: atmoH.luts, sourceUniforms: atmoH.sourceUniforms,
        cirrusAtlas: atmosphere.sky.cirrusAtlas,
        size: flags.get("waterenvsize") === "64" ? 64 : 128,
        makeCloudNode: vol && post?.hasClouds ? ({ sourceUniforms, ...probe }) => {
          const { H, luts, airK } = atmoH;
          const args = { tTex: luts.tTex, msTex: luts.msTex, ...sourceUniforms, uCamPos: probe.uCamPos };
          const trans = H.aerialTransNode(args), ins = H.aerialInscatterNode(args);
          // The six-face capture has a frozen planet origin. It must not
          // inherit the moving main-camera frame while faces are rendered.
          const probeCurvature = curvature ? new PlanetCurvature({ radius: curvature.radius }) : null;
          if (probeCurvature) {
            probeCurvature.origin = probe.uFrameOrigin.xz;
            probeCurvature.previousOrigin = probeCurvature.origin;
          }
          return vol.VC.volCloudsNode({ ...probe, uSunDir: sourceUniforms.uSunDir,
            front: atmosphere.frontName, noise: vol.noise, curvature: probeCurvature,
            aerial: {
              trans: airK === 1 ? trans : wp => pow(trans(wp), vec3(airK)),
              ins: airK === 1 ? ins : wp => ins(wp).mul(airK),
              uSunI: sourceUniforms.uSunI,
              sourceTransport: flags.get("cloudtransport") === "legacy" ? null
                : { luts, calibrateDay: flags.get("cloudtransport") !== "toa",
                  relativeOmission: ["strict", "toa"].includes(flags.get("cloudtransport")) ? 0 : .001 },
              celestial: sourceUniforms.uMoonDir ? sourceUniforms : null,
            },
          });
        } : null,
      });
      state.waterReflection = waterSkyEnvironment.stats;
    } catch (err) {
      console.warn("Water environment unavailable; existing scene IBL remains:", err && err.message);
    }
  }

  cockpit = new Cockpit({ state, input, controls, audio, hud, flags });
  state.cockpit = cockpit;
  renderer.domElement.tabIndex = -1;

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    post?.invalidateHistory?.();
    meter?.reset();
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
    sim, input, gamepad, controls, dbg, atmosphere, terrain, water, clouds, hud, player, battlefield, match, script, bandits, directory, audio, soundscape,
    cloudPass: post?.cloudPass ?? null,
    kc: () => killCam,
    cloudImmersion: () => clouds.immersion,
    setTimeOfDay: (h) => {
      atmosphere.setTime(h);
      waterSkyEnvironment?.invalidate("time-cut");
      post?.invalidateHistory?.();
      meter?.reset();
    },
    setFront: (f) => {
      atmosphere.setFront(String(f).toUpperCase());
      post?.invalidateHistory?.();
      meter?.reset();
    },
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
  const priorBench = savedBench();
  const benchViewport = [window.innerWidth, window.innerHeight, window.devicePixelRatio].join("/");
  let qualityBenchmark = (!hasManualTier() && !flags.has("cloudscale") && !flags.has("cloudnoise")
    && !isCompatibleBench(priorBench, { backend, profile: benchProfile }))
    ? new QualityBenchmark({ tier: state.tier, backend }) : null;
  let frameNo = 0;

  // Read a tiny GPU downsample of the existing temporal image. The readback
  // promise resolves independently; the frame loop never waits on the GPU.
  let meter = null;
  if (post && flags.get("autoexp") !== "0") {
    try {
      const { AsyncExposureMeter } = await import("./engine/exposure-meter.js");
      meter = new AsyncExposureMeter(renderer, post.getExposureTexture);
    } catch (err) { console.warn("Exposure sampler unavailable; palette exposure remains:", err && err.message); }
  }
  state.autoExposure = !!meter;
  state.meter = meter?.state || null;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      post?.invalidateHistory?.();
      meter?.reset();
    }
  });
  window.addEventListener("pagehide", event => { if (!event.persisted) meter?.dispose(); });
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
  aircraftFrame.projectedPixels = Math.max(world.f22.userData.aircraft.length, world.f22.userData.aircraft.span)
    * Math.abs(camera.projectionMatrix.elements[5]) * window.innerHeight
    / (2 * Math.max(1, world.jet.position.distanceTo(camera.position)));
  aircraftFrame.maxQuality = state.tier;
  updateF22Visuals(world.f22, aircraftFrame);
  curvature?.beginFrame(camera);
  aircraftLighting.refreshMaterials();
  planetObjects?.update();
  terrain?.update(camera, 0);
  water?.update(camera,0);
  clouds.update(camera,0);
  if (vol) { vol.uTime.value=0; vol.VC.updateCamera?.(camera); }
  if (atmoH) atmoH.uCamPos.value.copy(camera.position);
  atmosphere.update(camera);
  atmoH?.skyViewCache?.update(camera.position);
  aircraftLighting.update(world.jet, terrain);
  // Publish the final water environment before compiling the main graph.
  // Publishing it later replaces envNode and recompiles the water material.
  if (waterSkyEnvironment && waterSkyEnvironment.front < 0) {
    try { waterSkyEnvironment.warmUp(camera, 0); }
    catch (err) {
      console.warn("Water environment warmup failed; existing scene IBL remains:", err && err.message);
      waterSkyEnvironment.dispose(); waterSkyEnvironment = null;
    }
  }
  renderer.toneMappingExposure=atmosphere.exposure;
  if (!post) await renderer.compileAsync(scene,camera);
  // Real draws cover the post graph's own MRT, temporal and shadow variants.
  // No physics, input, audio or weapon effects advance during this warmup.
  for(let pass=0;pass<2;pass++) {
    await new Promise(requestAnimationFrame);
    // Compile the real celestial MRT variants under the loading veil.
    // Dusk should change uniforms, not stall the first visible night frame.
    const celestial = pass === 0 ? [atmosphere.stars.points, atmosphere.stars.moon] : [];
    const visibility = celestial.map(object => object.visible);
    for (const object of celestial) object.visible = true;
    try {
      if(post)post.post.render();else renderer.render(scene,camera);
    } finally {
      celestial.forEach((object, i) => { object.visible = visibility[i]; });
    }
    curvature?.endFrame();
    if (pass === 0) {
      curvature?.beginFrame(camera);
      aircraftLighting.refreshMaterials();
      planetObjects?.update();
    }
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
      // Consume presentation snapshots while the world is paused so resume
      // cannot replay an old missile launch, impact or engine transition.
      soundscape?.update({ camera, time: sim.time, dt: 0, paused: true, cinematic: !!killCam || !!match?.over });
      radioSuspended = true;
      commsAudio?.poll();
      audio?.setRadioActive(false);
      input.clear();
      return; // No sim catch-up, camera drift, GPU rendering or weapon aging while paused.
    }
    // A gamepad can resume inside this very frame, after the clock was read.
    if (state.resetFrameClock) { dtMs=0; state.resetFrameClock=false; }
    input.sampleGamepad(dtMs / 1000);
    if (input.pressed("hide_hud")) cockpit.toggleHUD();
    if (input.pressed("recenter_aim")) { player?.recenterAim(); cockpit.toast("Aim aligned with your aircraft."); }
    frameNo++;
    if (qualityBenchmark) {
      const settings = SETTINGS.current();
      const result = qualityBenchmark.observe(dtMs, {
        hidden: document.hidden, manual: hasManualTier() || settings.tier !== "AUTO",
        settling: !!terrain?.stats.detailSettling,
        changed: settings.renderScale !== bootRenderScale
          || [window.innerWidth, window.innerHeight, window.devicePixelRatio].join("/") !== benchViewport,
      });
      if (result?.cancelled) qualityBenchmark = null;
      else if (result) {
        state.tier = result.tier;
        const liveSettings = SETTINGS.getLiveCtx();
        if (liveSettings) {
          liveSettings.baseTier = result.tier;
          SETTINGS.applySettings(settings, liveSettings);
        }
        if (result.complete) {
          const rec = { ms: +result.median.toFixed(2), backend, tier: result.tier,
            profile: benchProfile, assets: state.bootAssets, cloudMode: bootCloudQuality.mode,
            cloudNoise: volPre?.noise?.resolution ?? null, measurements: result.measurements };
          saveBench(rec); state.bench = rec; qualityBenchmark = null;
        }
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
      const audioPaused = document.hidden || cockpit.paused || controls.open || sim.timescale === 0;
      soundscape?.update({ camera, time: sim.time, dt: dtMs / 1000, paused: audioPaused, cinematic: cine });
      radioSuspended = audioPaused || !!killCam;
      commsAudio?.poll();
      audio?.setRadioActive(!!voice?._cur && !radioSuspended);
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
    const planetFrame = curvature?.beginFrame(camera);
    if (planetFrame?.resetHistory) post?.invalidateHistory?.();
    aircraftLighting.refreshMaterials();
    planetObjects?.update();
    terrain?.update(camera, dtMs / 1000);
    waterClock += dtMs / 1000;
    water?.update(camera, waterClock);
    cloudClock += dtMs / 1000;
    clouds.update(camera, cloudClock);
    if (vol) {
      vol.uTime.value = cloudClock;
      vol.uCamPos.value.copy(camera.position);
      vol.VC.updateCamera?.(camera);
    }
    const hudEl = hud.canvas || hud.svg;
    if (hudEl && flags.get("hud") !== "0" && flags.get("chrome") !== "0") {
      if (!hudEl.style.transition) hudEl.style.transition = "opacity 0.3s";
      hudEl.style.opacity = killCam ? "0" : "1"; // death cinematic flies clean
    }
    hud.update(player ? player.hudState() : testworldHudState(world, alpha));
    if (atmoH) atmoH.uCamPos.value.copy(camera.position);
    atmosphere.update(camera); // IBL sees the current observer on its first capture
    atmoH?.skyViewCache?.update(camera.position);
    aircraftLighting.update(world.jet, terrain);
    uMoonAngularRadius.value = atmosphere.moonState.angularRadius;
    if (waterSkyEnvironment) {
      if (waterSkyEnvironment.front < 0) {
        try { waterSkyEnvironment.warmUp(camera, cloudClock); }
        catch (err) {
          console.warn("Water environment warmup failed; existing scene IBL remains:", err && err.message);
          waterSkyEnvironment.dispose(); waterSkyEnvironment = null;
        }
      } else waterSkyEnvironment.update(camera, cloudClock);
    }
    renderer.toneMappingExposure = atmosphere.exposure * (meter ? meter.mult : 1);
    if (post) post.post.render();
    else renderer.render(scene, camera);
    curvature?.endFrame();
    meter?.update({ target: atmosphere.meterTarget ?? .42 });
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
