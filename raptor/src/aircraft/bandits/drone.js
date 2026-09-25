import * as THREE from 'three';
import {Airframe,loft,wing,fin,ribbon,tubePath,meshGeometry,sampleSection,segmentedWing} from './geometry.js';
import {curveSegments,buildLevel} from './quality.js';
import {cutWindowOpenings} from './window-openings.js';
import {addSensorTurret} from './sensor-turret.js';

export const DRONE_EXTENT={span:17,length:8.8,height:4.4};

function fuselageShell(rows) {
  const shell=loft(rows,48,true,4),positions=shell.attributes.position,normals=shell.attributes.normal;
  const shoulder=(theta,z)=> {
    const [,w,h,cy]=sampleSection(rows,z),s=Math.sin(theta),c=Math.cos(theta);
    const envelope=THREE.MathUtils.smoothstep(z,-1.55,-.70)*(1-THREE.MathUtils.smoothstep(z,.20,1.20));
    // The wing fillet is part of the hull: a broad upper shoulder fades
    // smoothly into the original belly and forebody without an oval cap.
    const flare=.30*envelope*s*Math.exp(-(((c-.62)/.40)**2));
    return new THREE.Vector3(s*w+flare,cy+c*h,z);
  };
  const step=1e-4;
  for(let i=0;i<positions.count;i++) {
    const z=positions.getZ(i);
    if(z<=-1.55||z>=1.20)continue;
    const [,w,h,cy]=sampleSection(rows,z),theta=Math.atan2(positions.getX(i)/w,(positions.getY(i)-cy)/h);
    const point=shoulder(theta,z);
    const along=shoulder(theta,z+step).sub(shoulder(theta,z-step));
    const around=shoulder(theta+step,z).sub(shoulder(theta-step,z));
    const normal=along.cross(around).normalize();
    positions.setXYZ(i,point.x,point.y,point.z);normals.setXYZ(i,normal.x,normal.y,normal.z);
  }
  return shell;
}

function propellerBlade(sections) {
  const positions=[],indices=[],chord=8,ring=chord*2;
  for(const [rad,halfChord,sweep]of sections)for(let j=0;j<ring;j++) {
    const angle=j/ring*Math.PI*2,u=Math.cos(angle)*halfChord,pitch=.55-rad*.28;
    const thickness=Math.sin(angle)*(.011-rad*.005);
    positions.push(rad,sweep+u*Math.cos(pitch)-thickness*Math.sin(pitch),u*Math.sin(pitch)+thickness*Math.cos(pitch));
  }
  for(let i=0;i<sections.length-1;i++)for(let j=0;j<ring;j++) {
    const k=i*ring+j,next=i*ring+(j+1)%ring;indices.push(k,next,k+ring,next,next+ring,k+ring);
  }
  for(const row of [0,sections.length-1]) {
    const [rad,,sweep]=sections[row],centre=positions.length/3;positions.push(rad,sweep,0);
    for(let j=0;j<ring;j++){const k=row*ring+j,next=row*ring+(j+1)%ring;indices.push(...(row===0?[centre,next,k]:[centre,k,next]));}
  }
  return meshGeometry(positions,indices);
}

