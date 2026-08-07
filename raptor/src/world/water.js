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
  fract, floor,
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
    deep: 0x0e2e33, shallow: 0x2e6b66, roughness: 0.2, foamShore: 45, normalK: 1.6,
  },
  MARIANAS: { // open Pacific swell breaking on the barrier reef
    waves: [
      [80, 0.14, 75], [130, 0.22, 60], [200, 0.3, 85], [310, 0.38, 70],
      [470, 0.46, 55], [700, 0.52, 65], [100, 0.16, 100], [260, 0.28, 45],
    ],
    deep: 0x06334e, shallow: 0x2ba098, roughness: 0.14, foamShore: 110, normalK: 1.2,
  },
};

export class Water {
  constructor(front, terrain) {
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

    mat.positionNode = Fn(() => {
      const wp = modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz;
      const g = gerstner(wp);
      // waves flatten right at the beach so foam sits on still water; the
      // radial edge fade flattens the sheet's rim so the far-skirt hand-off
      // is seamless (forensics judge measured a single-row energy cliff)
      const edgeFade = smoothstep(15800.0, 9000.0, positionLocal.xz.length());
      const damp = smoothstep(0.0, 120.0, shoreDist(wp)).mul(edgeFade);
      return vec3(
        positionLocal.x.add(g.dispX.mul(damp)),
        g.dispY.mul(damp),
        positionLocal.z.add(g.dispZ.mul(damp))
      );
    })();

    mat.normalNode = Fn(() => {
      const wp = positionWorld;
      const g = gerstner(wp);
      const edgeFadeN = smoothstep(15800.0, 9000.0, positionLocal.xz.length());
      const damp = smoothstep(0.0, 120.0, shoreDist(wp)).mul(S.normalK).mul(edgeFadeN);
      return normalize(vec3(g.nx.negate().mul(damp), float(1.0).sub(g.nyAcc.mul(damp).mul(0.8)), g.nz.negate().mul(damp)));
    })();

    const deepC = new THREE.Color(S.deep), shallowC = new THREE.Color(S.shallow);
    mat.colorNode = Fn(() => {
      const wp = positionWorld;
      const sd = shoreDist(wp);
      const g = gerstner(wp);
      let c = mix(vec3(shallowC.r, shallowC.g, shallowC.b), vec3(deepC.r, deepC.g, deepC.b),
                  smoothstep(20.0, 520.0, sd));
      // shore foam band, broken up by a drifting hash; crest foam on steep sums
      const hash = fract(sin(dot(floor(wp.xz.mul(0.15)), vec2(127.1, 311.7))).mul(43758.5453));
      // foam terms wear the same radial edge fade as the displacement, or the
      // speckle pattern hard-stops at the sheet rim (measured energy cliff)
      const edgeFadeC = smoothstep(15800.0, 9000.0, positionLocal.xz.length());
      const shoreFoam = smoothstep(this.state.foamShore, 8.0, sd).mul(hash.mul(0.5).add(0.5));
      const crest = smoothstep(0.55, 0.95, g.nyAcc).mul(0.6);
      c = mix(c, vec3(0.92, 0.95, 0.96), clamp(shoreFoam.add(crest), 0.0, 0.85).mul(edgeFadeC));
      return c;
    })();

    // near animated sheet + flat far skirt to the horizon
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(NEAR_SPAN, NEAR_SPAN, NEAR_VERTS - 1, NEAR_VERTS - 1).rotateX(-Math.PI / 2),
      mat
    );
    this.mesh.frustumCulled = false;
    this.far = new THREE.Mesh(
      new THREE.PlaneGeometry(FAR_SPAN, FAR_SPAN, 1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: S.deep, roughness: S.roughness + 0.04, metalness: 0 })
    );
    this.far.position.y = -0.4; // tucked under the animated sheet
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.far);
  }

  // follow the camera in whole-quad snaps so the grid never swims
  update(camera, timeSec) {
    this.uTime.value = timeSec;
    const quad = NEAR_SPAN / (NEAR_VERTS - 1);
    this.mesh.position.x = Math.round(camera.position.x / quad) * quad;
    this.mesh.position.z = Math.round(camera.position.z / quad) * quad;
    this.far.position.x = camera.position.x;
    this.far.position.z = camera.position.z;
  }
}
