// Terrain v2 — chunked-LOD quadtree over the baked real-Earth heightfield.
//
// One shared 128x128 grid (with a skirt ring) is displaced in the VERTEX
// SHADER from the 16-bit R/G-packed height texture; each quadtree node is a
// Mesh whose position/scale carry the node transform, so a single TSL
// material serves every node with zero per-node compiles. Selection walks
// the tree each frame (render if dist > size*K, else recurse), culls against
// a precomputed min/max height pyramid, and syncs to a mesh pool. Skirts
// hide LOD-seam cracks. The decoded Float32 field stays CPU-side for
// collision/AI height queries (bilinear heightAt).

import * as THREE from "three";
import {
  Fn, uniform, texture, vec2, vec3, vec4, float, positionLocal, positionWorld,
  modelWorldMatrix, attribute, normalize, clamp, smoothstep, mix, max,
  floor, fract, sin, dot,
} from "three/tsl";

const GRID = 128;           // interior verts per node edge
const LOD_K = 2.2;          // render node when dist > size * K
const MAX_LEVEL = 5;        // 65536m root → 2048m leaves = 16m/vert at GRID=128
const POOL = 260;

// ---------- shared skirted grid: interior [-0.5..0.5], skirt ring flagged ----------
function buildGrid() {
  const n = GRID + 2; // + skirt ring on each side handled by clamping uv
  const verts = [], skirtFlag = [], index = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // clamp skirt ring onto the edge in XZ; flag it for the shader push-down
      const ci = Math.min(Math.max(i - 1, 0), GRID - 1);
      const cj = Math.min(Math.max(j - 1, 0), GRID - 1);
      verts.push(ci / (GRID - 1) - 0.5, 0, cj / (GRID - 1) - 0.5);
      skirtFlag.push(i === 0 || j === 0 || i === n - 1 || j === n - 1 ? 1 : 0);
    }
  }
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute("skirt", new THREE.Float32BufferAttribute(skirtFlag, 1));
  geo.setIndex(index);
  // culling is manual (quadtree AABBs); keep three from using shared bounds
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return geo;
}

// Ramp authored in sRGB hex, converted to LINEAR for the shader — feeding
// sRGB bytes into linear lighting was washing the whole ground pale.
function srgbLin(hex) {
  const f = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return [f(((hex >> 16) & 255) / 255), f(((hex >> 8) & 255) / 255), f((hex & 255) / 255)];
}
const RAMPS = {
  NELLIS: {
    playa: srgbLin(0xcbb794),
    bajada: srgbLin(0xa88a64),
    scrub: srgbLin(0x83704f),
    rock: srgbLin(0x6d5c4c),
    crest: srgbLin(0x93866f),
  },
  VALDEZ: {
    shore: srgbLin(0x4a4740),   // tide-scoured rock
    forest: srgbLin(0x2e4430),  // spruce to ~450m
    tundra: srgbLin(0x6b6b52),  // alpine scrub band
    rock: srgbLin(0x5c5a56),
    snow: srgbLin(0xe8ecef),    // above ~1100m, gentler slopes
  },
  MARIANAS: {
    beach: srgbLin(0xd9c9a3),
    jungle: srgbLin(0x33552f),  // limestone forest
    scrubland: srgbLin(0x5d7040),
    soil: srgbLin(0x8a5f42),    // the red volcanic soil patches
    cliff: srgbLin(0x8f8a7e),
  },
};

export class Terrain {
  static async load(baseUrl, front = "NELLIS") {
    const meta = await (await fetch(`${baseUrl}_meta.json`)).json();
    const img = new Image();
    img.src = `${baseUrl}_h.png`;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = meta.grid; cv.height = meta.grid;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    const px = cx.getImageData(0, 0, meta.grid, meta.grid).data;
    const heights = new Float32Array(meta.grid * meta.grid);
    const span = meta.maxH - meta.minH;
    for (let i = 0; i < heights.length; i++) {
      heights[i] = meta.minH + ((px[i * 4] << 8) | px[i * 4 + 1]) / 65535 * span;
    }
    return new Terrain(meta, heights, img, front);
  }

