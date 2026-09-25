// Sculpted seated aircrew. HGU-55/P + MBU-20/P shapes are based on Gentex
// product photographs, not a generic spherical head with an attached visor.
import * as THREE from 'three';
import { stationSet } from './geometry/interpolation.js';
import { addDetail, tintGeometry, patchGeometry, ringLoft, roundedBlock, rodDetail, hoseGeometry, strapGeometry, quadGeometry, vector } from './detail-geometry.js';

export function addPilot(group, material) {
  const add=(name,g,mat=material.structure,p=[0,0,0])=>addDetail(group,name,g,mat,p);
  const block=(name,w,h,d,p,mat=material.structure,r=.008)=>add(name,roundedBlock(w,h,d,r),mat,p);
  const rod=(name,a,b,r,mat=material.structure)=>rodDetail(group,name,a,b,r,mat);
  const cloth=(name,g,color)=>add(name,tintGeometry(g,color),material.cloth);
  const suit=0x4c5945,harness=0x737e69,glove=0x30392e;
  function drapedLoft(stations,segments=28,folds=false) {
    const source=stations.map(s=>({x:0,z:0,...s})),sample=stationSet(source,['x','z','w','d'],'y');
    const low=source[0].y,high=source.at(-1).y;
    const dense=Array.from({length:29},(_,i)=>{const y=low+(high-low)*i/28;return{y,...sample(y)};});
    const g=ringLoft(dense,segments),p=g.attributes.position;
    if(folds)for(let i=0;i<p.count;i++) {
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),s=sample(y);
      const dx=x-s.x,dz=z-s.z,r=Math.hypot(dx,dz);if(r<1e-5)continue;
      const t=(y-low)/(high-low),a=Math.atan2(dz,dx);
      const crease=.0033*Math.exp(-Math.pow((t-.72)/.18,2))*Math.sin(t*67+a*2.4)
        +.0016*Math.sin(a*5.3+t*8)*Math.sin(t*Math.PI);
      p.setXYZ(i,x+dx/r*crease,y,z+dz/r*crease);
    }
    g.computeVertexNormals();return g;
  }
  // Pelvis, tapered abdomen, chest and shoulders form one continuous surface.
  const torsoStations=[
    {y:.515,w:.143,d:.099,z:-5.191},{y:.585,w:.151,d:.117,z:-5.176},
    {y:.665,w:.145,d:.112,z:-5.161},{y:.792,w:.178,d:.119,z:-5.132},
    {y:.947,w:.194,d:.105,z:-5.109},{y:1.014,w:.156,d:.094,z:-5.102},
    {y:1.051,w:.072,d:.069,z:-5.110},
  ];
  const torso=stationSet(torsoStations,['w','d','z'],'y');
  const torsoFront=(x,y,offset=.010)=>{
    const c=torso(y);return c.z-c.d*Math.sqrt(Math.max(0,1-(x/c.w)**2))-offset;
  };
  cloth('pilotTorso',drapedLoft(torsoStations,32,true),suit);
  // A garment crosses the joint continuously. Separate capped cylinders made
  // the previous knees and elbows look like articulated mannequin parts.
  function garment(name,stations,foldAt,color=suit) {
    const curve=new THREE.CatmullRomCurve3(stations.map(s=>vector(s.p)));
    const radii=stationSet(stations.map((s,i)=>({t:i/(stations.length-1),w:s.w,d:s.d})),['w','d'],'t');
    const axis=new THREE.Vector3(1,0,0),normal=new THREE.Vector3(),binormal=new THREE.Vector3();
    const g=patchGeometry((u,t)=>{
      const center=curve.getPoint(t),tangent=curve.getTangent(t).normalize(),r=radii(t),a=u*Math.PI*2;
      normal.copy(axis).addScaledVector(tangent,-tangent.x).normalize();
      binormal.crossVectors(tangent,normal).normalize();
      // Small tension folds die away from the compressed elbow/knee, leaving
      // the long sleeve/thigh with broad soft fabric highlights.
      const compression=Math.exp(-Math.pow((t-foldAt)/.15,2));
      const wrinkle=.0036*compression*Math.sin(t*84+Math.sin(a)*2.8)
        +.0011*Math.sin(t*37+a*3)*Math.sin(t*Math.PI);
      return center.addScaledVector(normal,Math.cos(a)*(r.w+wrinkle))
        .addScaledVector(binormal,Math.sin(a)*(r.d+wrinkle)).toArray();
    },28,54);
    const p=g.attributes.position,uv=g.attributes.uv,c=new THREE.Color(color),colors=[];
    for(let i=0;i<p.count;i++){
      const t=uv.getY(i),a=uv.getX(i)*Math.PI*2;
      const shade=1-.06*Math.exp(-Math.pow((t-foldAt)/.15,2))*(1+Math.sin(t*84+Math.sin(a)*2.8))*.5;
      colors.push(c.r*shade,c.g*shade,c.b*shade);
    }
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return add(name,g,material.cloth);
  }
  for(const s of [-1,1]) {
    garment('continuousFlightSuitLeg',[
      {p:[s*.102,.518,-5.209],w:.093,d:.095},{p:[s*.119,.514,-5.392],w:.095,d:.090},
      {p:[s*.132,.503,-5.608],w:.082,d:.082},{p:[s*.133,.482,-5.711],w:.073,d:.075},
      {p:[s*.128,.343,-5.876],w:.065,d:.065},{p:[s*.123,.208,-5.983],w:.049,d:.054},
    ],.59);
    const boot=block('flyingBoot',.103,.096,.22,[s*.123,.190,-6.033],material.cloth,.023);tintGeometry(boot.geometry,0x232a27);boot.rotation.x=.15;
    const hand=[s*.326,.680,s<0?-5.608:-5.554];
    garment('continuousFlightSuitSleeve',[
      {p:[s*.139,.961,-5.11],w:.074,d:.084},{p:[s*.205,.914,-5.117],w:.078,d:.083},
      {p:[s*.258,.787,-5.147],w:.071,d:.074},{p:[s*.272,.735,-5.190],w:.063,d:.066},
      {p:[s*.301,.700,-5.356],w:.059,d:.059},{p:[hand[0],hand[1],hand[2]+.068],w:.043,d:.041},
    ],.58);
    const cuff=block('flightSuitCuff',.081,.073,.030,[hand[0],hand[1],hand[2]+.058],material.cloth,.009);tintGeometry(cuff.geometry,0x3e4a3a);
    const palm=block('glovePalm',.070,.059,.090,[hand[0],hand[1]-.003,hand[2]],material.cloth,.016);tintGeometry(palm.geometry,glove);
    for(let i=0;i<4;i++){
      const x=hand[0]-.027+i*.018;
      cloth('curledGloveFinger',hoseGeometry([[x,hand[1]+.018,hand[2]-.022],
        [x,hand[1]+.012,hand[2]-.056],[x,hand[1]-.015,hand[2]-.055],
        [x,hand[1]-.026,hand[2]-.036]],.009,12,8),glove);
      add('gloveKnuckleStitch',hoseGeometry([[x-.004,hand[1]+.028,hand[2]-.013],
        [x,hand[1]+.031,hand[2]-.026],[x+.004,hand[1]+.027,hand[2]-.036]],.0008,8,4),material.rubber);
    }
    cloth('opposedGloveThumb',hoseGeometry([[hand[0]-s*.027,hand[1]-.006,hand[2]+.020],
      [hand[0]-s*.041,hand[1]+.009,hand[2]-.013],[hand[0]-s*.029,hand[1]+.008,hand[2]-.041]],.012,15,9),glove);
    cloth('sleeveSeam',strapGeometry([[s*.247,.898,-5.177],[s*.292,.777,-5.214],[s*.302,.722,-5.310]],.006),0x424d3e);
    cloth('thighPocket',strapGeometry([[s*.124,.587,-5.408],[s*.129,.576,-5.515],[s*.132,.563,-5.617]],.097),0x596451);
    // Low-profile survival vest: shaped panels, sewn pocket flaps and a soft
    // rolled edge. The vest stays within the existing torso/console envelope.
    cloth('survivalVestPanel',patchGeometry((u,v)=>{
      const y=.658+v*.363,x=s*(.018+u*(.120-.018*v));
      return[x,y,torsoFront(x,y,.009)];
    },10,20,s>0),0x404b3b);
    cloth('vestPocket',patchGeometry((u,v)=>{
      const x=s*(.029+u*.071),y=.713+v*.115;
      return[x,y,torsoFront(x,y,.013+.006*Math.sin(u*Math.PI)*Math.sin(v*Math.PI))];
    },10,12,s>0),0x495440);
    cloth('vestPocketFlap',patchGeometry((u,v)=>{
      const x=s*(.029+u*.071),y=.822+v*.020;return[x,y,torsoFront(x,y,.017)];
    },12,3,s>0),0x354130);
    add('vestBoundEdge',hoseGeometry([[s*.135,.671],[s*.139,.806],
      [s*.128,.946],[s*.111,1.019]].map(([x,y])=>[x,y,torsoFront(x,y,.012)]),.0022,24,6),material.rubber);
    // Restraints follow shoulders, chest and lap, instead of intersecting them.
    const strapPath=[[s*.123,1.035,-5.01],[s*.139,1.026,-5.13],
      ...[[s*.138,.944],[s*.103,.85],[s*.089,.798],[s*.076,.641]].map(([x,y])=>[x,y,torsoFront(x,y,.020)])];
    cloth('shoulderHarness',strapGeometry(strapPath,.036),harness);
    cloth('lapRestraint',strapGeometry([[s*.223,.491,-5.098],[s*.181,.564,-5.205],
      [s*.092,.583,-5.310],[s*.014,.576,-5.329]],.049,[0,1,0]),harness);
    const buckleZ=torsoFront(s*.104,.846,.024);
    const buckle=block('shoulderBuckle',.043,.039,.009,[s*.104,.846,buckleZ],material.metal,.004);buckle.rotation.z=s*.27;
    const webbingLoop=block('harnessAdjustmentTab',.025,.037,.006,[s*.112,.878,torsoFront(s*.112,.878,.024)],material.cloth,.004);tintGeometry(webbingLoop.geometry,0x6d765f);
    add('harnessBuckleSlot',quadGeometry([[s*.104-.013,.839,buckleZ-.006],[s*.104+.013,.839,buckleZ-.006],
      [s*.104+.013,.850,buckleZ-.006],[s*.104-.013,.850,buckleZ-.006]].reverse()),material.rubber);
  }
  block('harnessCentralBuckle',.058,.043,.018,[0,.581,-5.336],material.metal,.009);
  cloth('flightSuitZipper',strapGeometry([1.03,.92,.80,.66].map(y=>[0,y,torsoFront(0,y,.014)]),.006),0x777b66);
  block('zipperPull',.013,.020,.006,[0,.936,torsoFront(0,.936,.017)],material.metal,.003);
  cloth('flightSuitCollar',ringLoft([{y:1.006,w:.080,d:.075,z:-5.119},{y:1.045,w:.084,d:.075,z:-5.129},
    {y:1.080,w:.071,d:.065,z:-5.154}],24),0x4c5948);
  cloth('neckSeal',ringLoft([{y:1.046,w:.064,d:.061,z:-5.152},{y:1.095,w:.065,d:.065,z:-5.175},
    {y:1.174,w:.060,d:.067,z:-5.205}],24),0x343e33);
  add('helmetFaceLiner',ringLoft([{y:1.113,w:.054,d:.061,z:-5.231},{y:1.171,w:.086,d:.101,z:-5.237},
    {y:1.248,w:.101,d:.121,z:-5.235},{y:1.301,w:.080,d:.090,z:-5.230}],28),material.rubber);

  const head=[0,1.239,-5.235];
  const edgePoint=theta=>{
    const front=Math.max(0,Math.cos(theta)),phi=2.13-1.12*front**3;
    return [.116*Math.sin(phi)*Math.sin(theta),head[1]+.142*Math.cos(phi),head[2]-.140*Math.sin(phi)*Math.cos(theta)];
  };
  add('HGU55HelmetShell',patchGeometry((u,v)=>{
    const theta=u*Math.PI*2,front=Math.max(0,Math.cos(theta)),phi=v*(2.13-1.12*front**3);
    return [.116*Math.sin(phi)*Math.sin(theta),head[1]+.142*Math.cos(phi),head[2]-.140*Math.sin(phi)*Math.cos(theta)];
  },48,20),material.helmet);
  add('helmetLeatherEdgeRoll',hoseGeometry(Array.from({length:49},(_,i)=>edgePoint(i/48*Math.PI*2)),.0045,64,7),material.rubber);
  const visorPoint=(u,v)=>{
    const theta=(u*2-1)*1.43,top=1.316-.037*(Math.abs(theta)/1.43)**1.6;
    const bottom=1.202+.023*Math.exp(-((theta/.25)**2))-.010*(Math.abs(theta)/1.43);
    return [.123*Math.sin(theta),top+(bottom-top)*v,head[2]-.152*Math.cos(theta)-.010*Math.sin(v*Math.PI)];
  };
  add('HGU55DarkVisor',patchGeometry(visorPoint,40,10),material.visor);
  for(const v of [0,1])add('visorRubberRim',hoseGeometry(Array.from({length:25},(_,i)=>visorPoint(i/24,v)),.003,32,6),material.rubber);
  for(const s of [-1,1]) {
    block('maskBayonetReceiver',.021,.045,.027,[s*.113,1.183,-5.274],material.metal,.008);
    cloth('visorRetentionStrap',strapGeometry([[s*.115,1.266,-5.278],[s*.122,1.266,-5.228],[s*.104,1.263,-5.163]],.016,[0,1,0]),0x303a35);
    add('maskRetentionWebbing',hoseGeometry([[s*.043,1.179,-5.394],[s*.086,1.181,-5.358],[s*.116,1.187,-5.284]],.005,16,6),material.rubber);
  }
  // Mask cup: cheek wings, nose bridge and tapered chin. No separate sphere.
  add('MBU20OxygenMask',ringLoft([
    {y:1.126,w:.030,d:.023,z:-5.376,exponent:.78},{y:1.144,w:.049,d:.034,z:-5.385,exponent:.76},
    {y:1.182,w:.053,d:.037,z:-5.386,exponent:.80},{y:1.213,w:.037,d:.032,z:-5.379,exponent:.83},
    {y:1.231,w:.014,d:.019,z:-5.378},
  ],24),material.mask);
  add('maskFaceSeal',hoseGeometry([[-.035,1.210,-5.372],[-.056,1.184,-5.354],[-.048,1.141,-5.358],
    [0,1.123,-5.362],[.048,1.141,-5.358],[.056,1.184,-5.354],[.035,1.210,-5.372]],.004,32,6),material.rubber);
  rod('maskBreathingValve',[0,1.155,-5.414],[0,1.155,-5.424],.018,material.rubber);
  add('corrugatedOxygenHose',hoseGeometry([[.009,1.133,-5.397],[.042,1.062,-5.407],
    [.116,.950,-5.353],[.176,.787,-5.339],[.223,.648,-5.277],[.247,.608,-5.164]],.016,120,9,34),material.mask);
  rod('oxygenQuickDisconnect',[.238,.614,-5.194],[.251,.606,-5.134],.021,material.metal);
}
