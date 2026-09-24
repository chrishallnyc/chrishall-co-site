import * as THREE from 'three';
import {Airframe,TAU,loft,wing,fin,ribbon,tubePath,meshGeometry,sampleSection,airfoilHeight} from './geometry.js';
import {curveSegments} from './quality.js';

export const FIGHTER_EXTENT={span:12,length:18.5,height:7};

// The nacelle changes from a rounded rectangular inlet to the circular hot
// section. Its open front is deliberately separate from the narrow spine.
function engineShell(rows,segments=32) {
  segments=curveSegments(segments);
  const p=[],ix=[];
  for(const [z,w,top,bottom,exponent=1]of rows)for(let j=0;j<segments;j++) {
    const t=j/segments*TAU,s=Math.sin(t),c=Math.cos(t),cy=(top+bottom)/2,h=(top-bottom)/2;
    p.push(Math.sign(s)*Math.abs(s)**exponent*w,cy+Math.sign(c)*Math.abs(c)**exponent*h,z);
  }
  for(let i=0;i<rows.length-1;i++)for(let j=0;j<segments;j++) {
    const a=i*segments+j,b=i*segments+(j+1)%segments;ix.push(a,a+segments,b,b,a+segments,b+segments);
  }
  return meshGeometry(p,ix);
}

function nozzle(a,x) {
  const cy=-.39,r=.59;
  a.add(loft([[-8.24,r*.89,r*.89,cy],[-7.38,r*1.07,r*1.07,cy]],32,false,1),'cavity',{position:[x,0,0],name:'exhaust-dark-gaps'});
  a.add(loft([[-7.52,.638,.638,cy],[-7.28,.643,.643,cy],[-7.12,.613,.613,cy]],32,false,2),'metal',{position:[x,0,0],name:'nozzle-actuator-collar',tint:[.62,.64,.63]});
  const disk=new THREE.CircleGeometry(.53,curveSegments(32));disk.rotateY(Math.PI);
  a.add(disk,'cavity',{position:[x,cy,-7.6],name:'recessed-exhaust-throat'});
  a.add(loft([[-8.245,.514,.514,cy],[-8.02,.488,.488,cy],[-7.72,.45,.45,cy]],32,false,2),'metal',{position:[x,0,0],name:'exhaust-ceramic-liner',tint:[.24,.235,.22]});
  const holder=new THREE.TorusGeometry(.32,.016,5,curveSegments(32));
  a.add(holder,'metal',{position:[x,cy,-7.93],name:'recessed-flameholder-ring',tint:[.32,.30,.26]});
  for(let j=0;j<12;j++) {
    const t=j/12*TAU,p=[];
    for(const [radius,angle,z]of [[.07,t,-7.91],[.42,t+.09,-7.86],[.42,t+.2,-7.85],[.07,t+.15,-7.91]])p.push(x+Math.sin(angle)*radius,cy+Math.cos(angle)*radius,z);
    a.add(meshGeometry(p,[0,1,2,0,2,3]),'metal',{name:'recessed-exhaust-stator',tint:[.23,.235,.24]});
  }
  for(let j=0;j<18;j++) {
    const t0=(j+.055)/18*TAU,t1=(j+.94)/18*TAU;
    const v=(t,rr,z)=>[x+Math.sin(t)*rr,cy+Math.cos(t)*rr,z];
    const p=[v(t0,r*.89,-8.25),v(t1,r*.89,-8.25),v(t1,r*1.07,-7.43),v(t0,r*1.07,-7.43)];
    a.add(meshGeometry(p.flat(),[0,3,1,1,3,2]),'metal',{name:'overlapping-exhaust-petal',tint:j%3===0?[.47,.46,.42]:[.61,.62,.60]});
    const mid=(t0+t1)/2;
    a.add(tubePath([v(mid,r*1.078,-7.5),v(mid,r*1.095,-7.18)],.018,5),'metal',{name:'nozzle-actuator',tint:[.5,.49,.43]});
  }
}

