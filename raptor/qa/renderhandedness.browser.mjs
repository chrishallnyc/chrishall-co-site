// Real pointer/keyboard steering, geographic projection and GPU raster tests.
// Teleports only establish repeatable inspection poses. Control assertions
// use browser events; winding assertions read actual pixels from each backend.
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.RAPTOR_BASE_URL || 'http://127.0.0.1:8192/';
const out = (process.env.RAPTOR_TEST_OUTPUT || '.context/nyc/handedness/').replace(/\/?$/, '/');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED !== '1' });
const results = [];
const scenarios = [
  { backend: 'webgpu', front: 'NEWYORK' },
  { backend: 'webgl', front: 'NEWYORK' },
  { backend: 'webgpu', front: 'NELLIS' },
];

try {
  for (const scenario of scenarios) {
    const label = `${scenario.backend}-${scenario.front.toLowerCase()}`;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      localStorage.setItem('raptor:quality:v1', 'LOW');
      localStorage.setItem('raptor.settings.v1', JSON.stringify({ tier: 'LOW', renderScale: .65,
        muted: true, showHints: false, showChecklist: false, pointingDevice: 'trackpad', trackpadSensitivity: .65 }));
      localStorage.setItem('raptor.practice.introduced', 'true');
    });
    const page = await context.newPage(); page.setDefaultTimeout(25000);
    const result = { ...scenario, checks: [], errors: [], badResponses: [] }; results.push(result);
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) result.badResponses.push([response.status(), response.url()]); });
    const check = async (name, work) => { await work(); result.checks.push(name); console.log(`PASS ${label} ${name}`); };
    const shot = name => page.screenshot({ path: `${out}${label}-${name}.png` });
    try {
      await page.goto(`${base}?mode=practice&front=${scenario.front}&tod=12${scenario.backend === 'webgl' ? '&gl=1' : ''}`);
      await page.waitForFunction(() => window.__RAPTOR?.ready || window.__RAPTOR?.failure, null, { timeout: 180000 });
      assert.equal(await page.evaluate(() => __RAPTOR.failure), null);
      await page.waitForSelector('#veil', { state: 'detached', timeout: 180000 });
      assert.equal(await page.evaluate(() => __RAPTOR.backend), scenario.backend);
      if (await page.evaluate(() => __RAPTOR.paused)) await page.locator('[data-resume]').click();

      await check('actual north-facing flight projects geographic east to the right', async () => {
        await page.evaluate(front => {
          const s = __RAPTOR, y = front === 'NEWYORK' ? -9000 : -6000;
          const altitude = Math.max(s.terrain.heightAt(0, y), 0) + 1500;
          s.player.debugCommand({ pos: { x: 0, y, alt: altitude, headingDeg: 90, speed: 200 } });
          s.player.aimPitch = 0;
        }, scenario.front);
        await page.waitForTimeout(160);
        result.geography = await page.evaluate(async () => {
          const { Vector3 } = await import('/vendor/three.webgpu.min.js');
          const s = __RAPTOR, c = s.rendering.camera, p = s.player.jet.position;
          const project = (x, y, z) => {
            const v = new Vector3(x, y, z);
            if (s.curvature) s.curvature.project(v, c, v); else v.project(c);
            return { x: v.x, y: v.y, z: v.z };
          };
          const landmarks = s.city ? Object.fromEntries(['liberty', 'chrysler'].map(id => {
            const l = s.city.landmarks.find(l => l.id === id);
            return [id, project(l.x, l.base + l.height, l.z)];
          })) : null;
          return { east: project(p.x + 1000, p.y, p.z + 5000), west: project(p.x - 1000, p.y, p.z + 5000),
            landmarks, determinant: c.matrixWorldInverse.determinantAffine(), terrainNodes: s.terrain.stats.nodes };
        });
        assert.ok(result.geography.east.x > .1); assert.ok(result.geography.west.x < -.1);
        assert.ok(result.geography.determinant < 0); assert.ok(result.geography.terrainNodes > 0);
        if (result.geography.landmarks) {
          assert.ok(result.geography.landmarks.liberty.x < 0, 'Liberty Island lies west, on the left looking north');
          assert.ok(result.geography.landmarks.chrysler.x > 0, 'the Chrysler Building lies east, on the right');
        }
        await shot('north-geography');
      });

      await check('real pointer travel moves the visible aim cue in the same direction, and R recenters', async () => {
        await page.mouse.move(620, 390); await page.keyboard.press('r'); await page.waitForTimeout(100);
        const before = await page.evaluate(() => __RAPTOR.player.aimHeading);
        await page.mouse.move(660, 390, { steps: 4 }); await page.waitForTimeout(90);
        const right = await page.evaluate(() => ({ cue: __RAPTOR.aimCue, heading: __RAPTOR.player.aimHeading }));
        assert.ok(right.heading < before, 'clockwise ENU aim follows positive pointer travel');
        assert.ok(right.cue.x > 650, `rightward cue is visibly right: ${right.cue.x}`);
        await shot('pointer-right');
        await page.keyboard.press('r'); await page.waitForTimeout(100);
        const centered = await page.evaluate(() => {
          const p = __RAPTOR.player;
          return { cue: __RAPTOR.aimCue, heading: p.aimHeading, course: Math.atan2(p.fm.state[8], p.fm.state[7]) };
        });
        // During a turn the velocity and nose differ. R deliberately holds
        // the flight path, so its cue need not sit exactly on the nose.
        assert.ok(Math.abs(Math.atan2(Math.sin(centered.heading - centered.course), Math.cos(centered.heading - centered.course))) < .02);
        assert.ok(Math.abs(centered.cue.x - 640) < Math.abs(right.cue.x - 640), 'recenter removes the requested course offset');
        await page.mouse.move(620, 390, { steps: 4 }); await page.waitForTimeout(90);
        const left = await page.evaluate(() => ({ cue: __RAPTOR.aimCue, heading: __RAPTOR.player.aimHeading }));
        assert.ok(left.cue.x < 630, `leftward cue is visibly left: ${left.cue.x}`);
        await shot('pointer-left'); await page.keyboard.press('r');
        result.pointer = { right, centered, left };
      });

      await check('a real right-bank key lowers the visible starboard wing', async () => {
        await page.keyboard.down('d');
        try { await page.waitForFunction(() => __RAPTOR.player.hudState().roll > 12, null, { timeout: 5000 }); }
        finally { await page.keyboard.up('d'); }
        result.bank = await page.evaluate(async () => {
          const { Vector3 } = await import('/vendor/three.webgpu.min.js');
          const s = __RAPTOR, model = s.rendering.world.f22, camera = s.rendering.camera;
          const right = new Vector3(6, 0, 0).applyMatrix4(model.matrixWorld);
          const left = new Vector3(-6, 0, 0).applyMatrix4(model.matrixWorld);
          const worldDelta = right.y - left.y;
          right.project(camera); left.project(camera);
          return { roll: s.player.hudState().roll, worldDelta, right: right.toArray(), left: left.toArray() };
        });
        assert.ok(result.bank.worldDelta < 0, 'physical starboard wing dips');
        assert.ok(result.bank.right[0] > result.bank.left[0], 'starboard appears on the right');
        assert.ok(result.bank.right[1] < result.bank.left[1], 'right wing appears lower on screen');
        await shot('right-bank');
      });

      await page.keyboard.press('Escape'); await page.waitForFunction(() => __RAPTOR.paused);
      await check('the actual landscape contributes visible pixels to the flight view', async () => {
        result.terrainRaster = await page.evaluate(async () => {
          const THREE = await import('/vendor/three.webgpu.min.js');
          const s = __RAPTOR, renderer = s.rendering.renderer;
          const target = new THREE.RenderTarget(128, 80, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
            colorSpace: THREE.NoColorSpace, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
          target.texture.name = 'HandednessQA.actualTerrain';
          const capture = async terrainVisible => {
            const old = { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
              mrt: renderer.getMRT(), autoClear: renderer.autoClear, xr: renderer.xr?.enabled, visible: s.terrain.group.visible };
            try {
              s.terrain.group.visible = terrainVisible;
              renderer.setMRT(null); renderer.autoClear = true; if (renderer.xr) renderer.xr.enabled = false;
              renderer.setRenderTarget(target); renderer.render(s.rendering.scene, s.rendering.camera);
            } finally {
              s.terrain.group.visible = old.visible;
              renderer.setRenderTarget(old.target, old.face, old.mip); renderer.setMRT(old.mrt);
              renderer.autoClear = old.autoClear; if (renderer.xr) renderer.xr.enabled = old.xr;
            }
            return renderer.readRenderTargetPixelsAsync(target, 0, 0, 128, 80);
          };
          try {
            const land = await capture(true), hidden = await capture(false);
            let changedPixels = 0;
            for (let i = 0; i < land.length; i += 4)
              if (Math.abs(land[i] - hidden[i]) + Math.abs(land[i + 1] - hidden[i + 1]) + Math.abs(land[i + 2] - hidden[i + 2]) > 15) changedPixels++;
            return { changedPixels, totalPixels: 128 * 80, visibleNodes: s.terrain.stats.nodes };
          } finally { target.dispose(); }
        });
        assert.ok(result.terrainRaster.changedPixels > 80,
          `landscape must actually rasterize, beyond loaded metadata: ${JSON.stringify(result.terrainRaster)}`);
      });
      await check('GPU pixels preserve one-sided surfaces across reflected aircraft, ordinary probes and main view', async () => {
        result.raster = await page.evaluate(async () => {
          const THREE = await import('/vendor/three.webgpu.min.js');
          const renderer = __RAPTOR.rendering.renderer;
          const scene = new THREE.Scene(); scene.background = new THREE.Color(0);
          const group = new THREE.Group(); scene.add(group);
          const geometry = new THREE.PlaneGeometry(2, 2);
          const materials = [0xff0000, 0x00ff00].map(color => new THREE.MeshBasicMaterial({ color, side: THREE.FrontSide, toneMapped: false }));
          for (let i = 0; i < 2; i++) { const mesh = new THREE.Mesh(geometry, materials[i]); mesh.position.x = i ? 1.25 : -1.25; group.add(mesh); }
          const reflected = __RAPTOR.rendering.camera.clone();
          reflected.position.set(0, 0, 5); reflected.up.set(0, 1, 0); reflected.lookAt(0, 0, 0);
          const ordinary = new THREE.PerspectiveCamera(reflected.fov, reflected.aspect, reflected.near, reflected.far);
          ordinary.position.copy(reflected.position); ordinary.lookAt(0, 0, 0);
          // 64 RGBA8 pixels fill exactly one WebGPU 256-byte row, so both
          // backends return the same unambiguous readback stride.
          const target = new THREE.RenderTarget(64, 64, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
            colorSpace: THREE.NoColorSpace, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
          target.texture.name = 'HandednessQA.oneSidedSurfaces';
          const captures = [];
          try {
            for (const cameraReflected of [true, false]) for (const objectReflected of [false, true]) {
              const camera = cameraReflected ? reflected : ordinary;
              group.scale.x = objectReflected ? -1 : 1;
              const old = { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
                mrt: renderer.getMRT(), autoClear: renderer.autoClear, xr: renderer.xr?.enabled };
              try {
                renderer.setMRT(null); renderer.autoClear = true; if (renderer.xr) renderer.xr.enabled = false;
                renderer.setRenderTarget(target); renderer.render(scene, camera);
              } finally {
                renderer.setRenderTarget(old.target, old.face, old.mip); renderer.setMRT(old.mrt);
                renderer.autoClear = old.autoClear; if (renderer.xr) renderer.xr.enabled = old.xr;
              }
              const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 64, 64);
              let red = 0, green = 0, rx = 0, gx = 0;
              for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
                const i = (y * 64 + x) * 4;
                if (pixels[i] > 150 && pixels[i + 1] < 40) { red++; rx += x; }
                if (pixels[i + 1] > 150 && pixels[i] < 40) { green++; gx += x; }
              }
              captures.push({ cameraReflected, objectReflected, red, green, redX: rx / red, greenX: gx / green });
            }
          } finally { target.dispose(); geometry.dispose(); materials.forEach(m => m.dispose()); }
          return captures;
        });
        for (const pass of result.raster) {
          assert.ok(pass.red > 20 && pass.green > 20, `both FrontSide planes rasterize: ${JSON.stringify(pass)}`);
          assert.equal(pass.redX > pass.greenX, pass.cameraReflected !== pass.objectReflected,
            `camera and object parity compose correctly: ${JSON.stringify(pass)}`);
        }
      });
      await page.locator('[data-resume]').click(); await page.waitForTimeout(150);
      await shot('after-probe');
      assert.deepEqual(result.errors, []); assert.deepEqual(result.badResponses, []);
    } catch (error) {
      result.failure = String(error); await shot('failure').catch(() => {}); throw error;
    } finally { await context.close(); }
  }
} finally { await writeFile(out + 'results.json', JSON.stringify(results, null, 2)); await browser.close(); }
