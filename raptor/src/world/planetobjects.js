// Render-only adapter for RAPTOR's ordinary game meshes. It operates after
// built-in morph/skin/instance transforms, never changing simulation poses.
import * as THREE from "three";
import { surfaceVelocityMRT } from "./surfacevelocitymrt.js";
import {
  Fn, vec2, vec4, positionLocal, positionPrevious, modelWorldMatrix,
  modelWorldMatrixInverse, normalWorldGeometry, cameraViewMatrix,
  varyingProperty, velocity, select, faceDirection, uniform,
} from "three/tsl";
import { PLANET_OCEAN_EXTENT_M } from "./planetcurvature.js";

export class PlanetObjectBender {
  constructor(curvature) {
    this.curvature = curvature;
    this._meshes = new Map();
    this._materials = new WeakMap();
    this._box = new THREE.Box3();
    this._sphere = new THREE.Sphere();
    this._inverse = new THREE.Matrix4();
    this._nextLabel = 0;
    this._frame = 0;
    // Stock velocity remembers the last DRAW of a mesh, which may be many
    // frames old after culling/hidden gear/pooled model activation. Only a
    // consecutive main motion draw can supply previous-frame history.
    this._objectHistoryValid = uniform(false).onObjectUpdate(({ object }) => {
      const record = this._meshes.get(object);
      if (!record) return false;
      if (record.lastDrawFrame !== this._frame) {
        record.historyValid = record.lastDrawFrame === this._frame - 1;
        record.lastDrawFrame = this._frame;
      }
      return record.historyValid;
    });
    this.fallbackSea = null;
  }

  // Repacked particle pools do not preserve instance row identity. Reject
  // their temporal history until those systems expose stable particle IDs.
  // Stable pylons and ordinary articulated meshes retain real prior motion.
  attach(root, { stableInstances = false, staticSurface = false } = {}) {
    if (!root) return;
    root.traverse(object => {
      if (!object.isMesh) return;
      if (object.isBatchedMesh || object.isSkinnedMesh || object.geometry.morphAttributes.position?.length) {
        throw new Error("Planet object bending needs explicit batched/skinned/morph bounds and history");
      }
      const mode = staticSurface ? "static" : object.isInstancedMesh && !stableInstances ? "reject" : "moving";
      this._meshes.set(object, { mode, instanceVersion: object.instanceMatrix?.version });
      this._prepareMaterial(object, mode);
      // Existing particle bounds are deliberately disabled by their owners.
      // Other instanced meshes need a whole-instance box when culled.
      if (object.frustumCulled && object.isInstancedMesh) object.computeBoundingBox();
      else if (object.frustumCulled && !object.geometry.boundingBox) object.geometry.computeBoundingBox();
    });
  }

