// Planet occultation at the actual receiver. Cached shader helpers contain
// only explicit arguments: no frame/source uniforms may hide in a closure.
import { Fn, vec2, vec3, float, dot, sqrt, max, normalize, asin, sin, exp } from "three/tsl";

export const SOLAR_ANGULAR_RADIUS = 0.2665 * Math.PI / 180;

// Returns [local elevation sine, geometric horizon sine, altitude meters].
// Factor r²−R² before subtracting large Earth-sized values. This preserves
// centimeter/meter receiver heights in float32 near the curved sea surface.
export const receiverCelestialGeometry = Fn(([point, direction, origin, radius]) => {
  const d = point.xz.sub(origin).toVar();
  const c = point.y.mul(point.y.add(radius.mul(2))).add(dot(d, d)).toVar();
  const r = sqrt(max(radius.mul(radius).add(c), 1)).toVar();
  const mu = dot(vec3(d.x, point.y.add(radius), d.y), direction).div(r).toVar();
  const horizon = sqrt(max(c, 0)).div(r).negate();
  const altitude = max(c.div(r.add(radius)), 0);
  return vec3(mu, horizon, altitude);
}).setLayout({ name: "receiverCelestialGeometry", type: "vec3", inputs: [
  { name: "point", type: "vec3" }, { name: "direction", type: "vec3" },
  { name: "origin", type: "vec2" }, { name: "radius", type: "float" },
] });

// Uniform circular-disc area above a locally straight limb. The small-angle
// projected-radius approximation is appropriate to ~0.5° Sun/Moon discs.
// No refraction or lunar terminator weighting is introduced here.
export const finiteDiscVisibility = Fn(([geometry, angularRadius]) => {
  const cosine = sqrt(max(float(1).sub(geometry.y.mul(geometry.y)), 1e-8));
  const q = geometry.x.sub(geometry.y).div(max(sin(angularRadius).mul(cosine), 1e-8)).clamp(-1, 1).toVar();
  return asin(q).add(q.mul(sqrt(max(float(1).sub(q.mul(q)), 0)))).div(Math.PI).add(.5);
}).setLayout({ name: "finiteDiscVisibility", type: "float", inputs: [
  { name: "geometry", type: "vec3" }, { name: "angularRadius", type: "float" },
] });

// Existing Moon continuum-extinction recipe, moved from the flight camera
// to the surface. Replacing it with LUT transport is a separate calibration.
export const receiverLunarTransmission = Fn(([geometry]) => {
  const mu = max(geometry.x, 0);
  const airMass = float(1).div(mu.add(exp(mu.mul(-11)).mul(.025)));
  const ray = exp(geometry.z.div(-8000)), mie = exp(geometry.z.div(-1200));
  return exp(vec3(.0464, .1085, .2648).mul(ray).add(mie.mul(.025)).mul(airMass).negate());
}).setLayout({ name: "receiverLunarTransmission", type: "vec3", inputs: [
  { name: "geometry", type: "vec3" },
] });

export function surfaceCelestialTransport({ direction, angularRadius = SOLAR_ANGULAR_RADIUS,
  curvature = null, lunarTransmission = false }) {
  // This wrapper stays inline; all source/frame nodes become helper args.
  return Fn(([point]) => {
    const p = curvature ? point : vec3(0, point.y, 0);
    const origin = curvature ? curvature.origin : vec2(0);
    const geometry = receiverCelestialGeometry(p, normalize(direction), origin, curvature?.radius || 6360000).toVar();
    const visible = finiteDiscVisibility(geometry, angularRadius);
    return lunarTransmission ? receiverLunarTransmission(geometry).mul(visible) : vec3(visible);
  });
}
