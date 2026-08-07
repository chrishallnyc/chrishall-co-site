// Weapons data foundation (phase 8 prep). PURE DATA — no three.js, no engine
// imports (one import from the sibling pure-data module f22data.js, for the
// shared lerp interpolator only). Consumed by the future missile/gun sim at
// 120Hz and by a future weapon-sanity script, mirroring how f22data.js feeds
// fm-sanity.mjs. Design doc: .context/raptor/design/WEAPONS-PLAN.md.
//
// Provenance: every number carries a one-line source comment, same convention
// as f22data.js. Public figures cite the source class; anything classified,
// unpublished, or a deliberate gameplay/tuning choice is marked // EST with
// the basis stated. Where a value is a straight-up judgment call rather than
// an estimate of a real number (e.g. a gameplay balance constant), the
// comment says so explicitly — don't read // EST as "close to the classified
// truth" in those cases.
//
// Interpolation: tables below are [x, value] pairs, ascending x, and are read
// with f22data.js's lookup() — the ONE canonical interpolator in this repo.
// Phase-8 code should `import { lookup } from "./f22data.js"` to read these
// tables too, so weapon curves and FM curves share identical math.
//
// Units: SI throughout — meters, kg, seconds, Newtons, m/s, Pa. Angles in
// degrees in tables/specs (matches f22data's cl/cd0/cm convention); radians
// only where a formula needs them, called out inline. G-load in standard
// gravities (×9.80665 m/s²).
//
// Faction symmetry: PLAN.md pillar 1 — enemy fighters are red-aggressor-
// painted F-22s flying the identical airframe, and the simulation doctrine
// states "both sides identical rules." M61A2 / AIM9X / AIM120C below are
// NOT per-faction data — they apply unmodified to blue and red. There is no
// separate "enemy" export by design: duplicating these tables under an
// ENEMY_* name would fork a single source of truth for no gameplay reason.
// A future loadout.js keys weapons by type (this file), not by faction.

import { lookup } from "./f22data.js";

const G0 = 9.80665; // standard gravity, for Isp->thrust and rocket-equation math

