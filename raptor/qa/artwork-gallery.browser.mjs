// Standalone artwork-gallery checks. Uses an existing Playwright installation and Chrome.
// Default: local file:// gallery. RAPTOR_BASE_URL may point at a served Raptor root.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raptorRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const galleryRoot = resolve(raptorRoot, 'artwork/four-cities');
let workspaceRoot = raptorRoot;
while (!existsSync(resolve(workspaceRoot, '.git')) && dirname(workspaceRoot) !== workspaceRoot) {
  workspaceRoot = dirname(workspaceRoot);
}
if (workspaceRoot === parse(workspaceRoot).root) workspaceRoot = resolve(raptorRoot, '..');
const output = resolve(workspaceRoot, process.env.RAPTOR_TEST_OUTPUT || '.context/raptor-artwork/qa');
const galleryURL = process.env.RAPTOR_BASE_URL
  ? new URL('artwork/four-cities/index.html', process.env.RAPTOR_BASE_URL.replace(/\/?$/, '/')).href
  : pathToFileURL(resolve(galleryRoot, 'index.html')).href;
const playwrightModule = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href
  : 'playwright';
const report = {
  passed: false, startedAt: new Date().toISOString(), galleryURL, output,
  checks: [], contexts: [], screenshots: [], downloads: [],
};
const contexts = [];
const pageIDs = new WeakMap();
let browser;
let activePage;

await mkdir(output, { recursive: true });

async function check(name, run) {
  const started = Date.now();
  try {
    await run();
    report.checks.push({ name, passed: true, durationMs: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, passed: false, durationMs: Date.now() - started, error: error.message });
    throw error;
  }
}

async function isolated(name, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true, ...options,
  });
  contexts.push(context);
  const evidence = { name, requests: [], pageErrors: [], consoleErrors: [], failedRequests: [], badResponses: [], verifiedOriginalPopups: [] };
  report.contexts.push(evidence);
  const requestPageID = request => {
    try { return pageIDs.get(request.frame().page()); } catch { return undefined; }
  };
  context.on('request', request => evidence.requests.push({ url: request.url(), type: request.resourceType(), pageId: requestPageID(request) }));
  context.on('requestfailed', request => evidence.failedRequests.push({ url: request.url(), error: request.failure()?.errorText, pageId: requestPageID(request) }));
  context.on('response', response => {
    if (response.status() >= 400) evidence.badResponses.push({ url: response.url(), status: response.status(), pageId: requestPageID(response.request()) });
  });
  let pageCount = 0;
  context.on('page', page => {
    const pageId = `${name}-${++pageCount}`;
    pageIDs.set(page, pageId);
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => evidence.pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') evidence.consoleErrors.push({ text: message.text(), url: message.location().url, pageId });
    });
  });
  const page = await context.newPage();
  activePage = page;
  return { context, page, evidence };
}

async function openGallery(page) {
  await page.goto(galleryURL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
}

function plate(page, entry) {
  return page.locator(`figure[id="${entry.id}"]`);
}

const absoluteURL = file => new URL(file, galleryURL).href;

async function loadedImage(image) {
  await image.waitFor({ state: 'visible' });
  await image.evaluate(image => {
    if (image.complete) {
      if (image.naturalWidth > 0) return;
      throw new Error(`Image failed to decode: ${image.currentSrc || image.src}`);
    }
    return new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', () => reject(new Error(`Image failed to load: ${image.src}`)), { once: true });
    });
  });
  assert.equal(await image.evaluate(image => image.complete && image.naturalWidth > 0), true);
}

async function readyPreview(page, entry) {
  const figure = plate(page, entry);
  await figure.scrollIntoViewIfNeeded();
  await page.waitForFunction(id => ['true', 'false'].includes(document.getElementById(id)?.dataset.ready), entry.id);
  assert.equal(await figure.getAttribute('data-ready'), 'true', `${entry.id} preview loads successfully`);
  await loadedImage(figure.locator('.plate-view img'));
  assert.equal(await figure.locator('.pending').isVisible(), false, `${entry.id} hides its loading message`);
}

