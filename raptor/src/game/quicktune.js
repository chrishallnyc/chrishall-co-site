import * as SETTINGS from './settings.js';

// The handful of changes a pilot needs while learning. All edits use the
// same validated preferences and live-apply path as the full settings menu.
export function mountQuickTune(parent, { expanded = false, onControls } = {}) {
  const s = SETTINGS.current();
  const trackpad = s.pointingDevice === 'trackpad';
  const gain = trackpad ? s.trackpadSensitivity : s.mouseSensitivity;
  const el = document.createElement('details');
  el.className = 'quick-tune'; el.open = expanded;
  el.innerHTML = `<summary><span>Quick tune <small>Your flight stays paused</small></span><span aria-hidden="true">＋</span></summary>
    <div class="quick-tune-body">
      <div class="quick-device" role="group" aria-label="Aim with"><button type="button" class="ui-button" data-quick-device="mouse" aria-pressed="${!trackpad}">Mouse</button><button type="button" class="ui-button" data-quick-device="trackpad" aria-pressed="${trackpad}">MacBook trackpad</button></div>
      <label class="quick-range"><span><b data-quick-gain-label>${trackpad?'Trackpad':'Mouse'} sensitivity</b><output for="quick-gain">${gain.toFixed(2)}×</output></span><input id="quick-gain" type="range" min=".35" max="2" step=".05" value="${gain}" aria-describedby="quick-gain-help"></label>
      <p id="quick-gain-help">Lower for small, precise movements. Higher to turn with less travel.</p>
      <div class="quick-columns"><label class="quick-range"><span><b>Instrument size</b><output for="quick-hud">${Math.round(s.hudScale*100)}%</output></span><input id="quick-hud" type="range" min=".8" max="1.4" step=".05" value="${s.hudScale}"></label><label class="quick-range"><span><b>Volume</b><output for="quick-volume">${Math.round(s.masterVol*100)}%</output></span><input id="quick-volume" type="range" min="0" max="1" step=".05" value="${s.masterVol}"></label></div>
      <div class="quick-switches"><label><input data-quick-invert type="checkbox" ${s.invertY?'checked':''}> Invert vertical aim</label><label><input data-quick-muted type="checkbox" ${s.muted?'checked':''}> Mute sound</label></div>
      <div class="quick-footer"><span data-quick-save role="status">${SETTINGS.storageAvailable()?'Saved automatically in this browser':'Storage unavailable · this session only'}</span><button type="button" class="text-button" data-quick-controls>Test aim & edit keys ↗</button></div>
    </div>`;
  parent.append(el);
  const save = patch => {
    const result = SETTINGS.saveSettings(patch);
    el.querySelector('[data-quick-save]').textContent = SETTINGS.storageAvailable() ? 'Saved · ready when you resume' : 'Storage unavailable · this session only';
    return result;
  };
  const gainInput = el.querySelector('#quick-gain');
  for (const button of el.querySelectorAll('[data-quick-device]')) button.onclick = () => {
    const next = save({pointingDevice:button.dataset.quickDevice});
    const isTrackpad = next.pointingDevice === 'trackpad';
    for (const b of el.querySelectorAll('[data-quick-device]')) b.setAttribute('aria-pressed',String(b.dataset.quickDevice===next.pointingDevice));
    gainInput.value = isTrackpad ? next.trackpadSensitivity : next.mouseSensitivity;
    el.querySelector('[data-quick-gain-label]').textContent = `${isTrackpad?'Trackpad':'Mouse'} sensitivity`;
    el.querySelector('output[for="quick-gain"]').textContent = Number(gainInput.value).toFixed(2)+'×';
  };
  gainInput.oninput = () => {
    const key = SETTINGS.current().pointingDevice==='trackpad'?'trackpadSensitivity':'mouseSensitivity';
    save({[key]:Number(gainInput.value)});
    el.querySelector('output[for="quick-gain"]').textContent = Number(gainInput.value).toFixed(2)+'×';
  };
  for (const [id,key] of [['quick-hud','hudScale'],['quick-volume','masterVol']]) {
    const range=el.querySelector('#'+id);
    range.oninput=()=>{save({[key]:Number(range.value)});el.querySelector(`output[for="${id}"]`).textContent=Math.round(Number(range.value)*100)+'%';};
  }
  el.querySelector('[data-quick-invert]').onchange=e=>save({invertY:e.target.checked});
  el.querySelector('[data-quick-muted]').onchange=e=>save({muted:e.target.checked});
  el.querySelector('[data-quick-controls]').onclick=()=>onControls?.();
  return el;
}
