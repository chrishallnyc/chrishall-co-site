import * as THREE from 'three';
import {curveSegments,buildLevel} from './quality.js';
import {cutWindowOpenings} from './window-openings.js';
import {
  Airframe, TAU, airfoilHeight, fin, loft, meshGeometry, ribbon,
  sampleSection, sectionShell, wing, segmentedWing,
} from './geometry.js';

// C-17-inspired proportions at the game's intentional, roughly 30 m scale.
// +Z is forward. The high wing and upswept cargo tail establish the shape;
// no simulation envelope or hit-volume dimensions are changed here.
export const TRANSPORT_EXTENT = { span: 31, length: 31, height: 14 };
const BODY = [
  [-14.9, .045, .075, 1.12, 1],
  [-14.1, .31, .29, 1.04, 1.16],
  [-12.65, .73, .58, .82, 1.28],
  [-10.35, 1.16, 1.03, .49, 1.17],
  [-8.0, 1.53, 1.47, .18, 1.08],
  [-5.0, 1.80, 1.91, .035, 1.01],
  [-1.0, 1.88, 2.07, .025, .985],
  [5.9, 1.88, 2.06, .025, .99],
  [8.5, 1.83, 2.00, .01, 1],
  [10.3, 1.73, 1.82, -.02, 1.025],
  [11.6, 1.58, 1.65, -.025, 1.09],
  [12.7, 1.36, 1.20, -.27, 1.18],
  [13.7, 1.08, 1.01, -.40, 1.12],
  [14.5, .70, .74, -.40, 1.015],
  [14.73, .53, .56, -.41, 1],
  [14.90, .345, .36, -.42, 1],
  [14.975, .16, .167, -.42, 1],
  [15.0, .006, .006, -.42, 1],
];
const WING = [
  [0, 1.53, 4.37, -1.55, .50],
  [1.25, 1.53, 4.37, -1.55, .53],
  [2.20, 1.53, 3.89, -1.83, .53],
  [6.1, 1.37, 1.40, -3.35, .42],
  [10.65, 1.10, -1.43, -4.73, .25],
  [14.30, .88, -3.60, -5.12, .075],
];
const SPONSON = [
  [-6.65, .045, .065, .02], [-5.3, .47, .48, -.03],
  [-3.5, .66, .66, -.04], [.35, .65, .66, 0],
  [2.20, .47, .46, .10], [3.25, .045, .07, .22],
];
const COCKPIT_PANES = [
  [.045, .415, 11.88, 13.08, .07],
  [.453, .805, 11.75, 12.99, .23],
  [.845, 1.155, 11.30, 12.63, .40],
];

function sectionPoint(rows, theta, z, offset = 0) {
  const [, w, h, cy, lower = 1] = sampleSection(rows, z);
  const c = Math.cos(theta);
  return [Math.sin(theta) * (w + offset), cy + c * (h * (c < 0 ? lower : 1) + offset), z];
}

function cargoShell() {
  const geometry=loft(BODY,64,true,3),p=geometry.attributes.position;
  const originalNormals=geometry.attributes.normal.clone(),reshaped=new Uint8Array(p.count);
  // Shape the original upper hull into a shoulder under the wing box.
  // This stays one watertight shell, including at both tapered ends.
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),[,width,height,centre]=sampleSection(BODY,z);
    const envelope=THREE.MathUtils.smoothstep(z,-4.1,-1.1)*(1-THREE.MathUtils.smoothstep(z,3.1,5.5));
    const elevation=(y-centre)/height;
    const shoulder=THREE.MathUtils.smoothstep(elevation,.38,.80)*envelope;
    reshaped[i]=Number(shoulder>0);
    const u=Math.min(1,Math.abs(x)/Math.max(.001,width));
    const target=Math.sign(x)*width*1.075*Math.pow(u,.58);
    p.setX(i,THREE.MathUtils.lerp(x,target,shoulder));
  }
  geometry.computeVertexNormals();
  // Keep the analytic loft normals on the untouched nose, belly and tail.
  // Re-averaging their unequal rings would reintroduce the highlight bands.
  const normals=geometry.attributes.normal;
  for(let i=0;i<p.count;i++)if(!reshaped[i])normals.setXYZ(i,originalNormals.getX(i),originalNormals.getY(i),originalNormals.getZ(i));
  return geometry;
}

function wingSection(x) {
  let i = 0;
  while (i < WING.length - 2 && x > WING[i + 1][0]) i++;
  const a = WING[i], b = WING[i + 1], t = (x - a[0]) / (b[0] - a[0]);
  return a.map((v, k) => THREE.MathUtils.lerp(v, b[k], t));
}

