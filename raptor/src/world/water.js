// Spectral water with a camera-centered adaptive mesh and curved far ocean.
// The macro FFT displaces geometry; a separate missing-band FFT provides
// centimeter-height fine ripples as smooth shading slopes. Both slope fields
// filter first/second moments so unresolved waves broaden GGX roughness.
// Geometry, phase, prior-frame motion, and shoreline queries stay in map
// coordinates; final complete surface radiance receives atmosphere once.
// Gerstner waves remain the WebGL/LOW fallback. ?waterslopes=legacy keeps
// the prior hashed normal field solely for QA comparison.

import * as THREE from "three";
import { surfaceVelocityMRT } from "./surfacevelocitymrt.js";
import {
  Fn, uniform, texture, vec2, vec3, float, positionLocal, positionWorld,
  modelWorldMatrix, vec4, normalize, clamp, smoothstep, mix, sin, cos, dot,
  fract, floor, cameraPosition, dFdx, dFdy, max, pow, sqrt, luminance,
  log2, exp2, abs, cameraViewMatrix, attribute, output, varyingProperty,
} from "three/tsl";

import { makeOceanGrid, OCEAN_GRID_SPAN, OCEAN_GRID_VERTS, OCEAN_GRID_WARP } from "./oceangrid.js";

import { makeFarOcean } from "./farocean.js";
import { filteredSlopeMoments } from "./waterslopes.js";

const NEAR_SPAN = OCEAN_GRID_SPAN, NEAR_VERTS = OCEAN_GRID_VERTS;
const FAR_SPAN = 480000;

// per-front sea states: [wavelengthM, amplitudeM, dirDeg] ×8
// Amplitude discipline: the SUM of amplitudes is the worst-case crest.
// Fjord chop tops out well under a meter; Pacific swell ~2.5m total.
const SEA_STATES = {
  VALDEZ: { // protected fjord water: short chop, wind-textured not mirror
    waves: [
      [42, 0.06, 335], [67, 0.09, 350], [95, 0.11, 320], [140, 0.14, 345],
      [210, 0.16, 310], [320, 0.2, 330], [55, 0.06, 5], [170, 0.12, 300],
    ],
    deep: 0x0e2e33, shallow: 0x2e6b66, roughness: 0.2, foamShore: 130, normalK: 1.6, micro: 0.9, mss: 0.011,
  },
  MARIANAS: { // open Pacific swell breaking on the barrier reef
    waves: [
      [80, 0.14, 75], [130, 0.22, 60], [200, 0.3, 85], [310, 0.38, 70],
      [470, 0.46, 55], [700, 0.52, 65], [100, 0.16, 100], [260, 0.28, 45],
    ],
    deep: 0x06334e, shallow: 0x2ba098, roughness: 0.14, foamShore: 170, normalK: 1.2, micro: 1.0, mss: 0.02,
  },
};