async function assertOriginalLinks(page, entry) {
  const figure = plate(page, entry);
  const viewer = figure.locator('.plate-view');
  assert.equal(await viewer.evaluate(element => element.tagName), 'A', `${entry.id} has a native image link`);
  assert.equal(await viewer.evaluate(element => element.href), absoluteURL(entry.file));
  const full = figure.locator('.plate-actions a:not([download])');
  const download = figure.locator('.plate-actions a[download]');
  assert.equal(await full.evaluate(element => element.href), absoluteURL(entry.file));
  assert.equal(await download.evaluate(element => element.href), absoluteURL(entry.file));
  assert.equal(await download.getAttribute('download'), basename(entry.file));
  assert.equal(await full.isVisible(), true, `${entry.id} exposes the full-resolution link`);
  assert.equal(await download.isVisible(), true, `${entry.id} exposes the PNG download`);
}

async function assertLightbox(page, entry) {
  assert.equal(await page.locator('#lightbox').evaluate(dialog => dialog.open), true);
  assert.equal(await page.locator('#lightbox-title').textContent(), entry.title);
  assert.equal(await page.locator('#lightbox-image').evaluate(image => image.src), absoluteURL(entry.file));
  assert.equal(await page.locator('#lightbox-full').evaluate(link => link.href), absoluteURL(entry.file));
  assert.equal(await page.locator('#lightbox-download').evaluate(link => link.href), absoluteURL(entry.file));
  assert.equal(await page.locator('#lightbox-download').getAttribute('download'), basename(entry.file));
  await loadedImage(page.locator('#lightbox-image'));
}

async function downloadPNG(page, link, entry, prefix) {
  if (new URL(galleryURL).protocol === 'file:') {
    // Chrome opens file:// download links as images instead of emitting a
    // download event. The new tab must preserve the gallery and selected file.
    assert.equal(await link.getAttribute('target'), '_blank');
    const [originalPage] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
    await originalPage.waitForLoadState('load');
    assert.equal(originalPage.url(), absoluteURL(entry.file));
    await loadedImage(originalPage.locator('img'));
    assert.equal(page.url(), galleryURL, 'local download fallback leaves the gallery open');
    await originalPage.close();
    const bytes = await readFile(new URL(absoluteURL(entry.file)));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'linked original is a PNG');
    report.downloads.push({ file: entry.file, behavior: 'Chrome opens the local PNG in a new tab; native file:// download attributes are not honored' });
    return;
  }
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  assert.equal(download.suggestedFilename(), basename(entry.file));
  assert.equal(await download.failure(), null);
  const path = resolve(output, `${prefix}-${download.suggestedFilename()}`);
  await download.saveAs(path);
  const bytes = await readFile(path);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'download is a PNG');
  report.downloads.push({ file: entry.file, behavior: 'download', savedTo: path });
}

async function screenshot(page, name) {
  const path = resolve(output, name);
  await page.screenshot({ path });
  report.screenshots.push(path);
}

function assertClean(evidence) {
  const expectedFailure = evidence.expectedFailureURL;
  // Chrome's built-in PNG document independently asks for /favicon.ico. A 404
  // from that verified no-JS popup is recorded separately from gallery traffic;
  // the same request or error on a gallery page still fails the check.
  const nativeImageFavicon = event => evidence.name === 'no-javascript'
    && /^https?:/.test(galleryURL)
    && event.url === new URL('/favicon.ico', galleryURL).href
    && evidence.verifiedOriginalPopups.some(popup => popup.pageId === event.pageId)
    && (event.status === 404 || /server responded with a status of 404/.test(event.text || ''));
  evidence.nativeImageDocumentTraffic = {
    consoleErrors: evidence.consoleErrors.filter(nativeImageFavicon),
    badResponses: evidence.badResponses.filter(nativeImageFavicon),
  };
  assert.deepEqual(evidence.pageErrors, [], `${evidence.name}: no script errors`);
  assert.deepEqual(evidence.failedRequests.filter(request => request.url !== expectedFailure), [], `${evidence.name}: no unexpected failed requests`);
  assert.deepEqual(evidence.badResponses.filter(response => response.url !== expectedFailure && !nativeImageFavicon(response)), [], `${evidence.name}: no unexpected HTTP errors`);
  assert.deepEqual(evidence.consoleErrors.filter(error => (!expectedFailure || error.url !== expectedFailure) && !nativeImageFavicon(error)), [], `${evidence.name}: no unexpected console errors`);
  const unexpectedOrigins = evidence.requests.filter(request => {
    if (!/^https?:/.test(request.url)) return false;
    return new URL(galleryURL).protocol === 'file:' || new URL(request.url).origin !== new URL(galleryURL).origin;
  });
  assert.deepEqual(unexpectedOrigins, [], `${evidence.name}: no external requests`);
}

