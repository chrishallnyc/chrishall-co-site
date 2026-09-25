// Deterministic surface authoring. Color, response and physical relief share
// one semantic description; this module is used only by the offline baker.
import { chartUV } from '../geometry/f22-uv.js';

function canvas(width, height, fill) {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = fill; ctx.fillRect(0, 0, width, height);
  return c;
}

function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

function signature(chart, pts) {
  const letters = [...chart].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  return pts.reduce((sum, p, i) => sum + (p[0] * 13.17 + p[1] * 7.31) * (i + 1), letters);
}

function pigmentVariation(target) {
  const ctx = target.getContext('2d'), rng = random(22071997);
  // Keep most variation at coating-application scale. Enlarged white noise
  // reads as damaged concrete; the fine tile is handled by the physical lobe.
  for (const [w, h, opacity] of [[42, 21, .048], [180, 90, .024], [620, 310, .006]]) {
    const source = canvas(w, h, '#808080'), sc = source.getContext('2d');
    const pixels = sc.getImageData(0, 0, w, h);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const value = 65 + rng() * 125;
      pixels.data[i] = value; pixels.data[i + 1] = value; pixels.data[i + 2] = value;
    }
    sc.putImageData(pixels, 0, 0);
    ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = opacity * 2;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, target.width, target.height); ctx.restore();
  }
}

