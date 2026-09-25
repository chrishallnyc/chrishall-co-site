// Reduced-resolution cloud integration with full-resolution reconstruction.
// Keep opaque geometry, cloud edges, motion and temporal depth at output size.
import * as THREE from 'three';
import {
  Fn, If, uniform, texture, uv, vec2, vec3, vec4, float, struct, mrt,
  min, max, abs, floor, fract, clamp, select, length, getViewPosition, screenCoordinate,
} from 'three/tsl';
import { CloudPass } from './cloudpass.js';
import { volCloudsNode, cloudLayerBounds } from './volclouds.js';
import { cloudTemporalResult } from './cloudtemporal.js';
import { createCloudGeometry } from './cloudgeometry.js';
import { CloudLightCache } from './cloudlightcache.js';

const LayerResult = struct({ layer: 'vec4', geometry: 'vec4' });

// Output 0: aerial-adjusted, premultiplied cloud radiance + remapped opacity.
// Output 1 (RGBA32F): mean ray distance, opaque-scene view depth, last integrated
// view depth, and whether integration completed independently of scene depth.
const emitLayer = ({ radiance, alpha, meanDistance, sceneDistance, viewDepth,
  integrationEnd, sceneIndependent }) => LayerResult(
  vec4(radiance, alpha),
  vec4(meanDistance, viewDepth, integrationEnd.mul(viewDepth.div(sceneDistance)), sceneIndependent),
);

export class AdaptiveCloudPass extends CloudPass {
  static get type() { return 'AdaptiveCloudPass'; }

