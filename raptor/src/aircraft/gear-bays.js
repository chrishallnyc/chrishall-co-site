import * as THREE from 'three';
import { buildAirframeGeometry,airframeTop } from './geometry/f22-airframe.js';
import { NOSE_GEAR_OPENING,MAIN_GEAR_RIGHT,MAIN_GEAR_LEFT,GEAR_STOPS,gearFairingY,splitGearSkin } from './geometry/f22-gear-layout.js';
import { clipProjectedPolygon } from './geometry/clip-polygon.js';
import { WING,wingUpperAt } from './geometry/f22-planform.js';
import { joinSurfaces,perimeterEdges,edgeStrip } from './weapons-bays.js';
import { mergeDetails } from './hardware.js';
import { buildLandingGear } from './landing-gear.js';
const instances=new WeakMap(),DEG=Math.PI/180;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const clip=(g,p)=>clipProjectedPolygon(g,p,{subtract:false});

// Both the closed wing door and the remaining wing use this same source.
// Only negative local-Y vertices move; upper geometry is retained exactly.
export function prepareGearWing(geometry) {
  const matrix=new THREE.Matrix4().makeRotationZ(-WING.anhedral);matrix.setPosition(WING.rootX,WING.rootY,0);
  const inverse=matrix.clone().invert(),p=geometry.attributes.position;
  let lower=geometry.clone();const upper=geometry.clone(),li=[],ui=[],index=geometry.index;
  for(let i=0;i<index.count;i+=3) {
    const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];
    (ids.every(j=>p.getY(j)<=1e-8)?li:ui).push(...ids);
  }
  lower.setIndex(li);upper.setIndex(ui);lower.applyMatrix4(matrix);
  const refined=splitGearSkin(lower);lower.dispose();lower=refined;
  const lp=lower.attributes.position;
  for(let i=0;i<lp.count;i++)lp.setY(i,gearFairingY(lp.getX(i),lp.getY(i),lp.getZ(i)));
  lower.computeVertexNormals();
  const cut=clipProjectedPolygon(lower,MAIN_GEAR_RIGHT);cut.applyMatrix4(inverse);
  const upperWorld=upper.clone().applyMatrix4(matrix);
  const result=joinSurfaces([upper,cut]);upper.dispose();cut.dispose();geometry.dispose();
  return {geometry:result,lowerWorld:lower,upperWorld};
}

