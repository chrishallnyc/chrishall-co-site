// Shared construction tools for the three pooled aircraft. All geometry is
// built once, merged by coating, and then shared by Object3D.clone().
import * as THREE from 'three';
import {curveSegments,curveSubdivisions,chordSegments,includePart,coatingRole,buildLevel} from './quality.js';

export const TAU = Math.PI * 2;

export function meshGeometry(positions, indices) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export function sampleSection(rows, z) {
  let i = 0;
  while (i < rows.length - 2 && z > rows[i + 1][0]) i++;
  const b = rows[i], c = rows[i + 1], interval = c[0] - b[0];
  const t = THREE.MathUtils.clamp((z - b[0]) / interval, 0, 1);
  const out = [z];
  for (let k = 1; k < 5; k++) {
    const def = k === 4 ? 1 : 0;
    const q = b[k] ?? def, r = c[k] ?? def;
    const secant = n => ((rows[n + 1][k] ?? def) - (rows[n][k] ?? def)) / (rows[n + 1][0] - rows[n][0]);
    // A single physical derivative belongs to each station. The old equal-
    // spacing tangents changed slope across unequal nose/tail intervals,
    // making visible rings even with dense tessellation. Monotone Hermite
    // derivatives preserve the authored sections without overshooting them.
    const slope = n => {
      if (rows.length === 2) return secant(0);
      if (n > 0 && n < rows.length - 1) {
        const h0=rows[n][0]-rows[n-1][0],h1=rows[n+1][0]-rows[n][0];
        const d0=secant(n-1),d1=secant(n);
        if(d0*d1<=0)return 0;
        const w0=2*h1+h0,w1=h1+2*h0;
        return (w0+w1)/(w0/d0+w1/d1);
      }
      const first=n===0,a=first?0:rows.length-2,b=first?1:a-1;
      const h0=rows[a+1][0]-rows[a][0],h1=rows[b+1][0]-rows[b][0];
      const d0=secant(a),d1=secant(b),m=((2*h0+h1)*d0-h0*d1)/(h0+h1);
      if(m*d0<=0)return 0;
      return d0*d1<=0&&Math.abs(m)>3*Math.abs(d0)?3*d0:m;
    };
    const m0 = slope(i)*interval, m1 = slope(i+1)*interval;
    out.push((2*t**3-3*t*t+1)*q+(t**3-2*t*t+t)*m0+(-2*t**3+3*t*t)*r+(t**3-t*t)*m1);
  }
  return out;
}

// z, half width, upper radius, section centre y, lower/upper radius ratio.
export function loft(stations, segments = 32, caps = true, subdivisions = 3) {
  segments=curveSegments(segments);subdivisions=curveSubdivisions(subdivisions);
  const rows = [];
  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < subdivisions; j++) rows.push(sampleSection(stations, THREE.MathUtils.lerp(stations[i][0], stations[i+1][0], j/subdivisions)));
  }
  rows.push(stations.at(-1));
  const p = [], ix = [];
  for (const [z, w, h, cy = 0, lower = 1] of rows) {
    for (let j = 0; j < segments; j++) {
      const t = j / segments * TAU, c = Math.cos(t);
      p.push(Math.sin(t)*w, cy+c*h*(c < 0 ? lower : 1), z);
    }
  }
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < segments; j++) {
    const a = i*segments+j, b = i*segments+(j+1)%segments;
    ix.push(a,a+segments,b,b,a+segments,b+segments);
  }
  if (caps) for (const row of [0, rows.length - 1]) {
    const centre = p.length/3;
    p.push(0,rows[row][3] || 0,rows[row][0]);
    for (let j = 0; j < segments; j++) {
      const a = row*segments+j, b = row*segments+(j+1)%segments;
      if (row === 0) ix.push(centre,a,b); else ix.push(centre,b,a);
    }
  }
  const geometry=meshGeometry(p,ix),normals=geometry.attributes.normal;
  // Smooth shading comes from the continuous section field, rather than
  // triangle areas on unequally spaced rings. That keeps the same highlight
  // when a lower LOD reduces longitudinal subdivisions.
  const derivativeStep=(stations.at(-1)[0]-stations[0][0])*1e-5;
  for(let i=0;i<rows.length;i++){
    const [z,w,h,cy=0,lower=1]=rows[i];
    const za=Math.max(stations[0][0],z-derivativeStep),zb=Math.min(stations.at(-1)[0],z+derivativeStep);
    const a=sampleSection(stations,za),b=sampleSection(stations,zb),dz=zb-za;
    const dw=(b[1]-a[1])/dz,dh=(b[2]-a[2])/dz,dc=(b[3]-a[3])/dz,dl=(b[4]-a[4])/dz;
    for(let j=0;j<segments;j++){
      const angle=j/segments*TAU,s=Math.sin(angle),c=Math.cos(angle),factor=c<0?lower:1;
      const tx=w*c,ty=-h*s*factor;
      const zx=dw*s,zy=dc+dh*c*factor+(c<0?h*c*dl:0);
      const nx=-ty,ny=tx,nz=zx*ty-zy*tx,length=Math.hypot(nx,ny,nz);
      if(length>1e-12)normals.setXYZ(i*segments+j,nx/length,ny/length,nz/length);
    }
  }
  return geometry;
}

