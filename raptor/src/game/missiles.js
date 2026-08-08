// AIM-9X pool (phase 8): imaging-IR seeker locked onto battlefield heat
// sources (the 9X has demonstrated surface-target capability — the convoy's
// running engines are honest IR targets), proportional-navigation guidance,
// real motor phases burning real propellant mass, drag over current mass.
// Deterministic: target selection is min-angle (ties -> lowest index), no
// rng anywhere; pool state folds into the player hash.
//
// PHASE 11 INC-4 (W1/W2): tick takes an optional TargetDirectory (targets.js
// makeDirectory) as the trailing param. With a directory the seeker/lock loop
// iterates the unified tid space (battlefield 0..cap-1 then bandits 4096+,
// min-angle ties -> lowest tid) and prop-nav runs the MOVING-target form
// dR/dt = v_tgt − v_m (the battlefield SAM's law; directory.vel supplies
// v_tgt — driving convoy trucks and bandits). With directory null the
// battlefield param works exactly as before: v_tgt = 0 reduces the math
// bit-identically to the old static form (verified term-by-term — IEEE sign
// flips are exact), so phase-8 seeds replay unchanged on that path. W2
// changes sim numerics on the directory path => SIM_VERSION 2 (engine/sim.js).

import * as THREE from "three";
import { AIM9X } from "../sim/weapondata.js";
import { S } from "../sim/flight.js";
import { softDiscTexture } from "../engine/sprites.js";

const LOADOUT = 4;
const SLOTS = 9; // x,y,z, vx,vy,vz, massKg, age, targetIdx
const SEEK_COS = Math.cos(25 * Math.PI / 180); // v1 acquisition cone (HOBS later)
const SEEK_MIN = 400, SEEK_MAX = 8000;
const LOCK_TIME = 0.7;
const PROX_M = 7;
const DMG = 90;
const LIFE_S = 10;
const G0 = 9.80665;
const MAX_PUFF = 320;

const M = AIM9X.motor;
const MDOT_BOOST = M.propellantMassKg * M.boostPropFraction / M.boostDurationS;
const MDOT_SUST = M.propellantMassKg * (1 - M.boostPropFraction) / M.sustainDurationS;
const T_SUST_END = M.boostDurationS + M.sustainDurationS;

