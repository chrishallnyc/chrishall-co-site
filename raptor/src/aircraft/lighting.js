// Aircraft integration with the actual game's sun, PBR environment and air.
// No simulation data is read or written; the rendered Object3D pose is enough.
import * as THREE from 'three';
import { Fn, output, positionWorld, vec4, shadow } from 'three/tsl';
import { makeSurfaceEnvironment } from '../world/surface-environment.js';

const OPAQUE = material => (material.fog !== false || material.userData.aircraftAerial === 'hillaire')
  && !material.transparent && !(material.transmission > 0);

export class AircraftLighting {
  constructor({ renderer, atmosphere, params, aerial = null, shadows = true, curvature = null }) {
    this.renderer = renderer;
    this.atmosphere = atmosphere;
    this.aerial = aerial;
    this.curvature = curvature;
    this.receiverTransport = false;
    this._sunVisibility = null;
    this.shadowRequested = shadows;
    this.shadows = false;
    this.bindings = [];
    this.groundReceivers = [];
    this.materials = new WeakMap();
    this.adaptedMaterials = new Set();
    this.environmentIntensities = new Map();
    this.environmentGain = 1;
    this.environmentTexture = null;
    this._center = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._sun = new THREE.Vector3();
    this._worldUp = new THREE.Vector3(0, 1, 0);
    this._lastSpan = 0;
    this._shadowSize = 0;
    this.stats = { materials: 0, meshes: 0, shadowSize: 0, allocatedShadowSize: 0,
      requestedShadowSize: 0, shadowSpan: 0,
      aerial: aerial ? 'hillaire' : atmosphere.scene.fog ? 'scene-fog' : 'none',
      environment: 'solar-sky-pmrem' };
    this.setQuality(params);
  }

  setQuality(params) {
    this.shadows = !!(params.shadows && this.shadowRequested);
    const sun = this.atmosphere.sun, shadow = sun.shadow;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.stats.requestedShadowSize = this.shadows ? params.shadowSize : 0;
    if (this.shadows) {
      this.renderer.shadowMap.enabled = true;
      sun.castShadow = true;
      shadow.autoUpdate = true;
      shadow.needsUpdate = true;
      shadow.intensity = 1;
      // Pick the target when shadows first become active, then retain it for
      // this renderer's lifetime. r185 WebGPU can submit a stale depth-texture
      // reference after resizing an allocated shadow target. Saved quality
      // changes pick the new resolution on the next boot, like texture LOD.
      if (!this._shadowSize) {
        this._shadowSize = params.shadowSize;
        shadow.mapSize.set(this._shadowSize, this._shadowSize);
        this.stats.allocatedShadowSize = this._shadowSize;
      }
      shadow.camera.near = 1;
      shadow.camera.far = 320;
      // Metres, tuned for a 19 m airframe rather than a landscape shadow map.
      shadow.normalBias = .025;
      shadow.bias = -.00008;
      shadow.radius = 1.2;
      this.stats.shadowSize = this._shadowSize;
    } else {
      // Keep an already compiled shadow node alive. Removing/re-adding the
      // light's shadow in r185 can leave cached node programs referencing a
      // disposed depth target. Zero receivers and no map updates cost no
      // shadow draws; the small cached target can be reused after an upgrade.
      shadow.autoUpdate = false;
      shadow.needsUpdate = false;
      shadow.intensity = 0;
      this.stats.shadowSize = 0;
    }
    for (const binding of this.bindings) {
      const materials = Array.isArray(binding.source) ? binding.source : [binding.source];
      binding.mesh.castShadow = this.shadows && materials.some(OPAQUE);
      binding.mesh.receiveShadow = this.receiverTransport || binding.mesh.castShadow;
    }
    for (const mesh of this.groundReceivers) mesh.receiveShadow = this.receiverTransport || this.shadows;
  }

