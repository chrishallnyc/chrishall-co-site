import assert from "node:assert/strict";
import test from "node:test";
import { Soundscape, spatialSound, acousticListener } from "../src/game/soundscape.js";
import { S } from "../src/sim/flight.js";
import { AIM9X } from "../src/sim/weapondata.js";

const camera = { position: { x: 0, y: 100, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
function fixture({ groundCount = 1, banditCount = 1, samCount = 1, banditMissiles = 1 } = {}) {
  const events = [], engine = [], scenes = [], airframe = [];
  const audio = {
    engine: { setState: (s) => engine.push(s) },
    gun: { fire: (f) => { audio.firing = f; }, setPerspective: (v) => { audio.gunView = v; } },
    locks: { setMode: (m) => { audio.mode = m; } },
    effects: { play: (kind, opts) => events.push({ kind, ...opts }), stopAll: () => { audio.stops = (audio.stops || 0) + 1; } },
    scene: { update: (frame) => scenes.push(frame) },
    airframe: { setState: (s) => airframe.push(s) },
    setPaused: (v) => { audio.paused = v; },
  };
  const st = new Float64Array(32);
  st[S.PZ] = 100; st[S.SPL] = 0.7; st[S.SPR] = 0.9;
  st[S.FUEL] = 1000;
  const player = {
    fm: { state: st, out: { qbar: 6125, V: 200, mach: 0.7, nz: 4, alphaDeg: 12 } },
    hp: 100, crashes: 0, gun: { firing: false },
    missiles: { r: new Float64Array(36), live: new Uint8Array(4), puffs: [], lockTarget: -1, locked: () => false },
  };
  const ground = new Float64Array(groundCount * 5);
  for (let i = 0; i < groundCount; i++) ground.set([150 + i * 10, 0, 100, 0, 80], i * 5);
  const battlefield = { state: ground, sam: new Float64Array(samCount * 11), samLive: new Uint8Array(samCount), samInbound: () => false };
  const bandits = { state: new Float64Array(banditCount * 14), live: new Uint8Array(banditCount), kind: new Uint8Array(banditCount).fill(2),
    msl: new Float64Array(banditMissiles * 12), mLive: new Uint8Array(banditMissiles), mslInboundPlayer: () => false };
  const director = new Soundscape(audio, { player, battlefield, bandits });
  const update = (time, extra = {}) => director.update({ camera, time, ...extra });
  return { audio, engine, events, player, battlefield, bandits, director, update, scenes, airframe };
}

test("camera-relative stereo converts ENU and follows camera rotation", () => {
  assert.deepEqual(spatialSound([120, 0, 100], camera), { distance: 120, pan: 1 });
  assert.deepEqual(spatialSound([-120, 0, 100], camera), { distance: 120, pan: -1 });
  const turned = { ...camera, quaternion: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } };
  assert.ok(spatialSound([0, 120, 100], turned).pan < -0.999);
});

test("engine follows real spool/flight state and air missiles override seeker tones", () => {
  const f = fixture();
  f.player.gun.firing = true;
  f.bandits.mslInboundPlayer = () => true;
  f.update(1);
  assert.equal(f.engine.at(-1).throttle, 0.8);
  assert.equal(f.engine.at(-1).powerInput, "spool", "the audio graph must not add another physical spool lag");
  assert.ok(Math.abs(f.engine.at(-1).ias - 194.384) < 0.001);
  assert.equal(f.engine.at(-1).g, 4);
  assert.equal(f.engine.at(-1).aoa, 12);
  assert.equal(f.audio.mode, "launch");
  assert.equal(f.audio.firing, true);
  assert.equal(f.audio.gunView, "external");
  assert.deepEqual(f.events, []);
});

test("cannon perspective follows the same view as the aircraft engine", () => {
  const f = fixture();
  f.update(1, { view: "cockpit" });
  assert.equal(f.engine.at(-1).view, "cockpit");
  assert.equal(f.audio.gunView, "cockpit");
});

test("missile launch and target detonation play once without changing sim state", () => {
  const f = fixture(), missile = f.player.missiles;
  f.update(0);
  missile.live[0] = 1; missile.r.set([50, 0, 100]); missile.r[7] = 0.05;
  const before = [...missile.r];
  f.update(0.1); f.update(0.2);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].kind, "missile");
  assert.equal(f.events[0].pan, 1);
  assert.deepEqual([...missile.r], before);
  missile.live[0] = 0; missile.r[0] = 150;
  f.battlefield.state[4] = 0;
  f.update(0.3); f.update(0.4);
  assert.equal(f.events.filter((e) => e.kind === "explosion").length, 1, "target death and missile fuse are one event");
});

