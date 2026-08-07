// Solar position (NOAA-style approximation, good to ~0.01°) — the fronts are
// real places, so the sun is the real sun. Azimuth from true north, eastward
// positive; elevation from the horizon. World frame: +X east, +Y up, +Z north.

const RAD = Math.PI / 180;

// dateMs: UTC epoch ms. Returns { azimuth, elevation } in radians.
export function sunPosition(dateMs, latDeg, lonDeg) {
  const jd = dateMs / 86400000 + 2440587.5;
  const d = jd - 2451545.0;
  const g = RAD * ((357.529 + 0.98560028 * d) % 360);       // mean anomaly
  const q = (280.459 + 0.98564736 * d) % 360;               // mean longitude
  const L = RAD * (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)); // ecliptic λ
  const e = RAD * (23.439 - 0.00000036 * d);                // obliquity
  const RA = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmstH = 18.697374558 + 24.06570982441908 * d;       // hours
  const lstH = (((gmstH + lonDeg / 15) % 24) + 24) % 24;
  const HA = RAD * (lstH * 15) - RA;                        // hour angle
  const lat = RAD * latDeg;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(HA));
  const az = Math.atan2(-Math.sin(HA), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(HA));
  return { azimuth: az, elevation: el };
}

// Build a UTC date for a front's location such that local SOLAR time ≈ hours.
// (Clock-time vs solar-time drift is minutes — irrelevant for lighting.)
export function dateForLocalHours(baseUtcMidnightMs, hours, lonDeg) {
  const utcHours = hours - lonDeg / 15;
  return baseUtcMidnightMs + utcHours * 3600000;
}

// az/el → unit direction in world frame (+X east, +Y up, +Z north)
export function directionFrom(azimuth, elevation, out) {
  const ce = Math.cos(elevation);
  out.set(Math.sin(azimuth) * ce, Math.sin(elevation), Math.cos(azimuth) * ce);
  return out;
}
