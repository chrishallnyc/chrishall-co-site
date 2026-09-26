/**
 * RAPTOR Pixel Wing's little pixel studio. Everything is painted at the game's native
 * resolution: no downloaded textures, canvas gradients, or per-frame noise.
 * Scenery and sprite poses are drawn once, then blitted on the flight canvas.
 */
import { STAGES } from './sim.js';
import { CITY_HEIGHT, CITY_VISTAS, cityCameraOffset, createCityScenes } from './city-scenes.js';

const W = 640;
const H = 400;
const WORLD_H = CITY_HEIGHT;
const TAU = Math.PI * 2;

export const PALETTE = Object.freeze({
  ink: '#10182e', navy: '#1c2945', slate: '#465d7a', titanium: '#dbe5df',
  cyan: '#95e6db', teal: '#328e92', gold: '#ffbd6c', coral: '#ff686b',
  violet: '#716692', cream: '#fff2ce',
});

function surface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function random(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function box(c, color, x, y, w, h) {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

// Scan-line polygons and Bresenham lines keep diagonal edges on whole pixels.
// Canvas's antialiased paths would give the sprites soft, inconsistent outlines.
function poly(c, color, points) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  minY = Math.max(0, Math.ceil(minY));
  maxY = Math.min(c.canvas.height, Math.ceil(maxY));
  c.fillStyle = color;
  for (let y = minY; y < maxY; y++) {
    const xs = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j]; const b = points[i];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x = Math.ceil(xs[i]);
      c.fillRect(x, y, Math.max(1, Math.ceil(xs[i + 1]) - x), 1);
    }
  }
}

function line(c, color, x0, y0, x1, y1, width = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  c.fillStyle = color;
  if (x0 === x1) {
    c.fillRect(x0 - (width >> 1), Math.min(y0, y1) - (width >> 1), width, Math.abs(y1 - y0) + width);
    return;
  }
  if (y0 === y1) {
    c.fillRect(Math.min(x0, x1) - (width >> 1), y0 - (width >> 1), Math.abs(x1 - x0) + width, width);
    return;
  }
  const dx = Math.abs(x1 - x0); const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0); const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    c.fillRect(x0 - (width >> 1), y0 - (width >> 1), width, width);
    if (x0 === x1 && y0 === y1) break;
    const e = error * 2;
    if (e >= dy) { error += dy; x0 += sx; }
    if (e <= dx) { error += dx; y0 += sy; }
  }
}

function outline(c, color, points, width = 1, closed = true) {
  for (let i = 1; i < points.length; i++) line(c, color, ...points[i - 1], ...points[i], width);
  if (closed) line(c, color, ...points.at(-1), ...points[0], width);
}

function pixelRing(c, color, x, y, radius, thickness = 1, dashed = false) {
  const steps = Math.max(12, Math.round(radius * 2));
  for (let i = 0; i < steps; i++) {
    if (dashed && (i % 6 > 2)) continue;
    const a = i / steps * TAU;
    const b = (i + 1) / steps * TAU;
    line(c, color, x + Math.cos(a) * radius, y + Math.sin(a) * radius,
      x + Math.cos(b) * radius, y + Math.sin(b) * radius, thickness);
  }
}

function tree(c, x, y, variant = 0, dark = false) {
  box(c, dark ? '#172c3d' : '#38625e', x + 3, y + 6, 8, 5);
  box(c, dark ? '#233c48' : '#304b43', x + 3, y + 1, 2, 8);
  const edge = dark ? '#284b51' : '#366b50';
  const top = dark ? '#42685f' : variant ? '#6f9a69' : '#73a37a';
  box(c, edge, x, y, 9, 7);
  box(c, edge, x + 2, y - 2, 5, 11);
  box(c, top, x + 1, y, 6, 3);
  box(c, top, x + 2, y - 1, 3, 6);
  box(c, dark ? '#568271' : '#9fb980', x + 2, y, 2, 2);
}

function boat(c, x, y, size = 1, color = '#d0d5c1') {
  poly(c, '#255a63', [[x - 4 * size, y - 11 * size], [x + 6 * size, y - 9 * size],
    [x + 6 * size, y + 10 * size], [x - 3 * size, y + 11 * size]]);
  poly(c, '#152e45', [[x, y - 11 * size], [x + 4 * size, y - 5 * size], [x + 4 * size, y + 9 * size],
    [x - 4 * size, y + 9 * size], [x - 4 * size, y - 5 * size]]);
  poly(c, color, [[x, y - 10 * size], [x + 3 * size, y - 4 * size], [x + 3 * size, y + 8 * size],
    [x - 3 * size, y + 8 * size], [x - 3 * size, y - 4 * size]]);
  box(c, '#495764', x - 2 * size, y - 2 * size, 4 * size, 5 * size);
  box(c, '#eee5b8', x - size, y - 3 * size, 2 * size, 2 * size);
  line(c, '#61a3a4', x - 4 * size, y + 12 * size, x - 7 * size, y + 21 * size);
  line(c, '#61a3a4', x + 4 * size, y + 12 * size, x + 7 * size, y + 21 * size);
  box(c, '#82b6ad', x - size, y + 13 * size, 2 * size, 8 * size);
}

function waves(c, rng, predicate, count, night = false) {
  const colors = night ? ['#19364c', '#1d3e51', '#234d5e', '#2e5a65'] : ['#24636f', '#286f7a', '#35838a', '#469397'];
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * W); const y = Math.floor(rng() * WORLD_H);
    if (!predicate(x, y)) continue;
    const w = 3 + Math.floor(rng() * 13);
    box(c, colors[i % colors.length], x, y, w, 1);
    if (i % 4 === 0) box(c, colors[i % colors.length], x + 3, y + 2, w - 2, 1);
    if (i % 13 === 0) box(c, night ? '#426a75' : '#79b4ad', x + 1, y - 1, 4, 1);
  }
}

function cityBuilding(c, rng, x, y, w, h, tall = false) {
  const elevation = tall ? 10 + Math.floor(rng() * 9) : 4 + Math.floor(rng() * 5);
  const roof = ['#465068', '#505770', '#39495f', '#56566b'][Math.floor(rng() * 4)];
  box(c, '#0e2035', x + 7, y + 8, w + 3, h + elevation + 2);
  box(c, '#25374e', x + 3, y + elevation, w, h);
  box(c, '#30374e', x, y + h - 1, w + 2, elevation + 2);
  box(c, '#202f46', x + w - 1, y + 2, 4, h + elevation - 1);
  for (let wy = 3; wy < elevation; wy += 3) {
    for (let wx = 2; wx < w - 2; wx += 4) {
      if (rng() > .29) box(c, rng() > .25 ? '#e1b389' : '#95877f', x + wx, y + h + wy, 2, 1);
    }
  }
  box(c, roof, x, y, w, h);
  box(c, '#6a6d7d', x, y, w, 1);
  box(c, '#758184', x, y + 1, 1, h - 2);
  box(c, '#293c53', x + 3, y + 3, Math.max(3, w - 6), Math.max(3, h - 6));
  box(c, roof, x + 4, y + 4, Math.max(2, w - 7), Math.max(2, h - 7));
  if (w > 11 && h > 10) {
    box(c, '#27354b', x + 4, y + 5, 5, 4);
    box(c, '#788084', x + 4, y + 4, 4, 3);
    box(c, '#a1a09c', x + 4, y + 4, 3, 1);
  }
  if (tall) {
    box(c, '#21354b', x + 4, y + 1, Math.max(3, w - 7), 5);
    box(c, '#89919a', x + 3, y - 1, Math.max(3, w - 7), 5);
    box(c, '#abb5b4', x + 3, y - 1, Math.max(3, w - 7), 1);
    box(c, '#152a41', x + w / 2, y + 4, 2, 8);
    box(c, '#798c98', x + w / 2, y - 4, 1, 9);
    box(c, '#dd9285', x + w / 2, y - 4, 1, 1);
  }
  // Small roof signs and glass atriums give the city its night colors without
  // covering every roof in decorative lights or competing with enemy fire.
  if (w > 17 && rng() > .7) {
    const tint = rng() > .5 ? '#7ac6c6' : '#d895b4';
    const shade = tint === '#7ac6c6' ? '#426b79' : '#755674';
    box(c, shade, x + 3, y + h - 5, w - 5, 5);
    box(c, tint, x + 4, y + h - 4, w - 7, 1);
    box(c, tint, x + 4, y + h - 3, 1, 2);
    box(c, '#d8dac2', x + 7, y + h - 2, 2, 1);
    if (w > 21) box(c, tint, x + 12, y + h - 2, 3, 1);
  }
}

