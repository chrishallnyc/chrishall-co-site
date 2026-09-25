// F-22 structural surfaces. Metres, nose -Z, starboard +X.
// Planform landmarks are inferred from the US Navy NAWDC orthographic study
// and checked against USAF photographs; they are not engineering CAD data.
// The central fuselage stays narrow between the intakes. The duct roof,
// sidewall and lower ramp grow from the mouth itself, leaving it truly open.
import * as THREE from 'three';
import { stationSet, lerp, smoothstep } from './interpolation.js';
import { surfacePatch, mirrorSurface } from './patch.js';
import { f22BodyUV } from './f22-uv.js';
import { coatBodyDetail } from './f22-body-coating-uv.js';
import { WING, wingLE, wingTEeff, wingUpperAt } from './f22-planform.js';
import { clipProjectedPolygon } from './clip-polygon.js';
import { MAIN_BAYS } from './f22-bay-layout.js';
import { SIDE_BAY_OUTLINE,SIDE_BAY_AXES } from './f22-side-bay-layout.js';
import { GEAR_OPENINGS, gearFairingY, splitGearSkin } from './f22-gear-layout.js';
import { F22_GEOMETRY_QUALITY, f22Quality } from '../f22-quality.js';

export const F22_DIMENSIONS = Object.freeze({ length: 18.92, span: 13.56 });
export const F22_NOZZLE = Object.freeze({ x: .675, y: -.065, z: 5.885, exit: 1.36 });
export const F22_CANOPY = [
  { z: -7.025, w: 0, top: .755, sill: .755 },
  { z: -6.80, w: .245, top: .910, sill: .715 },
  { z: -6.40, w: .417, top: 1.160, sill: .682 },
  { z: -5.94, w: .510, top: 1.373, sill: .674 },
  { z: -5.51, w: .523, top: 1.447, sill: .695 },
  { z: -5.02, w: .485, top: 1.417, sill: .767 },
  { z: -4.48, w: .359, top: 1.327, sill: .949 },
  { z: -3.81, w: 0, top: 1.206, sill: 1.206 },
];
export const canopySection = stationSet(F22_CANOPY, ['w', 'top', 'sill']);

// Upper width describes the chine ahead of the mouths, then the inner
// boundary of each nacelle roof. Lower width follows the inner intake wall.
const CORE = [
  [-9.460, .003, .003, .008, -.005, .002, .002],
  [-8.936, .270, .270, .276, -.217, .012, .012],
  [-8.487, .435, .435, .395, -.316, .040, .040],
  [-7.799, .600, .600, .533, -.434, .099, .099],
  [-7.025, .720, .720, .755, -.533, .157, .157],
  [-6.400, .772, .772, .766, -.612, .186, .186],
  [-5.868, .810, .780, .770, -.671, .210, -.036],
  [-4.730, .855, .670, 1.078, -.750, .345, -.628],
  [-4.540, .855, .643, 1.129, -.750, .358, -.725],
  [-3.810, .820, .626, 1.206, -.807, .413, -.787],
  [-2.400, .645, .617, .975, -.856, .567, -.817],
  [-1.000, .440, .600, .700, -.868, .670, -.846],
  [ 1.000, .337, .522, .654, -.854, .717, -.840],
  [ 3.300, .260, .290, .575, -.829, .625, -.800],
  [ 4.900, .190, .180, .490, -.710, .580, -.680],
  [ 5.885, .150, .150, .365, -.592, .360, -.565],
  [ 6.750, .150, .150, .136, -.454, .113, -.422],
  [ 7.800, .145, .145, .035, -.145, .010, -.100],
  [ 7.948, .006, .006, -.015, -.095, -.021, -.080],
].map(([z, upperWidth, lowerWidth, crown, belly, upperEdge, lowerEdge]) =>
  ({ z, upperWidth, lowerWidth, crown, belly, upperEdge, lowerEdge }));
const core = stationSet(CORE, ['upperWidth', 'lowerWidth', 'crown', 'belly', 'upperEdge', 'lowerEdge']);

