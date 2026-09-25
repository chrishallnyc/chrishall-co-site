// Source-aligned cumulative optical depth owned by the native cloud pass.
// Cache data is static density in one frozen curved frame, never accumulated
// image history. Unsupported backends retain the original light integration.
import * as THREE from 'three';
import { Fn, If, Loop, uniform, vec2, vec3, vec4, float, int, uint, ivec3,
  instanceIndex, texture3D, storageTexture3D, textureStore, dot, min, max,
  smoothstep, packHalf2x16, unpackHalf2x16 } from 'three/tsl';
import { PlanetCurvature, curvedBounds } from './planetcurvature.js';
import { makeCloudCacheDensity } from './volclouds.js';

export const CLOUD_LIGHT_CACHE_DEFAULTS = Object.freeze({
  halfSpanM: 6144, forwardM: 4096, crossStepM: 128, depthStepM: 64,
  integrationStepM: 8, borderCells: 2, maxOriginDriftM: 4096, refreshOriginDriftM: 512,
  maxSourceAngleRad: .0005, refreshSourceAngleRad: .00025, coverageGuardM: 9, maxDimension: 512,
  columnsPerFrame: 640,
});
const SKY = [[.7453559924999299, 2 / 3, 0], [-.7453559924999299, 2 / 3, 0]];

function finiteVector(v) { return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z); }

// Exported so the identical allocation/coverage math can be checked on CPU.
export function cloudLightLattice(box, direction, maxLengthM, options = CLOUD_LIGHT_CACHE_DEFAULTS) {
  const w = direction.clone().normalize().negate();
  const up = Math.abs(w.y) < .95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const u = up.cross(w).normalize(), v = w.clone().cross(u).normalize();
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate();
  for (let corner = 0; corner < 8; corner++) {
    const p = new THREE.Vector3(corner & 1 ? box.max.x : box.min.x,
      corner & 2 ? box.max.y : box.min.y, corner & 4 ? box.max.z : box.min.z);
    const q = new THREE.Vector3(p.dot(u), p.dot(v), p.dot(w));
    lo.min(q); hi.max(q);
  }
  lo.z -= maxLengthM;
  const spacing = new THREE.Vector3(options.crossStepM, options.crossStepM, options.depthStepM);
  const halo = options.borderCells + 1;
  lo.divide(spacing).floor().addScalar(-halo).multiply(spacing);
  hi.divide(spacing).ceil().addScalar(halo).multiply(spacing);
  const cells = hi.clone().sub(lo).divide(spacing).round();
  if (cells.x < 2 || cells.y < 2 || cells.z < 2 || Math.max(cells.x, cells.y, cells.z + 1) > options.maxDimension) {
    throw new Error('cloud light cache dimensions exceed the bounded cache');
  }
  const origin = u.clone().multiplyScalar(lo.x).addScaledVector(v, lo.y).addScaledVector(w, lo.z);
  return { u, v, w, origin, spacing, cells, bytes: cells.x * cells.y * (cells.z + 1) * 8 };
}

export function cloudLightCacheCoverage(point, direction, distanceM, lattice, borderCells = 2) {
  const relative = point.clone().sub(lattice.origin);
  const q = new THREE.Vector3(relative.dot(lattice.u), relative.dot(lattice.v), relative.dot(lattice.w)).divide(lattice.spacing);
  const qe = q.clone().add(new THREE.Vector3(direction.dot(lattice.u), direction.dot(lattice.v), direction.dot(lattice.w))
    .multiplyScalar(distanceM).divide(lattice.spacing));
  const margin = Math.min(q.x - .5, lattice.cells.x - .5 - q.x, q.y - .5, lattice.cells.y - .5 - q.y,
    q.z, lattice.cells.z - q.z, qe.x - .5, lattice.cells.x - .5 - qe.x, qe.y - .5,
    lattice.cells.y - .5 - qe.y, qe.z, lattice.cells.z - qe.z);
  const t = Math.max(0, Math.min(1, margin / borderCells));
  return { covered: margin >= 0, weight: t * t * (3 - 2 * t), q, qe, margin };
}

function makeStorage(name) {
  const texture = new THREE.Storage3DTexture(1, 1, 1);
  texture.type = THREE.HalfFloatType; texture.format = THREE.RGBAFormat;
  texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false;
  texture.name = name;
  return texture;
}

