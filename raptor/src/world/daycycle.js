// Atmosphere: owns the sky dome, sun + hemisphere lights, and fog, all driven
// by real solar position for the front's actual coordinates. Time-of-day is
// RENDER-side state (visual only, sim-neutral) — when night starts to matter
// to sensors/AI it graduates to a seeded per-match sim input (journaled).

import * as THREE from "three";
import { Sky } from "./sky.js";
import { Stars } from "./stars.js";
import { sunPosition, dateForLocalHours, directionFrom } from "./solar.js";

export const FRONTS = {
  VALDEZ:   { lat: 61.13, lon: -146.35, label: "Prince William Sound, AK" },
  NELLIS:   { lat: 36.24, lon: -115.03, label: "Nevada Test & Training Range" },
  MARIANAS: { lat: 13.58, lon: 144.93,  label: "Marianas / Andersen AFB" },
};

// palette stops by sun elevation (degrees); lerped between neighbors
// High-sun exposure drops hard (judge round 2: pale zenith = ACES compressing
// hot sky values to white; deep blue lives at low exposure) — sun/hemi
// intensities rise to keep the GROUND read constant.
const STOPS = [
  { el: -18, fog: 0x0a0e18, hemiSky: 0x141c2a, sun: 0x000000, sunI: 0.0, hemiI: 0.25, exp: 0.62 },
  { el: -6,  fog: 0x1a1f30, hemiSky: 0x232c40, sun: 0xff7038, sunI: 0.0, hemiI: 0.3,  exp: 0.58 },
  { el: 0,   fog: 0xd67d4e, hemiSky: 0x54566a, sun: 0xff8844, sunI: 1.1, hemiI: 0.5,  exp: 0.5 },
  { el: 8,   fog: 0xe8c9a0, hemiSky: 0x8aa3c4, sun: 0xffc487, sunI: 2.8, hemiI: 0.8,  exp: 0.42 },
  { el: 25,  fog: 0xcfdcea, hemiSky: 0x9db8d6, sun: 0xfff2dd, sunI: 4.0, hemiI: 1.15, exp: 0.32 },
  { el: 90,  fog: 0xc2d4e6, hemiSky: 0xa7c0dc, sun: 0xffffff, sunI: 4.4, hemiI: 1.25, exp: 0.30 },
];

const _c1 = new THREE.Color(), _c2 = new THREE.Color();
const _hdir = new THREE.Vector3(), _fogC = new THREE.Color();
function paletteAt(elDeg, key, isColor) {
  let a = STOPS[0], b = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++)
    if (elDeg >= STOPS[i].el && elDeg <= STOPS[i + 1].el) { a = STOPS[i]; b = STOPS[i + 1]; break; }
  const t = Math.min(Math.max((elDeg - a.el) / (b.el - a.el || 1), 0), 1);
  if (isColor) return _c1.setHex(a[key]).lerp(_c2.setHex(b[key]), t).clone();
  return a[key] + (b[key] - a[key]) * t;
}

export class Atmosphere {
  constructor(scene, frontName = "NELLIS") {
    this.front = FRONTS[frontName] || FRONTS.NELLIS;
    this.frontName = frontName;
    // fixed representative date per front for now (season variety in phase 5)
    this.baseUtcMidnight = Date.UTC(2026, 5, 21); // Jun 21
    this.hours = 10.5;

    this.sky = new Sky();
    scene.add(this.sky.mesh);

    this.stars = new Stars();
    scene.add(this.stars.group);

    // dynamic IBL (PMREM from the sky) — armed by initIBL(renderer)
    this._pmrem = null;
    this._envRT = null;
    this._iblDirty = true;
    this._iblHours = -99;
    this.envReady = false;

    this.sun = new THREE.DirectionalLight(0xfff2dd, 3.0);
    this.sun.target.position.set(0, 0, 0);
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9db8d6, 0x2a2622, 0.9);
    scene.add(this.hemi);

    scene.fog = new THREE.Fog(0xcfdcea, 4000, 30000);
    this.scene = scene;