const COWL = [
  [-4.54, 1.24, .285, .98, -.748, .48],
  [-3.79, 1.890, .222, 1.300, -.799, .60],
  [-3.285, 1.952, .211, 1.355, -.799, .72],
  [-2.50, 2.035, .197, 1.386, -.840, .70],
  [-.973, 2.175, .164, 1.371, -.847, .829],
  [ 1.00, 2.326, .248, 1.350, -.812, .769],
  [ 3.30, 2.331, .231, 1.327, -.805, .730],
  [ 4.90, 2.190, .201, 1.300, -.680, .620],
  [ 5.885, 1.950, .159, 1.279, -.565, .480],
].map(([z, upperWidth, upperEdge, lowerWidth, lowerEdge, roof]) =>
  ({ z, upperWidth, upperEdge, lowerWidth, lowerEdge, roof }));
const cowlStations = stationSet(COWL, ['upperWidth', 'upperEdge', 'lowerWidth', 'lowerEdge', 'roof']);
const cowl = z => {
  const s = cowlStations(z);
  // The nacelle shoulder blends into a broad wing-root saddle. Widening this
  // internal join keeps the calibrated outside planform while avoiding the
  // appearance of a separate thin wing laid across a narrow swollen pod.
  s.upperWidth += .23*smoothstep(-1.0,.45,z)*(1-smoothstep(4.35,5.45,z));
  const wingY = wingUpperAt(s.upperWidth, z);
  if (wingY !== null) {
    const x = (s.upperWidth - WING.rootX) / Math.cos(WING.anhedral);
    const blend = smoothstep(wingLE(x), wingLE(x) + .12, z) *
      (1 - smoothstep(wingTEeff(x) - .12, wingTEeff(x), z));
    s.upperEdge = lerp(s.upperEdge, wingY + .001, blend);
  }
  return s;
};

// Lip vertices are deliberately shared by all four exterior/duct patches.
// IT / OT lead the lower ramp, producing the characteristic caret opening.
export const F22_INLET = Object.freeze({
  IT: [.855, .358, -4.540], OT: [1.890, .222, -3.790],
  OB: [1.355, -.799, -3.285], IB: [.626, -.787, -3.810],
});

function centralTop(x, z) {
  const s = core(z), t = Math.min(1, Math.abs(x) / s.upperWidth);
  // Elliptic forward deck changes continuously to the flattened spine.
  const n = lerp(1.58, 2.50, smoothstep(-4.5, -1.0, z));
  const elliptical = s.upperEdge + (s.crown - s.upperEdge) * Math.pow(Math.max(0, 1 - t ** n), 1 / n);
  // Behind the cockpit the centre deck and engine roofs are one continuous
  // shell. An ellipse reaches its edge with a vertical tangent, producing a
  // long false knife-edge even though these patches meet at the same point.
  const deck = lerp(s.crown, s.upperEdge, t * t * (3 - 2 * t));
  return lerp(elliptical, deck, smoothstep(-3.81, -2.45, z));
}

function roofSection(t, z) {
  const a = core(z), b = cowl(z);
  // Raised engine roofs, a central trough and a broad planar outer shoulder.
  // The ridge moves inboard toward the two-dimensional exhausts.
  // The paired engine crowns stay near their actual engine axes. A fixed
  // fraction of the whole inlet-to-wing width put the ridge ~0.5m too far
  // outboard and created two large humps in the front silhouette.
  const ridgeX = .60 + .24 * (1 - smoothstep(-2.50, -1.0, z)) + .075 * smoothstep(3.0, 5.885, z);
  const ridge = Math.max(.035, Math.min(.75, (ridgeX - a.upperWidth) / (b.upperWidth - a.upperWidth)));
  const peak = Math.max(a.upperEdge, b.roof);
  if (t < ridge) return lerp(a.upperEdge, peak, smoothstep(0, ridge, t));
  const q = (t - ridge) / (1 - ridge), q2 = q * q, q3 = q2 * q;
  // Follow the real wing's tangent at the shoulder instead of ending the roof
  // horizontally on a sloped airfoil. The silhouette and seam position stay
  // fixed; only the broad highlight rolling across the join changes.
  const left = wingUpperAt(b.upperWidth - .003, z), right = wingUpperAt(b.upperWidth + .003, z);
  const wingX=(b.upperWidth-WING.rootX)/Math.cos(WING.anhedral);
  const leading=wingLE(wingX),trailing=wingTEeff(wingX);
  // The square-root airfoil has a deliberately vertical leading-edge
  // tangent. Extending that derivative across the entire nacelle inflated a
  // row of tiny spikes when tessellation crossed the wing's leading edge.
  // Match the smooth airfoil shoulder only after that edge has rolled over.
  const edgeBlend=smoothstep(leading+.08,leading+.42,z)*(1-smoothstep(trailing-.18,trailing,z));
  const wingSlope = left !== null && right !== null ? Math.max(-.16,Math.min(.16,(right-left)/.006))*edgeBlend : 0;
  const tangent = wingSlope * (b.upperWidth - a.upperWidth) * (1 - ridge);
  return peak * (2*q3 - 3*q2 + 1) + b.upperEdge * (-2*q3 + 3*q2) + tangent * (q3 - q2);
}

