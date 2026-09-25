// A bounded emission volume avoids the intersecting-card artifacts visible
// during close inspections. TSL compiles the same material for both engines.
// This is an art-directed radiance field, not a fluid simulation.
import * as THREE from 'three';
import { Fn, Loop, uniform, positionGeometry, vec2, vec3, vec4, float, int,
  normalize, min, max, clamp, mix, sin, cos, abs, exp, dot, length, sqrt } from 'three/tsl';

const HALF_X = .84, HALF_Y = .72;
let bounds;

export function createEngineVolume() {
  if (!bounds) { bounds = new THREE.BoxGeometry(2, 2, 1); bounds.translate(0, 0, .5); }
  const camera = uniform(new THREE.Vector3(0, 0, 5));
  const plumeLength = uniform(5), stage = uniform(0), time = uniform(0);
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true,
    depthWrite: false, side: THREE.FrontSide, fog: false,
    blending: THREE.AdditiveBlending, premultipliedAlpha: true });
  material.name = 'F119-volumetric-emission';
  material.outputNode = Fn(() => {
    // The planet adapter deforms positionLocal for rendering; this bounded
    // radiance field stays in the original nozzle-box coordinate system.
    const direction = normalize(positionGeometry.sub(camera)).toVar();
    const safeDirection = direction.add(vec3(.000001));
    const nearPlane = vec3(-1, -1, 0).sub(camera).div(safeDirection);
    const farPlane = vec3(1, 1, 1).sub(camera).div(safeDirection);
    const near = min(nearPlane, farPlane), far = max(nearPlane, farPlane);
    const start = max(max(max(near.x, near.y), near.z), 0).toVar();
    const end = min(min(far.x, far.y), far.z).toVar();
    const step = max(end.sub(start), 0).div(32).toVar();
    const metres = length(direction.mul(vec3(HALF_X, HALF_Y, plumeLength))).mul(step).toVar();
    const radiance = vec3(0).toVar(), transmittance = float(1).toVar();
    Loop({ start: int(0), end: int(32), type: 'int', condition: '<' }, ({ i }) => {
      const p = camera.add(direction.mul(start.add(float(i).add(.5).mul(step)))).toVar();
      const z = clamp(p.z, 0, 1).toVar(), tail = z.oneMinus();
      // Compression cells spread gradually downstream. Their shape is tied
      // to the nozzle axis; only the entraining shear layer advects in time.
      const phase = z.mul(30).sub(z.mul(z).mul(4)).toVar();
      // Rectangular mouth becomes approximately round as the jet expands.
      const width = mix(float(.535 / HALF_X), float(.57 / HALF_X), z);
      const height = mix(float(.265 / HALF_Y), float(.39 / HALF_Y), clamp(z.mul(4), 0, 1));
      const cell = cos(phase).mul(.08).add(.86);
      const cross = p.xy.div(vec2(width, height).mul(cell));
      // A superellipse preserves the broad rectangular nozzle mouth. The
      // cross-section rounds downstream instead of beginning as a round tube.
      const squared = cross.mul(cross);
      const rectangular = sqrt(dot(squared, squared));
      const radius2 = mix(rectangular, dot(cross, cross), clamp(z.mul(4),0,1)).toVar();
      const radius = sqrt(max(radius2, .00001)).toVar();
      const shock = exp(sin(phase).pow(2).mul(-21)).mul(tail).toVar();
      // Intersecting compression cones form diamonds in side view, rather
      // than isolated bright balls painted along a soft orange cylinder.
      const cone = exp(radius.sub(abs(sin(phase)).mul(.50)).pow(2).mul(-75))
        .mul(exp(radius2.mul(-4))).mul(tail).toVar();
      const eddy = sin(dot(p, vec3(23, 17, 67)).sub(time.mul(37)))
        .mul(sin(dot(p, vec3(11, -19, 41)).sub(time.mul(53)))).toVar();
      const core = exp(radius2.mul(-7)).mul(shock.mul(.95).add(.34));
      const shear = exp(radius.sub(.57).pow(2).mul(-46)).mul(eddy.mul(.36).add(.64)).mul(.10);
      const density = core.add(cone.mul(.23)).add(shear).mul(tail.pow(1.65)).mul(stage).toVar();
      const hot = clamp(shock.mul(exp(radius2.mul(-9))).add(cone.mul(.35)), 0, 1);
      // Short blue-violet throat, amber shear and hot compression centres.
      const base = mix(vec3(.68,.92,2.25),vec3(4.8,1.12,.20),clamp(z.mul(8),0,1));
      const temperature = mix(base, vec3(8.3, 5.6, 2.7), hot);
      const energy = density.mul(metres).toVar();
      radiance.addAssign(temperature.mul(energy).mul(transmittance));
      transmittance.mulAssign(exp(energy.mul(-.45)));
    });
    const emission = vec4(radiance, transmittance.oneMinus()).toVar();
    // NodeMaterial alphaTest precedes outputNode. Discard here too so empty
    // volume-box pixels cannot overwrite the underlying velocity MRT.
    emission.a.lessThanEqual(1e-5).discard();
    return emission;
  })();
  const mesh = new THREE.Mesh(bounds, material); mesh.name = 'F119-radiance-volume';
  mesh.scale.set(HALF_X, HALF_Y, 5);
  mesh.userData.aircraftEffect = true;
  return { mesh, camera, plumeLength, stage, time, localCamera: new THREE.Vector3() };
}

export function updateEngineVolume(volume, stage, plumeLength, time, cameraPosition) {
  volume.stage.value = stage; volume.plumeLength.value = plumeLength; volume.time.value = time;
  volume.mesh.scale.z = plumeLength;
  volume.mesh.updateWorldMatrix(true, false);
  volume.localCamera.copy(cameraPosition);
  volume.mesh.worldToLocal(volume.localCamera);
  volume.camera.value.copy(volume.localCamera);
}
