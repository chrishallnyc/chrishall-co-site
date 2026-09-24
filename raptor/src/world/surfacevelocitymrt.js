// A material velocity override must still emit color when Three renders into
// an internal single-color target without an active renderer MRT (WebGL).
import { MRTNode } from "three";
import { output } from "three/tsl";

export class SurfaceVelocityMRTNode extends MRTNode {
  constructor(velocityNode) { super({ velocity: velocityNode }); }

  setup(builder) {
    if (builder.renderer.getMRT() === null) {
      // NodeMaterial has assigned the lit surface to `output`, but in this
      // branch does NOT assign its later custom outputNode back to output.
      // Preserve completed aerial/other output transforms explicitly.
      let color = builder.material.outputNode || output;
      if (builder.context.getOutput) color = builder.context.getOutput(color, builder);
      this.members = [color.convert(builder.getOutputType(0))];
      // Register ONLY the emitted member as a setup child. Inherited
      // Node.setup also walks outputNodes.velocity, registering unused
      // updateAfter hooks that advance previous models in color-only
      // probe/internal passes. Keep this same struct (and its members):
      // returning a different struct leaves this output attachment empty
      // in the pinned WebGL builder.
      builder.getNodeProperties(this).node0 = this.members[0];
      return null;
    }
    return super.setup(builder);
  }
}

export const surfaceVelocityMRT = node => new SurfaceVelocityMRTNode(node);