export function mirror(g) {
  const p = g.getAttribute('position'),n=g.getAttribute('normal');
  for (let i=0;i<p.count;i++) { p.setX(i,-p.getX(i)); if(n)n.setX(i,-n.getX(i)); }
  const ix=g.index;
  for (let i=0;i<ix.count;i+=3) { const b=ix.getX(i+1);ix.setX(i+1,ix.getX(i+2));ix.setX(i+2,b); }
  if(!n)g.computeVertexNormals();
  return g;
}

export function airfoilHeight(t, thickness) {
  return thickness*(0.2969*Math.sqrt(t)-0.126*t-0.3516*t*t+0.2843*t**3-0.1036*t**4)/0.1;
}

// x, centre y, leading-edge z, trailing-edge z, maximum half-thickness.
export function wing(rows, mirrored = false, chord = 18) {
  chord=chordSegments(chord);
  const p=[],ix=[],ring=chord*2;
  for(const [x,y,le,te,h] of rows) for(let j=0;j<ring;j++) {
    const top=j<=chord,t=(1-Math.cos((top?j: ring-j)/chord*Math.PI))/2;
    p.push(x,y+(top?1:-1)*airfoilHeight(t,h),le+(te-le)*t);
  }
  for(let i=0;i<rows.length-1;i++) for(let j=0;j<ring;j++) {
    const a=i*ring+j,b=i*ring+(j+1)%ring;ix.push(a,a+ring,b,b,a+ring,b+ring);
  }
  for(const row of [0,rows.length-1]) {
    const [x,y,le,te]=rows[row],c=p.length/3;p.push(x,y,(le+te)/2);
    for(let j=0;j<ring;j++) {const a=row*ring+j,b=row*ring+(j+1)%ring;if(row===0)ix.push(c,a,b);else ix.push(c,b,a);}
  }
  const g=mirrored?mirror(meshGeometry(p,ix)):meshGeometry(p,ix);
  g.userData.banditProjection='plan';
  return g;
}

