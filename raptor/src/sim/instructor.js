// WT-style 5-layer instructor / FCS (FM-PLAN §3, WT-CONTROLS.md semantics).
// Pure function of (state, air, input, dt) — no DOM, no clocks, no rng.
// Integrator state lives in the flight state vector (slots TRIM/INTP/INTR) so
// the whole control loop hashes with the aircraft (determinism).
//
// Inputs (from binds layer): { aimPitch, aimYaw, throttle, rudder,
//   rollOverride, mode, brake, gearDown }
//   mode "mouse": aimPitch = desired flight-path angle (rad), aimYaw = desired
//     heading (rad, math CCW from +x/east). rollOverride/rudder = WASDQE-style
//     direct overrides in [-1,1] that bypass layers 1-2 (WT behavior).
//   mode "real":  aimPitch = virtual-stick pull [-1..1] (+ = aft), rollOverride
//     = roll stick, rudder = pedals. Enters at layer 3 (rate commands +
//     limiter, no aim marker).
//   mode "sim":   direct layer-5 deflections; limiter off, minimal pitch-damper
//     SAS only (bare airframe is unstable).
//
// Layers: 1 aim vector -> desired path · 2 path error -> lift vector + n_cmd ·
// 3 rate commands (q,p,r) + auto-rudder/auto-trim · 4 predictive alpha/G
// limiter · 5 rate->surface PI w/ dynamic-inversion feed-forward + TVC blend.

import { lookup, MASS, AERO, LIMITS } from "./f22data.js";

const DEG = Math.PI / 180, RAD = 180 / Math.PI;
const G0 = 9.80665;

// FCS gains — deterministic constants, tuned against fm-battery.mjs.
export const GAINS = {
  // layer 1-2: aim tracking
  kAim: 1.2,             // path turn-rate per rad of aim error (1/s)
  omegaAimMax: 0.55,     // path turn-rate cap (rad/s)
  kBank: 3.0,            // roll-rate cmd per rad of bank error (1/s)
  pushBankErr: 2.6,      // beyond this bank error (rad) w/ small aim error: push, don't roll
  pushAimErr: 0.35,
  // layer 3: rate commands
  kNq: 0.3,              // proportional G-error boost on q_cmd (rad/s per g)
  tauAlphaCmd: 0.5,      // alpha-command time constant (s), low-speed regime
  kBeta: 4.0,            // auto-rudder yaw-rate per rad of beta (1/s)
  rudderRateAuth: 0.5,   // pedal authority (rad/s of r_cmd)
  alphaTrimMaxDeg: 12,   // stick-neutral alpha target ceiling (recovery attitude)
  // layer 4: envelope limiter
  nMax: LIMITS.gMax, nMin: LIMITS.gMin,
  gGov: 0.6,             // proportional G-governor (rad/s of q_cmd per g of margin)
  tauAlphaPred: 0.5,     // predictive alpha horizon (s)
  alphaLimHiQ: 35,       // alpha limiter at high qbar (deg)
  alphaLimLoQ: LIMITS.alphaMaxDeg, // 60 deg arcade limit at low qbar
  alphaLimNeg: 20,       // negative alpha limit (deg)
  qbarBlend: 8000,       // Pa — low-speed/high-speed regime blend point (FM-PLAN q0)
  rollRateMax: LIMITS.rollRateMaxDegS * DEG,
  // layer 5: rate loops (dynamic inversion + PI)
  tauQ: 0.25, kiQ: 3.0, intQMax: 0.15,
  tauP: 0.15,
  tauR: 0.22,
  qbarTvc: 8000,         // Pa — TVC carries the pitch loop below this (FM-PLAN q0)
  tvcThrustRef: 60000,   // N — TVC blend fades as thrust drops below this
  qbarEffMin: 300,       // Pa — inversion denominator floor
  // ground mode
  nosewheelMaxDeg: 60,
  nosewheelFadeMs: 26,   // m/s (~50 kt): steering blends out
  simSasDegPerRadS: 8,   // full-real minimal pitch damper
};