  // Install once before shader compilation. A custom light.shadow.shadowNode
  // replaces Three's native shadow, so explicitly multiply both contracts.
  setSunVisibility(visibility) {
    if (this._sunVisibility === visibility) return;
    if (this._sunVisibility || !visibility?.isNode) throw new Error("Sun visibility must be installed once before rendering");
    this._sunVisibility = visibility;
    this.receiverTransport = true;
    const sun = this.atmosphere.sun;
    // LOW also compiles celestial visibility. Its native shadow node reserves
    // the default512 target without updating it; retain that allocation on a
    // later tier upgrade, matching the renderer's no-resize contract. Reload
    // selects the requested higher-resolution target.
    if (!this._shadowSize) {
      this._shadowSize = sun.shadow.mapSize.x;
      this.stats.allocatedShadowSize = this._shadowSize;
    }
    this.renderer.shadowMap.enabled = true;
    sun.castShadow = true;
    sun.shadow.shadowNode = visibility.mul(shadow(sun));
    for (const binding of this.bindings) binding.mesh.receiveShadow = true;
    for (const mesh of this.groundReceivers) mesh.receiveShadow = true;
  }

  material(source) {
    if (!source) return source;
    let adapted = this.materials.get(source);
    if (adapted) return adapted;
    // Basic glows, HUD symbols and additive exhaust preserve their own blend
    // treatment. The aircraft's opaque/emissive PBR surfaces share the air.
    if (!(source.isMeshStandardMaterial || source.isMeshPhysicalMaterial || source.isMeshStandardNodeMaterial)) {
      this.materials.set(source, source);
      return source;
    }
    adapted = source.isMeshPhysicalMaterial || source.isMeshPhysicalNodeMaterial
      ? new THREE.MeshPhysicalNodeMaterial() : new THREE.MeshStandardNodeMaterial();
    adapted.copy(source);
    this.environmentIntensities.set(adapted, source.envMapIntensity ?? 1);
    if (this.environmentTexture) this._environmentMaterial(adapted);
    const aerial = this.aerial;
    const originalOutput = adapted.outputNode;
    if (aerial && source.fog !== false) {
      adapted.fog = false; // Hillaire owns the full path; never double FogExp2.
      adapted.outputNode = Fn(() => {
        const lit = originalOutput ?? output;
        // positionWorld is already curved. Hillaire expects that rendered
        // physical point; inverse curvature would incorrectly flatten the path.
        const radiance = aerial.composite ? aerial.composite(positionWorld, lit.rgb)
          : lit.rgb.mul(aerial.trans(positionWorld)).add(aerial.ins(positionWorld).mul(aerial.uSunI));
        return vec4(radiance, lit.a);
      })();
      // Keep userData serializable: meshes/materials are cloned by LOD/liveries.
      adapted.userData = { ...source.userData, aircraftAerial: 'hillaire' };
    }
    this.materials.set(source, adapted);
    this.materials.set(adapted, adapted);
    this.adaptedMaterials.add(adapted);
    this.stats.materials = this.adaptedMaterials.size;
    return adapted;
  }

  _environmentMaterial(material) {
    const first = !material.envNode;
    material.envMap = this.environmentTexture;
    material.envNode = this.surfaceEnvironment.node;
    material.envMapIntensity = this.environmentIntensities.get(material) * this.environmentGain;
    if (first) material.needsUpdate = true;
  }

  setEnvironment(texture) {
    this.environmentTexture = texture;
    if (!this.surfaceEnvironment) {
      const up = this.curvature ? wp => this.curvature.radialUpNode(wp) : null;
      this.surfaceEnvironment = makeSurfaceEnvironment(texture, up);
    } else this.surfaceEnvironment.setTexture(texture);
    for (const material of this.adaptedMaterials) this._environmentMaterial(material);
    this.stats.environment = 'aircraft-height-sky-cloud-ground-pmrem';
  }

  rescaleEnvironment(gain) {
    if (gain === this.environmentGain) return;
    this.environmentGain = gain;
    for (const [material, intensity] of this.environmentIntensities) material.envMapIntensity = intensity * gain;
  }

  register(root) {
    root.traverse(mesh => {
      if (!mesh.isMesh || mesh.userData.aircraftEffect) return;
      const binding = { mesh, source: null, assigned: null };
      this.bindings.push(binding);
      this._refresh(binding);
    });
    this.stats.meshes = this.bindings.length;
  }

