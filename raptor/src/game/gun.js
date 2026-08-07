// M61A2 (phase 8): sim-side ballistic rounds — muzzle velocity + aircraft
// velocity, gravity, drag, seeded dispersion — with instanced tracer
// rendering and terrain impact puffs. Deterministic: all randomness through
// sim.rng, all state in flat arrays, fired/retired at tick boundaries.
// (The real M61A2 load has no tracers; WT-style visible rounds are the
// arcade readability choice, as planned in WEAPONS-PLAN §5.)

import * as THREE from "three";
import { M61A2 } from "../sim/weapondata.js";
import { S } from "../sim/flight.js";

const MAX_ROUNDS = 360;   // pool ≥ rate × life: 100/s × 3.5s = 350 live at steady state
const MAX_PUFFS = 48;
const ROUND_LIFE = 3.5;   // ~2.4km of travel under drag — past that they're spent anyway
const DRAG_K = 0.00035;   // 1/m — PGU-28 class velocity decay (EST vs published
                          // ~20% retained energy loss at 1km)

export class Gun {
  constructor(scene) {
    this.ammo = M61A2.roundsCarried;
    this.firing = false;
    this._spool = 0;            // fractional rounds accumulated per tick
    this.impacts = 0;

    // sim state (ENU): [x,y,z, vx,vy,vz, age] × MAX_ROUNDS
    this.r = new Float64Array(MAX_ROUNDS * 7);
    this.live = new Uint8Array(MAX_ROUNDS);

    // render: tracer streaks (thin boxes oriented along velocity), additive
    const tGeo = new THREE.BoxGeometry(0.35, 0.35, 7.0); // fat WT-style streaks — scale-true rounds vanish at chase-cam range
    const tMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = new THREE.InstancedMesh(tGeo, tMat, MAX_ROUNDS);
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    scene.add(this.tracers); // boot-time add — safe per the flightfx landmine note

    const pGeo = new THREE.SphereGeometry(1.6, 6, 5);
    const pMat = new THREE.MeshBasicMaterial({ color: 0x8a7a60, transparent: true, opacity: 0.55, depthWrite: false });
    this.puffMesh = new THREE.InstancedMesh(pGeo, pMat, MAX_PUFFS);
    this.puffMesh.frustumCulled = false;
    this.puffMesh.count = 0;
    scene.add(this.puffMesh);
    this.puffs = []; // {x,y,z(three frame), age} — render-side, fed by sim events
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._dir = new THREE.Vector3();
  }

  // trigger held? fm supplies position/velocity/attitude (ENU/FRD);
  // battlefield (optional) takes segment hit-tests against unit spheres
  tick(sim, dt, fm, trigger, terrain, battlefield) {
    const st = fm.state;
    // fire
    if (trigger && this.ammo > 0) {
      this._spool += (M61A2.rateRpm / 60) * dt;
      while (this._spool >= 1 && this.ammo > 0) {
        this._spool -= 1;
        this.ammo--;
        this._fire(sim, st);
      }
      this.firing = true;
    } else {
      this._spool = 0;
      this.firing = false;
    }
    // integrate rounds
    for (let i = 0; i < MAX_ROUNDS; i++) {
      if (!this.live[i]) continue;
      const o = i * 7, r = this.r;
      r[o + 3] *= 1 - DRAG_K * dt * Math.hypot(r[o + 3], r[o + 4], r[o + 5]);
      r[o + 4] *= 1 - DRAG_K * dt * Math.hypot(r[o + 3], r[o + 4], r[o + 5]);
      r[o + 5] = r[o + 5] * (1 - DRAG_K * dt * Math.hypot(r[o + 3], r[o + 4], r[o + 5])) - 9.81 * dt;
      const x0 = r[o], y0 = r[o + 1], z0 = r[o + 2]; // pre-move (rounds cover ~10m/tick — point tests tunnel)
      r[o] += r[o + 3] * dt; r[o + 1] += r[o + 4] * dt; r[o + 2] += r[o + 5] * dt;
      r[o + 6] += dt;
      if (battlefield) {
        const hit = battlefield.testSegment(x0, y0, z0, r[o], r[o + 1], r[o + 2]);
        if (hit >= 0) {
          this.live[i] = 0;
          this.impacts++;
          battlefield.damage(hit, 1);
          this.puffs.push({ x: r[o], y: r[o + 2], z: r[o + 1], age: 0 });
          if (this.puffs.length > MAX_PUFFS) this.puffs.shift();
          continue;
        }
      }
      const groundH = terrain ? terrain.heightAt(r[o], r[o + 1]) : 0;
      if (r[o + 2] <= Math.max(groundH, 0)) {
        this.live[i] = 0;
        this.impacts++;
        this.puffs.push({ x: r[o], y: Math.max(groundH, 0), z: r[o + 1], age: 0 });
        if (this.puffs.length > MAX_PUFFS) this.puffs.shift();
      } else if (r[o + 6] > ROUND_LIFE) {
        this.live[i] = 0;
      }
    }
  }

