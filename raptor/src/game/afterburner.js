// Render-only afterburner. Procedural colors/length are visual estimates,
// not measured F119 radiometry. All deformation is ordinary object motion so
// PlanetObjectBender can retain its existing current/previous model contract.
import * as THREE from 'three';

export const EXIT = Object.freeze({ z: 1.36, halfWidth: .545, halfHeight: .37 });
export const ATLAS = Object.freeze({ width: 512, height: 256,
  plume: [16, 16, 496, 112], aperture: [16, 144, 112, 240] });
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Plane angle is equivalent modulo pi. Choosing the nearest representative
// prevents invisible 180-degree sheet flips from generating false velocity.
// The end-on dead zone retains orientation instead of dividing by zero.
export function ribbonBasis(x, y, z, previousAngle = 0) {
  const prior = Number.isFinite(previousAngle) ? previousAngle : 0;
  if (![x, y, z].every(Number.isFinite)) return { angle: prior, radius: EXIT.halfWidth, endOn: true };
  const radial2 = x * x + y * y, distance2 = radial2 + z * z;
  const endOn = radial2 <= Math.max(1e-12, distance2 * 1e-6);
  let angle = prior;
  if (!endOn) {
    const desired = Math.atan2(-x, y), delta = desired - prior;
    angle += Math.atan2(Math.sin(2 * delta), Math.cos(2 * delta)) * .5;
  }
  const radius = EXIT.halfWidth * Math.abs(Math.cos(angle)) + EXIT.halfHeight * Math.abs(Math.sin(angle));
  return { angle, radius, endOn };
}

function plumeSample(u, v) {
  // A continuous column with a few weak compression cells. Cell contrast is
  // deliberately small: no detached beads or dark gaps between bright balls.
  const cell = Math.pow(Math.max(0, Math.cos((u * 3.6 - .25) * 2 * Math.PI)), 4);
  const cellWindow = smooth(.03, .10, u) * (1 - smooth(.50, .83, u));
  const radius = (.67 + .18 * smooth(0, .20, u) - .28 * smooth(.48, 1, u))
    * (1 + .055 * (cell - .375) * cellWindow);
  const q = Math.abs(v) / radius;
  const edge = (1 - smooth(.73, 1, q)) * Math.exp(-1.8 * q * q);
  const axial = smooth(0, .018, u) * (1 - smooth(.36, 1, u)) * (.30 + .70 * Math.exp(-2.8 * u));
  const alpha = clamp(edge * axial * (.84 + .16 * cell * cellWindow));
  const core = Math.exp(-5 * q * q - 5.5 * u);
  return [.24 + .76 * core, .42 + .53 * core, .73 + .14 * core, alpha];
}

function apertureSample(x, y) {
  const q = Math.pow(Math.pow(Math.abs(x), 6) + Math.pow(Math.abs(y), 6), 1 / 6);
  const alpha = 1 - smooth(.61, .98, q);
  const core = 1 - smooth(.05, .90, q);
  return [.86 + .14 * core, .54 + .39 * core, .27 + .55 * core, alpha];
}

// For additive straight-alpha material, filtered emission is alpha * RGB.
// Average that product, then recover straight RGB, instead of darkening the
// colors by averaging zero-RGB transparent texels into the field twice.
export function nextMip(source, width, height) {
  const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1), data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0, r = 0, g = 0, b = 0, n = 0;
    for (let dy = 0; dy < (height > 1 ? 2 : 1); dy++) for (let dx = 0; dx < (width > 1 ? 2 : 1); dx++) {
      const j = ((y * 2 + dy) * width + x * 2 + dx) * 4, alpha = source[j + 3];
      a += alpha; r += source[j] * alpha; g += source[j + 1] * alpha; b += source[j + 2] * alpha; n++;
    }
    const i = (y * w + x) * 4;
    // Recover RGB against the STORED alpha, including its quantization.
    // Otherwise low-alpha terminal mips change energy by tens of percent.
    // One alpha code can carry a correspondingly dark RGB value when the
    // true average alpha is smaller; exact zero coverage stays exact zero.
    data[i + 3] = a > 0 ? Math.max(1, Math.round(a / n)) : 0;
    if (a > 0) {
      const divisor = n * data[i + 3];
      data[i] = Math.min(255, Math.round(r / divisor));
      data[i + 1] = Math.min(255, Math.round(g / divisor));
      data[i + 2] = Math.min(255, Math.round(b / divisor));
      if (!(data[i] || data[i + 1] || data[i + 2])) data[i + 3] = 0;
    }
  }
  return { data, width: w, height: h };
}