function roofAt(t, z) {
  // Correct the first cross-section to the exact swept lip, keeping the
  // shared inner and outer boundary curves unchanged behind that lip.
  const frontZ = lerp(F22_INLET.IT[2], F22_INLET.OT[2], t);
  const lipY = lerp(F22_INLET.IT[1], F22_INLET.OT[1], t);
  return roofSection(t, z) + (lipY - roofSection(t, frontZ)) * (1 - smoothstep(frontZ, frontZ + 1.15, z));
}

export function airframeTop(x, z) {
  const ax = Math.abs(x), a = core(z);
  if (ax <= a.upperWidth || z < -4.54 || z > 5.885) return centralTop(x, z);
  const b = cowl(z);
  if (ax > b.upperWidth) {
    const wing = wingUpperAt(ax,z);
    if (wing !== null) return wing + .001;
  }
  return roofAt(Math.min(1, (ax - a.upperWidth) / (b.upperWidth - a.upperWidth)), z);
}

export function airframeBottom(x, z) {
  const ax = Math.abs(x), a = core(z);
  if (ax <= a.lowerWidth) {
    const t = ax / a.lowerWidth;
    return lerp(a.belly, a.lowerEdge, lerp(t ** 1.3,
      1 - Math.sqrt(Math.max(0, 1 - t * t)), smoothstep(-4.0, -1.0, z)));
  }
  const b = cowl(z), t = (ax - a.lowerWidth) / (b.lowerWidth - a.lowerWidth);
  return lerp(a.lowerEdge, b.lowerEdge, t) - Math.sin(t * Math.PI) * .045;
}

// Atlas charts reserve upper/lower XZ projections and longitudinal side
// strips independently. Side panels therefore retain area and texel density.
const topUV = f22BodyUV('upper'), lowerUV = f22BodyUV('lower');
const sideUV = f22BodyUV('outer'), innerUV = f22BodyUV('inner');

