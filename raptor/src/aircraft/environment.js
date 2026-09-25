// Aircraft-height sky/cloud reflections with a diffuse ground hemisphere.
// The ground is a front-specific average, not a second terrain renderer.
import * as THREE from 'three';
import { Fn, If, uniform, vec3, float, max, sqrt, smoothstep, mix, exp, normalize } from 'three/tsl';
import { SkyEnvironment } from '../world/sky-environment.js';
import { atmosphereSourceTransmittanceNode } from '../world/hillaire.js';

export function createAircraftEnvironment({ aircraft, lighting, terrain, front, ...options }) {
  const observer = new THREE.Vector3();
  const groundHeight = uniform(0);
  const albedo = new THREE.Color({ NELLIS: 0xa99c87, VALDEZ: 0x536353, MARIANAS: 0x234c59 }[front] || 0x777777);
  return new SkyEnvironment({ ...options, label: 'Aircraft', minInterval: 6, moveThreshold: 400,
    observer(camera, capture = false) {
      aircraft.getWorldPosition(observer);
      if (capture) groundHeight.value = Math.max(0, terrain?.heightAt(observer.x, observer.z) || 0);
      lighting.curvature?.forward(observer, observer);
      return observer;
    },
    publish: texture => lighting.setEnvironment(texture),
    rescale: gain => lighting.rescaleEnvironment(gain),
    radiance: ({ sky, direction, sources: U, observer: origin }) => Fn(() => {
      const L = sky(origin, direction).toVar();
      const height = max(origin.y.sub(groundHeight), 1).toVar();
      const radius = groundHeight.add(6360000).toVar();
      const r = radius.add(height).toVar();
      const c = height.mul(radius.mul(2).add(height)).toVar();
      const horizon = sqrt(c).div(r).negate().toVar();
      If(direction.y.lessThan(horizon.add(.003)), () => {
        const b = r.mul(direction.y).toVar();
        const distance = max(b.negate().sub(sqrt(max(b.mul(b).sub(c), 0))), 0).toVar();
        const radiusKm = groundHeight.div(1000).add(6360.001);
        const direct = atmosphereSourceTransmittanceNode(options.luts.tTex, radiusKm, U.uSunDir.y)
          .mul(max(U.uSunDir.y, 0)).mul(U.uSunI).toVar();
        if (U.uMoonDir && U.uMoonRatio) direct.addAssign(
          atmosphereSourceTransmittanceNode(options.luts.tTex, radiusKm, U.uMoonDir.y)
            .mul(max(U.uMoonDir.y, 0)).mul(U.uSunI).mul(U.uMoonRatio).mul(U.uMoonColor || vec3(1)));
        // A broad sky sample approximates diffuse irradiance. The complete
        // source includes twilight and physical night emission, with no floor.
        const ambient = sky(origin, normalize(vec3(direction.x, .65, direction.z)));
        const ground = vec3(albedo).mul(direct.div(Math.PI).add(ambient.mul(.7))).toVar();
        // Distant ground loses contrast into the same horizon sky. Near
        // ground retains its material colour under the fuselage and glass.
        const horizonSky = sky(origin, normalize(vec3(direction.x, horizon.add(.012), direction.z)));
        ground.assign(mix(horizonSky, ground, exp(distance.div(-35000))));
        L.assign(mix(ground, L, smoothstep(horizon.sub(.003), horizon.add(.003), direction.y)));
      });
      return L;
    })(),
  });
}
