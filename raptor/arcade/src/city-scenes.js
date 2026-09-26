/**
 * Authored flight routes, painted once at native resolution. Geography is
 * deliberately compressed for a northbound arcade sortie; landmarks occur once.
 * The renderer supplies its integer-only drawing primitives so scenery and
 * aircraft share exactly the same pixel edges.
 */
export const CITY_HEIGHT = 2048;
export const CITY_IDS = Object.freeze(['new-york', 'san-francisco', 'austin', 'washington-dc']);
export const CITY_VISTAS = Object.freeze([1370, 60, 1260, 745]);

/** Complete the authored route before the boss, then hold its final composition. */
export function cityCameraOffset(stageTime, duration) {
  const elapsed = Number.isFinite(stageTime) ? Math.max(0, stageTime) : 0;
  const length = Number.isFinite(duration) && duration > 0 ? duration : 1;
  return Math.floor((CITY_HEIGHT - 400) * (1 - Math.min(1, elapsed / length)));
}

export function createCityScenes({ surface, random, box, poly, line, outline, tree, boat }) {
  const W = 640;
  const H = CITY_HEIGHT;

  function water(c, rng, predicate, colors, count = 4700) {
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rng() * W); const y = Math.floor(rng() * H);
      if (!predicate(x, y)) continue;
      const width = 3 + Math.floor(rng() * 14);
      box(c, colors[i % colors.length], x, y, width, 1);
      if (i % 5 === 0) box(c, colors[i % colors.length], x + 3, y + 2, width - 2, 1);
    }
  }

  function building(c, rng, x, y, w, h, palette, elevation = 7) {
    box(c, palette.shadow, x + 7, y + 8, w + 2, h + elevation);
    box(c, palette.wall, x, y + h - 1, w + 3, elevation + 2);
    box(c, palette.side, x + w - 1, y + 2, 4, h + elevation);
    box(c, palette.roofs[Math.floor(rng() * palette.roofs.length)], x, y, w, h);
    box(c, palette.light, x, y, w, 1);
    box(c, palette.side, x + 3, y + 3, w - 6, h - 6);
    box(c, palette.roofs[0], x + 4, y + 4, w - 8, h - 8);
    if (w > 16) {
      box(c, palette.wall, x + 6, y + 5, 5, 4);
      box(c, palette.light, x + 6, y + 5, 4, 1);
    }
    for (let wy = 3; wy < elevation; wy += 4) {
      for (let wx = 3; wx < w - 2; wx += 5) {
        box(c, rng() > .3 ? palette.window : palette.side, x + wx, y + h + wy, 2, 1);
      }
    }
  }

  function avenue(c, x0, y0, x1, y1, color, pavement, width = 14) {
    line(c, pavement, x0, y0, x1, y1, width + 4);
    line(c, color, x0, y0, x1, y1, width);
    const distance = Math.hypot(x1 - x0, y1 - y0);
    for (let t = 5; t < distance - 4; t += 20) {
      line(c, pavement, x0 + (x1 - x0) * t / distance, y0 + (y1 - y0) * t / distance,
        x0 + (x1 - x0) * (t + 5) / distance, y0 + (y1 - y0) * (t + 5) / distance);
    }
  }

  function dome(c, x, y, radius, colors) {
    // Rectangular tiers keep a copper or limestone dome legible at 1:1 scale.
    const [shadow, wall, top, light] = colors;
    box(c, shadow, x - radius + 4, y + 6, radius * 2 + 4, radius + 6);
    box(c, wall, x - radius, y + 4, radius * 2, radius);
    poly(c, top, [[x - radius, y + 5], [x - radius + 3, y - 5], [x - radius + 8, y - 12],
      [x - 7, y - 18], [x + 7, y - 18], [x + radius - 8, y - 12], [x + radius - 3, y - 5], [x + radius, y + 5]]);
    poly(c, wall, [[x + 2, y - 18], [x + 7, y - 18], [x + radius - 8, y - 12],
      [x + radius - 3, y - 5], [x + radius, y + 5], [x + 2, y + 5]]);
    outline(c, light, [[x - radius + 1, y + 4], [x - radius + 4, y - 5], [x - radius + 9, y - 11], [x - 6, y - 17]], 1, false);
    for (let n = -radius + 5; n < radius - 2; n += 6) box(c, shadow, x + n, y + 9, 2, 5);
    box(c, light, x - radius, y + 4, radius * 2, 2);
    box(c, wall, x - 5, y - 24, 10, 8);
    box(c, light, x - 6, y - 25, 12, 2);
    box(c, top, x - 3, y - 30, 6, 5);
    line(c, light, x, y - 30, x, y - 39);
  }

  function sanFrancisco() {
    const { canvas, ctx: c } = surface(W, H);
    const rng = random(0x53464241);
    const coast = y => y < 370 ? 127 : y < 650 ? 127 + (y - 370) * .83
      : y < 1440 ? 385 + Math.sin(y / 180) * 22 : 380 - (y - 1440) * .32;
    const colors = { shadow: '#31505a', wall: '#728582', side: '#4f7077',
      roofs: ['#b5b6a4', '#9ea99d', '#c3b5a0', '#9caead'], light: '#d7ccb0', window: '#385865' };
    box(c, '#285d6c', 0, 0, W, H);
    water(c, rng, (x, y) => x > coast(y) + 8, ['#306d77', '#347b81', '#478b8c', '#559592']);
    // The peninsula climbs into stepped neighborhoods; the bay stays open east.
    for (let y = 320; y < H; y += 2) {
      const edge = Math.floor(coast(y) / 2) * 2;
      box(c, '#4d9290', 0, y, edge + 9, 2);
      box(c, '#b0b09a', 0, y, edge + 2, 2);
      box(c, '#77917d', 0, y, edge - 2, 2);
      box(c, '#8d9785', 0, y, edge - 10, 2);
      if (y % 40 === 0) box(c, '#d0c6a9', edge - 4, y, 3, 5);
    }
    for (let y = 448; y < H; y += 55) {
      const right = coast(y) - 25;
      box(c, '#5c7577', 0, y + 39, right + 13, 9);
      box(c, '#b6b29d', 0, y + 39, right + 13, 1);
      for (let x = 12; x < right - 20; x += 49) {
        // Hills are contour steps, not a perspective grid that distorts collision.
        box(c, '#627b78', x - 7, y - 11, 8, 54);
        if (y > 580 && y < 790 && x > 190) continue;
        const rise = y < 1150 ? 8 + Math.floor(rng() * 8) : 5;
        building(c, rng, x, y, 16 + rng() * 9, 17, colors, rise);
        building(c, rng, x + 23, y + 1, 12, 25, colors, rise - 2);
        if (y % 3) tree(c, x + 30, y + 29, 0, true);
      }
    }
    // Market Street cuts diagonally through the block grid toward the Ferry Building.
    avenue(c, 80, 1530, 397, 1321, '#536f74', '#aab2a0', 19);
    for (let x = 130; x < 359; x += 37) {
      const y = 1530 - (x - 80) * .66;
      line(c, '#82918b', x, y - 2, x + 22, y - 16);
      line(c, '#82918b', x, y + 3, x + 22, y - 11);
    }
    // A tiny red-and-cream cable car, grounded on its twin tracks.
    box(c, '#354e5c', 230, 1431, 15, 10);
    box(c, '#af6e60', 230, 1427, 13, 8);
    box(c, '#d7c59d', 231, 1427, 11, 2);
    box(c, '#3d6670', 233, 1430, 7, 2);
    // Piers and the long Ferry Building roof with its unmistakable clock tower.
    for (let y = 1140; y < 1560; y += 58) {
      const edge = coast(y);
      box(c, '#355461', edge + 5, y + 8, 42, 14);
      box(c, '#8d9990', edge - 3, y, 45, 12);
      box(c, '#c3c0a5', edge - 2, y, 43, 2);
      if (y !== 1314) building(c, rng, edge + 3, y + 2, 31, 5, colors, 3);
    }
    const fx = 403; const fy = 1320;
    box(c, '#3c5860', fx - 18, fy - 65, 45, 137);
    box(c, '#b5afa0', fx - 22, fy - 72, 35, 133);
    box(c, '#777e7c', fx - 19, fy - 69, 29, 128);
    line(c, '#d7c4a6', fx - 20, fy - 71, fx - 20, fy + 59, 2);
    for (let y = fy - 65; y < fy + 60; y += 11) box(c, '#a8ab98', fx - 16, y, 23, 1);
    box(c, '#6a7374', fx - 16, fy - 20, 27, 32);
    box(c, '#b5b8a4', fx - 16, fy - 52, 24, 50);
    box(c, '#d8caaa', fx - 16, fy - 52, 5, 50);
    box(c, '#82928b', fx + 2, fy - 52, 6, 50);
    box(c, '#d8caaa', fx - 18, fy - 54, 28, 4);
    box(c, '#526b73', fx - 10, fy - 48, 12, 12);
    box(c, '#d9d2b0', fx - 8, fy - 46, 8, 8);
    line(c, '#455c66', fx - 4, fy - 44, fx - 4, fy - 41);
    line(c, '#455c66', fx - 4, fy - 41, fx - 1, fy - 41);
    poly(c, '#7e9084', [[fx - 16, fy - 56], [fx - 4, fy - 76], [fx + 8, fy - 56]]);
    line(c, '#d2c7a6', fx - 4, fy - 76, fx - 4, fy - 84);
    // Transamerica's narrow pyramid above the Financial District.
    const tx = 308; const ty = 1040;
    poly(c, '#415b67', [[tx - 22, ty - 5], [tx + 30, ty + 2], [tx + 39, ty + 52], [tx - 12, ty + 46]]);
    poly(c, '#c7c3a9', [[tx, ty - 79], [tx + 23, ty + 28], [tx - 22, ty + 28]]);
    poly(c, '#819594', [[tx, ty - 79], [tx + 23, ty + 28], [tx + 3, ty + 28]]);
    line(c, '#e0d1ad', tx, ty - 83, tx - 19, ty + 24);
    for (let j = 0; j < 11; j++) {
      const y = ty - 57 + j * 7; const half = (y - (ty - 79)) * .19;
      line(c, '#9aa79c', tx - half, y, tx + half, y);
    }
    box(c, '#b5b59f', tx - 24, ty - 2, 9, 27);
    box(c, '#728b8d', tx + 16, ty - 2, 9, 27);
    // Coit Tower and a winding Telegraph Hill garden.
    poly(c, '#617f71', [[184, 578], [242, 548], [320, 566], [350, 633], [332, 746], [228, 768], [183, 704]]);
    for (let j = 0; j < 6; j++) {
      outline(c, j % 2 ? '#879b80' : '#748e76', [[191 + j * 5, 606 + j * 9], [245, 579 + j * 11],
        [323 - j * 4, 604 + j * 10], [332 - j * 6, 717 - j * 6]], 2, false);
    }
    for (let i = 0; i < 75; i++) tree(c, 190 + rng() * 143, 572 + rng() * 178, i % 2, true);
    box(c, '#b5b69d', 266, 664, 46, 25);
    box(c, '#586f6c', 280, 637, 28, 39);
    box(c, '#d1c9ac', 275, 603, 20, 65);
    box(c, '#9aa699', 289, 603, 7, 65);
    box(c, '#e1d0ac', 273, 602, 25, 5);
    box(c, '#809488', 279, 597, 13, 5);
    for (let x = 278; x < 295; x += 5) box(c, '#536e70', x, 609, 2, 9);
    // Alcatraz is a separate rocky island, including cellhouse and lighthouse.
    const ax = 486; const ay = 1760;
    poly(c, '#3f7a7d', [[ax - 73, ay - 18], [ax - 44, ay - 59], [ax + 30, ay - 66], [ax + 65, ay - 20], [ax + 48, ay + 46], [ax - 27, ay + 58], [ax - 62, ay + 20]]);
    poly(c, '#adad95', [[ax - 66, ay - 17], [ax - 40, ay - 52], [ax + 26, ay - 57], [ax + 58, ay - 19], [ax + 43, ay + 39], [ax - 24, ay + 50], [ax - 56, ay + 17]]);
    poly(c, '#798e75', [[ax - 56, ay - 15], [ax - 35, ay - 43], [ax + 22, ay - 49], [ax + 47, ay - 16], [ax + 36, ay + 31], [ax - 20, ay + 40], [ax - 48, ay + 15]]);
    building(c, rng, ax - 35, ay - 29, 69, 35, colors, 9);
    for (let y = ay - 22; y < ay + 2; y += 6) box(c, '#778d8a', ax - 29, y, 55, 2);
    building(c, rng, ax - 18, ay + 16, 37, 13, colors, 5);
    box(c, '#517170', ax + 30, ay - 30, 12, 44);
    box(c, '#d7ccab', ax + 26, ay - 40, 9, 49);
    box(c, '#758d86', ax + 32, ay - 40, 4, 49);
    box(c, '#526f72', ax + 24, ay - 43, 13, 6);
    box(c, '#dcd1ad', ax + 25, ay - 47, 11, 4);
    box(c, '#adad95', ax + 32, ay + 34, 36, 8);
    // Golden Gate: orange portal towers, suspended roadway, Marin headlands.
    poly(c, '#718c74', [[0, 0], [144, 0], [149, 128], [124, 211], [138, 326], [0, 368]]);
    poly(c, '#a1a286', [[0, 0], [119, 0], [129, 128], [100, 216], [117, 314], [0, 343]]);
    poly(c, '#597b70', [[550, 0], [640, 0], [640, 452], [588, 365], [537, 264], [556, 154]]);
    poly(c, '#829477', [[569, 0], [640, 0], [640, 402], [605, 346], [557, 262], [576, 160]]);
    for (let i = 0; i < 140; i++) {
      const x = rng() > .5 ? rng() * 96 : 588 + rng() * 52; const y = rng() * 315;
      tree(c, x, y, i % 2, true);
    }
    const by = 255;
    box(c, '#244a5a', 45, by + 31, 566, 14);
    box(c, '#a46650', 25, by - 2, 590, 22);
    box(c, '#d29770', 25, by - 2, 590, 2);
    box(c, '#525f63', 25, by + 3, 590, 12);
    for (let x = 33; x < 610; x += 19) box(c, '#afa993', x, by + 8, 7, 1);
    box(c, '#cf8461', 25, by + 17, 590, 3);
    for (const towerX of [177, 466]) {
      box(c, '#754e49', towerX + 6, by - 62, 17, 93);
      for (const x of [towerX - 8, towerX + 7]) {
        box(c, '#a85547', x, by - 79, 7, 99);
        box(c, '#d8875f', x, by - 79, 2, 99);
        box(c, '#df9e70', x - 1, by - 82, 9, 3);
      }
      for (const y of [by - 72, by - 47, by - 18]) {
        box(c, '#bc6b50', towerX - 8, y, 22, 5);
        box(c, '#df9668', towerX - 8, y, 22, 1);
      }
    }
    const cables = [[25, by + 1], [177, by - 80], [320, by - 24], [466, by - 80], [615, by + 1]];
    outline(c, '#df9569', cables, 2, false);
    for (let i = 1; i < cables.length; i++) {
      const [a, b] = [cables[i - 1], cables[i]];
      for (let x = a[0] + 11; x < b[0]; x += 12) {
        const y = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
        line(c, '#ac755e', x, y, x, by);
      }
    }
    for (let i = 0; i < 9; i++) boat(c, 455 + rng() * 132, 495 + i * 128, i % 2 ? .75 : 1.1, '#c5c7b0');
    boat(c, 330, 369, 1.5, '#cfcbb2');
    return canvas;
  }

  function austin() {
    const { canvas, ctx: c } = surface(W, H);
    const rng = random(0x41555354);
    const north = x => 1430 + Math.sin(x / 140) * 35 + x * .1;
    const south = x => 1780 + Math.sin(x / 160 + .4) * 30 + x * .06;
    const colors = { shadow: '#3d3d55', wall: '#826774', side: '#5b5168',
      roofs: ['#ac8b8c', '#a88380', '#95818a', '#b39c91'], light: '#d2b296', window: '#d4b38a' };
    box(c, '#777867', 0, 0, W, H);
    for (let y = 462; y < H; y += 59) {
      box(c, '#4e5662', 0, y + 42, W, 11);
      box(c, '#ad9a80', 0, y + 41, W, 1);
      for (let x = 15; x < W - 20; x += 56) {
        if (Math.abs(x - 320) < 48) continue;
        box(c, '#555c63', x - 9, y - 13, 10, 62);
        building(c, rng, x, y, 20 + rng() * 13, 20 + rng() * 12, colors,
          y > 740 && y < 1370 ? 9 + Math.floor(rng() * 15) : 6);
        if (rng() > .3) building(c, rng, x + 31, y + 4, 12, 22, colors, 7);
      }
    }
    // North-south Congress Avenue points directly at the pink granite Capitol.
    avenue(c, 320, 361, 320, H, '#4b5262', '#ab9a84', 28);
    for (let y = 440; y < 1420; y += 59) {
      for (const x of [297, 337]) {
        for (let j = 0; j < 4; j++) box(c, '#bca892', x + j * 2, y + 2, 1, 8);
      }
      tree(c, 286, y + 21, 0, true);
      tree(c, 345, y + 29, 0, true);
    }
    // Lady Bird Lake's trail, limestone banks, and broad unbroken water.
    for (let x = 0; x < W; x += 2) {
      const n = north(x); const s = south(x);
      box(c, '#496e60', x, n - 28, 2, s - n + 61);
      box(c, '#b5a681', x, n - 10, 2, s - n + 27);
      box(c, '#596f7b', x, n - 3, 2, s - n + 8);
      box(c, '#3b4f68', x, n + 5, 2, s - n - 7);
      box(c, '#ab9c7c', x, s + 25, 2, 2);
    }
    water(c, rng, (x, y) => y > north(x) + 8 && y < south(x) - 3,
      ['#4e6077', '#5a677b', '#6a7385', '#7c7d87'], 9200);
    for (let x = 10; x < W; x += 17) {
      if (Math.abs(x - 320) > 24) {
        tree(c, x, north(x) - 31 - rng() * 10, 0, true);
        tree(c, x, south(x) + 31 + rng() * 9, 1, true);
      }
    }
    // Congress Avenue Bridge connects both shores. Repeated piers remain below
    // its continuous deck; the southern approach resumes Congress Avenue.
    const bridgeTop = north(320) - 28; const bridgeBottom = south(320) + 42;
    box(c, '#294450', 321, bridgeTop + 15, 49, bridgeBottom - bridgeTop + 5);
    for (let y = bridgeTop + 32; y < bridgeBottom - 15; y += 53) {
      box(c, '#597473', 289, y + 4, 63, 8);
      box(c, '#9b9781', 292, y, 57, 5);
      box(c, '#71897b', 296, y - 3, 6, 15);
      box(c, '#71897b', 340, y - 3, 6, 15);
    }
    box(c, '#bda88b', 298, bridgeTop, 44, bridgeBottom - bridgeTop);
    box(c, '#58606b', 303, bridgeTop, 34, bridgeBottom - bridgeTop);
    box(c, '#c9b493', 298, bridgeTop, 2, bridgeBottom - bridgeTop);
    box(c, '#9a927e', 340, bridgeTop, 2, bridgeBottom - bridgeTop);
    for (let y = bridgeTop; y < bridgeBottom; y += 22) box(c, '#b7ad94', 319, y, 2, 9);
    for (let y = bridgeTop + 12; y < bridgeBottom; y += 48) {
      box(c, '#dac29a', 299, y, 2, 2);
      box(c, '#dac29a', 339, y, 2, 2);
      box(c, '#b49c90', 310, y + 6, 3, 7);
    }
    // Bat silhouettes gather beneath the bridge, small enough to stay scenery.
    for (let i = 0; i < 36; i++) {
      const x = 354 + rng() * 114; const y = 1660 + rng() * 105;
      line(c, '#273849', x - 3, y - 1, x, y + 1);
      line(c, '#273849', x, y + 1, x + 3, y - 1);
    }
    // Zilker-like open lawns, trail loops, kayaks, and waterside live-music tents.
    poly(c, '#59765e', [[0, 1885], [134, 1840], [244, 1910], [270, 2048], [0, 2048]]);
    outline(c, '#a89f7d', [[0, 1940], [72, 1892], [159, 1900], [224, 1971], [188, 2038]], 3, false);
    for (let i = 0; i < 70; i++) tree(c, rng() * 258, 1870 + rng() * 185, 0, true);
    for (const [x, y, color] of [[123, 1642, '#c89873'], [452, 1570, '#b77c76'], [502, 1706, '#abac87'], [192, 1750, '#c8b286']]) {
      poly(c, color, [[x, y - 8], [x + 2, y], [x, y + 9], [x - 2, y]]);
      line(c, '#b8c2a5', x - 5, y + 2, x + 5, y - 2);
    }
    // Frost Bank Tower: one blue glass tower, with its crystalline owl-like crown.
    const tx = 421; const ty = 1110;
    poly(c, '#414257', [[tx - 32, ty + 9], [tx + 35, ty + 9], [tx + 51, ty + 96], [tx - 9, ty + 99]]);
    box(c, '#41778a', tx - 24, ty - 41, 47, 110);
    box(c, '#3b607c', tx + 5, ty - 41, 18, 110);
    box(c, '#6d9ba5', tx - 24, ty - 41, 4, 110);
    for (let y = ty - 35; y < ty + 67; y += 6) box(c, '#799da3', tx - 19, y, 37, 1);
    for (let x = tx - 17; x < tx + 20; x += 8) box(c, '#5a8794', x, ty - 39, 1, 105);
    poly(c, '#82acaf', [[tx - 25, ty - 41], [tx - 17, ty - 73], [tx - 6, ty - 59],
      [tx, ty - 81], [tx + 6, ty - 59], [tx + 17, ty - 73], [tx + 24, ty - 41]]);
    poly(c, '#49798c', [[tx, ty - 81], [tx + 6, ty - 59], [tx + 17, ty - 73], [tx + 24, ty - 41], [tx, ty - 46]]);
    outline(c, '#b3c7bd', [[tx - 25, ty - 41], [tx - 17, ty - 73], [tx - 6, ty - 59], [tx, ty - 81]], 1, false);
    line(c, '#bad0bb', tx - 14, ty - 53, tx - 5, ty - 47);
    line(c, '#91b4b0', tx + 14, ty - 53, tx + 5, ty - 47);
    // Brick music venues and the food-truck court on Sixth Street.
    box(c, '#715d68', 59, 811, 173, 83);
    for (let i = 0; i < 5; i++) {
      const x = 65 + i * 31;
      building(c, rng, x, 820, 24, 23, { ...colors, roofs: ['#9b776d', '#a98478'] }, 11);
      box(c, i % 2 ? '#b7998c' : '#927691', x + 2, 850, 20, 3);
      box(c, '#d5b192', x + 5, 851, 3, 1);
      box(c, '#394651', x + 7, 882, 12, 5);
      box(c, i % 2 ? '#c49b80' : '#a3919a', x + 4, 873, 19, 8);
      box(c, '#65727a', x + 6, 874, 6, 3);
    }
    // State Capitol grounds: long axial paths and a warm pink-granite dome.
    box(c, '#696f60', 145, 38, 350, 378);
    box(c, '#53816a', 153, 44, 334, 362);
    box(c, '#b9ab87', 306, 51, 28, 358);
    box(c, '#a5a37d', 160, 304, 319, 10);
    outline(c, '#a9a584', [[176, 75], [176, 361], [465, 361], [465, 75], [176, 75]], 4);
    for (let i = 0; i < 105; i++) {
      const x = 160 + rng() * 314; const y = 51 + rng() * 342;
      if (Math.abs(x - 320) > 36 && (y < 163 || y > 301)) tree(c, x, y, 0, true);
    }
    box(c, '#4b4e54', 229, 220, 198, 64);
    box(c, '#997979', 217, 199, 205, 64);
    box(c, '#bc9690', 214, 192, 205, 48);
    box(c, '#d1aa99', 214, 192, 205, 3);
    for (const x of [214, 381]) {
      box(c, '#bd9a90', x, 177, 38, 70);
      box(c, '#d5b29b', x, 177, 38, 2);
      box(c, '#947984', x + 6, 183, 26, 51);
    }
    for (let x = 222; x < 415; x += 10) box(c, '#6b626f', x, 245, 3, 7);
    box(c, '#d1b098', 285, 236, 70, 38);
    for (let x = 291; x < 352; x += 9) box(c, '#9b7e80', x, 239, 4, 26);
    poly(c, '#dfb99f', [[281, 236], [320, 216], [359, 236]]);
    dome(c, 320, 188, 31, ['#635663', '#a87f82', '#c5a096', '#e2bca3']);
    box(c, '#c9ac94', 290, 276, 60, 4);
    box(c, '#b49c86', 285, 282, 70, 4);
    box(c, '#a9a087', 281, 288, 78, 4);
    return canvas;
  }

  function washington() {
    const { canvas, ctx: c } = surface(W, H);
    const rng = random(0x44434d41);
    const colors = { shadow: '#5b6c6c', wall: '#999b8e', side: '#768588',
      roofs: ['#b4b6a1', '#a9ae9f', '#bdbba9'], light: '#d6d0b2', window: '#687c80' };
    box(c, '#819078', 0, 0, W, H);
    // Potomac ribbon and park embankment, kept at the western edge of the Mall.
    const edge = y => 60 + Math.sin(y / 320) * 17 + Math.max(0, y - 1490) * .09;
    for (let y = 0; y < H; y += 2) {
      box(c, '#9bab8d', 0, y, edge(y) + 11, 2);
      box(c, '#6c9a91', 0, y, edge(y) + 4, 2);
      box(c, '#346a78', 0, y, edge(y), 2);
    }
    water(c, rng, (x, y) => x < edge(y) - 7, ['#407881', '#4b8588', '#689a95']);
    // Low museums and diagonal avenues frame an unusually open green city.
    for (let y = 37; y < 1530; y += 123) {
      avenue(c, 87, y + 83, 640, y + 83, '#66797b', '#acb298', 11);
      for (const x of [111, 173, 450, 521, 594]) {
        building(c, rng, x, y, 36 + rng() * 8, 48 + rng() * 9, colors, 9);
      }
    }
    avenue(c, 70, 530, 277, 319, '#71817e', '#bdbea2', 15);
    avenue(c, 374, 321, 640, 512, '#71817e', '#bdbea2', 15);
    avenue(c, 85, 974, 268, 829, '#71817e', '#bdbea2', 14);
    avenue(c, 370, 887, 630, 1073, '#71817e', '#bdbea2', 14);
    // National Mall, compressed into one continuous axial flight path.
    box(c, '#bfc0a1', 252, 365, 152, 1080);
    box(c, '#6e956f', 260, 369, 136, 1070);
    box(c, '#9cac83', 290, 373, 77, 1035);
    box(c, '#c0bba0', 317, 380, 12, 640);
    for (let y = 431; y < 1450; y += 71) {
      box(c, '#bfc0a1', 251, y, 154, 4);
      for (const x of [237, 407]) {
        tree(c, x, y - 20, 0, true);
        tree(c, x, y + 2, 1, true);
        tree(c, x, y + 23, 0, true);
      }
    }
    // Smithsonian-like red sandstone castle among quiet limestone museums.
    box(c, '#796d6d', 442, 621, 87, 49);
    box(c, '#a67e73', 436, 612, 87, 41);
    box(c, '#c59e85', 436, 612, 87, 2);
    for (const x of [440, 471, 507]) {
      box(c, '#8d706b', x, 587, 13, 62);
      box(c, '#b88e79', x, 584, 10, 55);
      poly(c, '#7e6e6c', [[x - 2, 584], [x + 5, 571], [x + 12, 584]]);
      box(c, '#555d67', x + 3, 599, 3, 7);
    }
    // Capitol: broad wings and layered white dome, backed by a generous lawn.
    box(c, '#718b74', 173, 65, 312, 324);
    outline(c, '#bfc0a4', [[178, 93], [473, 93], [473, 367], [178, 367], [178, 93]], 4);
    box(c, '#c4c1a3', 304, 315, 36, 64);
    for (let i = 0; i < 55; i++) {
      const x = 184 + rng() * 278; const y = 74 + rng() * 289;
      if ((y < 181 || y > 320) && Math.abs(x - 320) > 33) tree(c, x, y, i % 2, true);
    }
    box(c, '#586e70', 209, 244, 239, 74);
    box(c, '#a1a394', 200, 219, 238, 78);
    box(c, '#c4c5ad', 196, 210, 238, 62);
    box(c, '#e0d7b9', 196, 210, 238, 3);
    for (const x of [196, 390]) {
      box(c, '#d0ceb2', x, 198, 44, 84);
      box(c, '#e0d7b9', x, 198, 44, 2);
      box(c, '#b0b4a2', x + 5, 204, 34, 65);
      for (let xx = x + 7; xx < x + 39; xx += 7) box(c, '#788b8a', xx, 273, 3, 9);
    }
    for (let x = 246; x < 388; x += 9) box(c, '#7c8d8a', x, 278, 3, 8);
    box(c, '#d7d3b7', 280, 267, 81, 34);
    for (let x = 285; x < 358; x += 9) box(c, '#8d9d93', x, 270, 4, 25);
    poly(c, '#e6dcbf', [[276, 267], [320, 245], [365, 267]]);
    dome(c, 320, 208, 33, ['#647c7d', '#acb6a7', '#d4d4b9', '#eee0bf']);
    box(c, '#dbd3b5', 278, 302, 85, 4);
    box(c, '#c1bfa4', 273, 309, 95, 4);
    box(c, '#b6b79c', 268, 316, 105, 4);
    // Washington Monument: a slender taper and a long, coherent ground shadow.
    box(c, '#b9bca0', 293, 870, 57, 69);
    poly(c, '#708778', [[315, 869], [333, 869], [375, 958], [353, 961]]);
    poly(c, '#d7d3b3', [[313, 898], [315, 799], [323, 784], [331, 799], [333, 898]]);
    poly(c, '#a7b3a2', [[323, 784], [331, 799], [333, 898], [323, 898]]);
    line(c, '#eee0ba', 315, 801, 313, 897);
    line(c, '#c6cbb0', 313, 856, 332, 856);
    box(c, '#e0d7b7', 309, 899, 28, 4);
    // Reflecting Pool and its symmetrical elm-lined walks.
    box(c, '#c1bfa0', 287, 1049, 71, 254);
    box(c, '#769a94', 294, 1056, 57, 240);
    box(c, '#4b8185', 297, 1059, 51, 234);
    box(c, '#8cb0a3', 299, 1061, 2, 230);
    for (let y = 1070; y < 1290; y += 11) box(c, '#69978e', 303 + (y % 7), y, 34, 1);
    for (let y = 1055; y < 1328; y += 22) {
      tree(c, 272, y, 0, true); tree(c, 364, y, 0, true);
    }
    // Lincoln Memorial's columned rectangular temple and broad steps.
    box(c, '#b5b59a', 266, 1353, 114, 88);
    for (let i = 0; i < 4; i++) box(c, i % 2 ? '#d0c9ab' : '#bdbda2', 271 + i * 4, 1355 + i * 4, 105 - i * 8, 77 - i * 8);
    box(c, '#718981', 287, 1377, 80, 39);
    box(c, '#cecdb0', 280, 1351, 80, 47);
    box(c, '#e2d8b8', 278, 1348, 84, 6);
    box(c, '#b6bda8', 286, 1357, 67, 23);
    box(c, '#e4dabb', 282, 1382, 76, 3);
    for (let x = 284; x < 358; x += 9) {
      box(c, '#778e86', x, 1386, 5, 16);
      box(c, '#ded5b6', x - 1, 1386, 2, 16);
    }
    // Tidal Basin: a single water body with shoreline cherry blossoms.
    const basin = [[141, 1615], [202, 1519], [330, 1500], [439, 1553], [510, 1654],
      [519, 1772], [463, 1904], [334, 1984], [205, 1950], [133, 1850], [105, 1728]];
    poly(c, '#b4b99c', basin);
    const inner = basin.map(([x, y]) => [320 + (x - 320) * .95, 1740 + (y - 1740) * .96]);
    poly(c, '#5f948d', inner);
    const deep = basin.map(([x, y]) => [320 + (x - 320) * .90, 1740 + (y - 1740) * .93]);
    poly(c, '#396f7b', deep);
    water(c, rng, (x, y) => ((x - 313) / 169) ** 2 + ((y - 1748) / 199) ** 2 < 1,
      ['#437e83', '#4e898a', '#68988f'], 5500);
    function blossom(x, y, variant) {
      box(c, '#5b7772', x + 3, y + 7, 9, 6);
      box(c, '#897b73', x + 4, y + 1, 2, 11);
      box(c, variant ? '#bfa5a3' : '#c5a7a5', x, y, 11, 8);
      box(c, variant ? '#d6b7b1' : '#d3afa9', x + 2, y - 3, 7, 13);
      box(c, '#e1c5b8', x + 1, y, 7, 3);
      box(c, '#e8cebf', x + 3, y - 1, 3, 2);
    }
    for (let i = 0; i < basin.length; i++) {
      const a = basin[i]; const b = basin[(i + 1) % basin.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let p = 0; p < length; p += 17) {
        const x = a[0] + (b[0] - a[0]) * p / length;
        const y = a[1] + (b[1] - a[1]) * p / length;
        blossom(x, y, i % 2);
      }
    }
    for (let i = 0; i < 85; i++) {
      const x = 91 + rng() * 467; const y = 1540 + rng() * 480;
      if (((x - 313) / 211) ** 2 + ((y - 1748) / 259) ** 2 > 1) blossom(x, y, i % 2);
    }
    // Jefferson Memorial, on the basin's southern shore, stays distinct from
    // the Capitol's long wings: a compact circular dome on a square colonnade.
    box(c, '#a9b092', 345, 1902, 114, 89);
    for (let i = 0; i < 4; i++) box(c, i % 2 ? '#d2c8aa' : '#b9b99d', 350 + i * 4, 1904 + i * 4, 105 - i * 8, 75 - i * 8);
    box(c, '#778980', 373, 1925, 72, 42);
    box(c, '#d5ccb0', 362, 1914, 72, 42);
    box(c, '#e1d5b6', 359, 1910, 78, 5);
    for (let x = 365; x < 433; x += 9) {
      box(c, '#79918b', x, 1918, 4, 32);
      box(c, '#e3d7b8', x - 1, 1918, 2, 32);
    }
    dome(c, 398, 1892, 30, ['#6c847d', '#9cac9b', '#c7cbb0', '#e1d6b6']);
    return canvas;
  }

  return [sanFrancisco(), austin(), washington()];
}