export function bakeAfterburnerAtlas() {
  const { width, height } = ATLAS, data = new Uint8Array(width * height * 4);
  for (const [rect, sample] of [[ATLAS.plume, (u, v) => plumeSample(u, v * 2 - 1)],
    [ATLAS.aperture, (u, v) => apertureSample(u * 2 - 1, v * 2 - 1)]]) {
    const [x0, y0, x1, y1] = rect;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const rgba = sample((x + .5 - x0) / (x1 - x0), (y + .5 - y0) / (y1 - y0)), i = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) data[i + c] = Math.round(clamp(rgba[c]) * 255);
      if (!data[i + 3]) data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  const levels = [{ data, width, height }];
  while (levels.at(-1).width > 1 || levels.at(-1).height > 1) {
    const m = levels.at(-1); levels.push(nextMip(m.data, m.width, m.height));
  }
  return levels;
}

function makeQuad(positions, rect) {
  const [x0, y0, x1, y1] = rect;
  const u0 = (x0 + .5) / ATLAS.width, u1 = (x1 - .5) / ATLAS.width;
  const v0 = (y0 + .5) / ATLAS.height, v1 = (y1 - .5) / ATLAS.height;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u0, v1, u1, v1, u1, v0], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function createAfterburnerResources() {
  const levels = bakeAfterburnerAtlas(), first = levels[0];
  const texture = new THREE.DataTexture(first.data, first.width, first.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  Object.assign(texture, { name: 'afterburner-procedural-atlas', colorSpace: THREE.NoColorSpace,
    magFilter: THREE.LinearFilter, minFilter: THREE.LinearMipmapLinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    anisotropy: 4, generateMipmaps: false, mipmaps: levels });
  texture.needsUpdate = true;
  const ribbonGeometry = makeQuad([-1, 0, 0, 1, 0, 0, 1, 0, 1, -1, 0, 1], ATLAS.plume);
  const w = EXIT.halfWidth * .93, h = EXIT.halfHeight * .93;
  // First texture coordinate is local X in the aperture, local Z in plume.
  const apertureGeometry = makeQuad([-w, -h, 0, -w, h, 0, w, h, 0, w, -h, 0], ATLAS.aperture);
  const instances = new Set(); let disposed = false;
  return { texture, ribbonGeometry, apertureGeometry, instances,
    dispose() {
      if (disposed) return; disposed = true;
      for (const plume of instances) {
        plume.ribbon.removeFromParent(); plume.aperture.removeFromParent();
        plume.ribbon.material.dispose(); plume.aperture.material.dispose();
      }
      instances.clear(); ribbonGeometry.dispose(); apertureGeometry.dispose(); texture.dispose();
    } };
}

export function createNozzlePlume(pivot, resources) {
  const material = (side, gain) => new THREE.MeshBasicMaterial({
    name: 'afterburner-stock-basic', map: resources.texture, color: new THREE.Color(gain, gain, gain),
    transparent: true, opacity: 0, depthTest: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false, side, forceSinglePass: true, alphaTest: 1e-5,
  });
  const ribbon = new THREE.Mesh(resources.ribbonGeometry, material(THREE.DoubleSide, 1.35));
  const aperture = new THREE.Mesh(resources.apertureGeometry, material(THREE.BackSide, 1.65));
  // Quad winding gives -Z; BackSide makes the outlet visible from aft (+Z).
  ribbon.name = 'afterburner-axial-ribbon'; aperture.name = 'afterburner-rectangular-aperture';
  ribbon.position.z = aperture.position.z = EXIT.z;
  ribbon.visible = aperture.visible = false;
  pivot.add(ribbon, aperture);
  const plume = { pivot, ribbon, aperture, angle: 0, localView: new THREE.Vector3() };
  resources.instances.add(plume); return plume;
}

export function updateNozzlePlume(plume, { length, stage, time, side, camera }) {
  const amount = Number.isFinite(stage) ? clamp(stage) : 0;
  const visible = amount >= .01;
  plume.ribbon.visible = plume.aperture.visible = visible;
  if (!visible) { plume.ribbon.material.opacity = plume.aperture.material.opacity = 0; return; }
  plume.localView.copy(camera.position); plume.pivot.worldToLocal(plume.localView); plume.localView.z -= EXIT.z;
  const basis = ribbonBasis(plume.localView.x, plume.localView.y, plume.localView.z, plume.angle);
  plume.angle = basis.angle; plume.ribbon.rotation.z = basis.angle;
  plume.ribbon.scale.set(basis.radius * 1.28, 1, Math.max(.01, Number.isFinite(length) ? length : .01));
  // Intensity only, at <=2.5%; no size flicker or moving texture pattern.
  const phase = Number.isFinite(time) ? time : 0;
  const flicker = 1 + .025 * Math.sin(phase * 13 + side * 2.1);
  plume.ribbon.material.opacity = clamp(.78 * amount * flicker);
  plume.aperture.material.opacity = clamp(.92 * amount * flicker);
}
