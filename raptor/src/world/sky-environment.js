// Bounded, coherent environment capture. One face is rendered per update,
// then a complete cube is convolved/published for its owning receiver.
import * as THREE from "three";
import { uniform, normalize, positionWorld, cameraPosition, texture, vec4 } from "three/tsl";
import { makeSkyRadiance } from "./sky-radiance.js";
import { makeSurfaceEnvironment } from "./surface-environment.js";

const copyValue = value => value && typeof value.clone === "function" ? value.clone() : value;
const assignValue = (node, value) => {
  if (node.value && typeof node.value.copy === "function") node.value.copy(value);
  else node.value = value;
};

export class SkyEnvironment {
  constructor({ renderer, luts, sourceUniforms, cirrusAtlas = null,
    publish, rescale, observer = null, radiance = null, label = "Sky",
    makeCloudNode = null, size = 128, minInterval = 4, moveThreshold = 500,
    sunThresholdDegrees = .25 }) {
    if (![32, 64, 128, 256].includes(size)) throw new Error("Environment size must be a power of two from 32 to 256.");
    this.renderer = renderer; this.liveSources = sourceUniforms;
    this.publish = publish; this.rescale = rescale; this.observer = observer; this.label = label; this.minInterval = minInterval; this.moveThreshold = moveThreshold;
    this.angleCos = Math.cos(sunThresholdDegrees * Math.PI / 180);
    this.sources = Object.fromEntries(Object.entries(sourceUniforms).filter(([, v]) => v)
      .map(([key, node]) => [key, uniform(copyValue(node.value))]));
    this.uFrameOrigin = uniform(new THREE.Vector3());
    this.uObserver = uniform(new THREE.Vector3(0, 1, 0));
    this.uTime = uniform(0);
    this.size = size; this.front = -1; this.back = 0; this.face = -1;
    this.completedTime = -Infinity; this.startedTime = -Infinity;
    this.completedOrigin = new THREE.Vector3(Infinity, 0, Infinity);
    this.completedSun = new THREE.Vector3(0, 1, 0);
    this.completedMoon = new THREE.Vector3(0, -1, 0);
    this.completedMoonRatio = 0;
    this.publishedIrradiance = sourceUniforms.uSunI.value;
    this.forceDirty = true;
    this.stats = { capturesStarted: 0, facesRendered: 0, publications: 0,
      convolutionCalls: 0, lastReason: "initial", lastFaceCpuMs: 0,
      lastConvolutionCpuMs: 0, pendingFace: -1, rescaleOnlyFrames: 0 };
    this._pmrem = new THREE.PMREMGenerator(renderer);
    this.cubes = [0, 1].map(() => new THREE.CubeRenderTarget(size, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    }));
    this.pmrems = [null, null];
    this.cubeCamera = new THREE.CubeCamera(.1, 200000, this.cubes[0]);
    this.camera = new THREE.PerspectiveCamera(90, 1, .1, 200000);
    this.skyTarget = new THREE.RenderTarget(size, size, {
      type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: false, generateMipmaps: false,
    });
    const source = makeSkyRadiance({ luts, sourceUniforms: this.sources,
      uFrameOrigin: this.uFrameOrigin, uTime: this.uTime, cirrusAtlas,
      includeSolarDisc: false });
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide,
      fog: false, depthTest: false, depthWrite: false, toneMapped: false });
    const direction = normalize(positionWorld.sub(cameraPosition));
    material.colorNode = radiance ? radiance({ sky: source, direction, sources: this.sources,
      observer: this.uObserver, origin: this.uFrameOrigin }) : source(this.uObserver, direction);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 16, 8), material);
    this.sky.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.sky);
    this.cloudQuad = null;
    if (makeCloudNode) {
      const material = new THREE.MeshBasicNodeMaterial({ fog: false,
        depthTest: false, depthWrite: false, toneMapped: false });
      material.fragmentNode = makeCloudNode({
        beauty: { sample: uv => texture(this.skyTarget.texture, uv) },
        depth: { sample: () => vec4(renderer.reversedDepthBuffer ? 0 : 1) }, camera: this.camera,
        uCamPos: this.uObserver, uTime: this.uTime,
        sourceUniforms: this.sources, uFrameOrigin: this.uFrameOrigin,
      });
      this.cloudQuad = new THREE.QuadMesh(material);
    }
    this.dynamic = !!cirrusAtlas || !!makeCloudNode;
  }

  invalidate(reason = "explicit") { this.forceDirty = true; this.stats.lastReason = reason; }

  // Pure pre-exposure never invalidates a capture. The published HDR source
  // scales with the live gain while celestial/weather content stays cached.
  _rescale() {
    if (this.front < 0) return;
    this.rescale(this.liveSources.uSunI.value / Math.max(this.publishedIrradiance, 1e-12));
    this.stats.rescaleOnlyFrames++;
  }

  _reason(camera, now) {
    if (this.forceDirty) return this.stats.lastReason || "explicit";
    if (now - this.startedTime < this.minInterval) return null;
    const point = this.observer ? this.observer(camera) : camera.position;
    const dx = point.x - this.completedOrigin.x, dz = point.z - this.completedOrigin.z;
    const dy = this.observer ? point.y - this.completedOrigin.y : 0;
    if (dx * dx + dy * dy + dz * dz >= this.moveThreshold ** 2) return "translation";
    if (this.liveSources.uSunDir.value.dot(this.completedSun) < this.angleCos) return "sun-direction";
    if (this.liveSources.uMoonDir && this.liveSources.uMoonDir.value.dot(this.completedMoon) < this.angleCos) return "moon-direction";
    if (this.liveSources.uMoonRatio && Math.abs(this.liveSources.uMoonRatio.value - this.completedMoonRatio)
      > Math.max(this.completedMoonRatio * .02, 1e-8)) return "moon-phase";
    if (this.dynamic && now - this.startedTime >= this.minInterval) return "weather-time";
    return null;
  }

  _begin(camera, now, reason) {
    for (const [key, node] of Object.entries(this.sources)) assignValue(node, this.liveSources[key].value);
    this.uFrameOrigin.value.copy(camera.position);
    if (this.observer) this.uObserver.value.copy(this.observer(camera, true));
    else this.uObserver.value.set(camera.position.x, 1, camera.position.z);
    this.uTime.value = now;
    this.captureIrradiance = this.sources.uSunI.value;
    this.captureMoonRatio = this.sources.uMoonRatio?.value || 0;
    this.cubeCamera.position.copy(this.uObserver.value);
    if (this.cubeCamera.coordinateSystem !== this.renderer.coordinateSystem) {
      this.cubeCamera.coordinateSystem = this.renderer.coordinateSystem;
      this.cubeCamera.updateCoordinateSystem();
    }
    this.cubeCamera.updateMatrixWorld(true);
    this.sky.position.copy(this.uObserver.value); this.sky.updateMatrixWorld(true);
    this.startedTime = now; this.face = 0; this.forceDirty = false;
    this.stats.lastReason = reason; this.stats.capturesStarted++;
    this.stats.pendingFace = 0;
  }

  _renderFace() {
    const renderer = this.renderer;
    const old = { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(),
      mip: renderer.getActiveMipmapLevel(), mrt: renderer.getMRT(),
      toneMapping: renderer.toneMapping, xr: renderer.xr?.enabled,
      autoClear: renderer.autoClear };
    const start = performance.now();
    try {
      renderer.setMRT(null); renderer.toneMapping = THREE.NoToneMapping;
      renderer.autoClear = true; if (renderer.xr) renderer.xr.enabled = false;
      // Use one stable camera object so the existing cloud function's
      // onRenderUpdate closures see the current face's matrices.
      this.camera.copy(this.cubeCamera.children[this.face], false);
      this.camera.parent = null;
      this.camera.position.copy(this.uObserver.value);
      this.camera.updateMatrixWorld(true);
      if (this.cloudQuad) {
        renderer.setRenderTarget(this.skyTarget);
        renderer.render(this.scene, this.camera);
        renderer.setRenderTarget(this.cubes[this.back], this.face, 0);
        this.cloudQuad.render(renderer);
      } else {
        renderer.setRenderTarget(this.cubes[this.back], this.face, 0);
        renderer.render(this.scene, this.camera);
      }
      this.stats.facesRendered++;
      this.stats.lastFaceCpuMs = performance.now() - start;
      this.face++;
      this.stats.pendingFace = this.face;
    } finally {
      renderer.setRenderTarget(old.target, old.face, old.mip); renderer.setMRT(old.mrt);
      renderer.toneMapping = old.toneMapping; renderer.autoClear = old.autoClear;
      if (renderer.xr) renderer.xr.enabled = old.xr;
    }
  }

  _publish(now) {
    // This is the only PMREM regeneration call. A complete cube is already
    // frozen; the current published cube/PMREM is not modified while drawing.
    const start = performance.now();
    const renderer = this.renderer;
    const old = { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(),
      mip: renderer.getActiveMipmapLevel(), mrt: renderer.getMRT(), toneMapping: renderer.toneMapping,
      autoClear: renderer.autoClear, xr: renderer.xr?.enabled };
    let target;
    try {
      renderer.setMRT(null);
      target = this._pmrem.fromCubemap(this.cubes[this.back].texture, this.pmrems[this.back]);
    } finally {
      renderer.setRenderTarget(old.target, old.face, old.mip); renderer.setMRT(old.mrt);
      renderer.toneMapping = old.toneMapping; renderer.autoClear = old.autoClear;
      if (renderer.xr) renderer.xr.enabled = old.xr;
    }
    this.pmrems[this.back] = target;
    this.stats.convolutionCalls++;
    this.stats.lastConvolutionCpuMs = performance.now() - start;
    this.publish(target.texture, this.front < 0);
    this.front = this.back; this.back = 1 - this.back;
    this.publishedIrradiance = this.captureIrradiance;
    this.completedOrigin.copy(this.uObserver.value);
    this.completedSun.copy(this.sources.uSunDir.value);
    if (this.sources.uMoonDir) this.completedMoon.copy(this.sources.uMoonDir.value);
    this.completedMoonRatio = this.captureMoonRatio;
    this.completedTime = now; this.face = -1; this.stats.pendingFace = -1;
    this.stats.publications++; this._rescale();
  }

  // Initial complete capture belongs behind the existing loading veil.
  // Runtime updates consume one face per frame and a separate convolution frame.
  warmUp(camera, now = 0) {
    this._begin(camera, now, "initial");
    for (let i = 0; i < 6; i++) this._renderFace();
    this._publish(now);
  }

  update(camera, now) {
    this._rescale();
    if (this.failed) return;
    try {
      if (this.face === 6) { this._publish(now); return; }
      if (this.face < 0) {
        const reason = this._reason(camera, now);
        if (!reason) return;
        this._begin(camera, now, reason);
      }
      this._renderFace();
    } catch (error) {
      this.failed = true; this.stats.error = String(error?.message || error);
      console.warn(`${this.label} environment refresh stopped; retaining last complete map:`, this.stats.error);
    }
  }

  dispose() {
    this.cubes.forEach(rt => rt.dispose()); this.pmrems.forEach(rt => rt?.dispose());
    this.skyTarget.dispose(); this.sky.geometry.dispose(); this.sky.material.dispose();
    this.cloudQuad?.material.dispose(); this._pmrem.dispose();
  }
}

// Keep water's public contract and its existing sea-level reflection frame.
export class WaterSkyEnvironment extends SkyEnvironment {
  constructor({ water, intensity = .45, ...options }) {
    let environment;
    super({ ...options, label: 'Water sky',
      publish(texture, first) {
        const material = water.mesh.material;
        material.envMap = texture;
        if (first) {
          const radialUp = water.curvature ? wp => water.curvature.radialUpNode(wp) : null;
          environment = makeSurfaceEnvironment(texture, radialUp);
          material.envNode = environment.node;
          material.needsUpdate = true;
        } else environment.setTexture(texture);
      },
      rescale(gain) { water.mesh.material.envMapIntensity = intensity * gain; },
    });
    this.water = water;
  }
}
