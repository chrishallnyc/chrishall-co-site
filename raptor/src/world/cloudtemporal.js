// Shared scene/cloud depth and motion contract for native and adaptive clouds.
import { uv, smoothstep, min, max, mix, vec2, vec4, select, viewZToPerspectiveDepth, viewZToReversedPerspectiveDepth, struct } from 'three/tsl';
import { createCloudGeometry } from './cloudgeometry.js';
export const CloudResult = struct({ color: 'vec4', motion: 'vec4', depth: 'float' });
export function cloudTemporalResult(pass, { color, alpha, meanDistance, sceneDistance, rayDirection }, reversed) {
  const curvature = pass.cloudOptions.curvature;
  const geometry = curvature ? createCloudGeometry(curvature) : null;
        const suv = uv();
        const originalDepth = pass.sceneDepth.sample(suv).r.toVar();
        const originalMotion = pass.sceneVelocity.sample(suv).xy.toVar();
        const cloudWeight = smoothstep(0.12, 0.70, alpha).toVar();
        const cloudDistance = min(max(meanDistance, 1e-3), sceneDistance);
        // Translation parallax varies with inverse distance. Blending meters
        // would pin even substantial translucent cloud to distant terrain or
        // sky; this harmonic blend follows the weighted layer parallax.
        const representativeDistance = mix(
          max(sceneDistance, 1e-3).reciprocal(), cloudDistance.reciprocal(), cloudWeight,
        ).reciprocal().toVar();
        const wp = pass.cloudOptions.uCamPos.add(rayDirection.mul(representativeDistance)).toVar();
        const now = pass._currentClip.mul(vec4(wp, 1)).toVar();
        // Previous projection follows the same physical map point in the old
        // render frame; a moving origin changes sagitta even for static cloud.
        const previousWp = geometry ? geometry.toPrevious(wp) : wp;
        const previous = pass._previousClip.mul(vec4(previousWp, 1)).toVar();
        // Nearby cloud can cross the previous camera plane during ordinary
        // flight. Keep projection math finite even for rejected history,
        // independent of how the backend evaluates conditional candidates.
        const cameraMotion = now.xy.div(max(now.w, 1e-4))
          .sub(previous.xy.div(max(previous.w, 1e-4)));

        // One temporal sample represents two translucent layers. Give camera
        // parallax the same representative depth used for disocclusion, then
        // retain independent background motion while confidence still favors it.
        const sceneWp = pass.cloudOptions.uCamPos.add(rayDirection.mul(sceneDistance));
        const sceneNow = pass._currentClip.mul(vec4(sceneWp, 1)).toVar();
        const previousSceneWp = geometry ? geometry.toPrevious(sceneWp) : sceneWp;
        const scenePrevious = pass._previousClip.mul(vec4(previousSceneWp, 1)).toVar();
        const sceneCameraMotion = sceneNow.xy.div(max(sceneNow.w, 1e-4))
          .sub(scenePrevious.xy.div(max(scenePrevious.w, 1e-4)));
        const blendedMotion = cameraMotion.add(
          originalMotion.sub(sceneCameraMotion).mul(cloudWeight.oneMinus()),
        );
        const motion = select(cloudWeight.lessThanEqual(0), originalMotion, blendedMotion);
        const viewPosition = pass._cameraView.mul(vec4(wp, 1));
        const depthFromViewZ = reversed ? viewZToReversedPerspectiveDepth : viewZToPerspectiveDepth;
        const representativeDepth = depthFromViewZ(viewPosition.z, pass._nearFar.x, pass._nearFar.y);
        const outDepth = select(cloudWeight.lessThanEqual(0), originalDepth, representativeDepth.clamp(0, 1));
        const invalidCloudProjection = now.w.lessThanEqual(1e-4).or(previous.w.lessThanEqual(1e-4));
        const invalidSceneProjection = sceneNow.w.lessThanEqual(1e-4).or(scenePrevious.w.lessThanEqual(1e-4));
        const invalidProjection = cloudWeight.greaterThan(0).and(
          invalidCloudProjection.or(cloudWeight.lessThan(1).and(invalidSceneProjection)),
        );
        const historyRejected = pass._resetHistory.or(invalidProjection);
        const outMotion = select(curvature ? historyRejected.or(curvature.historyValid.not()) : historyRejected,
          vec2(4, 4), motion);
        return CloudResult(color, vec4(outMotion, 0, 1), outDepth);
}
