// Water v1 — Gerstner-sum ocean in TSL (one material, both backends).
// A camera-following snapped grid carries 8 summed Gerstner waves displaced
// in the vertex shader with ANALYTIC normals; a flat far skirt reaches the
// horizon. Standard-material shading means the sun light gives GGX glitter
// and the sky IBL gives reflections for free. Depth is proxied by the
// terrain's shore-distance field (bathymetry was clamped in the bake):
// turquoise shallows + a foam band hug the coast; crest foam breaks on the
// steepest wave sums. Render-side clock only — the sim never reads water.
//
// PASS-2 items 4+5 (FFT/webgpu path only; the Gerstner fallback above is
// untouched): all detail layers are filtered against the PROJECTED PIXEL
// FOOTPRINT with the removed slope variance traded into roughness
// (Toksvig/LEAN), the FFT normal/foam tile is phase-jittered per 320m cell,
// glitter is stochastic and luminance-floored — all of it because six fixed
// sinusoids + a raw tile once aliased into denim moire / comb rows /
// fingerprint rings. Grazing Fresnel picks up the hillaire horizon (skyRefl
// march) so golden-hour water finally mirrors the warm sky.
// PASS-3 item 6: the pass-2 micro chop (three warped cos gratings) itself
// combed at grazing and its fades left noon water dead glass — the gratings
// are gone entirely and the glitter is now a footprint-adaptive stochastic
// glint NDF (world-anchored hash cells sized to the pixel footprint,
// amplitude fed by the Toksvig-retired variance; see the micro-layer note).

import * as THREE from "three";
import {
  Fn, uniform, texture, vec2, vec3, float, positionLocal, positionWorld,
  modelWorldMatrix, vec4, normalize, clamp, smoothstep, mix, sin, cos, dot,
  fract, floor, cameraPosition, dFdx, dFdy, max, pow, sqrt, luminance,
  log2, exp2,
} from "three/tsl";