function controls() {
  return { u: uniform(new THREE.Vector3(1, 0, 0)), v: uniform(new THREE.Vector3(0, 1, 0)),
    w: uniform(new THREE.Vector3(0, 0, 1)), origin: uniform(new THREE.Vector3()),
    cells: uniform(new THREE.Vector3(1, 1, 1)), direction: uniform(new THREE.Vector3(0, 1, 0)) };
}

export class CloudLightCache {
  constructor({ noise, front, curvature, camera, uSunDir, aerial, cacheOptions = {} }) {
    this.options = Object.freeze({ ...CLOUD_LIGHT_CACHE_DEFAULTS, ...cacheOptions });
    for (const [key, value] of Object.entries(this.options)) {
      if (!Number.isFinite(value) || value <= 0) throw new Error('invalid cloud light cache option ' + key);
    }
    if (this.options.refreshOriginDriftM >= this.options.maxOriginDriftM
      || this.options.refreshSourceAngleRad >= this.options.maxSourceAngleRad
      || !Number.isInteger(this.options.columnsPerFrame)) throw new Error('invalid cloud cache cadence');
    this.camera = camera; this.curvature = curvature; this.front = front; this.noise = noise;
    this._sun = uSunDir; this._moon = aerial.celestial.uMoonDir;
    this.enabled = true; this._disposed = false; this._job = null;
    // Only one replacement is produced at a time. Complete front volumes
    // retain independent frames while this fifth texture is written.
    this._staging = makeStorage('cloudOpticalStaging');
    this.producerCurvature = new PlanetCurvature({ radius: curvature.radius });
    this.recipe = makeCloudCacheDensity({ noise, front, curvature: this.producerCurvature });
    this._sources = [0, 1, 2, 3].map(kind => this._makeSource(kind));
    this.stats = { bakes: 0, batches: 0, reusedFrames: 0, discarded: 0, bytes: 40,
      lastBatchDensitySamples: 0, maxBatchDensitySamples: 0, pending: null, sources: [] };
    this._center = new THREE.Vector3(); this._nextPriority = 0;
  }

  _makeSource(kind) {
    // Layout-bearing Fn graphs must be unique per producer on pinned Three.
    const recipe = makeCloudCacheDensity({ noise: this.noise, front: this.front, curvature: this.producerCurvature });
    const texture = makeStorage('cloudOpticalPrefix' + kind);
    const source = { kind, texture, sampled: texture3D(texture), valid: uniform(false),
      frame: new PlanetCurvature({ radius: this.curvature.radius }), ...controls(),
      producer: { ...controls(), offset: uniform(0, 'uint'), storage: storageTexture3D(this._staging) },
      hasData: false, lattice: null, center: new THREE.Vector3(), maxLengthM: kind < 2 ? 6180 : 3600,
      publishes: 0 };
    const p = source.producer, o = this.options;
    const substeps = Math.ceil(o.depthStepM / o.integrationStepM), ds = o.depthStepM / substeps;
    source.compute = Fn(() => {
      const index = instanceIndex.add(p.offset).toVar();
      const x = index.mod(uint(p.cells.x)).toVar(), y = index.div(uint(p.cells.x)).toVar();
      const start = p.origin.add(p.u.mul(float(x).add(.5).mul(o.crossStepM)))
        .add(p.v.mul(float(y).add(.5).mul(o.crossStepM))).toVar();
      const tau = float(0).toVar();
      textureStore(p.storage, ivec3(int(x), int(y), 0), vec4(0));
      Loop({ start: int(0), end: int(p.cells.z), type: 'int', condition: '<' }, ({ i }) => {
        for (let substep = 0; substep < substeps; substep++) {
          const d = float(i).mul(o.depthStepM).add((substep + .5) * ds);
          tau.addAssign(recipe.density(start.add(p.w.mul(d))).mul(ds * recipe.sigma));
        }
        const high = unpackHalf2x16(packHalf2x16(vec2(tau, 0))).x.toVar();
        textureStore(p.storage, ivec3(int(x), int(y), i.add(1)), vec4(high, tau.sub(high), 0, 0));
      });
    })().compute(1).setName('Cloud optical prefix batch ' + kind);
    return source;
  }