  constructor({ cloudScale = .67, repairAlphaRange = .05, repairDistanceRange = .2, stopTolerance = .5,
    debugRepair = false, ...options }) {
    super(options);
    this._disposed = false; this._lastFrameId = undefined;
    this._cloudScale = 1;
    this._nativeOnly = uniform(true);
    this._layerSize = uniform(new THREE.Vector2(1, 1));
    this._fullSize = uniform(new THREE.Vector2(1, 1));
    this._repairAlphaRange = uniform(repairAlphaRange);
    this._repairDistanceRange = uniform(repairDistanceRange);
    this._stopTolerance = uniform(stopTolerance);
    this._debugRepair = uniform(debugRepair);
    this._projectionInverse = uniform(new THREE.Matrix4());
    this._cameraWorld = uniform(new THREE.Matrix4());
    this._projectionInverse.onRenderUpdate(() => this._projectionInverse.value.copy(this.camera.projectionMatrixInverse));
    this._cameraWorld.onRenderUpdate(() => this._cameraWorld.value.copy(this.camera.matrixWorld));
    this.layerTarget = new THREE.RenderTarget(1, 1, {
      count: 2, type: THREE.HalfFloatType, depthBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.layerTarget.textures[0].name = 'layer';
    this.layerTarget.textures[1].name = 'geometry';
    // Distances can exceed half-float range. Float metadata also avoids a
    // quantized rejection boundary becoming visible during camera motion.
    this.layerTarget.textures[1].type = THREE.FloatType;
    this._layerMaterial = new THREE.NodeMaterial();
    this._layerMaterial.name = 'Cloud reduced-resolution integration';
    this._layerMaterial.depthTest = false;
    this._layerMaterial.depthWrite = false;
    this._layerMaterial.toneMapped = false;
    this._layerQuad = new THREE.QuadMesh(this._layerMaterial);
    this._material.name = 'Cloud full-resolution reconstruction and exact repair';
    this._material.toneMapped = false;
    this.setCloudScale(cloudScale);
    this.setRepairAlphaRange(repairAlphaRange);
    this.setRepairDistanceRange(repairDistanceRange);
    if (!Number.isFinite(stopTolerance) || stopTolerance < 0) throw new Error('stopTolerance must be nonnegative.');
  }

  get mode() { return 'adaptive'; }
  get cloudScale() { return this._cloudScale; }
  setCloudScale(scale) {
    if (!Number.isFinite(scale) || scale < .5 || scale > 1) throw new Error('cloudScale must be between 0.5 and 1.');
    if (scale !== this._cloudScale) { this._cloudScale = scale; this.invalidateHistory(); }
    this._nativeOnly.value = scale === 1;
    return this;
  }
  setRepairAlphaRange(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('repairAlphaRange must be between 0 and 1.');
    this._repairAlphaRange.value = value;
    this.invalidateHistory();
    return this;
  }
  setDebugRepair(enabled) {
    this._debugRepair.value = !!enabled;
    this.invalidateHistory();
    return this;
  }
  setRepairDistanceRange(value) {
    if (!Number.isFinite(value) || value < 0) throw new Error('repairDistanceRange must be nonnegative.');
    this._repairDistanceRange.value = value;
    this.invalidateHistory();
    return this;
  }

  setup(builder) {
    // r185 reverses AlwaysDepth into NeverDepth. WebGPU supports
    // unconditional fragment-depth writes when depth testing is disabled.
    const reversed = builder.renderer.reversedDepthBuffer === true;
    this._material.depthTest = !reversed;
    if (builder.renderer.logarithmicDepthBuffer) throw new Error('Adaptive clouds require standard perspective depth.');
    if (reversed) this.renderTarget.depthTexture.type = THREE.FloatType;
    if (!this.lightCache && builder.renderer.backend.isWebGPUBackend && this.cloudOptions.curvature
      && this.cloudOptions.aerial?.sourceTransport && this.cloudOptions.aerial?.celestial) {
      this.lightCache = new CloudLightCache({ ...this.cloudOptions, camera: this.camera });
    }
    const shared = builder.getSharedContext();
    const lowResult = volCloudsNode({
      ...this.cloudOptions, lightCache: this.lightCache, beauty: this.beauty, depth: this.sceneDepth, camera: this.camera,
      // Preserve the full-resolution spatial noise scale as cloudScale changes.
      jitterCoordinate: screenCoordinate.mul(this._fullSize.div(this._layerSize)), emit: emitLayer,
    });
    const low = Fn(() => lowResult.toVar('reducedCloudLayer'))().context(shared);
    this._layerMaterial.fragmentNode = mrt({ layer: low.get('layer'), geometry: low.get('geometry') });
    this._layerMaterial.needsUpdate = true;

    const layers = texture(this.layerTarget.textures[0]);
    const geometry = texture(this.layerTarget.textures[1]);
    const bounds = cloudLayerBounds(this.cloudOptions.front);
    const cloudGeometry = this.cloudOptions.curvature ? createCloudGeometry(this.cloudOptions.curvature) : null;
    const fullResult = Fn(() => {
      const suv = uv();
      const sceneDepth = this.sceneDepth.sample(suv).r.toVar();
      const vpos = getViewPosition(suv, sceneDepth, this._projectionInverse).toVar();
      const rel = this._cameraWorld.mul(vec4(vpos, 1)).xyz.sub(this.cloudOptions.uCamPos).toVar();
      const sceneDistance = max(length(rel), 1e-3).toVar();
      const dir = rel.div(sceneDistance).toVar();
      const viewDepth = vpos.z.negate().toVar();
      // Tolerance is physical ray distance, while metadata stores view Z.
      // Convert once so wide-FOV corners do not loosen the occluder bound.
      const stopToleranceView = this._stopTolerance.mul(viewDepth.div(sceneDistance)).toVar();

      // Analytic empty-ray rejection is exact and keeps a thin foreground jet
      // or a nearby ridge crisp even when every low-res texel missed it.
      let entry, exit;
      if (cloudGeometry) {
        const interval = cloudGeometry.shell(this.cloudOptions.uCamPos, dir, bounds.base, bounds.top).toVar();
        entry = interval.x.toVar();
        exit = min(min(interval.y, sceneDistance), entry.add(bounds.maxLen)).toVar();
      } else {
        const safeDy = select(abs(dir.y).lessThan(1e-5), select(dir.y.greaterThanEqual(0), 1e-5, -1e-5), dir.y);
        const tA = float(bounds.base).sub(this.cloudOptions.uCamPos.y).div(safeDy);
        const tB = float(bounds.top).sub(this.cloudOptions.uCamPos.y).div(safeDy);
        entry = max(min(tA, tB), 0).toVar();
        exit = min(min(max(tA, tB), sceneDistance), entry.add(bounds.maxLen)).toVar();
      }
      const hit = exit.greaterThan(entry).and(entry.lessThan(bounds.entryMax));
      const layer = vec4(0).toVar('reconstructedCloudLayer');
      const meanDistance = float(0).toVar('reconstructedCloudDistance');
      const repaired = float(0).toVar('cloudNativeRepair');
      If(hit, () => {
        const cloudSum = vec4(0).toVar();
        const weightedDistance = float(0).toVar();
        const needsRepair = this._nativeOnly.toVar('cloudNeedsNativeIntegration');
        If(this._nativeOnly.not(), () => {
          const pixel = suv.mul(this._layerSize).sub(.5).toVar();
          const base = floor(pixel).toVar();
          const part = fract(pixel).toVar();
          const invalidWeight = float(0).toVar();
          const minAlpha = float(1).toVar();
          const maxAlpha = float(0).toVar();
          const minDistance = float(1e20).toVar();
          const maxDistance = float(0).toVar();
          for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const coord = clamp(base.add(vec2(x, y)), vec2(0), this._layerSize.sub(1)).add(.5).div(this._layerSize);
            const sample = layers.sample(coord).level(0).toVar();
            const meta = geometry.sample(coord).level(0).toVar();
            const weight = (x ? part.x : part.x.oneMinus()).mul(y ? part.y : part.y.oneMinus()).toVar();
            // Never reconstruct a clipped cloud column from its mean distance.
            // A matching opaque stop or a fully completed foreground cloud is
            // required; missing information goes to the exact native march.
            const sameStop = abs(viewDepth.sub(meta.y)).lessThanEqual(stopToleranceView);
            const safeComplete = meta.w.greaterThan(.5).and(viewDepth.greaterThanEqual(meta.z.add(stopToleranceView)));
            invalidWeight.addAssign(select(sameStop.or(safeComplete), 0, weight));
            cloudSum.addAssign(sample.mul(weight));
            weightedDistance.addAssign(meta.x.mul(sample.a).mul(weight));
            // Exclude exactly zero-weight neighbors at a texel center. Including
            // them would force native repair even at cloudScale=1 reference mode.
            If(weight.greaterThan(1e-4), () => {
              minAlpha.assign(min(minAlpha, sample.a));
              maxAlpha.assign(max(maxAlpha, sample.a));
              // Similar colors/opacity can belong to different cloud depths.
              // Preserve temporal geometry where cloud has motion confidence;
              // transparent uniform veils do not get blanket native repair.
              If(sample.a.greaterThan(.12), () => {
                minDistance.assign(min(minDistance, max(meta.x, 1e-3)));
                maxDistance.assign(max(maxDistance, max(meta.x, 1e-3)));
              });
            });
          }
          const incompatibleDepth = invalidWeight.greaterThan(1e-3);
          const cloudSilhouette = maxAlpha.sub(minAlpha).greaterThan(this._repairAlphaRange);
          const cloudDistanceEdge = maxDistance.sub(minDistance).greaterThan(minDistance.mul(this._repairDistanceRange))
            .toVar('cloudDistanceDiscontinuity');
          needsRepair.assign(incompatibleDepth.or(cloudSilhouette).or(cloudDistanceEdge));
        });
        If(needsRepair, () => {
          // Keep the original full-res scene depth, jittered projection and
          // pixel noise. Both integrations share the same lighting cache;
          // unavailable columns retain the original light integration.
          const exact = volCloudsNode({
            ...this.cloudOptions, lightCache: this.lightCache, beauty: this.beauty, depth: this.sceneDepth,
            camera: this.camera, emit: emitLayer,
          }).toVar('nativeCloudRepairResult');
          layer.assign(exact.get('layer'));
          meanDistance.assign(exact.get('geometry').x);
          repaired.assign(1);
        }).Else(() => {
          layer.assign(cloudSum);
          meanDistance.assign(weightedDistance.div(max(cloudSum.a, 1e-6)));
        });
      });

      const beauty = this.beauty.sample(suv).rgb;
      const color = vec4(beauty.mul(layer.a.oneMinus()).add(layer.rgb), 1).toVar();
      If(this._debugRepair, () => {
        // Red=native repair, green=upsampled cloud, blue=analytic empty ray.
        color.assign(vec4(repaired, select(hit, repaired.oneMinus(), 0), select(hit, 0, 1), 1));
      });
      return cloudTemporalResult(this, { color, alpha: layer.a, meanDistance,
        sceneDistance, rayDirection: dir }, reversed);
    })().context(shared);
    const result = Fn(() => fullResult.toVar('fullResolutionCloudResult'))().context(shared);
    this._material.fragmentNode = mrt({ output: result.get('color'), velocity: result.get('motion') });
    this._material.depthNode = result.get('depth');
    this._material.needsUpdate = true;
    return this._textureNodes.output;
  }

  updateBefore(frame) {
    if (this._disposed) throw new Error('adaptive cloud pass is disposed');
    if (frame.frameId !== undefined && frame.frameId === this._lastFrameId) return;
    const { renderer } = frame;
    const size = renderer.getDrawingBufferSize(this._size);
    this._updateCamera(size.width, size.height);
    const lowWidth = Math.max(1, Math.ceil(size.width * this._cloudScale));
    const lowHeight = Math.max(1, Math.ceil(size.height * this._cloudScale));
    // At scale=1 the existing full-resolution repair branch is the native
    // march. Keep the low target tiny and skip its draw; scaling changes no
    // material graph, compiled shader, density recipe or noise asset.
    this.layerTarget.setSize(this._cloudScale < 1 ? lowWidth : 1, this._cloudScale < 1 ? lowHeight : 1);
    this._layerSize.value.set(lowWidth, lowHeight);
    this._fullSize.value.set(size.width, size.height);
    this._rendererState = THREE.RendererUtils.resetRendererState(renderer, this._rendererState);
    try {
      this.lightCache?.update(renderer);
      renderer.setMRT(null);
      if (this._cloudScale < 1) {
        renderer.setRenderTarget(this.layerTarget);
        this._layerQuad.render(renderer);
      }
      renderer.setRenderTarget(this.renderTarget);
      this._quad.render(renderer);
      this._storeCamera();
      this._lastFrameId = frame.frameId;
    } catch (error) { this.invalidateHistory(); throw error; }
    finally { THREE.RendererUtils.restoreRendererState(renderer, this._rendererState); }
  }

  dispose() {
    if (this._disposed) return; this._disposed = true;
    this.lightCache?.dispose();
    this.layerTarget.dispose();
    this._layerMaterial.dispose();
    super.dispose();
  }
}
