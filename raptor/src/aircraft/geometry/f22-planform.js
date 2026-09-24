// One planform source for geometry, surface paint and wing/body fairing.
// Coordinates are in each right-hand surface's undeformed local XZ plane.
const radians = degrees => degrees * Math.PI / 180;
export const WING = Object.freeze({
  rootX: 1.90, rootY: .15, span: 4.883, anhedral: radians(3.15),
  rootLE: -1.220, rootTE: 6.254, tipTE: 4.236,
  sweepLE: radians(42), sweepTE: radians(17),
  clippedTipStart: 3.995, flapSpan: 3.91, flapDepth: .78,
});
export const TAIL = Object.freeze({
  pivot: [1.155, .025, 7.933], span: 3.240,
  leadingKnee: [1.740, -1.706], trailingKnee: [1.635, 1.527],
  tipLE: -.359, tipTE: .973,
});
export const FIN = Object.freeze({
  rootX: 1.49, rootY: .30, span: 3.18, cant: radians(28),
  rootLE: 3.54, rootTE: 7.57, tipLE: 4.92, tipTE: 6.22,
  hingeRoot: 6.52, hingeTip: 5.89,
});

export const foil = fraction => {
  const t = Math.max(0, Math.min(1, fraction));
  return 2.439 * Math.sqrt(t) * (1 - t) ** .85;
};
export const wingLE = x => WING.rootLE + x * Math.tan(WING.sweepLE);
export const wingTE = x => WING.rootTE - x * Math.tan(WING.sweepTE);
export const wingTEeff = x => {
  if (x <= WING.clippedTipStart) return wingTE(x);
  const t = (x - WING.clippedTipStart) / (WING.span - WING.clippedTipStart);
  return wingTE(WING.clippedTipStart) * (1 - t) + WING.tipTE * t;
};
export const wingThick = x => .12 - .092 * Math.pow(Math.max(0, x) / WING.span, .9);
export const stabLE = x => x < TAIL.leadingKnee[0] ? TAIL.leadingKnee[1] * x / TAIL.leadingKnee[0] :
  TAIL.leadingKnee[1] + (x - TAIL.leadingKnee[0]) * (TAIL.tipLE - TAIL.leadingKnee[1]) / (TAIL.span - TAIL.leadingKnee[0]);
export const stabTE = x => x < TAIL.trailingKnee[0] ? TAIL.trailingKnee[1] * x / TAIL.trailingKnee[0] :
  TAIL.trailingKnee[1] + (x - TAIL.trailingKnee[0]) * (TAIL.tipTE - TAIL.trailingKnee[1]) / (TAIL.span - TAIL.trailingKnee[0]);
export const finLE = x => FIN.rootLE + x * (FIN.tipLE - FIN.rootLE) / FIN.span;
export const finTE = x => FIN.rootTE + x * (FIN.tipTE - FIN.rootTE) / FIN.span;
export const finHinge = x => FIN.hingeRoot + x * (FIN.hingeTip - FIN.hingeRoot) / FIN.span;
export const finThick = x => .11 - .065 * x / FIN.span;

// Approximation of the actual upper wing at a body-junction coordinate.
// Returns null ahead/behind the planform, where the intake/body owns the edge.
export function wingUpperAt(worldX, z) {
  const x = (Math.abs(worldX) - WING.rootX) / Math.cos(WING.anhedral);
  if (x < 0 || x > WING.span) return null;
  const leading = wingLE(x), trailing = wingTEeff(x);
  if (z < leading || z > trailing) return null;
  const t = (z - leading) / (trailing - leading);
  let depth = wingThick(x) * foil(t);
  if (x <= WING.flapSpan && z > trailing - WING.flapDepth) {
    const hingeT = 1 - WING.flapDepth / (trailing - leading);
    depth = wingThick(x) * foil(hingeT) * (trailing - z) / WING.flapDepth;
  }
  return WING.rootY - x * Math.sin(WING.anhedral) + depth * Math.cos(WING.anhedral);
}
