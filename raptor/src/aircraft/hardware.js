import * as THREE from "three";
import { buildLandingGear } from "./landing-gear.js";
import { patchGeometry } from "./detail-geometry.js";
export { F22_GEAR_DIMENSIONS } from "./landing-gear.js";

// Consolidate only static detail groups, never control-surface or nozzle rigs.
// This keeps the close-up hardware affordable during flight.
export function mergeDetails(group) {
  const batches = new Map(), originals = new Set();
  for (const mesh of [...group.children]) {
    if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.children.length || Array.isArray(mesh.material) ||
        Object.keys(mesh.geometry.morphAttributes).length) continue;
    mesh.updateMatrix();
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const p = geometry.attributes.position;
    const attributes = Object.entries(geometry.attributes).sort(([a],[b]) => a.localeCompare(b));
    // Attribute signatures keep color, tangent, secondary UVs and arbitrary
    // authored attributes intact, including when a material has mixed inputs.
    const signature = attributes.map(([name,a]) => `${name}:${a.itemSize}`).join('|');
    const key = [mesh.material.uuid,signature,mesh.visible,mesh.castShadow,mesh.receiveShadow,mesh.renderOrder].join(':');
    let batch = batches.get(key);
    if (!batch) {
      batch = { material:mesh.material, attributes:Object.fromEntries(attributes.map(([name,a]) => [name,{size:a.itemSize,data:[]}])),
        index:[], names:[], sources:[], visible:mesh.visible, castShadow:mesh.castShadow, receiveShadow:mesh.receiveShadow, renderOrder:mesh.renderOrder };
      batches.set(key,batch);
    }
    const index = geometry.index, count = index?.count ?? p.count;
    const first = Math.max(0,geometry.drawRange.start), last = Math.min(count,first+geometry.drawRange.count);
    const remap = new Map(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const mirrored = mesh.matrix.determinant() < 0;
    const firstTriangle = batch.index.length / 3;
    function vertex(old) {
      if (remap.has(old)) return remap.get(old);
      const next = batch.attributes.position.data.length / 3; remap.set(old,next);
      for (const [name,attribute] of attributes) for (let k=0;k<attribute.itemSize;k++) {
        const value = attribute.getComponent(old,k);
        batch.attributes[name].data.push(name==='tangent' && k===3 && mirrored ? -value : value);
      }
      return next;
    }
    for (let i=first;i+2<last;i+=3) {
      const ia=index?index.getX(i):i, ib=index?index.getX(i+1):i+1, ic=index?index.getX(i+2):i+2;
      a.fromBufferAttribute(p,ia);b.fromBufferAttribute(p,ib);c.fromBufferAttribute(p,ic);
      // Prune collapsed primitive poles and zero-area authored triangles.
      // Remapping only referenced vertices also removes the abandoned poles.
      if (b.sub(a).cross(c.sub(a)).lengthSq() <= 1e-20) continue;
      if (mirrored) batch.index.push(vertex(ia),vertex(ic),vertex(ib));
      else batch.index.push(vertex(ia),vertex(ib),vertex(ic));
    }
    batch.names.push(mesh.name);
    batch.sources.push({name:mesh.name,firstTriangle,triangles:batch.index.length/3-firstTriangle});
    geometry.dispose(); originals.add(mesh.geometry); group.remove(mesh);
  }
  // Do not dispose a geometry still used by a rig or other unmerged child.
  const retained = new Set();group.traverse(object=>{if(object.geometry)retained.add(object.geometry);});
  for(const geometry of originals)if(!retained.has(geometry))geometry.dispose();
  for(const batch of batches.values()) {
    if(!batch.index.length)continue;
    const geometry = new THREE.BufferGeometry();
    for(const [name,attribute] of Object.entries(batch.attributes))
      geometry.setAttribute(name,new THREE.Float32BufferAttribute(attribute.data,attribute.size));
    geometry.setIndex(batch.index);
    const normals=geometry.attributes.normal, fallback=geometry.clone();fallback.computeVertexNormals();
    const computed=fallback.attributes.normal;
    for(let i=0;i<normals.count;i++) {
      const n=new THREE.Vector3().fromBufferAttribute(normals,i);
      if(n.lengthSq()<1e-16)n.fromBufferAttribute(computed,i);
      n.normalize();normals.setXYZ(i,n.x,n.y,n.z);
    }
    fallback.dispose();geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,batch.material);mesh.name=`${group.name}:${batch.material.name||'detail'}`;
    mesh.visible=batch.visible;mesh.castShadow=batch.castShadow;mesh.receiveShadow=batch.receiveShadow;mesh.renderOrder=batch.renderOrder;
    mesh.userData.components=batch.names;mesh.userData.componentRanges=batch.sources;group.add(mesh);
  }
  return group;
}

export function landingGear(strutLength,wheelRadius,wheelWidth,options={}) {
  return mergeDetails(buildLandingGear(strutLength,wheelRadius,wheelWidth,options));
}

export function airframeHardware(surfaceHeight) {
  const group=new THREE.Group();group.name="airframeHardware";
  const recess=new THREE.MeshStandardMaterial({color:0x303a3e,roughness:.83});
  const louver=new THREE.MeshStandardMaterial({color:0x838d91,roughness:.67,metalness:.3});
  // Dorsal environmental-control outlets: shallow, recessed louvres, aligned
  // to the body skin. No protruding boxes or bright fasteners on a stealth jet.
  for(const sign of [-1,1])for(const z of [.25,4.35]) {
    const x=.98*sign;
    const panel=new THREE.Mesh(patchGeometry((u,v)=>{
      const px=x+(u-.5)*.24,pz=z+(v-.5)*.43;return[px,surfaceHeight(px,pz)+.003,pz];
    },4,10,true),recess);
    panel.name="ECSOutlet";group.add(panel);
    for(let i=0;i<7;i++) {
      const slat=new THREE.Mesh(patchGeometry((u,v)=>{
        const px=x+(u-.5)*.212,pz=z-.174+i*.058+(v-.5)*.025;
        return[px,surfaceHeight(px,pz)+.005+.009*v,pz];
      },6,1,true),louver);
      slat.name="ventLouver";group.add(slat);
    }
  }
  return mergeDetails(group);
}
