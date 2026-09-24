// One outline for skin cutouts, moving doors, cavity walls and painted seams.
// Main bays are specified in aircraft-local X/Z metres, nose toward -Z.
export const MAIN_BAY_RIGHT = Object.freeze([
  [.035, -1.50], [.560, -1.50], [.715, -1.27],
  [.715, 2.26], [.520, 2.48], [.035, 2.48],
]);
export const MAIN_BAY_LEFT = Object.freeze(MAIN_BAY_RIGHT.map(([x, z]) => [-x, z]).reverse());
export const MAIN_BAYS = Object.freeze([MAIN_BAY_LEFT, MAIN_BAY_RIGHT]);
