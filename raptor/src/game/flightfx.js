// FlightFX v1 — FM-driven wingtip condensation vortices, afterburner plume,
// and a barely-there mil-power haze trail. Render-side only: consumes
// fm.out telemetry + throttleCmd every frame, never touches sim state or
// SimCore (it's cosmetic, not a determinism-bearing system — no hash(),
// no tick()). Shape matches the other render-side systems in this codebase
// (terrain/water/clouds all expose `update(camera, ...)`); this one is
// `update(fmOut, throttleCmd, dt, camera)`.
//
// Anchors: rather than re-deriving wingtip/nozzle-exit world positions by
// hand every frame, we park a few invisible Object3Ds INSIDE the F-22's own
// scene graph — as children of the nose-flipped "f22" group and the two
// nozzle pivot groups — so they inherit every transform (current jet
// attitude, testworld's Math.PI nose flip, any future TVC nozzle animation)
// for free via the normal parent/child matrix cascade.
//
// IMPORTANT — everything VISIBLE this class creates is parented somewhere
// inside jetGroup's existing subtree too, NEVER added straight to `scene`.
// Verified empirically (see devlog): this build's renderer only draws
// objects that live under something that was already in the scene graph
// when the render loop started — a brand-new top-level `scene.add(x)` after
// boot silently never renders (confirmed with plain, untextured, non-
// transparent test meshes; mutating an EXISTING object's material updates
// instantly). The exhaust volumes are children of `parts.nozzleL/R`
// directly (plain local coordinates — no manual world-space placement
// needed). The vortex/smoke InstancedMeshes need to stay put in WORLD space
// while the jet flies on, so they live under a `_worldFixed` group that IS
// a child of jetGroup (satisfying "already in the tree") but whose local
// matrix is reset every frame to jetGroup.matrixWorld's inverse — the two
// cancel, so instance matrices set in absolute world coordinates (exactly
// as before) land in the right place regardless of where the jet is.
//
// Current aircraft declare wingtip and exhaust anchors in model metadata.
// Legacy models retain the original estimates below as a compatibility path.

import * as THREE from "three";
import { Pool } from "../engine/pools.js";
import { createExhaustPlume, updateExhaustPlume } from "../aircraft/exhaust-plume.js";

// ---- wingtip condensation vortex ----
const VORT_LIFE = 1.2;         // s — spec: fades over ~1.2s
const VORT_INTERVAL = 0.009;   // s between spawns per side while gated on — dense
                                // enough that puffs overlap into a streak at
                                // typical corner speeds instead of reading as dots
const VORT_CAP = 320;          // pool capacity, both wingtips combined
const VORT_SIZE = 1.0;         // m, peak puff radius
const VORT_ALPHA = 0.32;       // subtle white, not a ribbon of paper
const VORT_NZ_GATE = 4;        // |nz| >
const VORT_AOA_GATE = 15;      // alphaDeg >
const VORT_MAX_FRAME = 0.1;   // longer gaps restart at the current tip, never bridge a stall
const VORT_MAX_EMISSIONS = 12; // bounded catch-up for the 9 ms cadence
const VORT_CUT_DISTANCE = 250; // fallback for callers without a render-pose revision

// ---- afterburner plume (throttle > 1.0) ----
const AB_SPOOL_TAU = 0.4;      // s, EST light-off feel (f22data ENGINE.spoolTauAbS ~0.5)
const AB_LEN_BASE = 2.6, AB_LEN_AB = 5.2; // metres; maximum AB remains long and narrow

// ---- mil-power haze (very faint — F119 is smokeless-ish) ----
const SMOKE_TAU = 0.6;
const SMOKE_LIFE = 2.4;
const SMOKE_INTERVAL = 0.12;
const SMOKE_CAP = 48;
const SMOKE_SIZE = 0.9;
const SMOKE_ALPHA_MAX = 0.012;

const WINGTIP = { x: 6.6, y: 0.35, z: 4.2 }; // f22-model-local, mirrored for the L side (y re-anchored to v3's drooped tip, D-052)
const NOZZLE_EXIT_Z = 1.36;                 // nozzle-pivot-local, aft along the pivot's +Z

