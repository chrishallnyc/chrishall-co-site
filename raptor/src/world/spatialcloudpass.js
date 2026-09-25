// Two-draw cloud spatial filter. Original raw march owns geometry.
import * as THREE from 'three';
import { Fn, If, uniform, texture, passTexture, uv, vec2, vec3, vec4, float, ivec2,
  struct, mrt, min, max, abs, exp, select, normalize, getViewPosition } from 'three/tsl';
import { CloudPass as BaseCloudPass } from './cloudpass.js';
import { volCloudsNode } from './volclouds.js';
import { CloudLightCache } from './cloudlightcache.js';
import { cloudTemporalResult } from './cloudtemporal.js';

const RawResult = struct({ radiance: 'vec4', metadata: 'vec4', motion: 'vec4', depth: 'float' });
const SPATIAL_DEFAULTS = Object.freeze({ alphaFloor: 1 / 1024, stopMarginM: .5,
  spatialSigma: 1, spatialAlphaSigma: .1, spatialRelativeDepthSigma: .025 });

export class SpatialCloudPass extends BaseCloudPass {
  static get type() { return 'SpatialCloudPass'; }

  constructor({ cloudIntegrator = volCloudsNode, filterRadius = 2, filterOptions = {}, ...options }) {
    super(options);
    if (typeof cloudIntegrator !== 'function' || ![0, 2].includes(filterRadius)) throw new Error('invalid spatial cloud configuration');
    for (const key of Object.keys(filterOptions)) if (!(key in SPATIAL_DEFAULTS)) throw new Error('unknown spatial option ' + key);
    this.parameters = Object.freeze({ ...SPATIAL_DEFAULTS, ...filterOptions });
    for (const value of Object.values(this.parameters)) if (!Number.isFinite(value) || value <= 0) throw new Error('spatial parameters must be finite and positive');
    this.isSpatialCloudPass = true;
    this._integrate = cloudIntegrator; this._disposed = false; this._lastFrameId = undefined;
    this._successfulFrames = 0; this._pendingFrame = null; this._lastRawCaptureCount = 0;
    this.layerMetadataEncoding = 'meanDistance,sceneDistance,signedIntegrationEndRay,alphaF32';

    this.rawTarget = this.renderTarget;
    this.rawTarget.textures[0].name = 'radiance';
    const metadata = this.rawTarget.textures[0].clone(); metadata.name = 'geometry';
    metadata.type = THREE.FloatType; this.rawTarget.textures.push(metadata);
    for (const t of this.rawTarget.textures) {
      t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false;
    }
    this.outputTarget = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.outputTarget.texture.name = 'cloudSpatialOutput';
    // TRAA seeds color from this public target while copying raw real depth.
    this.renderTarget = this.outputTarget;
    this._textureNodes.output = passTexture(this, this.outputTarget.texture);
    this._rawRadiance = texture(this.rawTarget.textures[0]);
    this._rawMetadata = texture(this.rawTarget.textures[2]);
    this._compositionMaterial = new THREE.NodeMaterial();
    this._compositionMaterial.name = 'Cloud spatial composition';
    this._compositionMaterial.depthTest = this._compositionMaterial.depthWrite = false;
    this._compositionMaterial.toneMapped = false;
    this._compositionQuad = new THREE.QuadMesh(this._compositionMaterial);
    this._material.name = 'Cloud original march and geometry'; this._material.toneMapped = false;
    this._fullSize = uniform(new THREE.Vector2(1, 1));
    this._filterRadius = uniform(filterRadius, 'int');
    this._nowProjectionInverse = uniform(new THREE.Matrix4());
    this._quad.onBeforeRender = () => {
      if (this._pendingFrame) { this._captureRawCamera(); this._pendingFrame.rawCaptureCount++; }
    };
  }

  get filterRadius() { return this._filterRadius.value; }
  get rawMetadataTexture() { return this.rawTarget.textures[2]; }
  get rawRadianceTexture() { return this.rawTarget.textures[0]; }
  setFilterRadius(radius) {
    if (![0, 2].includes(radius)) throw new Error('filterRadius must be 0 or 2');
    if (radius !== this.filterRadius) { this._filterRadius.value = radius; this.invalidateHistory(); }
    return this;
  }

  _viewFactorAt(coord) {
    // The game's unscaled camera has inverse world/view rotations. The
    // scene-stop guide needs only -viewRay.z; rotating every filter tap to
    // world space and back cannot change that normalized view-space value.
    return normalize(getViewPosition(coord, float(.5), this._nowProjectionInverse)).z.negate();
  }