function ring(radius, z, squash = 1, count = 40) {
  count=curveSegments(count);
  return Array.from({ length: count }, (_, i) => {
    const t = i / count * TAU;
    return [Math.sin(t) * radius, Math.cos(t) * radius * squash, z];
  });
}

function frontDisc(radius, z, segments = 40) {
  segments=curveSegments(segments);
  const p = [0, 0, z], ix = [];
  for (let i = 0; i < segments; i++) p.push(Math.sin(i / segments * TAU) * radius, Math.cos(i / segments * TAU) * radius, z);
  for (let i = 0; i < segments; i++) ix.push(0, (i + 1) % segments + 1, i + 1);
  return meshGeometry(p, ix);
}

// These paths already sample their parent surface closely. Sampling them
// three more times adds thousands of invisible triangles to door seams.
function detailTube(points, radius = .010, radial = 4) {
  return new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))),
    Math.max(4, points.length - 1), radius, radial, false,
  );
}

function fanBlades() {
  const p=[],ix=[],count=buildLevel()===0?28:20,radial=buildLevel()===0?5:4,chord=buildLevel()===0?4:3;
  for(let blade=0;blade<count;blade++) {
    const base=blade/count*TAU,first=p.length/3,row=chord+1,layer=(radial+1)*row;
    for(let face=0;face<2;face++)for(let i=0;i<=radial;i++)for(let j=0;j<=chord;j++) {
      const u=i/radial,v=j/chord,r=.17+u*.445;
      const t=base+u*u*.115+(v-.5)*(TAU/count)*(.98+.45*(1-u));
      const z=.875-u*.075+(v-.5)*(.13-u*.055)+Math.sin(v*Math.PI)*.025+(face?-.006:.006);
      p.push(Math.sin(t)*r,Math.cos(t)*r,z);
    }
    for(let face=0;face<2;face++)for(let i=0;i<radial;i++)for(let j=0;j<chord;j++) {
      const n=first+face*layer+i*row+j,tris=[n,n+row,n+1,n+1,n+row,n+row+1];
      for(let q=0;q<6;q+=3)ix.push(...(face?tris.slice(q,q+3):tris.slice(q,q+3).reverse()));
    }
    const edge=(a,b)=>ix.push(first+a,first+b,first+a+layer,first+b,first+b+layer,first+a+layer);
    for(let i=0;i<radial;i++){edge(i*row,(i+1)*row);edge((i+1)*row+chord,i*row+chord);}
    for(let j=0;j<chord;j++){edge(j+1,j);edge(radial*row+j,radial*row+j+1);}
  }
  return meshGeometry(p,ix);
}