function cockpit(a,m) {
  const rows=[[2.13,.055,.025,.6],[2.43,.33,.14,.65],[2.86,.425,.38,.68],[3.43,.44,.58,.68],
    [3.91,.41,.57,.68],[4.22,.345,.45,.65],[4.65,.21,.24,.57],[4.96,.035,.015,.49]];
  a.add(loft(rows,36,true,4),'glass',{name:'canopy-glazing'});
  a.add(loft([[2.1,.08,.027,.61],[2.45,.365,.04,.665],[3.4,.465,.045,.675],[4.23,.355,.039,.65],[4.94,.04,.022,.505]],28,true,3),'trim',{name:'canopy-perimeter-seal',tint:[.65,.67,.65]});
  a.add(loft([[2.35,.29,.09,.66],[2.8,.35,.11,.68],[3.85,.345,.105,.675],[4.52,.145,.06,.60]],24),'cavity',{name:'cockpit-coaming'});
  const seat=new THREE.BoxGeometry(.35,.32,.25);seat.rotateX(-.16);
  a.add(seat,'cavity',{position:[0,.79,2.98],name:'ejection-seat-headrest'});
  const seatBack=new THREE.BoxGeometry(.39,.33,.12);seatBack.rotateX(-.16);
  a.add(seatBack,'trim',{position:[0,.81,3.055],name:'ejection-seat-cushion',tint:[.35,.38,.31]});
  const torso=new THREE.SphereGeometry(1,curveSegments(16),curveSegments(10,4));torso.scale(.16,.175,.125);
  a.add(torso,'trim',{position:[0,.85,3.26],name:'pilot-flight-suit',tint:[.69,.78,.57]});
  for(const s of [-1,1]) {
    a.add(tubePath([[s*.105,.985,3.23],[s*.082,.893,3.39],[s*.13,.79,3.30]],.018,5),'dielectric',{name:'pilot-shoulder-harness',tint:[.83,.79,.64]});
    a.add(tubePath([[s*.14,.91,3.25],[s*.19,.81,3.46],[s*.10,.765,3.59]],.045,6),'trim',{name:'pilot-flight-suit-arm',tint:[.67,.74,.53]});
    a.add(tubePath([[s*.35,.706,2.48],[s*.40,.723,3.64],[s*.27,.693,4.44]],.022,6),'trim',{name:'cockpit-canopy-rail',tint:[.63,.67,.65]});
  }
  a.add(new THREE.BoxGeometry(.51,.14,.29),'cavity',{position:[0,.765,3.91],name:'cockpit-instrument-coaming'});
  a.add(new THREE.BoxGeometry(.32,.017,.14),'trim',{position:[0,.849,3.94],name:'cockpit-hud-projector',tint:[.4,.43,.42]});
  const hud=meshGeometry([-.15,.855,4.02,.15,.855,4.02,.135,1.015,4.095,-.135,1.015,4.095],[0,1,2,0,2,3]);
  a.add(hud,'glass',{name:'cockpit-hud-combiner',tint:[.69,1.04,.93]});
  const helmet=new THREE.SphereGeometry(.145,curveSegments(16),curveSegments(10,4));helmet.scale(1,1.08,.97);
  a.add(helmet,'dielectric',{position:[0,1.045,3.27],name:'pilot-helmet',tint:[.71,.74,.73]});
  const visor=new THREE.SphereGeometry(.149,12,6,0,Math.PI,Math.PI*.31,Math.PI*.38);
  a.add(visor,'cavity',{position:[0,1.045,3.27],name:'pilot-visor'});
  a.add(tubePath([[.045,1.005,3.398],[.095,.958,3.42],[.153,.872,3.402],[.09,.81,3.345]],.017,6),'trim',{name:'pilot-oxygen-hose',tint:[.28,.34,.29]});
  const z=4.20,[,w,h,cy]=sampleSection(rows,z),arch=[];
  for(let i=0;i<=20;i++){const t=-Math.PI/2+i/20*Math.PI;arch.push([Math.sin(t)*(w+.014),cy+Math.cos(t)*(h+.014),z]);}
  a.add(tubePath(arch,.021,6),'trim',{name:'windshield-frame',tint:[.84,.86,.85]});
  const aftArch=[];
  const [,aftW,aftH,aftY]=sampleSection(rows,2.56);
  for(let i=0;i<=14;i++){const t=-Math.PI/2+i/14*Math.PI;aftArch.push([Math.sin(t)*(aftW+.011),aftY+Math.cos(t)*(aftH+.011),2.56]);}
  a.add(tubePath(aftArch,.016,5),'trim',{name:'cockpit-aft-canopy-frame',tint:[.76,.8,.78]});
  // A small IRST fairing ahead and to starboard of the windscreen.
  const sensor=new THREE.SphereGeometry(.142,curveSegments(18),curveSegments(10,4));sensor.scale(1,.92,1.32);
  a.add(sensor,'metal',{position:[.27,.435,5.02],name:'irst-housing',tint:[.64,.68,.65]});
  const lens=new THREE.SphereGeometry(.127,12,8,0,TAU,0,Math.PI*.46);lens.rotateX(Math.PI/2);
  a.add(lens,'glass',{position:[.27,.43,5.13],name:'irst-lens',tint:[.35,.57,.60]});
  // A modest coated canopy still shows the seat and helmet at inspection
  // distance, while its specular layer remains readable in a fast pass.
  m.glass.transparent=true;m.glass.opacity=.49;m.glass.depthWrite=false;
}

