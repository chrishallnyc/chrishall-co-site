// F119 two-dimensional nozzle. Coordinates are relative to the existing
// pitch-vectoring hinge; +Z is aft. The central trailing point is z=1.36.
// The paddle outline follows the public NAWDC orthographic and DVIDS 8587030
// photographs. Internal corrugations are a visual approximation, not CAD.
import * as THREE from 'three';
import { surfacePatch } from './geometry/patch.js';
import { stationSet } from './geometry/interpolation.js';
import { mergeDetails } from './hardware.js';
import { rodDetail } from './detail-geometry.js';

const profile = stationSet([
  { z: -.14, width: .550, height: .429 },
  { z: .10, width: .560, height: .416 },
  { z: .42, width: .544, height: .261 },
  { z: .75, width: .536, height: .264 },
  { z: 1.36, width: .535, height: .305 },
], ['width', 'height']);
const endAt = x => 1.36 - .494 * Math.abs(x) / .535;
const tones = [
  [0, new THREE.Color('#62666a')], [.25, new THREE.Color('#65615b')],
  [.58, new THREE.Color('#58524c')], [.82, new THREE.Color('#494b50')],
  [1, new THREE.Color('#35393c')],
];

function metalColors(geometry, plate = 0, inner = false) {
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
    color.multiplyScalar((inner ? .68 : 1) * (1 + .055 * Math.sin(plate * 2.399)));
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function leaf(sign, plate, segments) {
  return metalColors(surfacePatch((u, v) => {
    const fraction = (plate + .018 + u * .964) / 9;
    const xEnd = (fraction * 2 - 1) * .535;
    const z = -.12 + (endAt(xEnd) + .12) * v;
    const s = profile(z), x = (fraction * 2 - 1) * s.width;
    // A pressed crease down each leaf catches a narrow highlight. At the
    // aft edge it flattens into a thin, dark rim instead of a thick slab.
    const rib = .006 * Math.sin(Math.PI * u) ** 2 * Math.sin(Math.PI * v);
    const shoulder = sign > 0 ? .125 * (1 - THREE.MathUtils.smoothstep(z, -.14, .38)) *
      (1 - ((fraction * 2 - 1) ** 2)) : 0;
    return [x, sign * (s.height + rib + shoulder), z];
  }, { uSegments: 4, vSegments: segments, reverse: sign > 0, name: 'F119-paddle-leaf' }), plate);
}

export function buildF119Nozzle({ quality = 'high' } = {}) {
  const group = new THREE.Group(); group.name = 'F119-nozzle';
  // Oxidation scatters the broad studio/sun highlights. The liner has its
  // own brighter ceramic response; the exposed paddles remain charcoal.
  const metal = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true,
    roughness: .58, metalness: .68, envMapIntensity: .68, side: THREE.DoubleSide });
  metal.name = 'F119-oxidized-titanium';
  const lining = new THREE.MeshStandardMaterial({ color: 0x77736b,
    roughness: .83, metalness: .22, side: THREE.DoubleSide });
  lining.name = 'F119-ceramic-liner';
  const shadow = new THREE.MeshStandardMaterial({ color: 0x080a0b,
    roughness: .97, metalness: 0, side: THREE.DoubleSide });
  shadow.name = 'F119-deep-throat';
  const longitudinal = quality === 'low' ? 7 : quality === 'medium' ? 12 : 20;
  const add = (name, geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    group.add(mesh); return mesh;
  };

  for (const sign of [-1, 1]) {
    for (let plate = 0; plate < 9; plate++)
      add(`paddle-${sign}-${plate}`, leaf(sign, plate, longitudinal), metal);

    // Continuous liner closes the hairline gaps between leaves. Corrugation
    // is geometrical at close range and tapers away near the exhaust rim.
    add(`liner-${sign}`, surfacePatch((u, v) => {
      const x = (u * 2 - 1) * .510, z = -.37 + (endAt(x) + .35) * v;
      const s = profile(Math.max(-.14, z));
      const ripple = quality === 'low' ? 0 : .0035 * Math.cos(u * Math.PI * 2 * 18);
      return [x, sign * (s.height - .024 + ripple * Math.sin(Math.PI * v)), z];
    }, { uSegments: quality === 'low' ? 10 : 72, vSegments: longitudinal,
      reverse: sign < 0, name: 'F119-corrugated-liner' }), lining);

    // A physically thin edge seals the chevron without capping the mouth.
    add(`paddle-rim-${sign}`, metalColors(surfacePatch((u, v) => {
      const x = (u * 2 - 1) * .535, z = endAt(x), s = profile(z);
      return [x, sign * (s.height - v * .026), z - v * .005];
    }, { uSegments: 36, vSegments: 1, reverse: sign < 0, name: 'F119-chevron-rim' })), metal);
  }

  // Fixed side seals join the broad top and bottom paddles. A shallow folded
  // centre stiffener replaces the old rounded pipe-like outer shell.
  for (const sign of [-1, 1]) {
    add(`side-seal-${sign}`, metalColors(surfacePatch((u, v) => {
      const z = -.14 + (endAt(.535) + .14) * v, s = profile(z);
      const y = (u * 2 - 1) * s.height;
      const crease = .013 * Math.max(0, 1 - Math.abs(u - .5) * 4);
      return [sign * (s.width + crease), y, z];
    }, { uSegments: 8, vSegments: longitudinal, reverse: sign < 0,
      name: 'F119-side-seal' }), 3), metal);
    add(`side-liner-${sign}`, surfacePatch((u, v) => {
      const z = -.38 + 1.225 * v, s = profile(Math.max(z, -.14));
      return [sign * (s.width - .020), (u * 2 - 1) * (s.height - .02), z];
    }, { uSegments: 2, vSegments: longitudinal, reverse: sign > 0,
      name: 'F119-side-liner' }), lining);
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
