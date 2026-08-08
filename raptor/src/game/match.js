// Match rules (phase 10): the sandbox becomes a war. One deterministic
// SimCore system owns tickets, respawns, the airfield rearm zone, the
// battle boundary, and the win/lose state. All state in plain numbers,
// hashed; render reads, never writes.
//
// WT-style contract: red tickets = the ground war (each unit worth its
// weight; kills drain), blue tickets = your lives (deaths drain; 3 respawns
// then it's over). Rearm: low and slow over the airfield refills gun/aam/
// hull over 4 seconds. Leave the 30km battle square and you get 8 seconds
// of RETURN TO THE BATTLE before the airframe starts paying for it.

const TICKET_WEIGHTS = {
  supply_truck: 4, zsu: 8, sam_tel: 10, sam_radar: 8,
  cargo_ship: 20, destroyer: 30, carrier: 60,
};
const BLUE_TICKETS = 30;
const DEATH_COST = 10;       // 3 deaths = out
const AIRFIELD = { x: -3000, y: -8700, r: 900 };   // probed flat pad (D-061)
const REARM_AGL_MAX = 400, REARM_SPEED_MAX = 120;  // low + slow
const REARM_TIME = 4.0;
const BOUNDARY = 30000, BOUNDARY_GRACE = 8.0, BOUNDARY_DPS = 4;

export class Match {
  constructor(battlefield, player) {
    this.name = "match";
    this.bf = battlefield;
    this.player = player;
    // seed red from what is actually standing on this front
    let red = 0;
    if (battlefield) {
      for (let i = 0; i < battlefield.n; i++) {
        if (battlefield.alive(i)) red += TICKET_WEIGHTS[battlefield.types[i]] || 5;
      }
    }
    this.redMax = red || 1;
    this.red = red;
    this.blueMax = BLUE_TICKETS;
    this.blue = BLUE_TICKETS;
    this._deaths = 0;
    this._lastCrashes = player ? player.crashes : 0;
    this._killsSeen = 0;
    this.rearmT = 0;          // 0..REARM_TIME while refuelling
    this.rearming = false;
    this.boundaryT = 0;       // seconds outside the square
    this.outside = false;
    this.over = 0;            // 0 = live, 1 = victory, -1 = defeat
    this._boundaryAcc = 0;    // fractional hull drain accumulator
  }

  tick(sim, dt) {
    if (this.over !== 0 || !this.player) return;
    const P = this.player, bf = this.bf;

    // red drains as the ground war dies (recount beats event-plumbing:
    // kills come from guns AND missiles AND future systems)
    if (bf && bf.kills !== this._killsSeen) {
      this._killsSeen = bf.kills;
      let red = 0;
      for (let i = 0; i < bf.n; i++) if (bf.alive(i)) red += TICKET_WEIGHTS[bf.types[i]] || 5;
      this.red = red;
    }

    // blue drains on deaths (crash or shot down — both funnel through crashes)
    if (P.crashes !== this._lastCrashes) {
      const deaths = P.crashes - this._lastCrashes;
      this._lastCrashes = P.crashes;
      this._deaths += deaths;
      this.blue = Math.max(this.blue - DEATH_COST * deaths, 0);
    }

    // airfield rearm: inside the circle, low and slow
    const st = P.fm.state;
    const dx = st[0] - AIRFIELD.x, dy = st[1] - AIRFIELD.y;
    const groundH = P.terrain ? P.terrain.heightAt(st[0], st[1]) : 0;
    const agl = st[2] - Math.max(groundH, 0);
    const spd = Math.hypot(st[7], st[8], st[9]);
    const inZone = (dx * dx + dy * dy) < AIRFIELD.r * AIRFIELD.r && agl < REARM_AGL_MAX && spd < REARM_SPEED_MAX;
    const needs = P.gun.ammo < 480 || P.missiles.ammo < 4 || P.hp < 100;
    this.rearming = inZone && needs;
    if (this.rearming) {
      this.rearmT += dt;
      if (this.rearmT >= REARM_TIME) {
        this.rearmT = 0;
        P.gun.ammo = 480;
        P.missiles.ammo = 4;
        P.hp = 100;
      }
    } else this.rearmT = 0;

    // battle boundary: warning, then the airframe pays
    this.outside = Math.abs(st[0]) > BOUNDARY || Math.abs(st[1]) > BOUNDARY;
    if (this.outside) {
      this.boundaryT += dt;
      if (this.boundaryT > BOUNDARY_GRACE) {
        this._boundaryAcc += BOUNDARY_DPS * dt;
        if (this._boundaryAcc >= 1) {
          const dmg = Math.floor(this._boundaryAcc);
          this._boundaryAcc -= dmg;
          P.takeHit(dmg); // funnels through the normal death path
        }
      }
    } else { this.boundaryT = 0; this._boundaryAcc = 0; }

    // outcome
    if (this.red <= 0) this.over = 1;
    else if (this.blue <= 0) this.over = -1;
  }

  hash(h) {
    const H = (v) => (Math.imul(h ^ ((v * 1e3) | 0), 0x01000193)) >>> 0;
    h = H(this.red); h = H(this.blue); h = H(this.rearmT);
    h = H(this.boundaryT); h = H(this.over);
    return h;
  }
}
