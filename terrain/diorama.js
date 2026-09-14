import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';

const RADIUS = 6378137;
const WORLD = 2 * Math.PI * RADIUS;
const TAU = Math.PI * 2;
const mercator = (lng, lat) => [(lng + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2];
const positionOf = p => p.coordinates || [p.lng, p.lat];
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const palette = [[-90, [24, 66, 67]], [0, [45, 76, 44]], [150, [65, 100, 46]], [600, [76, 111, 49]], [1300, [126, 133, 72]], [2200, [168, 151, 113]], [3200, [192, 184, 159]], [4300, [237, 232, 214]], [6200, [251, 247, 230]]];
function colorAt(elevation) {
  const h = Math.max(-90, elevation);
  for (let i = 1; i < palette.length; i++) if (h <= palette[i][0]) {
    const [a, ca] = palette[i - 1], [b, cb] = palette[i];
    return ca.map((c, j) => mix(c, cb[j], (h - a) / (b - a)));
  }
  return palette.at(-1)[1];
}
function canvas(width, height) { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; }
function dispose(object) {
  object?.traverse(item => {
    item.geometry?.dispose();
    const materials = Array.isArray(item.material) ? item.material : item.material ? [item.material] : [];
    materials.forEach(m => { m.map?.dispose(); m.alphaMap?.dispose(); m.dispose(); });
    item.customDepthMaterial?.dispose();
  });
}

/** Finite terrain sculptures built from measured elevation and actual state boundaries. */
export class Diorama {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.surface = 'natural';
    this.relief = 20;
    this.padding = { top: 70, left: 370, right: 95, bottom: 120 };
    this.markers = new Map();
    this.places = {};
    this.cache = new Map();
    this.loading = false;
    this.active = true;
    this.loadSequence = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async init() {
    const [boundaries, relief] = await Promise.all([
      fetch(new URL('./data/states.geojson', import.meta.url)).then(r => { if (!r.ok) throw new Error('State shapes could not load.'); return r.json(); }),
      fetch(new URL('./data/relief/states.json', import.meta.url)).then(r => { if (!r.ok) throw new Error('The elevation collection could not load.'); return r.json(); }),
    ]);
    this.boundaries = boundaries;
    this.metadata = relief.states || relief;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#090c0b');
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 150);
    this.camera.position.set(-0.6, 11, 13.3);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const dom = this.renderer.domElement;
    dom.className = 'diorama-canvas';
    dom.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;outline:none';
    dom.tabIndex = 0;
    dom.setAttribute('aria-label', 'Interactive state sculpture. Drag to rotate, right-drag to pan, and scroll to zoom. Arrow keys rotate; plus and minus zoom.');
    this.container.append(dom);
    this.labels = document.createElement('div');
    this.labels.className = 'diorama-labels';
    this.labels.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    this.container.append(this.labels);
    this.credit = document.createElement('div');
    this.credit.className = 'diorama-credit';
    this.credit.style.cssText = 'position:absolute;right:18px;bottom:9px;color:#9c9c89;font:8px/1.5 Inter, sans-serif;max-width:66%;text-align:right;opacity:.8';
    this.credit.innerHTML = '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain: USGS · NOAA · Mapzen</a> · <a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" rel="noopener">Imagery © Esri & contributors</a>';
    this.container.append(this.credit);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 40;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.7;
    this.controls.panSpeed = 0.6;
    this.controls.addEventListener('start', () => { this.stopOrbit(); this.animation = null; });
    this.controls.addEventListener('change', () => { this.dirty = true; this._notify(); });
    this.controls.target.set(0, 0.1, 0);
    const hemisphere = new THREE.HemisphereLight('#f0f3e9', '#233233', 1.15);
    this.scene.add(hemisphere);
    this.sun = new THREE.DirectionalLight('#fff1d5', 2.6);
    this.sun.position.set(-7, 9, 5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.1, far: 35 });
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.012;
    this.scene.add(this.sun);
    const rim = new THREE.DirectionalLight('#b7d7d2', 0.8);
    rim.position.set(4, 5, -8);
    this.scene.add(rim);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshBasicMaterial({ color: '#0b1012', toneMapped: false }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.58;
    this.floor.receiveShadow = false;
    this.scene.add(this.floor);
    // A restrained soft contact pool makes the object sit in an otherwise empty stage.
    const shade = canvas(128, 128), ctx = shade.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(0,0,0,.6)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    this.contact = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shade), transparent: true, depthWrite: false }));
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.y = -0.572;
    this.scene.add(this.contact);
    this.surfaceUniform = { value: 0 };
    this.contourUniform = { value: 250 };
    dom.addEventListener('keydown', event => {
      if (event.key === '+' || event.key === '=') { this.zoomIn(); event.preventDefault(); }
      if (event.key === '-') { this.zoomOut(); event.preventDefault(); }
      if (event.key.startsWith('Arrow')) {
        this.stopOrbit();
        const offset = this.camera.position.clone().sub(this.controls.target);
        const sphere = new THREE.Spherical().setFromVector3(offset);
        if (event.key === 'ArrowLeft') sphere.theta -= 0.12;
        if (event.key === 'ArrowRight') sphere.theta += 0.12;
        if (event.key === 'ArrowUp') sphere.phi = Math.max(0.12, sphere.phi - 0.08);
        if (event.key === 'ArrowDown') sphere.phi = Math.min(Math.PI * 0.47, sphere.phi + 0.08);
        this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(sphere));
        this.controls.update(); event.preventDefault();
      }
    });
    this.resize();
    this._frame = this._frame.bind(this);
    this.frame = requestAnimationFrame(this._frame);
    return this;
  }

  _notify() {
    if (this.notifyFrame) return;
    this.notifyFrame = requestAnimationFrame(() => { this.notifyFrame = null; this.callbacks.onMove?.(this.getView()); });
  }

  async setState(state) {
    this.state = state;
    const sequence = ++this.loadSequence;
    this.stopOrbit();
    this.loading = true;
    this.imageryReady = false;
    this._notify();
    if (this.model) { this.scene.remove(this.model); dispose(this.model); this.model = null; }
    this.setPlaces(this.places);
    try {
      let data = this.cache.get(state.code);
      if (!data) {
        let metadata = this.metadata[state.code];
        if (!metadata) {
          this.metadata = await fetch(new URL('./data/relief/states.json', import.meta.url)).then(r => r.json());
          metadata = this.metadata[state.code];
        }
        if (!metadata) throw new Error(`The ${state.name} elevation model is not available.`);
        const response = await fetch(new URL(`./data/relief/${metadata.file || state.code + '.bin'}`, import.meta.url));
        if (!response.ok) throw new Error(`The ${state.name} elevation model could not load.`);
        const buffer = await response.arrayBuffer();
        data = { ...metadata, heights: new Int16Array(buffer) };
        if (data.heights.length !== data.width * data.height) throw new Error('The terrain file is incomplete. Reload to try again.');
        this.cache.set(state.code, data);
        if (this.cache.size > 5) this.cache.delete(this.cache.keys().next().value);
      }
      if (sequence !== this.loadSequence) return;
      this.data = data;
      this.feature = this.boundaries.features.find(f => f.properties.code === state.code);
      if (!this.feature) throw new Error(`The ${state.name} outline could not load.`);
      this._buildModel();
      this.loading = false;
      this.resetView(false);
      this.setPlaces(this.places);
      this.setTrail(this.trail || []);
      this._notify();
      this._loadImagery(sequence);
    } catch (error) {
      if (sequence !== this.loadSequence) return;
      this.loading = false;
      error.fatal = false;
      this.callbacks.onError?.(error);
      this._notify();
    }
  }

  _sample(u, v) {
    const d = this.data, x = clamp(u * d.width - 0.5, 0, d.width - 1), y = clamp(v * d.height - 0.5, 0, d.height - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, d.width - 1), y1 = Math.min(y0 + 1, d.height - 1);
    const a = mix(d.heights[y0 * d.width + x0], d.heights[y0 * d.width + x1], x - x0);
    const b = mix(d.heights[y1 * d.width + x0], d.heights[y1 * d.width + x1], x - x0);
    return Math.max(-90, mix(a, b, y - y0));
  }

  _world(lng, lat, lift = 0) {
    let [x, y] = mercator(lng, lat);
    const [x0, y0, x1, y1] = this.data.mercatorBounds;
    while (x > x1 + 0.2) x -= 1;
    const u = (x - x0) / (x1 - x0), v = (y - y0) / (y1 - y0);
    return new THREE.Vector3((u - 0.5) * this.modelWidth, this._sample(u, v) * this.heightScale * this.relief + lift, (v - 0.5) * this.modelHeight);
  }

  _buildModel() {
    const d = this.data;
    const [x0, y0, x1, y1] = d.mercatorBounds;
    const spanX = x1 - x0, spanY = y1 - y0, longest = Math.max(spanX, spanY);
    this.modelWidth = spanX / longest * 10;
    this.modelHeight = spanY / longest * 10;
    const latitude = (d.bounds[1] + d.bounds[3]) / 2;
    this.heightScale = 10 / (longest * WORLD * Math.cos(latitude * Math.PI / 180));
    this.baseDepth = 0.32;
    const longestGrid = innerWidth < 761 ? 320 : Math.min(600, Math.max(d.width, d.height));
    const columns = Math.max(2, Math.round(longestGrid * spanX / longest));
    const rows = Math.max(2, Math.round(longestGrid * spanY / longest));
    const geometry = new THREE.PlaneGeometry(this.modelWidth, this.modelHeight, columns, rows);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    this.elevations = new Float32Array(positions.count);
    for (let i = 0; i < positions.count; i++) {
      const u = (positions.getX(i) / this.modelWidth + 0.5), v = (positions.getZ(i) / this.modelHeight + 0.5);
      const elevation = this._sample(u, v);
      this.elevations[i] = elevation;
      positions.setY(i, elevation * this.heightScale * this.relief);
    }
    geometry.setAttribute('elevation', new THREE.BufferAttribute(this.elevations, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mask = canvas(Math.max(64, Math.round(2048 * this.modelWidth / 10)), Math.max(64, Math.round(2048 * this.modelHeight / 10)));
    const ctx = mask.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, mask.width, mask.height);
    ctx.fillStyle = '#fff';
    this.polygons = this.feature.geometry.type === 'MultiPolygon' ? this.feature.geometry.coordinates : [this.feature.geometry.coordinates];
    for (const polygon of this.polygons) {
      ctx.beginPath();
      for (const ring of polygon) ring.forEach(([lng, lat], index) => {
        const [x, y] = mercator(lng, lat);
        const px = (x - x0) / spanX * mask.width, py = (y - y0) / spanY * mask.height;
        if (index) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.fill('evenodd');
    }
    const maskTexture = new THREE.CanvasTexture(mask);
    maskTexture.colorSpace = THREE.NoColorSpace;
    maskTexture.minFilter = THREE.LinearFilter;
    const material = new THREE.MeshStandardMaterial({
      map: this._naturalTexture(), alphaMap: maskTexture, alphaTest: 0.48, roughness: 0.93, metalness: 0,
    });
    material.onBeforeCompile = shader => {
      shader.uniforms.surfaceMode = this.surfaceUniform;
      shader.uniforms.contourInterval = this.contourUniform;
      shader.vertexShader = 'attribute float elevation; varying float terrainElevation;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nterrainElevation = elevation;');
      shader.fragmentShader = 'uniform float surfaceMode; uniform float contourInterval; varying float terrainElevation;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        if (surfaceMode > 0.5) {
          float h = max(0.0, terrainElevation);
          vec3 low = vec3(0.17, 0.32, 0.20), middle = vec3(0.60, 0.53, 0.29), high = vec3(0.89, 0.82, 0.64);
          vec3 elevationColor = h < 1500.0 ? mix(low, middle, smoothstep(0.0, 1500.0, h)) : mix(middle, high, smoothstep(1500.0, 4300.0, h));
          diffuseColor.rgb = elevationColor;
          if (surfaceMode > 1.5) {
            float line = abs(fract(terrainElevation / contourInterval + 0.5) - 0.5);
            float edge = fwidth(terrainElevation / contourInterval) * 0.8;
            float contour = 1.0 - smoothstep(0.0, max(0.005, edge), line);
            diffuseColor.rgb = mix(diffuseColor.rgb * 0.72, vec3(0.82,0.76,0.57), contour * 0.7);
          }
        }
      `);
    };
    this.top = new THREE.Mesh(geometry, material);
    this.top.castShadow = true;
    this.top.receiveShadow = true;
    this.top.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: maskTexture, alphaTest: 0.48 });
    this.model = new THREE.Group();
    this.model.add(this.top);
    this._buildSides();
    this.scene.add(this.model);
    this.contourUniform.value = d.max > 3000 ? 250 : d.max > 1000 ? 100 : d.max > 250 ? 50 : 10;
    this.setSurface(this.surface);
    this.dirty = true;
  }

  _buildSides() {
    if (this.sides) { this.model.remove(this.sides); this.sides.geometry.dispose(); this.sides.material.dispose(); }
    const vertices = [], colors = [];
    const bands = 5;
    const push = (point, shade) => { vertices.push(point.x, point.y, point.z); colors.push(shade[0], shade[1], shade[2]); };
    for (const polygon of this.polygons) for (const ring of polygon) {
      const outline = polygon[0].map(p => this._world(...p));
      let area = 0;
      for (let i = 1; i < outline.length; i++) area += outline[i - 1].x * outline[i].z - outline[i].x * outline[i - 1].z;
      const cutDepth = Math.min(this.baseDepth, Math.max(0.018, Math.sqrt(Math.abs(area) / 2) * 0.14));
      for (let i = 1; i < ring.length; i++) {
        const a = this._world(...ring[i - 1]), b = this._world(...ring[i]);
        const horizontal = Math.hypot(b.x - a.x, b.z - a.z);
        const pieces = Math.max(1, Math.ceil(horizontal / 0.025));
        for (let segment = 0; segment < pieces; segment++) {
          const p = a.clone().lerp(b, segment / pieces), q = a.clone().lerp(b, (segment + 1) / pieces);
          const noise = Math.sin(p.x * 61 + p.z * 143) * 0.009;
          for (let band = 0; band < bands; band++) {
            const t0 = band / bands, t1 = (band + 1) / bands;
            const p0 = p.clone(), p1 = p.clone(), q0 = q.clone(), q1 = q.clone();
            p0.y = mix(-cutDepth, p.y, t0); p1.y = mix(-cutDepth, p.y, t1);
            q0.y = mix(-cutDepth, q.y, t0); q1.y = mix(-cutDepth, q.y, t1);
            const stratum = band % 3 === 0 ? -0.009 : band % 3 === 1 ? 0.006 : 0;
            const shade = [0.035 + t1 * 0.052 + noise + stratum, 0.041 + t1 * 0.050 + noise + stratum, 0.036 + t1 * 0.030 + noise + stratum];
            push(p0, shade); push(q1, shade); push(q0, shade); push(p0, shade); push(p1, shade); push(q1, shade);
          }
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    this.sides = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 }));
    this.sides.castShadow = true;
    this.sides.receiveShadow = true;
    this.model.add(this.sides);
  }

  _naturalTexture(imagery) {
    const d = this.data, c = canvas(d.width, d.height), context = c.getContext('2d');
    let imagePixels;
    if (imagery) { context.drawImage(imagery, 0, 0, c.width, c.height); imagePixels = context.getImageData(0, 0, c.width, c.height).data; }
    const output = context.createImageData(c.width, c.height);
    for (let i = 0; i < d.heights.length; i++) {
      const h = d.heights[i];
      const color = colorAt(h);
      for (let channel = 0; channel < 3; channel++) {
        let value = color[channel];
        if (imagePixels) {
          const r = imagePixels[i * 4], g = imagePixels[i * 4 + 1], b = imagePixels[i * 4 + 2];
          const average = (r + g + b) / 3;
          const saturated = clamp(average + (imagePixels[i * 4 + channel] - average) * 1.3, 0, 255);
          value = mix(color[channel], saturated * 1.15, h < 0 ? 0.93 : 0.73);
          if (h > 3000) value = mix(value, color[channel], clamp((h - 3000) / 2200, 0, 0.5));
        }
        output.data[i * 4 + channel] = clamp(value, 0, 255);
      }
      output.data[i * 4 + 3] = 255;
    }
    context.putImageData(output, 0, 0);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  async _loadImagery(sequence) {
    const data = this.data, [x0, y0, x1, y1] = data.mercatorBounds;
    const zoom = clamp(Math.ceil(Math.log2(1300 / (256 * Math.max(x1 - x0, y1 - y0)))), 2, 12), n = 2 ** zoom;
    const minX = Math.floor(x0 * n), maxX = Math.floor(x1 * n), minY = Math.floor(y0 * n), maxY = Math.floor(y1 * n);
    const mosaic = canvas((maxX - minX + 1) * 256, (maxY - minY + 1) * 256), context = mosaic.getContext('2d');
    const jobs = [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) jobs.push({ x, y });
    let failed = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (jobs.length && sequence === this.loadSequence) {
        const { x, y } = jobs.shift();
        try {
          const response = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${((x % n) + n) % n}`, { signal: AbortSignal.timeout(12000) });
          if (!response.ok) throw new Error('Imagery tile unavailable');
          const bitmap = await createImageBitmap(await response.blob());
          context.drawImage(bitmap, (x - minX) * 256, (y - minY) * 256); bitmap.close();
        } catch { failed++; }
      }
    }));
    if (sequence !== this.loadSequence || failed || !this.top) return;
    const cropped = canvas(data.width, data.height), crop = cropped.getContext('2d');
    crop.drawImage(mosaic, (x0 * n - minX) * 256, (y0 * n - minY) * 256, (x1 - x0) * n * 256, (y1 - y0) * n * 256, 0, 0, cropped.width, cropped.height);
    const old = this.top.material.map;
    this.top.material.map = this._naturalTexture(cropped);
    old.dispose();
    this.imageryReady = true;
    this._notify();
    this.dirty = true;
  }

  resetView(animate = true) {
    if (!this.model) return;
    this.stopOrbit();
    this.controls.target.set(0, 0.12, 0);
    this.framingOffset = { x: 0, y: 0 };
    this.camera.position.set(-0.3, 14, 11);
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld();
    this._applyPadding();
    const width = this.container.clientWidth, height = this.container.clientHeight;
    const availableWidth = Math.max(width * 0.4, width - this.padding.left - this.padding.right);
    const availableHeight = Math.max(height * 0.33, height - this.padding.top - this.padding.bottom);
    for (let attempt = 0; attempt < 3; attempt++) {
      this.camera.updateMatrixWorld();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const polygon of this.polygons) for (const [lng, lat] of polygon[0]) {
        const p = this._world(lng, lat).project(this.camera);
        const x = (p.x + 1) * width / 2, y = (1 - p.y) * height / 2;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      const ratio = Math.max((maxX - minX) / (availableWidth * 0.92), (maxY - minY) / (availableHeight * 0.94));
      this.camera.position.sub(this.controls.target).multiplyScalar(ratio).add(this.controls.target);
    }
    this.camera.updateMatrixWorld();
    const projected = this.polygons.flatMap(p => p[0].map(([lng,lat]) => this._world(lng,lat).project(this.camera)));
    const centerX = (Math.min(...projected.map(p => p.x)) + Math.max(...projected.map(p => p.x))) / 2;
    const centerY = (Math.min(...projected.map(p => p.y)) + Math.max(...projected.map(p => p.y))) / 2;
    const desiredX = (this.padding.left - this.padding.right) / width;
    const desiredY = (this.padding.bottom - this.padding.top) / height;
    this.framingOffset = { x: (centerX - desiredX) * width / 2, y: -(centerY - desiredY) * height / 2 };
    this._applyPadding();
    this.homeDistance = this.camera.position.distanceTo(this.controls.target);
    this.controls.update();
    this._notify();
    this.dirty = true;
  }

  setPadding(padding) { this.padding = { ...this.padding, ...padding }; this._applyPadding(); this.dirty = true; }
  _applyPadding() {
    if (!this.camera) return;
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const left = Math.min(this.padding.left, w * 0.45), right = Math.min(this.padding.right, w * 0.45);
    const top = Math.min(this.padding.top, h * 0.32), bottom = Math.min(this.padding.bottom, h * 0.7);
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, (right - left) / 2 + (this.framingOffset?.x || 0), (bottom - top) / 2 + (this.framingOffset?.y || 0), w, h);
    this.camera.updateProjectionMatrix();
  }

  setPlaces(options = {}) {
    this.places = options;
    const { cities = [], features = [], history = [], selectedId, showCities = true, showFeatures = true, showHistory = true } = options;
    const all = [...(showCities ? cities.map(p => ({ ...p, type: 'city' })) : []), ...(showFeatures ? features.map(p => ({ ...p, type: 'feature' })) : []), ...(showHistory ? history.map(p => ({ ...p, type: 'history' })) : [])];
    const ids = new Set(all.map(p => p.id));
    this.markers.forEach((m, id) => { if (!ids.has(id)) { m.button.remove(); this.markers.delete(id); } });
    for (const place of all) {
      let item = this.markers.get(place.id);
      if (!item) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `terrain-marker terrain-marker--${place.type}`;
        button.dataset.placeId = place.id;
        button.dataset.type = place.type;
        button.style.cssText = 'position:absolute;pointer-events:auto;transform:translate(-8px,-50%);';
        const dot = document.createElement('span'); dot.className = 'terrain-marker-dot'; dot.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span'); label.className = 'terrain-marker-label';
        const name = document.createElement('span'); name.className = 'terrain-marker-name'; name.textContent = place.name || place.title;
        label.append(name);
        if (place.type === 'history') {
          const date = document.createElement('span'); date.className = 'terrain-marker-date'; date.textContent = (place.period || '').split(' · ')[0]; label.append(date);
        }
        button.append(dot, label);
        button.title = `${place.name || place.title} — explore this ${place.type === 'history' ? 'story' : 'place'}`;
        button.setAttribute('aria-label', button.title);
        button.addEventListener('click', event => { event.stopPropagation(); this.callbacks.onSelect?.(item.place); });
        this.labels?.append(button);
        item = { button, place };
        this.markers.set(place.id, item);
      }
      item.place = place;
      item.button.classList.toggle('is-selected', selectedId === place.id);
      item.button.setAttribute('aria-pressed', String(selectedId === place.id));
    }
    this.dirty = true;
  }

  _positionLabels() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const boxes = [];
    const score = m => m.button.classList.contains('is-selected') ? 1e10 : m.place.type === 'history' ? 1e8 : (m.place.labelPriority || 0) * 1e7 + (m.place.population || 0) + (m.place.type === 'city' ? 1e6 : 0);
    const sorted = [...this.markers.values()].sort((a, b) => score(b) - score(a));
    for (const item of sorted) {
      if (!this.model || this.loading) { item.button.hidden = true; continue; }
      const p = this._world(...positionOf(item.place), 0.025).project(this.camera);
      const x = (p.x + 1) * w / 2, y = (1 - p.y) * h / 2;
      item.button.hidden = p.z > 1 || x < 0 || x > w || y < 0 || y > h;
      item.button.style.left = `${x}px`; item.button.style.top = `${y}px`;
      const width = Math.min(225, 30 + (item.place.name || item.place.title || '').length * 6.3), height = item.place.type === 'history' ? 32 : 20;
      const b = { x, y: y - height / 2, width, height };
      const collision = !item.button.classList.contains('is-selected') && boxes.some(a => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
      item.button.classList.toggle('is-compact', collision);
      if (!collision) boxes.push(b);
    }
  }

  setTrail(places = []) {
    this.trail = places;
    if (this.trailLine) { this.scene.remove(this.trailLine); dispose(this.trailLine); this.trailLine = null; }
    if (!this.model || places.length < 2) return;
    const points = [];
    for (let i = 1; i < places.length; i++) {
      const a = positionOf(places[i - 1]), b = positionOf(places[i]);
      for (let j = 0; j < 50; j++) points.push(this._world(mix(a[0], b[0], j / 49), mix(a[1], b[1], j / 49), 0.06));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.trailLine = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: '#edbb6c', dashSize: 0.08, gapSize: 0.045, transparent: true, opacity: 0.9 }));
    this.trailLine.computeLineDistances();
    this.scene.add(this.trailLine);
    this.dirty = true;
  }

  setSurface(surface) { this.surface = surface; if (this.surfaceUniform) this.surfaceUniform.value = surface === 'contours' ? 2 : surface === 'elevation' ? 1 : 0; this.dirty = true; this._notify(); }
  setRelief(value) {
    this.relief = clamp(Number(value) || 1, 1, 30);
    if (this.top) {
      const positions = this.top.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) positions.setY(i, this.elevations[i] * this.heightScale * this.relief);
      positions.needsUpdate = true; this.top.geometry.computeVertexNormals(); this.top.geometry.computeBoundingSphere();
      this._buildSides(); this.setTrail(this.trail || []);
    }
    this.dirty = true; this._notify();
  }
  zoomIn() { if (!this.controls) return; this.stopOrbit(); this.camera.position.sub(this.controls.target).multiplyScalar(0.82).add(this.controls.target); this.controls.update(); }
  zoomOut() { if (!this.controls) return; this.stopOrbit(); this.camera.position.sub(this.controls.target).multiplyScalar(1.22).add(this.controls.target); this.controls.update(); }
  toggleOrbit() { this.orbiting = !this.orbiting; this._notify(); return this.orbiting; }
  stopOrbit() { if (this.orbiting) { this.orbiting = false; this._notify(); } }
  setActive(active) { this.active = active; this.controls.enabled = active; this.container.style.visibility = active ? 'visible' : 'hidden'; if (active) { this.resize(); this.dirty = true; } }
  resize() { if (!this.renderer) return; const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1; this.renderer.setSize(w, h, false); this._applyPadding(); this.dirty = true; }
  getView() {
    const position = this.camera?.position.clone().sub(this.controls.target);
    return { center: this.state?.center || [-119.5, 37.1], zoom: 5.5 + Math.log2((this.homeDistance || 18) / (position?.length() || 18)), bearing: position ? Math.atan2(position.x, position.z) * 180 / Math.PI : 0, pitch: position ? Math.atan2(Math.hypot(position.x, position.z), position.y) * 180 / Math.PI : 52, relief: this.relief, surface: this.surface, orbiting: !!this.orbiting, renderer: 'diorama', loading: this.loading, modelState: this.state?.code, modelKind: 'measured-elevation-cutout', imageryReady: !!this.imageryReady, vertices: this.top?.geometry.attributes.position.count || 0 };
  }
  _frame(time) {
    this.frame = requestAnimationFrame(this._frame);
    if (!this.active || document.hidden) return;
    if (this.orbiting && this.model) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.0016);
      this.camera.position.copy(this.controls.target).add(offset);
      this.dirty = true;
    }
    this.controls.update();
    if (this.dirty) { this.camera.updateMatrixWorld(); this.renderer.render(this.scene, this.camera); this._positionLabels(); this.dirty = false; }
  }
  destroy() {
    this.loadSequence++; cancelAnimationFrame(this.frame); cancelAnimationFrame(this.notifyFrame);
    this.controls?.dispose(); dispose(this.model); dispose(this.floor); dispose(this.contact); dispose(this.trailLine);
    this.renderer?.dispose(); this.container.replaceChildren(); this.cache.clear();
  }
}
