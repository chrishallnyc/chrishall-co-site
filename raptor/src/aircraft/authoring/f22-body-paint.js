// Authored F-22 body finish: construction panels and surface response are
// independent of pigment. See the reference dossier for photographic sources.
import { F22_BODY_CHARTS } from '../geometry/f22-uv.js';
import { createPaintAtlas } from './coating-baker.js';
import { MAIN_BAYS } from '../geometry/f22-bay-layout.js';
import { GEAR_OPENINGS } from '../geometry/f22-gear-layout.js';
import { SIDE_BAY_OUTLINE } from '../geometry/f22-side-bay-layout.js';

export function bakeF22Body(options = {}) {
  const { color, orm, relief, path, polygon, seam, fasteners, label, finish } = createPaintAtlas(F22_BODY_CHARTS, options);
  const longitudinal = (x, z) => [z, x];
  const upper = pts => pts.map(([x, z]) => longitudinal(x, z));
  const mirrored = (pts, sign) => upper(pts.map(([x, z]) => [x * sign, z]));

  // Upper two-tone Mod Eagle family pattern: large connected areas with
  // softly sprayed boundaries, interrupted by actual maintenance panels.
  polygon('upper', upper([[-1.9,-3.5],[-1.1,-3.2],[-.45,-2.4],[-.20,-.8],[-.62,1.7],[-1.2,2.6],[-1.83,1.55],[-2.15,-.5]]), '#56646d', { blur: .065 });
  polygon('upper', upper([[1.0,-2.55],[1.95,-1.6],[2.25,.35],[1.90,2.80],[1.0,3.40],[.35,2.1],[.30,.80],[.72,-.8]]), '#54636c', { blur: .068 });
  polygon('upper', upper([[-2.0,3.8],[-1.18,3.1],[-.55,3.95],[.45,4.1],[1.34,4.9],[1.52,6.45],[.25,7.2],[-.95,6.6],[-1.65,5.8]]), '#5d6c74', { blur: .05 });
  polygon('upper', upper([[-.64,-6.9],[-.45,-6.0],[-.30,-4.7],[.26,-4.0],[.54,-4.4],[.45,-6.3],[.2,-7.2]]), '#8d9291', { blur: .030 });

  // Local coating repairs vary between the two sides. Broad pigment changes
  // are deliberately separate from relief: resealed RAM remains nearly flush.
  for (const [outline, shade, opacity] of [
    [[[.89,-3.38],[1.52,-2.98],[1.65,-2.35],[1.01,-2.73]], '#a0a5a1', .19],
    [[[-1.49,-2.86],[-1.10,-2.52],[-.89,-1.88],[-1.63,-1.24]], '#939c9d', .17],
    [[[.48,-.50],[.81,-.36],[1.15,-.36],[1.43,.18],[1.42,.69],[.53,.61]], '#7c868b', .20],
    [[[-.63,.87],[-1.46,.74],[-1.44,1.87],[-1.26,2.17],[-.55,2.17]], '#9aa19e', .13],
    [[[.70,3.10],[1.14,3.03],[1.43,3.48],[1.38,3.91],[.73,3.88]], '#a0a49f', .12],
    [[[-1.42,4.29],[-.74,4.35],[-.66,4.63],[-1.32,4.56]], '#707f86', .25],
    [[[.42,5.08],[1.10,5.09],[1.13,5.49],[.47,5.58]], '#939c9d', .16],
  ]) polygon('upper', upper(outline), shade, { opacity, blur: .018 });

  // Subtle airflow staining is tied to real dorsal outlets, rather than
  // sprinkling arbitrary grime over the airframe.
  for (const sign of [-1, 1]) for (const z of [.25, 4.35]) {
    polygon('upper', upper([[sign*.88,z+.18],[sign*1.08,z+.18],
      [sign*1.06,z+.78],[sign*.99,z+1.05],[sign*.92,z+.75]]), '#364850', {opacity:.10,blur:.052});
  }

  // Dry radome paint has a warmer, less reflective response than the skin.
  for (const chart of ['upper', 'lower', 'outer', 'inner']) {
    const [, , t0, t1] = F22_BODY_CHARTS[chart].bounds;
    const area = [[-9.5,t0],[-7.80,t0],[-7.72,t1],[-9.5,t1]];
    polygon(chart, area, '#858a89');
    path(orm, chart, area, { fill: 'rgb(252,185,2)' });
    seam(chart, [[-7.80,t0],[-7.72,t1]], { ram: .015, closed: false, shade: '#949796' });
  }

  for (const sign of [-1, 1]) {
    // Cockpit cheek / forward electronics access; aligned sawtooth returns.
    seam('upper', mirrored([[.70,-7.10],[.78,-6.6],[.88,-5.0],[1.06,-4.35],[1.40,-3.95]], sign), { ram: .047, closed: false });
    seam('upper', mirrored([[.90,-3.54],[1.55,-3.0],[1.83,-1.30],[1.32,-.88],[1.04,-1.10],[.65,-2.35]], sign), { ram: .065 });
    seam('upper', mirrored([[.42,-.55],[.71,-.55],[.88,-.36],[1.18,-.36],[1.54,.20],[1.57,2.03],[1.31,2.42],[1.31,2.66],[.62,2.42],[.40,2.18]], sign), { ram: .048 });
    seam('upper', mirrored([[.53,3.0],[1.19,2.88],[1.65,3.54],[1.63,4.36],[1.42,4.51],[1.42,4.72],[.68,4.65],[.52,4.40]], sign), { ram: .055 });
    seam('upper', mirrored([[.31,4.92],[1.25,4.97],[1.29,5.61],[1.14,5.81],[.32,5.81]], sign), { ram: .040, shade: '#8a908e' });
    // Long aligned joints near the wing-body shoulder.
    seam('upper', mirrored([[1.89,-2.25],[2.03,-1.18],[2.06,1.42],[1.96,1.62],[1.98,2.92],[1.74,3.40]], sign), { ram: .025, closed: false });
  }
  // Paired refuelling clamshells, calibrated to the Navy plan view and USAF
  // overhead refuelling photographs. Guide marks sit ahead of this hatch.
  seam('upper', upper([[0,-.02],[.21,.16],[.21,.57],[0,.78],[-.21,.57],[-.21,.16]]), { ram: .026, fill: '#7e888b' });
  seam('upper', upper([[0,-.02],[0,.78]]), { ram: .010, closed: false });
  seam('upper', upper([[-.17,-.64],[-.17,-.94],[.17,-.94],[.17,-.64]]), { ram: 0, closed: false });
  seam('upper', upper([[-.12,1.17],[.12,1.17],[.15,2.78],[-.15,2.78]]), { ram: .02 });

  // Cleaner, lighter underside. Panel layout follows the weapons bays,
  // nose-wheel well and paired main gear, rather than copying the dorsal art.
  const lowerChart = F22_BODY_CHARTS.lower;
  const [s0, s1, t0, t1] = lowerChart.bounds;
  polygon('lower', [[-7.75,t0],[s1,t0],[s1,t1],[-7.75,t1]], '#8d9596');
  for (const outline of MAIN_BAYS) seam('lower', upper(outline), { ram: .034 });
  for (const outline of GEAR_OPENINGS) seam('lower', upper(outline), { ram: .030 });
  seam('lower', upper([[0,-5.10],[0,-3.55]]), { ram: .012, closed: false });
  for (const sign of [-1, 1]) {
    seam('lower', mirrored([[.25,3.35],[1.25,3.35],[1.24,4.63],[1.02,4.93],[.25,4.93]], sign), { ram: .040 });
    seam('lower', mirrored([[.92,-3.53],[1.22,-3.20],[1.29,-1.07],[.89,-1.07]], sign), { ram: .055 });
  }

  for (const chart of ['outer', 'inner']) {
    polygon(chart, [[-7.72,-.9],[8.1,-.9],[8.1,1.3],[-7.72,1.3]], '#858e91');
    polygon(chart, [[-2.85,-.76],[2.68,-.70],[3.16,-.22],[2.91,.26],[-1.86,.42],[-2.65,.18]], '#718087', { blur: .03 });
    // Long side weapon bay has angular RAM returns at both ends.
    seam(chart, SIDE_BAY_OUTLINE, { ram: .038 });
    seam(chart, [[2.09,-.56],[2.39,-.64],[3.25,-.52],[3.57,-.23],[3.41,.02],[2.57,.12],[2.37,-.04]], { ram: .047 });
    seam(chart, [[-7.58,.06],[-7.34,.33],[-6.37,.33],[-6.06,.11],[-6.22,-.14],[-7.25,-.17]], { ram: .035 });
    seam(chart, [[-5.84,-.14],[-5.64,.19],[-4.53,.29],[-4.24,.04],[-4.65,-.31],[-5.53,-.35]], { ram: .037 });
    seam(chart, [[4.0,-.42],[4.33,-.49],[5.28,-.29],[5.59,.11],[5.43,.33],[4.36,.28]], { ram: .030 });
  }

  // Recessed fasteners are restricted to access-panel borders. No blanket
  // rivet grid: a stealth coating deliberately conceals most skin fasteners.
  for (const sign of [-1, 1]) for (let i = 0; i < 9; i++) {
    const z = .12 + i * .21, x = sign * 1.50;
    const pts = upper([[x - .006,z - .006],[x + .006,z - .006],[x + .006,z + .006],[x - .006,z + .006]]);
    path(color, 'upper', pts, { fill: '#646f74' });
    path(relief, 'upper', pts, { fill: '#717171' });
  }
  for (const sign of [-1, 1]) {
    fasteners('upper', mirrored([[.36,5.02],[1.17,5.06],[1.20,5.56],[1.08,5.72],[.37,5.72]], sign), {spacing:.17,size:.005});
    fasteners('upper', mirrored([[.76,-6.82],[.85,-5.15],[1.04,-4.53]], sign), {spacing:.19,size:.004,closed:false});
  }
  label('outer',[-5.36,.29],'RESCUE',{height:.050,width:.22,color:'#a4a48e',weight:700});
  label('outer',[-4.81,-.02],'DANGER',{height:.037,width:.15,color:'#4e5c61',weight:600});
  label('upper',[.38,-.37],'FUEL',{height:.04,width:.13,color:'#56646a',weight:500});
  return finish();
}
