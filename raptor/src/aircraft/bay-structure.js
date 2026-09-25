// Formed sheet structure for visible door liners and recessed bay walls.
// Everything follows the existing shell; this module never changes cutouts,
// hinge positions, door motion or the clearance envelope of the outer skin.
import * as THREE from 'three';
import {mergeDetails} from './hardware.js';

export function surfaceSampler(geometry, axes = [0, 2]) {
  const p = geometry.attributes.position, n = geometry.attributes.normal, triangles = [];
  for (let i = 0; i < geometry.index.count; i += 3) {
    const ids = [0,1,2].map(j => geometry.index.getX(i+j));
    const points = ids.map(j => new THREE.Vector3().fromBufferAttribute(p,j));
    const a = points.map(v => v.getComponent(axes[0])), b = points.map(v => v.getComponent(axes[1]));
    const determinant = (b[1]-b[2])*(a[0]-a[2]) + (a[2]-a[1])*(b[0]-b[2]);
    if (Math.abs(determinant) < 1e-12) continue;
    triangles.push({points, normals:ids.map(j => new THREE.Vector3().fromBufferAttribute(n,j)),a,b,determinant});
  }
  return (x,y) => {
    for (const t of triangles) {
      const {a,b,determinant} = t;
      const u = ((b[1]-b[2])*(x-a[2])+(a[2]-a[1])*(y-b[2]))/determinant;
      const v = ((b[2]-b[0])*(x-a[2])+(a[0]-a[2])*(y-b[2]))/determinant, w = 1-u-v;
      if (Math.min(u,v,w) < -1e-6) continue;
      const point = new THREE.Vector3(), normal = new THREE.Vector3();
      [u,v,w].forEach((weight,i) => {point.addScaledVector(t.points[i],weight);normal.addScaledVector(t.normals[i],weight);});
      return {point,normal:normal.normalize()};
    }
    return null;
  };
}

// A shallow hat section has broad faces and chamfered shoulders. Separate
// vertices across each fold retain definite sheet-metal highlights.
export function formedRib(points, normals, width = .032, depth = .018, quality = 'high') {
  const shape = quality==='low'?[[-.5,0],[-.22,1],[.22,1],[.5,0]]:
    quality==='medium'?[[-.5,0],[-.3,.1],[-.18,1],[.18,1],[.3,.1],[.5,0]]:
    [[-.5,0],[-.34,.08],[-.25,.86],[-.17,1],[.17,1],[.25,.86],[.34,.08],[.5,0]];
  const positions = [], uv = [], indices = [];
  const rings = points.map((point,i) => {
    const tangent = points[Math.min(points.length-1,i+1)].clone().sub(points[Math.max(0,i-1)]).normalize();
    const across = new THREE.Vector3().crossVectors(normals[i],tangent).normalize();
    return shape.map(([x,y]) => point.clone().addScaledVector(across,x*width).addScaledVector(normals[i],y*depth));
  });
  for (let j=0;j<shape.length-1;j++) for (let i=0;i<points.length-1;i++) {
    const offset = positions.length/3;
    for(const point of [rings[i][j],rings[i][j+1],rings[i+1][j],rings[i+1][j+1]])positions.push(...point.toArray());
    uv.push(j/(shape.length-1),i/(points.length-1),(j+1)/(shape.length-1),i/(points.length-1),
      j/(shape.length-1),(i+1)/(points.length-1),(j+1)/(shape.length-1),(i+1)/(points.length-1));
    indices.push(offset,offset+2,offset+1,offset+1,offset+2,offset+3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);
  geometry.computeVertexNormals();return geometry;
}

export function addFormedRib(parent,name,points,normals,width,depth,material,quality='high') {
  if(points.length<2)return;
  const mesh = new THREE.Mesh(formedRib(points,normals,width,depth,quality),material);mesh.name=name;parent.add(mesh);return mesh;
}

function insetPolygon(outline, distance) {
  const points=outline.filter((p,i)=>i===0||Math.hypot(p[0]-outline[i-1][0],p[1]-outline[i-1][1])>1e-6);
  if(Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])<1e-6)points.pop();
  const area=points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-b[0]*a[1];},0);
  const lines=points.map((a,i)=>{const b=points[(i+1)%points.length],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy),sign=Math.sign(area);
    return {p:[a[0]-sign*dy/l*distance,a[1]+sign*dx/l*distance],d:[dx/l,dy/l]};});
  return lines.map((b,i)=>{
    const a=lines[(i+lines.length-1)%lines.length],cross=a.d[0]*b.d[1]-a.d[1]*b.d[0];
    if(Math.abs(cross)<1e-6)return b.p;
    const t=((b.p[0]-a.p[0])*b.d[1]-(b.p[1]-a.p[1])*b.d[0])/cross;
    return[a.p[0]+a.d[0]*t,a.p[1]+a.d[1]*t];
  });
}

export function panelStructure(surface, outline, material, {
  quality='high',axes=[0,2],normalSign=1,lift=.002,depth=.018,width=.034,
  fractions=[.22,.5,.78],name='bayPanelStructure',offset=new THREE.Vector3(),
}={}) {
  const group=new THREE.Group();group.name=name;
  const sample=surfaceSampler(surface,axes),extents=[0,1].map(axis=>Math.max(...outline.map(p=>p[axis]))-Math.min(...outline.map(p=>p[axis])));
  const inset=insetPolygon(outline,Math.min(.05,Math.min(...extents)*.16));
  const add=(a,b,label)=>{
    const spacing=quality==='low'?.42:quality==='medium'?.26:.17;
    const count=Math.max(2,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/spacing)),points=[],normals=[];
    for(let i=0;i<=count;i++){
      const t=i/count,s=sample(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);if(!s)continue;
      s.normal.multiplyScalar(normalSign);points.push(s.point.addScaledVector(s.normal,lift));normals.push(s.normal);
    }
    addFormedRib(group,label,points,normals,width,depth,material,quality);
  };
  inset.forEach((a,i)=>add(a,inset[(i+1)%inset.length],'perimeterChannel'));
  const axis=extents[0]>extents[1]?0:1,other=1-axis;
  const min=Math.min(...inset.map(p=>p[axis])),max=Math.max(...inset.map(p=>p[axis]));
  for(const fraction of quality==='low'&&fractions.length?[.5]:fractions){
    const at=min+(max-min)*fraction,crossings=[];
    inset.forEach((a,i)=>{const b=inset[(i+1)%inset.length];if((a[axis]<=at&&b[axis]>at)||(b[axis]<=at&&a[axis]>at))crossings.push(a[other]+(b[other]-a[other])*(at-a[axis])/(b[axis]-a[axis]));});
    if(crossings.length<2)continue;
    const a=[],b=[];a[axis]=b[axis]=at;a[other]=Math.min(...crossings);b[other]=Math.max(...crossings);add(a,b,'transverseStiffener');
  }
  mergeDetails(group);group.position.copy(offset);return group;
}
