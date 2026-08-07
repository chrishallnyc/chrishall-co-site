// Battlefield (phase 9 opener): ground/naval units placed on the real
// terrain, gun hit detection, destruction state. Sim-side truth lives in one
// flat Float64Array (x, y, centerZ, radius, hp per unit — ENU) so it rides
// the SimCore auto-hash; groups/materials/smoke are render-side only.
// Placement tables are hand-picked from terrain probes (flat cells, real
// water for ships) — see BUILD-STATE D-040.

import * as THREE from "three";
import { UNITS } from "../world/groundunits.js";
import { softDiscTexture } from "../engine/sprites.js";

// hp in M61 rounds absorbed; r = hit-sphere radius (m); cz = sphere center
// height above the unit's base (ground/waterline)
const TYPE = {
  supply_truck: { hp: 2,   r: 5.5, cz: 2 },
  zsu:          { hp: 5,   r: 6,   cz: 2.5 },
  sam_tel:      { hp: 6,   r: 7,   cz: 3 },
  sam_radar:    { hp: 5,   r: 7,   cz: 4 },
  cargo_ship:   { hp: 80,  r: 55,  cz: 8 },
  destroyer:    { hp: 120, r: 60,  cz: 9 },
  carrier:      { hp: 250, r: 140, cz: 12 },
};

// [type, xEast, yNorth, yaw(three-frame rad, cosmetic)]
const FRONTS = {
  NELLIS: [
    // supply convoy on the eastern basin floor
    ["supply_truck", 2600, -8200, 0.45], ["supply_truck", 2540, -8140, 0.45],
    ["supply_truck", 2480, -8080, 0.45], ["supply_truck", 2420, -8020, 0.45],
    ["zsu", 2100, -8500, 1.2], ["zsu", 3100, -9000, -0.7],
    // SAM site on the flat south of the convoy
    ["sam_radar", 4200, -9800, 0], ["sam_tel", 4080, -9900, 0.5], ["sam_tel", 4320, -9720, -0.6],
    // western depot pair
    ["supply_truck", -9800, -2200, 2.1], ["supply_truck", -9740, -2260, 2.1], ["zsu", -9500, -2000, 0.3],
  ],
  VALDEZ: [
    // ships in Prince William Sound (probed real water, h <= -5)
    ["destroyer", 2000, -24000, 0.9], ["cargo_ship", 2000, -28000, 2.4],
    // shore battery on the flats east of the Sound
    ["supply_truck", 14000, -25000, 1.7], ["supply_truck", 14090, -24930, 1.7],
    ["zsu", 15000, -24200, -1.1],
    ["sam_radar", 11000, -24000, 0], ["sam_tel", 11150, -23880, 0.8],
  ],
  MARIANAS: [
    // carrier group offshore west
    ["carrier", -13000, 1600, 1.5], ["destroyer", -12800, 3400, 1.4],
    ["cargo_ship", 3000, 5000, -2.0],
    // Tinian strip cluster
    ["zsu", 4000, 8000, 0.6], ["supply_truck", 3000, 7000, -0.4], ["supply_truck", 3080, 7060, -0.4],
    ["sam_radar", 5000, 7000, 0], ["sam_tel", 5140, 7120, -0.9],
    // Saipan pair
    ["zsu", -5000, -4000, 2.6], ["supply_truck", -4900, -4120, 2.6],
  ],
};

const MAX_SMOKE = 64; // instanced billboard quads shared by all plumes

