// F-22A flight-dynamics data foundation (phase 7). PURE DATA — no three.js,
// no engine imports. Consumed by the 6-DOF at 120Hz and by the trim sanity
// script (.context/raptor/design/fm-sanity.mjs). Design doc: FM-PLAN.md.
//
// Provenance: every number carries a one-line source comment. Public figures
// cite the source class; classified/unpublished values are engineering
// estimates marked // EST with the basis stated.
//
// Sign conventions (used consistently by tables and the 6-DOF):
//   Body axes right-handed: +x forward, +y right wing, +z down.
//   +alpha = nose above velocity vector. +Cm = nose-up.
//   +stab deflection = trailing edge DOWN = nose-DOWN moment (negative Cm).
//   +TVC deflection = nozzles DOWN = nose-UP moment.
//
// Tables are [x, value] pairs, ascending x, interpolated with plain lerp via
// lookup() below (clamped at the ends). lookup() is the ONLY interpolator —
// sim and sanity script share it, so trim numbers match the game exactly.

export function lookup(table, x) {
  const n = table.length;
  if (x <= table[0][0]) return table[0][1];
  if (x >= table[n - 1][0]) return table[n - 1][1];
  for (let i = 1; i < n; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
  }
  return table[n - 1][1]; // unreachable; keeps the function total
}

export const MASS = {
  emptyKg: 19700,          // USAF fact sheet / public: 43,340 lb empty
  combatKg: 26000,         // public estimate: empty + pilot + A2A load + ~60% internal fuel
  mtowKg: 38000,           // public: 83,500 lb MTOW ≈ 37,875 kg, rounded
  fuelInternalKg: 8165,    // public: 18,000 lb internal fuel
  wingAreaM2: 78.04,       // public: 840 ft² reference wing area
  spanM: 13.56,            // public: 44 ft 6 in span
  macM: 5.1,               // EST: mean aerodynamic chord from planform (S/b·taper-weighted), ~5.1 m
  lengthM: 18.92,          // public: 62 ft 1 in length
  aspectRatio: 2.356,      // derived: b²/S = 13.56²/78.04

  // Inertia tensor at combatKg, kg·m². ESTIMATION METHOD: non-dimensional
  // radii of gyration back-computed from published F-16 inertias (Stevens &
  // Lewis "Aircraft Control and Simulation": Ixx 9496, Iyy 55814, Izz 63100,
  // Ixz 982 slug·ft² at 20,500 lb) — giving Rx≈0.25, Ry≈0.38, Rz≈0.40 —
  // then rescaled by F-22 mass × (span/2)² or (length/2)². Roskam's typical
  // fighter radii (0.25/0.38/0.46) agree. Ixx nudged up: F-22 carries fuel
  // and weapons spanwise in a wide blended body, unlike the F-16.
  inertia: {
    ixx: 75000,            // EST: 26000·(0.25·6.78)² ≈ 74k, +wide-body margin
    iyy: 336000,           // EST: 26000·(0.38·9.46)²
    izz: 380000,           // EST: 26000·(0.40·9.46)²; satisfies Ixx+Iyy ≥ Izz
    ixz: 5000,             // EST: ~1.5% of Izz, F-16 proportion (982/63100)
    // Fuel sits near the CG (wing + body tanks), so radii of gyration are
    // ~mass-invariant: scale the whole tensor by (currentMass/26000). // EST
    scaleWithMass: true,
  },

  // CG as fraction of MAC aft of the MAC leading edge. F-22 is trimmed
  // statically relaxed subsonic (see AERO.cm), so CG sits aft of the subsonic
  // neutral point by design.
  cgEmptyMac: 0.28,        // EST: relaxed-stability fighters trim 25-32% MAC (F-16 analog)
  cgFullFuelMac: 0.31,     // EST: aft body/wing tanks pull CG aft ~3% MAC when full
  // cg(fuelFrac) = lerp(cgEmptyMac, cgFullFuelMac, fuelFrac) — linear. // EST
};

