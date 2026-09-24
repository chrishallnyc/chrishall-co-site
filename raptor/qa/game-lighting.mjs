#!/usr/bin/env node
// Actual application capture: frozen modules, installed browser, real mission.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) options[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(options.out ?? join(root, '../.context/aircraft-rebuild/validation/game-lighting'));
await mkdir(out, { recursive: true });
const require = createRequire(import.meta.url), candidates = [options.playwright ?? process.env.AIRCRAFT_QA_PLAYWRIGHT, 'playwright', 'playwright-core'].filter(Boolean);
const cache = join(homedir(), '.bun/install/cache');
if (existsSync(cache)) for (const name of (await readdir(cache)).sort().reverse()) if (/^playwright-core@/.test(name)) candidates.push(join(cache, name));
let playwright, packagePath;
for (const path of candidates) { try { playwright = require(path); packagePath = require.resolve(path); break; } catch {} }
if (!playwright?.chromium) throw new Error('Set AIRCRAFT_QA_PLAYWRIGHT or --playwright to an installed Playwright package. Nothing was installed.');
const executablePath = [options.browser ?? process.env.AIRCRAFT_QA_BROWSER, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', playwright.chromium.executablePath()].filter(Boolean).find(existsSync);
if (!executablePath) throw new Error('Set AIRCRAFT_QA_BROWSER or --browser. Nothing was downloaded.');
const snapshot = new Map();
async function freeze(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await freeze(join(directory, entry.name), `${prefix}/${entry.name}`);
    else if (/\.(js|json)$/.test(entry.name)) snapshot.set(`${prefix}/${entry.name}`, await readFile(join(directory, entry.name)));
  }
}
await freeze(join(root, 'src'), '/src');
if (options['source-overlay']) await freeze(resolve(options['source-overlay']), '/src');
// Diagnostic-only import prefix: observe even the first game draw, before
// readiness is exposed. The saved source and its hash include this prefix.
if (options['trace-gl'] === '1') snapshot.set('/src/main.js', Buffer.from(`
import * as QA_THREE from 'three';
const qaBeforeRender = QA_THREE.Mesh.prototype.onBeforeRender;
QA_THREE.Mesh.prototype.onBeforeRender = function(...args) {
  window.__QA_DRAW_MESH__ = this;
  window.__QA_DRAW_OBJECT__ = {name:this.name,id:this.id,geometry:this.geometry.id,
    vertices:this.geometry.attributes.position?.count,indices:this.geometry.index?.count,
    material:this.material.name || this.material.type,parent:this.parent?.name,
    position:this.position.toArray()};
  return qaBeforeRender.apply(this,args);
};
` + snapshot.get('/src/main.js').toString()));
for (const [url, data] of snapshot) { const file = join(out, 'source', url.slice(5)); await mkdir(dirname(file), { recursive: true }); await writeFile(file, data); }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.css': 'text/css', '.bin': 'application/octet-stream' };
const server = createServer(async (request, response) => {
  try {
    let url = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (url.endsWith('/')) url += 'index.html';
    const file = resolve(root, `.${url}`);
    if (!file.startsWith(root + sep)) throw new Error('Path outside root');
    const bytes = snapshot.get(url) ?? await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const launch = await playwright.chromium.launchServer({ executablePath, headless: true, args: ['--ignore-gpu-blocklist'] });
const browser = await playwright.chromium.connect(launch.wsEndpoint());
const results = { started: new Date().toISOString(), browser: browser.version(), executablePath, packagePath,
  sourceSHA256: createHash('sha256').update([...snapshot].sort().map(([url, b]) => url + createHash('sha256').update(b).digest('hex')).join('\n')).digest('hex'), cases: [] };
const backends = (options.backend ?? 'both') === 'both' ? ['webgpu', 'webgl'] : [options.backend];
const scenarios = (options.scenarios ?? 'clear,hazy,sunset').split(',');
const tier = options.tier ?? 'HIGH';
try {
  for (const backend of backends) for (const scenario of scenarios) {
    const key = `${backend}-${tier}-${scenario}`, directory = join(out, key); await mkdir(directory, { recursive: true });
    const record = { key, errors: [], warnings: [], failedRequests: [], checks: [] }; results.cases.push(record);
    const context = await browser.newContext({ viewport: { width: Number(options.width ?? 1440), height: Number(options.height ?? 900) }, deviceScaleFactor: 1 });
    await context.addInitScript(tier => localStorage.setItem('raptor:quality:v1', tier), tier);
    if (options['trace-gl'] === '1') await context.addInitScript(() => {
      const reported = new Set();
      for (const name of ['drawElements', 'drawElementsInstanced']) {
        const original = WebGL2RenderingContext.prototype[name];
        WebGL2RenderingContext.prototype[name] = function (...args) {
          if (!this.getParameter(this.ELEMENT_ARRAY_BUFFER_BINDING)) {
            const backend = window.__RAPTOR?.rendering?.renderer.backend;
            const index = window.__QA_DRAW_MESH__?.geometry.index;
            const object = JSON.stringify({ ...window.__QA_DRAW_OBJECT__,
              indexExists: !!(index && backend?.get(index)?.bufferGPU),
              cachedIndexExists: !!backend?.state?.currentIndex,
              vaoMatchesCache: this.getParameter(this.VERTEX_ARRAY_BINDING) === backend?.state?.currentVAO });
            if (!reported.has(object)) {
              reported.add(object);
              console.error(`QA: ${name} without an element buffer ${object}\n${new Error().stack}`);
            }
          }
          return original.apply(this, args);
        };
      }
    });
    const page = await context.newPage();
    page.on('pageerror', error => record.errors.push(error.stack ?? error.message));
    page.on('console', m => { if (m.type() === 'error') record.errors.push(m.text()); else if (m.type() === 'warning') record.warnings.push(m.text()); });
    page.on('requestfailed', r => record.failedRequests.push({ url: r.url(), error: r.failure()?.errorText }));
    page.on('response', r => { if (r.status() >= 400) record.failedRequests.push({ url: r.url(), status: r.status() }); });
    const params = new URLSearchParams({ front: scenario === 'hazy' ? 'VALDEZ' : 'NELLIS', tod: scenario === 'sunset' ? '18.8' : '12', hud: '0', chrome: '0', noaaa: '1', autoexp: '0' });
    if (scenario === 'clear') params.set('mission', 'nellis-cap-01'); else params.set('nomatch', '1');
    if (backend === 'webgl') params.set('gl', '1');
    if (options.terrain === '0') params.set('noterrain', '1');
    if (options.shadows === '0') params.set('aircraftShadows', '0');
    if (options.air === '0') params.set('aircraftAir', '0');
    if (options.post === '0') params.set('post', '0');
    if (options['reverse-depth']) params.set('reverseDepth', options['reverse-depth']);
    if (options.ao) params.set('ao', options.ao);
    record.url = `${base}/?${params}`;
    const start = Date.now();
    try {
      console.log(JSON.stringify({ case: key, phase: 'boot', url: record.url }));
      await page.goto(record.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.bringToFront();
      await page.waitForFunction(() => window.__RAPTOR?.ready || window.__RAPTOR?.failure, {}, { timeout: Number(options.timeout ?? 180000) });
      if (await page.evaluate(() => !!window.__RAPTOR?.failure)) throw new Error(await page.evaluate(() => String(window.__RAPTOR.failure)));
      await page.locator('#veil').waitFor({ state: 'detached' });
      if (await page.evaluate(() => !!window.__RAPTOR?.cockpit?.paused)) await page.locator('.pause-dialog[open] [data-resume]').click();
      await page.waitForFunction(() => !window.__RAPTOR?.cockpit?.paused);
      record.bootMs = Date.now() - start;
      await page.evaluate(scenario => {
        const s = window.__RAPTOR;
        s.setTimescale(0);
        if (scenario === 'landing') {
          const x = -3000, y = -8700, groundH = s.terrain?.heightAt(x, y) ?? 0;
          s.player.fm.initGround({ x, y, groundH, headingRad: Math.PI / 4 });
          s.player._prev.set(s.player.fm.state);
        } else s.player.debugCommand({ pos: { x: 0, y: -6000, alt: 3600, headingDeg: 45, speed: 200 } });
      }, scenario);
      // Wait on actual completed game frames, not a fixed startup sleep.
      await page.evaluate(() => new Promise(done => { let n = 0; function frame() { if (++n === 12) done(); else requestAnimationFrame(frame); } requestAnimationFrame(frame); }));
      await page.screenshot({ path: join(directory, 'chase.png') });
      record.before = await page.evaluate(() => {
        const s = window.__RAPTOR, r = s.rendering; let meshes = 0, materials = new Set(), opaque = 0, casting = 0;
        r.world.jet.traverseVisible(m => { if (m.isMesh) { meshes++; const mat = m.material; materials.add(mat); if (!m.userData.aircraftEffect && (mat.fog !== false || mat.userData.aircraftAerial) && !mat.transparent && !(mat.transmission > 0)) { opaque++; casting += Number(m.castShadow); } } });
        const sunDirection = s.atmosphere.sun.position.clone().sub(s.atmosphere.sun.target.position).normalize();
        const wheelClearances = {};
        for (const name of ['gearNose', 'gearL', 'gearR']) {
          const part = r.world.f22parts[name], gear = part.userData.landingGear;
          const point = part.position.clone().fromArray(gear.wheelCenter); part.localToWorld(point);
          wheelClearances[name] = point.y - gear.wheelRadius - (s.terrain?.heightAt(point.x, point.z) ?? 0);
        }
        const materialProperties = ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','opacity','roughness','metalness','transmission','ior','clearcoat'];
        const materialFailures = [];
        for (const binding of r.aircraftLighting.bindings) {
          const originals = Array.isArray(binding.source) ? binding.source : [binding.source];
          const copies = Array.isArray(binding.assigned) ? binding.assigned : [binding.assigned];
          for (let i = 0; i < originals.length; i++) for (const key of materialProperties)
            if (originals[i][key] !== copies[i][key]) materialFailures.push(`${originals[i].name}:${key}`);
        }
        const direction = r.camera.getWorldDirection(r.camera.position.clone());
        const hudDepth = [[r.camera.near * .5, false], [r.camera.near * 2, true], [r.camera.far * .9, true], [r.camera.far * 1.1, false], [-100, false]].map(([distance, visible]) => {
          const p = r.camera.position.clone().addScaledVector(direction, distance).project(r.camera);
          const worldPoint = r.camera.position.clone().addScaledVector(direction, distance);
          return { distance, depth: p.z, expected: visible, actual: r.projectedDepthVisible(p.z, r.camera),
            terrainFrustum: s.terrain?._frustum.containsPoint(worldPoint) ?? null };
        });
        return { ready: s.ready, failure: s.failure, backend: s.backend, tier: s.tier, hash: s.hash(), simulationTime: s.sim.time,
          mission: !!s.script, hillaire: s.hillaire, info: { render: { ...r.renderer.info.render }, memory: { ...r.renderer.info.memory } },
          lighting: { ...r.aircraftLighting.stats }, meshCount: meshes, materialCount: materials.size, opaque, casting,
          lod: r.world.f22.userData.aircraft.lod?.level, environment: !!r.scene.environment, pmremReady: s.atmosphere.envReady,
          wheelClearances, materialFailures, sunDirectionError: sunDirection.distanceTo(s.atmosphere.sky.uSunDir.value),
          reverseDepth: r.renderer.reversedDepthBuffer,
          hudDepth,
          adapted: [...materials].filter(m => m.userData.aircraftAerial === 'hillaire').length };
      });
      // Park the real application camera for a closer material/junction view.
      await page.evaluate(() => {
        const r = window.__RAPTOR.rendering, center = r.world.jet.position.clone();
        r.world.fixYaw = 0;
        r.world.renderParkedCamera = camera => { camera.position.set(center.x + 18, center.y + 9, center.z - 19); camera.up.set(0, 1, 0); camera.lookAt(center); };
      });
      await page.evaluate(() => new Promise(done => { let n = 0; function frame() { if (++n === 12) done(); else requestAnimationFrame(frame); } requestAnimationFrame(frame); }));
      await page.screenshot({ path: join(directory, 'close.png') });
      record.timing = await page.evaluate(frames => new Promise(done => {
        const intervals = [], s = window.__RAPTOR; let previous = performance.now();
        function frame(now) { intervals.push(now - previous); previous = now; if (intervals.length < frames) requestAnimationFrame(frame);
          else { intervals.sort((a, b) => a - b); done({ frames, p50: intervals[Math.floor(frames * .5)], p95: intervals[Math.floor(frames * .95)], p99: intervals[Math.min(frames - 1, Math.floor(frames * .99))], hash: s.hash(), info: { ...s.rendering.renderer.info.render } }); } }
        requestAnimationFrame(frame);
      }), Number(options.frames ?? 90));
      for (const distance of (options.distances ?? '2000,6000').split(',').map(Number).filter(d => d > 0)) {
        await page.evaluate(distance => {
          const r = window.__RAPTOR.rendering, center = r.world.jet.position.clone();
          r.world.renderParkedCamera = camera => {
            camera.fov = Math.atan(18 / distance) * 360 / Math.PI;
            camera.updateProjectionMatrix();
            camera.position.set(center.x + distance * .72, center.y + distance * .18, center.z - distance * Math.sqrt(1 - .72 ** 2 - .18 ** 2));
            camera.up.set(0, 1, 0); camera.lookAt(center);
          };
        }, distance);
        await page.evaluate(() => new Promise(done => { let n = 0; function frame() { if (++n === 12) done(); else requestAnimationFrame(frame); } requestAnimationFrame(frame); }));
        await page.screenshot({ path: join(directory, `distance-${distance}m.png`) });
      }
      if (options['quality-cycle'] === '1') {
        record.qualityCycle = await page.evaluate(async () => {
          const { TIERS } = await import('/src/engine/quality.js');
          const s = window.__RAPTOR, r = s.rendering, samples = [];
          for (const tier of ['LOW', 'MED', 'HIGH', 'LOW', 'HIGH']) {
            s.tier = tier; r.aircraftLighting.setQuality(TIERS[tier]);
            await new Promise(done => { let n = 0; function frame() { if (++n === 12) done(); else requestAnimationFrame(frame); } requestAnimationFrame(frame); });
            samples.push({ tier, lod: r.world.f22.userData.aircraft.lod.level, shadows: r.aircraftLighting.shadows,
              shadowUpdates: s.atmosphere.sun.shadow.autoUpdate,
              shadowSize: r.aircraftLighting.stats.shadowSize,
              allocatedShadowSize: r.aircraftLighting.stats.allocatedShadowSize,
              requestedShadowSize: r.aircraftLighting.stats.requestedShadowSize,
              materials: r.aircraftLighting.stats.materials,
              memory: { ...r.renderer.info.memory }, hash: s.hash() });
          }
          return samples;
        });
        record.checks.push({ id: 'quality-cycle-lod-shadow-cap', pass: record.qualityCycle.every(s => s.lod === ({ LOW: 'low', MED: 'medium', HIGH: 'high' })[s.tier] && s.shadows === (s.tier !== 'LOW')) },
          { id: 'quality-cycle-shadow-target-stable', pass: record.qualityCycle.every(s => s.allocatedShadowSize === record.before.lighting.allocatedShadowSize && s.shadowUpdates === s.shadows && s.shadowSize === (s.shadows ? s.allocatedShadowSize : 0)) },
          { id: 'quality-cycle-material-cache-stable', pass: record.qualityCycle.every(s => s.materials === record.qualityCycle[0].materials) },
          { id: 'quality-cycle-sim-unchanged', pass: record.qualityCycle.every(s => s.hash === record.before.hash) });
      }
      record.checks.push({ id: 'requested-backend', pass: record.before.backend === backend },
        { id: 'requested-tier', pass: record.before.tier === tier }, { id: 'ready', pass: record.before.ready && !record.before.failure },
        { id: 'frozen-sim-unchanged', pass: record.before.hash === record.timing.hash },
        { id: 'dynamic-pbr-environment', pass: record.before.environment && record.before.pmremReady },
        { id: 'material-properties-preserved', pass: record.before.materialFailures.length === 0 },
        { id: 'sun-direction-preserved', pass: record.before.sunDirectionError < 1e-8 },
        { id: 'hud-depth-clipping', pass: record.before.hudDepth.every(p => p.actual === p.expected) },
        { id: 'terrain-projection-clipping', pass: record.before.hudDepth.every(p => p.terrainFrustum === null || p.terrainFrustum === p.expected) },
        { id: 'opaque-shadow-casters', pass: options.shadows === '0' || tier === 'LOW' || record.before.casting === record.before.opaque },
        { id: 'aerial-materials', pass: options.air === '0' || !record.before.hillaire || record.before.adapted > 0 });
      if (scenario === 'clear') record.checks.push({ id: 'actual-mission-loaded', pass: record.before.mission });
    } catch (error) { record.failure = error.stack; }
    record.warnings = [...new Set(record.warnings)];
    record.checks.push({ id: 'no-backend-validation-warnings',
      pass: !record.warnings.some(warning => /GL_INVALID_|GPUValidationError|CONTEXT_LOST|DeviceLost|device lost/i.test(warning)) });
    record.pass = !record.failure && !record.errors.length && !record.failedRequests.length && record.checks.every(c => c.pass);
    await writeFile(join(directory, 'result.json'), JSON.stringify(record, null, 2));
    console.log(JSON.stringify({ case: key, pass: record.pass, bootMs: record.bootMs, checks: record.checks.filter(c => !c.pass), errors: record.errors.slice(0, 3), failure: record.failure?.split('\n')[0], timing: record.timing }));
    await context.close();
  }
} finally {
  results.pass = results.cases.length > 0 && results.cases.every(c => c.pass);
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2));
  const force = setTimeout(() => launch.kill().catch(() => {}), 2000);
  await browser.close().catch(() => {}); await launch.close().catch(() => {}); clearTimeout(force);
  await new Promise(done => server.close(done));
}
if (!results.pass) process.exitCode = 1;