  _fire(sim, st) {
    // slot
    let slot = -1;
    for (let i = 0; i < MAX_ROUNDS; i++) if (!this.live[i]) { slot = i; break; }
    if (slot < 0) return;
    // body-forward rotated straight into ENU (the FM quaternion IS body→ENU;
    // player.js uses the identical rotation with no flips)
    const qw = st[S.QW], qx = st[S.QX], qy = st[S.QY], qz = st[S.QZ];
    let fx = 1 - 2 * (qy * qy + qz * qz);
    let fy = 2 * (qx * qy + qw * qz);
    let fz = 2 * (qx * qz - qw * qy);
    // dispersion: 2 seeded gaussian-ish angles (sum of 3 uniforms), applied
    // in the plane PERPENDICULAR to the fire direction — world-axis offsets
    // rotate the scatter pattern with heading (east-flyers got zero vertical
    // spread; D-040)
    const mrad = M61A2.dispersionMrad / 1000;
    const g1 = (sim.rng.f() + sim.rng.f() + sim.rng.f() - 1.5) * mrad;
    const g2 = (sim.rng.f() + sim.rng.f() + sim.rng.f() - 1.5) * mrad;
    let rx = fy, ry = -fx, rz = 0; // right = f x worldUp
    const rl = Math.hypot(rx, ry, rz);
    if (rl > 1e-4) { rx /= rl; ry /= rl; } else { rx = 1; ry = 0; }
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx; // up = right x f
    fx += g1 * rx + g2 * ux; fy += g1 * ry + g2 * uy; fz += g1 * rz + g2 * uz;
    const n = Math.hypot(fx, fy, fz); fx /= n; fy /= n; fz /= n;
    const o = slot * 7, r = this.r, mv = M61A2.muzzleVelocityMs;
    r[o] = st[S.PX] + fx * 8; r[o + 1] = st[S.PY] + fy * 8; r[o + 2] = st[S.PZ] + fz * 8;
    r[o + 3] = st[S.VX] + fx * mv;
    r[o + 4] = st[S.VY] + fy * mv;
    r[o + 5] = st[S.VZ] + fz * mv;
    r[o + 6] = 0;
    this.live[slot] = 1;
  }

  render(dtSec) {
    let n = 0;
    for (let i = 0; i < MAX_ROUNDS; i++) {
      if (!this.live[i]) continue;
      const o = i * 7, r = this.r;
      // ENU→three: (x, z_up, y_north); orient along velocity
      this._dir.set(r[o + 3], r[o + 5], r[o + 4]).normalize();
      this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._dir);
      this._m4.makeRotationFromQuaternion(this._q);
      this._m4.setPosition(r[o], r[o + 2], r[o + 1]);
      this.tracers.setMatrixAt(n++, this._m4);
    }
    this.tracers.count = n;
    this.tracers.instanceMatrix.needsUpdate = true;

    let p = 0;
    for (const puff of this.puffs) {
      puff.age += dtSec;
      if (puff.age > 1.3) continue;
      const s = 1 + puff.age * 4;
      this._m4.makeScale(s, s, s);
      this._m4.setPosition(puff.x, puff.y + puff.age * 2.5, puff.z);
      this.puffMesh.setMatrixAt(p++, this._m4);
    }
    this.puffMesh.count = p;
    this.puffMesh.instanceMatrix.needsUpdate = true;
    while (this.puffs.length && this.puffs[0].age > 1.3) this.puffs.shift();
  }
}