function suspensionBridge(c, x0, x1, y, accent = '#d1ac89') {
  box(c, '#0d223b', x0 + 8, y + 23, x1 - x0 + 7, 13);
  box(c, '#395064', x0, y, x1 - x0, 16);
  box(c, '#809191', x0, y, x1 - x0, 2);
  box(c, '#243548', x0, y + 4, x1 - x0, 8);
  box(c, '#9da495', x0, y + 14, x1 - x0, 1);
  for (let x = x0 + 6; x < x1; x += 13) box(c, '#b5a484', x, y + 7, 5, 1);
  for (let x = x0 + 5; x < x1; x += 29) {
    box(c, '#ddc69a', x, y + 4, 3, 1);
    box(c, '#d3817a', x + 12, y + 10, 2, 1);
  }
  const towers = [x0 + (x1 - x0) * .25, x0 + (x1 - x0) * .75];
  const cable = [[x0, y + 2], [towers[0], y - 19], [(x0 + x1) / 2, y - 2], [towers[1], y - 19], [x1, y + 2]];
  outline(c, '#ae9583', cable, 1, false);
  for (let i = 1; i < cable.length; i++) {
    const a = cable[i - 1]; const b = cable[i];
    for (let x = a[0] + 7; x < b[0]; x += 9) {
      const cy = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      line(c, '#566477', x, cy, x, y + 2);
    }
  }
  for (const x of towers) {
    box(c, '#1b2e46', x + 4, y - 16, 9, 41);
    box(c, '#9b8d7d', x - 3, y - 20, 5, 40);
    box(c, accent, x - 3, y - 20, 2, 40);
    box(c, '#706e75', x + 2, y - 20, 5, 40);
    box(c, accent, x - 4, y - 20, 12, 3);
    box(c, '#efc398', x - 4, y - 22, 2, 2);
    box(c, '#efc398', x + 6, y - 22, 2, 2);
  }
}

