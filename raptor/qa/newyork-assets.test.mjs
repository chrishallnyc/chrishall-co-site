// Shipping contracts for the offline geographic pack: registered coordinates,
// complete drapes, source attribution and byte-identical verified outputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const terrain=new URL('../assets/terrain/',import.meta.url);
const meta=JSON.parse(await readFile(new URL('newyork_meta.json',terrain),'utf8'));
const provenance=JSON.parse(await readFile(new URL('newyork-provenance.json',terrain),'utf8'));
test('the New York heightfield and surface pack share the city coordinate contract',async()=>{
 assert.equal(meta.centerLat,40.70);assert.equal(meta.centerLon,-74);assert.equal(meta.sizeM,65536);assert.equal(meta.grid,4096);
 assert.equal(meta.minH,-15);assert.ok(meta.maxH>250&&meta.maxH<400);
 const png=await readFile(new URL('newyork_h.png',terrain));
 assert.equal(png.readUInt32BE(16),meta.grid);assert.equal(png.readUInt32BE(20),meta.grid);
 for(const name of ['albedo_16k','albedo_4k','cover','n_8k','ao_8k']){
  assert.ok(meta.drape.includes(name),name);
  assert.ok((await stat(new URL(`newyork_${name}.${name==='cover'?'png':'jpg'}`,terrain))).size>1000);
 }
 assert.ok((await stat(new URL('newyork_albedo_16k.jpg',terrain))).size<64*1024*1024,'High artwork stays below the shipping budget');
});
test('all source-verified New York map outputs match their provenance digests',async()=>{
 assert.ok(provenance.exports.length>=64);assert.ok(provenance.sourceRecords.length>100);
 for(const asset of provenance.outputs){
  const bytes=await readFile(new URL(asset.file,terrain));
  assert.equal(bytes.length,asset.bytes,asset.file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256,asset.file);
 }
});