export class Water {
  constructor(front, terrain, aerial = null, fft = null, { cloudShadow = null, curvature = null } = {}) {
    // The shared Sun shadow node is installed during boot (round 4).
    // Receiver flags attenuate direct diffuse/specular only, preserving
    // ambient/IBL and wave normals. The QA flag opts both water meshes out.
    if (cloudShadow && typeof location !== "undefined" &&
        new URLSearchParams(location.search).get("watershadow") === "0") cloudShadow = null;
    this.curvature = curvature;
    this.terrain = terrain;
    this.temporalSurfaceHistory = !fft || !!fft.previousDispTex;
    this.cloudShadow = cloudShadow;
    this.aerial = aerial; // exposed for QA rebuilds (t6b battery)
    this.fft = fft; // MAXFI A4: createFFTOcean result, or null = Gerstner
    // QA A/B only; the actual FFT provider supplies the moment map. Custom
    // old providers keep their existing normal contract without assuming mips.
    this.filteredSlopes = !!fft?.slopeMomentTex && !(typeof location !== "undefined" &&
      new URLSearchParams(location.search).get("waterslopes") === "legacy");
    const legacyGrid = typeof location !== "undefined" &&
      new URLSearchParams(location.search).get("watergrid") === "legacy";
    // An old/custom FFT provider without mip support keeps the legacy grid;
    // a warped mesh must never sample its full-frequency displacement raw.
    this.adaptiveGrid = !legacyGrid && (!fft || fft.displacementMipLevels > 1);
    if (fft) {
      // world-tiled sampling needs repeat wrapping (set defensively here)
      for (const t of [fft.dispTex, fft.normTex, fft.previousDispTex].filter(Boolean)) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.magFilter = THREE.LinearFilter;
      }
      // The FFT provider owns displacement mip allocation/update ordering.
      // Keep the fragment normal/foam map exactly as before.
      fft.normTex.minFilter = THREE.LinearFilter;
      fft.normTex.generateMipmaps = false;
    }
    const S = SEA_STATES[front] || SEA_STATES.MARIANAS;
    this.state = S;
    this.uTime = uniform(0);
    this.uPreviousTime = uniform(0);
    this.uPreviousGridCenter = uniform(new THREE.Vector2());
    this.terrainSize = terrain.size;
    const shore = terrain.getShoreField();

    // wave constants baked into the shader graph
    const waves = S.waves.map(([L, A, degDir]) => {
      const w = (2 * Math.PI) / L;
      const c = Math.sqrt(9.81 / w); // deep-water dispersion
      const rad = (degDir * Math.PI) / 180;
      return { w, A, phi: w * c, dx: Math.sin(rad), dz: Math.cos(rad), Q: Math.min(0.55 / (w * A * S.waves.length), 1.2) };
    });

    const mat = new THREE.MeshStandardNodeMaterial({
      roughness: S.roughness, metalness: 0.0, transparent: false,
    });
    const surface = curvature?.surfaceNodes("water");
    const mapPosition = surface ? surface.flat : positionWorld;
    // Sampling coordinates of the wave simulation precede displacement.
    // Sampling the already-choppy world XZ slides normals across the crests.
    const waveParameter = this.filteredSlopes ? varyingProperty("vec3", "waterWaveParameter") : null;
    if (surface) mat.mrtNode = this.temporalSurfaceHistory ? surface.mrt : surfaceVelocityMRT(vec2(4));
    // Same conservative adjacent gap as the sinh grid, evaluated at the old
    // camera-relative location of a current geographic sample. This avoids
    // pretending that the previous mip footprint equals the current grid's.
    const gridK = NEAR_SPAN / 2 / Math.sinh(OCEAN_GRID_WARP);
    const gridDelta = OCEAN_GRID_WARP * 2 / (NEAR_VERTS - 1);
    const priorGridSpacing = (offset) => {
      const gap = (v) => abs(v).mul(Math.cosh(gridDelta) - 1)
        .add(sqrt(v.mul(v).add(gridK * gridK)).mul(Math.sinh(gridDelta)));
      return max(gap(offset.x), gap(offset.y));
    };

    const shoreUV = (wp) => vec2(
      wp.x.div(this.terrainSize).add(0.5),
      float(0.5).sub(wp.z.div(this.terrainSize))
    );
    // PASS-3 RADIAL FIX prereq: the sheet material now also dresses the far
    // skirt (see the skirt note), which reaches 240km — far past the DEM.
    // Out there the shore field's ClampToEdge texel is whatever the map
    // border held (often LAND -> sd 0), which would paint turquoise shallows
    // + full wave energy past the world edge. Fade every shore consumer to
    // open deep water across the last 2km of the map — a WORLD-anchored
    // boundary, unlike the camera-anchored rim this fix retires.
    const HALF = this.terrainSize / 2;
    const shoreDist = (wp) => {
      const raw = texture(shore.tex, shoreUV(wp)).r.mul(shore.maxDist);
      const inMap = smoothstep(float(HALF), float(HALF - 2000), max(abs(wp.x), abs(wp.z)));
      return mix(float(shore.maxDist), raw, inMap);
    };

