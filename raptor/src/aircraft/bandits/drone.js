import * as THREE from 'three';
import {Airframe,loft,wing,fin,ribbon,tubePath,meshGeometry,sampleSection} from './geometry.js';
import {curveSegments} from './quality.js';
import {addSensorTurret} from './sensor-turret.js';

export const DRONE_EXTENT={span:17,length:8.8,height:4.4};

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
    [.55,.40,.35,.025],[1.66,.50,.49,.10],[2.55,.535,.63,.12],[3.14,.47,.62,.08],[3.63,.31,.415,-.04],[3.94,.12,.17,-.115],[4.055,.012,.02,-.14]];
  // Partition one continuous shell into paint and dielectric faces. The
  // coating boundary cannot z-fight because no second skin is overlaid.
  const shell=loft(rows,40,true,4),flat=shell.toNonIndexed();shell.dispose();
  const position=flat.getAttribute('position'),normal=flat.getAttribute('normal');
  const regions={skin:{p:[],n:[]},dielectric:{p:[],n:[]}};
  for(let i=0;i<position.count;i+=3) {
    const z=(position.getZ(i)+position.getZ(i+1)+position.getZ(i+2))/3;
    const y=(position.getY(i)+position.getY(i+1)+position.getY(i+2))/3;
    const [, , ,cy]=sampleSection(rows,z);
    // The equator coincides with a ring vertex at all quality levels.
    // A cut through a cell would alternate material on its two triangles.
    const target=regions[z>1.661&&y>cy?'dielectric':'skin'];
    for(let j=i;j<i+3;j++){target.p.push(position.getX(j),position.getY(j),position.getZ(j));target.n.push(normal.getX(j),normal.getY(j),normal.getZ(j));}
  }
  flat.dispose();
  for(const [role,data]of Object.entries(regions)) {
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(data.n,3));
    a.add(g,role,{name:role==='skin'?'composite-fuselage':'upper-satcom-radome-panel'});
  }
  for(const s of [-1,1]) {
    const side=s<0?'port':'starboard';
    a.add(wing([[.27,.12,.74,-1.19,.10],[.8,.14,.68,-1.16,.085],[3.2,.235,.46,-1.10,.056],
      [6.72,.385,.10,-1.015,.03],[8.18,.448,-.075,-.965,.014],[8.4,.463,-.20,-.945,.007]],s<0,22),'skin',{name:`${side}-high-aspect-ratio-wing`});
    // The Predator family has an inverted V. Root intersections disappear
    // inside the aft shell and the tips are below the fuselage centreline.
    a.add(wing([[.16,-.045,-2.56,-3.77,.055],[.52,-.30,-2.78,-3.88,.048],[1.64,-1.19,-3.30,-4.23,.024],
      [1.98,-1.445,-3.56,-4.28,.009]],s<0),'skin',{name:`${side}-inverted-v-tail`});
    a.add(ribbon([[s*.55,-.315,-3.52],[s*1.65,-1.178,-3.995],[s*1.89,-1.36,-4.068]],.009,[0,.75,-.15]),'trim',{name:`${side}-ruddervator-separation`,tint:[.80,.83,.82]});
    // Small actuator fairings follow the wing underside, without stores
    // on this reconnaissance variant.
    a.add(loft([[-.86,.024,.024],[-.62,.055,.043],[.035,.05,.045],[.2,.011,.012]],12),'skin',{position:[s*3.21,.15,0],name:`${side}-aileron-actuator-fairing`});
    for(const z of [-1.86,-2.12,-2.38]) {
      a.add(ribbon([[s*.302,.015,z],[s*.317,-.13,z-.035]],.034,[s,0,0]),'cavity',{name:`${side}-engine-cooling-vent`});
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
  addSensorTurret(a);
  a.add(fin([[0,0,.58,.25,.017],[.32,0,.43,.29,.008]],0,.38),'dielectric',{name:'dorsal-radio-aerial'});
  a.add(fin([[0,0,-1.08,-1.25,.013],[.43,0,-1.06,-1.21,.008]],0,.3),'dielectric',{name:'aft-antenna-mast'});
  a.add(tubePath([[0,.73,-1.25],[0,.73,-.94]],.014,6),'dielectric',{name:'antenna-crossbar'});
  a.add(tubePath([[0,.16,3.99],[0,.20,4.27],[0,.20,4.47]],.009,6),'metal',{name:'nose-pitot-probe',tint:[.51,.55,.55]});
  const group=a.finish(),rotor=propeller.finish();rotor.name='bandit-propeller';rotor.position.set(0,.018,-4.045);group.add(rotor);
  group.userData.aircraft.reference='MQ-1-inspired reconnaissance UAV';
  group.userData.aircraft.rotor={axis:'+Z',position:rotor.position.toArray(),parts:rotor.userData.aircraft.parts};
  return group;
}
