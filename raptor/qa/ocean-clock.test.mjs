import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {OceanClock,OCEAN_EPOCH_SECONDS} from '../src/world/oceanclock.js';
import {buildFineSpectrum} from '../src/world/oceanfinespectrum.js';
import {createFFTOcean} from '../src/world/fftocean.js';

const TAU=2*Math.PI;
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const texture=data=>({image:{data},version:1,set needsUpdate(value){if(value)this.version++;}});
function multiply([ar,ai],[br,bi]){return[ar*br-ai*bi,ar*bi+ai*br];}
function heightMode(packed,i,angle){
  const j=i*4,c=Math.cos(angle),s=Math.sin(angle);
  const a=multiply([packed[j],packed[j+1]],[c,s]);
  const b=multiply([packed[j+2],packed[j+3]],[c,-s]);
  return[a[0]+b[0],a[1]+b[1]];
}

// Increasing sample density must reveal missing modes, not reseed/re-scale
// all existing waves or silently increase the retained roughness budget.
test('fine512 retains every represented wave and the physical variance budget',()=>{
  for(const front of ['MARIANAS','VALDEZ']){
    const low=buildFineSpectrum(front,{N:256}),high=buildFineSpectrum(front,{N:512});
    let shared=0;
    for(let z=0;z<256;z++)for(let x=0;x<256;x++){
      const p=(z*256+x)*4;if(!low.data.subarray(p,p+4).some(v=>v!==0))continue;
      const mx=x<128?x:x-256,mz=z<128?z:z-256;
      const q=(((mz+512)%512)*512+(mx+512)%512)*4;
      assert.deepEqual(high.data.subarray(q,q+4),low.data.subarray(p,p+4));shared++;
    }
    assert.ok(shared>49000,'Nonvacuous complete inherited frequency band');
    assert.equal(high.totalVariance,low.totalVariance);
    assert.equal(high.resolvedVariance+high.tailVariance,high.totalVariance);
    assert.ok(high.resolvedVariance>low.resolvedVariance&&high.tailVariance>=0&&high.tailVariance<low.tailVariance);
    assert.ok(TAU/high.maxPresentK<.13&&TAU/low.maxPresentK>.25);
  }
});

// Oracle: the two physical counter-rotating complex coefficients evaluated
// at absolute time. It does not use OceanClock's stored dispersion/rotation.
test('rebased fine512 waves preserve phase, conjugate symmetry and per-mode energy',()=>{
  const spectrum=buildFineSpectrum('MARIANAS',{N:512}),original=new Float32Array(spectrum.data);
  const clock=new OceanClock(spectrum.data,512,32,true),target=texture(clock.data),uniform={value:0};
  const storage=[clock.original,clock.data,clock.omega],initial=Buffer.from(bytes(original));
  let maxWaveError=0,maxEnergyError=0;
  try{
    for(const time of [511.999,512,604672+1/60,-1/60,0]){
      const priorEpoch=clock.epoch,version=target.version,priorTime=uniform.value;
      assert.equal(clock.prepare(time),true);
      assert.equal(target.version,version);assert.equal(uniform.value,priorTime);
      assert.equal(clock.commit(target,uniform),true);
      const epoch=OCEAN_EPOCH_SECONDS*Math.floor(time/OCEAN_EPOCH_SECONDS),residual=time-epoch;
      assert.equal(clock.epoch,epoch);assert.equal(uniform.value,residual);
      assert.ok(residual>=0&&residual<OCEAN_EPOCH_SECONDS);
      assert.equal(target.version,version+Number(epoch!==priorEpoch));
      let error=0,energy=0;
      for(let z=0;z<512;z++)for(let x=0;x<512;x++){
        const i=z*512+x,j=((512-z)%512)*512+(512-x)%512,p=i*4;
        assert.equal(clock.data[p+2],clock.data[j*4]);
        // +0/-0 is irrelevant to a zero-amplitude conjugate coefficient.
        assert.ok(clock.data[p+3]===-clock.data[j*4+1]);
        if(!original.subarray(p,p+4).some(v=>v!==0))continue;
        const mx=x<256?x:x-512,mz=z<256?z:z-512,k=Math.hypot(mx,mz)*TAU/32;
        const omega=Math.sqrt(9.81*k+.0000722*k**3);
        const expected=heightMode(original,i,omega*time),actual=heightMode(clock.data,i,omega*residual);
        error+=((expected[0]-actual[0])**2+(expected[1]-actual[1])**2)*k*k;
        energy+=(expected[0]**2+expected[1]**2)*k*k;
        const e0=original[p]**2+original[p+1]**2;
        if(e0>1e-30)maxEnergyError=Math.max(maxEnergyError,Math.abs((clock.data[p]**2+clock.data[p+1]**2)/e0-1));
      }
      maxWaveError=Math.max(maxWaveError,Math.sqrt(error/energy));
      assert.equal(clock.original,storage[0]);assert.equal(clock.data,storage[1]);assert.equal(clock.omega,storage[2]);
      assert.deepEqual(bytes(clock.original),initial);
      if(epoch===0)assert.deepEqual(bytes(clock.data),initial);
    }
    assert.ok(maxWaveError<1e-7,`Relative slope-weighted phase error ${maxWaveError}`);
    assert.ok(maxEnergyError<2e-7,`Per-mode rotation energy error ${maxEnergyError}`);
  }finally{clock.dispose(target);}
  assert.equal(target.image.data,null);assert.equal(clock.data,null);assert.equal(clock.original,null);assert.equal(clock.omega,null);
});

