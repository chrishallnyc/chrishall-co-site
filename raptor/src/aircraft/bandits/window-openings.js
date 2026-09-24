import * as THREE from 'three';
import {clipProjectedPolygon} from '../geometry/clip-polygon.js';
import {sampleSection,TAU} from './geometry.js';

// Clip in the fuselage's unwrapped angular/axial coordinates, carrying the
// real surface and its smooth normals as interpolated attributes. A window
// therefore removes exactly its own patch, not the opposite side of the hull.
export function cutWindowOpenings(source,rows,panes) {
  let geometry=source.index?source.toNonIndexed():source.clone();source.dispose();
  const skin=geometry.attributes.position.clone(),parameters=new Float32Array(skin.count*3);
  for(let i=0;i<skin.count;i+=3) {
    const theta=[];
    for(let j=0;j<3;j++) {
      const z=skin.getZ(i+j),[,w,h,cy,lower=1]=sampleSection(rows,z),dy=skin.getY(i+j)-cy;
      theta.push(Math.atan2(skin.getX(i+j)/Math.max(w,1e-6),dy/Math.max(h*(dy<0?lower:1),1e-6)));
    }
    const crossesSeam=Math.max(...theta)-Math.min(...theta)>Math.PI;
    for(let j=0;j<3;j++)parameters.set([theta[j]+(crossesSeam&&theta[j]<0?TAU:0),skin.getZ(i+j),0],(i+j)*3);
  }
  geometry.setAttribute('surfacePosition',skin);
  geometry.setAttribute('position',new THREE.BufferAttribute(parameters,3));
  for(const side of [-1,1])for(const [lo,hi,aft,fore,skew]of panes) {
    const next=clipProjectedPolygon(geometry,[[side*lo,aft],[side*lo,fore],[side*hi,fore-skew],[side*hi,aft-skew]],{axes:[0,1]});
    geometry.dispose();geometry=next;
  }
  geometry.setAttribute('position',geometry.attributes.surfacePosition);geometry.deleteAttribute('surfacePosition');
  geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}
