// Optional bounded hook for the round-2 actual-density light transport.
// This selects one direct source; segmentRadiance and its knot cache remain
// unchanged. uSunI and uNightSkyRadiance are ALREADY pre-exposed once.
import { vec3, float, dot, normalize, select, smoothstep, mix, pow } from "three/tsl";
const hg = (c, g) => float((1 - g * g) / (4 * Math.PI))
  .div(pow(float(1 + g * g).sub(c.mul(2 * g)), 1.5));

export function cloudCelestialLight({ viewDir, uSunDir, uSunI, uMoonDir, uMoonRatio, uNightSkyRadiance, albedo }) {
  // Retain the existing one-column -3° source-selection approximation.
  // Point-based visibility for elevated/distant clouds is a separate change.
  const moonSource = uSunDir.y.lessThan(-0.052335956);
  const direction = normalize(select(moonSource, uMoonDir, uSunDir)).toVar();
  const cosine = dot(viewDir, direction);
  const phase = mix(hg(cosine, .6), hg(cosine, -.25), .3).toVar();
  const warmth = mix(vec3(1, .62, .38), vec3(1), smoothstep(0, .35, direction.y));
  const spectrum = select(moonSource, warmth.mul(vec3(1, .98, .94)), warmth);
  // The old binary switch adds a small finite Moon term at -3°. Fade
  // that single-source handoff over one solar angular radius; Sun direct
  // is already zero in this interval, so both value and slope stay smooth.
  // This preserves the existing one-column approximation and does not
  // claim to correct elevated-cloud solar visibility (handled separately).
  const moonHandoff = float(1).sub(smoothstep(
    -0.056980301369527, -0.052335956, uSunDir.y)); // -3.2665° to -3°
  const scale = select(moonSource, uMoonRatio.mul(moonHandoff), float(1));
  const direct = spectrum.mul(uSunI).mul(scale).mul(smoothstep(-.02, .08, direction.y)).mul(albedo).toVar();
  const daySky = vec3(.45, .62, .95).mul(uSunI).mul(.05 * albedo)
    .mul(smoothstep(-.08, .25, uSunDir.y));
  const night = float(1).sub(smoothstep(-.173648178, -.052335956, uSunDir.y));
  const sky = mix(daySky, uNightSkyRadiance.mul(albedo), night).toVar();
  return { direction, phase, direct, sky };
}

// Both physical source directions, with phase evaluated once per view ray.
// Direct atmospheric attenuation is evaluated later at the scattering point.
export function cloudCelestialSources({ viewDir, uSunDir, uSunI, uMoonDir,
  uMoonRatio, uMoonColor = vec3(1, .98, .94), uNightSkyRadiance, albedo }) {
  const solarDirection = normalize(uSunDir).toVar();
  const lunarDirection = normalize(uMoonDir).toVar();
  const phase = direction => mix(hg(dot(viewDir, direction), .6), hg(dot(viewDir, direction), -.25), .3).toVar();
  const daySky = vec3(.45, .62, .95).mul(uSunI).mul(.05 * albedo)
    .mul(smoothstep(-.08, .25, uSunDir.y));
  const night = float(1).sub(smoothstep(-.173648178, -.052335956, uSunDir.y));
  return { solarDirection, lunarDirection, solarPhase: phase(solarDirection), lunarPhase: phase(lunarDirection),
    solarColor: vec3(uSunI.mul(albedo)), lunarColor: uMoonColor.mul(uSunI).mul(uMoonRatio).mul(albedo),
    sky: mix(daySky, uNightSkyRadiance.mul(albedo), night).toVar() };
}
