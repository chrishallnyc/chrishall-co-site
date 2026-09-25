// Portable asset/loader/ownership contracts; native appearance remains separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {DataUtils} from 'three';
import {prepareTerrainPhoto,packTerrainPhotoArray} from '../src/world/terrainphoto.js';
import {bakeTerrainDetail} from '../src/world/terrainmaterials.js';

const assets=new URL('../assets/terrain-photo/',import.meta.url);
const manifestBytes=await readFile(new URL('manifest.json',assets));
const manifest=JSON.parse(manifestBytes),compressed={},plain={};
for(const meta of manifest.materials){compressed[meta.kind]=await readFile(new URL(meta.file,assets));plain[meta.kind]=gunzipSync(compressed[meta.kind]);}
const request={front:'VALDEZ',tier:'HIGH',requested:true};

function fixture(mode='gzip'){
  const calls=[];let aborted=0,siblingSettled=false;
  return{calls,get aborted(){return aborted;},get siblingSettled(){return siblingSettled;},
    async fetch(url,{signal}={}){
      const file=new URL(url).pathname.split('/').at(-1);calls.push(file);
      if(mode==='headers-hang')return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(signal.reason);},{once:true}));
      if(mode==='body-hang'&&file==='manifest.json')return new Response(new ReadableStream({cancel(){aborted++;}}));
      if(file==='manifest.json'){const bytes=Buffer.from(manifestBytes);if(mode==='manifest-corrupt')bytes[0]^=1;return new Response(bytes);}
      const kind=file.startsWith('rock')?'rock':'snow';
      if(mode==='missing'&&kind==='snow')return new Response('',{status:404});
      if(mode==='corrupt'&&kind==='snow'){await new Promise(resolve=>setTimeout(resolve,5));siblingSettled=true;}
      const bytes=Buffer.from(mode==='plain'||mode==='corrupt'?plain[kind]:compressed[kind]);
      if(mode==='corrupt'&&kind==='rock')bytes[0]^=1;
      return new Response(bytes);
    }};
}

test('photographed material fetches only requested Valdez HIGH/ULTRA assets',async t=>{
  const f=fixture();t.mock.method(globalThis,'fetch',f.fetch.bind(f));
  for(const front of ['NELLIS','MARIANAS','VALDEZ'])for(const tier of ['LOW','MED','HIGH','ULTRA']){
    if(front==='VALDEZ'&&['HIGH','ULTRA'].includes(tier))continue;
    const state=await prepareTerrainPhoto({front,tier,requested:true});
    assert.equal(state.status,'disabled');assert.equal(state.photos,null);
  }
  assert.equal((await prepareTerrainPhoto({...request,requested:false})).status,'disabled');
  assert.equal(f.calls.length,0);
  const controller=new AbortController();controller.abort();
  const state=await prepareTerrainPhoto({...request,signal:controller.signal});
  assert.equal(state.status,'fallback');assert.equal(state.reason,'aborted');assert.equal(f.calls.length,0);
});

test('complete decoded photo pair is hash-checked before any texture allocation',async t=>{
  const f=fixture();t.mock.method(globalThis,'fetch',f.fetch.bind(f));
  const state=await prepareTerrainPhoto(request);
  assert.equal(state.status,'ready');assert.equal(state.pack,null);assert.equal(f.calls.length,3);
  for(const kind of ['rock','snow']){
    const data=state.photos.entries[kind].data;
    assert.deepEqual(new Uint8Array(data.buffer,data.byteOffset,data.byteLength),new Uint8Array(plain[kind]));
  }
  await new Promise(resolve=>setImmediate(resolve));assert(state.photos.entries.rock.data.length>0);
  const other=fixture('plain');globalThis.fetch=other.fetch.bind(other);
  const decoded=await prepareTerrainPhoto({...request,tier:'ULTRA'});
  for(const kind of ['rock','snow'])assert.deepEqual(decoded.photos.entries[kind].data,state.photos.entries[kind].data);
  decoded.dispose();state.dispose();
});

test('corrupted metadata, same-size pixels and incomplete pairs keep coherent foundation fallback',async t=>{
  for(const mode of ['manifest-corrupt','corrupt','missing']){
    const f=fixture(mode);const mock=t.mock.method(globalThis,'fetch',f.fetch.bind(f));
    const state=await prepareTerrainPhoto(request);
    assert.equal(state.status,'fallback');assert.equal(state.photos,null);assert.equal(state.pack,null);
    if(mode==='corrupt')assert(f.siblingSettled);
    mock.mock.restore();
  }
});

test('optional photo deadline aborts both headers and stalled response-body work',async t=>{
  for(const mode of ['headers-hang','body-hang']){
    const f=fixture(mode);const mock=t.mock.method(globalThis,'fetch',f.fetch.bind(f));
    const state=await prepareTerrainPhoto({...request,timeoutMS:10});
    assert.equal(state.status,'fallback');assert.equal(state.reason,'deadline');assert.equal(state.photos,null);assert.equal(state.pack,null);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(f.aborted,1);
    mock.mock.restore();
  }
});

test('packed photo moments retain foundation bytes, positive variance and idempotent ownership',async t=>{
  const f=fixture();t.mock.method(globalThis,'fetch',f.fetch.bind(f));
  const state=await prepareTerrainPhoto(request);
  const foundation=Object.fromEntries(['rock','aggregate','snow'].map(kind=>[kind,bakeTerrainDetail(kind)]));
  state.pack=packTerrainPhotoArray(foundation,state.photos);
  const pack=state.pack,data=pack.array.image.data,stride=512*512*4;
  for(const[kind,layer]of [['rock',0],['aggregate',1]])for(let y=0;y<512;y++)for(let x=0;x<512;x++)for(let c=0;c<4;c++)
    assert.equal(data[layer*stride+(y*512+x)*4+c],foundation[kind].data[((y%256)*256+x%256)*4+c]);
  assert.deepEqual(data.subarray(stride*2,stride*3),foundation.snow.data);
  for(const[kind,layer]of [['rock',3],['snow',4]]){
    const values=data.subarray(layer*stride,(layer+1)*stride);assert.equal(values.buffer,state.photos.entries[kind].data.buffer);
    assert.deepEqual(new Uint8Array(values.buffer,values.byteOffset,values.byteLength),new Uint8Array(plain[kind]));
    let min=Infinity;
    for(let at=0;at<values.length;at+=4){
      const x=DataUtils.fromHalfFloat(values[at]),y=DataUtils.fromHalfFloat(values[at+1]),moment=DataUtils.fromHalfFloat(values[at+2]);
      assert(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(moment));min=Math.min(min,moment-2*(x*x+y*y));
    }
    assert(min>0,'Filtered moment must retain positive intrinsic/unresolved roughness');
  }
  assert.equal(pack.diagnostics().cpuBytes,10485760);
  let disposals=0;pack.array.addEventListener('dispose',()=>disposals++);
  state.dispose();state.dispose();assert.equal(disposals,1);assert.equal(state.photos,null);assert.equal(pack.array.image.data,null);
});