  setup(builder) {
    const reversed = builder.renderer.reversedDepthBuffer === true;
    this._material.depthTest = !reversed;
    if (builder.renderer.logarithmicDepthBuffer) throw new Error('Spatial cloud pass requires perspective depth');
    if (reversed) this.rawTarget.depthTexture.type = THREE.FloatType;
    if (!this.lightCache && builder.renderer.backend.isWebGPUBackend && this.cloudOptions.curvature
      && this.cloudOptions.aerial?.sourceTransport && this.cloudOptions.aerial?.celestial) {
      this.lightCache = new CloudLightCache({ ...this.cloudOptions, camera: this.camera });
    }
    const shared = builder.getSharedContext();
    const integrated = this._integrate({ ...this.cloudOptions, lightCache: this.lightCache, beauty: this.beauty,
      depth: this.sceneDepth, camera: this.camera, emit: r => {
        // Crucially use the original ray/scene distance here, exactly once.
        const original = cloudTemporalResult(this, r, reversed).toVar();
        const metadata = vec4(r.meanDistance, r.sceneDistance,
          select(r.sceneIndependent.greaterThan(.5), r.integrationEnd, r.integrationEnd.negate()), r.alpha);
        return RawResult(vec4(r.radiance, r.alpha), metadata, original.get('motion'), original.get('depth'));
      } });
    const raw = Fn(() => integrated.toVar('cloudOriginalRawResult'))().context(shared);
    this._material.fragmentNode = mrt({ radiance: raw.get('radiance'), velocity: raw.get('motion'), geometry: raw.get('metadata') });
    this._material.depthNode = raw.get('depth'); this._material.needsUpdate = true;

    this._compositionMaterial.fragmentNode = this._compositionNode().context(shared);
    this._compositionMaterial.needsUpdate = true;
    return this._textureNodes.output;
  }

  _compositionNode() {
    const p = this.parameters;
    return Fn(() => {
      const coord = uv(), pixel = ivec2(coord.mul(this._fullSize));
      const meta = this._rawMetadata.load(pixel).toVar('cloudCompositionCurrentMetadata');
      const center = this._rawRadiance.load(pixel).rgb.toVar();
      const alpha = meta.w.toVar('cloudCompositionOriginalAlpha');
      const radiance = center.toVar();
      If(alpha.greaterThanEqual(p.alphaFloor).and(this._filterRadius.greaterThan(0)), () => {
        const sum = center.div(alpha).toVar(); const weights = float(1).toVar();
        const viewFactor = this._viewFactorAt(coord).toVar();
        const centerStopView = meta.y.mul(viewFactor).toVar();
        for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
          if (!x && !y) continue;
          const at = pixel.add(ivec2(x, y)).toVar();
          If(at.greaterThanEqual(ivec2(0)).all().and(at.lessThan(ivec2(this._fullSize)).all()), () => {
            const neighbor = this._rawMetadata.load(at).toVar();
            const tapUV = vec2(at).add(.5).div(this._fullSize).toVar();
            const factor = this._viewFactorAt(tapUV).toVar();
            const sameStop = abs(neighbor.y.mul(factor).sub(centerStopView)).lessThanEqual(viewFactor.mul(p.stopMarginM));
            const complete = neighbor.z.greaterThan(0)
              .and(abs(neighbor.z).mul(factor).add(viewFactor.mul(p.stopMarginM)).lessThanEqual(centerStopView));
            If(neighbor.w.greaterThanEqual(p.alphaFloor).and(sameStop.or(complete)), () => {
              const dd = neighbor.x.sub(meta.x).div(max(min(meta.x, neighbor.x).mul(p.spatialRelativeDepthSigma), 1));
              const da = neighbor.w.sub(alpha).div(p.spatialAlphaSigma);
              const w = exp(float((x * x + y * y) / (p.spatialSigma * p.spatialSigma)).add(dd.mul(dd)).add(da.mul(da)).mul(-.5)).toVar();
              sum.addAssign(this._rawRadiance.load(at).rgb.div(neighbor.w).mul(w)); weights.addAssign(w);
            });
          });
        }
        radiance.assign(sum.div(weights).mul(alpha));
      });
      If(alpha.lessThanEqual(0), () => { radiance.assign(vec3(0)); });
      return vec4(this.beauty.sample(coord).rgb.mul(alpha.oneMinus()).add(radiance), 1);
    })();
  }


  _captureRawCamera() {
    this._nowProjectionInverse.value.copy(this.camera.projectionMatrixInverse);
  }

  updateBefore(frame) {
    if (this._disposed) throw new Error('spatial cloud pass is disposed');
    if (frame.frameId !== undefined && frame.frameId === this._lastFrameId) return;
    const { renderer } = frame, size = renderer.getDrawingBufferSize(this._size);
    this._updateCamera(size.width, size.height);
    this.rawTarget.setSize(size.width, size.height); this._fullSize.value.set(size.width, size.height);
    this._captureRawCamera();
    this._rendererState = THREE.RendererUtils.resetRendererState(renderer, this._rendererState);
    const pending = { rawCaptureCount: 0 }; this._pendingFrame = pending;
    try {
      this.lightCache?.update(renderer);
      renderer.setMRT(null);
      renderer.setRenderTarget(this.rawTarget); this._quad.render(renderer);
      renderer.setRenderTarget(this.outputTarget); this._compositionQuad.render(renderer);
      if (pending.rawCaptureCount !== 1) throw new Error('spatial cloud pass requires exactly one observed raw draw');
      this._storeCamera(); this._lastFrameId = frame.frameId; this._successfulFrames++;
      this._lastRawCaptureCount = pending.rawCaptureCount;
    } catch (error) { this.invalidateHistory(); throw error; }
    finally { this._pendingFrame = null; THREE.RendererUtils.restoreRendererState(renderer, this._rendererState); }
  }

  dispose() {
    if (this._disposed) return; this._disposed = true;
    this.lightCache?.dispose();
    this.rawTarget.dispose(); this._compositionMaterial.dispose(); super.dispose();
  }
}
