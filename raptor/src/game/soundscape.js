// Render-side sound direction. This observes the same combat truth as the
// HUD; it never enters SimCore, consumes RNG, or writes simulation state.
import { S } from "../sim/flight.js";
import { AIM9X } from "../sim/weapondata.js";

const KT = 1.94384;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const world = (state, offset = 0) => [state[offset], state[offset + 2], state[offset + 1]];
const distanceBetween = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const MAX_SCENE_SOURCES = 12;
const AIRCRAFT_CLASSES = ["drone", "transport", "fighter"];

export function acousticListener(camera, previousPosition, dt) {
  const position = [camera.position.x, camera.position.y, camera.position.z];
  const q = camera.quaternion;
  const displacement = previousPosition ? distanceBetween(position, previousPosition) : 0;
  // Respawns, QA camera cuts and returning from a suspended tab are not a
  // physical supersonic movement of the listener.
  const continuous = previousPosition && dt > 0 && dt <= 0.25 && displacement <= Math.max(120, dt * 1200);
  return {
    position,
    velocity: continuous ? position.map((v, i) => (v - previousPosition[i]) / dt) : [0, 0, 0],
    right: [1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.y + q.w * q.z), 2 * (q.x * q.z - q.w * q.y)],
    up: [2 * (q.x * q.y - q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.w * q.x)],
    forward: [-2 * (q.x * q.z + q.w * q.y), -2 * (q.y * q.z - q.w * q.x), -1 + 2 * (q.x * q.x + q.y * q.y)],
  };
}

// Combat positions are ENU; the camera uses x=east, y=up, z=north. Project
// onto the camera's right vector so a banked view still has honest stereo.
export function spatialSound(enu, camera) {
  const dx = enu[0] - camera.position.x;
  const dy = enu[2] - camera.position.y;
  const dz = enu[1] - camera.position.z;
  const distance = Math.hypot(dx, dy, dz);
  const q = camera.quaternion;
  const rx = 1 - 2 * (q.y * q.y + q.z * q.z);
  const ry = 2 * (q.x * q.y + q.w * q.z);
  const rz = 2 * (q.x * q.z - q.w * q.y);
  return { distance, pan: distance > 1 ? clamp((dx * rx + dy * ry + dz * rz) / distance, -1, 1) : 0 };
}

function missilePool(name, state, live, stride, age, mass, own = false) {
  return state && live ? {
    name, state, live, stride, age, mass, own,
    previousLive: new Uint8Array(live),
    previousAge: Float64Array.from(live, (_, i) => state[i * stride + age]),
    previousMass: Float64Array.from(live, (_, i) => state[i * stride + mass]),
    burning: new Uint8Array(live.length),
    generation: new Uint32Array(live.length),
  } : null;
}

export class Soundscape {
  constructor(audio, { player, battlefield = null, bandits = null }) {
    this.audio = audio;
    this.player = player;
    this.battlefield = battlefield;
    this.bandits = bandits;
    this.pools = [
      missilePool("player-missile", player.missiles.r, player.missiles.live, 9, 7, 6, true),
      missilePool("sam", battlefield?.sam, battlefield?.samLive, 11, 6, 7),
      missilePool("bandit-missile", bandits?.msl, bandits?.mLive, 12, 6, 7),
    ].filter(Boolean);
    this.targets = [];
    if (battlefield) this.targets.push({ name: "ground", state: battlefield.state, stride: 5, hp: 4 });
    if (bandits) this.targets.push({ name: "air", state: bandits.state, stride: bandits.state.length / bandits.live.length, hp: 6 });
    for (const group of this.targets) group.previous = new Float64Array(group.state.length / group.stride);
    this.lastTime = null;
    this.lastImpact = -Infinity;
    this.lastSonic = -Infinity;
    this.cinematic = false;
    this.epoch = 0;
    this.destroyedTargets = new Set();
    this.reset();
  }