export const AERO = {
  // ---- CL vs alpha (deg), clean config, incompressible reference ----
  // Linear slope 0.051/deg = Helmbold low-AR estimate 2πAR/(2+√(4+AR²)) for
  // AR 2.36; zero-lift alpha ≈ 0° (near-symmetric section + LE-flap schedule).
  // 10-35°: LERX/chine vortex lift keeps CL growing past a conventional
  // stall — the F-22 is controllable deep post-stall (public 60°+ alpha
  // demos), so the falloff past CLmax is gradual, not a break.
  cl: [
    [-10, -0.51],   // linear slope mirrored // EST
    [-5, -0.255],   // linear // EST
    [0, 0.00],      // zero-lift alpha ~0° // EST: near-symmetric effective camber
    [5, 0.255],     // Helmbold slope 0.051/deg // EST
    [10, 0.51],     // end of linear range // EST
    [15, 0.80],     // vortex lift onset, super-linear // EST: delta/LERX analogs (F-16 XL, X-31)
    [20, 1.10],     // EST: vortex lift regime
    [25, 1.38],     // EST
    [30, 1.60],     // EST
    [35, 1.74],     // CLmax ≈ 1.74 near 35° // EST: modern LERX fighters 1.6-1.8
    [40, 1.72],     // gentle post-stall plateau // EST: X-31/HARV post-stall shape
    [45, 1.58],     // EST
    [50, 1.38],     // EST
    [55, 1.17],     // EST
    [60, 1.00],     // ≈ flat-plate 2·sinα·cosα + body lift at 60° // EST
  ],

  // ---- CD0 vs alpha (deg): profile + form + separation drag ----
  // Total drag = CD0(alpha)·waveFactor(M) + inducedK·CL². The wave multiplier
  // applies to CD0 ONLY (wave drag is dominantly zero-lift; induced-drag Mach
  // effects ignored in v1 — documented simplification).
  cd0: [
    [-10, 0.040],   // separation on lower surface // EST, mirrored shape
    [-5, 0.026],    // EST
    [0, 0.020],     // clean subsonic CD0 ≈ 0.020 // EST: F-16 class ~0.020, stealth is no dirtier
    [5, 0.022],     // EST
    [10, 0.028],    // EST
    [15, 0.042],    // vortex drag + early separation // EST
    [20, 0.070],    // EST
    [25, 0.112],    // EST
    [30, 0.170],    // EST
    [35, 0.260],    // EST
    [40, 0.380],    // trending to flat-plate normal force // EST
    [45, 0.520],    // EST
    [50, 0.680],    // EST
    [55, 0.880],    // EST
    [60, 1.100],    // flat plate CD≈2sin²α ≈ 1.5 incl. induced; CD0 share ~1.1 // EST
  ],

  // Induced drag: CDi = inducedK·CL², inducedK = 1/(π·e·AR) = 1/(π·0.80·2.356)
  oswaldE: 0.80,           // EST: low-AR fighter with LE-flap scheduling, e 0.75-0.85
  inducedK: 0.1689,        // derived: 1/(π·0.80·2.356)

  // ---- Wave drag rise: multiplier on CD0 vs Mach ----
  // Shape: divergence onset ~M0.85-0.9, transonic peak ~M1.1, supersonic
  // settle. Peak sized so supersonic CD0 ≈ 0.020·1.75 ≈ 0.035 at M1.5 —
  // consistent with the public supercruise claim (M1.5+ on dry thrust);
  // verified by fm-sanity.mjs check 2.
  waveFactor: [
    [0.0, 1.00],    // incompressible // by definition
    [0.8, 1.00],    // subcritical — area-ruled, internal carriage // EST
    [0.9, 1.18],    // drag divergence onset // EST: typical fighter Mdd 0.85-0.92
    [1.0, 1.75],    // transonic rise // EST
    [1.1, 2.05],    // transonic peak ~2x // EST: classic wave-drag peak shape
    [1.2, 2.00],    // EST
    [1.5, 1.75],    // sized to sustain M1.5 dry (supercruise) // EST, see fm-sanity
    [2.0, 1.60],    // supersonic decay ~1/√(M²-1) trend // EST
    [2.25, 1.55],   // EST
  ],

  // ---- Cm vs alpha (deg), about nominal CG (0.30 MAC), stick-fixed ----
  // POSITIVE slope near trim = statically UNSTABLE subsonic (~ -5% static
  // margin: Cmα ≈ +0.0028/deg ≈ 0.055·CLα). THE BARE AIRFRAME DIVERGES —
  // the FCS/instructor (FM-PLAN.md) must close the pitch loop at 120Hz.
  // Stable (restoring) beyond ~35°: nose-down recovery exists at high alpha
  // but is weak — TVC supplies the authority (public F-22 design rationale).
  cm: [
    [-10, -0.028],  // EST: unstable slope mirrored
    [-5, -0.014],   // EST
    [0, 0.000],     // Cm0 ≈ 0 — FCS auto-trims residuals // EST
    [5, 0.014],     // +0.0028/deg ≈ -5% static margin // EST: relaxed-stability design, F-16 analog
    [10, 0.028],    // EST
    [15, 0.040],    // instability soften as vortices shift // EST
    [20, 0.045],    // EST
    [25, 0.040],    // EST
    [30, 0.025],    // EST
    [35, 0.000],    // neutral point crossing // EST
    [40, -0.030],   // stable/restoring post-stall // EST: HARV/X-31 analog shape
    [45, -0.065],   // EST
    [50, -0.100],   // EST
    [55, -0.140],   // EST
    [60, -0.180],   // EST
  ],

  // ---- Control effectiveness (per DEGREE of deflection, at reference q̄) ----
  controls: {
    stab: {
      cmPerDeg: -0.011,    // EST: all-moving stab, F-16 −0.012 / F-15 −0.010 per deg, large F-22 stabs
      maxDeg: 25,          // EST: F-22 stabilator throw ~±25° (F-16 ±25 analog)
    },
    flaperon: {
      clPerDeg: 0.0012,    // EST: lumped flaperon+diff-stab; gives ~135°/s aero max at corner, FCS caps 100
      maxDeg: 20,          // EST: flaperon throw
    },
    rudder: {
      cnPerDeg: -0.0010,   // EST: twin canted rudders, F-16 −0.0011 less cant loss
      maxDeg: 30,          // public: F-22 rudder throw ±30°
    },
    tvc: {
      maxDeg: 20,          // public: F119 2D nozzles vector ±20° in pitch
      armM: 7.0,           // EST: nozzle exit ~17m station vs CG ~10m → ~7m arm (spec)
      // Pitch moment = totalThrustN · sin(deflRad) · armM. Independent of q̄ —
      // this is why TVC owns the post-stall/low-speed regime.
    },
  },

  // ---- Damping & static lateral derivatives (per RADIAN, nondim rates
  // p̂=pb/2V, q̂=qc̄/2V, r̂=rb/2V). Needed by the rate loops in FM-PLAN. ----
  damping: {
    cmq: -4.0,             // EST: fighters −2..−8 (F-16 ≈ −7 w/ big tail; short-coupled F-22 lower)
    clp: -0.25,            // EST: low-AR wing roll damping, slender-wing theory
    cnr: -0.35,            // EST: fighter yaw damping −0.2..−0.5
    cnBeta: 0.10,          // EST: weathercock, weak — canted verticals sized for stealth
    clBeta: -0.08,         // EST: effective dihedral from wing sweep
    cyBeta: -0.80,         // EST: side force per beta, fighter typical
  },
};

