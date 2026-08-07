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
- `src/game/` — game systems (currently the phase-1 proving world).

Deploys via the `raptor` Vercel project (rootDirectory `raptor`) on push to main.
