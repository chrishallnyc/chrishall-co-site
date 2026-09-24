#!/usr/bin/env node
// Verify an AO-only coating rebuild without assuming PNG byte encodings match.
// Uses an existing Playwright/Chromium install; no package or browser download.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const args = {};
for(let i=2;i<process.argv.length;i+=2) args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
if(!args.before || !args.after) throw new Error('Usage: node raptor/qa/texture-channels.mjs --before directory --after directory [--ao-source directory] [--out report.json]');
let playwright = args.playwright ?? process.env.AIRCRAFT_QA_PLAYWRIGHT;
if(!playwright) for(const name of ['playwright','playwright-core']) { try { playwright=require.resolve(name);break; } catch {} }
if(!playwright) {
  const cache=path.join(os.homedir(),'.bun/install/cache');
  const name=(await fs.readdir(cache).catch(()=>[])).filter(name=>name.startsWith('playwright-core@')).sort().at(-1);
  if(name) playwright=path.join(cache,name);
}
if(!playwright) throw new Error('Pass --playwright or AIRCRAFT_QA_PLAYWRIGHT to an installed Playwright package.');
const {chromium}=require(playwright);
const executablePath=args.browser ?? process.env.AIRCRAFT_QA_BROWSER ?? (process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':chromium.executablePath());
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const input={maps:[],ao:null};
for(const atlas of ['body','lifting']) for(const quality of ['high','medium','low']) for(const kind of ['color','normal','orm']) {
  const name=`${atlas}-${quality}-${kind}.png`;
  const [before,after]=await Promise.all([fs.readFile(path.join(args.before,name)),fs.readFile(path.join(args.after,name))]);
  input.maps.push({name,atlas,quality,kind,beforeSHA256:digest(before),afterSHA256:digest(after),
    before:`data:image/png;base64,${before.toString('base64')}`,after:`data:image/png;base64,${after.toString('base64')}`});
}
if(args['ao-source']) {
  const directory=args['ao-source'], manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
  input.ao={strength:manifest.strength??1,maps:{}};
  for(const atlas of ['body','lifting']) input.ao.maps[atlas]=`data:image/png;base64,${(await fs.readFile(path.join(directory,manifest.maps[atlas].file))).toString('base64')}`;
}
let launch,browser;
try {
  launch=await chromium.launchServer({executablePath,headless:true});
  browser=await chromium.connect(launch.wsEndpoint());
  const page=await browser.newPage();
  const results=await page.evaluate(async input=>{
    async function decode(url,width,height) {
      const image=new Image();image.src=url;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=width??image.width;canvas.height=height??image.height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
      return {width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
    }
    const results=[];
    for(const entry of input.maps) {
      const {before,after,...metadata}=entry;
      const a=await decode(before),b=await decode(after);
      const result={...metadata,width:a.width,height:a.height,byteIdentical:metadata.beforeSHA256===metadata.afterSHA256,
        changed:[0,0,0,0],brightenedRed:0,redDifferenceMaximum:0,redDifferenceSum:0,expectedRedFailures:0};
      result.dimensionsMatch=a.width===b.width&&a.height===b.height;
      const ao=input.ao&&entry.kind==='orm'&&entry.quality==='high'?await decode(input.ao.maps[entry.atlas],a.width,a.height):null;
      const strength=Math.max(0,Math.min(1,input.ao?.strength??1));
      for(let i=0;i<a.data.length;i+=4) {
        for(let c=0;c<4;c++) if(a.data[i+c]!==b.data[i+c]) result.changed[c]++;
        if(b.data[i]>a.data[i]) result.brightenedRed++;
        result.redDifferenceMaximum=Math.max(result.redDifferenceMaximum,a.data[i]-b.data[i]);
        result.redDifferenceSum+=a.data[i]-b.data[i];
        if(ao&&b.data[i]!==Math.round(a.data[i]*(1-strength+strength*ao.data[i]/255))) result.expectedRedFailures++;
      }
      result.meanRedReduction=result.redDifferenceSum/(a.width*a.height);delete result.redDifferenceSum;
      result.pass=result.dimensionsMatch&&(entry.kind==='orm'?
        result.changed[0]>0&&!result.changed[1]&&!result.changed[2]&&!result.changed[3]&&!result.brightenedRed&&!result.expectedRedFailures:
        result.byteIdentical&&result.changed.every(value=>value===0));
      results.push(result);
    }
    return results;
  },input);
  const report={schema:1,before:path.resolve(args.before),after:path.resolve(args.after),pass:results.every(result=>result.pass),maps:results};
  if(args.out) { await fs.mkdir(path.dirname(path.resolve(args.out)),{recursive:true});await fs.writeFile(args.out,JSON.stringify(report,null,2)+'\n'); }
  console.log(JSON.stringify({pass:report.pass,maps:results.length,failures:results.filter(result=>!result.pass),orm:results.filter(result=>result.kind==='orm').map(({name,changed,meanRedReduction,expectedRedFailures})=>({name,changed,meanRedReduction,expectedRedFailures}))}));
  if(!report.pass) process.exitCode=1;
} finally {
  const timeout=setTimeout(()=>launch?.kill().catch(()=>{}),2000);
  await browser?.close().catch(()=>{});await launch?.close().catch(()=>{});clearTimeout(timeout);
}
