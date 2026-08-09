// Script (phase 11 INC-1): one SimCore system owns mission objectives,
// triggers, and the comms ring — CAMPAIGN-DESIGN.md Part A §2. Ticks after
// player (it observes the completed combat tick), before match (which
// scores it). Determinism doctrine: fixed-size arrays, numbers only (comms
// are lineIds — text lives render-side in missions.js COMMS_LINES), no
// Date/Math.random, nothing here draws rng.
//
// Outcome authority: Script WRITES match.over and nothing else — tickets,
// rearm, and the boundary stay match's. Constructing a Script marks the
// match `scripted = true` (match then defers its own red<=0/blue<=0 outcome
// rules to us; blue-exhausted is re-checked here so the defeat survives
// either match behavior).
//
// Trigger vocabulary shipped (4 of the design's closed 6, see missions.js
// TRIG): ON_START, ON_TIME(t), ON_OBJECTIVE_DONE(obj), ON_OBJECTIVE_FAILED
// (obj). Each spec.comms row is one trigger -> one lineId, fires once
// (trigFired[i] mirrors spec.comms[i]). Zone-enter/groupDead land with
// INC-2 tags; playerHpBelow/aceState with later increments.

import { TRIG, OBJ_KIND } from "./missions.js";

const MAX_OBJ = 16, MAX_TRIG = 32, MAX_TIMERS = 8, RING = 32;
const KIND_NAME = ["destroy_tag", "protect_tag", "reach_zone", "survive_until", "kill_ace"];
// timeout rule (§2 priority table): offense types lose at timeLimitS;
// defense types (protect objectives intact — they'd have failed loseWhen
// otherwise) win. Only offense types exist in INC-1.
const DEFENSE_TYPES = new Set(["escort", "fleet_defense", "intercept"]); // timeout with the protect intact = the raid is beaten

export class Script {
  constructor(spec, { battlefield, player, match, terrain, bandits } = {}) {
    this.name = "script";
    this.spec = spec;
    this.bf = battlefield || null;
    this.bandits = bandits || null;
    this.player = player || null;
    this.match = match || null;
    this.terrain = terrain || null;
    if (this.match) this.match.scripted = true;

    // --- immutable objective config (numbers only; config, not hashed state) ---
    this.nObj = spec.objectives.length;
    this.objId = new Int32Array(MAX_OBJ);
    this.objKind = new Uint8Array(MAX_OBJ);
    this.objNeed = new Int32Array(MAX_OBJ);
    this.objT = new Float64Array(MAX_OBJ);
    this.objZone = new Float64Array(MAX_OBJ * 4).fill(-1); // x, y, r, aglMax (-1 = no band)
    this.objIdx = []; // per-slot battlefield index lists (INC-1 tag stand-in; INC-2 swaps to the tag column)
    this._slotOf = new Map(); // objective id -> slot
    spec.objectives.forEach((o, i) => {
      this.objId[i] = o.id;
      this.objKind[i] = OBJ_KIND[o.kind];
      this.objNeed[i] = o.need || 1;
      this.objT[i] = o.kind === "kill_ace" ? o.aceId : (o.t || 0);
      if (o.zone) {
        const zo = i * 4;
        this.objZone[zo] = o.zone.x; this.objZone[zo + 1] = o.zone.y;
        this.objZone[zo + 2] = o.zone.r;
        this.objZone[zo + 3] = o.zone.aglMax !== undefined ? o.zone.aglMax : -1;
      }
      this.objIdx.push(o.bfIdx ? o.bfIdx.slice() : []);
      this._slotOf.set(o.id, i);
    });
    this.objAir = new Uint8Array(MAX_OBJ);
    this.objTag = new Int32Array(MAX_OBJ).fill(-1);
    spec.objectives.forEach((o, i) => {
      if (o.air) { this.objAir[i] = 1; this.objTag[i] = o.tag; }
      else if (o.tag !== undefined) this.objTag[i] = o.tag; // ground tag (INC-7)
    });
    // INC-5: air raids are spec data — spawn the flight at mission start
    // (boot-time like battlefield placements; pool meshes already built)
    this._bSlots = []; // slots this mission spawned, for tag counting
    if (spec.bandits.length && this.bandits) {
      this._bSlots = this.bandits.spawnFlight(spec.bandits);
    }
    // INC-7: authored ground war — typed reserve slots + convoy paths
    if (this.bf) {
      if (spec.units && spec.units.length) this.bf.spawnGroup(spec.units);
      if (spec.paths) for (const [tag, pts] of Object.entries(spec.paths)) this.bf.setPath(+tag, pts);
    }
    this._win = spec.winWhen.map((id) => this._slotOf.get(id));
    this._lose = spec.loseWhen.map((id) => this._slotOf.get(id));
    this._offense = !DEFENSE_TYPES.has(spec.type);

    // --- sim state (fixed capacity, all folded by hash()) ---
    this.objState = new Uint8Array(MAX_OBJ);     // 0 pending, 1 done, 2 failed
    this.trigFired = new Uint8Array(MAX_TRIG);   // one flag per spec.comms row
    this.timers = new Float64Array(MAX_TIMERS);  // reserved for INC-2+ trigger timers; hashed now so the fold never changes shape
    this.commsLine = new Int32Array(RING);       // ring of lineIds
    this.commsT = new Float64Array(RING);        // sim-time stamps
    this.commsHead = 0;                          // monotonic write counter
    // derived per tick for the HUD (battlefield hp is the hashed truth)
    this._count = new Int32Array(MAX_OBJ);
  }

