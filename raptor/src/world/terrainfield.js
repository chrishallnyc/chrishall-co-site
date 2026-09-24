// One static, georeferenced source field. CPU collision and GPU geometry
// decode the same packed samples BEFORE bilinear interpolation.
import * as THREE from 'three';
import {Fn,If,uniform,float,vec2,vec3,ivec2,texture,textureLoad,floor,fract,mix,normalize} from 'three/tsl';

let nextFieldId=0;
const saturate=x=>Math.max(0,Math.min(1,x));
const smooth=t=>t*t*(3-2*t);
const sourceURL=(base,path)=>new URL(path,base).href;
const validSHA256=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
async function verifyPixels(pixels,expected,label){
 if(!globalThis.crypto?.subtle)throw Error('Terrain source integrity verification unavailable');
 const digest=await crypto.subtle.digest('SHA-256',pixels);
 const actual=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 if(actual!==expected)throw Error(`Terrain source ${label} checksum mismatch`);
}

async function pngPixels(url,width,height){
 const response=await fetch(url);if(!response.ok)throw Error(`Terrain source fetch failed (${response.status})`);
 const bitmap=await createImageBitmap(await response.blob(),{colorSpaceConversion:'none',imageOrientation:'none',premultiplyAlpha:'none'});
 let canvas;
 try{
  if(bitmap.width!==width||bitmap.height!==height)throw Error('Terrain source dimensions do not match its manifest');
  canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):Object.assign(document.createElement('canvas'),{width,height});
  const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);
  return context.getImageData(0,0,width,height).data;
 }finally{bitmap.close();if(canvas){canvas.width=1;canvas.height=1;}}
}

export class TerrainSourceField {
 static async load(manifestURL){
  const response=await fetch(manifestURL);if(!response.ok)throw Error(`Terrain source manifest failed (${response.status})`);
  const meta=await response.json();TerrainSourceField.validateMeta(meta);
  if(!validSHA256(meta.heightPackedSHA256)||!validSHA256(meta.normalPixelsSHA256))throw Error('Invalid terrain source pixel checksums');
  // Decode sequentially to bound temporary image/canvas storage.
  let pixels=await pngPixels(sourceURL(response.url||manifestURL,meta.heightFile),meta.width,meta.height);
  const packed=new Uint8Array(meta.width*meta.height*2);
  for(let i=0;i<packed.length/2;i++){packed[i*2]=pixels[i*4];packed[i*2+1]=pixels[i*4+1];}
  pixels=null;
  // Validate the actual collision/displacement bytes before decoding normals.
  // The pair stays unavailable until both decoded payloads match its manifest.
  await verifyPixels(packed,meta.heightPackedSHA256,'height');
  const normals=await pngPixels(sourceURL(response.url||manifestURL,meta.normalFile),meta.width,meta.height);
  await verifyPixels(normals,meta.normalPixelsSHA256,'normal');
  return new TerrainSourceField(meta,packed,normals);
 }

 static validateMeta(meta){
  const b=meta?.worldBounds;
  if(!b||![b.xmin,b.xmax,b.zmin,b.zmax,meta.minH,meta.maxH,meta.blendWidthM].every(Number.isFinite)
   ||b.xmin>=b.xmax||b.zmin>=b.zmax||meta.minH>=meta.maxH||meta.blendWidthM<=0
   ||!Number.isInteger(meta.width)||!Number.isInteger(meta.height)||meta.width<2||meta.height<2||meta.width>8192||meta.height>8192
   ||meta.blendWidthM*2>=Math.min(b.xmax-b.xmin,b.zmax-b.zmin))throw Error('Invalid terrain source field manifest');
 }

 constructor(meta,packed,normals){
  TerrainSourceField.validateMeta(meta);
  const count=meta.width*meta.height;
  if(!(packed instanceof Uint8Array)||packed.length!==count*2||!ArrayBuffer.isView(normals)||normals.length!==count*4)throw Error('Invalid terrain source field pixels');
  this.meta=meta;this.packed=packed;this.normalPixels=normals;this.disposed=false;
  this.enabled=uniform(true);this.id=nextFieldId++;
  this.heightTexture=new THREE.DataTexture(packed,meta.width,meta.height,THREE.RGFormat,THREE.UnsignedByteType);
  Object.assign(this.heightTexture,{name:'terrainSourceHeight',flipY:false,colorSpace:THREE.NoColorSpace,
   minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,generateMipmaps:false,unpackAlignment:1});
  this.heightTexture.wrapS=this.heightTexture.wrapT=THREE.ClampToEdgeWrapping;this.heightTexture.needsUpdate=true;
  this.normalTexture=new THREE.DataTexture(normals,meta.width,meta.height,THREE.RGBAFormat,THREE.UnsignedByteType);
  Object.assign(this.normalTexture,{name:'terrainSourceNormal',flipY:false,colorSpace:THREE.NoColorSpace,
   minFilter:THREE.LinearMipmapLinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:true,anisotropy:8});
  this.normalTexture.wrapS=this.normalTexture.wrapT=THREE.ClampToEdgeWrapping;this.normalTexture.needsUpdate=true;
  this._makeNodes();
 }

