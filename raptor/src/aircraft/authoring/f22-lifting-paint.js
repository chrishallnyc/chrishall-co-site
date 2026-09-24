import { createPaintAtlas } from './coating-baker.js';
import { F22_LIFTING_CHARTS } from '../geometry/f22-uv.js';
import { WING, TAIL, FIN, wingLE, wingTEeff, stabLE, stabTE, finLE, finTE, finHinge } from '../geometry/f22-planform.js';
import { MAIN_GEAR_RIGHT } from '../geometry/f22-gear-layout.js';

const points = coordinates => coordinates.map(([span, chord]) => [chord, span]);

export function bakeF22Lifting(options = {}) {
  const { polygon, seam, label, finish } = createPaintAtlas(F22_LIFTING_CHARTS, options);
  for (const chart of ['wingUpper', 'wingLower']) {
    if (chart === 'wingUpper') {
      polygon(chart, points([[0,-.55],[.64,.2],[1.35,1.15],[2.62,1.93],[3.68,3.16],[3.76,4.29],[2.86,4.61],[1.62,4.02],[.67,3.83],[0,2.92]]), '#56666f', { blur: .070 });
      polygon(chart, points([[2.45,2.37],[3.05,2.58],[3.34,3.13],[3.89,3.37],[4.40,3.80],[4.0,4.22],[3.36,3.85],[2.96,3.49]]), '#647780', { blur: .040 });
    } else {
      polygon(chart, [[-1.4,0],[6.4,0],[6.4,4.96],[-1.4,4.96]], '#8d9596');
      seam(chart, points(MAIN_GEAR_RIGHT.map(([x,z])=>[(x-WING.rootX)/Math.cos(WING.anhedral),z])), {ram:.030});
    }
    const leading = [[0,wingLE(0)],[WING.span,wingLE(WING.span)]];
    seam(chart, points(leading), { ram: .145, shade: '#8b9393', closed: false });
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
        [b-.05,wingTEeff(b)-.94],[a+.10,wingTEeff(a)-.95],[a,wingTEeff(a)-1.12]]), { ram: .027 });
      const x=(a+b)/2, z=wingTEeff(x)-1.45;
      seam(chart, points([[x-.065,z-.08],[x+.065,z-.08],[x+.065,z+.08],[x-.065,z+.08]]), { ram: .013 });
      label(chart, [wingTEeff(x)-1.1,x], 'NO STEP', { height: .040, width: .21, color:'#717c80', weight:500 });
    }
    seam(chart, points([[3.27,3.58],[3.36,4.04],[3.90,4.09],[4.01,3.76]]), { ram: .018 });

  }

  for (const chart of ['tailUpper','tailLower']) {
    if(chart==='tailUpper') polygon(chart, points([[.25,-.10],[1.32,-1.12],[1.93,-.87],[2.91,.06],[2.81,.72],[1.87,1.18],[.73,.45]]), '#586a74', {blur:.045});
    else polygon(chart,[[-1.8,0],[1.6,0],[1.6,3.28],[-1.8,3.28]],'#8d9596');
    seam(chart,points([[0,0],TAIL.leadingKnee,[TAIL.span,TAIL.tipLE]]),{ram:.10,closed:false,shade:'#8b9393'});
    seam(chart,points([[.20,stabLE(.20)+.13],[1.74,stabLE(1.74)+.16],[3.12,stabLE(3.12)+.14]]),{ram:.027,closed:false});
    seam(chart,points([[.77,-.43],[1.50,-1.11],[1.69,-.95],[1.68,1.24],[1.39,1.10],[.77,.47]]),{ram:.037});
    seam(chart,points([[1.96,-1.05],[2.02,.99],[2.26,stabTE(2.26)-.08]]),{ram:.022,closed:false});
    label(chart,[.71,1.58],'NO STEP',{height:.043,width:.23,color:'#737e82',weight:500});
  }

  for(const chart of ['finPositive','finNegative','finInnerPositive','finInnerNegative']) {
    polygon(chart,points([[.18,3.99],[.92,4.58],[2.47,5.26],[2.78,5.72],[1.33,6.18],[.42,5.63]]),'#5a6d77',{blur:.045});
    seam(chart,points([[0,FIN.rootLE],[FIN.span,FIN.tipLE]]),{ram:.15,closed:false,shade:'#8e9593'});
    seam(chart,points([[.2,finLE(.2)+.18],[2.98,finLE(2.98)+.15]]),{ram:.030,closed:false});
    seam(chart,points([[0,FIN.hingeRoot],[FIN.span,FIN.hingeTip]]),{ram:.036,closed:false});
    seam(chart,points([[.14,finLE(.14)+.45],[.17,finHinge(.17)-.13],[2.93,finHinge(2.93)-.13],[2.93,finLE(2.93)+.25]]),{ram:.025});
    seam(chart,points([[3.01,finLE(3.01)],[3.01,finTE(3.01)]]),{ram:.070,closed:false,shade:'#899397'});
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