export const ENGINE = {
  count: 2,                // public: 2× P&W F119-PW-100
  name: "F119-PW-100",
  thrustDrySlsN: 104000,   // public: ~23,500 lbf class dry per engine
  thrustAbSlsN: 156000,    // public: 35,000 lbf class afterburning per engine

  // Altitude lapse: T = T_sls · σ^0.7, σ = ρ/ρ₀. Exponent 0.7 is the
  // low-bypass-turbofan fit below the tropopause (Mattingly-class rule;
  // pure σ^1.0 above 11km is ignored in v1 — mildly optimistic ceiling). EST
  lapseExponent: 0.7,

  // Mach thrust factor (multiplies lapsed thrust). Small transonic sag, then
  // ram recovery: +15% at M1.5 (inlet total-pressure recovery on a fixed
  // normal-shock-class inlet), decaying past M2 as recovery falls. One shared
  // table for dry and AB in v1. // EST: Mattingly ram-recovery trends
  machFactor: [
    [0.0, 1.00],    // static // by definition
    [0.3, 0.97],    // inlet spillage sag // EST
    [0.6, 0.96],    // EST
    [0.9, 1.00],    // ram begins to win // EST
    [1.2, 1.06],    // EST
    [1.5, 1.15],    // ram recovery bump +15% at M1.5 (spec anchor) // EST
    [1.8, 1.17],    // EST
    [2.0, 1.12],    // recovery losses grow // EST
    [2.25, 1.05],   // EST
  ],

  spoolTauDryS: 1.2,       // EST: fighter turbofan idle→mil first-order time constant ~1-1.5s
  spoolTauAbS: 0.5,        // EST: AB light-off/stage fill ~0.5s
  idleFraction: 0.04,      // EST: idle thrust ~4% of mil, turbofan typical

  // Fuel flow: mdot = sfc · thrust. F119 SFC unpublished; low-bypass class:
  sfcDryKgPerNs: 2.4e-5,   // EST: ≈0.85 lb/lbf/hr dry, F110/F100 class
  sfcAbKgPerNs: 5.7e-5,    // EST: ≈2.0 lb/lbf/hr max AB, low-bypass class
  // Sanity: full AB SLS = 2·156kN·5.7e-5 ≈ 17.8 kg/s → internal fuel in ~7.6
  // min; mil = 2·104kN·2.4e-5 ≈ 5.0 kg/s. Plausible for the class. // EST
};

export const LIMITS = {
  gMax: 9.0,               // public: F-22 airframe limit +9g
  gMin: -3.0,              // public: −3g
  alphaMaxDeg: 60,         // public: trimmed 60°+ alpha demonstrated (TVC); FCS limiter setpoint
  iasMaxKt: 800,           // public estimate: ~800 KEAS structural placard
  machMax: 2.25,           // public estimate: ~M2.25 max
  gearMaxKt: 250,          // EST: fighter gear extend/operate placard 250-300 kt (F-16 300)
  flapMaxKt: 300,          // EST: flaperon high-lift schedule blends out ~300 kt
  rollRateMaxDegS: 100,    // public estimate: FCS-commanded roll rate cap ~100°/s at corner (spec)
  cornerSpeedKt: 330,      // derived: √(2·9·W/(ρ₀·S·CLmax)) at 26000kg ≈ 166 m/s ≈ 323 kt, rounded
};