test("pause stops continuous voices and consumes events without a resume backlog", () => {
  const f = fixture();
  f.player.gun.firing = true;
  f.player.missiles.live[0] = 1;
  f.player.missiles.r.set([50, 0, 100]);
  f.player.hp = 65;
  f.update(1, { paused: true });
  assert.equal(f.audio.paused, true);
  assert.equal(f.audio.firing, false);
  assert.equal(f.audio.mode, "off");
  assert.equal(f.engine.at(-1).active, false);
  f.update(1.1);
  assert.equal(f.audio.paused, false);
  assert.deepEqual(f.events, []);
});

test("death leaves one explosion at the pre-respawn position and silences the kill camera", () => {
  const f = fixture();
  f.player.fm.state[S.PX] = -40;
  f.update(0.1);
  f.player.crashes = 1;
  f.player.fm.state[S.PX] = 5000;
  f.update(0.2, { cinematic: true });
  f.update(0.3, { cinematic: true });
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].kind, "explosion");
  assert.equal(f.events[0].distance, 40);
  assert.equal(f.events[0].pan, -1);
  assert.equal(f.engine.at(-1).active, false);
  assert.equal(f.audio.paused, false, "leave the death transient tail audible");
});

test("mission-ending explosion remains audible, later background combat is quiet", () => {
  const f = fixture();
  f.battlefield.state[4] = 0;
  f.update(0.1, { cinematic: true });
  assert.equal(f.events.length, 1);
  f.player.missiles.live[0] = 1;
  f.update(0.2, { cinematic: true });
  assert.equal(f.events.length, 1);
});

test("ongoing killcam and mission-end cinematics suppress later player crashes", () => {
  const f = fixture();
  f.player.crashes = 1;
  f.update(0.1, { cinematic: true });
  assert.equal(f.events.length, 1, "the initiating death remains audible");
  f.player.crashes = 2;
  f.update(0.2, { cinematic: true });
  assert.equal(f.events.length, 1, "background respawn deaths stay silent");

  const mission = fixture();
  mission.update(0.1, { cinematic: true });
  mission.player.crashes = 1;
  mission.update(0.2, { cinematic: true });
  assert.deepEqual(mission.events, [], "a later crash cannot interrupt the mission end card");
});

test("burner/transonic one-shots have hysteresis and reset does not replay history", () => {
  const f = fixture();
  f.player.fm.state[S.ABL] = 0.1; f.player.fm.state[S.ABR] = 0.1;
  f.player.fm.out.mach = 1.02;
  f.update(10); f.update(10.1);
  assert.deepEqual(f.events.map((e) => e.kind), ["afterburner", "sonic"]);
  f.player.fm.out.mach = 1.001;
  f.update(10.2);
  f.player.fm.out.mach = 1.02;
  f.update(10.3);
  assert.equal(f.events.length, 2);
  f.update(0);
  assert.equal(f.events.length, 2);
});

test("an escaping air target with health remaining never makes an explosion", () => {
  const f = fixture();
  f.bandits.state[6] = 40; f.bandits.live[0] = 1;
  f.update(1);
  f.bandits.live[0] = 0;
  f.update(2);
  assert.deepEqual(f.events, []);
});

test("listener motion uses frame time and rejects camera cuts", () => {
  const moving = acousticListener(camera, [-10, 100, 0], 0.1);
  assert.deepEqual(moving.velocity, [100, 0, 0]);
  assert.deepEqual(moving.right, [1, 0, 0]);
  assert.deepEqual(moving.up, [0, 1, 0]);
  assert.equal(moving.forward[2], -1);
  assert.deepEqual(acousticListener(camera, [-10000, 100, 0], 0.016).velocity, [0, 0, 0]);
  assert.deepEqual(acousticListener(camera, [-10, 100, 0], 10).velocity, [0, 0, 0]);
});

