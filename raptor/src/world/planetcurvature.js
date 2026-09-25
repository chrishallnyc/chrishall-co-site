// Render-only local planet frame. Simulation/map coordinates remain flat.
// Matches Hillaire's R=6360km planet centered below the MAIN camera's XZ.
import * as THREE from "three";
import { surfaceVelocityMRT } from "./surfacevelocitymrt.js";
import {
  Fn, uniform, vec2, vec3, vec4, float, sqrt, max, dot, normalize,
  positionWorld, modelWorldMatrixInverse, varyingProperty, select,
} from "three/tsl";

export const PLANET_RADIUS_M = 6360000;
export const PLANET_OCEAN_EXTENT_M = 1000000;
export const PLANET_TESTED_ALTITUDE_M = 60000;

export function bendHeight(height, radiusSquared, radius = PLANET_RADIUS_M) {
  const a = radius + height;
  const q = Math.sqrt(Math.max(a * a - radiusSquared, 1));
  return height - radiusSquared / (a + q);
}

export function bendPoint(point, origin, out = new THREE.Vector3(), radius = PLANET_RADIUS_M) {
  const dx = point.x - origin.x, dz = point.z - origin.y;
  return out.set(point.x, bendHeight(point.y, dx * dx + dz * dz, radius), point.z);
}

export function unbendPoint(point, origin, out = new THREE.Vector3(), radius = PLANET_RADIUS_M) {
  const dx = point.x - origin.x, dz = point.z - origin.y, b = radius + point.y;
  const r2 = dx * dx + dz * dz;
  return out.set(point.x, point.y + r2 / (b + Math.sqrt(b * b + r2)), point.z);
}

export function bendJacobian(point, origin, out = new THREE.Matrix3(), radius = PLANET_RADIUS_M) {
  const dx = point.x - origin.x, dz = point.z - origin.y, a = radius + point.y;
  const q = Math.sqrt(Math.max(a * a - dx * dx - dz * dz, 1));
  return out.set(1, 0, 0, -dx / q, a / q, -dz / q, 0, 0, 1);
}

export function bendNormal(normal, point, origin, out = new THREE.Vector3(), radius = PLANET_RADIUS_M) {
  const dx = point.x - origin.x, dz = point.z - origin.y, a = radius + point.y;
  const q = Math.sqrt(Math.max(a * a - dx * dx - dz * dz, 1));
  // J^-T n; includes the height-axis scale, not just an added sea slope.
  return out.set(normal.x + dx / a * normal.y, q / a * normal.y, normal.z + dz / a * normal.y).normalize();
}

export function curvedBounds(box, origin, out = new THREE.Box3(), radius = PLANET_RADIUS_M) {
  const dx0 = Math.max(box.min.x - origin.x, 0, origin.x - box.max.x);
  const dz0 = Math.max(box.min.z - origin.y, 0, origin.y - box.max.z);
  const dx1 = Math.max(Math.abs(box.min.x - origin.x), Math.abs(box.max.x - origin.x));
  const dz1 = Math.max(Math.abs(box.min.z - origin.y), Math.abs(box.max.z - origin.y));
  const lo = bendHeight(box.min.y, dx1 * dx1 + dz1 * dz1, radius);
  const hi = bendHeight(box.max.y, dx0 * dx0 + dz0 * dz0, radius);
  out.min.set(box.min.x, lo, box.min.z);
  out.max.set(box.max.x, hi, box.max.z);
  return out;
}

export function horizonDistance(height, radius = PLANET_RADIUS_M) {
  const h = Math.max(height, 0);
  return Math.sqrt(h * (2 * radius + h));
}

export function farForAltitude(height, radius = PLANET_RADIUS_M) {
  // 10% tangent margin + 25km; bucket changes happen infrequently. Camera
  // far only grows within a flight, avoiding repeated projection resets.
  return Math.max(120000, Math.ceil((horizonDistance(height, radius) * 1.1 + 25000) / 50000) * 50000);
}

export class PlanetCurvature {
  constructor({ radius = PLANET_RADIUS_M } = {}) {
    this.radius = radius;
    this.origin = uniform(new THREE.Vector2());
    this.previousOrigin = uniform(new THREE.Vector2());
    this.currentClip = uniform(new THREE.Matrix4());
    this.previousClip = uniform(new THREE.Matrix4());
    this.historyValid = uniform(false);
    this._lastOrigin = new THREE.Vector2();
    this._lastClip = new THREE.Matrix4();
    this._lastPosition = new THREE.Vector3();
    this._lastRotation = new THREE.Quaternion();
    this._lastProjection = null;
    this._committed = false;
    this._camera = null;
    this._unjittered = null;
  }

