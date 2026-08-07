// F-22A 6-DOF flight dynamics core (phase 7). Implements FM-PLAN.md verbatim:
// flat Float64Array state, 9-step force/moment assembly at DT=1/120, ISA
// atmosphere, f22data lookup() aero (wave drag, TVC), F119 spool lags,
// gear/ground contact. DETERMINISTIC: no Math.random, no Date, no wall clock;
// turbulence (if any) arrives via env from the seeded world system.
//
// Frames: world ENU (+x east, +y north, +z up); body FRD (+x fwd, +y right
// wing, +z down) per f22data sign conventions. Quaternion is body->world.
//
// Usage: fm = new FlightModel(); fm.initFlight({...}) or fm.initGround({...});
// fm.tick(dt, controls, env) each sim tick. controls = { aimPitch, aimYaw,
// throttle, rudder, rollOverride, mode, brake, gearDown } (WT-CONTROLS.md
// semantics via instructor.js). env = { groundH, wind?, altitude? }.

import { lookup, MASS, AERO, ENGINE } from "./f22data.js";
import { instructorTick } from "./instructor.js";

export const G0 = 9.80665;
const RGAS = 287.053, GAMMA = 1.4;
const DEG = Math.PI / 180, RAD = 180 / Math.PI;

// ---- state slots (FM-PLAN §1) ----
export const S = {
  PX: 0, PY: 1, PZ: 2,                 // position world ENU (m); PZ = altitude MSL
  QW: 3, QX: 4, QY: 5, QZ: 6,          // attitude quaternion body->world
  VX: 7, VY: 8, VZ: 9,                 // velocity world (m/s)
  P: 10, Q: 11, R: 12,                 // body rates (rad/s): +p right roll, +q nose up, +r nose right
  FUEL: 13,                            // fuel (kg)
  SPL: 14, SPR: 15,                    // engine dry spool L,R (0..1 of regime)
  ABL: 16, ABR: 17,                    // afterburner stage L,R (0..1)
  STABL: 18, STABR: 19,                // stabilator positions (deg, +TE down = nose-down)
  FLAPL: 20, FLAPR: 21,                // flaperon positions (deg)
  RUDL: 22, RUDR: 23,                  // rudder positions (deg)
  TVCL: 24, TVCR: 25,                  // TVC pitch nozzles (deg, + = nose-up moment)
  GEAR: 26, WSPIN: 27, BRAKE: 28,      // gear pos 0..1, wheel spin (m/s), brake pressure 0..1
  TRIM: 29, INTP: 30, INTR: 31,        // instructor integrators (pitch trim, roll, yaw)
};
export const STATE_LEN = 32;

// ---- actuator rates (deg/s) + first-order tau — FM-PLAN step 4 (EST) ----
const RATE_STAB = 60, RATE_FLAP = 80, RATE_RUD = 90, RATE_TVC = 45;
const TAU_ACT = 0.06;

// ---- gear geometry, body FRD m — FM-PLAN §5 (EST from drawings) ----
// Contact points at full extension; z = +2.2 below CG.
const GEAR_PTS = [
  { x: 5.5, y: 0.0, z: 2.2, nose: true },
  { x: -1.0, y: 2.3, z: 2.2, nose: false },
  { x: -1.0, y: -2.3, z: 2.2, nose: false },
];
const K_NOSE = 2.0e5, K_MAIN = 5.6e5;  // N/m — 0.3 m static compression class at MTOW
const GEAR_ZETA = 0.8;
const MU_ROLL = 0.02;
const MU_BRAKE_STATIC = 0.9;           // EST raised from plan's 0.55: dry-concrete static w/ anti-skid; gate = hold mil runup
const MU_BRAKE_SLIDE = 0.7;            // WT semantics: B brakes ALL wheels (nose incl.) — offsets brake weight-transfer to nose
const MU_SIDE = 1.2;
const GEAR_CD = 0.020;                 // EST gear-down drag increment
const ENG_Y_OFF = 0.65;                // EST lateral offset of each F119 centerline (m)