export function buildAirframeGeometry({ quality = 'high', longitudinal, transverse, cutOpenings = true } = {}) {
  quality = f22Quality(quality);
  const detail = F22_GEOMETRY_QUALITY[quality];
  longitudinal ??= detail.longitudinal;
  transverse ??= detail.transverse;
  const small = quality === 'high' ? 1 : quality === 'medium' ? .6 : .3;
  const surfaces = [];
  const addPair = (name, evaluate, options = {}, material = 'skin') => {
    const colors = options.color ? new Map() : null;
    const key = point => point.map(Math.fround).join(',');
    const sample = colors ? (u,v) => {
      const point=evaluate(u,v);colors.set(key(point),options.color(u,v,point));return point;
    } : evaluate;
    const right = surfacePatch(sample, { uSegments: transverse, vSegments: longitudinal, ...options, name: `${name}R` });
    if(colors) {
      const p=right.attributes.position,values=new Float32Array(p.count*3);
      for(let i=0;i<p.count;i++)values.set(colors.get(key([p.getX(i),p.getY(i),p.getZ(i)])),i*3);
      right.setAttribute('color',new THREE.BufferAttribute(values,3));
    }
    const left = mirrorSurface(right); left.name = `${name}L`;
    // Reflection changes the chart position too. Copying the starboard UVs
    // would duplicate its paint and make every upper marking symmetrical.
    if (options.uv) {
      const p = left.attributes.position, uv = left.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const coords = options.uv(0, 0, [p.getX(i), p.getY(i), p.getZ(i)]);
        uv.setXY(i, coords[0], coords[1]);
      }
    }
    surfaces.push({ name: right.name, geometry: right, material }, { name: left.name, geometry: left, material });
  };
  const zAt = v => lerp(CORE[0].z, CORE.at(-1).z, v);
  for (const [name, front, back, cockpit, segments] of [
    ['noseUpper', CORE[0].z, F22_CANOPY[0].z, false, detail.nose],
    ['cockpitCheek', F22_CANOPY[0].z, F22_CANOPY.at(-1).z, true, detail.cockpit],
    ['spineUpper', F22_CANOPY.at(-1).z, CORE.at(-1).z, false, longitudinal],
  ]) {
    addPair(name, (u, v) => {
      const z = lerp(front, back, v), s = core(z), can = canopySection(z);
      const opening = cockpit ? can.w * 1.02 : 0;
      // Match the nose/spine sample positions exactly where the cockpit
      // opening closes. Linear cheek samples meeting sinusoidal spine samples
      // left real triangular holes although both evaluated the same curve.
      const closure = cockpit ? Math.max(1-smoothstep(front,front+.16,z),smoothstep(back-.20,back,z)) : 1;
      const t = lerp(u,Math.sin(u*Math.PI/2),closure);
      const x = lerp(opening, s.upperWidth, t);
      let y = centralTop(x, z);
      if (cockpit) y += (can.sill - centralTop(opening, z)) * (1 - t) ** 2;
      return [x, y, z];
    }, { reverse: true, vSegments: segments, uv: topUV });
  }
  addPair('cockpitWell', (u, v) => {
    const z = lerp(F22_CANOPY[0].z, F22_CANOPY.at(-1).z, v), c = canopySection(z);
    return [c.w * lerp(1.005, .80, u), lerp(c.sill - .018, .33, u), z];
  }, { uSegments: 1, vSegments: detail.cockpit, uv: innerUV }, 'duct');
  addPair('forebodyFlank', (u, v) => {
    const z = zAt(v), s = core(z);
    return [lerp(s.upperWidth, s.lowerWidth, u), lerp(s.upperEdge, s.lowerEdge, u), z];
  }, { reverse: true, uSegments: quality === 'high' ? 3 : 1, uv: innerUV });
  addPair('keel', (u, v) => {
    const z = zAt(v), s = core(z), t = Math.sin(u * Math.PI / 2);
    const y = lerp(s.belly, s.lowerEdge, lerp(t ** 1.3,
      1 - Math.sqrt(Math.max(0, 1 - t * t)), smoothstep(-4.0, -1.0, z)));
    return [s.lowerWidth * t, y, z];
  }, { uv: lowerUV });

  addPair('engineRoof', (u, v) => {
    const z0 = lerp(F22_INLET.IT[2], F22_INLET.OT[2], u), z = lerp(z0, F22_NOZZLE.z, v);
    const a = core(z), b = cowl(z);
    const lipX = lerp(F22_INLET.IT[0], F22_INLET.OT[0], u);
    const atLip = lerp(core(z0).upperWidth, cowl(z0).upperWidth, u);
    const x = lerp(a.upperWidth, b.upperWidth, u) + (lipX - atLip) * (1 - smoothstep(z0, z0 + 1.0, z));
    return [x, roofAt(u, z), z];
  }, { reverse: true, uv: topUV });
  addPair('intakeOuterWall', (u, v) => {
    const lip = F22_INLET.OT.map((value, i) => lerp(value, F22_INLET.OB[i], u));
    const z = lerp(lip[2], F22_NOZZLE.z, v), s = cowl(z);
    const atLip = cowl(lip[2]), correction = 1 - smoothstep(lip[2], lip[2] + 1.15, z);
    return [lerp(s.upperWidth, s.lowerWidth, u) + (lip[0] - lerp(atLip.upperWidth, atLip.lowerWidth, u)) * correction,
      lerp(s.upperEdge, s.lowerEdge, u) + (lip[1] - lerp(atLip.upperEdge, atLip.lowerEdge, u)) * correction, z];
  }, { reverse: true, uSegments: Math.max(2, Math.round(6*small)), uv: sideUV });
  addPair('intakeLowerRamp', (u, v) => {
    const lip = F22_INLET.IB.map((value, i) => lerp(value, F22_INLET.OB[i], u));
    const z = lerp(lip[2], F22_NOZZLE.z, v), a = core(z), b = cowl(z);
    const a0 = core(lip[2]), b0 = cowl(lip[2]);
    const correction = 1 - smoothstep(lip[2], lip[2] + 1.15, z);
    return [lerp(a.lowerWidth, b.lowerWidth, u) + (lip[0] - lerp(a0.lowerWidth, b0.lowerWidth, u)) * correction,
      lerp(a.lowerEdge, b.lowerEdge, u) + (lip[1] - lerp(a0.lowerEdge, b0.lowerEdge, u)) * correction -
        Math.sin(u * Math.PI) * .045 * (1 - correction), z];
  }, { uv: lowerUV });

  const corners = [F22_INLET.IT, F22_INLET.OT, F22_INLET.OB, F22_INLET.IB];
  const centre = corners.reduce((sum, p) => sum.map((v, i) => v + p[i] / 4), [0, 0, 0]);
  // The outside landmarks remain the calibrated caret. Its inner reveal has
  // gently rounded corners, as opposed to four infinitely sharp plates.
  const insetCorner = corner => corner.map((value, i) =>
    i === 2 ? value + .034 : centre[i] + (value - centre[i]) * .962);
  const innerCorners = corners.map(insetCorner);
  const innerRim = (edge, u) => {
    const a = innerCorners[edge], b = innerCorners[(edge + 1) % 4];
    const previous = innerCorners[(edge + 3) % 4], next = innerCorners[(edge + 2) % 4];
    const radius = .026;
    if (u < radius) {
      const t = .5 + .5 * u / radius;
      const start = a.map((value,i)=>lerp(value,previous[i],radius));
      const end = a.map((value,i)=>lerp(value,b[i],radius));
      return start.map((value,i)=>(1-t)**2*value+2*(1-t)*t*a[i]+t*t*end[i]);
    }
    if (u > 1-radius) {
      const t = .5 * (u - (1-radius)) / radius;
      const start = b.map((value,i)=>lerp(value,a[i],radius));
      const end = b.map((value,i)=>lerp(value,next[i],radius));
      return start.map((value,i)=>(1-t)**2*value+2*(1-t)*t*b[i]+t*t*end[i]);
    }
    return a.map((value,i)=>lerp(value,b[i],u));
  };
  for (let edge = 0; edge < 4; edge++) {
    const a = corners[edge], b = corners[(edge + 1) % 4];
    const rim = u => a.map((value, i) => lerp(value, b[i], u));
    addPair(`intakeLip${edge}`, (u, v) => {
      const p = rim(u), inside = innerRim(edge,u), turn = v * Math.PI;
      return [lerp(p[0], inside[0], (1-Math.cos(turn))*.5),
        lerp(p[1], inside[1], (1-Math.cos(turn))*.5), lerp(p[2], inside[2], v)-.018*Math.sin(turn)];
    }, { uSegments: Math.max(12, Math.round(44*small)), vSegments: quality === 'low' ? 3 : 6, uv: sideUV }, 'lip');
    addPair(`intakeDuct${edge}`, (u, v) => {
      const p = innerRim(edge,u), shrink = lerp(1, .64/.962, smoothstep(0,1,v));
      return [centre[0] + (p[0] - centre[0]) * shrink - .38 * v * v,
        centre[1] + (p[1] - centre[1]) * shrink + .22 * v * v,
        p[2] + 2.441 * v];
    }, { uSegments: Math.max(12, Math.round(44*small)), vSegments: Math.max(8, Math.round(24*small)), uv: innerUV,
      color: (u,v) => {const attenuation=.025+.975*Math.exp(-v*7.5);return[.085*attenuation,.099*attenuation,.111*attenuation];} }, 'duct');
  }
  // Recessed return of the S-duct: the compressor face is intentionally
  // occluded, as on the aircraft, rather than visible through an empty tube.
  const end = corners.map(p => [centre[0] + (p[0] - centre[0]) * .64 - .38,
    centre[1] + (p[1] - centre[1]) * .64 + .22, p[2] + 2.475]);
  addPair('intakeReturn', (u, v) => {
    const upper = end[0].map((value, i) => lerp(value, end[1][i], u));
    const lower = end[3].map((value, i) => lerp(value, end[2][i], u));
    return upper.map((value, i) => lerp(value, lower[i], v));
  }, { uSegments: 1, vSegments: 1, uv: innerUV }, 'duct');
  // Cavity depth must remain readable without an emissive fake or a visible
  // compressor. This low-frequency absorption is tied to physical depth;
  // direct light still shades the reveal, while the hidden bend falls dark.
  for (const surface of surfaces) if (surface.material === 'duct' && !surface.geometry.attributes.color) {
    const p = surface.geometry.attributes.position, colors = new Float32Array(p.count*3);
    const cavity = new THREE.Color();
    for (let i=0;i<p.count;i++) {
      const depth = surface.name.startsWith('intakeDuct') ? smoothstep(-3.65,-1.30,p.getZ(i)) : 1;
      cavity.setRGB(.105,.117,.128).multiplyScalar(lerp(1,.025,depth));
      colors.set([cavity.r,cavity.g,cavity.b],i*3);
    }
    surface.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  }
  // Different patch tessellations must not create different normals on a
  // shared smooth boundary. Sample the common height field, leaving the nose
  // chine, duct lip and all other deliberate hard boundaries untouched.
  for (const surface of surfaces) if (/^(spineUpper|engineRoof)/.test(surface.name)) {
    const p=surface.geometry.attributes.position,n=surface.geometry.attributes.normal;
    const h=.002;
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i),z=p.getZ(i),blend=smoothstep(-2.6,-2.3,z)*(1-smoothstep(5.83,5.885,z));
      if(blend===0)continue;
      const nx=-(airframeTop(x+h,z)-airframeTop(x-h,z))/(2*h);
      const nz=-(airframeTop(x,z+h)-airframeTop(x,z-h))/(2*h),length=Math.hypot(nx,1,nz);
      const a=lerp(n.getX(i),nx/length,blend),b=lerp(n.getY(i),1/length,blend),c=lerp(n.getZ(i),nz/length,blend);
      const unit=Math.hypot(a,b,c);n.setXYZ(i,a/unit,b/unit,c/unit);
    }
  }
  for (const surface of surfaces) if (/^intakeOuterWall/.test(surface.name)) {
    const refined=splitGearSkin(surface.geometry);surface.geometry.dispose();surface.geometry=refined;
    const p = surface.geometry.attributes.position;
    for (let i=0;i<p.count;i++) p.setY(i,gearFairingY(p.getX(i),p.getY(i),p.getZ(i)));
    surface.geometry.computeVertexNormals();
  }
  for (const surface of surfaces) if (cutOpenings && /^(keel|intakeLowerRamp|forebodyFlank|intakeOuterWall)/.test(surface.name)) {
    for (const outline of GEAR_OPENINGS) {
      const clipped=clipProjectedPolygon(surface.geometry,outline);
      surface.geometry.dispose();surface.geometry=clipped;
    }
  }
  for (const surface of surfaces) if (cutOpenings && /^intakeOuterWall/.test(surface.name)) {
    const clipped=clipProjectedPolygon(surface.geometry,SIDE_BAY_OUTLINE,{axes:SIDE_BAY_AXES});
    surface.geometry.dispose();surface.geometry=clipped;
  }
  // These are real skin openings. Exact clipping retains the authored UVs
  // and removes the hidden internal core walls crossing the weapon bays.
  for (const surface of surfaces) if (cutOpenings && /^(keel|intakeLowerRamp|forebodyFlank)/.test(surface.name)) {
    for (const outline of MAIN_BAYS) {
      const clipped = clipProjectedPolygon(surface.geometry, outline);
      surface.geometry.dispose(); surface.geometry = clipped;
    }
  }
  for (const surface of surfaces) coatBodyDetail(surface.geometry);
  return surfaces;
}
