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

## Set up a flight

Start with **Practice flight**, choose a region and time, then use **Controls**
and **Settings** before launching. Preflight shows your current essential keys,
names missing bindings, and links directly to **Needs a key** for repair.
The launch button stays available as you scroll; campaign progress is visible
before you choose a flight.

In **Controls**, search by action or key, click a binding to replace it, or use
**+ Add key** for an alternate. Conflicts let you move a key, explicitly share it,
or keep your current setup. **Restore action** resets only that action and
explains any occupied defaults; **Undo** reverses the most recent layout edit,
including any keys moved from other actions. Only implemented actions are offered.
**Test your controls** previews aiming and held keys without moving or firing the
aircraft; the last tap stays visible after you release it.

Choose **Mouse** or **MacBook trackpad** on preflight or in Controls. Both devices
remain usable; the choice recalls that device’s sensitivity. Mouse, trackpad,
and controller gains save separately. Trackpad starts at 0.65×; mouse and
controller start at 1×. Existing controller gain is retained when migrating an
older shared sensitivity. Vertical inversion applies to all three.

Defaults: mouse or one finger on the trackpad to aim, **W / S** for throttle,
**A / D** to roll, **F** or **left click** for cannon, **Space** for missile,
**R** to recenter aim, and **H** for the flight guide. No essential action needs
a number pad or function key. On the trackpad, steer without clicking or
dragging; lift and reposition between strokes, and hold **F** to fire with your
other hand. Existing custom bindings stay intact, including keys already using
F or H. Unassigned macOS Command shortcuts remain available. **Esc** always
opens the flight menu; **P** also pauses. Visible **Pause**, **Controls**, **Settings**,
**Pilot log**, and guide buttons remain available in flight. Menus and loss of
window focus pause the aircraft and world.

Optional **Capture pointer** keeps aiming responsive at window edges. **Esc**
releases the pointer and pauses; capture is never requested automatically.

Display settings include graphics preset, resolution scale, field of view, and
an FPS display. The panel distinguishes the running preset from the next-flight
choice and offers **Review restart**; restarting asks before discarding an
unfinished flight. Resolution and field of view changes appear when you resume.
A **new flight** applies a preset's changes to clouds, shadows, and effects.
High and Ultra retain volumetric clouds and the full post-processing path;
Low (fastest) and Medium (balanced) reduce graphics work.

Accessibility includes an illustrative HUD/text-size and target-color preview,
reduced combat flashes, and separate switches for key reminders and the practice
checklist. Completed practice steps collapse into a compact summary. Restore
hidden reminders or the checklist from **Pause** without changing the other.
Audio has a visible mute control and separate master, engine, weapon, and
warnings/radio levels. Master volume and mute also apply to spoken radio.

Keyboard with a mouse or MacBook trackpad are the primary controls. Standard
browser-mapped controllers also support left-stick roll/throttle, right-stick aim, RT cannon, RB missile,
A gear, Y recenter, and Start pause. Press a controller button to let the browser
detect it. Custom HOTAS mappings and touch flight controls are not implemented;
controller menus still use keyboard and a pointer. Automated checks simulate
pointer/controller input; they do not certify physical trackpad gestures or
every controller model.

Preferences and completed campaign/operation results stay in this browser's
local storage, separately for each origin/port. **Pilot log** shows briefings,
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
| [src/game/](src/game/) | Preflight, controls/settings, pause menu, pilot log, HUD, player and combat systems. |
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

## Verify changes

From the repository root, with Node.js 26 (used for the current checks):

```sh
node --test raptor/qa/*.test.mjs
```

These cover bindings, Undo/restoration and controller input, settings/storage,
flight selection and loading failures, camera/interpolation, pause input
boundaries, and asynchronous exposure. They use the vendored modules without
an npm installation or GPU.

With the static server running, an **existing Playwright installation** and
Google Chrome are required for the browser checks:

```sh
node raptor/qa/browser.mjs
node raptor/qa/controls.browser.mjs
node raptor/qa/controls-history.browser.mjs
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

| QA environment variable | Meaning |
| --- | --- |
| `PLAYWRIGHT_MODULE` | Optional absolute path to an existing Playwright module entry point. |
| `RAPTOR_BASE_URL` | Server URL; default `http://localhost:8082/`. |
| `RAPTOR_TEST_OUTPUT` | Optional artifact directory; each script has its own default under `.context/`. |
| `HEADED` | `1` shows Chrome; otherwise the scripts run headless. |

Browser checks use fresh contexts and save screenshots and results; the main
playthrough scripts also record video. `controls-history` covers Undo, action
restoration, missing keys, and retained test feedback; `guidance` flies practice
and checks independent overlays, accessibility preview, and graphics restart.
`accessibility` checks modal isolation, mute migration and illustrative previews.
`loading` checks loading stages and recovery from missing game/mission files.
The missions check flies all three regions, checks HIGH/WebGL paths, and injects
end-of-mission outcomes to test saving and debrief transitions; it does not
claim to beat the missions. Checks do not use your normal browser profile or
progress. Run GPU playthroughs one at a time; recording and other GPU activity
can affect frame-time measurements.
