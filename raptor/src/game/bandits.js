// Bandits (phase 11 INC-4/INC-5): enemy aircraft. One SimCore system, rungs
// A1-A3 (CAMPAIGN-DESIGN.md Part A §1): the full state ladder is
// INGRESS(0) -> ATTACK(1) / EVADE(2) / ENGAGE(3) -> EGRESS(4).
//   A1 liner: waypoints from the spawn config; ATTACK = raider dive + one
//     SAM-clone at a tagged surface unit, then EGRESS.
//   A2 survivor (all red bandits): EVADE on (a) a live player missile inside
//     3 km and closing, or (b) the player inside the 1.5 km rear hemisphere
//     (liners only — an ENGAGEd fighter evades on missiles alone, per §1).
//     Tier reaction delay [1.6,1.2,0.9,0.6,0.4] s between trigger and break;
//     break turn at tier gMax toward a jink heading resampled every
//     2.6 - 0.4·tier s, for 4 + rng·3 s; then EGRESS (raider types), resume
//     INGRESS, or re-ENGAGE (CAP with energy + the player in range).
//   A3 threat (red fighters tier 2-4, EXPLICIT `engage: true` spawn opt-in —
//     never inferred, so every INC-4 spawn config behaves exactly as
//     shipped): ENGAGE = pursue-pointing under the same honest turn caps.
//     Weapons: the in-file SAM-clone pool re-aimed at the player (tgtIdx
//     sentinel -2; envelope 800..[-,-,2600,3000,3400] by tier, reload 15 s >
//     missile life 6.5 s => ONE in flight per bandit by construction, dmg 45,
//     guideTau 0.35 — the player's t15 late-break/run counter works
//     unchanged) + a nose-mounted clone of the battlefield ZSU round pool
//     (range 700, 25 rps, 0.8 s bursts, 8 mrad, dmg 12, ~15 deg nose cone).
//     ENGAGE -> EVADE on inbound player missile; ENGAGE -> EGRESS below the
//     0.6·cruise energy floor (extends to recover, re-engages at 0.9·cruise).
//   TELEGRAPH (amendment 5): mslInboundPlayer() flips true ON the launch
//     tick — main.js ORs it into the battlefield samInbound() MISSILE-banner
//     path, so the warning is up seconds before any impact is possible; gun
//     tracers fly ~0.7 s before a round can land. Warning precedes harm.
//   A4 (BFM geometry, pairs, countermeasures) stays phase-9 completion.
//
// Determinism doctrine (design §0): flat Float64Array truth, SLOTS_B=14 per
// bandit (+ a fixed-width SLOTS_AI sidecar for the A2/A3 clocks), decisions
// every 60 ticks in index order. rng law: A1 draws none; A2/A3 DECISION rng
// (jink headings, evade durations) draws ONLY inside decision ticks — the
// break itself and all clock countdowns run rng-free in the integrator on
// pre-drawn values, so draw order stays index-stable. Gun dispersion draws
// at fire time, the battlefield AAA pattern verbatim (order stable: tick ->
// bandit index -> round index). hash(h) folds every fixed-width array,
// battlefield/match imul-FNV style, fixed length always. Bandits do NOT
// reset() on sim.reset (battlefield precedent — batteries setSeed FIRST,
// spawnFlight after). `bandits.player` attaches post-construction
// (battlefield.player pattern; main.js wires it) — without it A2 has no
// threat sense and A3 has no target, and all INC-4 behavior is unchanged.
//
// POOL DOCTRINE (D-065 amendment 3): all 8 bandit groups (each carrying the
// drone/transport/fighter silhouette variants) AND the 8-missile pool are
// built + scene-added AT CONSTRUCTION, hidden until spawnFlight activates a
// slot — this renderer build silently drops post-boot top-level scene.add
// (flightfx landmine), so activation only re-poses and shows.
//
// GUARDRAIL (amendment 5): total bandit speed is clamped <= 420 m/s, ever —
// the player's supercruise always escapes.
//
// Loss booking mirrors battlefield semantics: `kills` counts RED bandit
// deaths only (== the brief's redLosses; drives the match recount when a
// later increment wires air tickets — INC-4 leaves match untouched);
// `blueLosses` counts side-1 (friendly transport / escort target) deaths and
// never feeds kills. Side-1 bandits also never run ATTACK — friendly slots
// are pure liners (escort targets), raider logic is red-only.

import * as THREE from "three";
import { softDiscTexture } from "../engine/sprites.js";

export const MAX_BANDITS = 8;
export const SLOTS_B = 14; // [x,y,z, vx,vy,vz, hp, state, stateT, wptIdx, cmdHdg, cmdPitch, cmdSpd, cooldown]

// states — values are a data contract (INGRESS 0 / ATTACK 1 / EGRESS 4
// shipped in INC-4 and t23 asserts them; EVADE/ENGAGE fill the 2/3 gap)
export const B_INGRESS = 0, B_ATTACK = 1, B_EVADE = 2, B_ENGAGE = 3, B_EGRESS = 4;

// kind ids: 0 drone, 1 transport, 2 fighter (ids-not-strings in sim state;
// spawnFlight accepts the string names as config sugar)
const KIND_ID = { drone: 0, transport: 1, fighter: 2 };
const CRUISE = [180, 150, 240];  // m/s by kind (design §1)
const HP0 = [30, 45, 60];        // drone / transport / fighter
const HIT_R = [10, 10, 8];       // W3 hit spheres: r=8 fighter, r=10 drone/transport

const VMAX = 330, VMIN = 120, ACCEL = 6;        // m/s, m/s, m/s^2
const TURN_CAP = 0.35;                          // rad/s ceiling
const GMAX = [3.5, 4.5, 5.5, 6.5, 7.5];         // by tier 0..4
const BLEED_K = 0.12;                           // hard-turn energy bleed
const DASH_CAP = 420;                           // amendment-5 guardrail
const FLOOR_AGL = 150;                          // hard terrain floor (design §1)
const FOLLOW_AGL = 350;                         // soft terrain-follow target
const DECIDE_TICKS = 60;                        // 0.5 s decision cadence
const WPT_R = 400;                              // waypoint capture radius (m, 2-D)
const ATTACK_R = 8000;                          // raider commits to the dive inside this
const LAUNCH_R = 2500;                          // one SAM-clone shot inside this, then EGRESS