test("aircraft scene sources track actual world position, velocity, and class continuously", () => {
  const f = fixture();
  f.bandits.live[0] = 1;
  f.bandits.kind[0] = 1;
  f.bandits.state.set([100, 300, 200, 180, 20, -5, 45]);
  f.bandits.state[12] = 220;
  const truth = [...f.bandits.state];
  f.update(1, { dt: 0.016 });
  const first = f.scenes.at(-1).sources[0];
  assert.deepEqual(first.position, [100, 200, 300]);
  assert.deepEqual(first.velocity, [180, -5, 20]);
  assert.equal(first.kind, "aircraft");
  assert.equal(first.aircraftClass, "transport");
  assert.deepEqual([...f.bandits.state], truth, "observation cannot mutate the aircraft");
  f.bandits.state[0] = 160;
  f.update(1.1, { dt: 0.1 });
  assert.equal(f.scenes.at(-1).sources[0].id, first.id);
  assert.equal(f.scenes.at(-1).sources[0].position[0], 160);
  f.bandits.live[0] = 0;
  f.update(1.2);
  assert.deepEqual(f.scenes.at(-1).sources, [], "escaped/departed sources retire");
});

test("missile trajectories remain audible through real boost, sustain, and coast phases", () => {
  const f = fixture(), m = f.player.missiles;
  m.live[0] = 1;
  m.r.set([20, 30, 100, 400, 10, -20]);
  m.r[7] = 0.1;
  f.update(1);
  const initial = f.scenes.at(-1).sources[0];
  assert.deepEqual(initial.velocity, [400, -20, 10]);
  assert.equal(initial.motor, "boost");
  assert.equal(initial.power, 1);
  m.r[0] = 500;
  m.r[7] = AIM9X.motor.boostDurationS + 0.1;
  f.update(2);
  const sustaining = f.scenes.at(-1).sources[0];
  assert.equal(sustaining.id, initial.id);
  assert.equal(sustaining.motor, "sustain");
  assert.ok(sustaining.power > 0 && sustaining.power < initial.power);
  assert.equal(sustaining.position[0], 500);
  m.r[0] = 100; // a close coasting pass remains a meaningful audible source
  m.r[7] += AIM9X.motor.sustainDurationS;
  f.update(3);
  assert.equal(f.scenes.at(-1).sources[0].motor, "coast");
  assert.equal(f.scenes.at(-1).sources[0].power, 0);
  assert.equal(f.events.filter((e) => e.kind === "missile").length, 1);
});

test("SAM motor state follows measured propellant consumption", () => {
  const f = fixture(), bf = f.battlefield;
  bf.samLive[0] = 1;
  bf.sam.set([800, 0, 200, -200, 0, 30, 0.05, 125]);
  f.update(1);
  assert.equal(f.scenes.at(-1).sources[0].motor, "boost");
  bf.sam[6] = 1; bf.sam[7] = 105;
  f.update(2);
  assert.equal(f.scenes.at(-1).sources[0].motor, "boost");
  bf.sam[6] = 2.3; bf.sam[7] = 86;
  f.update(3);
  bf.sam[6] = 2.4; bf.sam[0] = 100;
  f.update(3.1);
  assert.equal(f.scenes.at(-1).sources[0].motor, "coast");
});

test("missile recycling and simulation reset create fresh acoustic identities", () => {
  const f = fixture(), m = f.player.missiles;
  m.live[0] = 1; m.r.set([200, 0, 100]); m.r[7] = 1;
  f.update(1);
  const first = f.scenes.at(-1).sources[0].id;
  m.r[7] = 0.02;
  f.update(2);
  const recycled = f.scenes.at(-1).sources[0].id;
  assert.notEqual(recycled, first, "a live slot with a rewound age is a new launch");
  f.update(0);
  assert.notEqual(f.scenes.at(-1).sources[0].id, recycled, "a new simulation cannot inherit old emitter identity");
  assert.equal(f.audio.stops, 1, "scheduled distant sounds are cleared on reset");
});

test("the scene budget selects meaningful nearby sources instead of pool order", () => {
  const f = fixture({ banditCount: 8, samCount: 4, banditMissiles: 8 });
  for (let i = 0; i < 8; i++) {
    f.bandits.live[i] = 1;
    f.bandits.state.set([5000 + i * 100, 0, 100, -180, 0, 0, 60], i * 14);
    f.bandits.mLive[i] = 1;
    f.bandits.msl.set([200 + i * 50, 0, 100, -500, 0, 0, 0.05, 125, 0, 0, 0, -2], i * 12);
  }
  for (let i = 0; i < 4; i++) {
    f.battlefield.samLive[i] = 1;
    f.battlefield.sam.set([100 + i * 50, 0, 100, -500, 0, 0, 0.05, 125], i * 11);
  }
  f.update(1);
  const selected = f.scenes.at(-1).sources;
  assert.equal(selected.length, 12);
  assert.equal(new Set(selected.map((s) => s.id)).size, 12);
  assert.ok(selected.every((s) => s.kind === "missile"), "close incoming weapons outrank distant engines");
});

