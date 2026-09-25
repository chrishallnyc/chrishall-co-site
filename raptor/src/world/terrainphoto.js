// Optional CC0 near-material data. Importing this module performs no I/O.
import * as THREE from 'three';
import {Fn,If,texture,vec2,vec3,float,dot,normalize,max,clamp,smoothstep,dFdx,dFdy,pow,mix,struct,select,Stack} from 'three/tsl';

const ROOT=new URL('../../assets/terrain-photo/',import.meta.url);
export const TERRAIN_PHOTO_VERSION='scanned-v2-uniform-scale';
const MANIFEST_SHA256='683b48f578c2b16e46d04c2afb87a7e7b607332cb85922497f5c76bd5ddd2403';
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');

async function readBounded(stream,limit,signal){
  signal?.throwIfAborted();
  if(!stream)throw Error('Empty terrain photo response');
  const reader=stream.getReader(),data=new Uint8Array(limit);let at=0;
  const abort=()=>{void reader.cancel(signal.reason).catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try{
    for(;;){
      signal?.throwIfAborted();const part=await reader.read();signal?.throwIfAborted();
      if(part.done)break;
      if(at+part.value.byteLength>limit)throw Error('Oversize terrain photo response');
      data.set(part.value,at);at+=part.value.byteLength;
    }
    return data.slice(0,at);
  }finally{
    signal?.removeEventListener('abort',abort);
    await reader.cancel().catch(()=>{});reader.releaseLock();
  }
}

export async function loadTerrainPhotoPixels({baseURL=ROOT,signal}={}){
  signal?.throwIfAborted();const start=performance.now();
  const reply=await fetch(new URL('manifest.json',baseURL),{signal});
  if(!reply.ok)throw Error('Terrain photo manifest unavailable');
  const manifestBytes=await readBounded(reply.body,65536,signal);
  if(await sha(manifestBytes)!==MANIFEST_SHA256)throw Error('Terrain photo manifest hash mismatch');
  const manifest=JSON.parse(new TextDecoder().decode(manifestBytes));
  if(manifest.version!==1)throw Error('Terrain photo manifest version');
  const kinds=['rock','snow'],entries={},requests=[];
  const selected=kinds.map(kind=>manifest.materials.filter(m=>m.kind===kind));
  if(selected.some(items=>items.length!==1))throw Error('Missing or duplicate terrain photo');
  const settled=await Promise.allSettled(selected.map(async([meta])=>{
    if(meta.size!==512||meta.bytes!==2097152||meta.encoding!=='rgba16f-le'||
      meta.file!==`${meta.kind}-photo-moments-512.rgba16f.gz`||
      meta.periodM!==({rock:2.7,snow:2}[meta.kind])||
      !Number.isFinite(meta.mipProof?.[0]?.mean?.[2])||meta.mipProof[0].mean[2]<=0)
      throw Error('Invalid terrain photo descriptor');
    const before=performance.now(),response=await fetch(new URL(meta.file,baseURL),{signal});
    if(!response.ok)throw Error('Terrain photo unavailable');
    let bytes=await readBounded(response.body,Math.max(meta.bytes,meta.gzipBytes),signal);
    const received=bytes.byteLength;
    if(bytes[0]===31&&bytes[1]===139)
      bytes=await readBounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),meta.bytes,signal);
    if(bytes.byteLength!==meta.bytes||await sha(bytes)!==meta.sha256)throw Error('Terrain photo hash mismatch');
    signal?.throwIfAborted();
    entries[meta.kind]={data:new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2),meta};
    requests.push({kind:meta.kind,receivedBytes:received,decodedBytes:bytes.byteLength,elapsedMS:performance.now()-before});
  }));
  const failed=settled.find(row=>row.status==='rejected');
  if(failed){for(const entry of Object.values(entries))entry.data=null;throw failed.reason;}
  return{manifest,entries,load:{elapsedMS:performance.now()-start,requests}};
}

export function terrainPhotoEligible(front,tier){
  return front==='VALDEZ'&&(tier==='HIGH'||tier==='ULTRA');
}

function state({requested,eligible,status,reason=null,photos=null}){
  let disposed=false;
  return{requested,eligible,status,reason,photos,pack:null,
    get disposed(){return disposed;},
    diagnostics(){return{requested,eligible,status,reason,disposed,version:TERRAIN_PHOTO_VERSION,
      hashes:photos?Object.fromEntries(Object.entries(photos.entries).map(([kind,e])=>[kind,e.meta.sha256])):null,
      load:photos?.load||null,packed:this.pack?.diagnostics()||null};},
    dispose(){if(disposed)return;disposed=true;this.pack?.dispose();this.pack=null;
      if(photos)for(const entry of Object.values(photos.entries))entry.data=null;
      this.photos=null;photos=null;}};
}

