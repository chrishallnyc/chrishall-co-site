// Linear-filterable first/second slope moments. Near magnification uses a
// positive cubic B-spline (four bilinear reads); distant sampling uses the
// mip/anisotropic sampler. Positive weights keep moment variance meaningful.
import { Fn, If, texture, vec2, float, floor, max, dFdx, dFdy, mix, smoothstep } from "three/tsl";

export function filteredSlopeMoments(map, worldXZ, tileM, size, label = "water") {
  return Fn(() => {
    // Do not fract UVs: wrapping is the sampler's job, and fract would make
    // implicit derivatives jump by a whole tile at each wrap seam.
    const uv = worldXZ.div(tileM);
    const filtered = texture(map, uv).toVar(label + "MipMoments");
    const texel = tileM / size;
    const fp = max(dFdx(worldXZ).length(), dFdy(worldXZ).length());
    If(fp.lessThan(texel * 1.5), () => {
      const p = uv.mul(size).sub(.5), i = floor(p), f = p.sub(i);
      const one = float(1).sub(f), f2 = f.mul(f), f3 = f2.mul(f);
      const w0 = one.mul(one).mul(one).div(6);
      const w1 = f3.mul(3).sub(f2.mul(6)).add(4).div(6);
      const w2 = f3.mul(-3).add(f2.mul(3)).add(f.mul(3)).add(1).div(6);
      const w3 = f3.div(6);
      const g0 = w0.add(w1), g1 = w2.add(w3);
      const a = i.sub(1).add(w1.div(g0)).add(.5).div(size);
      const b = i.add(1).add(w3.div(g1)).add(.5).div(size);
      const aa = texture(map, a).level(0);
      const ba = texture(map, vec2(b.x, a.y)).level(0);
      const ab = texture(map, vec2(a.x, b.y)).level(0);
      const bb = texture(map, b).level(0);
      const cubic = mix(mix(aa, ba, g1.x), mix(ab, bb, g1.x), g1.y);
      // At one texel/pixel the mip filter takes over continuously. Mix the
      // moments themselves, never separately normalized normals/roughness.
      filtered.assign(mix(cubic, filtered, smoothstep(texel * .5, texel * 1.5, fp)));
    });
    return filtered;
  })();
}
