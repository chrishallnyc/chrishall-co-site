// FlightFX consumes telemetry without writing simulation state. Wingtip and
// nozzle anchors stay in the aircraft rig. The axial plume inherits its nozzle
// pivot; the world-fixed particle group cancels its parent world transform.
import * as THREE from "three";
import { Pool } from "../engine/pools.js";
import { createAfterburnerResources, createNozzlePlume, updateNozzlePlume } from "./afterburner.js";

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

// ---- afterburner plume (throttle > 1.0) ----
const AB_SPOOL_TAU = 0.4;      // s, EST light-off feel (f22data ENGINE.spoolTauAbS ~0.5)
const AB_LEN_BASE = 4.2, AB_LEN_AB = 7.5; // m, plume length at abStage 0 -> 1

// ---- mil-power haze (very faint — F119 is smokeless-ish) ----
const SMOKE_TAU = 0.6;
const SMOKE_LIFE = 2.4;
const SMOKE_INTERVAL = 0.12;
const SMOKE_CAP = 48;
const SMOKE_SIZE = 0.9;
const SMOKE_ALPHA_MAX = 0.09;

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
    this._tipL = new THREE.Object3D();
    this._tipL.position.set(-WINGTIP.x, WINGTIP.y, WINGTIP.z);
    this._tipR = new THREE.Object3D();
    this._tipR.position.set(WINGTIP.x, WINGTIP.y, WINGTIP.z);
    f22Group.add(this._tipL, this._tipR);
    this._nozL = new THREE.Object3D();
    this._nozL.position.set(0, 0, NOZZLE_EXIT_Z);
    this._nozR = new THREE.Object3D();
    this._nozR.position.set(0, 0, NOZZLE_EXIT_Z);
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
    this._pNozL = new THREE.Vector3(); this._pNozR = new THREE.Vector3();
    this._aftL = new THREE.Vector3(); this._aftR = new THREE.Vector3();
    this._viewTmp = new THREE.Vector3();
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
    this._vortCooldown = 0;

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

    // Render-only axial plume; stock materials and stable object transforms
    // retain PlanetObjectBender's current/prior motion and probe contracts.
    this._abResources = createAfterburnerResources();
    this._abL = createNozzlePlume(parts.nozzleL, this._abResources);
    this._abR = createNozzlePlume(parts.nozzleR, this._abResources);
    // Keep diagnostic mesh lists stable across the old/new rendering paths.
    this._plumeL = [this._abL.ribbon, this._abL.aperture];
    this._plumeR = [this._abR.ribbon, this._abR.aperture];

    this._t = 0;
    this._abStage = 0;
    this._smokeStage = 0;
  }

  // fmOut: FlightModel.out ({V, mach, alphaDeg, nz, ...}). throttleCmd: 0..1.1.
  // camera: only `.position` is read.
  update(fmOut, throttleCmd, dt, camera) {
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
    const on = Math.abs(fmOut.nz) > VORT_NZ_GATE || fmOut.alphaDeg > VORT_AOA_GATE;
    this._vortCooldown -= dt;
    if (on && this._vortCooldown <= 0) {
      this._vortCooldown = VORT_INTERVAL;
      this._spawn(this._vortPool, this._pTipL);
      this._spawn(this._vortPool, this._pTipR);
    }
    let n = 0;
    this._vortPool.forEachLive((p, i) => {
      p.age += dt;
      if (p.age > VORT_LIFE) { this._vortPool.release(i); return; }
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

  _spawn(pool, worldPos) {
    const { item } = pool.acquire();
    item.x = worldPos.x; item.y = worldPos.y; item.z = worldPos.z; item.age = 0;
  }

  // ---- 2. afterburner plume ----
  _updateAB(fmOut, throttleCmd, dt, camera) {
    const target = Math.max(0, Math.min(1, (throttleCmd - 1.0) / 0.1));
    this._abStage += (target - this._abStage) * Math.min(1, dt / AB_SPOOL_TAU);
    const stage = this._abStage;
    const machBoost = 1 + Math.min(fmOut.mach, 2) * 0.15; // plume elongates a bit at speed/altitude
    const len = (AB_LEN_BASE + (AB_LEN_AB - AB_LEN_BASE) * stage) * machBoost;

    updateNozzlePlume(this._abL, { length: len, stage, time: this._t, side: 0, camera });
    updateNozzlePlume(this._abR, { length: len, stage, time: this._t, side: 1, camera });
  }

  // Idempotent release of this FlightFX instance's afterburner resources.
  // Existing vortex/smoke lifetime is unchanged.
  disposeAfterburner() { this._abResources.dispose(); }

  // ---- 3. mil-power haze (very faint, no AB) ----
  _updateSmoke(throttleCmd, dt) {
    const target = Math.max(0, Math.min(1, (throttleCmd - 0.55) / 0.45));
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
