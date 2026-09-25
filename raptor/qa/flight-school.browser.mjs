// Fly the real course through browser mouse/keyboard events. Isolated storage.
// Artificial crash/off-screen inputs below are separate regression probes.
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const out=(process.env.RAPTOR_TEST_OUTPUT||'.context/raptor-next/school/').replace(/\/?$/,'/');await mkdir(out,{recursive:true});
const origin=process.env.RAPTOR_BASE_URL||'http://localhost:8082/';
const browser=await chromium.launch({channel:'chrome',headless:process.env.HEADED!=='1',args:['--window-size=1440,1000']});
const context=await browser.newContext({viewport:{width:1280,height:800},...(process.env.RECORD==='1'?{recordVideo:{dir:out,size:{width:1280,height:800}}}:{})});
await context.addInitScript(()=>{localStorage.setItem('raptor:quality:v1','LOW');localStorage.setItem('raptor.settings.v1',JSON.stringify({tier:'LOW',pointingDevice:'trackpad',masterVol:0}));});
const page=await context.newPage(),checks=[],errors=[],evidence={};page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const snap=name=>page.screenshot({path:out+name+'.png'});
const running=()=>page.waitForFunction(()=>!__RAPTOR.paused);
const stage=n=>page.waitForFunction(n=>__RAPTOR.cockpit.coach.course.index>=n,n,{timeout:120000});
let px=570,py=410;
const aim=async({heading,pitch})=>{
 const v=await page.evaluate(()=>({heading:__RAPTOR.player.aimHeading,pitch:__RAPTOR.player.aimPitch,gain:__RAPTOR.input.options.mouseSensitivity}));
 if(heading!==undefined){const desired=(90-heading)*Math.PI/180;const delta=((desired-v.heading+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;px-=delta/(.0028*v.gain);}
 if(pitch!==undefined)py-=(pitch*Math.PI/180-v.pitch)/(.0028*v.gain);
 assert.ok(px>20&&px<1060&&py>150&&py<740,`pointer stays in clear flight view ${px},${py}`);
 await page.mouse.move(px,py,{steps:10});
};
try{
 const began=Date.now();await page.goto(origin+'?mode=practice');
 await page.waitForFunction(()=>window.__RAPTOR?.ready||window.__RAPTOR?.failure,null,{timeout:180000});
 assert.equal(await page.evaluate(()=>__RAPTOR.failure),null);await page.waitForSelector('#veil',{state:'detached'});
 evidence.bootMs=Date.now()-began;evidence.backend=await page.evaluate(()=>__RAPTOR.backend);
 await check('a direct practice link boots without enemies, tickets or mission scoring',async()=>{
 assert.equal(await page.evaluate(()=>__RAPTOR.match),null);assert.equal(await page.evaluate(()=>__RAPTOR.battlefield),null);
 await snap('01-ready');await page.locator('[data-resume]').click();await running();await page.mouse.move(px,py);
 });
 await check('the course measures stable flight and held throttle through real keyboard events',async()=>{
 await stage(1);await page.keyboard.down('s');await page.waitForFunction(()=>__RAPTOR.player.throttleCmd<=.67);await page.keyboard.up('s');
 const throttle=await page.evaluate(()=>__RAPTOR.player.throttleCmd);assert.ok(throttle>=.59&&throttle<=.7,`throttle ${throttle}`);
 await stage(2);await snap('02-turn-brief');
 });
 await check('a real trackpad-profile pointer turn reaches the assigned compass heading',async()=>{
 const target=await page.evaluate(()=>__RAPTOR.cockpit.coach.course.targetHeading);await aim({heading:target});await stage(3);await snap('03-climb-brief');
 });
 await check('a gentle climb and level-off graduate to cruise using actual flight telemetry',async()=>{
 await aim({pitch:5});await page.waitForFunction(()=>__RAPTOR.player.hudState().altFt>=__RAPTOR.cockpit.coach.course.targetAltitude-70,null,{timeout:120000});
 await aim({pitch:0});await stage(4);
 await page.keyboard.down('w');await page.waitForFunction(()=>__RAPTOR.player.throttleCmd>=.85);await page.keyboard.up('w');
 await page.waitForFunction(()=>__RAPTOR.cockpit.coach.course.status==='complete',null,{timeout:120000});
 evidence.graduation=await page.evaluate(()=>({time:__RAPTOR.sim.time,crashes:__RAPTOR.player.crashes,flight:__RAPTOR.player.hudState(),record:JSON.parse(localStorage.getItem('raptor.flight-school.v1'))}));
 assert.equal(evidence.graduation.crashes,0);assert.equal(evidence.graduation.record.completions,1);await snap('04-graduated');
 });
 await check('quick tune freezes flight, preserves separate gains and applies real settings',async()=>{
 await page.locator('[data-flight-action="tune"]').click();await page.waitForFunction(()=>__RAPTOR.paused);
 const t=await page.evaluate(()=>__RAPTOR.sim.time);
 await page.locator('#quick-gain').fill('0.45');await page.locator('[data-quick-device="mouse"]').click();assert.equal(await page.locator('#quick-gain').inputValue(),'1');
 await page.locator('#quick-gain').fill('1.2');await page.locator('[data-quick-device="trackpad"]').click();assert.equal(await page.locator('#quick-gain').inputValue(),'0.45');
 await page.locator('#quick-hud').fill('1.15');await page.locator('#quick-volume').fill('0.3');
 assert.equal(await page.evaluate(()=>__RAPTOR.hud.uiScale),1.15);assert.equal(await page.evaluate(()=>__RAPTOR.sim.time),t);await snap('05-quick-tune');
 });
 await check('off-screen aim keeps ammunition visible and provides a recovery arrow',async()=>{
 const result=await page.evaluate(()=>{
  const p=__RAPTOR.player,h=__RAPTOR.hud,old=p.aimHeading,texts=[],draw=h.ctx.fillText;
  h.ctx.fillText=function(text,...args){texts.push(text);return draw.call(this,text,...args);};
  try{p.aimHeading+=Math.PI;h.update(p.hudState());return {texts,cue:__RAPTOR.aimCue};}
  finally{p.aimHeading=old;h.ctx.fillText=draw;h.update(p.hudState());}
 });
 assert.equal(result.cue.edge,true);assert.equal(result.cue.behind,true);assert.ok(result.texts.some(t=>String(t).includes('GUN ')));assert.ok(result.texts.some(t=>String(t).includes('recenter')));
 });
 await check('live recovery returns keyboard focus and never alters earned training',async()=>{
 await page.locator('[data-resume]').click();await running();await page.locator('[data-coach-replay]').click();
 assert.equal(await page.evaluate(()=>document.activeElement.id),'game');assert.equal(await page.evaluate(()=>__RAPTOR.player.throttleCmd),.8);
 await page.locator('[data-coach-free]').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'game');
 await page.keyboard.down('w');await page.waitForFunction(()=>__RAPTOR.player.throttleCmd>.9);await page.keyboard.up('w');
 await page.locator('[data-coach-retry]').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'game');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('raptor.flight-school.v1')).completions),1);
 });
 await check('recenter discards pointer movement queued in the same frame without dropping throttle',async()=>{
 const result=await page.evaluate(()=>new Promise(resolve=>{
  const p=__RAPTOR.player,input=__RAPTOR.input;
  input.mouse.dx=300;input.mouse.dy=-200;input.edge.add('recenter_aim');input.down.add('KeyW');
  const st=p.fm.state,heading=Math.atan2(st[8],st[7]),pitch=Math.atan2(st[9],Math.hypot(st[7],st[8]));
  requestAnimationFrame(()=>resolve({heading,pitch,actualHeading:p.aimHeading,actualPitch:p.aimPitch,held:input.held('throttle_up')}));
 }));
 assert.ok(Math.abs(result.actualHeading-result.heading)<.001);assert.ok(Math.abs(result.actualPitch-result.pitch)<.001);assert.equal(result.held,true);
 await page.keyboard.press('w');
 });
 await check('a practice crash pauses on a safe aircraft with a clear recovery choice',async()=>{
 await page.evaluate(()=>__RAPTOR.player.debugCommand({pos:{x:0,y:-6000,alt:-100,speed:200}}));await page.waitForFunction(()=>__RAPTOR.paused);
 assert.match(await page.locator('.pause-dialog h2').textContent(),/fresh start/);assert.equal(await page.evaluate(()=>__RAPTOR.kc()),null);await snap('06-recovery');
 await page.locator('[data-resume]').click();await running();
 });
 evidence.frames=await page.evaluate(()=>new Promise(resolve=>{const gaps=[];let last=performance.now(),start=last;function f(now){gaps.push(now-last);last=now;if(now-start<6000)requestAnimationFrame(f);else{gaps.shift();gaps.sort((a,b)=>a-b);resolve({count:gaps.length,medianMs:gaps[Math.floor(gaps.length*.5)],p95Ms:gaps[Math.floor(gaps.length*.95)],over50:gaps.filter(x=>x>50).length});}}requestAnimationFrame(f);}));
 await page.keyboard.press('Escape');await snap('07-final-pause');
 assert.deepEqual(errors,[]);
}catch(e){console.error(e);process.exitCode=1;evidence.failure=String(e);evidence.lastState=await page.evaluate(()=>({ready:window.__RAPTOR?.ready,failure:window.__RAPTOR?.failure,coach:window.__RAPTOR?.cockpit?.coach?.course?.snapshot(),flight:window.__RAPTOR?.player?.hudState()})).catch(()=>null);await snap('failure').catch(()=>{});}
finally{await writeFile(out+'results.json',JSON.stringify({checks,errors,evidence,physicalTrackpadTested:false},null,2));await context.close();await browser.close();}