function drawHarbor() {
  const { canvas, ctx: c } = surface(W, WORLD_H);
  const rng = random(20260925);
  const west = y => 104 + Math.sin(y / WORLD_H * TAU * 2) * 15;
  const manLeft = y => y < 1480 ? 309 + y * .027 : 349 + (y - 1480) * .27;
  const manRight = y => y < 1480 ? 524 - y * .009 : 511 - (y - 1480) * .11;
  const onManhattan = (x, y) => y > 65 && y < 1780 && x > manLeft(y) && x < manRight(y);
  box(c, '#142c44', 0, 0, W, WORLD_H);
  waves(c, rng, (x, y) => x > west(y) + 10 && !onManhattan(x, y), 6200, true);
  // Hudson and East River embankments are crisp ribbons of stone and lights.
  for (let y = 0; y < WORLD_H; y += 2) {
    box(c, '#294354', 0, y, west(y) + 3, 2);
    box(c, '#445661', 0, y, west(y), 2);
    box(c, '#293b50', 0, y, west(y) - 4, 2);
    box(c, '#3e4e5e', 590, y, 50, 2);
    box(c, '#293b50', 594, y, 46, 2);
    if (y > 65 && y < 1780) {
      const l = manLeft(y); const r = manRight(y);
      box(c, '#244958', l - 5, y, r - l + 10, 2);
      box(c, '#5a6569', l - 1, y, r - l + 2, 2);
      box(c, '#2e4053', l + 3, y, r - l - 6, 2);
      if (y % 25 < 2) {
        box(c, '#a89778', l + 1, y, 2, 2);
        box(c, '#a89778', r - 3, y, 2, 2);
        box(c, '#576965', l - 4, y + 3, 2, 9);
      }
    }
  }
  // Grid blocks are individually roofed, with service alleys and lit facades.
  for (let y = 89; y < 1730; y += 52) {
    const l = Math.ceil((manLeft(y) + 11) / 36) * 36;
    const r = manRight(y + 45) - 9;
    box(c, '#162e43', manLeft(y) + 5, y + 39, Math.max(1, r - manLeft(y)), 5);
    for (let x = l; x < r - 19; x += 36) {
      // Central Park is a single intentional void in the dense urban pattern.
      if (y > 310 && y < 700 && x > 368 && x < 466) continue;
      box(c, '#182e44', x - 5, y - 3, 4, 54);
      cityBuilding(c, rng, x, y + rng() * 3, 11 + rng() * 6, 13 + rng() * 10, y > 730 && y < 1080);
      cityBuilding(c, rng, x + 18, y + 3, 10 + rng() * 6, 11 + rng() * 16, y > 1260);
      if (rng() > .25) cityBuilding(c, rng, x + 2, y + 27, 21 + rng() * 5, 8 + rng() * 6);
      box(c, '#bb9776', x - 4, y + 37, 1, 1);
      if (rng() > .4) box(c, '#d2ad82', x + 25, y + 42, 3, 1);
      if (rng() > .6) box(c, '#be6e73', x + 9, y + 40, 2, 1);
      if (rng() > .68) {
        box(c, '#466475', x + 13, y + 43, 13, 1);
        box(c, '#7d9b99', x + 14, y + 42, 4, 1);
      }
    }
  }
  // Jersey and Brooklyn complete the river landscape at both edges.
  for (let y = 31; y < WORLD_H; y += 53) {
    box(c, '#182e44', 0, y + 40, west(y) - 9, 5);
    for (let x = 8; x < west(y) - 20; x += 31) cityBuilding(c, rng, x, y, 20 + rng() * 4, 27 + rng() * 6);
    cityBuilding(c, rng, 605, y + 9, 24, 28);
  }
  // Central Park: the reservoir, serpentine paths, meadows and tree canopies.
  box(c, '#657170', 371, 315, 94, 375);
  box(c, '#223f43', 373, 317, 90, 371);
  box(c, '#30554c', 381, 325, 73, 355);
  for (let y = 327; y < 680; y += 4) {
    const x = 413 + Math.sin(y / 36) * 17;
    box(c, '#8d8d72', x, y, 3, 4);
  }
  for (let i = 0; i < 190; i++) {
    const x = 377 + rng() * 77; const y = 324 + rng() * 353;
    if (Math.abs(x - (413 + Math.sin(y / 36) * 17)) > 7) tree(c, x, y, 0, true);
  }
  poly(c, '#1b3b4a', [[390, 400], [402, 386], [436, 390], [447, 413], [435, 443], [409, 448], [391, 430]]);
  outline(c, '#688481', [[390, 400], [402, 386], [436, 390], [447, 413]], 1, false);
  box(c, '#668376', 409, 574, 31, 46);
  box(c, '#47745e', 411, 576, 27, 42);
  line(c, '#8d9d83', 424, 579, 424, 614);
  box(c, '#bcc0a0', 416, 579, 15, 1);
  box(c, '#bcc0a0', 416, 614, 15, 1);
  // Landmark towers are stepped silhouettes, with familiar illuminated crowns.
  const tower = (x, y, kind) => {
    box(c, '#10253d', x + 7, y + 8, 33, 53);
    box(c, '#666a7c', x - 3, y + 7, 30, 30);
    box(c, '#8f8e93', x - 3, y + 7, 2, 30);
    for (let j = 0; j < 5; j++) {
      const inset = j * 2; const top = y - j * 7;
      box(c, '#333f57', x + inset + 2, top + 4, 22 - inset * 2, 18);
      box(c, kind ? '#697080' : '#a19c97', x + inset, top, 22 - inset * 2, 11);
      box(c, '#d8bb96', x + inset, top, 22 - inset * 2, 1);
      for (let q = 0; q < 3; q++) box(c, '#ecc79d', x + inset + 2 + q * 4, top + 6, 1, 2);
    }
    line(c, '#e2c5a1', x + 11, y - 26, x + 11, y - (kind ? 45 : 49));
    box(c, '#e9be91', x + 10, y - (kind ? 45 : 49), 3, 2);
  };
  tower(394, 845, 0);
  tower(470, 923, 1);
  // One World Trade Center: a tapered glass prism rather than another Midtown
  // wedding-cake crown. Its antenna makes Lower Manhattan read at native size.
  const wx = 430; const wy = 1470;
  poly(c, '#10253d', [[wx - 17, wy - 8], [wx + 25, wy - 4], [wx + 35, wy + 54], [wx - 8, wy + 49]]);
  poly(c, '#77909c', [[wx - 8, wy - 70], [wx + 8, wy - 70], [wx + 18, wy + 28], [wx - 18, wy + 28]]);
  poly(c, '#465e7b', [[wx + 1, wy - 70], [wx + 8, wy - 70], [wx + 18, wy + 28], [wx - 5, wy + 28]]);
  line(c, '#aac7c7', wx - 8, wy - 70, wx - 18, wy + 28);
  for (let y = wy - 61; y < wy + 26; y += 5) {
    const half = 8 + (y - (wy - 70)) / 10;
    line(c, '#718995', wx - half + 2, y, wx + half - 2, y);
  }
  box(c, '#b0c6c6', wx - 8, wy - 72, 16, 2);
  line(c, '#d7d4ba', wx, wy - 72, wx, wy - 109);
  box(c, '#e1b395', wx, wy - 110, 1, 2);
  // The lower Manhattan waterfront, ferry slips and Battery Park.
  for (let i = 0; i < 8; i++) {
    const y = 950 + i * 71; const x = manLeft(y);
    box(c, '#0e243c', x - 29, y + 4, 30, 12);
    box(c, '#667478', x - 28, y, 30, 8);
    box(c, '#9c9c85', x - 26, y, 27, 1);
    if (i % 3 === 0) boat(c, x - 20, y + 23, .7, '#c4c9bf');
  }
  for (let y = 92; y < 1710; y += 43) {
    const x = manLeft(y);
    const lit = Math.floor(y / 43) % 3;
    box(c, lit ? '#d5af84' : '#97c8c3', x - 1, y, 2, 2);
    box(c, lit ? '#6b726c' : '#4f7880', x - 7, y + 5, 8, 1);
    box(c, lit ? '#4b5e61' : '#385c6e', x - 12, y + 8, 10, 1);
    box(c, '#2c4b5b', x - 16, y + 12, 12, 1);
    box(c, '#263f53', x - 13, y + 16, 8, 1);
  }
  for (let i = 0; i < 36; i++) tree(c, 425 + rng() * 42, 1647 + rng() * 100, 0, true);
  suspensionBridge(c, 488, 642, 1500, '#c3a486');
  suspensionBridge(c, 496, 642, 1260, '#91a2a2');
  suspensionBridge(c, 511, 642, 1000, '#b4a496');
  suspensionBridge(c, 508, 642, 255, '#aaa18e');
  suspensionBridge(c, 81, 315, 131, '#909e9e');
  // Liberty Island and the statue's copper silhouette: crown, tablet, raised
  // torch and robe remain separate pixel clusters even at the native scale.
  const lx = 250; const ly = 1835;
  poly(c, '#355159', [[lx - 27, ly], [lx - 12, ly - 18], [lx + 12, ly - 19], [lx + 30, ly], [lx + 16, ly + 29], [lx - 13, ly + 30]]);
  poly(c, '#75817c', [[lx - 22, ly], [lx - 10, ly - 15], [lx + 11, ly - 16], [lx + 26, ly], [lx + 12, ly + 24], [lx - 12, ly + 25]]);
  poly(c, '#3b635b', [[lx - 18, ly], [lx - 9, ly - 11], [lx + 9, ly - 12], [lx + 21, ly], [lx + 10, ly + 20], [lx - 10, ly + 20]]);
  box(c, '#7a8275', lx - 7, ly + 6, 19, 13);
  box(c, '#b0ac8f', lx - 8, ly + 1, 18, 13);
  box(c, '#c1b79a', lx - 10, ly - 1, 22, 3);
  poly(c, '#6c9988', [[lx - 3, ly - 28], [lx + 4, ly - 27], [lx + 10, ly + 1], [lx - 8, ly + 1]]);
  poly(c, '#9dbda0', [[lx - 3, ly - 28], [lx + 1, ly - 26], [lx - 1, ly + 1], [lx - 7, ly + 1]]);
  line(c, '#b5cbaa', lx - 3, ly - 22, lx - 14, ly - 44, 3);
  box(c, '#759889', lx + 5, ly - 25, 6, 12);
  box(c, '#bdd0ac', lx + 5, ly - 25, 5, 1);
  box(c, '#a4c5a7', lx - 3, ly - 35, 7, 8);
  for (const [dx, dy] of [[-5, -38], [-2, -42], [2, -43], [6, -39]]) {
    line(c, '#adc7a9', lx, ly - 33, lx + dx, ly + dy);
  }
  box(c, '#aac5a5', lx - 16, ly - 47, 5, 3);
  box(c, '#e3be85', lx - 15, ly - 52, 3, 5);
  box(c, '#f2d29b', lx - 14, ly - 53, 1, 3);
  for (let i = 0; i < 13; i++) boat(c, 150 + rng() * 107, 73 + i * 148, i % 3 ? .8 : 1.35, '#9eaeb3');
  // Piers cast little vertical trails of warm reflection into the Hudson.
  for (let y = 51; y < WORLD_H; y += 73) {
    const x = west(y);
    box(c, '#526773', x - 3, y, 23, 6);
    box(c, '#cbb690', x + 16, y + 1, 2, 2);
    for (let j = 0; j < 4; j++) box(c, ['#645f60', '#48565c', '#344a54', '#29414f'][j], x + 14 - j, y + 7 + j * 4, 5 + j * 2, 1);
  }
  return canvas;
}

