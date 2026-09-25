// Observer-only cache for visible-sky scattering. Discs, cirrus and airglow
// remain in sky-radiance.js. Surface lighting and probe integrations stay direct.
import * as THREE from 'three';
import { Fn, If, uniform, uv, vec2, vec3, vec4, float, normalize, dot, sin, cos,
  asin, atan, sqrt, abs, clamp, select, texture, mix, smoothstep } from 'three/tsl';
import { observerSkyNode } from './hillaire.js';
const R = 6360, DIRECT_HORIZON_BAND = .02, HORIZON_BLEND_END = .03;

export class ObserverSkyViewCache {
  constructor({ renderer, luts, sourceUniforms, uFrameOrigin, width = 1024, height = 512 }) {
    if (![512, 1024].includes(width) || height !== width / 2) throw Error('Unsupported observer-sky cache dimensions');
    this.renderer = renderer; this.sources = sourceUniforms; this.origin = uFrameOrigin; this.luts = luts;
    this.width = width; this.height = height; this.lastKey = null; this.disposed = false;
    this.bufferSize = new THREE.Vector2();
    this.stats = { width, height, bytes: width * height * 8, updates: 0, reused: 0, ready: false, failed: false, cpuMs: 0 };
    this.uObserver = uniform(new THREE.Vector3());
    this.uUp = uniform(new THREE.Vector3(0, 1, 0));
    this.uEast = uniform(new THREE.Vector3(1, 0, 0));
    this.uNorth = uniform(new THREE.Vector3(0, 0, 1));
    this.uHorizon = uniform(0); this.uReady = uniform(false);
    this.target = new THREE.RenderTarget(width, height, { type: THREE.HalfFloatType,
      format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.target.texture.name = 'observer-sky-scattering';
    this.target.texture.wrapS = THREE.RepeatWrapping; this.target.texture.wrapT = THREE.ClampToEdgeWrapping;
    const U = sourceUniforms;
    const march = observerSkyNode({ tTex: luts.tTex, msTex: luts.msTex, uSunDir: U.uSunDir,
      uFrameOrigin, uMoonDir: U.uMoonDir, uMoonRatio: U.uMoonRatio, uMoonColor: U.uMoonColor });
    const rows = height / 2;
    this.material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    this.material.name = 'observer-sky-scattering-bake';
    this.material.fragmentNode = Fn(() => {
      const pixelY = uv().y.mul(height).sub(.5);
      const above = pixelY.greaterThanEqual(rows);
      const q = select(above, pixelY.sub(rows).div(rows - 1), float(1).sub(pixelY.div(rows - 1)));
      const angle = select(above, this.uHorizon.add(float(Math.PI / 2).sub(this.uHorizon).mul(q.pow(2))),
        this.uHorizon.sub(float(Math.PI / 2).add(this.uHorizon).mul(q.pow(2))));
      const azimuth = uv().x.sub(.5).mul(Math.PI * 2);
      const direction = this.uEast.mul(sin(azimuth).mul(cos(angle)))
        .add(this.uUp.mul(sin(angle))).add(this.uNorth.mul(cos(azimuth).mul(cos(angle))));
      // Store scene-linear pre-exposed values: unscaled lunar scattering is
      // often smaller than half-float's minimum. The key includes this gain.
      return vec4(march(this.uObserver, direction).mul(U.uSunI), 1);
    })();
    this.quad = new THREE.QuadMesh(this.material);
    this.radiance = Fn(([observer, viewDirection]) => {
      const direction = normalize(viewDirection).toVar();
      const elevation = asin(clamp(dot(direction, this.uUp), -1, 1)).toVar();
      const exact = vec3(0).toVar(), cached = vec3(0).toVar();
      const distance = abs(elevation.sub(this.uHorizon)).toVar();
      // The original march handles a narrow geometric-horizon band exactly.
      // It contains the sharp planet-intersection/earth-shadow transitions.
      If(this.uReady.not().or(distance.lessThan(HORIZON_BLEND_END)), () => {
        exact.assign(march(observer, direction).mul(U.uSunI));
      });
      If(this.uReady.and(distance.greaterThan(DIRECT_HORIZON_BAND)), () => {
        const above = elevation.greaterThanEqual(this.uHorizon);
        const fraction = select(above, elevation.sub(this.uHorizon).div(float(Math.PI / 2).sub(this.uHorizon)),
          this.uHorizon.sub(elevation).div(float(Math.PI / 2).add(this.uHorizon)));
        const q = sqrt(clamp(fraction, 0, 1));
        const y = select(above, q.mul(rows - 1).add(rows), float(1).sub(q).mul(rows - 1));
        const x = atan(dot(direction, this.uEast), dot(direction, this.uNorth)).div(Math.PI * 2).add(.5);
        cached.assign(texture(this.target.texture, vec2(x, y.add(.5).div(height))).level(0).rgb);
      });
      // A smooth overlap prevents a visible seam at the direct/cache boundary.
      return select(this.uReady, mix(exact, cached, smoothstep(DIRECT_HORIZON_BAND, HORIZON_BLEND_END, distance)), exact);
    });
  }

  update(observer) {
    if (this.disposed || this.stats.failed) return false;
    // A fresh cache must save enough full-resolution marches to pay for its
    // own bake. Small windows and reduced render scales use the direct sky.
    this.renderer.getDrawingBufferSize(this.bufferSize);
    if (this.bufferSize.x * this.bufferSize.y < this.width * this.height * 2) {
      this.lastKey = null; this.uReady.value = false; this.stats.ready = false;
      return false;
    }
    const U = this.sources, origin = this.origin.value;
    const p = new THREE.Vector3(observer.x - origin.x, observer.y + R * 1000, observer.z - origin.z);
    const values = [p.x, p.y, p.z, ...U.uSunDir.value.toArray(), ...(U.uMoonDir?.value.toArray() || [0, -1, 0]),
      U.uMoonRatio?.value || 0, ...(U.uMoonColor?.value.toArray() || [1, 1, 1]), U.uSunI.value,
      this.luts.tTex.version, this.luts.msTex.version];
    if (!values.every(Number.isFinite)) { this.lastKey = null; this.uReady.value = false; this.stats.ready = false; return false; }
    if (this.lastKey && values.every((value, index) => Object.is(value, this.lastKey[index]))) { this.stats.reused++; return false; }
    const radius = Math.max(p.length() / 1000, R + .001);
    this.uObserver.value.copy(observer); this.uUp.value.copy(p).normalize();
    this.uEast.value.set(1, 0, 0).addScaledVector(this.uUp.value, -this.uUp.value.x).normalize();
    this.uNorth.value.crossVectors(this.uEast.value, this.uUp.value).normalize();
    this.uHorizon.value = -Math.acos(R / radius);
    const renderer = this.renderer, old = { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(),
      mip: renderer.getActiveMipmapLevel(), mrt: renderer.getMRT(), toneMapping: renderer.toneMapping,
      autoClear: renderer.autoClear, xr: renderer.xr?.enabled };
    const start = performance.now();
    try {
      renderer.setMRT(null); renderer.toneMapping = THREE.NoToneMapping; renderer.autoClear = true;
      if (renderer.xr) renderer.xr.enabled = false;
      renderer.setRenderTarget(this.target); this.quad.render(renderer);
      this.lastKey = values; this.uReady.value = true; this.stats.ready = true; this.stats.updates++;
      return true;
    } catch (error) {
      this.uReady.value = false; this.stats.ready = false; this.stats.failed = true;
      this.stats.error = String(error?.message || error);
      console.warn('Observer sky cache unavailable; direct atmosphere remains:', this.stats.error);
      return false;
    } finally {
      this.stats.cpuMs = performance.now() - start;
      renderer.setRenderTarget(old.target, old.face, old.mip); renderer.setMRT(old.mrt);
      renderer.toneMapping = old.toneMapping; renderer.autoClear = old.autoClear;
      if (renderer.xr) renderer.xr.enabled = old.xr;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.uReady.value = false; this.stats.ready = false;
    this.target.dispose(); this.material.dispose();
  }
}
