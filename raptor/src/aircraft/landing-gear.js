// F-22 undercarriage. Nominal tire sizes from Goodyear's application chart;
// casting, fork and brake layout from USM's F-22 maintenance trainer photos.
import * as THREE from 'three';
import { addDetail, patchGeometry, roundedBlock, rodDetail, hoseGeometry } from './detail-geometry.js';

export const F22_GEAR_DIMENSIONS = Object.freeze({
  main:Object.freeze({radius:37*.0254/2,width:11.5*.0254,rimRadius:18*.0254/2}),
  nose:Object.freeze({radius:23.5*.0254/2,width:7.5*.0254,rimRadius:10*.0254/2}),
});

let sharedMaterials;
function materials() {
  if(sharedMaterials)return sharedMaterials;
  const c=document.createElement('canvas');c.width=256;c.height=512;const ctx=c.getContext('2d');
  ctx.fillStyle='#182021';ctx.fillRect(0,0,256,512);ctx.strokeStyle='#a3afad';ctx.lineWidth=3;ctx.strokeRect(9,9,238,494);
  ctx.fillStyle='#b7c2bb';ctx.font='20px monospace';ctx.textAlign='center';
  ['LANDING GEAR','SHOCK STRUT','','SERVICING','NITROGEN ONLY','','CHECK EXTENSION','BEFORE FLIGHT','','CAUTION','HIGH PRESSURE'].forEach((line,i)=>ctx.fillText(line,128,46+i*39));
  const placard=new THREE.CanvasTexture(c);placard.colorSpace=THREE.SRGBColorSpace;placard.anisotropy=4;
  const sidewall=document.createElement('canvas');sidewall.width=1024;sidewall.height=512;
  const lettering=sidewall.getContext('2d');lettering.fillStyle='#808080';lettering.fillRect(0,0,1024,512);
  // Relief is restrained: molded lettering and fine annular witness lines,
  // never white printed text on a black aircraft tire.
  lettering.strokeStyle='#898989';lettering.lineWidth=2;
  for(const y of [19,88,424,493]){lettering.beginPath();lettering.moveTo(0,y);lettering.lineTo(1024,y);lettering.stroke();}
  lettering.fillStyle='#909090';lettering.font='bold 23px sans-serif';lettering.textAlign='center';
  for(const y of [48,476]) {
    lettering.fillText('AVIATION',235,y);lettering.fillText('TUBELESS',736,y);
    lettering.font='11px sans-serif';lettering.fillText('NYLON  •  HIGH SPEED',235,y+14);lettering.fillText('MAX LOAD / INFLATION',736,y+14);lettering.font='bold 23px sans-serif';
  }
  const heights=lettering.getImageData(0,0,1024,512).data,normalImage=lettering.createImageData(1024,512);
  for(let y=0;y<512;y++)for(let x=0;x<1024;x++) {
    const value=(xx,yy)=>heights[(Math.max(0,Math.min(511,yy))*1024+((xx+1024)%1024))*4]/255;
    const dx=(value(x-1,y)-value(x+1,y))*2,dy=(value(x,y+1)-value(x,y-1))*2,q=1/Math.hypot(dx,dy,1),i=(y*1024+x)*4;
    normalImage.data.set([(dx*q*.5+.5)*255,(dy*q*.5+.5)*255,(q*.5+.5)*255,255],i);
  }
  lettering.putImageData(normalImage,0,0);
  const tireNormal=new THREE.CanvasTexture(sidewall);tireNormal.colorSpace=THREE.NoColorSpace;tireNormal.anisotropy=4;
  sharedMaterials={
    paint:new THREE.MeshStandardMaterial({color:0xb4bbaf,roughness:.55,metalness:.14}),
    chrome:new THREE.MeshStandardMaterial({color:0xbac4c0,roughness:.23,metalness:.93}),
    rubber:new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.93,normalMap:tireNormal,normalScale:new THREE.Vector2(.30,.30)}),
    brake:new THREE.MeshStandardMaterial({color:0x3f4948,roughness:.67,metalness:.66}),
    hose:new THREE.MeshStandardMaterial({color:0x202825,roughness:.87}),
    label:new THREE.MeshStandardMaterial({color:0xffffff,map:placard,roughness:.70,metalness:.1}),
    lens:new THREE.MeshPhysicalMaterial({color:0xa8b6af,roughness:.09,metalness:.3,clearcoat:1}),
  };
  for(const [name,m]of Object.entries(sharedMaterials))m.name=`gear:${name}`;
  return sharedMaterials;
}

