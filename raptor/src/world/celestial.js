// Render-only, low-precision lunar ephemeris and shared photometric units.
// Orbital elements/perturbations: Paul Schlyter, stjarnhimlen.se/comp/ppcomp.html.
// No simulation RNG, no network, no Date.now(): the atmosphere's UTC drives it.
const DEG = Math.PI / 180;
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const sin = (x) => Math.sin(x * DEG), cos = (x) => Math.cos(x * DEG);
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
export const SOLAR_ILLUMINANCE_LUX = 120000;
export const SOLAR_SCENE_IRRADIANCE = 36;
export const SCENE_PER_LUX = SOLAR_SCENE_IRRADIANCE / SOLAR_ILLUMINANCE_LUX;
// A representative pristine zenith background (~21.7 mag/arcsec²), not a
// display-space floor. The 90 km emitting shell is projected in celestial-nodes.
export const DARK_SKY_CD_M2 = 0.00022;
export const DARK_SKY_RADIANCE = DARK_SKY_CD_M2 * SCENE_PER_LUX;
export const ZERO_MAG_LUX = 2.54e-6;

export function localSiderealRadians(dateMs, longitudeDeg) {
  const d = dateMs / 86400000 + 2440587.5 - 2451545;
  return ((280.46061837 + 360.98564736629 * d + longitudeDeg) % 360) * DEG;
}

// Empirical integrated brightness law, alpha=0 at full Moon. A quarter
// Moon is ~9% of full brightness, despite half of its disc being illuminated.
export function lunarPhaseBrightness(phaseAngleRadians) {
  const a = clamp(phaseAngleRadians / DEG, 0, 180);
  return Math.pow(10, -0.4 * (0.026 * a + 4e-9 * a ** 4));
}