try {
  const manifest = JSON.parse(await readFile(resolve(galleryRoot, 'manifest.json'), 'utf8'));
  await check('manifest defines ten unique previews and original PNGs', async () => {
    assert.equal(manifest.length, 10);
    assert.equal(new Set(manifest.map(entry => entry.id)).size, 10);
    assert.equal(new Set(manifest.map(entry => entry.preview)).size, 10);
    for (const entry of manifest) {
      assert.equal(typeof entry.preview, 'string', `${entry.id} defines a preview`);
      assert.notEqual(entry.preview, entry.file, `${entry.id} separates preview and original`);
      assert.match(entry.file, /\.png$/i);
    }
    report.assets = await Promise.all(manifest.map(async entry => ({
      id: entry.id, file: entry.file, preview: entry.preview,
      originalBytes: (await stat(resolve(galleryRoot, entry.file))).size,
      previewBytes: (await stat(resolve(galleryRoot, entry.preview))).size,
    })));
  });

  const { chromium } = await import(playwrightModule);
  browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED !== '1' });
  report.browserVersion = browser.version();
  const desktop = await isolated('desktop');
  await openGallery(desktop.page);

  await check('gallery figures, previews and original links match the manifest', async () => {
    const actual = await desktop.page.locator('figure[data-title]').evaluateAll(figures => figures.map(figure => ({
      id: figure.id, title: figure.dataset.title, subtitle: figure.dataset.subtitle,
      preview: figure.querySelector('.plate-view img').getAttribute('src'),
    })));
    assert.deepEqual(actual, manifest.map(({ id, title, subtitle, preview }) => ({ id, title, subtitle, preview })));
    for (const entry of manifest) await assertOriginalLinks(desktop.page, entry);
    assert.equal(await desktop.page.evaluate(() => document.fonts.check('16px Pixel')), true);
  });

  await check('fresh desktop eagerly loads the first preview and defers distant previews and all originals', async () => {
    const images = desktop.page.locator('figure[data-title] .plate-view img');
    assert.equal(await images.first().getAttribute('loading'), 'eager');
    assert.equal(await images.first().getAttribute('fetchpriority'), 'high');
    for (let index = 1; index < manifest.length; index++) assert.equal(await images.nth(index).getAttribute('loading'), 'lazy');
    const previewURLs = new Set(manifest.map(entry => absoluteURL(entry.preview)));
    const originalURLs = new Set(manifest.map(entry => absoluteURL(entry.file)));
    const requested = new Set(desktop.evidence.requests.filter(request => previewURLs.has(request.url)).map(request => request.url));
    assert.ok(requested.has(absoluteURL(manifest[0].preview)), 'first preview is requested');
    // Native lazy loading includes a browser-controlled near-viewport margin.
    assert.ok(requested.size < manifest.length, 'startup does not request every preview');
    assert.equal(requested.has(absoluteURL(manifest.at(-1).preview)), false, 'distant final preview stays deferred');
    assert.deepEqual(desktop.evidence.requests.filter(request => originalURLs.has(request.url)), [], 'startup requests no original PNGs');
    const visible = await images.evaluateAll(images => images.filter(image => {
      const rect = image.getBoundingClientRect();
      return rect.top < innerHeight && rect.bottom > 0;
    }).map(image => image.src));
    for (const url of visible) assert.ok(requested.has(url), 'visible preview is requested');
    const originalCollectionBytes = report.assets.reduce((sum, asset) => sum + asset.originalBytes, 0);
    const previewCollectionBytes = report.assets.reduce((sum, asset) => sum + asset.previewBytes, 0);
    const requestedPreviewFiles = report.assets.filter(asset => requested.has(absoluteURL(asset.preview)))
      .map(asset => ({ file: basename(asset.preview), bytes: asset.previewBytes }));
    const requestedPreviewBytes = requestedPreviewFiles.reduce((sum, asset) => sum + asset.bytes, 0);
    report.startup = {
      requestedPreviews: [...requested], requestedPreviewFiles, visiblePreviews: visible,
      totalPreviews: manifest.length, requestedPreviewBytes, originalCollectionBytes, previewCollectionBytes,
      reductionVersusAllOriginals: 1 - requestedPreviewBytes / originalCollectionBytes,
    };
    await screenshot(desktop.page, 'desktop-startup.png');
  });

  await check('scrolling loads all ten previews without loading original PNGs', async () => {
    for (const entry of manifest) await readyPreview(desktop.page, entry);
    const originalURLs = new Set(manifest.map(entry => absoluteURL(entry.file)));
    assert.deepEqual(desktop.evidence.requests.filter(request => originalURLs.has(request.url)), []);
    await screenshot(desktop.page, 'shared-artwork.png');
  });

  await check('lightbox uses originals, cycles with arrow keys, preserves filenames and restores focus', async () => {
    const page = desktop.page;
    const opener = plate(page, manifest[0]).locator('.plate-view');
    await opener.focus();
    await page.keyboard.press('Enter');
    for (const entry of manifest) {
      await assertLightbox(page, entry);
      await page.keyboard.press('ArrowRight');
    }
    await assertLightbox(page, manifest[0]);
    await page.keyboard.press('ArrowLeft');
    await assertLightbox(page, manifest.at(-1));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await assertLightbox(page, manifest[2]);
    await screenshot(page, 'lightbox.png');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#lightbox').evaluate(dialog => dialog.open), false);
    assert.equal(await opener.evaluate(element => document.activeElement === element), true);
    await plate(page, manifest[2]).locator('.plate-view').click();
    await assertLightbox(page, manifest[2]);
    await downloadPNG(page, page.locator('#lightbox-download'), manifest[2], 'lightbox-download');
  });
  assertClean(desktop.evidence);
  await desktop.context.close();

  await check('a failed preview reports the failure and retains working original links and lightbox', async () => {
    const failure = await isolated('injected-preview-failure');
    const entry = manifest[0];
    const previewURL = absoluteURL(entry.preview);
    let intercepted = 0;
    failure.evidence.expectedFailureURL = previewURL;
    await failure.context.route(previewURL, route => { intercepted++; return route.abort('failed'); });
    await openGallery(failure.page);
    if (intercepted === 0) {
      // Chromium does not route file:// resources on every version. Trigger a real
      // image error after load in that case, without rewriting gallery source.
      await readyPreview(failure.page, entry);
      const missingURL = new URL('qa-intentionally-missing-preview.webp', galleryURL).href;
      failure.evidence.expectedFailureURL = missingURL;
      await plate(failure.page, entry).locator('.plate-view img').evaluate((image, url) => { image.src = url; }, missingURL);
      failure.evidence.injection = 'missing DOM image source';
    } else {
      failure.evidence.injection = 'aborted preview request';
    }
    await failure.page.waitForFunction(id => document.getElementById(id)?.dataset.ready === 'false', entry.id);
    const figure = plate(failure.page, entry);
    assert.equal(await figure.locator('.pending').isVisible(), true);
    assert.match(await figure.locator('.pending').textContent(), /preview (?:unavailable|could not|failed)/i);
    await assertOriginalLinks(failure.page, entry);
    await figure.scrollIntoViewIfNeeded();
    await screenshot(failure.page, 'preview-failure.png');
    await figure.locator('.plate-view').click();
    await assertLightbox(failure.page, entry);
    await failure.page.keyboard.press('ArrowRight');
    await assertLightbox(failure.page, manifest[1]);
    await failure.page.keyboard.press('Escape');
    assert.ok(failure.evidence.failedRequests.some(request => request.url === failure.evidence.expectedFailureURL), 'the injected image request really failed');
    assertClean(failure.evidence);
    await failure.context.close();
  });

  await check('without JavaScript all previews and direct full-resolution and download links work', async () => {
    const noJS = await isolated('no-javascript', { javaScriptEnabled: false });
    await openGallery(noJS.page);
    for (const entry of manifest) {
      const figure = plate(noJS.page, entry);
      await figure.scrollIntoViewIfNeeded();
      await loadedImage(figure.locator('.plate-view img'));
      await assertOriginalLinks(noJS.page, entry);
      assert.equal(await figure.locator('.pending').isVisible(), false, 'no JavaScript does not leave a loading overlay');
    }
    const entry = manifest[4];
    const fullLink = plate(noJS.page, entry).locator('.plate-actions a:not([download])');
    const [originalPage] = await Promise.all([noJS.context.waitForEvent('page'), fullLink.click()]);
    await originalPage.waitForLoadState('load');
    assert.equal(originalPage.url(), absoluteURL(entry.file));
    await loadedImage(originalPage.locator('img'));
    noJS.evidence.verifiedOriginalPopups.push({ pageId: pageIDs.get(originalPage), url: originalPage.url() });
    await originalPage.close();
    await plate(noJS.page, manifest[0]).scrollIntoViewIfNeeded();
    await screenshot(noJS.page, 'no-javascript.png');
    await downloadPNG(noJS.page, plate(noJS.page, entry).locator('.plate-actions a[download]'), entry, 'no-js-download');
    assertClean(noJS.evidence);
    await noJS.context.close();
  });

  await check('mobile gallery and lightbox fit narrow screens and respect reduced motion', async () => {
    const mobile = await isolated('mobile-reduced-motion', { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = mobile.page;
    await openGallery(page);
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
    const transitions = await page.locator('.plate-view').evaluateAll(elements => elements.map(element => getComputedStyle(element).transitionDuration));
    assert.ok(transitions.every(duration => duration.split(',').every(value => parseFloat(value) === 0)));
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${viewport.width}px gallery fits`);
      await readyPreview(page, manifest[0]);
      await plate(page, manifest[0]).locator('.plate-view').click();
      await assertLightbox(page, manifest[0]);
      assert.equal(await page.locator('#lightbox').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true, `${viewport.width}px dialog fits`);
      assert.equal(await page.locator('#lightbox-close').isVisible(), true);
      if (viewport.width === 390) await screenshot(page, 'mobile-lightbox.png');
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    await screenshot(page, 'mobile.png');
    assertClean(mobile.evidence);
    await mobile.context.close();
  });

  await check('all browser contexts have no unexpected script, network or console failures', async () => {
    for (const evidence of report.contexts) assertClean(evidence);
  });
  report.passed = true;
} catch (error) {
  process.exitCode = 1;
  report.error = error.stack || String(error);
  console.error(error);
  if (activePage && !activePage.isClosed()) {
    report.imageStatesAtFailure = await activePage.locator('figure[data-title]').evaluateAll(figures => figures.map(figure => ({
      id: figure.id, ready: figure.dataset.ready, source: figure.querySelector('img')?.src,
      complete: figure.querySelector('img')?.complete, naturalWidth: figure.querySelector('img')?.naturalWidth,
    }))).catch(() => []);
    try { await screenshot(activePage, 'failure.png'); } catch (screenshotError) { report.screenshotError = screenshotError.message; }
  }
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Results: ${resolve(output, 'results.json')}`);
}
