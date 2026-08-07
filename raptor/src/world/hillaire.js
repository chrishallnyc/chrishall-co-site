// Hillaire-2020 atmosphere — the physically-based replacement path for the
// Preetham dome. Three faces, one physics: loadAtmo() decodes the bakery's
// 16-bit split-PNG LUTs (transmittance 256x64, psi_ms 32x32), cpuSky/cpuAerial
// are the float64 oracle mirroring bakery/atmosphere/reference.py, and the
// TSL builders emit the exact same 32-step midpoint march for the GPU (aerial
// runs 8 steps — documented approximation; the CPU pair stays at 32 to match
// the acceptance vectors). Contract: .context/raptor/bakery/atmosphere/spec.json.
// Units: planet frame in km, game API in meters. Sun irradiance 1/channel at TOA.

import * as THREE from "three";
import {
  Fn, texture, float, int, vec2, vec3, Loop,
  exp, sqrt, dot, normalize, clamp, max, min, abs, select, pow, length, and, or,
} from "three/tsl";

// ---------------------------------------------------------------------------
// Constants (spec.json "constants" — km, per-km)
// ---------------------------------------------------------------------------
const R_GROUND = 6360.0;
const R_TOP = 6460.0;
const H_ATMO = Math.sqrt(R_TOP * R_TOP - R_GROUND * R_GROUND); // 1132.2497 km
const BETA_RAY = [0.005802, 0.013558, 0.0331];
const H_RAY = 8.0;
const SIGMA_S_MIE = 3.996e-3;
const SIGMA_A_MIE = 0.404e-3;
const H_MIE = 1.2;
const MIE_G = 0.8;
const BETA_OZONE = [0.650e-3, 1.881e-3, 0.085e-3];
const OZONE_CENTER = 25.0, OZONE_HALF_WIDTH = 15.0;
const PLANET_RADIUS_OFFSET = 0.01; // 10m up-offset for the earth-shadow ray
const PSI_MS_SCALE = 0.125;        // psi = encoded^2 * scale (sqrt encode)
const T_W = 256, T_H = 64, MS_RES = 32;
const N_SKY = 32;   // march steps: sky + CPU reference (must match the bake)
const N_AERIAL = 8; // GPU aerial perspective (approximation, per module contract)

// ---------------------------------------------------------------------------
// loadAtmo — fetch + decode the 4 split PNGs into float LUTs and half-float
// DataTextures. PNG row 0 = ground; DataTexture row 0 = v0 with flipY=false,
// so v = uv.y maps altitude directly. Returns null on ANY failure (404 etc).
// ---------------------------------------------------------------------------
async function fetchPixels(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const bmp = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: "none", premultiplyAlpha: "none",
  });
  let canvas;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(bmp.width, bmp.height);
  } else {
    canvas = document.createElement("canvas");
    canvas.width = bmp.width; canvas.height = bmp.height;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const out = { data, width: bmp.width, height: bmp.height };
  bmp.close();
  return out;
}

// value16 = msb*256 + lsb; linear: x = v16/65535; sqrt-encoded: x = (v16/65535)^2 * scale
function decode16(msb, lsb, texels, sqrtScale) {
  const out = new Float32Array(texels * 4);
  for (let i = 0; i < texels; i++) {
    for (let c = 0; c < 3; c++) {
      let v = (msb[i * 4 + c] * 256 + lsb[i * 4 + c]) / 65535;
      if (sqrtScale) v = v * v * sqrtScale;
      out[i * 4 + c] = v;
    }
    out[i * 4 + 3] = 1;
  }
  return out;
}