  reset() {
    const p = this.player;
    if (this.lastTime !== null) this.audio.effects.stopAll?.();
    this.epoch++;
    this.hp = p.hp;
    this.crashes = p.crashes;
    this.position = [p.fm.state[S.PX], p.fm.state[S.PY], p.fm.state[S.PZ]];
    this.abLit = (p.fm.state[S.ABL] + p.fm.state[S.ABR]) * 0.5 > 0.08;
    this.subsonic = p.fm.out.mach < 0.97;
    this.lastImpact = -Infinity;
    this.lastSonic = -Infinity;
    this.lastTouchdown = -Infinity;
    this.lastCameraPosition = null;
    this.aircraftStarted = new Map();
    this.seenBooms = new WeakSet();
    for (const puff of p.missiles.puffs || []) if (puff.boom) this.seenBooms.add(puff);
    this.gearPosition = p.fm.state[S.GEAR];
    this.gearMoving = false;
    this.weightOnWheels = !!p.fm.out.wow;
    this.verticalSpeed = p.fm.state[S.VZ];
    this.fuel = p.fm.state[S.FUEL];
    for (const pool of this.pools) {
      pool.previousLive.set(pool.live);
      pool.burning.fill(0);
      for (let i = 0; i < pool.live.length; i++) {
        pool.previousAge[i] = pool.state[i * pool.stride + pool.age];
        pool.previousMass[i] = pool.state[i * pool.stride + pool.mass];
        pool.generation[i] = pool.live[i] ? 1 : 0;
      }
    }
    for (const group of this.targets) {
      for (let i = 0; i < group.previous.length; i++) group.previous[i] = group.state[i * group.stride + group.hp];
    }
  }

  _play(kind, position, strength = 1, { sourceId, priority, propagate = kind === "explosion" } = {}) {
    if (!this.audible) return;
    const spatial = spatialSound(position, this.camera);
    if (spatial.distance > 18000) return;
    this.audio.effects.play(kind, { ...spatial, position: world(position), strength, sourceId, priority,
      delay: propagate ? Math.min(6, spatial.distance / 343) : 0 });
  }

  _targetFor(pool, offset) {
    if (pool.name === "sam" || (pool.name === "bandit-missile" && pool.state[offset + 11] === -2)) {
      return { id: "player", position: this.player.crashes > this.crashes ? this.position
        : [this.player.fm.state[S.PX], this.player.fm.state[S.PY], this.player.fm.state[S.PZ]] };
    }
    const tid = pool.state[offset + (pool.own ? 8 : 11)];
    if (tid < 0) return null;
    const air = pool.own && tid >= 4096;
    const group = this.targets.find((g) => g.name === (air ? "air" : "ground"));
    const index = air ? tid - 4096 : tid;
    if (!group || index >= group.previous.length) return null;
    const o = index * group.stride;
    return { id: `${group.name}:${index}`, position: [group.state[o], group.state[o + 1], group.state[o + 2]] };
  }

  _terminal(pool, offset, age, freshBooms) {
    const position = [pool.state[offset], pool.state[offset + 1], pool.state[offset + 2]];
    const target = this._targetFor(pool, offset);
    const boom = pool.own && freshBooms.find((b) => !b.consumed && distanceBetween(position, b.position) < 35);
    if (boom) boom.consumed = true;
    if (target && this.destroyedTargets.has(target.id)) return; // this fuse already owns a target destruction
    const terrain = this.player.terrain || this.battlefield?.terrain;
    const ground = terrain?.heightAt(position[0], position[1]) || 0;
    const groundContact = position[2] <= Math.max(0, ground) + 0.5;
    // These are the existing pool lifetimes, not sound-design durations.
    // A disappearing airborne pool slot alone is not proof of an impact.
    const expired = age >= (pool.own ? 10 : 6.5);
    const atTarget = !expired && target && distanceBetween(position, target.position) < 35;
    if (boom || groundContact || atTarget) this._play("explosion", position, pool.own ? 0.85 : 0.7,
      { sourceId: `${pool.name}:${this.epoch}:${offset / pool.stride}:${pool.generation[offset / pool.stride]}:impact` });
  }

