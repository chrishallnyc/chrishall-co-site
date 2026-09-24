// NASA/HEASARC BSC5P subset. See assets/sky/BRIGHT-STARS-CREDITS.md.
// Local render basis is [equatorial X, equatorial Z, equatorial Y]. The
// existing Stars sidereal rotation maps it to [east, up, north].
const DEG = Math.PI / 180, ARCSEC = DEG / 3600;
const J2000_MS = Date.UTC(2000, 0, 1, 12), YEAR_MS = 365.25 * 86400000;
const HEADER_BYTES = 24, RECORD_BYTES = 18, MISSING_COLOR = 32767;
const requests = new Map();

export function decodeBrightStars(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER_BYTES) throw Error("Invalid bright-star catalog header");
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== 0x42534331 || view.getUint16(4, true) !== 1
    || view.getUint16(6, true) !== RECORD_BYTES || view.getFloat64(12, true) !== 2000) throw Error("Unsupported bright-star catalog");
  const count = view.getUint32(8, true);
  if (count < 100 || count > 10000 || buffer.byteLength !== HEADER_BYTES + count * RECORD_BYTES) throw Error("Invalid bright-star catalog length");
  const stars = [], ids = new Set();
  for (let i = 0; i < count; i++) {
    const at = HEADER_BYTES + i * RECORD_BYTES, hr = view.getUint16(at, true);
    const ra = view.getUint32(at + 2, true) / 3600000, dec = view.getInt32(at + 6, true) / 3600000;
    const magnitude = view.getInt16(at + 10, true) / 100, rawColor = view.getInt16(at + 12, true);
    const bv = rawColor === MISSING_COLOR ? null : rawColor / 100;
    if (hr < 1 || hr > 9110 || ids.has(hr) || ra >= 360 || Math.abs(dec) > 90 || magnitude < -2 || magnitude > 6.5
      || bv !== null && (bv < -.5 || bv > 5)) throw Error("Invalid bright-star catalog record");
    ids.add(hr);
    stars.push({ hr, ra, dec, magnitude, bv,
      pmRA: view.getInt16(at + 14, true) / 1000,
      pmDec: view.getInt16(at + 16, true) / 1000 });
  }
  return stars;
}

export function loadBrightStarCatalogue(url = new URL("../../assets/sky/bright-stars-v6.bin", import.meta.url)) {
  const key = String(url);
  if (!requests.has(key)) requests.set(key, (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return decodeBrightStars(await response.arrayBuffer());
    } catch { return null; } // Keep the seeded field on HTTP/decode failures.
  })());
  return requests.get(key);
}

// IAU 1976 J2000 -> mean equator/equinox of date. This matches the game's
// mean sidereal-time and mean-of-date lunar frame; no new apparent-place
// ephemeris is introduced. UTC vs TT is negligible for precession here.
export function precessionAngles(dateMs) {
  const t = (dateMs - J2000_MS) / (100 * YEAR_MS);
  return [(2306.2181 * t + .30188 * t * t + .017998 * t ** 3) * ARCSEC,
    (2306.2181 * t + 1.09468 * t * t + .018203 * t ** 3) * ARCSEC,
    (2004.3109 * t - .42665 * t * t - .041833 * t ** 3) * ARCSEC];
}

export function starDirection(star, dateMs, angles = precessionAngles(dateMs)) {
  const ra = star.ra * DEG, dec = star.dec * DEG, years = (dateMs - J2000_MS) / YEAR_MS;
  // BSC proper motion in RA is the tangential mu_alpha*cos(delta), in
  // arcsec/year. Cartesian tangent updates remain well-behaved at Polaris.
  const cr = Math.cos(ra), sr = Math.sin(ra), cd = Math.cos(dec), sd = Math.sin(dec);
  const east = star.pmRA * years * ARCSEC, north = star.pmDec * years * ARCSEC;
  let x = cd * cr - east * sr - north * sd * cr;
  let y = cd * sr + east * cr - north * sd * sr;
  let z = sd + north * cd;
  const [zeta, zz, theta] = angles;
  const a = Math.cos(zeta) * x - Math.sin(zeta) * y;
  const b = Math.sin(zeta) * x + Math.cos(zeta) * y;
  const c = Math.cos(theta) * a - Math.sin(theta) * z;
  z = Math.sin(theta) * a + Math.cos(theta) * z;
  x = Math.cos(zz) * c - Math.sin(zz) * b;
  y = Math.sin(zz) * c + Math.cos(zz) * b;
  const length = Math.hypot(x, y, z);
  return [x / length, z / length, y / length];
}

// Preserve the accepted restrained tint range. B-V replaces random color;
// this is a display tint, not a synthesized stellar spectrum. Missing B-V
// receives neutral white. Flux normalization remains the caller's job.
export function starTint(bv) {
  if (bv === null) return [1, 1, 1];
  const warm = Math.min(Math.max((bv + .3) / 2.3, 0), 1);
  return [.85 + .21 * warm, .97, 1.13 - .34 * warm];
}
