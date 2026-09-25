import { F22_LEVELS, f22Quality } from './f22-quality.js';

const resources = new Map();
const instances = new WeakMap();
const qualityIndices = Object.freeze({high:0,HIGH:0,ultra:0,ULTRA:0,medium:1,MEDIUM:1,med:1,MED:1,low:2,LOW:2});
// CSS pixels along the larger aircraft dimension, independent of DPR/render
// scale. Hysteresis keeps chase-camera movement from alternating resources.
export const F22_LOD_THRESHOLDS = Object.freeze({ high:320, medium:110, hysteresis:.12 });

function meshPaths(root) {
  const meshes = new Map();
  function visit(object, path) {
    if (object.isMesh) meshes.set(path, object);
    const occurrences = new Map();
    for (const child of object.children) {
      const name = child.name || child.type;
      const occurrence = occurrences.get(name) || 0;
      occurrences.set(name, occurrence + 1);
      visit(child, `${path}/${name}:${occurrence}`);
    }
  }
  visit(root, '');
  return meshes;
}

// Called once at construction, before cockpit detail or FlightFX is attached.
// Each visual mesh retains one geometry for its entire lifetime. Repeated
// geometry replacement exposed intermittent WebGPU wing corruption in the
// pinned renderer; separate prebuilt visuals avoid that render-cache path.
// Rig parents and all material assignments remain untouched during updates.
export function registerF22LodResources(quality, structures) {
  quality = f22Quality(quality);
  const primary = structures[quality].group;
  const paths = Object.fromEntries(Object.entries(structures).map(([level,built]) => [level,meshPaths(built.group)]));
  for (const [path,mesh] of paths[quality]) {
    mesh.userData.f22LodVisible = [quality];
    mesh.userData.f22LodGeometry = quality;
    for (const level of F22_LEVELS.slice(F22_LEVELS.indexOf(quality))) {
      const variant = paths[level]?.get(path);
      if (!variant) throw new Error(`F-22 ${level} LOD is missing ${path}`);
      if (level === quality) continue;
      const visual = mesh.clone(false);
      visual.geometry = variant.geometry;
      visual.name = `${mesh.name}:lod-${level}`;
      visual.userData = {...variant.userData,f22LodVisible:[level],f22LodGeometry:level};
      visual.visible = false;
      mesh.parent.add(visual);
    }
  }
  const key = `f22:${quality}`;
  const resource = { key, quality };
  resources.set(key, resource);
  primary.userData.f22LodKey = key;
  return resource;
}

export function bindF22Lod(group) {
  const resource = resources.get(group.userData.f22LodKey);
  if (!resource) return null;
  const details = [];
  group.traverse(object => {
    if (Array.isArray(object.userData.f22LodVisible))
      details.push({ object, levels:object.userData.f22LodVisible });
  });
  const instance = { resource, details, level:null, initialized:false };
  instances.set(group, instance);
  applyLevel(group, instance, resource.quality);
  return instance;
}

function applyLevel(group, instance, level) {
  // Only explicitly tagged visual meshes/groups are toggled. No rig
  // pivot or arbitrary descendant attached by FlightFX is ever hidden.
  for (const binding of instance.details) binding.object.visible = binding.levels.includes(level);
  instance.level = level;
  group.userData.aircraft.lod.level = level;
}

export function updateF22Visuals(group, { projectedPixels, forceLevel, maxQuality } = {}) {
  const instance = instances.get(group) || bindF22Lod(group);
  if (!instance) return null;
  const cap = Math.max(F22_LEVELS.indexOf(instance.resource.quality),qualityIndices[maxQuality] ?? 0);
  let next;
  if (forceLevel !== undefined) {
    next = Math.max(cap, F22_LEVELS.indexOf(f22Quality(forceLevel)));
  } else {
    if (!Number.isFinite(projectedPixels) || projectedPixels < 0) {
      const level = F22_LEVELS[Math.max(cap,F22_LEVELS.indexOf(instance.level))];
      if (level !== instance.level) applyLevel(group,instance,level);
      return level;
    }
    const {high,medium,hysteresis:h} = F22_LOD_THRESHOLDS;
    next = instance.initialized ? F22_LEVELS.indexOf(instance.level) :
      projectedPixels >= high ? 0 : projectedPixels >= medium ? 1 : 2;
    if (instance.initialized) {
      if (next === 0 && projectedPixels < high * (1-h)) next = 1;
      if (next === 1 && projectedPixels < medium * (1-h)) next = 2;
      if (next === 2 && projectedPixels > medium * (1+h)) next = 1;
      if (next === 1 && projectedPixels > high * (1+h)) next = 0;
    }
    next = Math.max(cap, next);
  }
  instance.initialized = true;
  const level = F22_LEVELS[next];
  if (level !== instance.level) applyLevel(group, instance, level);
  return level;
}
