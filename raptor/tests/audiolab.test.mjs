// Native lab lifecycle regressions. Open /audiolab.html, enable sound, then run:
//   await (await import('/tests/audiolab.test.mjs')).runAudioLabTests()
// The foreground-stall test deliberately blocks this test tab for 2.2 seconds.
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

const tests = [
  ['a long foreground frame gap cancels the showcase before replaying old cues', async lab => {
    lab.setPreset('afterburner');
    lab.setView('external');
    assert(await lab.startShowcase(), 'showcase must start');
    await nextFrame();
    const before = lab.bus.ctx.currentTime;
    const until = performance.now() + 2200;
    while (performance.now() < until) { /* reproduce a bounded foreground long task */ }
    const elapsed = lab.bus.ctx.currentTime - before;
    assert(elapsed > 2, 'the native audio clock must keep advancing during the foreground stall');
    await nextFrame();
    assert(!lab.demoPlaying, 'a long frame gap must cancel the showcase');
    lab.assertStopped();
    assert(document.getElementById('demoStatus').textContent.includes('interrupted'), 'show a clear restart message');
    assert(lab.engine.state.ab === 1 && lab.engine.state.view === 'external' && lab.engine.state.active,
      'interruption must restore the original flight state');
    await wait(150);
    lab.assertStopped();
    return { elapsedAudioSeconds: elapsed, restoredAfterburner: lab.engine.state.ab, pendingCues: lab.auditionState.pendingCues };
  }],
  ['an intentional pause resets the frame-gap tracker and resumes the showcase', async lab => {
    assert(await lab.startShowcase(), 'showcase must start');
    await nextFrame();
    lab.setPaused(true);
    const frozen = lab.auditionState.elapsed, before = lab.bus.ctx.currentTime;
    await wait(2200);
    assert(lab.bus.ctx.currentTime - before > 2, 'the pause must cover the foreground-gap threshold');
    assert(lab.auditionState.elapsed === frozen, 'intentional pause must preserve showcase position');
    lab.setPaused(false);
    await wait(120);
    assert(lab.demoPlaying, 'resuming an intentional pause must not trigger the interrupted-playback cutoff');
    const resumed = lab.auditionState.elapsed;
    assert(resumed >= frozen && resumed - frozen < 0.4, 'resume must continue near the frozen position');
    lab.stopAll();
    lab.assertStopped();
    return { frozen, resumed, pendingCues: lab.auditionState.pendingCues };
  }],
];

export async function runAudioLabTests({ log = false } = {}) {
  const lab = window.__AUDIOLAB;
  assert(lab?.ready && lab.enabled && lab.bus.ctx.state === 'running' && !document.hidden,
    'Run on the visible audio lab after enabling sound');
  const results = [], started = performance.now();
  for (const [name, run] of tests) {
    lab.setPaused(false);
    lab.stopAll();
    const began = performance.now();
    try { results.push({ name, status: 'passed', metrics: await run(lab), durationMs: Math.round(performance.now() - began) }); }
    catch (error) { results.push({ name, status: 'failed', error: error.stack || error.message, durationMs: Math.round(performance.now() - began) }); }
    finally { lab.stopAll(); lab.setPaused(false); }
    if (log) console.info(`[audiolab] ${results.at(-1).status}: ${name}`);
  }
  return { passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length, durationMs: Math.round(performance.now() - started), tests: results };
}
