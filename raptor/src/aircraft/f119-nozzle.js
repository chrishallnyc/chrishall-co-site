// F119 two-dimensional nozzle. Coordinates are relative to the existing
// pitch-vectoring hinge; +Z is aft. The central trailing point is z=1.36.
// The paddle outline follows the public NAWDC orthographic and DVIDS 8587030
// photographs. Internal corrugations are a visual approximation, not CAD.
import * as THREE from 'three';
import { surfacePatch } from './geometry/patch.js';
import { stationSet } from './geometry/interpolation.js';
import { mergeDetails } from './hardware.js';
import { rodDetail } from './detail-geometry.js';
import { f119Detail } from './f119-detail.js';

const profile = stationSet([
  { z: -.14, width: .550, height: .429 },
  { z: .10, width: .560, height: .416 },
  { z: .42, width: .544, height: .261 },
  { z: .75, width: .536, height: .264 },
  { z: 1.36, width: .535, height: .305 },
], ['width', 'height']);
const endAt = x => 1.36 - .494 * Math.abs(x) / .535;
const tones = [
  [0, new THREE.Color('#3b474c')], [.24, new THREE.Color('#465052')],
  [.43, new THREE.Color('#2e373b')], [.60, new THREE.Color('#535756')],
  [.86, new THREE.Color('#454a4d')], [1, new THREE.Color('#323a3e')],
];