function nacelle(a, x, y, z, name, rotors) {
  const position = [x, y, z];
  const cowlRows=[
    [-1.77, .50, .50], [-1.26, .67, .66], [-.55, .795, .785],
    [.40, .84, .817], [1.05, .837, .807], [1.50, .817, .792],
  ];
  a.add(loft(cowlRows, 40, false, 2), 'skin', { position, name: `${name}-cowl` });

  // One continuous rounded annular lip joins the cowl to an actual duct.
  // Its section doubles back into the aperture, giving both thickness and
  // outward/front-facing normals without a solid disk across the mouth.
  a.add(sectionShell([
    ring(.817, 1.50, .97), ring(.797, 1.64, .97),
    ring(.758, 1.715, .97), ring(.719, 1.713, .98),
    ring(.687, 1.657, .99), ring(.677, 1.565),
  ]), 'machined', { position, name: `${name}-rounded-inlet-lip`, tint: [.90,.93,.95] });
  const duct=sectionShell([ring(.677,1.565),ring(.667,1.38),ring(.655,1.17),ring(.639,.99),ring(.622,.73)]);
  const ductColors=[],ductPositions=duct.attributes.position;
  for(let i=0;i<ductPositions.count;i++) {
    const depth=THREE.MathUtils.smoothstep(ductPositions.getZ(i),.73,1.565),shade=.36+depth*.84;
    ductColors.push(shade*.89,shade*.95,shade);
  }
  duct.setAttribute('color',new THREE.Float32BufferAttribute(ductColors,3));
  a.add(duct,'trim',{position,name:`${name}-recessed-inlet-duct`});
  a.add(frontDisc(.624, .70), 'cavity', { position, name: `${name}-fan-shadow` });
  const fan=buildLevel()<2?new Airframe(`${name}-fan`,{...a.materials,metal:a.materials.fan},TRANSPORT_EXTENT):a;
  const fanPosition=fan===a?position:[0,0,0];
  if(fan!==a)fan.add(fanBlades(),'metal',{name:`${name}-fan-stator`,tint:[.79,.83,.85]});
  fan.add(loft([
    [.71, .185, .185], [.93, .174, .174], [1.15, .105, .105], [1.27, .012, .012],
  ], 28, true, 3), 'metal', { position:fanPosition, name: `${name}-fan-spinner`, tint: [.34,.37,.38] });
  if(fan!==a){const rotor=fan.finish();rotor.name=`bandit-fan-${name}`;rotor.position.set(...position);rotors.push(rotor);}

  a.add(sectionShell([
    ring(.393, -2.20), ring(.438, -2.01), ring(.50, -1.77),
  ]), 'metal', { position, name: `${name}-exhaust-cone`, tint: [.67, .63, .58] });
  a.add(sectionShell([
    ring(.50, -1.77), ring(.345, -1.88), ring(.35, -2.20), ring(.393, -2.20),
  ]), 'cavity', { position, name: `${name}-exhaust-liner` });
  const back = frontDisc(.35, -1.80);
  const backIndex = back.index;
  for (let i = 0; i < backIndex.count; i += 3) {
    const b = backIndex.getX(i + 1);
    backIndex.setX(i + 1, backIndex.getX(i + 2)); backIndex.setX(i + 2, b);
  }
  back.computeVertexNormals();
  a.add(back, 'cavity', { position, name: `${name}-exhaust-shadow` });
  a.add(loft([
    [-2.41, .008, .008], [-2.18, .13, .13], [-1.78, .215, .215],
  ], 20, true, 2), 'metal', { position, name: `${name}-core-plug`, tint: [.40, .37, .33] });

  // A restrained circumferential cowl joint carries scale without adding
  // raised bands to every engine station.
  const seam = ring(.846, .36, .972, 36); seam.push(seam[0]);
  a.add(detailTube(seam, .008, 4), 'trim', { position, name: `${name}-cowl-joint`, tint: [1.25, 1.25, 1.25] });
  for(const t of [-1.18,1.18]) {
    const path=[-.9,-.7,-.45,-.2,.1,.36,.66,.85,1.05].map(axial=>sectionPoint(cowlRows,t,axial,.009));
    a.add(detailTube(path,.006,4),'trim',{position,name:`${name}-cowl-service-seam`,tint:[1.34,1.36,1.37]});
    for(const axial of [-.52,.09,.66]) {
      const latch=new THREE.BoxGeometry(.055,.016,.115);latch.rotateZ(-t);
      const at=sectionPoint(cowlRows,t,axial,.018);
      a.add(latch,'metal',{position:[x+at[0],y+at[1],z+axial],name:`${name}-cowl-fastener`,tint:[.60,.63,.64]});
    }
  }
}

