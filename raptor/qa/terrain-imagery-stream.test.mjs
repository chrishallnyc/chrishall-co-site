import assert from 'node:assert/strict';
import test from 'node:test';
import { TerrainImageryStream, imageryQuartet, imageryMipBytes, validateImageryManifest } from '../src/world/terrain-imagery-stream.js';

function fixture() {
  const meta = { worldBounds: { xmin: -8, xmax: 8, zmin: -8, zmax: 8 }, rows: 4, columns: 4,
    tileSizeM: 4, interiorPixels: 4, gutterPixels: 1, imagePixels: 6, metresPerPixel: 1, tiles: [] };
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
    const b = { xmin: -8 + column * 4, xmax: -4 + column * 4, zmin: 4 - row * 4, zmax: 8 - row * 4 };
    meta.tiles.push({ id: `r${row}c${column}`, row, column, worldBounds: b,
      imageWorldBounds: { xmin: b.xmin - 1, xmax: b.xmax + 1, zmin: b.zmin - 1, zmax: b.zmax + 1 },
      blank: false, file: `tiles/r${row}c${column}.webp`, sha256: 'a'.repeat(64), bytes: 100 });
  }
  return meta;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const near = { x: 0, z: 0, heightAboveGroundM: 100 };
function pixels(args, alpha = 255) {
  const a = new Uint8Array(args.width * args.height * 4);
  for (let i = 0; i < a.length; i += 4) a.set([81, 142, 211, alpha], i);
  a.set([254, 120, 36, 0], 0); return a;
}
const make = options => new TerrainImageryStream({ manifest: fixture(), baseURL: 'https://local.test/imagery/manifest.json', ...options });

test('geographic quartet covers every interior point and keeps north-first row convention', () => {
  const meta = fixture(); validateImageryManifest(meta);
  assert.deepEqual(imageryQuartet(meta, 0, 0).map(t => t.id).sort(), ['r1c1','r1c2','r2c1','r2c2']);
  assert.deepEqual(imageryQuartet(meta, -8, 8).map(t => t.id).sort(), ['r0c0','r0c1','r1c0','r1c1']);
  assert.deepEqual(imageryQuartet(meta, 8, -8).map(t => t.id).sort(), ['r2c2','r2c3','r3c2','r3c3']);
  for (let j = 0; j <= 32; j++) for (let i = 0; i <= 32; i++) {
    const x = -8 + i * .5, z = -8 + j * .5, tiles = imageryQuartet(meta, x, z);
    assert.equal(tiles.length, 4);
    assert(tiles.some(({ worldBounds:b }) => x >= b.xmin && x <= b.xmax && z >= b.zmin && z <= b.zmax));
  }
  for (const [x,z] of [[-8.01,0],[8.01,0],[0,-8.01],[0,8.01],[NaN,0]]) assert.deepEqual(imageryQuartet(meta,x,z),[]);
});

test('manifest rejects wrong geographic extents, overlapping cells, traversal and wrong physical gutter', () => {
  for (const mutate of [m=>m.tiles[0].worldBounds.xmin++,m=>m.tiles[0].imageWorldBounds.zmin++,
    m=>m.tiles[0].file='../escape.webp',m=>m.tiles[0].sha256='x',m=>m.tiles[0].column=1,
    m=>m.metresPerPixel=2,m=>m.tiles.pop(),m=>m.tiles[0].blank=undefined,m=>m.interiorPixels=0]) {
    const m=fixture(); mutate(m); assert.throws(()=>validateImageryManifest(m), /Invalid geographic imagery/);
  }
});

