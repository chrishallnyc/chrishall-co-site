import { AcousticScene } from '../src/engine/acoustic-scene.js';
import { prepareOfflineHrtf } from '../audio-tools/offline-hrtf.mjs';
const assert=(ok,message)=>{if(!ok)throw new Error(message)};
const listener={position:[0,0,0],velocity:[0,0,0],forward:[0,0,-1],up:[0,1,0],right:[1,0,0]};
function metrics(buffer,lo=1,hi=2){
 let sum=0,lowSum=0,peak=0,n=0;
 for(let c=0;c<buffer.numberOfChannels;c++){
  let low=0;const a=1-Math.exp(-2*Math.PI*250/buffer.sampleRate),data=buffer.getChannelData(c);
  for(let i=0;i<Math.min(data.length,hi*buffer.sampleRate);i++){
   const v=data[i];assert(Number.isFinite(v),'finite native PCM');low+=a*(v-low);
   if(i>=lo*buffer.sampleRate){sum+=v*v;lowSum+=low*low;peak=Math.max(peak,Math.abs(v));n++}
  }
 }
 return{rms:Math.sqrt(sum/n),lowFraction:Math.sqrt(lowSum/Math.max(sum,1e-30)),peak};
}
async function render(source,transition=false){
 const ctx=new OfflineAudioContext(2,48000*3.5,48000),release=prepareOfflineHrtf(ctx);
 const scene=new AcousticScene(ctx,ctx.destination,{seed:917});scene.update({listener,sources:[source]});
 const jobs=[];
 if(transition){jobs.push(ctx.suspend(1).then(async()=>{scene.update({listener,sources:[{...source,motor:'coast'}]});await ctx.resume()}));jobs.push(ctx.suspend(2.5).then(async()=>{scene.update({listener,sources:[]});await ctx.resume()}))}
 try{const[pcm]=await Promise.all([ctx.startRendering(),...jobs]);return{pcm,remaining:scene.voices.size}}finally{scene.dispose();release()}
}
export async function runMovingIdentityTests({log=false}={}){
 const out={passed:0,failed:0,tests:[]};
 const rocket={id:'rocket',kind:'missile',position:[0,0,-25],velocity:[300,0,0],power:1,motor:'boost'};
 const plane={id:'plane',kind:'aircraft',aircraftClass:'fighter',position:[0,0,-80],velocity:[0,0,1],power:.8};
 const check=async(name,fn)=>{try{out.tests.push({name,status:'passed',metrics:await fn()});out.passed++}catch(e){out.tests.push({name,status:'failed',error:e.stack});out.failed++}if(log)console.log(out.tests.at(-1))};
 await check('coasting missile loses combustion body but retains a close aerodynamic pass',async()=>{
  const boost=metrics((await render(rocket)).pcm),coast=metrics((await render({...rocket,motor:'coast'})).pcm);
  assert(coast.rms>.0001&&coast.rms<boost.rms,'close coast remains audible below the rocket motor');
  assert(coast.lowFraction<boost.lowFraction*.5,'coast has substantially less low-frequency combustion energy');
  assert(boost.peak<1&&coast.peak<1,'isolated world output has headroom');return{boost,coast};
 });
 await check('front-facing aircraft has a distinct intake spectrum from its exhaust',async()=>{
  const front=metrics((await render(plane)).pcm),rear=metrics((await render({...plane,velocity:[0,0,-1]})).pcm);
  assert(front.rms>.0001&&rear.rms>.0001,'both aspects remain audible');
  assert(front.lowFraction<rear.lowFraction*.85,'intake detail changes timbre, not only loudness: '+JSON.stringify({front,rear}));
  assert(front.peak<1&&rear.peak<1,'both aspects retain headroom');return{front,rear};
 });
 await check('boost-to-coast transitions retain one voice and retirement reaches silence',async()=>{
  const{pcm,remaining}=await render(rocket,true),motor=metrics(pcm,.35,.8),coast=metrics(pcm,1.7,2.2),retired=metrics(pcm,3.1,3.45);
  assert(coast.rms>.0001&&coast.lowFraction<motor.lowFraction*.5,'continuous motor transition becomes aerodynamic noise');
  assert(remaining===0&&retired.rms<.000001,'retired moving source releases and becomes silent');return{motor,coast,retired,remaining};
 });
 return out;
}