// Merge a unit's STATIC meshes into one mesh per material — three.js
// WebGPURenderer pays ~3µs CPU per render item per frame (the MAXFI wall),
// and 29 units × ~35 parts was ~30% of the headless frame. Meshes under
// animated part roots (turret/dish/launcher…) stay live; the merged meshes
// sit directly under the group so the wreck material swap still catches
// everything. Position+normal only (procedural units carry no uvs).
const ANIM_PARTS = ["turret", "barrels", "dish", "radarDish", "launcher", "tubes"];
function batchStatics(group, parts) {
  group.updateMatrixWorld(true);
  const animRoots = ANIM_PARTS.map((k) => parts[k]).filter(Boolean);
  const underAnim = (o) => { for (let p = o; p; p = p.parent) if (animRoots.includes(p)) return true; return false; };
  const buckets = new Map(); // material -> [{geo, matrix}]
  const doomed = [];
  group.traverse((m) => {
    if (!m.isMesh || underAnim(m)) return;
    if (!buckets.has(m.material)) buckets.set(m.material, []);
    buckets.get(m.material).push({ geo: m.geometry, matrix: m.matrixWorld.clone() });
    doomed.push(m);
  });
  const nrmM = new THREE.Matrix3();
  for (const [material, items] of buckets) {
    let nV = 0, nI = 0;
    for (const it of items) {
      nV += it.geo.attributes.position.count;
      nI += it.geo.index ? it.geo.index.count : it.geo.attributes.position.count;
    }
    const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3);
    const idx = new Uint32Array(nI);
    let vo = 0, io = 0;
    const v = new THREE.Vector3();
    for (const it of items) {
      const p = it.geo.attributes.position, n = it.geo.attributes.normal;
      nrmM.getNormalMatrix(it.matrix);
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k).applyMatrix4(it.matrix);
        pos.set([v.x, v.y, v.z], (vo + k) * 3);
        v.fromBufferAttribute(n, k).applyMatrix3(nrmM).normalize();
        nor.set([v.x, v.y, v.z], (vo + k) * 3);
      }
      if (it.geo.index) {
        for (let k = 0; k < it.geo.index.count; k++) idx[io++] = it.geo.index.getX(k) + vo;
      } else {
        for (let k = 0; k < p.count; k++) idx[io++] = vo + k;
      }
      vo += p.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    group.add(new THREE.Mesh(g, material));
  }
  for (const m of doomed) m.removeFromParent();
}

// ZSU-23-4 return fire (phase 9 "the war shoots back"): lead-predicted
// bursts with seeded dispersion + skill wobble — low passes are dangerous,
// not lethal. All state deterministic; rounds are honest ballistic objects.
const AAA = {
  range: 2600, muzzle: 970, rps: 20, burstS: 1.6, cooldownS: 2.8,
  dispersionMrad: 9, dmg: 12, dragK: 0.0005, life: 3.2,
};
const MAX_ER = 240; // enemy rounds pool: rps 20 x life 3.2 x ~3 guns

// SA-8/Roland-class TEL missiles (phase 9: the sites launch). Same honest
// pattern as the AIM-9X: real-ish motor burning mass, true prop-nav against
// a MOVING target (dR/dt = v_player − v_sam), authority tapering with
// dynamic pressure — which is exactly why a hard break at the right moment
// defeats it. One in the air per TEL, long reload, loud warning: scary,
// survivable, fair.
const SAM = {
  envMin: 1000, envMax: 6000, reloadS: 12,
  massKg: 126, propKg: 40, thrustN: 17000, burnS: 2.2,
  dragCd: 0.4, refAreaM2: 0.049, N: 4, maxG: 16, qRef: 9000,
  guideTau: 0.35, // autopilot+airframe response lag — the physics that makes a LATE break work
  proxM: 10, dmg: 45, lifeS: 6.5, // self-destruct: a launch-warning runner outlives it, a straight-liner never does
};
const MAX_SAM = 4;

