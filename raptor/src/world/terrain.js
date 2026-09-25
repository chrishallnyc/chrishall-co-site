// Terrain v2 — chunked-LOD quadtree over the baked real-Earth heightfield.
//
// Shared coarse and nested near grids (with skirt rings) are displaced
// from the 16-bit R/G-packed height texture; each quadtree node is a
// Mesh whose position/scale carry the node transform, so a single TSL
// material serves every node with zero per-node compiles. Selection walks
// the tree each frame (render if dist > size*K, else recurse), culls against
// a precomputed min/max height pyramid, and syncs to a mesh pool. Skirts
// hide LOD-seam cracks. The decoded Float32 field stays CPU-side for
// collision/AI height queries (bilinear heightAt).

import * as THREE from "three";
import { TerrainSourceField } from "./terrainfield.js";
import { OceanFloorOcclusion } from "./oceanocclusion.js";
import { createTerrainGrid, TERRAIN_COARSE_INTERVALS, TERRAIN_FINE_INTERVALS,
  TERRAIN_DETAIL_FULL_M, TERRAIN_DETAIL_END_M, TERRAIN_DETAIL_SELECT_M } from "./terraingrid.js";
import { TerrainDetailTransition, tierHasNearTerrain } from "./terraindetail.js";
import { TerrainSurfaceMotion } from "./terrainmotion.js";
import { terrainMaterialNodes } from "./terrainmaterials.js";
import { prepareTerrainPhoto } from "./terrainphoto.js";
import { geographicImageryNode } from "./terrain-imagery-node.js";
import {
  Fn, uniform, texture, textureLoad, ivec2, vec2, vec3, vec4, float, positionLocal, positionWorld,
  modelWorldMatrix, attribute, normalize, clamp, smoothstep, mix, max,
  floor, fract, sin, dot, cameraViewMatrix, output, If, length, select, varyingProperty,
} from "three/tsl";

