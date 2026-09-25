// Shared deterministic coating-authoring primitives. Only the bake tool
// imports this module; no canvas or raster work is performed during flight.
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

function pigmentVariation(target) {
  const ctx = target.getContext('2d'), rng = random(22071997);
  // Soft, irregular pigment clouds at several physical scales; the fine
  // layer is only a few code values, avoiding visible "sandpaper" grain.
  for (const [w, h, opacity] of [[36, 18, .035], [124, 62, .018], [480, 240, .008]]) {
    const source = canvas(w, h, '#808080'), sc = source.getContext('2d');
    const pixels = sc.getImageData(0, 0, w, h);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const value = 70 + rng() * 115;
      pixels.data[i] = value; pixels.data[i + 1] = value; pixels.data[i + 2] = value;
    }
    sc.putImageData(pixels, 0, 0);
    ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = opacity * 2;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, target.width, target.height); ctx.restore();
  }
}

export function createPaintAtlas(charts, { width = 4096, height = 2048, dataScale = .5, baseColor = '#788286' } = {}) {
  const color = canvas(width, height, baseColor);
  const dw = Math.round(width * dataScale), dh = Math.round(height * dataScale);
  const relief = canvas(dw, dh, '#808080');
  const orm = canvas(dw, dh, 'rgb(250,158,20)');

  function path(target, chartName, points, { fill, stroke, lineWidth = .009, blur = 0, closed = true, opacity = 1 } = {}) {
    const chart = charts[chartName], ctx = target.getContext('2d');
    const { rect: [u, v, w, h], bounds: [s0, s1, t0, t1] } = chart;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath(); ctx.rect(u * target.width, (1 - v - h) * target.height, w * target.width, h * target.height); ctx.clip();
    if (blur) ctx.filter = `blur(${blur * target.width * w / (s1 - s0)}px)`;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const [a, b] = chartUV(chart, points[i][0], points[i][1]);
      if (i) ctx.lineTo(a * target.width, (1 - b) * target.height);
      else ctx.moveTo(a * target.width, (1 - b) * target.height);
    }
    if (closed) ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      // Approximate isotropic metre widths, independent of chart rotation.
      ctx.lineWidth = lineWidth * Math.sqrt(target.width * w / (s1 - s0) * target.height * h / (t1 - t0));
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = stroke; ctx.stroke();
    }
    ctx.restore();
  }
  const polygon = (chart, pts, colorFill, options = {}) => path(color, chart, pts, { fill: colorFill, ...options });
  function seam(chart, pts, { ram = .050, closed = true, shade = '#78868b', fill = null } = {}) {
    if (fill) polygon(chart, pts, fill);
    if (closed && pts.length > 2) {
      // Different maintenance panels retain slightly different sealing and
      // polishing histories. Keep this in the physical response, not relief.
      const signature = pts.reduce((sum, p, i) => sum + (p[0] * 13.17 + p[1] * 7.31) * (i + 1), 0);
      const variation = Math.sin(signature) * .5 + .5;
      path(orm, chart, pts, { fill: `rgb(250,${Math.round(147 + variation * 24)},${Math.round(15 + variation * 10)})`, opacity: .65 });
    }
    if (ram) {
      path(color, chart, pts, { stroke: shade, lineWidth: ram, closed, opacity: .48 });
      path(orm, chart, pts, { stroke: 'rgb(249,179,6)', lineWidth: ram, closed });
      path(relief, chart, pts, { stroke: '#818181', lineWidth: ram, closed });
    }
    path(color, chart, pts, { stroke: 'rgba(28,36,42,.48)', lineWidth: .005, closed });
    path(orm, chart, pts, { stroke: 'rgb(235,188,3)', lineWidth: .007, closed });
    path(relief, chart, pts, { stroke: '#797979', lineWidth: .007, closed });
  }

  function fasteners(chart, pts, { spacing = .15, size = .008, closed = true } = {}) {
    const count = closed ? pts.length : pts.length - 1;
    for (let edge = 0; edge < count; edge++) {
      const a = pts[edge], b = pts[(edge + 1) % pts.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.floor(length / spacing));
      for (let i = 0; i < n; i++) {
        const t = (i + .5) / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        const p = [[x-size,y-size],[x+size,y-size],[x+size,y+size],[x-size,y+size]];
        path(color, chart, p, { fill: '#3b474e', opacity: .43 });
        path(relief, chart, p, { fill: '#7b7b7b' });
      }
    }
  }

  function label(chartName, coordinate, value, { height = .16, color: ink = '#56636a', weight = 600, width: physicalWidth = null } = {}) {
    const chart = charts[chartName], ctx = color.getContext('2d');
    const [u, v] = chartUV(chart, ...coordinate);
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
    // Coating microtexture changes gloss, never ambient visibility. Updating
    // packed channels independently keeps AO and pigment physically separate.
    const oc = orm.getContext('2d'), response = oc.getImageData(0, 0, dw, dh);
    const rng = random(72619);
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const i = (y * dw + x) * 4;
      const cloudy = Math.sin(x * .021 + Math.sin(y * .013) * 2.1) *
        Math.sin(y * .026 + Math.sin(x * .007) * 1.7);
      response.data[i + 1] = Math.max(0, Math.min(255, response.data[i + 1] + cloudy * 3 + (rng() - .5) * 2));
    }
    oc.putImageData(response, 0, 0);
  const normal = canvas(dw, dh, '#8080ff');
  // A millimetre seam can be smaller than a data-map texel. Prefilter the
  // relief before differentiating it, so oblique highlights stay continuous
  // instead of amplifying raster stair-steps into serrated metal edges.
  const filteredRelief = canvas(dw, dh, '#808080');
  const rc = filteredRelief.getContext('2d'); rc.filter = 'blur(0.65px)';
  rc.drawImage(relief, 0, 0);
  const heights = rc.getImageData(0, 0, dw, dh).data;
  const nc = normal.getContext('2d'), pixels = nc.getImageData(0, 0, dw, dh);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const read = (a, b) => heights[(Math.max(0, Math.min(dh - 1, b)) * dw + Math.max(0, Math.min(dw - 1, a))) * 4];
    // Canvas Y points down, texture V points up. The green sign accounts
    // for that flip so a recessed panel stays recessed in tangent space.
    const nx = (read(x - 1,y) - read(x + 1,y)) * .007;
    const ny = (read(x,y + 1) - read(x,y - 1)) * .007;
    const length = Math.hypot(nx, ny, 1), i = (y * dw + x) * 4;
    pixels.data[i] = Math.round((nx / length * .5 + .5) * 255);
    pixels.data[i + 1] = Math.round((ny / length * .5 + .5) * 255);
    pixels.data[i + 2] = Math.round((1 / length * .5 + .5) * 255);
    pixels.data[i + 3] = 255;
  }
  nc.putImageData(pixels, 0, 0);
    return { color, normal, orm };
  }
  return { color, orm, relief, path, polygon, seam, fasteners, label, finish };
}