  reset() {
    this.objState.fill(0);
    this.trigFired.fill(0);
    this.timers.fill(0);
    this.commsLine.fill(0);
    this.commsT.fill(0);
    this.commsHead = 0;
    this._count.fill(0);
  }

  tick(sim, dt) {
    const M = this.match;
    if (!M || M.over !== 0) return; // outcome decided: mission state freezes

    // 1. objectives
    for (let i = 0; i < this.nObj; i++) {
      if (this.objState[i] !== 0) continue;
      const k = this.objKind[i];
      if (k === OBJ_KIND.destroy_tag) {
        let dead = 0;
        if (this.objAir[i]) {
          const B = this.bandits;
          if (B) for (const bi of this._bSlots) {
            if (bi < 0 || B.tag[bi] !== this.objTag[i]) continue;
            if (!B.live[bi]) dead++;
          }
        } else if (this.objTag[i] >= 0 && this.bf) { // spawned ground group by tag
          const bf = this.bf, cap = bf.cap || bf.n;
          for (let j = 0; j < cap; j++) {
            if (!bf.slotUsed || !bf.slotUsed[j]) continue;
            if (bf.tag[j] !== this.objTag[i]) continue;
            if (bf.state[j * 5 + 4] <= 0) dead++;
          }
        } else {
          const list = this.objIdx[i];
          if (this.bf) for (let j = 0; j < list.length; j++) if (this.bf.state[list[j] * 5 + 4] <= 0) dead++;
        }
        this._count[i] = dead;
        if (dead >= this.objNeed[i]) this.objState[i] = 1;
      } else if (k === OBJ_KIND.protect_tag) {
        // with a zone: DENIAL — fails when a tagged live bandit crosses it.
        // without: fails when `need` tagged units are dead.
        const zo = i * 4, hasZone = this.objZone[zo + 2] > 0;
        if (this.objAir[i] && this.bandits) {
          const B = this.bandits;
          let dead = 0;
          for (const bi of this._bSlots) {
            if (bi < 0 || B.tag[bi] !== this.objTag[i]) continue;
            if (!B.live[bi]) { dead++; continue; }
            if (hasZone) {
              const o14 = bi * 14;
              const dx = B.state[o14] - this.objZone[zo], dy = B.state[o14 + 1] - this.objZone[zo + 1];
              if (dx * dx + dy * dy < this.objZone[zo + 2] * this.objZone[zo + 2]) { this.objState[i] = 2; break; }
            }
          }
          if (this.objState[i] === 0 && !hasZone && dead >= this.objNeed[i]) this.objState[i] = 2;
          this._count[i] = dead;
        } else if (this.bf) {
          let dead = 0;
          if (this.objTag[i] >= 0 && !this.objIdx[i].length) {
            const bf = this.bf, cap = bf.cap || bf.n;
            for (let j = 0; j < cap; j++) {
              if (!bf.slotUsed || !bf.slotUsed[j] || bf.tag[j] !== this.objTag[i]) continue;
              if (bf.state[j * 5 + 4] <= 0) dead++;
            }
          } else {
            const list = this.objIdx[i];
            for (let j = 0; j < list.length; j++) if (this.bf.state[list[j] * 5 + 4] <= 0) dead++;
          }
          this._count[i] = dead;
          if (dead >= this.objNeed[i]) this.objState[i] = 2;
        }
      } else if (k === OBJ_KIND.reach_zone) {
        if (!this.player) continue;
        const st = this.player.fm.state, zo = i * 4;
        const dx = st[0] - this.objZone[zo], dy = st[1] - this.objZone[zo + 1], r = this.objZone[zo + 2];
        if (dx * dx + dy * dy > r * r) continue;
        const aglMax = this.objZone[zo + 3];
        if (aglMax >= 0) {
          const gh = this.terrain ? this.terrain.heightAt(st[0], st[1]) : 0;
          if (st[2] - Math.max(gh, 0) > aglMax) continue;
        }
        this.objState[i] = 1; this._count[i] = 1; // latched: "once" per §2
      } else if (k === OBJ_KIND.survive_until) {
        if (sim.time >= this.objT[i] && M.blue > 0) { this.objState[i] = 1; this._count[i] = 1; }
      }
      else if (k === OBJ_KIND.kill_ace && this.bandits) {
        const st = this.bandits.aceStatus(this.objT[i]); // objT reused as aceId store (see ctor)
        if (st === "killed") { this.objState[i] = 1; this._count[i] = 1; }
        else if (st === "escaped") this.objState[i] = 2; // the set-piece slipped away
      }
    }

    // 2. triggers -> comms ring (same tick as the state change: no dead air)
    const comms = this.spec.comms;
    for (let i = 0; i < comms.length; i++) {
      if (this.trigFired[i]) continue;
      const c = comms[i];
      let fire = false;
      if (c.on === TRIG.ON_START) fire = true;
      else if (c.on === TRIG.ON_TIME) fire = sim.time >= c.t;
      else if (c.on === TRIG.ON_OBJECTIVE_DONE) fire = this.objState[this._slotOf.get(c.obj)] === 1;
      else if (c.on === TRIG.ON_OBJECTIVE_FAILED) fire = this.objState[this._slotOf.get(c.obj)] === 2;
      else if (c.on === TRIG.ON_ACE_STATE) fire = this.bandits ? this.bandits.aceStatus(c.aceId) === c.aceState : false;
      if (fire) {
        this.trigFired[i] = 1;
        const s = this.commsHead % RING;
        this.commsLine[s] = c.lineId;
        this.commsT[s] = sim.time;
        this.commsHead++;
      }
    }

    // 3. outcome — priority per §2: blue exhausted -> loseWhen failed ->
    // all winWhen done -> time limit (offense = defeat).
    if (M.blue <= 0) { M.over = -1; return; }
    for (let i = 0; i < this._lose.length; i++) if (this.objState[this._lose[i]] === 2) { M.over = -1; return; }
    let all = true;
    for (let i = 0; i < this._win.length; i++) if (this.objState[this._win[i]] !== 1) { all = false; break; }
    if (all) { M.over = 1; return; }
    if (sim.time > this.spec.timeLimitS) M.over = this._offense ? -1 : 1;
  }

