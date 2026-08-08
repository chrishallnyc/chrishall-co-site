// TargetDirectory (phase 11 INC-4, W1): one unified target id space over the
// battlefield (list 0) and the bandits (list 1) so missiles.js's seeker loop
// and gun.js's segment test stop iterating battlefield alone.
//
//   tid = listIdx * 4096 + unitIdx        (CAMPAIGN-DESIGN.md §1 W1)
//
// Iteration order is the determinism contract: battlefield slots 0..cap-1
// first, then bandit slots 0..MAX_BANDITS-1 — callers preserve their
// existing tie-breaks (min-angle, lowest tid) for free. Zero allocation in
// the hot paths: pos/vel write into caller-owned out arrays.
//
// Ground velocity honesty (W2 feed): driving convoy trucks report their
// 8 m/s (battlefield CONVOY_SPEED) along the hashed yaw cursor — everything
// else on the ground is the v_tgt = 0 special case the design names.
// testSegmentAll checks the lists in directory order (battlefield first) —
// same first-hit-wins tie-break as each list's own testSegment.

const GROUND = "ground", AIR = "air";
const LIST_STRIDE = 4096;

export function makeDirectory({ battlefield = null, bandits = null } = {}) {
  const bfCap = battlefield ? battlefield.cap : 0;
  const bCap = bandits ? bandits.live.length : 0; // MAX_BANDITS

  return {
    // fixed directory size (dead slots stay addressable — alive() filters)
    count() { return bfCap + bCap; },

    // i-th directory entry's tid, in the contract order
    tid(i) { return i < bfCap ? i : LIST_STRIDE + (i - bfCap); },

    pos(tid, out) {
      const u = tid & (LIST_STRIDE - 1);
      if (tid < LIST_STRIDE) {
        const o = u * 5;
        out[0] = battlefield.state[o]; out[1] = battlefield.state[o + 1]; out[2] = battlefield.state[o + 2];
      } else {
        const o = u * 14; // SLOTS_B
        out[0] = bandits.state[o]; out[1] = bandits.state[o + 1]; out[2] = bandits.state[o + 2];
      }
    },

    vel(tid, out) {
      out[0] = 0; out[1] = 0; out[2] = 0;
      const u = tid & (LIST_STRIDE - 1);
      if (tid < LIST_STRIDE) {
        const bf = battlefield;
        if (bf.types[u] === "supply_truck" && bf.tag[u] !== 0 && bf.paths.has(bf.tag[u]) &&
            bf.wpt[u] * 2 < bf.paths.get(bf.tag[u]).length && bf.alive(u)) {
          out[0] = 8 * Math.sin(bf.yawS[u]); // yawS = atan2(dx, dy): ENU bearing
          out[1] = 8 * Math.cos(bf.yawS[u]);
        }
      } else {
        const o = u * 14;
        out[0] = bandits.state[o + 3]; out[1] = bandits.state[o + 4]; out[2] = bandits.state[o + 5];
      }
    },

    alive(tid) {
      const u = tid & (LIST_STRIDE - 1);
      if (tid < LIST_STRIDE) return u < bfCap && battlefield.alive(u);
      return u < bCap && bandits.alive(u);
    },

    kind(tid) { return tid < LIST_STRIDE ? GROUND : AIR; },

    // routes to the owning list's damage sink (kills/blueLosses booking
    // stays each list's own — battlefield semantics on both sides)
    damage(tid, d) {
      const u = tid & (LIST_STRIDE - 1);
      if (tid < LIST_STRIDE) return u < bfCap ? battlefield.damage(u, d) : false;
      return u < bCap ? bandits.damage(u, d) : false;
    },

    // segment vs every live hit-sphere in both lists; first hit as a tid, -1
    // clean. Directory order (battlefield, then bandits) is the tie-break.
    testSegmentAll(x0, y0, z0, x1, y1, z1) {
      if (battlefield) {
        const i = battlefield.testSegment(x0, y0, z0, x1, y1, z1);
        if (i >= 0) return i;
      }
      if (bandits) {
        const j = bandits.testSegment(x0, y0, z0, x1, y1, z1);
        if (j >= 0) return LIST_STRIDE + j;
      }
      return -1;
    },
  };
}