test('invalid or cancelled time cannot publish a partially prepared epoch',()=>{
  const data=buildFineSpectrum('VALDEZ',{N:128}).data,original=Buffer.from(bytes(data));
  const clock=new OceanClock(data,128,32,true),target=texture(clock.data),uniform={value:0};
  assert.equal(clock.prepare(20),true);assert.equal(clock.commit(target,uniform),true);
  const prior=[target.version,uniform.value,clock.epoch];
  assert.equal(clock.prepare(604820),true);
  for(const invalid of [NaN,Infinity,-Infinity,'512',null,Number.MAX_VALUE]){
    assert.equal(clock.prepare(invalid),false);assert.equal(clock.commit(target,uniform),false);
    assert.deepEqual([target.version,uniform.value,clock.epoch],prior);
  }
  assert.equal(clock.prepare(20),true);assert.equal(clock.commit(target,uniform),true);
  assert.deepEqual(bytes(clock.data),original);assert.deepEqual([target.version,uniform.value,clock.epoch],prior);
  clock.dispose(target);clock.dispose(target);
  assert.equal(clock.prepare(512),false);assert.equal(clock.commit(target,uniform),false);
});

function ownerHarness(fineN=512){
  const commands=[],passes=[];let inspect=()=>null;
  const renderer={backend:{isWebGPUBackend:true,generateMipmaps:texture=>commands.push({op:'mips',texture})},
    copyTextureToTexture:(from,to)=>commands.push({op:'copy',from,to}),
    compute:nodes=>{passes.push(nodes);commands.push({op:'compute',nodes,state:inspect()});}};
  const ocean=createFFTOcean(renderer,{front:'MARIANAS',motionHistory:true,fineN});
  assert.ok(ocean?.fine);assert.equal(ocean.fine.N,fineN);
  return{commands,passes,ocean,inspect:fn=>{inspect=fn;}};
}
function graphBuilder(){
  // Construct graph builders only. No init/device/adapter, render or GPU call.
  const renderer=new THREE.WebGPURenderer({canvas:{width:1,height:1,style:{},addEventListener(){},removeEventListener(){}}});
  renderer.backend.renderer=renderer;renderer.hasFeature=()=>false;
  return node=>{const b=new THREE.WGSLNodeBuilder(node,renderer);b.build();return b;};
}