function heroSprite(bank = 0, roll = false) {
  const { canvas, ctx: c } = surface(72, 72);
  const scale = roll ? Math.max(.13, Math.abs(Math.cos(bank))) : 1 - Math.abs(bank) * .055;
  const bend = roll ? Math.sin(bank) : bank * .35;
  const point = ([x, y]) => [36 + (x - 32) * scale + (32 - y) * bend * .08, y + 3 + (x - 32) * bend * .11];
  const shape = (color, points) => poly(c, color, points.map(point));
  const seam = (color, points) => outline(c, color, points.map(point), 1, false);
  const flipped = roll && Math.cos(bank) < 0;
  shape('#13253b', [[32, 5], [36, 19], [58, 35], [59, 38], [43, 42], [38, 38], [40, 48], [48, 55],
    [48, 58], [35, 58], [32, 53], [29, 58], [16, 58], [16, 55], [24, 48], [26, 38], [21, 42], [5, 38], [6, 35], [28, 19]]);
  shape(flipped ? '#728894' : '#a4b9bc', [[32, 7], [35, 20], [56, 36], [43, 39], [36, 34], [38, 49], [45, 55],
    [37, 56], [33, 51], [31, 51], [27, 56], [19, 55], [26, 49], [28, 34], [21, 39], [8, 36], [29, 20]]);
  shape(flipped ? '#516c80' : '#d1ddd3', [[31, 14], [28, 28], [10, 36], [23, 36], [29, 32], [28, 45], [32, 49], [32, 14]]);
  shape(flipped ? '#445b73' : '#92a9b2', [[33, 14], [36, 28], [54, 36], [42, 37], [35, 32], [36, 45], [32, 49], [32, 14]]);
  shape('#e4ead5', [[31, 8], [33, 16], [32, 23], [30, 19]]);
  shape('#506e80', [[28, 28], [25, 34], [16, 37], [27, 34]]);
  shape('#526d7f', [[36, 28], [39, 34], [49, 37], [37, 34]]);
  seam('#e2e8ce', [[10, 36], [26, 25], [29, 20]]);
  seam('#acc4c5', [[36, 24], [53, 36]]);
  seam('#52697c', [[23, 36], [27, 31], [29, 30]]);
  seam('#536b7e', [[40, 36], [36, 31], [34, 30]]);
  shape('#334b64', [[27, 34], [30, 38], [29, 48], [25, 44]]);
  shape('#334b64', [[37, 34], [34, 38], [35, 48], [39, 44]]);
  shape(flipped ? '#6d8291' : '#cad5c9', [[24, 40], [28, 43], [27, 53], [22, 50]]);
  shape('#849da9', [[40, 40], [36, 43], [37, 53], [42, 50]]);
  seam('#dde8d0', [[24, 41], [25, 48], [23, 50]]);
  if (!flipped) {
    shape('#18384f', [[32, 17], [35, 23], [34, 31], [30, 31], [29, 23]]);
    seam('#87d8d4', [[32, 18], [30, 23], [31, 27]]);
    seam('#457b97', [[34, 23], [33, 29]]);
  } else {
    shape('#b6c6c5', [[30, 22], [34, 22], [34, 39], [30, 39]]);
    seam('#697f8e', [[32, 25], [32, 36]]);
  }
  shape('#223b52', [[27, 48], [31, 48], [31, 54], [26, 54]]);
  shape('#223b52', [[33, 48], [37, 48], [38, 54], [33, 54]]);
  shape('#d28f64', [[27, 51], [31, 51], [31, 54], [27, 54]]);
  shape('#d28f64', [[33, 51], [37, 51], [37, 54], [33, 54]]);
  seam('#d8e4c8', [[19, 55], [26, 50]]);
  seam('#9bb6b9', [[45, 55], [38, 50]]);
  return canvas;
}

function scoutSprite(kind) {
  const big = kind === 'striker';
  const ace = kind === 'ace';
  const { canvas, ctx: c } = surface(big ? 56 : 48, big ? 56 : 48);
  const cx = canvas.width / 2; const cy = canvas.height / 2;
  const s = big ? 1.22 : ace ? 1.08 : 1;
  const p = points => points.map(([x, y]) => [cx + x * s, cy + y * s]);
  const hull = [[0, 18], [-4, 8], [-17, -2], [-17, -10], [-5, -3], [-4, -15], [4, -15], [5, -3], [17, -10], [17, -2], [4, 8]];
  poly(c, '#101b33', p(hull));
  poly(c, ace ? '#8e7eaa' : big ? '#cf9b75' : '#be857c', p([[0, 15], [-3, 7], [-15, -2], [-15, -7], [-4, 0], [-3, -13], [3, -13], [4, 0], [15, -7], [15, -2], [3, 7]]));
  poly(c, ace ? '#b4a0c1' : '#e2b58b', p([[0, 14], [-2, 6], [-13, -2], [-5, 1], [-2, -9], [0, -9]]));
  poly(c, ace ? '#5c6a95' : '#80576c', p([[0, 14], [3, 6], [14, -2], [5, 1], [2, -10], [0, -10]]));
  poly(c, '#172b43', p([[-2, 7], [-3, 1], [-2, -4], [2, -4], [3, 1], [2, 7]]));
  line(c, ace ? '#9fe6de' : '#ffc483', cx - 1, cy + 4 * s, cx - 1, cy - s, 1);
  line(c, '#f2c8a1', cx - 15 * s, cy - 5 * s, cx - 5 * s, cy + 2 * s);
  line(c, ace ? '#bb95ce' : '#db897f', cx + 15 * s, cy - 5 * s, cx + 5 * s, cy + 2 * s);
  for (const sign of [-1, 1]) {
    box(c, '#23374e', cx + sign * 7 * s - 1, cy - 11 * s, 3, 10);
    box(c, ace ? '#9dd7db' : '#ff9c77', cx + sign * 7 * s, cy - 13 * s, 2, 3);
    box(c, '#17293f', cx + sign * 12 * s - 1, cy - s, 2, 5);
  }
  return canvas;
}

function gunshipSprite() {
  const { canvas, ctx: c } = surface(80, 76);
  const p = points => points.map(([x, y]) => [40 + x, 35 + y]);
  poly(c, '#101b31', p([[-31, -10], [-24, -18], [-12, -13], [-8, -26], [8, -26], [12, -13], [24, -18],
    [31, -10], [31, 17], [23, 22], [17, 17], [9, 14], [5, 28], [-5, 28], [-9, 14], [-17, 17], [-23, 22], [-31, 17]]));
  poly(c, '#767f89', p([[-29, -10], [-23, -15], [-10, -10], [-6, -24], [6, -24], [10, -10], [23, -15],
    [29, -10], [29, 15], [23, 19], [17, 14], [7, 10], [4, 25], [-4, 25], [-7, 10], [-17, 14], [-23, 19], [-29, 15]]));
  poly(c, '#9eaaae', p([[-28, -9], [-22, -13], [-9, -8], [-4, -20], [0, -20], [0, 20], [-5, 11], [-17, 11], [-23, 17], [-28, 13]]));
  poly(c, '#4e637a', p([[2, -21], [5, -20], [9, -8], [23, -12], [27, -9], [27, 13], [22, 16], [17, 11], [5, 8], [3, 24]]));
  for (const sign of [-1, 1]) {
    const x = 40 + sign * 23;
    box(c, '#172e46', x - 4, 20, 8, 24);
    box(c, '#bd8b77', x - 3, 18, 6, 19);
    box(c, '#e1b794', x - 3, 18, 2, 18);
    box(c, '#f0ad7c', x - 2, 17, 4, 2);
    box(c, '#101f37', x - 2, 41, 4, 13);
    box(c, '#b5a18c', x - 2, 41, 1, 11);
    box(c, '#c86f72', x - 4, 36, 8, 2);
    line(c, '#3d566e', 40 + sign * 9, 26, x - sign * 5, 31);
    box(c, '#ddc5a2', 40 + sign * 13 - 1, 30, 3, 2);
  }
  poly(c, '#1b344c', [[37, 31], [43, 31], [44, 44], [40, 51], [36, 44]]);
  box(c, '#e1b780', 38, 34, 2, 9);
  line(c, '#cbd5c0', 37, 12, 35, 23);
  return canvas;
}