export function buildDrone(materials) {
  const a=new Airframe('bandit-drone',materials,DRONE_EXTENT);
  const propeller=new Airframe('bandit-drone-propeller',materials,DRONE_EXTENT);
  const rows=[[-3.85,.195,.18,.02],[-3.15,.28,.275,-.015],[-2.1,.315,.295,-.027],[-.8,.335,.315,-.025],
    [.55,.40,.35,.025],[1.66,.50,.48,.085],[2.42,.53,.59,.09],[2.96,.50,.605,.055],[3.50,.35,.45,-.04],[3.88,.15,.225,-.115],[4.055,.012,.02,-.14]];
  // Partition one continuous shell into paint and dielectric faces. The
  // coating boundary cannot z-fight because no second skin is overlaid.
  const shell=cutWindowOpenings(fuselageShell(rows),rows,[[1.36,1.85,-2.65,-1.86,0]]),flat=shell.index?shell.toNonIndexed():shell.clone();shell.dispose();
  const position=flat.getAttribute('position'),normal=flat.getAttribute('normal');
  const regions={skin:{p:[],n:[]},dielectric:{p:[],n:[]}};
  for(let i=0;i<position.count;i+=3) {
    const z=(position.getZ(i)+position.getZ(i+1)+position.getZ(i+2))/3;
    // The whole moulded nose uses one dielectric finish. Splitting its
    // equator into paint and radome made a false hard chine in the light.
    const target=regions[z>1.661?'dielectric':'skin'];
    for(let j=i;j<i+3;j++){target.p.push(position.getX(j),position.getY(j),position.getZ(j));target.n.push(normal.getX(j),normal.getY(j),normal.getZ(j));}
  }
  flat.dispose();
  for(const [role,data]of Object.entries(regions)) {
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(data.n,3));
    a.add(g,role,{name:role==='skin'?'composite-fuselage':'moulded-satcom-radome'});
  }
  for(const s of [-1,1]) {
    const side=s<0?'port':'starboard';
    a.add(segmentedWing([[.27,.15,.80,-1.21,.165],[.8,.16,.70,-1.17,.105],[3.2,.235,.46,-1.10,.056],
      [6.72,.385,.10,-1.015,.03],[8.18,.448,-.075,-.965,.014],[8.4,.463,-.20,-.945,.007]],s<0,26,{cut:.77,gap:.006}),'skin',{name:`${side}-high-aspect-ratio-wing`});
    // The Predator family has an inverted V. Root intersections disappear
    // inside the aft shell and the tips are below the fuselage centreline.
    a.add(wing([[.16,-.045,-2.56,-3.77,.055],[.52,-.30,-2.78,-3.88,.048],[1.64,-1.19,-3.30,-4.23,.024],
      [1.98,-1.445,-3.56,-4.28,.009]],s<0),'skin',{name:`${side}-inverted-v-tail`});
    a.add(ribbon([[s*.55,-.315,-3.52],[s*1.65,-1.178,-3.995],[s*1.89,-1.36,-4.068]],.009,[0,.75,-.15]),'trim',{name:`${side}-ruddervator-separation`,tint:[.80,.83,.82]});
    // Small actuator fairings follow the wing underside, without stores
    // on this reconnaissance variant.
    a.add(loft([[-.86,.024,.024],[-.62,.055,.043],[.035,.05,.045],[.2,.011,.012]],12),'skin',{position:[s*3.21,.15,0],name:`${side}-aileron-actuator-fairing`});
    a.add(new THREE.BoxGeometry(.045,.18,.82),'cavity',{position:[s*.253,-.035,-2.28],name:`${side}-engine-cooling-plenum`});
    for(const z of [-1.94,-2.07,-2.2,-2.33,-2.46,-2.59]) {
      const vane=new THREE.BoxGeometry(.067,.14,.018);vane.rotateY(s*.39);
      a.add(vane,'metal',{position:[s*.285,-.030,z],name:`${side}-engine-cooling-louvre`,tint:[.40,.425,.44]});
    }
  }
  // Downward central stabilizer, formed by rotating an airfoil fin about Z.
  const ventral=fin([[0,0,-2.84,-3.82,.035],[.65,0,-3.2,-3.89,.013]],0,0);
  ventral.rotateZ(Math.PI);
  a.add(ventral,'skin',{position:[0,-.16,0],name:'central-ventral-fin'});
  a.add(loft([[-4.34,.015,.015,.018],[-4.15,.125,.125,.018],[-3.96,.195,.195,.018],[-3.81,.197,.197,.018]],28),'metal',{name:'pusher-propeller-spinner',tint:[.5,.53,.54]});
  for(let j=0;j<2;j++) {
    // Twisted, tapered blades are batched on their own pivot so the render
    // path can spin them without moving the airframe's dark detail batch.
    const sections=[[.15,.08,.022],[.36,.115,.038],[.78,.11,.08],[1.08,.060,.126]];
    const g=propellerBlade(sections);g.rotateZ(j*Math.PI+.45);
    propeller.add(g,'trim',{name:'pusher-propeller-blade',tint:[.33,.35,.36]});
    const tip=propellerBlade([[1.08,.060,.126],[1.15,.033,.15],[1.18,.003,.16]]);tip.rotateZ(j*Math.PI+.45);
    propeller.add(tip,'dielectric',{name:'propeller-tip-mark',tint:[1.10,1.09,.92]});
  }
  // Turret collar and shell are seated into the belly. Distinct recessed
  // optical apertures are visible from ahead and below.
  a.add(loft([[1.75,.245,.045,-.405],[2.22,.235,.04,-.385]],24),'skin',{name:'sensor-turret-mount'});
  let sensor=null;
  if(buildLevel()<2) {
    const equipment=new Airframe('bandit-drone-sensor',materials,DRONE_EXTENT);addSensorTurret(equipment);
    sensor=equipment.finish();sensor.name='bandit-sensor-gimbal';
    for(const mesh of sensor.children)mesh.geometry.translate(0,.567,-2.02);
    sensor.position.set(0,-.567,2.02);
  } else addSensorTurret(a);
  a.add(fin([[0,0,.58,.25,.017],[.32,0,.43,.29,.008]],0,.38),'dielectric',{name:'dorsal-radio-aerial'});
  a.add(fin([[0,0,-1.08,-1.25,.013],[.43,0,-1.06,-1.21,.008]],0,.3),'dielectric',{name:'aft-antenna-mast'});
  a.add(tubePath([[0,.73,-1.25],[0,.73,-.94]],.014,6),'dielectric',{name:'antenna-crossbar'});
  a.add(tubePath([[0,.16,3.99],[0,.20,4.27],[0,.20,4.47]],.009,6),'metal',{name:'nose-pitot-probe',tint:[.51,.55,.55]});
  const group=a.finish(),rotor=propeller.finish();rotor.name='bandit-propeller';rotor.position.set(0,.018,-4.045);group.add(rotor);if(sensor)group.add(sensor);
  group.userData.aircraft.reference='MQ-1-inspired reconnaissance UAV';
  group.userData.aircraft.rotor={axis:'+Z',position:rotor.position.toArray(),parts:rotor.userData.aircraft.parts};
  return group;
}
