// Exercise real canvas sizing while an awaited startup asset is held. Pixel
// checks inspect the displayed frame, never a replacement GPU render target.
import {pathToFileURL} from 'node:url';
import {mkdir, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const origin=process.env.RAPTOR_BASE_URL||'http://localhost:8097/';
const out=(process.env.RAPTOR_TEST_OUTPUT||'.context/raptor-viewport/').replace(/\/?$/,'/');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:process.env.HEADED!=='1'});
const scenarios=[
 {name:'retina-growth',backend:'webgpu',dpr:2,start:{width:1280,height:900},boot:{width:2560,height:900},live:{width:1440,height:900},paused:{width:1920,height:900}},
 {name:'standard-shrink',backend:'webgl',dpr:1,start:{width:1440,height:900},boot:{width:960,height:720},live:{width:1280,height:800},paused:{width:1024,height:768}},
].filter(s=>!process.env.RAPTOR_TEST_BACKEND||s.backend===process.env.RAPTOR_TEST_BACKEND);
assert.ok(scenarios.length,'RAPTOR_TEST_BACKEND must be webgpu or webgl');
const results=[];
try {
 for(const scenario of scenarios){
  const context=await browser.newContext({viewport:scenario.start,deviceScaleFactor:scenario.dpr,serviceWorkers:'block'});
  await context.addInitScript(()=>localStorage.setItem('raptor.settings.v1',JSON.stringify({tier:'AUTO',muted:true})));
  const page=await context.newPage(),report={scenario,checks:[],frames:[],errors:[]};results.push(report);
  page.setDefaultTimeout(25000);
  page.on('pageerror',error=>report.errors.push(error.message));
  let release;
  const hold=new Promise(resolve=>{release=resolve;});
  await page.route('**/assets/atmo/transmittance_msb.png',async route=>{await hold;await route.continue();});
  const ready=async()=>{
   await page.waitForFunction(()=>window.__RAPTOR?.ready||window.__RAPTOR?.failure,null,{timeout:180000});
   assert.equal(await page.evaluate(()=>__RAPTOR.failure),null);
   await page.waitForSelector('#veil',{state:'detached'});
   assert.equal(await page.evaluate(()=>__RAPTOR.backend),scenario.backend);
  };
  const frames=async()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
  const resume=async()=>{
   if(await page.locator('.pause-dialog[open]').count())await page.locator('[data-resume]').click();
   await page.waitForFunction(()=>!__RAPTOR.paused&&__RAPTOR.sim.time>.1);await frames();
  };
  const dimensions=async()=>page.evaluate(async()=>{
   const {Vector2,Vector4}=await import('three'),s=__RAPTOR,r=s.rendering.renderer,c=r.domElement;
   const bounds=element=>{const b=element.getBoundingClientRect();return [b.x,b.y,b.width,b.height];};
   return {window:[innerWidth,innerHeight,devicePixelRatio],canvas:[c.width,c.height],bounds:bounds(c),
    logical:r.getSize(new Vector2()).toArray(),buffer:r.getDrawingBufferSize(new Vector2()).toArray(),
    ratio:r.getPixelRatio(),viewport:r.getViewport(new Vector4()).toArray(),hud:bounds(s.hud.canvas),
    aspect:s.rendering.camera.aspect,paused:s.paused,budget:s.frameBudget};
  });
  const assertDimensions=data=>{
   const [width,height]=data.window;
   assert.deepEqual(data.logical,[width,height],'renderer logical size follows the current window');
   assert.deepEqual(data.bounds,[0,0,width,height],'flight canvas fills the window');
   assert.deepEqual(data.hud,[0,0,width,height],'HUD and flight canvas share the same bounds');
   assert.deepEqual(data.canvas,data.buffer,'canvas backing size matches the renderer');
   assert.ok(Math.abs(data.canvas[0]-width*data.ratio)<=1&&Math.abs(data.canvas[1]-height*data.ratio)<=1,'backing size applies DPR/render scale once');
   assert.ok(Math.abs(data.aspect-width/height)<.005,'camera aspect follows the window within backing-pixel rounding');
  };
  const inspect=async label=>{
   const data=await dimensions();report.frames.push({label,...data});
   const overlay=await page.addStyleTag({content:'body > :not(#game){visibility:hidden!important}'});
   let png;
   try {png=await page.screenshot({path:out+scenario.name+'-'+label+'.png'});}
   finally {await overlay.evaluate(el=>el.remove());}
   const pixels=await page.evaluate(async encoded=>{
    const blob=await (await fetch('data:image/png;base64,'+encoded)).blob();
    const bitmap=await createImageBitmap(blob,{resizeWidth:320});
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');
    ctx.drawImage(bitmap,0,0);bitmap.close();
    const background=getComputedStyle(document.body).backgroundColor.match(/\d+/g).slice(0,3).map(Number);
    const image=ctx.getImageData(0,0,canvas.width,canvas.height),coverage=[];
    for(const [left,right] of [[.05,.30],[.70,.95]]){
     let visible=0,total=0;
     for(let y=Math.floor(canvas.height*.15);y<canvas.height*.85;y++)for(let x=Math.floor(canvas.width*left);x<canvas.width*right;x++){
      const i=(y*canvas.width+x)*4,r=image.data[i],g=image.data[i+1],b=image.data[i+2];
      if(Math.max(r,g,b)>40&&Math.abs(r-background[0])+Math.abs(g-background[1])+Math.abs(b-background[2])>35)visible++;
      total++;
     }
     coverage.push(visible/total);
    }
    return {coverage,background};
   },png.toString('base64'));
   report.frames.at(-1).pixels=pixels;
   assertDimensions(data);
   assert.ok(pixels.coverage.every(fraction=>fraction>.65),'daytime scenery covers both sides of the displayed frame: '+JSON.stringify(pixels));
   report.checks.push(label);console.log('PASS '+scenario.name+' '+label);
  };
  try {
   const asset=page.waitForRequest('**/assets/atmo/transmittance_msb.png',{timeout:90000});
   await page.goto(origin+'?front=NELLIS&tod=12'+(scenario.backend==='webgl'?'&gl=1':''),{waitUntil:'domcontentloaded'});
   await asset;
   await page.waitForFunction(width=>document.getElementById('game').style.width===width+'px',scenario.start.width);
   assert.equal(await page.evaluate(()=>__RAPTOR.ready),false,'resize happens during awaited boot work');
   await page.setViewportSize(scenario.boot);release();
   await ready();await resume();await inspect('resized-during-boot');
   await page.setViewportSize(scenario.live);await frames();await inspect('resized-during-flight');
   await page.locator('[data-flight-action="pause"]').click();await page.waitForFunction(()=>__RAPTOR.paused);
   const time=await page.evaluate(()=>__RAPTOR.sim.time);
   await page.setViewportSize(scenario.paused);await frames();
   assertDimensions(await dimensions());
   assert.equal(await page.evaluate(()=>__RAPTOR.sim.time),time,'paused resize does not advance the flight');
   await resume();await inspect('resized-while-paused-then-resumed');
   assert.deepEqual(report.errors,[]);
  } catch(error){report.failure=String(error.stack||error);throw error;}
  finally {release();await writeFile(out+'results.json',JSON.stringify(results,null,2));await context.close();}
 }
} finally {await browser.close();}