// Inverse of the CL(alpha) table over its rising branch (-10..35 deg).
function alphaForCL(cl) {
  const t = AERO.cl;
  if (cl <= t[0][1]) return t[0][0];
  for (let i = 1; i < t.length; i++) {
    const a1 = t[i][0];
    if (a1 > 35.01) break;
    if (cl <= t[i][1]) {
      const a0 = t[i - 1][0], c0 = t[i - 1][1], c1 = t[i][1];
      return a0 + (a1 - a0) * ((cl - c0) / (c1 - c0));
    }
  }
  return 35;
}

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

export function instructorTick(st, S, air, input, dt, cmd) {
  const mode = input && input.mode ? input.mode : "mouse";
  const G = GAINS;
  const stick = input ? clamp(input.aimPitch || 0, -1, 1) : 0;
  const rollIn = input ? clamp(input.rollOverride || 0, -1, 1) : 0;
  const rudIn = input ? clamp(input.rudder || 0, -1, 1) : 0;

  // ---- full-real: direct deflections + minimal SAS ----
  if (mode === "sim") {
    cmd.stab = -stick * AERO.controls.stab.maxDeg + air.q * G.simSasDegPerRadS;
    cmd.flapRoll = rollIn * AERO.controls.flaperon.maxDeg;
    cmd.rud = rudIn * AERO.controls.rudder.maxDeg;
    cmd.tvc = 0;
    cmd.nose = air.wow ? rudIn * nosewheelDeg(air.V) : 0;
    st[S.TRIM] *= Math.max(0, 1 - dt * 2);
    return;
  }

  // ---- ground mode (weight on wheels): no alpha limiter, direct nosewheel ----
  if (air.wow) {
    const pitchStick = mode === "mouse" ? clamp((input.aimPitch || 0) * 4, -1, 1) : stick;
    cmd.stab = -pitchStick * AERO.controls.stab.maxDeg;
    cmd.flapRoll = rollIn * AERO.controls.flaperon.maxDeg;
    cmd.rud = rudIn * AERO.controls.rudder.maxDeg;
    cmd.tvc = 0;
    cmd.nose = rudIn * nosewheelDeg(air.V);
    // integrators bleed off on the ground — clean air-mode handoff
    st[S.TRIM] *= Math.max(0, 1 - dt * 2);
    st[S.INTP] = 0; st[S.INTR] = 0;
    return;
  }
  cmd.nose = 0;

  const V = Math.max(air.V, 20), qbar = air.qbar, mass = air.mass;
  const Sw = MASS.wingAreaM2, bSpan = MASS.spanM, cbar = MASS.macM;
  const alphaDeg = air.alphaRad * RAD;
  const wLow = clamp(1 - qbar / G.qbarBlend, 0, 1);        // 1 = post-stall/low-q regime
  const alphaLim = G.alphaLimHiQ + (G.alphaLimLoQ - G.alphaLimHiQ) * wLow;
  const qbarEff = Math.max(qbar, G.qbarEffMin);

  // ================= layers 1-2: aim -> lift vector + n_cmd =================
  let nCmd, pCmd;
  if (mode === "mouse") {
    const f = air.fwdW, up = air.upW;
    const dcp = Math.cos(input.aimPitch || 0), dsp = Math.sin(input.aimPitch || 0);
    const dx = dcp * Math.cos(input.aimYaw || 0);
    const dy = dcp * Math.sin(input.aimYaw || 0);
    const dz = dsp;
    const dot = clamp(f[0] * dx + f[1] * dy + f[2] * dz, -1, 1);
    const eps = Math.acos(dot);
    // required perpendicular specific force: turn accel toward marker + cancel
    // gravity's perpendicular component  S = V*omega*e_hat - g_perp
    const omega = Math.min(G.kAim * eps, G.omegaAimMax);
    let ex = dx - f[0] * dot, ey = dy - f[1] * dot, ez = dz - f[2] * dot;
    const el = Math.hypot(ex, ey, ez);
    if (el > 1e-6) { ex /= el; ey /= el; ez /= el; } else { ex = up[0]; ey = up[1]; ez = up[2]; }
    const gpx = -G0 * (0 - f[0] * f[2]);   // g_perp = -g( z_hat - f*f_z )
    const gpy = -G0 * (0 - f[1] * f[2]);
    const gpz = -G0 * (1 - f[2] * f[2]);
    let Sx = V * omega * ex - gpx, Sy = V * omega * ey - gpy, Sz = V * omega * ez - gpz;
    const Sm = Math.hypot(Sx, Sy, Sz);
    const nRaw = Sm / G0;
    if (Sm > 1e-6) { Sx /= Sm; Sy /= Sm; Sz /= Sm; } else { Sx = up[0]; Sy = up[1]; Sz = up[2]; }
    // signed bank error: rotation about f from current lift axis (upW) to S_hat
    const cosB = clamp(up[0] * Sx + up[1] * Sy + up[2] * Sz, -1, 1);
    const cx = up[1] * Sz - up[2] * Sy, cy = up[2] * Sx - up[0] * Sz, cz = up[0] * Sy - up[1] * Sx;
    const sinB = cx * f[0] + cy * f[1] + cz * f[2];
    const bankErr = Math.atan2(sinB, cosB);
    if (Math.abs(bankErr) > G.pushBankErr && eps < G.pushAimErr) {
      // target nearly behind the lift vector but close to the nose: push, don't roll
      nCmd = clamp(-nRaw * Math.abs(cosB), G.nMin, 1);
      pCmd = 0;
    } else {
      // roll lift vector onto S_hat; pull scaled by alignment (unload mid-roll)
      nCmd = clamp(nRaw * Math.max(cosB, 0.15), G.nMin, G.nMax);
      pCmd = clamp(G.kBank * bankErr, -G.rollRateMax, G.rollRateMax);
    }
    if (rollIn !== 0) pCmd = rollIn * G.rollRateMax; // WASDQE override bypasses layer 2
  } else {
    // realistic: virtual stick -> load-factor command, neutral = 1g
    nCmd = stick >= 0 ? 1 + stick * (G.nMax - 1) : 1 + stick * (1 - G.nMin);
    pCmd = rollIn * G.rollRateMax;
  }

  // ============== layer 3: rate commands (q, p, r) + auto-trim ==============
  // G-path: wind-axis relation q = g(n - cos(gamma-ish))/V, using the true
  // body-z gravity share upZ (exact for coordinated banked flight), plus a
  // proportional G-error boost so onset beats the drag-bleed race; the alpha
  // predictor + G governor in layer 4 keep it from overshooting.
  const qG = G0 * (nCmd - air.upZ) / V + G.kNq * (nCmd - air.n);
  // alpha-path (low-q / post-stall regime): command alpha directly.
  const clReq = nCmd * mass * G0 / (qbarEff * Sw);
  const alphaTrim = clamp(alphaForCL(air.upZ * mass * G0 / (qbarEff * Sw)), -5, G.alphaTrimMaxDeg);
  const sEff = mode === "mouse"
    ? clamp(nCmd >= 1 ? (nCmd - 1) / (G.nMax - 1) : (nCmd - 1) / (1 - G.nMin), -1, 1)
    : stick;
  let alphaTgt;
  if (sEff >= 0) alphaTgt = alphaTrim + sEff * (alphaLim - alphaTrim);
  else alphaTgt = alphaTrim + sEff * (alphaTrim + G.alphaLimNeg);
  // if the aero can deliver n_cmd below the limiter, target that alpha instead
  if (clReq < lookup(AERO.cl, 35)) {
    const aFromN = alphaForCL(clReq);
    if (sEff >= 0 && aFromN < alphaTgt) alphaTgt = Math.max(aFromN, alphaTrim);
  }
  const qAlpha = (alphaTgt - alphaDeg) * DEG / G.tauAlphaCmd;
  let qCmd = (1 - wLow) * qG + wLow * qAlpha;

  // auto-rudder: turn coordination + beta -> 0; pedals add on top
  const sinBank = -air.rightWZ; // level right bank: rightWZ = -sin(phi)
  let rCmd = (G0 / V) * sinBank + G.kBeta * air.betaRad + rudIn * G.rudderRateAuth;

  // ================= layer 4: predictive alpha/G envelope limiter =================
  // G governor (proportional clamp toward the structural limits)
  const qGmax = G0 * (G.nMax - air.upZ) / V + G.gGov * (G.nMax - air.n);
  const qGmin = G0 * (G.nMin - air.upZ) / V - G.gGov * (air.n - G.nMin);
  qCmd = clamp(qCmd, qGmin, qGmax);
  // predictive alpha clamp: alpha_pred = alpha + q_cmd*tau <= limiter
  const aPred = alphaDeg + qCmd * RAD * G.tauAlphaPred;
  if (aPred > alphaLim) qCmd = (alphaLim - alphaDeg) * DEG / G.tauAlphaPred;
  else if (aPred < -G.alphaLimNeg) qCmd = (-G.alphaLimNeg - alphaDeg) * DEG / G.tauAlphaPred;
  // roll-rate cap + post-stall roll authority fade (departure resistance)
  const rollScale = clamp(1.2 - 0.8 * Math.max(alphaDeg, 0) / alphaLim, 0.25, 1);
  pCmd = clamp(pCmd, -G.rollRateMax, G.rollRateMax) * rollScale;

  // ============ layer 5: rate -> surfaces (inversion + PI) + TVC blend ============
  // pitch: invert the known static moment (both ~qbar -> works at any speed),
  // PI supplies the inertial moment demand, split stab/TVC by qbar weight.
  const qErr = qCmd - air.q;
  st[S.TRIM] = clamp(st[S.TRIM] + qErr * dt, -G.intQMax, G.intQMax); // auto-trim integrator
  const qdotDes = qErr / G.tauQ + G.kiQ * st[S.TRIM];
  const Mpi = air.iyy * qdotDes;
  const wT = clamp((G.qbarTvc - qbar) / G.qbarTvc, 0, 1) * clamp(air.thrust / G.tvcThrustRef, 0, 1);
  const dStabFF = -air.cmStatic / AERO.controls.stab.cmPerDeg;
  const dStabRaw = dStabFF + (Mpi * (1 - wT)) / (qbarEff * Sw * cbar) / AERO.controls.stab.cmPerDeg;
  const stabMax = AERO.controls.stab.maxDeg;
  cmd.stab = clamp(dStabRaw, -stabMax, stabMax);
  // TVC: its share of the demand + whatever the saturated stab left on the table
  const overflowM = (dStabRaw - cmd.stab) * AERO.controls.stab.cmPerDeg * qbarEff * Sw * cbar;
  const MtvcDes = wT * Mpi + overflowM;
  cmd.tvc = clamp(
    (MtvcDes / (Math.max(air.thrust, 1000) * AERO.controls.tvc.armM)) * RAD,
    -AERO.controls.tvc.maxDeg, AERO.controls.tvc.maxDeg);
  // roll: inversion of known Cl terms + P
  const pdotDes = (pCmd - air.p) / G.tauP;
  cmd.flapRoll = clamp(
    (air.ixx * pdotDes / (qbarEff * Sw * bSpan) - AERO.damping.clBeta * air.betaRad
      - AERO.damping.clp * air.phat) / AERO.controls.flaperon.clPerDeg,
    -AERO.controls.flaperon.maxDeg, AERO.controls.flaperon.maxDeg);
  // yaw: inversion of known Cn terms + P
  const rdotDes = (rCmd - air.r) / G.tauR;
  cmd.rud = clamp(
    (air.izz * rdotDes / (qbarEff * Sw * bSpan) - AERO.damping.cnBeta * air.betaRad
      - AERO.damping.cnr * air.rhat) / AERO.controls.rudder.cnPerDeg,
    -AERO.controls.rudder.maxDeg, AERO.controls.rudder.maxDeg);
}

function nosewheelDeg(V) {
  const fade = clamp(1 - Math.max(V - 5, 0) / (GAINS.nosewheelFadeMs - 5), 0, 1);
  return GAINS.nosewheelMaxDeg * fade;
}