    // value noise (same idiom as terrain.js): foam ribbons + micro-gust fields
    const hash2 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
    const vnoise = (p) => {
      const i = floor(p), f = fract(p);
      const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
      const a = hash2(i), b = hash2(i.add(vec2(1, 0)));
      const c = hash2(i.add(vec2(0, 1))), d = hash2(i.add(vec2(1, 1)));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    };

    // PASS-2 item 4 ("the ocean is denim"): the pass-1 micro layer was six
    // FIXED-direction pure sinusoids faded by CAMERA DISTANCE — but at grazing
    // angles the along-view pixel footprint stretches 5-20x past the fade's
    // assumption, so still-live gratings sampled far past Nyquist aliased into
    // periodic moire (FFT peaks 78-216x median: denim crosshatch, comb rows in
    // the glint, fingerprint rings on dark water). The rebuild breaks every
    // source of periodicity and filters by the ACTUAL footprint:
    //   - footprint(wp) = max screen-derivative of world XZ (meters/pixel);
    //     every detail layer fades against ITS wavelength vs this, not range
    //   - (pass-2 kept 3 warped cos octaves here — they combed at grazing;
    //     retired by PASS-3 item 6, see the micro-layer note below)
    //   - the retired slope variance folds into roughness (Toksvig/LEAN trade
    //     below) so far water stays wind-rough instead of mirror-flat
    //   - glitter is gated by the reflected-sky luminance (skyRefl, shared
    //     with the item-5 mirror term): dark water carries no sparkle noise
    const footprint = (wp) => max(dFdx(wp.xz).length(), dFdy(wp.xz).length());
    const hash22 = (p) => vec2(hash2(p), hash2(p.add(vec2(37.79, 17.31))));
    // value noise carries its own lattice frequency — any single vnoise field
    // is itself a periodicity source (measured: the old 210m gust grid was a
    // clean 32px FFT line). Rotate every noise domain off-axis and pair
    // incommensurate scales so no lattice survives into the spectrum.
    const rot2 = (p, deg) => {
      const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
    };

    // PASS-3 item 6 (REGRESSION — noon sparkle dead, golden glint a screen-
    // period comb): the pass-2 micro layer was still THREE FIXED-DIRECTION
    // cos gratings. Bisect (waterdbg captures, marianas-178) pinned the comb
    // on them alone: near its Nyquist-fade band one octave dominates and its
    // across-view projection is a single ~11-14px frequency — the 10m domain
    // warp bends phase lines over ~50m, which is ~50 SCREEN px out there, so
    // patches stay coherent (FFT concentration 87-258x, aniso 46-60x; every
    // other suspect — glint dither, tile phase jitter, displacement, fftFade,
    // luminance floor, Toksvig — measured innocent). And at noon the fades
    // retired FFT texels + micro + the fp<2.4 glint dither TOGETHER, leaving
    // only smooth roughness: HF p99 1.5-3.0 DN vs the 5-20 bar (fftFade=1
    // alone doubled it; glintGate=1 and constant roughness changed nothing).
    // Fix: no gratings at all — the FFT field owns the near-field wave look
    // (its texels are live exactly where micro octaves lived), and a
    // FOOTPRINT-ADAPTIVE stochastic glint NDF (below) re-carries the retired
    // variance as sparse world-anchored dots at every distance. Nothing in
    // the micro path is periodic anymore, so there is nothing left to comb.
    // Kept: the cat's-paw gust field — glitter arrives in patches, not
    // uniformly (two rotated incommensurate octaves — see rot2 note).
    const gustField = (wp) => {
      const gust = vnoise(rot2(wp.xz, 17).div(210.0).add(vec2(this.uTime.mul(0.011), this.uTime.mul(-0.007))))
        .mul(0.62)
        .add(vnoise(rot2(wp.xz, -39).div(151.0).add(vec2(this.uTime.mul(-0.008), this.uTime.mul(0.006)))).mul(0.38));
      return smoothstep(0.25, 0.8, gust).mul(0.85).add(0.15).mul(S.micro ?? 1.0);
    };
    // retired micro slope variance (was Σamp²/2 · 0.36·micro² of the removed
    // octaves) — still budgeted so the Toksvig trade and the glint amplitude
    // conserve the same energy the old layer carried
    const MICRO_VAR = 0.0097 * 0.36 * (S.micro ?? 1) * (S.micro ?? 1);