  // matches the match.js/battlefield.js imul-FNV fold
  hash(h) {
    const H = (v) => { h = Math.imul(h ^ ((v * 1e3) | 0), 0x01000193) >>> 0; };
    for (let i = 0; i < this.objState.length; i++) H(this.objState[i]);
    for (let i = 0; i < this.trigFired.length; i++) H(this.trigFired[i]);
    for (let i = 0; i < this.timers.length; i++) H(this.timers[i]);
    for (let i = 0; i < this.commsLine.length; i++) H(this.commsLine[i]);
    for (let i = 0; i < this.commsT.length; i++) H(this.commsT[i]);
    H(this.commsHead);
    return h;
  }

  // ---- render-side accessors (no DOM here; the HUD reads these) ----

  // newest-first [{lineId, t}] — HUD maps lineId through COMMS_LINES
  readComms() {
    const out = [];
    const n = Math.min(this.commsHead, RING);
    for (let i = 0; i < n; i++) {
      const s = (this.commsHead - 1 - i) % RING;
      out.push({ lineId: this.commsLine[s], t: this.commsT[s] });
    }
    return out;
  }

  // [{id, kind, done, failed, count, need, zone}] for the HUD objective line
  objectiveSummary() {
    const out = [];
    for (let i = 0; i < this.nObj; i++) {
      const zo = i * 4;
      out.push({
        id: this.objId[i],
        kind: KIND_NAME[this.objKind[i]],
        done: this.objState[i] === 1,
        failed: this.objState[i] === 2,
        count: this._count[i],
        need: this.objNeed[i],
        zone: this.objKind[i] === OBJ_KIND.reach_zone
          ? { x: this.objZone[zo], y: this.objZone[zo + 1], r: this.objZone[zo + 2] }
          : null,
      });
    }
    return out;
  }
}