function bossSprite(kind) {
  const width = kind === 'carrier' ? 176 : kind === 'mantis' ? 186 : 214;
  const { canvas, ctx: c } = surface(width, 134);
  const cx = width / 2; const cy = 65;
  const p = points => points.map(([x, y]) => [cx + x, cy + y]);
  const shape = (color, points) => poly(c, color, p(points));
  const stroke = (color, points, weight = 1) => outline(c, color, p(points), weight, false);
  if (kind === 'carrier') {
    shape('#0a142b', [[-74, -16], [-70, -33], [-32, -21], [-24, -45], [-9, -47], [-6, -33], [6, -33], [9, -47], [24, -45],
      [32, -21], [70, -33], [74, -16], [71, 25], [59, 36], [47, 31], [23, 16], [14, 44], [-14, 44], [-23, 16], [-47, 31], [-59, 36], [-71, 25]]);
    shape('#5f7184', [[-72, -16], [-68, -30], [-30, -18], [-22, -42], [-11, -44], [-8, -30], [8, -30], [11, -44], [22, -42],
      [30, -18], [68, -30], [72, -16], [69, 23], [59, 32], [47, 28], [21, 12], [12, 40], [-12, 40], [-21, 12], [-47, 28], [-59, 32], [-69, 23]]);
    shape('#9ba9ae', [[-70, -16], [-67, -28], [-28, -15], [-20, -39], [-13, -41], [-9, -24], [0, -22], [0, 37], [-10, 37], [-19, 9], [-48, 25], [-59, 28], [-66, 20]]);
    shape('#425872', [[2, -24], [9, -24], [13, -41], [20, -38], [28, -15], [67, -28], [70, -16], [66, 20], [59, 28], [48, 25], [19, 9], [10, 37], [2, 37]]);
    stroke('#d4dbca', [[-68, -26], [-28, -12], [-20, -38]]);
    stroke('#a9b9b8', [[28, -12], [67, -26]]);
    for (const sign of [-1, 1]) {
      const x = cx + sign * 56;
      box(c, '#152b45', x - 8, cy - 22, 16, 42);
      box(c, '#768392', x - 7, cy - 24, 14, 38);
      box(c, '#b7b6ac', x - 7, cy - 24, 3, 35);
      box(c, '#ffad79', x - 6, cy - 27, 12, 3);
      box(c, '#d57d73', x - 7, cy + 2, 14, 4);
      box(c, '#1a2942', x - 5, cy + 14, 10, 16);
      for (let q = 0; q < 3; q++) box(c, '#ced0b7', x - 3 + q * 3, cy + 16, 1, 12);
      const tx = cx + sign * 30;
      box(c, '#18283f', tx - 7, cy - 7, 14, 15);
      box(c, '#5e7487', tx - 6, cy - 9, 12, 13);
      box(c, '#b2b9b1', tx - 5, cy - 9, 9, 2);
      box(c, '#d7b581', tx - 2, cy - 2, 4, 12);
      box(c, '#1a2d46', cx + sign * 13 - 2, cy - 31, 4, 38);
      box(c, '#b98974', cx + sign * 13 - 1, cy - 30, 2, 11);
    }
    shape('#263f58', [[-8, -12], [8, -12], [7, 24], [0, 33], [-7, 24]]);
    shape('#78aaae', [[-5, -10], [5, -10], [4, 0], [-4, 0]]);
    stroke('#bbddd0', [[-4, -8], [-4, -1], [3, -1]]);
    for (let i = 0; i < 5; i++) box(c, '#7c929e', cx - 3, cy + 5 + i * 4, 6, 1);
  } else if (kind === 'mantis') {
    shape('#1d1931', [[-79, -40], [-62, -39], [-46, -22], [-25, -11], [-16, -45], [16, -45], [25, -11], [46, -22], [62, -39],
      [79, -40], [77, -4], [58, 6], [78, 26], [72, 47], [55, 38], [38, 9], [16, 22], [7, 47], [-7, 47], [-16, 22], [-38, 9], [-55, 38], [-72, 47], [-78, 26], [-58, 6], [-77, -4]]);
    shape('#a77773', [[-76, -37], [-63, -36], [-46, -18], [-22, -7], [-13, -41], [13, -41], [22, -7], [46, -18], [63, -36],
      [76, -37], [74, -6], [52, 6], [75, 27], [69, 42], [58, 35], [39, 5], [14, 19], [5, 42], [-5, 42], [-14, 19], [-39, 5], [-58, 35], [-69, 42], [-75, 27], [-52, 6], [-74, -6]]);
    shape('#d2a085', [[-74, -35], [-64, -33], [-46, -15], [-20, -3], [-11, -38], [0, -38], [0, 35], [-4, 39], [-11, 16], [-40, 1], [-60, 33], [-69, 36], [-70, 28], [-47, 5], [-71, -8]]);
    shape('#785a73', [[3, -38], [11, -38], [20, -3], [46, -15], [65, -33], [73, -34], [71, -8], [47, 5], [70, 28], [69, 36], [60, 33], [40, 1], [11, 16], [4, 39], [1, 34]]);
    for (const sign of [-1, 1]) {
      stroke('#ebbe95', [[sign * 74, -35], [sign * 71, -10], [sign * 49, 3]]);
      stroke('#463d59', [[sign * 66, -29], [sign * 63, -13], [sign * 34, 0]], 2);
      stroke('#e09b87', [[sign * 62, 34], [sign * 44, 6]]);
      box(c, '#302641', cx + sign * 62 - 4, cy - 32, 8, 22);
      box(c, '#f89c82', cx + sign * 62 - 3, cy - 33, 6, 3);
      box(c, '#1c2944', cx + sign * 63 - 4, cy + 26, 8, 15);
      box(c, '#ac6b8a', cx + sign * 63 - 2, cy + 27, 4, 13);
      box(c, '#f1bb95', cx + sign * 26 - 2, cy - 2, 4, 4);
    }
    shape('#302b48', [[-11, -21], [0, -28], [11, -21], [10, 8], [0, 17], [-10, 8]]);
    shape('#754f73', [[-7, -17], [0, -22], [7, -17], [7, 3], [0, 10], [-7, 3]]);
    shape('#e98c9f', [[-4, -13], [0, -18], [4, -13], [4, 0], [0, 5], [-4, 0]]);
    box(c, '#ffe1b9', cx - 1, cy - 11, 2, 10);
  } else if (kind === 'sentinel') {
    // A fourth, unmistakable silhouette: four armored quadrants surrounding a
    // diamond reactor. Broad ivory shields contrast with the spring parkland.
    shape('#151c32', [[0, -56], [26, -35], [47, -37], [65, -52], [92, -32], [96, 9], [80, 22],
      [87, 41], [65, 51], [39, 25], [22, 35], [0, 58], [-22, 35], [-39, 25], [-65, 51],
      [-87, 41], [-80, 22], [-96, 9], [-92, -32], [-65, -52], [-47, -37], [-26, -35]]);
    shape('#62717e', [[0, -52], [25, -31], [49, -33], [65, -48], [88, -30], [92, 7], [75, 21],
      [82, 39], [66, 46], [40, 20], [20, 32], [0, 53], [-20, 32], [-40, 20], [-66, 46],
      [-82, 39], [-75, 21], [-92, 7], [-88, -30], [-65, -48], [-49, -33], [-25, -31]]);
    for (const sign of [-1, 1]) {
      shape(sign < 0 ? '#d3ceae' : '#9aa9a1', [[sign * 30, -27], [sign * 50, -29], [sign * 65, -44],
        [sign * 84, -29], [sign * 88, 4], [sign * 67, 17], [sign * 38, 9]]);
      shape(sign < 0 ? '#b4b6a1' : '#758a91', [[sign * 42, 14], [sign * 67, 21],
        [sign * 76, 37], [sign * 67, 41], [sign * 47, 21]]);
      stroke('#efdfb8', [[sign * 32, -25], [sign * 50, -27], [sign * 65, -41], [sign * 81, -28]]);
      stroke('#34495c', [[sign * 56, -20], [sign * 70, -25], [sign * 75, -13], [sign * 67, -6], [sign * 53, -10]], 3);
      shape('#49556c', [[sign * 30, -16], [sign * 45, -18], [sign * 55, -3], [sign * 41, 12], [sign * 30, 6]]);
      const x = cx + sign * 70;
      box(c, '#27384e', x - 5, cy + 4, 10, 25);
      box(c, '#bd899a', x - 3, cy + 5, 6, 21);
      box(c, '#f0bdac', x - 2, cy + 23, 4, 6);
      box(c, '#26384d', x - 7, cy - 36, 14, 5);
      box(c, '#a5d3c7', x - 6, cy - 36, 12, 2);
      stroke('#d2bd9e', [[sign * 84, -22], [sign * 85, 3], [sign * 71, 12]]);
    }
    shape('#263b52', [[0, -46], [24, -24], [24, 22], [0, 47], [-24, 22], [-24, -24]]);
    shape('#7d9296', [[0, -42], [18, -22], [18, 19], [0, 40], [-18, 19], [-18, -22]]);
    shape('#bfd0b9', [[0, -37], [13, -20], [13, 14], [0, 32], [-13, 14], [-13, -20]]);
    shape('#46576d', [[0, -28], [9, -16], [9, 10], [0, 22], [-9, 10], [-9, -16]]);
    shape('#a67291', [[0, -22], [5, -13], [5, 7], [0, 14], [-5, 7], [-5, -13]]);
    box(c, '#f2c4b9', cx - 2, cy - 13, 4, 17);
    box(c, '#ffe0bd', cx - 1, cy - 10, 2, 10);
    stroke('#f0dab1', [[0, -49], [-19, -27]]);
  } else {
    shape('#091329', [[0, -51], [21, -29], [46, -21], [72, -45], [92, -41], [96, 17], [82, 37], [67, 26], [52, 11],
      [35, 24], [18, 28], [7, 50], [-7, 50], [-18, 28], [-35, 24], [-52, 11], [-67, 26], [-82, 37], [-96, 17], [-92, -41], [-72, -45], [-46, -21], [-21, -29]]);
    shape('#596987', [[0, -48], [20, -26], [47, -17], [73, -41], [89, -38], [92, 16], [81, 32], [69, 22], [52, 7],
      [34, 20], [16, 25], [5, 46], [-5, 46], [-16, 25], [-34, 20], [-52, 7], [-69, 22], [-81, 32], [-92, 16], [-89, -38], [-73, -41], [-47, -17], [-20, -26]]);
    shape('#8794a5', [[-1, -46], [-19, -23], [-47, -13], [-74, -38], [-86, -35], [-88, 15], [-80, 27], [-69, 19], [-52, 3], [-32, 17], [-14, 21], [-3, 41], [-1, 41]]);
    shape('#384965', [[2, -46], [19, -23], [47, -13], [74, -38], [86, -35], [88, 15], [80, 27], [69, 19], [52, 3], [32, 17], [14, 21], [3, 41]]);
    for (const sign of [-1, 1]) {
      shape('#263c59', [[sign * 25, -14], [sign * 48, -6], [sign * 70, -26], [sign * 76, -24], [sign * 60, 1], [sign * 48, 0], [sign * 30, 12]]);
      stroke('#a0c4c4', [[sign * 86, -35], [sign * 87, 14], [sign * 80, 25]]);
      stroke('#566f87', [[sign * 75, -33], [sign * 49, -9], [sign * 26, -18]]);
      const x = cx + sign * 79;
      box(c, '#132e47', x - 5, cy - 31, 10, 31);
      box(c, '#94d1cc', x - 4, cy - 32, 8, 3);
      for (let q = 0; q < 4; q++) box(c, '#3e5b72', x - 3, cy - 25 + q * 5, 6, 2);
      box(c, '#12243d', x - 4, cy + 9, 8, 17);
      box(c, '#c88ea6', x - 2, cy + 10, 4, 17);
      box(c, '#ffd0b6', x - 1, cy + 19, 2, 6);
      box(c, '#0d223b', cx + sign * 26 - 6, cy + 2, 12, 15);
      box(c, '#819aac', cx + sign * 26 - 5, cy, 10, 11);
      box(c, '#b0ced0', cx + sign * 26 - 5, cy, 8, 2);
      box(c, '#ffb79a', cx + sign * 26 - 2, cy + 7, 4, 11);
    }
    shape('#1b304b', [[0, -30], [12, -14], [9, 18], [0, 34], [-9, 18], [-12, -14]]);
    shape('#597092', [[0, -24], [7, -12], [5, 14], [0, 25], [-5, 14], [-7, -12]]);
    shape('#9bc9ce', [[0, -20], [4, -11], [3, 5], [0, 9], [-3, 5], [-4, -11]]);
    box(c, '#e6e8d9', cx - 1, cy - 15, 2, 17);
    stroke('#d1dacf', [[0, -47], [-10, -30]]);
  }
  return canvas;
}

