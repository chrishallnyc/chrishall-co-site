# Aircraft validation

Run from anywhere with Node and an installed Playwright package/browser:

```sh
node raptor/qa/aircraft.mjs --out .context/aircraft-rebuild/validation/baseline
```

The driver starts its own static server rooted at `raptor/`, launches an isolated browser, tests the requested renderer, captures evidence, closes browser/server, and returns a failing exit code for failed assertions or browser/network errors. Production files and user browser sessions are untouched. There is no package install, framework, or build step.

The default runs the F-22 on **WebGPU and WebGL**, at 1600×1000 and device pixel ratio 1. A requested WebGPU run that falls back to WebGL fails. `--aircraft all` covers all four aircraft. `--help` lists every option.

Runtime modules are frozen in memory before the browser starts, so parallel agents editing the model cannot change the aircraft between backend cases. The exact served `/src/` files are also saved under the output's `source/`, with per-file and combined digests in the result. `--source-overlay path` overlays a directory on `/src/` before freezing. For example, the output's saved `source/` can replay an earlier revision, or a directory containing `aircraft/f22v3.js` can replace just that module and its saved siblings. Asset images outside `/src/` still come from the working tree.

## Dependencies

The driver checks local `playwright` / `playwright-core` package resolution, existing Bun package caches, then standard global Node package locations. It checks installed Chrome/Chromium and Playwright's existing browser path. Discovery never downloads anything. For reproducibility, prefer explicit paths or environment variables:

```sh
AIRCRAFT_QA_PLAYWRIGHT=/path/to/playwright-core \
AIRCRAFT_QA_BROWSER=/path/to/chrome \
node raptor/qa/aircraft.mjs --backend webgl
```

Equivalent flags are `--playwright` and `--browser`. The result records the resolved paths and browser/package versions.

## Alternate builders and matched comparisons

An F-22 builder exports `buildF22(options)` returning `{ group, parts }`; an async result or an additional `ready` promise is supported. The fixture waits for material image textures to finish loading before inspecting and capturing. Browser evaluation has an explicit timeout, including loader and GPU initialization waits. Paths are local URLs relative to the served `raptor/` root. `--export` chooses a different named export, and `--builder-options` passes JSON. The bandit builder remains `buildBanditModels()` returning `[drone, transport, fighter]` unless `--bandit-builder` specifies another module.

```sh
node raptor/qa/aircraft.mjs \
  --builder /src/aircraft/newF22.js \
  --require-metadata \
  --baseline .context/aircraft-rebuild/validation/baseline/results.json \
  --out .context/aircraft-rebuild/validation/rebuild
```

To capture the saved pre-rebuild source with identical modules on both backends:

```sh
node raptor/qa/aircraft.mjs \
  --source-overlay .context/aircraft-rebuild/baseline-src \
  --aircraft all \
  --out .context/aircraft-rebuild/validation/frozen-baseline
```

Matched runs reuse each baseline camera's world-space target and orthographic span. Shape changes therefore retain their physical scale in the comparison. Each capture records world units per pixel. Top/front/rear/side are **true orthographic cameras**, not long-lens perspective approximations. `perspective` names the diagonal inspection angle but also uses orthographic projection, deliberately. `underside` is available too. The silhouette pass renders black geometry against white without lighting or texture effects; beauty uses fixed studio lighting and ACES exposure 1. Neither pass includes the lab floor, contact shadows, gameplay atmosphere or post-processing.

F-22 coating PNGs and their manifest are frozen with the source snapshot. `--texture-overlay <directory>` replaces all 18 coating maps for a controlled material comparison without modifying production assets; the directory must contain every body/lifting color, normal and ORM quality variant. Saved snapshots record each texture hash. Use the baseline's saved `source/` plus identical framing to compare an offline AO bake on unchanged geometry.