function latheX(profile,segments=48) {
  const g=new THREE.LatheGeometry(profile.map(([x,r])=>new THREE.Vector2(r,x)),segments);
  g.rotateZ(-Math.PI/2);return g;
}

function tireGeometry(radius,width,rimRadius) {
  // Bead, rounded sidewall, shoulder and four recessed circumferential grooves.
  // A torus cannot reproduce the flatter tread or independent wheel width.
  const bead=rimRadius/radius,profile=[[-.33,bead],[-.48,bead+.075],[-.50,.75],[-.46,.86],[-.37,.95],[-.30,.985]];
  for(const x of [-.24,-.08,.08,.24])profile.push([x-.024,1],[x-.013,.986],[x+.013,.986],[x+.024,1]);
  profile.push([.30,.985],[.37,.95],[.46,.86],[.50,.75],[.48,bead+.075],[.33,bead]);
  const g=latheX(profile.map(([x,r])=>[x*width,r*radius]),112),p=g.attributes.position,colors=[];
  const side=new THREE.Color(0x171b18),tread=new THREE.Color(0x282b26);
  for(let i=0;i<p.count;i++) {
    const rr=Math.hypot(p.getY(i),p.getZ(i))/radius,t=THREE.MathUtils.smoothstep(rr,.90,.99);
    const a=Math.atan2(p.getZ(i),p.getY(i)),x=p.getX(i)/width;
    const wear=1+t*(.033*Math.sin(a*17+x*8)+.018*Math.sin(a*39-x*19));
    const c=side.clone().lerp(tread,t).multiplyScalar(wear);colors.push(c.r,c.g,c.b);
  }
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return g;
}

function wheelFace(radius,width,side,main) {
  // Real openings through the cast face expose the darker hub/brake cavity.
  const shape=new THREE.Shape();shape.moveTo(radius,0);
  for(let k=1;k<=64;k++)shape.lineTo(Math.cos(k/64*Math.PI*2)*radius,Math.sin(k/64*Math.PI*2)*radius);
  for(let k=0;k<(main?8:6);k++) {
    const angle=k/(main?8:6)*Math.PI*2,rad=radius*.62;
    const hole=new THREE.Path();
    hole.absellipse(Math.cos(angle)*rad,Math.sin(angle)*rad,radius*.062,radius*.15,0,Math.PI*2,true,angle-Math.PI/2);
    shape.holes.push(hole);
  }
  const g=new THREE.ExtrudeGeometry(shape,{depth:.014,bevelEnabled:true,bevelSize:.0025,bevelThickness:.0025,bevelSegments:1,curveSegments:10,steps:1});
  const position=g.attributes.position,normal=g.attributes.normal;
  for(let i=0;i<position.count;i++) {
    const r=Math.hypot(position.getX(i),position.getY(i))/radius;
    position.setZ(i,position.getZ(i)+side*.013*(1-Math.min(1,r*r)));
    if(Math.abs(normal.getZ(i))>.9) {
      const sign=Math.sign(normal.getZ(i)),x=side*.026*position.getX(i)/(radius*radius),y=side*.026*position.getY(i)/(radius*radius);
      const length=Math.hypot(x,y,1);normal.setXYZ(i,sign*x/length,sign*y/length,sign/length);
    }
  }
  g.translate(0,0,side*width*.38-.007);g.rotateY(Math.PI/2);
  return g;
}

