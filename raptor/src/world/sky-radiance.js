// Shared scene-linear sky source. The observer and planet-frame origin are
// explicit; this function is used by the view and by a sea-level HDR probe.
// The atmosphere itself is exclusively Hillaire's existing shared marcher.
import { Fn, vec2, vec3, float, dot, normalize, length, max, min, abs,
  sqrt, select, smoothstep, fwidth, pow, exp, mix, texture, time } from "three/tsl";
import { observerSkyNode } from "./hillaire.js";

const R = 6360, CIRRUS_R = 6370, SUN_RADIUS = 0.2665 * Math.PI / 180;
const SUN_COS = Math.cos(SUN_RADIUS);
const DARK_SKY_RADIANCE = 0.00022 * 36 / 120000;

export function makeSkyRadiance({ luts, sourceUniforms: U, uFrameOrigin,
  cirrusAtlas, uTime = time, includeSolarDisc = false, scatteringRadiance = null }) {
  const scattering = observerSkyNode({ tTex: luts.tTex, msTex: luts.msTex,
    uSunDir: U.uSunDir, uFrameOrigin, uMoonDir: U.uMoonDir,
    uMoonRatio: U.uMoonRatio, uMoonColor: U.uMoonColor });
  const gain = U.uExposureGain || float(1);
  return Fn(([observer, viewDirection]) => {
    const dir = normalize(viewDirection).toVar();
    const p = vec3(observer.x.sub(uFrameOrigin.x), observer.y.add(R * 1000),
      observer.z.sub(uFrameOrigin.z)).div(1000).toVar();
    const radius = max(length(p), R + 0.001).toVar();
    const up = normalize(p).toVar();
    const pos = up.mul(radius).toVar();
    const mu = dot(dir, up).toVar();
    const horizon = sqrt(max(float(1).sub(float(R).div(radius).pow(2)), 0)).negate();
    const edge = max(fwidth(mu).mul(.5), .00001);
    const visible = smoothstep(horizon.sub(edge), horizon.add(edge), mu).toVar();
    const L = (scatteringRadiance ? scatteringRadiance(observer, dir)
      : scattering(observer, dir).mul(U.uSunI)).toVar();

    // The night candidate supplies the same physical mesopause emission.
    // No arbitrary RGB floor is introduced when the source is absent.
    if (U.uMoonRatio) {
      const altitudeM = radius.sub(R).mul(1000);
      const muPositive = max(mu, 0);
      const airMass = float(1).div(muPositive.add(exp(muPositive.mul(-11)).mul(.025)));
      const tau = vec3(.0464, .1085, .2648).mul(exp(altitudeM.div(-8000)))
        .add(exp(altitudeM.div(-1200)).mul(.025));
      const starlightT = exp(tau.mul(airMass).negate()).mul(visible);
      const vanRhijn = float(1).div(sqrt(max(float(1).sub(radius.div(R + 90).pow(2)
        .mul(float(1).sub(mu.pow(2)))), .01)));
      L.addAssign(vec3(.78, 1.06, .91).mul(DARK_SKY_RADIANCE).mul(vanRhijn)
        .mul(pow(starlightT, vec3(.20))).mul(visible).mul(gain));
    }

    const cosSun = dot(dir, U.uSunDir);
    const lowSun = float(1).sub(smoothstep(.02, .35, dot(up, U.uSunDir)));
    const discColor = mix(vec3(1, .97, .92), vec3(1, .52, .22), lowSun);
    // The broad existing aureole belongs to atmospheric sky radiance.
    // Finite celestial discs are omitted from IBL: directional lights own
    // their direct highlights, so the source is not counted a second time.
    let nearSun = exp(cosSun.sub(1).mul(4200)).mul(.012);
    if (includeSolarDisc) {
      const discEdge = max(fwidth(cosSun).mul(.5), .00000012);
      const disc = smoothstep(float(SUN_COS).sub(discEdge), float(SUN_COS).add(discEdge), cosSun);
      const limb = pow(cosSun.sub(SUN_COS).div(1 - SUN_COS).clamp(0, 1), .5);
      nearSun = nearSun.add(disc.mul(limb.mul(.16).add(.84)).mul(.65));
    }
    L.addAssign(discColor.mul(nearSun).mul(U.uSunI).mul(visible));

    if (cirrusAtlas) {
      const b = dot(pos, dir), c = radius.pow(2).sub(CIRRUS_R ** 2);
      const discriminant = b.pow(2).sub(c);
      const root = sqrt(max(discriminant, 0));
      const near = b.negate().sub(root), far = b.negate().add(root);
      const distance = select(near.greaterThan(0), near, far);
      const valid = select(discriminant.greaterThanEqual(0).and(distance.greaterThan(0)), 1, 0);
      const hit = pos.add(dir.mul(max(distance, 0))).toVar();
      const layerUp = normalize(hit).toVar();
      const worldXZ = uFrameOrigin.xz.add(hit.xz.mul(1000)).sub(vec2(18, 7).mul(uTime));
      const density = texture(cirrusAtlas, worldXZ.div(120000).add(.5)).r;
      const slant = float(1).div(max(abs(dot(dir, layerUp)), .30));
      const farFade = float(1).sub(smoothstep(80, 190, distance));
      const crossing = smoothstep(.03, .30, abs(radius.sub(CIRRUS_R)));
      const tau = density.mul(.22).mul(slant).mul(valid).mul(farFade).mul(crossing).mul(visible);
      const transmission = exp(tau.negate());
      const layerHorizon = -Math.sqrt(1 - (R / CIRRUS_R) ** 2);
      const sunMu = dot(layerUp, U.uSunDir);
      const sunLit = smoothstep(layerHorizon - Math.sin(SUN_RADIUS), layerHorizon + Math.sin(SUN_RADIUS), sunMu);
      const sunset = float(1).sub(smoothstep(layerHorizon + .005, .025, sunMu));
      let direct = mix(vec3(1.60, 1.68, 1.77), vec3(1.75, .75, .31), sunset).mul(sunLit);
      if (U.uMoonDir && U.uMoonRatio) {
        const moonLit = smoothstep(layerHorizon - .0047, layerHorizon + .0047, dot(layerUp, U.uMoonDir));
        direct = direct.add(vec3(1.60, 1.65, 1.69).mul(U.uMoonRatio).mul(moonLit));
      }
      const source = L.mul(.40).add(direct.mul(gain));
      L.assign(L.mul(transmission).add(source.mul(float(1).sub(transmission))));
    }
    return L;
  });
}