export function buildFighter(materials) {
  const a=new Airframe('bandit-fighter',materials,FIGHTER_EXTENT);
  a.add(loft([[-7.42,.18,.16,.07],[-6.15,.47,.30,.12],[-4.4,.64,.43,.16],[-2.2,.70,.47,.15],
    [.2,.72,.50,.12],[2.25,.68,.48,.10],[3.98,.625,.46,.04],[5.38,.55,.35,-.045],[6.01,.46,.285,-.105]],40,true,4),'skin',{name:'narrow-central-spine-and-forebody'});
  a.add(loft([[6.008,.46,.285,-.105],[6.71,.34,.245,-.15],[7.45,.20,.16,-.195],[8.13,.075,.073,-.21],[8.43,.01,.015,-.215]],36,true,4),'dielectric',{name:'dielectric-radome'});
  a.add(loft([[8.32,.021,.021,-.215],[8.85,.009,.009,-.215],[9.03,.002,.002,-.215]],8),'metal',{name:'nose-air-data-probe'});
  for(const s of [-1,1]) {
    const side=s<0?'port':'starboard',x=s*1.18;
    a.add(wing([[.48,.14,4.33,-5.79,.265],[.95,.13,3.98,-5.17,.23],[1.52,.10,2.25,-4.87,.17],
      [2.13,.08,.99,-4.70,.13],[2.68,.08,.25,-4.79,.105],[4.25,.1,-1.47,-4.94,.07],[5.64,.13,-3.03,-5.06,.022]],s<0,22),'skin',{name:`${side}-wing-and-root-extension`});
    const engineRows=[[-7.37,.61,.22,-1.00,1],[-6.6,.64,.29,-1.07,1],[-4.8,.72,.32,-1.13,1],[-2.5,.75,.31,-1.17,.86],
      [-.4,.73,.27,-1.17,.62],[1.08,.68,.13,-1.16,.39],[2.44,.62,.015,-1.10,.27]];
    a.add(engineShell(engineRows),'skin',{position:[x,0,0],name:`${side}-integrated-engine-tunnel`});
    a.add(engineShell([[2.31,.565,-.04,-1.045,.27],[2.485,.578,-.024,-1.068,.27],[2.50,.62,.015,-1.10,.27],[2.39,.64,.034,-1.12,.27]]),'metal',{position:[x,0,0],name:`${side}-inlet-lip`,tint:[.70,.74,.73]});
    a.add(engineShell([[1.12,.48,-.085,-1.04,.5],[1.83,.53,-.056,-1.041,.34],[2.34,.565,-.04,-1.045,.27]]),'cavity',{position:[x,0,0],name:`${side}-intake-duct`});
    const back=new THREE.PlaneGeometry(1.01,.97);a.add(back,'cavity',{position:[x,-.57,1.12],name:`${side}-inlet-shadow-baffle`});
    // Splitter plate lies above the opening, with its boundary layer gap
    // visible as a fine shadow beneath the forebody shoulder.
    const splitter=new THREE.BoxGeometry(1.23,.058,1.01);
    a.add(splitter,'skin',{position:[x,.064,2.02],name:`${side}-intake-splitter`});
    a.add(wing([[1.05,-.04,-5.23,-7.63,.07],[2.23,-.07,-5.77,-8.14,.08],[3.72,-.13,-6.59,-8.39,.036],[4.16,-.15,-7.11,-8.30,.012]],s<0),'skin',{name:`${side}-all-moving-stabilator`});
    const finRows=[[0,0,-3.31,-6.95,.115],[.78,0,-3.95,-7.13,.11],[2.56,0,-5.24,-7.08,.049],[2.81,0,-5.52,-6.99,.015]];
    a.add(fin(finRows,s*1.35,.3,s*.034),'skin',{name:`${side}-vertical-tail`});
    const rudder=finRows.map(([span,,le,te,h])=>[s*(1.35+span*.034+airfoilHeight(.74,h)+.008),.3+span,le+(te-le)*.74]);
    a.add(ribbon(rudder,.014,[s,0,0]),'trim',{name:`${side}-rudder-hinge`,tint:[.65,.68,.68]});
    a.add(loft([[-5.18,.035,.035],[-3.14,.045,.045],[-2.86,.02,.02]],10),'metal',{position:[s*5.66,.135,0],name:`${side}-wingtip-rail`,tint:[.67,.70,.69]});
    a.add(new THREE.SphereGeometry(.035,10,6),'light',{position:[s*5.68,.15,-3.25],name:`${side}-navigation-light`,tint:s<0?[1,.1,.07]:[.14,.83,.29]});
    // Flush leading-edge slat and trailing-edge control separations.
    a.add(ribbon([[s*2.71,.163,-.10],[s*4.28,.162,-1.82],[s*5.57,.164,-3.26]],.011),'trim',{name:`${side}-slat-joint`,tint:[.9,.94,.94]});
    nozzle(a,x);
    for(const xP of [2.5,3.65]) {
      a.add(fin([[0,0,-1.5,-2.83,.04],[.31,0,-1.72,-2.68,.027]],s*xP,-.28),'skin',{name:`${side}-stores-pylon`});
    }
  }
  cockpit(a,materials);
  a.add(fin([[0,0,-.53,-1.13,.025],[.36,0,-.75,-1.06,.008]],0,.63),'dielectric',{name:'dorsal-radio-aerial'});
  a.add(fin([[0,0,5.53,5.26,.012],[.12,0,5.42,5.26,.004]],0,-.46),'metal',{name:'ventral-air-data-vane'});
  a.add(loft([[-7.72,.052,.044,.075],[-6.95,.21,.11,.1],[-5.36,.21,.15,.15]],20),'skin',{name:'tail-centre-fairing'});
  const group=a.finish();group.userData.aircraft.reference='MiG-29-inspired generic twin-engine fighter';return group;
}
