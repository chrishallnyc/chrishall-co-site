// War Thunder default air binds, encoded 1:1 from the verified reference
// (.context/raptor/WT-CONTROLS.md — datamined live-client v2.57 config).
// A bind is a chord: every listed code must be held, the LAST code is the
// trigger. "Mouse0/1/2/3/4" = LMB/MMB/RMB/back/forward. Multiple binds per
// action are WT's shipped alternates. Overlaps (Space, T, Alt+A/D, Mouse0)
// ship overlapping in WT by design — game-mode context disambiguates.
// Inapplicable-to-F-22 controls omitted per BUILD-STATE D-011.

export const ACTIONS = {
  // ── flight ──────────────────────────────────────────────────────────────
  // CHRIS'S SCHEME (2026-08-06, overrides the datamined WT throttle keys):
  // W/S = throttle, mouse = aim, A/D = flaperon roll, Q/E = rudder.
  // Arrows keep manual pitch override since the mouse owns pitch.
  pitch_down:      { cat: "flight", label: "pitch: nose down (manual)", binds: [["ArrowUp"]], hold: true },
  pitch_up:        { cat: "flight", label: "pitch: nose up (manual)", binds: [["ArrowDown"]], hold: true },
  roll_left:       { cat: "flight", label: "roll left (flaperons)", binds: [["KeyA"], ["ArrowLeft"]], hold: true },
  roll_right:      { cat: "flight", label: "roll right (flaperons)", binds: [["KeyD"], ["ArrowRight"]], hold: true },
  yaw_left:        { cat: "flight", label: "rudder left", binds: [["KeyQ"]], hold: true },
  yaw_right:       { cat: "flight", label: "rudder right", binds: [["KeyE"]], hold: true },
  throttle_up:     { cat: "flight", label: "throttle up (past 100% = AB)", binds: [["KeyW"], ["NumpadAdd"], ["Equal"]], hold: true },
  throttle_down:   { cat: "flight", label: "throttle down", binds: [["KeyS"], ["NumpadSubtract"], ["Minus"]], hold: true },
  trim_toggle:     { cat: "flight", label: "trim aircraft (toggle)", binds: [["PageUp"], ["KeyT"]] },
  waim_yaw_left:   { cat: "flight", label: "weapon aim: yaw left", binds: [["AltLeft", "KeyA"]], hold: true },
  waim_yaw_right:  { cat: "flight", label: "weapon aim: yaw right", binds: [["AltLeft", "KeyD"]], hold: true },
  waim_pitch_up:   { cat: "flight", label: "weapon aim: pitch up", binds: [["AltLeft", "KeyS"]], hold: true },
  waim_pitch_down: { cat: "flight", label: "weapon aim: pitch down", binds: [["AltLeft", "KeyW"]], hold: true },

  // ── weapons ─────────────────────────────────────────────────────────────
  fire_mguns:      { cat: "weapons", label: "fire machine guns", binds: [["Mouse0"], ["Digit1"]], hold: true },
  fire_cannons:    { cat: "weapons", label: "fire cannons", binds: [["Mouse0"], ["Digit2"]], hold: true },
  fire_additional: { cat: "weapons", label: "fire additional guns", binds: [["Mouse0"], ["Digit2"]], hold: true },
  drop_bomb:       { cat: "weapons", label: "drop bomb", binds: [["Space"], ["Digit3"], ["Mouse3"]] },
  drop_guided:     { cat: "weapons", label: "drop guided bomb", binds: [["AltLeft", "Space"], ["Digit3"], ["Mouse3"]] },
  lock_guided:     { cat: "weapons", label: "lock guided bomb", binds: [["AltLeft", "KeyV"]] },
  fire_rocket:     { cat: "weapons", label: "fire rocket", binds: [["Digit4"], ["Mouse4"]] },
  fire_aam:        { cat: "weapons", label: "fire air-to-air missile", binds: [["ControlLeft", "AltLeft"]] },
  lock_a2a:        { cat: "weapons", label: "weapon lock (air-to-air)", binds: [["AltLeft", "KeyX"]] },
  fire_agm:        { cat: "weapons", label: "fire air-to-ground missile", binds: [["Space"]] },
  lock_a2g:        { cat: "weapons", label: "weapon lock (air-to-ground)", binds: [["AltLeft", "KeyC"]] },
  sel_fire_primary:   { cat: "weapons", label: "selector: fire primary", binds: [["Mouse0"]], hold: true },
  sel_fire_secondary: { cat: "weapons", label: "selector: fire secondary", binds: [["Space"]] },
  sel_primary:     { cat: "weapons", label: "selector: switch primary", binds: [["AltLeft", "Digit1"]] },
  sel_secondary:   { cat: "weapons", label: "selector: switch secondary", binds: [["AltLeft", "Digit2"]] },
  sel_cm:          { cat: "weapons", label: "selector: switch countermeasures", binds: [["AltLeft", "Digit4"]] },
  sel_ripple:      { cat: "weapons", label: "selector: ripple quantity", binds: [["AltLeft", "Digit3"]] },
  sel_exit:        { cat: "weapons", label: "selector: exit weapon mode", binds: [["AltLeft", "Backquote"]] },
  visual_selector: { cat: "weapons", label: "visual weapon selector", binds: [["CapsLock"]] },

  // ── countermeasures ─────────────────────────────────────────────────────
  cm_fire:         { cat: "countermeasures", label: "fire countermeasures", binds: [["AltLeft", "KeyE"]] },

  // ── radar / sensors ─────────────────────────────────────────────────────
  sensor_toggle:   { cat: "sensors", label: "radar/IRST on-off", binds: [["AltLeft", "KeyR"]] },
  sensor_lock:     { cat: "sensors", label: "lock radar/IRST on target", binds: [["AltLeft", "KeyF"]] },
  sensor_cycle:    { cat: "sensors", label: "cycle radar/IRST targets", binds: [["AltLeft", "KeyT"]] },
  sensor_mode:     { cat: "sensors", label: "radar/IRST mode (TWS/STT…)", binds: [["AltLeft", "KeyB"]] },
  sensor_scan:     { cat: "sensors", label: "radar/IRST search pattern", binds: [["AltLeft", "KeyD"]] },
  sensor_scale:    { cat: "sensors", label: "radar scope scale", binds: [["AltLeft", "KeyQ"]] },
  sensor_type:     { cat: "sensors", label: "switch radar / IRST", binds: [["AltLeft", "KeyA"]] },
  sensor_acm:      { cat: "sensors", label: "ACM / boresight mode", binds: [["AltLeft", "KeyW"]] },
  radar_gui:       { cat: "sensors", label: "radar mouse-control mode", binds: [["AltLeft", "KeyY"]] },
  show_cursor:     { cat: "sensors", label: "show mouse cursor (hold)", binds: [["AltLeft"]], hold: true },

  // ── views / targeting ───────────────────────────────────────────────────
  lock_target:     { cat: "view", label: "lock target (view tracking)", binds: [["Mouse1"], ["KeyX"]] },
  tracking_cam:    { cat: "view", label: "tracking camera: enemy (hold)", binds: [["Mouse2"]], hold: true },
  freelook:        { cat: "view", label: "free look (hold)", binds: [["KeyC"], ["NumpadDecimal"]], hold: true },
  toggle_view:     { cat: "view", label: "toggle view", binds: [["KeyV"]] },
  zoom_toggle:     { cat: "view", label: "zoom camera", binds: [["KeyZ"]] },
  look_back:       { cat: "view", label: "look back", binds: [["Period"]], hold: true },
  look_down:       { cat: "view", label: "look down", binds: [["Semicolon"]], hold: true },
  cam_cockpit:     { cat: "view", label: "cockpit view", binds: [["F2"]] },
  cam_external:    { cat: "view", label: "external view", binds: [["F3"]] },
  cam_virtual:     { cat: "view", label: "virtual cockpit", binds: [["F4"], ["ShiftLeft", "F1"]] },
  cam_default:     { cat: "view", label: "default view", binds: [["F5"]] },
  hide_hud:        { cat: "view", label: "hide HUD", binds: [["AltLeft", "KeyZ"]] },
  cockpit_sight:   { cat: "view", label: "toggle cockpit sight", binds: [["Quote"]] },
  poi_stab:        { cat: "view", label: "sight stabilization", binds: [["AltLeft", "Mouse0"]] },
  poi_set:         { cat: "view", label: "activate point of interest", binds: [["AltLeft", "Mouse1"]] },
  poi_clear:       { cat: "view", label: "deactivate point of interest", binds: [["AltLeft", "Mouse2"]] },
  poi_unlock:      { cat: "view", label: "unlock point", binds: [["AltLeft", "Backspace"]] },

  // ── airframe systems ────────────────────────────────────────────────────
  gear:            { cat: "systems", label: "toggle gear", binds: [["KeyG"]] },
  flaps:           { cat: "systems", label: "toggle flaps", binds: [["KeyF"]] },
  flaps_up:        { cat: "systems", label: "flaps up (step)", binds: [["BracketLeft"]] },
  flaps_down:      { cat: "systems", label: "flaps down (step)", binds: [["BracketRight"]] },
  airbrake:        { cat: "systems", label: "toggle airbrake", binds: [["KeyH"]] },
  chute:           { cat: "systems", label: "drag chute", binds: [["AltLeft", "KeyG"]] },
  engine_toggle:   { cat: "systems", label: "toggle engine", binds: [["KeyI"]] },
  wheel_brakes:    { cat: "systems", label: "wheel brakes", binds: [["KeyB"]], hold: true },
  bailout:         { cat: "systems", label: "leave the vehicle (hold)", binds: [["KeyJ"]], hold: true },
  smoke:           { cat: "systems", label: "aerobatics smoke", binds: [["KeyL"]] },
  nvd:             { cat: "systems", label: "night vision", binds: [["AltLeft", "KeyN"]] },
  laser:           { cat: "systems", label: "laser designator", binds: [["AltLeft", "KeyL"]] },

  // ── interface / comms ───────────────────────────────────────────────────
  scoreboard:      { cat: "interface", label: "statistics", binds: [["Tab"], ["KeyN"]], hold: true },
  map:             { cat: "interface", label: "tactical map", binds: [["KeyM"]] },
  chat_team:       { cat: "interface", label: "chat (team)", binds: [["Enter"], ["NumpadEnter"]] },
  chat_all:        { cat: "interface", label: "chat (all)", binds: [["ShiftLeft", "Enter"]] },
  radio_menu:      { cat: "interface", label: "radio messages (team)", binds: [["KeyT"]] },
  radio_squad:     { cat: "interface", label: "radio messages (squad)", binds: [["KeyK"]] },
  mfd_menu:        { cat: "interface", label: "multifunction menu", binds: [["KeyY"]] },
  designate:       { cat: "interface", label: "designate team target", binds: [["KeyC", "KeyY"]] },
  menu:            { cat: "interface", label: "menu", binds: [["Escape"]] },
  game_pause:      { cat: "interface", label: "pause", binds: [["KeyP"]] },
  ptt:             { cat: "interface", label: "push-to-talk", binds: [["ControlRight"]], hold: true },

  // ── raptor-only (not WT) ────────────────────────────────────────────────
  debug:           { cat: "raptor", label: "debug overlay", binds: [["Backquote"]] },
};

// WT gamepad preset pc_xinput_ma_ver1 (mouse-aim), from the same datamine.
// Axes: standard-mapping indices; buttons: standard gamepad indices.
export const WT_GAMEPAD_MA = {
  axes: { roll: 0, throttleRel: 1, aimX: 2, aimY: 3 },
  holdThrottleForWEP: true,
  buttons: {
    fire_mguns: 7,        // RT
    drop_bomb: 9,
    fire_rocket: 8,
    gear: 0,
    toggle_view: 15,
    lock_target: 12,
    zoom_toggle: 14,
  },
  chords: {
    flaps: [3, 7],
    airbrake: [2, 7],
  },
};