  _prepareMaterial(object, mode) {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const prior = this._materials.get(material);
      if (prior) {
        if (prior !== mode) throw new Error("A planet material cannot share incompatible surface-history modes");
        continue;
      }
      if (!material.isMeshBasicMaterial && !material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) {
        throw new Error(`Planet object material requires an explicit adapter: ${material.type}`);
      }
      if (material.positionNode || material.normalNode || material.mrtNode || material.normalMap || material.bumpMap || material.displacementMap || material.clearcoatNormalNode || material.clearcoatNormalMap) {
        throw new Error(`Planet object material has an existing deformation/normal/MRT contract: ${material.type}`);
      }
      const label = "planetObject" + this._nextLabel++;
      const curvature = this.curvature;
      const staticSurface = mode === "static" ? curvature.surfaceNodes(label) : null;
      const flat = staticSurface?.flat || varyingProperty("vec3", label + "MapPosition");
      material.positionNode = Fn((inputs, builder) => {
        // NodeMaterial calls this after morph, skin and instance transforms.
        const world = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
        if (staticSurface) return staticSurface.vertex(world, world);
        flat.assign(world);
        if (mode === "moving" && builder.renderer.getMRT()?.has("velocity")) {
          // The pinned stock velocity node owns per-object old model and
          // per-instance/skin history. Correct its previous vertex in the
          // prior planet frame, then return to the model space it expects.
          const previousModel = velocity.previousModelWorldMatrix;
          const previousWorld = previousModel.mul(vec4(positionPrevious, 1)).xyz;
          positionPrevious.assign(previousModel.inverse()
            .mul(vec4(curvature.forwardNode(previousWorld, curvature.previousOrigin), 1)).xyz);
        }
        return modelWorldMatrixInverse.mul(vec4(curvature.forwardNode(world), 1)).xyz;
      })();
      if (!material.isMeshBasicMaterial && !material.flatShading) {
        const side = material.side === THREE.BackSide ? -1 : material.side === THREE.DoubleSide ? faceDirection : 1;
        material.normalNode = curvature.normalNode(normalWorldGeometry.mul(side), flat).transformDirection(cameraViewMatrix);
        if (material.isMeshPhysicalMaterial) material.clearcoatNormalNode = material.normalNode;
      }
      // MRT velocity has its own alpha=1. Invisible sprite corners and
      // opacity-zero plume cards would otherwise replace/add motion even
      // though their color contributes nothing. Discard only zero-alpha
      // fragments (and the negligible 1e-5 tail), preserving soft coverage.
      if (material.transparent) material.alphaTest = Math.max(material.alphaTest, 1e-5);
      // Referencing stock velocity keeps its object/camera update lifecycle
      // active for ordinary/stable-instance motion. Cuts reject old history.
      material.mrtNode = staticSurface ? staticSurface.mrt : surfaceVelocityMRT(
        mode === "reject" ? vec2(4) : select(curvature.historyValid.and(this._objectHistoryValid), velocity, vec2(4)));
      material.needsUpdate = true;
      this._materials.set(material, mode);
    }
  }

  prepareFallbackSea(sea) {
    if (!sea) return;
    // TestWorld's mesh already rotates an XY plane into the ground plane.
    // Radial subdivision is essential; merely bending its four corners
    // would leave another flat/conical horizon.
    const old = sea.geometry;
    sea.geometry = new THREE.RingGeometry(0, PLANET_OCEAN_EXTENT_M, 128, 96);
    old.dispose();
    sea.frustumCulled = false;
    this.fallbackSea = sea;
    this.attach(sea, { staticSurface: true });
  }

  // Run after game visual poses/instances and curvature.beginFrame(), before
  // rendering. This updates only shader contracts and render-culling bounds.
  update() {
    this._frame++;
    if (this.fallbackSea) {
      this.fallbackSea.position.x = this.curvature.origin.value.x;
      this.fallbackSea.position.z = this.curvature.origin.value.y;
    }
    for (const [object, record] of this._meshes) {
      const { mode } = record;
      // Wreck/team swaps replace material objects after registration.
      this._prepareMaterial(object, mode);
      if (!object.frustumCulled) continue;
      object.updateWorldMatrix(true, false);
      if (object.isInstancedMesh && object.instanceMatrix.version !== record.instanceVersion) {
        object.computeBoundingBox();
        record.instanceVersion = object.instanceMatrix.version;
      }
      const source = object.isInstancedMesh ? object.boundingBox : object.geometry.boundingBox;
      if (!source) continue;
      this._box.copy(source).applyMatrix4(object.matrixWorld);
      this.curvature.bounds(this._box, this._box).getBoundingSphere(this._sphere);
      this._inverse.copy(object.matrixWorld).invert();
      // Frustum.intersectsObject transforms this sphere by matrixWorld and
      // multiplies its radius by getMaxScaleOnAxis. Encode the desired world
      // sphere exactly; do not double-apply scale or rewrite geometry bounds.
      if (!object.boundingSphere) object.boundingSphere = new THREE.Sphere();
      object.boundingSphere.center.copy(this._sphere.center).applyMatrix4(this._inverse);
      object.boundingSphere.radius = this._sphere.radius / Math.max(object.matrixWorld.getMaxScaleOnAxis(), 1e-12);
    }
  }
}

export function attachRaptorPlanetObjects(bender, { world, player, battlefield, bandits }) {
  bender.attach(world.jet); // Includes all FlightFX children and worldFixed particles.
  bender.attach(world.pylons, { stableInstances: true });
  bender.attach(world.trailMesh);
  bender.prepareFallbackSea(world.sea);
  bender.attach(battlefield?.root);
  bender.attach(bandits?.root);
  for (const mesh of [player?.gun?.tracers, player?.gun?.puffMesh, player?.gun?.flash,
    player?.missiles?.bodies, player?.missiles?.trail]) bender.attach(mesh);
}