  column(renderPoint, direction, distanceM, kind) {
    const s = this._sources[kind], o = this.options;
    const inverseSpacing = vec3(1 / o.crossStepM, 1 / o.crossStepM, 1 / o.depthStepM);
    const pointInCacheFrame = p => s.frame.forwardNode(this.curvature.inverseNode(p));
    return Fn(([point, requestedDirection, distance]) => {
      const result = vec2(0).toVar(), delta = requestedDirection.sub(s.direction);
      If(s.valid.and(dot(delta, delta).lessThanEqual(o.maxSourceAngleRad ** 2)), () => {
        const relative = pointInCacheFrame(point).sub(s.origin).toVar();
        const q = vec3(dot(relative, s.u), dot(relative, s.v), dot(relative, s.w)).mul(inverseSpacing).toVar();
        const qe = q.sub(vec3(0, 0, distance.div(o.depthStepM))).toVar();
        const actualEnd = pointInCacheFrame(point.add(requestedDirection.mul(distance))).sub(s.origin).toVar();
        const actualQe = vec3(dot(actualEnd, s.u), dot(actualEnd, s.v), dot(actualEnd, s.w)).mul(inverseSpacing).toVar();
        const guard = inverseSpacing.mul(o.coverageGuardM);
        const supportedMargin = at => min(min(min(at.x.sub(.5).sub(guard.x), s.cells.x.sub(.5).sub(at.x).sub(guard.x)),
          min(at.y.sub(.5).sub(guard.y), s.cells.y.sub(.5).sub(at.y).sub(guard.y))),
          min(at.z.sub(guard.z), s.cells.z.sub(at.z).sub(guard.z)));
        const margin = min(supportedMargin(q), min(supportedMargin(qe), supportedMargin(actualQe))).toVar();
        If(margin.greaterThanEqual(0), () => {
          const dimensions = s.cells.add(vec3(0, 0, 1));
          const a = s.sampled.sample(q.add(vec3(0, 0, .5)).div(dimensions)).level(0).rg.toVar();
          const b = s.sampled.sample(qe.add(vec3(0, 0, .5)).div(dimensions)).level(0).rg.toVar();
          result.assign(vec2(max(a.x.sub(b.x).add(a.y.sub(b.y)), 0), smoothstep(0, o.borderCells, margin)));
        });
      });
      return result;
    }).setLayout({ name: 'cloudCachedColumn' + kind, type: 'vec2', inputs: [
      { name: 'point', type: 'vec3' }, { name: 'requestedDirection', type: 'vec3' }, { name: 'distance', type: 'float' },
    ] })(renderPoint, direction, distanceM);
  }

  _within(origin, direction, currentDirection, originLimit, angleLimit) {
    return origin.distanceTo(this.curvature.origin.value) <= originLimit
      && direction.distanceToSquared(currentDirection) <= angleLimit * angleLimit;
  }

  _start(source, direction, center) {
    const o = this.options, origin = this.curvature.origin.value.clone();
    this.producerCurvature.origin.value.copy(origin);
    const h = o.halfSpanM;
    const flatBox = new THREE.Box3(new THREE.Vector3(center.x - h, this.recipe.base, center.z - h),
      new THREE.Vector3(center.x + h, this.recipe.top, center.z + h));
    const box = curvedBounds(flatBox, origin, undefined, this.curvature.radius);
    const lattice = cloudLightLattice(box, direction, source.maxLengthM, o), p = source.producer;
    for (const key of ['u', 'v', 'w', 'origin', 'cells']) p[key].value.copy(lattice[key]);
    p.direction.value.copy(direction); p.storage.value = this._staging;
    this._staging.setSize(lattice.cells.x, lattice.cells.y, lattice.cells.z + 1);
    this._job = { source, lattice, origin, direction: direction.clone(), center: center.clone(),
      completed: 0, count: lattice.cells.x * lattice.cells.y };
  }

  _publish(job) {
    const source = job.source, old = source.texture;
    source.texture = this._staging; source.sampled.value = this._staging; this._staging = old;
    for (const key of ['u', 'v', 'w', 'origin', 'cells']) source[key].value.copy(job.lattice[key]);
    source.direction.value.copy(job.direction); source.frame.origin.value.copy(job.origin);
    source.center.copy(job.center); source.lattice = job.lattice; source.hasData = true;
    source.valid.value = this.enabled; source.publishes++; this.stats.bakes++;
  }

