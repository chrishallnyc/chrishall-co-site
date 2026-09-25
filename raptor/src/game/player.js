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
import { createAircraftPose } from "../aircraft/pose.js";

const MOUSE_SENS = 0.0028;      // rad of aim per px of mouse travel
const THROTTLE_RATE = 0.45;     // per second held (0 -> 100% in ~2.2s)
const AB_PUSH_RATE = 0.125;     // slower shove through the AB detent (~0.8s of deliberate holding)
const AIM_PITCH_LIM = 80 * Math.PI / 180;
const CAMERA_UP_TAU = 0.07;   // short horizon easing; aiming direction stays immediate

export class Player {
  constructor(scene, { jet, parts, terrain, spawn, battlefield, directory }) {
    this.jet = jet;             // the F-22 group (taken over from TestWorld)
    this.terrain = terrain || null;
    this.battlefield = battlefield || null;
    this.directory = directory || null; // W1 unified targets (ground + air)
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
    this._manualSteering = false;
    this._manualPointerAim = false;
    this._live = { rollL: 0, rollR: 0, yawL: 0, yawR: 0, thrUp: 0, thrDn: 0, pitchUp: 0, pitchDn: 0, brake: 0, wheel: 0, gearEdge: 0, fire: 0, aamEdge: 0 };
    this.crashes = 0;
    this.hp = 100;
    this.hitFlash = 0; // render-side: seconds of damage flash remaining

    // render-side scratch
    this._prev = new Float64Array(this.fm.state);
    // HUD projection shares the aircraft's presentation time. Simulation,
    // targeting and the coach continue reading fm.state / hudState().
    this.renderState = new Float64Array(this.fm.state);
    this._q = new THREE.Quaternion();
    this._nextQ = new THREE.Quaternion();
    this._f = new THREE.Vector3(); this._u = new THREE.Vector3(); this._r = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._camPos = new THREE.Vector3();
    this._camOffset = new THREE.Vector3();
    this._camUp = new THREE.Vector3();
    this._camUpTarget = new THREE.Vector3();
    this._cameraReady = false;
    this.renderPoseVersion = 0; // render effects must not bridge respawns or teleports
    this._renderForward = new THREE.Vector3();
    this._renderUp = new THREE.Vector3();
    this._aircraftPose = createAircraftPose(jet,parts);
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
    const roll = input.axis?.("roll") || 0;
    const throttle = input.axis?.("throttleRel") || 0;
    L.rollL = Math.max(input.held("roll_left") ? 1 : 0, -roll);
    L.rollR = Math.max(input.held("roll_right") ? 1 : 0, roll);
    L.yawL = input.held("yaw_left") ? 1 : 0;
    L.yawR = input.held("yaw_right") ? 1 : 0;
    L.thrUp = Math.max(input.held("throttle_up") ? 1 : 0, throttle);
    L.thrDn = Math.max(input.held("throttle_down") ? 1 : 0, -throttle);
    L.pitchUp = input.held("pitch_up") ? 1 : 0;
    L.pitchDn = input.held("pitch_down") ? 1 : 0;
    L.brake = input.held("wheel_brakes") ? 1 : 0;
    L.wheel += input.wheelDelta();
    if (input.pressed("gear")) L.gearEdge = 1;
    L.fire = input.held("fire_mguns") ? 1 : 0;
    if (input.pressed("fire_aam")) L.aamEdge = 1;
  }

  // Input can arrive on a render frame with no fixed simulation tick. Clear
  // that queued input at the pause/focus boundary so resuming cannot fire a
  // missile, toggle gear, or apply mouse motion from before the menu opened.
  clearInput() {
    this._mouseDx = 0;
    this._mouseDy = 0;
    this._manualSteering = false;
    this._manualPointerAim = false;
    for (const key of Object.keys(this._live)) this._live[key] = 0;
  }