export class Battlefield {
  constructor(scene, terrain, front, player = null) {
    this.name = "battlefield";
    this.kills = 0;
    this.player = player; // set post-construction by main.js (build order)
    const table = FRONTS[front] || [];
    this.n = table.length;
    this.state = new Float64Array(this.n * 5); // hashed via hash() below
    this.types = []; this.groups = []; this.parts = [];
    this.zsus = []; // unit indices that shoot back
    // per-zsu fire state: [phase timer, spool] — phase>0 bursting, <0 cooling
    this.aaa = new Float64Array(0);
    // enemy rounds (ENU): x,y,z, vx,vy,vz, age
    this.er = new Float64Array(MAX_ER * 7);
    this.erLive = new Uint8Array(MAX_ER);
    this.playerHits = 0;

    this.root = new THREE.Group();
    this.root.name = "battlefield";
    scene.add(this.root); // boot-time add — safe per the flightfx landmine

    table.forEach(([type, x, y, yaw], i) => {
      const spec = TYPE[type];
      const h = terrain ? terrain.heightAt(x, y) : 0;
      const base = h <= 0 ? 0 : h; // ships (probed sea cells) sit at sea level
      const o = i * 5;
      this.state[o] = x; this.state[o + 1] = y; this.state[o + 2] = base + spec.cz;
      this.state[o + 3] = spec.r; this.state[o + 4] = spec.hp;
      const { group, parts } = UNITS[type]();
      batchStatics(group, parts); // ~35 meshes -> ~5 per unit (MAXFI item-budget rule)
      group.position.set(x, base, y); // ENU -> three: (east, up, north)
      group.rotation.y = yaw;
      this.root.add(group);
      this.types.push(type); this.groups.push(group); this.parts.push(parts);
      if (type === "zsu") this.zsus.push(i);
    });
    this.aaa = new Float64Array(this.zsus.length * 2);
    for (let k = 0; k < this.zsus.length; k++) this.aaa[k * 2] = -1.0 - k * 0.9; // staggered first bursts
    this.tels = [];
    for (let i = 0; i < this.n; i++) if (this.types[i] === "sam_tel") this.tels.push(i);
    this.telCool = new Float64Array(this.tels.length).fill(3); // grace at spawn
    // SAM pool: x,y,z, vx,vy,vz, age, massKg, axS,ayS,azS (lagged accel)
    this.sam = new Float64Array(MAX_SAM * 11);
    this.samLive = new Uint8Array(MAX_SAM);
    this.samHits = 0;

    // destruction visuals: one shared wreck material + instanced smoke quads
    this._wreck = new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 0.95, metalness: 0.08 });
    const sGeo = new THREE.PlaneGeometry(9, 12);
    this._smokeMat = new THREE.MeshBasicMaterial({ color: 0x232019, map: softDiscTexture(), transparent: true, opacity: 0.5, depthWrite: false });
    this.smoke = new THREE.InstancedMesh(sGeo, this._smokeMat, MAX_SMOKE);
    this.smoke.frustumCulled = false;
    this.smoke.count = 0;
    this.root.add(this.smoke);
    this.plumes = []; // {i} per dead unit — render-side, looped forever

    // enemy tracers: hot red streaks, unmistakably not yours
    const eGeo = new THREE.BoxGeometry(0.4, 0.4, 6.0);
    const eMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.erMesh = new THREE.InstancedMesh(eGeo, eMat, MAX_ER);
    this.erMesh.frustumCulled = false;
    this.erMesh.count = 0;
    this.root.add(this.erMesh);

    // SAM bodies + trail smoke
    const sGeo2 = new THREE.BoxGeometry(0.3, 0.3, 3.2);
    const sMat2 = new THREE.MeshBasicMaterial({ color: 0xf2ede2 });
    this.samMesh = new THREE.InstancedMesh(sGeo2, sMat2, MAX_SAM);
    this.samMesh.frustumCulled = false;
    this.samMesh.count = 0;
    this.root.add(this.samMesh);
    const tGeo2 = new THREE.PlaneGeometry(2.6, 2.6);
    const tMat2 = new THREE.MeshBasicMaterial({ color: 0xe6e2da, map: softDiscTexture(), transparent: true, opacity: 0.5, depthWrite: false });
    this.samTrail = new THREE.InstancedMesh(tGeo2, tMat2, 220);
    this.samTrail.frustumCulled = false;
    this.samTrail.count = 0;
    this.root.add(this.samTrail);
    this.samPuffs = [];
    this._samLastPuff = new Float64Array(MAX_SAM * 3);

    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._dir = new THREE.Vector3();
    this._clock = 0;
    this.terrain = terrain;
  }

  alive(i) { return this.state[i * 5 + 4] > 0; }
  aliveCount() { let c = 0; for (let i = 0; i < this.n; i++) if (this.alive(i)) c++; return c; }
  samInbound() { for (let s = 0; s < MAX_SAM; s++) if (this.samLive[s]) return true; return false; }

  // ---- sim side ----
  tick(sim, dt) {
    const P = this.player;
    if (P) {
      const ps = P.fm.state; // previous-tick pos is fine (battlefield ticks first)
      const px = ps[0], py = ps[1], pz = ps[2];
      const pvx = ps[7], pvy = ps[8], pvz = ps[9];
      for (let k = 0; k < this.zsus.length; k++) {
        const i = this.zsus[k], o = i * 5, a = k * 2;
        if (this.state[o + 4] <= 0) continue; // dead guns don't shoot
        const dx = px - this.state[o], dy = py - this.state[o + 1], dz = pz - this.state[o + 2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist > AAA.range || dist < 60) { this.aaa[a] = Math.min(this.aaa[a], -0.4); this.aaa[a + 1] = 0; continue; }
        this.aaa[a] += dt;
        if (this.aaa[a] < 0) continue;               // cooling down
        if (this.aaa[a] > AAA.burstS) { this.aaa[a] = -AAA.cooldownS; this.aaa[a + 1] = 0; continue; }
        // bursting: spool rounds with a lead-predicted, gravity-compensated solution
        this.aaa[a + 1] += AAA.rps * dt;
        while (this.aaa[a + 1] >= 1) {
          this.aaa[a + 1] -= 1;
          this._aaaFire(sim, i, px, py, pz, pvx, pvy, pvz);
        }
      }
    }
    // ---- SAM launch + guidance ----
    if (P) {
      const ps = P.fm.state;
      for (let k = 0; k < this.tels.length; k++) {
        this.telCool[k] -= dt;
        const i = this.tels[k], o = i * 5;
        if (this.state[o + 4] <= 0 || this.telCool[k] > 0) continue;
        const dx = ps[0] - this.state[o], dy = ps[1] - this.state[o + 1], dz = ps[2] - this.state[o + 2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist < SAM.envMin || dist > SAM.envMax || dz < 50) continue; // envelope + no ground-hugging shots
        let slot = -1;
        for (let s = 0; s < MAX_SAM; s++) if (!this.samLive[s]) { slot = s; break; }
        if (slot < 0) continue;
        const so = slot * 11, r = this.sam;
        r[so] = this.state[o]; r[so + 1] = this.state[o + 1]; r[so + 2] = this.state[o + 2] + 3;
        // booster kick: up and toward the target
        const n = Math.hypot(dx, dy, dz);
        r[so + 3] = (dx / n) * 45; r[so + 4] = (dy / n) * 45; r[so + 5] = (dz / n) * 45 + 30;
        r[so + 6] = 0; r[so + 7] = SAM.massKg;
        r[so + 8] = 0; r[so + 9] = 0; r[so + 10] = 0;
        this.samLive[slot] = 1;
        this.telCool[k] = SAM.reloadS;
      }
      const mdot = SAM.propKg / SAM.burnS;
      for (let s = 0; s < MAX_SAM; s++) {
        if (!this.samLive[s]) continue;
        const so = s * 11, r = this.sam;
        const age = r[so + 6];
        const thrust = age < SAM.burnS ? SAM.thrustN : 0;
        if (age < SAM.burnS) r[so + 7] = Math.max(r[so + 7] - mdot * dt, SAM.massKg - SAM.propKg);
        const mass = r[so + 7];
        let vx = r[so + 3], vy = r[so + 4], vz = r[so + 5];
        const v = Math.hypot(vx, vy, vz) || 1;
        const rho = 1.225 * Math.exp(-Math.max(r[so + 2], 0) / 8500);
        const acc = thrust / mass - 0.5 * rho * v * v * SAM.dragCd * SAM.refAreaM2 / mass;
        vx += (vx / v) * acc * dt; vy += (vy / v) * acc * dt; vz += (vz / v) * acc * dt - 9.81 * dt;
        // prop-nav vs the MOVING jet: dR/dt = v_player - v_sam
        const Rx = ps[0] - r[so], Ry = ps[1] - r[so + 1], Rz = ps[2] - r[so + 2];
        const Rm = Math.hypot(Rx, Ry, Rz) || 1;
        const dRx = ps[7] - vx, dRy = ps[8] - vy, dRz = ps[9] - vz;
        const Vc = -(Rx * dRx + Ry * dRy + Rz * dRz) / Rm;
        const wx = (Ry * dRz - Rz * dRy) / (Rm * Rm);
        const wy = (Rz * dRx - Rx * dRz) / (Rm * Rm);
        const wz = (Rx * dRy - Ry * dRx) / (Rm * Rm);
        let ax = SAM.N * Vc * (wy * vz - wz * vy) / v;
        let ay = SAM.N * Vc * (wz * vx - wx * vz) / v;
        let az = SAM.N * Vc * (wx * vy - wy * vx) / v;
        const qbar = 0.5 * rho * v * v;
        const gCap = SAM.maxG * 9.81 * Math.min(1, qbar / SAM.qRef + (age < SAM.burnS ? 0.5 : 0.05));
        const am = Math.hypot(ax, ay, az);
        if (am > gCap) { ax *= gCap / am; ay *= gCap / am; az *= gCap / am; }
        // first-order guidance lag: the commanded turn arrives late — a
        // last-ditch break outruns the correction, a straight target never does
        const k = Math.min(dt / SAM.guideTau, 1);
        r[so + 8] += (ax - r[so + 8]) * k;
        r[so + 9] += (ay - r[so + 9]) * k;
        r[so + 10] += (az - r[so + 10]) * k;
        vx += r[so + 8] * dt; vy += r[so + 9] * dt; vz += r[so + 10] * dt;
        // induced drag: lift costs speed (missile L/D ~4) — sustained
        // corrections bleed the closing energy that makes late breaks work
        const aLat = Math.hypot(r[so + 8], r[so + 9], r[so + 10]);
        const v2 = Math.hypot(vx, vy, vz) || 1;
        const bleed = (aLat / 4) * dt / v2;
        vx -= vx * bleed; vy -= vy * bleed; vz -= vz * bleed;
        r[so + 3] = vx; r[so + 4] = vy; r[so + 5] = vz;
        r[so] += vx * dt; r[so + 1] += vy * dt; r[so + 2] += vz * dt;
        r[so + 6] = age + dt;
        if (Rm < SAM.proxM) {
          this.samLive[s] = 0;
          this.samHits++;
          P.takeHit(SAM.dmg);
          continue;
        }
        const gh = this.terrain ? this.terrain.heightAt(r[so], r[so + 1]) : 0;
        if (r[so + 2] <= Math.max(gh, 0) || age > SAM.lifeS) this.samLive[s] = 0;
      }
    }

    // integrate enemy rounds; hit-test the player sphere segment-wise
    const pr = 7.0;
    const ps = P ? P.fm.state : null;
    for (let j = 0; j < MAX_ER; j++) {
      if (!this.erLive[j]) continue;
      const o = j * 7, r = this.er;
      const v = Math.hypot(r[o + 3], r[o + 4], r[o + 5]);
      const k = 1 - AAA.dragK * dt * v;
      r[o + 3] *= k; r[o + 4] *= k; r[o + 5] = r[o + 5] * k - 9.81 * dt;
      const x0 = r[o], y0 = r[o + 1], z0 = r[o + 2];
      r[o] += r[o + 3] * dt; r[o + 1] += r[o + 4] * dt; r[o + 2] += r[o + 5] * dt;
      r[o + 6] += dt;
      if (P) {
        const cx = ps[0] - x0, cy = ps[1] - y0, cz = ps[2] - z0;
        const sx = r[o] - x0, sy = r[o + 1] - y0, sz = r[o + 2] - z0;
        const l2 = sx * sx + sy * sy + sz * sz;
        let t = l2 > 0 ? (cx * sx + cy * sy + cz * sz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = cx - sx * t, qy = cy - sy * t, qz = cz - sz * t;
        if (qx * qx + qy * qy + qz * qz <= pr * pr) {
          this.erLive[j] = 0;
          this.playerHits++;
          P.takeHit(AAA.dmg);
          continue;
        }
      }
      const gh = this.terrain ? this.terrain.heightAt(r[o], r[o + 1]) : 0;
      if (r[o + 2] <= Math.max(gh, 0) || r[o + 6] > AAA.life) this.erLive[j] = 0;
    }
  }

  _aaaFire(sim, i, px, py, pz, pvx, pvy, pvz) {
    let slot = -1;
    for (let j = 0; j < MAX_ER; j++) if (!this.erLive[j]) { slot = j; break; }
    if (slot < 0) return;
    const o5 = i * 5;
    const gx = this.state[o5], gy = this.state[o5 + 1], gz = this.state[o5 + 2] + 1.5;
    // two-pass lead: time of flight from current range, aim at predicted pos
    const d0 = Math.hypot(px - gx, py - gy, pz - gz);
    const tof = d0 / AAA.muzzle;
    const lead = 0.95 + (sim.rng.f() - 0.5) * 0.18; // good gunner, human wobble — straight flight gets punished, jinking evades
    let tx = px + pvx * tof * lead, ty = py + pvy * tof * lead, tz = pz + pvz * tof * lead;
    tz += 4.9 * tof * tof; // gravity drop compensation (aim high)
    let fx = tx - gx, fy = ty - gy, fz = tz - gz;
    const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    // dispersion in the plane perpendicular to fire dir (the D-040 lesson);
    // close overhead passes strain the mount's tracking rate — fast movers
    // at point-blank are HARDER to hit, not free kills
    const strain = d0 < 900 ? 1 + (900 - d0) / 900 * 1.4 : 1;
    const mrad = AAA.dispersionMrad / 1000 * strain;
    const g1 = (sim.rng.f() + sim.rng.f() + sim.rng.f() - 1.5) * mrad;
    const g2 = (sim.rng.f() + sim.rng.f() + sim.rng.f() - 1.5) * mrad;
    let rx = fy, ry = -fx;
    const rl = Math.hypot(rx, ry);
    if (rl > 1e-4) { rx /= rl; ry /= rl; } else { rx = 1; ry = 0; }
    const ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx;
    fx += g1 * rx + g2 * ux; fy += g1 * ry + g2 * uy; fz += g2 * uz;
    const fn = Math.hypot(fx, fy, fz); fx /= fn; fy /= fn; fz /= fn;
    const o = slot * 7, r = this.er;
    r[o] = gx + fx * 4; r[o + 1] = gy + fy * 4; r[o + 2] = gz + fz * 4;
    r[o + 3] = fx * AAA.muzzle; r[o + 4] = fy * AAA.muzzle; r[o + 5] = fz * AAA.muzzle;
    r[o + 6] = 0;
    this.erLive[slot] = 1;
  }

  // replaces the SimCore auto-hash (state alone no longer covers the war)
  hash(h) {
    const H = (v) => { h = (Math.imul(h ^ ((v * 1e3) | 0), 0x01000193)) >>> 0; };
    for (let i = 0; i < this.state.length; i++) H(this.state[i]);
    for (let i = 0; i < this.aaa.length; i++) H(this.aaa[i]);
    for (let i = 0; i < this.sam.length; i++) H(this.sam[i]);
    for (let i = 0; i < this.telCool.length; i++) H(this.telCool[i]);
    H(this.kills); H(this.playerHits); H(this.samHits);
    return h;
  }

  // segment p0->p1 vs live unit hit-spheres; first hit index or -1
  testSegment(x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len2 = dx * dx + dy * dy + dz * dz;
    for (let i = 0; i < this.n; i++) {
      const o = i * 5;
      if (this.state[o + 4] <= 0) continue;
      const cx = this.state[o] - x0, cy = this.state[o + 1] - y0, cz = this.state[o + 2] - z0;
      let t = len2 > 0 ? (cx * dx + cy * dy + cz * dz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = cx - dx * t, qy = cy - dy * t, qz = cz - dz * t, r = this.state[o + 3];
      if (qx * qx + qy * qy + qz * qz <= r * r) return i;
    }
    return -1;
  }

  damage(i, dmg) {
    const o = i * 5;
    if (this.state[o + 4] <= 0) return false;
    this.state[o + 4] -= dmg;
    if (this.state[o + 4] <= 0) {
      this.state[o + 4] = 0;
      this.kills++;
      this._destroy(i);
      return true;
    }
    return false;
  }

  _destroy(i) {
    const g = this.groups[i];
    g.traverse((m) => { if (m.isMesh) m.material = this._wreck; });
    g.rotation.z += this.types[i] === "carrier" || this.types[i] === "destroyer" || this.types[i] === "cargo_ship" ? 0.10 : 0.05; // listing / knocked over
    if (this.plumes.length * 4 < MAX_SMOKE) this.plumes.push({ i });
  }

  // ---- render side ----
  render(dt, camera) {
    this._clock += dt;
    // idle life: spin live radar dishes; live ZSU turrets track the player
    for (let i = 0; i < this.n; i++) {
      if (!this.alive(i)) continue;
      const p = this.parts[i];
      if (p.dish) p.dish.rotation.y += dt * 1.4;
      if (p.radarDish) p.radarDish.rotation.y += dt * 2.2;
    }
    if (this.player) {
      const ps = this.player.fm.state;
      for (const i of this.zsus) {
        if (!this.alive(i)) continue;
        const p = this.parts[i], g = this.groups[i], o = i * 5;
        const dx = ps[0] - this.state[o], dyN = ps[1] - this.state[o + 1];
        const dist = Math.hypot(dx, dyN);
        if (dist > AAA.range * 1.3) continue;
        if (p.turret) {
          // ENU bearing -> three yaw, minus the unit's own base yaw
          p.turret.rotation.y = Math.atan2(dx, dyN) - g.rotation.y;
        }
        if (p.barrels) {
          p.barrels.rotation.x = -Math.atan2(ps[2] - this.state[o + 2], dist);
        }
      }
    }
    // SAM bodies + trail (puffs spawned render-side at distance spacing)
    let ns = 0;
    for (let s = 0; s < MAX_SAM; s++) {
      if (!this.samLive[s]) continue;
      const so = s * 11, r = this.sam;
      this._dir.set(r[so + 3], r[so + 5], r[so + 4]).normalize();
      this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._dir);
      this._m4.makeRotationFromQuaternion(this._q);
      this._m4.setPosition(r[so], r[so + 2], r[so + 1]);
      this.samMesh.setMatrixAt(ns++, this._m4);
      const l3 = s * 3, lp = this._samLastPuff;
      const pd = Math.hypot(r[so] - lp[l3], r[so + 1] - lp[l3 + 1], r[so + 2] - lp[l3 + 2]);
      if (pd > 14 && this.samPuffs.length < 220) {
        this.samPuffs.push({ x: r[so], y: r[so + 1], z: r[so + 2], age: 0 });
        lp.set([r[so], r[so + 1], r[so + 2]], l3);
      }
    }
    this.samMesh.count = ns;
    this.samMesh.instanceMatrix.needsUpdate = true;
    let np = 0;
    for (const pf of this.samPuffs) {
      pf.age += dt;
      if (pf.age > 5.0) continue;
      const sc = 0.6 + pf.age * 0.7;
      this._m4.makeRotationFromQuaternion(camera.quaternion);
      this._m4.scale(new THREE.Vector3(sc, sc, sc));
      this._m4.setPosition(pf.x, pf.z, pf.y);
      if (np < 220) this.samTrail.setMatrixAt(np++, this._m4);
    }
    this.samTrail.count = np;
    this.samTrail.instanceMatrix.needsUpdate = true;
    while (this.samPuffs.length && this.samPuffs[0].age > 5.0) this.samPuffs.shift();

    // enemy tracer streaks along velocity
    let ne = 0;
    for (let j = 0; j < MAX_ER; j++) {
      if (!this.erLive[j]) continue;
      const o = j * 7, r = this.er;
      this._dir.set(r[o + 3], r[o + 5], r[o + 4]).normalize();
      this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._dir);
      this._m4.makeRotationFromQuaternion(this._q);
      this._m4.setPosition(r[o], r[o + 2], r[o + 1]);
      this.erMesh.setMatrixAt(ne++, this._m4);
    }
    this.erMesh.count = ne;
    this.erMesh.instanceMatrix.needsUpdate = true;
    // smoke: 4 rising billboard quads per plume, looped
    let n = 0;
    for (const pl of this.plumes) {
      const o = pl.i * 5;
      const bx = this.state[o], bz = this.state[o + 1];
      const by = this.state[o + 2]; // three y = ENU z
      for (let k = 0; k < 4 && n < MAX_SMOKE; k++) {
        const t = ((this._clock * 0.11 + k * 0.25 + pl.i * 0.17) % 1);
        const s = 0.6 + t * 2.6;
        this._m4.makeRotationFromQuaternion(camera.quaternion);
        this._m4.scale(new THREE.Vector3(s, s, s));
        this._m4.setPosition(bx + Math.sin(pl.i * 3.1 + k) * 3, by + 2 + t * 52, bz + Math.cos(pl.i * 2.3 + k) * 3);
        this.smoke.setMatrixAt(n++, this._m4);
      }
    }
    this.smoke.count = n;
    this.smoke.instanceMatrix.needsUpdate = true;
  }
}
