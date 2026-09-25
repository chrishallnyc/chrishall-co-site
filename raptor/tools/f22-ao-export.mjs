#!/usr/bin/env node
// Export the actual procedural aircraft with world-space positions and its
// authored UVs. No production asset is written; the output is a frozen bake
// input and an overlap report, not an implicit approval to bake final maps.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(args.out ?? join(root, '../.context/aircraft-rebuild/ao-tools/probe'));
await mkdir(out, { recursive: true });
const require = createRequire(import.meta.url);
const candidates = [args.playwright ?? process.env.AIRCRAFT_QA_PLAYWRIGHT, 'playwright', 'playwright-core'].filter(Boolean);
const cache = join(homedir(), '.bun/install/cache');
if (existsSync(cache)) for (const name of (await readdir(cache)).sort().reverse())
  if (name.startsWith('playwright-core@')) candidates.push(join(cache, name));
let chromium;
for (const name of candidates) { try { ({ chromium } = require(name)); if (chromium) break; } catch {} }
if (!chromium) throw new Error('Set --playwright or AIRCRAFT_QA_PLAYWRIGHT to an installed package; nothing is installed automatically.');
const executablePath = [args.browser ?? process.env.AIRCRAFT_QA_BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', chromium.executablePath()].filter(Boolean).find(existsSync);
if (!executablePath) throw new Error('Set --browser or AIRCRAFT_QA_BROWSER to an installed Chromium browser.');
const source = new Map();
async function freeze(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await freeze(join(directory, entry.name), `${prefix}/${entry.name}`);
    else if (/\.(js|json)$/.test(entry.name)) source.set(`${prefix}/${entry.name}`, await readFile(join(directory, entry.name)));
  }
}
await freeze(join(root, 'src'), '/src');
if (args['source-overlay']) await freeze(resolve(args['source-overlay']), '/src');
for (const [url, bytes] of source) {
  const file = join(out, 'source', url.slice(5)); await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes);
}
const sourceSHA256 = createHash('sha256').update([...source].sort().map(([url, b]) => url + createHash('sha256').update(b).digest('hex')).join('\n')).digest('hex');
const server = createServer(async (request, response) => {
  try {
    const url = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, `.${url}`);
    if (!file.startsWith(root + sep)) throw new Error('Path outside root');
    const bytes = source.get(url) ?? await readFile(file);
    response.writeHead(200, { 'Content-Type': ({ '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.html':'text/html' })[extname(file)] ?? 'application/octet-stream' });
    response.end(bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser, launch;
try {
  launch = await chromium.launchServer({ executablePath, headless: true });
  browser = await chromium.connect(launch.wsEndpoint());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/f22-ao.html`);
  const data = await page.evaluate(async () => (await import('/tools/f22-ao-scene.js')).exportF22ForAO());
  if (errors.length) throw new Error(errors.join('\n'));
  data.sourceSHA256 = sourceSHA256;
  data.exportedAt = new Date().toISOString();
  await writeFile(join(out,'aircraft.json'),JSON.stringify(data));
  const summary = { sourceSHA256, geometrySHA256:data.geometrySHA256, meshes:data.meshes.length, triangles:data.meshes.reduce((n,m)=>n+m.faces.length,0),
    receiverTriangles:Object.fromEntries(['body','lifting'].map(atlas=>[atlas,data.meshes.filter(m=>m.atlas===atlas).reduce((n,m)=>n+m.receivers.filter(Boolean).length,0)])),
    excludedMeshes:data.exclusions.length, file:join(out,'aircraft.json') };
  await writeFile(join(out,'export.json'),JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary));
} finally {
  const timeout = setTimeout(() => launch?.kill().catch(() => {}), 2000);
  await browser?.close().catch(() => {});
  await launch?.close().catch(() => {});
  clearTimeout(timeout);
  await new Promise(done=>server.close(done));
}
