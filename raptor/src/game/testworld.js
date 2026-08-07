// Phase-1 proving world: a placeholder jet flying a banked circle over a sea
// plane, driven ENTIRELY by sim ticks (render only interpolates). Exists to
// prove the engine contract end-to-end: fixed-step determinism, prev/curr
// interpolation, instanced trail via Pool, fog + lights on both backends,
// chase camera. Replaced wholesale by real fronts from phase 3.

import * as THREE from "three";
import { Pool } from "../engine/pools.js";

const TRAIL_N = 240;

export class TestWorld {
  constructor(scene) {
    this.scene = scene;
    // sky, fog, and lights are owned by Atmosphere (world/daycycle.js)

    // plane edge must sit far beyond fog saturation or it draws a seam line
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(240000, 240000, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x18354a, roughness: 0.82, metalness: 0.05 })
    );
    sea.rotation.x = -Math.PI / 2;
    scene.add(sea);
    this.sea = sea;

    // distance pylons every 500m on a 4km ring — scale reference
    const pylonGeo = new THREE.ConeGeometry(18, 160, 6);
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0xc8c4b8, roughness: 0.9 });
    const pylons = new THREE.InstancedMesh(pylonGeo, pylonMat, 24);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      m4.setPosition(Math.cos(a) * 4000, 80, Math.sin(a) * 4000);
      pylons.setMatrixAt(i, m4);
    }
    scene.add(pylons);
    this.pylons = pylons;

    // placeholder jet: fuselage + wing slab (the real F-22 arrives in phase 6)
    this.jet = new THREE.Group();
    const fuse = new THREE.Mesh(
      new THREE.ConeGeometry(9, 62, 8),
      new THREE.MeshStandardMaterial({ color: 0x3c4048, roughness: 0.5, metalness: 0.6 })
    );
    fuse.rotation.x = Math.PI / 2;
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(64, 2.2, 20),
      new THREE.MeshStandardMaterial({ color: 0x34383f, roughness: 0.55, metalness: 0.6 })
    );
    wing.position.z = 6;
    this.jet.add(fuse, wing);
    this.scene.add(this.jet);

    // instanced contrail fed by a Pool ring
    const puffGeo = new THREE.SphereGeometry(2.4, 6, 5);
    const puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    this.trailMesh = new THREE.InstancedMesh(puffGeo, puffMat, TRAIL_N);
    this.trailMesh.frustumCulled = false;
    scene.add(this.trailMesh);
    this.trail = new Pool(TRAIL_N, () => ({ x: 0, y: 0, z: 0, age: 1e9 }));

    // sim-owned state: [angle, radius, alt, speed, bank] + prev copy for lerp
    this.baseAlt = 900;
    this.state = new Float64Array(5);
    this.prev = new Float64Array(5);
    this.state[0] = 0; this.state[1] = 2600; this.state[2] = this.baseAlt; this.state[3] = 240;
    this.prev.set(this.state);
    this._puffCooldown = 0;
    // QA/judge framing: ?pitch=deg tilts the chase view; ?yaw=deg parks the
    // camera at altitude looking along a fixed azimuth (sun-aware sky shots)
    const q = new URLSearchParams(location.search);
    this.pitchBias = parseFloat(q.get("pitch") || "0") * Math.PI / 180;
    this.fixYaw = q.has("yaw") ? parseFloat(q.get("yaw")) * Math.PI / 180 : null;
  }

  // terrain arrived: sea stays only on ocean fronts (y=0 = real sea level),
  // pylons perch on the ground, circle altitude clears the local ridges
  setGround(terrain, opts = {}) {
    this.terrain = terrain;
    this.sea.visible = !!opts.ocean;
    this.baseAlt = opts.baseAlt || 3400;
    this.state[2] = this.baseAlt;
    this.prev.set(this.state);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const x = Math.cos(a) * 4000, z = Math.sin(a) * 4000;
      m4.setPosition(x, terrain.heightAt(x, z) + 80, z);
      this.pylons.setMatrixAt(i, m4);
    }
    this.pylons.instanceMatrix.needsUpdate = true;
  }

  // ---- sim side (fixed step, deterministic) ----
  reset() {
    this.state[0] = 0; this.state[1] = 2600; this.state[2] = this.baseAlt; this.state[3] = 240; this.state[4] = 0;
    this.prev.set(this.state);
  }

  tick(sim, dt) {
    this.prev.set(this.state);
    const s = this.state;
    const omega = s[3] / s[1];               // rad/s around the circle
    s[0] += omega * dt;
    s[2] = this.baseAlt + Math.sin(s[0] * 2.0) * 140; // gentle altitude weave
    s[4] = Math.atan((s[3] * omega) / 9.81); // coordinated bank angle
    this._puffCooldown -= dt;
    if (this._puffCooldown <= 0) {
      this._puffCooldown = 0.05 + sim.rng.f() * 0.01; // rng use keeps hash honest
      const { item } = this.trail.acquire();
      item.x = Math.cos(s[0]) * s[1];
      item.y = s[2];
      item.z = Math.sin(s[0]) * s[1];
      item.age = 0;
    }
    this.trail.forEachLive((p, i) => { p.age += dt; if (p.age > 9) this.trail.release(i); });
  }

  hash(h) {
    // fold flight state; trail is cosmetic but ages deterministically anyway
    for (let i = 0; i < this.state.length; i++) h = (Math.imul(h ^ ((this.state[i] * 1e6) | 0), 0x01000193)) >>> 0;
    return h;
  }

  // ---- render side (interpolated) ----
  render(alpha, camera) {
    const a = this.prev, b = this.state;
    const ang = a[0] + (b[0] - a[0]) * alpha;
    const rad = a[1] + (b[1] - a[1]) * alpha;
    const alt = a[2] + (b[2] - a[2]) * alpha;
    const bank = a[4] + (b[4] - a[4]) * alpha;

    const px = Math.cos(ang) * rad, pz = Math.sin(ang) * rad;
    this.jet.position.set(px, alt, pz);
    // velocity is tangent to the circle
    const heading = Math.atan2(-Math.cos(ang), Math.sin(ang));
    this.jet.rotation.set(0, heading, 0, "YXZ");
    this.jet.rotateZ(-bank);

    const m4 = new THREE.Matrix4();
    let n = 0;
    this.trail.forEachLive((p) => {
      m4.makeScale(1 + p.age * 0.35, 1 + p.age * 0.35, 1 + p.age * 0.35);
      m4.setPosition(p.x, p.y, p.z);
      this.trailMesh.setMatrixAt(n++, m4);
    });
    this.trailMesh.count = n;
    this.trailMesh.instanceMatrix.needsUpdate = true;

    if (this.fixYaw !== null) {
      // parked camera: +X east, +Z north; terrain-aware altitude (a fixed
      // 900m sat UNDERGROUND in the 1266m Nevada basin)
      const camY = (this.terrain ? this.terrain.heightAt(0, 0) : 0) + 600;
      camera.position.set(0, camY, 0);
      camera.lookAt(Math.sin(this.fixYaw) * 1000, camY + Math.tan(this.pitchBias) * 1000, Math.cos(this.fixYaw) * 1000);
      return;
    }
    // chase camera, behind along heading
    const back = 190, up = 60;
    camera.position.set(px - Math.sin(heading) * back, alt + up, pz - Math.cos(heading) * back);
    camera.lookAt(px, alt + back * Math.tan(this.pitchBias), pz);
  }
}
