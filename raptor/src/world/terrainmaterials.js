// Small deterministic material tiles, expressed as height derivatives rather
// than color noise. RG = world-meter height slopes; B = squared slope moment.
// Linear mip filtering preserves the mean slope and its unresolved variance.
import * as THREE from 'three';
import { Fn, texture, vec2, vec3, float, normalize, max, min, clamp, mix,
  smoothstep, dot, dFdx, dFdy, pow, sqrt, positionWorld } from 'three/tsl';

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
  const heights=new Float32Array(size*size);
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
    }else{
      const c=cell(u,v,64,64,7189);
      const crown=Math.pow(Math.max(0,1-c.first*c.first*2.2),2);
      h=crown*(.016+.026*c.id)+(noise(u*32,v*32,32,881)-.5)*.005;
    }
    heights[y*size+x]=h;
  }
  const values=new Float32Array(size*size*4),data=new Uint16Array(values.length),step=periodM/size;
  let minH=Infinity,maxH=-Infinity,mss=0,peakSlope=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const at=(a,b)=>heights[mod(b,size)*size+mod(a,size)];
    const dx=Math.max(-.7,Math.min(.7,(at(x+1,y)-at(x-1,y))/(2*step)));
    const dz=Math.max(-.7,Math.min(.7,(at(x,y+1)-at(x,y-1))/(2*step)));
    const k=(y*size+x)*4,s2=dx*dx+dz*dz,h=at(x,y);
    values[k]=dx;values[k+1]=dz;values[k+2]=s2;values[k+3]=h;
    minH=Math.min(minH,h);maxH=Math.max(maxH,h);mss+=s2;peakSlope=Math.max(peakSlope,Math.sqrt(s2));
  }
  for(let i=0;i<values.length;i++)data[i]=THREE.DataUtils.toHalfFloat(values[i]);
  return {kind,size,periodM,heights,values,data,stats:{minHeightM:minH,maxHeightM:maxH,meanSquaredSlope:mss/(size*size),peakSlope}};
}

let cached=null;
function detailTextures(includeSnow = false) {
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
  vegetation*=1-snow;
  const rock=(.08+.92*cliff)*(1-vegetation)*(1-snow);
  return {rock,vegetation,snow,land:sm(-.5,3,height)};
}

export function terrainMaterialNodes({front,baseNormal,imageColor=null,coverage=float(1),worldPosition=positionWorld}) {
  const snowEnabled=front==='VALDEZ' && (typeof location==='undefined' ||
    new URLSearchParams(location.search).get('snowdetail')!=='0');
  const textures=detailTextures(snowEnabled),wp=worldPosition;
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
  vegetation=vegetation.mul(snow.oneMinus()).toVar('terrainVegetation');
  snow=snow.toVar('terrainSnow');
  const land=smoothstep(-.5,3,wp.y).toVar('terrainLand');
  const rock=cliff.mul(.92).add(.08).mul(vegetation.oneMinus()).mul(snow.oneMinus()).toVar('terrainRock');
  const pair=(tex,periodA,periodB,angleA,angleB,label,layer=null)=>{
    const tap=(period,angle)=>{
      const c=Math.cos(angle),s=Math.sin(angle);
      const uv=vec2(wp.x.mul(c).sub(wp.z.mul(s)),wp.x.mul(s).add(wp.z.mul(c))).div(period);
      const source=texture(tex,uv);
      const t=(layer===null?source:source.depth(layer)).toVar(label+'Sample'+period);
      const slope=vec2(t.r.mul(c).add(t.g.mul(s)),t.g.mul(c).sub(t.r.mul(s)));
      return {slope,lost:max(t.b.sub(dot(t.rg,t.rg)),0)};
    };
    const a=tap(periodA,angleA),b=tap(periodB,angleB);
    const slope=a.slope.mul(.62).add(b.slope.mul(.38)).toVar(label+'Slope');
    const lost=a.lost.mul(.62*.62).add(b.lost.mul(.38*.38)).toVar(label+'Lost');
    return {slope,lost};
  };
  const coarse=pair(textures.surface,96,139,.6458,-.4014,'geology',0);
  const fine=pair(textures.surface,32,47,-.2967,.9076,'aggregate',1);
  const coarseGain=rock.mul(.95).mul(land);
  const fineGain=mix(float(.7),float(.16),vegetation).mul(mix(float(1),float(.22),snow)).mul(land);
  const coarseFade=smoothstep(5,1,fp),fineFade=smoothstep(.8,.12,fp);
  let slopes=coarse.slope.mul(coarseGain).mul(coarseFade).add(fine.slope.mul(fineGain).mul(fineFade));
  let snowLost=float(0);
  if(snowEnabled){
    const windpack=pair(textures.snow,64,91,-.52,-.44,'snowWindpack');
    const snowGain=snow.mul(land),snowFade=smoothstep(3,.4,fp);
    slopes=slopes.add(windpack.slope.mul(snowGain).mul(snowFade));
    snowLost=windpack.lost.add(dot(windpack.slope,windpack.slope)
      .mul(snowFade.mul(snowFade).oneMinus())).mul(snowGain.mul(snowGain));
  }
  const detailNormal=normalize(vec3(slopes.x.negate(),1,slopes.y.negate()));
  // Reorient the fine normal onto the actual terrain normal. A flat detail
  // is the identity, and steep mountains keep their underlying orientation.
  const q=baseNormal.add(vec3(0,1,0)),u=detailNormal.mul(vec3(-1,1,-1));
  const normalWorld=normalize(q.mul(dot(q,u)).sub(u.mul(q.y))).toVar('terrainDetailedNormalWorld');
  const lost=coarse.lost.add(dot(coarse.slope,coarse.slope).mul(coarseFade.mul(coarseFade).oneMinus())).mul(coarseGain.mul(coarseGain))
    .add(fine.lost.add(dot(fine.slope,fine.slope).mul(fineFade.mul(fineFade).oneMinus())).mul(fineGain.mul(fineGain)))
    .add(snowLost);
  const baseR=mix(mix(mix(float(.94),float(.84),rock),float(.98),vegetation),float(.86),snow);
  // Conservative variance-aware roughness; not a claim of an exact GGX
  // variance conversion. Preserve unresolved relief without shiny aliasing.
  const roughness=clamp(pow(pow(baseR,4).add(lost.mul(2)),.25),.8,.99);
  return {normalWorld,roughness,land,textures};
}