`texture-channels.mjs --before <directory> --after <directory> --ao-source <AO-source-directory> --out <report.json>` checks an AO-only rebuild at all three quality levels. All color/normal PNGs must remain byte-identical. ORM green, blue and alpha must remain pixel-identical; red can only darken and must actually change. With an AO source, each high-resolution red pixel must exactly equal the declared strength-adjusted packing equation. This uses the same existing Playwright/Chromium dependency and browser overrides as the other drivers.

The contact sheet links full-size PNGs and amplified difference images. JSON reports exact image hashes, changed-pixel fraction and RMSE; silhouette comparisons add intersection-over-union. Metrics are evidence, not automatic judgments that an intentional visual change is wrong. Use an explicit `--min-silhouette-iou 0.95` only for a change expected to preserve shape. Nonempty and unclipped silhouette checks always run.

## Model and rig assertions

- Finite geometry attributes and transforms, matched attribute counts, valid indices, triangle counts, unit normals and valid optional tangents.
- Texture-bearing meshes have UVs; physical maps are non-color data. Missing sRGB color annotation and zero-length normals at collapsed tips are reported as warnings for inspection.
- The original 15 part keys and independent Object3D identities remain stable. Each part is exercised at its declared nonzero angle limits around its local hinge axis (legacy models use ±0.2 radians). A real surface vertex must move while the hinge line stays fixed and other rig transforms remain unchanged.
- Nozzle pivots remain direct aircraft-root children. **No nozzle coordinates are hardcoded.** A correct rebuild may move the entire engine/nozzle assembly forward.
- Actual `FlightFX` is instantiated under a translated and rotated aircraft parent. Its nozzle and wingtip anchors are compared with declared attachments in both neutral and vectored poses. This catches stale effect constants even when metadata itself looks correct.

The rebuilt model should declare this exact optional metadata shape. Legacy models receive warnings for missing metadata; `--require-metadata` turns those into failures:

```js
group.userData.aircraft = {
  version: 1,
  forward: [0, 0, -1],
  span: 13.56,
  length: 18.92,
  attachments: {
    // position is local to parts[part]; null means local to the aircraft root.
    nozzleL: { part: "nozzleL", position: [0, 0, 1.36], direction: [0, 0, 1] },
    nozzleR: { part: "nozzleR", position: [0, 0, 1.36], direction: [0, 0, 1] },
    wingtipL: { part: null, position: [-6.6, .35, 4.2] },
    wingtipR: { part: null, position: [6.6, .35, 4.2] },
  },
  hinges: {
    flaperonL: { axis: [1, 0, 0], minDeg: -20, maxDeg: 20 },
    gearNose: { axis: [1, 0, 0], minDeg: -90, maxDeg: 0, stowedDeg: -90, deployedDeg: 0 },
    // Declare each of the remaining 14 parts; bay doors use local Z.
  },
};
```

The numbers above illustrate the schema using legacy offsets. Rebuilt geometry data is authoritative; adjust all attachment coordinates accordingly. Hinge tests preserve rest cant/yaw. Additional internal rig controls can live elsewhere in `userData`; the public `parts` keys remain exactly `flaperonL/R`, `stabL/R`, `rudderL/R`, `nozzleL/R`, `canopy`, `bayMain`, `baySideL/R`, `gearNose`, `gearL/R`.

## Simulation regression

By default, the driver obtains `raptor/src/game/bandits.js` from **origin/main** using `git show`, then serves that source at a sibling module URL so relative imports resolve correctly. It compares the current and reference modules using the same scripted eight-aircraft scenario and seed over 1,200 ticks. The fixture exercises waypoints, guns, missiles, evasion, damaged-ace bingo/escape and kill bookkeeping. It compares hashes every 60 ticks, final full aircraft state, counters and RNG state.

A second current-module run calls `bandits.render()` between ticks. Its state must match the run without rendering. This tests that cosmetic work does not affect simulation. `--sim-ref <commit-or-ref>`, `--ticks`, and `--seed` make the reference explicit. A missing git reference fails rather than silently skipping the test. `--skip-sim` is available for isolated visual work.