test("coasting missiles preserve near-pass preroll without reserving distant silent voices", () => {
  const f = fixture(), m = f.player.missiles;
  m.live[0] = 1; m.r.set([251, 0, 100, -600, 0, 0]); m.r[7] = 6;
  f.update(1);
  assert.deepEqual(f.scenes.at(-1).sources, []);
  m.r[0] = 250; m.r[7] = 6.1;
  f.update(1.1);
  assert.equal(f.scenes.at(-1).sources.length, 1);
  assert.equal(f.scenes.at(-1).sources[0].motor, "coast");
});

test("a full missile preroll set cannot cull an audible aircraft before rendering", () => {
  const f = fixture({ banditMissiles: 8 });
  f.bandits.live[0] = 1;
  f.bandits.state.set([500, 0, 100, 200, 0, 0, 60]);
  for (let i = 0; i < 4; i++) {
    f.player.missiles.live[i] = 1;
    f.player.missiles.r.set([249, 0, 100, -500, 0, 0, 50, 6, 0], i * 9);
  }
  for (let i = 0; i < 8; i++) {
    f.bandits.mLive[i] = 1;
    f.bandits.msl.set([249, 0, 100, -500, 0, 0, 4, 86, 0, 0, 0, -2], i * 12);
  }
  f.director.reset(); // attach to an already-running scene after the motors have burned out
  f.update(1);
  const selected = f.scenes.at(-1).sources;
  assert.equal(selected.length, 12);
  assert.equal(selected[0].kind, "aircraft", "candidate admission must use the renderer's audible importance");
});

test("explosions propagate with bounded delay and launches remain immediate", () => {
  const f = fixture();
  f.battlefield.state[0] = 686;
  f.battlefield.state[4] = 0;
  f.player.missiles.live[0] = 1;
  f.player.missiles.r.set([50, 0, 100]);
  f.update(1);
  const explosion = f.events.find((e) => e.kind === "explosion");
  assert.equal(explosion.delay, 2);
  assert.deepEqual(explosion.position, [686, 100, 0]);
  assert.match(explosion.sourceId, /^target:/);
  const launch = f.events.find((e) => e.kind === "missile");
  assert.equal(launch.delay, 0);
  assert.deepEqual(launch.position, [50, 100, 0]);
  const far = fixture();
  far.battlefield.state[0] = 10000; far.battlefield.state[4] = 0;
  far.update(1);
  assert.equal(far.events[0].delay, 6);
});

test("separate nearby destroyed targets are separate explosions", () => {
  const f = fixture({ groundCount: 2 });
  f.battlefield.state[4] = 0; f.battlefield.state[9] = 0;
  f.update(1);
  const booms = f.events.filter((e) => e.kind === "explosion");
  assert.equal(booms.length, 2);
  assert.notEqual(booms[0].sourceId, booms[1].sourceId);
});

test("airborne missile timeouts do not invent impact explosions", () => {
  const f = fixture(), m = f.player.missiles;
  m.live[0] = 1; m.r.set([150, 0, 100]); m.r[7] = 9.9;
  f.update(1);
  f.events.length = 0;
  m.live[0] = 0; m.r[7] = 10.01;
  f.update(2);
  assert.deepEqual(f.events, [], "even near a target, timeout alone does not establish a hit");
  assert.deepEqual(f.scenes.at(-1).sources, []);
});

test("confirmed missile ground contact produces a spatial explosion", () => {
  const f = fixture(), m = f.player.missiles;
  m.live[0] = 1; m.r.set([500, 400, 100]); m.r[7] = 1;
  f.update(1);
  f.events.length = 0;
  m.live[0] = 0; m.r[2] = -1; m.r[7] = 1.1;
  f.update(1.1);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].kind, "explosion");
  assert.ok(f.events[0].delay > 0);
});