  _airframe(active, time, teleported) {
    const p = this.player, st = p.fm.state, out = p.fm.out;
    const gear = st[S.GEAR], moved = Math.abs(gear - this.gearPosition) > 1e-6;
    const travelling = gear > 0.001 && gear < 0.999;
    const moving = travelling && (moved || this.gearMoving);
    const contact = !!out.wow;
    if (active && !teleported) {
      if (moving && !this.gearMoving) this.audio.effects.play("gear_start", { strength: 0.65, sourceId: `gear:${this.epoch}:${time}` });
      if (!moving && this.gearMoving && !travelling) this.audio.effects.play("gear_lock", { strength: 0.8, sourceId: `gear:${this.epoch}:${time}:lock` });
      if (contact && !this.weightOnWheels && time - this.lastTouchdown > 0.8) {
        this.audio.effects.play("touchdown", { strength: clamp(Math.max(0, -this.verticalSpeed) / 8, 0.15, 1.5), sourceId: `contact:${this.epoch}:${time}` });
        this.lastTouchdown = time;
      }
      if (this.fuel > 0 && st[S.FUEL] <= 0) this.audio.effects.play("fuel_out", { strength: 0.7, sourceId: `fuel:${this.epoch}:${time}` });
    }
    this.audio.airframe?.setState({
      active, gearPosition: gear, gearMoving: active && moving,
      ias: active ? Math.sqrt(Math.max(0, out.qbar) * 2 / 1.225) * KT : 0,
      weightOnWheels: active && contact, wheelSpeed: active ? Math.abs(st[S.WSPIN]) : 0,
      // The FM exposes contact, not suspension normal force. Use unit loaded
      // contact rather than misrepresenting aero/thrust nz as tyre loading.
      groundLoad: active && contact ? 1 : 0,
      brake: active ? st[S.BRAKE] : 0, fuelStarved: st[S.FUEL] <= 0,
    });
    this.gearPosition = gear; this.gearMoving = moving; this.weightOnWheels = contact;
    this.verticalSpeed = st[S.VZ]; this.fuel = st[S.FUEL];
  }