  _refresh(binding) {
    const mesh = binding.mesh, source = mesh.material;
    if (source === binding.assigned) return;
    const sourceMaterials = Array.isArray(source) ? source : [source];
    // This path runs at startup or a new livery/LOD material assignment.
    // All steady-state frames only compare object identity.
    binding.source = source;
    binding.assigned = Array.isArray(source) ? source.map(material => this.material(material)) : this.material(source);
    mesh.material = binding.assigned;
    const opaque = sourceMaterials.some(OPAQUE);
    mesh.castShadow = this.shadows && opaque;
    mesh.receiveShadow = this.receiverTransport || (this.shadows && opaque);
  }

  receiveGround(root) {
    if (!root) return;
    root.traverse(mesh => { if (mesh.isMesh) { mesh.receiveShadow = this.receiverTransport || this.shadows; this.groundReceivers.push(mesh); } });
  }

  refreshMaterials() {
    // Main calls this after LOD/livery changes and before planet bending.
    // Identity checks preserve the upstream allocation-free steady state.
    for (let i = 0; i < this.bindings.length; i++) this._refresh(this.bindings[i]);
  }

  update(aircraftRoot, terrain = null, { materialsReady = false } = {}) {
    // Retain the public upstream update contract for callers without a bender.
    if (!materialsReady) this.refreshMaterials();
    const sun = this.atmosphere.sun, shadow = sun.shadow;
    this._sun.copy(this.atmosphere.sky.uSunDir.value).normalize();
    // Retain the compiled shadow node but skip an unlit Sun's map draw.
    shadow.autoUpdate = this.shadows && sun.intensity > 0;
    if (!shadow.autoUpdate) shadow.needsUpdate = false;
    if (!this.shadows) {
      // Restore Atmosphere's origin-relative convention when its time-of-day
      // code moves the light. A retained player-relative target would tilt
      // the sun direction after changing quality and then changing time.
      sun.target.position.set(0, 0, 0);
      sun.position.copy(this._sun).multiplyScalar(20000);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
      return;
    }
    aircraftRoot.getWorldPosition(this._center);
    let halfSpan = 22;
    // Preserve a landing/taxi shadow in the same map when the projected
    // contact is close enough to retain useful self-shadow resolution.
    const ground = terrain ? Math.max(0, terrain.heightAt(this._center.x, this._center.z)) : 0;
    const height = Math.max(0, this._center.y - ground);
    if (height < 25 && this._sun.y > .12) {
      const distance = height / this._sun.y;
      halfSpan = Math.min(48, Math.max(halfSpan, distance * .5 + 15));
      this._center.addScaledVector(this._sun, -distance * .5);
    }
    // Terrain/contact queries above use flat map coordinates. Shadow draws
    // use bent vertices, so snap and aim the map in that same rendered frame.
    if (this.curvature) this.curvature.forward(this._center, this._center);
    // Quantization prevents projection scale crawling during taxi/approach.
    halfSpan = Math.ceil(halfSpan * .5) * 2;
    if (halfSpan !== this._lastSpan) {
      shadow.camera.left = shadow.camera.bottom = -halfSpan;
      shadow.camera.right = shadow.camera.top = halfSpan;
      shadow.camera.updateProjectionMatrix();
      this._lastSpan = halfSpan;
    }
    halfSpan = this._lastSpan;
    this._right.crossVectors(this._worldUp, this._sun);
    if (this._right.lengthSq() < .0001) this._right.set(1, 0, 0);
    else this._right.normalize();
    this._up.crossVectors(this._sun, this._right).normalize();
    const texel = halfSpan * 2 / shadow.mapSize.x;
    const x = this._center.dot(this._right), y = this._center.dot(this._up);
    this._center.addScaledVector(this._right, Math.round(x / texel) * texel - x);
    this._center.addScaledVector(this._up, Math.round(y / texel) * texel - y);
    sun.target.position.copy(this._center);
    sun.position.copy(this._center).addScaledVector(this._sun, 150);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    this.stats.shadowSpan = halfSpan * 2;
  }

  dispose() {
    for (const material of this.adaptedMaterials) material.dispose();
    this.adaptedMaterials.clear();
    this.environmentIntensities.clear();
    this.bindings.length = 0;
    this.groundReceivers.length = 0;
  }
}