test('both cascades publish before compute, preserve history order and reject partial updates',()=>{
  const h=ownerHarness(),build=graphBuilder();let disposed=false;
  try{
    h.ocean.update(20);
    assert.deepEqual(h.commands.map(x=>x.op),['compute','mips','mips','copy','compute','mips']);
    const macro=build(h.passes[0][0]),fine=build(h.passes[1][0]);
    const coeff=b=>b.uniforms.compute.find(u=>u.type==='texture').node.value;
    const time=b=>b.uniforms.compute.find(u=>u.type==='float').node;
    const mt=coeff(macro),ft=coeff(fine),mu=time(macro),fu=time(fine);
    const targets=[mt,ft],data=targets.map(t=>t.image.data),original=data.map(a=>Buffer.from(bytes(a)));
    assert.deepEqual(targets.map(t=>t.image.width),[256,512]);
    h.inspect(()=>({versions:targets.map(t=>t.version),times:[mu.value,fu.value]}));
    let oldEpoch=0;
    for(const now of [511.99,512,512+1/60,604672,-1/60,0,20]){
      const start=h.commands.length,prior=targets.map(t=>t.version),epoch=512*Math.floor(now/512);
      h.ocean.update(now);const added=h.commands.slice(start);
      assert.deepEqual(added.map(x=>x.op),['copy','compute','mips','mips','compute','mips']);
      assert.equal(added[0].from,h.ocean.dispTex);assert.equal(added[0].to,h.ocean.previousDispTex);
      for(const row of added.filter(x=>x.op==='compute'))assert.deepEqual(row.state,{versions:prior.map(v=>v+Number(epoch!==oldEpoch)),times:[now-epoch,now-epoch]});
      targets.forEach((t,i)=>assert.equal(t.image.data,data[i]));
      if(epoch===0)targets.forEach((t,i)=>assert.deepEqual(bytes(t.image.data),original[i]));
      oldEpoch=epoch;
    }
    const before=h.commands.length,versions=targets.map(t=>t.version),times=[mu.value,fu.value];
    const prepare=h.ocean.fine.prepareTime;
    h.ocean.fine.prepareTime=()=>false;
    try{h.ocean.update(604820);}finally{h.ocean.fine.prepareTime=prepare;}
    assert.equal(h.commands.length,before);assert.deepEqual(targets.map(t=>t.version),versions);assert.deepEqual([mu.value,fu.value],times);
    h.ocean.update(20);targets.forEach((t,i)=>assert.deepEqual(bytes(t.image.data),original[i]));
    const nodes=new Set(h.passes.flat());let disposedNodes=0,disposedCoefficients=0;
    for(const node of nodes)node.addEventListener('dispose',()=>disposedNodes++);
    for(const target of targets)target.addEventListener('dispose',()=>disposedCoefficients++);
    const count=h.commands.length;h.ocean.dispose();disposed=true;h.ocean.dispose();h.ocean.update(512);
    assert.equal(h.commands.length,count);assert.equal(disposedNodes,nodes.size);assert.equal(disposedCoefficients,2);
    targets.forEach(t=>assert.equal(t.image.data,null));
  }finally{if(!disposed)h.ocean.dispose();}
});

test('fine FFT scratch never creates mip chains; final slope moments retain filtering',()=>{
  for(const N of [128,512]){
    const h=ownerHarness(N),build=graphBuilder();
    try{
      h.ocean.update(20);const fine=h.passes[1],textures=new Set();
      for(const node of [fine[0],fine[1],fine.at(-1)])for(const u of build(node).uniforms.compute)
        if(u.node.value?.isTexture)textures.add(u.node.value);
      const scratch=[...textures].filter(t=>t.isStorageTexture&&t.type===THREE.FloatType);
      assert.equal(scratch.length,2);for(const t of scratch)assert.equal(t.generateMipmaps,false);
      const final=h.ocean.fine.slopeMomentTex;
      assert.equal(final.generateMipmaps,true);assert.equal(final.mipmapsAutoUpdate,false);
      assert.equal(final.minFilter,THREE.LinearMipmapLinearFilter);
      assert.equal(h.commands.filter(x=>x.op==='mips'&&x.texture===final).length,1);
      assert.equal(fine.length,2*Math.log2(N)+2);
    }finally{h.ocean.dispose();}
  }
  assert.equal(createFFTOcean({backend:{isWebGPUBackend:false}},{fineN:512}),null);
});
