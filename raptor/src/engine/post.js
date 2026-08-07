// MAXFI A1: the AAA post chain — scene pass with velocity MRT feeding TRAA
// (temporal AA replaces MSAA; the node owns camera.setViewOffset for Halton
// jitter), then HDR bloom, then anamorphic-ish lens flare ghosts driven from
// the bloom texture. ACES + exposure stay in PostProcessing's output
// transform, so atmosphere.exposure keeps working unchanged. WebGPU only —
// the WebGL2 fallback renders plain (per MAXFI budget doc: fallback is
// "doesn't crash" tier).

import * as THREE from "three";
import { pass, mrt, output, velocity } from "three/tsl";
import { traa } from "../../vendor/display/TRAANode.js";
import { bloom } from "../../vendor/display/BloomNode.js";
import { lensflare } from "../../vendor/display/LensflareNode.js";

export function buildPost(renderer, scene, camera, { flare = true, chain: chainSel = "full" } = {}) {
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, velocity }));

  const beauty = scenePass.getTextureNode();
  const depth = scenePass.getTextureNode("depth");
  const vel = scenePass.getTextureNode("velocity");

  const taa = traa(beauty, depth, vel, camera);
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
  post.outputNode = chain;
  return { post, scenePass, taa, bloomPass, flarePass };
}