  _scene(listener, candidates, dt, active, time) {
    const bandits = this.bandits;
    if (active && bandits) {
      const stride = bandits.state.length / bandits.live.length;
      for (let i = 0; i < bandits.live.length; i++) {
        const o = i * stride, st = bandits.state;
        if (!bandits.live[i] || st[o + 6] <= 0) continue;
        if (!this.aircraftStarted.has(i)) this.aircraftStarted.set(i, time);
        const velocity = world(st, o + 3), speed = Math.hypot(...velocity);
        // Bandits use a point-mass model, without engine spool. This is an
        // acoustic load proxy from real speed and commanded acceleration.
        const power = clamp(0.35 + 0.5 * speed / 330 + 0.15 * clamp((st[o + 12] - speed) / 30, 0, 1), 0.25, 1);
        candidates.push({ id: `aircraft:${this.epoch}:${i}`, kind: "aircraft",
          aircraftClass: AIRCRAFT_CLASSES[bandits.kind?.[i] ?? 2],
          position: world(st, o), velocity, power, motor: "cruise",
          age: time - this.aircraftStarted.get(i), priority: 0.7 });
      }
    }
    const ranked = active ? candidates.map((source) => {
      const distance = distanceBetween(source.position, listener.position);
      const rocket = source.kind === "missile", coast = rocket && source.motor === "coast";
      const reference = rocket ? 28 : 110;
      const attenuation = reference / (reference + Math.max(0, distance - 8));
      const audibility = coast ? clamp((250 - distance) / 180, 0, 1) : 1;
      return { source, distance, coast, score: attenuation * source.priority * audibility * (rocket ? 1.5 : 1) };
    }).filter(({ source, distance, coast }) => {
      // Coasting weapons have only a close-pass hiss (audible within 160m).
      // Keep 90m of allocation preroll; distant silent slots must not crowd
      // real aircraft out of the presentation budget.
      return distance < (source.kind === "missile" ? 3500 : 14000) && !(coast && distance > 250);
    })
      .sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id))
      .slice(0, MAX_SCENE_SOURCES) : [];
    this.audio.scene?.update({ listener, sources: ranked.map(({ source }) => source), dt });
  }

  update({ camera, time, dt, paused = false, cinematic = false, view = "external" }) {
    const p = this.player, fm = p.fm, st = fm.state, out = fm.out;
    if (this.lastTime !== null && time < this.lastTime) this.reset();
    const elapsed = dt ?? (this.lastTime === null ? 0 : Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.camera = camera;
    this.destroyedTargets.clear();
    const listener = acousticListener(camera, paused ? null : this.lastCameraPosition, elapsed);
    this.lastCameraPosition = listener.position;
    const sources = [];
    const freshBooms = [];
    for (const puff of p.missiles.puffs || []) {
      if (!puff.boom || this.seenBooms.has(puff)) continue;
      this.seenBooms.add(puff);
      freshBooms.push({ position: [puff.x, puff.y, puff.z], consumed: false });
    }
    this.audible = !paused;
    const died = p.crashes > this.crashes;
    const active = !paused && !cinematic && !died;
    this.audio.setPaused(paused);

    // Use the F119's actual spool and afterburner stage, including their
    // physical lag, rather than making the sound jump with the throttle key.
    const ab = (st[S.ABL] + st[S.ABR]) * 0.5;
    this.audio.engine.setState({
      throttle: (st[S.SPL] + st[S.SPR]) * 0.5,
      ab,
      powerInput: "spool",
      ias: Math.sqrt(Math.max(0, out.qbar) * 2 / 1.225) * KT,
      mach: out.mach,
      g: out.nz,
      aoa: out.alphaDeg,
      view,
      active,
      fuelStarved: st[S.FUEL] <= 0,
    });
    this.audio.gun.setPerspective?.(view);
    this.audio.gun.fire(active && p.gun.firing);
    const inbound = this.battlefield?.samInbound() || this.bandits?.mslInboundPlayer();
    this.audio.locks.setMode(!active ? "off" : inbound ? "launch"
      : p.missiles.locked() ? "lock" : p.missiles.lockTarget >= 0 ? "scan" : "off");

    if (died && (!cinematic || !this.cinematic)) this._play("explosion", this.position, 1.3,
      { sourceId: `player:${this.epoch}:${p.crashes}:death`, priority: 4, propagate: false });
    // Let the mission-ending detonation finish under its end card. Later
    // cinematic frames consume their snapshots silently.
    this.audible = !paused && !died && (!cinematic || !this.cinematic);
    if (!died && p.hp < this.hp && time - this.lastImpact > 0.075) {
      // Airframe strikes sit with the aircraft, independent of camera distance.
      if (active) this.audio.effects.play("impact", { strength: clamp((this.hp - p.hp) / 35, 0.3, 1), priority: 3 });
      this.lastImpact = time;
    }

    // Target destruction also covers cannon kills and mission-script kills.
    // Escaped aces retain HP, so disappearing from the air never fakes a kill.
    for (const group of this.targets) {
      for (let i = 0; i < group.previous.length; i++) {
        const o = i * group.stride, hp = group.state[o + group.hp];
        if (group.previous[i] > 0 && hp <= 0) {
          const id = `${group.name}:${i}`;
          this.destroyedTargets.add(id);
          this._play("explosion", [group.state[o], group.state[o + 1], group.state[o + 2]], 1,
            { sourceId: `target:${this.epoch}:${id}:death` });
        }
        group.previous[i] = hp;
      }
    }

    for (const pool of this.pools) {
      for (let i = 0; i < pool.live.length; i++) {
        const o = i * pool.stride, age = pool.state[o + pool.age];
        const was = pool.previousLive[i], live = pool.live[i];
        // An age rewind catches recycled slots even if both frames are live.
        const launched = live && (!was || age + 1e-7 < pool.previousAge[i]);
        if (launched) {
          pool.generation[i]++;
          this._play("missile", [pool.state[o], pool.state[o + 1], pool.state[o + 2]], pool.own ? 0.95 : 0.65,
            { sourceId: `${pool.name}:${this.epoch}:${i}:${pool.generation[i]}:launch`, propagate: false });
        } else if (was && !live) {
          this._terminal(pool, o, age, freshBooms);
        }
        if (live) {
          const mass = pool.state[o + pool.mass];
          if (launched) pool.burning[i] = 1;
          else if (age > pool.previousAge[i]) pool.burning[i] = mass < pool.previousMass[i] - 1e-5 ? 1 : 0;
          const motor = pool.own ? age < AIM9X.motor.boostDurationS ? "boost"
            : age < AIM9X.motor.boostDurationS + AIM9X.motor.sustainDurationS ? "sustain" : "coast"
            : pool.burning[i] ? "boost" : "coast";
          sources.push({ id: `${pool.name}:${this.epoch}:${i}:${pool.generation[i]}`, kind: "missile",
            position: world(pool.state, o), velocity: world(pool.state, o + 3),
            power: motor === "boost" ? 1 : motor === "sustain" ? 0.4 : 0,
            motor, age, priority: pool.own ? 0.85 : pool.name === "sam" || pool.state[o + 11] === -2 ? 1 : 0.65 });
        }
        pool.previousLive[i] = live;
        pool.previousAge[i] = age;
        pool.previousMass[i] = pool.state[o + pool.mass];
      }
    }
    // A real fuse puff survives a launch+impact between rendered frames,
    // even when the live-bit observer never saw that missile in flight.
    for (const boom of freshBooms) if (!boom.consumed) {
      const alreadyDestroyed = this.targets.some((group) => group.previous.some((hp, i) =>
        this.destroyedTargets.has(`${group.name}:${i}`) && distanceBetween(boom.position,
          [group.state[i * group.stride], group.state[i * group.stride + 1], group.state[i * group.stride + 2]]) < 10));
      if (!alreadyDestroyed) this._play("explosion", boom.position, 0.85,
        { sourceId: `fuse:${this.epoch}:${time}:${boom.position.join(":")}` });
    }

    const position = [st[S.PX], st[S.PY], st[S.PZ]];
    const teleported = died || distanceBetween(position, this.position) > Math.max(150, Math.hypot(st[S.VX], st[S.VY], st[S.VZ]) * elapsed * 3 + 20);
    this._airframe(active, time, teleported);
    this._scene(listener, sources, elapsed, active, time);
    if (!this.abLit && ab > 0.08) {
      if (active) this._play("afterburner", position, 0.45);
      this.abLit = true;
    } else if (ab < 0.025) this.abLit = false;
    // A restrained external-camera pressure thump, with hysteresis to stop
    // chatter near Mach 1. It is not a cockpit sonic-boom simulation.
    if (out.mach < 0.97) this.subsonic = true;
    if (this.subsonic && out.mach > 1.015) {
      if (active && view === "external" && time - this.lastSonic > 8) this._play("sonic", position, 0.22);
      this.subsonic = false;
      this.lastSonic = time;
    }
    // Always consume snapshots while inaudible. Unpausing must never replay
    // a salvo, old hit, or afterburner ignition from a menu/background frame.
    this.hp = p.hp;
    this.crashes = p.crashes;
    this.position = position;
    this.cinematic = cinematic;
  }
}