// ISA atmosphere (troposphere + isothermal stratosphere) — matches fm-sanity.mjs.
function isaInto(h, out) {
  const hh = h < -500 ? -500 : h > 30000 ? 30000 : h;
  let T, p;
  if (hh <= 11000) {
    T = 288.15 - 0.0065 * hh;
    p = 101325 * Math.pow(T / 288.15, G0 / (0.0065 * RGAS));
  } else {
    T = 216.65;
    const p11 = 101325 * Math.pow(216.65 / 288.15, G0 / (0.0065 * RGAS));
    p = p11 * Math.exp(-G0 * (hh - 11000) / (RGAS * T));
  }
  out.rho = p / (RGAS * T);
  out.a = Math.sqrt(GAMMA * RGAS * T);
  out.sigma = out.rho / 1.225;
}

export class FlightModel {
  constructor(opts = {}) {
    this.state = new Float64Array(STATE_LEN);
    this.payloadKg = opts.payloadKg !== undefined ? opts.payloadKg : 1400; // pilot + A2A load (EST)
    // Damage scale hooks (FM-PLAN §4) — all 1.0 = pristine.
    this.dmg = { liftL: 1, liftR: 1, stabL: 1, stabR: 1, rudL: 1, rudR: 1, tvcL: 1, tvcR: 1, flapL: 1, flapR: 1 };
    // Preallocated scratch (no per-tick allocation).
    this._R = new Float64Array(9);     // body->world rotation, m[row*3+col], cols = body axes
    this._atm = { rho: 1.225, a: 340.3, sigma: 1 };
    this._Fb = new Float64Array(3);    // aero+thrust force, body
    this._Mb = new Float64Array(3);    // total moment, body
    this._Fw = new Float64Array(3);    // gear force accumulator, world
    // Instructor exchange objects (instructor is a pure function of these).
    this.air = {
      V: 0, mach: 0, qbar: 0, alphaRad: 0, betaRad: 0, gammaRad: 0,
      p: 0, q: 0, r: 0, phat: 0, qhat: 0, rhat: 0,
      upZ: 1, rightWZ: 0, fwdW: new Float64Array(3), upW: new Float64Array(3),
      n: 1, mass: 26000, iyy: 0, ixx: 0, izz: 0, thrust: 0, cmStatic: 0, wow: false,
    };
    this.cmd = { stab: 0, flapRoll: 0, rud: 0, tvc: 0, nose: 0 };
    // Derived outputs for HUD/tests (recomputed every tick; not part of hash).
    this.out = {
      V: 0, mach: 0, qbar: 0, alphaDeg: 0, betaDeg: 0, gammaDeg: 0, nz: 1,
      thrust: 0, thrustFracDry: 0, wow: false, headingRad: 0, pitchDeg: 0, agl: 0,
    };
    this.reset();
  }

  reset() {
    const st = this.state;
    st.fill(0);
    st[S.QW] = 1;
    this.setAttitude(0, 0, 0);         // level, heading east (+x)
    st[S.FUEL] = 0.6 * MASS.fuelInternalKg;
    st[S.GEAR] = 1;
  }

  get massKg() { return MASS.emptyKg + this.payloadKg + this.state[S.FUEL]; }

  // Euler -> quaternion. yaw: math CCW from +x(east) about world up; pitch up +;
  // roll right +. Built from body axis vectors (fwd/right/down) then mat->quat.
  setAttitude(yawRad, pitchRad, rollRad) {
    const cy = Math.cos(yawRad), sy = Math.sin(yawRad);
    const cp = Math.cos(pitchRad), sp = Math.sin(pitchRad);
    const cr = Math.cos(rollRad), sr = Math.sin(rollRad);
    const fx = cp * cy, fy = cp * sy, fz = sp;
    // right0 = normalize(cross(fwd, worldUp)); down0 = cross(fwd, right0)
    let rx = fy, ry = -fx, rz = 0;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const dx = fy * rz - fz * ry, dy = fz * rx - fx * rz, dz = fx * ry - fy * rx;
    const Rx = rx * cr + dx * sr, Ry = ry * cr + dy * sr, Rz = rz * cr + dz * sr;
    const Dx = dx * cr - rx * sr, Dy = dy * cr - ry * sr, Dz = dz * cr - rz * sr;
    // rotation matrix, columns = fwd, right, down
    const m = this._R;
    m[0] = fx; m[1] = Rx; m[2] = Dx;
    m[3] = fy; m[4] = Ry; m[5] = Dy;
    m[6] = fz; m[7] = Rz; m[8] = Dz;
    this._matToQuat(m);
  }