function explosionFrames() {
  const frames = [];
  const rng = random(982);
  const sparks = Array.from({ length: 18 }, (_, i) => ({ a: i * TAU / 18 + rng() * .18, r: .55 + rng() * .45, s: 2 + Math.floor(rng() * 5) }));
  for (let f = 0; f < 8; f++) {
    const { canvas, ctx: c } = surface(72, 72);
    const t = f / 7;
    const radius = 7 + Math.sin(t * 2.05) * 22;
    const points = sparks.map(s => [36 + Math.cos(s.a) * radius * s.r, 36 + Math.sin(s.a) * radius * s.r]);
    poly(c, f < 4 ? '#ad4b67' : '#64536f', points);
    poly(c, f < 4 ? '#f27e6c' : '#9e646f', points.map(([x, y]) => [36 + (x - 36) * .78, 36 + (y - 36) * .78]));
    if (f < 5) {
      poly(c, '#ffc283', points.map(([x, y]) => [36 + (x - 36) * .59, 36 + (y - 36) * .59]));
      poly(c, '#fff1be', points.map(([x, y]) => [36 + (x - 36) * .33, 36 + (y - 36) * .33]));
    }
    for (const s of sparks) {
      const r = 7 + f * 3.5 * s.r;
      const size = Math.max(1, s.s - f * .45);
      box(c, f < 5 ? '#ffd19a' : '#c4867c', 36 + Math.cos(s.a) * r, 36 + Math.sin(s.a) * r, size, size);
    }
    if (f > 4) {
      c.globalCompositeOperation = 'destination-out';
      poly(c, '#000', points.map(([x, y]) => [36 + (x - 36) * (f - 4) * .25, 36 + (y - 36) * (f - 4) * .25]));
      c.globalCompositeOperation = 'source-over';
    }
    frames.push(canvas);
  }
  return frames;
}

function cloudSprite() {
  const { canvas, ctx: c } = surface(174, 74);
  const lobes = [[5, 32, 29, 19], [24, 17, 48, 31], [56, 9, 46, 39], [87, 22, 53, 32], [129, 36, 36, 17]];
  for (const [x, y, w, h] of lobes) {
    box(c, '#779fa5', x + 7, y + 9, w, h - 4);
    box(c, '#b3c9c0', x + 3, y + 4, w, h - 4);
    box(c, '#dbe0c8', x + 3, y, w - 7, h - 6);
    box(c, '#e7e8d1', x + 7, y, w - 15, 7);
  }
  return canvas;
}

function spriteShadow(sprite) {
  const { canvas, ctx: c } = surface(sprite.width, sprite.height);
  c.drawImage(sprite, 0, 0);
  c.globalCompositeOperation = 'source-in';
  box(c, '#07172c', 0, 0, canvas.width, canvas.height);
  return canvas;
}

function flashSprite(sprite, strength = .48) {
  const { canvas, ctx: c } = surface(sprite.width, sprite.height);
  c.drawImage(sprite, 0, 0);
  c.globalCompositeOperation = 'source-atop';
  c.globalAlpha = strength;
  box(c, '#fff2cd', 0, 0, canvas.width, canvas.height);
  return canvas;
}

