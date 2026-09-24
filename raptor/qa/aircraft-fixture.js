import * as THREE from "three";
import { inspectDetailedAssemblies } from './detail-checks.js';

const PARTS = ["flaperonL", "flaperonR", "stabL", "stabR", "rudderL", "rudderR", "nozzleL", "nozzleR", "canopy", "bayMain", "baySideL", "baySideR", "gearNose", "gearL", "gearR"];
const VIEWS = {
  top: { direction: [0, 1, 0], up: [0, 0, -1] },
  underside: { direction: [0, -1, 0], up: [0, 0, -1] },
  side: { direction: [1, 0, 0], up: [0, 1, 0] },
  front: { direction: [0, 0, -1], up: [0, 1, 0] },
  rear: { direction: [0, 0, 1], up: [0, 1, 0] },
  perspective: { direction: [1, .5, -1.25], up: [0, 1, 0] },
};
let fixture;

async function waitForTextures(group, timeout) {
  const textures = new Set();
  group.traverse(object => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value?.isTexture && !value.isRenderTargetTexture) textures.add(value);
    }
  });
  const ready = image => Array.isArray(image)
    ? image.length > 0 && image.every(ready)
    : image && image.width > 0 && image.height > 0 && (!(image instanceof HTMLImageElement) || (image.complete && image.naturalWidth > 0));
  const start = performance.now();
  while ([...textures].some(texture => !ready(texture.image))) {
    if (performance.now() - start > timeout * .8) throw new Error(`Aircraft textures did not finish loading: ${[...textures].filter(texture => !ready(texture.image)).map(texture => texture.name || texture.uuid).join(", ")}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

function assertion(checks, id, pass, detail = null, severity = "error") {
  checks.push({ id, pass: !!pass, severity, ...(detail === null ? {} : { detail }) });
}

function visibleBounds(group) {
  const bounds = new THREE.Box3();
  group.updateMatrixWorld(true);
  group.traverseVisible(object => {
    if (!object.isMesh || !object.geometry.getAttribute("position")) return;
    object.geometry.computeBoundingBox();
    bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
  });
  return bounds;
}

function inventory(group) {
  const checks = [], geometries = new Set(), materials = new Set(), textures = new Set();
  let meshes = 0, triangles = 0, visibleTriangles = 0, vertexBytes = 0, indexBytes = 0;
  const zeroNormals = [], missingUV = [], detail = [];
  group.updateMatrixWorld(true);
  group.traverse(object => {
    assertion(checks, `transform:${object.name || object.id}`, object.matrixWorld.elements.every(Number.isFinite));
    if (!object.isMesh) return;
    meshes++;
    const geometry = object.geometry, position = geometry.getAttribute("position");
    if (!position) { assertion(checks, `position:${object.name}`, false, "Mesh has no position attribute"); return; }
    const count = geometry.index?.count ?? position.count;
    triangles += count / 3;
    let visible = true;
    for (let ancestor = object; ancestor; ancestor = ancestor.parent) visible &&= ancestor.visible;
    if (visible) visibleTriangles += count / 3;
    detail.push({ name: object.name, triangles: count / 3, vertices: position.count, visible });
    if (!geometries.has(geometry)) {
      geometries.add(geometry);
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        const array = attribute.array ?? attribute.data?.array;
        assertion(checks, `attribute:${object.name}:${name}`, !!array && Array.from(array).every(Number.isFinite), "All attribute values must be finite");
        assertion(checks, `attribute-count:${object.name}:${name}`, attribute.count === position.count, { actual: attribute.count, expected: position.count });
        vertexBytes += array?.byteLength ?? 0;
      }
      assertion(checks, `triangle-count:${object.name}`, Number.isInteger(count / 3), { indicesOrVertices: count });
      if (geometry.index) {
        const indices = geometry.index.array;
        indexBytes += indices.byteLength;
        assertion(checks, `indices:${object.name}`, Array.from(indices).every(index => Number.isInteger(index) && index >= 0 && index < position.count));
      }
      const normals = geometry.getAttribute("normal");
      assertion(checks, `normals:${object.name}`, !!normals, "Lit aircraft geometry must provide normals");
      if (normals) {
        let zero = 0, wrongLength = 0;
        for (let i = 0; i < normals.count; i++) {
          const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
          if (length < 1e-6) zero++;
          else if (Math.abs(length - 1) > .02) wrongLength++;
        }
        assertion(checks, `normal-length:${object.name}`, !wrongLength, { nonUnitNormals: wrongLength });
        if (zero) zeroNormals.push({ mesh: object.name, count: zero });
      }
      const tangent = geometry.getAttribute("tangent");
      if (tangent) {
        let invalid = 0;
        for (let i = 0; i < tangent.count; i++) {
          if (Math.abs(Math.hypot(tangent.getX(i), tangent.getY(i), tangent.getZ(i)) - 1) > .02 || Math.abs(Math.abs(tangent.getW(i)) - 1) > .001) invalid++;
        }
        assertion(checks, `tangents:${object.name}`, !invalid, { invalid });
      }
    }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      if ((material.map || material.normalMap || material.roughnessMap || material.metalnessMap) && !geometry.hasAttribute("uv")) missingUV.push(object.name);
      for (const key of ["opacity", "roughness", "metalness", "envMapIntensity"]) {
        if (key in material) assertion(checks, `material:${material.name || material.id}:${key}`, Number.isFinite(material[key]));
      }
      if (material.map) assertion(checks, `color-space:${material.name || material.id}`, material.map.colorSpace === THREE.SRGBColorSpace, "Base-color texture must declare sRGB", "warning");
      for (const key of ["normalMap", "roughnessMap", "metalnessMap", "aoMap"]) {
        if (material[key]) assertion(checks, `data-space:${material.name || material.id}:${key}`, material[key].colorSpace === THREE.NoColorSpace, "Physical data maps must not be sRGB");
      }
    }
  });
  assertion(checks, "textured-mesh-uvs", !missingUV.length, missingUV);
  // Collapsed tips/intentional duplicate crease columns can yield zero normals.
  // Expose their count for review without pretending every one is a defect.
  assertion(checks, "zero-normals", !zeroNormals.length, zeroNormals, "warning");
  const bounds = visibleBounds(group);
  assertion(checks, "nonempty-visible-bounds", !bounds.isEmpty() && [...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite));
  return {
    checks,
    counts: { meshes, triangles, visibleTriangles, geometries: geometries.size, materials: materials.size, textures: textures.size, vertexBytes, indexBytes },
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size: bounds.getSize(new THREE.Vector3()).toArray() },
    meshes: detail,
    textures: [...textures].map(texture => ({ name: texture.name, width: texture.image?.width, height: texture.image?.height, colorSpace: texture.colorSpace, mipmaps: texture.generateMipmaps })),
  };
}

function inspectRig(group, parts, requireMetadata) {
  const checks = [], metadata = group.userData.aircraft;
  assertion(checks, "rig:exact-part-contract", Object.keys(parts).length === PARTS.length && PARTS.every(key => parts[key]?.isObject3D), Object.keys(parts));
  assertion(checks, "rig:independent-identities", new Set(PARTS.map(key => parts[key])).size === PARTS.length);
  assertion(checks, "rig:metadata", !!metadata, "Declare group.userData.aircraft for the rebuilt model", requireMetadata ? "error" : "warning");
  if (metadata) {
    assertion(checks, "rig:metadata-version", Number.isInteger(metadata.version) && metadata.version > 0, metadata.version);
    const forward = Array.isArray(metadata.forward) && metadata.forward.length === 3 ? new THREE.Vector3(...metadata.forward) : null;
    assertion(checks, "rig:forward-convention", forward && forward.toArray().every(Number.isFinite) && forward.distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-6, metadata.forward);
    assertion(checks, "rig:dimensions-metadata", Number.isFinite(metadata.span) && metadata.span > 0 && Number.isFinite(metadata.length) && metadata.length > 0, { span: metadata.span, length: metadata.length });
  }
  if (!PARTS.every(key => parts[key]?.isObject3D)) return { checks, metadata: metadata ?? null };
  for (const key of ["nozzleL", "nozzleR"]) assertion(checks, `rig:direct-parent:${key}`, parts[key].parent === group, "FlightFX obtains the aircraft root from nozzleL.parent; coordinates are intentionally not fixed");
  for (const key of PARTS) {
    const part = parts[key], rest = part.quaternion.clone();
    assertion(checks, `rig:hinge-metadata:${key}`, !!metadata?.hinges?.[key]?.axis, "Declare the physical local hinge axis", requireMetadata ? "error" : "warning");
    const hinge = metadata?.hinges?.[key];
    if (hinge) assertion(checks, `rig:hinge-limits:${key}`, Number.isFinite(hinge.minDeg) && Number.isFinite(hinge.maxDeg) && hinge.minDeg < hinge.maxDeg, hinge);
    const axis = new THREE.Vector3(...(metadata?.hinges?.[key]?.axis ?? (key.startsWith("bay") ? [0, 0, 1] : [1, 0, 0])));
    assertion(checks, `rig:axis:${key}`, axis.toArray().every(Number.isFinite) && Math.abs(axis.length() - 1) < .001, axis.toArray());
    if (axis.lengthSq() < 1e-12 || !axis.toArray().every(Number.isFinite)) continue;
    axis.normalize();
    group.updateMatrixWorld(true);
    const otherTransforms = PARTS.filter(name => name !== key).map(name => [name, parts[name].matrixWorld.clone()]);
    const hingeBefore = axis.clone().applyMatrix4(part.matrixWorld);
    const originBefore = new THREE.Vector3().setFromMatrixPosition(part.matrixWorld);
    // Find a real surface vertex away from the hinge, not a group origin.
    const inverse = part.matrixWorld.clone().invert();
    let sample = null, distance = 0;
    part.traverse(object => {
      if (!object.isMesh) return;
      const position = object.geometry.getAttribute("position");
      for (let i = 0; i < position.count; i += Math.max(1, Math.floor(position.count / 128))) {
        const local = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld).applyMatrix4(inverse);
        const perpendicular = local.clone().cross(axis).lengthSq();
        if (perpendicular > distance) { distance = perpendicular; sample = local; }
      }
    });
    assertion(checks, `rig:surface-off-axis:${key}`, distance > 1e-6);
    if (!sample) continue;
    const pointBefore = sample.clone().applyMatrix4(part.matrixWorld);
    const angles = hinge && Number.isFinite(hinge.minDeg) && Number.isFinite(hinge.maxDeg)
      ? [hinge.minDeg, hinge.maxDeg].map(degrees => degrees * Math.PI / 180).filter(angle => Math.abs(angle) > 1e-5)
      : [-.2, .2];
    for (const angle of angles) {
      part.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
      group.updateMatrixWorld(true);
      const stableHinge = axis.clone().applyMatrix4(part.matrixWorld).distanceTo(hingeBefore) < 1e-6;
      const stableOrigin = new THREE.Vector3().setFromMatrixPosition(part.matrixWorld).distanceTo(originBefore) < 1e-6;
      const moved = sample.clone().applyMatrix4(part.matrixWorld).distanceTo(pointBefore) > 1e-5;
      assertion(checks, `rig:hinge-motion:${key}:${angle}`, stableHinge && stableOrigin && moved);
      assertion(checks, `rig:isolated-motion:${key}:${angle}`, otherTransforms.every(([name, matrix]) => matrix.equals(parts[name].matrixWorld)));
    }
    part.quaternion.copy(rest);
    group.updateMatrixWorld(true);
  }
  return { checks, metadata: metadata ?? null };
}

async function inspectEffects(group, parts, requireMetadata) {
  const { FlightFX } = await import("/src/game/flightfx.js");
  const checks = [], samples = {}, metadata = group.userData.aircraft;
  const previousParent = group.parent, previousChildren = new Map();
  group.traverse(object => previousChildren.set(object, new Set(object.children)));
  const outer = new THREE.Group();
  outer.position.set(53, 400, -71); outer.rotation.set(.23, -.42, .11);
  outer.add(group);
  const restL = parts.nozzleL.quaternion.clone(), restR = parts.nozzleR.quaternion.clone();
  try {
    const fx = new FlightFX(new THREE.Scene(), { jetGroup: outer, parts });
    for (const angle of [0, .2]) {
      parts.nozzleL.rotateX(angle); parts.nozzleR.rotateX(-angle);
      fx.update({ V: 250, mach: .8, nz: 1, alphaDeg: 2 }, .8, 1 / 60, { position: new THREE.Vector3(50, 450, -100) });
      for (const [name, object, parent] of [["nozzleL", fx._nozL, parts.nozzleL], ["nozzleR", fx._nozR, parts.nozzleR], ["wingtipL", fx._tipL, group], ["wingtipR", fx._tipR, group]]) {
        assertion(checks, `effects:parent:${name}:${angle}`, object?.parent === parent);
        if (!object) continue;
        samples[`${name}:${angle}`] = { local: object.position.toArray(), world: object.getWorldPosition(new THREE.Vector3()).toArray() };
        const attachment = metadata?.attachments?.[name];
        assertion(checks, `effects:metadata:${name}`, !!attachment, "Expected { part, position, direction? }", requireMetadata ? "error" : "warning");
        if (!attachment) continue;
        const parentExpected = attachment.part ? parts[attachment.part] : group;
        const valid = parentExpected && Array.isArray(attachment.position) && attachment.position.length === 3 && attachment.position.every(Number.isFinite);
        assertion(checks, `effects:attachment-schema:${name}`, valid);
        if (!valid) continue;
        const expected = parentExpected.localToWorld(new THREE.Vector3(...attachment.position));
        assertion(checks, `effects:attachment-world:${name}:${angle}`, expected.distanceTo(object.getWorldPosition(new THREE.Vector3())) < 1e-5, { declared: attachment.position, actual: object.position.toArray() });
        if (name.startsWith("nozzle") && attachment.direction) {
          const actual = name === "nozzleL" ? fx._aftL : fx._aftR;
          const expectedDirection = new THREE.Vector3(...attachment.direction).transformDirection(parentExpected.matrixWorld);
          assertion(checks, `effects:direction:${name}:${angle}`, actual.distanceTo(expectedDirection) < 1e-5);
        }
      }
    }
  } finally {
    parts.nozzleL.quaternion.copy(restL); parts.nozzleR.quaternion.copy(restR);
    for (const [object, children] of previousChildren) for (const child of [...object.children]) if (!children.has(child)) object.remove(child);
    if (previousParent) previousParent.add(group); else outer.remove(group);
    group.updateMatrixWorld(true);
  }
  return { checks, samples };
}

function studio(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x30363e);
  scene.add(new THREE.HemisphereLight(0xcad5e3, 0x514b43, .55));
  for (const [position, color, intensity] of [[[-14, 20, -15], 0xfff3e2, 2.5], [[15, 7, -3], 0xcbdcff, .65], [[-1, 10, 16], 0xffffff, 1.1]]) {
    const light = new THREE.DirectionalLight(color, intensity); light.position.set(...position); scene.add(light);
  }
  const environment = new THREE.Scene();
  environment.background = new THREE.Color(0x667180);
  for (const [position, width, height, intensity] of [[[-15, 18, -12], 12, 30, 4], [[19, 10, 8], 8, 26, 2.5], [[0, 25, 4], 26, 12, 3]]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity), side: THREE.DoubleSide }));
    panel.position.set(...position); panel.lookAt(0, 0, 0); environment.add(panel);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(environment, .025, .1, 150);
  scene.environment = target.texture; scene.environmentIntensity = .5;
  pmrem.dispose();
  environment.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
  return { scene, target };
}

async function boot(config) {
  const canvas = document.getElementById("aircraft");
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: config.backend === "webgl" });
  await renderer.init();
  const backend = renderer.backend.isWebGPUBackend ? "webgpu" : "webgl";
  if (backend !== config.backend) throw new Error(`Requested ${config.backend}, got ${backend}; fallback is not a successful WebGPU test`);
  renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  const { scene, target } = studio(renderer);
  const module = await import(config.aircraft === "f22" ? config.builder : config.banditBuilder);
  let group, parts = {};
  if (config.aircraft === "f22") {
    const built = await module[config.exportName](config.builderOptions);
    if (built.ready) await built.ready;
    ({ group, parts } = built);
  } else {
    const built = await module.buildBanditModels();
    group = built[{ drone: 0, transport: 1, fighter: 2 }[config.aircraft]];
    group.rotation.y = Math.PI;
  }
  if (!group?.isObject3D) throw new Error("Builder did not return an aircraft Object3D");
  await waitForTextures(group, config.timeout);
  scene.add(group);
  const model = inventory(group);
  const rig = config.aircraft === "f22" ? inspectRig(group, parts, config.requireMetadata) : null;
  const effects = config.aircraft === "f22" && PARTS.every(key => parts[key]) ? await inspectEffects(group, parts, config.requireMetadata) : null;
  const details = config.aircraft === "f22" ? await inspectDetailedAssemblies(group,parts) : null;
  const pose = config.aircraft === "f22" && config.checkPose
    ? (await import('./pose-checks.js')).inspectAircraftPose(group,parts) : null;
  for (const [name, degrees] of Object.entries(config.pose ?? {})) {
    if (!parts[name] || !Number.isFinite(degrees)) throw new Error(`Invalid inspection pose: ${name}`);
    const axis = group.userData.aircraft?.hinges?.[name]?.axis ?? [1,0,0];
    parts[name].quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(),THREE.MathUtils.degToRad(degrees)));
  }
  fixture = { renderer, scene, environmentTarget: target, group, parts, config, backend, model, rig, effects, black: new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }) };
  await capture("perspective", "beauty");
  if (config.aircraft === 'f22') (await import('../src/aircraft/weapons-bays.js')).syncMainBayDoors(parts);
  if (config.aircraft === "f22") {
    const {syncGearBays}=await import("/src/aircraft/gear-bays.js");
    syncGearBays(group,config.gear?1:0);
  }

  return { backend, model, rig, effects, details, pose, threeRevision: THREE.REVISION };
}

function cameraFor(view, supplied) {
  const spec = VIEWS[view];
  if (!spec) throw new Error(`Unknown view: ${view}`);
  const { group, renderer } = fixture;
  const bounds = visibleBounds(group), direction = new THREE.Vector3(...(supplied?.direction ?? spec.direction)).normalize();
  const target = new THREE.Vector3(...(supplied?.target ?? [0, 0, 0]));
  const size = bounds.getSize(new THREE.Vector3()).length();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, Math.max(1000, size * 20));
  camera.up.set(...(supplied?.up ?? spec.up)); camera.position.copy(target).addScaledVector(direction, Math.max(100, size * 4)); camera.lookAt(target); camera.updateMatrixWorld(true);
  const aspect = renderer.domElement.width / renderer.domElement.height;
  let halfHeight = 0;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const point = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    halfHeight = Math.max(halfHeight, Math.abs(point.y), Math.abs(point.x) / aspect);
  }
  halfHeight = supplied?.halfHeight ?? Math.max(.1, halfHeight * 1.12);
  camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
  return { camera, framing: { projection: "orthographic", view, target: target.toArray(), direction: direction.toArray(), up: camera.up.toArray(), halfHeight, worldUnitsPerPixel: halfHeight * 2 / renderer.domElement.height } };
}

async function capture(view, mode, framing = null) {
  const { renderer, scene, black } = fixture;
  const { camera, framing: actualFraming } = cameraFor(view, framing);
  fixture.camera = camera;
  scene.overrideMaterial = mode === "silhouette" ? black : null;
  scene.background = new THREE.Color(mode === "silhouette" ? 0xffffff : 0x30363e);
  renderer.toneMapping = mode === "silhouette" ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  renderer.render(scene, camera);
  await new Promise(resolve => requestAnimationFrame(resolve));
  renderer.render(scene, camera);
  return { framing: actualFraming, render: { ...renderer.info.render }, memory: { ...renderer.info.memory } };
}

function summary(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const at = fraction => values[Math.min(values.length - 1, Math.floor(fraction * values.length))];
  return { count: values.length, p50: at(.5), p95: at(.95), p99: at(.99), max: values[values.length - 1] };
}

async function measure(frames) {
  const intervals = [], submissions = [];
  let previous = null;
  for (let i = 0; i < frames + 10; i++) {
    const timestamp = await new Promise(resolve => requestAnimationFrame(resolve));
    const start = performance.now();
    fixture.renderer.render(fixture.scene, fixture.camera);
    const duration = performance.now() - start;
    if (i >= 10) { intervals.push(timestamp - previous); submissions.push(duration); }
    previous = timestamp;
  }
  return { frameIntervalMs: summary(intervals), cpuRenderSubmissionMs: summary(submissions), gpuMs: null, note: "Static fixture, VSync-limited rAF and CPU submission timing; not GPU time or a full-game performance claim" };
}

async function imagePixels(dataURL) {
  const image = new Image(); image.src = dataURL; await image.decode();
  const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(image, 0, 0);
  return { data: context.getImageData(0, 0, image.width, image.height), canvas, context };
}

async function analyzeImage(currentURL, baselineURL = null, silhouette = false) {
  const current = await imagePixels(currentURL), { width, height, data } = current.data;
  let blackPixels = 0, x0 = width, x1 = -1, y0 = height, y1 = -1;
  for (let i = 0; i < data.length; i += 4) if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 128) {
    blackPixels++; const x = (i / 4) % width, y = Math.floor(i / 4 / width);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const result = { width, height, ...(silhouette ? { silhouettePixels: blackPixels, occupancy: blackPixels / (width * height), silhouetteBounds: [x0, y0, x1, y1], clipped: x0 === 0 || y0 === 0 || x1 === width - 1 || y1 === height - 1 } : {}) };
  if (!baselineURL) return result;
  const baseline = await imagePixels(baselineURL);
  if (baseline.data.width !== width || baseline.data.height !== height) throw new Error("Comparison screenshots have different dimensions");
  const reference = baseline.data.data, difference = current.context.createImageData(width, height);
  let sum = 0, changed = 0, intersection = 0, union = 0;
  for (let i = 0; i < data.length; i += 4) {
    let maximum = 0;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(data[i + channel] - reference[i + channel]);
      sum += delta * delta; maximum = Math.max(maximum, delta); difference.data[i + channel] = Math.min(255, delta * 4);
    }
    difference.data[i + 3] = 255;
    if (maximum > 8) changed++;
    const a = (data[i] + data[i + 1] + data[i + 2]) < 384, b = (reference[i] + reference[i + 1] + reference[i + 2]) < 384;
    if (a && b) intersection++; if (a || b) union++;
  }
  current.context.putImageData(difference, 0, 0);
  return { ...result, comparison: { rmse255: Math.sqrt(sum / (width * height * 3)), changedPixelFraction: changed / (width * height), ...(silhouette ? { silhouetteIoU: union ? intersection / union : 1 } : {}) }, difference: current.canvas.toDataURL("image/png") };
}

async function simulationRegression({ referenceURL, ticks = 1200, seed = 0xA1C4 }) {
  const { SimCore } = await import("/src/engine/sim.js");
  const current = await import("/src/game/bandits.js");
  const reference = referenceURL ? await import(referenceURL) : null;
  const flights = [
    { kind: "fighter", tier: 4, x: -550, y: 0, z: 700, headingDeg: 0, engage: true },
    { kind: "fighter", tier: 3, x: -2300, y: 120, z: 720, headingDeg: 0, engage: true },
    { kind: "drone", tier: 1, x: 900, y: 500, z: 680, headingDeg: 0, wpts: [[4000, 500], [4000, 4000]] },
    { kind: "transport", tier: 0, x: -2000, y: -1500, z: 750, side: 1, wpts: [[2000, -1500], [4000, 3000]] },
    { kind: "fighter", tier: 4, x: 29200, y: 0, z: 700, headingDeg: 0, aceId: 17, engage: true },
    { kind: "fighter", tier: 2, x: 1500, y: 1200, z: 750, headingDeg: 180, wpts: [[-4000, 1200]] },
    { kind: "transport", tier: 0, x: -5000, y: 3000, z: 900, headingDeg: 15, wpts: [[6000, 3000]] },
    { kind: "drone", tier: 1, x: 1200, y: -1200, z: 600, headingDeg: 90, wpts: [[1200, 5000]] },
  ];
  function run(module, renderStress) {
    const scene = new THREE.Scene(), bandits = new module.Bandits(scene, { terrain: { heightAt: (x, y) => 40 + 20 * Math.sin(x / 500) * Math.cos(y / 600) } });
    const player = { fm: { state: new Float64Array(32) }, missiles: { live: new Uint8Array(1), r: new Float64Array(9) }, damage: 0, takeHit(value) { this.damage += value; } };
    bandits.player = player;
    const sim = new SimCore(seed); sim.addSystem(bandits);
    bandits.spawnFlight(flights);
    const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 850, -80);
    const checkpoints = [], observedStates = new Set();
    for (let tick = 0; tick < ticks; tick++) {
      const time = tick / 120, state = player.fm.state;
      state[0] = 30 * time; state[1] = Math.sin(time * .1) * 30; state[2] = 700;
      state[7] = 30; state[8] = Math.cos(time * .1) * 3; state[9] = 0;
      player.missiles.live[0] = tick >= 240 && tick < 480 ? 1 : 0;
      player.missiles.r.set([bandits.state[5 * 14] - 900, bandits.state[5 * 14 + 1], bandits.state[5 * 14 + 2], 500, 0, 0]);
      if (tick === 120) bandits.damage(4, 90); // damaged ace enters BINGO and reaches map edge
      if (tick === 600) bandits.damage(7, 100); // normal kill bookkeeping
      sim.tick();
      for (let index = 0; index < 8; index++) observedStates.add(bandits.state[index * 14 + 7]);
      if (renderStress && tick % 3 === 0) bandits.render(.37, camera);
      if ((tick + 1) % 60 === 0 || tick === ticks - 1) checkpoints.push({ tick: tick + 1, hash: sim.stateHash() });
    }
    return { hash: sim.stateHash(), checkpoints, state: Array.from(bandits.state), counters: { kills: bandits.kills, blueLosses: bandits.blueLosses, escapes: bandits.escapes, launches: bandits.launches, gunRounds: bandits.gunRounds, playerDamage: player.damage }, observedStates: [...observedStates].sort(), rng: [sim.rng.a, sim.rng.b, sim.rng.c, sim.rng.d] };
  }
  const actual = run(current, false), stressed = run(current, true), baseline = reference ? run(reference, false) : null;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const checks = [];
  assertion(checks, "sim:render-does-not-change-state", same(actual, stressed));
  assertion(checks, "sim:fixture-exercises-weapons", actual.counters.launches > 0 && actual.counters.gunRounds > 0, actual.counters);
  assertion(checks, "sim:fixture-exercises-evasion-and-bingo", actual.observedStates.includes(2) && actual.observedStates.includes(5), actual.observedStates);
  if (baseline) assertion(checks, "sim:reference-regression", same(actual, baseline), { current: actual.hash, reference: baseline.hash, firstMismatch: actual.checkpoints.find((value, index) => value.hash !== baseline.checkpoints[index]?.hash) ?? null });
  return { seed, ticks, fixtureVersion: 1, checks, current: actual, withRendering: stressed, reference: baseline };
}

window.__AIRCRAFT_QA = { boot, capture, measure, analyzeImage, simulationRegression };
