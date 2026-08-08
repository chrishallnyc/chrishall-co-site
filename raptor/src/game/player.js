// Player flight (phase 7): mouse-aim + Chris's control scheme (W/S throttle,
// A/D flaperon roll, Q/E rudder, arrows manual pitch) driving the validated
// FlightModel through the WT-style instructor. Runs as a SimCore system —
// inputs are sampled per TICK (the replay/netcode boundary), rendering only
// interpolates. Frames: FM world is ENU (+x east, +y north, +z up); the game
// renders x=east, y=up, z=north — an improper axis swap, so orientation
// crosses via basis vectors (makeBasis re-orthogonalizes handedness).

import * as THREE from "three";
import { FlightModel, S } from "../sim/flight.js";
import { Gun } from "./gun.js";
import { Missiles } from "./missiles.js";

const MOUSE_SENS = 0.0028;      // rad of aim per px of mouse travel
const THROTTLE_RATE = 0.45;     // per second held (0 -> 100% in ~2.2s)
const AB_PUSH_RATE = 0.125;     // slower shove through the AB detent (~0.8s of deliberate holding)
const AIM_PITCH_LIM = 80 * Math.PI / 180;

export class Player {
  constructor(scene, { jet, terrain, spawn, battlefield }) {
    this.jet = jet;             // the F-22 group (taken over from TestWorld)
    this.terrain = terrain || null;
    this.battlefield = battlefield || null;
    this.spawn = spawn;
    this.gun = new Gun(scene);  // boot-time scene.add — safe
    this.missiles = new Missiles(scene);

    this.fm = new FlightModel();
    this._doSpawn();

    // aim state (deterministic sim inputs; mouse deltas accumulate render-side
    // and are consumed per tick)
    this.aimHeading = spawn.headingRad;
    this.aimPitch = 0;
    this.throttleCmd = 0.8;
    this.gearDown = false;
    this._mouseDx = 0; this._mouseDy = 0;
    this._live = { rollL: 0, rollR: 0, yawL: 0, yawR: 0, thrUp: 0, thrDn: 0, pitchUp: 0, pitchDn: 0, brake: 0, wheel: 0, gearEdge: 0, fire: 0, aamEdge: 0 };
    this.crashes = 0;
    this.hp = 100;
    this.hitFlash = 0; // render-side: seconds of damage flash remaining

    // render-side scratch
    this._prev = new Float64Array(this.fm.state);
    this._q = new THREE.Quaternion();
    this._f = new THREE.Vector3(); this._u = new THREE.Vector3(); this._r = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._camPos = new THREE.Vector3();
  }

  _doSpawn() {
    this.fm.initFlight({
      x: this.spawn.x, y: this.spawn.y, alt: this.spawn.alt,
      headingRad: this.spawn.headingRad, speed: this.spawn.speed, throttle: 0.8,
    });
  }

  // called by the render loop every frame — accumulates until the next tick
  feedInput(input) {
    this._mouseDx += input.mouse.dx;
    this._mouseDy += input.mouse.dy;
    const L = this._live;
    L.rollL = input.held("roll_left") ? 1 : 0;
    L.rollR = input.held("roll_right") ? 1 : 0;
    L.yawL = input.held("yaw_left") ? 1 : 0;
    L.yawR = input.held("yaw_right") ? 1 : 0;
    L.thrUp = input.held("throttle_up") ? 1 : 0;
    L.thrDn = input.held("throttle_down") ? 1 : 0;
    L.pitchUp = input.held("pitch_up") ? 1 : 0;
    L.pitchDn = input.held("pitch_down") ? 1 : 0;
    L.brake = input.held("wheel_brakes") ? 1 : 0;
    L.wheel += input.wheelDelta();
    if (input.pressed("gear")) L.gearEdge = 1;
    L.fire = (input.held("fire_mguns") || input.held("fire_cannons")) ? 1 : 0;
    if (input.pressed("fire_aam")) L.aamEdge = 1;
  }

  // QA hook: drive the aim/throttle directly (batteries can't move a mouse);
  // pos teleports the FM (batteries can't fly 20km to a target either)
  debugCommand({ aimPitchDeg, aimHeadingDeg, throttle, pos } = {}) {
    if (throttle !== undefined) this.throttleCmd = throttle;
    if (pos) { // pos FIRST — a combined {pos, aimHeadingDeg} call must keep the aim (PASS-3 item 2 bug)
      this.fm.initFlight({
        x: pos.x, y: pos.y, alt: pos.alt,
        headingRad: (pos.headingDeg || 0) * Math.PI / 180,
        speed: pos.speed || 200, throttle: this.throttleCmd,
      });
      this.aimHeading = (pos.headingDeg || 0) * Math.PI / 180;
      this._prev.set(this.fm.state);
    }
    if (aimPitchDeg !== undefined) this.aimPitch = aimPitchDeg * Math.PI / 180;
    if (aimHeadingDeg !== undefined) this.aimHeading = aimHeadingDeg * Math.PI / 180;
  }

  // AAA/weapon damage; shot down = same respawn path as a crash
  takeHit(dmg) {
    this.hp -= dmg;
    this.hitFlash = 0.5;
    if (this.hp <= 0) { this.crashes++; this.reset(); }
  }

  // ---- sim side ----
  reset() { this._doSpawn(); this.aimPitch = 0; this.aimHeading = this.spawn.headingRad; this.hp = 100; }

