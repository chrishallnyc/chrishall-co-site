// Terrain v1 — real-Earth heightfield from the bakery (16-bit PNG R/G packed).
// One 512x512 displaced mesh over the full AOI proves the pipeline end-to-end;
// the CDLOD quadtree replaces the single mesh in the next block. Keeps the
// full-resolution decoded field for collision/AI height queries.

import * as THREE from "three";

const MESH_VERTS = 512;

// altitude/slope desert ramp (NELLIS palette; per-front palettes later)
const RAMP = {
  playa: new THREE.Color(0xbfae8e),
  bajada: new THREE.Color(0xa08a6c),
  scrub: new THREE.Color(0x7d6d55),
  rock: new THREE.Color(0x6b5d50),
  crest: new THREE.Color(0x8d8274),
};

export class Terrain {
  static async load(baseUrl) {
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
    return new Terrain(meta, heights);
  }

  constructor(meta, heights) {
    this.meta = meta;
    this.heights = heights;
    this.size = meta.sizeM;

    const geo = new THREE.PlaneGeometry(this.size, this.size, MESH_VERTS - 1, MESH_VERTS - 1);
    geo.rotateX(-Math.PI / 2); // plane XZ, +Y up
    // after rotateX, vertex row 0 sits at world -Z (south in the solar frame);
    // bake row 0 is the NORTH edge — index bake rows flipped (no scale hacks,
    // they invert winding)
    const pos = geo.attributes.position;
    const stride = (meta.grid - 1) / (MESH_VERTS - 1);
    for (let vy = 0; vy < MESH_VERTS; vy++) {
      const bakeRow = Math.round((MESH_VERTS - 1 - vy) * stride);
      for (let vx = 0; vx < MESH_VERTS; vx++) {
        const gi = bakeRow * meta.grid + Math.round(vx * stride);
        pos.setY(vy * MESH_VERTS + vx, heights[gi]);
      }
    }
    geo.computeVertexNormals();

    // vertex colors: altitude + slope ramps
    const colors = new Float32Array(pos.count * 3);
    const nrm = geo.attributes.normal;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i);
      const slope = 1 - nrm.getY(i); // 0 flat → 1 cliff
      const tAlt = Math.min(Math.max((h - this.meta.minH) / (this.meta.maxH - this.meta.minH), 0), 1);
      if (slope < 0.04 && tAlt < 0.1) c.copy(RAMP.playa);
      else if (tAlt < 0.3) c.copy(RAMP.bajada).lerp(RAMP.scrub, tAlt / 0.3);
      else if (tAlt < 0.65) c.copy(RAMP.scrub).lerp(RAMP.rock, (tAlt - 0.3) / 0.35);
      else c.copy(RAMP.rock).lerp(RAMP.crest, (tAlt - 0.65) / 0.35);
      if (slope > 0.25) c.lerp(RAMP.rock, Math.min((slope - 0.25) * 2, 0.7));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0.0,
    }));
  }

  // bilinear height at world x (east) / z (north); world origin = AOI center
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
