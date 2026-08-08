// Campaign zone tables (phase 11 INC-3) — CAMPAIGN-DESIGN.md Part A §2/§4:
// the shipped battlefield.js FRONTS boot placements regrouped as named zones
// on each front's 1-D front-line axis. META WORLD ONLY: names are strings
// (they never enter sim state — the MissionSpec carries only numbers), and
// nothing here is imported by any sim system. No imports by design: this
// module (like missions.js) must load in plain Node for the t22 battery.
//
// bfIdx lists are BOOT ROW INDICES into battlefield.js FRONTS — the t17/t20
// index contract ("never reorder"). Verified against the FRONTS tables at
// authoring time and re-verified per boot by t22 (types + positions probed
// on the live battlefield, all three fronts). Doctrine follows the INC-1
// authored specs: strike targets are the supply trucks (zsu escorts defend
// but are not objectives), sead targets are radar + TELs, antiship targets
// are hulls. affords tokens: "strike" | "sead" | "antiship" (engine.js maps
// antiship -> spec.type "anti_ship").
//
// axisKm: position along the front axis (§4 — NELLIS SW->NE across the
// range, VALDEZ mouth->head of the Sound, MARIANAS Saipan->Guam down the
// chain). frontKm starts at 0; zones with axisKm > frontKm are enemy-held
// and generate sorties; zones at/behind the line count as liberated.
// zoneCenter = mean of the member unit positions (rounded to 1 m).

export const ZONES = {
  NELLIS: [
    // FRONTS.NELLIS rows: 0-3 supply_truck convoy · 4,5 zsu escort ·
    // 6 sam_radar 7,8 sam_tel · 9,10 supply_truck depot 11 zsu
    { id: 0, name: "EASTERN BASIN CONVOY", axisKm: 3, bfIdx: [0, 1, 2, 3], affords: ["strike"], zoneCenter: { x: 2510, y: -8110 } },
    { id: 1, name: "SOUTH RANGE SAM SITE", axisKm: 7, bfIdx: [6, 7, 8], affords: ["sead"], zoneCenter: { x: 4200, y: -9807 } },
    { id: 2, name: "WESTERN DEPOT", axisKm: 11, bfIdx: [9, 10], affords: ["strike"], zoneCenter: { x: -9770, y: -2230 } },
  ],
  VALDEZ: [
    // FRONTS.VALDEZ rows: 0 destroyer 1 cargo_ship · 2,3 supply_truck ·
    // 4 zsu · 5 sam_radar 6 sam_tel
    { id: 0, name: "SOUND ANCHORAGE", axisKm: 3, bfIdx: [0, 1], affords: ["antiship"], zoneCenter: { x: 2000, y: -26000 } },
    { id: 1, name: "EAST SHORE SAM SITE", axisKm: 7, bfIdx: [5, 6], affords: ["sead"], zoneCenter: { x: 11075, y: -23940 } },
    { id: 2, name: "SHORE FLATS DEPOT", axisKm: 11, bfIdx: [2, 3], affords: ["strike"], zoneCenter: { x: 14045, y: -24965 } },
  ],
  MARIANAS: [
    // FRONTS.MARIANAS rows: 0 carrier 1 destroyer · 2 cargo_ship ·
    // 3 zsu 4,5 supply_truck 6 sam_radar 7 sam_tel · 8 zsu 9 supply_truck
    { id: 0, name: "SAIPAN OUTPOST", axisKm: 2.5, bfIdx: [9], affords: ["strike"], zoneCenter: { x: -4900, y: -4120 } },
    { id: 1, name: "TINIAN ANCHORAGE", axisKm: 5, bfIdx: [2], affords: ["antiship"], zoneCenter: { x: 3000, y: 5000 } },
    { id: 2, name: "TINIAN STRIP DEPOT", axisKm: 8, bfIdx: [4, 5], affords: ["strike"], zoneCenter: { x: 3040, y: 7030 } },
    { id: 3, name: "TINIAN SAM SITE", axisKm: 11, bfIdx: [6, 7], affords: ["sead"], zoneCenter: { x: 5070, y: 7060 } },
    { id: 4, name: "CARRIER STATION", axisKm: 14, bfIdx: [0, 1], affords: ["antiship"], zoneCenter: { x: -12900, y: 2500 } },
  ],
};

// Every boot row that shoots at the player (zsu AAA + sam_tel launchers —
// sam_radar senses, it doesn't shoot), mirrored from FRONTS for the
// amendment-5 guardrail: engine.shooterCount() counts these within ~5 km of
// a zone's center. All boot rows spawn alive, so at generation time
// "placed" == "alive". t22 cross-checks this table against the live
// battlefield's types/positions on all three fronts.
export const SHOOTERS = {
  NELLIS: [
    { bfIdx: 4, type: "zsu", x: 2100, y: -8500 },
    { bfIdx: 5, type: "zsu", x: 3100, y: -9000 },
    { bfIdx: 7, type: "sam_tel", x: 4080, y: -9900 },
    { bfIdx: 8, type: "sam_tel", x: 4320, y: -9720 },
    { bfIdx: 11, type: "zsu", x: -9500, y: -2000 },
  ],
  VALDEZ: [
    { bfIdx: 4, type: "zsu", x: 15000, y: -24200 },
    { bfIdx: 6, type: "sam_tel", x: 11150, y: -23880 },
  ],
  MARIANAS: [
    { bfIdx: 3, type: "zsu", x: 4000, y: 8000 },
    { bfIdx: 7, type: "sam_tel", x: 5140, y: 7120 },
    { bfIdx: 8, type: "zsu", x: -5000, y: -4000 },
  ],
};

// Per-front presets the generator reads (§2 step 4 "tod/weather from front
// presets"): airfield = battlefield.js FRONT_AIRFIELDS values (probed pads,
// D-061/D-068 — duplicated as plain data because battlefield.js imports
// three and this chain must stay Node-importable); spawn = the front pad
// area at a safe altitude (NELLIS matches the INC-1 authored specs); tods =
// HIGH NOON / AFTERNOON / per-front GOLDEN (LATITUDE LAW hours from the
// hangar, D-064).
export const FRONT_PRESETS = {
  NELLIS: {
    airfield: { x: -3000, y: -8700, r: 900 },
    spawn: { x: 0, y: -6000, alt: 3600, speed: 220 },
    tods: [12, 15.5, 18.8],
    weatherIdx: 0,
  },
  VALDEZ: {
    airfield: { x: 0, y: -6000, r: 600 },
    spawn: { x: 0, y: -6000, alt: 3600, speed: 220 },
    tods: [12, 15.5, 21.4],
    weatherIdx: 0,
  },
  MARIANAS: {
    airfield: { x: -3200, y: -8000, r: 600 },
    spawn: { x: -3200, y: -8000, alt: 3600, speed: 220 },
    tods: [12, 15.5, 17.8],
    weatherIdx: 0,
  },
};