export function buildGearBays(bodyCoating,wingCoating,quality,wingSource,wingUpperSource) {
  const root=new THREE.Group();root.name='gearBayAssembly';
  const fixed=new THREE.Group();fixed.name='gearWellInteriors';root.add(fixed);
  const liner=new THREE.MeshStandardMaterial({color:0xadb4ab,roughness:.76,metalness:.12,side:THREE.DoubleSide});liner.name='gear-well-liner';
  const hardware=new THREE.MeshStandardMaterial({color:0x586360,roughness:.68,metalness:.32});hardware.name='gear-well-hardware';
  const mesh=(parent,name,g,m)=>{const o=new THREE.Mesh(g,m);o.name=name;parent.add(o);return o;};
  const source=buildAirframeGeometry({quality,cutOpenings:false});
  const sourceSkins=source.filter(s=>/^(keel|intakeLowerRamp|intakeOuterWall)/.test(s.name));
  const leftWing=wingSource.clone();leftWing.scale(-1,1,1);
  for(let i=0;i<leftWing.index.count;i+=3){const a=leftWing.index.getX(i+1);leftWing.index.setX(i+1,leftWing.index.getX(i+2));leftWing.index.setX(i+2,a);}
  const leftUpper=wingUpperSource.clone();leftUpper.scale(-1,1,1);
  const upperSources=[...source.filter(s=>/^(engineRoof|spineUpper)/.test(s.name)).map(s=>s.geometry),wingUpperSource,leftUpper];
  const roof=(nose,x,z)=>nose?-.06:Math.min(airframeTop(x,z),wingUpperAt(x,z)??Infinity)-.055;
  const bays=[{key:'nose',outline:NOSE_GEAR_OPENING,parts:2},{key:'right',outline:MAIN_GEAR_RIGHT,sign:1,parts:1},{key:'left',outline:MAIN_GEAR_LEFT,sign:-1,parts:1}];
  for(const bay of bays) {
    const nose=bay.key==='nose',regions=nose?[
      NOSE_GEAR_OPENING.map(([x,z])=>[Math.min(0,x),z]).filter((p,i,a)=>i===0||p[0]!==a[i-1][0]||p[1]!==a[i-1][1]),
      NOSE_GEAR_OPENING.map(([x,z])=>[Math.max(0,x),z]).filter((p,i,a)=>i===0||p[0]!==a[i-1][0]||p[1]!==a[i-1][1])
    ]:[
      bay.outline.map(([x,z])=>[bay.sign*Math.min(1.90,Math.abs(x)),z]),
      bay.outline.map(([x,z])=>[bay.sign*Math.max(1.90,Math.abs(x)),z])
    ];
    for(let doorIndex=0;doorIndex<regions.length;doorIndex++) {
      const outline=regions[doorIndex],sign=nose?(doorIndex?1:-1):bay.sign;
      const pivot=new THREE.Group();pivot.name=`gearDoor_${bay.key}_${doorIndex}`;
      const hingeX=nose?sign*.25:sign*(doorIndex?2.82:1.02),hingeZ=nose?-4.25:2.28;
      pivot.position.set(hingeX,nose?-.745:doorIndex?gearFairingY(hingeX,.025,hingeZ):-.83,hingeZ);
      pivot.userData.gearDoor={openDeg:sign*(nose?88:doorIndex?102:-78),nose};root.add(pivot);
      const all=[];
      for(const skin of (nose||!doorIndex?sourceSkins:[])) {
        const g=clip(skin.geometry,outline);
        if(g.index.count){all.push(g);mesh(pivot,`gearDoorBody_${skin.name}`,g.clone().translate(-pivot.position.x,-pivot.position.y,-pivot.position.z),bodyCoating);}else g.dispose();
      }
      if(!nose&&doorIndex) {
        const g=clip(sign>0?wingSource:leftWing,outline);
        if(g.index.count){all.push(g);mesh(pivot,'gearDoorWing',g.clone().translate(-pivot.position.x,-pivot.position.y,-pivot.position.z),wingCoating);}else g.dispose();
      }
      const full=joinSurfaces(all),edges=perimeterEdges(full,outline),inner=full.clone();
      const p=inner.attributes.position,n=inner.attributes.normal;
      for(let i=0;i<p.count;i++){p.setXYZ(i,p.getX(i)-n.getX(i)*.014,p.getY(i)-n.getY(i)*.014,p.getZ(i)-n.getZ(i)*.014);n.setXYZ(i,-n.getX(i),-n.getY(i),-n.getZ(i));}
      for(let i=0;i<inner.index.count;i+=3){const a=inner.index.getX(i+1);inner.index.setX(i+1,inner.index.getX(i+2));inner.index.setX(i+2,a);}
      mesh(pivot,'gearDoorInner',inner.translate(-pivot.position.x,-pivot.position.y,-pivot.position.z),liner);
      mesh(pivot,'gearDoorEdge',edgeStrip(edges,p=>p[1],p=>p[1]+.014).translate(-pivot.position.x,-pivot.position.y,-pivot.position.z),liner);
      const wallEdges=perimeterEdges(full,bay.outline);
      mesh(fixed,'gearWellWalls',edgeStrip(wallEdges,p=>p[1],p=>roof(nose,p[0],p[2]),true),liner);
      full.dispose();all.forEach(g=>g.dispose());
    }
    if(nose) {
      const shape=new THREE.Shape(bay.outline.map(([x,z])=>new THREE.Vector2(x,z))),ceiling=new THREE.ShapeGeometry(shape),p=ceiling.attributes.position;
      for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getY(i);p.setXYZ(i,x,-.06,z);}ceiling.computeVertexNormals();mesh(fixed,'gearWellRoof',ceiling,liner);
    } else {
      const pieces=[];
      for(const upper of upperSources) {const piece=clip(upper,bay.outline);if(piece.index.count){piece.translate(0,-.055,0);pieces.push(piece);}else piece.dispose();}
      const ceiling=joinSurfaces(pieces);pieces.forEach(g=>g.dispose());mesh(fixed,'gearWellRoof',ceiling,liner);
    }
    const cx=nose?0:bay.sign*1.55;
    for(const z of nose?[-4.78,-4.18]:[1.65,2.94]) {
      const beam=mesh(fixed,'gearWellRib',new THREE.BoxGeometry(nose?.36:.82,.025,.032),hardware);
      beam.position.set(cx,nose?-.17:-.23,z);
    }
  }
  source.forEach(s=>s.geometry.dispose());leftWing.dispose();leftUpper.dispose();
  root.remove(fixed);root.add(mergeDetails(fixed));
  root.userData.gearBays={version:1,stops:{...GEAR_STOPS},source:'USAF DVIDS 4500335 / video 918341; stop angles fit tire clearance'};
  return root;
}

