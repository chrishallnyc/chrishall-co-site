// Static geographic surfaces move only with the camera. The terrain pool
// reassigns meshes every frame, so mesh model history is not surface history.
import * as THREE from "three";
import { surfaceVelocityMRT } from "./surfacevelocitymrt.js";
import { Fn, uniform, vec2, vec4, positionWorld, max, select } from "three/tsl";

export class TerrainSurfaceMotion {
  constructor() {
    this.currentClip = uniform(new THREE.Matrix4());
    this.previousClip = uniform(new THREE.Matrix4());
    this.historyValid = uniform(false);
    this._camera = null;
    this._unjittered = null;
    this._lastPosition = new THREE.Vector3();
    this._lastQuaternion = new THREE.Quaternion();
    this._lastProjection = null;
    this.node = Fn(() => {
      const world = vec4(positionWorld, 1);
      const current = this.currentClip.mul(world);
      const previous = this.previousClip.mul(this.previousPositionNode ? vec4(this.previousPositionNode, 1) : world);
      const valid = this.historyValid.and(previous.w.greaterThan(1e-4));
      return select(valid, current.xy.div(current.w).sub(previous.xy.div(max(previous.w, 1e-4))), vec2(4));
    })();
    this.mrt = surfaceVelocityMRT(this.node);
  }

  // Terrain.update is called once after main camera motion, before rendering.
  // Never feed a shadow/probe camera into this main-view history.
  update(camera) {
    camera.updateMatrixWorld();
    const last = this._lastProjection;
    const cut = this._camera !== camera || !last
      || camera.position.distanceToSquared(this._lastPosition) > 250 * 250
      || Math.abs(camera.quaternion.dot(this._lastQuaternion)) < Math.cos(35 * Math.PI / 360)
      || last && (camera.near !== last.near || camera.far !== last.far || camera.aspect !== last.aspect
        || Math.abs(camera.fov - last.fov) > 8 || Math.abs(camera.zoom - last.zoom) > .1);
    if (!this._unjittered) this._unjittered = camera.clone();
    this._unjittered.copy(camera, false);
    this._unjittered.clearViewOffset();
    this.previousClip.value.copy(this.currentClip.value);
    this.currentClip.value.multiplyMatrices(this._unjittered.projectionMatrix, camera.matrixWorldInverse);
    if (cut) this.previousClip.value.copy(this.currentClip.value);
    this.historyValid.value = !cut;
    this._camera = camera;
    this._lastPosition.copy(camera.position);
    this._lastQuaternion.copy(camera.quaternion);
    this._lastProjection = { near: camera.near, far: camera.far, aspect: camera.aspect, fov: camera.fov, zoom: camera.zoom };
  }

  invalidateHistory() { this._lastProjection = null; this.historyValid.value = false; }
}