function drawPickup(c, p, time, reducedMotion) {
  const x = Math.round(p.x); const y = Math.round(p.y + (reducedMotion ? 0 : Math.sin(time * 4 + p.x) * 2));
  const color = p.kind === 'repair' ? '#ffb5bd' : p.kind === 'power' ? '#a8efe0' : '#ffe0a3';
  const edge = p.kind === 'repair' ? '#a45b80' : p.kind === 'power' ? '#3f8a9f' : '#af805e';
  poly(c, '#122d44', [[x, y - 12], [x + 12, y], [x, y + 12], [x - 12, y]]);
  poly(c, edge, [[x, y - 10], [x + 10, y], [x, y + 10], [x - 10, y]]);
  poly(c, '#243c51', [[x, y - 8], [x + 8, y], [x, y + 8], [x - 8, y]]);
  if (p.kind === 'repair') {
    box(c, color, x - 2, y - 5, 4, 10);
    box(c, color, x - 5, y - 2, 10, 4);
  } else if (p.kind === 'power') {
    poly(c, color, [[x + 1, y - 6], [x - 4, y + 1], [x, y + 1], [x - 1, y + 6], [x + 5, y - 1], [x + 1, y - 1]]);
  } else {
    poly(c, color, [[x, y - 6], [x + 2, y - 2], [x + 6, y - 2], [x + 3, y + 1], [x + 4, y + 5], [x, y + 3], [x - 4, y + 5], [x - 3, y + 1], [x - 6, y - 2], [x - 2, y - 2]]);
  }
  if (Math.floor(time * 3 + p.x) % 3 === 0) {
    box(c, '#f2f1ce', x + 10, y - 11, 1, 5);
    box(c, '#f2f1ce', x + 8, y - 9, 5, 1);
  }
}

function drawBullet(c, b, time) {
  const x = Math.round(b.x); const y = Math.round(b.y);
  const vx = b.vx || 0; const vy = b.vy || (b.side === 'player' ? -400 : 170);
  const length = b.kind === 'missile' ? 14 : b.side === 'player' ? 9 : 4;
  const speed = Math.hypot(vx, vy) || 1;
  const dx = vx / speed; const dy = vy / speed;
  if (b.side === 'player') {
    if (b.kind === 'missile') {
      line(c, '#183e53', x - dx * 19, y - dy * 19, x, y, 5);
      line(c, '#348597', x - dx * 16, y - dy * 16, x, y, 3);
      line(c, '#a5e9db', x - dx * 10, y - dy * 10, x + dx * 2, y + dy * 2, 3);
      line(c, '#fff0c9', x - dx * 3, y - dy * 3, x + dx * 3, y + dy * 3, 1);
      const flame = 4 + (Math.floor(time * 15) % 3) * 2;
      line(c, '#ffc997', x - dx * 12, y - dy * 12, x - dx * (12 + flame), y - dy * (12 + flame), 2);
    } else {
      line(c, '#244859', x, y + 2, x - dx * length, y - dy * length + 2, 4);
      line(c, '#72c7ca', x, y, x - dx * length, y - dy * length, 3);
      line(c, '#f0f4d3', x, y, x - dx * (length - 2), y - dy * (length - 2), 1);
    }
  } else {
    const r = Math.max(3, Math.min(7, b.r || 3));
    box(c, '#15283e', x - r - 1, y - r, r * 2 + 3, r * 2 + 1);
    box(c, '#15283e', x - r, y - r - 1, r * 2 + 1, r * 2 + 3);
    box(c, b.color || '#ff7f88', x - r + 1, y - r, r * 2 - 1, r * 2 + 1);
    box(c, b.color || '#ff7f88', x - r, y - r + 1, r * 2 + 1, r * 2 - 1);
    box(c, '#fff1cd', x - 1, y - 2, 2, 3);
    box(c, '#ffd3aa', x, y + 1, 2, 1);
  }
}

function drawTelegraph(c, t, time, reducedMotion) {
  const remaining = Math.max(0, Math.min(1, t.life / (t.maxLife || 1)));
  const color = t.color || '#ffb196';
  c.globalAlpha = reducedMotion ? .65 : .45 + (1 - remaining) * .4;
  if (t.kind === 'circle') {
    pixelRing(c, color, t.x, t.y, t.r || 30, 1, true);
    pixelRing(c, color, t.x, t.y, (t.r || 30) * remaining, 1);
    line(c, color, t.x - 4, t.y, t.x + 4, t.y);
    line(c, color, t.x, t.y - 4, t.x, t.y + 4);
  } else {
    const x2 = t.x2 ?? t.x; const y2 = t.y2 ?? H;
    const dx = x2 - t.x; const dy = y2 - t.y;
    const length = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < length; i += 13) {
      const start = Math.min(length, i + (reducedMotion ? 0 : time * 12 % 9));
      const end = Math.min(length, start + 6);
      line(c, color, t.x + dx * start / length, t.y + dy * start / length, t.x + dx * end / length, t.y + dy * end / length);
    }
    pixelRing(c, color, x2, Math.min(H - 10, y2), 7, 1);
  }
  c.globalAlpha = 1;
}