  // Hold the flight path already being flown. The instructor aims velocity,
  // not the nose (which is several degrees above it at positive angle of
  // attack). Recentring to the nose would add a climb on every press.
  // At walking speed there is no meaningful flight path; fall back to nose.
  recenterAim() {
    const st = this.fm.state;
    this._q.set(st[S.QX], st[S.QY], st[S.QZ], st[S.QW]);
    this._f.set(1, 0, 0).applyQuaternion(this._q);
    const horizontal = Math.hypot(st[S.VX], st[S.VY]);
    const moving = Math.hypot(horizontal, st[S.VZ]) >= 5;
    this.aimHeading = moving && horizontal >= 1
      ? Math.atan2(st[S.VY], st[S.VX]) : Math.atan2(this._f.y, this._f.x);
    this.aimPitch = Math.max(-AIM_PITCH_LIM, Math.min(AIM_PITCH_LIM,
      moving ? Math.atan2(st[S.VZ], horizontal)
        : Math.asin(Math.max(-1, Math.min(1, this._f.z)))));
    this._mouseDx = 0;
    this._mouseDy = 0;
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
      this.renderState.set(this.fm.state);
      this._cameraReady = false;
      this.renderPoseVersion++;
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
  reset() {
    this.recoverFlight();
  }

  // Practice UI may offer this explicitly; combat only calls it through the
  // crash/damage respawn path above. Restore a usable aircraft without
  // replenishing ammunition, clearing active weapons, or rewriting progress.
  recoverFlight() {
    this.clearInput();
    this.throttleCmd = 0.8;
    this.gearDown = false;
    this._doSpawn();
    this.aimPitch = 0;
    this.aimHeading = this.spawn.headingRad;
    this.hp = 100;
    this.hitFlash = 0;
    // A respawn is a discontinuity, never a flight segment to interpolate.
    this._prev?.set(this.fm.state);
    this.renderState?.set(this.fm.state);
    this._cameraReady = false;
    this.renderPoseVersion++;
  }

  tick(sim, dt) {
    this._prev.set(this.fm.state);
    const L = this._live;

    // A keyboard-only bank/rudder maneuver establishes a new course. Without
    // this handoff the instructor fights the turn and flies back to the old
    // pointer heading on release. If the pilot also aims with the pointer,
    // retain that deliberate target for the entire manual maneuver instead.
    const manual = L.rollL !== L.rollR || L.yawL !== L.yawR;
    if (manual && !this._manualSteering) this._manualPointerAim = false;
    if ((manual || this._manualSteering) && (this._mouseDx || this._mouseDy)) this._manualPointerAim = true;
    if ((manual || this._manualSteering) && !this._manualPointerAim) {
      const st = this.fm.state;
      const qw = st[S.QW], qx = st[S.QX], qy = st[S.QY], qz = st[S.QZ];
      this.aimHeading = Math.atan2(2 * (qx * qy + qw * qz), 1 - 2 * (qy * qy + qz * qz));
    }
    this._manualSteering = manual;

    // aim from accumulated mouse travel
    this.aimHeading -= this._mouseDx * MOUSE_SENS; // FM heading is CCW-from-east: mouse-right must decrease it
    // Clamp after combining pointer and keyboard input: held arrow keys must
    // obey the same limit as the pointer, including when both are active.
    this.aimPitch = Math.max(-AIM_PITCH_LIM, Math.min(AIM_PITCH_LIM,
      this.aimPitch - this._mouseDy * MOUSE_SENS + (L.pitchUp - L.pitchDn) * 0.9 * dt));
    this._mouseDx = 0; this._mouseDy = 0;

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
      // The instructor's aim-vector mode is named "mouse". Unknown modes
      // fall through to realistic stick control, which ignores aimYaw and
      // interprets aimPitch as a sustained G command instead of a direction.
      mode: "mouse",
      brake: L.brake,
      gearDown: this.gearDown,
    }, { groundH: Math.max(groundH, 0) });

