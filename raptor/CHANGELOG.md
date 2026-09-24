# RAPTOR release notes

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
  size, distant terrain occlusion, correct celestial motion, and temporal
  resets when the camera, resolution or visible geometry changes.
- **Aircraft and quality:** preserve coating normal maps, native self-shadows
  and volumetric exhaust in the curved world. Live presets update rendering;
  settings identify when larger boot assets need a restart. WebGL2 retains
  physical atmosphere, cloud cards, material detail and improved depth precision.

The final five refinements focus on cloud structure, cirrus, fine water, night
clarity and aircraft integration. Native 4K is demanding; the quality presets
and fallback renderer remain available. See GRAPHICS.md for source credits,
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
