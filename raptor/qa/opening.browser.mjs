// First impression and optional setup, in fresh storage without a 3D boot.
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const out=(process.env.RAPTOR_TEST_OUTPUT||'.context/ceo-pass/opening/').replace(/\/?$/,'/');await mkdir(out,{recursive:true});
const origin=process.env.RAPTOR_BASE_URL||'http://localhost:8082/';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
const page=await context.newPage(),checks=[],errors=[],startupRequests=[];
page.on('request',request=>startupRequests.push(new URL(request.url()).pathname));
page.on('pageerror',e=>errors.push(e.message));
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const inViewport=async selector=>{const box=await page.locator(selector).boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=page.viewportSize().height,`${selector} is visible without scrolling`);};
try{
 await page.goto(origin,{waitUntil:'networkidle'});
 await check('fresh visitors see one safe launch action without a setup checklist',async()=>{
  assert.equal(await page.locator('#launch-action').textContent(),'Start flying');
  assert.equal(await page.locator('#flight-customize').getAttribute('open'),null);
  assert.equal(await page.locator('main .primary:visible').count(),1);
  assert.match(await page.locator('#launch-label').textContent(),/Practice flight · Nellis/);
  assert.match(await page.locator('#launch-conditions').textContent(),/No enemies or time limit/);
  await inViewport('#flyBtn');await page.screenshot({path:out+'desktop.png'});
 });
 await check('preflight does not download the flight renderer or world',async()=>{
  assert.equal(startupRequests.some(path=>path==='/src/main.js'||path.startsWith('/vendor/')||path.startsWith('/src/world/')||path.startsWith('/src/aircraft/')),false);
  assert.equal(await page.evaluate(()=>window.__RAPTOR.hangar),true);
 });
 await check('all four flight modes are one click away without opening setup',async()=>{
  for(const [mode,label,action] of [['battle','Quick battle','Launch battle'],['operation','Operation','Fly operation'],['campaign','Campaign','Fly next mission'],['practice','Practice flight','Start flying']]){
   await page.locator(`[data-mode="${mode}"]`).click();
   assert.equal(await page.locator('#flight-customize').getAttribute('open'),null);
   assert.match(await page.locator('#launch-label').textContent(),new RegExp(label));
   assert.equal(await page.locator('#launch-action').textContent(),action);
   assert.equal(await page.locator('[data-mode][aria-pressed="true"]').count(),1);
   assert.equal(await page.evaluate(()=>__RAPTOR.ready),false);
  }
 });
 await check('destination shortcuts keep the launch, setup and saved region in sync',async()=>{
  await page.locator('[data-deck-front="VALDEZ"]').click();
  assert.match(await page.locator('#launch-label').textContent(),/Valdez/);
  assert.equal(await page.locator('[data-front="VALDEZ"]').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('#destination-description').textContent(),/Glacier/);
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('[data-deck-front="VALDEZ"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-deck-front="NELLIS"]').click();
 });
 await check('campaign briefing is available directly and region follows the mission',async()=>{
  await page.locator('[data-mode="campaign"]').click();
  await page.waitForFunction(()=>!document.getElementById('flyBtn').disabled);
  assert.equal(await page.locator('[data-deck-front="VALDEZ"]').isDisabled(),true);
  assert.match(await page.locator('#destination-description').textContent(),/Mission 01/);
  await page.locator('[data-deck-brief]').click();
  assert.equal(await page.locator('[data-mission="N01"]').getAttribute('aria-pressed'),'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-deck-brief]').evaluate(el=>document.activeElement===el),true);
  await page.locator('[data-mode="practice"]').click();
 });
 await check('launch remains visible on a laptop and a narrow viewport',async()=>{
  for(const [width,height] of [[1280,720],[768,1024],[390,844],[375,667]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await inViewport('#flyBtn');
   assert.equal(await page.locator('#hangar').evaluate(el=>el.scrollWidth<=innerWidth),true);
   await page.screenshot({path:out+`${width}x${height}.png`});
  }
 });
 await check('keyboard opens optional setup and Done returns focus to launch',async()=>{
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#flight-customize summary').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-front="VALDEZ"]').isVisible(),true);
  await page.locator('[data-front="VALDEZ"]').click();await page.locator('[data-time="golden"]').click();
  await page.locator('[data-customize-done]').click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'flyBtn');
  assert.match(await page.locator('#launch-label').textContent(),/Valdez/);
  assert.match(await page.locator('#launch-conditions').textContent(),/Golden hour/);
  assert.equal(await page.locator('#destination-name').textContent(),'Valdez');
 });
 await check('saved flights stay explicit while optional setup stays closed',async()=>{
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('#flight-customize').getAttribute('open'),null);
  assert.match(await page.locator('#launch-label').textContent(),/Valdez/);
  assert.match(await page.locator('#launch-conditions').textContent(),/Golden hour/);
  await page.locator('[data-deck-device="trackpad"]').click();
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('[data-deck-device="trackpad"]').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('#setup-summary').textContent(),/Trackpad aiming/);
 });
 await check('campaign and battle expose their actual launch context',async()=>{
  await page.locator('#flight-customize summary').click();await page.locator('[data-mode="campaign"]').click();
  await page.waitForFunction(()=>!document.getElementById('flyBtn').disabled);
  assert.match(await page.locator('#launch-label').textContent(),/Campaign · Nellis/);
  assert.equal(await page.locator('#destination-name').textContent(),'Nellis');
  assert.equal(await page.locator('[data-front="VALDEZ"]').isDisabled(),true);
  await page.locator('[data-mode="battle"]').click();await page.locator('[data-customize-done]').click();
  assert.match(await page.locator('#launch-label').textContent(),/Quick battle · Nellis/);
  assert.equal(await page.locator('#launch-action').textContent(),'Launch battle');
 });
 await check('leaving a New York selection for campaign keeps other flight modes accessible',async()=>{
  await page.locator('#flight-customize summary').click();await page.locator('[data-front="NEWYORK"]').click();
  assert.equal(await page.locator('[data-mode="battle"]').isDisabled(),true);
  await page.locator('[data-mode="campaign"]').click();
  assert.equal(await page.locator('#destination-name').textContent(),'Nellis');
  assert.equal(await page.locator('[data-mode="battle"]').isEnabled(),true);
  assert.equal(await page.locator('[data-mode="operation"]').isEnabled(),true);
  await page.locator('[data-mode="operation"]').click();
  assert.match(await page.locator('#launch-label').textContent(),/Operation · Nellis/);
  await page.locator('[data-customize-done]').click();
 });
 await check('New York destination shortcut keeps supported modes and standalone briefing separate',async()=>{
  await page.locator('[data-deck-front="NEWYORK"]').click();
  assert.equal(await page.locator('#destination-name').textContent(),'New York');
  assert.equal(await page.locator('[data-front="NEWYORK"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-mode="practice"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-mode="battle"]').isDisabled(),true);
  assert.equal(await page.locator('[data-mode="operation"]').isDisabled(),true);
  const route=await page.locator('.destination-route').boundingBox();
  const caption=await page.locator('.destination-caption').boundingBox();
  assert.ok(caption.y+caption.height<=route.y,'four destination shortcuts must not overlap their caption');
  const shortcuts=await page.locator('[data-deck-front]').evaluateAll(buttons=>buttons.map(button=>button.getBoundingClientRect().top));
  assert.equal(new Set(shortcuts).size,1,'all destinations fit a single row');
  await page.screenshot({path:out+'newyork-preflight.png'});
  await page.locator('[data-scenario-brief]').click();
  await page.locator('[data-scenario-launch]').waitFor();
  assert.match(await page.locator('.scenario-dialog').textContent(),/Harbor Watch/);
  await page.locator('[data-scenario-cancel]').click();
  await page.locator('[data-open="progress"]').click();
  await page.locator('[data-scenario="Y01"]').waitFor();
  assert.equal(await page.locator('[data-filter="NEWYORK"]').count(),0);
  assert.equal(await page.locator('.operation-ledger').last().locator('article').count(),3);
  await page.locator('[data-mission-search]').fill('no matching mission');
  assert.equal(await page.locator('.log-empty').isVisible(),true);
  await page.locator('[data-scenario="Y01"]').click();
  await page.locator('[data-fly-scenario]').waitFor();
  assert.match(await page.locator('[data-fly-scenario]').textContent(),/Harbor Watch/);
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>__RAPTOR.ready),false);
 });
 await check('returning late-campaign pilots get a concise opening and the matching briefing',async()=>{
  await page.evaluate(async()=>{
   const {CAMPAIGN,markDone}=await import('/src/campaign/authored.js');
   for(const mission of CAMPAIGN)if(mission.id!=='M10')markDone(mission.id);
   localStorage.setItem('raptor.preflight.v1',JSON.stringify({mode:'campaign',front:'MARIANAS',time:'noon'}));
  });
  await page.setViewportSize({width:1280,height:720});await page.reload({waitUntil:'networkidle'});
  assert.ok((await page.locator('#welcome-copy').textContent()).length<130);
  await inViewport('#flyBtn');
  await page.locator('[data-open="progress"]').click();await page.locator('[data-mission="N01"]').click();await page.keyboard.press('Escape');
  await page.locator('#flight-customize summary').click();await page.locator('#brief-more').click();
  assert.equal(await page.locator('[data-mission="M10"]').getAttribute('aria-pressed'),'true');await page.keyboard.press('Escape');
  await page.locator('[data-customize-done]').click();
  await page.setViewportSize({width:375,height:667});await page.reload({waitUntil:'networkidle'});await inViewport('#flyBtn');
  await page.screenshot({path:out+'returning-campaign.png'});
 });
 await check('unavailable mission setup returns keyboard focus to its visible disclosure',async()=>{
  await context.route('**/src/campaign/sorties/nellis-01.js',route=>route.abort());
  await page.evaluate(()=>{localStorage.removeItem('raptor.auth.v1');localStorage.setItem('raptor.preflight.v1',JSON.stringify({mode:'campaign',front:'NELLIS',time:'noon'}));});
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('#flyBtn').isDisabled(),true);
  await page.locator('#flight-customize summary').click();await page.locator('[data-customize-done]').click();
  assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('#flight-customize summary')),true);
  assert.match(await page.locator('#deck-status').textContent(),/could not load/);
 });
 assert.deepEqual(errors,[]);
}catch(error){process.exitCode=1;console.error(error);await page.screenshot({path:out+'failure.png'});}
finally{await writeFile(out+'results.json',JSON.stringify({checks,errors},null,2));await browser.close();}