function cockpitPane(a, side, index, bounds) {
  const [lo, hi, aft, fore, skew] = bounds, p = [], ix = [], axial = 4, angular = 3;
  const at = (u, v, off = .006) => {
    const theta = THREE.MathUtils.lerp(lo, hi, u);
    const z = THREE.MathUtils.lerp(aft, fore, v) - skew * u;
    const q = sectionPoint(BODY, theta, z, off); q[0] *= side; return q;
  };
  for (let j = 0; j <= angular; j++) for (let k = 0; k <= axial; k++) {
    p.push(...at(j / angular, k / axial));
    if (j && k) {
      const i = j * (axial + 1) + k, prev = i - axial - 1;
      const tris = [prev - 1, i - 1, prev, prev, i - 1, i];
      for (let t = 0; t < tris.length; t += 3) ix.push(...(side > 0 ? tris.slice(t, t + 3).reverse() : tris.slice(t, t + 3)));
    }
  }
  a.add(meshGeometry(p, ix), 'glass', { name: `cockpit-${side > 0 ? 'right' : 'left'}-pane-${index}` });
  const paneBand=(outer,inner,offset)=> {
    const points=[],indices=[],perimeter=[];
    for(let j=0;j<6;j++)perimeter.push([0,j/6]);
    for(let j=0;j<4;j++)perimeter.push([j/4,1]);
    for(let j=0;j<6;j++)perimeter.push([1,1-j/6]);
    for(let j=0;j<4;j++)perimeter.push([1-j/4,0]);
    for(const [u,v]of perimeter)for(const margin of [outer,inner])
      points.push(...at(THREE.MathUtils.lerp(margin[0],1-margin[0],u),THREE.MathUtils.lerp(margin[1],1-margin[1],v),offset));
    for(let j=0;j<perimeter.length;j++) {
      const a=j*2,b=(j+1)%perimeter.length*2,tris=[a,b,a+1,a+1,b,b+1];
      for(let k=0;k<6;k+=3)indices.push(...(side>0?tris.slice(k,k+3):tris.slice(k,k+3).reverse()));
    }
    return meshGeometry(points,indices);
  };
  // Surface-following flat retainers seat each pane into the hull. Round
  // wire outlines caught a metallic glint and obscured the layered seal.
  const prefix=`cockpit-${side>0?'right':'left'}-frame`;
  a.add(paneBand([-.014,-.010],[.034,.024],.016),'cavity',{name:`${prefix}-inner-gasket-${index}`,tint:[.8,.84,.81]});
  a.add(paneBand([-.044,-.029],[-.010,-.008],.028),'skin',{name:`${prefix}-painted-retainer-${index}`,tint:[.86,.90,.91]});
  if(index===1) {
    const arm=[at(.28,.09,.057),at(.36,.51,.063)],blade=[at(.16,.49,.067),at(.52,.57,.067)];
    a.add(detailTube(arm,.012,4),'trim',{name:'cockpit-windshield-wiper-arm',tint:[.48,.5,.5]});
    a.add(detailTube(blade,.015,4),'trim',{name:'cockpit-windshield-wiper-blade',tint:[.3,.32,.31]});
  }
}

function surfaceOutline(a, rows, thetaLo, thetaHi, aft, fore, name, options = {}) {
  const points = [], steps = 10, offset = options.offset ?? .012;
  const at = (t, z) => sectionPoint(rows, t, z, offset);
  for (let i = 0; i <= steps; i++) points.push(at(thetaLo, THREE.MathUtils.lerp(aft, fore, i / steps)));
  for (let i = 1; i <= steps; i++) points.push(at(THREE.MathUtils.lerp(thetaLo, thetaHi, i / steps), fore));
  for (let i = 1; i <= steps; i++) points.push(at(thetaHi, THREE.MathUtils.lerp(fore, aft, i / steps)));
  for (let i = 1; i <= steps; i++) points.push(at(THREE.MathUtils.lerp(thetaHi, thetaLo, i / steps), aft));
  a.add(detailTube(points, options.radius ?? .010, 4), 'trim', {
    name, position: options.position, tint: [1.3, 1.3, 1.3],
  });
}

