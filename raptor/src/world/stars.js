// Astronomical angular scales and fluxes, with a local NASA bright-star
// catalog. The seeded decorative field remains the asset-failure fallback.
import * as THREE from "three";
import { Fn, attribute, uniform, texture, vec2, vec3, vec4, float, uv, max, sqrt, dot,
  normalize, smoothstep, fwidth, atan, asin, pow, modelWorldMatrix,
  cameraProjectionMatrix, viewportSize, positionPrevious, materialOpacity, velocity, select } from "three/tsl";
import { cirrusTransmission, stellarAirTransmission, horizonVisibility } from "./celestial-nodes.js";
import { moonPosition, ZERO_MAG_LUX, SCENE_PER_LUX, SOLAR_SCENE_IRRADIANCE } from "./celestial.js";

import { loadBrightStarCatalogue, starDirection, starTint, precessionAngles } from "./starcatalog.js";
import { surfaceVelocityMRT } from "./surfacevelocitymrt.js";

const R = 43000, COUNT = 6000;
function starGeometry(stars) {
  const plane = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry().copy(plane);
  plane.dispose();
  geometry.instanceCount = stars.length;
  geometry.setAttribute("starCenter", new THREE.InstancedBufferAttribute(new Float32Array(stars.flatMap((s) => s.p)), 3));
  geometry.setAttribute("starColor", new THREE.InstancedBufferAttribute(new Float32Array(stars.flatMap((s) => s.c)), 3));
  return geometry;
}
// Celestial PSFs exceed the game's half-float+bloom range after dark
// adaptation. Apply a bounded highlight shoulder; their
// physical irradiance still drives atmosphere, surfaces, and phase energy.
// This deliberately matches the existing analytic Sun's ~24-unit peak.
const celestialHighlight = (rgb) => rgb.div(dot(rgb, vec3(.2126, .7152, .0722)).div(24).add(1));
// Invisible additive cards must leave both scene color and velocity intact.
// Use the actual source result and completed alpha, without a new brightness
// threshold. A nonzero source is unchanged even when display quantization
// makes its contribution too small to alter the current color attachment.
function visibleCelestialSource(colorNode) {
  return Fn(() => {
    const source = colorNode.toVar('celestialVisibleSource');
    return source.a.mul(materialOpacity).greaterThan(0)
      .and(source.rgb.greaterThan(vec3(0)).any());
  })();
}

// Angular celestial geometry is camera-centered; its finite construction
// radius must not put a star or the Moon in front of a distant mountain.
// Keep ordinary depth testing while evaluating against the clear far depth.
function celestialFarDepth() {
  return Fn((inputs, builder) => float(builder.renderer.reversedDepthBuffer ? 0 : 1))();
}

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

let maps;
function skyTextures() {
  if (maps) return maps;
  const n = 64, pixels = new Uint8Array(n * n * 4);
  let sum = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r2 = ((x + .5) / n * 2 - 1) ** 2 + ((y + .5) / n * 2 - 1) ** 2;
    const profile = Math.max(0, (Math.exp(-4.8 * r2) - Math.exp(-4.8)) / (1 - Math.exp(-4.8)));
    const i = (y * n + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255; pixels[i + 3] = Math.round(profile * 255);
    sum += pixels[i + 3] / 255;
  }
  const star = new THREE.DataTexture(pixels, n, n, THREE.RGBAFormat);
  star.minFilter = star.magFilter = THREE.LinearFilter; star.needsUpdate = true;
  const moon = new THREE.DataTexture(new Uint8Array([118, 117, 114, 255]), 1, 1, THREE.RGBAFormat);
  moon.colorSpace = THREE.SRGBColorSpace; moon.wrapS = THREE.RepeatWrapping;
  moon.minFilter = THREE.LinearMipmapLinearFilter; moon.magFilter = THREE.LinearFilter;
  moon.generateMipmaps = true; moon.flipY = false; moon.needsUpdate = true;
  if (typeof document !== "undefined") {
    new THREE.ImageLoader().load(new URL("../../assets/sky/lroc-color-2k.jpg", import.meta.url).href, (image) => {
      let canvas;
      try {
        const width = image.naturalWidth ?? image.width, height = image.naturalHeight ?? image.height;
        if (width !== 2048 || height !== 1024) return;
        canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(image, 0, 0);
        const rgba = ctx.getImageData(0, 0, width, height).data;
        if (!(rgba instanceof Uint8ClampedArray) || rgba.byteLength !== width * height * 4) return;
        const data = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
        // Validate the complete image before releasing immutable 1x1 storage.
        // Existing texture/node references recreate storage on the next upload.
        moon.dispose();
        moon.image = { data, width, height }; moon.needsUpdate = true;
      } catch {
        // Decode/canvas failures retain the neutral low-detail Moon.
      } finally {
        if (canvas) { canvas.width = 1; canvas.height = 1; }
      }
    }, undefined, () => { /* neutral low-detail Moon if the asset is unavailable */ });
  }
  maps = { star, moon, profileMean: sum / (n * n) };
  return maps;
}

