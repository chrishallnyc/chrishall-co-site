import * as THREE from 'three';
import {Airframe,TAU,loft,wing,fin,ribbon,tubePath,meshGeometry,sampleSection,airfoilHeight,segmentedWing} from './geometry.js';
import {curveSegments,curveSubdivisions,buildLevel} from './quality.js';

export const FIGHTER_EXTENT={span:12,length:18.5,height:7};

// The nacelle changes from a rounded rectangular inlet to the circular hot
// section. Its open front is deliberately separate from the narrow spine.
function engineShell(rows,segments=32) {
  segments=curveSegments(segments);
  const p=[],ix=[],smooth=[];
  const steps=curveSubdivisions(5);
  for(let i=0;i<rows.length-1;i++)for(let j=0;j<steps;j++) {
    const t=j/steps,t2=t*t,t3=t2*t;
    const row=[THREE.MathUtils.lerp(rows[i][0],rows[i+1][0],t)];
    for(let k=1;k<6;k++) {
      const b=rows[i][k]??1,c=rows[i+1][k]??1,delta=c-b;
      const limit=v=>delta*v<=0?0:Math.sign(delta)*Math.min(Math.abs(v),Math.abs(delta)*2);
      const m0=limit((c-(rows[Math.max(0,i-1)][k]??1))*.5),m1=limit(((rows[Math.min(rows.length-1,i+2)][k]??1)-b)*.5);
      row.push((2*t3-3*t2+1)*b+(t3-2*t2+t)*m0+(-2*t3+3*t2)*c+(t3-t2)*m1);
    }
    smooth.push(row);
  }
  smooth.push(rows.at(-1));
  for(const [z,w,top,bottom,exponent=1]of smooth)for(let j=0;j<segments;j++) {
    const t=j/segments*TAU,s=Math.sin(t),c=Math.cos(t),cy=(top+bottom)/2,h=(top-bottom)/2;
    p.push(Math.sign(s)*Math.abs(s)**exponent*w,cy+Math.sign(c)*Math.abs(c)**exponent*h,z);
  }
  for(let i=0;i<smooth.length-1;i++)for(let j=0;j<segments;j++) {
    const a=i*segments+j,b=i*segments+(j+1)%segments;ix.push(a,a+segments,b,b,a+segments,b+segments);
  }
  return meshGeometry(p,ix);
}

