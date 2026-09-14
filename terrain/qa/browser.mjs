// Real-browser integration checks. Run with an installed Playwright module:
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node terrain/qa/browser.mjs
// Optional TERRAIN_BROWSER_CHANNEL=chrome uses an installed Chrome.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const playwright = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/geo+json','.woff2':'font/woff2','.png':'image/png','.md':'text/plain'};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = resolve(root, `.${pathname}`);
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    response.writeHead(200, {'Content-Type': mime[extname(file)] || 'application/octet-stream'});
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/terrain/`;
const browser = await playwright.chromium.launch({headless: true, ...(process.env.TERRAIN_BROWSER_CHANNEL ? {channel: process.env.TERRAIN_BROWSER_CHANNEL} : {}), args: ['--enable-webgl', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log(`ok ${checks} · ${name}`); }
const info = () => page.evaluate(() => window.__TERRAIN.info());
async function boot(query = '') {
  await page.goto(base + query, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => window.__TERRAIN?.info().ready, null, {timeout: 45000});
}
async function search(value, result) {
  await page.click('#open-search');
  await page.fill('#place-search', value);
  await page.locator('.search-result').filter({hasText: result}).first().click();
}
try {
  await boot();
  check('real map starts with California and 50-state data', (await info()).code === 'CA' && (await info()).counts.states === 50);
  check('cities and features have real map markers', await page.locator('.terrain-marker--city').count() >= 5 && await page.locator('.terrain-marker--feature').count() >= 2);
  await page.keyboard.press('/');
  check('search opens with all 50 states', await page.locator('#search-dialog').isVisible() && await page.locator('.state-grid button').count() === 50);
  check('search dialog has an accessible name', (await page.locator('#search-dialog').getAttribute('aria-labelledby')) === 'search-heading');
  await page.keyboard.press('Escape');

  await page.click('[data-layer="history"]');
  await page.locator('[data-theme="gold-rush"]').focus();
  await page.keyboard.press('Enter');
  check('Gold Rush filter yields five sites', (await info()).historyIds.length === 5);
  check('theme filter retains keyboard focus', await page.evaluate(() => document.activeElement?.dataset.theme === 'gold-rush'));
  await page.selectOption('#era-filter', 'modern');
  check('era filter intersects theme using overlapping dates', (await info()).historyIds.join() === 'empire-mine');
  await page.selectOption('#era-filter', 'before-1600');
  check('empty intersection removes historical pins and explains why', (await info()).historyIds.length === 0 && await page.locator('.terrain-marker--history').count() === 0 && await page.locator('#empty-reset').isVisible());
  await page.click('#empty-reset');
  check('empty-state reset restores complete state history', (await info()).historyIds.length === 8);

  await page.locator('#history-list [data-place-id="coloma"]').focus();
  await page.keyboard.press('Enter');
  check('keyboard site selection focuses the detail close control', await page.evaluate(() => document.activeElement.id === 'close-story'));
  check('story explains landscape and links its official source', (await page.textContent('#story-landscape')).includes('river') && (await page.getAttribute('#story-source', 'href')).startsWith('https://www.parks.ca.gov/'));
  await page.keyboard.press('Enter');
  check('closing details restores the replacement list row', await page.evaluate(() => document.activeElement.dataset.placeId === 'coloma'));
  await page.click('[data-journey-id="california-gold"]');
  check('Gold Rush journey starts at Coloma', (await info()).selectedId === 'coloma' && (await info()).trailId === 'california-gold');
  await page.click('#next-stop');
  check('journey advances to Columbia', (await info()).selectedId === 'columbia');
  await page.click('#previous-stop');
  check('journey returns and disables previous at first stop', (await info()).selectedId === 'coloma' && await page.locator('#previous-stop').isDisabled());

  await boot('?state=CA&layer=history&theme=gold-rush&place=manzanar');
  check('conflicting deep-link filter keeps selected story on the map', (await info()).theme === 'all' && (await info()).historyIds.includes('manzanar') && await page.locator('.terrain-marker[data-place-id="manzanar"]').count() === 1);
  await page.reload();
  await page.waitForFunction(() => window.__TERRAIN?.info().ready, null, {timeout: 45000});
  check('deep link survives reload', (await info()).selectedId === 'manzanar');

  await boot('?state=TX&layer=history');
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  check('skip link preserves state/history and focuses explorer', (await info()).code === 'TX' && (await info()).layer === 'history' && await page.evaluate(() => document.activeElement.id === 'explorer'));
  await page.click('[data-theme="cowboys"]');
  check('Texas cowboy filter has four sites', (await info()).historyIds.length === 4);
  await page.click('[data-journey-id="texas-cowboys"]');
  check('Texas journey starts with the Kineños ranching story', (await info()).selectedId === 'king-ranch' && (await page.textContent('#story-summary')).includes('Mexican'));

  await boot('?journey=freedom-landscape');
  const route = [['MD','tubman'],['TX','galveston-juneteenth'],['KS','brown-board'],['AR','little-rock-nine'],['AL','selma']];
  for (let i = 0; i < route.length; i++) {
    if (i) await page.click('#next-stop');
    const current = await info();
    check(`journey follows story into ${route[i][0]}`, current.code === route[i][0] && current.selectedId === route[i][1] && current.historyIds.includes(route[i][1]));
  }
  check('last journey stop disables next', await page.locator('#next-stop').isDisabled());

  await search('SF', 'San Francisco');
  check('SF shortcut selects a California city view', (await info()).code === 'CA' && (await info()).layer === 'geography' && (await page.textContent('#state-title')) === 'San Francisco');
  await page.waitForFunction(() => window.__TERRAIN.info().view.zoom > 11);
  check('city focus actually zooms the 3D camera', (await info()).view.zoom > 11);
  await page.click('#close-story');
  check('closing a search-origin story returns to the search button', await page.evaluate(() => document.activeElement.id === 'open-search'));
  await search('Austin', 'Austin');
  check('Austin search changes state to Texas', (await info()).code === 'TX' && (await page.textContent('#story-title')) === 'Austin');
  await search('NYC', 'New York City');
  check('NYC shortcut changes state to New York', (await info()).code === 'NY' && (await page.textContent('#story-title')) === 'New York City');
  await page.click('#story-state-view');
  await page.uncheck('#show-cities');
  await page.uncheck('#show-features');
  check('geography label toggles remove map markers', await page.locator('.terrain-marker').count() === 0);
  await page.click('[data-surface="elevation"]');
  check('elevation mode changes renderer and legend', (await info()).view.surface === 'elevation' && await page.locator('#elevation-key').isVisible());
  await page.click('[data-surface="contours"]');
  check('contour mode changes renderer', (await info()).view.surface === 'contours');
  await page.locator('#relief').fill('3');
  check('relief slider changes actual exaggeration', (await info()).view.relief === 3);
  const bearing = (await info()).view.bearing;
  await page.click('#orbit-view');
  await page.waitForTimeout(900);
  check('automatic rotation moves the camera bearing', Math.abs((await info()).view.bearing - bearing) > .5);
  await page.keyboard.press('Escape');
  check('Escape stops rotation', !(await info()).view.orbiting);

  await page.setViewportSize({width:390,height:844});
  await boot('?state=TX&layer=history');
  check('mobile search has an accessible name', (await page.getAttribute('#open-search','aria-label')).includes('Find a state'));
  await page.click('#toggle-panel');
  check('mobile explorer expands to show filters', await page.locator('#theme-filters').isVisible() && await page.getAttribute('#toggle-panel','aria-expanded') === 'true');
  await page.locator('#history-list [data-place-id="alamo"]').scrollIntoViewIfNeeded();
  await page.click('#history-list [data-place-id="alamo"]');
  await page.click('#close-story');
  check('mobile row-origin close restores the visible expanded list', await page.getAttribute('#toggle-panel','aria-expanded') === 'true' && await page.evaluate(() => document.activeElement.dataset.placeId === 'alamo'));
  await page.click('[data-journey-id="texas-cowboys"]');
  check('mobile story opens with source and full text', await page.locator('#story-panel').isVisible() && await page.locator('#story-source').isVisible());
  await page.locator('#next-stop').scrollIntoViewIfNeeded();
  await page.click('#next-stop');
  check('mobile journey navigation remains reachable', (await info()).selectedId === 'fort-worth-stockyards');
  check('mobile layout has no document overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mkdir(resolve(root,'.context/terrain-qa'),{recursive:true});
  await page.screenshot({path:resolve(root,'.context/terrain-qa/browser-mobile-final.png')});
  check('no uncaught browser exceptions', errors.length === 0);

  // Simulate a real external-network failure: local data and history remain usable.
  const offlinePage = await browser.newPage({viewport:{width:1280,height:900}});
  await offlinePage.route(/^https:\/\/(s3\.amazonaws\.com|server\.arcgisonline\.com)\//, (route) => route.abort());
  await offlinePage.goto(base+'?state=CA&layer=history');
  await offlinePage.waitForFunction(() => Boolean(window.__TERRAIN));
  await offlinePage.click('[data-theme="gold-rush"]');
  await offlinePage.click('#history-list [data-place-id="coloma"]');
  check('historical reading works when remote map tiles fail', await offlinePage.locator('#story-panel').isVisible() && (await offlinePage.textContent('#story-summary')).includes('1848'));
  await offlinePage.waitForSelector('#map-notice:not([hidden])',{timeout:35000});
  check('tile failure shows an actionable notice', (await offlinePage.textContent('#map-notice')).includes('Retry map'));
  await offlinePage.close();
  console.log(`\n${checks} browser checks passed.`);
} finally { await browser.close(); server.close(); }
