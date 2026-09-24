# RAPTOR

F-22 air combat for the browser — one aircraft, three real-Earth fronts. Lives at
[raptor.chall.net](https://raptor.chall.net); build progress at
[/devlog.html](https://raptor.chall.net/devlog.html).

Built autonomously, phase by phase. No build step, no framework: native ES modules
served static.

- `vendor/` — pinned three.js (exact version in `THREE_VERSION`); WebGPU renderer
  with automatic WebGL2 fallback (`?gl=1` forces the fallback).
- `src/engine/` — deterministic fixed-timestep sim core (120 Hz, seeded RNG,
  state hashing — replays/netcode/QA all depend on it), action-map input with
  War Thunder's default binds, quality tiers, pools, debug overlay (`?debug=1`).
- `src/game/` — aircraft, combat, campaign and render-side sound systems.

Deploys via the `raptor` Vercel project (rootDirectory `raptor`) on push to main.

## Audio

The engine combines independently seeded synthesis with a small, edited
afterburner recording. Real engine spool, airspeed, load, fuel state and
perspective drive the mix. Aircraft and missile sources move through native
HRTF panners with bounded Doppler; distant explosions arrive after a bounded
propagation delay. Gear travel, touchdown and rolling follow flight state.
`Soundscape` observes these events without changing simulation state or its RNG.
The solved engine spool receives only a short dezipper; manual lab throttle
commands retain their authored response. Each cannon trigger starts at a round
boundary, while successive taps vary. Exposed gear continues to produce airflow
after the actuator stops, and moving listeners change distant blast filtering. Broad fan/compressor bands
follow spool; impacts use layered pressure and fragment textures. Moving
aircraft change intake/exhaust timbre with direction, and coasting missiles
lose their combustion body while retaining close aerodynamic noise. Mechanical
cues stay dry while large distant effects retain a diffuse reflection tail.

`AudioBus` owns mixing, warning priority, pause/mute and disposal. Continuous
world sources are capped at 12, one-shot effects at 20, and warning release
voices at 4. The 768 KB afterburner asset loads without holding up flight;
failed loading preserves the procedural engine. Source credits and the precise
authoring recipe are in `audio-credits.html` and `assets/audio/sources.json`.
The sounds are artistic game audio, not a reproduction of operational avionics.
Incoming warnings briefly lower the engine to make room for the first pulse.
Muting the shared warning/radio fader releases this priority reduction while
preserving the chosen engine and weapons volumes.

Serve from the repository root:

```sh
python3 -m http.server 8080 --directory raptor
```

Open `/audiolab.html`, enable sound at a comfortable level, and play the
45-second showcase or individual flight, flyby, missile and landing auditions.
The lab also includes a flare effect for audition; the current game does not
yet simulate a countermeasure dispenser.

## Audio validation

Run the signal and scheduling suites from a served page's browser console.
Each result must have `failed: 0`:

```js
await (await import('/tests/audio.test.mjs')).runAudioTests({ log: true })
await (await import('/tests/audio-assets.test.mjs')).runAudioAssetTests()
await (await import('/tests/acoustic-scene.test.mjs')).runAcousticSceneTests({ log: true })
await (await import('/tests/warnings.test.mjs')).runWarningTests({ log: true })
await (await import('/tests/engine-response.test.mjs')).runEngineResponseTests({ log: true })
await (await import('/tests/cannon-response.test.mjs')).runCannonResponseTests({ log: true })
await (await import('/tests/ducking-response.test.mjs')).runDuckingResponseTests({ log: true })
await (await import('/tests/mix-preferences.test.mjs')).runMixPreferenceTests({ log: true })
await (await import('/tests/engine-character.test.mjs')).runEngineCharacterTests()
await (await import('/tests/moving-identity.test.mjs')).runMovingIdentityTests({ log: true })
```

These render actual Web Audio PCM for dynamics, stereo, timing, loading,
headroom, priority, pause/mute and resource limits. Spatial tests initialize a
silent native HRTF node before offline rendering to avoid Chrome's first-node
initialization stall; production uses native HRTF without a substituted panner.
Tests preserve the saved mute preference. On `/audiolab.html`, the separate
`runAudioLabTests()` export from `/tests/audiolab.test.mjs` checks real pause and
interruption behavior.

Pure geometry, gameplay routing, asset validation and soak-harness checks run
without a browser:

```sh
node --test raptor/tests/soundscape.test.mjs raptor/tests/acoustic-scene.test.mjs raptor/tests/audio-assets.test.mjs raptor/tests/audio-soak.test.mjs
```

See [audio-tools/README.md](audio-tools/README.md) for reproducible captures,
level-matched blind comparisons, signal analysis and silent endurance tests.
Passing signal tests does not establish subjective sound quality; record
listener judgments separately from measurements or automated critiques.