test("real fuse puffs recover a between-frame missile detonation without replay", () => {
  const f = fixture();
  f.player.missiles.puffs.push({ x: 400, y: 600, z: 300, age: 0, boom: true });
  f.update(1); f.update(1.1);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].kind, "explosion");
  assert.ok(f.events[0].distance > 0);
});

test("gear sounds follow physical travel and endpoints, not the command or render cadence", () => {
  const f = fixture(), st = f.player.fm.state;
  f.player.gearDown = true;
  f.update(1);
  assert.deepEqual(f.events, [], "a command alone is not actuator movement");
  st[S.GEAR] = 0.05;
  f.update(1.1); f.update(1.101);
  assert.deepEqual(f.events.map((e) => e.kind), ["gear_start"]);
  assert.equal(f.airframe.at(-1).gearMoving, true);
  st[S.GEAR] = 1;
  f.update(5.1); f.update(5.2);
  assert.deepEqual(f.events.map((e) => e.kind), ["gear_start", "gear_lock"]);
  assert.equal(f.airframe.at(-1).gearMoving, false);
});

test("touchdown strength uses pre-contact descent and rolling/braking uses actual state", () => {
  const f = fixture(), st = f.player.fm.state;
  st[S.VZ] = -8;
  f.update(1);
  f.player.fm.out.wow = true;
  st[S.VZ] = 0; st[S.WSPIN] = 75; st[S.BRAKE] = 0.6;
  f.update(1.1);
  const event = f.events.find((e) => e.kind === "touchdown");
  assert.equal(event.strength, 1);
  assert.equal(f.airframe.at(-1).wheelSpeed, 75);
  assert.equal(f.airframe.at(-1).brake, 0.6);
  assert.equal(f.airframe.at(-1).weightOnWheels, true);
  f.player.fm.out.wow = false; f.update(1.2);
  f.player.fm.out.wow = true; f.update(1.3);
  assert.equal(f.events.filter((e) => e.kind === "touchdown").length, 1, "wheel bounce is debounced");
});

test("airframe uses unit ground contact load and actual gear/IAS without feeding aero G into tyres", () => {
  const f = fixture(), st = f.player.fm.state;
  st[S.GEAR] = 1; st[S.WSPIN] = 75; f.player.fm.out.wow = true;
  const before = new Float64Array(st);
  for (const [i, nz] of [0, 1.99, 2, 2.01, 6, 9].entries()) {
    f.player.fm.out.nz = nz; f.update(1 + i * 0.1);
    const frame = f.airframe.at(-1);
    assert.equal(frame.groundLoad, 1);
    assert.equal(frame.gearPosition, 1);
    assert.ok(Math.abs(frame.ias - 194.384) < 0.001);
    assert.equal(frame.load, undefined, "aerodynamic buffet intensity is not ground normal force");
  }
  f.player.fm.out.wow = false; f.update(2);
  assert.equal(f.airframe.at(-1).groundLoad, 0);
  f.update(3, { paused: true });
  assert.equal(f.airframe.at(-1).ias, 0);
  assert.deepEqual(st, before, "audio observation cannot change flight-model state");
});

test("fuel exhaustion is a real transition and is consumed silently while paused", () => {
  const f = fixture();
  f.player.fm.state[S.FUEL] = 0;
  f.update(1); f.update(2);
  assert.equal(f.events.filter((e) => e.kind === "fuel_out").length, 1);
  assert.equal(f.engine.at(-1).fuelStarved, true);
  assert.equal(f.airframe.at(-1).fuelStarved, true);
  const paused = fixture();
  paused.player.fm.state[S.FUEL] = 0;
  paused.update(1, { paused: true }); paused.update(2);
  assert.deepEqual(paused.events, []);
});

test("pause and cinematics retire continuous scene and airframe sources", () => {
  const f = fixture();
  f.bandits.live[0] = 1; f.bandits.state.set([50, 0, 100, 200, 0, 0, 60]);
  f.player.fm.out.wow = true; f.player.fm.state[S.WSPIN] = 70;
  f.update(1);
  assert.equal(f.scenes.at(-1).sources.length, 1);
  f.update(2, { paused: true });
  assert.deepEqual(f.scenes.at(-1).sources, []);
  assert.equal(f.airframe.at(-1).active, false);
  assert.equal(f.airframe.at(-1).wheelSpeed, 0);
  f.update(3, { cinematic: true });
  assert.deepEqual(f.scenes.at(-1).sources, []);
  assert.equal(f.airframe.at(-1).weightOnWheels, false);
});