  _matToQuat(m) {
    const st = this.state;
    const tr = m[0] + m[4] + m[8];
    let qw, qx, qy, qz;
    if (tr > 0) {
      const s = Math.sqrt(tr + 1) * 2;
      qw = 0.25 * s; qx = (m[7] - m[5]) / s; qy = (m[2] - m[6]) / s; qz = (m[3] - m[1]) / s;
    } else if (m[0] > m[4] && m[0] > m[8]) {
      const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
      qw = (m[7] - m[5]) / s; qx = 0.25 * s; qy = (m[1] + m[3]) / s; qz = (m[2] + m[6]) / s;
    } else if (m[4] > m[8]) {
      const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
      qw = (m[2] - m[6]) / s; qx = (m[1] + m[3]) / s; qy = 0.25 * s; qz = (m[5] + m[7]) / s;
    } else {
      const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
      qw = (m[3] - m[1]) / s; qx = (m[2] + m[6]) / s; qy = (m[5] + m[7]) / s; qz = 0.25 * s;
    }
    const n = Math.hypot(qw, qx, qy, qz) || 1;
    st[S.QW] = qw / n; st[S.QX] = qx / n; st[S.QY] = qy / n; st[S.QZ] = qz / n;
  }

  _quatToMat() {
    const st = this.state, m = this._R;
    const w = st[S.QW], x = st[S.QX], y = st[S.QY], z = st[S.QZ];
    m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - w * z); m[2] = 2 * (x * z + w * y);
    m[3] = 2 * (x * y + w * z); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z - w * x);
    m[6] = 2 * (x * z - w * y); m[7] = 2 * (y * z + w * x); m[8] = 1 - 2 * (x * x + y * y);
  }

  // In-air spawn, pre-trimmed enough for the FCS to settle in ~2 s.
  initFlight({ x = 0, y = 0, alt = 3000, headingRad = 0, speed = 200, fpaRad = 0,
               alphaDeg = 2, fuelKg = 0.6 * MASS.fuelInternalKg, throttle = 0.5, gearDown = false } = {}) {
    const st = this.state;
    st.fill(0);
    st[S.PX] = x; st[S.PY] = y; st[S.PZ] = alt;
    this.setAttitude(headingRad, fpaRad + alphaDeg * DEG, 0);
    st[S.VX] = speed * Math.cos(fpaRad) * Math.cos(headingRad);
    st[S.VY] = speed * Math.cos(fpaRad) * Math.sin(headingRad);
    st[S.VZ] = speed * Math.sin(fpaRad);
    st[S.FUEL] = fuelKg;
    const dry = ENGINE.idleFraction + (1 - ENGINE.idleFraction) * Math.min(Math.max(throttle, 0), 1);
    st[S.SPL] = dry; st[S.SPR] = dry;
    st[S.GEAR] = gearDown ? 1 : 0;
  }

  // On-wheels spawn (runway). Sits at static gear compression.
  initGround({ x = 0, y = 0, groundH = 0, headingRad = 0, fuelKg = 6000 } = {}) {
    const st = this.state;
    st.fill(0);
    this.setAttitude(headingRad, 0, 0);
    st[S.PX] = x; st[S.PY] = y;
    st[S.FUEL] = fuelKg;
    st[S.GEAR] = 1;
    st[S.SPL] = ENGINE.idleFraction; st[S.SPR] = ENGINE.idleFraction;
    // static compression: mains carry ~arm-weighted share of W
    const W = this.massKg * G0;
    const comp = (W * 0.846 * 0.5) / K_MAIN; // per-main share
    st[S.PZ] = groundH + GEAR_PTS[1].z - comp;
  }

  // ---- the 9-step tick (FM-PLAN §2) ----
  tick(dt, controls, env) {
    const st = this.state, m = this._R, air = this.air, out = this.out;
    const groundH = env && env.groundH !== undefined ? env.groundH : 0;

    // 1. atmosphere
    const altMsl = env && env.altitude !== undefined ? env.altitude : st[S.PZ];
    isaInto(altMsl, this._atm);
    const rho = this._atm.rho, sndSpd = this._atm.a, sigma = this._atm.sigma;

    // 2. airdata
    this._quatToMat();
    const wx = env && env.wind ? env.wind[0] : 0;
    const wy = env && env.wind ? env.wind[1] : 0;
    const wz = env && env.wind ? env.wind[2] : 0;
    const vax = st[S.VX] - wx, vay = st[S.VY] - wy, vaz = st[S.VZ] - wz;
    // world -> body: dot with body axis columns; body z is DOWN so world +z maps negative
    const u = m[0] * vax + m[3] * vay + m[6] * vaz;
    const v = m[1] * vax + m[4] * vay + m[7] * vaz;
    const w = m[2] * vax + m[5] * vay + m[8] * vaz;
    const V = Math.hypot(vax, vay, vaz);
    const mach = V / sndSpd;
    const qbar = 0.5 * rho * V * V;
    let alpha = 0, beta = 0;
    if (V > 1) { alpha = Math.atan2(w, u); beta = Math.asin(Math.max(-1, Math.min(1, v / V))); }
    const gV = Math.hypot(st[S.VX], st[S.VY], st[S.VZ]);
    const gamma = gV > 1 ? Math.asin(Math.max(-1, Math.min(1, st[S.VZ] / gV))) : 0;
    const mass = this.massKg;
    const iScale = MASS.inertia.scaleWithMass ? mass / MASS.combatKg : 1;
    const ixx = MASS.inertia.ixx * iScale, iyy = MASS.inertia.iyy * iScale;
    const izz = MASS.inertia.izz * iScale, ixz = MASS.inertia.ixz * iScale;
    const b = MASS.spanM, cbar = MASS.macM, Sw = MASS.wingAreaM2;
    const v2 = V > 1 ? 2 * V : 2;
    const phat = st[S.P] * b / v2, qhat = st[S.Q] * cbar / v2, rhat = st[S.R] * b / v2;
    const alphaDeg = alpha * RAD;
    const fuelFrac = Math.max(0, Math.min(1, st[S.FUEL] / MASS.fuelInternalKg));
    const cgMac = MASS.cgEmptyMac + (MASS.cgFullFuelMac - MASS.cgEmptyMac) * fuelFrac;
    // ground effect (FM-PLAN §5) — McCormick
    const agl = Math.max(0.1, st[S.PZ] - groundH);
    const ge16 = (16 * agl / b) * (16 * agl / b);
    const geFactor = ge16 / (1 + ge16);
    // thrust magnitude estimate from current spool state (pure fn of state) — for TVC blend
    const lapse = Math.pow(sigma, ENGINE.lapseExponent) * lookup(ENGINE.machFactor, mach);
    const dT = ENGINE.thrustAbSlsN - ENGINE.thrustDrySlsN;
    const thrEstL = st[S.SPL] * ENGINE.thrustDrySlsN * lapse * (1 + st[S.ABL] * dT / ENGINE.thrustDrySlsN);
    const thrEstR = st[S.SPR] * ENGINE.thrustDrySlsN * lapse * (1 + st[S.ABR] * dT / ENGINE.thrustDrySlsN);
    // WOW estimate: geometric contact test (pure fn of state)
    let wow = false;
    if (st[S.GEAR] > 0.5 && st[S.PZ] - groundH < 5) {
      for (let i = 0; i < 3; i++) {
        const g = GEAR_PTS[i];
        const czW = st[S.PZ] + (m[2] * g.x + m[5] * g.y + m[8] * g.z);
        if (czW <= groundH) { wow = true; break; }
      }
    }
    const dmgLift = 0.5 * (this.dmg.liftL + this.dmg.liftR);
    const CLnow = lookup(AERO.cl, alphaDeg) * dmgLift;
    // static pitching moment (no stab/TVC/damping) — instructor inverts this
    const cmStatic = lookup(AERO.cm, alphaDeg) + CLnow * (cgMac - 0.30) - 0.008 * (1 - geFactor);

    air.V = V; air.mach = mach; air.qbar = qbar;
    air.alphaRad = alpha; air.betaRad = beta; air.gammaRad = gamma;
    air.p = st[S.P]; air.q = st[S.Q]; air.r = st[S.R];
    air.phat = phat; air.qhat = qhat; air.rhat = rhat;
    air.upZ = -m[8]; air.rightWZ = m[7];
    air.fwdW[0] = gV > 1 ? st[S.VX] / gV : m[0];
    air.fwdW[1] = gV > 1 ? st[S.VY] / gV : m[3];
    air.fwdW[2] = gV > 1 ? st[S.VZ] / gV : m[6];
    air.upW[0] = -m[2]; air.upW[1] = -m[5]; air.upW[2] = -m[8];
    air.n = qbar * Sw * CLnow / (mass * G0);
    air.mass = mass; air.ixx = ixx; air.iyy = iyy; air.izz = izz;
    air.thrust = thrEstL + thrEstR;
    air.cmStatic = cmStatic;
    air.wow = wow;

    // 3. instructor/FCS -> commanded deflections (writes this.cmd, integrators in st)
    instructorTick(st, S, air, controls, dt, this.cmd);

    // 4. actuators — rate-limited first-order toward commands
    this._act(S.STABL, this.cmd.stab, RATE_STAB, AERO.controls.stab.maxDeg, dt);
    this._act(S.STABR, this.cmd.stab, RATE_STAB, AERO.controls.stab.maxDeg, dt);
    this._act(S.FLAPL, this.cmd.flapRoll, RATE_FLAP, AERO.controls.flaperon.maxDeg, dt);
    this._act(S.FLAPR, -this.cmd.flapRoll, RATE_FLAP, AERO.controls.flaperon.maxDeg, dt);
    this._act(S.RUDL, this.cmd.rud, RATE_RUD, AERO.controls.rudder.maxDeg, dt);
    this._act(S.RUDR, this.cmd.rud, RATE_RUD, AERO.controls.rudder.maxDeg, dt);
    this._act(S.TVCL, this.cmd.tvc, RATE_TVC, AERO.controls.tvc.maxDeg, dt);
    this._act(S.TVCR, this.cmd.tvc, RATE_TVC, AERO.controls.tvc.maxDeg, dt);
    const gearTgt = controls && controls.gearDown !== undefined
      ? (controls.gearDown ? 1 : 0) : st[S.GEAR]; // unspecified = hold current
    st[S.GEAR] += Math.max(-0.25 * dt, Math.min(0.25 * dt, gearTgt - st[S.GEAR]));
    const brkTgt = controls && controls.brake ? Math.min(1, controls.brake) : 0;
    st[S.BRAKE] += (brkTgt - st[S.BRAKE]) * Math.min(1, dt / 0.15);

    // 5. engines — F119 spool lags, thrust, fuel burn
    const thr = Math.max(0, Math.min(1.1, controls && controls.throttle !== undefined ? controls.throttle : 0));
    const fuelOut = st[S.FUEL] <= 0;
    const dryTgt = fuelOut ? 0 : ENGINE.idleFraction + (1 - ENGINE.idleFraction) * Math.min(thr, 1);
    const abTgt = fuelOut || thr <= 1.001 ? 0 : 1;
    const kDry = Math.min(1, dt / ENGINE.spoolTauDryS), kAb = Math.min(1, dt / ENGINE.spoolTauAbS);
    st[S.SPL] += (dryTgt - st[S.SPL]) * kDry;
    st[S.SPR] += (dryTgt - st[S.SPR]) * kDry;
    st[S.ABL] += (abTgt - st[S.ABL]) * kAb;
    st[S.ABR] += (abTgt - st[S.ABR]) * kAb;
    const tDryL = st[S.SPL] * ENGINE.thrustDrySlsN * lapse;
    const tDryR = st[S.SPR] * ENGINE.thrustDrySlsN * lapse;
    const tAbL = st[S.ABL] * st[S.SPL] * dT * lapse;
    const tAbR = st[S.ABR] * st[S.SPR] * dT * lapse;
    const thrustL = tDryL + tAbL, thrustR = tDryR + tAbR;
    const sfcL = ENGINE.sfcDryKgPerNs + (ENGINE.sfcAbKgPerNs - ENGINE.sfcDryKgPerNs) * st[S.ABL];
    const sfcR = ENGINE.sfcDryKgPerNs + (ENGINE.sfcAbKgPerNs - ENGINE.sfcDryKgPerNs) * st[S.ABR];
    st[S.FUEL] = Math.max(0, st[S.FUEL] - (sfcL * thrustL + sfcR * thrustR) * dt);

    // 6. aero coefficients (FM-PLAN step 6)
    const dStab = 0.5 * (st[S.STABL] * this.dmg.stabL + st[S.STABR] * this.dmg.stabR);
    const dFlap = 0.5 * (st[S.FLAPL] * this.dmg.flapL - st[S.FLAPR] * this.dmg.flapR);
    const dRud = 0.5 * (st[S.RUDL] * this.dmg.rudL + st[S.RUDR] * this.dmg.rudR);
    const CL = CLnow;
    const CD = lookup(AERO.cd0, alphaDeg) * lookup(AERO.waveFactor, mach)
      + AERO.inducedK * geFactor * CL * CL + GEAR_CD * st[S.GEAR];
    const Cm = cmStatic + AERO.controls.stab.cmPerDeg * dStab + AERO.damping.cmq * qhat;
    const dmgAsymCl = 0.5 * CL * (this.dmg.liftL - this.dmg.liftR) * 0.35 / 2; // y_bar ~0.35 b/2 (FM-PLAN §4)
    const Cl = AERO.damping.clBeta * beta + AERO.controls.flaperon.clPerDeg * dFlap
      + AERO.damping.clp * phat + dmgAsymCl;
    const Cn = AERO.damping.cnBeta * beta + AERO.controls.rudder.cnPerDeg * dRud
      + AERO.damping.cnr * rhat;
    const CY = AERO.damping.cyBeta * beta;

    // 7. forces & moments (wind->body, thrust w/ TVC, gravity in world)
    const qS = qbar * Sw;
    const L = qS * CL, D = qS * CD, Y = qS * CY;
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const cb = Math.cos(beta), sb = Math.sin(beta);
    const Fb = this._Fb, Mb = this._Mb;
    Fb[0] = -D * ca * cb - Y * ca * sb + L * sa;
    Fb[1] = -D * sb + Y * cb;
    Fb[2] = -D * sa * cb - Y * sa * sb - L * ca;
    Mb[0] = qS * b * Cl;
    Mb[1] = qS * cbar * Cm;
    Mb[2] = qS * b * Cn;
    // thrust + TVC (per-engine: asymmetry -> free yaw/roll moments)
    const dTvcL = st[S.TVCL] * this.dmg.tvcL * DEG, dTvcR = st[S.TVCR] * this.dmg.tvcR * DEG;
    const fxL = thrustL * Math.cos(dTvcL), fzL = thrustL * Math.sin(dTvcL);
    const fxR = thrustR * Math.cos(dTvcR), fzR = thrustR * Math.sin(dTvcR);
    Fb[0] += fxL + fxR;
    Fb[2] += fzL + fzR;
    const arm = AERO.controls.tvc.armM;
    Mb[0] += -ENG_Y_OFF * fzL + ENG_Y_OFF * fzR;
    Mb[1] += (fzL + fzR) * arm;
    Mb[2] += ENG_Y_OFF * fxL - ENG_Y_OFF * fxR;
    // load factor (aero+thrust specific force, body -z up) — before gear/gravity
    out.nz = -Fb[2] / (mass * G0);

    // 8. ground contact (FM-PLAN §5)
    const Fw = this._Fw;
    Fw[0] = 0; Fw[1] = 0; Fw[2] = 0;
    let anyContact = false, groundSpeed = 0;
    if (st[S.GEAR] > 0.5 && st[S.PZ] - groundH < 6) {
      const cDampM = 2 * GEAR_ZETA * Math.sqrt(K_MAIN * mass / 3);
      const cDampN = 2 * GEAR_ZETA * Math.sqrt(K_NOSE * mass / 3);
      // total forward thrust along ground for the brake static solve
      const thrFwdW = (fxL + fxR); // body x ~ horizontal on ground
      for (let i = 0; i < 3; i++) {
        const g = GEAR_PTS[i];
        // contact point world offset r_w = R * r_b
        const rwx = m[0] * g.x + m[1] * g.y + m[2] * g.z;
        const rwy = m[3] * g.x + m[4] * g.y + m[5] * g.z;
        const rwz = m[6] * g.x + m[7] * g.y + m[8] * g.z;
        const pen = groundH - (st[S.PZ] + rwz);
        if (pen <= 0) continue;
        anyContact = true;
        // contact point velocity: v + omega x r (body) rotated to world
        const oxr_bx = st[S.Q] * g.z - st[S.R] * g.y;
        const oxr_by = st[S.R] * g.x - st[S.P] * g.z;
        const oxr_bz = st[S.P] * g.y - st[S.Q] * g.x;
        const vcx = st[S.VX] + m[0] * oxr_bx + m[1] * oxr_by + m[2] * oxr_bz;
        const vcy = st[S.VY] + m[3] * oxr_bx + m[4] * oxr_by + m[5] * oxr_bz;
        const vcz = st[S.VZ] + m[6] * oxr_bx + m[7] * oxr_by + m[8] * oxr_bz;
        const k = g.nose ? K_NOSE : K_MAIN;
        const c = g.nose ? cDampN : cDampM;
        let N = k * pen - c * vcz;
        if (N < 0) N = 0;
        // wheel ground-plane axes: forward = body x projected; nose wheel steers
        let wfx = m[0], wfy = m[3];
        const wfl = Math.hypot(wfx, wfy) || 1;
        wfx /= wfl; wfy /= wfl;
        if (g.nose && this.cmd.nose !== 0) {
          // + steer = nose right = clockwise from above (heading decreases)
          const sA = -this.cmd.nose * DEG;
          const cs = Math.cos(sA), sn = Math.sin(sA);
          const nx = wfx * cs - wfy * sn, ny = wfx * sn + wfy * cs;
          wfx = nx; wfy = ny;
        }
        const wlx = -wfy, wly = wfx; // left-perp; lateral axis
        const vF = vcx * wfx + vcy * wfy;
        const vL = vcx * wlx + vcy * wly;
        let Flong = 0;
        const braked = st[S.BRAKE] > 0.01; // all wheels (WT wheel-brake semantics)
        if (braked && Math.abs(vF) < 1) {
          // static solve: cancel momentum + thrust share, clamped to friction cone
          const need = -((mass / 3) * vF / dt + thrFwdW / 3) * st[S.BRAKE];
          const cap = MU_BRAKE_STATIC * N * st[S.BRAKE];
          Flong = Math.max(-cap, Math.min(cap, need));
        } else if (braked) {
          Flong = -MU_BRAKE_SLIDE * N * st[S.BRAKE] * Math.sign(vF);
        }
        if (Math.abs(vF) > 0.1) Flong += -MU_ROLL * N * Math.sign(vF);
        const capSide = MU_SIDE * N;
        const Flat = Math.max(-capSide, Math.min(capSide, -(mass / 3) * vL / dt));
        const Fx = wfx * Flong + wlx * Flat;
        const Fy = wfy * Flong + wly * Flat;
        Fw[0] += Fx; Fw[1] += Fy; Fw[2] += N;
        // moment: world force -> body, r_b x F_b
        const fbx = m[0] * Fx + m[3] * Fy + m[6] * N;
        const fby = m[1] * Fx + m[4] * Fy + m[7] * N;
        const fbz = m[2] * Fx + m[5] * Fy + m[8] * N;
        Mb[0] += g.y * fbz - g.z * fby;
        Mb[1] += g.z * fbx - g.x * fbz;
        Mb[2] += g.x * fby - g.y * fbx;
        groundSpeed = Math.hypot(vcx, vcy);
      }
    }
    st[S.WSPIN] = anyContact ? groundSpeed : st[S.WSPIN] * Math.max(0, 1 - dt / 0.5);

    // 9. integrate — semi-implicit Euler, fixed order
    const ax = (m[0] * Fb[0] + m[1] * Fb[1] + m[2] * Fb[2] + Fw[0]) / mass;
    const ay = (m[3] * Fb[0] + m[4] * Fb[1] + m[5] * Fb[2] + Fw[1]) / mass;
    const az = (m[6] * Fb[0] + m[7] * Fb[1] + m[8] * Fb[2] + Fw[2]) / mass - G0;
    // angular: hdot = M - omega x (I omega); solve coupled p,r (Ixz)
    const p = st[S.P], q = st[S.Q], r = st[S.R];
    const hx = ixx * p - ixz * r, hy = iyy * q, hz = -ixz * p + izz * r;
    const Mpx = Mb[0] - (q * hz - r * hy);
    const Mpy = Mb[1] - (r * hx - p * hz);
    const Mpz = Mb[2] - (p * hy - q * hx);
    const det = ixx * izz - ixz * ixz;
    const pdot = (Mpx * izz + Mpz * ixz) / det;
    const rdot = (Mpx * ixz + Mpz * ixx) / det;
    const qdot = Mpy / iyy;
    st[S.P] += pdot * dt; st[S.Q] += qdot * dt; st[S.R] += rdot * dt;
    st[S.VX] += ax * dt; st[S.VY] += ay * dt; st[S.VZ] += az * dt;
    st[S.PX] += st[S.VX] * dt; st[S.PY] += st[S.VY] * dt; st[S.PZ] += st[S.VZ] * dt;
    // quaternion: qdot = 1/2 q (x) omega_body (new omega — semi-implicit)
    const P2 = st[S.P], Q2 = st[S.Q], R2 = st[S.R];
    const qw = st[S.QW], qx = st[S.QX], qy = st[S.QY], qz = st[S.QZ];
    const dqw = 0.5 * (-qx * P2 - qy * Q2 - qz * R2);
    const dqx = 0.5 * (qw * P2 + qy * R2 - qz * Q2);
    const dqy = 0.5 * (qw * Q2 - qx * R2 + qz * P2);
    const dqz = 0.5 * (qw * R2 + qx * Q2 - qy * P2);
    let nw = qw + dqw * dt, nx = qx + dqx * dt, ny = qy + dqy * dt, nz = qz + dqz * dt;
    const qn = Math.hypot(nw, nx, ny, nz) || 1;
    st[S.QW] = nw / qn; st[S.QX] = nx / qn; st[S.QY] = ny / qn; st[S.QZ] = nz / qn;

    // derived outputs (HUD/tests)
    out.V = V; out.mach = mach; out.qbar = qbar;
    out.alphaDeg = alphaDeg; out.betaDeg = beta * RAD; out.gammaDeg = gamma * RAD;
    out.thrust = thrustL + thrustR;
    const dryAvail = 2 * ENGINE.thrustDrySlsN * lapse;
    out.thrustFracDry = dryAvail > 0 ? (thrustL + thrustR) / dryAvail : 0;
    out.wow = anyContact;
    out.headingRad = Math.atan2(m[3], m[0]);
    out.pitchDeg = Math.asin(Math.max(-1, Math.min(1, m[6]))) * RAD;
    out.agl = st[S.PZ] - groundH;
  }

  _act(slot, cmdDeg, rateDegS, maxDeg, dt) {
    const st = this.state;
    const tgt = Math.max(-maxDeg, Math.min(maxDeg, cmdDeg));
    let v = (tgt - st[slot]) / TAU_ACT;
    if (v > rateDegS) v = rateDegS; else if (v < -rateDegS) v = -rateDegS;
    st[slot] += v * dt;
  }

  // Fold FM state into a running FNV hash (mirrors testworld.js pattern).
  hash(h) {
    const st = this.state;
    for (let i = 0; i < st.length; i++) {
      h = (Math.imul(h ^ ((st[i] * 1e6) | 0), 0x01000193)) >>> 0;
    }
    return h;
  }
}