// ---- A2/A3 (INC-5) ----
const SLOTS_AI = 6; // per-bandit clock sidecar: [reactT, jinkHdg, jinkT, evadeT, gunPhase, gunSpool]
const REACT = [1.6, 1.2, 0.9, 0.6, 0.4];        // s, trigger -> break, by tier (design §1 A2)
const JINK_BASE = 2.6, JINK_TIER = 0.4;         // jinkPeriod = 2.6 - 0.4·tier s
const EVADE_MSL_R = 3000;                       // trigger (a): player missile inside 3 km and closing
const EVADE_REAR_R = 1500;                      // trigger (b): player in the rear hemisphere
const ENGAGE_R = 10000;                         // CAP commit radius (doc silent — chosen: HUD diamond is visible long before)
const DISENGAGE_R = 15000;                      // supercruise escape is real: pursuit gives up out here
const RELOAD_S = 15;                            // AAM reload; > BMSL.lifeS 6.5 => one in flight per bandit
const AAM_ENV_MIN = 800;
const AAM_ENV_MAX = [0, 0, 2600, 3000, 3400];   // by tier — tiers 0-1 never ENGAGE, never fire
const BORE_COS = Math.cos(25 * Math.PI / 180);  // AAM boresight gate == the player's 9X seeker cone (the shot comes off the nose — readable + the turn-in fight stays honest)
const TGT_PLAYER = -2;                          // msl tgtIdx sentinel: guiding on the player
const PLAYER_R = 7.0;                           // player hit sphere (battlefield AAA value)
// bandit gun = the battlefield ZSU pattern nose-mounted; no ground-mount
// strain term (the airframe IS the mount), rounds inherit airframe velocity
const BGUN = {
  range: 700, muzzle: 970, rps: 25, burstS: 0.8, cooldownS: 1.4,
  dispersionMrad: 8, dmg: 12, dragK: 0.0005, life: 1.2,
};
const GUN_CONE_COS = Math.cos(15 * Math.PI / 180); // ~15 deg nose cone
const MAX_BR = 120; // round pool: 4 shooters (amendment-5 cap) x 25 rps x 1.2 s life

// SAM-clone missile (battlefield.js SAM constants verbatim — same honest
// integrator, re-aimed at a surface unit; its prop-nav is already the
// moving-target form dR/dt = v_tgt - v_m). blastM: ground-contact grace —
// a steep terminal dive can meet the dirt a few meters short of the hit
// sphere; detonating on contact that close is what a proximity fuse does.
const BMSL = {
  massKg: 126, propKg: 40, thrustN: 17000, burnS: 2.2,
  dragCd: 0.4, refAreaM2: 0.049, N: 4, maxG: 16, qRef: 9000,
  guideTau: 0.35, proxM: 10, dmg: 45, lifeS: 6.5, blastM: 25,
};
const MAX_BMSL = 8; // one in flight per bandit worst case
const MSL_SLOTS = 12; // [x,y,z, vx,vy,vz, age, massKg, axS,ayS,azS, tgtIdx]
const MAX_MTRAIL = 220;

const wrapPi = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

