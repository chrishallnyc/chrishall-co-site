// Battlefield (phase 9 opener): ground/naval units placed on the real
// terrain, gun hit detection, destruction state. Sim-side truth lives in one
// flat Float64Array (x, y, centerZ, radius, hp per unit — ENU) so it rides
// the SimCore auto-hash; groups/materials/smoke are render-side only.
// Placement tables are hand-picked from terrain probes (flat cells, real
// water for ships) — see BUILD-STATE D-040.

import * as THREE from "three";
import { UNITS } from "../world/groundunits.js";

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

export class Battlefield {
  constructor(scene, terrain, front) {
    this.name = "battlefield";
    this.kills = 0;
    const table = FRONTS[front] || [];
    this.n = table.length;
    this.state = new Float64Array(this.n * 5); // auto-hashed by SimCore
    this.types = []; this.groups = []; this.parts = [];

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
      group.position.set(x, base, y); // ENU -> three: (east, up, north)
      group.rotation.y = yaw;
      this.root.add(group);
      this.types.push(type); this.groups.push(group); this.parts.push(parts);
    });

    // destruction visuals: one shared wreck material + instanced smoke quads
    this._wreck = new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 0.95, metalness: 0.08 });
    const sGeo = new THREE.PlaneGeometry(9, 12);
    this._smokeMat = new THREE.MeshBasicMaterial({ color: 0x232019, transparent: true, opacity: 0.42, depthWrite: false });
    this.smoke = new THREE.InstancedMesh(sGeo, this._smokeMat, MAX_SMOKE);
    this.smoke.frustumCulled = false;
    this.smoke.count = 0;
    this.root.add(this.smoke);
    this.plumes = []; // {i} per dead unit — render-side, looped forever
    this._m4 = new THREE.Matrix4();
    this._clock = 0;
  }

  alive(i) { return this.state[i * 5 + 4] > 0; }
  aliveCount() { let c = 0; for (let i = 0; i < this.n; i++) if (this.alive(i)) c++; return c; }

  // ---- sim side ----
  tick(sim, dt) { /* static targets for now — AAA return fire is the next rung */ }

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
    // idle life: spin live radar dishes
    for (let i = 0; i < this.n; i++) {
      if (!this.alive(i)) continue;
      const p = this.parts[i];
      if (p.dish) p.dish.rotation.y += dt * 1.4;
      if (p.radarDish) p.radarDish.rotation.y += dt * 2.2;
    }
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