    // 4-tap tile-phase jitter (normals + foam only — the vertex displacement
    // keeps plain UVs for mesh continuity; 0.4m geometry repeats are invisible
    // where the normal-field repeats were not). Each 320m cell hashes its own
    // phase offset; smooth-bilinear corner weights hide the seams and the
    // slope sum is renormalized by 1/sqrt(Σw²) so blend zones keep full
    // variance (a plain average would stamp a 320m soft-spot grid).
    const slopeFoam = fft ? (wp) => {
      const p = wp.xz.div(fft.tileM);
      const i = floor(p), f = fract(p);
      const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
      let sx = float(0), sz = float(0), foam = float(0), w2sum = float(0);
      for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const w = (cx ? u.x : float(1.0).sub(u.x)).mul(cz ? u.y : float(1.0).sub(u.y));
        const n = texture(fft.normTex, p.add(hash22(i.add(vec2(cx, cz)))));
        const ny = max(n.y, 0.35);
        sx = sx.add(n.x.div(ny).mul(w));
        sz = sz.add(n.z.div(ny).mul(w));
        foam = foam.add(n.a.mul(w));
        w2sum = w2sum.add(w.mul(w));
      }
      const wrms = sqrt(max(w2sum, 1e-4));
      return { sx: sx.div(wrms), sz: sz.div(wrms), foam };
    } : null;

    const gerstner = (wp, gridSpacing = null, time = this.uTime) => {
      let dispX = float(0), dispY = float(0), dispZ = float(0);
      let nx = float(0), nz = float(0), nyAcc = float(0);
      for (const { w, A, phi, dx, dz, Q } of waves) {
        const theta = wp.x.mul(dx * w).add(wp.z.mul(dz * w)).add(time.mul(phi));
        const s = sin(theta), c = cos(theta);
        // Geometry only: fade a wave before fewer than four vertices can
        // describe it; gone at Nyquist. Fragment normals retain their field.
        const amplitude = gridSpacing
          ? smoothstep(gridSpacing.mul(2.0), gridSpacing.mul(4.0), float(2 * Math.PI / w)).mul(A)
          : float(A);
        dispX = dispX.add(c.mul(amplitude).mul(Q * dx));
        dispZ = dispZ.add(c.mul(amplitude).mul(Q * dz));
        dispY = dispY.add(s.mul(amplitude));
        nx = nx.add(c.mul(dx * w * A));
        nz = nz.add(c.mul(dz * w * A));
        nyAcc = nyAcc.add(s.mul(Q * w * A));
      }
      return { dispX, dispY, dispZ, nx, nz, nyAcc };
    };

    // FFT mode samples the compute-generated maps at world-tiled UV; the
    // shore damp + edge fades apply identically in both modes (hard-won —
    // the rim energy cliff and beach flattening were forensics findings)
    const fftUV = fft ? (wp) => fract(wp.xz.div(fft.tileM)) : null;

    // Surface statistics are independent of the incoming illumination.
    const glintGate = float(1.0);
    const slopeMoments = this.filteredSlopes
      ? filteredSlopeMoments(fft.slopeMomentTex, waveParameter.xz, fft.tileM, fft.N).toVar("waterSlopeMoments") : null;
    const fineMoments = slopeMoments && fft.fine
      ? filteredSlopeMoments(fft.fine.slopeMomentTex, waveParameter.xz, fft.fine.tileM, fft.fine.N, "waterFine")
        .toVar("waterFineSlopeMoments") : null;

    mat.positionNode = Fn(() => {
      // Evaluate wave/shore fields in the original map coordinates, then
      // bend both current and previous physical surface positions.
      const wp = modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz;
      if (waveParameter) waveParameter.assign(wp);
      const shoreDamp = smoothstep(0.0, 120.0, shoreDist(wp));
      const damp = shoreDamp.mul(smoothstep(15800.0, 9000.0, positionLocal.xz.length()));
      const oldOffset = wp.xz.sub(this.uPreviousGridCenter);
      const oldDamp = shoreDamp.mul(smoothstep(15800.0, 9000.0, oldOffset.length()));
      const spacing = this.adaptiveGrid ? attribute("waterGridSpacing", "float") : null;
      const oldSpacing = this.adaptiveGrid ? priorGridSpacing(oldOffset) : null;
      const displaced = (previous) => {
        const fade = previous ? oldDamp : damp, sampleSpacing = previous ? oldSpacing : spacing;
        if (fft) {
          const tex = previous && fft.previousDispTex ? fft.previousDispTex : fft.dispTex;
          const lod = sampleSpacing
            ? clamp(log2(max(sampleSpacing.mul(2.0 / (fft.tileM / fft.N)), 1.0)), 0.0, fft.displacementMipLevels - 1)
            : float(0);
          const d = texture(tex, fftUV(wp)).level(lod).xyz;
          return vec3(wp.x.add(d.x.mul(fade)), wp.y.add(d.y.mul(fade)), wp.z.add(d.z.mul(fade)));
        }
        const g = gerstner(wp, sampleSpacing, previous ? this.uPreviousTime : this.uTime);
        return vec3(wp.x.add(g.dispX.mul(fade)), wp.y.add(g.dispY.mul(fade)), wp.z.add(g.dispZ.mul(fade)));
      };
      const current = displaced(false);
      if (surface) return surface.vertex(current, displaced(true));
      // Without curvature keep the established local/model contract.
      return vec3(positionLocal.x.add(current.x.sub(wp.x)), current.y.sub(wp.y), positionLocal.z.add(current.z.sub(wp.z)));
    })();

    const flatNormal = Fn(() => {
      const wp = mapPosition;
      const shoreDamp = smoothstep(0.0, 120.0, shoreDist(wp)).mul(S.normalK);
      if (slopeMoments) {
        // Means follow the same physical FFT coordinates as displacement.
        // The filter carries subpixel variance separately into roughness;
        // no discontinuous hash-cell normal is added at any footprint.
        const damp = clamp(shoreDamp, 0, 1);
        const mean = fineMoments ? slopeMoments.xy.add(fineMoments.xy) : slopeMoments.xy;
        return normalize(vec3(mean.x.mul(damp), 1, mean.y.mul(damp)));
      }
      if (fft) {
        // filtered-NDF LOD, footprint edition: normTex has no mips (per-frame
        // storage) — flatten the phase-jittered slope as its 1.25m texels go
        // sub-pixel ON SCREEN (footprint covers grazing stretch, which the
        // old camera-distance fade missed — that miss WAS the denim) and hand
        // the lost variance to the roughness companion below
        const fp = footprint(wp);
        const texel = fft.tileM / fft.N;
        const fftFade = smoothstep(texel * 5.0, texel * 1.2, fp);
        const sf = slopeFoam(wp);
        // FOOTPRINT-ADAPTIVE stochastic glint NDF: sparse world-anchored
        // slope dots whose CELL SIZE tracks the pixel footprint (0.38m cells
        // at lod 0, doubling per lod, two lods crossfaded), so dots stay
        // ~1-2.6px at every distance instead of retiring at fp>2.4 (that
        // retirement was the dead noon). Amplitude rides the SAME variance
        // the footprint fades hand to roughness (Toksvig budget) — the NDF
        // is mirror + discrete facets, not mirror-or-nothing. Cell ids are
        // hashed (wrapped mod 1024 so the sin-hash keeps fp32 precision at
        // 16km; the 389m·2^lod dot-layout repeat is invisible in sparse
        // noise) — pure world anchoring + per-cell blue-noise-ish threshold:
        // nothing is screen-locked and nothing is periodic.
        const gustK = gustField(wp);
        const varRet = float(S.mss).mul(float(1.0).sub(fftFade.mul(fftFade))).add(MICRO_VAR);
        const lodF = clamp(log2(max(fp.mul(2.63), 1.0)), 0.0, 7.0);
        const l0 = floor(lodF), lw = lodF.sub(l0);
        const dotAt = (scale, lodId) => {
          const c = fract(floor(wp.xz.mul(2.63).div(scale)).div(1024.0)).mul(1024.0)
            .add(lodId.mul(13.7));
          const on = smoothstep(0.5, 0.8, hash2(c.add(vec2(91.7, 33.3))));
          return vec2(hash2(c).sub(0.5), hash2(c.add(vec2(57.1, 7.7))).sub(0.5)).mul(on);
        };
        const spark = mix(dotAt(exp2(l0), l0), dotAt(exp2(l0.add(1.0)), l0.add(1.0)), lw);
        // fade only where a cell would exceed ~50m / the horizon band: the
        // far-field glitter average IS the roughness lobe (horizon intact)
        const sparkA = sqrt(varRet.add(1e-5)).mul(3.1).mul(gustK).mul(glintGate)
          .mul(smoothstep(45.0, 18.0, fp));
        const nx = sf.sx.mul(fftFade).add(spark.x.mul(sparkA));
        const nz = sf.sz.mul(fftFade).add(spark.y.mul(sparkA));
        // PASS-3 RADIAL FIX: NO sheet-rim fade here (shore damp only). The
        // old edgeFadeN was CAMERA-anchored (the sheet follows the camera)
        // and retired spark energy over a 9-15.8km camera ring. The fft
        // texel share needs no rim fade: texels are 1.25m, so fp >= ~5.9m at
        // 9km+ keeps fftFade = 0 there from any camera (the footprint law
        // owns the retirement), and the glint NDF is world-anchored with its
        // own footprint fade — both continue seamlessly onto the far skirt,
        // which now wears this same material (see the skirt note).
        return normalize(mix(vec3(0, 1, 0), vec3(nx, 1.0, nz), clamp(shoreDamp, 0.0, 1.0)));
      }
      // analytic Gerstner waves carry no footprint machinery — keep the rim
      // fade so the fallback sheet still flattens into the skirt
      const edgeFadeN = smoothstep(15800.0, 9000.0, positionLocal.xz.length());
      const damp = shoreDamp.mul(edgeFadeN);
      const g = gerstner(wp);
      return normalize(vec3(g.nx.negate().mul(damp), float(1.0).sub(g.nyAcc.mul(damp).mul(0.8)), g.nz.negate().mul(damp)));
    })();
    mat.normalNode = (curvature ? curvature.normalNode(flatNormal, mapPosition) : flatNormal)
      .transformDirection(cameraViewMatrix);
    if (fft) {
      // GGX companion: as micro-normal energy rises the surface must sparkle,
      // not mirror-flash — nudge roughness up with the same gust/damp fields.
      // Toksvig/LEAN trade: every slope-variance unit the footprint filters
      // removed from the normal (FFT texels via fftFade, plus the retired
      // MICRO_VAR budget) returns as roughness in α² space, so far water
      // stays wind-rough instead of collapsing to a mirror — and the glint
      // NDF above re-carries a share of it as discrete facets.
      // PASS-3 RADIAL FIX: microDamp is the SHORE field only — the old
      // edgeFadeR retired the Toksvig restore over the camera-centered
      // 9-15.8km sheet-rim ring. Footprint keeps the fftFade half honest at
      // every range; the restore is world/footprint-anchored, never camera-
      // anchored, and continues seamlessly onto the shared-material skirt.
      mat.roughnessNode = Fn(() => {
        const wp = mapPosition;
        const microDamp = smoothstep(0.0, 120.0, shoreDist(wp));
        if (slopeMoments) {
          // E[|s|²] - |E[s]|² is exactly the trace of the filtered slope
          // covariance. Scale variance by damp², consistently with normals.
          // Three uses perceptual roughness r and GGX alpha=r², so width
          // variance accumulates in alpha²=r⁴, not r². This isotropic GGX
          // width match is an approximation, not a full anisotropic LEAN BRDF.
          const macroVariance = max(slopeMoments.z.sub(dot(slopeMoments.xy, slopeMoments.xy)), 0);
          const fineVariance = fineMoments
            ? max(fineMoments.z.sub(dot(fineMoments.xy, fineMoments.xy)), 0) : float(0);
          const unresolved = macroVariance.add(fineVariance);
          const tail = fineMoments ? fft.fine.tailVariance : MICRO_VAR;
          const damp = clamp(microDamp.mul(S.normalK), 0, 1);
          return clamp(pow(float(S.roughness ** 4)
            .add(unresolved.add(tail).mul(damp.mul(damp))), .25), .04, 1);
        }
        const fp = footprint(wp);
        const gustK = gustField(wp);
        const texel = fft.tileM / fft.N;
        const fftFade = smoothstep(texel * 5.0, texel * 1.2, fp);
        const lost = float(S.mss).mul(float(1.0).sub(fftFade.mul(fftFade)))
          .add(float(MICRO_VAR).mul(glintGate).mul(glintGate));
        // gust sheen patches are a NEAR/MID-field glint texture — faded by
        // footprint before grazing projection stacks them into far-field rows
        return sqrt(float(S.roughness * S.roughness).add(lost.mul(microDamp)))
          .add(gustK.mul(microDamp).mul(0.05).mul(smoothstep(14.0, 4.0, fp)));
      })();
    }

    const deepC = new THREE.Color(S.deep), shallowC = new THREE.Color(S.shallow);
    mat.colorNode = Fn(() => {
      const wp = mapPosition;
      // PASS-1 item 7: the shore field is coarse (32m texels) — consumed raw,
      // its bilinear iso-contours draw as staircase chunks along every coast.
      // Wobble the sampled distance with two octaves of slow world-space
      // noise so no straight texel edge survives, then cut the foam as a
      // noise-broken advected ribbon instead of a uniform speckled stripe.
      const t = this.uTime;
      const sdRaw = shoreDist(wp);
      const wob = vnoise(wp.xz.div(90.0).add(vec2(t.mul(0.015), t.mul(-0.011)))).sub(0.5).mul(70.0)
        .add(vnoise(wp.xz.div(28.0)).sub(0.5).mul(22.0));
      const sd = sdRaw.add(wob);
      let c = mix(vec3(shallowC.r, shallowC.g, shallowC.b), vec3(deepC.r, deepC.g, deepC.b),
                  smoothstep(20.0, 520.0, sd));
      // foam terms wear the same radial edge fade as the displacement, or the
      // speckle pattern hard-stops at the sheet rim (measured energy cliff)
      const edgeFadeC = smoothstep(15800.0, 9000.0, positionLocal.xz.length());
      // advected foam ribbon: band strength biases the noise threshold, so
      // the waterline is near-solid froth that breaks into tapered fingers
      // and dissolves seaward — never a stripe with a hard seaward chop
      const band = smoothstep(this.state.foamShore, 6.0, sd);
      const camDist = wp.sub(cameraPosition).length();
      const fn1 = vnoise(wp.xz.div(60.0).add(vec2(t.mul(0.030), t.mul(0.021))));
      const fn2 = vnoise(wp.xz.div(21.0).add(vec2(t.mul(-0.050), t.mul(0.033))));
      const fn3 = vnoise(wp.xz.div(7.5).add(vec2(t.mul(0.080), t.mul(-0.060))));
      // the 7.5m octave goes sub-pixel past ~2km — retire it before it dithers
      const fnoise = fn1.mul(0.5).add(fn2.mul(0.32)).add(fn3.mul(smoothstep(4000.0, 1200.0, camDist).mul(0.18)));
      const shoreFoam = smoothstep(float(0.62).sub(band.mul(0.34)), float(0.88).sub(band.mul(0.26)), fnoise)
        .mul(band).mul(fn2.mul(0.35).add(0.65));
      // crest foam: FFT mode uses the compute-side Jacobian accumulation via
      // the same phase-jittered 4-tap field as the normals (mip-less — fade
      // by footprint before its texels dither into confetti)
      const crest = slopeMoments ? slopeMoments.w.mul(.75) : fft
        ? slopeFoam(wp).foam.mul(smoothstep(10.0, 2.5, footprint(wp))).mul(0.75)
        : smoothstep(0.55, 0.95, gerstner(wp).nyAcc).mul(0.6);
      c = mix(c, vec3(0.92, 0.95, 0.96), clamp(shoreFoam.add(crest), 0.0, 0.85).mul(edgeFadeC));
      return c;
    })();
    // `output` contains complete direct diffuse/specular + environment
    // light. Apply the view atmosphere ONCE to all of it after lighting.
    // The shared composite uses one march for both transmittance/inscatter.
    if (aerial) {
      mat.fog = false;
      mat.outputNode = Fn(() => vec4(
        aerial.composite
          ? aerial.composite(positionWorld, output.rgb)
          : output.rgb.mul(aerial.trans(positionWorld)).add(aerial.ins(positionWorld).mul(aerial.uSunI)),
        output.a
      ))();
    }

    // near animated sheet + flat far skirt to the horizon
    this.mesh = new THREE.Mesh(
      this.adaptiveGrid ? makeOceanGrid() :
        new THREE.PlaneGeometry(NEAR_SPAN, NEAR_SPAN, NEAR_VERTS - 1, NEAR_VERTS - 1).rotateX(-Math.PI / 2),
      mat
    );
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = !!cloudShadow;
    // Match every near-grid boundary vertex at the same physical height.
    // Overlapping a radial skirt with the square grid loses depth precision
    // at range and changes the world position used for wave/shore shading.
    this.far = new THREE.Mesh(
      makeFarOcean({ nearGeometry: this.mesh.geometry,
        ...(curvature ? {} : { outerRadius: FAR_SPAN / 2, radialSegments: 1, angularSegments: 48 }) }),
      mat
    );
    if (this.adaptiveGrid) {
      // The far ring shares this material but has zero geometric wave fade.
      // Provide the same vertex input so both render pipelines are valid.
      const count = this.far.geometry.getAttribute("position").count;
      this.far.geometry.setAttribute("waterGridSpacing", new THREE.BufferAttribute(new Float32Array(count).fill(NEAR_SPAN), 1));
    }
    this.far.position.y = 0; // shared seam vertices occupy one surface
    this.far.frustumCulled = false;
    this.far.receiveShadow = !!cloudShadow;
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.far);
  }

  // The adaptive grid follows continuously: no snap or topology change.
  // Displacement is world-anchored and filtered for the local sample spacing.
  update(camera, timeSec) {
    this.uPreviousTime.value = this.uTime.value;
    this.uPreviousGridCenter.value.set(this.mesh.position.x, this.mesh.position.z);
    this.uTime.value = timeSec;
    if (this.fft) this.fft.update(timeSec); // per-frame compute dispatch
    const quad = NEAR_SPAN / (NEAR_VERTS - 1);
    this.mesh.position.x = this.adaptiveGrid ? camera.position.x : Math.round(camera.position.x / quad) * quad;
    this.mesh.position.z = this.adaptiveGrid ? camera.position.z : Math.round(camera.position.z / quad) * quad;
    this.far.position.x = this.mesh.position.x;
    this.far.position.z = this.mesh.position.z;
    this.terrain.oceanOcclusion?.update(this, camera);
  }
}
