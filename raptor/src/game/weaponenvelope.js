// Missile advice is a view of the acquisition rules, never a targeting input.
// Limits come from missiles.js at the call site; this module stays DOM/engine
// free and does not create a second set of weapon-balance constants.
export function missileEnvelope(player, east, north, altitude, limits, out = {}) {
  const dx = east - player[0], dy = north - player[1], dz = altitude - player[2];
  const distanceM = Math.hypot(dx, dy, dz);
  const qw = player[3], qx = player[4], qy = player[5], qz = player[6];
  const fx = 1 - 2 * (qy * qy + qz * qz), fy = 2 * (qx * qy + qw * qz), fz = 2 * (qx * qz - qw * qy);
  const cosOff = distanceM > 0 ? (dx * fx + dy * fy + dz * fz) / distanceM : 1;
  if (!Number.isFinite(distanceM) || !Number.isFinite(cosOff)) return null;
  out.distanceM = distanceM; out.cosOff = cosOff;
  // Range endpoints are inclusive; the seeker's angular test is strict >.
  out.reason = distanceM < limits.min ? 'near' : distanceM > limits.max ? 'far'
    : cosOff <= limits.cos ? 'off-axis' : 'in-envelope';
  return out;
}

// The existing marker pass supplies visibility only after its detection and
// projection gates. Filtering here also prevents friendly or dead aircraft
// from becoming advice targets. Stable slot order resolves equal-angle ties.
export function selectMissileAdvisory(player, bandits, visibleMask, limits, out = {}, scratch = {}) {
  if (!bandits?.live || !bandits.state) return null;
  let best = -1, bestCos = -1;
  for (let slot = 0; slot < Math.min(32, bandits.live.length); slot++) {
    if (!(visibleMask & (1 << slot)) || !bandits.live[slot] || bandits.side?.[slot] === 1) continue;
    const offset = slot * 14;
    if (!(bandits.state[offset + 6] > 0)) continue;
    const cue = missileEnvelope(player, bandits.state[offset], bandits.state[offset + 1], bandits.state[offset + 2], limits, scratch);
    if (!cue || cue.cosOff <= 0 || cue.cosOff <= bestCos) continue;
    best = slot; bestCos = cue.cosOff;
    out.slot = slot; out.distanceM = cue.distanceM; out.cosOff = cue.cosOff; out.reason = cue.reason;
  }
  return best < 0 ? null : out;
}
