// Three r185 reverses entire render lists for reverse Z, including explicit
// priorities. Compensate only on this pinned WebGPU path; no vendor mutation.
import GTAONode from '../../vendor/display/GTAONode.js';
import { Fn, If, float, uv, nodeObject } from 'three/tsl';

// Preserve the application import while sharing the upstream idempotent guard.
export { installReversedDepthOrderGuard as installReversedDepthSort } from "./reversed-depth-order.js";

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