Only the bandits module is taken from the git reference; its imported dependencies use the current checkout. This is appropriate for an aircraft-rendering diff, and is **not** a complete historical simulation checkout. If core simulation dependencies change, use a dedicated baseline worktree and the project's simulation tests as well.

## Artifacts and limits

The output includes `results.json`, each case's `result.json`, full-size screenshots, optional difference images, and an `index.html` contact sheet. Browser console/network failures are recorded separately from assertions. Metadata omissions are visible even if a legacy baseline passes.

The optional `--frames` measurement records warmed static-fixture rAF intervals and CPU render-submission time. It does **not** measure GPU execution or full-game performance. No number here establishes a 60 fps mission claim. Gameplay shadows, atmospheric integration, terrain/cloud cost, and long-session memory growth require separate in-game checks. The harness tests the structural/attachment contract and produces reviewable shape/material evidence; realistic appearance still requires reference comparison and visual review.

## Flight-control pose regression

`--check-pose` exercises the render-only aircraft pose helper and the actual `Player.render()` integration. It is explicit so legacy source overlays and alternate builders can still be captured without the new articulation contract.

```sh
node raptor/qa/aircraft.mjs --backend both --check-pose --require-metadata \
  --views rear,side --modes beauty --skip-sim --frames 0 \
  --out .context/aircraft-rebuild/validation/flight-controls
```

Checks use actual transformed surface points, quaternions and wheel centers. They verify neutral authored rest yaw/cant; physical response signs for all eight actuators under a banked/yawed/translated parent; fixed hinge lines; quarter-frame interpolation; mirrored main-gear folding and both gear stops; and untouched canopy/bay transforms. A real `Player` receives distinct previous/current positions, attitudes and actuator states, then renders 122 frames. Assertions check its interpolated world pose, visible actuator motion, unchanged identities for all 15 parts, and **byte-for-byte unchanged** current and previous FM arrays plus unchanged FM hash. The test disposes its weapon geometry and restores the aircraft before screenshots.

FM positive stabilator/flaperon deflection lowers the trailing edge. Positive rudder FM state has a negative yaw-moment slope, so it maps to negative local hinge angle. Positive TVC directs thrust downward and exhaust upward, also requiring negative local angle. All deflections postmultiply the authored rest quaternion. Gear doors lead extension, followed by the legs and folding support stays. The shared gear helper derives the whole mechanism from the interpolated gear fraction; reversing the input reverses the sequence. The nose folds forward around local X, and the main legs fold outward around mirrored local Z axes. Stop angles fit the authored geometry and are not published engineering specifications. Actual wells and conforming doors replace the earlier closed-hull approximation.


## Cockpit and landing gear inspection

A closeup can override camera framing without requiring a comparison baseline. A pose is applied only after rest-pose rig/attachment/assembly checks, and uses each part's declared local hinge axis:

```sh
node raptor/qa/aircraft.mjs --backend both --skip-sim --frames 0 \
  --views side,front,perspective --modes beauty \
  --framing '{"target":[0,0.85,-5.6],"halfHeight":0.80}' \
  --pose '{"canopy":65}' --out .context/aircraft-rebuild/cockpit/inspection
```

The rebuilt cockpit declares its canopy station envelope and expected facing directions for the visor, instrument panel and consoles. Assembly checks reject above-sill vertices penetrating the closed glazing by more than 3 mm, unintended cockpit transforms, or reversed surface normals. Gear metadata declares each wheel's center, radius, width and axle axis. Checks compare the actual tire bounds to those dimensions, ensure all three contact planes coincide within 1 mm, verify mirrored main-wheel centers, and ensure the three legs share their hardware materials. These checks activate only for assemblies that declare the metadata; legacy captures remain supported.

Syntax-check browser modules explicitly as ESM in this workspace:

```sh
node --input-type=module --check < raptor/src/aircraft/cockpit.js
```

The installed Node 26 can otherwise accept a `.js` syntax check while Chrome rejects ESM exponentiation precedence. Browser import remains the final syntax and backend gate.

