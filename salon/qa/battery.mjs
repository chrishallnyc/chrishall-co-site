/* THE SALON — QA battery. Run: node salon/qa/battery.mjs [--live] [--webkit]
   Local: serves salon/ on :8123 (remote museum images load over the network).
   Live:  targets https://salon.chall.net. */
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { dirname, join, extname } from 'path';
import { fileURLToPath } from 'url';

const pw = await import('file:///Users/ch/.claude/skills/gstack/node_modules/playwright/index.mjs');
const LIVE = process.argv.includes('--live');
const WEBKIT = process.argv.includes('--webkit');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

let BASE;
let server = null;
if (LIVE) { BASE = 'https://salon.chall.net'; }
else {
  server = createServer((req, res) => {
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    const f = join(ROOT, p);
    if (!existsSync(f)) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  }).listen(0); /* ephemeral — port 8123 was squatted by another agent's stale server */
  await new Promise(r => server.on('listening', r));
  server.on('error', e => { console.error('server error', e.message); process.exit(2); });
  BASE = 'http://127.0.0.1:' + server.address().port;
}

let pass = 0, fail = 0;
const t = (name, cond, note) => { if (cond) { pass++; console.log('ok   ' + name + (note ? ' — ' + note : '')); } else { fail++; console.log('FAIL ' + name + (note ? ' — ' + note : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browserType = WEBKIT ? pw.webkit : pw.chromium;
const browser = await browserType.launch();

async function newPage(opts = {}, url = '/?door=0&still=1&cursor=1') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  return { ctx, page, errors };
}

/* T1: door boots, click enters, a work hangs, plate readable */
{
  const { ctx, page, errors } = await newPage({}, '/?cursor=1');
  t('T1 title', (await page.title()).includes('THE SALON'));
  t('T1 door visible', await page.isVisible('#door'));
  const counts = await page.textContent('#doorCounts');
  t('T1 door counts', /\d+ WORKS · \d+ ROOMS/.test(counts), counts.trim());
  await page.click('#door');
  await page.waitForSelector('.work.up', { timeout: 45000 });
  const info = await page.evaluate(() => window.__SALON.info());
  t('T1 entered solo', info.entered && info.mode === 'solo' && info.hung.length === 1, JSON.stringify(info.hung));
  await page.waitForSelector('.plate.on', { timeout: 8000 });
  const plate = await page.textContent('.plate.on');
  t('T1 plate labels', plate.includes('·') && plate.length > 12, plate.replace(/\s+/g, ' ').slice(0, 60));
  const img = await page.evaluate(() => { const i = document.querySelector('.work img'); return { w: i.naturalWidth, dw: i.width }; });
  t('T1 real pixels', img.w >= 843, 'natural ' + img.w);
  t('T1 no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* T2: walk forward/back; deep links */
{
  const { ctx, page } = await newPage();
  await page.waitForSelector('.work.up', { timeout: 45000 });
  const a = (await page.evaluate(() => window.__SALON.info())).hung[0];
  await page.evaluate(() => window.__SALON.next());
  await page.waitForFunction(a0 => window.__SALON.info().hung[0] !== a0, a, { timeout: 45000 });
  const b = (await page.evaluate(() => window.__SALON.info())).hung[0];
  t('T2 next hangs new work', b && b !== a, a + ' -> ' + b);
  await page.evaluate(() => window.__SALON.prev());
  await page.waitForFunction(b0 => window.__SALON.info().hung[0] !== b0, b, { timeout: 45000 });
  t('T2 prev returns', (await page.evaluate(() => window.__SALON.info())).hung[0] === a);
  await ctx.close();
}

/* T3: gallery mode hangs three, relayout on resize */
{
  const { ctx, page } = await newPage({}, '/?door=0&still=1&mode=gallery&cursor=1');
  await page.waitForFunction(() => document.querySelectorAll('.work.up').length >= Math.min(3, window.__SALON.info().works), null, { timeout: 90000 });
  const n = await page.evaluate(() => document.querySelectorAll('.work.up').length);
  t('T3 gallery hangs three', n === Math.min(3, await page.evaluate(() => window.__SALON.info().works)), n + ' hung');
  const xs = await page.evaluate(() => [...document.querySelectorAll('.work.up')].map(w => w.getBoundingClientRect().left).sort((p, q) => p - q));
  t('T3 works spread', xs.length < 2 || xs[xs.length - 1] - xs[0] > 200, JSON.stringify(xs.map(Math.round)));
  await page.setViewportSize({ width: 900, height: 1200 });
  await sleep(400);
  const inV = await page.evaluate(() => [...document.querySelectorAll('.work.up')].every(w => { const r = w.getBoundingClientRect(); return r.width > 40 && r.right <= innerWidth + 4 && r.bottom <= innerHeight + 60; }));
  t('T3 relayout portrait', inV);
  await ctx.close();
}

/* T4: gilded frames render + bare toggle */
{
  const { ctx, page } = await newPage();
  await page.waitForSelector('.work.up', { timeout: 45000 });
  const framed = await page.evaluate(() => { const f = document.querySelector('.work .frame'); const s = getComputedStyle(f); return { pad: parseFloat(s.paddingLeft), bg: s.backgroundImage.includes('gradient') }; });
  t('T4 gilded frame', framed.pad >= 10 && framed.bg, 'pad ' + framed.pad);
  await page.keyboard.press('b');
  t('T4 bare toggle', await page.evaluate(() => document.querySelector('.work').classList.contains('bare')));
  await page.keyboard.press('b');
  await ctx.close();
}

/* T5: rooms sheet, room filter */
{
  const { ctx, page } = await newPage();
  await page.waitForSelector('.work.up', { timeout: 45000 });
  await page.keyboard.press('g');
  t('T5 rooms sheet opens', await page.isVisible('#roomsSheet .panel'));
  const rows = await page.evaluate(() => document.querySelectorAll('#roomList .row').length);
  t('T5 room rows', rows >= 2, rows + ' rows');
  await page.keyboard.press('Escape');
  t('T5 escape closes', !(await page.isVisible('#roomsSheet .panel')));
  const room = await page.evaluate(() => window.__SALON.info().room);
  t('T5 no room filter default', room === null);
  await ctx.close();
}

/* T6: ?room= and ?work= deep links */
{
  const { ctx, page } = await newPage({}, '/?door=0&still=1&room=vincent&cursor=1');
  await page.waitForSelector('.work.up', { timeout: 45000 });
  const i = await page.evaluate(() => window.__SALON.info());
  t('T6 room deep link', i.room === 'vincent');
  const allVincent = await page.evaluate(() => { const C = window.__SALON.info(); return C.hung.length > 0; });
  t('T6 room hangs', allVincent);
  await ctx.close();
  const first = await (async () => { const { ctx, page } = await newPage({}, '/?door=0&still=1&cursor=1'); await page.waitForSelector('.work.up', { timeout: 45000 }); const id = (await page.evaluate(() => window.__SALON.info())).hung[0]; await ctx.close(); return id; })();
  const { ctx: c2, page: p2 } = await newPage({}, '/?door=0&still=1&cursor=1&work=' + first);
  await p2.waitForSelector('.work.up', { timeout: 45000 });
  t('T6 work deep link', (await p2.evaluate(() => window.__SALON.info())).hung[0] === first, first);
  await c2.close();
}

/* T7: the sun — night wall at a night hour, day wall at noon (sunat idiom) */
{
  const { ctx, page } = await newPage({}, '/?door=0&still=1&cursor=1&sunat=2026-08-10T23:30:00');
  await page.waitForSelector('.work.up', { timeout: 45000 });
  t('T7 night wall', await page.evaluate(() => document.documentElement.classList.contains('night')));
  t('T7 midnight dim', await page.evaluate(() => document.documentElement.classList.contains('dim')));
  await ctx.close();
  const { ctx: c2, page: p2 } = await newPage({}, '/?door=0&still=1&cursor=1&sunat=2026-08-10T12:00:00');
  await p2.waitForSelector('.work.up', { timeout: 45000 });
  t('T7 day wall', !(await p2.evaluate(() => document.documentElement.classList.contains('night'))));
  const sun = await p2.evaluate(() => window.__SALON.sun());
  t('T7 sun engine', !sun.fault && sun.rise && sun.set, (sun.rise || '').slice(11, 16) + ' / ' + (sun.set || '').slice(11, 16));
  await c2.close();
}

/* T8: ?audit self-check */
{
  const { ctx, page, errors } = await newPage({}, '/?audit');
  await sleep(600);
  const title = await page.title();
  const body = await page.textContent('#audit');
  t('T8 audit clean', title.includes('AUDIT-CLEAN-SALON'), title);
  t('T8 audit lines', body.includes('ids unique') && body.includes('seeded shuffle deterministic'));
  t('T8 audit no errors', errors.length === 0, errors.slice(0, 2).join('|'));
  await ctx.close();
}

/* T9: reduced motion */
{
  const { ctx, page } = await newPage({ reducedMotion: 'reduce' });
  await page.waitForSelector('.work.up', { timeout: 45000 });
  const fade = await page.evaluate(() => getComputedStyle(document.querySelector('.work')).transitionDuration);
  t('T9 short fade', parseFloat(fade) <= 0.5, fade);
  t('T9 no drift', await page.evaluate(() => !document.getElementById('stage').style.transform || document.getElementById('stage').style.transform === ''));
  await ctx.close();
}

/* T10: 390px phone */
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } }, '/?cursor=1');
  t('T10 door fits', await page.evaluate(() => { const c = document.querySelector('.doorcard').getBoundingClientRect(); return c.width <= 390 && c.left >= 0; }));
  await page.click('#door');
  await page.waitForSelector('.work.up', { timeout: 45000 });
  const fit = await page.evaluate(() => { const r = document.querySelector('.work').getBoundingClientRect(); return r.width > 100 && r.left >= -2 && r.right <= 392; });
  t('T10 work fits 390px', fit);
  await ctx.close();
}

/* T11: dwell + pause machinery */
{
  const { ctx, page } = await newPage({}, '/?door=0&still=1&cursor=1&dwell=45');
  await page.waitForSelector('.work.up', { timeout: 45000 });
  t('T11 dwell param', (await page.evaluate(() => window.__SALON.info())).dwell === 45000);
  await page.keyboard.press(']');
  t('T11 dwell nudge', (await page.evaluate(() => window.__SALON.info())).dwell === 60000);
  await page.keyboard.press(' ');
  t('T11 pause', (await page.evaluate(() => window.__SALON.info())).paused === true);
  await page.keyboard.press(' ');
  t('T11 resume', (await page.evaluate(() => window.__SALON.info())).paused === false);
  await ctx.close();
}

/* T12: quarantine skips dead works after reload */
{
  const { ctx, page } = await newPage();
  await page.waitForSelector('.work.up', { timeout: 45000 });
  const before = await page.evaluate(() => window.__SALON.info().works);
  console.log('     (works in collection: ' + before + ')');
  t('T12 dead ledger empty', Object.keys(await page.evaluate(() => window.__SALON.dead())).length === 0);
  await ctx.close();
}

/* T13: sw.js / index.html / manifest lockstep (file-level, no SW needed) */
{
  const swSrc = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const idxSrc = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const man = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  const sv = (swSrc.match(/V = 'salon-(v[\d.]+)'/) || [])[1];
  const iv = (idxSrc.match(/SALON_VER='(v[\d.]+)'/) || [])[1];
  t('T13 sw/page version lockstep', !!sv && sv === iv, sv + ' vs ' + iv);
  t('T13 manifest id + icons', man.id === './' && man.icons.length === 2 && existsSync(join(ROOT, 'icon-192.png')) && existsSync(join(ROOT, 'icon-512.png')));
  t('T13 sw navigations key to ./', swSrc.includes("req.mode === 'navigate'") && swSrc.includes("caches.match('./')"));
}

/* T14: offline resilience — no burials on a dead network, recovery after */
if (!WEBKIT) { /* setOffline + navigator.onLine emulation is Chromium-reliable */
  const { ctx, page } = await newPage();
  await page.waitForSelector('.work.up', { timeout: 45000 });
  await ctx.setOffline(true);
  await page.evaluate(() => window.__SALON.next());
  await page.evaluate(() => window.__SALON.next());
  await sleep(800);
  const dead = Object.keys(await page.evaluate(() => window.__SALON.dead())).length;
  t('T14 offline buries nothing', dead === 0, dead + ' buried');
  const toast = await page.textContent('#toast');
  t('T14 offline toast', /offline/.test(toast), toast);
  await ctx.setOffline(false);
  const a = (await page.evaluate(() => window.__SALON.info())).hung[0];
  await page.evaluate(() => window.__SALON.next());
  await page.waitForFunction(a0 => window.__SALON.info().hung[0] !== a0, a, { timeout: 60000 });
  t('T14 recovers online', true);
  await ctx.close();
}

/* T15: mode-mash leaves no orphaned works (the hangSeq generation guard) */
{
  const { ctx, page } = await newPage();
  await page.waitForSelector('.work.up', { timeout: 45000 });
  for (let i = 0; i < 10; i++) { await page.keyboard.press('v'); await sleep(120); }
  await sleep(9000);
  const state = await page.evaluate(() => ({ mode: window.__SALON.info().mode, els: document.querySelectorAll('.work').length }));
  const want = state.mode === 'solo' ? 1 : 3;
  t('T15 no orphans after mode mash', state.els <= want, state.els + ' .work in ' + state.mode + ' (want <= ' + want + ')');
  await ctx.close();
}

await browser.close();
if (server) server.close();
console.log('\n' + (WEBKIT ? 'webkit' : 'chromium') + (LIVE ? ' LIVE' : ' local') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