  // Call once after the main camera moves, before terrain selection, water,
  // shadow passes, and post.render(). Never call with a shadow/probe camera.
  beginFrame(camera) {
    const neededFar = farForAltitude(camera.position.y, this.radius);
    const farChanged = neededFar > camera.far;
    if (farChanged) { camera.far = neededFar; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    if (!this._unjittered) this._unjittered = camera.clone();
    this._unjittered.copy(camera, false);
    this._unjittered.clearViewOffset();
    this.origin.value.set(camera.position.x, camera.position.z);
    this.currentClip.value.multiplyMatrices(this._unjittered.projectionMatrix, camera.matrixWorldInverse);
    const last = this._lastProjection;
    const cut = !this._committed || this._camera !== camera || farChanged
      || camera.position.distanceToSquared(this._lastPosition) > 250 * 250
      || Math.abs(camera.quaternion.dot(this._lastRotation)) < Math.cos(35 * Math.PI / 360)
      || last && (camera.near !== last.near || camera.far !== last.far || camera.aspect !== last.aspect
        || Math.abs(camera.fov - last.fov) > 8 || Math.abs(camera.zoom - last.zoom) > .1);
    this.previousOrigin.value.copy(cut ? this.origin.value : this._lastOrigin);
    this.previousClip.value.copy(cut ? this.currentClip.value : this._lastClip);
    this.historyValid.value = !cut;
    this._camera = camera;
    return { farChanged, resetHistory: !!cut, withinTestedAltitude: camera.position.y <= PLANET_TESTED_ALTITUDE_M };
  }

  // Commit only after the main frame was rendered. Multiple camera passes do
  // not advance this history, and rendering a shadow never moves the origin.
  endFrame() {
    if (!this._camera) return;
    this._lastOrigin.copy(this.origin.value);
    this._lastClip.copy(this.currentClip.value);
    this._lastPosition.copy(this._camera.position);
    this._lastRotation.copy(this._camera.quaternion);
    this._lastProjection = { near: this._camera.near, far: this._camera.far, aspect: this._camera.aspect, fov: this._camera.fov, zoom: this._camera.zoom };
    this._committed = true;
  }

  invalidateHistory() { this._committed = false; this.historyValid.value = false; }
  forward(point, out) { return bendPoint(point, this.origin.value, out, this.radius); }
  inverse(point, out) { return unbendPoint(point, this.origin.value, out, this.radius); }
  normal(normal, point, out) { return bendNormal(normal, point, this.origin.value, out, this.radius); }
  bounds(box, out) { return curvedBounds(box, this.origin.value, out, this.radius); }
  project(point, camera, out = new THREE.Vector3()) { return this.forward(point, out).project(camera); }

  forwardNode(point, origin = this.origin) {
    const d = point.xz.sub(origin), r2 = dot(d, d), a = point.y.add(this.radius);
    const drop = r2.div(a.add(sqrt(max(a.mul(a).sub(r2), 1))));
    return vec3(point.x, point.y.sub(drop), point.z);
  }

  planetPositionNode(point) {
    return vec3(point.x.sub(this.origin.x), point.y.add(this.radius), point.z.sub(this.origin.y));
  }

  radialUpNode(point) { return normalize(this.planetPositionNode(point)); }

  inverseNode(point, origin = this.origin) {
    const d = point.xz.sub(origin), r2 = dot(d, d), b = point.y.add(this.radius);
    const rise = r2.div(b.add(sqrt(b.mul(b).add(r2))));
    return vec3(point.x, point.y.add(rise), point.z);
  }

  // J*d maps a physical/map tangent into the rendered frame. Keep this
  // separate from J^-T*n: applying the normal transform to a tangent is wrong.
  directionNode(direction, flatPoint, origin = this.origin) {
    const d = flatPoint.xz.sub(origin), a = flatPoint.y.add(this.radius);
    const q = sqrt(max(a.mul(a).sub(dot(d, d)), 1));
    return vec3(direction.x, a.mul(direction.y).sub(d.x.mul(direction.x))
      .sub(d.y.mul(direction.z)).div(q), direction.z);
  }

  normalNode(normal, flatPoint) {
    const d = flatPoint.xz.sub(this.origin), a = flatPoint.y.add(this.radius);
    const q = sqrt(max(a.mul(a).sub(dot(d, d)), 1));
    return normalize(vec3(normal.x.add(d.x.div(a).mul(normal.y)),
      q.div(a).mul(normal.y), normal.z.add(d.y.div(a).mul(normal.y))));
  }

  surfaceNodes(label) {
    const flat = varyingProperty("vec3", label + "MapPosition");
    const previous = varyingProperty("vec3", label + "PreviousRenderedPosition");
    const vertex = (flatPoint, previousFlatPoint = flatPoint) => {
      flat.assign(flatPoint);
      previous.assign(this.forwardNode(previousFlatPoint, this.previousOrigin));
      return modelWorldMatrixInverse.mul(vec4(this.forwardNode(flatPoint), 1)).xyz;
    };
    const motion = Fn(() => {
      const current = this.currentClip.mul(vec4(positionWorld, 1));
      const prior = this.previousClip.mul(vec4(previous, 1));
      const valid = this.historyValid.and(prior.w.greaterThan(1e-4));
      return select(valid, current.xy.div(current.w).sub(prior.xy.div(max(prior.w, 1e-4))), vec2(4));
    })();
    // MRT merge overrides only velocity. Scene color/depth and CloudPass's
    // existing harmonic cloud/object motion composition remain unchanged.
    return { flat, previous, vertex, motion, mrt: surfaceVelocityMRT(motion) };
  }
}
