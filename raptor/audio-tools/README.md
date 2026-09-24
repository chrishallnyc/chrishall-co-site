# Audio authoring and listening comparisons

This workflow captures real browser output, measures it, and creates blind,
level-matched listening comparisons. It makes no automatic claim that a version
sounds better. The game has no dependency on these development tools.

## Silent real-time stability soak

With the local server below running, open
`http://127.0.0.1:5181/audio-tools/soak.html` and click **Start silent soak**.
The default is ten minutes. Set the duration to `24h` for a full day, or use
`?duration=24h&batch=soak-day-01`. The tool does not keep the computer awake or
change its power settings. Leave the machine running normally; sleep or browser
throttling is recorded and prevents a continuous-duration pass.

For a short check covering the complete 120-second recipe and four bus
recreations, use
`http://127.0.0.1:5181/audio-tools/soak.html?duration=130s&recreate=30&batch=soak-smoke-01`.
Use a new capture name for each run. Browser automation can also call:

```js
const run = await (await import('/audio-tools/soak.mjs')).startSoak({
  duration: '24h', batch: 'soak-day-01', recreateSeconds: 300,
});
// run.snapshot() gives progress; run.stop() stops early without a pass.
const result = await run.done;
```

The graph's initial destination is a zero-gain hardware safeguard. An
AudioWorklet measures every rendered PCM block before independently writing
zeros, so bus construction and recreation cannot leak sound to the speakers.
The workload includes both engine perspectives, recorded afterburner texture,
cannon bursts, warnings, radio ducking, gear travel, runway/brakes, fuel loss,
moving aircraft and missiles, delayed explosions, saturated transient queues,
pause/mute transitions, and disposal/recreation. This is a seeded DSP workload,
not a replay of a flight-simulation session. Each two-minute cycle uses solved
spool input for its first minute and default throttle-command response for its
second. Gear airflow follows the recipe's IAS and actuator exposure; loaded
runway contact uses explicit unit ground load rather than aerodynamic G.

Files are written under `.context/audio-review/<batch>/raw/`: `manifest.json`
contains frozen audio module snapshots, SHA-256 hashes, the exact texture hash,
and browser/sample-rate details; `minute-0001.json` and subsequent files contain
per-minute PCM and resource measurements; `latest.json` is the checkpoint;
`result.json` contains the terminal verdict and UTC start/end times. No audio
is uploaded or recorded during the soak. An interrupted tab may only leave a
running checkpoint; that is not a completed result.

Completion requires the requested duration of actual metered PCM, no detected
nonfinite/clipped samples, no unexpected persistent silence, no orphaned looping
sources or exceeded voice budget, and no unplanned clock/scheduler interruption.
Intentional context suspension for bus replacement is reported separately;
abnormally long replacements also disqualify continuous completion. Active
source counts include future scheduled transients. Optional browser JS heap
samples do not measure native audio memory or prove garbage-collector behavior.
These checks establish stability and bounds, not perceived sound quality.

Pure harness regressions run without a browser:

```sh
node --test raptor/tests/audio-soak.test.mjs
```

## Listening captures

From the repository root:

```sh
python3 -m venv .context/audio-analysis-venv
.context/audio-analysis-venv/bin/pip install -r raptor/audio-tools/requirements.txt
python3 raptor/audio-tools/server.py --port 5181
```

The server binds to `127.0.0.1`, accepts only its local hostnames, rejects
cross-site capture writes, and confines resolved file paths to the selected
static/capture directories. It serves the entire chosen capture directory, so
use a dedicated output folder for listening artifacts. The Python process adds
`/capture/`, `/review/`, and `/__baseline.js` only while running locally; static
hosting does not execute the server or expose a file-writing endpoint. Restart
the local server after changing its Python source; an existing process keeps
its previously loaded handler.

Open
`http://127.0.0.1:5181/audio-tools/render.html`, choose a new capture name for each
revision, and render the comparison. The baseline defaults to the preserved
`baselines/original-audio.js`, copied byte-for-byte from the commit recorded in
`baselines/original-audio.provenance.json`; use `--baseline` to select another
original snapshot. This development fixture intentionally retains the original
prototype’s defects and is never loaded by the game.
FFmpeg must be installed for analysis.

The local HTTP boundary has isolated filesystem regressions:

```sh
python3 raptor/audio-tools/test_server.py
```

The capture page can also run from browser automation:

```js
await (await import('/audio-tools/render.mjs')).renderStudy({
  batch: 'revision-02',
  // Optional subset; omit for the whole study.
  names: ['power-sweep', 'military', 'cannon', 'combat'],
})
```