export function createPaintAtlas(charts, { width = 4096, height = 2048, dataScale = .5, baseColor = '#717b7d' } = {}) {
  const color = canvas(width, height, baseColor);
  const dw = Math.round(width * dataScale), dh = Math.round(height * dataScale);
  const relief = canvas(dw, dh, '#808080');
  // A modest mixed specular response approximates the photographed silver
  // finish. These are appearance targets, not measured coating composition.
  // Radome, protective strips and fresh sealing remain matte dielectric.
  const orm = canvas(dw, dh, 'rgb(252,144,26)');

  function path(target, chartName, points, { fill, stroke, lineWidth = .009, blur = 0,
    closed = true, opacity = 1, composite = 'source-over' } = {}) {
    const chart = charts[chartName], ctx = target.getContext('2d');
    if (!chart) throw new Error(`Unknown coating chart: ${chartName}`);
    const { rect: [u, v, w, h], bounds: [s0, s1, t0, t1] } = chart;
    ctx.save(); ctx.globalAlpha = opacity; ctx.globalCompositeOperation = composite;
    ctx.beginPath(); ctx.rect(u * target.width, (1 - v - h) * target.height, w * target.width, h * target.height); ctx.clip();
    if (blur) ctx.filter = `blur(${blur * Math.sqrt(target.width * w / (s1 - s0) * target.height * h / (t1 - t0))}px)`;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const [a, b] = chartUV(chart, points[i][0], points[i][1]);
      if (i) ctx.lineTo(a * target.width, (1 - b) * target.height);
      else ctx.moveTo(a * target.width, (1 - b) * target.height);
    }
    if (closed) ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      ctx.lineWidth = lineWidth * Math.sqrt(target.width * w / (s1 - s0) * target.height * h / (t1 - t0));
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = stroke; ctx.stroke();
    }
    ctx.restore();
  }
  const polygon = (chart, pts, colorFill, options = {}) => path(color, chart, pts, { fill: colorFill, ...options });

  function surfaceResponse(chart, pts, { roughness = .56, metalness = .10,
    opacity = 1, feather = .025 } = {}) {
    path(orm, chart, pts, { fill: `rgb(252,${Math.round(roughness * 255)},${Math.round(metalness * 255)})`,
      opacity, blur: feather });
  }

  function scuff(chartName, start, end, { width = .028, strength = .43,
    roughness = .46, metalness = .15 } = {}) {
    const chart = charts[chartName], ctx = orm.getContext('2d');
    const a = chartUV(chart,...start), b = chartUV(chart,...end);
    const fade = ctx.createLinearGradient(a[0]*dw,(1-a[1])*dh,b[0]*dw,(1-b[1])*dh);
    const rgb = `252,${Math.round(roughness*255)},${Math.round(metalness*255)}`;
    fade.addColorStop(0,`rgba(${rgb},0)`); fade.addColorStop(.18,`rgba(${rgb},${strength})`);
    fade.addColorStop(.62,`rgba(${rgb},${strength*.67})`); fade.addColorStop(1,`rgba(${rgb},0)`);
    path(orm,chartName,[start,end],{stroke:fade,lineWidth:width,closed:false,blur:width*.10});
  }

  // Broad service marks have a location and direction, unlike global dirt
  // noise. Coherent 10–30 cm variation survives medium atlas mip levels.
  function serviceTrace(chart, points, { width = .16, strength = .10,
    roughness = .68, warm = false, seed = 0 } = {}) {
    const phase = signature(chart,points)+seed, route=[];
    let distance=0;
    for(let edge=0;edge<points.length-1;edge++) {
      const a=points[edge],b=points[edge+1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
      const steps=Math.max(2,Math.ceil(length/.045));
      for(let i=0;i<steps;i++) {
        const t=i/steps,s=distance+t*length;
        const drift=(Math.sin(s*9.1+phase)+.4*Math.sin(s*18.7+phase*.37))*width*.075;
        route.push([a[0]+dx*t-dy/Math.max(length,.001)*drift,
          a[1]+dy*t+dx/Math.max(length,.001)*drift]);
      }
      distance+=length;
    }
    route.push(points.at(-1));
    const tone=warm?[62,55,43]:[54,63,65];
    path(color,chart,route,{stroke:`rgb(${tone})`,lineWidth:width*1.75,closed:false,
      opacity:strength*.34,blur:width*.34});
    path(color,chart,route,{stroke:`rgb(${tone})`,lineWidth:width*.56,closed:false,
      opacity:strength*.45,blur:width*.18});
    path(orm,chart,route,{stroke:`rgb(252,${Math.round(roughness*255)},12)`,lineWidth:width,
      closed:false,opacity:.42,blur:width*.22});
    // Minute disturbed-coating relief, without excavating a grime groove.
    path(relief,chart,route,{stroke:'#757575',lineWidth:width*.43,
      closed:false,opacity:.36,blur:width*.17});
    for(let i=2;i<route.length-4;i+=7) {
      const d=.5+.5*Math.sin(phase+i*.74);
      path(orm,chart,route.slice(i,i+5),{stroke:`rgb(252,${Math.round((roughness-.10+d*.13)*255)},16)`,
        lineWidth:width*(.21+d*.16),closed:false,opacity:.36,blur:width*.10});
    }
  }

  function seam(chart, pts, { ram = .05, closed = true, shade = '#909994', fill = null,
    response = true, sealContrast = 1 } = {}) {
    const phase = signature(chart, pts), variation = Math.sin(phase) * .5 + .5;
    if (fill) polygon(chart, pts, fill);
    if (closed && pts.length > 2 && response) {
      // Broad access covers visibly differ in gloss before tiny panel lines
      // become visible. Pigment and finish remain separate physical signals.
      path(orm, chart, pts, { fill: `rgb(252,${Math.round(127 + variation * 47)},${Math.round(18 + (1-variation) * 19)})`, opacity: .75 });
      polygon(chart, pts, variation > .52 ? '#93968e' : '#6b7578',
        { opacity: .10 + variation * .10, composite: 'soft-light' });
    }
    if (ram) {
      // A feathered repair halo, a narrow sealant layer, then the real gap.
      // Only the narrow layer affects relief: sprayed paint is nearly flush.
      const protectiveEdge = ram >= .09;
      // Most panel boundaries read through gloss and a hairline recess.
      // Only the broad protective leading edges carry an obvious pale band.
      // Soft-light retains the local camouflage beneath thin resealing paint
      // instead of drawing a pale circuit diagram around every access cover.
      path(color, chart, pts, { stroke: shade, lineWidth: ram * 1.8, blur: ram * .28,
        closed, opacity: (protectiveEdge ? .10 : .07) * sealContrast, composite: 'soft-light' });
      path(color, chart, pts, { stroke: shade, lineWidth: ram, closed,
        opacity: (protectiveEdge ? .42 : (closed ? .15 + variation * .16 : .23)) * sealContrast,
        composite: protectiveEdge ? 'source-over' : 'soft-light' });
      path(orm, chart, pts, { stroke: `rgb(251,${Math.round(178 + variation * 22)},1)`,
        lineWidth: ram, closed, opacity:sealContrast,
        blur: protectiveEdge ? .002 : .003 + variation * .007 });
      path(relief, chart, pts, { stroke: '#828282', lineWidth: ram, closed });
      if(ram>.03&&!protectiveEdge) {
        // A few local resealed lengths interrupt an otherwise continuous
        // joint. Neither pigment nor relief turns the entire border white.
        const count=closed?pts.length:pts.length-1;
        for(let i=0;i<count;i++) {
          const a=pts[i],b=pts[(i+1)%pts.length],q=.5+.5*Math.sin(phase+i*2.17);
          if(q<.48)continue;
          const lo=.16+q*.17,hi=Math.min(.84,lo+.22+q*.17);
          const segment=[lo,hi].map(t=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);
          path(orm,chart,segment,{stroke:`rgb(251,${Math.round(188+q*20)},1)`,
            lineWidth:ram*(.84+q*.32),closed:false,blur:.004+q*.009,opacity:.63*sealContrast});
          path(color,chart,segment,{stroke:shade,lineWidth:ram*(.81+q*.20),
            closed:false,blur:.004+q*.008,opacity:.10*sealContrast,composite:'soft-light'});
          path(relief,chart,segment,{stroke:'#848484',lineWidth:ram*(.65+q*.15),
            closed:false,blur:.005+q*.007,opacity:.58});
        }
      }
    }
    // Aged flush joins can have a quiet reseal while retaining the actual
    // recessed hairline. Finish history does not change structural relief.
    path(color, chart, pts, { stroke: 'rgba(25,34,38,.30)', lineWidth: .0035, closed, opacity:sealContrast });
    path(orm, chart, pts, { stroke: 'rgb(237,199,1)', lineWidth: .008, closed, opacity:.65+.35*sealContrast });
    path(relief, chart, pts, { stroke: '#737373', lineWidth: .008, closed });
  }

  function repair(chart, pts, { shade = '#a6aaa1', opacity = .34, roughness = .71,
    feather = .009, edge = .014, scuffed = false } = {}) {
    // Preserve the original camouflage and its local luminance. Refreshed
    // coating is a modest tint/finish shift, not an opaque pale sticker.
    polygon(chart, pts, shade, { opacity: opacity * .82, blur: feather * 1.8, composite: 'soft-light' });
    const restrainedRoughness = .61 + (roughness - .61) * .66;
    path(orm, chart, pts, { fill: `rgb(252,${Math.round(restrainedRoughness * 255)},${scuffed ? 27 : 13})`, blur: feather, opacity: .74 });
    path(relief, chart, pts, { fill: '#818181', blur: feather });
    if (edge) {
      path(color, chart, pts, { stroke: shade, lineWidth: edge, opacity: opacity * .28, composite: 'soft-light' });
      path(orm, chart, pts, { stroke: 'rgb(251,198,1)', lineWidth: edge, opacity: .7 });
    }
    if (scuffed) {
      const rng = random(Math.abs(Math.round(signature(chart, pts) * 1000)));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
      // Restrained parallel cleaning marks contained within the access area.
      for (let i = 0; i < 9; i++) {
        const x = x0 + (x1 - x0) * (.12 + rng() * .7), y = y0 + (y1 - y0) * (.18 + rng() * .64);
        path(orm, chart, [[x,y],[Math.min(x1 - .03, x + .10 + rng() * .20),y+.007]],
          { stroke: 'rgb(252,122,31)', lineWidth: .014 + rng() * .018, closed: false, opacity: .32 });
      }
    }
  }

  function streak(chartName, start, end, { width = .07, strength = .13, shade = [43,47,42], roughness = .75 } = {}) {
    const chart = charts[chartName], c = color.getContext('2d');
    const a = chartUV(chart, ...start), b = chartUV(chart, ...end);
    const gradient = c.createLinearGradient(a[0] * color.width, (1-a[1]) * color.height,
      b[0] * color.width, (1-b[1]) * color.height);
    gradient.addColorStop(0, `rgba(${shade},${strength})`);
    gradient.addColorStop(.25, `rgba(${shade},${strength * .50})`);
    gradient.addColorStop(1, `rgba(${shade},0)`);
    path(color, chartName, [start,end], { stroke: gradient, lineWidth: width, closed: false, blur: width * .15 });
    path(orm, chartName, [start,end], { stroke: `rgb(252,${Math.round(roughness * 255)},2)`, lineWidth: width * .7,
      closed: false, opacity: strength * .85, blur: width * .16 });
  }

  // Airflow carries a local service trace aft. A widening, broken plume has
  // a different scale and shape from a panel gap or a round-ended brush line.
  // Pigment and response share the same fade, so the tail never ends in a
  // hard roughness rectangle when the camera moves through the reflection.
  function flowMark(chartName, start, end, { width = .20, strength = .20,
    roughness = .77, shade = [62,62,53], seed = 0 } = {}) {
    const chart = charts[chartName], dx = end[0]-start[0], dy = end[1]-start[1];
    const length = Math.hypot(dx,dy), nx = -dy/length, ny = dx/length;
    const sides = [[],[]];
    for(let i=0;i<=12;i++) {
      const t=i/12, taper=Math.sqrt(1-t), spread=width*(.28+t*.67)*taper;
      const bend=Math.sin(t*4.3+seed)*width*.10*taper;
      const wave=1+.12*Math.sin(t*19+seed)+.06*Math.sin(t*37+seed*.71);
      const x=start[0]+dx*t+nx*bend,y=start[1]+dy*t+ny*bend;
      sides[0].push([x+nx*spread*wave,y+ny*spread*wave]);
      sides[1].push([x-nx*spread/wave,y-ny*spread/wave]);
    }
    const outline=[...sides[0],...sides[1].reverse()];
    const fade=(target,rgb,alpha)=>{
      const context=target.getContext('2d'),a=chartUV(chart,...start),b=chartUV(chart,...end);
      const gradient=context.createLinearGradient(a[0]*target.width,(1-a[1])*target.height,
        b[0]*target.width,(1-b[1])*target.height);
      for(const [t,k] of [[0,.30],[.09,1],[.36,.69],[.72,.19],[1,0]])
        gradient.addColorStop(t,`rgba(${rgb},${alpha*k})`);
      return gradient;
    };
    path(color,chartName,outline,{fill:fade(color,shade,strength),blur:width*.18});
    path(orm,chartName,outline,{fill:fade(orm,[252,Math.round(roughness*255),7],strength*2.2),blur:width*.15});
  }

  function fasteners(chart, pts, { spacing = .15, size = .008, closed = true } = {}) {
    const count = closed ? pts.length : pts.length - 1;
    for (let edge = 0; edge < count; edge++) {
      const a = pts[edge], b = pts[(edge + 1) % pts.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.floor(length / spacing));
      for (let i = 0; i < n; i++) {
        const t = (i + .5) / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        const p = [[x-size,y-size*.65],[x+size,y-size*.65],[x+size,y+size*.65],[x-size,y+size*.65]];
        path(color, chart, p, { fill: '#344146', opacity: .46 });
        path(orm, chart, p, { fill: 'rgb(242,129,14)' });
        path(relief, chart, p, { fill: '#727272' });
      }
    }
  }

  function label(chartName, coordinate, value, { height = .16, color: ink = '#536064', weight = 600, width: physicalWidth = null } = {}) {
    const chart = charts[chartName], ctx = color.getContext('2d'), [u, v] = chartUV(chart, ...coordinate);
    const pixelsPerMetre = color.height * chart.rect[3] / (chart.bounds[3] - chart.bounds[2]);
    ctx.save();
    ctx.beginPath(); ctx.rect(chart.rect[0] * color.width, (1 - chart.rect[1] - chart.rect[3]) * color.height,
      chart.rect[2] * color.width, chart.rect[3] * color.height); ctx.clip();
    ctx.font = `${weight} ${height * pixelsPerMetre}px Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = ink;
    ctx.translate(u * color.width, (1 - v) * color.height);
    if (physicalWidth) {
      const desired = physicalWidth * color.width * chart.rect[2] / (chart.bounds[1] - chart.bounds[0]);
      ctx.scale(desired / Math.max(1, ctx.measureText(value).width), 1);
    }
    ctx.fillText(value, 0, 0); ctx.restore();
  }

  function finish() {
    pigmentVariation(color);
    const oc = orm.getContext('2d'), response = oc.getImageData(0, 0, dw, dh), rng = random(72619);
    // Directional application variation is mostly roughness. Keep AO and
    // metallic channels intact, and never imprint global noise as crevices.
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const i = (y * dw + x) * 4;
      const broad = Math.sin(x * .037 + Math.sin(y * .021) * 2.1) * Math.sin(y * .071 + Math.sin(x * .017));
      const directional = Math.sin(y * .27 + Math.sin(x * .005) * 1.7);
      response.data[i + 1] = Math.max(0, Math.min(255, response.data[i + 1] + broad * 5 + directional * 1.6 + (rng() - .5) * 1.5));
    }
    oc.putImageData(response, 0, 0);
    const normal = canvas(dw, dh, '#8080ff'), filtered = canvas(dw, dh, '#808080');
    const rc = filtered.getContext('2d'); rc.filter = 'blur(0.45px)'; rc.drawImage(relief, 0, 0);
    const heights = rc.getImageData(0, 0, dw, dh).data;
    const nc = normal.getContext('2d'), pixels = nc.getImageData(0, 0, dw, dh);
    // One grey code is 35 micrometres of displacement. Different charts have
    // different texel densities; differentiate each axis in actual metres.
    const metresPerCode = .000035;
    for (const chart of Object.values(charts)) {
      const [u,v,w,h] = chart.rect, [s0,s1,t0,t1] = chart.bounds;
      const x0 = Math.ceil(u * dw), x1 = Math.floor((u+w) * dw);
      const y0 = Math.ceil((1-v-h) * dh), y1 = Math.floor((1-v) * dh);
      const dx = (s1-s0)/(w*dw), dy = (t1-t0)/(h*dh);
      const read = (x,y) => heights[(Math.max(y0,Math.min(y1-1,y))*dw + Math.max(x0,Math.min(x1-1,x)))*4];
      for (let y=y0;y<y1;y++) for (let x=x0;x<x1;x++) {
        const nx = (read(x-1,y)-read(x+1,y))*metresPerCode/(2*dx);
        // Canvas Y points down and texture V up: preserve a recessed seam.
        const ny = (read(x,y+1)-read(x,y-1))*metresPerCode/(2*dy);
        const inv = 1/Math.hypot(nx,ny,1), i=(y*dw+x)*4;
        pixels.data[i]=Math.round((nx*inv*.5+.5)*255);
        pixels.data[i+1]=Math.round((ny*inv*.5+.5)*255);
        pixels.data[i+2]=Math.round((inv*.5+.5)*255); pixels.data[i+3]=255;
      }
    }
    nc.putImageData(pixels,0,0);
    return {color,normal,orm};
  }
  return {color,orm,relief,path,polygon,surfaceResponse,scuff,serviceTrace,seam,repair,streak,flowMark,fasteners,label,finish};
}
