# RAPTOR release notes

## 1.13.1 — 2026-09-25

- **Full-window flight on startup:** the world now fills the current window
  even when its size changes while flight assets are loading. This fixes a
  half-screen blank area that could persist until a refresh or another resize.

## 1.13.0 — 2026-09-24

Find your next flight faster, read the fight more clearly, and carry your pilot
profile between browsers. Includes the New York and Harbor Watch release.

- **Tactical map and radio log:** M pauses flight to review your heading, current
  objective, mission areas, battle boundary and airfield return course. A numbered
  objective list distinguishes required, optional and early-victory tasks. Received
  radio calls remain readable with timestamps; shortcuts respect existing layouts.
- **Readable radio:** long calls wrap within the viewport, subtitle age freezes
  while paused, and urgent combat/navigation cards take priority. Unchanged radio
  frames reuse history and text layouts instead of rebuilding message objects.
- **Lighter HUD geometry:** reuse ladder buffers and compute rotation once per
  draw. A local JavaScript component benchmark measured 24.0% less CPU time
  (0.00395 to 0.00300 ms), with identical drawing commands. This excludes canvas
  rasterization and does not establish an FPS improvement.
- **Lighter preflight:** load the flight engine only after choosing a flight.
  The initial matched bootstrap comparison reduced resource transfers by 74.5%
  (2.70 MB to 0.69 MB) and requests from 156 to 53. These are startup download
  measurements, not in-flight FPS claims.
- **Faster flight selection:** supported modes are directly accessible, desktop
  region previews select a destination, and campaign briefings open beside launch.
- **Find and prepare a mission:** search the pilot log by ID, title or type,
  combine region and status filters, or jump to the next mission. Sortie plans
  distinguish required tasks, early-victory goals, navigation and protection
  conditions using the same timeout rules as the mission.
- **More useful practice:** live airspeed, terrain clearance and vertical speed
  continue in free flight and after graduation. Prioritized safety cues and early
  level-off guidance help recover and finish the climb lesson. High-angle-of-attack
  recovery and gear status use your current bindings and yield to terrain safety.
- **Clearer combat:** target range, closing speed, lock progress and the assigned
  launch key; friendly and empty-ammo cues; incoming missile bearing, distance and
  count. Air victories now contribute to the HUD kill count.
- **Understand missile acquisition:** detected, visible hostile aircraft explain
  range and seeker-angle limits before acquisition. Actual locks, incoming threats,
  rearming and boundary warnings take priority.
- **Find your way back:** low supplies and nearby refills show the airfield's
  heading, distance, rearm conditions and progress. Leaving the battle shows a
  return course and countdown before hull damage, alongside missile warnings.
- **A useful sortie report:** flight time, losses, objectives and aircraft stores
  are captured at mission end and remain unchanged when reopened. Clear retry,
  next-mission and operation actions explain where the next flight starts.
- **Portable pilot profiles:** Pilot log → **Backup & restore** downloads progress,
  controls and preferences to a local file. Preview or cancel before replacing
  a profile from preflight; failed writes attempt recovery and report the result.
  Harbor Watch completion stays separate from campaign and operation records.
- **Less terrain work:** index the four nearby imagery tiles directly and reuse
  selection storage. Settled frames skip redundant loading-queue and edge updates
  while retaining fades, nearest-first requests, cancellation and retries.
- **Less audio update work:** reuse acoustic scratch records and source-selection
  storage. Isolated Node measurements with four or twelve voices show 49–53% less
  scene-update CPU time; this excludes audio processing and whole-game frame rate.
- **Less aircraft transform work:** flight effects update their anchor paths
  instead of walking every aircraft mesh. Native CPU measurements of neutral
  effects plus normal transform traversal fall from 0.0722 to 0.0374 ms (48.2%).
  This measures a component using the real F-22 hierarchy, excluding GPU rendering
  and whole-game frame rate; trails and plume state match the prior implementation.

## 1.12.0 — 2026-09-24

Fly New York Harbor and Manhattan, or launch Harbor Watch from its own briefing.

- **New York City:** a fourth region with a 65.536 km USGS landscape, NAIP aerial
  imagery, about 56,000 source-derived buildings, thirteen authored landmarks,
  and six bridges. Regional sky, harbor water, facade shading, and city
  collision volumes complete the flight environment.
- **A clear first flight:** New York starts as peaceful practice with the
  skyline ahead. The optional Harbor Watch briefing opens separately; its
  mission clock stays paused until you choose **Begin Harbor Watch**.