export class Missiles {
  constructor(scene) {
    this.ammo = LOADOUT;
    this.kills = 0;
    this.r = new Float64Array(LOADOUT * SLOTS);
    this.live = new Uint8Array(LOADOUT);
    // seeker
    this.lockTarget = -1;
    this.lockProgress = 0;

    // render: missile bodies + smoke trail
    const bGeo = new THREE.BoxGeometry(0.13, 0.13, 3.0);
    const bMat = new THREE.MeshBasicMaterial({ color: 0xe8e6df });
    this.bodies = new THREE.InstancedMesh(bGeo, bMat, LOADOUT);
    this.bodies.frustumCulled = false;
    this.bodies.count = 0;
    scene.add(this.bodies); // boot-time add — safe

    const pGeo = new THREE.PlaneGeometry(2.2, 2.2);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xcfd2d6, map: softDiscTexture(), transparent: true, opacity: 0.4, depthWrite: false });
    this.trail = new THREE.InstancedMesh(pGeo, pMat, MAX_PUFF);
    this.trail.frustumCulled = false;
    this.trail.count = 0;
    scene.add(this.trail);
    this.puffs = []; // {x,y,z (ENU), age} render-side, fed at spawn spacing
    this._lastPuff = new Float64Array(LOADOUT * 3);
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._dir = new THREE.Vector3();
    this._tp = new Float64Array(3); // W1 scratch: directory pos/vel out args
    this._tv = new Float64Array(3); // (zero-allocation hot path, targets.js contract)
  }

  locked() { return this.lockTarget >= 0 && this.lockProgress >= LOCK_TIME; }

  // directory (optional, W1): TargetDirectory over battlefield+bandits; when
  // present it owns seek/guide/damage and lockTarget/r[o+8] hold tids. When
  // null the battlefield param behaves exactly as shipped in phase 8.
  tick(sim, dt, fm, battlefield, fireEdge, directory = null) {
    const st = fm.state;
    // ---- seeker: min angle-off-nose inside cone + range band ----
    if (directory || battlefield) {
      const qw = st[S.QW], qx = st[S.QX], qy = st[S.QY], qz = st[S.QZ];
      const fx = 1 - 2 * (qy * qy + qz * qz), fy = 2 * (qx * qy + qw * qz), fz = 2 * (qx * qz - qw * qy);
      let best = -1, bestCos = SEEK_COS;
      if (directory) {
        // unified id space; tid(i) is strictly increasing in i, so the strict
        // > keeps the deterministic tie-break: min angle, lowest tid
        const tp = this._tp, n = directory.count();
        for (let i = 0; i < n; i++) {
          const t = directory.tid(i);
          if (!directory.alive(t)) continue;
          directory.pos(t, tp);
          const dx = tp[0] - st[S.PX], dy = tp[1] - st[S.PY], dz = tp[2] - st[S.PZ];
          const d = Math.hypot(dx, dy, dz);
          if (d < SEEK_MIN || d > SEEK_MAX) continue;
          const c = (dx * fx + dy * fy + dz * fz) / d;
          if (c > bestCos) { bestCos = c; best = t; }
        }
      } else {
        for (let i = 0; i < battlefield.n; i++) {
          const o = i * 5;
          if (battlefield.state[o + 4] <= 0) continue;
          const dx = battlefield.state[o] - st[S.PX], dy = battlefield.state[o + 1] - st[S.PY], dz = battlefield.state[o + 2] - st[S.PZ];
          const d = Math.hypot(dx, dy, dz);
          if (d < SEEK_MIN || d > SEEK_MAX) continue;
          const c = (dx * fx + dy * fy + dz * fz) / d;
          if (c > bestCos) { bestCos = c; best = i; }
        }
      }
      if (best === this.lockTarget && best >= 0) this.lockProgress = Math.min(this.lockProgress + dt, LOCK_TIME + 1);
      else { this.lockTarget = best; this.lockProgress = 0; }
    }

    // ---- launch on edge, locked only ----
    if (fireEdge && this.ammo > 0 && this.locked()) {
      const slot = this.ammo - 1; // fixed rail order keeps slots deterministic
      this.ammo--;
      const qw = st[S.QW], qx = st[S.QX], qy = st[S.QY], qz = st[S.QZ];
      // wingtip rail in body FRD (fwd 0.5, right ±5, down 0.4) -> ENU
      const side = slot % 2 === 0 ? 1 : -1;
      const bx = 0.5, by = 5 * side, bz = 0.4;
      const rx = bx * (1 - 2 * (qy * qy + qz * qz)) + by * (2 * (qx * qy - qw * qz)) + bz * (2 * (qx * qz + qw * qy));
      const ry = bx * (2 * (qx * qy + qw * qz)) + by * (1 - 2 * (qx * qx + qz * qz)) + bz * (2 * (qy * qz - qw * qx));
      const rz = bx * (2 * (qx * qz - qw * qy)) + by * (2 * (qy * qz + qw * qx)) + bz * (1 - 2 * (qx * qx + qy * qy));
      const o = slot * SLOTS, r = this.r;
      r[o] = st[S.PX] + rx; r[o + 1] = st[S.PY] + ry; r[o + 2] = st[S.PZ] + rz;
      r[o + 3] = st[S.VX]; r[o + 4] = st[S.VY]; r[o + 5] = st[S.VZ];
      r[o + 6] = AIM9X.massKg; r[o + 7] = 0; r[o + 8] = this.lockTarget;
      this.live[slot] = 1;
      this._lastPuff.set([r[o], r[o + 1], r[o + 2]], slot * 3);
    }

    // ---- flight ----
    for (let m = 0; m < LOADOUT; m++) {
      if (!this.live[m]) continue;
      const o = m * SLOTS, r = this.r;
      const age = r[o + 7];
      // motor: boost / sustain / coast, burning mass
      let thrust = 0, mdot = 0;
      if (age < M.boostDurationS) { thrust = M.thrustBoostN; mdot = MDOT_BOOST; }
      else if (age < T_SUST_END) { thrust = M.thrustSustainN; mdot = MDOT_SUST; }
      r[o + 6] = Math.max(r[o + 6] - mdot * dt, AIM9X.massKg - M.propellantMassKg);
      const mass = r[o + 6];

      let vx = r[o + 3], vy = r[o + 4], vz = r[o + 5];
      const v = Math.hypot(vx, vy, vz) || 1;
      // thrust along velocity; ISA density for drag over CURRENT mass
      const rho = 1.225 * Math.exp(-Math.max(r[o + 2], 0) / 8500);
      const acc = thrust / mass - 0.5 * rho * v * v * AIM9X.aero.dragCd * AIM9X.aero.refAreaM2 / mass;
      vx += (vx / v) * acc * dt; vy += (vy / v) * acc * dt; vz += (vz / v) * acc * dt - G0 * dt;

      // proportional navigation toward the locked unit (W2: generalized to
      // MOVING targets — the battlefield SAM's form)
      const tgt = r[o + 8] | 0;
      const tp = this._tp, tv = this._tv;
      let track = false;
      if (tgt >= 0) {
        if (directory) {
          if (directory.alive(tgt)) { directory.pos(tgt, tp); directory.vel(tgt, tv); track = true; }
        } else if (battlefield && battlefield.state[tgt * 5 + 4] > 0) {
          const to = tgt * 5;
          tp[0] = battlefield.state[to]; tp[1] = battlefield.state[to + 1]; tp[2] = battlefield.state[to + 2];
          tv[0] = 0; tv[1] = 0; tv[2] = 0; // static special case == old math bit-identically
          track = true;
        }
      }
      if (track) {
        const Rx = tp[0] - r[o], Ry = tp[1] - r[o + 1], Rz = tp[2] - r[o + 2];
        const Rm = Math.hypot(Rx, Ry, Rz) || 1;
        // LOS rate omega = (R x dR/dt) / |R|^2 with dR/dt = v_tgt - v_m
        // (journal sign law: dR/dt = -v for static — the +v flip steers AWAY,
        // cost one full test miss); a_cmd = N * Vc * (omega x v_hat)
        const dRx = tv[0] - vx, dRy = tv[1] - vy, dRz = tv[2] - vz;
        const Vc = -(Rx * dRx + Ry * dRy + Rz * dRz) / Rm; // true closing speed
        const wx = (Ry * dRz - Rz * dRy) / (Rm * Rm);
        const wy = (Rz * dRx - Rx * dRz) / (Rm * Rm);
        const wz = (Rx * dRy - Ry * dRx) / (Rm * Rm);
        let ax = AIM9X.guidance.N * Vc * (wy * vz - wz * vy) / v;
        let ay = AIM9X.guidance.N * Vc * (wz * vx - wx * vz) / v;
        let az = AIM9X.guidance.N * Vc * (wx * vy - wy * vx) / v;
        // authority: 60G ceiling tapering with dynamic pressure (TVC only
        // partly compensates once the motor is out)
        const qbar = 0.5 * rho * v * v;
        const gCap = AIM9X.guidance.maxGLoad * G0 * Math.min(1, qbar / AIM9X.guidance.controlAuthorityQrefPa + (age < T_SUST_END ? 0.6 : 0.1));
        const am = Math.hypot(ax, ay, az);
        if (am > gCap) { ax *= gCap / am; ay *= gCap / am; az *= gCap / am; }
        vx += ax * dt; vy += ay * dt; vz += az * dt;
        // induced drag (L/D ~4): hard corrections bleed speed — honesty
        // applies to our own missiles too
        const aL = Math.min(Math.hypot(ax, ay, az), gCap);
        const vb = Math.hypot(vx, vy, vz) || 1;
        const bleed = (aL / 4) * dt / vb;
        vx -= vx * bleed; vy -= vy * bleed; vz -= vz * bleed;
        // proximity fuse (damage routes to the tid's owning list via the
        // directory when present — battlefield semantics on both sides)
        if (Rm < PROX_M) {
          if (directory) directory.damage(tgt, DMG); else battlefield.damage(tgt, DMG);
          this.kills++;
          this.live[m] = 0;
          this.puffs.push({ x: r[o], y: r[o + 1], z: r[o + 2], age: 0, boom: true });
          continue;
        }
      }
      r[o + 3] = vx; r[o + 4] = vy; r[o + 5] = vz;
      r[o] += vx * dt; r[o + 1] += vy * dt; r[o + 2] += vz * dt;
      r[o + 7] = age + dt;
      // trail puff every ~12m of travel (sim-side spawn keeps it deterministic-shaped)
      const lp = this._lastPuff, l3 = m * 3;
      const pd = Math.hypot(r[o] - lp[l3], r[o + 1] - lp[l3 + 1], r[o + 2] - lp[l3 + 2]);
      if (pd > 12 && this.puffs.length < MAX_PUFF) {
        this.puffs.push({ x: r[o], y: r[o + 1], z: r[o + 2], age: 0 });
        lp.set([r[o], r[o + 1], r[o + 2]], l3);
      }
      const gh = battlefield && battlefield.terrain ? battlefield.terrain.heightAt(r[o], r[o + 1]) : 0;
      if (r[o + 2] <= Math.max(gh, 0) || age > LIFE_S) this.live[m] = 0;
    }
  }

  hash(h) {
    const H = (x) => (Math.imul(h ^ ((x * 1e3) | 0), 0x01000193)) >>> 0;
    for (let i = 0; i < this.r.length; i++) h = H(this.r[i]);
    h = H(this.ammo); h = H(this.lockTarget);
    return h;
  }

  render(dt, camera) {
    let n = 0;
    for (let m = 0; m < LOADOUT; m++) {
      if (!this.live[m]) continue;
      const o = m * SLOTS, r = this.r;
      this._dir.set(r[o + 3], r[o + 5], r[o + 4]).normalize();
      this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._dir);
      this._m4.makeRotationFromQuaternion(this._q);
      this._m4.setPosition(r[o], r[o + 2], r[o + 1]);
      this.bodies.setMatrixAt(n++, this._m4);
    }
    this.bodies.count = n;
    this.bodies.instanceMatrix.needsUpdate = true;

    let p = 0;
    for (const puff of this.puffs) {
      puff.age += dt;
      const life = puff.boom ? 2.2 : 6.0;
      if (puff.age > life) continue;
      const s = puff.boom ? 1 + puff.age * 9 : 0.5 + puff.age * 0.5;
      this._m4.makeRotationFromQuaternion(camera.quaternion);
      this._m4.scale(new THREE.Vector3(s, s, s));
      this._m4.setPosition(puff.x, puff.z, puff.y); // ENU -> three
      if (p < MAX_PUFF) this.trail.setMatrixAt(p++, this._m4);
    }
    this.trail.count = p;
    this.trail.instanceMatrix.needsUpdate = true;
    while (this.puffs.length && this.puffs[0].age > (this.puffs[0].boom ? 2.2 : 6.0)) this.puffs.shift();
  }
}