function metalColors(geometry, plate = 0, role = 'outer') {
  const p = geometry.attributes.position, colors = new Float32Array(p.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp((p.getZ(i) + .14) / 1.5, 0, 1);
    let j = 0;
    while (j < tones.length - 2 && t > tones[j + 1][0]) j++;
    color.copy(tones[j][1]).lerp(tones[j + 1][1],
      (t - tones[j][0]) / (tones[j + 1][0] - tones[j][0]));
    // Subtle unequal oxidation between overlapping metal leaves. Never use
    // HDR colours to simulate heat; engine radiance belongs to FlightFX.
    if (role === 'liner') {
      color.set('#555651');
      color.multiplyScalar(.13 + .87 * THREE.MathUtils.smoothstep(p.getZ(i), -.4, 1.22));
    }
    if (role === 'cover') color.multiplyScalar(.78);
    color.multiplyScalar(1 + .08 * Math.sin(plate * 2.399));
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function leafPoint(sign, plate, u, v, convergent = false) {
    const fraction = (plate + .018 + u * .964) / 9;
    const xEnd = (fraction * 2 - 1) * .535;
    // Two overlapping formed sheets meet at the convergent/divergent knee.
    // Their small physical step reads under moving light, unlike a dark line
    // painted across a single flat paddle.
    const z = convergent ? -.12 + .553 * v : .418 + (endAt(xEnd) - .418) * v;
    const s = profile(z), x = (fraction * 2 - 1) * s.width;
    const envelope = Math.sin(Math.PI * v);
    const rib = .0055 * Math.sin(Math.PI * u) ** 2 * envelope;
    const lap = .006 * (1 - THREE.MathUtils.smoothstep(u, 0, .18)) * envelope;
    const shoulder = sign > 0 ? .125 * (1 - THREE.MathUtils.smoothstep(z, -.14, .38)) *
      (1 - ((fraction * 2 - 1) ** 2)) : 0;
    const overlap = convergent ? .007 * THREE.MathUtils.smoothstep(v, .55, .95) : 0;
    return [x, sign * (s.height + rib + shoulder + lap + overlap), z];
}

function leaf(sign, plate, segments, convergent = false, across = 6) {
  return metalColors(surfacePatch((u, v) => leafPoint(sign, plate, u, v, convergent), {
    uSegments: across, vSegments: segments, reverse: sign > 0,
    name: convergent ? 'F119-convergent-cover' : 'F119-divergent-petal',
  }), plate, convergent ? 'cover' : 'outer');
}

export function buildF119Nozzle({ quality = 'high' } = {}) {
  const group = new THREE.Group(); group.name = 'F119-nozzle';
  const detail = f119Detail(quality);
  // The oxidized shell, satin wear edges and heat-affected liner have distinct
  // responses. A bright ceramic plane must not fill the apparent nozzle depth.
  const metal = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true,
    roughness: .68, metalness: .86, envMapIntensity: .78, side: THREE.DoubleSide,
    normalMap: detail?.normal ?? null, normalScale: new THREE.Vector2(.65, .35),
    roughnessMap: detail?.roughness ?? null });
  metal.name = 'F119-oxidized-titanium';
  const lining = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true,
    roughness: .92, metalness: .14, side: THREE.DoubleSide,
    roughnessMap: detail?.roughness ?? null });
  lining.name = 'F119-heat-affected-liner';
  const edge = new THREE.MeshStandardMaterial({color: 0x777f7e,
    roughness: .43, metalness: .87, envMapIntensity: .72, side: THREE.DoubleSide});
  edge.name = 'F119-satin-wear-edges';
  const shadow = new THREE.MeshStandardMaterial({ color: 0x080a0b,
    roughness: .97, metalness: 0, side: THREE.DoubleSide });
  shadow.name = 'F119-deep-throat';
  const longitudinal = quality === 'low' ? 7 : quality === 'medium' ? 12 : 20;
  const across = quality === 'low' ? 2 : quality === 'medium' ? 4 : 6;
  const add = (name, geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    group.add(mesh); return mesh;
  };

  // Broad fixed transition shrouds bridge the coated deck into the segmented
  // hot section. They overlap the forward leaf ends by a few millimetres and
  // leave a recessed witness line, rather than exposing a row of open strips.
  for(const sign of [-1,1]) {
    add(`forward-shroud-${sign}`,metalColors(surfacePatch((u,v)=>{
      const fraction=u*2-1,z=-.15+.235*v,s=profile(z);
      const shoulder=sign>0 ? .125*(1-THREE.MathUtils.smoothstep(z,-.14,.38))*(1-fraction*fraction) : 0;
      const overlap=.007+.004*Math.sin(v*Math.PI);
      return[fraction*(s.width+.002),sign*(s.height+shoulder+overlap),z];
    },{uSegments:quality==='low'?10:24,vSegments:quality==='low'?3:7,reverse:sign>0,
      name:'F119-transition-shroud'}),2),metal);
    add(`shroud-recess-${sign}`,surfacePatch((u,v)=>{
      const x=(u*2-1)*.557,z=.083+v*.013,s=profile(z);
      const shoulder=sign>0 ? .125*(1-THREE.MathUtils.smoothstep(z,-.14,.38))*(1-(x/.557)**2) : 0;
      return[x,sign*(s.height+shoulder+.002),z];
    },{uSegments:quality==='low'?10:24,vSegments:1,reverse:sign>0,name:'F119-shroud-recess'}),shadow);
  }

  for (const sign of [-1, 1]) {
    for (let plate = 0; plate < 9; plate++) {
      add(`convergent-cover-${sign}-${plate}`, leaf(sign, plate, Math.max(4, Math.ceil(longitudinal * .55)), true, across), metal);
      add(`paddle-${sign}-${plate}`, leaf(sign, plate, longitudinal, false, across), metal);
      // Folded return on the cover makes its aft overlap physically thin.
      add(`cover-return-${sign}-${plate}`, metalColors(surfacePatch((u, v) => {
        const p = leafPoint(sign, plate, u, 1, true); p[1] -= sign * v * .007;
        p[2] -= v * .002; return p;
      }, {uSegments: across, vSegments: 1, reverse: sign < 0, name: 'F119-cover-return'}), plate, 'cover'), metal);
      // The formed lap itself catches the highlight. A second satin sheet
      // less than a millimetre above it caused unstable subpixel depth bands
      // in the whole-aircraft view; reserve the wear material for solid rims.
    }

    // Continuous liner closes the hairline gaps between leaves. Corrugation
    // is geometrical at close range and tapers away near the exhaust rim.
    add(`liner-${sign}`, metalColors(surfacePatch((u, v) => {
      const x = (u * 2 - 1) * .510, z = -.37 + (endAt(x) + .35) * v;
      const s = profile(Math.max(-.14, z));
      const ripple = quality === 'low' ? 0 : .003 * Math.cos(u * Math.PI * 2 * 18);
      return [x, sign * (s.height - .024 + ripple * Math.sin(Math.PI * v)), z];
    }, { uSegments: quality === 'low' ? 10 : 72, vSegments: longitudinal,
      reverse: sign < 0, name: 'F119-corrugated-liner' }), 0, 'liner'), lining);

    // A physically thin edge seals the chevron without capping the mouth.
    add(`paddle-rim-${sign}`, surfacePatch((u, v) => {
      const x = (u * 2 - 1) * .535, z = endAt(x), s = profile(z);
      return [x, sign * (s.height - v * .026), z - v * .005];
    }, { uSegments: 36, vSegments: 1, reverse: sign < 0, name: 'F119-chevron-rim' }), edge);
  }

  // Folded side seals enclose a real recessed control channel. Its supporting
  // faces sit above the linkage, so it reads as depth rather than a dark decal.
  for (const sign of [-1, 1]) {
    add(`side-seal-${sign}`, metalColors(surfacePatch((u, v) => {
      const z = -.14 + (endAt(.535) + .14) * v, s = profile(z);
      const y = (u * 2 - 1) * s.height;
      const channel = .012 * (1 - THREE.MathUtils.smoothstep(Math.abs(y), .022, .047)) *
        THREE.MathUtils.smoothstep(z, -.06, .02) * (1 - THREE.MathUtils.smoothstep(z, .65, .74));
      const fold = .008 * Math.sin(Math.PI * u);
      return [sign * (s.width + fold - channel), y, z];
    }, { uSegments: quality === 'low' ? 8 : quality === 'medium' ? 12 : 20, vSegments: longitudinal, reverse: sign < 0,
      name: 'F119-side-seal' }), 3), metal);
    add(`side-liner-${sign}`, metalColors(surfacePatch((u, v) => {
      const z = -.38 + 1.225 * v, s = profile(Math.max(z, -.14));
      return [sign * (s.width - .020), (u * 2 - 1) * (s.height - .02), z];
    }, { uSegments: 2, vSegments: longitudinal, reverse: sign > 0,
      name: 'F119-side-liner' }), 1, 'liner'), lining);
    add(`control-channel-${sign}`, surfacePatch((u, v) => {
      const z = .01 + .64 * v, s = profile(z);
      return [sign * (s.width - .0032), (u - .5) * .038, z];
    }, {uSegments: 2, vSegments: longitudinal, reverse: sign < 0, name: 'F119-recessed-control-channel'}), shadow);
    if (quality !== 'low') {
      // Recessed slider and its short exposed shaft. Both stay inside the side
      // seal envelope and move with the existing vectoring group.
      add(`control-slider-${sign}`, surfacePatch((u, v) => {
        const z = .065 + .245 * v, s = profile(z);
        return [sign * (s.width + .001), (u - .5) * .021, z];
      }, {uSegments: 2, vSegments: 5, reverse: sign < 0, name: 'F119-control-slider'}), edge);
      rodDetail(group, `control-shaft-${sign}`, [sign * (profile(.31).width + .001), 0, .31],
        [sign * (profile(.56).width + .001), 0, .56], .0045, edge, .0045, 6);
    }
  }
  const throat = new THREE.PlaneGeometry(1.095, .88);
  throat.translate(0, 0, -.72);
  add('F119-throat-backing', throat, shadow);
  // The recessed flameholder is stationary inside the vectoring assembly.
  // Broad, low-contrast metal stays legible without shimmering at game scale.
  const burner = new THREE.MeshStandardMaterial({color:0x3f4241,roughness:.86,metalness:.38});
  burner.name = 'F119-flameholder-alloy';
  const ring = new THREE.TorusGeometry(.29, .016, 6, quality === 'low' ? 20 : 40);
  ring.scale(1.42, 1, 1); ring.translate(0, 0, -.63);
  add('F119-afterburner-ring', ring, burner);
  if (quality !== 'low') {
    const innerRing = new THREE.TorusGeometry(.13, .012, 6, 32);
    innerRing.scale(1.42, 1, 1); innerRing.translate(0, 0, -.645);
    add('F119-inner-flameholder', innerRing, burner);
    for (let i=0;i<8;i++) {
      const angle=i*Math.PI/4, c=Math.cos(angle), s=Math.sin(angle);
      rodDetail(group,`F119-flameholder-strut-${i}`,
        [.13*1.42*c,.13*s,-.645],[.29*1.42*c,.29*s,-.63],.009,burner,.009,6);
    }
    // Recessed fixings lie on the broad forward paddle, never on the rim.
    for (const sign of [-1,1]) for (let plate=0;plate<9;plate++) {
      const fraction=(plate+.5)/9, z=.08, section=profile(z);
      const shoulder=sign>0 ? .125*(1-THREE.MathUtils.smoothstep(z,-.14,.38))*(1-(fraction*2-1)**2) : 0;
      const head=new THREE.CircleGeometry(.008,8);
      head.rotateX(-sign*Math.PI/2);
      head.translate((fraction*2-1)*section.width,sign*(section.height+shoulder+.007),z);
      add(`F119-paddle-fixing-${sign}-${plate}`,head,burner);
    }
  }
  group.userData.nozzle = { exit: [0, 0, 1.36], halfWidth: .535, halfHeight: .305,
    chevronSetback: .494, quality };
  return mergeDetails(group);
}
