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
- `src/game/` — game systems, missions, player and enemy aircraft.

Deploys via the `raptor` Vercel project (rootDirectory `raptor`) on push to main.

Aircraft graphics live in `src/aircraft/`. `f22v3.js` retains the player rig's
15 public controls; reference-derived geometry, cockpit, gear, weapon bays,
F119 nozzles, and materials are separate modules. `bandit-models.js` builds the
shared fighter, transport, and drone. Their coating textures are generated once
at startup for the selected quality and shared across the aircraft pool.
Distance-dependent visual detail and livery changes preserve each aircraft's
materials and rig. Flight physics,
hit volumes, and deterministic simulation remain independent of these meshes.

The F-22 uses authored color, normal, and packed occlusion/roughness/metalness
maps in `textures/f22/`. These are static assets, with three texture tiers;
the browser does no coating baking during flight. Rebuild the paint maps with
`node raptor/tools/bake-f22.mjs` using an existing Playwright/Chrome installation.
The authoring source is in `src/aircraft/authoring/`; physical dimensions and
shared UV/door outlines are in `src/aircraft/geometry/`.
Contact occlusion is baked offline from the neutral aircraft and packed into
the same maps. See [`tools/F22-AO.md`](tools/F22-AO.md) to regenerate it after
geometry changes; the paint baker rejects a stale contact bake.

Serve this directory as the web root, then open `/f22lab.html` to inspect all
four aircraft under studio lighting. View buttons cover the underside, cockpit,
and exhausts; toggles expose the landing gear and weapon bays. Reproducible views use
`?view=rear&gear=0&spin=0`; add `gl=1` for WebGL, `ui=0` for clean screenshots,
`bays=1` for open bays, `ab=1` for settled afterburners, or `aircraft=fighter`,
`transport`, or `drone`. The earlier F-22 remains available with `v=2`.

See [`qa/README.md`](qa/README.md) for frozen-source aircraft captures, rig and
simulation regressions, and real-game WebGPU/WebGL lighting/quality checks.
`src/aircraft/lighting.js` provides aircraft self-shadow and atmospheric
integration; compatibility handling is documented alongside those checks.
