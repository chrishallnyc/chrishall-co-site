#!/usr/bin/env node
// Standalone browser validation. Uses an installed Playwright; never installs it.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, relative, extname, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform, arch, release } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const raptorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(raptorRoot, "..");
const BOOLEAN_OPTIONS = new Set(["help", "headed", "require-metadata", "gear", "skip-sim", "check-pose"]);
const VALUE_OPTIONS = new Set(["builder", "export", "builder-options", "bandit-builder", "backend", "aircraft", "out", "baseline", "source-overlay", "texture-overlay", "sim-ref", "ticks", "seed", "views", "modes", "width", "height", "frames", "timeout", "playwright", "browser", "min-silhouette-iou", "framing", "pose"]);
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, "");
  if (BOOLEAN_OPTIONS.has(key)) options[key] = true;
  else if (VALUE_OPTIONS.has(key) && process.argv[i + 1] !== undefined) options[key] = process.argv[++i];
  else throw new Error(`Unknown option or missing value: ${process.argv[i]}. Use --help.`);
}
if (options.help) {
  console.log(`Usage: node raptor/qa/aircraft.mjs [options]

  --builder /src/aircraft/f22v3.js  Builder module served from raptor/
  --export buildF22                Named builder export
  --builder-options '{"key":1}'    JSON passed to builder
  --bandit-builder /src/aircraft/bandit-models.js
  --aircraft f22|all|f22,fighter,transport,drone
  --backend both|webgl|webgpu       Default both; silent fallback fails
  --views top,side,front,rear       True orthographic views; also underside,perspective
  --modes beauty,silhouette        Default both
  --baseline path/results.json     Reuse baseline framing and write image differences
  --source-overlay path            Overlay directory on /src/ before freezing sources
  --texture-overlay path           F-22 coating PNG/manifest directory for material comparisons
  --min-silhouette-iou 0.95         Optional explicit silhouette comparison gate
  --require-metadata               Require aircraft/hinge/effect metadata
  --gear                           Show extended gear in captures
  --framing JSON                   Camera overrides, e.g. target/halfHeight
  --pose JSON                      Local part angles in degrees, e.g. {"canopy":65}
  --check-pose                     Exercise FM articulation and actual Player.render
  --sim-ref origin/main            Git bandit source to compare (default origin/main)
  --ticks 1200 --seed 0xA1C4        Deterministic simulation fixture
  --skip-sim                       Omit simulation regression
  --width 1600 --height 1000 --frames 60
  --out path                       Artifact directory (default timestamped .context/ path)
  --playwright path                Installed package path (also AIRCRAFT_QA_PLAYWRIGHT)
  --browser path                   Browser executable (also AIRCRAFT_QA_BROWSER)
  --headed --timeout 90000

Starts and closes its own localhost static server. Does not modify production files.`);
  process.exit(0);
}

