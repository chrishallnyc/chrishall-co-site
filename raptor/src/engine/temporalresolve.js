// App-owned invalidation for pinned Three TRAA. A reset resolves directly
// from current beauty for one frame; the native history/depth copies then
// seed the following frame without resizing or reallocating any targets.
import TRAANode from "./rawdepthtraa.js";
import { Vector3, Quaternion } from "three";
import { convertToTexture, uniform, Fn, If, vec4, uv } from "three/tsl";

export class TemporalResolveNode extends TRAANode {
  constructor(beauty, depth, motion, camera, { rawDepthSelection = false } = {}) {
    super(convertToTexture(beauty), depth, motion, camera);
    this.rawDepthSelection = rawDepthSelection;
    this._resetPending = true;
    this._resetThisFrame = uniform(true);
    this._lastPosition = new Vector3();
    this._lastRotation = new Quaternion();
    this._currentPosition = new Vector3();
    this._currentRotation = new Quaternion();
    this._lastProjection = null;
  }

  invalidateHistory() { this._resetPending = true; }

  setup(builder) {
    const result = super.setup(builder);
    const accumulated = this._resolveMaterial.colorNode;
    this._resolveMaterial.colorNode = Fn(() => {
      const color = vec4(0).toVar();
      If(this._resetThisFrame, () => {
        color.assign(this.beautyNode.sample(uv()));
      }).Else(() => {
        color.assign(accumulated);
      });
      return color;
    })();
    return result;
  }

  updateBefore(frame) {
    // Detect cuts here too: LOW/debug rendering may have no CloudPass or
    // planet adapter to notify the post chain. Temporal jitter changes only
    // view offsets, not these lens/pose fields, so it never causes a reset.
    const camera = this.camera, last = this._lastProjection;
    camera.getWorldPosition(this._currentPosition);
    camera.getWorldQuaternion(this._currentRotation);
    if (last && (camera !== last.camera
      || this._currentPosition.distanceToSquared(this._lastPosition) > 250 * 250
      || Math.abs(this._currentRotation.dot(this._lastRotation)) < Math.cos(35 * Math.PI / 360)
      || camera.near !== last.near || camera.far !== last.far || camera.aspect !== last.aspect
      || Math.abs(camera.fov - last.fov) > 8 || Math.abs(camera.zoom - last.zoom) > .1)) {
      this._resetPending = true;
    }
    this._resetThisFrame.value = this._resetPending;
    // Clear only after a successful native update. A failed draw retries
    // the reset; duplicate invalidations naturally coalesce until rendering.
    super.updateBefore(frame);
    this._resetPending = false;
    this._lastPosition.copy(this._currentPosition);
    this._lastRotation.copy(this._currentRotation);
    this._lastProjection = { camera, near: camera.near, far: camera.far,
      aspect: camera.aspect, fov: camera.fov, zoom: camera.zoom };
  }
}

export const temporalResolve = (beauty, depth, motion, camera, options) =>
  new TemporalResolveNode(beauty, depth, motion, camera, options);
