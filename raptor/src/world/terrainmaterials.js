// Deterministic terrain material tiles. RG = physical height derivatives;
// B = squared slope moment; A = rock mineral reflectance residual or snow/
// aggregate height. Linear mips preserve mean slopes and unresolved variance.
import * as THREE from 'three';
import {packTerrainPhotoArray,addTerrainPhotoDetail} from './terrainphoto.js';
import { Fn, texture, vec2, vec3, float, normalize, max, min, clamp, mix,
  smoothstep, dot, dFdx, dFdy, pow, sqrt, positionWorld, abs } from 'three/tsl';

const TILE_SIZE = 256;
const sat = x => Math.min(1, Math.max(0, x));
const mod = (x, n) => ((x % n) + n) % n;
const hash = (x, y, seed) => {
  let n = Math.imul(x ^ seed, 374761393) ^ Math.imul(y + seed, 668265263);
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
};
const noise = (x, y, period, seed, periodY = period) => {
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
  const h=(a,b)=>hash(mod(a,period),mod(b,periodY),seed);
  return (h(ix,iy)*(1-sx)+h(ix+1,iy)*sx)*(1-sy)+(h(ix,iy+1)*(1-sx)+h(ix+1,iy+1)*sx)*sy;
};
const cell = (u, v, nx, ny, seed) => {
  const x=u*nx,y=v*ny,ix=Math.floor(x),iy=Math.floor(y);
  let first=Infinity,second=Infinity,id=0;
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
    const cx=ix+i,cy=iy+j,wx=mod(cx,nx),wy=mod(cy,ny);
    const dx=cx+.1+.8*hash(wx,wy,seed)-x;
    const dy=cy+.1+.8*hash(wx,wy,seed+11)-y;
    const d=dx*dx+dy*dy;
    if(d<first){second=first;first=d;id=hash(wx,wy,seed+29);}else if(d<second)second=d;
  }
  return {first:Math.sqrt(first),second:Math.sqrt(second),id};
};

// Art-directed scales, not a claim to reconstruct geology absent from the DEM.
// Fractures span roughly 7–16m in a 96m tile, with decimeter relief. Aggregate
// clumps span about 0.5m in a 32m tile, with centimeter relief.
export function bakeTerrainDetail(kind, size = kind === 'snow' ? 512 : TILE_SIZE) {
  const rock=kind==='rock',snow=kind==='snow',periodM=rock?96:snow?64:32;
  const heights=new Float32Array(size*size), minerals=rock?new Float32Array(size*size):null;
  let mineralSum=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=(x+.5)/size,v=(y+.5)/size;
    let h;
    if(snow){
      // Decimeter wind-packed surface relief, not glacier crevasses or
      // invented mapped geography. Anisotropic continuous bands span
      // 1–4m across the wind and 3–16m along it; finer grain retires in mips.
      // Rectangular periodic noise avoids rows of regular sine-wave ridges.
      const warp=(noise(u*4,v*4,4,5939)-.5)*1.1;
      h=(noise(u*16+warp,v*4,16,4391,4)-.5)*.22;
      h+=(noise(u*56+warp*.3,v*20,56,1021,20)-.5)*.045;
      h+=(noise(u*128,v*128,128,7307)-.5)*.004;
    }else if(rock){
      const warpX=(noise(u*4,v*4,4,217)-.5)*.065;
      const warpY=(noise(u*4,v*4,4,541)-.5)*.065;
      const c=cell(u+warpX,v+warpY,6,14,1337);
      // Weathered relief carries the surface; sparse, interrupted joints
      // cut into it. Raised Voronoi cells would read as manufactured pavers.
      const jointMask=sat((noise(u*5,v*5,5,1231)-.30)/.45);
      h=(noise(u*8,v*8,8,2181)-.5)*.28;
      h+=(noise(u*18,v*18,18,981)-.5)*.18;
      h+=(noise(u*48,v*48,48,311)-.5)*.025;
      h-=.14*Math.exp(-Math.pow((c.second-c.first)/.10,2))*jointMask;
      // Generic centimetre-scale weathering along broken mineral bedding.
      // This shades a surface; it is not extra DEM or a geological survey.
      const bedWarp=(noise(u*4,v*4,4,6323)-.5)*1.6;
      const bedding=noise(u*8,v*48+bedWarp,8,9209,48)-.5;
      h+=bedding*.085;
      minerals[y*size+x]=bedding*.12+(noise(u*32,v*32,32,1277)-.5)*.045;
      mineralSum+=minerals[y*size+x];
    }else{
      const c=cell(u,v,64,64,7189);
      const crown=Math.pow(Math.max(0,1-c.first*c.first*2.2),2);
      h=crown*(.016+.026*c.id)+(noise(u*32,v*32,32,881)-.5)*.005;
    }
    heights[y*size+x]=h;
  }
  const mineralMean=mineralSum/(size*size);
  const values=new Float32Array(size*size*4),data=new Uint16Array(values.length),step=periodM/size;
  let minH=Infinity,maxH=-Infinity,mss=0,peakSlope=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const at=(a,b)=>heights[mod(b,size)*size+mod(a,size)];
    const dx=Math.max(-.7,Math.min(.7,(at(x+1,y)-at(x-1,y))/(2*step)));
    const dz=Math.max(-.7,Math.min(.7,(at(x,y+1)-at(x,y-1))/(2*step)));
    const k=(y*size+x)*4,s2=dx*dx+dz*dz,h=at(x,y);
    values[k]=dx;values[k+1]=dz;values[k+2]=s2;values[k+3]=rock?minerals[y*size+x]-mineralMean:h;
    minH=Math.min(minH,h);maxH=Math.max(maxH,h);mss+=s2;peakSlope=Math.max(peakSlope,Math.sqrt(s2));
  }
  for(let i=0;i<values.length;i++)data[i]=THREE.DataUtils.toHalfFloat(values[i]);
  return {kind,size,periodM,heights,values,data,stats:{minHeightM:minH,maxHeightM:maxH,meanSquaredSlope:mss/(size*size),peakSlope}};
}