export function buildTransport(materials) {
  const a = new Airframe('bandit-transport', materials, TRANSPORT_EXTENT),rotors=[];
  a.add(cutWindowOpenings(cargoShell(),BODY,COCKPIT_PANES), 'skin', { name: 'cargo-fuselage' });
  materials.glass.color.setHex(0x233940);materials.glass.roughness=.13;materials.glass.envMapIntensity=.58;materials.glass.specularIntensity=.62;materials.glass.clearcoat=.42;materials.glass.clearcoatRoughness=.09;materials.glass.iridescence=.025;materials.glass.transparent=true;materials.glass.opacity=.69;materials.glass.depthWrite=false;
  a.add(new THREE.BoxGeometry(2.1,.16,2.65),'cavity',{position:[0,.11,11.84],name:'cockpit-interior-floor'});
  const bulkhead=[0,.15,10.93],bulkheadIndex=[];
  for(let i=0;i<=24;i++) {
    bulkhead.push(...sectionPoint(BODY,-1.4+i/24*2.8,10.93,-.08));
    if(i)bulkheadIndex.push(0,i,i+1);
  }
  a.add(meshGeometry(bulkhead,bulkheadIndex),'cavity',{name:'cockpit-aft-bulkhead'});
  const dashboard=new THREE.BoxGeometry(1.81,.18,.36);dashboard.rotateX(.18);
  a.add(dashboard,'cavity',{position:[0,.52,12.57],name:'cockpit-instrument-dashboard'});
  for(const side of [-1,1]) {
    const seat=new THREE.BoxGeometry(.40,.56,.16);seat.rotateX(-.14);
    a.add(seat,'trim',{position:[side*.49,.65,11.52],name:'cockpit-crew-seat',tint:[.42,.46,.44]});
    const body=new THREE.SphereGeometry(1,12,8);body.scale(.175,.23,.12);
    a.add(body,'crew',{position:[side*.49,.65,11.74],name:'cockpit-crew-flight-suit',tint:[.080,.094,.060]});
    const head=new THREE.SphereGeometry(.128,16,10);head.scale(1,1.08,.94);
    a.add(head,'crew',{position:[side*.49,.975,11.78],name:'cockpit-crew-head',tint:[.45,.30,.20]});
    const hair=new THREE.SphereGeometry(.130,12,6,0,TAU,0,Math.PI*.43);hair.scale(1,1.08,.94);
    a.add(hair,'trim',{position:[side*.49,.977,11.78],name:'cockpit-crew-hair',tint:[.24,.21,.17]});
    const headset=[];
    for(let i=0;i<=10;i++){const t=-Math.PI/2+i/10*Math.PI;headset.push([side*.49+Math.sin(t)*.139,.982+Math.cos(t)*.151,11.775]);}
    a.add(detailTube(headset,.014,4),'trim',{name:'cockpit-crew-headset',tint:[.39,.42,.4]});
    for(const ear of [-1,1]) {
      a.add(new THREE.BoxGeometry(.036,.076,.061),'trim',{position:[side*.49+ear*.137,.982,11.775],name:'cockpit-crew-earphone',tint:[.38,.40,.38]});
      a.add(detailTube([[side*.49+ear*.10,.83,11.73],[side*.49+ear*.072,.72,11.855],[side*.49+ear*.105,.51,11.80]],.018,4),'crew',{name:'cockpit-crew-shoulder-harness',tint:[.16,.15,.12]});
    }
    const screen=new THREE.BoxGeometry(.18,.11,.01);screen.rotateX(.13);
    a.add(screen,'glass',{position:[side*.38,.56,12.381],name:'cockpit-instrument-screen',tint:[.37,.67,.57]});
  }

  // Both wings continue all the way to the centreline, where their end
  // caps are buried inside the cargo shell. Stopping at x=1.25 exposes
  // an upright root cap above the curved body and breaks the wing box.

  for (const side of [-1, 1]) {
    const label = side > 0 ? 'right' : 'left';
    a.add(segmentedWing(WING, side < 0, 28,{cut:.765,gap:.003}), 'skin', { name: `${label}-main-wing` });
    a.add(fin([
      [0, 0, -3.60, -5.12, .085], [.48, 0, -3.92, -5.12, .06],
      [1.53, 0, -4.63, -5.20, .024],
    ], side * 14.30, .88, side * .22), 'skin', { name: `${label}-winglet` });

    for (const [engineIndex, x, z] of [[1, 4.55, 2.25], [2, 9.2, -.40]]) {
      const [, wy, le, te] = wingSection(x), y = engineIndex === 1 ? .04 : -.21;
      // Pylon penetrates the cowl and the lower wing surface at both ends.
      a.add(fin([
        [0,0,z+1.06,z-1.36,.17],
        [(wy-y-.50)*.35,0,z+.94,z-1.38,.205],
        [(wy-y-.50)*.74,0,le-.15,te+.73,.18],
        [wy-y-.50,0,le-.08,te+.64,.12],
      ], side * x, y + .48), 'skin', { name: `${label}-engine-${engineIndex}-pylon` });
      nacelle(a, side * x, y, z, `${label}-engine-${engineIndex}`,rotors);
    }

    const hinge = [2.22, 4.5, 6.1, 8.4, 10.65, 12.8, 14.1].map(x => {
      const [, y, le, te, h] = wingSection(x), t = .77;
      return [side * x, y + airfoilHeight(t, h) + .012, THREE.MathUtils.lerp(le, te, t)];
    });
    a.add(ribbon(hinge, .018), 'trim', { name: `${label}-flap-aileron-hinge`, tint: [1.26, 1.26, 1.26] });
    for (const [i, x] of [3.45, 6.9, 10.7].entries()) {
      const [, wy, , te, h] = wingSection(x);
      const profile = [
        [-1.02, .025, .035, .07], [-.55, .12, .13, -.015],
        [.24, .16, .15, 0], [1.05, .13, .105, .055], [1.55, .025, .025, .10],
      ].map(([z, w, height, cy]) => [z, w, height * h / .53, cy * h / .53]);
      a.add(loft(profile, 16, true, 2), 'skin', { position: [side * x, wy - h * .37, te + .21], name: `${label}-flap-track-${i + 1}` });
    }

    a.add(loft(SPONSON, 28, true, 3), 'skin', { position: [side * 1.66, -1.14, 0], name: `${label}-main-gear-sponson` });
    const thetaLo = side > 0 ? 1.16 : -2.19, thetaHi = side > 0 ? 2.19 : -1.16;
    surfaceOutline(a, SPONSON, thetaLo, thetaHi, -4.6, 1.35, `${label}-flush-main-gear-door`, { position: [side * 1.66, -1.14, 0], radius: .012 });

    // Glazing spans real openings. Solid strips between the six panes
    // remain structural mullions, with a visible cockpit behind them.
    COCKPIT_PANES.forEach((pane, i) => cockpitPane(a, side, i + 1, pane));

    const doorTheta = side > 0 ? [1.09, 1.96] : [-1.96, -1.09];
    surfaceOutline(a, BODY, ...doorTheta, 8.70, 9.53, `${label}-forward-crew-door`, { radius: .009 });
    surfaceOutline(a, BODY, ...doorTheta, -7.58, -6.78, `${label}-rear-escape-door`, { radius: .009 });
    const handle = sectionPoint(BODY, side * 1.57, 9.0, .027);
    a.add(detailTube([[handle[0], handle[1] + .12, 8.98], [handle[0], handle[1] + .12, 9.19]], .015, 4), 'metal', { name: `${label}-crew-door-handle`, tint: [.75, .75, .72] });

    a.add(wing([
      [0, 6.36, -10.03, -13.62, .24], [2.9, 6.30, -11.07, -14.03, .16],
      [5.48, 6.23, -12.18, -14.49, .061],
    ], side < 0, 20), 'skin', { name: `${label}-t-tailplane` });
    a.add(ribbon([
      [side * .34, 6.405, -12.66], [side * 2.8, 6.375, -13.23], [side * 5.35, 6.275, -13.92],
    ], .017), 'trim', { name: `${label}-elevator-hinge`, tint: [1.3, 1.3, 1.3] });

    a.add(new THREE.SphereGeometry(.064, 10, 6), 'light', {
      position: [side * 14.45, 1.38, -4.15], name: `${label}-navigation-light`,
      tint: side < 0 ? [1, .12, .09] : [.18, 1, .45],
    });
  }

  a.add(fin([
    [0, 0, -7.1, -13.05, .29], [1.4, 0, -8.0, -13.39, .24],
    [3.75, 0, -9.75, -13.68, .15], [5.10, 0, -10.2, -13.71, .085],
  ], 0, 1.17), 'skin', { name: 'vertical-tail' });
  for (const side of [-1, 1]) {
    a.add(ribbon([
      [side * .082, 2.02, -12.31], [side * .064, 4.50, -12.91], [side * .031, 6.25, -13.03],
    ], .017, [side, 0, 0]), 'trim', { name: `${side > 0 ? 'right' : 'left'}-rudder-hinge`, tint: [1.2, 1.2, 1.2] });
  }

  surfaceOutline(a, BODY, 2.39, 3.893, -12.52, -7.40, 'closed-aft-cargo-ramp', { radius: .012 });
  surfaceOutline(a, BODY, 2.91, 3.373, 10.0, 12.3, 'flush-nose-gear-doors', { radius: .010 });
  const keel = [10.0, 10.6, 11.2, 11.8, 12.3].map(z => sectionPoint(BODY, Math.PI, z, .014));
  a.add(detailTube(keel, .008, 4), 'trim', { name: 'nose-gear-door-centre-seam', tint: [1.25, 1.25, 1.25] });

  a.add(loft([
    [-1.08, .025, .025, 0], [-.42, .32, .16, .04], [.35, .31, .17, .05], [.94, .05, .045, .025],
  ], 20, true, 2), 'dielectric', { position: [0, 2.07, 6.40], name: 'dorsal-satcom-fairing', tint: [1.03, 1.04, 1.04] });
  for (const z of [3.18, -4.33]) {
    const [, , h, cy] = sampleSection(BODY, z);
    a.add(fin([[0, 0, z + .25, z - .20, .037], [.30, 0, z + .09, z - .18, .017]], 0, cy + h - .045), 'dielectric', { name: `dorsal-blade-antenna-${z > 0 ? 'forward' : 'aft'}` });
  }
  a.add(new THREE.SphereGeometry(.078, 12, 8), 'light', { position: [0, 2.16, -2.22], name: 'upper-anti-collision-beacon', tint: [1, .16, .11] });
  const group=a.finish();if(rotors.length)group.add(...rotors);
  group.userData.aircraft.fanRotors=rotors.map(rotor=>rotor.name);
  return group;
}