function castPlate(points,width,x) {
  const shape=new THREE.Shape();points.forEach(([z,y],i)=>i?shape.lineTo(-z,y):shape.moveTo(-z,y));shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:width-.008,bevelEnabled:true,bevelThickness:.004,bevelSize:.005,bevelSegments:2,steps:1,curveSegments:6});
  g.translate(0,0,-width/2+.004);g.rotateY(Math.PI/2);g.translate(x,0,0);return g;
}

export function buildLandingGear(strutLength,wheelRadius,wheelWidth,{kind=wheelRadius<.35?'nose':'main',side=1,wheelOffset=.43,splay=.19,rake=.18}={}) {
  const group=new THREE.Group();group.name=kind==='nose'?'noseLandingGear':'mainLandingGear';
  const mat=materials(),main=kind==='main',s=side<0?-1:1,L=strutLength,R=wheelRadius,W=wheelWidth;
  const wheel=[main?s*(wheelOffset-splay):0,-L,main?.04:.08];
  // Splay the load-bearing leg, preserving circular wheels and oleo sections.
  const point=p=>main?[p[0]-s*splay*p[1]/L,p[1],p[2]-rake*p[1]/L]:p;
  const shear=new THREE.Matrix4().set(1,main?-s*splay/L:0,0,0, 0,1,0,0, 0,main?-rake/L:0,1,0, 0,0,0,1);
  const rim=R*(main?F22_GEAR_DIMENSIONS.main.rimRadius/F22_GEAR_DIMENSIONS.main.radius:F22_GEAR_DIMENSIONS.nose.rimRadius/F22_GEAR_DIMENSIONS.nose.radius);
  const add=(name,g,m=mat.paint,p=[0,0,0])=>addDetail(group,name,g,m,point(p));
  const rod=(name,a,b,r,m=mat.paint,r2=r)=>rodDetail(group,name,point(a),point(b),r,m,r2,16);
  const pin=(name,p,r,length,m=mat.chrome)=>rod(name,[p[0]-length/2,p[1],p[2]],[p[0]+length/2,p[1],p[2]],r,m);
  const block=(name,w,h,d,p,m=mat.paint)=>add(name,roundedBlock(w,h,d,.009),m,p);
  const shockBottom=main?-L+.105:-L+R+.095,shockX=main?s*.058:0,shaftRadius=main?.066:.046;
  rod('upperTrunnion',[0,.025,0],[0,-L*.16,0],shaftRadius*1.43);
  pin('trunnionPivot',[0,0,0],shaftRadius*1.20,main?.29:.20,mat.brake);
  rod('oleoCylinder',[0,-L*.10,0],[shockX*.42,-L*.47,0],shaftRadius*1.16);
  rod('oleoChromePiston',[shockX*.31,-L*.40,0],[shockX,shockBottom,.018],shaftRadius*.74,mat.chrome);
  rod('oleoSealCollar',[shockX*.39,-L*.45,0],[shockX*.46,-L*.49,0],shaftRadius*1.25);
  rod('pistonWiperSeal',[shockX*.46,-L*.49,0],[shockX*.48,-L*.502,0],shaftRadius*.9,mat.hose);
  // Split collar flange, retained bolts and narrow dirt line make the chrome
  // piston read as a telescoping load-bearing assembly rather than a plain rod.
  for(let i=0;i<6;i++) {
    const a=i/6*Math.PI*2,x=shockX*.42+Math.cos(a)*shaftRadius*1.04,z=Math.sin(a)*shaftRadius*1.04;
    rod('sealRetainingBolt',[x,-L*.446,z],[x,-L*.460,z],.006,mat.brake);
  }
  rod('oleoGreaseWitness',[shockX*.48,-L*.503,.001],[shockX*.49,-L*.511,.001],shaftRadius*.76,mat.brake);
  const label=patchGeometry((u,v)=>{
    const angle=(u-.5)*1.52;return[Math.sin(angle)*shaftRadius*1.175,-L*(.19+v*.21),-Math.cos(angle)*shaftRadius*1.175];
  },12,1);add('strutServicingPlacard',label.applyMatrix4(shear),mat.label);
  if(main) {
    // The single main wheel sits outboard of its oleo; the axle is continuous.
    rod('axleCasting',[shockX,shockBottom,.018],[shockX,-L,.04],shaftRadius*1.20);
    pin('mainWheelAxle',[(shockX+wheel[0])*.5,-L,.04],R*.12,Math.abs(wheel[0]-shockX)+W*.85);
    const root=[-s*.34,.055,-.19],knee=[-s*.17,-L*.29,-.115],end=[shockX*.75,-L*.64,.016];
    rod('sideStayUpper',root,knee,.031);rod('sideStayLower',knee,end,.030);
    pin('sideStayKnuckle',knee,.041,.087);
    rod('retractionActuatorBody',[-s*.17,.025,.31],[s*.01,-L*.27,.166],.031);
    rod('retractionActuatorRod',[s*.01,-L*.27,.166],[shockX,-L*.56,.051],.017,mat.chrome);
    for(const sideX of [-.032,.032]) {
      rod('torqueScissorUpper',[shockX+sideX,-L*.47,.076],[shockX+sideX,-L*.64,.17],.014);
      rod('torqueScissorLower',[shockX+sideX,-L*.64,.17],[shockX+sideX,-L*.84,.068],.014);
    }
    pin('scissorPivot',[shockX,-L*.64,.17],.021,.092);
    const brakeX=wheel[0]-s*W*.39;
    for(let i=0;i<4;i++) {
      const disc=new THREE.CylinderGeometry(rim*.79,rim*.79,.012,32);disc.rotateZ(Math.PI/2);
      add('carbonBrakeStack',disc,mat.brake,[brakeX-s*i*.017,-L,.04]);
    }
    block('brakeCaliper',.09,R*.32,R*.32,[brakeX-s*.052,-L+R*.22,.04+R*.23]);
    for(const v of [-1,1])pin('brakeCaliperRetainer',[brakeX-s*.052,-L+R*(.22+v*.105),.04+R*.23],.012,.083,mat.brake);
    add('flexibleBrakeLine',hoseGeometry([[-s*.07,-.07,-.10],[-s*.09,-L*.31,-.11],
      [shockX-s*.086,-L*.55,-.083],[shockX-s*.086,-L*.76,-.075],[brakeX-s*.07,-L+R*.23,.06]],.009,36,7).applyMatrix4(shear),mat.hose);
  } else {
    // Forked nose casting arches around a single tire and joins both axle ends.
    const top=-L+R+.098,bottom=-L;
    const profile=[[-.078,top-.02],[-.082,top-.115],[.048,bottom-.015],
      [.068,bottom-.036],[.099,bottom-.034],[.114,bottom-.007],[.106,bottom+.031],
      [-.025,top-.105],[-.028,top-.018]];
    for(const sign of [-1,1])add('noseForkArm',castPlate(profile,.038,sign*(W*.56)),mat.paint);
    pin('forkCrown',[0,top-.030,-.049],.041,W*1.24,mat.paint);
    pin('noseWheelAxle',wheel,R*.092,W*1.30);
    for(const x of [-.026,.026]) {
      rod('noseTorqueLinkUpper',[x,-L*.36,.06],[x,-L*.53,.15],.011);
      rod('noseTorqueLinkLower',[x,-L*.53,.15],[x,top-.018,.043],.011);
    }
    pin('noseScissorKnuckle',[0,-L*.53,.15],.021,.087);
    rod('noseDragStay',[0,.04,.39],[0,-L*.28,.24],.030);
    rod('noseDragStay',[0,-L*.28,.24],[0,top+.075,.015],.025);
    rod('noseRetractRam',[.09,.015,.20],[.07,-L*.23,.143],.022);
    rod('noseRetractPiston',[.07,-L*.23,.143],[.045,top+.12,.04],.012,mat.chrome);
    add('noseHydraulicLine',hoseGeometry([[-.066,-.035,.055],[-.069,-L*.31,.061],[-.066,-L*.48,.074],[-.072,top+.011,-.004]],.006,28,6),mat.hose);
    const light=new THREE.CylinderGeometry(.050,.047,.035,24);light.rotateX(Math.PI/2);
    add('taxiLightHousing',light,mat.brake,[.071,-L*.24,-.047]);
    const lens=new THREE.CircleGeometry(.041,24);lens.rotateY(Math.PI);
    add('taxiLightLens',lens,mat.lens,[.071,-L*.24,-.066]);
  }
  add('groovedAircraftTire',tireGeometry(R,W,rim),mat.rubber,wheel);
  // Rim bead and its cylindrical back cavity remain visible through the holes.
  add('wheelRimBarrel',latheX([[-W*.36,rim*.86],[-W*.39,rim*.98],[-W*.30,rim*1.05],
    [W*.30,rim*1.05],[W*.39,rim*.98],[W*.36,rim*.86]],48),mat.paint,wheel);
  const cavity=new THREE.CylinderGeometry(rim*.92,rim*.92,W*.53,48);cavity.rotateZ(Math.PI/2);
  add('recessedWheelCavity',cavity,mat.brake,wheel);
  for(const faceSide of [-1,1]) {
    add('castWheelFace',wheelFace(rim*.96,W,faceSide,main),mat.paint,wheel);
    const faceSurface=r=>faceSide*(W*.38+.007+.013*(1-(r/(rim*.96))**2));
    const cap=new THREE.CylinderGeometry(rim*.29,rim*.32,.024,24);cap.rotateZ(Math.PI/2);
    add('axleBearingCap',cap,mat.paint,[wheel[0]+faceSide*W*.43,wheel[1],wheel[2]]);
    const sealX=faceSurface(rim*.32);
    const seal=latheX([[sealX,rim*.295],[sealX+faceSide*.0015,rim*.298],
      [sealX+faceSide*.0015,rim*.326],[sealX,rim*.330]],48);
    add('wheelBearingDustSeal',seal,mat.hose,wheel);
    for(let i=0;i<(main?8:6);i++) {
      const a=i/(main?8:6)*Math.PI*2,r=rim*.34;
      const size=main?.007:.0055,depth=main?.007:.004;
      const bolt=new THREE.CylinderGeometry(size,size,depth,6);bolt.rotateZ(Math.PI/2);
      add('wheelFastener',bolt,mat.chrome,[wheel[0]+faceSurface(r)+faceSide*depth*.35,wheel[1]+Math.cos(a)*r,wheel[2]+Math.sin(a)*r]);
    }
    // Recessed rim fasteners, valve and lock tab remain inside the tire width.
    for(let i=0;i<(main?8:6);i++) {
      const a=(i+.5)/(main?8:6)*Math.PI*2,r=rim*.87;
      const bolt=new THREE.CylinderGeometry(main?.006:.0045,main?.006:.0045,.005,6);bolt.rotateZ(Math.PI/2);
      add('rimSplitFastener',bolt,mat.brake,[wheel[0]+faceSurface(r)+faceSide*.0015,wheel[1]+Math.cos(a)*r,wheel[2]+Math.sin(a)*r]);
    }
    const valve=[wheel[0]+faceSurface(rim*Math.hypot(.72,.24)),wheel[1]+rim*.72,wheel[2]-rim*.24];
    rod('inflationValve',valve,[valve[0]+faceSide*.006,valve[1],valve[2]],.0045,mat.brake);
  }
  group.userData.landingGear={kind,side:s,wheelCenter:point(wheel),wheelRadius:R,wheelWidth:W,rimRadius:rim,attachment:[0,0,0],axleAxis:[1,0,0]};
  return group;
}
