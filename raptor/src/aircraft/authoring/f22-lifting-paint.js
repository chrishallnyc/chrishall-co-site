import { createPaintAtlas } from './coating-baker.js';
import { F22_LIFTING_CHARTS } from '../geometry/f22-uv.js';
import { WING, TAIL, FIN, wingLE, wingTEeff, stabLE, stabTE, finLE, finTE, finHinge } from '../geometry/f22-planform.js';
import { MAIN_GEAR_RIGHT } from '../geometry/f22-gear-layout.js';
import { mainGearServicePaint } from './f22-service-paint.js';

const points = coordinates => coordinates.map(([span, chord]) => [chord, span]);

export function bakeF22Lifting(options = {}) {
  const { polygon, surfaceResponse, scuff, serviceTrace, seam, repair, streak, flowMark, fasteners, label, finish } = createPaintAtlas(F22_LIFTING_CHARTS, options);
  for (const chart of ['wingUpper', 'wingUpperLeft', 'wingLower', 'wingLowerLeft']) {
    const left = chart.endsWith('Left'), top = chart.includes('Upper');
    if (top) {
      polygon(chart, points([[0,-.55],[.64,.2],[1.35,1.15],[2.62,1.93],[3.68,3.16],[3.76,4.29],[2.86,4.61],[1.62,4.02],[.67,3.83],[0,2.92]]), '#536065', { blur: .037 });
      polygon(chart, points([[2.45,2.37],[3.05,2.58],[3.34,3.13],[3.89,3.37],[4.40,3.80],[4.0,4.22],[3.36,3.85],[2.96,3.49]]), '#667477', { blur: .029 });
      const patches = left ? [
        {p:[[.05,.19],[.37,.53],[.39,1.02],[.17,1.22],[.04,.93]],a:.48,r:.71},
        {p:[[.52,1.06],[1.15,1.55],[1.28,1.96],[.85,1.92],[.72,1.57],[.46,1.49]],a:.39,r:.76},
        {p:[[1.72,2.35],[2.21,2.69],[2.23,3.18],[1.91,3.10],[1.77,2.88]],a:.26,r:.53},
        {p:[[2.53,3.64],[3.01,3.81],[3.12,4.17],[2.66,4.32],[2.46,4.06]],a:.42,r:.72},
        {p:[[.16,3.19],[.43,3.26],[.57,3.55],[.38,3.78],[.17,3.63]],a:.40,r:.66},
      ] : [
        {p:[[.08,.06],[.38,.41],[.41,.79],[.23,.87],[.05,.58]],a:.30,r:.59},
        {p:[[.88,1.42],[1.44,1.81],[1.46,2.23],[1.15,2.32],[.98,1.97],[.79,1.92]],a:.44,r:.74},
        {p:[[2.25,2.94],[2.70,3.25],[2.71,3.64],[2.39,3.58],[2.19,3.31]],a:.36,r:.69},
        {p:[[3.29,3.75],[3.63,3.83],[3.79,4.02],[3.59,4.22],[3.29,4.15]],a:.40,r:.77},
        {p:[[.42,3.42],[.80,3.54],[.86,3.96],[.50,3.85]],a:.26,r:.51},
      ];
      for (const [i,{p,a,r}] of patches.entries()) repair(chart,points(p),
        {shade:r<.60?'#748284':'#a2a89b',opacity:a,roughness:r,edge:0,
          feather:i%2?.022:.013,scuffed:r<.60});
      // The near-root service path is cleaned and scuffed; outboard panels
      // retain their finish. These are small trails, not all-over weathering.
      for (let i=0;i<4;i++) {
        const span=.23+i*.08, z=1.0+(left?.3:0)+i*.21;
        streak(chart,[z,span],[z+.54,span+.025],{width:.024,strength:.07,roughness:.51});
      }
    } else {
      polygon(chart, [[-1.4,0],[6.4,0],[6.4,4.96],[-1.4,4.96]], '#8d9596');
      surfaceResponse(chart,[[-1.4,0],[6.4,0],[6.4,4.96],[-1.4,4.96]],
        {roughness:.66,metalness:.03,feather:0});
      seam(chart, points(MAIN_GEAR_RIGHT.map(([x,z])=>[(x-WING.rootX)/Math.cos(WING.anhedral),z])), {ram:.030});
    }
    const leading = [[0,wingLE(0)],[WING.span,wingLE(WING.span)]];
    seam(chart, points(leading), { ram: .145, shade: '#a2a89e', closed: false });
    seam(chart, points([[.12,wingLE(.12)+.27],[4.70,wingLE(4.70)+.17]]), { ram: .032, closed: false });
    // Exposed leading-edge flap and paired outboard trailing-edge panels.
    seam(chart, points([[.11,wingLE(.11)+.57],[4.44,wingLE(4.44)+.34]]), { ram: .034, closed: false });
    for (const x of [.65,2.15,3.77]) {
      seam(chart, points([[x,wingLE(x)+.16],[x,wingLE(x)+.48]]), { ram: .02, closed: false });
    }
    seam(chart, points([[.03,wingTEeff(.03)-WING.flapDepth],[WING.flapSpan,wingTEeff(WING.flapSpan)-WING.flapDepth]]), { ram: .065, closed: false });
    seam(chart, points([[2.1,wingTEeff(2.1)-WING.flapDepth],[2.1,wingTEeff(2.1)]]), { ram: .022, closed: false });
    for (const [a,b] of [[.55,1.19],[1.43,2.12],[2.38,3.05]]) {
      seam(chart, points([[a,wingLE(a)+.89],[b,wingLE(b)+.88],[b+.09,wingTEeff(b)-1.07],
        [b-.05,wingTEeff(b)-.94],[a+.10,wingTEeff(a)-.95],[a,wingTEeff(a)-1.12]]),
        { ram: .027, sealContrast:top?(a<1?.67:a>2?.74:.83):1 });
      const x=(a+b)/2, z=wingTEeff(x)-1.45;
      seam(chart, points([[x-.065,z-.08],[x+.065,z-.08],[x+.065,z+.08],[x-.065,z+.08]]), { ram: .013 });
      label(chart, [wingTEeff(x)-1.1,x], 'NO STEP', { height: .040, width: .21, color:'#717c80', weight:500 });
      if (top && ((left && a<1) || (!left && a>2)))
        fasteners(chart,points([[a+.06,wingLE(a)+.96],[b-.04,wingLE(b)+.96]]),{spacing:.16,size:.005,closed:false});
    }
    seam(chart, points([[3.27,3.58],[3.36,4.04],[3.90,4.09],[4.01,3.76]]), { ram: .018 });
    if(top) {
      surfaceResponse(chart,points([[.07,.39],[.34,.69],[.48,1.82],[.53,3.42],
        [.31,3.78],[.08,3.34]]),{roughness:.49,metalness:.13,opacity:.55,feather:.07});
      for(let i=0;i<8;i++) {
        const span=.17+i*.045,z=1.05+(i%3)*.19+(left?.3:0);
        scuff(chart,[z,span],[z+.47+(i%2)*.18,span+.009],
          {width:.018,strength:.31,roughness:.45,metalness:.14});
      }
      serviceTrace(chart,points([[.14,1.22],[.23,1.84],[.28,2.51],[.36,3.23]]),
        {width:.19,strength:left?.085:.11,roughness:.67,seed:left?13:29});
      const a=left?.41:1.43,b=left?1.33:2.25;
      serviceTrace(chart,points([[a,wingTEeff(a)-WING.flapDepth-.055],
        [(a+b)/2,wingTEeff((a+b)/2)-WING.flapDepth-.055],
        [b,wingTEeff(b)-WING.flapDepth-.055]]),
        {width:.08,strength:.08,roughness:.70,seed:left?31:43});
    } else {
      serviceTrace(chart,points([[.19,2.21],[.47,2.36],[.73,2.35]]),
        {width:.13,strength:left?.09:.12,roughness:.76,warm:true,seed:left?53:61});
      mainGearServicePaint({repair,serviceTrace,flowMark},chart,
        ([x,z])=>[z,(x-WING.rootX)/Math.cos(WING.anhedral)],left?-1:1);
    }

  }

  for (const chart of ['tailUpper','tailUpperLeft','tailLower','tailLowerLeft']) {
    const left=chart.endsWith('Left'),top=chart.includes('Upper');
    if(top) polygon(chart, points([[.25,-.10],[1.32,-1.12],[1.93,-.87],[2.91,.06],[2.81,.72],[1.87,1.18],[.73,.45]]), '#58686d', {blur:.028});
    else {
      polygon(chart,[[-1.8,0],[1.6,0],[1.6,3.28],[-1.8,3.28]],'#8d9596');
      surfaceResponse(chart,[[-1.8,0],[1.6,0],[1.6,3.28],[-1.8,3.28]],
        {roughness:.65,metalness:.035,feather:0});
    }
    seam(chart,points([[0,0],TAIL.leadingKnee,[TAIL.span,TAIL.tipLE]]),{ram:.10,closed:false,shade:'#8b9393'});
    seam(chart,points([[.20,stabLE(.20)+.13],[1.74,stabLE(1.74)+.16],[3.12,stabLE(3.12)+.14]]),{ram:.027,closed:false});
    seam(chart,points([[.77,-.43],[1.50,-1.11],[1.69,-.95],[1.68,1.24],[1.39,1.10],[.77,.47]]),{ram:.037});
    seam(chart,points([[1.96,-1.05],[2.02,.99],[2.26,stabTE(2.26)-.08]]),{ram:.022,closed:false});
    if(top) {
      const patch=left?[[.86,-.35],[1.15,-.58],[1.37,-.44],[1.37,.46],[1.10,.48],[.91,.17]]:
        [[1.83,-.62],[2.12,-.48],[2.31,-.21],[2.22,.24],[1.91,.19]];
      repair(chart,points(patch),{shade:left?'#9ea79f':'#a7aaa0',opacity:left?.35:.43,roughness:left?.57:.72,edge:0});
      streak(chart,[.17,left?1.05:2.05],[.70,left?1.10:2.09],{width:.045,strength:.075});
      serviceTrace(chart,points([[.23,.10],[.34,.51],[.48,.87]]),
        {width:.13,strength:left?.07:.095,roughness:.69,warm:true,seed:left?71:89});
    }
    label(chart,[.71,1.58],'NO STEP',{height:.043,width:.23,color:'#737e82',weight:500});
  }

  for(const chart of ['finPositive','finNegative','finInnerPositive','finInnerNegative']) {
    polygon(chart,points([[.18,3.99],[.92,4.58],[2.47,5.26],[2.78,5.72],[1.33,6.18],[.42,5.63]]),'#59696e',{blur:.027});
    seam(chart,points([[0,FIN.rootLE],[FIN.span,FIN.tipLE]]),{ram:.15,closed:false,shade:'#8e9593'});
    seam(chart,points([[.2,finLE(.2)+.18],[2.98,finLE(2.98)+.15]]),{ram:.030,closed:false});
    seam(chart,points([[0,FIN.hingeRoot],[FIN.span,FIN.hingeTip]]),{ram:.036,closed:false});
    seam(chart,points([[.14,finLE(.14)+.45],[.17,finHinge(.17)-.13],[2.93,finHinge(2.93)-.13],[2.93,finLE(2.93)+.25]]),{ram:.025});
    seam(chart,points([[3.01,finLE(3.01)],[3.01,finTE(3.01)]]),{ram:.070,closed:false,shade:'#899397'});
    const positive=chart.includes('Positive');
    repair(chart,points(positive?[[.26,4.47],[.58,4.66],[.63,5.45],[.30,5.61]]:
      [[.69,4.75],[.96,4.88],[1.05,5.71],[.73,5.84]]),
      {shade:'#a3a89b',opacity:chart.includes('Inner')?.24:.33,roughness:positive?.70:.56,edge:0});
    streak(chart,[6.31,positive?.43:.77],[6.83,positive?.49:.83],{width:.038,strength:.085});
    // The inboard faces are unmarked in the USAF photographic references.
    if (chart.includes('Inner')) continue;
    // Face-specific UV orientation preserves readable letters on both fins.
    label(chart,[5.61,1.86],'FF',{height:.53,width:.62,color:'#455660',weight:700});
    label(chart,[5.70,1.35],'AF 10',{height:.16,width:.40,color:'#4b5b65',weight:600});
    label(chart,[5.76,1.02],'4191',{height:.29,width:.49,color:'#455660',weight:600});
    label(chart,[5.81,.68],'1ST FIGHTER WING',{height:.055,width:.70,color:'#5c6b73',weight:600});
  }
  return finish();
}
