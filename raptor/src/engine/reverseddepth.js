// Three r185 reverses entire render lists for reverse Z, including explicit
// priorities. Compensate only on this pinned WebGPU path; no vendor mutation.
import GTAONode from '../../vendor/display/GTAONode.js';
import { Fn, If, float, uv, nodeObject } from 'three/tsl';

export function installReversedDepthSort(renderer) {
  if (!renderer.reversedDepthBuffer) return;
  if (!renderer.backend.isWebGPUBackend) throw new Error('Reversed scene depth requires WebGPU.');
  // These are pre-reversal comparisons. Depth retains the native reverse-Z
  // near/far ordering; explicit group/render priorities keep their
  // ordinary order after r185 calls reverse().
  renderer.setOpaqueSort((a, b) => b.groupOrder - a.groupOrder
    || b.renderOrder - a.renderOrder || a.z - b.z || b.id - a.id);
  renderer.setTransparentSort((a, b) => b.groupOrder - a.groupOrder
    || b.renderOrder - a.renderOrder || b.z - a.z || b.id - a.id);
}

// Native GTAO r185 treats depth==1 as background. Its matrix-based geometry
// reconstruction otherwise supports reverse Z. Guard the actual clear value
// before evaluating its existing AO graph; keep target/lifecycle unchanged.
class DepthAwareGTAONode extends GTAONode {
  static get type() { return 'DepthAwareGTAONode'; }
  setup(builder) {
    const result = super.setup(builder);
    if (builder.renderer.reversedDepthBuffer) {
      const nativeAO = this._material.fragmentNode;
      this._material.fragmentNode = Fn(() => {
        const value = float(1).toVar();
        If(this.depthNode.sample(uv()).r.greaterThan(0), () => { value.assign(nativeAO); });
        return value;
      })().context(builder.getSharedContext());
      this._material.needsUpdate = true;
    }
    return result;
  }
}
export const depthAwareAO = (depth, normal, camera) => nodeObject(new DepthAwareGTAONode(depth, normal, camera));