 setEnabled(value){if(this.disposed)throw Error('Terrain source field is disposed');this.enabled.value=!!value;}

 weightAt(x,z){
  if(this.disposed||!this.enabled.value)return 0;
  const b=this.meta.worldBounds,B=this.meta.blendWidthM;
  return smooth(saturate(Math.min(x-b.xmin,b.xmax-x)/B))*smooth(saturate(Math.min(z-b.zmin,b.zmax-z)/B));
 }
 weightGradientAt(x,z){
  if(this.disposed||!this.enabled.value)return [0,0,0];
  const b=this.meta.worldBounds,B=this.meta.blendWidthM;
  const tx=saturate(Math.min(x-b.xmin,b.xmax-x)/B),tz=saturate(Math.min(z-b.zmin,b.zmax-z)/B);
  const sx=smooth(tx),sz=smooth(tz);
  return [sx*sz,6*tx*(1-tx)/B*(x<(b.xmin+b.xmax)/2?1:-1)*sz,
   6*tz*(1-tz)/B*(z<(b.zmin+b.zmax)/2?1:-1)*sx];
 }

 sourceHeightAt(x,z){
  if(this.disposed)throw Error('Terrain source field is disposed');
  const m=this.meta,b=m.worldBounds;
  const u=Math.max(0,Math.min(m.width-1,(x-b.xmin)/(b.xmax-b.xmin)*m.width-.5));
  const v=Math.max(0,Math.min(m.height-1,(b.zmax-z)/(b.zmax-b.zmin)*m.height-.5));
  const i=Math.floor(u),j=Math.floor(v),ii=Math.min(i+1,m.width-1),jj=Math.min(j+1,m.height-1),fx=u-i,fz=v-j;
  const q=(x,y)=>{const k=(y*m.width+x)*2;return this.packed[k]*256+this.packed[k+1];};
  const a=q(i,j)+(q(ii,j)-q(i,j))*fx,c=q(i,jj)+(q(ii,jj)-q(i,jj))*fx;
  return m.minH+(a+(c-a)*fz)/65535*(m.maxH-m.minH);
 }

 heightAt(x,z,baseHeightAt){
  const w=this.weightAt(x,z);
  if(w<=0)return baseHeightAt(x,z);
  const source=this.sourceHeightAt(x,z);if(w>=1)return source;
  const base=baseHeightAt(x,z);return base+(source-base)*w;
 }

 _makeNodes(){
  const m=this.meta,b=m.worldBounds,B=m.blendWidthM;
  this.uvNode=wp=>vec2(wp.x.sub(b.xmin).div(b.xmax-b.xmin),float(b.zmax).sub(wp.z).div(b.zmax-b.zmin));
  // Keep helpers inline: explicit-layout functions capture backend binding
  // names in this pinned Three version and become wrong in another material.
  this.weightGradientNode=Fn(([wp])=>{
   const tx=wp.x.sub(b.xmin).min(float(b.xmax).sub(wp.x)).div(B).clamp(0,1);
   const tz=wp.z.sub(b.zmin).min(float(b.zmax).sub(wp.z)).div(B).clamp(0,1);
   const sx=tx.mul(tx).mul(float(3).sub(tx.mul(2))),sz=tz.mul(tz).mul(float(3).sub(tz.mul(2)));
   const dx=tx.mul(float(1).sub(tx)).mul(6/B).mul(wp.x.lessThan((b.xmin+b.xmax)/2).select(1,-1)).mul(sz);
   const dz=tz.mul(float(1).sub(tz)).mul(6/B).mul(wp.z.lessThan((b.zmin+b.zmax)/2).select(1,-1)).mul(sx);
   return vec3(sx.mul(sz),dx,dz).mul(this.enabled.select(1,0));
  });
  this.sourceHeightNode=Fn(([wp])=>{
   const p=this.uvNode(wp).mul(vec2(m.width,m.height)).sub(.5).clamp(vec2(0),vec2(m.width-1,m.height-1)).toVar();
   const i=ivec2(floor(p)),j=i.add(ivec2(1)).min(ivec2(m.width-1,m.height-1)),f=fract(p);
   const load=xy=>{
    // No packed-channel filtering: texelLoad, exact byte recovery, decode,
    // then scalar f32 bilinear. Byte boundaries cannot create half errors.
    const rg=textureLoad(this.heightTexture,xy).rg.mul(255).round();
    return rg.x.mul(256).add(rg.y);
   };
   const a=load(i),bb=load(ivec2(j.x,i.y)),c=load(ivec2(i.x,j.y)),d=load(j);
   return mix(mix(a,bb,f.x),mix(c,d,f.x),f.y).mul((m.maxH-m.minH)/65535).add(m.minH);
  });
 }

