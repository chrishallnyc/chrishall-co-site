import * as THREE from 'three';
import {clipProjectedPolygon} from '../geometry/clip-polygon.js';
import {curveSegments} from './quality.js';
import {meshGeometry,TAU} from './geometry.js';

export function addSensorTurret(a) {
  const centre=[0,-.567,2.02],radius=.295,apertures=[[-.088,-.013,.113,.196],[.109,-.083,.073,.193]];
  const sphere=new THREE.SphereGeometry(radius,curveSegments(36),curveSegments(24,8));sphere.scale(1,.94,1.05);
  const flat=sphere.toNonIndexed();sphere.dispose();
  const data={front:{p:[],n:[]},rear:{p:[],n:[]}},p=flat.attributes.position,n=flat.attributes.normal;
  for(let i=0;i<p.count;i+=3) {
    const batch=data[(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))>0?'front':'rear'];
    for(let j=i;j<i+3;j++){batch.p.push(p.getX(j),p.getY(j),p.getZ(j));batch.n.push(n.getX(j),n.getY(j),n.getZ(j));}
  }
  flat.dispose();
  let front=new THREE.BufferGeometry();front.setAttribute('position',new THREE.Float32BufferAttribute(data.front.p,3));front.setAttribute('normal',new THREE.Float32BufferAttribute(data.front.n,3));
  const segments=curveSegments(28,12);
  for(const [x,y,r]of apertures) {
    const boundary=Array.from({length:segments},(_,j)=>[x+Math.cos(j/segments*TAU)*r,y+Math.sin(j/segments*TAU)*r]);
    const clipped=clipProjectedPolygon(front,boundary,{axes:[0,1]});front.dispose();front=clipped;
  }
  a.add(front,'dielectric',{position:centre,name:'sensor-turret-aperture-shell',tint:[.88,.91,.88]});
  const rear=new THREE.BufferGeometry();rear.setAttribute('position',new THREE.Float32BufferAttribute(data.rear.p,3));rear.setAttribute('normal',new THREE.Float32BufferAttribute(data.rear.n,3));
  a.add(rear,'dielectric',{position:centre,name:'sensor-turret-gimbal-shell',tint:[.88,.91,.88]});
  for(const [x,y,r,depth]of apertures) {
    const points=[],indices=[];
    for(let j=0;j<segments;j++) {
      const t=j/segments*TAU,px=x+Math.cos(t)*r,py=y+Math.sin(t)*r;
      const skinZ=Math.sqrt(Math.max(0,radius*radius-px*px-(py/.94)**2))*1.05+.003;
      points.push(px,py,skinZ,x+Math.cos(t)*r*.9,y+Math.sin(t)*r*.9,depth);
      const k=j*2,next=(j+1)%segments*2;indices.push(k,next,k+1,k+1,next,next+1);
    }
    a.add(meshGeometry(points,indices),'cavity',{position:centre,name:'sensor-optical-recess'});
    const lens=new THREE.SphereGeometry(1,segments,6,0,TAU,0,Math.PI/2);
    lens.scale(r*.9,.009,r*.9);lens.rotateX(Math.PI/2);
    a.add(lens,'glass',{position:[centre[0]+x,centre[1]+y,centre[2]+depth],name:'sensor-optical-window',tint:[.18,.31,.36]});
  }
  for(const side of [-1,1]) {
    const bearing=new THREE.CylinderGeometry(.063,.063,.026,curveSegments(20));bearing.rotateZ(Math.PI/2);
    a.add(bearing,'metal',{position:[side*.28,centre[1],centre[2]],name:'sensor-turret-trunnion',tint:[.4,.43,.43]});
  }
}
