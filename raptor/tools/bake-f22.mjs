#!/usr/bin/env node
// Rebuild committed coating maps. Requires an existing Playwright install;
// no package download, asset service, GPU renderer or API call is involved.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const productionDirectory = path.join(root, 'src/aircraft/textures/f22');
const directory = path.resolve(argument('--out', productionDirectory));
const sourceOverlay = argument('--source-overlay', null);
const aoDirectory = path.resolve(argument('--ao-source', path.join(root, 'src/aircraft/authoring/contact-ao')));
const allowStaleAO = argument('--allow-stale-ao', '0') === '1';
let contactAO = null;
if (argument('--contact-ao', '1') !== '0') {
  let metadata;
  try { metadata = JSON.parse(await fs.readFile(path.join(aoDirectory, 'manifest.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (metadata) {
    if (metadata.schema !== 1 || !metadata.geometrySHA256) throw new Error('Contact AO manifest requires schema 1 and geometrySHA256.');
    if (metadata.provisional && directory === productionDirectory) throw new Error('Provisional AO can only be baked to a separate --out directory.');
    const images = {};
    for (const atlas of ['body', 'lifting']) {
      const entry = metadata.maps?.[atlas];
      if (!entry?.file || !entry.sha256) throw new Error(`Missing ${atlas} AO source metadata.`);
      const filename = path.resolve(aoDirectory, entry.file);
      if (!filename.startsWith(aoDirectory + path.sep)) throw new Error('Contact AO source must remain inside its authoring directory.');
      const bytes = await fs.readFile(filename), sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== entry.sha256) throw new Error(`Contact AO checksum mismatch: ${atlas}`);
      images[atlas] = `data:image/png;base64,${bytes.toString('base64')}`;
    }
    contactAO = { metadata, images };
  }
}
let playwrightPath = argument('--playwright', process.env.AIRCRAFT_QA_PLAYWRIGHT);
if (!playwrightPath) {
  for (const name of ['playwright', 'playwright-core']) {
    try { playwrightPath = require.resolve(name); break; } catch {}
  }
}
if (!playwrightPath) {
  const cache = path.join(os.homedir(), '.bun/install/cache');
  const entries = await fs.readdir(cache).catch(() => []);
  const candidate = entries.filter(entry => entry.startsWith('playwright-core@')).sort().at(-1);
  if (candidate) playwrightPath = path.join(cache, candidate);
}
if (!playwrightPath) throw new Error('Pass --playwright /path/to/an/existing/playwright-core package');
const { chromium } = require(playwrightPath);
let executablePath = argument('--browser', process.env.AIRCRAFT_QA_BROWSER);
if (!executablePath && process.platform === 'darwin') executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sourceSnapshot = new Map();
async function freezeSource(directory, prefix = '/src') {
  for (const entry of await fs.readdir(directory, { withFileTypes:true })) {
    const filename = path.join(directory, entry.name), url = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await freezeSource(filename, url);
    else if (/\.(?:js|json)$/.test(entry.name)) sourceSnapshot.set(url, await fs.readFile(filename));
  }
}
await freezeSource(path.join(root,'src'));
if (sourceOverlay) await freezeSource(path.resolve(sourceOverlay));

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!filename.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) { res.writeHead(403).end(); return; }
    const data = sourceSnapshot.get(url.pathname) ?? await fs.readFile(filename);
    res.writeHead(200, { 'Content-Type': ({'.js':'text/javascript','.json':'application/json','.png':'image/png','.html':'text/html'})[path.extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browserServer, browser;
try {
  browserServer = await chromium.launchServer({ executablePath, headless: true });
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/bake-f22.html`);
  const output = await page.evaluate(async ({contactAO,allowStaleAO}) => {
    const { bakeF22Body } = await import('/src/aircraft/authoring/f22-body-paint.js');
    const { bakeF22Lifting } = await import('/src/aircraft/authoring/f22-lifting-paint.js');
    const atlases = [['body', bakeF22Body()], ['lifting', bakeF22Lifting()]];
    let contact = { status:'absent', applied:false };
    if (contactAO) {
      const { exportF22ForAO } = await import('/tools/f22-ao-scene.js');
      const geometry = await exportF22ForAO();
      const stale = geometry.geometrySHA256 !== contactAO.metadata.geometrySHA256;
      contact = { status:stale?'stale':'current',applied:true,
        geometrySHA256:geometry.geometrySHA256,bakedGeometrySHA256:contactAO.metadata.geometrySHA256,
        provisional:!!contactAO.metadata.provisional,sourceMaps:contactAO.metadata.maps,
        radiusMetres:contactAO.metadata.radiusMetres,strength:contactAO.metadata.strength??1,
        filter:contactAO.metadata.filter??null,limitations:contactAO.metadata.limitations??[] };
      if (stale && !allowStaleAO) throw new Error(`Stale contact AO: baked ${contact.bakedGeometrySHA256}, current ${contact.geometrySHA256}. Re-export and bake the frozen geometry; --allow-stale-ao 1 is an explicit inspection override.`);
      for (const [atlas,maps] of atlases) {
        const source = new Image(); source.src = contactAO.images[atlas]; await source.decode();
        const mask = document.createElement('canvas'); mask.width=maps.orm.width;mask.height=maps.orm.height;
        const maskContext=mask.getContext('2d',{willReadFrequently:true});
        maskContext.drawImage(source,0,0,mask.width,mask.height);
        const ao=maskContext.getImageData(0,0,mask.width,mask.height).data;
        const ctx=maps.orm.getContext('2d',{willReadFrequently:true});
        const pixels=ctx.getImageData(0,0,maps.orm.width,maps.orm.height);
        const strength=Math.max(0,Math.min(1,contact.strength));
        // Only red changes. Pack before downsampling so lower qualities keep
        // the same filtering as the authored roughness and metallic data.
        for(let i=0;i<pixels.data.length;i+=4)
          pixels.data[i]=Math.round(pixels.data[i]*(1-strength+strength*ao[i]/255));
        ctx.putImageData(pixels,0,0);
      }
    }
    const images = [];
    for (const [atlas, maps] of atlases) for (const [quality, scale] of [['high', 1], ['medium', .5], ['low', .25]]) {
      for (const [kind, source] of Object.entries(maps)) {
        const target = document.createElement('canvas');
        target.width = Math.round(source.width * scale); target.height = Math.round(source.height * scale);
        const ctx = target.getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, target.width, target.height);
        images.push({ name: `${atlas}-${quality}-${kind}.png`, atlas, kind, quality, width: target.width, height: target.height,
          data: target.toDataURL('image/png').split(',')[1] });
      }
    }
    return {images,contactAO:contact};
  }, {contactAO,allowStaleAO});
  await fs.mkdir(directory, { recursive: true });
  const manifest = { schema: 1, sources: ['src/aircraft/authoring/f22-body-paint.js', 'src/aircraft/authoring/f22-lifting-paint.js'], contactAO:output.contactAO, maps: [] };
  for (const { data, ...entry } of output.images) {
    const bytes = Buffer.from(data, 'base64');
    await fs.writeFile(path.join(directory, entry.name), bytes);
    manifest.maps.push({ ...entry, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ directory, images: manifest.maps.length, bytes: manifest.maps.reduce((sum, entry) => sum + entry.bytes, 0), contactAO:manifest.contactAO }));
} finally {
  const timeout = setTimeout(() => browserServer?.kill().catch(() => {}), 2000);
  await browser?.close().catch(() => {});
  await browserServer?.close().catch(() => {});
  clearTimeout(timeout);
  await new Promise(resolve => server.close(resolve));
}