test('four layers stay stable, allocate lazily, bound concurrency and clear hidden RGB without changing alpha', async () => {
  let active=0, maximum=0, calls=0;
  const stream=make({loadPixels:async args=>{calls++;active++;maximum=Math.max(maximum,active);await tick();active--;args.onBytes(100);return pixels(args);}});
  const texture=stream.texture; let disposals=0; texture.addEventListener('dispose',()=>disposals++);
  assert.equal(texture.image.width,1); assert.equal(stream.profile.cpuBackingBytes,16);
  stream.update(near); await stream.whenSettled();
  assert.equal(calls,4); assert.equal(maximum,2); assert.equal(stream.texture,texture); assert.equal(disposals,1);
  assert.equal(texture.image.depth,4); assert.equal(stream.profile.residents.length,4);
  assert.equal(stream.profile.cpuBackingBytes,4*6*6*4); assert.equal(stream.profile.downloadedBytes,400);
  for (const slot of stream.slots) {
    const off=slot.layer*6*6*4;
    assert.deepEqual([...texture.image.data.subarray(off,off+8)],[0,0,0,0,81,142,211,255]);
    assert(slot.ready.value);
  }
  for(let i=0;i<100;i++)stream.update(near);
  assert.equal(calls,4,'stationary updates cause no new requests');
  texture.onUpdate(); // Actual backend callback, after the first whole allocation upload.
  stream.update({x:7,z:7,heightAboveGroundM:100});await stream.whenSettled();
  assert.equal(calls,7,'one overlapping tile remains resident');
  assert.equal(stream.texture,texture);assert.equal(disposals,1,'moving does not reallocate array storage');
  assert.equal(texture.layerUpdates.size,3,'only three replaced layers are dirty');
  assert.equal(stream.profile.residents.length,4);
  stream.dispose();stream.dispose();assert.equal(disposals,2);
  assert.equal(texture.image.data,null);assert.equal(stream.profile.cpuBackingBytes,0);
});

test('blank cells make no request, high altitude/outside requests are suppressed and resident data survives return', async () => {
  const meta=fixture();meta.tiles.find(t=>t.id==='r1c1').blank=true;
  let calls=0;const stream=make({manifest:meta,loadPixels:async args=>{calls++;return pixels(args);}});
  stream.update({...near,heightAboveGroundM:3000});await stream.whenSettled();assert.equal(calls,0);assert(!stream.enabled.value);
  stream.update(near);await stream.whenSettled();assert.equal(calls,3);
  stream.update({...near,x:50});assert(!stream.enabled.value);assert.equal(stream.profile.residents.length,3);
  stream.update(near);await stream.whenSettled();assert.equal(calls,3);stream.dispose();
});

test('obsolete completion cannot overwrite retained geometry or allocate after disposal', async () => {
  const pending=[];
  const stream=make({loadPixels:args=>new Promise(resolve=>pending.push({args,resolve}))});
  stream.update({x:-7,z:7,heightAboveGroundM:100});assert.equal(pending.length,2);
  stream.update({x:7,z:-7,heightAboveGroundM:100});assert(pending.every(p=>p.args.signal.aborted));
  assert.equal(pending.length,2,'aborted-but-unsettled work retains concurrency slots');
  for(const p of pending.slice())p.resolve(pixels(p.args));await tick();
  assert.equal(stream.profile.obsoleteResults,2);assert.equal(stream.profile.residents.length,0);
  assert.equal(pending.length,4);assert.equal(stream.texture.image.width,1);
  stream.dispose();for(const p of pending.slice(2))p.resolve(pixels(p.args));await stream.whenSettled();
  assert.equal(stream.texture.image.data,null);assert.equal(stream.profile.residents.length,0);
  assert.equal(stream.profile.obsoleteResults,4);assert(!stream.enabled.value);
});

test('failed tile keeps fallback and is retried only explicitly', async () => {
  let bad=true,calls=0;
  const stream=make({loadPixels:async args=>{calls++;if(bad&&args.url.includes('r1c1'))throw Error('test source failure');return pixels(args);}});
  stream.update(near);await stream.whenSettled();assert.equal(stream.profile.failed,1);assert.equal(stream.profile.residents.length,3);
  for(let i=0;i<20;i++)stream.update(near);await stream.whenSettled();assert.equal(calls,4);
  bad=false;stream.retryFailed();await stream.whenSettled();assert.equal(calls,5);assert.equal(stream.profile.residents.length,4);stream.dispose();
});

test('bad decoded dimensions/coverage never publish or allocate the large backing', async () => {
  for(const loadPixels of [async()=>new Uint8Array(3),async args=>pixels(args,128)]) {
    const stream=make({loadPixels});stream.update(near);await stream.whenSettled();
    assert.equal(stream.profile.failed,4);assert.equal(stream.profile.residents.length,0);
    assert.equal(stream.texture.image.width,1);stream.dispose();
  }
});

test('timeouts abort each desired tile once and do not create a retry storm', async () => {
  let calls=0;
  const stream=make({requestTimeoutMs:5,loadPixels:({signal})=>new Promise((resolve,reject)=>{
    calls++;signal.addEventListener('abort',()=>reject(Object.assign(Error('abort'),{name:'AbortError'})),{once:true});
  })});
  stream.update(near);await stream.whenSettled();assert.equal(calls,4);assert.equal(stream.profile.failed,4);
  stream.update(near);await stream.whenSettled();assert.equal(calls,4);assert.equal(stream.profile.pending,0);stream.dispose();
});