export const M61A2 = {
  name: "M61A2 Vulcan",
  rateRpm: 6000,           // public: USAF F-22 fact sheet + GD linkless ammo-
                           // handling system spec (100 rds/s = 6000/min).
                           // M61A2's own mechanical ceiling is cited up to
                           // 6,600 rpm in some sources (lighter barrels) —
                           // 6,000 is the figure attached to the F-22 specifically.
  muzzleVelocityMs: 1050,  // public: PGU-28/B ~1,050 m/s (3,450 ft/s), widely
                           // cited; General Dynamics' own PGU-28A/B spec sheet
                           // lists 3,410 ft/s (1,039 m/s) — ~1% source spread,
                           // 1050 used here (matches the more common figure).
  roundsCarried: 480,      // public: USAF fact sheet; GD linkless ammo
                           // handling system drum capacity.
  sustainedFireTimeS: 4.8, // derived: roundsCarried / (rateRpm/60) = 480/100.
                           // Public reporting rounds this to "about 5 seconds."

  round: {
    name: "PGU-28/B (SAPHEI)",   // public: General Dynamics MIL-P-85723 spec.
    type: "Semi-Armor-Piercing High-Explosive Incendiary",
    massKg: 0.100,                // public: GD spec sheet, ~100 g.
    diameterM: 0.020,             // public: 20×102mm NATO cannon round.
    // Public reporting (repeated across aviation press, not an official
    // spec sheet — moderate confidence) says the F-22's combat mix carries
    // NO tracer rounds, unlike legacy fighters, specifically to avoid a
    // visible give-away of the aircraft's position. Flagged as such rather
    // than asserted as certain.
    realLoadoutHasTracer: false, // public (moderate confidence), see above
  },

  // Arcade-only visual tracer: a WT-style player-feedback convention, NOT a
  // claim about the real ammo mix (see round.realLoadoutHasTracer above).
  // DESIGN CHOICE, not sourced.
  tracerEveryNRounds: 5,
  tracerBurnTimeS: 1.3,   // EST: sized so the visual tracer burns out at
                          // ~1350m (muzzleVelocityMs · tracerBurnTimeS),
                          // matching the general 1000-1500m tracer-burnout
                          // range cited for aircraft autocannon tracers.

  dispersionMrad: 5,      // EST: open literature on aircraft rotary-cannon
                          // dispersion typically quotes 5-10 mrad circular
                          // dispersion; M61A2-specific figure is unpublished.
                          // Low end chosen — F-22's internal, doors-closed
                          // mount is comparatively rigid vs podded guns.

  // Physically-derived quadratic-drag model for the point-mass tracer/round.
  // Round mass is constant (no propellant burn), so — unlike the missiles
  // below — a single derived per-meter decay constant is valid here.
  ballistics: {
    dragCd: 0.30,               // EST: typical Cd for a modern boat-tailed
                                 // supersonic small-caliber projectile
                                 // (muzzle Mach ≈3.1 at sea level); PGU-28's
                                 // aluminum-nose-capped ogive is blunter than
                                 // a sleek spitzer bullet, nudged up from the
                                 // ~0.2-0.25 seen in small-arms literature.
    refAreaM2: 3.1416e-4,        // derived: π·(0.020/2)²
    // dragDecelPerM: dV/dx = -k·V (constant-density point-mass drag model),
    // k = 0.5·Cd·ρ0·A/m. Halves velocity at ln(2)/k ≈ 1200 m — plausible for
    // a 20mm-class autocannon round; altitude density scaling deferred to v2.
    dragDecelPerM: 5.77e-4,      // derived: 0.5·0.30·1.225·3.1416e-4/0.100
    // Informational cross-reference only — the sim uses dragDecelPerM above,
    // not this. G1-style ballistic coefficient from sectional density:
    // SD = 0.2205 lb / (0.7874 in)² ≈ 0.356 lb/in²; form factor i ≈1.4 EST
    // (blunter HEI ogive than a sleek bullet) → BC = SD/i.
    ballisticCoefficientG1Est: 0.25, // EST, informational only
  },

  // Placeholder hook multipliers for a future damage.js (component model per
  // PLAN.md: engines L/R, fuel, hydraulics, spars, pilot). Not yet consumed
  // anywhere — mirrors FM-PLAN.md §4's "deferred hooks" pattern. EST/tunable.
  damageClass: {
    kinetic: 1.0,      // baseline penetrator hit vs any component
    incendiary: 0.3,   // per-hit chance multiplier to ignite fuel/flammables
    blast: 0.05,       // small internal HE charge — negligible structural
                       // blast radius vs an airframe, mostly incendiary/frag
  },
};

// ---------------------------------------------------------------------------
// Proportional navigation (PN) background, shared by both missiles below.
// PN commands a turn rate proportional to the line-of-sight (LOS) rotation
// rate: turnRateCmd = N · closingVelocity · losRate. N (navigation constant,
// dimensionless) is cited in open guidance literature as typically 3-5;
// higher N reacts faster near intercept but amplifies seeker/glint noise and
// can demand unrealistic terminal-G. Each missile below picks its own N in
// that band with a one-line rationale. // public (method); N values // EST
// ---------------------------------------------------------------------------

