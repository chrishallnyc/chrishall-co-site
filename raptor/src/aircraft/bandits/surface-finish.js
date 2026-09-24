// Authored finish at real airframe landmarks. These marks describe access,
// walkways and airflow; they are not random damage scattered over the model.
export function paintSurfaceFinish({ color, roughness, height, point, kind }) {
  const polygon = (ctx, points, chart, fill) => {
    ctx.beginPath(); points.forEach((p, i) => { const q = point(p, chart); i ? ctx.lineTo(...q) : ctx.moveTo(...q); });
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  };
  const line = (ctx, points, chart, stroke, width = 1) => {
    ctx.beginPath(); points.forEach((p, i) => { const q = point(p, chart); i ? ctx.lineTo(...q) : ctx.moveTo(...q); });
    ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke();
  };
  const fasteners = (points, chart = 'top', pitch = .27) => {
    for (let j = 0; j < points.length - 1; j++) {
      const a = points[j], b = points[j + 1], count = Math.max(1, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / pitch));
      for (let i = 0; i <= count; i++) {
        const t = i / count, q = point([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], chart);
        color.beginPath(); color.arc(...q, .48, 0, Math.PI * 2); color.fillStyle = 'rgba(43,52,54,.32)'; color.fill();
        height.beginPath(); height.arc(...q, .52, 0, Math.PI * 2); height.fillStyle = '#777777'; height.fill();
      }
    }
  };
  const streak = (a, b, width, strength = .09, chart = 'top') => {
    const p = point(a, chart), q = point(b, chart), gradient = color.createLinearGradient(...p, ...q);
    gradient.addColorStop(0, `rgba(47,42,33,${strength})`); gradient.addColorStop(.22, `rgba(47,42,33,${strength * .5})`); gradient.addColorStop(1, 'rgba(47,42,33,0)');
    line(color, [a, b], chart, gradient, width);
  };
  if (kind === 'fighter') {
    // Muted grey/green fields break across the wing-root extensions and
    // spine, while the underside retains its separate light finish.
    for (const s of [-1, 1]) {
      polygon(color, [[s*.62,4.3],[s*1.25,2.5],[s*1.87,1.3],[s*2.42,-.10],[s*2.9,-1.5],[s*1.43,-2.8],[s*.78,-.8]], 'top', 'rgba(81,100,101,.22)');
      polygon(color, [[s*3.22,-1.8],[s*4.21,-2.44],[s*5.6,-3.2],[s*5.57,-4.95],[s*3.74,-4.8],[s*4.0,-3.73]], 'top', 'rgba(76,96,101,.22)');
      polygon(color, [[s*.17,-3.2],[s*.59,-2.2],[s*1.43,-3.12],[s*1.62,-5.35],[s*.47,-6.5],[s*.22,-4.9]], 'top', 'rgba(87,104,104,.20)');
      const walkway = [[s*.58,2.6],[s*.91,2.17],[s*1.2,.95],[s*1.02,-2.45],[s*.76,-2.55],[s*.78,.7]];
      polygon(color, walkway, 'top', 'rgba(48,58,60,.15)'); polygon(roughness, walkway, 'top', '#d4d4d4');
      for (const z of [1.9,.6,-1.6,-3.5]) fasteners([[s*.85,z],[s*1.55,z-.13]], 'top', .21);
      for (const x of [1.42,1.62,1.79]) streak([s*x,.5],[s*(x+.06),-1.1], 2.2, .11);
      streak([s*1.28,-6.4],[s*1.23,-7.5], 9, .10);
      line(color, [[s*.62,5.85],[s*.85,5.4]], 'top', 'rgba(210,216,210,.22)', 1);
    }
    polygon(color, [[1.27,-4.72],[2.85,-5.22],[2.82,-6.72],[1.25,-6.27]], 'side', 'rgba(83,101,105,.14)');
  } else if (kind === 'transport') {
    for (const s of [-1,1]) {
      const walkway = [[s*2.2,2.45],[s*12.8,-3.67],[s*12.8,-4.18],[s*2.2,1.72]];
      polygon(color, walkway, 'top', 'rgba(65,71,71,.13)'); polygon(roughness, walkway, 'top', '#dddddd');
      for (const x of [3.05,5.6,8.1,11]) fasteners([[s*x,3.5-x*.49],[s*x,-.36-x*.29]], 'top', .38);
      for (const z of [5.95,2.15,-2.4,-6.1]) fasteners([[s*.25,z],[s*1.2,z]], 'top', .35);
      for (const x of [4.6,9.2]) streak([s*x,-1.7],[s*x,-3.7], 7, .055);
      line(color, [[s*2.6,-.42],[s*6.1,-1.83],[s*10.5,-3.65]], 'top', 'rgba(224,227,221,.32)', 1.2);
    }
    for (const z of [9.65,5.95,2.15,-2.4,-6.1,-8.8]) fasteners([[-1.45,z],[1.4,z]], 'side', .36);
    streak([-.9,-7.5],[-.9,-10.5], 4, .06, 'side');
  } else {
    for (const s of [-1,1]) {
      for (const z of [2.65,.75,-.93,-2.91]) fasteners([[s*.10,z],[s*.35,z]], 'top', .16);
      for (const x of [3.2,6.8]) fasteners([[s*x,.02],[s*x,-.67]], 'top', .17);
      line(color, [[s*.53,.46],[s*3.2,.27],[s*6.8,-.03]], 'top', 'rgba(242,240,224,.34)', 1);
      streak([s*.28,-1.86],[s*.28,-3.07], 2, .10, 'side');
    }
    polygon(color, [[-.3,-2.57],[-.22,-3.65],[.22,-3.65],[.3,-2.57]], 'top', 'rgba(112,109,91,.08)');
  }
}
