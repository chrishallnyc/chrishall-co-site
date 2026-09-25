// Shape-preserving interpolation for measured aircraft station tables.
// Unlike an unweighted Catmull-Rom spline, this respects non-uniform station
// spacing and cannot grow a spurious shoulder between monotonic dimensions.
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function stationCurve(stations, column, axis = 'z') {
  if (stations.length < 2) throw new Error('A station curve needs at least two stations');
  const count = stations.length;
  const positions = new Float64Array(count);
  const values = new Float64Array(count);
  const widths = new Float64Array(count - 1);
  const secants = new Float64Array(count - 1);
  const slopes = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    positions[i] = stations[i][axis];
    values[i] = stations[i][column];
    if (!Number.isFinite(positions[i]) || !Number.isFinite(values[i])) {
      throw new Error(`Invalid station ${i}: ${axis}/${column}`);
    }
    if (i > 0) {
      widths[i - 1] = positions[i] - positions[i - 1];
      if (widths[i - 1] <= 0) throw new Error('Stations must advance along their axis');
      secants[i - 1] = (values[i] - values[i - 1]) / widths[i - 1];
    }
  }
  if (count === 2) {
    slopes.fill(secants[0]);
  } else {
    const endpoint = (h0, h1, d0, d1) => {
      let result = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (Math.sign(result) !== Math.sign(d0)) result = 0;
      else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(result) > Math.abs(3 * d0)) result = 3 * d0;
      return result;
    };
    slopes[0] = endpoint(widths[0], widths[1], secants[0], secants[1]);
    slopes[count - 1] = endpoint(widths[count - 2], widths[count - 3], secants[count - 2], secants[count - 3]);
    for (let i = 1; i < count - 1; i++) {
      const left = secants[i - 1], right = secants[i];
      if (left * right <= 0) slopes[i] = 0;
      else {
        const w1 = 2 * widths[i] + widths[i - 1];
        const w2 = widths[i] + 2 * widths[i - 1];
        slopes[i] = (w1 + w2) / (w1 / left + w2 / right);
      }
    }
  }
  return position => {
    if (position <= positions[0]) return values[0];
    if (position >= positions[count - 1]) return values[count - 1];
    let low = 0, high = count - 1;
    while (high - low > 1) {
      const middle = (low + high) >>> 1;
      if (position < positions[middle]) high = middle;
      else low = middle;
    }
    const t = (position - positions[low]) / widths[low];
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * values[low] +
      (t3 - 2 * t2 + t) * widths[low] * slopes[low] +
      (-2 * t3 + 3 * t2) * values[high] +
      (t3 - t2) * widths[low] * slopes[high];
  };
}

export function stationSet(stations, columns, axis = 'z') {
  const curves = columns.map(column => [column, stationCurve(stations, column, axis)]);
  return position => Object.fromEntries(curves.map(([column, curve]) => [column, curve(position)]));
}