const LOD_K = 2.2;          // render node when dist > size * K
const MAX_LEVEL = 5;        // 65536m root → 2048m leaves = 16m/vert at GRID=128
const POOL = 260;

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
  // drape texture loader: any missing/broken file resolves null and the
  // shader falls back to the procedural ramps. fetch-based: a 404 through
  // fetch stays out of the console (an <img> 404 fails the console-clean QA
  // gates), and createImageBitmap avoids Chrome's decoder-abort flakiness
  // when several 8-16k decodes race.
  static async _imgTex(url, srgb) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      // imageOrientation "none": rows stay as-baked (row 0 = north) — the
      // same mirror guard as the height texture's flipY=false
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", imageOrientation: "none" });
      const t = new THREE.Texture(bmp);
      t.flipY = false;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 8; // the whole game is grazing angles
      t.needsUpdate = true;
      return t;
    } catch (_) { return null; }
  }

  static async load(baseUrl, front = "NELLIS", cloudShadow = null, { drape = "16k", aerial = null, curvature = null, nearDetail = true, sourceManifest = null, geographicImagery = null, photoDetail = null } = {}) {
    const meta = await (await fetch(`${baseUrl}_meta.json`)).json();
    const img = new Image();
    img.src = `${baseUrl}_h.png`;
    // the height decode must NOT race the 8-16k drape decodes — Chrome's
    // image decoder can abort it under that load ("cannot be decoded" on a
    // perfectly good PNG); drape fetches start after it lands
    await img.decode();
    // MAXFI A2: real-imagery albedo + coverage mask + baked normals/AO.
    // meta.drape declares what exists — requesting a missing file would log
    // a console 404 and fail the console-clean QA gates.
    const has = (k) => drape && (meta.drape || []).includes(k);
    const photoRequested = photoDetail?.requested === true && !(typeof location !== "undefined" && new URLSearchParams(location.search).get("terrainmaterials") === "0");
    const photoP = prepareTerrainPhoto({ ...photoDetail, front, requested: photoRequested });
    const [albedoP, coverP, nrmP, aoP] = [
      has(`albedo_${drape}`) ? this._imgTex(`${baseUrl}_albedo_${drape}.jpg`, true) : null,
      has("cover") ? this._imgTex(`${baseUrl}_cover.png`, false) : null,
      has("n_8k") ? this._imgTex(`${baseUrl}_n_8k.jpg`, false) : null,
      has("ao_8k") ? this._imgTex(`${baseUrl}_ao_8k.jpg`, false) : null,
    ];
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
    const [albedo, cover, nrm, ao, preparedPhoto] = await Promise.all([albedoP, coverP, nrmP, aoP, photoP]);
    // Geographic heights are fixed before materials, collision/ground-unit
    // placement and shoreline initialization. Never swap sources mid-flight.
    let sourceField = null;
    if (sourceManifest) {
      try {
        sourceField = await TerrainSourceField.load(sourceManifest);
        const b = sourceField.meta.worldBounds, half = meta.sizeM / 2;
        if (sourceField.meta.front !== front || b.xmin < -half || b.xmax > half || b.zmin < -half || b.zmax > half)
          throw Error("Terrain source does not match this front/extent");
      } catch (error) {
        sourceField?.dispose(); sourceField = null;
        console.warn("Terrain source unavailable; canonical field retained:", error.message);
      }
    }
    geographicImagery = await Promise.resolve(geographicImagery).catch(() => null);
    try {
      return new Terrain(meta, heights, img, front, cloudShadow, { albedo, cover, nrm, ao, geographicImagery, photoDetail: preparedPhoto }, aerial, curvature, nearDetail, sourceField);
    } catch (error) { sourceField?.dispose(); geographicImagery?.dispose(); preparedPhoto.dispose(); throw error; }
  }

  constructor(meta, heights, img, front = "NELLIS", cloudShadow = null, drape = {}, aerial = null, curvature = null, nearDetail = true, sourceField = null) {
    this.sourceField = sourceField;
    this._baseHeightAt = this.baseHeightAt.bind(this);
    this.curvature = curvature;
    this.nearDetail = nearDetail && !(typeof location !== "undefined" &&
      new URLSearchParams(location.search).get("terrainnear") === "0");
    this.detailTransition = new TerrainDetailTransition(this.nearDetail);
    this.uDetailStrength = uniform(this.detailTransition.current);
    this.uPreviousDetailStrength = uniform(this.detailTransition.previous);
    this.uDetailCamera = uniform(new THREE.Vector3());
    this.uPreviousDetailCamera = uniform(new THREE.Vector3());
    this.surfaceMotion = curvature ? null : new TerrainSurfaceMotion();
    this.drape = drape;
    this.photoDetail = drape.photoDetail || null;
    this.geographicImagery = drape.geographicImagery || null;
    this._geographicEnabled = true;
    this.aerial = aerial; // MAXFI A3: { trans(wp), ins(wp), uSunI } or null
    this.front = front;
    // Projector retained for scene lighting; bind it to the directional Sun.
    // Cloud visibility must not darken the material's ambient/IBL response.
    this.cloudShadow = cloudShadow;
    this.meta = meta;
    this.oceanOcclusion = new OceanFloorOcclusion(meta);
    this.heights = heights;
    this.size = meta.sizeM;
    this.group = new THREE.Group();

    // Packed heights retain mip filtering for fragment material detail.
    // Vertex displacement decodes four exact texels before interpolation.
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
    // Each endpoint sample supports one bilinear cell to either side.
    // Include that one-sample collar in the node bounds; canonical UVs must
    // not expose a steep boundary vertex outside the culling pyramid.
    const binLo = new Uint8Array(meta.grid), binHi = new Uint8Array(meta.grid);
    for (let i = 0; i < meta.grid; i++) {
      binLo[i] = Math.max(0, Math.min(NB - 1, Math.floor((i - 1) / (meta.grid - 1) * NB)));
      binHi[i] = Math.max(0, Math.min(NB - 1, Math.floor((i + 1) / (meta.grid - 1) * NB)));
    }
    for (let gy = 0; gy < meta.grid; gy++) for (let gx = 0; gx < meta.grid; gx++) {
      const h = heights[gy * meta.grid + gx];
      for (let by = binLo[gy]; by <= binHi[gy]; by++) for (let bx = binLo[gx]; bx <= binHi[gx]; bx++) {
        const bi = by * NB + bx;
        if (h < this.leafMin[bi]) this.leafMin[bi] = h;
        if (h > this.leafMax[bi]) this.leafMax[bi] = h;
      }
    }

    // Include the new source support before quadtree culling can run.
    this.sourceField?.expandBounds(this.leafMin, this.leafMax, this.size, NB);

    // Heights and source support are fixed for this flight. Aggregate each
    // ancestor once instead of rescanning up to 1,024 leaves per visited
    // node on every frame. Level MAX_LEVEL retains the exact leaf bounds.
    this._nodeMin = new Array(MAX_LEVEL + 1);
    this._nodeMax = new Array(MAX_LEVEL + 1);
    this._nodeMin[MAX_LEVEL] = this.leafMin;
    this._nodeMax[MAX_LEVEL] = this.leafMax;
    for (let level = MAX_LEVEL - 1; level >= 0; level--) {
      const width = 1 << level, childWidth = width * 2;
      const mins = this._nodeMin[level] = new Float32Array(width * width);
      const maxs = this._nodeMax[level] = new Float32Array(width * width);
      const childMin = this._nodeMin[level + 1], childMax = this._nodeMax[level + 1];
      for (let z = 0; z < width; z++) for (let x = 0; x < width; x++) {
        const i = z * width + x, child = z * 2 * childWidth + x * 2;
        mins[i] = Math.min(childMin[child], childMin[child + 1],
          childMin[child + childWidth], childMin[child + childWidth + 1]);
        maxs[i] = Math.max(childMax[child], childMax[child + 1],
          childMax[child + childWidth], childMax[child + childWidth + 1]);
      }
    }

    this.material = this._buildMaterial();
    this.grid = createTerrainGrid();
    // Eligible quality settings prepare this shared grid before flight.
    // LOW/MED sessions never allocate it; downgrades retain the same cache.
    this.fineGrid = null;
    this._selection = Array.from({ length: POOL }, () => ({ cx: 0, cz: 0, size: 0, level: 0, fine: false }));
    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const m = new THREE.Mesh(this.grid, this.material);
      m.frustumCulled = false;
      m.receiveShadow = !!cloudShadow;
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
    const sampleBaseMaterialH = (wp, explicitLevel = null) => {
      // Height samples include the AOI endpoints. Image/shore textures
      // retain their pixel-area UVs; this correction is height-specific.
      const heightUV = worldUV(wp).mul(this.meta.grid - 1).add(.5).div(this.meta.grid);
      const source = texture(hTex, heightUV);
      const t = explicitLevel === null ? source : source.level(explicitLevel);
      return uMin.add(t.r.mul(255 * 256).add(t.g.mul(255)).div(65535).mul(uSpan));
    };


    const sampleBaseGeometryH = (wp) => {
      // Filtering packed R/G separately amplifies sampler rounding into
      // decimetre displacement errors. Fetch exact bytes, decode each
      // height, then interpolate in shader float precision. Fragment
      // sampleH deliberately retains its existing implicit mip filtering.
      const q = clamp(worldUV(wp).mul(this.meta.grid - 1), 0, this.meta.grid - 1).toVar();
      const cell = floor(q).toVar(), f = fract(q).toVar();
      const at = (offset) => {
        const t = textureLoad(hTex, ivec2(clamp(cell.add(offset), 0, this.meta.grid - 1)), 0).toVar();
        return uMin.add(t.r.mul(255 * 256).add(t.g.mul(255)).div(65535).mul(uSpan));
      };
      const a = at(vec2(0)).toVar(), b = at(vec2(1, 0)).toVar();
      const c = at(vec2(0, 1)).toVar(), d = at(vec2(1)).toVar();
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    };

    const sourceField = this.sourceField;
    const sampleGeometryH = sourceField
      ? sourceField.compositeHeightNode(sampleBaseGeometryH) : sampleBaseGeometryH;
    const sampleSourceMaterialH = sourceField?.compositeHeightNode(
      wp => sampleBaseMaterialH(wp), "Material", { implicitBaseFilter: true });
    const sampleH = (wp, explicitLevel = null) => sourceField
      ? (explicitLevel === null ? sampleSourceMaterialH(wp) : sampleGeometryH(wp))
      : sampleBaseMaterialH(wp, explicitLevel);
    // Shared diagnostic hooks also describe the contract used by all four
    // current/parent samples below. Collision uses the same static source.
    this.geometryHeightNode = sampleGeometryH;
    this.baseGeometryHeightNode = sampleBaseGeometryH;

    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0 });
    const surface = this.curvature?.surfaceNodes("terrain");
    const mapPosition = surface ? surface.flat : positionWorld;
    const previousFlat = !surface && this.nearDetail
      ? varyingProperty("vec3", "terrainPreviousFlatPosition") : null;
    if (previousFlat) this.surfaceMotion.previousPositionNode = previousFlat;
    mat.mrtNode = surface ? surface.mrt : this.surfaceMotion.mrt;

    // vertex: displace by sampled height; push skirt ring down.
    // positionWorld derives FROM positionNode (chicken-egg), so world XZ is
    // computed explicitly via the model matrix. Node meshes use scaleY=1 and
    // posY=0, so local Y == world Y and the height lands directly.
    mat.positionNode = Fn(() => {
      const wp = modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz;
      const h = sampleGeometryH(wp).toVar("terrainDetailHeight");
      const previousH = h.add(0).toVar("terrainPreviousDetailHeight");
      if (this.nearDetail) If(attribute("terrainDetail", "float").greaterThan(.5), () => {
        // Reconstruct the actual parent triangle with three height taps.
        // At the outer morph boundary the denser grid is the same plane
        // as the coarse mesh, so changing geometry cannot pop the surface.
        const q = positionLocal.xz.add(.5).mul(TERRAIN_COARSE_INTERVALS);
        const cell = clamp(floor(q), 0, TERRAIN_COARSE_INTERVALS - 1);
        const f = q.sub(cell), upper = f.x.add(f.y).greaterThan(1);
        const cornerHeight = (offset) => {
          const xz = cell.add(offset).div(TERRAIN_COARSE_INTERVALS).sub(.5);
          return sampleGeometryH(modelWorldMatrix.mul(vec4(xz.x, 0, xz.y, 1)).xyz);
        };
        const a = cornerHeight(select(upper, vec2(1), vec2(0))).toVar();
        const b = cornerHeight(vec2(1, 0)).toVar(), c = cornerHeight(vec2(0, 1)).toVar();
        const parent = select(upper,
          a.mul(f.x.add(f.y).sub(1)).add(b.mul(float(1).sub(f.y))).add(c.mul(float(1).sub(f.x))),
          a.mul(float(1).sub(f.x).sub(f.y)).add(b.mul(f.x)).add(c.mul(f.y))).toVar("terrainParentHeight");
        const flatParent = vec3(wp.x, parent, wp.z);
        const renderedParent = this.curvature ? this.curvature.forwardNode(flatParent) : flatParent;
        const distance = length(renderedParent.sub(this.uDetailCamera));
        const blend = float(1).sub(smoothstep(TERRAIN_DETAIL_FULL_M, TERRAIN_DETAIL_END_M, distance)).mul(this.uDetailStrength);
        const previousParent = this.curvature
          ? this.curvature.forwardNode(flatParent, this.curvature.previousOrigin) : flatParent;
        const previousDistance = length(previousParent.sub(this.uPreviousDetailCamera));
        const previousBlend = float(1).sub(smoothstep(TERRAIN_DETAIL_FULL_M, TERRAIN_DETAIL_END_M, previousDistance)).mul(this.uPreviousDetailStrength);
        previousH.assign(mix(parent, h, previousBlend));
        h.assign(mix(parent, h, blend));
      });
      const skirtDrop = attribute("skirt", "float").mul(60.0);
      const prior = vec3(wp.x, previousH.sub(skirtDrop), wp.z);
      if (surface) return surface.vertex(vec3(wp.x, h.sub(skirtDrop), wp.z), prior);
      if (previousFlat) previousFlat.assign(prior);
      return vec3(positionLocal.x, h.sub(skirtDrop), positionLocal.z);
    })();

    // normals: existing baked 8k map when present (1 tap replaces 4);
    // bake is (R=east, G=north, B=up), this material's frame is x=east,
    // y=up, z=north — so (r, b, g). Fallback: central differences.
    const eps = 16.0;
    const nrmTex = this.drape.nrm;
    const bakedNormal = Fn(() => {
      const wp = mapPosition;
      if (nrmTex) {
        const n = texture(nrmTex, worldUV(wp)).rgb.mul(2.0).sub(1.0);
        return normalize(vec3(n.r, n.b, n.g));
      }
      const hx1 = sampleBaseMaterialH(vec3(wp.x.add(eps), wp.y, wp.z));
      const hx0 = sampleBaseMaterialH(vec3(wp.x.sub(eps), wp.y, wp.z));
      const hz1 = sampleBaseMaterialH(vec3(wp.x, wp.y, wp.z.add(eps)));
      const hz0 = sampleBaseMaterialH(vec3(wp.x, wp.y, wp.z.sub(eps)));
      return normalize(vec3(hx0.sub(hx1), float(eps * 2), hz0.sub(hz1)));
    })().toVar("terrainBakedNormalWorld");
    const baseNormal = (sourceField
      ? sourceField.normalNode(mapPosition, bakedNormal, sampleBaseGeometryH)
      : bakedNormal).toVar("terrainBaseNormalWorld");
    const albedoTex = this.drape.albedo, coverTex = this.drape.cover, aoTex = this.drape.ao;
    const baseImageColor = albedoTex ? texture(albedoTex, worldUV(mapPosition)).rgb : null;
    const imageColor = baseImageColor && this.geographicImagery
      ? geographicImageryNode(this.geographicImagery, mapPosition, baseImageColor) : baseImageColor;
    const materialsEnabled = typeof location === "undefined" ||
      new URLSearchParams(location.search).get("terrainmaterials") !== "0";
    const detail = materialsEnabled ? terrainMaterialNodes({
      front: this.front, baseNormal, imageColor, worldPosition: mapPosition,
      coverage: coverTex ? texture(coverTex, worldUV(mapPosition)).r : float(1),
      photoDetail: this.photoDetail,
    }) : null;
    const flatNormal = detail ? detail.normalWorld : baseNormal;
    const renderNormal = this.curvature ? this.curvature.normalNode(flatNormal, mapPosition) : flatNormal;
    mat.normalNode = renderNormal.transformDirection(cameraViewMatrix);
    if (detail) {
      mat.roughnessNode = detail.roughness;
      // Baked occlusion belongs to indirect lighting, not the albedo or Sun.
      if (aoTex) mat.aoNode = mix(float(1), texture(aoTex, worldUV(mapPosition)).r, detail.land.mul(.75));
    }

    // value noise for ground variation (macro patchiness + micro grain)
    const hash2 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
    const vnoise = (p) => {
      const i = floor(p), f = fract(p);
      const u = f.mul(f).mul(f.mul(-2.0).add(3.0)); // smoothstep fade
      const a = hash2(i), b = hash2(i.add(vec2(1, 0)));
      const c = hash2(i.add(vec2(0, 1))), d = hash2(i.add(vec2(1, 1)));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    };

    // color: real-imagery drape crossfaded over the per-front procedural
    // ramps by the coverage mask (imagery holes fall back seamlessly)
    const front = this.front;
    // PASS-1 item 6a: on ocean fronts, classified water must never wear the
    // ortho's baked sea surface — static photo glints against the live ocean
    // read as confetti wherever the terrain shows around/through the sheet.
    // Lazily built here (water fronts only), same field the water shader uses.
    const shore = this.meta.minH < -0.5 ? this.getShoreField() : null;
    mat.colorNode = Fn((_, builder) => {
      const wp = mapPosition;
      this.oceanOcclusion.discardHidden(wp, () => sampleH(wp, 0), builder);
      const h = sampleH(wp);
      const tAlt = clamp(h.sub(uMin).div(uSpan), 0, 1);
      let slope;
      if (sourceField) {
        slope = clamp(baseNormal.x.abs().add(baseNormal.z.abs()).div(baseNormal.y.max(.15)), 0, 1);
      } else if (nrmTex) {
        // same semantics as the tap-based estimate: (|dh/dx|+|dh/dz|), from
        // the baked normal (dh/dx = -nx/ny in this frame)
        const n = texture(nrmTex, worldUV(wp)).rgb.mul(2.0).sub(1.0);
        slope = clamp(n.r.abs().add(n.g.abs()).div(max(n.b, 0.15)), 0, 1);
      } else {
        const hx1 = sampleH(vec3(wp.x.add(eps), wp.y, wp.z));
        const hz1 = sampleH(vec3(wp.x, wp.y, wp.z.add(eps)));
        slope = clamp(h.sub(hx1).abs().add(h.sub(hz1).abs()).div(eps), 0, 1);
      }
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

      // procedural branch gets the synthetic variation (macro brightness +
      // hue drift); real imagery carries its own macro truth
      c = c.mul(macro.sub(0.5).mul(0.34).add(1.0));
      c = c.mul(mix(vec3(1.05, 1.0, 0.93), vec3(0.96, 1.0, 1.05), macro));
      // Resolve material relief through the normal/roughness graph. The old
      // 45m color grain remains only in the explicit baseline A/B path.
      const micro = detail ? float(0.5) : vnoise(wp.xz.div(45.0));
      c = c.mul(micro.sub(0.5).mul(0.12).add(1.0));

      if (albedoTex) {
        // MAXFI A2: the real Earth. Micro grain (light) de-flattens the
        // 4m/px imagery up close; coverage mask crossfades imagery holes
        // back to the ramps.
        let ci = imageColor;
        // PASS-2 item 3: NAIP's blue-gray cast on the dry front — warm
        // white-balance at ingest (the physical playa albedo photographs
        // cool under blue sky; the eye expects warm desert)
        if (front === "NELLIS") {
          ci = ci.mul(vec3(1.14, 1.0, 0.82)); // stronger warm WB (3rd-pass fail: B−R must go negative on sunlit ground)
          const l = dot(ci, vec3(0.2126, 0.7152, 0.0722));
          ci = vec3(l, l, l).add(ci.sub(vec3(l, l, l)).mul(1.18)); // saturation floor — desaturating to gray is cheating
        }
        ci = ci.mul(micro.sub(0.5).mul(0.08).add(1.0));
        const cov = coverTex ? texture(coverTex, worldUV(wp)).r : float(1.0);
        c = mix(c, ci, cov);
      }
      if (detail?.albedoNode) c = detail.albedoNode(c);
      let waterK = null;
      if (shore) {
        // item 6a: fade imagery AND ramps to the water shader's own color
        // ramp where the seafloor drops away. Height feather (-1 → -3m)
        // keeps the prized 0..-1m reef/beach shallows (Saipan's turquoise
        // ring); the shore-distance feather keeps the surf strip and kills
        // any straight tile/cover seam over open water.
        const sd = texture(shore.tex, worldUV(wp)).r.mul(shore.maxDist);
        const wDeep = float(1.0).sub(smoothstep(-3.0, -1.0, h));
        waterK = wDeep.mul(smoothstep(40.0, 220.0, sd));
        const deepW = front === "VALDEZ" ? srgbLin(0x0e2e33) : srgbLin(0x06334e);
        const shalW = front === "VALDEZ" ? srgbLin(0x2e6b66) : srgbLin(0x2ba098);
        const waterC = mix(vec3(...shalW), vec3(...deepW), smoothstep(20.0, 520.0, sd));
        c = mix(c, waterC, waterK);
      }
      if (aoTex && !detail) {
        // baked multi-scale AO (bypassed on classified water — bake artifacts
        // over the sea would texture the flat water color)
        const ao = mix(float(1.0), texture(aoTex, worldUV(wp)).r, 0.75);
        c = c.mul(waterK ? mix(ao, float(1.0), waterK) : ao);
      }
      return c;
    })();
    if (this.aerial) {
      const aerial = this.aerial;
      // Transport the completed surface lighting, including its specular
      // reflection, through the same air as water and clouds. One shared
      // march supplies both extinction and atmospheric radiance.
      mat.fog = false;
      mat.outputNode = Fn(() => vec4(
        aerial.composite
          ? aerial.composite(positionWorld, output.rgb)
          : output.rgb.mul(aerial.trans(positionWorld)).add(aerial.ins(positionWorld).mul(aerial.uSunI)),
        output.a
      ))();
    }

    return mat;
  }

  setDetailTier(tier) {
    this.detailTransition.setEnabled(tierHasNearTerrain(tier));
    this._geographicEnabled = tier === "HIGH" || tier === "ULTRA";
    this.prepareDetail(tier);
  }

  // Settings are applied behind the loading veil. Move the roughly 3 MB
  // CPU mesh construction there, so descending toward terrain cannot
  // trigger it mid-frame. Allocation does not affect the selected LOD.
  prepareDetail(tier) {
    if (this.nearDetail && tierHasNearTerrain(tier) && !this.fineGrid)
      this.fineGrid = createTerrainGrid(TERRAIN_FINE_INTERVALS);
    return this.fineGrid;
  }

  // Main-view update only. Other camera passes reuse this frame's geometry.
  update(camera, renderDt = 0) {
    this.geographicImagery?.update({ x: camera.position.x, z: camera.position.z,
      heightAboveGroundM: camera.position.y - this.heightAt(camera.position.x, camera.position.z),
      enabled: this._geographicEnabled });
    this.surfaceMotion?.update(camera);
    const historyValid = (this.curvature || this.surfaceMotion).historyValid.value;
    this.detailTransition.advance(renderDt, historyValid);
    this.uDetailStrength.value = this.detailTransition.current;
    this.uPreviousDetailStrength.value = this.detailTransition.previous;
    this.uPreviousDetailCamera.value.copy(this.uDetailCamera.value);
    this.uDetailCamera.value.copy(camera.position);
    if (!(this.curvature || this.surfaceMotion).historyValid.value)
      this.uPreviousDetailCamera.value.copy(camera.position);
    camera.updateMatrixWorld();
    this._proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._proj, camera.coordinateSystem, camera.reversedDepth);
    const cam = camera.position;
    const out = this._selection;
    let selectedCount = 0;

    const visit = (level, ix, iz) => {
      const size = this.size / (1 << level);
      const cx = -this.size / 2 + (ix + 0.5) * size;
      // leaf z index 0 = north = +Z half
      const cz = this.size / 2 - (iz + 0.5) * size;
      const index = iz * (1 << level) + ix;
      const mn = this._nodeMin[level][index], mx = this._nodeMax[level][index];
      this._box.min.set(cx - size / 2, mn - 70, cz - size / 2);
      this._box.max.set(cx + size / 2, mx + 10, cz + size / 2);
      if (this.curvature) this.curvature.bounds(this._box, this._box);
      if (!this._frustum.intersectsBox(this._box)) return;
      const dx = Math.max(Math.abs(cam.x - cx) - size / 2, 0);
      const dz = Math.max(Math.abs(cam.z - cz) - size / 2, 0);
      const dy = Math.max(cam.y - this._box.max.y, this._box.min.y - cam.y, 0);
      const dist = Math.hypot(dx, dy, dz);
      if (level >= MAX_LEVEL || dist > size * LOD_K) {
        if (selectedCount < out.length) {
          const node = out[selectedCount];
          node.cx = cx; node.cz = cz; node.size = size; node.level = level;
          node.fine = this.detailTransition.useFine && level === MAX_LEVEL && dist < TERRAIN_DETAIL_SELECT_M;
        }
        selectedCount++;
        return;
      }
      visit(level + 1, ix * 2, iz * 2);
      visit(level + 1, ix * 2 + 1, iz * 2);
      visit(level + 1, ix * 2, iz * 2 + 1);
      visit(level + 1, ix * 2 + 1, iz * 2 + 1);
    };
    visit(0, 0, 0);

    const n = Math.min(selectedCount, this.pool.length);
    let minL = 99, maxL = 0, fineNodes = 0;
    let allocatedFine = false;
    for (let i = 0; i < n; i++) {
      const m = this.pool[i], nd = out[i];
      if (nd.fine) {
        fineNodes++;
        if (!this.fineGrid) {
          this.fineGrid = createTerrainGrid(TERRAIN_FINE_INTERVALS);
          allocatedFine = true;
        }
      }
      m.geometry = nd.fine ? this.fineGrid : this.grid;
      m.position.set(nd.cx, 0, nd.cz);
      m.scale.set(nd.size, 1, nd.size);
      m.updateMatrixWorld();
      m.visible = true;
      if (nd.level < minL) minL = nd.level;
      if (nd.level > maxL) maxL = nd.level;
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].visible = false;
    this.stats = { nodes: n, minLevel: minL, maxLevel: maxL, overflow: selectedCount - n,
      fineNodes, detailStrength: this.detailTransition.current,
      previousDetailStrength: this.detailTransition.previous,
      detailTarget: this.detailTransition.target, fineCached: !!this.fineGrid,
      detailSettling: allocatedFine || this.detailTransition.settling };
  }

  // Shore-distance field (meters from land, sea cells only) — the bake clamps
  // bathymetry to 0, so water depth is proxied by distance-to-shore. 2048²
  // two-pass chamfer transform (~200ms), lazily built, uploaded as a texture.
  // (PASS-1 item 7: 1024 = 64m texels — the foam band consumed the field at
  // sub-texel width and drew its bilinear diamonds as a coastline staircase.)
  getShoreField() {
    if (this._shore) return this._shore;
    const N = 2048, step = this.size / N;
    const d = new Float32Array(N * N);
    const BIG = 1e9;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++)
        // This raster represents pixel areas. Classify its physical cell
        // centers against the same endpoint DEM used by collision/geometry.
        d[j * N + i] = this.heightAt(((i + .5) / N - .5) * this.size,
          (.5 - (j + .5) / N) * this.size) > .5 ? 0 : BIG;
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
    return this.sourceField
      ? this.sourceField.heightAt(x, z, this._baseHeightAt)
      : this.baseHeightAt(x, z);
  }

  baseHeightAt(x, z) {
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
