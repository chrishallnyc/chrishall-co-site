# RAPTOR release notes

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
