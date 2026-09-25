import {pathToFileURL} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const origin=process.env.RAPTOR_BASE_URL||'http://localhost:8082/';
const out=(process.env.RAPTOR_TEST_OUTPUT||'.context/raptor-backup/').replace(/\/?$/,'/');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:850},acceptDownloads:true,serviceWorkers:'block'});
const page=await context.newPage(),checks=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const openBackup=async()=>{await page.locator('[data-open="progress"]').click();await page.locator('[data-pilot-backup]').click();await page.locator('.pilot-backup[open]').waitFor();};
const choose=async content=>page.locator('[data-backup-file]').setInputFiles({name:'pilot.json',mimeType:'application/json',buffer:Buffer.from(content)});
let exported;
try{
 await page.goto(origin,{waitUntil:'networkidle'});
 await page.evaluate(async()=>{
  const {markDone}=await import('/src/campaign/authored.js');markDone('N01');markDone('N02');markDone('Y01');
  const {freshSave,genMission,reduceCampaign,saveSave}=await import('/src/campaign/engine.js');
  const op=freshSave('NELLIS');saveSave(reduceCampaign(op,genMission(op),{over:1,simHash:'12345678'}));
  localStorage.setItem('raptor.flight-school.v1',JSON.stringify({version:1,completedAt:1234567,completions:2}));
  localStorage.setItem('unrelated-app','do not export');
  const settings=await import('/src/game/settings.js');settings.saveSettings({pointingDevice:'trackpad',muted:true});
  __RAPTOR.input.setBinding('throttle_up',0,['KeyU']);
 });
 await openBackup();
 await check('downloaded backup contains progress, settings and actual custom controls only',async()=>{
  // The live settings/input already recovered valid values; stale malformed
  // storage must not prevent exporting those values for a future repair.
  await page.evaluate(()=>{localStorage.setItem('raptor.settings.v1','corrupt');localStorage.setItem('raptor:binds:v3','corrupt');});
  const received=page.waitForEvent('download');await page.locator('[data-backup-export]').click();
  const download=await received;await download.saveAs(out+'pilot.json');exported=await readFile(out+'pilot.json','utf8');
  const data=JSON.parse(exported);
  assert.deepEqual(data.entries['raptor.auth.v1'].done,{N01:1,N02:1});
  assert.deepEqual(data.entries['raptor.scenarios.v1'].done,{Y01:1});
  assert.equal(Object.hasOwn(data.entries,'raptor.op.v1:NEWYORK'),false);
  assert.equal(data.entries['raptor.op.v1:NELLIS'].sortieIndex,1);
  assert.deepEqual(data.entries['raptor:binds:v3'].throttle_up[0],['KeyU']);
  assert.equal(data.entries['raptor.settings.v1'].pointingDevice,'trackpad');
  assert.equal(exported.includes('unrelated-app'),false);
  assert.match(await page.locator('[data-backup-status]').textContent(),/download started/);
 });
 await check('preview and cancel never overwrite current progress',async()=>{
  await page.evaluate(()=>localStorage.setItem('raptor.auth.v1',JSON.stringify({v:1,done:{N01:1}})));
  await choose(exported);await page.locator('[data-backup-preview]:visible').waitFor();
  assert.match(await page.locator('.backup-summary').textContent(),/2 \/ 30.*1 currently saved/);
  assert.match(await page.locator('.backup-summary').textContent(),/Standalone scenarios1 \/ 1/);
  assert.equal(await page.locator('[data-backup-cancel]').evaluate(el=>el===document.activeElement),true);
  await page.screenshot({path:out+'preview.png'});
  await page.locator('[data-backup-cancel]').click();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('raptor.auth.v1')).done),{N01:1});
 });
 await check('invalid file is rejected while current records remain intact',async()=>{
  await choose('{"format":"other-app"}');
  await page.waitForFunction(()=>document.querySelector('[data-backup-status]').textContent.includes('not a supported'));
  assert.equal(await page.locator('[data-backup-preview]').isVisible(),false);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('raptor.auth.v1')).done),{N01:1});
 });
 await check('valid backup can recover a corrupted current profile on a narrow screen',async()=>{
  await page.evaluate(()=>localStorage.setItem('raptor.auth.v1','corrupt record'));
  await page.setViewportSize({width:390,height:844});await choose(exported);
  await page.locator('[data-backup-restore]').waitFor();
  assert.match(await page.locator('.backup-summary').textContent(),/Current profile unreadable/);
  assert.equal(await page.locator('.pilot-backup').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.screenshot({path:out+'narrow-recovery.png'});
  await page.locator('[data-backup-restore]').click();await page.waitForSelector('#flyBtn');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('raptor.auth.v1')).done),{N01:1,N02:1});
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('raptor.scenarios.v1')).done),{Y01:1});
  assert.equal(await page.locator('[data-deck-device="trackpad"]').getAttribute('aria-pressed'),'true');
  assert.deepEqual(await page.evaluate(()=>__RAPTOR.input.actions.throttle_up.binds[0]),['KeyU']);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('raptor.op.v1:NELLIS')).sortieIndex),1);
  assert.equal(await page.evaluate(()=>localStorage.getItem('unrelated-app')),'do not export');
  assert.equal(await page.evaluate(()=>__RAPTOR.ready),false);
 });
 await check('a newer backup choice wins when an older file finishes reading later',async()=>{
  // Control only File.text completion order. The production readFile method,
  // parser, preview, cancellation, and real dialog lifecycle remain in use.
  await page.evaluate(async content=>{
   const {PilotBackupMenu}=await import('/src/game/pilotbackupmenu.js');
   const menu=new PilotBackupMenu();menu.show();
   const older=JSON.parse(content);older.entries['raptor.auth.v1'].done={N01:1};
   const pending={menu,older:JSON.stringify(older),latest:content,before:JSON.stringify({...localStorage})};
   for(const name of ['older','latest']){
    const file=new File([pending[name]],name+'.json',{type:'application/json'});
    file.text=()=>new Promise(resolve=>{pending[name+'Resolve']=resolve;});
    pending[name+'Read']=menu.readFile(file);
   }
   window.__backupReads=pending;
  },exported);
  assert.match(await page.locator('[data-backup-status]').textContent(),/Reading/);
  assert.equal(await page.locator('[data-backup-preview]').isVisible(),false);
  await page.evaluate(async()=>{const p=__backupReads;p.latestResolve(p.latest);await p.latestRead;});
  assert.match(await page.locator('.backup-summary').textContent(),/2 \/ 30/);
  const newestPreview=await page.locator('[data-backup-preview]').innerHTML();
  await page.evaluate(async()=>{const p=__backupReads;p.olderResolve(p.older);await p.olderRead;});
  assert.equal(await page.locator('[data-backup-preview]').innerHTML(),newestPreview);
  assert.deepEqual(await page.evaluate(()=>__backupReads.menu.pending.entries['raptor.auth.v1'].done),{N01:1,N02:1});
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})===__backupReads.before),true);
  await page.locator('[data-backup-cancel]').click();
  assert.equal(await page.locator('[data-backup-preview]').isVisible(),false);
  await page.getByRole('button',{name:'Close Keep your pilot profile',exact:true}).click();
  await page.locator('.pilot-backup').waitFor({state:'detached'});
  await page.evaluate(()=>{delete window.__backupReads;});
 });
 await check('closing backup ignores both late file completion and late read failure',async()=>{
  for(const outcome of ['complete','fail']){
   await page.evaluate(async content=>{
    const {PilotBackupMenu}=await import('/src/game/pilotbackupmenu.js');
    const menu=new PilotBackupMenu();menu.show();
    const file=new File([content],'delayed.json',{type:'application/json'});
    const pending={menu,content,before:JSON.stringify({...localStorage})};
    file.text=()=>new Promise((resolve,reject)=>{pending.resolve=resolve;pending.reject=reject;});
    pending.read=menu.readFile(file);
    pending.markup=menu.body.innerHTML;
    window.__backupReads=pending;
   },exported);
   await page.getByRole('button',{name:'Close Keep your pilot profile',exact:true}).click();
   await page.locator('.pilot-backup').waitFor({state:'detached'});
   const result=await page.evaluate(async mode=>{
    const p=__backupReads;
    if(mode==='complete')p.resolve(p.content);else p.reject(new Error('Delayed file read failed'));
    await p.read;
    const result={open:p.menu.open,connected:p.menu.el.isConnected,pending:p.menu.pending,
     unchanged:p.menu.body.innerHTML===p.markup,storageUnchanged:JSON.stringify({...localStorage})===p.before};
    delete window.__backupReads;
    return result;
   },outcome);
   assert.deepEqual(result,{open:false,connected:false,pending:null,unchanged:true,storageUnchanged:true});
   assert.equal(await page.locator('.pilot-backup').count(),0);
  }
 });
 assert.deepEqual(errors,[]);
}catch(error){console.error(error);process.exitCode=1;await page.screenshot({path:out+'failure.png'}).catch(()=>{});}
finally{await writeFile(out+'results.json',JSON.stringify({checks,errors},null,2));await context.close();await browser.close();}