The renderer freezes the entry module and its local import graph before the
first scene, so a concurrent edit cannot change later scenes in the same batch.
The capture includes snapshots/hashes of these modules and a hash of each final
WAV. Candidate renders load the production texture by default, await readiness,
and record its status and asset hash; pass `loadSamples: false` for a procedural
fallback study. Relative asset URLs retain their original module base. The manifest records
the adapter needed by the original implementation:
context injection, disabled gesture handlers for offline rendering, and a fixed
RNG for its formerly random cannon. Its DSP and mix gains remain unchanged.

Generate the analysis, listening WAVs, and blind player:

```sh
.context/audio-analysis-venv/bin/python raptor/audio-tools/analyze.py \
  .context/audio-review/revision-02
```

Open `http://127.0.0.1:5181/review/revision-02/blind/index.html`. The player switches
between two synchronized sources, offers a common mono control, saves notes
locally, exports them, and reveals the random A/B mapping on request. The
generated `report.md`, `analysis.json`, raw WAVs, matched WAVs, and figures stay
under `.context/`. `--no-plots` skips the plotting backend when only audio and
measurements are needed quickly.

The newer world sounds have dedicated 20 Hz motion recipes. They have no
equivalent in the original implementation and are captured separately:

```js
await (await import('/audio-tools/render.mjs')).renderStudy({
  batch: 'world-01',
  versions: ['candidate'],
  names: ['moving-aircraft', 'missile-passes', 'airframe-ground', 'dense-world'],
})
```

These isolate a fighter flyby; identical missile passes under boost, sustain,
and coast; gear/touchdown/decelerating runway sounds; and a dense combined mix
with audio-clock propagation delays. Markers and all source-module snapshots
are written to the manifest. Compare subsequent captures of these recipes to
the earlier world-sound revision, rather than treating the original game's
absence of those sounds as an equivalent listening reference. The same analysis
command measures these individual captures and prepares labeled listening WAVs;
it does not invent a baseline or create a false A/B pair.

Each pair uses a common integrated-loudness target, normally −23 LUFS. If either
source would exceed −3 dBTP, both are matched to a lower target. Only static gain
is applied, so no added compressor changes one source's dynamics during the
comparison. Matched copies are dithered 16-bit PCM WAVs; untouched captures are
32-bit float WAVs. These are listening-study levels, not mandatory game targets.

The analysis uses FFmpeg's EBU R128/BS.1770 loudness and true-peak measurement. It
also reports spectra, stereo correlation, mono fold-down, crest factor, and
waveform recurrence below 1 kHz. These diagnostics can expose excessive isolated
tones, exact repeats, phase cancellation, or level bias. They do not determine
perceptual realism, roughness, fatigue, or preference. Loudness Range is omitted
because these clips are shorter than the one-minute duration recommended for
interpreting that measure in [EBU R128](https://tech.ebu.ch/docs/r/r128.pdf).

Record actual listener judgments separately. Automated audio critiques must pass
an identical-input control and order reversal before comparative preferences
are trusted. The audio model tested during this production pass failed the
identical-input control, so its comparative preferences are excluded from
acceptance evidence. It must never be presented as human listening. The original implementation has no spatial
combat effects, so the combat scene compares entire experiences. Engine and
cannon scenes support closer comparisons of equivalent events.

## Native HRTF offline preparation

Chrome 154 can stall when the first HRTF panner is created inside an
`OfflineAudioContext.suspend()` callback. World captures and spatial tests retain
a silent HRTF panner before `startRendering()`, which lets the browser initialize
its native HRTF database before rendering. No sleep, equal-power substitution,
or production audio change is involved. `hrtf-probe.html` isolates precreated,
dynamic, primed, and live controls; the live graph is measured before a silent
output gate. A timeout is a diagnostic failure, never a passing result.

## Optional API critic and local spend estimates

`api_listen.py` is an explicit command-line research tool. The game and authoring
server do not call it. `status` is offline; `listen` requires `OPENAI_API_KEY`
and explicitly named project-local clips and a prompt. It sends those selected
clips and the prompt to OpenAI. The API key is read from the environment and is
not printed or written to reports. Reports do store prompts, model responses,
file names/hashes and returned usage data under `.context/audio-production/`.

The helper's budget constants and dated pricing estimates belong to this
production session. Its totals combine the local critique ledger with estimates
from agent logs listed in `.context/agent-usage-baseline.json`; missing meters
disable paid calls. A fresh checkout does not contain those local meter files.
These estimates are not provider invoices, do not inspect account billing, and
cannot enforce an account-wide spending limit or include unrelated requests.
Review the constants and meter coverage before choosing to use the helper in a
new session. An uncertain request retains its reservation, and failed requests
are never automatically retried. The critic failed the identical-input control
during this production pass; its preference judgments are not acceptance evidence.