// Build the wing box and each trailing control as separate closed solids.
// The narrow hinge space is geometry, so low/raking light catches thickness
// instead of a painted stripe. All solids still merge into one skin batch.
export function segmentedWing(rows, mirrored = false, chord = 18, { cut = .76, gap = .014 } = {}) {
  if (buildLevel() === 2) return wing(rows, mirrored, chord);
  const positions = [], indices = [];
  const append = (sectionRows, from, to) => {
    const steps = Math.max(4, Math.round(chordSegments(chord) * (to - from))), ring = (steps + 1) * 2;
    const offset = positions.length / 3;
    for (const [x, y, le, te, h] of sectionRows) {
      const chordLength = le - te;
      for (let face = 0; face < 2; face++) for (let j = 0; j <= steps; j++) {
        const u = face ? 1 - j / steps : j / steps;
        const t = from + (to - from) * (.5 - .5 * Math.cos(u * Math.PI));
        const thickness=(t<1e-10||t>1-1e-10)?0:airfoilHeight(t,h);
        positions.push(x, y + (face ? -1 : 1) * thickness, le - chordLength * t);
      }
    }
    for (let i = 0; i < sectionRows.length - 1; i++) for (let j = 0; j < ring; j++) {
      const a = offset + i * ring + j, b = offset + i * ring + (j + 1) % ring;
      // Exact leading/trailing-edge duplicate vertices have zero thickness.
      if (positions[a*3+1] === positions[b*3+1] && positions[a*3+2] === positions[b*3+2]) continue;
      indices.push(a, a + ring, b, b, a + ring, b + ring);
    }
    for (const row of [0, sectionRows.length - 1]) {
      const [x, y, le, te] = sectionRows[row], centre = positions.length / 3;
      positions.push(x, y, le + (te - le) * ((from + to) / 2));
      for (let j = 0; j < ring; j++) {
        const a = offset + row * ring + j, b = offset + row * ring + (j + 1) % ring;
        if (positions[a*3+1] === positions[b*3+1] && positions[a*3+2] === positions[b*3+2]) continue;
        indices.push(...(row === 0 ? [centre,a,b] : [centre,b,a]));
      }
    }
  };
  append(rows, 0, cut - gap / 2);
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1], span = b[0] - a[0];
    const margin = Math.min(.012, span * .008);
    const interpolate = t => a.map((v, k) => v + (b[k] - v) * t);
    append([interpolate(margin / span), interpolate(1 - margin / span)], cut + gap / 2, 1);
  }
  const geometry = meshGeometry(positions, indices);
  geometry.userData.banditProjection = 'plan';
  return mirrored ? mirror(geometry) : geometry;
}

export function fin(rows,x,y,cant=0) {
  const g=wing(rows),p=g.getAttribute('position');
  for(let i=0;i<p.count;i++) {const span=p.getX(i),thickness=p.getY(i);p.setXYZ(i,x-thickness+span*cant,y+span,p.getZ(i));}
  g.computeVertexNormals();g.userData.banditProjection='side';return g;
}

export function ribbon(points,width=0.014,normal=[0,1,0]) {
  const p=[],ix=[];
  for(let j=0;j<points.length-1;j++) {
    const a=points[j],b=points[j+1],dir=new THREE.Vector3().subVectors(new THREE.Vector3(...b),new THREE.Vector3(...a));
    const off=dir.cross(new THREE.Vector3(...normal)).normalize().multiplyScalar(width/2),i=p.length/3;
    for(const v of [a,b]) for(const sign of [-1,1]) p.push(v[0]+off.x*sign,v[1]+off.y*sign,v[2]+off.z*sign);
    ix.push(i,i+1,i+2,i+1,i+3,i+2);
  }
  return meshGeometry(p,ix);
}

export function panel(points,thickness=0.012,normal=[0,1,0]) {
  const p=[],ix=[],n=points.length;
  for(const sign of [-1,1]) for(const v of points) p.push(v[0]+normal[0]*thickness*sign,v[1]+normal[1]*thickness*sign,v[2]+normal[2]*thickness*sign);
  const shape=points.map(v=>new THREE.Vector2(v[0],v[2]));
  const tris=THREE.ShapeUtils.triangulateShape(shape,[]);
  for(const tri of tris) {ix.push(...tri);ix.push(...tri.slice().reverse().map(v=>v+n));}
  for(let j=0;j<n;j++) {const k=(j+1)%n;ix.push(j,k,j+n,k,k+n,j+n);}
  return meshGeometry(p,ix);
}

export function tubePath(points,radius=0.015,radial=6) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),Math.max(4,curveSubdivisions(3)*points.length),radius,curveSegments(radial,4),false);
}

