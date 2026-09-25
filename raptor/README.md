# RAPTOR

F-22 air combat across Nevada, Alaska, and the Marianas. Includes free practice,
quick battles, a 30-mission campaign, and generated operations with persistent
front lines. The game uses native JavaScript modules, vendored Three.js, WebGPU
with a WebGL2 fallback, and a deterministic 120 Hz flight simulation.

[Play RAPTOR](https://raptor.chall.net/) · [Release notes](CHANGELOG.md)

## Run locally

From the repository root:

```sh
python3 -m http.server 8082 --bind 127.0.0.1 --directory raptor
```

Open [localhost:8082](http://localhost:8082/). Serve **`raptor/` as the web root**:
assets and imports use absolute paths. Opening `index.html` directly or serving
it under `/raptor/` on another site's server will not load everything correctly.

There is no build step, package installation, backend, account, API key, or
runtime environment configuration. Game assets and libraries are checked in.
Use a desktop browser with WebGPU for the full graphics path; WebGL2 is the
fallback. Audio starts after a user gesture. Optional radio speech uses the
browser's speech synthesis and voices available on the computer.

See [GRAPHICS.md](GRAPHICS.md) for rendering contracts, asset sources, quality
paths, and reproducible visual comparisons.

Deploys via the `raptor` Vercel project (rootDirectory `raptor`) on push to main.

## Set up a flight

Start with **Practice flight**, choose a region and time, then use **Controls**
and **Settings** before launching. Preflight shows your current essential keys,
names missing bindings, and links directly to **Needs a key** for repair.
The launch button stays available as you scroll; campaign progress is visible
before you choose a flight.

The visual keyboard is the main editor in **Controls**; **Edit keys** returns
there from farther down the page. It follows a complete US MacBook layout,
including function keys, punctuation, both Shift keys, and the inverted-T arrow
cluster. Action colors and category filters help locate flight, weapon, aircraft,
and interface controls without moving keys around. Other keyboard and mouse
inputs remain visible separately.

Choose any key or mouse button to inspect its complete shortcuts. The inspector
shows **Hold** or **Press**, the action description, and every alternate binding.
Dotted outlines connect alternates; dashed outlines identify required modifiers.
Use **Change key** to replace a binding, **+ Add key** to capture an alternate,
or choose an action directly on an unused key. Direct assignment keeps existing
bindings and cannot silently replace a fourth slot. Conflicts let you move a key,
explicitly share it, or keep the current setup. Escape always remains available.
**Restore action** resets only that action and explains occupied defaults;
**Undo** reverses the last edit, including bindings moved from other actions.

Use arrow keys to explore the diagram, **Enter** to reach the selected key's
editor, and **Home / End** for the first / last key. **Tab** leaves the diagram
in one step. On narrow screens, swipe the keyboard sideways; the menu itself
stays within the window. The full searchable action list is still below aiming
options. Only implemented actions are offered.

**Rehearse keys** lights the actual keys you hold and reports the actions that
the flight input resolver would trigger, including shortcuts and shared keys.
The last tap remains visible. Gameplay stays paused and bindings stay unchanged;
**Tab** leaves the rehearsal area, **Esc** finishes, and collapsing the keyboard
also ends rehearsal. Focus loss and interrupted Command shortcuts clear held
inputs. F1–F12 may require Fn depending on macOS settings; Fn and Touch ID are
managed by macOS and cannot be assigned from the browser.

**Test your controls** previews aiming and held keys without moving or firing the
aircraft; the last tap stays visible after you release it. **Try aim targets**
adds five short pointer exercises to check your sensitivity. **Center preview**
starts the aiming preview from the middle; **Esc** finishes testing.

Choose **Mouse** or **MacBook trackpad** on preflight or in Controls. Both devices
remain usable; the choice recalls that device’s sensitivity. Mouse, trackpad,
and controller gains save separately. Trackpad starts at 0.65×; mouse and
controller start at 1×. Existing controller gain is retained when migrating an
older shared sensitivity. Vertical inversion applies to all three.
Choose **Precise**, **Balanced**, or **Responsive** for a starting sensitivity,
then adjust the slider. Each preset changes only the selected device's gain;
custom key assignments and other device preferences are kept.

Defaults: mouse or one finger on the trackpad to aim, **W / S** for throttle,
**A / D** to roll, **F** or **left click** for cannon, **Space** for missile,
**R** to recenter aim, and **H** for the flight guide. No essential action needs
a number pad or function key. On the trackpad, steer without clicking or
dragging; lift and reposition between strokes, and hold **F** to fire with your
other hand. Existing custom bindings stay intact, including keys already using
F or H. Unassigned macOS Command shortcuts remain available. **Esc** always
opens the flight menu; **P** also pauses. Visible **Pause**, **Controls**,
**Tune feel**, **Settings**, **Pilot log**, and guide buttons remain available in
flight. Menus and loss of window focus pause the aircraft and world.

The aircraft follows your aim direction. Keyboard bank and rudder turns keep
the new course when released, unless you also set a pointer target during the
turn. **R** aligns aim with your current flight path, so repeated recentering
does not add an unwanted climb. An off-screen aim arrow helps you find a lost
aim marker without hiding ammunition and weapon status.

Optional **Capture pointer** keeps aiming responsive at window edges. **Esc**
releases the pointer and pauses; capture is never requested automatically.

**Tune feel** opens a paused **Quick tune** panel for device choice, sensitivity,
vertical inversion, instrument size, volume and mute. Changes use the same
saved preferences as the full Controls and Settings screens. Resume when ready;
the world stays paused while you adjust them. During missions, Pause also shows
current objectives, remaining time and protected units. Protection losses are
kept separate from objective completion counts.

Practice starts airborne without enemies, mission scoring or ticket pressure.
The flight coach teaches five maneuvers: steady flight, throttle control, a
gentle turn to a compass heading, a climb and level-off, and steady cruise.
Progress comes from the aircraft's measured attitude, heading, altitude and
throttle. Live readings show the current target, with a short hold and room for
small corrections. The coach uses your current key bindings.

Choose **Just fly** for unguided practice, or start flight school again from
Pause. **Reset to level flight** restores a safe airborne aircraft and restarts
the current exercise. A practice crash pauses on a fresh aircraft so you can
adjust your setup before continuing. Completing all five exercises saves a
graduation in this browser; replaying or recovering does not erase it. If local
storage is unavailable, the completion remains valid for the current session
and the coach reports that it could not be saved.

Display settings include graphics preset, resolution scale, field of view, and
an FPS display. Preset changes update render scale, terrain detail and aircraft
shadow activity when you resume. Field of view changes also appear when you
resume. Loaded detail assets and shadow-map resolution change on a new flight.
The panel identifies pending asset changes and offers **Review restart**, which
asks before discarding an unfinished flight.
On WebGPU, High and Ultra retain volumetric clouds and the full post-processing path;
Low (fastest) and Medium (balanced) reduce graphics work.
High now uses finer cloud data, nearby one-metre Nevada aerial imagery, and
scanned Alaska rock and snow detail. These larger assets load when starting a
flight; missing optional detail keeps the base terrain usable. Native 4K is
available but remains demanding on the graphics processor.

Accessibility includes an illustrative HUD/text-size and target-color preview,
reduced combat flashes, and separate switches for key reminders and the practice
coach. The finished course collapses into a graduation card with campaign and
replay choices. Restore hidden reminders or the coach from **Pause** without
changing the other.
Audio has a visible mute control and separate master, engine, weapon, and
warnings/radio levels. Master volume and mute also apply to spoken radio.

Keyboard with a mouse or MacBook trackpad are the primary controls. Standard
browser-mapped controllers also support left-stick roll/throttle, right-stick aim, RT cannon, RB missile,
A gear, Y recenter, and Start pause. Press a controller button to let the browser
detect it. Custom HOTAS mappings and touch flight controls are not implemented;
controller menus still use keyboard and a pointer. Automated checks simulate
pointer/controller input; they do not certify physical trackpad gestures or
every controller model.

Preferences, flight school graduation, and completed campaign/operation results
stay in this browser's local storage, separately for each origin/port.
**Pilot log** shows briefings,
unlocks, completed missions, and operation status; during a campaign flight it
opens the current mission. An unfinished flight restarts when reloaded or left.
Private browsing or blocked storage limits persistence; the UI reports save
failures and keeps changes usable for the current session.

Flight preparation shows its current stage. If a selected mission cannot load,
retry that mission or return to preflight; it never silently starts a different
battle. Small preflight images keep setup lighter than loading full terrain
textures. The installable PWA caches its small shell, not every flight asset:
a connection is still needed to load a complete flight.

## Where to work

| Location | Responsibility |
| --- | --- |
| [index.html](index.html), [src/main.js](src/main.js) | Entry point, renderer initialization, game loop and system wiring. |
| [src/game/keyboardlayout.js](src/game/keyboardlayout.js), [controlsmenu.js](src/game/controlsmenu.js), [controls.css](src/game/controls.css) | Physical keyboard geometry, visual binding editor and rehearsal, shared before and during flight. |
| [src/game/](src/game/) | Preflight, controls/settings, pause menu, pilot log, HUD, player and combat systems. |
| [src/game/flightcoach.js](src/game/flightcoach.js), [quicktune.js](src/game/quicktune.js), [flightbrief.js](src/game/flightbrief.js) | Telemetry-based practice course, paused setup shortcuts and mission objective overview; wired by [cockpit.js](src/game/cockpit.js). |
| [src/aircraft/](src/aircraft/) | Aircraft geometry, materials, articulation, visual detail, lighting, and coating textures. |
| [src/sim/](src/sim/) | Aircraft dynamics, aerodynamic data, instructor and weapon data. |
| [src/engine/](src/engine/) | Fixed-step simulation, input, controller mapping, audio, graphics quality, post-processing and asynchronous exposure. |
| [src/world/](src/world/) | Terrain, atmosphere, clouds and water. |
| [src/campaign/](src/campaign/) | Authored sorties, mission progression and generated operations. |
| [assets/](assets/), [vendor/](vendor/) | Runtime assets and pinned dependencies; Three.js version is in [THREE_VERSION](vendor/THREE_VERSION). |
| [bakery/bake_terrain.py](bakery/bake_terrain.py) | Optional terrain regeneration from external USGS GeoTIFFs; its Python dependencies and source tiles are not needed to play. |
| [qa/](qa/) | Native regression tests and browser playthroughs. |

Standalone development pages: [aircraft](f22lab.html), [clouds](cloudslab.html),
[units](unitslab.html), [HUD](hudlab.html), and [audio](audiolab.html).
[Development notes](devlog.html) and [progress.json](progress.json) record earlier
work; historical phase descriptions are not the current implementation map.

## Aircraft graphics

Aircraft graphics live in `src/aircraft/`. `f22v3.js` retains the player rig's
15 public controls; reference-derived geometry, cockpit, gear, weapon bays,
F119 nozzles, and materials are separate modules. `bandit-models.js` builds the
shared fighter, transport, and drone. Their coating textures are generated once
at startup for the selected quality and shared across the aircraft pool.
Distance-dependent visual detail and livery changes preserve each aircraft's
materials and rig. Flight physics, hit volumes, and deterministic simulation
remain independent of these meshes.

The F-22 uses authored color, normal, and packed occlusion/roughness/metalness
maps in `src/aircraft/textures/f22/`. These are static assets, with three texture tiers;
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

## Verify changes

From the repository root, with Node.js 26 (used for the current checks):

```sh
node --import ./raptor/qa/register-three.mjs --test raptor/qa/*.test.mjs raptor/tests/*.test.mjs
```

These cover bindings, Undo/restoration and controller input, settings/storage,
flight selection and loading failures, camera/interpolation, pause input
boundaries, flight coaching, aircraft controls, and asynchronous exposure.
The coach includes a real flight-model integration check driven by pointer
deltas and held throttle inputs, alongside pure course-state tests. Native
checks use the vendored modules without an npm installation or GPU. See the
audio validation commands below for browser-dependent audio checks.

With the static server running, an **existing Playwright installation** and
Google Chrome are required for the browser checks:

```sh
node raptor/qa/browser.mjs
node raptor/qa/controls.browser.mjs
node raptor/qa/controls-history.browser.mjs
node raptor/qa/control-layout.browser.mjs
node raptor/qa/keyboard-workshop.browser.mjs
node raptor/qa/flight-school.browser.mjs
node raptor/qa/guidance.browser.mjs
node raptor/qa/loading.browser.mjs
node raptor/qa/accessibility.browser.mjs
node raptor/qa/missions.browser.mjs
node raptor/qa/pointing.browser.mjs
```

If Playwright is not resolvable from this checkout, point to its existing module
entry point; `HEADED=1` shows the isolated browser while it runs:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
HEADED=1 node raptor/qa/browser.mjs
```

To record the visual keyboard workshop, use `RAPTOR_RECORD=1` with
`raptor/qa/keyboard-workshop.browser.mjs`. It exercises the actual controls
component in a fresh browser context without loading a flight scene.

To watch and record the flight school playthrough:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
HEADED=1 RECORD=1 node raptor/qa/flight-school.browser.mjs
```

| QA environment variable | Meaning |
| --- | --- |
| `PLAYWRIGHT_MODULE` | Optional absolute path to an existing Playwright module entry point. |
| `RAPTOR_BASE_URL` | Server URL; default `http://localhost:8082/`. |
| `RAPTOR_TEST_OUTPUT` | Optional artifact directory; each script has its own default under `.context/`. |
| `HEADED` | `1` shows Chrome; otherwise the scripts run headless. |
| `RECORD` | `1` records the flight-school browser check; optional for that script. |

Browser checks use fresh contexts and save screenshots and results; the main
playthrough scripts also record video. `controls-history` covers Undo, action
restoration, missing keys, and retained test feedback. `control-layout` checks
the visual key map, preset persistence, shortcut editing, aim comfort targets
and narrow layouts before starting a renderer. `flight-school` completes the
five lessons using browser keyboard and pointer events, then checks Quick tune,
live recovery focus, off-screen aim and crash handling. Its deliberately injected
crash and off-screen aim probes are separate from the flown training course.
`guidance` checks independent overlays, accessibility preview and graphics restart.
`accessibility` checks modal isolation, mute migration and illustrative previews.
`loading` checks loading stages and recovery from missing game/mission files.
The missions check flies all three regions, checks HIGH/WebGL paths, and injects
end-of-mission outcomes to test saving and debrief transitions; it does not
claim to beat the missions. Checks do not use your normal browser profile or
progress. Run GPU playthroughs one at a time; recording and other GPU activity
can affect frame-time measurements.

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

With the local server above running, open `/audiolab.html`, enable sound at a comfortable level, and play the
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
