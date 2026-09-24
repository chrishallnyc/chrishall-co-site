// A small, independent FFT for the missing sub-meter slope band. It never
// rewrites macro displacement or modes; filtering transfers unresolved fine
// variance back into the existing microfacet budget.
import * as THREE from "three";
import { Fn, uniform, textureLoad, textureStore, instanceIndex, float, int, uint, ivec2, vec2, vec4, sin, cos, sqrt, select } from "three/tsl";
import { buildFineSpectrum } from "./oceanfinespectrum.js";

export function createFineOcean(renderer, options) {
  if (!renderer?.backend?.isWebGPUBackend || typeof renderer.compute !== "function" ||
      typeof renderer.backend.generateMipmaps !== "function") return null;
  const resources = [], nodes = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const node of nodes) node.dispose?.();
    for (const texture of resources) texture.dispose();
  };
  try {
    const spectrum = buildFineSpectrum(options.front, options);
    const { N, tileM, data } = spectrum, half = N / 2, dk = 2 * Math.PI / tileM;
    const stages = Math.log2(N);
    const h0 = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
    h0.needsUpdate = true;resources.push(h0);
    const storage = type => {
      const t = new THREE.StorageTexture(N, N);t.type = type;t.flipY = false;
      t.minFilter = t.magFilter = THREE.NearestFilter;resources.push(t);return t;
    };
    const ping = storage(THREE.FloatType), pong = storage(THREE.FloatType);
    const slopeMomentTex = storage(THREE.HalfFloatType);
    slopeMomentTex.wrapS = slopeMomentTex.wrapT = THREE.RepeatWrapping;
    slopeMomentTex.magFilter = THREE.LinearFilter;
    slopeMomentTex.minFilter = THREE.LinearMipmapLinearFilter;
    slopeMomentTex.generateMipmaps = true;
    slopeMomentTex.mipmapsAutoUpdate = false;
    slopeMomentTex.anisotropy = 8;
    const uTime = uniform(0);
    const coords = () => {
      const x = instanceIndex.mod(uint(N)).toVar(), z = instanceIndex.div(uint(N)).toVar();
      return { x, z, coord: ivec2(int(x), int(z)) };
    };
    const evolve = Fn(() => {
      const {x,z,coord} = coords();
      const mx = select(x.lessThan(uint(half)), int(x), int(x).sub(N));
      const mz = select(z.lessThan(uint(half)), int(z), int(z).sub(N));
      const kx = float(mx).mul(dk), kz = float(mz).mul(dk), k = sqrt(kx.mul(kx).add(kz.mul(kz)));
      // Deep water gravity-capillary dispersion; gamma/rho≈7.22e-5 m³/s².
      const phase = sqrt(k.mul(9.81).add(k.mul(k).mul(k).mul(.0000722))).mul(uTime);
      const c = cos(phase), s = sin(phase), h = textureLoad(h0, coord);
      const hr = h.x.mul(c).sub(h.y.mul(s)).add(h.z.mul(c)).add(h.w.mul(s));
      const hi = h.x.mul(s).add(h.y.mul(c)).sub(h.z.mul(s)).add(h.w.mul(c));
      // Pack the TWO real normal slopes in one complex inverse FFT:
      // (-i*kx*H) + i*(-i*kz*H). BA retain height for diagnosis only.
      textureStore(ping, coord, vec4(kx.mul(hi).add(kz.mul(hr)), kz.mul(hi).sub(kx.mul(hr)), hr, hi));
    })().compute(N * N);
    nodes.push(evolve);
    // Parameters are captured per function call, never mutable loop state:
    // TSL Fn callbacks execute later when a renderer builds the graph.
    const butterfly = (src, dst, p, horizontal) => Fn(() => {
      const {x,z,coord} = coords(), j = horizontal ? x : z;
      const q = j.div(uint(2 * p)), r = j.mod(uint(2 * p)), k = r.mod(uint(p));
      const t = q.mul(uint(p)).add(k), t2 = t.add(uint(half));
      const a = textureLoad(src, horizontal ? ivec2(int(t), int(z)) : ivec2(int(x), int(t)));
      const b = textureLoad(src, horizontal ? ivec2(int(t2), int(z)) : ivec2(int(x), int(t2)));
      const phase = float(k).mul(Math.PI / p), c = cos(phase), s = sin(phase);
      const re = b.xz.mul(c).sub(b.yw.mul(s)), im = b.xz.mul(s).add(b.yw.mul(c));
      const sign = select(r.lessThan(uint(p)), float(1), float(-1));
      const xr = a.xz.add(re.mul(sign)), xi = a.yw.add(im.mul(sign));
      textureStore(dst, coord, vec4(xr.x, xi.x, xr.y, xi.y));
    })().compute(N * N);
    let current = ping, next = pong;
    for (const horizontal of [true, false]) {
      for (let stage = 0; stage < stages; stage++) {
        nodes.push(butterfly(current, next, 1 << stage, horizontal));
        const swap = current;current = next;next = swap;
      }
    }
    const completed = current;
    nodes.push(Fn(() => {
      const {coord} = coords(), slopes = textureLoad(completed, coord).xy;
      textureStore(slopeMomentTex, coord, vec4(slopes, slopes.dot(slopes), 0));
    })().compute(N * N));
    const update = time => {
      if (disposed) return;
      uTime.value = time;
      renderer.compute(nodes);
      renderer.backend.generateMipmaps(slopeMomentTex);
    };
    return { slopeMomentTex, N, tileM, update, dispose,
      totalVariance: spectrum.totalVariance, resolvedVariance: spectrum.resolvedVariance,
      tailVariance: spectrum.tailVariance, heightRMS: spectrum.heightRMS,
      minimumWavelengthM: 2 * Math.PI / spectrum.maxPresentK,
      maximumWavelengthM: 2 * Math.PI / spectrum.minK };
  } catch (error) {
    dispose();
    throw error; // Owner can keep macro-only waves and report this failure.
  }
}