let cached=null;
function detailTextures(includeSnow = false, photoDetail = null) {
  if(photoDetail?.status==='ready'){
    if(photoDetail.disposed)throw Error('Terrain photo state disposed');
    photoDetail.pack ||= packTerrainPhotoArray({rock:bakeTerrainDetail('rock'),aggregate:bakeTerrainDetail('aggregate'),snow:bakeTerrainDetail('snow')},photoDetail.photos);
    return {surface:photoDetail.pack.array,snow:photoDetail.pack.array,pack:photoDetail.pack};
  }
  if(cached && (!includeSnow || cached.snow))return cached;
  cached ||= {};
  const configure = (t, name) => {
    t.name=name;t.format=THREE.RGBAFormat;t.type=THREE.HalfFloatType;t.colorSpace=THREE.NoColorSpace;
    t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;
    t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=4;t.needsUpdate=true;
    return t;
  };
  if(!cached.surface){
    // Equal-size rock/aggregate fields occupy separate array layers. Their
    // original half-float bytes, periodic UVs and mip filtering are retained,
    // while the full terrain + native-shadow graph saves one texture binding.
    const rock=bakeTerrainDetail('rock'),aggregate=bakeTerrainDetail('aggregate');
    const data=new Uint16Array(rock.data.length+aggregate.data.length);
    data.set(rock.data);data.set(aggregate.data,rock.data.length);
    cached.surface=configure(new THREE.DataArrayTexture(data,TILE_SIZE,TILE_SIZE,2),'terrain-surface-slope-moments');
  }
  if(includeSnow && !cached.snow){
    const b=bakeTerrainDetail('snow');
    cached.snow=configure(new THREE.DataTexture(b.data,b.size,b.size),'terrain-snow-slope-moments');
  }
  return cached;
}

// CPU counterpart for isolated material-mask tests. Inputs are linear RGB.
export function terrainMaterialWeights(front, normalY, height, rgb=null, coverage=1) {
  const sm=(a,b,x)=>{const t=sat((x-a)/(b-a));return t*t*(3-2*t);};
  const cliff=sm(.055,.28,1-normalY);
  let vegetation=0,snow=0;
  if(front==='VALDEZ')vegetation=sm(5,40,height)*(1-sm(450,750,height))*(1-cliff);
  if(front==='MARIANAS')vegetation=sm(3,18,height)*(1-cliff)*.85;
  if(front==='VALDEZ')snow=sm(1000,1350,height)*(1-sm(.18,.5,1-normalY));
  if(rgb){
    const hi=Math.max(...rgb),lo=Math.min(...rgb),lum=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
    const green=sm(.035,.18,(rgb[1]-Math.max(rgb[0],rgb[2]))/(hi+.02));
    const ice=sm(.25,.65,lum)*(1-sm(.18,.5,(hi-lo)/(hi+.02)));
    vegetation=vegetation*(1-coverage)+green*coverage;
    if(front==='VALDEZ')snow=snow*(1-coverage)+ice*coverage;
  }
  if(front==='NELLIS')vegetation*=.4;
  const rock=(.08+.92*cliff)*(1-vegetation)*(1-snow);
  vegetation*=1-snow;
  return {rock,vegetation,snow,land:sm(-.5,3,height)};
}

