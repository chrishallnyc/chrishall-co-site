// Authored F-22 body finish: construction panels and surface response are
// independent of pigment. See the reference dossier for photographic sources.
import { F22_BODY_CHARTS } from '../geometry/f22-uv.js';
import { createPaintAtlas } from './coating-baker.js';
import { MAIN_BAYS } from '../geometry/f22-bay-layout.js';
import { GEAR_OPENINGS } from '../geometry/f22-gear-layout.js';
import { SIDE_BAY_OUTLINE } from '../geometry/f22-side-bay-layout.js';
import { mainGearServicePaint } from './f22-service-paint.js';

export function bakeF22Body(options = {}) {
  const { color, orm, relief, path, polygon, surfaceResponse, scuff, serviceTrace, seam, repair, streak, flowMark, fasteners, label, finish } = createPaintAtlas(F22_BODY_CHARTS, options);
  const longitudinal = (x, z) => [z, x];
  const upper = pts => pts.map(([x, z]) => longitudinal(x, z));
  const mirrored = (pts, sign) => upper(pts.map(([x, z]) => [x * sign, z]));

  // Upper two-tone Mod Eagle family pattern: large connected areas with
  // softly sprayed boundaries, interrupted by actual maintenance panels.
  polygon('upper', upper([[-1.9,-3.5],[-1.1,-3.2],[-.45,-2.4],[-.20,-.8],[-.62,1.7],[-1.2,2.6],[-1.83,1.55],[-2.15,-.5]]), '#535e62', { blur: .035 });
  polygon('upper', upper([[1.0,-2.55],[1.95,-1.6],[2.25,.35],[1.90,2.80],[1.0,3.40],[.35,2.1],[.30,.80],[.72,-.8]]), '#545f63', { blur: .040 });
  polygon('upper', upper([[-2.0,3.8],[-1.18,3.1],[-.55,3.95],[.45,4.1],[1.34,4.9],[1.52,6.45],[.25,7.2],[-.95,6.6],[-1.65,5.8]]), '#5c676a', { blur: .032 });
  polygon('upper', upper([[-.64,-6.9],[-.45,-6.0],[-.30,-4.7],[.26,-4.0],[.54,-4.4],[.45,-6.3],[.2,-7.2]]), '#91958e', { blur: .022 });

  // Broad coating fields change their reflection without printing an extra
  // pattern into the pigment. Smooth forebody skin, exposed dorsal covers,
  // and the dry protective coating retain distinct material identities.
  surfaceResponse('upper',upper([[-.67,-7.55],[-.73,-5.8],[-.84,-4.18],
    [.84,-4.18],[.73,-5.8],[.67,-7.55]]),{roughness:.49,metalness:.16,feather:.055});
  for (const sign of [-1,1]) {
    surfaceResponse('upper',mirrored([[.95,-3.75],[1.76,-3.54],[2.04,-1.35],
      [1.91,1.66],[1.56,2.20],[1.17,.57],[.79,-2.42]],sign),
      {roughness:sign>0?.55:.57,metalness:.12,feather:.06});
    surfaceResponse('upper',mirrored([[.20,-.65],[.52,-.39],[.47,2.42],
      [.64,3.98],[.26,4.16],[.12,2.12]],sign),{roughness:.51,metalness:.15,feather:.07,opacity:.66});
  }

  // Maintenance history is authored at service-panel scale. These are
  // coating repairs, not invented structural cuts: most have no dark edge.
  // Each side is intentionally different, as in the refuelling photographs.
  const serviceRepairs = [
    { p:[[.94,-3.72],[1.70,-3.49],[1.84,-3.02],[1.57,-2.73],[1.35,-3.04],[1.00,-3.19]], c:'#a3a79a', a:.52, r:.73 },
    { p:[[-1.86,-3.14],[-1.64,-3.28],[-1.27,-2.82],[-1.34,-2.45],[-1.59,-2.52]], c:'#9caaa8', a:.42, r:.76 },
    { p:[[1.41,-2.13],[1.88,-2.05],[1.99,-1.42],[1.75,-1.34],[1.70,-1.58],[1.44,-1.68]], c:'#969b91', a:.48, r:.65 },
    { p:[[-1.50,-1.50],[-1.18,-1.26],[-.91,-.63],[-1.05,-.46],[-1.33,-.79],[-1.69,-.96]], c:'#a0a49b', a:.46, r:.70 },
    { p:[[.54,-.40],[.83,-.34],[1.14,-.34],[1.40,.21],[1.41,.65],[.60,.60]], c:'#929a95', a:.31, r:.55 },
    { p:[[-.60,.05],[-1.36,-.02],[-1.41,.64],[-1.11,.62],[-.93,.44],[-.63,.50]], c:'#afb0a3', a:.29, r:.76 },
    { p:[[1.24,.83],[1.58,.72],[1.57,1.37],[1.45,1.46],[1.47,1.73],[1.26,1.73]], c:'#a5aba2', a:.52, r:.72 },
    { p:[[-.58,.98],[-1.40,.81],[-1.42,1.84],[-1.23,2.13],[-.59,2.13]], c:'#778080', a:.57, r:.49 },
    { p:[[.56,2.07],[1.27,2.24],[1.46,2.01],[1.53,2.08],[1.29,2.49],[.64,2.36]], c:'#a5a89c', a:.44, r:.76 },
    { p:[[-1.66,2.82],[-1.19,2.75],[-.99,3.11],[-1.19,3.34],[-1.68,3.13]], c:'#929992', a:.47, r:.62 },
    { p:[[.60,3.02],[1.17,2.95],[1.38,3.36],[1.20,3.58],[.62,3.50]], c:'#9fa69f', a:.34, r:.59 },
    { p:[[-.54,3.55],[-1.27,3.43],[-1.45,3.86],[-1.21,4.03],[-.58,3.94]], c:'#a7a99c', a:.31, r:.72 },
    { p:[[.76,3.77],[1.54,3.75],[1.55,4.19],[1.35,4.36],[.70,4.28]], c:'#545e60', a:.30, r:.51 },
    { p:[[-1.33,4.38],[-.74,4.43],[-.71,4.64],[-1.27,4.58]], c:'#afb0a1', a:.44, r:.81 },
    { p:[[.35,4.97],[.65,4.98],[.67,5.44],[.43,5.57],[.35,5.56]], c:'#aaa99a', a:.37, r:.78 },
    { p:[[-1.15,5.14],[-.66,5.14],[-.65,5.57],[-1.02,5.72],[-1.18,5.56]], c:'#92958b', a:.53, r:.67 },
    { p:[[.90,-6.35],[.98,-5.56],[.87,-5.31],[.83,-5.95]], c:'#a1a69c', a:.32, r:.74 },
    { p:[[-.63,-6.70],[-.70,-5.87],[-.57,-5.71],[-.50,-6.46]], c:'#acafa3', a:.27, r:.70 },
  ];
  for (const [i,{p,c,a,r}] of serviceRepairs.entries())
    repair('upper', upper(p), {shade:c,opacity:a,roughness:r,edge:0,
      feather:i%3===0?.033:.016,scuffed:r<.60});

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
  ]) repair('upper', upper(outline), shade.startsWith('#7') ?
    {shade,opacity,roughness:.55,edge:0,feather:.018} : {shade,opacity,roughness:.69,edge:0,feather:.018});

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
    polygon(chart, area, '#818680');
    path(orm, chart, area, { fill: 'rgb(252,201,0)' });
    seam(chart, [[-7.80,t0],[-7.72,t1]], { ram: .015, closed: false, shade: '#949796' });
  }

  for (const sign of [-1, 1]) {
    // Cockpit cheek / forward electronics access; aligned sawtooth returns.
    seam('upper', mirrored([[.70,-7.10],[.78,-6.6],[.88,-5.0],[1.06,-4.35],[1.40,-3.95]], sign), { ram: .047, closed: false });
    seam('upper', mirrored([[.90,-3.54],[1.55,-3.0],[1.83,-1.30],[1.32,-.88],[1.04,-1.10],[.65,-2.35]], sign), { ram: .065, sealContrast:.64 });
    seam('upper', mirrored([[.42,-.55],[.71,-.55],[.88,-.36],[1.18,-.36],[1.54,.20],[1.57,2.03],[1.31,2.42],[1.31,2.66],[.62,2.42],[.40,2.18]], sign), { ram: .048, sealContrast:sign>0?.76:.67 });
    seam('upper', mirrored([[.53,3.0],[1.19,2.88],[1.65,3.54],[1.63,4.36],[1.42,4.51],[1.42,4.72],[.68,4.65],[.52,4.40]], sign), { ram: .055, sealContrast:sign>0?.70:.82 });
    seam('upper', mirrored([[.31,4.92],[1.25,4.97],[1.29,5.61],[1.14,5.81],[.32,5.81]], sign), { ram: .040, shade: '#8a908e' });
    // Long aligned joints near the wing-body shoulder.
    seam('upper', mirrored([[1.89,-2.25],[2.03,-1.18],[2.06,1.42],[1.96,1.62],[1.98,2.92],[1.74,3.40]], sign), { ram: .025, closed: false, sealContrast:.62 });
    // Traffic follows the narrow dorsal access route. Longitudinal scuffs
    // and vent trails stay local instead of dirtying every exposed panel.
    for (let i=0;i<5;i++) {
      const x=sign*(.72+i*.105), z=(sign>0?.83:1.21)+i*.11;
      streak('upper',[z,x],[z+.64+(i%2)*.19,x+sign*.018],{width:.032,strength:.07,roughness:.55});
    }
    for (const z of [.26,4.36]) for (let i=0;i<4;i++) {
      const x=sign*(.88+i*.047);
      streak('upper',[z+.14,x],[z+.58+i*.12,x+sign*.04],{width:.027,strength:.18-i*.025});
    }
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
  surfaceResponse('lower',[[-7.75,t0],[s1,t0],[s1,t1],[-7.75,t1]],
    {roughness:.65,metalness:.035,feather:0});
  for (const outline of MAIN_BAYS) seam('lower', upper(outline), { ram: .034 });
  for (const outline of GEAR_OPENINGS) seam('lower', upper(outline), { ram: .030 });
  seam('lower', upper([[0,-5.10],[0,-3.55]]), { ram: .012, closed: false });
  for (const sign of [-1, 1]) {
    seam('lower', mirrored([[.25,3.35],[1.25,3.35],[1.24,4.63],[1.02,4.93],[.25,4.93]], sign), { ram: .040 });
    seam('lower', mirrored([[.92,-3.53],[1.22,-3.20],[1.29,-1.07],[.89,-1.07]], sign), { ram: .055 });
    repair('lower',mirrored([[.28,.20],[.66,.20],[.66,1.13],[.28,1.13]],sign),
      {shade:sign>0?'#999d93':'#707a7b',opacity:.25,roughness:sign>0?.74:.54,edge:0});
    streak('lower',[2.43,sign*.74],[3.36,sign*.78],{width:.10,strength:.14,roughness:.80});
  }

  for (const chart of ['outer', 'inner']) {
    polygon(chart, [[-7.72,-.9],[8.1,-.9],[8.1,1.3],[-7.72,1.3]], '#858d8c');
    polygon(chart, [[-2.85,-.76],[2.68,-.70],[3.16,-.22],[2.91,.26],[-1.86,.42],[-2.65,.18]], '#6b797c', { blur: .025 });
    surfaceResponse(chart,[[-7.72,-.9],[8.1,-.9],[8.1,1.3],[-7.72,1.3]],
      {roughness:.59,metalness:.08,feather:0});
    // Long side weapon bay has angular RAM returns at both ends.
    seam(chart, SIDE_BAY_OUTLINE, { ram: .038 });
    seam(chart, [[2.09,-.56],[2.39,-.64],[3.25,-.52],[3.57,-.23],[3.41,.02],[2.57,.12],[2.37,-.04]], { ram: .047 });
    seam(chart, [[-7.58,.06],[-7.34,.33],[-6.37,.33],[-6.06,.11],[-6.22,-.14],[-7.25,-.17]], { ram: .035 });
    seam(chart, [[-5.84,-.14],[-5.64,.19],[-4.53,.29],[-4.24,.04],[-4.65,-.31],[-5.53,-.35]], { ram: .037 });
    seam(chart, [[4.0,-.42],[4.33,-.49],[5.28,-.29],[5.59,.11],[5.43,.33],[4.36,.28]], { ram: .030 });
    repair(chart,[[-6.74,.15],[-6.30,.15],[-6.25,-.05],[-6.66,-.10]],
      {shade:'#a4a89b',opacity:.26,roughness:.71,edge:0});
    repair(chart,[[2.48,-.54],[3.18,-.44],[3.33,-.19],[2.66,-.10]],
      {shade:'#9ea39a',opacity:.25,roughness:.75,edge:0});
    streak(chart,[4.86,-.18],[5.75,-.29],{width:.10,strength:.14,roughness:.79});
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
  label('upper',[1.53,-.22],'GROUND HERE',{height:.047,width:.34,color:'#a5aaa2',weight:500});
  label('upper',[4.72,.38],'NO STEP',{height:.048,width:.25,color:'#404d51',weight:500});
  label('lower',[3.48,.73],'CAUTION',{height:.045,width:.24,color:'#626e6b',weight:600});

  // Longitudinal cleaning/scuff response follows the actual narrow service
  // routes. These lines modify reflection only and fade smoothly at both ends.
  for (const sign of [-1,1]) {
    for (let i=0;i<13;i++) {
      const x=sign*(.59+i*.048), z=.14+(i%4)*.25+(sign>0?.13:0);
      scuff('upper',[z,x],[z+.43+(i%3)*.16,x+sign*.008],
        {width:.016+(i%3)*.007,strength:.27+(i%2)*.12,roughness:.44,metalness:.16});
    }
    // Aft access panels acquire a warmer, slightly duller finish around the
    // outlet path. No burn marks are scattered on cool forward surfaces.
    for (let i=0;i<5;i++) {
      const x=sign*(.70+i*.087), z=4.60+(i%2)*.10;
      streak('upper',[z,x],[5.68+(i%3)*.10,x+sign*.05],
        {width:.056+(i%2)*.026,strength:.09,shade:[60,49,38],roughness:.70});
      scuff('upper',[4.88,x+.02*sign],[5.28+(i%2)*.14,x+.02*sign],
        {width:.028,strength:.31,roughness:.49,metalness:.14});
    }
    // Sill contact, dorsal access, and aft skin handling have distinct
    // widths and directions. Keep the canopy clear of painted-on shadows.
    serviceTrace('upper',mirrored([[.58,-6.50],[.68,-5.87],[.73,-4.96],[.67,-4.17]],sign),
      {width:.095,strength:sign>0?.075:.11,roughness:.64,seed:sign*11});
    serviceTrace('upper',mirrored([[.54,-.04],[.64,.64],[.70,1.48],[.83,2.22]],sign),
      {width:.22,strength:.085,roughness:.65,seed:sign*17});
    serviceTrace('upper',mirrored([[.42,4.75],[.75,4.88],[1.18,4.92],[1.28,5.38]],sign),
      {width:.15,strength:.09,roughness:.70,warm:true,seed:sign*23});

    // Lower construction reads through broad, faint service traces around
    // the real gear/bay boundaries. No extra tiny rivet grid is introduced.
    serviceTrace('lower',mirrored([[.37,-4.00],[.41,-3.58],[.45,-3.22]],sign),
      {width:.12,strength:.13,roughness:.74,seed:sign*31});
    serviceTrace('lower',mirrored([[.81,-2.76],[.89,-1.48],[.93,-.23],[.89,.91]],sign),
      {width:.14,strength:.11,roughness:.74,seed:sign*37});
    serviceTrace('lower',mirrored([[.26,2.58],[.52,2.70],[.84,2.66],[1.05,2.86]],sign),
      {width:.17,strength:.12,roughness:.77,warm:true,seed:sign*43});
    serviceTrace('lower',mirrored([[.32,3.58],[.32,4.40],[.48,4.80],[.94,4.91]],sign),
      {width:.115,strength:.09,roughness:.72,warm:true,seed:sign*47});
    streak('lower',[2.86,sign*.91],[4.11,sign*.96],
      {width:.19,strength:.11,shade:[64,61,51],roughness:.78});

    // Aft-access finish is integrated into the surrounding coating with
    // one broad, softly blended touch-up and a few directional outlet marks.
    // The two engine sides have different service histories.
    const aft=sign>0?[[.40,4.85],[.67,4.81],[1.17,4.92],[1.32,5.12],
      [1.24,5.42],[.94,5.48],[.57,5.31],[.39,5.12]]:
      [[.62,5.30],[.94,5.24],[1.17,5.42],[1.27,5.65],[1.06,5.83],[.70,5.73],[.54,5.51]];
    repair('upper',mirrored(aft,sign),{shade:sign>0?'#737b74':'#91958a',
      opacity:sign>0?.37:.29,roughness:sign>0?.54:.72,edge:0,feather:.055});
    for(const [x,z,length,width,strength] of sign>0?
      [[.76,5.75,.79,.23,.17],[1.12,5.56,.63,.14,.13]]:
      [[.65,5.81,.46,.16,.12],[1.19,5.67,.94,.27,.20]])
      flowMark('upper',[z,sign*x],[z+length,sign*(x+.027)],
        {width,strength,roughness:.74,shade:[65,61,51],seed:x*7+sign});
    mainGearServicePaint({repair,serviceTrace,flowMark},'lower',([x,z])=>[z,sign*x],sign);
  }
  flowMark('lower',[-3.56,-.20],[-2.76,-.25],
    {width:.14,strength:.17,roughness:.78,seed:17});
  serviceTrace('upper',upper([[-.17,-.52],[-.24,-.17],[-.26,.32],[-.16,.89]]),
    {width:.10,strength:.09,roughness:.61,seed:71});
  for(const chart of ['outer','inner']) {
    serviceTrace(chart,[[-5.70,.25],[-5.25,.29],[-4.83,.18]],
      {width:.08,strength:chart==='outer'?.12:.075,roughness:.64,seed:81});
    serviceTrace(chart,[[2.30,-.55],[2.91,-.56],[3.32,-.38]],
      {width:.13,strength:.10,roughness:.71,warm:true,seed:91});
  }
  return finish();
}