function choice(value, allowed, label) {
  for (const item of value) if (!allowed.includes(item)) throw new Error(`Invalid ${label}: ${item}`);
  return [...new Set(value)];
}
function numberOption(key, fallback, minimum = 1, maximum = Infinity) {
  const value = Number(options[key] ?? fallback);
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`Invalid --${key}: ${value}`);
  return value;
}
const aircraft = choice(options.aircraft === "all" ? ["f22", "fighter", "transport", "drone"] : (options.aircraft ?? "f22").split(","), ["f22", "fighter", "transport", "drone"], "aircraft");
const backends = choice((options.backend ?? "both") === "both" ? ["webgpu", "webgl"] : [options.backend], ["webgpu", "webgl"], "backend");
const views = choice((options.views ?? "top,side,front,rear").split(","), ["top", "side", "front", "rear", "underside", "perspective"], "view");
const modes = choice((options.modes ?? "beauty,silhouette").split(","), ["beauty", "silhouette"], "mode");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = resolve(options.out ?? join(repoRoot, ".context/aircraft-rebuild/validation", timestamp));
const baselinePath = options.baseline ? resolve(options.baseline) : null;
const baseline = baselinePath ? JSON.parse(await readFile(baselinePath, "utf8")) : null;
if (baselinePath && output === dirname(baselinePath)) throw new Error("Comparison output must be separate from the baseline directory");
const config = {
  builder: options.builder ?? "/src/aircraft/f22v3.js",
  exportName: options.export ?? "buildF22",
  builderOptions: JSON.parse(options["builder-options"] ?? "{}"),
  banditBuilder: options["bandit-builder"] ?? "/src/aircraft/bandit-models.js",
  width: numberOption("width", baseline?.config?.width ?? 1600),
  height: numberOption("height", baseline?.config?.height ?? 1000),
  frames: numberOption("frames", 60, 0),
  ticks: numberOption("ticks", 1200, 600),
  seed: numberOption("seed", 0xA1C4, 0, 0xffffffff),
  timeout: numberOption("timeout", 90000),
  requireMetadata: !!options["require-metadata"], gear: !!options.gear,
  checkPose: !!options["check-pose"],
  framing: options.framing ? JSON.parse(options.framing) : null,
  pose: options.pose ? JSON.parse(options.pose) : {},
  sourceOverlay: options["source-overlay"] ? resolve(options["source-overlay"]) : null,
  textureOverlay: options["texture-overlay"] ? resolve(options["texture-overlay"]) : null,
};
for (const key of ["builder", "banditBuilder"]) {
  if (!config[key].startsWith("/") || config[key].includes("..") || config[key].includes(":")) throw new Error(`${key} must be a local URL path within raptor/`);
}
if (options["min-silhouette-iou"] && !baseline) throw new Error("--min-silhouette-iou requires --baseline");
const iouGate = options["min-silhouette-iou"] ? numberOption("min-silhouette-iou", 0, 0, 1) : null;

