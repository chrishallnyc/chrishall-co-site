// Point-based incident illumination. The atmosphere lookup remains inline:
// cached shader functions receive already-attenuated RGB as explicit inputs.
import { Fn, If, vec2, vec3, max } from 'three/tsl';
import { receiverCelestialGeometry, finiteDiscVisibility, SOLAR_ANGULAR_RADIUS } from './celestial-surface.js';
import { atmosphereSourceTransmittanceNode, sampleAtmosphereSourceTransmission } from './hillaire.js';

export function cloudPointAtmosphere({ luts, curvature = null, referenceAltitude = 2000, calibrateDay = true }) {
  if (!luts?.tTex || !luts?.tData) throw new Error('Cloud source transport requires the existing atmosphere LUT.');
  // Existing cloud source units were calibrated to white clear-day clouds.
  // One FIXED front reference preserves that grade. No directional fade or
  // old warm tint is multiplied into the physical transmission again.
  const reference = sampleAtmosphereSourceTransmission(luts, referenceAltitude, 1);
  const calibration = vec3(...reference.map(t => calibrateDay ? 1 / Math.max(t, 1e-5) : 1));
  return (point, direction, incidentColor, angularRadius = SOLAR_ANGULAR_RADIUS) => Fn(() => {
    const radiance = vec3(0).toVar();
    If(max(max(incidentColor.x, incidentColor.y), incidentColor.z).greaterThan(0), () => {
      const p = curvature ? point : vec3(0, point.y, 0);
      const geometry = receiverCelestialGeometry(p, direction,
        curvature ? curvature.origin : vec2(0), curvature?.radius || 6360000).toVar();
      const visible = finiteDiscVisibility(geometry, angularRadius).toVar();
      If(visible.greaterThan(0), () => {
        const transmittance = atmosphereSourceTransmittanceNode(luts.tTex,
          geometry.z.mul(.001).add(6360), geometry.x);
        radiance.assign(incidentColor.mul(calibration).mul(transmittance).mul(visible));
      });
    });
    return radiance;
  })();
}