export class Bandits {
  // battlefield is optional at construction (main.js build order builds it
  // first anyway); it can also be attached post-construction like
  // battlefield.player: `bandits.battlefield = battlefield`. Without it,
  // raiders have nothing to dive on and fly the liner only.
  constructor(scene, { terrain, battlefield = null } = {}) {
    this.name = "bandits";
    this.terrain = terrain || null;
    this.battlefield = battlefield;
    this.player = null;  // attached post-construction (battlefield.player pattern; main.js wires it)
    this.kills = 0;      // RED bandit deaths (battlefield.kills semantics)
    this.blueLosses = 0; // side-1 deaths — never touch kills (battlefield.blueLosses semantics)
    this.launches = 0;   // ALL SAM-clone launches (raider fired-exactly-once audit)
    this.mslHits = 0;    // SAM-clone impacts on surface units
    this.launchesPlayer = 0; // A3: AAM launches at the player
    this.mslHitsPlayer = 0;  // A3: AAM impacts on the player
    this.gunRounds = 0;      // A3: bandit gun rounds fired
    this.gunHitsPlayer = 0;  // A3: bandit gun impacts on the player

    // ---- flat sim truth (design §1 layout), all fixed width == fixed hash length ----
    this.state = new Float64Array(MAX_BANDITS * SLOTS_B);
    this.live = new Uint8Array(MAX_BANDITS);
    this.kind = new Uint8Array(MAX_BANDITS);      // 0 drone, 1 transport, 2 fighter
    this.tier = new Uint8Array(MAX_BANDITS);      // 0..4
    this.side = new Uint8Array(MAX_BANDITS);      // 0 red, 1 blue (escort targets)
    this.slotUsed = new Uint8Array(MAX_BANDITS);  // activated ever (dead != free)
    this.aceId = new Int32Array(MAX_BANDITS).fill(-1);
    this.tag = new Int32Array(MAX_BANDITS);       // 0 = untagged group id
    this.attackTag = new Int32Array(MAX_BANDITS); // raider surface-target tag (0 = none)
    // waypoint routes: flat [x0,y0,x1,y1,...] per slot. Not hashed — set
    // deterministically at spawn (battlefield.paths Map precedent); the
    // hashed wptIdx cursor carries the progress.
    this.wpts = new Array(MAX_BANDITS).fill(null);
    // missile pool (SAM state layout + tgtIdx; tgtIdx -2 = the player)
    this.msl = new Float64Array(MAX_BMSL * MSL_SLOTS);
    this.mLive = new Uint8Array(MAX_BMSL);
    // A2/A3 sidecars (fixed width == fixed hash length, design §0 rule 5)
    this.engage = new Uint8Array(MAX_BANDITS);            // A3 CAP flag (red fighters tier 2-4, explicit opt-in)
    this.ai = new Float64Array(MAX_BANDITS * SLOTS_AI);   // [reactT, jinkHdg, jinkT, evadeT, gunPhase, gunSpool]
    for (let i = 0; i < MAX_BANDITS; i++) this.ai[i * SLOTS_AI] = -1; // reactT < 0 = idle
    // bandit gun round pool (battlefield enemy-round layout: x,y,z,vx,vy,vz,age)
    this.br = new Float64Array(MAX_BR * 7);
    this.brLive = new Uint8Array(MAX_BR);

    // ---- render-side ----
    this._prev = new Float64Array(this.state);
    this._turn = new Float64Array(MAX_BANDITS); // applied heading rate (banking visual)
    this.root = new THREE.Group();
    this.root.name = "bandits";
    scene.add(this.root); // boot-time add — safe per the flightfx landmine

    this._matRed = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.85, metalness: 0.25 });
    this._matBlue = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.8, metalness: 0.2 });
    this.groups = []; this._variants = [];
    for (let i = 0; i < MAX_BANDITS; i++) {
      const g = new THREE.Group();
      g.rotation.order = "YXZ"; // yaw -> pitch -> roll for a +z-forward model
      const vars = [this._buildDrone(), this._buildTransport(), this._buildFighter()];
      for (const v of vars) { v.visible = false; g.add(v); }
      g.visible = false;
      g.position.set(0, -500, 0); // parked below the world (battlefield reserve pattern)
      this.root.add(g);
      this.groups.push(g); this._variants.push(vars);
    }

    // missile visuals: the SAM's pattern verbatim (body boxes + trail puffs)
    const mGeo = new THREE.BoxGeometry(0.3, 0.3, 3.2);
    const mMat = new THREE.MeshBasicMaterial({ color: 0xf2ede2 });
    this.mslMesh = new THREE.InstancedMesh(mGeo, mMat, MAX_BMSL);
    this.mslMesh.frustumCulled = false;
    this.mslMesh.count = 0;
    this.root.add(this.mslMesh);
    const tGeo = new THREE.PlaneGeometry(2.6, 2.6);
    const tMat = new THREE.MeshBasicMaterial({ color: 0xe6e2da, map: softDiscTexture(), transparent: true, opacity: 0.5, depthWrite: false });
    this.mslTrail = new THREE.InstancedMesh(tGeo, tMat, MAX_MTRAIL);
    this.mslTrail.frustumCulled = false;
    this.mslTrail.count = 0;
    this.root.add(this.mslTrail);
    this.mslPuffs = [];
    this._mslLastPuff = new Float64Array(MAX_BMSL * 3);

    // bandit gun tracers: the battlefield enemy-round streaks verbatim —
    // hot red, unmistakably incoming (amendment-5 telegraph). Built + added
    // AT CONSTRUCTION (pool doctrine; post-boot scene.add drops silently).
    const rGeo = new THREE.BoxGeometry(0.4, 0.4, 6.0);
    const rMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.brMesh = new THREE.InstancedMesh(rGeo, rMat, MAX_BR);
    this.brMesh.frustumCulled = false;
    this.brMesh.count = 0;
    this.root.add(this.brMesh);

    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._dir = new THREE.Vector3();
    this._sc = new THREE.Vector3();
  }

  // ---- silhouettes: composed boxes, nose along +z (three yaw == ENU bearing) ----
  _buildFighter() {
    const g = new THREE.Group();
    const add = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this._matRed); m.position.set(x, y, z); g.add(m); };
    add(1.6, 1.4, 15, 0, 0, 0);      // fuselage
    add(12, 0.3, 4.5, 0, 0, -1.5);   // main wing
    add(5.5, 0.25, 2, 0, 0.2, -6);   // stabilators
    add(0.25, 2.4, 2.6, 0, 1.4, -6.2); // fin
    return g;
  }
  _buildDrone() {
    const g = new THREE.Group();
    const add = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this._matRed); m.position.set(x, y, z); g.add(m); };
    add(1.0, 1.0, 8, 0, 0, 0);       // fuselage
    add(14, 0.2, 1.4, 0, 0.3, 1);    // long straight wing
    add(3.2, 0.2, 1.2, 0, 0.6, -3.6); // tail
    return g;
  }
  _buildTransport() {
    const g = new THREE.Group();
    const add = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this._matRed); m.position.set(x, y, z); g.add(m); };
    add(3.4, 3.4, 30, 0, 0, 0);      // fuselage
    add(34, 0.5, 5, 0, 1.4, 2);      // wing
    add(12, 0.4, 3, 0, 1.0, -13);    // tailplane
    add(0.5, 5.5, 4, 0, 3.0, -13);   // fin
    return g;
  }

  alive(i) { return this.live[i] === 1 && this.state[i * SLOTS_B + 6] > 0; }
  aliveCount() { let c = 0; for (let i = 0; i < MAX_BANDITS; i++) if (this.alive(i)) c++; return c; }
  mslInbound() { for (let m = 0; m < MAX_BMSL; m++) if (this.mLive[m]) return true; return false; }

  // TELEGRAPH hook (amendment 5): true while any bandit AAM is guiding on
  // the player. main.js ORs this into battlefield.samInbound() for the
  // MISSILE banner + RWR tone. Flips true ON the launch tick — the missile
  // needs seconds to arrive, so the warning strictly precedes any harm.
  mslInboundPlayer() {
    for (let m = 0; m < MAX_BMSL; m++) {
      if (this.mLive[m] && (this.msl[m * MSL_SLOTS + 11] | 0) === TGT_PLAYER) return true;
    }
    return false;
  }

  // Activate pool slots (mirrors battlefield.spawnGroup): units =
  // [{ kind, tier, x, y, z, headingDeg, speed, tag, aceId, side,
  //    wpts: [[x,y],...], attackTag?, engage? }]. kind: "drone"|"transport"|
  // "fighter" or the numeric id. headingDeg follows the FM/debugCommand
  // convention (0 = east / +x ENU, CCW positive, 90 = north). Deterministic
  // assignment: first never-used slot in index order; -1 per unit when the
  // pool is exhausted. Meshes were built at construction — this only
  // re-poses/shows. `engage: true` (INC-5) = CAP behavior: EXPLICIT opt-in,
  // never inferred, honored only for red fighters tier 2-4 (tiers 0-1 are
  // A2-capped by design §1) — every engage-less config flies exactly the
  // INC-4 liner.
  spawnFlight(units) {
    const out = [];
    for (const u of units) {
      let slot = -1;
      for (let i = 0; i < MAX_BANDITS; i++) if (!this.slotUsed[i]) { slot = i; break; }
      out.push(slot);
      if (slot < 0) continue;
      const k = typeof u.kind === "string" ? (KIND_ID[u.kind] ?? 0) : (u.kind | 0);
      const hdg = (u.headingDeg || 0) * Math.PI / 180;
      const spd = Math.min(Math.max(u.speed ?? CRUISE[k], VMIN), VMAX);
      const gh = this.terrain ? Math.max(this.terrain.heightAt(u.x, u.y), 0) : 0;
      const z = Math.max(u.z ?? gh + FOLLOW_AGL, gh + FLOOR_AGL);
      const o = slot * SLOTS_B;
      this.state[o] = u.x; this.state[o + 1] = u.y; this.state[o + 2] = z;
      this.state[o + 3] = spd * Math.cos(hdg);
      this.state[o + 4] = spd * Math.sin(hdg);
      this.state[o + 5] = 0;
      this.state[o + 6] = HP0[k];
      this.state[o + 7] = B_INGRESS; this.state[o + 8] = 0; this.state[o + 9] = 0;
      this.state[o + 10] = hdg; this.state[o + 11] = 0; this.state[o + 12] = CRUISE[k];
      this.state[o + 13] = 0;
      this.slotUsed[slot] = 1;
      this.live[slot] = 1;
      this.kind[slot] = k;
      this.tier[slot] = Math.min(Math.max(u.tier | 0, 0), 4);
      this.side[slot] = u.side ? 1 : 0;
      this.tag[slot] = (u.tag || 0) | 0;
      this.aceId[slot] = u.aceId ?? -1;
      this.attackTag[slot] = (u.attackTag || 0) | 0;
      this.engage[slot] = u.engage && k === 2 && this.tier[slot] >= 2 && this.side[slot] === 0 ? 1 : 0;
      const ai0 = slot * SLOTS_AI;
      this.ai[ai0] = -1; this.ai[ai0 + 1] = 0; this.ai[ai0 + 2] = 0;
      this.ai[ai0 + 3] = 0; this.ai[ai0 + 4] = -0.5; this.ai[ai0 + 5] = 0; // gun spin-up grace
      if (u.wpts && u.wpts.length) {
        const flat = new Float64Array(u.wpts.length * 2);
        for (let w = 0; w < u.wpts.length; w++) { flat[w * 2] = u.wpts[w][0]; flat[w * 2 + 1] = u.wpts[w][1]; }
        this.wpts[slot] = flat;
      } else this.wpts[slot] = null;
      for (let s = 0; s < SLOTS_B; s++) this._prev[o + s] = this.state[o + s];
      this._turn[slot] = 0;
      // pose + show the pre-built mesh (never construct scene geometry here)
      const g = this.groups[slot], vars = this._variants[slot];
      for (let v = 0; v < 3; v++) vars[v].visible = v === k;
      const mat = this.side[slot] ? this._matBlue : this._matRed;
      vars[k].traverse((m) => { if (m.isMesh) m.material = mat; });
      g.position.set(u.x, z, u.y); // ENU -> three (east, up, north)
      g.rotation.set(0, Math.atan2(this.state[o + 3], this.state[o + 4]), 0);
      g.visible = true;
    }
    return out;
  }

  // W3 damage sink (gun/missiles reach it through the TargetDirectory)
  damage(i, dmg) {
    const o = i * SLOTS_B;
    if (!this.live[i] || this.state[o + 6] <= 0) return false;
    this.state[o + 6] -= dmg;
    if (this.state[o + 6] <= 0) {
      this.state[o + 6] = 0;
      this.live[i] = 0;
      if (this.side[i]) this.blueLosses++; else this.kills++;
      this.groups[i].visible = false; // no airborne wreck in A1 — gone is gone
      return true;
    }
    return false;
  }

  // segment p0->p1 vs live bandit hit-spheres (r=8 fighter, 10 drone/
  // transport); first hit index in slot order or -1 — battlefield semantics
  testSegment(x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len2 = dx * dx + dy * dy + dz * dz;
    for (let i = 0; i < MAX_BANDITS; i++) {
      if (!this.live[i]) continue;
      const o = i * SLOTS_B;
      const cx = this.state[o] - x0, cy = this.state[o + 1] - y0, cz = this.state[o + 2] - z0;
      let t = len2 > 0 ? (cx * dx + cy * dy + cz * dz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = cx - dx * t, qy = cy - dy * t, qz = cz - dz * t, r = HIT_R[this.kind[i]];
      if (qx * qx + qy * qy + qz * qz <= r * r) return i;
    }
    return -1;
  }

  // lowest alive battlefield index carrying the tag (deterministic re-resolve
  // each decision — no stale-target state to hash)
  _findTag(tag) {
    const bf = this.battlefield;
    if (!bf || !tag) return -1;
    for (let i = 0; i < bf.cap; i++) {
      if (bf.tag[i] === tag && bf.alive(i)) return i;
    }
    return -1;
  }

  // soft terrain-follow pitch command: hold FOLLOW_AGL over the higher of
  // here and 3 s ahead (the hard FLOOR_AGL clamp in the integrator is the
  // guarantee; this keeps the liner from riding the clamp)
  _followPitch(o) {
    const x = this.state[o], y = this.state[o + 1], z = this.state[o + 2];
    let h = 0;
    if (this.terrain) {
      const hx = x + this.state[o + 3] * 3, hy = y + this.state[o + 4] * 3;
      h = Math.max(this.terrain.heightAt(hx, hy), this.terrain.heightAt(x, y), 0);
    }
    const err = (h + FOLLOW_AGL) - z;
    return Math.max(-0.12, Math.min(0.25, err * 0.004));
  }

  // A2 trigger (a): any live player missile inside 3 km whose velocity
  // relative to this bandit is closing (proximity sense, not lock sense —
  // the bandit sees a smoke trail, it doesn't read the seeker)
  _missileThreat(i) {
    const M = this.player && this.player.missiles;
    if (!M) return false;
    const o = i * SLOTS_B;
    const x = this.state[o], y = this.state[o + 1], z = this.state[o + 2];
    const vx = this.state[o + 3], vy = this.state[o + 4], vz = this.state[o + 5];
    for (let m = 0; m < M.live.length; m++) {
      if (!M.live[m]) continue;
      const mo = m * 9; // missiles.js SLOTS=9: x,y,z, vx,vy,vz, mass, age, tgt
      const rx = x - M.r[mo], ry = y - M.r[mo + 1], rz = z - M.r[mo + 2];
      if (Math.hypot(rx, ry, rz) > EVADE_MSL_R) continue;
      const cx = M.r[mo + 3] - vx, cy = M.r[mo + 4] - vy, cz = M.r[mo + 5] - vz;
      if (rx * cx + ry * cy + rz * cz > 0) return true; // relative velocity points at us
    }
    return false;
  }

  // A2 trigger (b): the player inside the 1.5 km rear hemisphere
  _rearThreat(i) {
    const P = this.player;
    if (!P) return false;
    const ps = P.fm.state, o = i * SLOTS_B;
    const dx = ps[0] - this.state[o], dy = ps[1] - this.state[o + 1], dz = ps[2] - this.state[o + 2];
    if (Math.hypot(dx, dy, dz) > EVADE_REAR_R) return false;
    return dx * this.state[o + 3] + dy * this.state[o + 4] + dz * this.state[o + 5] < 0;
  }

  // decision tick (every 60 ticks, index order). rng law: A1 draws none;
  // the A2/A3 draws below (jink heading, evade duration) happen ONLY here.
  _decide(sim, i) {
    const o = i * SLOTS_B, ai0 = i * SLOTS_AI;
    const st = this.state[o + 7];
    const x = this.state[o], y = this.state[o + 1], z = this.state[o + 2];
    const P = this.player;
    // ---- A2 threat watch (red only; EVADE never re-arms, ATTACK is a
    // committed dive). On trigger, pre-draw the WHOLE evade here — break
    // heading (a 60-180 deg banked break off the current heading) and
    // duration — and start the tier reaction clock; the break itself fires
    // rng-free in the integrator when the clock runs out.
    if (P && this.side[i] === 0 && this.ai[ai0] < 0 && st !== B_EVADE && st !== B_ATTACK) {
      const threat = this._missileThreat(i) ||
        ((st === B_INGRESS || st === B_EGRESS) && this._rearThreat(i));
      if (threat) {
        const hdg = Math.atan2(this.state[o + 4], this.state[o + 3]);
        const sgn = sim.rng.f() < 0.5 ? -1 : 1;
        this.ai[ai0 + 1] = wrapPi(hdg + sgn * (Math.PI / 3 + sim.rng.f() * (2 * Math.PI / 3)));
        this.ai[ai0 + 3] = 4 + sim.rng.f() * 3;
        this.ai[ai0] = REACT[this.tier[i]];
      }
    }
    if (st === B_INGRESS) {
      // A3 CAP commit: engage-flagged fighters break off the liner when the
      // player is inside ENGAGE_R (flag pre-gated to red fighters tier 2-4)
      if (this.engage[i] && P) {
        const ps = P.fm.state;
        if (Math.hypot(ps[0] - x, ps[1] - y, ps[2] - z) <= ENGAGE_R) {
          this.state[o + 7] = B_ENGAGE; this.state[o + 8] = 0;
          return;
        }
      }
      // advance waypoints (2-D capture)
      const w = this.wpts[i];
      let wi = this.state[o + 9] | 0;
      while (w && wi * 2 < w.length && Math.hypot(w[wi * 2] - x, w[wi * 2 + 1] - y) < WPT_R) wi++;
      this.state[o + 9] = wi;
      const done = !w || wi * 2 >= w.length;
      // raider logic is red-only (side 1 = friendly liner, never attacks)
      if (this.side[i] === 0 && this.attackTag[i] !== 0) {
        const t = this._findTag(this.attackTag[i]);
        if (t >= 0) {
          const to = t * 5, bs = this.battlefield.state;
          const d = Math.hypot(bs[to] - x, bs[to + 1] - y, bs[to + 2] - z);
          if (done || d < ATTACK_R) {
            this.state[o + 7] = B_ATTACK; this.state[o + 8] = 0;
            return;
          }
        } else if (done) { this.state[o + 7] = B_EGRESS; this.state[o + 8] = 0; return; }
      } else if (done) {
        // liner complete: egress on the last leg's heading
        this.state[o + 7] = B_EGRESS; this.state[o + 8] = 0;
        return;
      }
      if (!done) this.state[o + 10] = Math.atan2(w[wi * 2 + 1] - y, w[wi * 2] - x);
      this.state[o + 11] = this._followPitch(o);
      this.state[o + 12] = CRUISE[this.kind[i]];
    } else if (st === B_ATTACK) {
      const t = this._findTag(this.attackTag[i]);
      if (t < 0) { this.state[o + 7] = B_EGRESS; this.state[o + 8] = 0; this.state[o + 11] = this._followPitch(o); return; }
      const to = t * 5, bs = this.battlefield.state;
      const dx = bs[to] - x, dy = bs[to + 1] - y, dz = bs[to + 2] - z;
      const dh = Math.hypot(dx, dy), d = Math.hypot(dh, dz);
      this.state[o + 10] = Math.atan2(dy, dx);
      this.state[o + 11] = Math.max(-0.5, Math.min(0.2, Math.atan2(dz, dh))); // dive on it
      this.state[o + 12] = VMAX;
      if (d <= LAUNCH_R && this.state[o + 13] <= 0) {
        this._launch(i, t);
        this.state[o + 13] = 15; // reload — moot in A1 (one shot then egress)
        this.state[o + 7] = B_EGRESS; this.state[o + 8] = 0;
        this.state[o + 10] = wrapPi(this.state[o + 10] + Math.PI); // break off the target
        this.state[o + 11] = this._followPitch(o);
      }
    } else if (st === B_EVADE) {
      // A2: hold the break — turn at tier gMax toward the pre-drawn jink
      // heading, firewall, terrain-follow. Resample (rng) when the jink
      // clock (run down per-tick by the integrator) has expired.
      if (this.ai[ai0 + 2] <= 0) {
        const hdg = Math.atan2(this.state[o + 4], this.state[o + 3]);
        const sgn = sim.rng.f() < 0.5 ? -1 : 1;
        this.ai[ai0 + 1] = wrapPi(hdg + sgn * (Math.PI / 3 + sim.rng.f() * (2 * Math.PI / 3)));
        this.ai[ai0 + 2] = JINK_BASE - JINK_TIER * this.tier[i];
      }
      this.state[o + 10] = this.ai[ai0 + 1];
      this.state[o + 11] = this._followPitch(o);
      this.state[o + 12] = VMAX;
    } else if (st === B_ENGAGE) {
      // A3: pursue-pointing at the player under the same honest turn caps
      // (the 420 dash guardrail still rules — supercruise always escapes)
      const ps = P ? P.fm.state : null;
      if (!ps) { this.state[o + 7] = B_INGRESS; this.state[o + 8] = 0; return; }
      const dx = ps[0] - x, dy = ps[1] - y, dz = ps[2] - z;
      const dh = Math.hypot(dx, dy), d = Math.hypot(dh, dz);
      if (d > DISENGAGE_R) { // the player ran — CAP goes back to the liner
        this.state[o + 7] = B_INGRESS; this.state[o + 8] = 0;
        this.state[o + 12] = CRUISE[this.kind[i]];
        return;
      }
      const v = Math.hypot(this.state[o + 3], this.state[o + 4], this.state[o + 5]);
      if (v < 0.6 * CRUISE[this.kind[i]]) { // energy floor: extend to recover
        this.state[o + 7] = B_EGRESS; this.state[o + 8] = 0;
        this.state[o + 11] = this._followPitch(o);
        return;
      }
      this.state[o + 10] = Math.atan2(dy, dx);
      this.state[o + 11] = Math.max(-0.5, Math.min(0.45, Math.atan2(dz, dh)));
      this.state[o + 12] = VMAX;
      // AAM: tier envelope + boresight + reload (15 s > 6.5 s life => one in
      // flight per bandit). The launch IS the telegraph: mslInboundPlayer()
      // is true from this tick, seconds before any possible impact.
      if (d >= AAM_ENV_MIN && d <= AAM_ENV_MAX[this.tier[i]] && this.state[o + 13] <= 0 && v > 1) {
        const cosOff = (dx * this.state[o + 3] + dy * this.state[o + 4] + dz * this.state[o + 5]) / (d * v);
        if (cosOff >= BORE_COS) {
          this._launch(i, TGT_PLAYER);
          this.state[o + 13] = RELOAD_S;
        }
      }
    } else { // B_EGRESS: hold heading, terrain-follow, fighters firewall it
      // A3 recovery: an engage fighter that extended re-commits once its
      // energy is back (design: re-engage at v > 0.9·cruise)
      if (this.engage[i] && P) {
        const ps = P.fm.state;
        const v = Math.hypot(this.state[o + 3], this.state[o + 4], this.state[o + 5]);
        if (v > 0.9 * CRUISE[this.kind[i]] &&
            Math.hypot(ps[0] - x, ps[1] - y, ps[2] - z) <= ENGAGE_R) {
          this.state[o + 7] = B_ENGAGE; this.state[o + 8] = 0;
          return;
        }
      }
      this.state[o + 11] = this._followPitch(o);
      this.state[o + 12] = this.kind[i] === 2 ? VMAX : CRUISE[this.kind[i]];
    }
  }

  _launch(i, tgt) {
    let slot = -1;
    for (let m = 0; m < MAX_BMSL; m++) if (!this.mLive[m]) { slot = m; break; }
    if (slot < 0) return;
    const o = i * SLOTS_B, so = slot * MSL_SLOTS, r = this.msl;
    // air launch: drop at the bandit's position, inherit its velocity —
    // the SAM booster kick is the rail's job; here the airframe IS the rail
    r[so] = this.state[o]; r[so + 1] = this.state[o + 1]; r[so + 2] = this.state[o + 2] - 3;
    r[so + 3] = this.state[o + 3]; r[so + 4] = this.state[o + 4]; r[so + 5] = this.state[o + 5];
    r[so + 6] = 0; r[so + 7] = BMSL.massKg;
    r[so + 8] = 0; r[so + 9] = 0; r[so + 10] = 0;
    r[so + 11] = tgt;
    this.mLive[slot] = 1;
    this.launches++;
    if (tgt === TGT_PLAYER) this.launchesPlayer++;
    this._mslLastPuff.set([r[so], r[so + 1], r[so + 2]], slot * 3);
  }

  // A3 gun round spawn — the battlefield _aaaFire pattern from the nose:
  // two-pass lead + gravity comp + 8 mrad perpendicular dispersion. No
  // ground-mount strain term (the airframe tracks with its own nose), and
  // rounds inherit the airframe velocity (the airframe IS the mount).
  _gunFire(sim, i, ps) {
    let slot = -1;
    for (let j = 0; j < MAX_BR; j++) if (!this.brLive[j]) { slot = j; break; }
    if (slot < 0) return;
    const o = i * SLOTS_B;
    const gx = this.state[o], gy = this.state[o + 1], gz = this.state[o + 2];
    const d0 = Math.hypot(ps[0] - gx, ps[1] - gy, ps[2] - gz);
    const tof = d0 / BGUN.muzzle;
    const lead = 0.95 + (sim.rng.f() - 0.5) * 0.18; // good gunner, human wobble
    const tx = ps[0] + ps[7] * tof * lead, ty = ps[1] + ps[8] * tof * lead;
    let tz = ps[2] + ps[9] * tof * lead;
    tz += 4.9 * tof * tof; // gravity drop compensation
    let fx = tx - gx, fy = ty - gy, fz = tz - gz;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    const mrad = BGUN.dispersionMrad / 1000;
    const g1 = (sim.rng.f() + sim.rng.f() + sim.rng.f() - 1.5) * mrad;
    const g2 = (sim.rng.f() + sim.rng.f() + sim.rng.f() - 1.5) * mrad;
    let rx = fy, ry = -fx;
    const rl = Math.hypot(rx, ry);
    if (rl > 1e-4) { rx /= rl; ry /= rl; } else { rx = 1; ry = 0; }
    const ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx;
    fx += g1 * rx + g2 * ux; fy += g1 * ry + g2 * uy; fz += g2 * uz;
    const fn = Math.hypot(fx, fy, fz); fx /= fn; fy /= fn; fz /= fn;
    const ro = slot * 7, r = this.br;
    r[ro] = gx + fx * 8; r[ro + 1] = gy + fy * 8; r[ro + 2] = gz + fz * 8;
    r[ro + 3] = fx * BGUN.muzzle + this.state[o + 3];
    r[ro + 4] = fy * BGUN.muzzle + this.state[o + 4];
    r[ro + 5] = fz * BGUN.muzzle + this.state[o + 5];
    r[ro + 6] = 0;
    this.brLive[slot] = 1;
    this.gunRounds++;
  }

  // surface-target velocity for the missile's moving-target prop-nav:
  // driving convoy trucks carry 8 m/s (battlefield CONVOY_SPEED) along their
  // hashed yaw; everything else on the ground is the v_tgt = 0 special case.
  _tgtVel(t, out) {
    out[0] = 0; out[1] = 0; out[2] = 0;
    const bf = this.battlefield;
    if (bf && bf.types[t] === "supply_truck" && bf.tag[t] !== 0 && bf.paths.has(bf.tag[t]) &&
        bf.wpt[t] * 2 < bf.paths.get(bf.tag[t]).length && bf.alive(t)) {
      out[0] = 8 * Math.sin(bf.yawS[t]); // yawS = atan2(dx, dy): ENU bearing
      out[1] = 8 * Math.cos(bf.yawS[t]);
    }
  }

  // ---- sim side ----
  tick(sim, dt) {
    this._prev.set(this.state);
    if (sim.tickCount % DECIDE_TICKS === 0) {
      for (let i = 0; i < MAX_BANDITS; i++) if (this.live[i]) this._decide(sim, i);
    }
    // point-mass integration under the honest caps
    for (let i = 0; i < MAX_BANDITS; i++) {
      if (!this.live[i]) continue;
      const o = i * SLOTS_B, ai0 = i * SLOTS_AI;
      // ---- A2 clocks (red only; rng-free — everything was pre-drawn in the
      // decision tick that saw the threat, so reaction windows are per-tick
      // exact, not 0.5 s quantized) ----
      if (this.side[i] === 0) {
        if (this.ai[ai0] >= 0) { // reaction clock -> the break
          this.ai[ai0] -= dt;
          const s7 = this.state[o + 7];
          if (this.ai[ai0] < 0 && s7 !== B_EVADE && s7 !== B_ATTACK) {
            this.state[o + 7] = B_EVADE; this.state[o + 8] = 0;
            this.state[o + 10] = this.ai[ai0 + 1];
            this.state[o + 11] = this._followPitch(o);
            this.state[o + 12] = VMAX;
            this.ai[ai0 + 2] = JINK_BASE - JINK_TIER * this.tier[i];
          }
        }
        if (this.state[o + 7] === B_EVADE) { // jink + duration clocks
          this.ai[ai0 + 2] -= dt;
          this.ai[ai0 + 3] -= dt;
          if (this.ai[ai0 + 3] <= 0) {
            // evade complete — route by role (design §1): raiders abort to
            // EGRESS, liners resume INGRESS, CAP re-engages if it has the
            // energy and the player is still in reach (else extends first)
            let next = this.attackTag[i] !== 0 ? B_EGRESS : B_INGRESS;
            if (this.engage[i] && this.player) {
              const ps = this.player.fm.state;
              if (Math.hypot(ps[0] - this.state[o], ps[1] - this.state[o + 1], ps[2] - this.state[o + 2]) <= ENGAGE_R) {
                const ev = Math.hypot(this.state[o + 3], this.state[o + 4], this.state[o + 5]);
                next = ev >= 0.6 * CRUISE[this.kind[i]] ? B_ENGAGE : B_EGRESS;
              }
            }
            this.state[o + 7] = next; this.state[o + 8] = 0;
            if (next === B_INGRESS) this.state[o + 12] = CRUISE[this.kind[i]];
          }
        }
      }
      let vx = this.state[o + 3], vy = this.state[o + 4], vz = this.state[o + 5];
      let v = Math.hypot(vx, vy, vz) || 1;
      const hdg = Math.atan2(vy, vx);
      const pit = Math.asin(Math.max(-1, Math.min(1, vz / v)));
      const turnMax = Math.min(GMAX[this.tier[i]] * 9.81 / v, TURN_CAP);
      let dH = wrapPi(this.state[o + 10] - hdg);
      dH = Math.max(-turnMax * dt, Math.min(turnMax * dt, dH));
      let dP = this.state[o + 11] - pit;
      dP = Math.max(-0.6 * turnMax * dt, Math.min(0.6 * turnMax * dt, dP));
      const rate = Math.hypot(dH, dP) / dt;
      this._turn[i] = dH / dt; // render-side banking (deterministic, not hashed)
      // thrust toward the commanded speed, then the hard-turn bleed
      v += Math.max(-ACCEL * dt, Math.min(ACCEL * dt, this.state[o + 12] - v));
      v -= BLEED_K * v * rate * dt;
      v = Math.max(VMIN, Math.min(VMAX, v));
      const nh = hdg + dH, np = pit + dP, cp = Math.cos(np);
      vx = v * cp * Math.cos(nh); vy = v * cp * Math.sin(nh); vz = v * Math.sin(np);
      // amendment-5 guardrail: nothing red ever outruns supercruise
      const sp = Math.hypot(vx, vy, vz);
      if (sp > DASH_CAP) { const k = DASH_CAP / sp; vx *= k; vy *= k; vz *= k; }
      let x = this.state[o] + vx * dt, y = this.state[o + 1] + vy * dt, z = this.state[o + 2] + vz * dt;
      // hard terrain floor (design §1): z >= max(heightAt,0) + 150
      const gh = this.terrain ? Math.max(this.terrain.heightAt(x, y), 0) : 0;
      if (z < gh + FLOOR_AGL) {
        z = gh + FLOOR_AGL;
        if (vz < 0) { // ride the ridge: level off, keep the airspeed honest
          const vh = Math.hypot(vx, vy);
          if (vh > 1) { const k = Math.hypot(vx, vy, vz) / vh; vx *= k; vy *= k; }
          vz = 0;
        }
      }
      this.state[o] = x; this.state[o + 1] = y; this.state[o + 2] = z;
      this.state[o + 3] = vx; this.state[o + 4] = vy; this.state[o + 5] = vz;
      this.state[o + 8] += dt;
      if (this.state[o + 13] > 0) this.state[o + 13] = Math.max(0, this.state[o + 13] - dt);
      // ---- A3 bandit gun: the ZSU burst/spool state machine on the nose —
      // ENGAGE only, range 700, ~15 deg cone. Dispersion rng draws at fire
      // time (the AAA pattern; order stable: tick -> index -> round).
      // Tracers fly ~0.7 s before a round can land — the gun's telegraph.
      if (this.state[o + 7] === B_ENGAGE && this.player) {
        const g0 = ai0 + 4; // [gunPhase, gunSpool]
        const ps = this.player.fm.state;
        const dx = ps[0] - x, dy = ps[1] - y, dz = ps[2] - z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const vv = Math.hypot(vx, vy, vz) || 1;
        const cosOff = (dx * vx + dy * vy + dz * vz) / (d * vv);
        if (d > BGUN.range || d < 40 || cosOff < GUN_CONE_COS) {
          this.ai[g0] = Math.min(this.ai[g0], -0.4); this.ai[g0 + 1] = 0;
        } else {
          this.ai[g0] += dt;
          if (this.ai[g0] >= 0) {
            if (this.ai[g0] > BGUN.burstS) { this.ai[g0] = -BGUN.cooldownS; this.ai[g0 + 1] = 0; }
            else {
              this.ai[g0 + 1] += BGUN.rps * dt;
              while (this.ai[g0 + 1] >= 1) {
                this.ai[g0 + 1] -= 1;
                this._gunFire(sim, i, ps);
              }
            }
          }
        }
      }
    }
    // ---- bandit rounds vs the player (the battlefield enemy-round loop:
    // drag + gravity ballistics, segment test against the 7 m sphere) ----
    const pl = this.player;
    const pps = pl ? pl.fm.state : null;
    for (let j = 0; j < MAX_BR; j++) {
      if (!this.brLive[j]) continue;
      const ro = j * 7, r = this.br;
      const rv = Math.hypot(r[ro + 3], r[ro + 4], r[ro + 5]);
      const kk = 1 - BGUN.dragK * dt * rv;
      r[ro + 3] *= kk; r[ro + 4] *= kk; r[ro + 5] = r[ro + 5] * kk - 9.81 * dt;
      const x0 = r[ro], y0 = r[ro + 1], z0 = r[ro + 2];
      r[ro] += r[ro + 3] * dt; r[ro + 1] += r[ro + 4] * dt; r[ro + 2] += r[ro + 5] * dt;
      r[ro + 6] += dt;
      if (pps) {
        const cx = pps[0] - x0, cy = pps[1] - y0, cz = pps[2] - z0;
        const sx = r[ro] - x0, sy = r[ro + 1] - y0, sz = r[ro + 2] - z0;
        const l2 = sx * sx + sy * sy + sz * sz;
        let tt = l2 > 0 ? (cx * sx + cy * sy + cz * sz) / l2 : 0;
        tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        const qx = cx - sx * tt, qy = cy - sy * tt, qz = cz - sz * tt;
        if (qx * qx + qy * qy + qz * qz <= PLAYER_R * PLAYER_R) {
          this.brLive[j] = 0;
          this.gunHitsPlayer++;
          pl.takeHit(BGUN.dmg);
          continue;
        }
      }
      const rgh = this.terrain ? this.terrain.heightAt(r[ro], r[ro + 1]) : 0;
      if (r[ro + 2] <= Math.max(rgh, 0) || r[ro + 6] > BGUN.life) this.brLive[j] = 0;
    }
    // ---- SAM-clone missiles (battlefield SAM integrator) vs surface units
    // (A1 raiders) or the player (A3, tgtIdx sentinel -2 — the same
    // moving-target prop-nav; the player is just v_tgt = the jet) ----
    const bf = this.battlefield;
    const mdot = BMSL.propKg / BMSL.burnS;
    const tv = this._tv || (this._tv = new Float64Array(3));
    const tp = this._tp || (this._tp = new Float64Array(3));
    for (let s = 0; s < MAX_BMSL; s++) {
      if (!this.mLive[s]) continue;
      const so = s * MSL_SLOTS, r = this.msl;
      const age = r[so + 6];
      const thrust = age < BMSL.burnS ? BMSL.thrustN : 0;
      if (age < BMSL.burnS) r[so + 7] = Math.max(r[so + 7] - mdot * dt, BMSL.massKg - BMSL.propKg);
      const mass = r[so + 7];
      let vx = r[so + 3], vy = r[so + 4], vz = r[so + 5];
      const v = Math.hypot(vx, vy, vz) || 1;
      const rho = 1.225 * Math.exp(-Math.max(r[so + 2], 0) / 8500);
      const acc = thrust / mass - 0.5 * rho * v * v * BMSL.dragCd * BMSL.refAreaM2 / mass;
      vx += (vx / v) * acc * dt; vy += (vy / v) * acc * dt; vz += (vz / v) * acc * dt - 9.81 * dt;
      const t = r[so + 11] | 0;
      let Rm = Infinity;
      // target fetch: the player (A3) or a battlefield unit (A1 raider).
      // pos/vel land in tp/tv; the PN math below is identical either way.
      let track = false;
      if (t === TGT_PLAYER) {
        if (pps) {
          tp[0] = pps[0]; tp[1] = pps[1]; tp[2] = pps[2];
          tv[0] = pps[7]; tv[1] = pps[8]; tv[2] = pps[9];
          track = true;
        }
      } else if (bf && t >= 0 && bf.state[t * 5 + 4] > 0) {
        const to = t * 5;
        tp[0] = bf.state[to]; tp[1] = bf.state[to + 1]; tp[2] = bf.state[to + 2];
        this._tgtVel(t, tv);
        track = true;
      }
      if (track) {
        // prop-nav vs the moving target: dR/dt = v_tgt - v_msl
        const Rx = tp[0] - r[so], Ry = tp[1] - r[so + 1], Rz = tp[2] - r[so + 2];
        Rm = Math.hypot(Rx, Ry, Rz) || 1;
        const dRx = tv[0] - vx, dRy = tv[1] - vy, dRz = tv[2] - vz;
        const Vc = -(Rx * dRx + Ry * dRy + Rz * dRz) / Rm;
        const wx = (Ry * dRz - Rz * dRy) / (Rm * Rm);
        const wy = (Rz * dRx - Rx * dRz) / (Rm * Rm);
        const wz = (Rx * dRy - Ry * dRx) / (Rm * Rm);
        let ax = BMSL.N * Vc * (wy * vz - wz * vy) / v;
        let ay = BMSL.N * Vc * (wz * vx - wx * vz) / v;
        let az = BMSL.N * Vc * (wx * vy - wy * vx) / v;
        const qbar = 0.5 * rho * v * v;
        const gCap = BMSL.maxG * 9.81 * Math.min(1, qbar / BMSL.qRef + (age < BMSL.burnS ? 0.5 : 0.05));
        const am = Math.hypot(ax, ay, az);
        if (am > gCap) { ax *= gCap / am; ay *= gCap / am; az *= gCap / am; }
        const k = Math.min(dt / BMSL.guideTau, 1);
        r[so + 8] += (ax - r[so + 8]) * k;
        r[so + 9] += (ay - r[so + 9]) * k;
        r[so + 10] += (az - r[so + 10]) * k;
        vx += r[so + 8] * dt; vy += r[so + 9] * dt; vz += r[so + 10] * dt;
        const aLat = Math.hypot(r[so + 8], r[so + 9], r[so + 10]);
        const v2 = Math.hypot(vx, vy, vz) || 1;
        const bleed = (aLat / 4) * dt / v2;
        vx -= vx * bleed; vy -= vy * bleed; vz -= vz * bleed;
      }
      r[so + 3] = vx; r[so + 4] = vy; r[so + 5] = vz;
      r[so] += vx * dt; r[so + 1] += vy * dt; r[so + 2] += vz * dt;
      r[so + 6] = age + dt;
      if (track) {
        Rm = Math.hypot(tp[0] - r[so], tp[1] - r[so + 1], tp[2] - r[so + 2]);
        if (Rm < BMSL.proxM) {
          this.mLive[s] = 0;
          if (t === TGT_PLAYER) { this.mslHitsPlayer++; pl.takeHit(BMSL.dmg); }
          else { this.mslHits++; bf.damage(t, BMSL.dmg); }
          continue;
        }
      }
      const gh = this.terrain ? this.terrain.heightAt(r[so], r[so + 1]) : 0;
      if (r[so + 2] <= Math.max(gh, 0)) {
        // blastM ground-contact grace is a SURFACE-target fuse behavior —
        // a player-targeted round that meets the dirt just dies
        if (t >= 0 && track && Rm < BMSL.blastM) { this.mslHits++; bf.damage(t, BMSL.dmg); }
        this.mLive[s] = 0;
      } else if (age > BMSL.lifeS) this.mLive[s] = 0;
    }
  }

  // replaces the SimCore auto-hash — folds every fixed-width array + the
  // counters, battlefield/match imul-FNV style; length never changes
  hash(h) {
    const H = (v) => { h = (Math.imul(h ^ ((v * 1e3) | 0), 0x01000193)) >>> 0; };
    for (let i = 0; i < this.state.length; i++) H(this.state[i]);
    for (let i = 0; i < this.msl.length; i++) H(this.msl[i]);
    for (let i = 0; i < MAX_BANDITS; i++) H(this.live[i]);
    for (let i = 0; i < MAX_BANDITS; i++) H(this.kind[i]);
    for (let i = 0; i < MAX_BANDITS; i++) H(this.tier[i]);
    for (let i = 0; i < MAX_BANDITS; i++) H(this.side[i]);
    for (let i = 0; i < MAX_BANDITS; i++) H(this.slotUsed[i]);
    for (let i = 0; i < MAX_BANDITS; i++) H(this.tag[i]);
    for (let i = 0; i < MAX_BANDITS; i++) H(this.aceId[i]);
    for (let i = 0; i < MAX_BANDITS; i++) H(this.attackTag[i]);
    for (let i = 0; i < MAX_BMSL; i++) H(this.mLive[i]);
    // INC-5 sidecars — appended folds, all fixed width (no length changes)
    for (let i = 0; i < this.ai.length; i++) H(this.ai[i]);
    for (let i = 0; i < MAX_BANDITS; i++) H(this.engage[i]);
    for (let i = 0; i < this.br.length; i++) H(this.br[i]);
    for (let i = 0; i < MAX_BR; i++) H(this.brLive[i]);
    H(this.kills); H(this.blueLosses); H(this.launches); H(this.mslHits);
    H(this.launchesPlayer); H(this.mslHitsPlayer); H(this.gunRounds); H(this.gunHitsPlayer);
    return h;
  }

  // ---- render side ---- alpha = sim interpolation factor (player.js
  // prev-state pattern); banking leans into the applied turn rate
  render(alpha, camera) {
    const a = this._prev, b = this.state;
    for (let i = 0; i < MAX_BANDITS; i++) {
      if (!this.live[i]) continue;
      const o = i * SLOTS_B, g = this.groups[i];
      const lx = a[o] + (b[o] - a[o]) * alpha;
      const ly = a[o + 1] + (b[o + 1] - a[o + 1]) * alpha;
      const lz = a[o + 2] + (b[o + 2] - a[o + 2]) * alpha;
      g.position.set(lx, lz, ly); // ENU -> three
      const vx = b[o + 3], vy = b[o + 4], vz = b[o + 5];
      const v = Math.hypot(vx, vy, vz);
      if (v > 1) {
        g.rotation.y = Math.atan2(vx, vy);                       // ENU bearing == three yaw
        g.rotation.x = -Math.asin(Math.max(-1, Math.min(1, vz / v))); // climb = nose up
        g.rotation.z = Math.max(-1.15, Math.min(1.15, Math.atan2(this._turn[i] * v, 9.81))); // bank into the turn
      }
    }
    // missiles: SAM render pattern (bodies along velocity + billboard puffs)
    let ns = 0;
    for (let s = 0; s < MAX_BMSL; s++) {
      if (!this.mLive[s]) continue;
      const so = s * MSL_SLOTS, r = this.msl;
      this._dir.set(r[so + 3], r[so + 5], r[so + 4]).normalize();
      this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._dir);
      this._m4.makeRotationFromQuaternion(this._q);
      this._m4.setPosition(r[so], r[so + 2], r[so + 1]);
      this.mslMesh.setMatrixAt(ns++, this._m4);
      const l3 = s * 3, lp = this._mslLastPuff;
      const pd = Math.hypot(r[so] - lp[l3], r[so + 1] - lp[l3 + 1], r[so + 2] - lp[l3 + 2]);
      if (pd > 14 && this.mslPuffs.length < MAX_MTRAIL) {
        this.mslPuffs.push({ x: r[so], y: r[so + 1], z: r[so + 2], age: 0 });
        lp.set([r[so], r[so + 1], r[so + 2]], l3);
      }
    }
    this.mslMesh.count = ns;
    this.mslMesh.instanceMatrix.needsUpdate = true;
    // bandit gun tracers along velocity (battlefield enemy-round pattern)
    let nr = 0;
    for (let j = 0; j < MAX_BR; j++) {
      if (!this.brLive[j]) continue;
      const ro = j * 7, r = this.br;
      this._dir.set(r[ro + 3], r[ro + 5], r[ro + 4]).normalize();
      this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._dir);
      this._m4.makeRotationFromQuaternion(this._q);
      this._m4.setPosition(r[ro], r[ro + 2], r[ro + 1]);
      this.brMesh.setMatrixAt(nr++, this._m4);
    }
    this.brMesh.count = nr;
    this.brMesh.instanceMatrix.needsUpdate = true;
    let np = 0;
    const pdt = 1 / 60; // visual aging; cheap approximation (player.js precedent)
    for (const pf of this.mslPuffs) {
      pf.age += pdt;
      if (pf.age > 5.0) continue;
      const sc = 0.6 + pf.age * 0.7;
      this._m4.makeRotationFromQuaternion(camera.quaternion);
      this._m4.scale(this._sc.set(sc, sc, sc));
      this._m4.setPosition(pf.x, pf.z, pf.y);
      if (np < MAX_MTRAIL) this.mslTrail.setMatrixAt(np++, this._m4);
    }
    this.mslTrail.count = np;
    this.mslTrail.instanceMatrix.needsUpdate = true;
    while (this.mslPuffs.length && this.mslPuffs[0].age > 5.0) this.mslPuffs.shift();
  }
}