function git(args) { return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function sha256(data) { return createHash("sha256").update(data).digest("hex"); }
async function evaluate(page, fn, argument) {
  // Playwright's page.evaluate does not inherit setDefaultTimeout.
  let timeout;
  try {
    return await Promise.race([
      page.evaluate(fn, argument),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Browser evaluation exceeded ${config.timeout} ms`)), config.timeout); }),
    ]);
  } finally { clearTimeout(timeout); }
}

async function discoverPlaywright() {
  const explicit = options.playwright ?? process.env.AIRCRAFT_QA_PLAYWRIGHT;
  const candidates = explicit ? [resolve(explicit)] : ["playwright", "playwright-core"];
  if (!explicit) {
    const cache = join(homedir(), ".bun/install/cache");
    if (existsSync(cache)) {
      const entries = (await readdir(cache)).filter(name => /^playwright(?:-core)?@/.test(name) && !name.includes("patch_hash"));
      entries.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      candidates.push(...entries.map(name => join(cache, name)));
    }
    for (const base of ["/opt/homebrew/lib/node_modules", "/usr/local/lib/node_modules"]) for (const name of ["playwright", "playwright-core"]) candidates.push(join(base, name));
  }
  const failures = [];
  for (const candidate of candidates) {
    try {
      const resolved = require.resolve(candidate), module = require(resolved);
      if (!module.chromium) throw new Error("Module does not export chromium");
      let version = null;
      try { version = JSON.parse(readFileSync(join(dirname(resolved), "package.json"), "utf8")).version; } catch {}
      return { chromium: module.chromium, resolved, version };
    } catch (error) { failures.push(`${candidate}: ${error.code ?? error.message}`); }
  }
  throw new Error(`No installed Playwright found. Set --playwright /path/to/playwright-core or AIRCRAFT_QA_PLAYWRIGHT. No package was installed.\n${failures.join("\n")}`);
}

function discoverBrowser(chromium) {
  const explicit = options.browser ?? process.env.AIRCRAFT_QA_BROWSER;
  const candidates = explicit ? [resolve(explicit)] : [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", chromium.executablePath(),
  ];
  const executable = candidates.find(candidate => existsSync(candidate));
  if (!executable) throw new Error("No browser executable found. Set --browser or AIRCRAFT_QA_BROWSER. No browser was downloaded.");
  return executable;
}

let referenceSource = null;
const simRef = options["sim-ref"] ?? "origin/main";
if (!options["skip-sim"]) {
  const sourcePath = `${relative(repoRoot, raptorRoot).split(sep).join("/")}/src/game/bandits.js`;
  // execFile avoids interpolating branch names into shell source.
  try { referenceSource = git(["show", `${simRef}:${sourcePath}`]); }
  catch (error) { throw new Error(`Cannot read simulation reference ${simRef}:${sourcePath}. Choose an existing --sim-ref or explicitly --skip-sim. ${error.message}`); }
}
// Freeze modules for the whole run. Parallel model edits must not change the
// WebGL case after WebGPU has captured a different aircraft revision.
const sourceSnapshot = new Map();
async function snapshotTree(directory, prefix) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries.map(async entry => {
    const file = join(directory, entry.name), url = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await snapshotTree(file, url);
    else if (entry.isFile() && /\.(?:js|mjs|json|html)$/.test(entry.name)) sourceSnapshot.set(url, await readFile(file));
  }));
}
await snapshotTree(join(raptorRoot, "src"), "/src");
if (config.sourceOverlay) await snapshotTree(config.sourceOverlay, "/src");
await snapshotTree(join(raptorRoot, "qa"), "/qa");
// Freeze coating assets too: rebuilding a PNG during a two-backend comparison
// must not silently change the material under the second renderer.
const textureDirectory = config.textureOverlay ?? join(raptorRoot,"src/aircraft/textures/f22");
for (const name of await readdir(textureDirectory)) {
  if (/^(?:body|lifting)-(?:high|medium|low)-(?:color|normal|orm)\.png$/.test(name) || name === "manifest.json")
    sourceSnapshot.set(`/src/aircraft/textures/f22/${name}`, await readFile(join(textureDirectory,name)));
}
if (config.textureOverlay) {
  for (const atlas of ["body","lifting"]) for (const quality of ["high","medium","low"]) for (const kind of ["color","normal","orm"])
    if (!sourceSnapshot.has(`/src/aircraft/textures/f22/${atlas}-${quality}-${kind}.png`)) throw new Error(`Incomplete F-22 texture overlay: ${atlas}-${quality}-${kind}.png`);
}
const sourceDigests = [...sourceSnapshot].sort(([a], [b]) => a.localeCompare(b)).map(([url, bytes]) => ({ url, sha256: sha256(bytes) }));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".bin": "application/octet-stream", ".wasm": "application/wasm", ".ktx2": "image/ktx2", ".glb": "model/gltf-binary" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/src/game/__qa_reference_bandits.js" && referenceSource !== null) {
      response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" }); response.end(referenceSource); return;
    }
    if (sourceSnapshot.has(pathname)) {
      response.writeHead(200, { "Content-Type": MIME[extname(pathname)] ?? "text/javascript", "Cache-Control": "no-store" }); response.end(sourceSnapshot.get(pathname)); return;
    }
    let file = resolve(raptorRoot, `.${pathname}`);
    if (file !== raptorRoot && !file.startsWith(raptorRoot + sep)) { response.writeHead(403); response.end(); return; }
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const bytes = await readFile(file);
    response.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }); response.end(bytes);
  } catch (error) { response.writeHead(error.code === "ENOENT" ? 404 : 500); response.end(error.code ?? "Read error"); }
});

await mkdir(output, { recursive: true });
await Promise.all([...sourceSnapshot].filter(([url]) => url.startsWith("/src/")).map(async ([url, bytes]) => {
  const destination = join(output, "source", url.slice(5));
  await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes);
}));
const playwright = await discoverPlaywright(), executablePath = discoverBrowser(playwright.chromium);
const results = {
  schemaVersion: 1, startedAt: new Date().toISOString(), config, views, modes, baseline: baselinePath,
  environment: { platform: platform(), arch: arch(), osRelease: release(), node: process.version, playwright: playwright.resolved, playwrightVersion: playwright.version, browserExecutable: executablePath },
  source: { head: git(["rev-parse", "HEAD"]), builderSHA256: sha256(sourceSnapshot.get(config.builder) ?? await readFile(resolve(raptorRoot, `.${config.builder}`))), snapshotSHA256: sha256(JSON.stringify(sourceDigests)), modules: sourceDigests, simRef: options["skip-sim"] ? null : simRef, simReferenceSHA256: referenceSource === null ? null : sha256(referenceSource) },
  cases: [],
};
await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
const baseURL = `http://127.0.0.1:${server.address().port}`;
let browserServer, browser;
try {
  browserServer = await playwright.chromium.launchServer({ executablePath, headless: !options.headed, args: ["--ignore-gpu-blocklist"], timeout: config.timeout });
  browser = await playwright.chromium.connect(browserServer.wsEndpoint());
  results.environment.browserVersion = browser.version();
  for (const backend of backends) for (const model of aircraft) {
    const key = `${model}-${backend}`, directory = join(output, key);
    await mkdir(directory, { recursive: true });
    const context = await browser.newContext({ viewport: { width: config.width, height: config.height }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(config.timeout);
    const result = { key, aircraft: model, requestedBackend: backend, errors: [], warnings: [], requests: [], screenshots: [], checks: [] };
    results.cases.push(result);
    page.on("pageerror", error => result.errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") result.errors.push(message.text()); if (message.type() === "warning") result.warnings.push(message.text()); });
    page.on("requestfailed", request => result.requests.push({ url: request.url(), failure: request.failure()?.errorText }));
    page.on("response", response => { if (response.status() >= 400) result.requests.push({ url: response.url(), status: response.status() }); });
    try {
      await page.goto(`${baseURL}/qa/aircraft.html`, { waitUntil: "load", timeout: config.timeout });
      await page.waitForFunction(() => !!window.__AIRCRAFT_QA);
      const bootStart = Date.now();
      const boot = await evaluate(page, async input => window.__AIRCRAFT_QA.boot(input), { ...config, backend, aircraft: model });
      result.bootMs = Date.now() - bootStart;
      Object.assign(result, boot);
      result.checks.push(...boot.model.checks, ...(boot.rig?.checks ?? []), ...(boot.effects?.checks ?? []), ...(boot.details?.checks ?? []), ...(boot.pose?.checks ?? []));
      const baselineCase = baseline?.cases.find(item => item.key === key);
      for (const view of views) for (const mode of modes) {
        const old = baselineCase?.screenshots.find(item => item.view === view && item.mode === mode);
        if (iouGate !== null && mode === "silhouette" && !old) result.checks.push({ id: `image:baseline-present:${view}`, pass: false, severity: "error", detail: "The requested silhouette gate has no matching baseline screenshot" });
        const capture = await evaluate(page, async ({ view, mode, framing }) => window.__AIRCRAFT_QA.capture(view, mode, framing), { view, mode, framing: old?.framing ?? config.framing ?? null });
        const file = `${view}-${mode}.png`, absolute = join(directory, file);
        const buffer = await page.screenshot({ path: absolute, animations: "disabled" });
        const currentURL = `data:image/png;base64,${buffer.toString("base64")}`;
        let baselineURL = null;
        if (old) baselineURL = `data:image/png;base64,${(await readFile(resolve(dirname(baselinePath), old.path))).toString("base64")}`;
        const image = await evaluate(page, async ({ currentURL, baselineURL, silhouette }) => window.__AIRCRAFT_QA.analyzeImage(currentURL, baselineURL, silhouette), { currentURL, baselineURL, silhouette: mode === "silhouette" });
        const difference = image.difference; delete image.difference;
        const shot = { view, mode, path: `${key}/${file}`, sha256: sha256(buffer), ...capture, image };
        if (difference) {
          shot.differencePath = `${key}/${view}-${mode}-difference.png`;
          await writeFile(join(output, shot.differencePath), Buffer.from(difference.split(",")[1], "base64"));
        }
        if (mode === "silhouette") {
          result.checks.push({ id: `image:nonempty:${view}`, pass: image.occupancy > .001 && image.occupancy < .95, severity: "error", detail: image.occupancy });
          result.checks.push({ id: `image:unclipped:${view}`, pass: !image.clipped, severity: "error", detail: image.silhouetteBounds });
          if (iouGate !== null && image.comparison) result.checks.push({ id: `image:silhouette-iou:${view}`, pass: image.comparison.silhouetteIoU >= iouGate, severity: "error", detail: { actual: image.comparison.silhouetteIoU, minimum: iouGate } });
        }
        result.screenshots.push(shot);
      }
      if (config.frames) {
        await evaluate(page, () => window.__AIRCRAFT_QA.capture("perspective", "beauty"));
        result.timing = await evaluate(page, frames => window.__AIRCRAFT_QA.measure(frames), config.frames);
      }
      if (!options["skip-sim"] && model === aircraft[0]) {
        result.simulation = await evaluate(page, input => window.__AIRCRAFT_QA.simulationRegression(input), { referenceURL: "/src/game/__qa_reference_bandits.js", ticks: config.ticks, seed: config.seed });
        result.checks.push(...result.simulation.checks);
      }
    } catch (error) { result.failure = error.stack ?? error.message; }
    finally { await context.close(); }
    result.errors = [...new Set(result.errors)]; result.warnings = [...new Set(result.warnings)];
    result.pass = !result.failure && !result.errors.length && !result.requests.length && !result.checks.some(check => !check.pass && check.severity === "error");
    await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify({ case: key, pass: result.pass, counts: result.model?.counts, failedChecks: result.checks.filter(check => !check.pass && check.severity === "error"), errors: result.errors, failure: result.failure?.split("\n")[0], output: directory }));
  }
} finally {
  if (browserServer) {
    const kill = setTimeout(() => browserServer.kill().catch(() => {}), 2500);
    await browser?.close().catch(() => {}); await browserServer.close().catch(() => {}); clearTimeout(kill);
  }
  await new Promise(resolveClose => server.close(resolveClose));
  results.finishedAt = new Date().toISOString();
  results.pass = results.cases.length === aircraft.length * backends.length && results.cases.every(result => result.pass);
  await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
  const escape = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const cards = results.cases.map(result => `<section><h2>${escape(result.key)} — ${result.pass ? "PASS" : "FAIL"}</h2><p>${escape(JSON.stringify(result.model?.counts ?? result.failure))}</p><div>${result.screenshots.map(shot => `<figure><a href="${escape(shot.path)}"><img src="${escape(shot.path)}" alt="${escape(`${result.key} ${shot.view} ${shot.mode}`)}"></a><figcaption>${escape(`${shot.view} / ${shot.mode}`)}${shot.image.comparison ? ` · IoU ${shot.image.comparison.silhouetteIoU?.toFixed(4) ?? "n/a"} · RMSE ${shot.image.comparison.rmse255.toFixed(3)}` : ""}${shot.differencePath ? ` · <a href="${escape(shot.differencePath)}">difference</a>` : ""}</figcaption></figure>`).join("")}</div></section>`).join("");
  await writeFile(join(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Aircraft validation</title><style>body{background:#15191f;color:#dce2ea;font:14px system-ui;margin:24px}h1,h2{font-weight:500}section>div{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:14px}figure{margin:0}img{width:100%;display:block}figcaption{padding:8px 0;color:#aebac8}a{color:#a9d5ff}p{overflow-wrap:anywhere}</style><h1>Aircraft validation — ${results.pass ? "PASS" : "FAIL"}</h1><p>True orthographic captures; <a href="results.json">full evidence and checks</a>. ${escape(results.startedAt)}</p>${cards}`);
}
console.log(`Aircraft validation ${results.pass ? "passed" : "failed"}: ${join(output, "results.json")}`);
if (!results.pass) process.exitCode = 1;