    this.gun.tick(sim, dt, this.fm, L.fire === 1, this.terrain, this.battlefield, this.directory);
    this.missiles.tick(sim, dt, this.fm, this.battlefield, L.aamEdge === 1, this.directory);
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
  render(alpha, camera, parked, dt = 1 / 60, presentationDt = dt) {
    const a = this._prev, b = this.fm.state;
    const t = Math.max(0, Math.min(1, alpha));
    const elapsed = Number.isFinite(presentationDt) ? Math.max(0, presentationDt) : 0;
    // Effect lifetime belongs to the frame clock, never to HUD redraw count.
    this.hitFlash = Math.max(0, this.hitFlash - elapsed);
    // FM ENU -> three (x=east stays, y=up from ENU z, z=north from ENU y)
    const px = a[S.PX] + (b[S.PX]-a[S.PX])*t;
    const py = a[S.PZ] + (b[S.PZ]-a[S.PZ])*t;
    const pz = a[S.PY] + (b[S.PY]-a[S.PY])*t;
    this.jet.position.set(px, py, pz);

    // orientation via basis vectors (quat can't cross an improper swap)
    // Position AND attitude must share one presentation time. Using the
    // current tick's rotation made the jet twitch relative to its camera on
    // displays whose refresh rate does not divide the 120 Hz simulation.
    this._q.set(a[S.QX], a[S.QY], a[S.QZ], a[S.QW]);
    this._nextQ.set(b[S.QX], b[S.QY], b[S.QZ], b[S.QW]);
    this._q.slerp(this._nextQ, t);
    const shown = this.renderState;
    shown.set(b);
    shown[S.PX] = px; shown[S.PY] = pz; shown[S.PZ] = py;
    shown[S.QX] = this._q.x; shown[S.QY] = this._q.y;
    shown[S.QZ] = this._q.z; shown[S.QW] = this._q.w;
    for (let slot = S.VX; slot <= S.VZ; slot++) shown[slot] = a[slot] + (b[slot] - a[slot]) * t;
    this._f.set(1, 0, 0).applyQuaternion(this._q);   // body fwd in ENU
    this._u.set(0, 0, -1).applyQuaternion(this._q);  // body up (FRD +z is down)
    const f = this._renderForward.set(this._f.x, this._f.z, this._f.y); // ENU->three
    const u = this._renderUp.set(this._u.x, this._u.z, this._u.y);
    const r = this._r.crossVectors(u, f).normalize();
    u.crossVectors(f, r).normalize();
    this._m.makeBasis(r, u, f);
    this.jet.quaternion.setFromRotationMatrix(this._m);
    this._aircraftPose?.update(a,b,t);

    this.gun.render(dt, camera);
    this.missiles.render(dt, camera);

    if (parked) return; // QA parked-camera owns the view
    // Smooth the chase OFFSET, then anchor it to the interpolated aircraft.
    // Smoothing absolute world positions creates variable translational lag:
    // every slow frame lets a fast aircraft pull away, then snaps it back.
    // Time-based damping retains the old 60 fps banking feel at any cadence.
    const back = 55, up = 16;
    this._camPos.set(-f.x * back + u.x * up, -f.y * back + u.y * up, -f.z * back + u.z * up);
    this._camUpTarget.set(u.x * 0.35, 1, u.z * 0.35);
    if (!this._cameraReady) {
      this._camOffset.copy(this._camPos);
      this._camUp.copy(this._camUpTarget);
      this._cameraReady = true;
    } else {
      this._camOffset.lerp(this._camPos, 1 - Math.pow(0.65, Math.max(0, dt) * 60));
      this._camUp.lerp(this._camUpTarget, 1 - Math.exp(-Math.max(0, dt) / CAMERA_UP_TAU));
    }
    camera.position.copy(this.jet.position).add(this._camOffset);
    // Normalize only the displayed vector, keeping the damped state linear
    // so the horizon has the same response at every display refresh rate.
    camera.up.copy(this._camUp).normalize();
    camera.lookAt(px + f.x * 120, py + f.y * 120, pz + f.z * 120);
  }

  hudState({ presentation = false } = {}) {
    const st = presentation ? this.renderState : this.fm.state, out = this.fm.out;
    // initFlight/reset establish velocity without ticking the physics. Its
    // derived outputs can still be zero or belong to the previous flight when
    // the welcome/pause card opens. Read the current state, including a real
    // zero-speed state. Player.tick supplies still air, so this is airspeed.
    const speed = Math.hypot(st[S.VX], st[S.VY], st[S.VZ]);
    // Match flight.js's ISA temperature model without advancing the world.
    const altitude = Math.max(-500, Math.min(30000, st[S.PZ]));
    const temperature = altitude <= 11000 ? 288.15 - 0.0065 * altitude : 216.65;
    const mach = speed / Math.sqrt(1.4 * 287.053 * temperature);
    // heading/pitch/roll from the body basis in ENU
    this._q.set(st[S.QX], st[S.QY], st[S.QZ], st[S.QW]);
    this._f.set(1, 0, 0).applyQuaternion(this._q);
    this._r.set(0, 1, 0).applyQuaternion(this._q); // body right wing in ENU
    this._u.set(0, 0, -1).applyQuaternion(this._q); // body up in ENU
    const heading = Math.atan2(this._f.x, this._f.y) * 180 / Math.PI; // from north, eastward
    const pitch = Math.asin(Math.max(-1, Math.min(1, this._f.z))) * 180 / Math.PI;
    // +roll = right bank: right wing dips → its ENU z goes negative
    // Both components contain cos(pitch), so atan2 cancels it and retains
    // the inverted half of the circle. A horizontal magnitude folded every
    // bank past 90 degrees back toward zero, hiding inverted flight.
    const roll = Math.atan2(-this._r.z, this._u.z) * 180 / Math.PI;
    return {
      speedKt: speed * 1.94384,
      altFt: st[S.PZ] * 3.28084,
      heading: (heading + 360) % 360,
      pitch, roll,
      g: out.nz,
      mach,
      aoa: out.alphaDeg,
      throttle: Math.round(this.throttleCmd * 100),
      ammo: this.gun.ammo,
      aam: this.missiles.ammo,
      hp: this.hp,
    };
  }
}
