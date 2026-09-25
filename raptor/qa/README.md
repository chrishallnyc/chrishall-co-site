# Aircraft validation

For the opening screen and cockpit flows, serve `raptor/` as the web root using
the [local setup instructions](../README.md#run-locally), then run:

```sh
node raptor/qa/opening.browser.mjs
node raptor/qa/loading.browser.mjs
node raptor/qa/browser.mjs
node raptor/qa/feedback.browser.mjs
node raptor/qa/backup.browser.mjs
node raptor/qa/pilotlog.browser.mjs
node raptor/qa/tactical.browser.mjs
node raptor/qa/missions.browser.mjs
```

These use `RAPTOR_BASE_URL` (default `http://localhost:8082/`) and an existing
Playwright installation; set `PLAYWRIGHT_MODULE` to its module entry point if
needed. `opening` runs headless without booting a flight renderer, covering fresh
and returning pilots, optional customization, focus and narrow layouts. It writes
screenshots and results to `.context/ceo-pass/opening/` by default. `loading`
checks recoverable bootstrap/flight-module failures without allocating a GPU.
`feedback` runs WebGL practice and combat, checks live instruments and recovery
at narrow sizes, including high-angle-of-attack guidance, gear
travel and reassigned recovery/gear controls. It verifies the real HUD's lock,
binding, friendly, ammunition, incoming-threat, rearm and boundary cues using fixed
presentation poses. Acquisition cases cover range and seeker-angle advice, detected
on-screen hostiles, and priority for actual locks and urgent warnings. Injected
outcomes check the completed-sortie report and retry flows without claiming to
beat a mission. Its artifacts default to `.context/raptor-feedback/`.
`backup` runs without a flight renderer and checks local download, preview/cancel,
invalid-file rejection, and replacement of a damaged profile on a narrow screen.
Successful restore reloads preflight with the restored controls and progress;
artifacts default to `.context/raptor-backup/`. Native `pilot-backup.test.mjs`
also checks rollback after failed writes and reports incomplete recovery.
`pilotlog` runs without a flight renderer and checks mission-ID/type search,
combined region/status filters, empty-result recovery, next-mission navigation,
briefing objectives, typing focus, selected-row visibility and narrow layouts.
It verifies that discovery leaves campaign progress and unlocks unchanged; artifacts
default to `.context/raptor-pilotlog/`.
Run flight scripts one at a time to avoid
competing graphics work.

`tactical` flies a real campaign sortie and practice flight on WebGL (or set
`RAPTOR_TEST_BACKEND=webgpu` to assert the WebGPU path). It checks
map/flight/Pause transitions, frozen simulation and weapons, current objectives,
full radio history, remapped shortcuts, narrow layouts and maximum-size live
subtitles. The subtitle layout check freezes presentation and reuses the first
received call's time; no future messages or victory are injected. Artifacts
default to `.context/raptor-tactical/`. `tactical-map.test.mjs` separately checks
all 30 authored missions, real flight headings, map bounds and hidden-target
exclusion without changing simulation hashes. `radio-log.test.mjs` covers ring
wrap/reset, subtitle expiry during simulated pauses, layout and warning priority.

`hud-ladder.test.mjs` compares canvas drawing commands to the exported geometry
functions across 630 poses, including scale changes and shrinking visible rung
sets. A saved prior implementation also matched 278,397 commands across 1,134
poses exactly. Nine warmed, alternating 100,000-frame samples measured median
JavaScript ladder work of 0.003951 ms before and 0.003001 ms after (24.0% less).
This excludes canvas rasterization, other game work and GPU time.

Current routes: the opening mode selector switches practice/battle/campaign/
operation without opening setup. The desktop destination preview switches region;
campaign regions follow their mission. **Customize flight** opens region/time choices; **Done**
returns focus to launch. In Practice, **Esc → Flight options** opens Controls,
Display & sound, and Pilot log. **Replay/Start flight school** and **Reset to
level flight** are outside those optional settings. The welcome card's **Start
flying** resumes with the flight canvas focused. Handoff behavior and render
warmup also have portable coverage in `cockpit-flow.test.mjs` and
`render-warmup.test.mjs`.

## Flight feedback and CPU checks

The following native checks use the pinned Three distribution without a browser
or GPU:

```sh
node --import ./raptor/qa/register-three.mjs --test \
  raptor/qa/mission-catalog.test.mjs raptor/qa/practice-guidance.test.mjs \
  raptor/qa/practice-recovery.test.mjs raptor/qa/flightcoach.test.mjs \
  raptor/qa/weapon-envelope.test.mjs raptor/qa/flightfx-transform.test.mjs \
  raptor/qa/flight-presentation.test.mjs raptor/qa/render-warmup.test.mjs
```

Mission preparation shares the simulation's timeout-victory predicate. Tests
distinguish required goals, early-victory goals, protection loss thresholds and
navigation. Practice checks cover recovery priority and actual gear actuator
travel, including customized or unassigned controls. Missile advice is compared
with the production seeker at strict angle and inclusive range boundaries, and
excludes friendly, dead, undetected and off-screen aircraft.

`flightfx-transform` checks current wingtip/nozzle poses, world-fixed trails and
plume camera coordinates under moving parents, manual local/world matrices,
reparenting and pose cuts. It also checks that effect preparation leaves unrelated
aircraft detail to normal rendering. Existing trail tests retain timing and density
coverage across 30, 60 and 144 fps.

A local before/after comparison used the real HIGH F-22 hierarchy (363 objects),
with raster/image loading stubbed and no GPU submission. Nine alternating samples
of 4,000 frames produced these median CPU times per update:

| Measured component | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Neutral flight effects | 0.0380 ms | 0.00282 ms | 92.6% |
| Condensation and afterburner effects | 0.1965 ms | 0.1724 ms | 12.3% |
| Neutral effects plus normal transform traversal | 0.0722 ms | 0.0374 ms | 48.2% |

Neutral effect preparation made 11 local matrix updates instead of 382. An exact
comparison with the saved prior implementation matched effect state and final
rendered world transforms across 600 frames, including LOD changes and pose cuts.
These small component CPU savings exclude drawing, GPU execution and the rest
of the game loop; they do not establish an FPS improvement.

## Aircraft driver

Run from the repository root with Node and an installed Playwright package/browser:

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

An F-22 builder exports `buildF22(options)` returning `{ group, parts }`; an async result or an additional `ready` promise is supported. The fixture waits for material image textures to finish loading before inspecting and capturing. Browser evaluation has an explicit timeout, including loader and GPU initialization waits. Paths are local URLs relative to the served `raptor/` root. `--export` chooses a different named export, and `--builder-options` passes JSON; for example, `--builder-options '{"quality":"low"}'` caps the F-22's constructed geometry and textures. The fixture calls the bandit builder as `buildBanditModels()` returning `[drone, transport, fighter]` unless `--bandit-builder` specifies another module. The production API also accepts `buildBanditModels(null, { quality })` with `high`, `medium` (`med`), or `low`; this selects fleet texture resolution at construction. `--builder-options` applies only to the F-22 fixture.

Fleet color/roughness/normal maps are generated once per aircraft kind and texture tier, then shared by every pool clone and livery. Across the three kinds, these maps use approximately 96/24/6 MiB at HIGH/MED/LOW, including mipmaps. This counts fleet coating textures only; geometry, effects, the F-22, and render targets are separate. Distance-based geometry changes reuse the selected texture tier.

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
    // Declare each of the remaining 13 parts; bay doors use local Z.
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

The clear case loads the authored Nellis CAP mission; hazy, sunset and night use free flight in Valdez/Nellis. Night uses midnight with the physical celestial sources. Unknown scenario names fail before capture. After readiness, simulation pauses and the existing debug command establishes a repeatable inspection pose. Each case captures the actual chase camera, a close parked view, and 2 km/6 km telephoto views with constant aircraft image size. The latter are depth/atmosphere stress views, not ordinary gameplay FOVs. `--distances 0` omits them. `--scenarios landing` uses the real FM ground initializer and reports individual wheel/terrain clearances rather than moving the model to fake contact.

Checks cover requested backend/tier, actual mission readiness, retained dynamic sky PMREM, opaque shadow casters, adapted aerial materials, every original PBR texture/scalar property, unchanged sun direction, correct HUD and terrain-frustum near/far/behind-camera clipping, and unchanged paused simulation hash. `--quality-cycle 1` exercises LOW→MED→HIGH→LOW→HIGH through the actual shadow and LOD callers, checking quality caps, stable material-cache size and simulation state. Construct at HIGH for that transition test; a LOW construction deliberately cannot invent higher-detail resources.

For controlled comparisons, `--shadows 0`, `--air 0`, and `--reverse-depth 0` disable individual integrations. `--post 0` and `--terrain 0` isolate compilation/cost; screenshots from those runs do not establish full-game performance. `--source-overlay <saved/source>` reuses a frozen implementation. `--ao 1` exercises the existing optional GTAO path. Production query equivalents are `aircraftShadows=0`, `aircraftAir=0`, and `reverseDepth=0`.

`--textures <directory>` previews a complete private coating bake in the real game. `--require-reflection 1` requires a complete aircraft reflection publication without capture failures. `--time-cuts 1` changes daylight/night/sunset through the application hook, checks that complete reflections refresh after each cut, and verifies that rendering leaves simulation unchanged. `--environment 0` disables only the aircraft probe for a controlled comparison (`aircraftenv=0` in production).

The aircraft reflection probe uses the physical sky and clouds at player altitude, with front-specific average diffuse ground color below the horizon. This ground hemisphere is an approximation, not a terrain render or a probe per enemy. All aircraft share the complete map while retaining their individual material response. Initial capture happens behind the loading veil; runtime refresh renders one frozen face per frame and convolves only after all six faces complete. Two reusable cube/PMREM pairs keep the published texture coherent. Pre-exposure rescales the retained map without recapturing, including after a refresh failure. The cube size is selected at boot (128 HIGH/MED, 64 LOW); later quality changes retain these resources until restart.

The lab's Studio, Daylight, Overcast and Low sun presets (`light=daylight|overcast|raking`) expose joins and material behavior under different illumination. They are inspection lighting, not the physical in-game atmosphere. Independent wing/tail charts preserve asymmetric maintenance marks. Coating normals use physical metre coordinates in UV1 for the clearcoat layer; the authored base normal uses UV0. Both layers retain their original tangent frames before world curvature. LOW omits micro-coating/nozzle maps; higher tiers share cached maps across model instances.

Aircraft shadows use the existing sun and quality map sizes, a player-centered 44 m projection snapped to texels, and a larger bounded projection near ground contact. Terrain receives aircraft shadows but does not become an additional caster. LOW disables shadow draws and map updates. The allocated shadow target survives runtime quality changes: resizing or disposing it exposed stale depth-texture references in the pinned Three.js WebGPU renderer. Saved changes select the requested 1024/2048/4096 resolution on the next boot. `shadowSize`, `allocatedShadowSize`, and `requestedShadowSize` distinguish active rendering, retained memory, and the desired tier in reports. With shared celestial visibility active, LOW reserves a 512² target without updating it; upgrading retains that allocation until restart, and the settings panel reports the mismatch.

Hillaire applies extinction and inscatter to the final lit aircraft color on both WebGPU and WebGL, preserving alpha and the post pipeline's velocity output. Ordinary scene fog remains the aircraft fallback when physical atmosphere is unavailable or aircraft aerial perspective is disabled. The material cache preserves livery assignments and covers every prebuilt visual LOD variant at startup. Explicit aircraft effects and `fog:false` effect materials remain outside this integration. WebGPU uses reversed depth for distant-surface precision. WebGL uses logarithmic depth by default; `logdepth=0` restores ordinary forward depth.

GL/GPU validation warnings fail the gate alongside browser errors and network failures. `--trace-gl 1` records the exact mesh and VAO/index-cache state for unbound indexed draws, including the first startup frame. This trace identified an existing r185 WebGL index-upload cache fault in the terrain; `engine/webgl-index-state.js` narrowly resets vertex state before index creation/update and applies only to that pinned revision. This index guard does not run on native WebGPU.

Reverse depth also needs `engine/reversed-depth-order.js`: r185 reverses explicit group/render priorities along with distance order, so the guard preserves the intended star/cloud draw order when reverse depth is active. The application imports this guard through `engine/reverseddepth.js`, which also wraps the pinned GTAO implementation to reject the reverse-depth sky clear value of zero when `--ao 1` is enabled. Revalidate these compatibility fixes when upgrading Three.js, including the optional AO path and WebGL startup draws.

Timing is warmed **rAF interval evidence**, with raw renderer counters and memory inventory. It is not GPU timestamp data, CPU-only render time, a long mission endurance test, or a universal fps claim. The full HIGH native terrain/post/cloud path can dominate the result. Run comparison cases without competing graphics jobs before attributing a small difference to the aircraft.

### Presenter and guest rehearsal

`demo.browser.mjs` checks a returning pilot with completed training and hidden
coaching on WebGPU and WebGL2. It verifies paused handoff, retained training,
visible recovery, real afterburner input, and prepared terrain GPU buffers.
Stored progress and near-terrain poses are fixtures; `flight-school.browser.mjs`
completes the course through real flight input.

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
RAPTOR_BASE_URL=http://localhost:8082/ \
node raptor/qa/demo.browser.mjs
```

The recorded Marianas HIGH feature smoke in `missions.browser.mjs` uses an
explicit 0.65 scene scale while retaining HIGH clouds, exposure and FFT ocean.
Full-resolution manual HIGH is a heavier hardware benchmark; the default Auto
mode has its own frame-budget tests and resolution policy.