function makeLutTexture(f32, w, h) {
  const half = new Uint16Array(f32.length);
  for (let i = 0; i < f32.length; i++) half[i] = THREE.DataUtils.toHalfFloat(f32[i]);
  const tex = new THREE.DataTexture(half, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export async function loadAtmo(baseUrl) {
  try {
    const [tMsb, tLsb, msMsb, msLsb] = await Promise.all([
      fetchPixels(`${baseUrl}/transmittance_msb.png`),
      fetchPixels(`${baseUrl}/transmittance_lsb.png`),
      fetchPixels(`${baseUrl}/multiscatter_msb.png`),
      fetchPixels(`${baseUrl}/multiscatter_lsb.png`),
    ]);
    if (!tMsb || !tLsb || !msMsb || !msLsb) return null;
    if (tMsb.width !== T_W || tMsb.height !== T_H ||
        tLsb.width !== T_W || tLsb.height !== T_H ||
        msMsb.width !== MS_RES || msMsb.height !== MS_RES ||
        msLsb.width !== MS_RES || msLsb.height !== MS_RES) return null;
    const tData = decode16(tMsb.data, tLsb.data, T_W * T_H, 0);
    const msData = decode16(msMsb.data, msLsb.data, MS_RES * MS_RES, PSI_MS_SCALE);
    return {
      tTex: makeLutTexture(tData, T_W, T_H),
      msTex: makeLutTexture(msData, MS_RES, MS_RES),
      tData, msData, tW: T_W, tH: T_H, msW: MS_RES, msH: MS_RES,
    };
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CPU reference — mirrors reference.py / atmo_common.py raymarch() exactly.
// ---------------------------------------------------------------------------
function raySphereNearestCPU(ox, oy, oz, dx, dy, dz, radius) {
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const delta = b * b - c;
  if (delta < 0) return -1;
  const sq = Math.sqrt(delta);
  const sol0 = -b - sq, sol1 = -b + sq;
  if (sol0 < 0 && sol1 < 0) return -1;
  if (sol0 < 0) return Math.max(sol1, 0);
  if (sol1 < 0) return Math.max(sol0, 0);
  return Math.max(Math.min(sol0, sol1), 0);
}

// sigma_s_rayleigh/sigma_t into ssRay/sigmaT; returns scalar sigma_s_mie
function mediumCPU(h, ssRay, sigmaT) {
  const hm = Math.max(h, 0);
  const dRay = Math.exp(-hm / H_RAY);
  const dMie = Math.exp(-hm / H_MIE);
  const dOzo = Math.min(Math.max(1 - Math.abs(h - OZONE_CENTER) / OZONE_HALF_WIDTH, 0), 1);
  const sMie = SIGMA_S_MIE * dMie;
  for (let c = 0; c < 3; c++) {
    ssRay[c] = BETA_RAY[c] * dRay;
    sigmaT[c] = ssRay[c] + sMie + SIGMA_A_MIE * dMie + BETA_OZONE[c] * dOzo;
  }
  return sMie;
}

// GPU-style bilinear: texel centers at (i+0.5), clamp-to-edge; x/y pixel coords
function bilinearCPU(data, w, h, x, y, out) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0, fy = y - y0;
  for (let c = 0; c < 3; c++) {
    const top = data[(y0 * w + x0) * 4 + c] * (1 - fx) + data[(y0 * w + x1) * 4 + c] * fx;
    const bot = data[(y1 * w + x0) * 4 + c] * (1 - fx) + data[(y1 * w + x1) * 4 + c] * fx;
    out[c] = top * (1 - fy) + bot * fy;
  }
}

// spec.json transmittance_lut.params_to_uv
function sampleTransmittanceCPU(luts, r, mu, out) {
  r = Math.min(Math.max(r, R_GROUND), R_TOP);
  mu = Math.min(Math.max(mu, -1), 1);
  const rho = Math.sqrt(Math.max(r * r - R_GROUND * R_GROUND, 0));
  const disc = r * r * (mu * mu - 1) + R_TOP * R_TOP;
  const d = Math.max(0, -r * mu + Math.sqrt(Math.max(disc, 0)));
  const u = Math.min(Math.max((d - (R_TOP - r)) / (rho + H_ATMO - (R_TOP - r)), 0), 1);
  const v = rho / H_ATMO;
  const x = Math.min(Math.max(u * luts.tW - 0.5, 0), luts.tW - 1);
  const y = Math.min(Math.max(v * luts.tH - 0.5, 0), luts.tH - 1);
  bilinearCPU(luts.tData, luts.tW, luts.tH, x, y, out);
}

// spec.json multiscatter_lut.params_to_uv (exact texel-center mapping)
function sampleMultiscatterCPU(luts, muS, h, out) {
  const ux = Math.min(Math.max(muS * 0.5 + 0.5, 0), 1);
  const uy = Math.min(Math.max(h / (R_TOP - R_GROUND), 0), 1);
  bilinearCPU(luts.msData, luts.msW, luts.msH, ux * (luts.msW - 1), uy * (luts.msH - 1), out);
}

// spec.json raymarch_recipe: N midpoint steps, analytic per-step integration
function marchCPU(luts, altM, viewDir, sunDir, tMaxCapKm) {
  const py = R_GROUND + altM / 1000;
  const [vx, vy, vz] = viewDir;
  const [sx, sy, sz] = sunDir;

  const tBottom = raySphereNearestCPU(0, py, 0, vx, vy, vz, R_GROUND);
  const tTop = raySphereNearestCPU(0, py, 0, vx, vy, vz, R_TOP);
  let tMax = tBottom >= 0 ? tBottom : (tTop >= 0 ? tTop : 0);
  if (tMaxCapKm != null) tMax = Math.min(tMax, tMaxCapKm);
  const dt = tMax / N_SKY;

  const cosTheta = vx * sx + vy * sy + vz * sz;
  const pRay = (3 / (16 * Math.PI)) * (1 + cosTheta * cosTheta);
  const g2 = MIE_G * MIE_G;
  const pMie = (3 * (1 - g2) * (1 + cosTheta * cosTheta)) /
    (8 * Math.PI * (2 + g2) * Math.pow(1 + g2 - 2 * MIE_G * cosTheta, 1.5));

  const L = [0, 0, 0], thru = [1, 1, 1];
  const ssRay = [0, 0, 0], sigmaT = [0, 0, 0], tSun = [0, 0, 0], psi = [0, 0, 0];
  for (let i = 0; i < N_SKY; i++) {
    const t = (i + 0.5) * dt;
    const Px = t * vx, Py = py + t * vy, Pz = t * vz;
    const r = Math.sqrt(Px * Px + Py * Py + Pz * Pz);
    const h = r - R_GROUND;
    const ux = Px / r, uy = Py / r, uz = Pz / r;
    const muS = ux * sx + uy * sy + uz * sz;

    const sMie = mediumCPU(h, ssRay, sigmaT);
    sampleTransmittanceCPU(luts, r, muS, tSun);
    const tEarth = raySphereNearestCPU(
      Px - PLANET_RADIUS_OFFSET * ux, Py - PLANET_RADIUS_OFFSET * uy, Pz - PLANET_RADIUS_OFFSET * uz,
      sx, sy, sz, R_GROUND);
    const shadow = tEarth < 0 ? 1 : 0;
    sampleMultiscatterCPU(luts, muS, h, psi);

    for (let c = 0; c < 3; c++) {
      const S = shadow * tSun[c] * (ssRay[c] * pRay + sMie * pMie) + psi[c] * (ssRay[c] + sMie);
      const transStep = Math.exp(-sigmaT[c] * dt);
      L[c] += thru[c] * (sigmaT[c] > 1e-12 ? (S - S * transStep) / sigmaT[c] : S * dt);
      thru[c] *= transStep;
    }
  }
  return { L, thru };
}

export function cpuSky(luts, altM, viewDir, sunDir) {
  return marchCPU(luts, altM, viewDir, sunDir, null).L;
}

export function cpuAerial(luts, altM, viewDir, sunDir, distM) {
  const out = marchCPU(luts, altM, viewDir, sunDir, distM / 1000);
  return { trans: out.thru, inscatter: out.L };
}

// ---------------------------------------------------------------------------
// TSL — the SAME march emitted as nodes. One shared helper (tslMarch) feeds
// all three builders so sky/trans/inscatter cannot drift apart.
// ---------------------------------------------------------------------------
function tslRaySphereNearest(o, d, radius) {
  const b = dot(o, d);
  const c = dot(o, o).sub(radius * radius);
  const delta = b.mul(b).sub(c);
  const sq = sqrt(max(delta, 0.0));
  const sol0 = b.negate().sub(sq);
  const sol1 = b.negate().add(sq);
  const nearest = select(sol0.lessThan(0.0),
    max(sol1, 0.0),
    select(sol1.lessThan(0.0), max(sol0, 0.0), max(min(sol0, sol1), 0.0)));
  const miss = or(delta.lessThan(0.0), and(sol0.lessThan(0.0), sol1.lessThan(0.0)));
  return select(miss, float(-1.0), nearest);
}

function tslSampleTransmittance(tTex, r, mu) {
  const rc = clamp(r, R_GROUND, R_TOP);
  const muc = clamp(mu, -1.0, 1.0);
  const rho = sqrt(max(rc.mul(rc).sub(R_GROUND * R_GROUND), 0.0));
  const disc = rc.mul(rc).mul(muc.mul(muc).sub(1.0)).add(R_TOP * R_TOP);
  const d = max(rc.mul(muc).negate().add(sqrt(max(disc, 0.0))), 0.0);
  const dMin = float(R_TOP).sub(rc);
  const u = clamp(d.sub(dMin).div(rho.add(H_ATMO).sub(dMin)), 0.0, 1.0);
  const v = rho.div(H_ATMO); // row0=ground + flipY=false: v maps altitude directly
  return texture(tTex, vec2(u, v)).rgb;
}

function tslSampleMultiscatter(msTex, muS, h) {
  const ux = clamp(muS.mul(0.5).add(0.5), 0.0, 1.0);
  const uy = clamp(h.div(R_TOP - R_GROUND), 0.0, 1.0);
  const uv = vec2(ux, uy).mul(MS_RES - 1).add(0.5).div(MS_RES); // exact texel centers
  return texture(msTex, uv).rgb;
}

// pos/dir in planet-frame km (planet center at origin, unit dir). tCap: float
// node clamp for aerial perspective, or null for the full sky march.
// Returns { L, trans } accumulator vars.
function tslMarch({ tTex, msTex, sunDir, pos, dir, tCap, steps }) {
  const tBottom = tslRaySphereNearest(pos, dir, R_GROUND);
  const tTop = tslRaySphereNearest(pos, dir, R_TOP);
  let tMaxNode = select(tBottom.greaterThanEqual(0.0), tBottom, max(tTop, 0.0));
  if (tCap !== null) tMaxNode = min(tMaxNode, tCap);
  const dt = tMaxNode.div(steps).toVar();

  const cosTheta = dot(dir, sunDir).toVar();
  const pRay = cosTheta.mul(cosTheta).add(1.0).mul(3.0 / (16.0 * Math.PI)).toVar();
  const g2 = MIE_G * MIE_G;
  const pMie = cosTheta.mul(cosTheta).add(1.0).mul(3.0 * (1.0 - g2))
    .div(pow(cosTheta.mul(-2.0 * MIE_G).add(1.0 + g2), 1.5).mul(8.0 * Math.PI * (2.0 + g2)))
    .toVar();

  const L = vec3(0.0).toVar();
  const trans = vec3(1.0).toVar();
  Loop({ start: int(0), end: int(steps), type: 'int', condition: '<' }, ({ i }) => {
    const t = float(i).add(0.5).mul(dt);
    const P = pos.add(dir.mul(t)).toVar();
    const r = length(P).toVar();
    const h = r.sub(R_GROUND).toVar();
    const up = P.div(r).toVar();
    const muS = dot(up, sunDir).toVar();

    // medium() — spec.json "medium"
    const hm = max(h, 0.0);
    const dRay = exp(hm.div(-H_RAY));
    const dMie = exp(hm.div(-H_MIE)).toVar();
    const dOzo = clamp(abs(h.sub(OZONE_CENTER)).div(-OZONE_HALF_WIDTH).add(1.0), 0.0, 1.0);
    const ssRay = vec3(BETA_RAY[0], BETA_RAY[1], BETA_RAY[2]).mul(dRay).toVar();
    const ssMie = dMie.mul(SIGMA_S_MIE).toVar();
    const sigmaT = ssRay.add(dMie.mul(SIGMA_S_MIE + SIGMA_A_MIE))
      .add(vec3(BETA_OZONE[0], BETA_OZONE[1], BETA_OZONE[2]).mul(dOzo)).toVar();

    // sun visibility: transmittance LUT x hard earth shadow (10m up-offset)
    const tSun = tslSampleTransmittance(tTex, r, muS);
    const tEarth = tslRaySphereNearest(P.sub(up.mul(PLANET_RADIUS_OFFSET)), sunDir, R_GROUND);
    const shadow = select(tEarth.lessThan(0.0), float(1.0), float(0.0));

    // S = shadow*T_sun*(ssRay*phaseR + ssMie*phaseM) + psi_ms*(ssRay + ssMie)
    const psi = tslSampleMultiscatter(msTex, muS, h);
    const S = tSun.mul(ssRay.mul(pRay).add(ssMie.mul(pMie))).mul(shadow)
      .add(psi.mul(ssRay.add(ssMie))).toVar();

    // analytic step integration, sigma_t -> 0 guard (all channels co-vanish)
    const transStep = exp(sigmaT.mul(dt).negate()).toVar();
    const sigSum = sigmaT.x.add(sigmaT.y).add(sigmaT.z);
    const sInt = select(sigSum.greaterThan(1e-12),
      S.sub(S.mul(transStep)).div(max(sigmaT, 1e-12)),
      S.mul(dt));
    L.addAssign(trans.mul(sInt));
    trans.mulAssign(transStep);
  });
  return { L, trans };
}

// Planet frame: center directly below the CAMERA. Camera sits at
// (0, Rground + cam.y/1000, 0); a world point wp lands at pos + (wp-cam)/1000.
function tslCameraPos(uCamPos) {
  return vec3(0.0, uCamPos.y.div(1000.0).add(R_GROUND), 0.0);
}

// (viewDirNode: vec3) => vec3 sky radiance. No sun disc, no ground term.
export function skySkyNode({ tTex, msTex, uSunDir, uCamPos }) {
  return Fn(([viewDir]) => {
    const { L } = tslMarch({
      tTex, msTex, sunDir: normalize(uSunDir),
      pos: tslCameraPos(uCamPos).toVar(), dir: normalize(viewDir).toVar(),
      tCap: null, steps: N_SKY,
    });
    return L;
  });
}

// shared aerial setup: camera->wp ray in planet-frame km
function tslAerial({ tTex, msTex, uSunDir, uCamPos }, wp) {
  const rel = wp.sub(uCamPos).div(1000.0).toVar();
  const distKm = length(rel).toVar();
  return tslMarch({
    tTex, msTex, sunDir: normalize(uSunDir),
    pos: tslCameraPos(uCamPos).toVar(), dir: rel.div(max(distKm, 1e-6)).toVar(),
    tCap: distKm, steps: N_AERIAL,
  });
}

// (wp: vec3 world meters) => vec3 transmittance along camera->wp
export function aerialTransNode({ tTex, msTex, uSunDir, uCamPos }) {
  return Fn(([wp]) => tslAerial({ tTex, msTex, uSunDir, uCamPos }, wp).trans);
}

// (wp: vec3 world meters) => vec3 inscattered radiance along camera->wp
export function aerialInscatterNode({ tTex, msTex, uSunDir, uCamPos }) {
  return Fn(([wp]) => tslAerial({ tTex, msTex, uSunDir, uCamPos }, wp).L);
}