export function moonPosition(dateMs, latDeg, lonDeg, altitudeM = 0) {
  const d = dateMs / 86400000 + 2440587.5 - 2451543.5;
  const node = 125.1228 - 0.0529538083 * d;
  const inc = 5.1454, arg = 318.0634 + 0.1643573223 * d;
  const anomaly = 115.3654 + 13.0649929509 * d;
  const eccentricity = 0.0549, a = 60.2666;
  const M = (anomaly % 360) * DEG;
  let E = M + eccentricity * Math.sin(M) * (1 + eccentricity * Math.cos(M));
  for (let i = 0; i < 4; i++) E -= (E - eccentricity * Math.sin(E) - M) / (1 - eccentricity * Math.cos(E));
  const xv = a * (Math.cos(E) - eccentricity);
  const yv = a * Math.sqrt(1 - eccentricity ** 2) * Math.sin(E);
  const v = Math.atan2(yv, xv) / DEG;
  let radius = Math.hypot(xv, yv);
  const x = radius * (cos(node) * cos(v + arg) - sin(node) * sin(v + arg) * cos(inc));
  const y = radius * (sin(node) * cos(v + arg) + cos(node) * sin(v + arg) * cos(inc));
  const z = radius * sin(v + arg) * sin(inc);
  let longitude = Math.atan2(y, x) / DEG, latitude = Math.atan2(z, Math.hypot(x, y)) / DEG;
  const Ms = 356.0470 + 0.9856002585 * d, ws = 282.9404 + 4.70935e-5 * d;
  const Ls = Ms + ws, Lm = anomaly + arg + node, D = Lm - Ls, F = Lm - node;
  longitude += -1.274 * sin(anomaly - 2 * D) + 0.658 * sin(2 * D) - 0.186 * sin(Ms)
    - 0.059 * sin(2 * anomaly - 2 * D) - 0.057 * sin(anomaly - 2 * D + Ms)
    + 0.053 * sin(anomaly + 2 * D) + 0.046 * sin(2 * D - Ms) + 0.041 * sin(anomaly - Ms)
    - 0.035 * sin(D) - 0.031 * sin(anomaly + Ms) - 0.015 * sin(2 * F - 2 * D) + 0.011 * sin(anomaly - 4 * D);
  latitude += -0.173 * sin(F - 2 * D) - 0.055 * sin(anomaly - F - 2 * D)
    - 0.046 * sin(anomaly + F - 2 * D) + 0.033 * sin(F + 2 * D) + 0.017 * sin(2 * anomaly + F);
  radius += -0.58 * cos(anomaly - 2 * D) - 0.46 * cos(2 * D);
  const eps = (23.4393 - 3.563e-7 * d) * DEG;
  const ec = [radius * cos(longitude) * cos(latitude), radius * sin(longitude) * cos(latitude), radius * sin(latitude)];
  const eq = [ec[0], ec[1] * Math.cos(eps) - ec[2] * Math.sin(eps), ec[1] * Math.sin(eps) + ec[2] * Math.cos(eps)];
  const lat = latDeg * DEG, lst = localSiderealRadians(dateMs, lonDeg);
  // Subtract an oblate-Earth observer before az/el: lunar parallax is close
  // to one degree at the horizon and cannot be ignored for a half-degree disc.
  const geocentricLat = Math.atan(0.99664719 ** 2 * Math.tan(lat));
  const earthRadius = 1 / Math.sqrt(Math.cos(geocentricLat) ** 2 + (Math.sin(geocentricLat) / 0.99664719) ** 2);
  const observerR = earthRadius + altitudeM / 6378137;
  const observer = [observerR * Math.cos(geocentricLat) * Math.cos(lst), observerR * Math.cos(geocentricLat) * Math.sin(lst), observerR * Math.sin(geocentricLat)];
  const topo = eq.map((c, i) => c - observer[i]);
  const distanceKm = Math.hypot(...topo) * 6378.137;
  const q = norm(topo);
  const east = -Math.sin(lst) * q[0] + Math.cos(lst) * q[1];
  const meridian = Math.cos(lst) * q[0] + Math.sin(lst) * q[1];
  const up = Math.cos(lat) * meridian + Math.sin(lat) * q[2];
  const north = -Math.sin(lat) * meridian + Math.cos(lat) * q[2];
  // Solar ecliptic longitude, same low-precision orbital solution.
  const es = 0.016709 - 1.151e-9 * d, ms = (Ms % 360) * DEG;
  const Es = ms + es * Math.sin(ms) * (1 + es * Math.cos(ms));
  const sunLon = Math.atan2(Math.sqrt(1 - es * es) * Math.sin(Es), Math.cos(Es) - es) + ws * DEG;
  const sunEq = [Math.cos(sunLon), Math.sin(sunLon) * Math.cos(eps), Math.sin(sunLon) * Math.sin(eps)];
  const phaseAngle = Math.acos(clamp(-dot(q, sunEq), -1, 1));
  const illuminatedFraction = (1 + Math.cos(phaseAngle)) / 2;
  const phaseBrightness = lunarPhaseBrightness(phaseAngle);
  // Full Moon at mean distance: 0.30 lux above the atmosphere. Direct
  // ground irradiance receives atmospheric attenuation in the light setup.
  const irradianceRatio = 0.30 / SOLAR_ILLUMINANCE_LUX * phaseBrightness * (384400 / distanceKm) ** 2;
  return { dateMs, direction: [east, up, north], elevation: Math.asin(clamp(up, -1, 1)), azimuth: Math.atan2(east, north),
    distanceKm, angularRadius: Math.asin(1737.4 / distanceKm), phaseAngle, illuminatedFraction,
    phaseBrightness, irradianceRatio, siderealRadians: lst, latitudeRadians: lat };
}

export function smoothRange(a, b, v) {
  const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t);
}

// Cheap continuum transmission for stellar extinction, fallback scattering,
// and the directional moon light. The Hillaire atmosphere uses its exact LUT.
export function celestialTransmission(elevationSine, altitudeM = 0) {
  const mu = Math.max(elevationSine, 0);
  const airMass = 1 / (mu + 0.025 * Math.exp(-11 * mu));
  const ray = Math.exp(-Math.max(altitudeM, 0) / 8000);
  const mie = Math.exp(-Math.max(altitudeM, 0) / 1200);
  return [0.0464, 0.1085, 0.2648].map((tau) => Math.exp(-(tau * ray + 0.025 * mie) * airMass));
}
