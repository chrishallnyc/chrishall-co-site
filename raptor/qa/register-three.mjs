// Resolve the browser import map against the pinned distribution for Node QA.
// Run with: node --import ./raptor/qa/register-three.mjs --test raptor/qa/*.test.mjs
import { registerHooks } from 'node:module';
const modules = {
  three: 'three.webgpu.min.js',
  'three/webgpu': 'three.webgpu.min.js',
  'three/tsl': 'three.tsl.min.js',
};
registerHooks({ resolve(specifier, context, nextResolve) {
  const file = modules[specifier];
  return file ? { url: new URL(`../vendor/${file}`, import.meta.url).href, shortCircuit: true }
    : nextResolve(specifier, context);
} });