## Actual game lighting, atmosphere and quality

`game-lighting.mjs` starts its own static server, freezes production modules, and boots the real application. It uses the same installed Playwright/browser discovery and explicit overrides (`--playwright`, `--browser`, or the `AIRCRAFT_QA_*` environment variables). No test scene replaces the game renderer, weather, terrain, materials, or post chain.

```sh
node raptor/qa/game-lighting.mjs --backend both --tier HIGH \
  --scenarios clear,hazy,sunset --frames 90 \
  --out .context/aircraft-rebuild/validation/game-lighting
```

The clear case loads the authored Nellis CAP mission; hazy and sunset use free flight in Valdez/Nellis. After readiness, simulation pauses and the existing debug command establishes a repeatable inspection pose. Each case captures the actual chase camera, a close parked view, and 2 km/6 km telephoto views with constant aircraft image size. The latter are depth/atmosphere stress views, not ordinary gameplay FOVs. `--distances 0` omits them. `--scenarios landing` uses the real FM ground initializer and reports individual wheel/terrain clearances rather than moving the model to fake contact.

Checks cover requested backend/tier, actual mission readiness, retained dynamic sky PMREM, opaque shadow casters, adapted aerial materials, every original PBR texture/scalar property, unchanged sun direction, correct HUD and terrain-frustum near/far/behind-camera clipping, and unchanged paused simulation hash. `--quality-cycle 1` exercises LOW→MED→HIGH→LOW→HIGH through the actual shadow and LOD callers, checking quality caps, stable material-cache size and simulation state. Construct at HIGH for that transition test; a LOW construction deliberately cannot invent higher-detail resources.

For controlled comparisons, `--shadows 0`, `--air 0`, and `--reverse-depth 0` disable individual integrations. `--post 0` and `--terrain 0` isolate compilation/cost; screenshots from those runs do not establish full-game performance. `--source-overlay <saved/source>` reuses a frozen implementation. `--ao 1` exercises the existing optional GTAO path. Production query equivalents are `aircraftShadows=0`, `aircraftAir=0`, and `reverseDepth=0`.

Aircraft shadows use the existing sun and quality map sizes, a player-centered 44 m projection snapped to texels, and a larger bounded projection near ground contact. Terrain receives aircraft shadows but does not become an additional caster. LOW disables shadow draws and map updates. Once enabled, the allocated shadow target survives runtime quality changes: resizing or disposing it exposed stale depth-texture references in the pinned Three.js WebGPU renderer. Saved changes select the requested 1024/2048/4096 resolution on the next boot. `shadowSize`, `allocatedShadowSize`, and `requestedShadowSize` distinguish active rendering, retained memory, and the desired tier in reports; LOW from startup allocates no shadow target.

Hillaire applies extinction and inscatter to the final lit aircraft color, preserving alpha and the post pipeline's velocity output; WebGL retains ordinary scene fog. The material cache preserves livery assignments and covers every prebuilt visual LOD variant at startup. Explicit aircraft effects and `fog:false` effect materials remain outside this integration. Reverse depth prevents kilometre-distance surface interference; unsupported WebGL extensions retain the renderer's normal-depth fallback.

GL/GPU validation warnings fail the gate alongside browser errors and network failures. `--trace-gl 1` records the exact mesh and VAO/index-cache state for unbound indexed draws, including the first startup frame. This trace identified an existing r185 WebGL index-upload cache fault in the terrain; `engine/webgl-index-state.js` narrowly resets vertex state before index creation/update and applies only to that pinned revision. Native WebGPU is untouched. Revalidate and remove the compatibility guard when upgrading Three.js.

Timing is warmed **rAF interval evidence**, with raw renderer counters and memory inventory. It is not GPU timestamp data, CPU-only render time, a long mission endurance test, or a universal fps claim. The full HIGH native terrain/post/cloud path can dominate the result. Run comparison cases without competing graphics jobs before attributing a small difference to the aircraft.
