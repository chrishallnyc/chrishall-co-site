// New practice/combat feedback through the real renderer and cockpit.
// Isolated browser storage; deterministic poses only for presentation checks.
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const origin=process.env.RAPTOR_BASE_URL||'http://localhost:8082/';
const out=(process.env.RAPTOR_TEST_OUTPUT||'.context/raptor-feedback/').replace(/\/?$/,'/');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
await context.addInitScript(()=>{
 localStorage.setItem('raptor:quality:v1','LOW');
 localStorage.setItem('raptor.settings.v1',JSON.stringify({tier:'LOW',muted:true,motionReduce:true}));
});
const page=await context.newPage(),checks=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.setDefaultTimeout(20000);
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const boot=async query=>{
 await page.goto(origin+query+'&gl=1',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__RAPTOR?.ready||window.__RAPTOR?.failure,null,{timeout:180000});
 assert.equal(await page.evaluate(()=>__RAPTOR.failure),null);
 assert.equal(await page.evaluate(()=>__RAPTOR.backend),'webgl');
 await page.waitForSelector('#veil',{state:'detached'});
 await page.bringToFront();
 if(await page.locator('.pause-dialog[open]').count())await page.locator('[data-resume]').click();
 await page.waitForFunction(()=>__RAPTOR.sim.time>.25);
};
try {
 await boot('?mode=practice&front=NELLIS');
 await check('real practice telemetry is visible and remains live in free flight',async()=>{
  await page.waitForFunction(()=>/\d+ kt/.test(document.querySelector('[data-coach-speed]').textContent));
  await page.locator('[data-coach-free]').click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'game');
  await page.waitForFunction(()=>document.querySelector('[data-coach-condition]').textContent!=='Waiting for flight data');
  assert.match(await page.locator('[data-coach-clearance]').textContent(),/ft/);
  assert.match(await page.locator('[data-coach-vertical]').textContent(),/fpm/);
  const elapsed=await page.evaluate(()=>__RAPTOR.cockpit.coach.course.elapsed);
  await page.keyboard.down('w');await page.waitForTimeout(350);await page.keyboard.up('w');
  assert.equal(await page.evaluate(()=>__RAPTOR.cockpit.coach.course.elapsed),elapsed);
  await page.screenshot({path:out+'practice-free.png'});
 });
 await check('practice gear guidance follows real actuator travel and custom controls',async()=>{
  assert.equal(await page.evaluate(()=>__RAPTOR.input.setBinding('gear',0,['KeyJ'],{resolve:'replace'})),true);
  await page.keyboard.press('j');
  await page.waitForFunction(()=>document.querySelector('[data-coach-configuration]').textContent.includes('Gear extending'));
  await page.waitForFunction(()=>__RAPTOR.player.hudState().gearPosition===1);
  await page.waitForFunction(()=>document.querySelector('[data-coach-configuration]').textContent.includes('J retracts it'));
  await page.screenshot({path:out+'practice-gear.png'});
  await page.keyboard.press('j');
  await page.waitForFunction(()=>document.querySelector('[data-coach-configuration]').textContent.includes('Gear retracting'));
  await page.waitForFunction(()=>document.querySelector('[data-coach-configuration]').hidden);
 });
 await check('actual high-angle-of-attack telemetry offers the bound recovery action',async()=>{
  await page.evaluate(()=>{
   const s=__RAPTOR,p=s.player;s.sim.timescale=0;p.clearInput();p.throttleCmd=.8;p.aimPitch=0;p.aimHeading=0;
   s.input.setBinding('recenter_aim',0,['KeyK'],{resolve:'replace'});
   const x=p.fm.state[0],y=p.fm.state[1],ground=Math.max(0,p.terrain.heightAt(x,y));
   p.fm.initFlight({x,y,alt:ground+6000,headingRad:0,speed:200,fpaRad:-40*Math.PI/180,alphaDeg:40,throttle:.8});
   p.renderPoseVersion++;p._cameraReady=false;s.sim.tick();
  });
  await page.waitForFunction(()=>document.querySelector('[data-coach-condition]').textContent==='Ease the pull');
  assert.match(await page.locator('[data-coach-advice]').textContent(),/K centers aim/);
  assert.ok(await page.evaluate(()=>__RAPTOR.player.hudState().aoa>=35));
  await page.screenshot({path:out+'practice-recovery.png'});
  await page.keyboard.press('k');await page.keyboard.down('w');
  await page.evaluate(()=>__RAPTOR.sim.timescale=1);
  await page.waitForFunction(()=>__RAPTOR.player.hudState().aoa<20);
  await page.keyboard.up('w');
  assert.equal(await page.evaluate(()=>__RAPTOR.player.crashes),0);
  await page.locator('[data-coach-retry]').click();
 });
 await check('graduation keeps instruments and recovery within the coach panel',async()=>{
  await page.evaluate(()=>{const coach=__RAPTOR.cockpit.coach;coach.course.status='complete';coach.refresh();});
  await frame();
  assert.equal(await page.locator('[data-coach-retry]').isVisible(),true);
  assert.match(await page.locator('[data-coach-speed]').textContent(),/kt/);
  for(const [width,height] of [[1280,800],[1024,700],[390,667]]){
   await page.setViewportSize({width,height});await frame();
   assert.equal(await page.locator('.flight-coach').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
   const box=await page.locator('.flight-coach').boundingBox();
   assert.ok(box.x>=0&&box.x+box.width<=width&&box.y+box.height<=height);
  }
  await page.setViewportSize({width:1280,height:800});await frame();
 });
 await boot('?front=NELLIS');
 await page.evaluate(()=>{
  const s=__RAPTOR;s.sim.timescale=0;
  s.player.debugCommand({pos:{x:0,y:0,alt:4500,headingDeg:0,speed:220},aimPitchDeg:0,aimHeadingDeg:0});
  const slot=s.bandits.spawnFlight([{kind:'fighter',x:2200,y:320,z:4500,headingDeg:180,speed:180}])[0];
  window.__feedbackSlot=slot;
  s.player.missiles.lockTarget=4096+slot;s.player.missiles.lockProgress=.35;s.player.missiles.ammo=4;
  s.battlefield.samLive[0]=1;s.battlefield.sam.set([-700,500,4350,400,-120,50,1,100,0,0,0]);
  const ctx=s.hud.ctx,draw=ctx.fillText,layer=s.hud.arcadeLayer;
  ctx.fillText=function(message,...args){window.__feedbackText?.push(String(message));window.__feedbackInk?.push({message:String(message),x:args[0],y:args[1]});return draw.call(this,message,...args);};
  s.hud.arcadeLayer=function(...args){window.__feedbackText=[];window.__feedbackInk=[];return layer.apply(this,args);};
 });
 await check('real combat HUD draws acquisition, closure and directional threat cues',async()=>{
  await page.waitForFunction(()=>window.__feedbackText?.some(t=>t.includes('ACQUIRING')));
  const text=await page.evaluate(()=>__feedbackText);
  assert.ok(text.some(t=>t.includes('CLOSING')&&t.includes('KM')));
  assert.ok(text.some(t=>t.includes("O'CLOCK")&&t.includes('BREAK TURN')));
  await page.screenshot({path:out+'combat-acquiring.png'});
 });
 await check('seeker launch hint follows the actual binding and ammo/friendly states',async()=>{
  assert.equal(await page.evaluate(()=>{__RAPTOR.player.missiles.lockProgress=.7;return __RAPTOR.input.setBinding('fire_aam',0,['KeyL'],{resolve:'replace'});}),true);
  await page.waitForFunction(()=>window.__feedbackText?.includes('L · launch missile'));
  assert.match(await page.locator('.flight-hints').textContent(),/L\s*Missile/);
  await page.screenshot({path:out+'combat-locked.png'});
  await page.evaluate(()=>{__RAPTOR.bandits.side[__feedbackSlot]=1;});
  await page.waitForFunction(()=>window.__feedbackText?.includes('HOLD FIRE'));
  assert.equal(await page.evaluate(()=>__feedbackText.some(t=>t.includes('launch missile'))),false);
  await page.evaluate(()=>{__RAPTOR.bandits.side[__feedbackSlot]=0;__RAPTOR.player.missiles.ammo=0;});
  await page.waitForFunction(()=>window.__feedbackText?.includes('NO MISSILES'));
  assert.equal(await page.evaluate(()=>__feedbackText.some(t=>t.includes('launch missile'))),false);
 });
 await check('missile acquisition advice explains the real envelope without overriding threats or friendlies',async()=>{
  await page.evaluate(()=>{
   const s=__RAPTOR;s.battlefield.samLive.fill(0);s.bandits.live.fill(0);s.bandits.live[__feedbackSlot]=1;
   s.player.missiles.lockTarget=-1;s.player.missiles.lockProgress=0;s.player.missiles.ammo=4;
  });
  for(const [x,y,status] of [[10000,500,'OUT OF RANGE'],[300,30,'TOO CLOSE'],[3000,1800,'OUTSIDE SEEKER'],[3000,200,'HOLD TARGET AHEAD']]){
   await page.evaluate(({x,y})=>{
    const b=__RAPTOR.bandits,offset=__feedbackSlot*14;b.state[offset]=x;b.state[offset+1]=y;b.state[offset+2]=4500;b._prev.set(b.state);
   },{x,y});
   await page.waitForFunction(status=>window.__feedbackText?.includes('MISSILE · '+status),status);
   assert.equal(await page.evaluate(()=>__RAPTOR.player.missiles.lockTarget),-1);
   if(status==='OUT OF RANGE')await page.screenshot({path:out+'missile-envelope.png'});
  }
  await page.evaluate(()=>__RAPTOR.bandits.side[__feedbackSlot]=1);
  await page.waitForFunction(()=>!__feedbackText.some(text=>text.startsWith('MISSILE · ')));
  await page.evaluate(()=>{
   const s=__RAPTOR;s.bandits.side[__feedbackSlot]=0;
   s.battlefield.samLive[0]=1;s.battlefield.sam.set([-700,500,4350,400,-120,50,1,100,0,0,0]);
  });
  await page.waitForFunction(()=>__feedbackText.includes('MISSILE'));
  assert.equal(await page.evaluate(()=>__feedbackText.some(text=>text.startsWith('MISSILE · '))),false);
 });
 await check('airfield guidance follows real rearm conditions and completion',async()=>{
  await page.evaluate(()=>{
   const s=__RAPTOR,p=s.player,af=s.match.airfield;
   s.battlefield.samLive.fill(0);p.missiles.lockTarget=-1;
   const x=af.x+200,y=af.y,ground=Math.max(0,p.terrain.heightAt(x,y));
   p.debugCommand({pos:{x,y,alt:ground+600,headingDeg:0,speed:170}});
   p.gun.ammo=100;p.missiles.ammo=0;p.hp=60;s.match.tick(s.sim,0);
  });
  await page.waitForFunction(()=>window.__feedbackText?.includes('Descend and slow down to rearm'));
  assert.ok(await page.evaluate(()=>__feedbackText.some(t=>t.includes('Total speed <'))));
  await page.screenshot({path:out+'airfield-approach.png'});
  await page.evaluate(()=>{
   const s=__RAPTOR,p=s.player,af=s.match.airfield,x=af.x+200,y=af.y;
   p.debugCommand({pos:{x,y,alt:Math.max(0,p.terrain.heightAt(x,y))+200,headingDeg:0,speed:80}});
   s.match.tick(s.sim,2);
  });
  await page.waitForFunction(()=>window.__feedbackText?.includes('REARMING 50% · 2.0s remaining'));
  await page.screenshot({path:out+'airfield-rearming.png'});
  await page.evaluate(()=>{
   const s=__RAPTOR,st=s.player.fm.state;
   s.battlefield.samLive[0]=1;s.battlefield.sam.set([st[0]-700,st[1]+500,st[2]-150,400,-120,50,1,100,0,0,0]);
  });
  await page.setViewportSize({width:390,height:320});
  await page.waitForFunction(()=>window.__feedbackText?.some(t=>t.includes("O'CLOCK")));
  assert.equal(await page.evaluate(()=>__feedbackText.some(t=>t.startsWith('AIRFIELD'))),false,'urgent missile cue takes priority over rearm card');
  await page.screenshot({path:out+'airfield-threat-compact.png'});
  await page.evaluate(()=>__RAPTOR.battlefield.samLive.fill(0));
  await page.setViewportSize({width:1280,height:800});await frame();
  await page.evaluate(()=>__RAPTOR.match.tick(__RAPTOR.sim,2));
  await page.waitForFunction(()=>!window.__feedbackText?.some(t=>t.startsWith('AIRFIELD')));
  assert.deepEqual(await page.evaluate(()=>[__RAPTOR.player.gun.ammo,__RAPTOR.player.missiles.ammo,__RAPTOR.player.hp]),[480,4,100]);
 });
 await check('boundary return heading and missile threat remain readable together',async()=>{
  await page.evaluate(()=>{
   const s=__RAPTOR;s.player.debugCommand({pos:{x:31000,y:0,alt:5000,headingDeg:180,speed:200}});
   s.match.tick(s.sim,3);
   s.battlefield.samLive[0]=1;s.battlefield.sam.set([30300,500,4850,400,-120,50,1,100,0,0,0]);
  });
  await page.waitForFunction(()=>window.__feedbackText?.includes('RETURN TO BATTLE'));
  assert.ok(await page.evaluate(()=>__feedbackText.some(t=>t.startsWith('HDG 270°'))));
  assert.ok(await page.evaluate(()=>__feedbackText.includes('5s until hull damage')));
  assert.ok(await page.evaluate(()=>__feedbackText.some(t=>t.includes("O'CLOCK"))));
  await page.screenshot({path:out+'boundary-threat.png'});
  await page.setViewportSize({width:390,height:320});await frame();
  assert.ok(await page.evaluate(()=>__feedbackText.includes('MISSILE')),'urgent warning survives when there is insufficient room for both cards');
  assert.ok(await page.evaluate(()=>{
   const detail=__feedbackInk.find(row=>row.message.includes('BREAK TURN'));
   return detail.y+4<document.querySelector('.flight-hints').getBoundingClientRect().top;
  }),'missile instructions must remain above the key reminders');
  await page.screenshot({path:out+'threat-priority-compact.png'});
  await page.setViewportSize({width:390,height:360});await frame();
  assert.ok(await page.evaluate(()=>__feedbackText.includes('RETURN TO BATTLE')));
  assert.ok(await page.evaluate(()=>__feedbackText.includes('MISSILE')));
  await page.screenshot({path:out+'boundary-threat-compact.png'});
  await page.setViewportSize({width:1280,height:800});await frame();
 });
 await check('completed sortie report freezes real counters and offers a clear replay',async()=>{
  await page.evaluate(()=>{
   const s=__RAPTOR;s.sim.time=321;s.match.over=-1;s.match.blue=0;
   s.player.crashes=3;s.bandits.kills=7;s.battlefield.kills=5;s.cockpit.pause('result');
  });
  await page.locator('.sortie-debrief').waitFor();
  assert.deepEqual(await page.locator('.sortie-metrics dd').allTextContents(),['5:21','7','5','3']);
  assert.match(await page.locator('.sortie-debrief').textContent(),/No aircraft remaining/);
  assert.equal(await page.locator('[data-restart]').first().textContent(),'Fly battle again ↗');
  await page.evaluate(()=>{__RAPTOR.sim.time=999;__RAPTOR.bandits.kills=99;__RAPTOR.cockpit.showPause();});
  assert.deepEqual(await page.locator('.sortie-metrics dd').allTextContents(),['5:21','7','5','3']);
  await page.screenshot({path:out+'sortie-debrief.png'});
  await page.setViewportSize({width:390,height:667});await frame();
  assert.equal(await page.locator('.pause-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.screenshot({path:out+'sortie-debrief-narrow.png'});
 });
 await check('in-flight pilot backup keeps export available and restore disabled',async()=>{
  await page.evaluate(()=>__RAPTOR.cockpit.openLog());
  await page.locator('[data-pilot-backup]').click();
  await page.locator('.pilot-backup[open]').waitFor();
  assert.equal(await page.locator('[data-backup-export]').isEnabled(),true);
  assert.equal(await page.locator('[data-backup-choose]').isEnabled(),false);
  assert.match(await page.locator('.pilot-backup').textContent(),/preflight/);
 });
 assert.deepEqual(errors,[]);
} catch(error) {process.exitCode=1;console.error(error);await page.screenshot({path:out+'failure.png'}).catch(()=>{});}
finally {await writeFile(out+'results.json',JSON.stringify({checks,errors},null,2));await context.close();await browser.close();}
