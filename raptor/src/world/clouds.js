// Clouds v1 — rungs 5a/5b/5c of the phase-5 ladder (CLOUDS-PLAN.md):
// cloud shadows for any ground material, billboard cumulus fields, and
// per-front climates with uniform wind advection.
//
// One Clouds instance owns:
//   - the per-front COVERAGE TEXTURE (baked once, tiles every 24km) that BOTH
//     puff placement and the terrain shadow node read — one texture, two
//     consumers, never a second copy;
//   - exactly ONE {uWindVel, uTime} uniform pair, shared by the billboards
//     and the shadow projector (the plan's top-flagged risk: two copies drift
//     apart silently — every consumer reads the same objects via `.shared`);
//   - the instanced billboard field: cylindrical (Y-locked) billboard crosses
//     plus a flat cap card, so puffs never lie flat or swim when overflown.
//
// Render-side only — the sim never reads clouds.

import * as THREE from "three";
import {
  Fn, If, Discard, uniform, texture, attribute, cameraPosition, positionLocal, positionWorld, uv,
  vec2, vec3, vec4, float, normalize, dot, min, max, smoothstep, mix,
  clamp, fract, sin, floor, step, abs, sqrt, varying,
} from "three/tsl";
import { SfcRng } from "../engine/rng.js";
import { surfaceCelestialTransport, SOLAR_ANGULAR_RADIUS } from "./celestial-surface.js";

// world XZ -> coverage UV: the field tiles every 24km (plan §4)
export const COVER_PERIOD = 24000;
const COVER_N = 256;        // coverage texels per tile edge (~94m/texel)
const FIELD_SPAN = 48000;   // puff placement span — a multiple of COVER_PERIOD
const PLACE_STEP = 600;     // placement grid pitch (plan §1)
const PLACE_THRESH = 0.52;  // coverage above this births a puff

// Per-front climates (plan §5) — single source of truth for placement,
// lighting, wind, and the shadow projector. Same table shape as daycycle's
// STOPS and water's SEA_STATES.
export const CLOUD_CLIMATES = {
  VALDEZ: {   // maritime stratus deck: low, flat, gray, near-overcast
    coverage: 0.72, freq: 3, contrast: 1.8, seed: 101,
    baseAlt: 700, yJitter: 200, puffW: [2400, 3800], puffH: [240, 400],
    budget: 220, scatter: 0.15, towers: 0,
    windFromDeg: 135, windSpd: 5.5,        // down-fjord SE flow
    lit: [0.78, 0.79, 0.82], shade: [0.60, 0.62, 0.66],
    gradLo: -1.2, gradHi: 2.2, density: 0.75, baseSoft: 0.30, vertFadeK: 1.0,
    shadowFloor: 0.62,
  },
  NELLIS: {   // scattered fair-weather cumulus, high desert bases
    coverage: 0.16, freq: 7, contrast: 3.2, seed: 202,
    baseAlt: 3500, yJitter: 160, puffW: [1000, 1800], puffH: [520, 950],
    budget: 110, scatter: 0.15, towers: 0,
    windFromDeg: 225, windSpd: 7,          // afternoon SW desert flow
    lit: [1.0, 0.99, 0.96], shade: [0.50, 0.54, 0.62],
    gradLo: 0.05, gradHi: 0.8, density: 0.92, baseSoft: 0.14, vertFadeK: 0.5,
    shadowFloor: 0.45,
  },
  MARIANAS: { // trade-wind puffs everywhere + a few towering cells
    coverage: 0.40, freq: 9, contrast: 2.6, seed: 303,
    baseAlt: 650, yJitter: 90, puffW: [750, 1350], puffH: [340, 620],
    budget: 190, scatter: 0.2,
    towers: 2, towerW: [1700, 2400], towerH: [2400, 3600],
    windFromDeg: 45, windSpd: 8.5,         // steady NE trades
    lit: [1.0, 1.0, 0.99], shade: [0.58, 0.62, 0.68],
    gradLo: 0.05, gradHi: 0.9, density: 0.9, baseSoft: 0.16, vertFadeK: 0.55,
    shadowFloor: 0.50,
  },
};

