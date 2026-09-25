// Cloud rays live in rendered meters; procedural density lives in map meters.
// This adapter consumes the shared PlanetCurvature frame without owning it.
import { Fn, float, vec2, vec3, dot, sqrt, max, min, abs, select } from 'three/tsl';

export function sphereRoots(point, direction, height, origin, radius) {
  const x = point.x - origin.x, z = point.z - origin.y;
  const b = x * direction.x + (radius + point.y) * direction.y + z * direction.z;
  // Difference of squared radii, factored before adding the horizontal term.
  const c = (point.y - height) * (2 * radius + point.y + height) + x * x + z * z;
  const disc = b * b - c;
  if (disc < 0) return { near: 0, far: 0, hit: false };
  const root = Math.sqrt(disc), q = -b - (b >= 0 ? root : -root);
  const other = Math.abs(q) > 1e-8 ? c / q : 0;
  return { near: Math.min(q, other), far: Math.max(q, other), hit: true };
}

// First forward, contiguous shell interval. Far-hemisphere reentry after a
// lower-shell exit is intentionally outside this local cloud integration.
export function shellInterval(point, direction, base, top, origin, radius) {
  const outer = sphereRoots(point, direction, top, origin, radius);
  if (!outer.hit || outer.far <= 0) return { begin: 0, end: 0, hit: false };
  const inner = sphereRoots(point, direction, base, origin, radius);
  let begin = Math.max(outer.near, 0), end = outer.far;
  if (inner.hit && inner.far > begin) {
    if (inner.near > begin) end = Math.min(end, inner.near);
    else begin = Math.max(begin, inner.far);
  }
  return end > begin ? { begin, end, hit: true } : { begin: 0, end: 0, hit: false };
}

// Share one pure function identity across every cloud/projector instance.
// Both frame and radius are explicit inputs, so backend function caching is
// safe across main/probe materials and two source projectors in one shader.
const roots = Fn(([point, direction, height, origin, radius]) => {
  const d = point.xz.sub(origin).toVar();
  const b = dot(vec3(d.x, point.y.add(radius), d.y), direction).toVar();
  const c = point.y.sub(height).mul(point.y.add(height).add(radius.mul(2)))
    .add(dot(d, d)).toVar();
  const discriminant = b.mul(b).sub(c).toVar();
  const root = sqrt(max(discriminant, 0));
  const q = b.negate().sub(select(b.greaterThanEqual(0), root, root.negate())).toVar();
  // Guard both signs before division, even if a backend evaluates both
  // candidates of select. A tangent point with q=0 has both roots at zero.
  const safeQ = select(q.greaterThanEqual(0), max(q, 1e-8), min(q, -1e-8));
  const other = select(abs(q).greaterThan(1e-8), c.div(safeQ), float(0)).toVar();
  return vec3(min(q, other), max(q, other), select(discriminant.greaterThanEqual(0), 1, 0));
}).setLayout({ name: 'cloudSphereRoots', type: 'vec3', inputs: [
  { name: 'point', type: 'vec3' }, { name: 'direction', type: 'vec3' }, { name: 'height', type: 'float' },
  { name: 'origin', type: 'vec2' }, { name: 'radius', type: 'float' },
] });

const shell = Fn(([point, direction, base, top, origin, radius]) => {
  const outer = roots(point, direction, top, origin, radius).toVar();
  const inner = roots(point, direction, base, origin, radius).toVar();
  const begin0 = max(outer.x, 0).toVar();
  const insideInner = inner.z.greaterThan(0).and(inner.y.greaterThan(begin0))
    .and(inner.x.lessThanEqual(begin0));
  const begin = select(insideInner, max(begin0, inner.y), begin0).toVar();
  const lowerExit = inner.z.greaterThan(0).and(inner.x.greaterThan(begin0));
  const end = select(lowerExit, min(outer.y, inner.x), outer.y).toVar();
  const valid = outer.z.greaterThan(0).and(end.greaterThan(begin));
  return select(valid, vec2(begin, end), vec2(0));
}).setLayout({ name: 'cloudShellInterval', type: 'vec2', inputs: [
  { name: 'point', type: 'vec3' }, { name: 'direction', type: 'vec3' },
  { name: 'base', type: 'float' }, { name: 'top', type: 'float' },
  { name: 'origin', type: 'vec2' }, { name: 'radius', type: 'float' },
] });

export function createCloudGeometry(curvature) {
  return {
    roots: (point, direction, height) => roots(point, direction, height, curvature.origin, curvature.radius),
    shell: (point, direction, base, top) => shell(point, direction, base, top, curvature.origin, curvature.radius),
    toMap: (renderedPoint) => curvature.inverseNode(renderedPoint),
    toPrevious: (renderedPoint) => curvature.forwardNode(curvature.inverseNode(renderedPoint), curvature.previousOrigin),
  };
}