// The result is fixed before material creation. Failure/timeout never upgrades
// a compiled foundation material later, and no texture is made by this loader.
export async function prepareTerrainPhoto({front,tier=null,requested=false,
  baseURL=ROOT,timeoutMS=4000,signal}={}){
  const eligible=terrainPhotoEligible(front,tier),want=!!requested;
  if(!want||!eligible)return state({requested:want,eligible,status:'disabled',reason:!want?'not-requested':'front-or-tier'});
  if(!Number.isFinite(timeoutMS)||timeoutMS<1||timeoutMS>60000)
    return state({requested:want,eligible,status:'fallback',reason:'invalid-deadline'});
  const controller=new AbortController();let closed=false,timer;
  const forward=()=>controller.abort(signal.reason);
  signal?.addEventListener('abort',forward,{once:true});if(signal?.aborted)forward();
  let rejectDeadline;
  const deadline=new Promise((_,reject)=>{rejectDeadline=reject;timer=setTimeout(()=>{
    const error=new DOMException('Terrain photo deadline','TimeoutError');controller.abort(error);reject(error);
  },timeoutMS);});
  const abort=()=>rejectDeadline(controller.signal.reason||new DOMException('Aborted','AbortError'));
  controller.signal.addEventListener('abort',abort,{once:true});
  const work=loadTerrainPhotoPixels({baseURL,signal:controller.signal});
  // An unusual fetch implementation may ignore abort. Such a late completion
  // still owns no GPU objects and cannot publish into the returned fallback.
  work.then(photos=>{if(closed)for(const entry of Object.values(photos.entries))entry.data=null;},()=>{});
  try{
    const photos=await Promise.race([work,deadline]);
    return state({requested:want,eligible,status:'ready',photos});
  }catch(error){
    return state({requested:want,eligible,status:'fallback',reason:error?.name==='TimeoutError'?'deadline':error?.name==='AbortError'?'aborted':String(error?.message||error)});
  }finally{
    closed=true;clearTimeout(timer);signal?.removeEventListener('abort',forward);
    controller.signal.removeEventListener('abort',abort);controller.abort();
  }
}

export function packTerrainPhotoArray(foundation,photos){
 const size=512,stride=size*size*4;let data=new Uint16Array(stride*5);const layers={rock:0,aggregate:1,windpack:2,photoRock:3,photoSnow:4};
 // Repeat each256 tile2x2, not resample it. Halving its UV preserves texel
 // centers, pixel derivatives, physical period and every shared mip exactly.
 for(const[k,layer]of [['rock',0],['aggregate',1]]){
  const src=foundation[k];if(src.size!==256||src.data.length!==256*256*4)throw Error('Foundation dimensions');
  for(let y=0;y<size;y++){const row=src.data.subarray((y%256)*256*4,(y%256+1)*256*4),at=layer*stride+y*size*4;data.set(row,at);data.set(row,at+256*4);}
 }
 if(foundation.snow.size!==512||foundation.snow.data.length!==stride)throw Error('Snow dimensions');data.set(foundation.snow.data,2*stride);
 for(const[k,layer]of [['rock',3],['snow',4]]){const e=photos.entries[k];if(!(e?.data instanceof Uint16Array)||e.data.length!==stride)throw Error('Photo pixels unavailable');data.set(e.data,layer*stride);}
 const array=new THREE.DataArrayTexture(data,size,size,5);Object.assign(array,{name:'terrain-unified-material-moments',format:THREE.RGBAFormat,type:THREE.HalfFloatType,colorSpace:THREE.NoColorSpace,flipY:false,wrapS:THREE.RepeatWrapping,wrapT:THREE.RepeatWrapping,magFilter:THREE.LinearFilter,minFilter:THREE.LinearMipmapLinearFilter,generateMipmaps:true,anisotropy:4});array.needsUpdate=true;
 // Release duplicate photo payload buffers after packing, preserving views.
 for(const[k,layer]of [['rock',3],['snow',4]])photos.entries[k].data=data.subarray(layer*stride,(layer+1)*stride);
 let disposed=false;return{array,layers,photos,get disposed(){return disposed;},dispose(){if(disposed)return;disposed=true;array.dispose();array.image.data=null;for(const e of Object.values(photos.entries))e.data=null;data=null;},diagnostics(){return{disposed,size:[512,512,5],anisotropy:4,cpuBytes:data?.byteLength||0,gpuLogicalBytes:disposed?0:Array.from({length:10},(_,l)=>(512>>l)**2*8*5).reduce((a,b)=>a+b),load:photos.load,photoHashes:Object.fromEntries(Object.entries(photos.entries).map(([k,e])=>[k,e.meta.sha256]))};}};
}