// ---------- coverage bake: tileable value-noise FBM, quantile-normalized ----------
// Stored so 0.5 is exactly the coverage boundary: the fraction of texels above
// 0.5 equals the climate's coverage number, whatever the noise did.

function ihash(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function tileValueNoise(u, v, freq, seed) {
  const x = u * freq, y = v * freq;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (ix, iy) => ihash(((ix % freq) + freq) % freq, ((iy % freq) + freq) % freq, seed);
  const a = w(x0, y0), b = w(x0 + 1, y0), c = w(x0, y0 + 1), d = w(x0 + 1, y0 + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

function bakeCoverage(C) {
  const N = COVER_N;
  const field = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const v = (j + 0.5) / N;
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      let n = 0, amp = 1, tot = 0, f = C.freq;
      for (let o = 0; o < 4; o++) {
        n += tileValueNoise(u, v, f, C.seed + o * 57) * amp;
        tot += amp; amp *= 0.5; f *= 2;
      }
      field[j * N + i] = n / tot;
    }
  }
  // quantile remap: value q sits at the (1-coverage) percentile -> maps to 0.5
  const sorted = Float32Array.from(field).sort();
  const q = sorted[Math.min(Math.floor((1 - C.coverage) * sorted.length), sorted.length - 1)];
  for (let k = 0; k < field.length; k++) {
    field[k] = Math.min(Math.max(0.5 + (field[k] - q) * C.contrast, 0), 1);
  }
  // towering cells: gaussian bumps pushed to full coverage (MARIANAS)
  const towerSpots = [];
  if (C.towers > 0) {
    const rng = new SfcRng(C.seed * 7919 + 13);
    const rad = 1400 / COVER_PERIOD; // tile units
    for (let t = 0; t < C.towers; t++) {
      const cu = rng.f(), cv = rng.f();
      towerSpots.push({ u: cu, v: cv });
      for (let j = 0; j < N; j++) {
        let dv = Math.abs((j + 0.5) / N - cv); dv = Math.min(dv, 1 - dv);
        if (dv > rad * 3) continue;
        for (let i = 0; i < N; i++) {
          let du = Math.abs((i + 0.5) / N - cu); du = Math.min(du, 1 - du);
          if (du > rad * 3) continue;
          const r2 = (du * du + dv * dv) / (rad * rad);
          field[j * N + i] = Math.min(1, field[j * N + i] + Math.exp(-r2) * 0.6);
        }
      }
    }
  }
  const bytes = new Uint8Array(N * N);
  for (let k = 0; k < field.length; k++) bytes[k] = field[k] * 255;
  const tex = new THREE.DataTexture(bytes, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  // post-tower sorted copy: the constructor derives the shadow window from it
  const sortedFinal = Float32Array.from(field).sort();
  return { field, tex, towerSpots, sortedFinal };
}

// ---------- terrain shadow node (plan §4) ----------
// Projects the coverage texture onto the ground along the sun ray, scrolled by
// the SAME {uWindVel, uTime} pair the visible clouds advect with. Handed to
// any material's colorNode as `c = c.mul(cloudShadow(wp))`.
//
// Sign contract: visible puffs sit at (iCenter + wind*t), so the coverage that
// is overhead ground point x NOW was baked at (x - wind*t) — the projector
// SUBTRACTS the scroll. Flipping either side of this pair is the drift bug.
// Optional curvature changes receiver/ray geometry only: this function then
// consumes rendered positions directly; coverage coordinates remain map XZ.
export function makeCloudShadowNode(shared, curvature = null) {
  const S = shared;
  return function cloudShadow(wp) {
    // project up the sun ray to the cloud deck; clamp keeps terrain that pokes
    // above the deck (Valdez peaks) from projecting backwards
    let hitXZ;
    if (curvature) {
      // Rendered receiver -> constant physical-altitude spherical deck.
      // The rationalized exit root avoids subtracting two planet-size terms;
      // expand radial residual around deck height to retain float precision.
      const p = curvature.planetPositionNode(wp);
      const ray = vec3(S.uSunDir.x, max(S.uSunDir.y, .08), S.uSunDir.z);
      const radialResidual = wp.y.sub(S.uCloudAlt)
        .mul(wp.y.add(S.uCloudAlt).add(curvature.radius * 2)).add(dot(p.xz, p.xz));
      const below = min(radialResidual, 0);
      const b = dot(p, ray);
      const t = below.negate().div(max(b.add(sqrt(max(b.mul(b).sub(dot(ray, ray).mul(below)), 0))), 1));
      hitXZ = wp.xz.add(ray.xz.mul(t));
    } else {
      const t = max(S.uCloudAlt.sub(wp.y), 0.0).div(max(S.uSunDir.y, 0.08));
      hitXZ = wp.xz.add(S.uSunDir.xz.mul(t));
    }
    const scroll = hitXZ.sub(S.uWindVel.mul(S.uTime));
    const cov = texture(S.coverageTex, scroll.mul(S.uCoverScale)).r;
    const dayGate = smoothstep(0.03, 0.12, S.uSunDir.y); // no shadows past sunset
    return mix(float(1.0), S.uShadowFloor, smoothstep(S.uCoverLo, S.uCoverHi, cov).mul(dayGate));
  };
}

// value noise for the card mask (same pattern as terrain.js)
const hash2 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const vnoise = (p) => {
  const i = floor(p), f = fract(p);
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
  const a = hash2(i), b = hash2(i.add(vec2(1, 0)));
  const c = hash2(i.add(vec2(0, 1))), d = hash2(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
};

export class Clouds {
  // front: FRONTS key. tierParams: quality.js params object (or a mode string).
  // sunDirUniform (optional): pass atmosphere.sky.uSunDir so clouds, sky, and
  // shadows read the SAME sun uniform — zero-copy, can't drift.
  constructor(front = "NELLIS", tierParams = {}, sunDirUniform = null, celestial = null, curvature = null) {
    this.celestial = celestial;
    this.uMoonAngularRadius = uniform(celestial?.moonState?.angularRadius || SOLAR_ANGULAR_RADIUS);
    this.curvature = curvature;
    // Main-camera history only. Probe/shadow renders must not advance it.
    this.uCamera = uniform(new THREE.Vector3());
    this.uPreviousCamera = uniform(new THREE.Vector3());
    this.uPreviousTime = uniform(0);
    this._frameReady = false;
    const mode = typeof tierParams === "string" ? tierParams : (tierParams.clouds || "billboard");
    this.front = CLOUD_CLIMATES[front] ? front : "NELLIS";
    const C = this.climate = CLOUD_CLIMATES[this.front];
    // imposter/volumetric are later rungs (5d/5f); they render the billboard
    // field until they land. "sky" (LOW) builds no geometry — shadows only.
    this.mode = mode === "sky" ? "sky" : "billboard";
    this.immersion = 0; // rung 5e stub: 0 = clear air, 1 = inside cloud

    const { field, tex, towerSpots, sortedFinal } = bakeCoverage(C);
    this._covField = field;
    this._towerSpots = towerSpots;

    // wind FROM windFromDeg (meteorological), velocity vector points downwind
    const rad = (C.windFromDeg * Math.PI) / 180;
    const wind = new THREE.Vector2(-Math.sin(rad), -Math.cos(rad)).multiplyScalar(C.windSpd);

    // THE shared uniform bundle — the only {uWindVel, uTime} pair in the
    // system. Billboards, the shadow projector, and any future tier all hold
    // references into this object; never instantiate a second copy.
    this.shared = {
      coverageTex: tex,
      uWindVel: uniform(wind),
      uTime: uniform(0),
      uCloudAlt: uniform(C.baseAlt),
      uCoverScale: uniform(1 / COVER_PERIOD),
      uSunDir: sunDirUniform || uniform(new THREE.Vector3(0.3, 0.8, 0.35).normalize()),
      uShadowFloor: uniform(C.shadowFloor),
      uCoverLo: uniform(0.55),
      uCoverHi: uniform(0.75),
    };

    // placement always runs (cheap, once) so the shadow window below is
    // identical across tiers; geometry is only built past "sky"
    this.puffs = this._placePuffs();
    this.group = new THREE.Group();
    if (this.mode !== "sky") this.group.add(this._buildField(this.puffs));

    // Shadow window auto-sync (cycle-2 fix): the budget caps how much coverage
    // gets a visible puff, so darkening everything above the placement
    // threshold litters the ground with orphan shadows. Instead, find the
    // coverage quantile whose area matches what the placed puffs actually
    // occupy and only shade above it — shadows sit where clouds really are.
    let area = 0;
    for (const p of this.puffs) area += Math.PI * (p.w * 0.35) ** 2;
    const frac = Math.min(area / (FIELD_SPAN * FIELD_SPAN), 0.85);
    const lo = sortedFinal[Math.floor((1 - frac) * (sortedFinal.length - 1))];
    this.shared.uCoverLo.value = Math.min(Math.max(lo, 0.52), 0.92);
    this.shared.uCoverHi.value = Math.min(this.shared.uCoverLo.value + 0.16, 1.0);
  }

  // CPU-side coverage sample — same mapping as texture(coverageTex, xz*scale)
  _covAt(x, z) {
    const N = COVER_N;
    const u = ((x / COVER_PERIOD) % 1 + 1) % 1;
    const v = ((z / COVER_PERIOD) % 1 + 1) % 1;
    return this._covField[Math.min((v * N) | 0, N - 1) * N + Math.min((u * N) | 0, N - 1)];
  }

  // placement (plan §1): coarse grid over the field, keep cells above the
  // coverage threshold, jitter, cap at budget. Paid once at load.
  _placePuffs() {
    const C = this.climate;
    const rng = new SfcRng(C.seed);
    const half = FIELD_SPAN / 2;
    const cand = [];
    for (let z = -half + PLACE_STEP / 2; z < half; z += PLACE_STEP) {
      for (let x = -half + PLACE_STEP / 2; x < half; x += PLACE_STEP) {
        const cov = this._covAt(x, z);
        if (cov < PLACE_THRESH) continue;
        cand.push({ x, z, cov, score: cov * (1 - C.scatter) + rng.f() * C.scatter });
      }
    }
    cand.sort((a, b) => b.score - a.score);
    const puffs = [];
    for (let i = 0; i < Math.min(cand.length, C.budget); i++) {
      const c = cand[i];
      const grow = 0.7 + (c.cov - 0.5) * 0.8; // denser coverage -> bigger puffs
      puffs.push({
        x: c.x + rng.range(-0.4, 0.4) * PLACE_STEP,
        z: c.z + rng.range(-0.4, 0.4) * PLACE_STEP,
        y: C.baseAlt + rng.range(-1, 1) * C.yJitter,
        w: rng.range(C.puffW[0], C.puffW[1]) * grow,
        h: rng.range(C.puffH[0], C.puffH[1]) * grow,
        seed: rng.f(),
      });
    }
    // towering cells sit exactly on their coverage bumps (all tile copies
    // inside the field, so cloud and shadow agree everywhere). Each tower is
    // a STACK of puffs, not one giant card — a single 3km card reads as
    // cardboard from level flight (cycle-2 finding); a narrowing column of
    // overlapping puffs reads as a cauliflower buildup.
    if (C.towers > 0) {
      const LEVELS = 4;
      for (const t of this._towerSpots) {
        for (const mx of [-1, 0]) {
          for (const mz of [-1, 0]) {
            const bx = (t.u + mx) * COVER_PERIOD, bz = (t.v + mz) * COVER_PERIOD;
            const H = rng.range(C.towerH[0], C.towerH[1]);
            const W = rng.range(C.towerW[0], C.towerW[1]);
            const towerStart = puffs.length;
            for (let i = 0; i < LEVELS; i++) {
              const f = i / (LEVELS - 1);
              puffs.push({
                x: bx + rng.range(-250, 250),
                z: bz + rng.range(-250, 250),
                y: C.baseAlt + f * (H - 500),
                w: W * (1 - f * 0.35) * rng.range(0.9, 1.1),
                h: (H / LEVELS) * 1.7,
                seed: rng.f(),
              });
            }
            // The visible mask is narrower than each card's quad. Nominal
            // overlap left four detached discs; overlap the useful alpha
            // instead. Retain the bottom puff and original complete bounds,
            // XZ footprint, widths/seeds, RNG sequence and shadow coverage.
            const span = H - 500 + (H / LEVELS) * 1.7;
            for (let i = 1; i < LEVELS; i++) {
              const p = puffs[towerStart + i];
              const f = i === 1 ? .10 + p.seed * .05
                : i === 2 ? .32 + p.seed * .045 : .56 + p.seed * .04;
              p.y = C.baseAlt + f * span;
              p.h = (i === 3 ? 1 - f : .50 + p.seed * .035) * span;
            }
            for (let i = 0; i < LEVELS; i++) {
              // One lighting-height frame; only the complete tower's bottom
              // and crown need horizontal caps. Interior caps cut the body.
              puffs[towerStart + i].tower = [C.baseAlt, span, i === 0 || i === 3 ? 1 : 0];
            }
          }
        }
      }
    }
    return puffs;
  }

  // one InstancedMesh, 3 cards per puff: two Y-locked crossed quads (the
  // overhead-swim fix — plan §1) + one flat cap card so decks still read as
  // surfaces from 30°+ above instead of rows of vertical slivers.
  _buildField(puffs) {
    const n = puffs.length * 3;
    const geo = new THREE.PlaneGeometry(1, 1);
    const centers = new Float32Array(n * 3);
    const scales = new Float32Array(n * 3);
    const seeds = new Float32Array(n);
    const tower = this.climate.towers > 0 ? new Float32Array(n * 3) : null;
    let k = 0;
    for (const p of puffs) {
      for (let flag = 0; flag < 3; flag++) {
        centers[k * 3] = p.x; centers[k * 3 + 1] = p.y; centers[k * 3 + 2] = p.z;
        scales[k * 3] = p.w; scales[k * 3 + 1] = p.h; scales[k * 3 + 2] = flag;
        seeds[k] = p.seed + flag * 0.13;
        if (tower && p.tower) tower.set(p.tower, k * 3);
        k++;
      }
    }
    geo.setAttribute("iCenter", new THREE.InstancedBufferAttribute(centers, 3));
    geo.setAttribute("iScale", new THREE.InstancedBufferAttribute(scales, 3));
    geo.setAttribute("iSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    if (tower) geo.setAttribute("iTower", new THREE.InstancedBufferAttribute(tower, 3));
    const mesh = new THREE.InstancedMesh(geo, this._buildMaterial(), n);
    mesh.frustumCulled = false; // instances span the field; geometry bounds don't
    mesh.renderOrder = 10;      // after terrain/water, before HUD
    return mesh;
  }

  _buildMaterial() {
    const S = this.shared, C = this.climate, curvature = this.curvature;
    const surface = curvature?.surfaceNodes("billboardCloud");
    const observer = curvature ? this.uCamera : cameraPosition;
    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });

    const litC = vec3(C.lit[0], C.lit[1], C.lit[2]);
    const shadeC = vec3(C.shade[0], C.shade[1], C.shade[2]);

    // wind-advected world center — the SAME uWindVel/uTime the shadow reads
    const center = (time = S.uTime) => attribute("iCenter", "vec3")
      .add(vec3(S.uWindVel.x, 0.0, S.uWindVel.y).mul(time));

    // cylindrical billboard basis: yaw-only, never tilts (cross = 90° twin)
    const basis = (c, flag, viewPosition = observer) => {
      const toCam = viewPosition.sub(c);
      const right0 = normalize(vec3(toCam.z, 0.0, toCam.x.negate()).add(vec3(1e-4, 0.0, 0.0)));
      const right1 = vec3(right0.z, 0.0, right0.x.negate());
      return mix(right0, right1, clamp(flag, 0.0, 1.0));
    };

    const cardPoint = (time, viewPosition) => {
      const c = center(time);
      const s = attribute("iScale", "vec3"); // (width, height, cardFlag)
      const flag = s.z;
      const right = basis(c, flag, viewPosition);
      // vertical card: base sits at iCenter.y, grows upward
      const vert = right.mul(positionLocal.x.mul(s.x))
        .add(vec3(0.0, positionLocal.y.add(0.5).mul(s.y), 0.0));
      // cap card: flat, mid-crown, world-axis aligned (edge-on from level = invisible)
      const cap = vec3(
        positionLocal.x.mul(s.x).mul(0.85),
        s.y.mul(0.62),
        positionLocal.y.mul(s.x).mul(0.85)
      );
      return c.add(mix(vert, cap, step(1.5, flag)));
    };
    mat.positionNode = Fn(() => {
      const current = cardPoint(S.uTime, observer);
      if (!surface) return current;
      // Stable card identity: evaluate actual previous advection AND facing,
      // then bend about the prior main-camera origin. Stock positionPrevious
      // only contains the raw unit plane and cannot describe this geometry.
      const previous = cardPoint(this.uPreviousTime, this.uPreviousCamera);
      return surface.vertex(current, previous);
    })();
    if (surface) mat.mrtNode = surface.mrt;

    mat.colorNode = Fn(() => {
      // card-space coords via the geometry's uv attribute — positionLocal is
      // NOT usable here: the vertex stage already overwrote it with the
      // billboarded world position (found by bisect, cycle 1)
      const cuv = uv(); // 0..1 across the card, v=0 at the base
      const s = attribute("iScale", "vec3");
      const flag = s.z;
      const isCap = step(1.5, flag);
      const tower = C.towers > 0 ? attribute("iTower", "vec3") : null; // base, full height, cap enabled
      if (tower) If(tower.y.greaterThan(0).and(isCap.greaterThan(.5)).and(tower.z.lessThan(.5)), () => { Discard(); });
      const seed = attribute("iSeed", "float");
      const c0 = center();
      const renderedCenter = curvature ? varying(curvature.forwardNode(c0), "billboardCloudCenter") : c0;
      const up = curvature ? varying(curvature.normalNode(vec3(0, 1, 0), c0), "billboardCloudUp") : vec3(0, 1, 0);

      // Rounded billows give the card a cumulus silhouette. Fine erosion
      // follows that form instead of blurring the entire puff into one disc.
      const so = seed.mul(37.7);
      const coarse = vnoise(cuv.mul(4.0).add(so)).toVar();
      const mediumUV = cuv.mul(9.0).add(so.mul(1.7));
      const medium = vnoise(mediumUV).toVar();
      const fine = vnoise(cuv.mul(21.0).add(so.mul(2.3))).toVar();
      const micro = vnoise(cuv.mul(47.0).add(so.mul(3.1))).toVar();
      const n = coarse.mul(0.45).add(medium.mul(0.30)).add(fine.mul(0.17)).add(micro.mul(0.08)).toVar();
      const crownY = seed.mul(5.3).fract().mul(0.08).add(0.57);
      const left = cuv.sub(vec2(0.30, 0.43)).div(vec2(0.27, 0.30)).length();
      const crown = cuv.sub(vec2(0.52, crownY)).div(vec2(0.27, 0.28)).length();
      const rightLobe = cuv.sub(vec2(0.72, 0.45)).div(vec2(0.24, 0.27)).length();
      const base = cuv.sub(vec2(0.49, 0.30)).div(vec2(0.39, 0.22)).length();
      const billows = min(min(left, crown), min(rightLobe, base));
      const d = mix(billows, cuv.sub(0.5).length().mul(2.1), isCap);
      const erosion = n.sub(0.5).mul(0.40).add(fine.sub(0.5).mul(0.11)).add(micro.sub(0.5).mul(0.045));
      let shape = float(1).sub(smoothstep(0.72, 1.05, d.add(erosion)));
      shape = shape.mul(mix(smoothstep(0.0, C.baseSoft, cuv.y.add(n.sub(0.5).mul(0.22))), float(1.0), isCap));
      // edge apron: the eroded mask can leak past the quad border, printing a
      // razor-straight card edge into the sky (cycle-3 finding) — force zero
      const apron = smoothstep(0.0, 0.10, cuv.x).mul(smoothstep(1.0, 0.90, cuv.x))
        .mul(smoothstep(1.0, 0.88, cuv.y));
      shape = shape.mul(apron);

      // Preserve the card's form. Sun and Moon share the same directional
      // response, but contribute independently; never interpolate a direction
      // or reorient a bright daytime card when the selected light changes.
      let grad = smoothstep(C.gradLo, C.gradHi, cuv.y.add(n.sub(0.5).mul(0.3)));
      const capCenter = c0.add(vec3(0, s.y.mul(.62), 0));
      const renderedCap = curvature ? varying(curvature.forwardNode(capCenter), "billboardCloudCapCenter") : capCenter;
      const capGrad = smoothstep(-300.0, 300.0, dot(observer.sub(renderedCap), up))
        .mul(0.65).add(0.25);
      grad = mix(grad, capGrad, isCap);
      if (tower) {
        grad = grad.toVar();
        If(tower.y.greaterThan(0), () => {
          // The repeated per-puff dark bases made connected geometry look like
          // stacked balloons. Keep its directional relief, but light the entire
          // column in one height frame, including its retained horizontal caps.
          const height = c0.y.sub(tower.x).add(mix(cuv.y, float(.62), isCap).mul(s.y)).div(tower.y);
          grad.assign(smoothstep(C.gradLo, C.gradHi, height.add(n.sub(.5).mul(.3))));
        });
      }
      const flatRight = basis(c0, flag);
      const right = curvature ? varying(normalize(curvature.directionNode(flatRight, c0)), "billboardCloudRight") : flatRight;
      const cardResponse = (direction) => {
        const localY = dot(direction, up);
        const azimuth = normalize(direction.sub(up.mul(localY)).add(right.mul(1e-4)));
        const sideDot = curvature ? dot(right, azimuth)
          : dot(right.xz, normalize(direction.xz.add(vec2(1e-4, 0))));
        const flank = smoothstep(-0.2, 0.7, sideDot.mul(cuv.x.sub(.5).mul(2)))
          .mul(.22).mul(float(1).sub(isCap));
        const weight = mix(grad, float(1), flank).toVar();
        const onCard = normalize(vec2(dot(right, direction), max(localY, .15)).add(vec2(1e-4, 0)));
        const relief = clamp(medium.sub(vnoise(mediumUV.add(onCard.mul(.45)))).mul(.38)
          .add(fine.sub(.5).mul(.055)).add(.99), .86, 1.12).toVar();
        const lit = litC.mul(mix(vec3(1, .74, .52), vec3(1), smoothstep(.02, .30, localY))).mul(1.28);
        return { weight, relief, lit };
      };
      let col;
      if (this.celestial) {
        const N = this.celestial;
        const solar = cardResponse(N.uSunDir), lunar = cardResponse(N.uMoonDir);
        // Evaluate planetary visibility at the actual fragment's cloud height,
        // not at the flight camera or a single sea-level source elevation.
        const solarVisible = surfaceCelestialTransport({ direction: N.uSunDir, curvature })(positionWorld).x;
        const lunarVisible = surfaceCelestialTransport({ direction: N.uMoonDir,
          angularRadius: this.uMoonAngularRadius, curvature })(positionWorld).x;
        const moonEnergy = N.uMoonRatio.mul(N.uExposureGain).mul(lunarVisible);
        const night = float(1).sub(smoothstep(-.173648178, -.052335956, N.uSunDir.y));
        // Diffuse twilight persists after the direct solar disc is occulted.
        // Retain the calibrated day/high-Moon palette and shared night radiance;
        // its pre-exposure is already applied, so do not multiply it again.
        const dayAmbient = shadeC.mul(float(1).sub(solar.weight)).mul(solar.relief);
        const nightAmbient = N.uNightSkyRadiance.mul(.40)
          .mul(lunar.weight.mul(.4).add(.6)).mul(lunar.relief);
        const solarDirect = solar.lit.mul(solar.weight).mul(solar.relief)
          .mul(solarVisible).mul(N.uExposureGain);
        const lunarDirect = mix(shadeC.mul(.12), lunar.lit, lunar.weight)
          .mul(lunar.relief).mul(moonEnergy);
        col = mix(dayAmbient, nightAmbient, night).add(solarDirect).add(lunarDirect);
      } else {
        const solar = cardResponse(S.uSunDir);
        col = mix(shadeC, solar.lit, solar.weight).mul(solar.relief);
      }

      // per-puff brightness variance + night dim (same shared sun)
      const pv = fract(sin(seed.mul(127.1)).mul(43758.5453));
      col = col.mul(pv.mul(0.14).add(0.92));
      if (!this.celestial) col = col.mul(smoothstep(-0.10, 0.12, S.uSunDir.y).mul(0.85).add(0.15));

      // fades: far (inside fog-far so puffs never pop on sky), near (don't
      // show a hard card when the camera flies into a puff), and view-angle
      // crossfade — caps fade IN as the view steepens (edge-on cap = seam
      // line, cycle 2), vertical cards fade DOWN at steep views (glancing
      // masks smear into streaks, cycle 3). The pair hands the silhouette
      // over smoothly between the card types as the camera climbs.
      const toC = observer.sub(renderedCenter);
      const dist = toC.length();
      const viewY = abs(dot(normalize(toC), up));
      const fade = smoothstep(42000.0, 33000.0, dist).mul(smoothstep(300.0, 1400.0, dist));
      const capFade = smoothstep(0.10, 0.32, viewY);
      const vertFade = float(1.0).sub(smoothstep(0.4, 0.8, viewY).mul(C.vertFadeK));
      let opacity = shape.mul(C.density);
      if (tower) {
        opacity = opacity.toVar();
        If(tower.y.greaterThan(0).and(shape.greaterThan(.55)), () => {
          // Crossed billboards are edge-on from their facing camera; a lone
          // .9 core still transmits the background. Add optical depth only
          // inside the tower body, retaining the original low-alpha rim.
          const core = smoothstep(.55, .90, shape);
          opacity.assign(float(1).sub(float(1).sub(opacity).pow(core.add(1))));
        });
      }
      // Near/far/view fades stay outside the core remap, preserving their
      // endpoints and the transition when flying into or above a card.
      return vec4(col, opacity.mul(fade).mul(mix(vertFade, capFade, isCap)));
    })();

    return mat;
  }

  // Advance once per main frame after PlanetCurvature.beginFrame. The current
  // and previous camera/time drive curved card geometry; sunDir is unnecessary
  // when the atmosphere's uSunDir uniform was passed at construction.
  update(camera, timeSec, sunDir = null) {
    this.uPreviousTime.value = this._frameReady ? this.shared.uTime.value : timeSec;
    this.uPreviousCamera.value.copy(this._frameReady ? this.uCamera.value : camera.position);
    this.uCamera.value.copy(camera.position);
    if (this.celestial?.moonState) this.uMoonAngularRadius.value = this.celestial.moonState.angularRadius;
    this.shared.uTime.value = timeSec;
    this._frameReady = true;
    if (sunDir) this.shared.uSunDir.value.copy(sunDir).normalize();
    this.immersion = 0; // rung 5e computes the real camera-in-slab scalar
  }
}