  tick(sim, dt) {
    this._prev.set(this.fm.state);
    const L = this._live;

    // aim from accumulated mouse travel
    this.aimHeading -= this._mouseDx * MOUSE_SENS; // FM heading is CCW-from-east: mouse-right must decrease it
    this.aimPitch = Math.max(-AIM_PITCH_LIM, Math.min(AIM_PITCH_LIM, this.aimPitch - this._mouseDy * MOUSE_SENS));
    this._mouseDx = 0; this._mouseDy = 0;
    // arrow-key manual pitch nudges the aim
    this.aimPitch += (L.pitchUp - L.pitchDn) * 0.9 * dt;

    // throttle: W/S ONLY (Chris's spec — the mouse never accelerates).
    // WT behavior: hold W → 100% in ~a second, KEEP holding → pushes into
    // afterburner; release → settles back to MIL (100%) and stays. AB is
    // hold-to-keep; S backs out of everything.
    const inAB = this.throttleCmd >= 1.0;
    const rate = inAB && L.thrUp ? AB_PUSH_RATE : THROTTLE_RATE;
    this.throttleCmd += (L.thrUp - L.thrDn) * rate * dt;
    if (!L.thrUp && this.throttleCmd > 1.0) this.throttleCmd = 1.0; // W released in AB -> MIL latch
    this.throttleCmd = Math.max(0, Math.min(1.1, this.throttleCmd));
    L.wheel = 0;

    if (L.gearEdge) { this.gearDown = !this.gearDown; L.gearEdge = 0; }

    const st = this.fm.state;
    const groundH = this.terrain ? this.terrain.heightAt(st[S.PX], st[S.PY]) : 0;
    this.fm.tick(dt, {
      aimPitch: this.aimPitch,
      aimYaw: this.aimHeading,
      throttle: this.throttleCmd,
      rudder: L.yawR - L.yawL,
      rollOverride: L.rollR - L.rollL,
      mode: "arcade",
      brake: L.brake,
      gearDown: this.gearDown,
    }, { groundH: Math.max(groundH, 0) });

    this.gun.tick(sim, dt, this.fm, L.fire === 1, this.terrain, this.battlefield);
    this.missiles.tick(sim, dt, this.fm, this.battlefield, L.aamEdge === 1);
    L.aamEdge = 0;

    // gear-up terrain/water contact = crash → respawn (proper damage phase 8)
    const agl = st[S.PZ] - Math.max(groundH, 0);
    if (agl < 1.5 && !this.gearDown) { this.crashes++; this.reset(); }
  }

  hash(h) {
    const st = this.fm.state;
    for (let i = 0; i < 14; i++) h = (Math.imul(h ^ ((st[i] * 1e5) | 0), 0x01000193)) >>> 0;
    return this.missiles.hash(h);
  }

  // ---- render side ----
  render(alpha, camera, parked) {
    const a = this._prev, b = this.fm.state;
    const lp = (i) => a[i] + (b[i] - a[i]) * alpha;
    // FM ENU -> three (x=east stays, y=up from ENU z, z=north from ENU y)
    const px = lp(S.PX), py = lp(S.PZ), pz = lp(S.PY);
    this.jet.position.set(px, py, pz);

    // orientation via basis vectors (quat can't cross an improper swap)
    this._q.set(b[S.QX], b[S.QY], b[S.QZ], b[S.QW]);
    this._f.set(1, 0, 0).applyQuaternion(this._q);   // body fwd in ENU
    this._u.set(0, 0, -1).applyQuaternion(this._q);  // body up (FRD +z is down)
    const f = new THREE.Vector3(this._f.x, this._f.z, this._f.y); // ENU->three
    const u = new THREE.Vector3(this._u.x, this._u.z, this._u.y);
    const r = new THREE.Vector3().crossVectors(u, f).normalize();
    u.crossVectors(f, r).normalize();
    this._m.makeBasis(r, u, f);
    this.jet.quaternion.setFromRotationMatrix(this._m);

    this.gun.render(1 / 60, camera); // visual aging; cheap approximation of dt
    this.missiles.render(1 / 60, camera);

    if (parked) return; // QA parked-camera owns the view
    // chase camera behind the flight path, mild smoothing
    const back = 55, up = 16;
    this._camPos.set(px - f.x * back + u.x * up, py - f.y * back + u.y * up, pz - f.z * back + u.z * up);
    // snap on spawn/respawn (a slow lerp from the origin drags the camera
    // underground through the basin); smooth only when already close
    if (camera.position.distanceTo(this._camPos) > 400) camera.position.copy(this._camPos);
    else camera.position.lerp(this._camPos, 0.35);
    camera.up.set(u.x * 0.35, 1, u.z * 0.35).normalize();
    camera.lookAt(px + f.x * 120, py + f.y * 120, pz + f.z * 120);
  }

  hudState() {
    const st = this.fm.state, out = this.fm.out;
    // heading/pitch/roll from the body basis in ENU
    this._q.set(st[S.QX], st[S.QY], st[S.QZ], st[S.QW]);
    this._f.set(1, 0, 0).applyQuaternion(this._q);
    this._r.set(0, 1, 0).applyQuaternion(this._q); // body right wing in ENU
    const heading = Math.atan2(this._f.x, this._f.y) * 180 / Math.PI; // from north, eastward
    const pitch = Math.asin(Math.max(-1, Math.min(1, this._f.z))) * 180 / Math.PI;
    // +roll = right bank: right wing dips → its ENU z goes negative
    const roll = Math.atan2(-this._r.z, Math.hypot(this._r.x, this._r.y)) * 180 / Math.PI;
    return {
      speedKt: out.V * 1.94384,
      altFt: st[S.PZ] * 3.28084,
      heading: (heading + 360) % 360,
      pitch, roll,
      g: out.nz,
      mach: out.mach,
      aoa: out.alphaDeg,
      throttle: Math.round(this.throttleCmd * 100),
      ammo: this.gun.ammo,
      aam: this.missiles.ammo,
      hp: this.hp,
    };
  }
}
