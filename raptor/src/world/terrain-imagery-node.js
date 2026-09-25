import {Fn,If,texture,vec2,vec3,vec4,float,int,dFdx,dFdy,dot,sqrt,smoothstep,min,Stack} from 'three/tsl';

// One array sample at a geographically selected layer. All derivatives are
// formed before the varying choice, so tile boundaries keep stable LOD.
export function geographicImageryNode(stream, worldPosition, baseColor){
 return Fn(()=>{
  const world=worldPosition.xz.toVar('imageryMapXZ');
  const dx=dFdx(world).toVar('imageryMapDx'),dy=dFdy(world).toVar('imageryMapDy');
  Stack(dx);Stack(dy);
  const footprint=sqrt(dot(dx,dx).add(dot(dy,dy))).toVar('imageryFootprint');
  const fade=float(1).sub(smoothstep(2,6,footprint));
  const layer=int(0).toVar('imageryLayer'),sampleUV=vec2(0).toVar('imageryUV'),weight=float(0).toVar('imageryWeight');
  for(const slot of stream.slots){
   const b=slot.bounds,image=slot.imageBounds;
   If(slot.ready.and(world.x.greaterThanEqual(b.x)).and(world.x.lessThan(b.z))
    .and(world.y.greaterThanEqual(b.y)).and(world.y.lessThan(b.w)),()=>{
     const distance=vec4(world.x.sub(b.x),world.y.sub(b.y),b.z.sub(world.x),b.w.sub(world.y));
     const open=slot.edgeOpen;
     const edges=vec4(1).sub(open).add(open.mul(smoothstep(vec4(0),vec4(32),distance)));
     const boundary=min(min(edges.x,edges.y),min(edges.z,edges.w));
     layer.assign(slot.layer);
     sampleUV.assign(vec2(world.x.sub(image.x),image.w.sub(world.y)).div(stream.manifest.imagePixels*stream.manifest.metresPerPixel));
     weight.assign(slot.opacity.mul(boundary).mul(fade));
   });
  }
  const result=vec3(baseColor).toVar('imageryColor');
  If(stream.enabled.and(weight.greaterThan(0)),()=>{
   const scale=stream.manifest.imagePixels*stream.manifest.metresPerPixel;
   const pixel=texture(stream.texture,sampleUV).depth(layer).grad(vec2(dx.x,dx.y.negate()).div(scale),vec2(dy.x,dy.y.negate()).div(scale)).toVar('imageryPixel');
   // Binary source alpha + zero hidden RGB forms premultiplied linear
   // radiance after SRGB decode/filtering; multiplying RGB by alpha again
   // would darken the edges of legitimate source coverage holes.
   result.assign(result.mul(float(1).sub(pixel.a.mul(weight))).add(pixel.rgb.mul(weight)));
  });
  return result;
 })();
}