  _statistics() {
    const textures = [...this._sources.map(source => source.texture), this._staging];
    if (new Set(textures).size !== 5) throw new Error('cloud staging texture aliases a visible volume');
    this.stats.bytes = textures.reduce((sum, t) => sum + t.image.width * t.image.height * t.image.depth * 8, 0);
    this.stats.pending = this._job ? { kind: this._job.source.kind, completed: this._job.completed, total: this._job.count } : null;
    this.stats.sources = this._sources.map(s => ({ kind: s.kind, ready: s.valid.value, publishes: s.publishes,
      origin: s.frame.origin.value.toArray(), dimensions: [s.texture.image.width, s.texture.image.height, s.texture.image.depth] }));
  }

  update(renderer) {
    if (this._disposed) throw new Error('cloud light cache is disposed');
    this.stats.lastBatchDensitySamples = 0;
    const sun = this._sun.value, moon = this._moon.value;
    if (!finiteVector(sun) || !finiteVector(moon) || sun.lengthSq() < .5 || moon.lengthSq() < .5) {
      for (const source of this._sources) source.valid.value = false;
      this._job = null; this._statistics(); return;
    }
    const inputs = [sun.clone().normalize(), moon.clone().normalize(), ...SKY.map(d => new THREE.Vector3(...d))];
    const o = this.options;
    const forward = this.camera.getWorldDirection(new THREE.Vector3()); forward.y = 0;
    if (forward.lengthSq() > 1e-8) forward.normalize();
    const center = this._center.copy(this.camera.position).addScaledVector(forward, o.forwardM);
    for (const source of this._sources) {
      source.valid.value = this.enabled && source.hasData && this._within(source.frame.origin.value,
        source.direction.value, inputs[source.kind], o.maxOriginDriftM, o.maxSourceAngleRad);
    }
    // A cut cannot publish an obsolete in-flight producer. Existing source
    // volumes are independently rejected above; the ordinary column remains.
    if (this._job && !this._within(this._job.origin, this._job.direction,
      inputs[this._job.source.kind], o.maxOriginDriftM, o.maxSourceAngleRad)) {
      this.stats.discarded++; this._job = null;
    }
    if (!this.enabled) { this._statistics(); return; }
    const primary = inputs[0].y < -.05 ? 1 : 0;
    const order = [primary, 2, 3];
    const needsRefresh = source => !source.hasData || !this._within(source.frame.origin.value,
      source.direction.value, inputs[source.kind], o.refreshOriginDriftM, o.refreshSourceAngleRad)
      || Math.hypot(center.x - source.center.x, center.z - source.center.z) > o.halfSpanM * .5;
    // Spare work is preemptible: it must not spend the active sources' refresh
    // margin while the camera moves. Its incomplete texture was never visible.
    if (this._job?.source.kind === 1 - primary && order.some(kind => needsRefresh(this._sources[kind]))) {
      this.stats.discarded++; this._job = null;
    }
    if (!this._job) {
      const invalid = order.map(kind => this._sources[kind]).find(source => !source.valid.value && needsRefresh(source));
      let source = invalid;
      if (!source) for (let n = 0; n < order.length; n++) {
        const index = (this._nextPriority + n) % order.length, candidate = this._sources[order[index]];
        if (needsRefresh(candidate)) { source = candidate; this._nextPriority = (index + 1) % order.length; break; }
      }
      // The secondary celestial source always retains exact fallback. Build
      // it during spare work so a usually-omitted daytime Moon does not delay
      // refresh of the active Sun and diffuse sky. At night priorities swap.
      const secondary = this._sources[1 - primary];
      if (!source && needsRefresh(secondary)) source = secondary;
      if (source) this._start(source, inputs[source.kind], center);
    }
    const job = this._job;
    if (!job) { this.stats.reusedFrames++; this._statistics(); return; }
    const source = job.source, count = Math.min(o.columnsPerFrame, job.count - job.completed);
    source.producer.offset.value = job.completed; source.compute.count = count;
    try { renderer.compute(source.compute); }
    catch (error) { this._job = null; this._statistics(); throw error; }
    job.completed += count; this.stats.batches++;
    this.stats.lastBatchDensitySamples = count * job.lattice.cells.z * Math.ceil(o.depthStepM / o.integrationStepM);
    this.stats.maxBatchDensitySamples = Math.max(this.stats.maxBatchDensitySamples, this.stats.lastBatchDensitySamples);
    if (job.completed === job.count) { this._publish(job); this._job = null; }
    this._statistics();
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true; this._job = null;
    for (const source of this._sources) { source.valid.value = false; source.texture.dispose(); source.compute.dispose(); }
    this._staging.dispose(); this._statistics();
  }
}