test('real 2064-pixel budget counts every non-power-of-two mip', () => {
  assert.equal(4*2064*2064*4,68161536);
  assert.equal(imageryMipBytes(2064),90880672);
});

test('insufficient native texture size keeps the tiny fallback and performs no requests', async () => {
  let calls=0;const stream=make({maxTextureSize:4,loadPixels:async args=>{calls++;return pixels(args);}});
  stream.update(near);await stream.whenSettled();assert.equal(calls,0);assert(!stream.enabled.value);
  assert(!stream.profile.supported);assert.equal(stream.texture.image.width,1);stream.dispose();
});

test('actual loader validates compressed bytes before decoding and always closes bitmap/canvas', async () => {
  const original={fetch:globalThis.fetch,createImageBitmap:globalThis.createImageBitmap,OffscreenCanvas:globalThis.OffscreenCanvas};
  const asset=new Uint8Array([1,2,3,4,5,6]);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',asset)),n=>n.toString(16).padStart(2,'0')).join('');
  const meta=fixture();for(const tile of meta.tiles){tile.blank=tile.id!=='r1c1';tile.bytes=asset.length;tile.sha256=digest;}
  let decoded=0,closed=0,canvases=[],corrupt=false,wrongDimensions=false;
  globalThis.fetch=async()=>new Response(corrupt?new Uint8Array([6,5,4,3,2,1]):asset);
  globalThis.createImageBitmap=async(blob,options)=>{
    decoded++;assert.equal(blob.type,'image/webp');assert.equal(options.premultiplyAlpha,'none');assert.equal(options.imageOrientation,'none');
    return {width:wrongDimensions?7:6,height:6,close(){closed++;}};
  };
  globalThis.OffscreenCanvas=class{constructor(width,height){this.width=width;this.height=height;canvases.push(this);}
    getContext(){return{drawImage(){},getImageData:()=>({data:pixels({width:6,height:6})})};}};
  try {
    const good=make({manifest:meta});good.update(near);await good.whenSettled();
    assert.equal(good.profile.residents.length,1);assert.equal(good.profile.downloadedBytes,asset.length);
    assert.equal(decoded,1);assert.equal(closed,1);assert(canvases.every(c=>c.width===1&&c.height===1));good.dispose();
    corrupt=true;const bad=make({manifest:meta});bad.update(near);await bad.whenSettled();
    assert.equal(decoded,1,'bad digest rejected before bitmap allocation');assert.equal(bad.profile.failed,1);bad.dispose();
    corrupt=false;wrongDimensions=true;const wrong=make({manifest:meta});wrong.update(near);await wrong.whenSettled();
    assert.equal(closed,2,'dimension failure still closes decoded bitmap');assert.equal(wrong.profile.failed,1);wrong.dispose();
  } finally {Object.assign(globalThis,original);}
});

test('slot opacity starts at actual upload, ramps over600ms, and opens missing/fading neighbor edges', async () => {
  let now=100;const stream=make({clock:()=>now,loadPixels:async args=>pixels(args)});
  stream.update(near);await stream.whenSettled();
  now=1000;stream.update(near);assert(stream.slots.every(s=>s.opacity.value===0),'decode alone does not start visual publication');
  stream.texture.onUpdate();now=1300;stream.update(near);
  assert(stream.slots.every(s=>s.opacity.value===.5));
  const nw=stream.slots.find(s=>s.tileId==='r1c1');
  assert.deepEqual(nw.edgeOpen.value.toArray(),[1,.5,.5,1]);
  now=1600;stream.update(near);assert(stream.slots.every(s=>s.opacity.value===1));
  assert.deepEqual(nw.edgeOpen.value.toArray(),[1,0,0,1]);
  stream.update({x:7,z:7,heightAboveGroundM:100});await stream.whenSettled();
  const retained=stream.slots.find(s=>s.tileId==='r1c2');assert.equal(retained.opacity.value,1);
  assert(stream.slots.filter(s=>s!==retained).every(s=>s.opacity.value===0));
  assert.deepEqual(retained.edgeOpen.value.toArray(),[1,1,1,1],'new neighbors fade against base until uploaded');
  stream.texture.onUpdate();now=1900;stream.update({x:7,z:7,heightAboveGroundM:100});
  assert.deepEqual(retained.edgeOpen.value.toArray(),[1,1,.5,.5]);
  stream.dispose();assert(stream.slots.every(s=>s.opacity.value===0));
});
