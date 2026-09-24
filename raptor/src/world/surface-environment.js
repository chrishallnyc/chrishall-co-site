import { Fn, vec3, normalize, dot, cross, max, positionWorld, pmremTexture } from "three/tsl";

// Preserve Three's physical reflection/irradiance directions and roughness.
// A curved surface uses its local tangent sky; rotate only the lookup into
// the sea-level probe's +Y frame, never the actual direct-light vectors.
// A single probe still approximates solar-zenith/weather variation with range.
export function makeSurfaceEnvironment(texture, radialUpNode = null) {
  let currentTexture = texture;
  const samplers = new Set();
  const node = Fn((_, builder) => {
    const sourceDirection = builder.context.getUV();
    const level = builder.context.getTextureLevel();
    let direction = sourceDirection;
    if (radialUpNode) {
      const up = normalize(radialUpNode(positionWorld));
      const targetUp = vec3(0, 1, 0);
      const k = cross(up, targetUp);
      // Rodrigues' shortest rotation, valid on this local planetary patch.
      direction = normalize(sourceDirection.add(cross(k, sourceDirection))
        .add(cross(k, cross(k, sourceDirection)).div(max(dot(up, targetUp).add(1), 1e-5))));
    }
    const sampler = pmremTexture(currentTexture, direction, level);
    samplers.add(sampler);
    return sampler;
  })();
  return {
    node,
    setTexture(texture) {
      currentTexture = texture;
      for (const sampler of samplers) sampler.value = texture;
    },
  };
}