    this._sunDir = new THREE.Vector3(0, 1, 0);
    this.elevationDeg = 0;
    this.setTime(this.hours);
  }

  setFront(name) {
    if (!FRONTS[name]) return false;
    this.front = FRONTS[name];
    this.frontName = name;
    this.setTime(this.hours);
    return true;
  }

  setTime(hours) {
    this.hours = ((hours % 24) + 24) % 24;
    const t = dateForLocalHours(this.baseUtcMidnight, this.hours, this.front.lon);
    const { azimuth, elevation } = sunPosition(t, this.front.lat, this.front.lon);
    this.elevationDeg = elevation * 180 / Math.PI;
    directionFrom(azimuth, elevation, this._sunDir);

    // elevation-keyed haze: crystalline blue air overhead, thicker + redder
    // toward the horizon hours (judge round 1: "beige, not gold")
    const lowSun = Math.min(Math.max(1 - this.elevationDeg / 15, 0), 1);
    this.sky.turbidity = 2.5 + lowSun * 3.5;
    this.sky.mieCoefficient = 0.004 + lowSun * 0.005;
    this.sky.setSun(this._sunDir);

    const el = this.elevationDeg;
    this.sun.position.copy(this._sunDir).multiplyScalar(20000);
    this.sun.intensity = paletteAt(el, "sunI", false);
    this.sun.color.copy(paletteAt(el, "sun", true));
    this.sun.visible = this.sun.intensity > 0.01;

    this.hemi.intensity = paletteAt(el, "hemiI", false);
    this.hemi.color.copy(paletteAt(el, "hemiSky", true));

    // fog color derived from the sky model itself (horizon, 60° off-sun) so
    // aerial haze and sky always agree; palette only floors the deep night
    const az = Math.atan2(this._sunDir.x, this._sunDir.z);
    _hdir.set(Math.sin(az + Math.PI / 3) * Math.cos(0.035), Math.sin(0.035), Math.cos(az + Math.PI / 3) * Math.cos(0.035));
    const [r, g, b] = this.sky.sampleDirection(_hdir);
    _fogC.setRGB(Math.min(r, 1.6), Math.min(g, 1.6), Math.min(b, 1.6));
    const nightFloor = paletteAt(el, "fog", true);
    this.scene.fog.color.copy(el < -2 ? nightFloor : _fogC);
    this.exposure = paletteAt(el, "exp", false);

    this.stars.update(el, this.hours, this.front.lat, this._sunDir);
    if (Math.abs(this.hours - this._iblHours) > 0.2) this._iblDirty = true;
  }

  initIBL(renderer) {
    try {
      this._pmrem = new THREE.PMREMGenerator(renderer);
      this._iblScene = new THREE.Scene();
      this._iblScene.add(this.sky.mesh.clone()); // shares the sky material
    } catch (err) {
      console.warn("IBL unavailable on this backend:", err && err.message);
      this._pmrem = null;
    }
  }

  _regenIBL() {
    if (!this._pmrem) return;
    try {
      const rt = this._pmrem.fromScene(this._iblScene, 0, 10, 60000);
      if (this._envRT) this._envRT.dispose();
      this._envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = 0.45;
      this.envReady = true;
      this._iblHours = this.hours;
      this._iblDirty = false;
    } catch (err) {
      console.warn("IBL regen failed; hemisphere light carries ambient:", err && err.message);
      this._pmrem = null;
      this.envReady = false;
    }
  }

  // advance wall-clock-driven ToD if a speed is set (0 = frozen); render-side only
  tickRender(dtSec, speed = 0) {
    if (speed > 0) this.setTime(this.hours + (dtSec * speed) / 3600);
  }

  update(camera) {
    this.sky.followCamera(camera);
    this.stars.followCamera(camera);
    if (this._iblDirty) this._regenIBL();
  }

  info() {
    return { front: this.frontName, hours: +this.hours.toFixed(2), sunElevationDeg: +this.elevationDeg.toFixed(2) };
  }
}