- **Harbor Watch:** a standalone alternate history set after the September 11,
  2001 attacks. Establish harbor overwatch, then intercept two additional
  hijacked aircraft before either enters protected city airspace. Both
  interceptions are required, and the eight-minute deadline is a loss condition.
  Completion and replay stay separate from the thirty-mission campaign.
- **A defined historical setting:** the attacks are not recreated; aftermath
  haze and a construction-year filter establish the scene. The F-22 response
  and additional threats are fictional, and modern imagery is retained.
  Failed interceptions end before a building impact is depicted.
- **Correct geographic orientation:** the shared flight camera now preserves
  east and west, and pointer steering follows the visible direction. Aircraft
  orientation, surface normals and renderer winding follow the same view.
- **Documented sources:** reproducible terrain and building bakeries retain
  source requests and hashes; [Map credits](terrain-credits.html) identifies
  the geographic data and the authored geometry.

Native checks exercise geometry budgets, collisions, scenario persistence,
mission outcomes, and a complete interception using production flight and
missile physics. See [New York City](README.md#new-york-city) for launch and
mission instructions.

## 1.11.0 — 2026-09-24

Start flying sooner, then hand the controls to another pilot without rebuilding
your setup.

- **A simpler opening:** fresh visitors get Practice flight over Nellis with
  one **Start flying** action. Region, time and mission choices live in
  **Customize flight**; returning pilots keep their saved selection.
- **An easier handoff:** the shorter welcome card puts steering and essential
  keys beside **Start flying**. **Esc → Replay flight school** resets the aircraft
  and lessons, restores the coach and reminders, and keeps earned progress.
  **Reset to level flight** stays visible; advanced settings sit in **Flight options**.
- **Clearer missions:** objective labels name targets, and the active task shows
  heading and distance. Saved campaign victories offer the next mission;
  operations distinguish continuing a saved front from retrying an unsaved result.
  Won or lost operations return to preflight before starting over. Rejected
  missile launches explain missing lock or empty ammunition.
- **Prepared first use:** afterburner programs and already-prepared near-terrain
  geometry join the loading draws, so these resources are ready before flight.
  Temporary rendering state is restored before the clean starting view.
- **Campaign loading:** fixes ace-livery material initialization that could block
  the second campaign mission from loading.

See the [presenter and guest handoff instructions](README.md#set-up-a-flight).

## 1.10.0 — 2026-09-24

Smoother flight through measured rendering budgets and more consistent feedback.

- **Auto graphics:** adjusts scene resolution when sustained frame times are
  slow, with a bounded floor and no repeated up/down changes. Instruments stay
  crisp. Manual presets and explicit resolution scales remain under your control;
  **Use automatic resolution** restores Auto without resetting other settings.
- **Flight feedback:** instruments, the gun pipper and air-target markers share
  the aircraft's interpolated presentation. Damage flashes and smoke use elapsed
  time. The coach acknowledges target entry and exit immediately.
- **Frame preparation:** cloud lighting warms before controls become active.
  HIGH/ULTRA terrain geometry is prepared before flight; hidden aircraft skip
  transform work, terrain bounds are cached, and reflections share one update
  slot per frame. The first near-terrain GPU upload remains deferred.
- **Cloud rendering:** removes redundant filter transforms. The optional adaptive
  path now shares the native lighting cache; the default cloud path is unchanged.

The deterministic 120 Hz flight simulation is unchanged. Auto can trade scene
resolution for smoother motion; actual frame rate still depends on hardware,
region and view.

## 1.9.1 — 2026-09-24

A calmer flight deck and smoother presentation in the air.

- **Flight deck:** clearer type, quieter navigation, brighter region previews,
  and F-22 linework give preflight more space and a stronger aircraft identity.
  Amber selections, keycaps, setup menus and flight coaching share a more
  consistent finish. Short transitions respect reduced-motion preferences.
- **Flight feel:** the chase camera eases into banks while forward aiming stays
  immediate. Cinematic camera easing follows elapsed time across refresh rates.
- **Wingtip trails:** condensation keeps consistent spacing across frame rates,
  with bounded catch-up and fresh starts after respawns, teleports or long gaps.
  Particle capacity and flight physics are unchanged.

## 1.9.0 — 2026-09-24

The engine develops irregular pressure movement instead of repeating the same
short noise texture. Cannon fire has a fuller body and a brief airframe decay,
while distant blasts spread into a deeper, more diffuse tail.

- **Engine character:** independent pressure motion and slight carrier drift
  reduce measured loop recurrence while keeping cruise and afterburner close
  to their previous loudness. Fuel loss still leaves aerodynamic sound intact.
- **Weapons and distance:** cannon rounds retain immediate, aligned attacks.
  Nine shared blast stages follow listener distance, preserving the initial
  pressure front and scheduled arrival without adding voices per event.
- **Combat clarity:** firing, incoming warnings and radio briefly reduce the
  engine's midrange while preserving its low rumble and the user's faders.
  Audio-clock recovery handles overlapping cues and finite bursts; muted cues
  leave the engine unchanged.

Native PCM checks at 44.1 and 48 kHz cover recurrence, material boundaries,
headroom, scheduling, pause, fuel loss and disposal. The added engine controls
and blast stages use about 17.1 MiB of PCM at 48 kHz; existing voice limits
remain in force. Automated measurements establish signal behavior, not a
subjective quality multiplier. Audition the mix in the sound room.

## 1.8.0 — 2026-09-24

The F-22 and opposing fleet have smoother airframes, deeper mechanical
construction and more natural material response under the sky at flight altitude.
The aircraft rebuild was followed by five rendered refinement passes. This
combined release retains the finer cloud lighting and nearby terrain detail
introduced in 1.7.0, including aerial imagery, irregular rock and snow surfaces,
and steep-slope projection.

- **Shape and assembly:** continuous cockpit and wing-root joins, rolled
  intake lips, formed bay/wheel-well structure and gear doors that clear the
  wheels through deployment. Nozzle panels show their convergent/divergent
  construction, with restrained brushed metal and heat-affected interiors.
- **Coating and light:** independent left/right maintenance patterns, quieter
  resealed joints, layered coating normals, differentiated radome/glass/metal,
  and freshly baked contact shading. Sky, cloud and average ground reflections
  now follow aircraft altitude while preserving each material's response.
- **The opposing fleet:** smoother transport noses, shaped inlet fans, fitted
  cockpit panes, deeper fighter ducts, continuous drone shoulders and detailed
  sensor/propeller assemblies. Geometry and textures remain shared by pool clones.
- **Motion and inspection:** more structured afterburner compression cells,
  stable prebuilt distance levels, and daylight, overcast and low-sun lighting
  in the aircraft lab. Native and browser checks cover both render backends,
  articulation, quality changes, reflection refresh and simulation invariance.
- **Clouds:** a new 192³/96³ High asset tier, reshaped Alaska cloud banks and
  tropical erosion, and denser source-light integration. Lighting updates run
  in bounded batches while preserving the original cloud opacity, depth and motion.
- **Terrain:** correct the Nellis base image's geographic alignment and stream
  one-metre aerial imagery near the flight area. Valdez gains optional scanned
  rock and snow detail, with material projection that holds up on steep cliffs.
- **Performance:** reuse observer-sky scattering, remove repeated ocean shoreline
  work, and retain compiled Sun/Moon programs through day/night changes. Detail
  assets have fixed memory limits, load deadlines and base-material fallbacks.
- **Integration:** preserve the flight school and controls improvements from
  1.5.0 and 1.6.0, update quality benchmark identities, and cover asset failures, moving
  tile residency, cloud-cache publication and both shader backends.

This release retains the flight school, controls, audio and world improvements
from earlier releases. High and Ultra add detail and memory use; native 4K
remains demanding. Native volumetric clouds and post-processing remain more
demanding than the WebGL fallback; quality presets remain available.
See [GRAPHICS.md](GRAPHICS.md) for rendering contracts and comparison commands.
The [cloud and terrain validation report](GRAPHICS-1.7.md) records component
measurements and their limits; those timings do not measure the combined release.

## 1.7.0 — 2026-09-24

Clouds gain finer internal structure and more accurate lighting; close terrain
resolves real aerial detail, irregular rock and snow surfaces, and steep slopes.

- **Clouds:** a new 192³/96³ High asset tier, reshaped Alaska cloud banks and
  tropical erosion, and denser source-light integration. Lighting updates run
  in bounded batches while preserving the original cloud opacity, depth and motion.
- **Terrain:** correct the Nellis base image's geographic alignment and stream
  one-metre aerial imagery near the flight area. Valdez gains optional scanned
  rock and snow detail, with material projection that holds up on steep cliffs.
- **Performance:** reuse observer-sky scattering, remove repeated ocean shoreline
  work, and retain compiled Sun/Moon programs through day/night changes. Detail
  assets have fixed memory limits, load deadlines and base-material fallbacks.
- **Integration:** preserve the flight school and controls improvements from
  1.5.0 and 1.6.0, update quality benchmark identities, and cover asset failures, moving
  tile residency, cloud-cache publication and both shader backends.

High and Ultra add detail and memory use; native 4K remains demanding. Measured
component improvements and their limits are documented in [GRAPHICS.md](GRAPHICS.md).

## 1.6.0 — 2026-09-24

The visual keyboard is now the main control editor, with a complete MacBook
layout and a rehearsal mode that shows what your real inputs would do.

- **Recognize the keyboard.** Function keys, punctuation, both Shift keys,
  wider modifier keys and an inverted-T arrow cluster match US MacBook
  positions. Categories have distinct colors and named filters. Fn and Touch ID
  are explained as macOS controls rather than assignable inputs.
- **Edit directly.** Choose an unused key to add an action without replacing
  existing bindings. Inspect full shortcuts and all alternates; related keys
  and required modifiers highlight together. Existing conflict choices, Undo,
  the four-binding limit and Escape protection remain in force.
- **Rehearse safely.** Press actual keys or use mouse buttons over the diagram
  to see held-key lighting, resolved actions and the last input. Nothing fires,
  moves or changes bindings. Rehearsal follows the same modifier precedence as
  flight and clears interrupted Command shortcuts, focus loss and wheel pulses.
- **Navigate comfortably.** Arrow keys move spatially, Enter reaches the
  selected key's editor, and Tab leaves the diagram in one step. Narrow layouts
  scroll the keyboard locally. Laptop rehearsal keeps the entire keyboard
  visible beside its feedback; compact arrow keys retain full accessible names.

Native and isolated browser checks cover geometry, navigation, assignment,
conflicts, saved layouts, rehearsal safety and responsive layouts. Physical
MacBook trackpad behavior has not been tested by the agent.

## 1.5.0 — 2026-09-24

Mouse and trackpad aiming now steer the aircraft as intended. The player had
selected an unsupported instructor mode, which ignored horizontal aim and
treated vertical aim as a sustained load command. Selecting the actual mouse
instructor fixes that mismatch. Keyboard turns keep their new course when
released, and recentering holds the current flight path without adding a climb.

- **See and edit your controls.** An interactive keyboard and pointer map shows
  current bindings, complete shortcuts and shared actions. Change a key or add
  an alternate directly from the map, with the existing conflict choices and
  Undo. Custom inputs outside the laptop layout remain visible and editable.
- **Find a comfortable aiming feel.** Precise, Balanced and Responsive presets
  work with separately saved mouse and MacBook trackpad sensitivities. A guided
  five-target comfort check lets you try the feel in the safe Controls preview;
  it does not move or fire the aircraft.
- **Learn through real flight.** Five practice lessons measure steady flight,
  throttle control, a heading change, a climb and level-off, and steady cruise.
  The coach shows live targets and current keys, forgives brief wobbles, and
  saves graduation in the browser. Free flight, replay and reset to level flight
  are available throughout practice. Crashes pause on a safe aircraft before
  you continue; recovery preserves earned training and returns keyboard focus
  to the flight canvas.
- **Adjust without losing your place.** Tune feel opens a paused panel for
  sensitivity, device choice, inversion, instrument size and sound. Pause also
  shows mission objectives and remaining time, with protection kept separate
  from completion counts. An off-screen aim cue keeps recentering discoverable
  while weapon and ammunition information remains visible.

Native checks cover input behavior, course timing, persistence and a real
flight-model course. Isolated browser checks exercise the controls map, aim
targets, all five flown lessons, Quick tune, recovery and focus. Automated
pointer input exercises the trackpad profile; physical MacBook trackpad testing
has not been performed. See [README.md](README.md#verify-changes) for commands
and optional playthrough recording.

## 1.4.0 — 2026-09-24

The sky and landscape now carry substantially more detail, with shaped volumetric
clouds, fine cirrus, a physical night sky, smaller ocean waves, and improved
terrain relief. The aircraft, flight setup, controls and combat audio from the
preceding releases remain integrated.

- **Clouds and sky:** full-resolution cloud lighting and edge-aware filtering,
  secondary billows, tier-aware 8K cirrus fibres, and consistent Sun/Moon lighting
  across the atmosphere, surfaces and water reflections.
- **Water and terrain:** a 512² fine-wave cascade on HIGH/ULTRA, filtered glints,
  coherent long-session wave phase, joined ocean meshes, packed-height
  interpolation, close terrain detail, snow relief, and a central 16 km Valdez
  region using real 5 m USGS IfSAR elevations.
- **Night and motion:** catalogued stars, a mapped Moon at its actual angular
  size, distant terrain occlusion, correct celestial motion, resets for camera
  cuts and resolution changes, and rejection of stale history for newly visible
  objects and replaced celestial geometry.
- **Aircraft and quality:** preserve coating normal maps, native self-shadows
  and volumetric exhaust in the curved world. Live presets update rendering;
  settings identify when boot assets and shadow-map resolution need a restart.
  WebGL2 retains physical atmosphere, cloud cards, material detail and improved
  depth precision.

The final five refinements focus on cloud structure, cirrus, fine water, night
clarity and aircraft integration. Native 4K is demanding; the quality presets
and fallback renderer remain available. See [GRAPHICS.md](GRAPHICS.md) for source credits,
rendering contracts and reproducible validation commands.

## 1.3.0 — 2026-09-24

Aircraft now hold up to close inspection, with shaped airframes, detailed
cockpits and mechanical interiors, physical coatings, and volumetric exhaust.
The F-22 and all three enemy aircraft share quality-aware resources and switch
to lighter geometry at a distance.

- **Refine the F-22.** Rebuilt airframe surfaces, intake and weapons-bay
  openings, pilot and instrument details, landing-gear hardware, and vectoring
  engine nozzles preserve the existing articulated aircraft rig.
- **Give each aircraft its own finish.** Authored paint, panel wear, glazing,
  engine metal, and freshly baked contact shading respond to the game's sun,
  atmosphere, and aircraft shadows.
- **Improve the enemy fleet.** Fighters gain cockpit and exhaust interiors;
  transports gain open cockpit windows and contoured engines; drones gain
  shaped propellers and optical sensor apertures.
- **Keep motion coherent.** Interpolated control surfaces, gear supports,
  doors, and nozzles follow the visible aircraft without changing flight
  simulation numerics. The flight setup and controls improvements from 1.1.0
  remain intact.
- **Inspect and reproduce the results.** The aircraft lab covers all four
  models. Offline coating and contact-bake tools, geometry checks, and browser
  captures exercise both WebGPU and WebGL rendering.

Five further refinement passes polished coating response, canopy and engines,
cockpit and gear, the enemy fleet, and exhaust/contact shading. Resource sharing,
quality caps, and prebuilt distance levels keep the detail bounded.

## 1.2.0 — 2026-09-24

Flight and combat audio now follows engine spool, aircraft motion and combat
state, with a credited afterburner recording and distinct turbine, cannon,
missile, impact, gear and warning textures.

- Hear nearby aircraft and missiles move through stereo space, with bounded
  Doppler, distance filtering and delayed blasts.
- Keep warning and radio cues readable with priority mixing that respects
  master, engine, weapons and warnings/radio volume choices.
- Audition presets and individual effects in the [audio lab](audiolab.html),
  including its 45-second demonstration. [Sound credits](audio-credits.html)
  identify the recording and its source.

Native signal, scheduling and lifecycle checks cover headroom, pause/mute,
source limits and cleanup. They do not establish subjective listening quality.

## 1.1.0 — 2026-09-24

Flight setup now gives mouse and MacBook trackpad players a clear route from
choosing controls to taking off. Preflight shows the actual essential keys,
missing-key repair, campaign progress, and a launch button that stays available.
Controls, Settings, Pause, and Pilot log remain within reach during flight.

- **Set keys with confidence.** Search actions or keys, add alternate bindings,
  resolve conflicts explicitly, restore one action, and Undo the last layout
  edit. The safe test area keeps the last input result visible. Intentional
  shared keys and existing custom layouts survive reload and migration.
- **Tune each device.** Mouse, trackpad, and controller sensitivity save
  independently. Trackpad steering needs no dragging; keyboard firing keeps
  one hand free to aim. Optional pointer capture helps at window edges, and
  Escape always releases it and opens Pause.
- **Keep flight readable.** Practice steps respond to actual controls and
  collapse when complete. Key reminders and the checklist can be hidden and
  restored independently. Accessibility settings preview instrument size and
  target colors; display settings explain which preset is running and let
  players review a restart before applying a new one.
- **Fly and load more reliably.** Camera and aircraft interpolation stay aligned,
  exposure updates avoid a synchronous graphics readback, and lighter region
  previews reduce preflight downloads. Loading shows real preparation stages;
  failed missions offer retry or preflight instead of silently starting another
  battle. Menus and focus loss pause the simulation and clear held input.
- **Preserve player choices.** Setup dialogs isolate background controls and
  restore focus. A visible mute setting includes spoken radio and retains older
  mute preferences. Campaign briefings reopen the current mission, storage
  failures report session-only changes, and shell updates retire only RAPTOR's
  own caches.

Native regression tests and isolated browser checks cover control editing,
mouse/trackpad profiles, guidance, loading recovery, and mission progress.
The game still runs as a static site with no package installation or build step.
