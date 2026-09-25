// Shared by geometry and the offline paint authoring tool. Longitudinal
// charts run across the atlas width, keeping both axes near the same scale.
export const F22_BODY_CHARTS = Object.freeze({
  upper: { rect: [.02, .68, .96, .30], bounds: [-9.5, 8.1, -2.6, 2.6] },
  lower: { rect: [.02, .36, .96, .30], bounds: [-9.5, 8.1, -2.6, 2.6] },
  outer: { rect: [.02, .19, .96, .15], bounds: [-9.5, 8.1, -.9, 1.3] },
  inner: { rect: [.02, .02, .96, .15], bounds: [-9.5, 8.1, -.9, 1.3] },
});

export const F22_LIFTING_CHARTS = Object.freeze({
  // Independent sides preserve maintenance history while retaining the
  // established 4K x 2K atlas budget. Fin faces were already independent.
  wingUpper: { rect: [.02, .52, .263, .46], bounds: [-1.4, 6.4, 0, 4.96] },
  wingUpperLeft: { rect: [.297, .52, .263, .46], bounds: [-1.4, 6.4, 0, 4.96] },
  wingLower: { rect: [.02, .02, .263, .46], bounds: [-1.4, 6.4, 0, 4.96] },
  wingLowerLeft: { rect: [.297, .02, .263, .46], bounds: [-1.4, 6.4, 0, 4.96] },
  tailUpper: { rect: [.59, .76, .18, .22], bounds: [-1.8, 1.60, 0, 3.28] },
  tailUpperLeft: { rect: [.79, .76, .18, .22], bounds: [-1.8, 1.60, 0, 3.28] },
  tailLower: { rect: [.59, .51, .18, .22], bounds: [-1.8, 1.60, 0, 3.28] },
  tailLowerLeft: { rect: [.79, .51, .18, .22], bounds: [-1.8, 1.60, 0, 3.28] },
  finPositive: { rect: [.59, .265, .18, .22], bounds: [3.4, 7.65, 0, 3.25] },
  finNegative: { rect: [.59, .02, .18, .22], bounds: [3.4, 7.65, 0, 3.25], flipS: true },
  finInnerPositive: { rect: [.79, .265, .18, .22], bounds: [3.4, 7.65, 0, 3.25] },
  finInnerNegative: { rect: [.79, .02, .18, .22], bounds: [3.4, 7.65, 0, 3.25], flipS: true },
});

export function chartUV(chart, s, t) {
  const { rect: [u, v, width, height], bounds: [s0, s1, t0, t1] } = chart;
  const longitudinal = (s - s0) / (s1 - s0);
  return [u + (chart.flipS ? 1 - longitudinal : longitudinal) * width, v + (t - t0) / (t1 - t0) * height];
}

export const f22BodyUV = chartName => (_u, _v, p) => chartUV(F22_BODY_CHARTS[chartName], p[2],
  chartName === 'upper' || chartName === 'lower' ? p[0] : p[1]);