// A loft between matching section polygons. Open ends make real inlet
// mouths; the back wall/fan is a separate recessed part.
export function sectionShell(rows) {
  const p=rows.flat(2),ix=[],n=rows[0].length;
  for(let r=0;r<rows.length-1;r++) for(let j=0;j<n;j++) {
    const a=r*n+j,b=r*n+(j+1)%n;ix.push(a,a+n,b,b,a+n,b+n);
  }
  return meshGeometry(p,ix);
}

function projectUV(x,y,z,n,extent) {
  const {span,length,height}=extent;
  if(Math.abs(n[1])>=Math.abs(n[0])&&Math.abs(n[1])>=Math.abs(n[2])*.6) {
    return [(x/span+.5)*.496+(n[1]<0?.502:.002),.502+(z/length+.5)*.496];
  }
  return [.002+(z/length+.5)*.996,.002+(y/height+.5)*.496];
}

export class Airframe {
  constructor(name,materials,extent) {this.name=name;this.materials=materials;this.extent=extent;this.batches=new Map();this.parts=[];}
  add(g,role='skin',options={}) {
    const {position=[0,0,0],name=role,tint=[1,1,1],uv='auto'}=options;
    if(!includePart(name)){g.dispose();return;}
    role=coatingRole(role);
    const chart=uv==='auto'?(g.userData.banditProjection||'auto'):uv;
    g.translate(...position);
    // Split indices so differently projected charts meet at a triangle
    // boundary while preserving the original smooth surface normals.
    const flat=g.index?g.toNonIndexed():g;
    if(flat!==g)g.dispose();
    let b=this.batches.get(role);if(!b){b={p:[],n:[],uv:[],c:[]};this.batches.set(role,b);}
    const p=flat.getAttribute('position'),n=flat.getAttribute('normal'),vertexColor=flat.getAttribute('color'),start=b.p.length/3;
    const partBounds=new THREE.Box3();
    for(let j=0;j<p.count;j+=3) {
      const avg=[0,0,0];for(let k=0;k<3;k++){avg[0]+=n.getX(j+k);avg[1]+=n.getY(j+k);avg[2]+=n.getZ(j+k);}
      if(chart==='top')avg.splice(0,3,0,1,0);
      if(chart==='plan')avg.splice(0,3,0,avg[1]<0?-1:1,0);
      if(chart==='side')avg.splice(0,3,1,0,0);
      for(let k=0;k<3;k++) {
        const i=j+k,x=p.getX(i),y=p.getY(i),z=p.getZ(i);
        b.p.push(x,y,z);b.n.push(n.getX(i),n.getY(i),n.getZ(i));
        b.uv.push(...projectUV(x,y,z,avg,this.extent));
        b.c.push(tint[0]*(vertexColor?.getX(i) ?? 1),tint[1]*(vertexColor?.getY(i) ?? 1),tint[2]*(vertexColor?.getZ(i) ?? 1));
        partBounds.expandByPoint(new THREE.Vector3(x,y,z));
      }
    }
    this.parts.push({name,role,firstVertex:start,vertexCount:p.count,bounds:[partBounds.min.toArray(),partBounds.max.toArray()]});
    flat.dispose();
  }
  finish() {
    const group=new THREE.Group();group.name=this.name;
    group.userData.aircraft={kind:this.name.replace('bandit-',''),version:2,forward:'+Z',units:'metres',parts:this.parts};
    for(const [role,b]of this.batches) {
      const g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));
      g.setAttribute('normal',new THREE.Float32BufferAttribute(b.n,3));
      g.setAttribute('uv',new THREE.Float32BufferAttribute(b.uv,2));
      g.setAttribute('color',new THREE.Float32BufferAttribute(b.c,3));
      g.computeBoundingBox();g.computeBoundingSphere();
      const material=this.materials[role],mesh=new THREE.Mesh(g,material);
      mesh.name=`${this.name}-${role}`;
      mesh.userData={livery:!!material.userData.banditLivery,banditMaterialKey:material.userData.banditMaterialKey,role,partNames:this.parts.filter(p=>p.role===role).map(p=>p.name)};
      mesh.castShadow=role!=='glass';mesh.receiveShadow=role!=='glass';group.add(mesh);
    }
    return group;
  }
}