// Projected mean of a Lommel-Seeliger disc: used only when time changes to
// normalize the texture's integrated brightness to the empirical phase law.
export function lunarDiscMean(phaseAngle) {
  let sum = 0, count = 0;
  const sx = Math.sin(phaseAngle), sz = Math.cos(phaseAngle), n = 64;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = 2 * (x + .5) / n - 1, py = 2 * (y + .5) / n - 1, r2 = px * px + py * py;
    if (r2 >= 1) continue;
    const mu = Math.sqrt(1 - r2), mu0 = Math.max(px * sx + mu * sz, 0);
    sum += 2 * mu0 / Math.max(mu0 + mu, 1e-5); count++;
  }
  return sum / count;
}

export class Stars {
  constructor(seedRand = seededRandom(0x7a27c9e5), sky = null, { catalogue = true, catalogueURL } = {}) {
    this.uExposureGain = sky?.uExposureGain || uniform(1);
    this._motionFrame = 0; this._motionCamera = null; this._motionHistory = new WeakMap();
    // Stock velocity remembers the last draw, including one before a hidden
    // interval or catalogue replacement. Only consecutive main-view draws of
    // the same geometry may reuse that history. Color-only probes never bind
    // this uniform or advance the stock velocity through SurfaceVelocityMRT.
    this._motionHistoryValid = uniform(false).onObjectUpdate(({ object, camera, renderer }) => {
      if (camera !== this._motionCamera || !renderer.getMRT()?.has("velocity")) return false;
      let record = this._motionHistory.get(object);
      if (!record || record.frame !== this._motionFrame || record.geometry !== object.geometry) {
        const valid = !!record && record.frame === this._motionFrame - 1
          && record.geometry === object.geometry && record.camera === camera;
        record = { frame: this._motionFrame, geometry: object.geometry, camera, valid };
        this._motionHistory.set(object, record);
      }
      return record.valid;
    });
    this.group = new THREE.Group(); this.points = new THREE.Group();
    this.group.add(this.points); this.pointSets = []; this.mats = [];
    this.uMoonDir = uniform(new THREE.Vector3(0, -1, 0));
    this.uMoonCosRadius = uniform(1); this.uMoonLightLocal = uniform(new THREE.Vector3(0, 0, 1));
    this.uMoonRadiance = uniform(0);
    this.uMoonTanRadius = uniform(.0045);
    this.uMoonRight = uniform(new THREE.Vector3(1, 0, 0));
    this.uMoonUp = uniform(new THREE.Vector3(0, 1, 0));
    const tex = skyTextures();
    const bins = [{ max: 1.5, size: 3.6, stars: [] }, { max: 3.5, size: 2.4, stars: [] }, { max: 6.5, size: 1.7, stars: [] }];
    const bandAxis = new THREE.Vector3(.55, 1, .2).normalize();
    const tangent = new THREE.Vector3().crossVectors(bandAxis, new THREE.Vector3(0, 0, 1)).normalize();
    const bitangent = new THREE.Vector3().crossVectors(bandAxis, tangent).normalize(), v = new THREE.Vector3();
    for (let i = 0; i < COUNT; i++) {
      if (i % 10 < 3) {
        const a = seedRand() * Math.PI * 2, off = (seedRand() + seedRand() + seedRand() - 1.5) * .24;
        v.copy(tangent).multiplyScalar(Math.cos(a)).addScaledVector(bitangent, Math.sin(a)).addScaledVector(bandAxis, off).normalize();
      } else {
        const y = seedRand() * 2 - 1, a = seedRand() * Math.PI * 2, r = Math.sqrt(1 - y * y);
        v.set(r * Math.cos(a), y, r * Math.sin(a));
      }
      const magnitude = i === 0 ? -1.46 : Math.log10(1 + seedRand() * (1e4 - 1)) / .5 - 1.5;
      const t = seedRand();
      // Subtle stellar color, normalized to equal photopic luminance.
      const color = [1.06 - .21 * t, .97, .79 + .34 * t];
      const luma = color[0] * .2126 + color[1] * .7152 + color[2] * .0722;
      const irradiance = ZERO_MAG_LUX * SCENE_PER_LUX * 10 ** (-.4 * magnitude);
      bins.find((b) => magnitude <= b.max).stars.push({ p: v.toArray().map((x) => x * R), c: color.map((x) => x / luma * irradiance), magnitude });
    }
    this.magnitudeCounts = bins.map((b) => ({ max: b.max, count: b.stars.length }));
    for (const bin of bins) {
      const geometry = starGeometry(bin.stars);
      const material = new THREE.PointsNodeMaterial({ size: bin.size, sizeAttenuation: false, transparent: true,
        opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      material.positionNode = Fn((inputs, builder) => {
        const center = attribute("starCenter", "vec3");
        // Stock velocity owns prior object/camera matrices. Its previous
        // local point must be this star, not the screen-facing unit quad.
        // Avoid registering motion callbacks in single-color/probe draws.
        if (builder.renderer.getMRT()?.has("velocity")) positionPrevious.assign(center);
        return center;
      })();
      material.colorNode = Fn(() => {
        const dir = normalize(modelWorldMatrix.mul(vec4(attribute("starCenter", "vec3"), 0)).xyz);
        const pixelAngle = float(2).div(cameraProjectionMatrix.element(1).element(1).mul(viewportSize.y));
        // Derivatives measure the actual rasterized quad area, including DPR
        // and quality render scale. Stellar flux therefore survives resizing.
        const quadPixels = float(1).div(max(fwidth(uv().x).mul(fwidth(uv().y)), 1e-8));
        const solidAngle = pixelAngle.pow(2).mul(quadPixels).mul(tex.profileMean);
        const flux = attribute("starColor", "vec3").div(max(solidAngle, 1e-12));
        // Use the uniform node itself so the silhouette follows distance.
        const occultation = float(1).sub(smoothstep(this.uMoonCosRadius.sub(1e-7), this.uMoonCosRadius.add(1e-7), dot(dir, this.uMoonDir)));
        const transmission = stellarAirTransmission(dir).mul(cirrusTransmission(dir)).mul(occultation);
        return vec4(celestialHighlight(flux.mul(this.uExposureGain)).mul(transmission), texture(tex.star).a);
      })();
      material.maskNode = visibleCelestialSource(material.colorNode);
      material.depthNode = celestialFarDepth();
      material.mrtNode = surfaceVelocityMRT(select(this._motionHistoryValid, velocity, vec2(4)));
      const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.renderOrder = -99;
      this.mats.push(material); this.pointSets.push(mesh); this.points.add(mesh);
    }
    const moonMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false });
    moonMaterial.colorNode = Fn(() => {
      const xy = uv().mul(2).sub(1), r2 = dot(xy, xy), z = sqrt(max(float(1).sub(r2), 0));
      const n = vec3(xy, z), mu0 = dot(n, this.uMoonLightLocal);
      const limb = float(1).sub(smoothstep(float(1).sub(fwidth(r2)), 1, r2));
      const terminator = smoothstep(fwidth(mu0).mul(-.5), fwidth(mu0).mul(.5), mu0);
      const ls = max(mu0, 0).mul(2).div(max(max(mu0, 0).add(z), 1e-5));
      // NASA map is centered on longitude 0; uploaded north-first, flipY=false.
      const lonLat = vec2(atan(n.x, n.z).div(2 * Math.PI).add(.5), float(.5).sub(asin(n.y).div(Math.PI)));
      const albedo = texture(tex.moon, lonLat).rgb;
      const direction = normalize(this.uMoonDir.add(this.uMoonRight.mul(xy.x.mul(this.uMoonTanRadius)))
        .add(this.uMoonUp.mul(xy.y.mul(this.uMoonTanRadius))));
      const transmission = stellarAirTransmission(direction).mul(cirrusTransmission(direction));
      // A per-disc shoulder retains mare/bright-highland contrast while the
      // observer adapts to the dim sky. Attenuation follows the shoulder so
      // a cirrus filament still dims the Moon instead of being tone-mapped
      // back to white. This display adaptation never changes lunar lighting.
      const linearScale = this.uMoonRadiance.mul(this.uExposureGain);
      const displayedScale = linearScale.div(linearScale.div(9).add(1));
      return vec4(albedo.mul(ls).mul(displayedScale).mul(transmission), limb.mul(terminator));
    })();
    moonMaterial.maskNode = visibleCelestialSource(moonMaterial.colorNode);
    moonMaterial.depthNode = celestialFarDepth();
    moonMaterial.mrtNode = surfaceVelocityMRT(select(this._motionHistoryValid, velocity, vec2(4)));
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), moonMaterial);
    this.moon.renderOrder = -98; this.moon.frustumCulled = false; this.group.add(this.moon);
    // Retained API. Atmospheric Mie scattering supplies the aureole now.
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    this.halo.visible = false; this.group.add(this.halo);
    this._sunDir = new THREE.Vector3(0, 1, 0); this._inverseMoonQ = new THREE.Quaternion();
    this._basis = new THREE.Matrix4(); this._east = new THREE.Vector3(); this._north = new THREE.Vector3(); this._third = new THREE.Vector3();
    this._starBins = bins;
    this._catalogueDateMs = Date.UTC(2026, 5, 21, 12);
    this._catalogueEpochDay = null; this._catalogueRecords = null;
    this.catalogueStatus = "fallback";
    this.catalogueReady = catalogue && typeof window !== "undefined"
      ? loadBrightStarCatalogue(catalogueURL).then((records) => {
        if (!records) return false;
        this._catalogueRecords = records; this._refreshCatalogue(this._catalogueDateMs);
        this.catalogueStatus = "ready"; return true;
      }) : Promise.resolve(false);
  }

  _refreshCatalogue(dateMs) {
    if (!this._catalogueRecords) return;
    // Proper motion/precession change far less than a raster pixel per day.
    // Rebuild only when the UTC date changes; sidereal rotation stays exact.
    const day = Math.floor(dateMs / 86400000);
    if (day === this._catalogueEpochDay) return;
    const epochMs = (day + .5) * 86400000, angles = precessionAngles(epochMs);
    for (const bin of this._starBins) bin.stars = [];
    for (const star of this._catalogueRecords) {
      const color = starTint(star.bv);
      const luma = color[0] * .2126 + color[1] * .7152 + color[2] * .0722;
      const irradiance = ZERO_MAG_LUX * SCENE_PER_LUX * 10 ** (-.4 * star.magnitude);
      this._starBins.find((b) => star.magnitude <= b.max).stars.push({
        p: starDirection(star, epochMs, angles).map((x) => x * R),
        c: color.map((x) => x / luma * irradiance), magnitude: star.magnitude,
      });
    }
    this._starBins.forEach((bin, i) => {
      const old = this.pointSets[i].geometry;
      this.pointSets[i].geometry = starGeometry(bin.stars); old.dispose();
    });
    this.magnitudeCounts = this._starBins.map((b) => ({ max: b.max, count: b.stars.length }));
    this._catalogueEpochDay = day;
  }

  update(sunElDeg, hours, latDeg, sunDir, state = null) {
    // Existing four-argument callers remain usable; Atmosphere supplies UTC.
    state ||= moonPosition(Date.UTC(2026, 5, 21) + hours * 3600000, latDeg, 0);
    this._catalogueDateMs = Number.isFinite(state.dateMs) ? state.dateMs : Date.UTC(2026, 5, 21) + hours * 3600000;
    this._refreshCatalogue(this._catalogueDateMs);
    this._sunDir.copy(sunDir); this.uMoonDir.value.fromArray(state.direction);
    this.uMoonCosRadius.value = Math.cos(state.angularRadius);
    this.uMoonTanRadius.value = Math.tan(state.angularRadius);
    this.points.visible = sunElDeg < 2;
    const lat = state.latitudeRadians, theta = state.siderealRadians;
    this._east.set(-Math.sin(theta), Math.cos(lat) * Math.cos(theta), -Math.sin(lat) * Math.cos(theta));
    this._north.set(0, Math.sin(lat), Math.cos(lat));
    this._third.set(Math.cos(theta), Math.cos(lat) * Math.sin(theta), -Math.sin(lat) * Math.sin(theta));
    this._basis.makeBasis(this._east, this._north, this._third); this.points.quaternion.setFromRotationMatrix(this._basis);
    this.moon.up.copy(this._north);
    this.moon.position.copy(this.uMoonDir.value).multiplyScalar(R * .98);
    this.moon.scale.setScalar(Math.tan(state.angularRadius) * R * .98);
    const omega = 2 * Math.PI * (1 - Math.cos(state.angularRadius));
    this.uMoonRadiance.value = SOLAR_SCENE_IRRADIANCE * state.irradianceRatio / Math.max(omega * .18 * Math.max(lunarDiscMean(state.phaseAngle), 1e-4), 1e-12);
    this.moon.visible = state.elevation > -.15 && state.illuminatedFraction > .0001;
    this.halo.visible = false;
  }

  followCamera(camera) {
    this._motionFrame++; this._motionCamera = camera;
    this.group.position.copy(camera.position); this.group.updateMatrixWorld(true);
    this.moon.lookAt(camera.position);
    this.uMoonRight.value.set(1, 0, 0).applyQuaternion(this.moon.quaternion);
    this.uMoonUp.value.set(0, 1, 0).applyQuaternion(this.moon.quaternion);
    this._inverseMoonQ.copy(this.moon.quaternion).invert();
    this.uMoonLightLocal.value.copy(this._sunDir).applyQuaternion(this._inverseMoonQ);
  }
}