function nozzle(a,x) {
  const cy=-.39,r=.59;
  if(buildLevel()===2) {
    a.add(loft([[-8.27,.53,.53,cy],[-7.42,.64,.64,cy]],24,false,1),'metal',{position:[x,0,0],name:'distant-nozzle-shell',tint:[.43,.42,.39]});
    a.add(loft([[-8.27,.51,.51,cy],[-7.3,.40,.40,cy]],20,false,1),'cavity',{position:[x,0,0],name:'distant-nozzle-liner'});
    const disk=new THREE.CircleGeometry(.40,curveSegments(24));disk.rotateY(Math.PI);
    a.add(disk,'cavity',{position:[x,cy,-7.3],name:'distant-nozzle-throat'});return;
  }
  a.add(loft([[-8.26,.532,.532,cy],[-7.9,.554,.554,cy],[-7.42,.59,.59,cy],[-7.06,.61,.61,cy]],40,false,2),'cavity',{position:[x,0,0],name:'exhaust-dark-gaps'});
  a.add(loft([[-7.49,.648,.648,cy],[-7.30,.655,.655,cy],[-7.15,.622,.622,cy],[-6.99,.62,.62,cy]],40,false,2),'metal',{position:[x,0,0],name:'nozzle-actuator-collar',tint:[.49,.46,.41]});
  const disk=new THREE.CircleGeometry(.40,curveSegments(36));disk.rotateY(Math.PI);
  a.add(disk,'cavity',{position:[x,cy,-6.96],name:'recessed-exhaust-throat'});
  a.add(loft([[-8.26,.511,.511,cy],[-8.02,.487,.487,cy],[-7.59,.46,.46,cy],[-7.1,.397,.397,cy]],40,false,3),'metal',{position:[x,0,0],name:'exhaust-ceramic-liner',tint:[.185,.19,.20]});
  for(const [radius,z]of [[.365,-7.19],[.283,-7.15]]) {
    const ring=new THREE.TorusGeometry(radius,.013,5,curveSegments(32));
    a.add(ring,'metal',{position:[x,cy,z],name:'recessed-flameholder-ring',tint:[.25,.225,.19]});
  }
  for(let j=0;j<7;j++) {
    const t=j/7*TAU;
    a.add(tubePath([[x+Math.sin(t)*.14,cy+Math.cos(t)*.14,-7.10],[x+Math.sin(t)*.39,cy+Math.cos(t)*.39,-7.19]],.010,4),'metal',{name:'recessed-exhaust-stator',tint:[.18,.185,.185]});
  }
  for(let j=0;j<18;j++) {
    const start=(j-.075)/18*TAU,end=(j+1.02)/18*TAU;
    const sections=[[-8.27,.523],[-8.10,.551],[-7.72,.607],[-7.42,.638]],points=[],indices=[];
    // Closed overlapping petals with a concave panel and a folded rim.
    for(let face=0;face<2;face++)for(const [z,radius]of sections)for(let k=0;k<=4;k++) {
      const u=k/4,t=start+(end-start)*u,fold=Math.sin(u*Math.PI)*.008;
      const rr=radius+fold+(face?-.014:0);
      points.push(x+Math.sin(t)*rr,cy+Math.cos(t)*rr,z);
    }
    const row=5,layer=sections.length*row;
    for(let face=0;face<2;face++)for(let i=0;i<sections.length-1;i++)for(let k=0;k<4;k++) {
      const n=face*layer+i*row+k,quad=[n,n+row,n+1,n+1,n+row,n+row+1];
      for(let q=0;q<quad.length;q+=3)indices.push(...(face?quad.slice(q,q+3).reverse():quad.slice(q,q+3)));
    }
    const connect=(a0,b0)=>indices.push(a0,b0,a0+layer,b0,b0+layer,a0+layer);
    for(let i=0;i<sections.length-1;i++){connect(i*row,(i+1)*row);connect((i+1)*row+4,i*row+4);}
    for(let k=0;k<4;k++){connect(k+1,k);connect(layer-5+k,layer-4+k);}
    const petal=meshGeometry(points,indices),heat=[],variation=.94+(j%3)*.055;
    for(let k=0;k<points.length;k+=3) {
      const u=THREE.MathUtils.clamp((points[k+2]+8.27)/.85,0,1);
      const a=u<.48?[.32,.345,.40]:[.43,.355,.285],b=u<.48?[.43,.355,.285]:[.63,.60,.52],t=u<.48?u/.48:(u-.48)/.52;
      for(let channel=0;channel<3;channel++)heat.push(THREE.MathUtils.lerp(a[channel],b[channel],t)*variation);
    }
    petal.setAttribute('color',new THREE.Float32BufferAttribute(heat,3));
    a.add(petal,'metal',{name:'overlapping-exhaust-petal'});
    const t=(start+end)/2,v=(rr,z)=>[x+Math.sin(t)*rr,cy+Math.cos(t)*rr,z];
    a.add(tubePath([v(.645,-7.62),v(.674,-7.29),v(.646,-7.12)],.017,5),'metal',{name:'nozzle-actuator',tint:[.46,.435,.36]});
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
  a.add(seatBack,'crew',{position:[0,.81,3.055],name:'ejection-seat-cushion',tint:[.030,.038,.029]});
  const torso=new THREE.SphereGeometry(1,curveSegments(16),curveSegments(10,4));torso.scale(.16,.175,.125);
  // Vertex values are linear reflectance: muted olive cloth stays below
  // the helmet and harness highlights in full daylight through the canopy.
  a.add(torso,'crew',{position:[0,.85,3.26],name:'pilot-flight-suit',tint:[.070,.084,.061]});
  for(const s of [-1,1]) {
    a.add(tubePath([[s*.105,.985,3.23],[s*.082,.893,3.39],[s*.13,.79,3.30]],.018,5),'crew',{name:'pilot-shoulder-harness',tint:[.16,.155,.13]});
    a.add(tubePath([[s*.14,.91,3.25],[s*.19,.81,3.46],[s*.10,.765,3.59]],.045,6),'crew',{name:'pilot-flight-suit-arm',tint:[.059,.071,.051]});
    a.add(tubePath([[s*.35,.706,2.48],[s*.40,.723,3.64],[s*.27,.693,4.44]],.022,6),'trim',{name:'cockpit-canopy-rail',tint:[.63,.67,.65]});
  }
  a.add(new THREE.BoxGeometry(.51,.14,.29),'cavity',{position:[0,.765,3.91],name:'cockpit-instrument-coaming'});
  a.add(new THREE.BoxGeometry(.32,.017,.14),'trim',{position:[0,.849,3.94],name:'cockpit-hud-projector',tint:[.4,.43,.42]});
  const hud=meshGeometry([-.15,.855,4.02,.15,.855,4.02,.135,1.015,4.095,-.135,1.015,4.095],[0,1,2,0,2,3]);
  a.add(hud,'glass',{name:'cockpit-hud-combiner',tint:[.69,1.04,.93]});
  const helmet=new THREE.SphereGeometry(.145,curveSegments(16),curveSegments(10,4));helmet.scale(1,1.08,.97);
  a.add(helmet,'crew',{position:[0,1.045,3.27],name:'pilot-helmet',tint:[.22,.235,.22]});
  const visor=new THREE.SphereGeometry(.149,12,6,0,Math.PI,Math.PI*.31,Math.PI*.38);
  a.add(visor,'cavity',{position:[0,1.045,3.27],name:'pilot-visor'});
  const mask=new THREE.SphereGeometry(1,12,8);mask.scale(.065,.055,.033);
  a.add(mask,'trim',{position:[0,1.006,3.411],name:'pilot-oxygen-mask',tint:[.56,.61,.52]});
  a.add(tubePath([[.045,1.005,3.398],[.095,.958,3.42],[.153,.872,3.402],[.09,.81,3.345]],.017,6),'trim',{name:'pilot-oxygen-hose',tint:[.28,.34,.29]});
  const z=4.20,[,w,h,cy]=sampleSection(rows,z),arch=[];
  for(let i=0;i<=20;i++){const t=-Math.PI/2+i/20*Math.PI;arch.push([Math.sin(t)*(w+.014),cy+Math.cos(t)*(h+.014),z]);}
  a.add(tubePath(arch,.023,6),'skin',{name:'windshield-frame',tint:[.91,.94,.94]});
  const innerArch=[];
  for(let i=0;i<=20;i++){const t=-Math.PI/2+i/20*Math.PI;innerArch.push([Math.sin(t)*(w+.002),cy+Math.cos(t)*(h+.002),z-.014]);}
  a.add(tubePath(innerArch,.011,5),'trim',{name:'windshield-inner-frame-gasket',tint:[.43,.46,.43]});
  const aftArch=[];
  const [,aftW,aftH,aftY]=sampleSection(rows,2.56);
  for(let i=0;i<=14;i++){const t=-Math.PI/2+i/14*Math.PI;aftArch.push([Math.sin(t)*(aftW+.011),aftY+Math.cos(t)*(aftH+.011),2.56]);}
  a.add(tubePath(aftArch,.017,5),'skin',{name:'cockpit-aft-canopy-frame',tint:[.88,.92,.90]});
  // A small IRST fairing ahead and to starboard of the windscreen.
  const sensor=new THREE.SphereGeometry(.142,curveSegments(18),curveSegments(10,4));sensor.scale(1,.92,1.32);
  a.add(sensor,'metal',{position:[.27,.435,5.02],name:'irst-housing',tint:[.64,.68,.65]});
  const lens=new THREE.SphereGeometry(.127,12,8,0,TAU,0,Math.PI*.46);lens.rotateX(Math.PI/2);
  a.add(lens,'glass',{position:[.27,.43,5.13],name:'irst-lens',tint:[.35,.57,.60]});
  // A modest coated canopy still shows the seat and helmet at inspection
  // distance, while its specular layer remains readable in a fast pass.
  m.glass.color.setHex(0x708c87);m.glass.roughness=.045;m.glass.clearcoat=.72;m.glass.envMapIntensity=.78;m.glass.iridescence=.055;m.glass.transparent=true;m.glass.opacity=.34;m.glass.depthWrite=false;
}

export function buildFighter(materials) {
  const a=new Airframe('bandit-fighter',materials,FIGHTER_EXTENT);
  a.add(loft([[-7.42,.18,.16,.07],[-6.15,.47,.30,.12],[-4.4,.64,.43,.16],[-2.2,.70,.47,.15],
    [.2,.72,.50,.12],[2.25,.68,.48,.10],[3.98,.625,.46,.04],[5.38,.55,.35,-.045],[6.01,.46,.285,-.105]],40,true,4),'skin',{name:'narrow-central-spine-and-forebody'});
  a.add(loft([[6.008,.46,.285,-.105],[6.71,.34,.245,-.15],[7.45,.20,.16,-.195],[8.13,.075,.073,-.21],[8.43,.01,.015,-.215]],36,true,4),'dielectric',{name:'dielectric-radome'});
  a.add(loft([[8.32,.021,.021,-.215],[8.85,.009,.009,-.215],[9.03,.002,.002,-.215]],8),'metal',{name:'nose-air-data-probe'});
  for(const s of [-1,1]) {
    const side=s<0?'port':'starboard',x=s*1.18;
    a.add(segmentedWing([[.48,.22,4.33,-5.79,.355],[.95,.27,3.98,-5.17,.335],[1.52,.25,2.25,-4.87,.28],
      [2.13,.15,.99,-4.70,.18],[2.68,.095,.25,-4.79,.115],[4.25,.1,-1.47,-4.94,.07],[5.64,.13,-3.03,-5.06,.022]],s<0,26,{cut:.78,gap:.003}),'skin',{name:`${side}-wing-and-root-extension`});
    // The upper shoulders belong to the engine shell itself. A second
    // closed fairing would leave visible ovals and intrude into the nozzle.
    const engineRows=[[-7.37,.61,.22,-1.00,1],[-6.6,.64,.39,-1.07,1],[-4.8,.72,.51,-1.13,1],[-2.5,.75,.54,-1.17,.86],
      [-.4,.73,.46,-1.17,.62],[1.08,.68,.245,-1.16,.39],[2.44,.62,.015,-1.10,.27]];
    a.add(engineShell(engineRows),'skin',{position:[x,0,0],name:`${side}-integrated-engine-tunnel`});

    a.add(engineShell([[2.31,.565,-.04,-1.045,.27],[2.485,.578,-.024,-1.068,.27],[2.50,.62,.015,-1.10,.27],[2.39,.64,.034,-1.12,.27]]),'metal',{position:[x,0,0],name:`${side}-inlet-lip`,tint:[.70,.74,.73]});
    const duct=engineShell([[.67,.43,-.145,-1.015,.56],[1.46,.49,-.085,-1.04,.40],[2.34,.565,-.04,-1.045,.27]]),ductColors=[];
    for(let i=0;i<duct.attributes.position.count;i++) {
      const depth=THREE.MathUtils.smoothstep(duct.attributes.position.getZ(i),.67,2.34),shade=.19+depth*.76;
      ductColors.push(shade*.89,shade*.94,shade);
    }
    duct.setAttribute('color',new THREE.Float32BufferAttribute(ductColors,3));
    a.add(duct,'trim',{position:[x,0,0],name:`${side}-intake-duct`});
    const back=new THREE.PlaneGeometry(.90,.90);a.add(back,'cavity',{position:[x,-.58,.665],name:`${side}-inlet-shadow-baffle`});
    // Splitter plate lies above the opening, with its boundary layer gap
    // visible as a fine shadow beneath the forebody shoulder.
    const splitter=wing([[-.615,.064,2.53,1.51,.042],[.615,.064,2.53,1.51,.042]],false,14);
    a.add(splitter,'skin',{position:[x,0,0],name:`${side}-intake-splitter`});
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