function bindings(group) {
  let result=instances.get(group);if(result)return result;
  const doors=[];group.traverse(o=>{if(o.userData.gearDoor)doors.push(o);});
  const parts=Object.fromEntries(['gearNose','gearR','gearL'].map(name=>[name,group.getObjectByName(name)]));
  const stays=[];group.traverse(o=>{if(o.userData.gearStay)stays.push({...o.userData.gearStay,root:o,part:parts[o.userData.gearStay.part],
    upper:o.getObjectByName('upperStay'),lower:o.getObjectByName('lowerStay'),
    a:new THREE.Vector3(),b:new THREE.Vector3(),k:new THREE.Vector3(),direction:new THREE.Vector3(),bend:new THREE.Vector3(),yAxis:new THREE.Vector3(0,1,0)});});
  result={doors,parts,stays,legs:Object.entries(parts).map(([name,part])=>({name,part}))};instances.set(group,result);return result;
}
// Pure pose from the same normalized FM state in the game and inspection lab.
// Doors lead extension and remain open while deployed; reversibility follows
// directly from the fraction, with no timers or mutable simulation state.
export function syncGearBays(group,fraction,forceVisible=false) {
  const t=Math.max(0,Math.min(1,fraction)),b=bindings(group);
  const leg=smooth(.12,1,t),door=smooth(0,.13,t);
  const visible=t>0||forceVisible;
  for(const {name,part} of b.legs)if(part) {
    part.visible=visible;part.rotation.set(0,0,0);
    if(name==='gearNose')part.rotation.x=GEAR_STOPS[name]*(1-leg)*DEG;
    else part.rotation.z=GEAR_STOPS[name]*(1-leg)*DEG;
  }
  for(const pivot of b.doors)pivot.rotation.z=pivot.userData.gearDoor.openDeg*door*DEG;
  for(const stay of b.stays){stay.root.visible=visible;syncStay(stay);}
}


// Separate the linkage attached to the airframe from the rotating wheel leg.
// Both links retain their nominal lengths; their private knee follows a
// two-link construction rather than rotating the fixed upper anchor.
export function buildGearDetail(length,radius,width,options) {
  const raw=buildLandingGear(length,radius,width,options);
  for(const child of [...raw.children]) if(/^(noseDragStay|noseRetractRam|noseRetractPiston|sideStayUpper|sideStayLower|sideStayKnuckle)$/.test(child.name)) {
    raw.remove(child);child.geometry.dispose();
  }
  if(options.kind==='nose')for(const child of raw.children) {
    if(/^(upperTrunnion|trunnionPivot)$/.test(child.name))child.position.y-=.10;
    if(child.name==='noseHydraulicLine')child.position.y-=.03;
  }
  if(options.kind==='main')for(const child of raw.children)if(child.name==='flexibleBrakeLine')child.position.x+=(options.side<0?-1:1)*.02;
  return mergeDetails(raw);
}
export function addGearStays(group) {
  const material=new THREE.MeshStandardMaterial({color:0xaeb8b3,roughness:.48,metalness:.30});material.name='gear-folding-stays';
  const geometry=new THREE.CylinderGeometry(.022,.025,1,12);
  for(const [part,sign]of [['gearNose',0],['gearR',1],['gearL',-1]]) {
    const nose=!sign,root=new THREE.Group();root.name=`${part}PrivateStay`;
    root.userData.gearStay={part,anchor:nose?[0,-.65,-3.51]:[sign*1.05,-.48,1.99],
      attachment:nose?[0,-.55,.015]:[sign*.165,-.642,.131],lengthA:nose?.48:.54,lengthB:nose?.48:.54};
    for(const name of ['upperStay','lowerStay']){const rod=new THREE.Mesh(geometry,material);rod.name=name;root.add(rod);}
    group.add(root);
  }
}
function syncStay(stay) {
  const {a,b,k,direction,bend}=stay;a.fromArray(stay.anchor);b.fromArray(stay.attachment).applyEuler(stay.part.rotation).add(stay.part.position);
  direction.subVectors(b,a);const distance=direction.length();direction.multiplyScalar(1/Math.max(1e-9,distance));
  const along=(stay.lengthA**2-stay.lengthB**2+distance**2)/(2*Math.max(1e-9,distance));
  const height=Math.sqrt(Math.max(0,stay.lengthA**2-along**2));
  bend.set(0,1,0).addScaledVector(direction,-direction.y).normalize();
  k.copy(a).addScaledVector(direction,along).addScaledVector(bend,height);
  setStayRod(stay.upper,a,k,direction,stay.yAxis);
  setStayRod(stay.lower,k,b,direction,stay.yAxis);
}

function setStayRod(rod,from,to,direction,axis) {
  rod.position.copy(from).add(to).multiplyScalar(.5);direction.subVectors(to,from);
  rod.scale.y=direction.length();rod.quaternion.setFromUnitVectors(axis,direction.normalize());
}