  constructor(meta, heights, img, front = "NELLIS") {
    this.front = front;
    this.meta = meta;
    this.heights = heights;
    this.size = meta.sizeM;
    this.group = new THREE.Group();

    // height texture: R/G byte-packed; decode is linear in (R,G) so LINEAR
    // filtering interpolates true heights
    this.tex = new THREE.Texture(img);
    // three defaults flipY=true — but worldUV (v = 0.5 - z/size), the CPU
    // decode, and the culling pyramid all address UNFLIPPED rows (row 0 =
    // north). The default silently MIRRORED the whole world north-south on
    // every front (workflow wf_1f9df84a-570, verified both backends).
    this.tex.flipY = false;
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = true;
    this.tex.needsUpdate = true;

    // min/max pyramid at leaf granularity (32x32 nodes) for culling AABBs
    const NB = 1 << MAX_LEVEL;
    this.leafMin = new Float32Array(NB * NB).fill(Infinity);
    this.leafMax = new Float32Array(NB * NB).fill(-Infinity);
    const per = meta.grid / NB;
    for (let gy = 0; gy < meta.grid; gy++) {
      const by = Math.min(Math.floor(gy / per), NB - 1);
      for (let gx = 0; gx < meta.grid; gx++) {
        const bx = Math.min(Math.floor(gx / per), NB - 1);
        const h = heights[gy * meta.grid + gx];
        const bi = by * NB + bx;
        if (h < this.leafMin[bi]) this.leafMin[bi] = h;
        if (h > this.leafMax[bi]) this.leafMax[bi] = h;
      }
    }

    this.material = this._buildMaterial();
    this.grid = buildGrid();
    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const m = new THREE.Mesh(this.grid, this.material);
      m.frustumCulled = false;
      m.visible = false;
      this.pool.push(m);
      this.group.add(m);
    }
    this._frustum = new THREE.Frustum();
    this._proj = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this.stats = { nodes: 0, minLevel: 0, maxLevel: 0 };
  }

  _buildMaterial() {
    const uMin = uniform(this.meta.minH), uSpan = uniform(this.meta.maxH - this.meta.minH);
    const uSize = uniform(this.size);
    const hTex = this.tex;

    const worldUV = (wp) => vec2(
      wp.x.div(uSize).add(0.5),
      float(0.5).sub(wp.z.div(uSize)) // bake row 0 = north (+Z)
    );
    const sampleH = (wp) => {
      const t = texture(hTex, worldUV(wp));
      return uMin.add(t.r.mul(255 * 256).add(t.g.mul(255)).div(65535).mul(uSpan));
    };

    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0 });

    // vertex: displace by sampled height; push skirt ring down.
    // positionWorld derives FROM positionNode (chicken-egg), so world XZ is
    // computed explicitly via the model matrix. Node meshes use scaleY=1 and
    // posY=0, so local Y == world Y and the height lands directly.
    mat.positionNode = Fn(() => {
      const wp = modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz;
      const h = sampleH(wp);
      const skirtDrop = attribute("skirt", "float").mul(60.0);
      return vec3(positionLocal.x, h.sub(skirtDrop), positionLocal.z);
    })();

    // normals: central differences at ~16m spacing in world units
    const eps = 16.0;
    mat.normalNode = Fn(() => {
      const wp = positionWorld;
      const hx1 = sampleH(vec3(wp.x.add(eps), wp.y, wp.z));
      const hx0 = sampleH(vec3(wp.x.sub(eps), wp.y, wp.z));
      const hz1 = sampleH(vec3(wp.x, wp.y, wp.z.add(eps)));
      const hz0 = sampleH(vec3(wp.x, wp.y, wp.z.sub(eps)));
      return normalize(vec3(hx0.sub(hx1), float(eps * 2), hz0.sub(hz1)));
    })();

    // value noise for ground variation (macro patchiness + micro grain)
    const hash2 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
    const vnoise = (p) => {
      const i = floor(p), f = fract(p);
      const u = f.mul(f).mul(f.mul(-2.0).add(3.0)); // smoothstep fade
      const a = hash2(i), b = hash2(i.add(vec2(1, 0)));
      const c = hash2(i.add(vec2(0, 1))), d = hash2(i.add(vec2(1, 1)));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    };

    // color: per-front altitude/slope ramps + shared noise variation
    const front = this.front;
    mat.colorNode = Fn(() => {
      const wp = positionWorld;
      const h = sampleH(wp);
      const tAlt = clamp(h.sub(uMin).div(uSpan), 0, 1);
      const hx1 = sampleH(vec3(wp.x.add(eps), wp.y, wp.z));
      const hz1 = sampleH(vec3(wp.x, wp.y, wp.z.add(eps)));
      const slope = clamp(h.sub(hx1).abs().add(h.sub(hz1).abs()).div(eps), 0, 1);
      const macro = vnoise(wp.xz.div(1800.0)).mul(0.6).add(vnoise(wp.xz.div(240.0)).mul(0.4));

      let c;
      if (front === "VALDEZ") {
        const R = RAMPS.VALDEZ;
        const shore = vec3(...R.shore), forest = vec3(...R.forest), tundra = vec3(...R.tundra);
        const rock = vec3(...R.rock), snow = vec3(...R.snow);
        c = mix(shore, forest, smoothstep(2.0, 30.0, h));          // treeline starts fast
        c = mix(c, tundra, smoothstep(380.0, 520.0, h));
        c = mix(c, rock, smoothstep(650.0, 900.0, h));
        // snow: altitude-gated, avoids the steepest faces, macro-raggedy line
        const snowLine = macro.mul(220.0).add(1000.0);
        c = mix(c, snow, smoothstep(snowLine, snowLine.add(180.0), h).mul(smoothstep(0.85, 0.45, slope)));
      } else if (front === "MARIANAS") {
        const R = RAMPS.MARIANAS;
        const beach = vec3(...R.beach), jungle = vec3(...R.jungle), scrubl = vec3(...R.scrubland);
        const soil = vec3(...R.soil), cliff = vec3(...R.cliff);
        c = mix(beach, jungle, smoothstep(2.5, 14.0, h));
        c = mix(c, scrubl, smoothstep(0.35, 0.75, macro));          // savanna patches
        c = mix(c, soil, smoothstep(0.72, 0.95, vnoise(wp.xz.div(420.0))).mul(0.7));
        c = mix(c, cliff, smoothstep(0.3, 0.75, slope));
      } else {
        const R = RAMPS.NELLIS;
        const playa = vec3(...R.playa), bajada = vec3(...R.bajada);
        const scrub = vec3(...R.scrub), rock = vec3(...R.rock), crest = vec3(...R.crest);
        c = mix(bajada, scrub, clamp(tAlt.div(0.3), 0, 1));
        c = mix(c, rock, smoothstep(0.3, 0.65, tAlt));
        c = mix(c, crest, smoothstep(0.65, 1.0, tAlt));
        c = mix(playa, c, smoothstep(0.06, 0.12, max(tAlt, slope.mul(0.5))));
        c = mix(c, rock, smoothstep(0.35, 0.9, slope).mul(0.7));
      }

      // shared variation: macro brightness + hue drift, 45m micro grain
      c = c.mul(macro.sub(0.5).mul(0.34).add(1.0));
      c = c.mul(mix(vec3(1.05, 1.0, 0.93), vec3(0.96, 1.0, 1.05), macro));
      const micro = vnoise(wp.xz.div(45.0));
      c = c.mul(micro.sub(0.5).mul(0.12).add(1.0));
      return c;
    })();

    return mat;
  }

  // quadtree selection → pool sync; call once per frame
  update(camera) {
    camera.updateMatrixWorld();
    this._proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._proj);
    const cam = camera.position;
    const out = [];
    const NB = 1 << MAX_LEVEL;

    const nodeMinMax = (level, ix, iz) => {
      // aggregate leaf pyramid over this node's leaf span
      const span = NB >> level;
      let mn = Infinity, mx = -Infinity;
      for (let z = iz * span; z < (iz + 1) * span; z++) {
        for (let x = ix * span; x < (ix + 1) * span; x++) {
          const v = z * NB + x;
          if (this.leafMin[v] < mn) mn = this.leafMin[v];
          if (this.leafMax[v] > mx) mx = this.leafMax[v];
        }
      }
      return [mn, mx];
    };

    const visit = (level, ix, iz) => {
      const size = this.size / (1 << level);
      const cx = -this.size / 2 + (ix + 0.5) * size;
      // leaf z index 0 = north = +Z half
      const cz = this.size / 2 - (iz + 0.5) * size;
      const [mn, mx] = nodeMinMax(level, ix, iz);
      this._box.min.set(cx - size / 2, mn - 70, cz - size / 2);
      this._box.max.set(cx + size / 2, mx + 10, cz + size / 2);
      if (!this._frustum.intersectsBox(this._box)) return;
      const dx = Math.max(Math.abs(cam.x - cx) - size / 2, 0);
      const dz = Math.max(Math.abs(cam.z - cz) - size / 2, 0);
      const dy = Math.max(cam.y - mx, mn - cam.y, 0);
      const dist = Math.hypot(dx, dy, dz);
      if (level >= MAX_LEVEL || dist > size * LOD_K) {
        out.push({ cx, cz, size, level });
        return;
      }
      visit(level + 1, ix * 2, iz * 2);
      visit(level + 1, ix * 2 + 1, iz * 2);
      visit(level + 1, ix * 2, iz * 2 + 1);
      visit(level + 1, ix * 2 + 1, iz * 2 + 1);
    };
    visit(0, 0, 0);

    const n = Math.min(out.length, this.pool.length);
    let minL = 99, maxL = 0;
    for (let i = 0; i < n; i++) {
      const m = this.pool[i], nd = out[i];
      m.position.set(nd.cx, 0, nd.cz);
      m.scale.set(nd.size, 1, nd.size);
      m.updateMatrixWorld();
      m.visible = true;
      if (nd.level < minL) minL = nd.level;
      if (nd.level > maxL) maxL = nd.level;
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].visible = false;
    this.stats = { nodes: n, minLevel: minL, maxLevel: maxL, overflow: out.length - n };
  }

  // Shore-distance field (meters from land, sea cells only) — the bake clamps
  // bathymetry to 0, so water depth is proxied by distance-to-shore. 1024²
  // two-pass chamfer transform (~50ms), lazily built, uploaded as a texture.
  getShoreField() {
    if (this._shore) return this._shore;
    const N = 1024, g = this.meta.grid, step = this.size / N;
    const d = new Float32Array(N * N);
    const stride = g / N;
    const BIG = 1e9;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++)
        d[j * N + i] = this.heights[Math.floor(j * stride) * g + Math.floor(i * stride)] > 0.5 ? 0 : BIG;
    const D1 = step, D2 = step * 1.4142;
    for (let j = 0; j < N; j++)         // forward pass
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        if (i > 0) d[k] = Math.min(d[k], d[k - 1] + D1);
        if (j > 0) {
          d[k] = Math.min(d[k], d[k - N] + D1);
          if (i > 0) d[k] = Math.min(d[k], d[k - N - 1] + D2);
          if (i < N - 1) d[k] = Math.min(d[k], d[k - N + 1] + D2);
        }
      }
    for (let j = N - 1; j >= 0; j--)    // backward pass
      for (let i = N - 1; i >= 0; i--) {
        const k = j * N + i;
        if (i < N - 1) d[k] = Math.min(d[k], d[k + 1] + D1);
        if (j < N - 1) {
          d[k] = Math.min(d[k], d[k + N] + D1);
          if (i < N - 1) d[k] = Math.min(d[k], d[k + N + 1] + D2);
          if (i > 0) d[k] = Math.min(d[k], d[k + N - 1] + D2);
        }
      }
    const MAXD = 1400;
    const bytes = new Uint8Array(N * N);
    for (let k = 0; k < d.length; k++) bytes[k] = Math.min(d[k] / MAXD, 1) * 255;
    const tex = new THREE.DataTexture(bytes, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this._shore = { tex, maxDist: MAXD };
    return this._shore;
  }

  // bilinear height at world x (east) / z (north); origin = AOI center
  heightAt(x, z) {
    const g = this.meta.grid, half = this.size / 2;
    const u = (x + half) / this.size * (g - 1);
    const v = (half - z) / this.size * (g - 1); // north row 0
    if (u < 0 || v < 0 || u > g - 1 || v > g - 1) return this.meta.minH;
    const u0 = Math.floor(u), v0 = Math.floor(v);
    const u1 = Math.min(u0 + 1, g - 1), v1 = Math.min(v0 + 1, g - 1);
    const fu = u - u0, fv = v - v0;
    const H = this.heights;
    return (H[v0 * g + u0] * (1 - fu) + H[v0 * g + u1] * fu) * (1 - fv) +
           (H[v1 * g + u0] * (1 - fu) + H[v1 * g + u1] * fu) * fv;
  }
}
