// F-22 cockpit in AIRCRAFT coordinates: metres, nose -Z, starboard +X.
// Add directly to the aircraft. No legacy scale/translation is needed.
import * as THREE from 'three';
import { mergeDetails } from './hardware.js';
import { F22_CANOPY } from './geometry/f22-airframe.js';
import { stationSet } from './geometry/interpolation.js';
import { createCockpitAtlas, createFabricMaps, createHUDSymbols, COCKPIT_ATLAS } from './cockpit-atlas.js';
import { addPilot } from './cockpit-pilot.js';
import { addDetail, tintGeometry, patchGeometry, ringLoft, roundedBlock, rodDetail, hoseGeometry, quadGeometry } from './detail-geometry.js';

export const F22_COCKPIT = Object.freeze({ eye:[0,1.253,-5.383], seat:[0,.425,-5.18], panel:[0,.645,-6.14] });

export function buildCockpit({ canopyStations = F22_CANOPY, pilot = true } = {}) {
  const group = new THREE.Group(); group.name = 'cockpitInterior';
  const canopy = stationSet(canopyStations, ['w','top','sill']);
  const atlas = createCockpitAtlas(), fabric = createFabricMaps();
  const material = {
    structure: new THREE.MeshStandardMaterial({color:0x242d2e,roughness:.73,metalness:.25}),
    rubber: new THREE.MeshStandardMaterial({color:0x131918,roughness:.92}),
    cloth: new THREE.MeshStandardMaterial({color:0xc1c4be,vertexColors:true,roughness:1,...fabric,normalScale:new THREE.Vector2(.14,.14),side:THREE.DoubleSide}),
    metal: new THREE.MeshStandardMaterial({color:0x909d9b,roughness:.43,metalness:.72}),
    helmet: new THREE.MeshStandardMaterial({color:0x656e67,roughness:.62,metalness:.02}),
    visor: new THREE.MeshPhysicalMaterial({color:0x101b1c,roughness:.14,metalness:.36,clearcoat:.65,clearcoatRoughness:.12}),
    mask: new THREE.MeshStandardMaterial({color:0x4a5550,roughness:.68}),
    safety: new THREE.MeshStandardMaterial({color:0xbca248,roughness:.67,metalness:.15}),
    instruments: new THREE.MeshStandardMaterial({color:0xffffff,...atlas,roughness:1,metalness:.12,emissive:0xffffff,emissiveIntensity:.13,normalScale:new THREE.Vector2(.55,.55)}),
    glass: new THREE.MeshPhysicalMaterial({color:0x9bb9ae,roughness:.08,metalness:.05,clearcoat:1,transparent:true,opacity:.16,side:THREE.DoubleSide,depthWrite:false}),
    hud: new THREE.MeshBasicMaterial({color:0xffffff,map:createHUDSymbols(),transparent:true,opacity:.33,side:THREE.DoubleSide,depthWrite:false,toneMapped:true}),
  };
  for(const [name,m] of Object.entries(material))m.name=`cockpit:${name}`;
  const add=(name,g,mat=material.structure,p=[0,0,0])=>addDetail(group,name,g,mat,p);
  const block=(name,w,h,d,p,mat=material.structure,r=.008)=>add(name,roundedBlock(w,h,d,r),mat,p);
  const rod=(name,a,b,r,mat=material.structure)=>rodDetail(group,name,a,b,r,mat);
  const cloth=(name,g,color)=>add(name,tintGeometry(g,color),material.cloth);
  const cushion=0x202724;

  add('cockpitFloor',patchGeometry((u,v)=>{
    const z=-6.70+v*2.12,c=canopy(z);return[(u-.5)*c.w*1.68,.275,z];
  },12,32,true),material.rubber);
  for(const s of [-1,1]) {
    add('innerSill',patchGeometry((u,v)=>{
      const z=-6.76+v*2.40,c=canopy(z);return[s*c.w*(.94+.045*u),c.sill-.014-.045*(1-u),z];
    },3,40,s>0),material.structure);
    add('canopyPressureSeal',hoseGeometry(Array.from({length:25},(_,i)=>{
      const z=-6.74+i/24*2.35,c=canopy(z);return[s*c.w*.99,c.sill-.009,z];
    }),.009,64,6),material.rubber);
    const console=patchGeometry((u,v)=>{
      const z=-6.05+v*1.32,c=canopy(z);return[s*(.266+u*(c.w*.91-.266)),.562+.053*v,z];
    },8,24,s>0);
    const rect=s<0?COCKPIT_ATLAS.left:COCKPIT_ATLAS.right,uv=console.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setXY(i,rect[0]+uv.getX(i)*rect[2],1-rect[1]-uv.getY(i)*rect[3]);
    add(s<0?'leftConsolePanel':'rightConsolePanel',console,material.instruments);
    add('consoleInnerWall',patchGeometry((u,v)=>[s*.266,.29+u*(.272+.053*v),-6.05+v*1.32],2,24,s>0),material.structure);
    rod('canopyLatchRail',[s*.425,.665,-5.92],[s*.437,.706,-5.23],.012);
    // Selected knobs/toggles break the grazing silhouette; the remaining
    // legends and fine switches stay on the common instrument atlas.
    for(const row of [0,1,4,5]) {
      const v=(58+row*123)/768,z=-6.05+v*1.32,c=canopy(z),u=(row%2?120:43)/327.68;
      const x=s*(.266+u*(c.w*.91-.266)),y=.562+.053*v;
      const knob=new THREE.CylinderGeometry(.010,.012,.013,12);add('consoleRotaryKnob',knob,material.rubber,[x,y+.006,z]);
      rod('consoleKnobIndex',[x,y+.014,z],[x+.006*s,y+.014,z-.006],.0013,material.metal);
    }
    for(const v of [.17,.80]) {
      const z=-6.05+v*1.32,c=canopy(z),x=s*(.266+.68*(c.w*.91-.266)),y=.562+.053*v;
      rod('consoleToggleStem',[x,y+.002,z],[x,y+.020,z-.007],.0028,material.metal);
    }
  }
  // Six displays and the ICP live on one atlas, tilted away from the pilot.
  const panelCorners=[[-.354,.352,-6.065],[.354,.352,-6.065],[.389,.873,-6.258],[-.389,.873,-6.258]];
  add('sixDisplayInstrumentPanel',quadGeometry(panelCorners,COCKPIT_ATLAS.panel),material.instruments);
  const panelNormal=new THREE.Vector3(0,.193,.521).normalize();
  const panelPoint=(x,y,depth=0)=>{
    const v=1-y/768,w=.354+.035*v;
    return new THREE.Vector3((x/1280*2-1)*w,.352+.521*v,-6.065-.193*v).addScaledVector(panelNormal,depth).toArray();
  };
  function instrumentRelief(name,rect,depth,hole=null) {
    const [x,y,w,h]=rect,outer=[[x,y+h],[x+w,y+h],[x+w,y],[x,y]];
    const inner=hole?[[hole[0],hole[1]+hole[3]],[hole[0]+hole[2],hole[1]+hole[3]],
      [hole[0]+hole[2],hole[1]],[hole[0],hole[1]]]:null;
    const vertices=[],uv=[],indices=[];
    function face(corners){
      const start=vertices.length/3;
      for(const [px,py,d] of corners){vertices.push(...panelPoint(px,py,d));uv.push(px/2048,1-py/1024);}
      indices.push(start,start+1,start+2,start,start+2,start+3);
    }
    for(let k=0;k<4;k++){
      const a=outer[k],b=outer[(k+1)%4];
      face([[...a,0],[...b,0],[...b,depth],[...a,depth]]);
      if(inner){
        const c=inner[k],d=inner[(k+1)%4];
        face([[...a,depth],[...b,depth],[...d,depth],[...c,depth]]);
        face([[...c,depth],[...d,depth],[...d,0],[...c,0]]);
      }
    }
    if(!inner)face(outer.map(p=>[...p,depth]));
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
    add(name,g,material.instruments);
  }
  // Each display has a solid cast bezel and a recessed screen. Atlas-aligned
  // geometry retains the exact legends while restoring contact shadows and
  // parallax at the pilot's shallow viewing angle.
  for(const [x,y,w,h] of [[456,275,368,289],[151,313,231,221],[897,313,231,221],
    [485,610,310,119],[206,128,225,118],[849,128,225,118]]) {
    instrumentRelief('displayBezel',[x-20,y-20,w+40,h+40],.009,[x,y,w,h]);
    for(let k=0;k<5;k++)for(const py of [y-12,y+h+12])instrumentRelief('displayFunctionKey',[x+(k+.5)*w/5-6.5,py-4.5,13,9],.012);
    for(let k=0;k<4;k++)for(const px of [x-12,x+w+12])instrumentRelief('displayFunctionKey',[px-4.5,y+(k+.5)*h/4-6.5,9,13],.012);
  }
  for(let j=0;j<4;j++)for(let i=0;i<6;i++)instrumentRelief('integratedControlKey',[497+i*49,106+j*29,34,20],.006);
  for(const s of [-1,1])rod('panelEdge',[s*.354,.352,-6.062],[s*.389,.873,-6.255],.014,material.rubber);
  add('instrumentCoaming',patchGeometry((u,v)=>{
    const z=-6.54+v*.36,w=.30+.091*v,x=(u*2-1)*w;
    return[x,.817+.071*v+.028*(1-(u*2-1)**2)+.014*Math.sin(v*Math.PI)*(1-(u*2-1)**2),z];
  },32,16,true),material.rubber);
  add('coamingRearLip',hoseGeometry(Array.from({length:25},(_,i)=>{
    const x=(i/24*2-1)*.391;return[x,.888+.028*(1-(x/.391)**2),-6.18];
  }),.015,32,8),material.rubber);
  add('coamingFascia',patchGeometry((u,v)=>{
    const x=(u*2-1)*.391,top=.888+.028*(1-(x/.391)**2);
    return[x,top*(1-v)+.850*v,-6.180];
  },32,2,true),material.rubber);
  for(const s of [-1,1])add('coamingSideReturn',patchGeometry((u,v)=>{
    const z=-6.54+v*.36,w=.30+.091*v,top=.817+.071*v;
    return[s*w,top-u*.047,z];
  },2,16,s<0),material.rubber);
  for(const s of [-1,1]) {
    add('coamingBoundSeam',hoseGeometry([ [s*.291,.821,-6.523],[s*.323,.851,-6.420],
      [s*.356,.873,-6.290],[s*.380,.892,-6.190]],.0022,24,6),material.structure);
    const fitting=block('coamingRetainer',.018,.006,.027,[s*.364,.882,-6.241],material.metal,.002);
    fitting.rotation.x=-.18;
  }
  // Opaque backing prevents the instrument page showing through from ahead.
  add('panelBackShell',quadGeometry(panelCorners.map(([x,y,z])=>[x,y,z-.006]).reverse()),material.structure);
  const hudCorners=[[-.129,.924,-6.292],[.129,.924,-6.292],[.144,1.147,-6.339],[-.144,1.147,-6.339]];
  add('HUDCombinerGlass',quadGeometry(hudCorners),material.glass);
  add('HUDCollimatedSymbols',quadGeometry(hudCorners.map(([x,y,z])=>[x,y,z+.0014])),material.hud);
  block('HUDOpticalProjector',.19,.053,.166,[0,.916,-6.278],material.structure,.018);
  for(const s of [-1,1]) {
    rod('HUDLowerSupport',[s*.093,.920,-6.235],[s*.128,.945,-6.301],.008,material.metal);
    rod('HUDSideClamp',[s*.129,.925,-6.293],[s*.133,.983,-6.306],.006);
  }
  add('rearCockpitDeck',patchGeometry((u,v)=>{
    const z=-4.76+v*.76,c=canopy(z);return[(u*2-1)*c.w*.87,c.sill-.025,z];
  },16,18,true),material.structure);
  for(const s of [-1,1]) {
    rod('ACESIIGuideRail',[s*.219,.31,-5.078],[s*.219,1.181,-4.891],.015,material.metal);
    rod('ACESIISeatSide',[s*.226,.365,-5.25],[s*.214,.994,-4.94],.024);
    block('seatRailSlide',.048,.145,.037,[s*.219,.785,-4.975]);
    cloth('stowedArmRestraint',ringLoft([{y:.51,w:.044,d:.055,z:-5.023,x:s*.233},
      {y:.59,w:.048,d:.052,z:-5.012,x:s*.233},{y:.91,w:.042,d:.049,z:-4.945,x:s*.223},
      {y:.975,w:.032,d:.039,z:-4.934,x:s*.218}],12),0x242d29);
    rod('seatHarnessFitting',[s*.135,1.028,-4.962],[s*.135,1.068,-4.958],.013,material.metal);
  }
  const back=block('ACESIIBackShell',.438,.672,.09,[0,.748,-4.995],material.structure,.025);back.rotation.x=.21;
  const backCushion=block('seatBackCushion',.356,.539,.073,[0,.753,-5.055],material.cloth,.03);
  tintGeometry(backCushion.geometry,cushion);backCushion.rotation.x=.21;
  const pan=block('survivalPackSeatPan',.407,.13,.457,[0,.408,-5.218],material.cloth,.025);tintGeometry(pan.geometry,cushion);pan.rotation.x=-.075;
  block('seatHeadrestShell',.275,.215,.166,[0,1.136,-4.955],material.structure,.032);
  const pad=block('headrestCushion',.237,.162,.047,[0,1.147,-5.058],material.cloth,.021);tintGeometry(pad.geometry,cushion);
  block('drogueParachuteHousing',.23,.175,.182,[0,1.139,-4.815],material.structure,.02);
  add('seatIdentificationPlate',quadGeometry([[-.116,1.112,-4.716],[.116,1.112,-4.716],
    [.116,1.216,-4.716],[-.116,1.216,-4.716]],COCKPIT_ATLAS.seat),material.instruments);
  for(const s of [-1,1])add('ejectionHandle',hoseGeometry([[s*.013,.442,-5.447],[s*.064,.410,-5.473],
    [s*.063,.364,-5.457],[s*.017,.355,-5.442],[s*.012,.420,-5.448]],.007,24,8),material.safety);
  rod('sideStickStem',[.326,.583,-5.555],[.326,.654,-5.56],.015);
  const stick=block('sideStickGrip',.033,.072,.047,[.326,.686,-5.574],material.rubber,.01);stick.rotation.x=-.22;
  for(const s of [-1,1]) {
    rod('throttleLever',[-.345+s*.018,.584,-5.58],[-.345+s*.018,.649,-5.625],.007,material.metal);
    block('throttleGrip',.028,.028,.086,[-.345+s*.018,.658,-5.615],material.rubber,.009);
  }
  if(pilot)addPilot(group,material);
  group.userData.cockpit={version:3,coordinates:'aircraft',eye:[...F22_COCKPIT.eye],pilot,
    canopyStations:canopyStations.map(station=>({...station})),
    facing:{HGU55DarkVisor:[0,0,-1],sixDisplayInstrumentPanel:[0,0,1],leftConsolePanel:[0,1,0],rightConsolePanel:[0,1,0]}};
  return mergeDetails(group);
}
