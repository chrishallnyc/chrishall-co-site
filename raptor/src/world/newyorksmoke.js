// Restrained, non-interactive aftermath haze for Harbor Watch. No impact,
// fire, destruction animation or damage is simulated at the historic site.
import * as THREE from 'three';
import { Fn, attribute, output, positionWorld, vec4 } from 'three/tsl';
import { softDiscTexture } from '../engine/sprites.js';
import { newYorkPoint } from './newyork.js';
const COUNT=24;
export class NewYorkAftermath {
  constructor({aerial=null}={}) {
    const geometry=new THREE.PlaneGeometry(1,1);
    this.alpha=new THREE.InstancedBufferAttribute(new Float32Array(COUNT),1);
    geometry.setAttribute('plumeAlpha',this.alpha);
    const material=new THREE.MeshBasicNodeMaterial({color:0x62686b,map:softDiscTexture(),transparent:true,depthWrite:false,opacity:.34});
    material.opacityNode=attribute('plumeAlpha').mul(.34);
    if(aerial){
      material.fog=false;
      material.outputNode=Fn(()=>vec4(aerial.composite?aerial.composite(positionWorld,output.rgb):output.rgb.mul(aerial.trans(positionWorld)).add(aerial.ins(positionWorld).mul(aerial.uSunI)),output.a))();
    }
    this.mesh=new THREE.InstancedMesh(geometry,material,COUNT);
    this.mesh.name='Harbor Watch aftermath haze';this.mesh.frustumCulled=false;
    this.group=new THREE.Group();this.group.add(this.mesh);
    this.origin=newYorkPoint(40.7116,-74.0134);this.matrix=new THREE.Matrix4();this.scale=new THREE.Vector3();
  }
  update(camera,time=0){
    for(let i=0;i<COUNT;i++){
      const t=(i/COUNT+time/190)%1;
      const size=120+t*380;
      this.matrix.makeRotationFromQuaternion(camera.quaternion);
      this.matrix.scale(this.scale.set(size,size,1));
      this.matrix.setPosition(this.origin.x+t*650+Math.sin(i*2.399+time*.025)*35,45+t*710,this.origin.z-t*380+Math.cos(i*2.399+time*.02)*35);
      this.mesh.setMatrixAt(i,this.matrix);
      this.alpha.array[i]=Math.sin(Math.PI*t)**.7;
    }
    this.mesh.instanceMatrix.needsUpdate=true;this.alpha.needsUpdate=true;
  }
  dispose(){this.mesh.geometry.dispose();this.mesh.material.dispose();this.group.removeFromParent();}
}