/** Return a deterministic, allocation-light painter for the arcade simulation. */
export function createRenderer(canvas) {
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d', { alpha: false });
  c.imageSmoothingEnabled = false;
  const worlds = [drawHarbor(), ...createCityScenes({ surface, random, box, poly, line, outline, tree, boat })];
  const sprites = {
    scout: scoutSprite('scout'), striker: scoutSprite('striker'), ace: scoutSprite('ace'), gunship: gunshipSprite(),
    carrier: bossSprite('carrier'), mantis: bossSprite('mantis'), leviathan: bossSprite('leviathan'),
    sentinel: bossSprite('sentinel'),
  };
  const shadows = {}; const flashes = {};
  for (const [key, sprite] of Object.entries(sprites)) {
    shadows[key] = spriteShadow(sprite);
    const boss = STAGES.some(stage => stage.bossType === key);
    flashes[key] = flashSprite(sprite, boss ? .28 : .48);
  }
  const heroes = [-2, -1, 0, 1, 2].map(bank => heroSprite(bank));
  const rolls = Array.from({ length: 12 }, (_, i) => heroSprite(i / 12 * TAU, true));
  const heroShadows = heroes.map(spriteShadow);
  const explosions = explosionFrames();
  const cloud = cloudSprite();
  const cloudShadow = spriteShadow(cloud);
  let previousX = 320;
  let previousTime = 0;
  let bank = 0;
  let destroyed = false;
  let lastStage = -1;

  function render(state, { attract = false, reducedMotion = false } = {}) {
    if (destroyed) return;
    const time = Number.isFinite(state?.time) ? state.time : 0;
    const stage = Math.max(0, Math.min(STAGES.length - 1, Math.floor(state?.stage || 0)));
    const scroll = Number.isFinite(state?.scroll) ? state.scroll : time * 25;
    // Cached authored strips traverse once, bottom to top, and hold at the boss.
    // No modulo means a long boss fight never repeats Liberty or the Capitol.
    const offset = attract ? CITY_VISTAS[stage]
      : cityCameraOffset(state?.stageTime, STAGES[stage].duration);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.drawImage(worlds[stage], 0, -Math.floor(offset));
    // Shadowed wisps travel on a separate depth plane. Their broad placement
    // protects the central aiming lane, including the tiny player hitbox.
    if (stage === 1) {
      for (let i = 0; i < 3; i++) {
        const x = i % 2 ? 508 : -80 + i * 11;
        const y = (((reducedMotion ? 0 : scroll) * .88 + i * 177) % 650) - 160;
        c.globalAlpha = .14;
        c.drawImage(cloudShadow, x + 24, Math.round(y + 31));
        c.globalAlpha = .28;
        c.drawImage(cloud, x, Math.round(y));
      }
      c.globalAlpha = 1;
    }
    // Harbor rain is a sparse hand-placed lattice. It never strobes or obscures
    // danger bullets; reduced motion freezes the decorative weather.
    if (stage === 0) {
      c.globalAlpha = .22;
      const rainTime = reducedMotion ? 0 : time;
      for (let i = 0; i < 35; i++) {
        const x = (i * 137 + Math.floor(rainTime * 9)) % 660 - 10;
        const y = (i * 71 + Math.floor(rainTime * 91)) % 420 - 10;
        line(c, '#7691a4', x, y, x - 2, y + 6);
      }
      c.globalAlpha = 1;
    }

    for (const t of state?.telegraphs || []) drawTelegraph(c, t, time, reducedMotion);
    for (const p of state?.pickups || []) drawPickup(c, p, time, reducedMotion);

    const enemies = state?.enemies || [];
    // All altitude shadows precede all aircraft, so one plane cannot paint its
    // shadow over another plane at the same altitude.
    c.globalAlpha = .32;
    for (const enemy of enemies) {
      const key = enemy.kind === 'boss' ? enemy.bossType || STAGES[stage].bossType : enemy.kind;
      const sprite = shadows[key] || shadows.scout;
      c.drawImage(sprite, Math.round(enemy.x - sprite.width / 2 + 12), Math.round(enemy.y - sprite.height / 2 + 20));
    }
    c.globalAlpha = 1;
    for (const enemy of enemies) {
      const key = enemy.kind === 'boss' ? enemy.bossType || STAGES[stage].bossType : enemy.kind;
      const sprite = (enemy.flash > 0 && !reducedMotion ? flashes[key] : sprites[key]) || sprites.scout;
      const x = Math.round(enemy.x); const y = Math.round(enemy.y);
      if (enemy.kind !== 'boss') {
        const spread = enemy.kind === 'gunship' ? 23 : 7;
        const top = enemy.kind === 'gunship' ? -19 : enemy.kind === 'striker' ? -19 : -16;
        const flame = 3 + Math.floor(time * 18 + (enemy.id || 0)) % 3;
        for (const sign of [-1, 1]) {
          box(c, '#af625f', x + sign * spread - 1, y + top - flame, 3, flame);
          box(c, '#f2bb83', x + sign * spread, y + top - flame + 1, 1, flame - 1);
        }
      }
      c.drawImage(sprite, x - sprite.width / 2, y - sprite.height / 2);
      if (enemy.kind !== 'boss' && enemy.windup > 0) {
        // A single smooth charge at the actual firing origin announces an
        // ordinary volley. No blink or expanding effect in reduced mode.
        const strength = Math.max(0, Math.min(1, enemy.windup));
        const muzzleY = Math.round(y + (enemy.r || 11) * .55);
        const radius = reducedMotion ? 2 : 1 + Math.floor(strength * 2);
        c.globalAlpha = reducedMotion ? .8 : .4 + strength * .6;
        box(c, '#283449', x - radius - 1, muzzleY - radius - 1, radius * 2 + 3, radius * 2 + 3);
        box(c, '#f0a477', x - radius, muzzleY - radius, radius * 2 + 1, radius * 2 + 1);
        box(c, '#fff0bd', x, muzzleY - 1, 1, 3);
        box(c, '#fff0bd', x - 1, muzzleY, 3, 1);
        c.globalAlpha = 1;
      }
      if (enemy.kind === 'boss' && enemy.windup > 0) {
        const strength = Math.max(0, Math.min(1, enemy.windup));
        c.globalAlpha = .45 + strength * .5;
        pixelRing(c, stage === 2 ? '#ffc199' : '#b3eee0', x, y - 5, 10 + (1 - strength) * 18, 1, true);
        box(c, '#fff0c9', x - 1, y - 7, 3, 4);
        c.globalAlpha = 1;
      }
    }

    const player = state?.player || { x: 320, y: 309, hp: 100, maxHp: 100 };
    const px = Math.round(player.x ?? 320); const py = Math.round(player.y ?? 309);
    if (lastStage !== stage || time < previousTime) { previousX = px; bank = 0; }
    const dt = Math.max(.001, Math.min(.1, time - previousTime));
    const wantedBank = (px - previousX) / dt;
    bank += (Math.max(-2, Math.min(2, wantedBank / 105)) - bank) * Math.min(1, dt * 13);
    const pose = Math.max(0, Math.min(4, Math.round(bank) + 2));
    const rolling = player.rollTime > 0;
    const rollIndex = Math.min(11, Math.floor((1 - Math.min(.52, player.rollTime || 0) / .52) * 12));
    const playerSprite = rolling && !reducedMotion ? rolls[rollIndex] : heroes[pose];
    if ((player.hp ?? 1) > 0 || attract) {
      c.globalAlpha = .36;
      c.drawImage(heroShadows[pose], px - 36 + 13, py - 36 + 23);
      c.globalAlpha = 1;
      const flame = reducedMotion ? 6 : 5 + Math.floor(time * 22) % 4 * 2;
      const engineWidth = rolling && !reducedMotion ? Math.max(1, Math.round(Math.abs(Math.cos(rollIndex / 12 * TAU)) * 5)) : 5;
      for (const sign of [-1, 1]) {
        const ex = px + sign * engineWidth;
        box(c, '#375574', ex - 2, py + 22, 4, flame + 7);
        box(c, '#e3a27e', ex - 2, py + 21, 4, flame);
        box(c, '#ffe1a5', ex - 1, py + 21, 2, Math.max(3, flame - 2));
        box(c, '#eff5d6', ex - 1, py + 21, 2, 3);
        if (!reducedMotion) box(c, '#93c6c7', ex, py + 31 + flame, 1, 2);
      }
      if (rolling) {
        c.globalAlpha = .18;
        c.drawImage(heroes[pose], px - 36 - bank * 8, py - 33);
        c.drawImage(heroes[pose], px - 36 - bank * 14, py - 29);
        c.globalAlpha = 1;
      }
      c.drawImage(playerSprite, px - 36, py - 36);
      if (player.invulnerable > 0 || rolling) {
        c.globalAlpha = reducedMotion ? .8 : .55 + Math.sin(time * 12) * .15;
        pixelRing(c, '#b3f0de', px, py, rolling ? 28 : 25, 1, true);
        c.globalAlpha = 1;
      }
      // A quiet, exact collision center makes threading a bullet pattern fair.
      box(c, '#142b42', px - 2, py - 2, 5, 5);
      box(c, '#ecf4d1', px - 1, py - 1, 3, 3);
    }
    previousX = px; previousTime = time; lastStage = stage;

    for (const bullet of state?.bullets || []) {
      if (bullet.side === 'player') drawBullet(c, bullet, time);
    }
    for (const p of state?.particles || []) {
      const age = 1 - Math.max(0, Math.min(1, p.life / (p.maxLife || 1)));
      if (p.kind === 'explosion') {
        const frame = explosions[Math.min(7, Math.floor(age * 8))];
        const size = Math.round(Math.max(28, (p.size || 28) * 2));
        c.globalAlpha = age > .7 ? (1 - age) / .3 : 1;
        c.drawImage(frame, Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
      } else {
        const size = Math.max(1, Math.round((p.size || 2) * (1 - age * .45)));
        c.globalAlpha = age > .6 ? (1 - age) / .4 : 1;
        const x = Math.round(p.x); const y = Math.round(p.y);
        const color = p.color || '#ffd19a';
        if (size >= 3) box(c, '#553e59', x - 1, y, size + 2, size + 1);
        box(c, color, x, y, size, size);
        if (size >= 3 && age < .35) box(c, '#fff0c3', x, y, Math.max(1, size - 1), 1);
      }
    }
    c.globalAlpha = 1;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const f of state?.floaters || []) {
      c.globalAlpha = Math.min(1, (f.life || 0) * 3);
      c.font = `${f.size || 10}px Pixel, monospace`;
      c.fillStyle = '#11273d';
      c.fillText(f.text, Math.round(f.x) + 1, Math.round(f.y) + 2);
      c.fillStyle = f.color || '#fff0c5';
      c.fillText(f.text, Math.round(f.x), Math.round(f.y));
    }
    c.globalAlpha = 1;
    // A live hazard always wins the paint order. Explosions and score labels may
    // be spectacular, but neither can hide a shot the pilot still has to dodge.
    for (const bullet of state?.bullets || []) {
      if (bullet.side !== 'player') drawBullet(c, bullet, time);
    }
  }

  return {
    render,
    destroy() {
      destroyed = true;
      for (const asset of [...worlds, ...Object.values(sprites), ...Object.values(shadows), ...Object.values(flashes), ...heroes, ...rolls, ...heroShadows, ...explosions, cloud, cloudShadow]) {
        asset.width = 1; asset.height = 1;
      }
    },
  };
}