export function terrainMaterialNodes({front,baseNormal,imageColor=null,coverage=float(1),worldPosition=positionWorld,photoDetail=null}) {
  const snowEnabled=front==='VALDEZ' && (typeof location==='undefined' ||
    new URLSearchParams(location.search).get('snowdetail')!=='0');
  const textures=detailTextures(snowEnabled,front==='VALDEZ'?photoDetail:null),wp=worldPosition;
  const dx=dFdx(wp),dy=dFdy(wp);
  // Frobenius footprint is conservative and invariant to camera roll. A
  // max(dx,dy) estimate changes at 45 degrees and can modulate fine relief.
  const fp=sqrt(dot(dx,dx).add(dot(dy,dy))).toVar('terrainPixelMeters');
  const cliff=smoothstep(.055,.28,float(1).sub(baseNormal.y));
  let vegetation=float(0),snow=float(0);
  if(front==='VALDEZ')vegetation=smoothstep(5,40,wp.y).mul(smoothstep(750,450,wp.y)).mul(cliff.oneMinus());
  if(front==='MARIANAS')vegetation=smoothstep(3,18,wp.y).mul(cliff.oneMinus()).mul(.85);
  if(front==='VALDEZ')snow=smoothstep(1000,1350,wp.y).mul(smoothstep(.5,.18,float(1).sub(baseNormal.y)));
  if(imageColor){
    const hi=max(imageColor.r,max(imageColor.g,imageColor.b)),lo=min(imageColor.r,min(imageColor.g,imageColor.b));
    const green=smoothstep(.035,.18,imageColor.g.sub(max(imageColor.r,imageColor.b)).div(hi.add(.02)));
    vegetation=mix(vegetation,green,coverage);
    if(front==='VALDEZ'){
      const lum=dot(imageColor,vec3(.2126,.7152,.0722));
      const ice=smoothstep(.25,.65,lum).mul(smoothstep(.5,.18,hi.sub(lo).div(hi.add(.02))));
      snow=mix(snow,ice,coverage);
    }
  }
  if(front==='NELLIS')vegetation=vegetation.mul(.4);
  const vegetationBase=vegetation.toVar('terrainVegetationBase');
  snow=snow.toVar('terrainSnow');
  const land=smoothstep(-.5,3,wp.y).toVar('terrainLand');
  // Projection weights are continuous, signed-normal safe, and independent
  // of the camera. All implicit texture samples stay in uniform control flow.
  const w0=pow(abs(baseNormal),vec3(4));
  const weights=w0.div(max(w0.x.add(w0.y).add(w0.z),1e-6)).toVar('terrainProjectionWeights');
  const tangent=g=>g.sub(baseNormal.mul(dot(baseNormal,g)));
  const tap=(tex,bakedPeriod,period,angle,plane,label,layer=null,offset=[0,0])=>{
    const coordinates=plane==='x'?wp.zy:plane==='z'?wp.xy:wp.xz;
    const c=Math.cos(angle),s=Math.sin(angle);
    const uv=vec2(coordinates.x.mul(c).sub(coordinates.y.mul(s)),
      coordinates.x.mul(s).add(coordinates.y.mul(c))).div(period).add(vec2(...offset));
    const sampleUV=textures.pack&&(layer===0||layer===1)?uv.mul(.5):uv;
    const source=texture(tex,sampleUV),m=(layer===null?source:source.depth(layer)).toVar(label);
    // Stored slopes are height derivatives at bakedPeriod; stretching the
    // tile scales both the resolved gradient and its squared moment.
    const scale=bakedPeriod/period;
    const u=m.r.mul(c).add(m.g.mul(s)).mul(scale),v=m.g.mul(c).sub(m.r.mul(s)).mul(scale);
    const g=plane==='x'?vec3(0,v,u):plane==='z'?vec3(u,v,0):vec3(u,0,v);
    return {gradient:tangent(g),moment:m.b.mul(scale*scale),aux:m.a};
  };
  const tri=(tex,bakedPeriod,label,layer=null,pair=false)=>{
    const axes=['x','y','z'],parts=[];
    for(let i=0;i<3;i++){
      const a=tap(tex,bakedPeriod,bakedPeriod,[.21,.6458,-.31][i],axes[i],label+axes[i]+'A',layer,
        [[.173,.619],[0,0],[.731,.287]][i]);
      if(pair){
        const b=tap(tex,bakedPeriod,bakedPeriod*139/96,[-.63,-.4014,.72][i],axes[i],label+axes[i]+'B',layer,[.237,.513]);
        parts.push({gradient:a.gradient.mul(.62).add(b.gradient.mul(.38)),
          moment:a.moment.mul(.62).add(b.moment.mul(.38)),aux:a.aux.mul(.62).add(b.aux.mul(.38))});
      }else parts.push(a);
    }
    const blend=key=>parts[0][key].mul(weights.x).add(parts[1][key].mul(weights.y)).add(parts[2][key].mul(weights.z));
    return {gradient:blend('gradient').toVar(label+'Gradient'),moment:blend('moment'),aux:blend('aux')};
  };
  const coarse=tri(textures.surface,96,'geology',0,true);
  const fine=tri(textures.surface,32,'aggregate',1);
  const coarseFade=smoothstep(5,1,fp),fineFade=smoothstep(.8,.12,fp);
  // Keep the original micro aggregate's two-octave RMS when using one
  // well-resolved tile per projection. The larger rock joints retain two.
  const singleGain=Math.sqrt(.62*.62+.38*.38);
  let windpack=null;
  if(snowEnabled){
    windpack=tri(textures.snow,64,'snowWindpack',textures.pack?2:null);
    // Only mixed material pixels move. No snow appears on bare terrain;
    // fully snow-covered imagery stays covered. The ripple field is filtered
    // at the same footprint as the normal, rather than a binary snow mask.
    const snowEdge=clamp(windpack.aux.mul(-3),-.35,.35).mul(smoothstep(3,.4,fp));
    snow=snow.add(snow.mul(snow.oneMinus()).mul(snowEdge)).clamp(0,1).toVar('terrainDepositedSnow');
  }
  vegetation=vegetationBase.mul(snow.oneMinus()).toVar('terrainVegetation');
  const localRock=cliff.mul(.92).add(.08).mul(vegetationBase.oneMinus()).mul(snow.oneMinus());
  const coarseGain=localRock.mul(.95).mul(land);
  const fineGain=mix(float(.7),float(.16),vegetation).mul(mix(float(1),float(.22),snow)).mul(land).mul(singleGain);
  const variance=(field,fade)=>max(field.moment.sub(dot(field.gradient,field.gradient).mul(fade.mul(fade))),0);
  let gradient=coarse.gradient.mul(coarseGain).mul(coarseFade).add(fine.gradient.mul(fineGain).mul(fineFade));
  let lost=variance(coarse,coarseFade).mul(coarseGain.mul(coarseGain))
    .add(variance(fine,fineFade).mul(fineGain.mul(fineGain)));
  if(windpack){
    const snowGain=snow.mul(land).mul(singleGain),snowFade=smoothstep(3,.4,fp);
    gradient=gradient.add(windpack.gradient.mul(snowGain).mul(snowFade));
    lost=lost.add(variance(windpack,snowFade).mul(snowGain.mul(snowGain)));
  }
  // Surface gradients lie in N's tangent plane. Therefore dot(N,N-g)=1:
  // no overhang flip or axis-sign ambiguity, and zero detail is identity.
  const normalWorld=normalize(baseNormal.sub(gradient)).toVar('terrainDetailedNormalWorld');
  const mineral=coarse.aux.mul(localRock).mul(land).mul(coarseFade).toVar('terrainMineralReflectance');
  const baseR=mix(mix(mix(float(.94),float(.84),localRock),float(.98),vegetation),float(.86),snow)
    .add(mineral.mul(-.35));
  // Convex projected moments retain disagreement and unresolved relief;
  // this is a conservative scalar roughness model, not anisotropic LEAN.
  const roughness=clamp(pow(pow(baseR,4).add(lost.mul(2)),.25),.8,.99);
  const albedoNode=color=>{
    const base=color,peak=max(base.r,max(base.g,base.b));
    // Symmetric headroom preserves zero-mean mineral variation without
    // dark freckles on already-white snow or clipping only positive lobes.
    const bound=.1;
    const headroom=clamp(float(1).sub(peak).div(max(peak,1e-5).mul(bound)),0,1);
    return base.mul(float(1).add(mineral.mul(headroom)));
  };
  if(textures.pack)return addTerrainPhotoDetail({pack:textures.pack,front,wp,baseNormal,normalWorld,roughness,baseR,land,rock:localRock,snow,fp,albedoNode,textures});
  return {normalWorld,roughness,land,textures,albedoNode};
}