export class FlightFX {
  // jetGroup: the F-22's outer world-space group (testworld's `world.jet` /
  // player's `this.jet`). parts: the f22.js rig (`f22parts`) — only
  // `nozzleL`/`nozzleR` are read. `camera`, passed to update(), is only ever
  // read via its `.position` (a THREE.Vector3) — any object shaped that way
  // works, which keeps this class trivially testable without the real
  // renderer/camera.
  constructor(scene, { jetGroup, parts }) {
    this.jetGroup = jetGroup;

    // ---- anchors, parked inside the model's own hierarchy ----
    const f22Group = parts.nozzleL.parent; // the Math.PI-flipped "f22" group
    const attachments = f22Group.userData.aircraft?.attachments;
    this._tipL = new THREE.Object3D();
    this._tipL.position.fromArray(attachments?.wingtipL?.position ?? [-WINGTIP.x, WINGTIP.y, WINGTIP.z]);
    this._tipR = new THREE.Object3D();
    this._tipR.position.fromArray(attachments?.wingtipR?.position ?? [WINGTIP.x, WINGTIP.y, WINGTIP.z]);
    f22Group.add(this._tipL, this._tipR);
    this._nozL = new THREE.Object3D();
    this._nozL.position.fromArray(attachments?.nozzleL?.position ?? [0, 0, NOZZLE_EXIT_Z]);
    this._nozR = new THREE.Object3D();
    this._nozR.position.fromArray(attachments?.nozzleR?.position ?? [0, 0, NOZZLE_EXIT_Z]);
    parts.nozzleL.add(this._nozL);
    parts.nozzleR.add(this._nozR);

    // world-fixed anchor for the vortex/smoke trails — see file header. A
    // child of jetGroup (so the renderer picks it up) whose local matrix is
    // overwritten every update() with jetGroup's inverse world matrix, so
    // its own children's absolute-world instance transforms are unaffected
    // by where the jet actually is.
    this._worldFixed = new THREE.Group();
    this._worldFixed.matrixAutoUpdate = false;
    jetGroup.add(this._worldFixed);

    // scratch — allocated once, mutated per frame, never replaced
    this._pTipL = new THREE.Vector3(); this._pTipR = new THREE.Vector3();
    this._prevTipL = new THREE.Vector3(); this._prevTipR = new THREE.Vector3();
    this._vortSpawn = new THREE.Vector3();
    this._pNozL = new THREE.Vector3(); this._pNozR = new THREE.Vector3();
    this._aftL = new THREE.Vector3(); this._aftR = new THREE.Vector3();
    this._mid = new THREE.Vector3();
    this._m4 = new THREE.Matrix4();
    this._invWorld = new THREE.Matrix4();

    // ---- 1. wingtip vortex: instanced puffs, Pool-backed (testworld's
    // retired-contrail pattern — sphere geometry so no billboard bookkeeping
    // is needed, it reads as a puff from any angle) ----
    this._vortMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: VORT_ALPHA, depthWrite: false }),
      VORT_CAP
    );
    this._vortMesh.frustumCulled = false;
    this._vortMesh.count = 0;
    this._worldFixed.add(this._vortMesh);
    this._vortPool = new Pool(VORT_CAP, () => ({ x: 0, y: 0, z: 0, age: 1e9 }));
    this._vortCooldown = VORT_INTERVAL;
    this._vortHistoryReady = false;
    this._vortWasOn = false;
    this._renderPoseVersion = null;

    // ---- 3. mil-power haze: same shape, darker/fainter/slower ----
    this._smokeMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0x28282a, transparent: true, opacity: SMOKE_ALPHA_MAX, depthWrite: false }),
      SMOKE_CAP
    );
    this._smokeMesh.frustumCulled = false;
    this._smokeMesh.count = 0;
    this._worldFixed.add(this._smokeMesh);
    this._smokePool = new Pool(SMOKE_CAP, () => ({ x: 0, y: 0, z: 0, age: 1e9 }));
    this._smokeCooldown = 0;

    // Longitudinal radiance follows the actual vectoring nozzles. Resource
    // geometry and textures are shared; opacity is independent per engine.
    this._plumeL = createExhaustPlume(this._nozL, 0);
    this._plumeR = createExhaustPlume(this._nozR, 1);
    this._liners = [];
    for (const nozzle of [parts.nozzleL, parts.nozzleR]) nozzle.traverse(object => {
      if (object.isMesh && object.material.name === 'F119-ceramic-liner') this._liners.push(object);
    });

    this._t = 0;
    this._abStage = 0;
    this._smokeStage = 0;
  }

  // fmOut: FlightModel.out ({V, mach, alphaDeg, nz, ...}). throttleCmd: 0..1.1.
  // camera: only `.position` is read.
  // renderPoseVersion changes on a respawn/teleport, including nearby cuts.
  update(fmOut, throttleCmd, dt, camera, renderPoseVersion = 0) {
    if (renderPoseVersion !== this._renderPoseVersion) {
      this.resetTrails();
      this._renderPoseVersion = renderPoseVersion;
    }
    this._t += dt;
    // force the f22 rig's matrixWorld fresh THIS frame (player.render() just
    // moved jetGroup; the renderer's own cascade hasn't run yet) so anchors
    // read the current position, not last frame's.
    this.jetGroup.updateMatrixWorld(true);

    // re-cancel jetGroup's (now-fresh) world transform on the vortex/smoke
    // anchor, then push that fix down into its own subtree.
    this._invWorld.copy(this.jetGroup.matrixWorld).invert();
    this._worldFixed.matrix.copy(this._invWorld);
    this._worldFixed.updateMatrixWorld(true);

    this._tipL.getWorldPosition(this._pTipL);
    this._tipR.getWorldPosition(this._pTipR);
    this._nozL.getWorldPosition(this._pNozL);
    this._nozR.getWorldPosition(this._pNozR);
    this._aftL.set(0, 0, 1).transformDirection(this._nozL.matrixWorld);
    this._aftR.set(0, 0, 1).transformDirection(this._nozR.matrixWorld);

    this._updateVortices(fmOut, dt);
    this._updateAB(fmOut, throttleCmd, dt, camera);
    this._updateSmoke(throttleCmd, dt);
  }

  // ---- 1. wingtip condensation vortices ----
  _updateVortices(fmOut, dt) {
    const elapsed = Math.max(0, dt);
    const on = Math.abs(fmOut.nz) > VORT_NZ_GATE || fmOut.alphaDeg > VORT_AOA_GATE;
    if (this._vortHistoryReady && (
      this._pTipL.distanceToSquared(this._prevTipL) > VORT_CUT_DISTANCE ** 2
      || this._pTipR.distanceToSquared(this._prevTipR) > VORT_CUT_DISTANCE ** 2
    )) this.resetTrails();

    // Age old samples first; new samples carry only the elapsed time since
    // their own sub-frame emission. This keeps size and spacing consistent
    // when a render frame contains several 9 ms trail intervals.
    this._vortPool.forEachLive((p, i) => {
      p.age += elapsed;
      if (p.age > VORT_LIFE) this._vortPool.release(i);
    });
    if (on && elapsed > 0) {
      if (this._vortHistoryReady && this._vortWasOn && elapsed <= VORT_MAX_FRAME) {
        this._vortCooldown -= elapsed;
        let emitted = 0;
        while (this._vortCooldown <= 1e-9 && emitted++ < VORT_MAX_EMISSIONS) {
          const age = Math.max(0, -this._vortCooldown);
          const fraction = Math.max(0, Math.min(1, 1 - age / elapsed));
          this._vortSpawn.lerpVectors(this._prevTipL, this._pTipL, fraction);
          this._spawn(this._vortPool, this._vortSpawn, age);
          this._vortSpawn.lerpVectors(this._prevTipR, this._pTipR, fraction);
          this._spawn(this._vortPool, this._vortSpawn, age);
          this._vortCooldown += VORT_INTERVAL;
        }
      } else {
        // A new trail, pose cut, or long frame has no reliable old segment.
        this._spawn(this._vortPool, this._pTipL);
        this._spawn(this._vortPool, this._pTipR);
        this._vortCooldown = VORT_INTERVAL;
      }
    } else if (!on) {
      this._vortCooldown = VORT_INTERVAL;
    }
    this._prevTipL.copy(this._pTipL);
    this._prevTipR.copy(this._pTipR);
    this._vortHistoryReady = true;
    this._vortWasOn = on;
    let n = 0;
    this._vortPool.forEachLive((p) => {
      const t = p.age / VORT_LIFE;
      const grow = Math.min(1, p.age / 0.15);          // quick pop-in
      const fade = Math.max(0, 1 - Math.pow(t, 1.6));  // lingers, then dissipates
      const s = VORT_SIZE * grow * fade;
      this._m4.makeScale(s, s, s);
      this._m4.setPosition(p.x, p.y, p.z);
      this._vortMesh.setMatrixAt(n++, this._m4);
    });
    this._vortMesh.count = n;
    if (n > 0) this._vortMesh.instanceMatrix.needsUpdate = true;
  }

  resetTrails() {
    for (const pool of [this._vortPool, this._smokePool]) {
      pool.forEachLive((_p, i) => pool.release(i));
    }
    this._vortMesh.count = this._smokeMesh.count = 0;
    this._vortCooldown = VORT_INTERVAL;
    this._smokeCooldown = 0;
    this._vortHistoryReady = false;
    this._vortWasOn = false;
  }

  _spawn(pool, worldPos, age = 0) {
    const { item } = pool.acquire();
    item.x = worldPos.x; item.y = worldPos.y; item.z = worldPos.z; item.age = age;
  }

  // ---- 2. afterburner plume ----
  _updateAB(fmOut, throttleCmd, dt, camera) {
    const target = Math.max(0, Math.min(1, (throttleCmd - 1.0) / 0.1));
    this._abStage += (target - this._abStage) * Math.min(1, dt / AB_SPOOL_TAU);
    const stage = this._abStage;
    const machBoost = 1 + Math.min(fmOut.mach, 2) * 0.15; // plume elongates a bit at speed/altitude
    const len = (AB_LEN_BASE + (AB_LEN_AB - AB_LEN_BASE) * stage) * machBoost;

    updateExhaustPlume(this._plumeL, stage, len, this._t, camera.position);
    updateExhaustPlume(this._plumeR, stage, len, this._t, camera.position);
    for (const mesh of this._liners) {
      mesh.material.emissive?.setRGB(.30 * stage, .045 * stage, .005 * stage);
    }
  }

  // ---- 3. mil-power haze (very faint, no AB) ----
  _updateSmoke(throttleCmd, dt) {
    const target = Math.max(0, Math.min(1, (throttleCmd - 0.55) / 0.45)) * (1 - this._abStage);
    this._smokeStage += (target - this._smokeStage) * Math.min(1, dt / SMOKE_TAU);
    this._smokeCooldown -= dt;
    if (this._smokeStage > 0.02 && this._smokeCooldown <= 0) {
      this._smokeCooldown = SMOKE_INTERVAL;
      this._mid.copy(this._pNozL).add(this._pNozR).multiplyScalar(0.5);
      this._spawn(this._smokePool, this._mid);
    }
    let n = 0;
    this._smokePool.forEachLive((p, i) => {
      p.age += dt;
      if (p.age > SMOKE_LIFE) { this._smokePool.release(i); return; }
      const t = p.age / SMOKE_LIFE;
      const s = SMOKE_SIZE * (0.6 + t * 0.8); // grows as it disperses
      this._m4.makeScale(s, s, s);
      this._m4.setPosition(p.x, p.y, p.z);
      this._smokeMesh.setMatrixAt(n++, this._m4);
    });
    this._smokeMesh.count = n;
    if (n > 0) this._smokeMesh.instanceMatrix.needsUpdate = true;
    this._smokeMesh.material.opacity = SMOKE_ALPHA_MAX * (0.3 + 0.7 * this._smokeStage);
  }
}