export const AIM9X = {
  name: "AIM-9X Sidewinder",
  massKg: 84.4,        // public: NAVAIR/Army Recognition, 186 lb launch weight.
  lengthM: 3.02,        // public: 9.9 ft.
  diameterM: 0.127,     // public: 5 in.

  warhead: {
    name: "WDU-17/B-class annular blast-fragmentation", // public designation
                                                          // widely cited across
                                                          // the AIM-9 family;
                                                          // exact P/N for the
                                                          // 9X Block II build
                                                          // unconfirmed — EST
    massKg: 9.4,        // public: 20.8 lb.
  },

  motor: {
    name: "Mk36 Mod 11-class, reduced-smoke",   // public: family designation
    smokeClass: "low",                          // public: reduced-smoke
                                                 // propellant (vs older
                                                 // AIM-9M dirty motors).
    propellantMassKg: 20,       // EST: ~24% of launch mass — typical SRM
                                 // fraction for a small imaging-IR AAM.
    ispS: 240,                   // EST: typical reduced-smoke composite/HTPB
                                 // tactical SRM class, 220-250s.
    boostDurationS: 2.2,         // EST: dual-thrust grain, short high-thrust
                                 // boost segment typical of SRAAMs.
    sustainDurationS: 3.5,       // EST: lower-thrust sustain tail.
    boostPropFraction: 0.7,      // EST: majority of grain mass in the boost
                                 // segment (agile, short-range profile).
    // Derived: mdot = propMass·fraction/duration; thrust = mdot·Isp·g0.
    thrustBoostN: 14977,         // derived: (20·0.7/2.2)·240·9.80665
    thrustSustainN: 4035,        // derived: (20·0.3/3.5)·240·9.80665
    // Sanity check (Tsiolkovsky, ideal): deltaV = Isp·g0·ln(m0/mf),
    // m0=84.4, mf=64.4 -> ln(1.311)=0.2705 -> deltaV ≈ 636 m/s ideal.
    // Launch ~M0.9 at a≈343 m/s = 309 m/s; apply ~18% EST gravity/drag
    // losses during burn -> net gain ≈522 m/s -> burnout ≈831 m/s -> M≈2.4
    // at sea-level a. Matches the public "Mach 2.5+" burnout claim. // EST
  },

  aero: {
    dragCd: 0.35,          // EST: slender supersonic missile body class
                            // (0.25-0.45 in open aero literature); kept
                            // Mach-invariant in v1, unlike f22data's
                            // waveFactor — documented simplification.
    refAreaM2: 0.012668,    // derived: π·(0.127/2)²
    // Mass changes as the motor burns (unlike the gun round above), so drag
    // is Cd/area here, not a single precomputed decay constant — the sim
    // must divide by current mass each tick.
  },

  guidance: {
    N: 4,                    // EST: upper end of the 3-5 band — agile,
                              // short-range imaging-IR intercepts favor a
                              // faster-responding terminal law.
    maxGLoad: 60,             // public: Raytheon/press "60g turns" via the
                              // two-axis thrust-vector-control (TVC) package.
                              // (Earlier internal guess of ~22G was wrong —
                              // corrected against public figures.)
    controlAuthorityQrefPa: 8000, // EST: dynamic-pressure reference below
                              // which available lateral-G tapers with q̄
                              // (fins lose bite at low speed/high alt); TVC
                              // is not modeled as compensating here the way
                              // f22data's TVC does for the jet — v1
                              // simplification, flagged for v2.
  },

  seeker: {
    type: "imaging infrared, 128x128 focal-plane array", // public
    gimbalLimitDeg: 90,      // public: ±90° high-off-boresight (HOBS).
    ifovDeg: 4,               // EST: instantaneous FOV of the detector itself
                              // (distinct from the 90° mechanical gimbal
                              // limit); typical imaging-IR seeker class 2-5°.
    slewRateDegS: 120,        // EST: typical agile-seeker gimbal slew rate,
                              // open literature class 60-150°/s.
    lockMode: "LOBL (boresight/HMD-cued)", // public: lock-on-before-launch is
                              // the primary documented mode; LOAL support is
                              // platform-dependent and out of v1 scope — EST.
  },

  // IRCCM (infrared countermeasures resistance) model. PLAN.md doctrine:
  // "defeat via geometry+terrain not one flare" — the curve below is built
  // to honor that: a single flare from a hard rear aspect barely moves the
  // needle; multiple flares plus favorable geometry (larger angular
  // separation from the true target, i.e. beam/head aspects) does. Evaluated
  // at a reduced cadence (not every 120Hz tick) so expected break-times land
  // in a plausible ~0.5-3s band rather than resolving in a single frame.
  // Resolution rolls MUST use sim.rng (SfcRng), never Math.random, per the
  // repo's determinism rule (engine/rng.js). All EST / tuning targets.
  irccm: {
    seekerEvalHz: 10,          // EST: decision cadence, not the 120Hz tick rate
    // P_break per evaluation = clamp01(flareFactor(nFlares) ·
    //   aspectFactor(aspectDeg) · burnerFactor) while ≥1 flare is inside the
    // seeker's gimbal+ifov cone and state === TRACK.
    flareFactor: [           // EST: diminishing returns — an imaging seeker
      [0, 0],                  // resists a flare volley far better than a
      [1, 0.03],                // legacy reticle seeker; dumping more flares
      [2, 0.05],                // alone barely helps (doctrine-consistent).
      [4, 0.09],
      [8, 0.15],
    ],
    aspectFactorDeg: [        // EST: 0°=dead astern (tail chase, hardest to
      [0, 1.0],                 // spoof — flare separates slowly from a
      [45, 1.4],                 // target that isn't maneuvering), 180°=head-
      [90, 2.2],                  // on (easiest — cooler forward aspect,
      [135, 3.0],                  // flare competes better against a weaker
      [180, 3.6],                   // true signature).
    ],
    burnerFactor: {
      on: 1.2,   // JUDGMENT CALL, not a sourced estimate: modeled as the
                 // transient afterburner light/flare-release thermal bloom
                 // being comparably hot, aiding decoy correlation for a
                 // moment. The opposite hypothesis (burner = stronger true
                 // signature = HARDER to spoof) is equally arguable in open
                 // IRCCM discussion. TUNING TARGET — revisit against the
                 // seeded spoof-rate QA battery (WEAPONS-PLAN.md §8).
      off: 1.0,
    },
    reacquireProbPerEval: 0.08, // EST: chance per evaluation to reacquire the
                                // true target once flares fade, given it's
                                // still within the gimbal+ifov cone.
  },

  fuze: {
    type: "active-laser proximity, DSU-15/B-class", // EST/medium confidence:
                              // commonly cited across AIM-9 references; exact
                              // model for the 9X Block II build unconfirmed.
    proximityRadiusM: 3,      // EST: small annular-blast-frag warhead, mostly
                              // shorter-range/lower-closure IR engagements;
                              // open literature ballpark for IR AAM fuzing
                              // is 2-5m.
    armingDelayS: 0.6,        // EST: minimum safe post-launch arming time,
                              // typical SRAAM class 0.3-1s (keeps a close
                              // WVR shot from detonating on the shooter).
  },

  // Monotonic Pk-vs-miss-distance falloff, per general open literature on
  // fragmentation warheads (gradual degradation, not a binary go/no-go).
  // NOT a claim about the real classified curve — a gameplay curve shaped
  // like the real physics. EST throughout.
  warheadLethality: [
    [0, 0.95],
    [3, 0.85],
    [6, 0.55],
    [10, 0.20],
    [15, 0.03],
  ],

  envelope: {
    rangeMinM: 300,     // EST: seeker lock/fuze-arming floor for a WVR shot.
    rangeMaxM: 18000,   // EST: public "10+ miles" (~16km) rounded up modestly
                        // for envelope uncertainty; exact figure classified.
    // Rmax/Rmin/no-escape-zone for the HUD are GEOMETRY-dependent (closure,
    // aspect, altitude/energy) and are computed at runtime, not stored as a
    // single number — see WEAPONS-PLAN.md §3.
  },
};