const NEAR_SPAN = 32000, NEAR_VERTS = 384;
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
  constructor(front, terrain, aerial = null, fft = null) {
    this.fft = fft; // MAXFI A4: createFFTOcean result, or null = Gerstner
    if (fft) {
      // world-tiled sampling needs repeat wrapping (set defensively here)
      for (const t of [fft.dispTex, fft.normTex]) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
      }
    }
    const S = SEA_STATES[front] || SEA_STATES.MARIANAS;
    this.state = S;
    this.uTime = uniform(0);
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

    const shoreUV = (wp) => vec2(
      wp.x.div(this.terrainSize).add(0.5),
      float(0.5).sub(wp.z.div(this.terrainSize))
    );
    const shoreDist = (wp) => texture(shore.tex, shoreUV(wp)).r.mul(shore.maxDist);

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

    const gerstner = (wp) => {
      let dispX = float(0), dispY = float(0), dispZ = float(0);
      let nx = float(0), nz = float(0), nyAcc = float(0);
      for (const { w, A, phi, dx, dz, Q } of waves) {
        const theta = wp.x.mul(dx * w).add(wp.z.mul(dz * w)).add(this.uTime.mul(phi));
        const s = sin(theta), c = cos(theta);
        dispX = dispX.add(c.mul(Q * A * dx));
        dispZ = dispZ.add(c.mul(Q * A * dz));
        dispY = dispY.add(s.mul(A));
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

    // PASS-2 item 5 (golden-hour sea doesn't mirror the sky): the IBL path
    // CAN'T carry the warm horizon — the PMREM lobe at roughness 0.2-0.3
    // averages the whole (blue) upper sky, so the few-degree orange band
    // vanishes and grazing water measured B−R −5 under a −45 sky. Cheap
    // analytic fix: march the SAME hillaire aerial inscatter along the
    // flat-mirror reflected ray to ~80km and add it as a grazing Fresnel
    // term. Sun-azimuth weighting, warm grading and the cool noon case all
    // fall out of the physics for free; grazeW keeps it a horizon-band
    // effect so steep-angle water (reef turquoise) is untouched.
    // These node objects are built ONCE and referenced by emissive, normal
    // and roughness slots — one march per material, and it doubles as the
    // glitter luminance floor (item 4: dark water carries no sparkle).
    let skyRefl = null, mirror = null, glintGate = float(1.0);
    if (aerial) {
      const V = normalize(positionWorld.sub(cameraPosition));
      const cosV = clamp(V.y.negate(), 0.0, 1.0);
      // reflected elevation is skewed toward the horizon (0.22x): the GGX
      // grazing lobe on rough water hugs the surface, so the mirror reads
      // the low warm band, not the mauve sky a flat mirror would return
      const R = normalize(vec3(V.x, max(cosV.mul(0.22), 0.012), V.z));
      skyRefl = aerial.ins(cameraPosition.add(R.mul(80000.0))).mul(aerial.uSunI);
      const fres = pow(float(1.0).sub(cosV), 5.0).mul(0.98).add(0.02);
      const grazeW = smoothstep(0.30, 0.10, cosV);
      // 1.15: the single-bounce march undersells the warm band a touch (no
      // multiple scattering) — measured against the valdez-214 B−R gate
      mirror = skyRefl.mul(fres).mul(grazeW).mul(1.15);
      glintGate = smoothstep(0.015, 0.10, luminance(skyRefl));
    }

    mat.positionNode = Fn(() => {
      const wp = modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz;
      const edgeFade = smoothstep(15800.0, 9000.0, positionLocal.xz.length());
      const damp = smoothstep(0.0, 120.0, shoreDist(wp)).mul(edgeFade);
      if (fft) {
        const d = texture(fft.dispTex, fftUV(wp)).xyz;
        return vec3(
          positionLocal.x.add(d.x.mul(damp)),
          d.y.mul(damp),
          positionLocal.z.add(d.z.mul(damp))
        );
      }
      const g = gerstner(wp);
      return vec3(
        positionLocal.x.add(g.dispX.mul(damp)),
        g.dispY.mul(damp),
        positionLocal.z.add(g.dispZ.mul(damp))
      );
    })();

    mat.normalNode = Fn(() => {
      const wp = positionWorld;
      const edgeFadeN = smoothstep(15800.0, 9000.0, positionLocal.xz.length());
      const damp = smoothstep(0.0, 120.0, shoreDist(wp)).mul(S.normalK).mul(edgeFadeN);
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
        // lerp toward flat by the same damp field (shore + rim)
        return normalize(mix(vec3(0, 1, 0), vec3(nx, 1.0, nz), clamp(damp, 0.0, 1.0)));
      }
      const g = gerstner(wp);
      return normalize(vec3(g.nx.negate().mul(damp), float(1.0).sub(g.nyAcc.mul(damp).mul(0.8)), g.nz.negate().mul(damp)));
    })();
    if (fft) {
      // GGX companion: as micro-normal energy rises the surface must sparkle,
      // not mirror-flash — nudge roughness up with the same gust/damp fields.
      // Toksvig/LEAN trade: every slope-variance unit the footprint filters
      // removed from the normal (FFT texels via fftFade, plus the retired
      // MICRO_VAR budget) returns as roughness in α² space, so far water
      // stays wind-rough instead of collapsing to a mirror — and the glint
      // NDF above re-carries a share of it as discrete facets.
      mat.roughnessNode = Fn(() => {
        const wp = positionWorld;
        const fp = footprint(wp);
        const edgeFadeR = smoothstep(15800.0, 9000.0, positionLocal.xz.length());
        const microDamp = smoothstep(0.0, 120.0, shoreDist(wp)).mul(edgeFadeR);
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
      const wp = positionWorld;
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
      const crest = fft
        ? slopeFoam(wp).foam.mul(smoothstep(10.0, 2.5, footprint(wp))).mul(0.75)
        : smoothstep(0.55, 0.95, gerstner(wp).nyAcc).mul(0.6);
      c = mix(c, vec3(0.92, 0.95, 0.96), clamp(shoreFoam.add(crest), 0.0, 0.85).mul(edgeFadeC));
      if (aerial) c = c.mul(aerial.trans(wp)); // MAXFI A3 (see terrain.js note)
      return c;
    })();
    // emissive carries the aerial inscatter + the item-5 warm-horizon mirror
    if (aerial) mat.emissiveNode = Fn(() => aerial.ins(positionWorld).mul(aerial.uSunI).add(mirror))();

    // near animated sheet + flat far skirt to the horizon
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(NEAR_SPAN, NEAR_SPAN, NEAR_VERTS - 1, NEAR_VERTS - 1).rotateX(-Math.PI / 2),
      mat
    );
    this.mesh.frustumCulled = false;
    let farMat;
    if (aerial) {
      // the skirt must wear the same air as the sheet or they seam at the rim
      // — and the same item-5 mirror: the horizon band that must warm-mirror
      // the sky at golden hour IS mostly this skirt
      farMat = new THREE.MeshStandardNodeMaterial({ roughness: S.roughness + 0.04, metalness: 0 });
      farMat.colorNode = Fn(() => vec3(deepC.r, deepC.g, deepC.b).mul(aerial.trans(positionWorld)))();
      farMat.emissiveNode = Fn(() => aerial.ins(positionWorld).mul(aerial.uSunI).add(mirror))();
    } else {
      farMat = new THREE.MeshStandardMaterial({ color: S.deep, roughness: S.roughness + 0.04, metalness: 0 });
    }
    // PASS-1 item 6a: the full-span skirt plane z-fought the sheet at range
    // (metres of Y separation vanish in far-field depth precision) — the
    // skirt won in patches and stamped a hard-edged flat rectangle into the
    // textured water (the measured x≈483 seam). A ring whose hole matches
    // the sheet's flat rim never overlaps live waves; past 15.8km both
    // surfaces are flat and same-colored, so the residual overlap is moot.
    this.far = new THREE.Mesh(
      new THREE.RingGeometry(15800, FAR_SPAN / 2, 48, 1).rotateX(-Math.PI / 2),
      farMat
    );
    this.far.position.y = -0.4; // tucked under the flattened sheet rim
    this.far.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.far);
  }

  // follow the camera in whole-quad snaps so the grid never swims
  update(camera, timeSec) {
    this.uTime.value = timeSec;
    if (this.fft) this.fft.update(timeSec); // per-frame compute dispatch
    const quad = NEAR_SPAN / (NEAR_VERTS - 1);
    this.mesh.position.x = Math.round(camera.position.x / quad) * quad;
    this.mesh.position.z = Math.round(camera.position.z / quad) * quad;
    this.far.position.x = camera.position.x;
    this.far.position.z = camera.position.z;
  }
}
