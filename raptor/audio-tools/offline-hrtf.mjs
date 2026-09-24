// Authoring/test-only preparation for native OfflineAudioContext renders.
// Chrome 154 can stall if the context's first HRTF panner is constructed from
// a suspend() callback. A retained, silent panner present at startRendering()
// lets the browser initialize its HRTF database before rendering begins.
// No wall-clock sleep, panning substitution, or production graph change.
// The minimal matrix and live controls are in hrtf-probe.html.
export function prepareOfflineHrtf(context) {
  if (typeof context.startRendering !== 'function') throw new TypeError('Offline context required');
  const panner = context.createPanner();
  panner.panningModel = 'HRTF';
  const silence = context.createGain();
  silence.gain.value = 0;
  panner.connect(silence).connect(context.destination);
  return () => { panner.disconnect(); silence.disconnect(); };
}
