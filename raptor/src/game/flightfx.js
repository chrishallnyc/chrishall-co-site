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
// for free via the normal parent/child matrix cascade. The visible effect
// geometry (discs/puffs) lives in its own group parented directly to
// `scene`, repositioned from those anchors each frame — same shape as
// testworld.js's retired contrail (Pool-backed InstancedMesh, positions
// resolved once per frame, no per-frame allocation past construction).
//
// Wingtip offset is EST from f22.js's WING table (root x=1.60, half-span
// 5.18, LE sweep 42deg / TE sweep 17deg -> tip mid-chord sits at local
// (~x=6.6, y=0.7, z=4.2) in the f22 model's own frame, forward=-Z/+X
// starboard/+Y up). Nozzle exit is the nozzle pivot's local (0,0,1.36) —
// the divergent-exit station in f22.js's nozzleGeometry().

import * as THREE from "three";
import { Pool } from "../engine/pools.js";

// ---- wingtip condensation vortex ----
const VORT_LIFE = 1.2;         // s — spec: fades over ~1.2s
const VORT_INTERVAL = 0.03;    // s between spawns per side while gated on
const VORT_CAP = 200;          // pool capacity, both wingtips combined
const VORT_SIZE = 0.55;        // m, peak puff radius
const VORT_ALPHA = 0.24;       // subtle white, not a ribbon of paper
const VORT_NZ_GATE = 4;        // |nz| >
const VORT_AOA_GATE = 15;      // alphaDeg >

// ---- afterburner plume (throttle > 1.0) ----
const AB_SPOOL_TAU = 0.4;      // s, EST light-off feel (f22data ENGINE.spoolTauAbS ~0.5)
const AB_STACK = [
  // distance fraction along the plume length, disc radius (m), tint, base opacity
  { d: 0.06, r: 0.60, color: 0xfff3d8, op: 0.95 }, // white-hot core at the nozzle lip
  { d: 0.32, r: 0.95, color: 0xffb058, op: 0.70 }, // orange mid
  { d: 0.72, r: 1.35, color: 0xff5a24, op: 0.42 }, // diffuse red-orange tail
];
const AB_LEN_BASE = 2.4, AB_LEN_AB = 3.6; // m, plume length at abStage 0 -> 1
const SHIMMER_D = 0.14, SHIMMER_R = 1.55; // heat-shimmer-suggestion quad

// ---- mil-power haze (very faint — F119 is smokeless-ish) ----
const SMOKE_TAU = 0.6;
const SMOKE_LIFE = 2.4;
const SMOKE_INTERVAL = 0.12;
const SMOKE_CAP = 48;
const SMOKE_SIZE = 0.9;
const SMOKE_ALPHA_MAX = 0.09;

const WINGTIP = { x: 6.6, y: 0.7, z: 4.2 }; // f22-model-local, mirrored for the L side
const NOZZLE_EXIT_Z = 1.36;                 // nozzle-pivot-local, aft along the pivot's +Z

function radialTexture(stops, size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) g.addColorStop(t, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

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

    // scratch — allocated once, mutated per frame, never replaced
    this._pTipL = new THREE.Vector3(); this._pTipR = new THREE.Vector3();
    this._pNozL = new THREE.Vector3(); this._pNozR = new THREE.Vector3();
    this._aftL = new THREE.Vector3(); this._aftR = new THREE.Vector3();
    this._viewTmp = new THREE.Vector3();
    this._mid = new THREE.Vector3();
    this._m4 = new THREE.Matrix4();

    this.group = new THREE.Group();
    this.group.name = "flightfx";
    scene.add(this.group);

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
    this.group.add(this._vortMesh);
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
    this.group.add(this._smokeMesh);
    this._smokePool = new Pool(SMOKE_CAP, () => ({ x: 0, y: 0, z: 0, age: 1e9 }));
    this._smokeCooldown = 0;

    // ---- 2. AB plume: fixed disc stack + heat-shimmer per nozzle, each a
    // camera-billboarded Mesh (lookAt each frame — same trick stars.js uses
    // for its moon/halo discs), additive for the hot core/mid/tail ----
    const abTex = radialTexture([[0, "rgba(255,255,255,1)"], [0.4, "rgba(255,255,255,0.6)"], [1, "rgba(255,255,255,0)"]]);
    const mkDisc = (color) => new THREE.Mesh(
      new THREE.CircleGeometry(1, 16),
      new THREE.MeshBasicMaterial({
        map: abTex, color, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false,
      })
    );
    const shimmerTex = radialTexture([[0, "rgba(255,230,190,0.35)"], [0.6, "rgba(255,210,160,0.12)"], [1, "rgba(255,210,160,0)"]]);
    const mkShimmer = () => new THREE.Mesh(
      new THREE.CircleGeometry(1, 12),
      new THREE.MeshBasicMaterial({ map: shimmerTex, transparent: true, opacity: 0, depthWrite: false, fog: false })
    );
    this._plumeL = AB_STACK.map((s) => mkDisc(s.color));
    this._plumeR = AB_STACK.map((s) => mkDisc(s.color));
    this._shimmerL = mkShimmer();
    this._shimmerR = mkShimmer();
    for (const m of [...this._plumeL, ...this._plumeR, this._shimmerL, this._shimmerR]) this.group.add(m);

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

    this._placeStack(this._plumeL, this._pNozL, this._aftL, len, stage, camera, 0);
    this._placeStack(this._plumeR, this._pNozR, this._aftR, len, stage, camera, 1);
    this._placeShimmer(this._shimmerL, this._pNozL, this._aftL, len, stage, camera, 0);
    this._placeShimmer(this._shimmerR, this._pNozR, this._aftR, len, stage, camera, 1);
  }

  // ~1 = camera behind the jet looking up the tailpipe (brightest), ~-1 = camera ahead
  _viewFacing(nozPos, aft, camera) {
    this._viewTmp.copy(camera.position).sub(nozPos).normalize();
    return this._viewTmp.dot(aft);
  }

  _placeStack(discs, nozPos, aft, len, stage, camera, side) {
    const boost = 0.75 + 0.5 * Math.max(0, this._viewFacing(nozPos, aft, camera));
    for (let i = 0; i < discs.length; i++) {
      const spec = AB_STACK[i], mesh = discs[i];
      if (stage < 0.01) { mesh.material.opacity = 0; continue; }
      const flick = 1 + 0.10 * Math.sin(this._t * 41 + i * 2.3 + side * 5) + 0.06 * Math.sin(this._t * 97 + i * 4.1);
      const dist = spec.d * len;
      mesh.position.set(nozPos.x + aft.x * dist, nozPos.y + aft.y * dist, nozPos.z + aft.z * dist);
      mesh.lookAt(camera.position);
      const r = spec.r * (0.55 + 0.45 * stage) * flick;
      mesh.scale.set(r, r, r);
      mesh.material.opacity = spec.op * stage * boost * flick;
    }
  }

  _placeShimmer(mesh, nozPos, aft, len, stage, camera, side) {
    if (stage < 0.01) { mesh.material.opacity = 0; return; }
    const dist = SHIMMER_D * len;
    const wob = 1 + 0.08 * Math.sin(this._t * 17 + side * 3);
    mesh.position.set(nozPos.x + aft.x * dist, nozPos.y + aft.y * dist, nozPos.z + aft.z * dist);
    mesh.lookAt(camera.position);
    const r = SHIMMER_R * (0.7 + 0.3 * stage) * wob;
    mesh.scale.set(r, r, r);
    mesh.material.opacity = 0.10 * stage;
  }

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