const PhotoResult=struct({gradient:'vec3',moment:'float',residual:'float'});
export function addTerrainPhotoDetail({pack,front,wp,baseNormal,normalWorld,roughness,baseR,land,rock,snow,fp,albedoNode,textures}){
 if(pack.disposed)throw Error('Terrain photo material disposed');
 const N=normalize(normalWorld).toVar('terrainPhotoFoundationNormal'),raw=pow(baseNormal.abs(),vec3(4)),weights=raw.div(max(raw.x.add(raw.y).add(raw.z),1e-6)).toVar('terrainPhotoProjectionWeights');
 const sampleKind=(kind,layer,mask)=>{
  const desc=pack.photos.entries[kind].meta,period=desc.periodM;
  const fade=float(1).sub(smoothstep(period*.25,period*.85,fp)).toVar('terrainPhoto'+kind+'Fade');
  // Gradients are materialized before any varying branch. Explicit gradient
  // texture samples can then skip absent/far material without invalid LOD.
  const result=Fn(()=>{
  Stack(N);Stack(weights);
  const projections=['x','y','z'].map((axis,i)=>{
   const coords=axis==='x'?wp.zy:axis==='z'?wp.xy:wp.xz;
   const taps=[0,1].map(j=>{
    const angle=[.371,-.713,.219][i]+j*1.151,c=Math.cos(angle),s=Math.sin(angle),scale=j?1/1.431:1;
    const uv=vec2(coords.x.mul(c).sub(coords.y.mul(s)),coords.x.mul(s).add(coords.y.mul(c))).mul(scale/period).add(vec2(...[[.173,.619],[.731,.287],[.293,.157]][i])).add(vec2(j*.391,j*.733)).toVar('terrainPhoto'+kind+axis+'UV'+j);
    const dx=dFdx(uv).toVar('terrainPhoto'+kind+axis+'Dx'+j),dy=dFdy(uv).toVar('terrainPhoto'+kind+axis+'Dy'+j);
    Stack(dx);Stack(dy);return{axis,c,s,scale,uv,dx,dy};
   });return taps;
  });
   const gradient=vec3(0).toVar('terrainPhoto'+kind+'Gradient'),moment=float(desc.mipProof[0].mean[2]).toVar('terrainPhoto'+kind+'Moment'),residual=float(0).toVar('terrainPhoto'+kind+'Residual');
   If(mask.greaterThan(0).and(fade.greaterThan(0)),()=>{
    const samples=projections.map(taps=>{
     const values=taps.map(({axis,c,s,scale,uv,dx,dy},j)=>{
      const m=texture(pack.array,uv).depth(layer).grad(dx,dy).toVar('terrainPhoto'+kind+axis+'Sample'+j);
      // Each copy is uniformly enlarged in all three physical dimensions.
      // Its normal slopes and intrinsic roughness stay unchanged; only
      // orientation rotates. Scaling packed B would also scale roughness^4.
      const u=m.r.mul(c).add(m.g.mul(s)),v=m.g.mul(c).sub(m.r.mul(s)),g=axis==='x'?vec3(0,v,u):axis==='z'?vec3(u,v,0):vec3(u,0,v);
      return{gradient:g.sub(N.mul(dot(N,g))),moment:m.b,residual:m.a};
     });return Object.fromEntries(['gradient','moment','residual'].map(k=>[k,values[0][k].add(values[1][k]).mul(.5)]));
    });
    const blend=k=>samples[0][k].mul(weights.x).add(samples[1][k].mul(weights.y)).add(samples[2][k].mul(weights.z));
    gradient.assign(blend('gradient').mul(fade));moment.assign(mix(moment,blend('moment'),fade));residual.assign(blend('residual').mul(fade));
   });
   return PhotoResult(gradient,moment,residual);
  })().toVar('terrainPhoto'+kind+'Result');
  return{gradient:result.get('gradient'),moment:result.get('moment'),residual:result.get('residual'),fade};
 };
 const wr=rock.mul(land).toVar('terrainPhotoRockWeight'),ws=front==='VALDEZ'?snow.mul(land).toVar('terrainPhotoSnowWeight'):float(0);
 const r=sampleKind('rock',3,wr);
 let gradient=r.gradient.mul(wr),moment=r.moment.mul(wr),residual=r.residual.mul(wr),bound=r.fade.mul(wr).mul(.32),weight=wr;
 if(front==='VALDEZ'){
  const s=sampleKind('snow',4,ws);gradient=gradient.add(s.gradient.mul(ws));moment=moment.add(s.moment.mul(ws));residual=residual.add(s.residual.mul(ws));bound=bound.add(s.fade.mul(ws).mul(.15));weight=weight.add(ws);
 }
 gradient=gradient.toVar('terrainPhotoSurfaceGradient');
 const active=weight.greaterThan(0),normal=select(active,normalize(N.sub(gradient)),normalWorld).toVar('terrainPhotoNormalWorld');
 const r4=pow(roughness,4).add(moment).sub(pow(baseR,4).mul(weight)).sub(dot(gradient,gradient).mul(2));
 const finalR=select(active,clamp(pow(max(r4,1e-4),.25),.45,1),roughness);
 const finalAlbedo=color=>{
  const base=albedoNode(color),peak=max(base.r,max(base.g,base.b));
  const headroom=clamp(float(1).sub(peak).div(max(peak,1e-5).mul(max(bound,1e-6))),0,1);
  return base.mul(float(1).add(residual.mul(headroom)));
 };
 return{normalWorld:normal,roughness:finalR,land,textures,albedoNode:finalAlbedo};
}

