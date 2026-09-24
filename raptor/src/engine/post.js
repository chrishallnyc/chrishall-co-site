// MAXFI A1: the AAA post chain — scene pass with velocity MRT feeding TRAA
// (temporal AA replaces MSAA; the node owns camera.setViewOffset for Halton
// jitter), then HDR bloom, then anamorphic-ish lens flare ghosts driven from
// the bloom texture. ACES + exposure stay in PostProcessing's output
// transform, so atmosphere.exposure keeps working unchanged. WebGPU only —
// the WebGL2 fallback renders plain (per MAXFI budget doc: fallback is
// "doesn't crash" tier).

import * as THREE from "three";
import { pass, mrt, output, velocity, Fn, vec4, fract, screenCoordinate, renderOutput, texture } from "three/tsl";
import { temporalResolve as makeTemporalResolve } from "./temporalresolve.js";
import { bloom } from "../../vendor/display/BloomNode.js";
import { lensflare } from "../../vendor/display/LensflareNode.js";
import { depthAwareAO as ao } from "./reverseddepth.js";

export function buildPost(renderer, scene, camera, { flare = false, gtao = false, chain: chainSel = "full", makeClouds = null, rawDepthSelection = false } = {}) {
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, velocity }));

  const beauty = scenePass.getTextureNode();
  const depth = scenePass.getTextureNode("depth");
  const vel = scenePass.getTextureNode("velocity");

  // Volumetric clouds provide their own depth and motion so TRAA follows the
  // visible billows instead of the terrain behind them. Plain color nodes
  // remain supported for callers that do not need a separate cloud pass.
  let base = beauty;
  let temporalDepth = depth, temporalVelocity = vel;
  let cloudPass = null;
  let hasClouds = false;
  if (makeClouds) {
    try {
      const n = makeClouds({ beauty, depth, velocity: vel });
      if (n) {
        if (typeof n.getTextureNode === "function") {
          const cloudColor = n.getTextureNode();
          const cloudDepth = n.getTextureNode("depth");
          const cloudVelocity = n.getTextureNode("velocity");
          if (!cloudColor || !cloudDepth?.value?.isDepthTexture || !cloudVelocity) {
            throw new Error("Cloud composition must provide color, velocity, and a depth texture.");
          }
          base = cloudColor;
          temporalDepth = cloudDepth;
          temporalVelocity = cloudVelocity;
          cloudPass = n;
        } else base = n;
        hasClouds = true;
      }
    } catch (err) { console.warn("volumetric clouds node failed, billboards stay:", err && err.message); }
  }

  const temporalResolve = makeTemporalResolve(base, temporalDepth, temporalVelocity, camera, { rawDepthSelection });
  let taa = temporalResolve;
  // GTAO (?ao=1, eyeball-gated): normals reconstructed from depth (null),
  // occlusion multiplied into the lit scene before bloom picks highlights
  let aoPass = null;
  if (gtao) {
    aoPass = ao(depth, null, camera);
    taa = taa.mul(aoPass.getTextureNode().r);
  }
  // threshold in LINEAR HDR (pre-tonemap): the whole sky sits above 1.0, so
  // the cut must be well beyond it — only the sun disk, water glint, and AB
  // flame overshoot ~3
  const bloomPass = bloom(taa, 0.4, 0.32, 3.0);

  let chain;
  let flarePass = null;
  if (chainSel === "beauty") chain = beauty;      // ?chain=beauty — pass-through (isolates the MRT/pipeline itself)
  else if (chainSel === "taa") chain = taa;       // ?chain=taa — TRAA only
  else if (chainSel === "bloom") chain = taa.add(bloomPass);
  else {
    chain = taa.add(bloomPass);
    if (flare) {
      flarePass = lensflare(bloomPass, { threshold: 0.6, ghostSamples: 3, ghostSpacing: 0.28, ghostAttenuationFactor: 22 });
      chain = chain.add(flarePass.mul(0.35));
    }
  }

  const Pipeline = THREE.RenderPipeline || THREE.PostProcessing; // r185 rename
  const post = new Pipeline(renderer);
  // Dither in display space, AFTER exposure, ACES, and temporal AA. One
  // output-code-value of fixed pixel noise breaks up sky/haze banding without
  // being accumulated away by TRAA or amplified in dark scenes by exposure.
  post.outputColorTransform = false;
  post.outputNode = Fn(() => {
    const display = renderOutput(chain).toVar();
    const noise = fract(fract(screenCoordinate.x.mul(0.06711056)
      .add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189)).sub(0.5).div(255);
    return vec4(display.rgb.add(noise).clamp(0, 1), display.a);
  })();
  // Preserve the completed-effects sampler used by external render tools.
  // Plain texture references cannot schedule the scene or temporal pass twice.
  let meterNode = texture(temporalResolve.getTextureNode().value);
  if (aoPass) meterNode = meterNode.mul(texture(aoPass.getTextureNode().value).r);
  if (chainSel === "beauty") meterNode = texture(beauty.value);
  else if (chainSel !== "taa") {
    meterNode = meterNode.add(texture(bloomPass.getTextureNode().value));
    if (flarePass) meterNode = meterNode.add(texture(flarePass.getTextureNode().value).mul(0.35));
  }
  return {
    post, scenePass, taa, bloomPass, flarePass, hasClouds, cloudPass, meterNode,
    // Return the existing GPU Texture, NEVER its PassTextureNode. Sampling
    // it after post.render() cannot schedule scene/TRAA a second time.
    getExposureTexture: () => chainSel === "beauty"
      ? beauty.value : temporalResolve.getTextureNode().value,
    invalidateHistory: () => {
      temporalResolve.invalidateHistory();
      cloudPass?.invalidateHistory?.();
    },
  };
}