 compositeHeightNode(baseHeightNode,suffix='Geometry',{implicitBaseFilter=false}={}){
  return Fn(([wp])=>{
   // An implicit filtered base sample must execute before varying branches
   // so its mip derivatives are defined across the field's outer edge.
   const base=implicitBaseFilter?baseHeightNode(wp).toVar():null;
   const getBase=()=>base||baseHeightNode(wp);
   const w=this.weightGradientNode(wp).x.toVar(),h=float(0).toVar();
   If(w.lessThanEqual(0),()=>{h.assign(getBase());}).ElseIf(w.greaterThanEqual(1),()=>{h.assign(this.sourceHeightNode(wp));})
    .Else(()=>{h.assign(mix(getBase(),this.sourceHeightNode(wp),w));});
   return h;
  });
 }

 normalNode(wp,baseNormal,baseGeometryHeight){
  return Fn(()=>{
   const weights=this.weightGradientNode(wp).toVar(),w=weights.x;
   // Keep implicit mip/anisotropic normal filtering in uniform control flow.
   // In the interior this replaces, rather than layers over, the older map.
   const encoded=texture(this.normalTexture,this.uvNode(wp)).rgb.mul(2).sub(1).toVar();
   const source=normalize(vec3(encoded.x,encoded.z,encoded.y)).toVar();
   const n=baseNormal.toVar();
   If(w.greaterThanEqual(1),()=>{n.assign(source);}).ElseIf(w.greaterThan(0),()=>{
    const oldSlope=baseNormal.xz.negate().div(baseNormal.y.max(.001));
    const newSlope=source.xz.negate().div(source.y.max(.001));
    const delta=this.sourceHeightNode(wp).sub(baseGeometryHeight(wp));
    const slope=mix(oldSlope,newSlope,w).add(weights.yz.mul(delta));
    n.assign(normalize(vec3(slope.x.negate(),1,slope.y.negate())));
   });
   return n;
  })();
 }

 // Union every source support cell into every overlapping base leaf. A
 // convex blend cannot exceed either source's local extrema. Baseline
 // bounds already contain their own bilinear support collar.
 expandBounds(leafMin,leafMax,worldSize,leavesPerEdge){
  const m=this.meta,b=m.worldBounds,stepX=(b.xmax-b.xmin)/m.width,stepZ=(b.zmax-b.zmin)/m.height;
  const leafSize=worldSize/leavesPerEdge,half=worldSize/2;
  const clampIndex=v=>Math.max(0,Math.min(leavesPerEdge-1,v));
  for(let j=0;j<m.height;j++){
   const z=b.zmax-(j+.5)*stepZ;
   const za=clampIndex(Math.floor((half-z-stepZ)/leafSize)),zb=clampIndex(Math.floor((half-z+stepZ)/leafSize));
   for(let i=0;i<m.width;i++){
    // Every pixel center is inside the rectangle and has nonzero weight.
    const x=b.xmin+(i+.5)*stepX;
    const xa=clampIndex(Math.floor((x-stepX+half)/leafSize)),xb=clampIndex(Math.floor((x+stepX+half)/leafSize));
    const k=(j*m.width+i)*2,h=m.minH+(this.packed[k]*256+this.packed[k+1])/65535*(m.maxH-m.minH);
    for(let by=za;by<=zb;by++)for(let bx=xa;bx<=xb;bx++){
     const p=by*leavesPerEdge+bx;leafMin[p]=Math.min(leafMin[p],h);leafMax[p]=Math.max(leafMax[p],h);
    }
   }
  }
 }

 dispose(){
  if(this.disposed)return;this.enabled.value=false;this.disposed=true;
  this.heightTexture.dispose();this.normalTexture.dispose();
  this.heightTexture.image.data=null;this.normalTexture.image.data=null;
  this.packed=null;this.normalPixels=null;
 }
}
