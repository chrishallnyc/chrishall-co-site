// Water v1 — Gerstner-sum ocean in TSL (one material, both backends).
// A camera-following snapped grid carries 8 summed Gerstner waves displaced
// in the vertex shader with ANALYTIC normals; a flat far skirt reaches the
// horizon. Standard-material shading means the sun light gives GGX glitter
// and the sky IBL gives reflections for free. Depth is proxied by the
// terrain's shore-distance field (bathymetry was clamped in the bake):
// turquoise shallows + a foam band hug the coast; crest foam breaks on the
// steepest wave sums. Render-side clock only — the sim never reads water.

import * as THREE from "three";
import {
  Fn, uniform, texture, vec2, vec3, float, positionLocal, positionWorld,
  modelWorldMatrix, vec4, normalize, clamp, smoothstep, mix, sin, cos, dot,
  fract, floor, cameraPosition,
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
    deep: 0x0e2e33, shallow: 0x2e6b66, roughness: 0.2, foamShore: 130, normalK: 1.6, micro: 0.9,
  },
  MARIANAS: { // open Pacific swell breaking on the barrier reef
    waves: [
      [80, 0.14, 75], [130, 0.22, 60], [200, 0.3, 85], [310, 0.38, 70],
      [470, 0.46, 55], [700, 0.52, 65], [100, 0.16, 100], [260, 0.28, 45],
    ],
    deep: 0x06334e, shallow: 0x2ba098, roughness: 0.14, foamShore: 170, normalK: 1.2, micro: 1.0,
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

    // PASS-1 item 6b: micro-normal detail — the 256²/320m FFT low-passes away
    // the cm-scale facets that make real glints (measured HF max 2/255 at
    // noon). Two octaves of animated directional chop (~9-14m and ~2.4-3.6m),
    // gated by a drifting gust field so the glitter comes in patches, each
    // octave faded out before its wavelength goes sub-pixel (moiré guard).
    const MICRO = [
      // [wavelengthM, dirDeg, phaseSpeed, slopeAmp]
      [13.1, 21, 1.9, 0.075], [9.3, 63, 1.6, 0.065], [11.2, -34, 1.7, 0.06],
      [3.5, 9, 0.95, 0.06], [2.4, 52, 0.8, 0.05], [3.1, -68, 0.85, 0.045],
    ];
    const microSlope = (wp, camDist) => {
      const fadeA = smoothstep(9500.0, 2500.0, camDist);  // 9-14m octave
      const fadeB = smoothstep(2600.0, 500.0, camDist);   // 2-4m octave
      let gx = float(0), gz = float(0);
      for (const [L, degDir, spd, amp] of MICRO) {
        const k = (2 * Math.PI) / L;
        const rad = (degDir * Math.PI) / 180;
        const dx = Math.sin(rad), dz = Math.cos(rad);
        const theta = wp.x.mul(dx * k).add(wp.z.mul(dz * k)).add(this.uTime.mul(spd * k));
        const g = cos(theta).mul(amp).mul(L > 5 ? fadeA : fadeB);
        gx = gx.add(g.mul(dx));
        gz = gz.add(g.mul(dz));
      }
      // gust patches: real glitter arrives in cat's-paw fields, not uniformly
      const gust = vnoise(wp.xz.div(210.0).add(vec2(this.uTime.mul(0.011), this.uTime.mul(-0.007))));
      const gustK = smoothstep(0.25, 0.8, gust).mul(0.85).add(0.15).mul(S.micro ?? 1.0);
      return { gx: gx.mul(gustK), gz: gz.mul(gustK), gustK };
    };

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
        const n = texture(fft.normTex, fftUV(wp)).xyz;
        // filtered-NDF LOD: normTex has no mips (per-frame storage), so at
        // distance its 1.25m texels alias into confetti — flatten the wave
        // normal as texels go sub-pixel and hand the lost variance to the
        // roughness companion below (Toksvig-style trade)
        const camDist = wp.sub(cameraPosition).length();
        const fftFade = smoothstep(11000.0, 2500.0, camDist);
        // micro chop rides on the FFT normal, wearing the same shore/rim damp
        const microDamp = smoothstep(0.0, 120.0, shoreDist(wp)).mul(edgeFadeN);
        const m = microSlope(wp, camDist);
        const nd = n.add(vec3(m.gx.negate(), 0.0, m.gz.negate()).mul(microDamp));
        // lerp toward flat by the same damp field (shore + rim)
        return normalize(mix(vec3(0, 1, 0), nd, clamp(damp.mul(fftFade), 0.0, 1.0)));
      }
      const g = gerstner(wp);
      return normalize(vec3(g.nx.negate().mul(damp), float(1.0).sub(g.nyAcc.mul(damp).mul(0.8)), g.nz.negate().mul(damp)));
    })();
    if (fft) {
      // GGX companion: as micro-normal energy rises the surface must sparkle,
      // not mirror-flash — nudge roughness up with the same gust/damp fields.
      // And where the filtered-NDF LOD flattens the FFT normal, its variance
      // returns as roughness so far water stays wind-rough, not mirror-flat.
      mat.roughnessNode = Fn(() => {
        const wp = positionWorld;
        const camDist = wp.sub(cameraPosition).length();
        const edgeFadeR = smoothstep(15800.0, 9000.0, positionLocal.xz.length());
        const microDamp = smoothstep(0.0, 120.0, shoreDist(wp)).mul(edgeFadeR);
        const m = microSlope(wp, camDist);
        const lodVar = smoothstep(2500.0, 11000.0, camDist).mul(0.06);
        return float(S.roughness).add(m.gustK.mul(microDamp).mul(0.05)).add(lodVar);
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
      // crest foam: FFT mode uses the compute-side Jacobian accumulation
      // (mip-less — fade with the same filtered-NDF distance as the normals)
      const crest = fft
        ? texture(fft.normTex, fftUV(wp)).a.mul(smoothstep(11000.0, 2500.0, camDist)).mul(0.75)
        : smoothstep(0.55, 0.95, gerstner(wp).nyAcc).mul(0.6);
      c = mix(c, vec3(0.92, 0.95, 0.96), clamp(shoreFoam.add(crest), 0.0, 0.85).mul(edgeFadeC));
      if (aerial) c = c.mul(aerial.trans(wp)); // MAXFI A3 (see terrain.js note)
      return c;
    })();
    if (aerial) mat.emissiveNode = Fn(() => aerial.ins(positionWorld).mul(aerial.uSunI))();

    // near animated sheet + flat far skirt to the horizon
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(NEAR_SPAN, NEAR_SPAN, NEAR_VERTS - 1, NEAR_VERTS - 1).rotateX(-Math.PI / 2),
      mat
    );
    this.mesh.frustumCulled = false;
    let farMat;
    if (aerial) {
      // the skirt must wear the same air as the sheet or they seam at the rim
      farMat = new THREE.MeshStandardNodeMaterial({ roughness: S.roughness + 0.04, metalness: 0 });
      farMat.colorNode = Fn(() => vec3(deepC.r, deepC.g, deepC.b).mul(aerial.trans(positionWorld)))();
      farMat.emissiveNode = Fn(() => aerial.ins(positionWorld).mul(aerial.uSunI))();
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