export const AIM120C = {
  name: "AIM-120C AMRAAM",
  massKg: 161.5,        // public: 356 lb.
  lengthM: 3.65,          // public: 12 ft.
  diameterM: 0.178,       // public: 7 in.

  warhead: {
    name: "WDU-33/B-class high-explosive blast-fragmentation", // public
    massKg: 20,          // public: 44 lb.
  },

  fuze: {
    type: "FZU-49/B active radar proximity + impact backup", // public
    proximityRadiusM: 10, // EST: larger blast-frag warhead + high BVR closure
                          // speeds need an earlier trigger than the 9X;
                          // open-literature ballpark for medium AAM fuzing
                          // is 8-15m.
    armingDelayS: 1.0,    // EST: minimum safe post-launch arming time.
  },

  motor: {
    name: "single-stage solid rocket, reduced-smoke HTPB", // public
    smokeClass: "low",     // public
    propellantMassKg: 55,   // EST: ~34% of launch mass — larger sustain-
                            // heavy grain than the 9X, built to extend
                            // powered (no-escape-zone) range at BVR distances.
    ispS: 250,               // EST: reduced-smoke HTPB class, slightly above
                            // the 9X's smaller motor.
    boostDurationS: 3.0,     // EST
    sustainDurationS: 18,    // EST: long sustain burn is the key BVR
                            // differentiator from a SRAAM's short burn.
    boostPropFraction: 0.55, // EST: BVR dual-thrust grains skew relatively
                            // more mass to sustain than a SRAAM does.
    thrustBoostN: 24721,     // derived: (55·0.55/3.0)·250·9.80665
    thrustSustainN: 3371,    // derived: (55·0.45/18)·250·9.80665
    // Sanity check (ideal Tsiolkovsky): deltaV = 250·9.80665·ln(161.5/106.5)
    // = 2451.7·ln(1.516) ≈ 1021 m/s ideal. Launch ~M1.0 at altitude (a≈295
    // m/s) = 295 m/s; apply ~20% EST losses -> net gain ≈817 m/s -> burnout
    // ≈1112 m/s -> M≈3.8 at that altitude's sound speed. Public "Mach 4
    // class" figure (1372 m/s) likely reflects a more favorable reference
    // condition (higher altitude/less loss) than this EST loss assumption —
    // flagged as a known gap, not silently forced to match. // EST
  },

  aero: {
    dragCd: 0.30,        // EST: slightly more slender/optimized body than
                          // the 9X for BVR cruise-out range; same 0.25-0.45
                          // open-literature class, Mach-invariant in v1.
    refAreaM2: 0.024886,  // derived: π·(0.178/2)²
  },

  guidance: {
    N: 3.5,               // EST: lower-middle of the 3-5 band — smoother
                          // response through the midcourse-to-terminal
                          // (loft-to-dive) transition than the 9X's snappier
                          // close-in law.
    maxGLoad: 40,          // public: AIM-120C-5/6/7 rated to "up to 40G
                          // maximum overload."
    datalink: {
      updateHz: 4,         // EST: typical airborne weapons-datalink update
                          // cadence in open literature, low single-digit Hz.
      note: "midcourse INS + command updates from the launching aircraft's " +
        "radar track; stops if the shooter loses track (e.g. target notches " +
        "the shooter's radar) — see notchGate below.",
    },
    loft: {
      enable: true,
      rangeThresholdM: 20000, // EST: only worth lofting genuinely BVR shots;
                              // shorter shots fly a flat profile.
      apexFractionOfRange: 0.4, // EST: climb during the first ~40% of great-
                              // circle range to target, then dive.
      maxClimbAngleDeg: 25,   // EST: open-literature BVR loft-angle class,
                              // roughly 20-30°.
      note: "simplified 2-waypoint (climb-then-dive) profile for the 3-DOF " +
        "point-mass model, not energy-optimal trajectory shaping.",
    },
    notchGate: {
      halfWidthMs: 15,   // EST: ±15 m/s closing-rate band masked by mainbeam
                          // ground/sea clutter rejection; open-literature
                          // airborne intercept radar notch width class is
                          // 10-20 m/s.
      appliesTo: "own seeker terminal doppler gating, AND the launching " +
        "aircraft's radar track during midcourse (target notching the " +
        "SHOOTER's radar stops datalink updates, per datalink.note above).",
    },
    chaff: {
      breakProbPerEval: 0.05,     // EST: low baseline — monopulse/doppler-
                                  // processing seekers are chaff-resistant
                                  // per open ECCM literature.
      comboMultiplierIfNotched: 6, // EST: chaff dispensed WHILE notching
                                  // removes the doppler discriminant that
                                  // normally defeats chaff alone — doctrine-
                                  // consistent with PLAN.md's "notch/beam"
                                  // AI tactics.
      evalHz: 10,                 // same reduced-cadence rationale as irccm above
    },
  },

  seeker: {
    type: "active radar, WGU-16/B-class Ku-band", // EST/medium confidence on
                          // the exact model designation; active-radar
                          // terminal homing + inertial/datalink midcourse is
                          // the public-documented guidance mode.
    gimbalLimitDeg: 60,   // EST: open-literature active-radar AAM seeker
                          // gimbal class, 55-70°.
    pitbullRangeM: 15000, // EST: "pitbull" (autonomous active-seeker
                          // acquisition) is publicly discussed as occurring
                          // roughly 5-8 miles (~8-13km) from the target;
                          // gameplay picks the upper-mid value against a
                          // typical fighter-class RCS. Exact figure
                          // classified — TUNING TARGET.
  },

  warheadLethality: [   // same EST methodology as AIM9X.warheadLethality —
    [0, 0.95],           // larger warhead, larger radii.
    [8, 0.80],
    [15, 0.50],
    [25, 0.15],
    [35, 0.02],
  ],

  envelope: {
    rangeMinM: 1000,     // EST: seeker/fuze/geometry floor for a usable BVR
                          // shot.
    rangeMaxM: 90000,    // public-ish: commonly cited unclassified figure
                          // (~49nmi) for the C variant; almost certainly a
                          // best-case lofted-altitude number — effective
                          // employment range in a fight is much shorter.
                          // Flagged as optimistic, not a claim about typical
                          // engagement ranges.
    // Rmax/Rmin/no-escape-zone for the HUD are geometry-dependent and
    // computed at runtime — see WEAPONS-PLAN.md §3.
  },
};
