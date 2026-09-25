// Returning-pilot handoff and first-use graphics on each backend. Saved training
// and inspection poses are fixtures; flight-school.browser.mjs flies the course.
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const out=(process.env.RAPTOR_TEST_OUTPUT||'.context/ceo-pass/demo/').replace(/\/?$/,'/');await mkdir(out,{recursive:true});
const origin=process.env.RAPTOR_BASE_URL||'http://localhost:8082/';
const browser=await chromium.launch({channel:'chrome',headless:true});
const report=[];
try{for(const backend of ['webgpu','webgl']){
 const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
 await context.addInitScript(()=>{
  localStorage.setItem('raptor.settings.v1',JSON.stringify({tier:'HIGH',renderScale:.6,masterVol:0,showHints:false,showChecklist:false}));
  localStorage.setItem('raptor.practice.introduced','true');
  localStorage.setItem('raptor.flight-school.v1',JSON.stringify({version:1,completedAt:1,completions:2}));
 });
 const page=await context.newPage(),result={backend,checks:[],errors:[]};report.push(result);
 page.on('pageerror',e=>result.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')result.errors.push(m.text());});
 const pass=name=>{result.checks.push(name);console.log('PASS '+backend+' '+name);};
 try{
  await page.goto(origin+'?mode=practice&front=NELLIS'+(backend==='webgl'?'&gl=1':''));
  await page.waitForFunction(()=>window.__RAPTOR?.ready||window.__RAPTOR?.failure,null,{timeout:180000});
  assert.equal(await page.evaluate(()=>__RAPTOR.failure),null);await page.waitForSelector('#veil',{state:'detached'});
  assert.equal(await page.evaluate(()=>__RAPTOR.backend),backend);
  result.resources=await page.evaluate(()=>{const s=__RAPTOR,g=s.terrain.fineGrid;return {fineGrid:!!g,indexUploaded:!!(g&&(s.rendering.renderer.backend.get(g.index).buffer||s.rendering.renderer.backend.get(g.index).bufferGPU)),plumes:s.rendering.scene.getObjectsByProperty('name','F119-exhaust').length};});
  assert.equal(result.resources.fineGrid,true);assert.equal(result.resources.indexUploaded,true);assert.equal(result.resources.plumes,2);
  pass('prepared terrain buffers are uploaded before first flight');
  if(!await page.evaluate(()=>__RAPTOR.paused))await page.locator('[data-flight-action="pause"]').click();
  await page.locator('[data-school-start]').click();
  assert.equal(await page.locator('.pause-dialog').getAttribute('data-pause-kind'),'welcome');
  const handoff=await page.evaluate(async()=>{const s=await import('/src/game/settings.js');return {paused:__RAPTOR.paused,index:__RAPTOR.cockpit.coach.course.index,status:__RAPTOR.cockpit.coach.course.status,coach:s.current().showChecklist,hints:s.current().showHints,record:JSON.parse(localStorage.getItem('raptor.flight-school.v1')),throttle:__RAPTOR.player.throttleCmd};});
  assert.deepEqual({...handoff,record:undefined},{paused:true,index:0,status:'active',coach:true,hints:true,record:undefined,throttle:.8});assert.equal(handoff.record.completions,2);
  const start=await page.locator('[data-resume]').boundingBox();assert.ok(start.y+start.height<800);
  await page.screenshot({path:out+backend+'-guest-ready.png'});pass('guest handoff restores a paused first lesson without erasing training');
  await page.locator('[data-resume]').click();await page.waitForFunction(()=>!__RAPTOR.paused&&__RAPTOR.sim.time>.5);
  await page.keyboard.down('w');await page.waitForFunction(()=>__RAPTOR.player.throttleCmd>=1.05);await page.keyboard.up('w');
  await page.waitForFunction(()=>__RAPTOR.rendering.scene.getObjectsByProperty('name','F119-exhaust').every(o=>o.visible));
  pass('real throttle input activates the prepared afterburners');
  await page.evaluate(()=>{const s=__RAPTOR,x=0,y=-6000;const alt=s.terrain.heightAt(x,y)+550;s.player.debugCommand({pos:{x,y,alt,headingDeg:45,speed:200}});});
  await page.waitForTimeout(1200);await page.screenshot({path:out+backend+'-near-terrain.png'});
  assert.equal(await page.evaluate(()=>__RAPTOR.paused),false);pass('near-terrain inspection renders after the first descent');
  await page.locator('[data-flight-action="pause"]').click();await page.locator('[data-recover]').click();
  assert.equal(await page.evaluate(()=>__RAPTOR.paused),true);
  assert.equal(await page.evaluate(()=>__RAPTOR.player.throttleCmd),.8);pass('visible level-flight recovery keeps the guest safely paused');
  assert.deepEqual(result.errors,[]);
 }catch(error){result.failure=String(error);await page.screenshot({path:out+backend+'-failure.png'}).catch(()=>{});throw error;}
 finally{await context.close();}
}}
finally{await writeFile(out+'results.json',JSON.stringify(report,null,2));await browser.close();}
