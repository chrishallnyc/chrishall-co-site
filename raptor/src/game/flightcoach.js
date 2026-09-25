// A small flight school built from aircraft telemetry. The course is pure and
// deterministic; the DOM adapter only redraws telemetry four times a second.
// No scene objects, simulator commands, or input bindings belong to the coach.
import { bindingLabel, escapeHTML } from './ui.js';

export const FLIGHT_SCHOOL_KEY = 'raptor.flight-school.v1';
export const LESSONS = Object.freeze([
  Object.freeze({ id: 'steady', title: 'Find level flight', seconds: 4 }),
  Object.freeze({ id: 'throttle', title: 'Set your own pace', seconds: 3 }),
  Object.freeze({ id: 'turn', title: 'Make a gentle turn', seconds: 3 }),
  Object.freeze({ id: 'climb', title: 'Climb, then level off', seconds: 3 }),
  Object.freeze({ id: 'cruise', title: 'Bring it all together', seconds: 4 }),
]);

export function headingDifference(target, current) {
  return ((target - current) % 360 + 540) % 360 - 180;
}
const normalizeHeading = heading => ((heading % 360) + 360) % 360;
const finiteTelemetry = t => t && ['heading', 'altFt', 'pitch', 'roll', 'speedKt', 'throttle'].every(key => Number.isFinite(t[key]));
const storageDefault = () => { try { return globalThis.localStorage; } catch { return null; } };

export function readSchoolRecord(storage = storageDefault()) {
  try {
    const value = JSON.parse(storage?.getItem(FLIGHT_SCHOOL_KEY) || 'null');
    if (value?.version !== 1 || !Number.isFinite(value.completedAt) || value.completedAt <= 0 || !Number.isInteger(value.completions) || value.completions < 1) return null;
    return { version: 1, completedAt: value.completedAt, completions: Math.min(value.completions, 9999) };
  } catch { return null; }
}

export class TrainingCourse {
  constructor({ storage = storageDefault(), now = Date.now, resumeCompleted = true } = {}) {
    this.storage = storage;
    this.now = now;
    this.record = readSchoolRecord(storage);
    this.saved = this.record ? true : null;
    this.status = this.record && resumeCompleted ? 'complete' : 'active';
    this.index = this.status === 'complete' ? LESSONS.length - 1 : 0;
    this.held = this.status === 'complete' ? LESSONS[this.index].seconds : 0;
    this.slip = 0;
    this.elapsed = 0;
    this.initialized = false;
    this.lastCrashes = null;
    this.recoveries = 0;
    this.paused = false;
    this.inTarget = false;
    this.targetHeading = 0;
    this.targetAltitude = 0;
    this.notice = '';
    this.telemetry = null;
  }

  anchor(telemetry) {
    if (!finiteTelemetry(telemetry)) { this.initialized = false; return; }
    this.targetHeading = normalizeHeading(telemetry.heading + 30);
    this.targetAltitude = Math.ceil((telemetry.altFt + 400) / 100) * 100;
    this.lastCrashes = Number.isFinite(telemetry.crashes) ? telemetry.crashes : this.lastCrashes;
    this.initialized = true;
    this.telemetry = telemetry;
  }

  setPaused(paused) { this.paused = !!paused; }

  reset({ replay = false, telemetry = this.telemetry } = {}) {
    if (replay) { this.index = 0; this.status = 'active'; this.elapsed = 0; this.recoveries = 0; }
    this.held = 0;
    this.slip = 0;
    this.inTarget = false;
    this.notice = replay ? 'A fresh flight school session. Take it one step at a time.' : 'Aircraft settled. The current exercise has a fresh target.';
    this.anchor(telemetry);
  }

  freeFlight() { this.status = 'free'; this.held = 0; this.slip = 0; }

  // A pause or a long frame cannot earn several seconds of unseen progress.
  // Small slips are forgiven; sustained misses gradually drain the hold meter.
  update(dt, telemetry, { paused = this.paused } = {}) {
    if (paused || this.status !== 'active' || !finiteTelemetry(telemetry) || !Number.isFinite(dt) || dt <= 0) return false;
    const step = Math.min(dt, 0.25);
    this.telemetry = telemetry;
    if (!this.initialized) this.anchor(telemetry);
    if (Number.isFinite(telemetry.crashes) && this.lastCrashes !== null && telemetry.crashes !== this.lastCrashes) {
      this.recoveries++;
      this.reset({ telemetry });
      this.notice = 'You have a fresh aircraft. This exercise is ready to try again.';
      return true;
    }
    if (Number.isFinite(telemetry.crashes)) this.lastCrashes = telemetry.crashes;
    this.elapsed += step;
    const safe = telemetry.speedKt >= 150 && (!Number.isFinite(telemetry.aglFt) || telemetry.aglFt > 300);
    const flat = Math.abs(telemetry.pitch) <= 7 && Math.abs(telemetry.roll) <= 12;
    switch (LESSONS[this.index].id) {
      case 'steady': this.inTarget = safe && flat; break;
      case 'throttle': this.inTarget = safe && telemetry.throttle >= 60 && telemetry.throttle <= 70 && Math.abs(telemetry.pitch) <= 12 && Math.abs(telemetry.roll) <= 20; break;
      case 'turn': this.inTarget = safe && Math.abs(headingDifference(this.targetHeading, telemetry.heading)) <= 7 && Math.abs(telemetry.roll) <= 15 && Math.abs(telemetry.pitch) <= 10; break;
      case 'climb': this.inTarget = safe && Math.abs(telemetry.altFt - this.targetAltitude) <= 140 && flat; break;
      case 'cruise': this.inTarget = safe && flat && telemetry.throttle >= 80 && telemetry.throttle <= 95; break;
    }
    if (this.inTarget) { this.held += step; this.slip = 0; }
    else {
      const priorSlip = this.slip;
      this.slip += step;
      const decaySeconds = Math.max(0, this.slip - 0.6) - Math.max(0, priorSlip - 0.6);
      this.held = Math.max(0, this.held - decaySeconds * 0.65);
    }
    if (this.held + 1e-8 < LESSONS[this.index].seconds) return false;
    if (this.index === LESSONS.length - 1) {
      this.status = 'complete';
      this.held = LESSONS[this.index].seconds;
      this.notice = 'Flight school complete. You can hold a steady course, manage throttle, turn and climb.';
      const record = { version: 1, completedAt: this.now(), completions: Math.min(9999, (this.record?.completions || 0) + 1) };
      this.record = record;
      try {
        if (!this.storage) throw new Error('Storage unavailable');
        this.storage.setItem(FLIGHT_SCHOOL_KEY, JSON.stringify(record));
        this.saved = true;
      } catch { this.saved = false; }
    } else {
      const title = LESSONS[this.index].title;
      this.index++;
      this.held = 0;
      this.slip = 0;
      this.inTarget = false;
      this.anchor(telemetry);
      this.notice = `${title} complete. Next: ${LESSONS[this.index].title.toLowerCase()}.`;
    }
    return true;
  }

  snapshot() {
    const lesson = LESSONS[this.index];
    return {
      status: this.status, step: this.index + 1, total: LESSONS.length,
      id: lesson.id, title: lesson.title, duration: lesson.seconds,
      held: Math.min(lesson.seconds, this.held), progress: Math.min(1, this.held / lesson.seconds),
      targetHeading: this.targetHeading, targetAltitude: this.targetAltitude,
      inTarget: this.inTarget, saved: this.saved, earned: !!this.record,
      notice: this.notice, recoveries: this.recoveries,
    };
  }
}

const headingText = value => `${String(Math.round(normalizeHeading(value)) % 360).padStart(3, '0')}°`;
const altitudeText = value => `${Math.round(value).toLocaleString()} ft`;

// Telemetry is useful while a player is adjusting the aircraft; status changes
// are announced once, while frequent numeric updates remain quiet for AT.
export class FlightCoach {
  constructor({ state, input, container, onRecover, onControls, onCampaign, onHide, getSettings = () => ({}), storage = storageDefault() } = {}) {
    Object.assign(this, { state, input, onRecover, onControls, onCampaign, onHide, getSettings });
    this.course = new TrainingCourse({ storage });
    this.visible = true;
    this.paused = false;
    this.paintElapsed = 0;
    this.el = document.createElement('aside');
    this.el.className = 'flight-coach practice-checklist';
    this.el.dataset.gameUi = '';
    this.el.setAttribute('aria-label', 'Flight school');
    (container || document.body).append(this.el);
    this.onBindings = () => this.refresh();
    window.addEventListener('raptor-bindings-change', this.onBindings);
    window.addEventListener('raptor-settings-change', this.onBindings);
    this.refresh();
  }

  readTelemetry() {
    const player = this.state?.player;
    const data = player?.hudState?.();
    if (!data) return null;
    data.crashes = player.crashes;
    const agl = player.fm?.out?.agl;
    // Before the first simulation tick, the derived AGL value is still zero.
    if (this.state?.sim?.time > 0 && Number.isFinite(agl)) data.aglFt = agl * 3.28084;
    return data;
  }

  setVisible(visible) { this.visible = !!visible; this.el.hidden = !this.visible || this.paused; }
  setPaused(paused) { this.paused = !!paused; this.course.setPaused(paused); this.el.hidden = !this.visible || this.paused; this.paintElapsed = 0; }

  reset({ replay = false } = {}) {
    this.course.reset({ replay, telemetry: this.readTelemetry() });
    this.refresh();
  }

  retry() {
    // The cockpit owns recovery and clearing queued input; the course only
    // reanchors after the aircraft has actually moved to its safe position.
    this.onRecover?.();
    this.reset();
    this.focusFlight();
  }

  replay() {
    this.onRecover?.();
    this.reset({ replay: true });
    this.focusFlight();
  }

  freeFlight() { this.course.freeFlight(); this.refresh(); this.focusFlight(); }

  // Live coach buttons return to flying. Leaving focus on a game-UI button
  // would correctly suppress flight shortcuts until the pilot clicked the
  // canvas again. Paused menu actions must keep the native dialog's focus.
  focusFlight() {
    if (this.paused || this.state?.paused || document.querySelector('dialog[open]')) return;
    document.getElementById('game')?.focus({ preventScroll: true });
  }

  update(dt, telemetry = this.readTelemetry()) {
    const wasInTarget = this.course.inTarget;
    const hadTelemetry = !!this.course.telemetry;
    const changed = this.course.update(dt, telemetry, { paused: this.paused || this.state?.paused });
    if (changed) { this.refresh(); this.paintElapsed = 0; return changed; }
    this.paintElapsed += Math.max(0, Math.min(0.25, Number.isFinite(dt) ? dt : 0));
    if (this.visible && !this.paused && !this.state?.paused) {
      const numeric = this.paintElapsed >= 0.25 || !hadTelemetry;
      // Target entry/exit must acknowledge the maneuver on this frame. Keep
      // rapidly changing readouts at 4 Hz and preserve their existing nodes.
      if (numeric || this.course.inTarget !== wasInTarget) this.paintTelemetry({ numeric });
      if (numeric) this.paintElapsed %= 0.25;
      if (this.progressEl && this.progressEl.value !== this.course.held) this.progressEl.value = this.course.held;
    }
    return changed;
  }

  refresh() {
    const s = this.course.snapshot();
    const key = id => `<kbd>${escapeHTML(bindingLabel(this.input, id))}</kbd>`;
    const trackpad = this.getSettings().pointingDevice === 'trackpad';
    const pointing = trackpad ? 'Slide one finger on the trackpad, without clicking. Lift and reposition between strokes.' : 'Move the mouse gently. Small movements are enough.';
    this.el.classList.toggle('complete', s.status === 'complete');
    this.el.classList.toggle('coach-free', s.status === 'free');
    let body;
    if (s.status === 'active') {
      const instructions = {
        steady: `${pointing} Keep the horizon nearly level. ${key('recenter_aim')} aligns the aim with your current flight path.`,
        throttle: `Ease down with ${key('throttle_down')} until throttle is 60–70%, then release. ${key('throttle_up')} adds power if you go too far.`,
        turn: `Point slightly right toward heading <b>${headingText(s.targetHeading)}</b>. Let the aircraft follow; bring your aim back near the horizon as you arrive. ${key('roll_left')} / ${key('roll_right')} can help you bank.`,
        climb: `Aim a little above the horizon, or tap ${key('pitch_up')}. Approach <b>${altitudeText(s.targetAltitude)}</b>, then lower your aim gently to level off. ${key('pitch_down')} lowers the nose.`,
        cruise: `Use ${key('throttle_up')} / ${key('throttle_down')} to set 80–95% throttle. Keep a level attitude and let the aircraft settle.`,
      };
      body = `<div class="coach-eyebrow"><span>FLIGHT SCHOOL</span><span>${s.step} / ${s.total}</span></div><h3 tabindex="-1">${escapeHTML(s.title)}</h3>
        <ol class="coach-course" aria-label="Flight school exercises">${LESSONS.map((lesson, index) => `<li class="${index < this.course.index ? 'done' : index === this.course.index ? 'current' : ''}" ${index === this.course.index ? 'aria-current="step"' : ''} title="${escapeHTML(lesson.title)}"><span class="coach-visually-hidden">${index < this.course.index ? 'Complete: ' : ''}${escapeHTML(lesson.title)}</span></li>`).join('')}</ol>
        <p class="coach-instruction">${instructions[s.id]}</p><div class="coach-readout" data-coach-readout></div>
        <div class="coach-hold"><span data-coach-feedback>Find the target, then hold steady</span><span data-coach-seconds>0 / ${s.duration}s</span></div>
        <progress max="${s.duration}" value="${s.held}" aria-label="Seconds held on target"></progress>
        <p class="coach-reassurance">Small corrections. A brief wobble is okay.</p>
        <div class="coach-actions"><button type="button" class="ui-button" data-coach-retry>Reset to level flight</button><button type="button" class="text-button" data-coach-controls>Adjust controls</button></div>
        <div class="coach-footer"><button type="button" class="text-button" data-coach-free>Just fly</button><button type="button" class="text-button" data-hide-checklist>Hide coach</button></div>`;
    } else if (s.status === 'complete') {
      body = `<div class="coach-eyebrow"><span>FLIGHT SCHOOL</span><span>5 / 5 ✓</span></div><h3 tabindex="-1">Ready for your first mission</h3><p>You can hold a steady course, manage throttle, turn and climb.</p><p class="coach-save ${s.saved === false ? 'unsaved' : ''}">${s.saved === false ? 'Completed this session. Your browser could not save this achievement.' : 'Flight school complete · saved in this browser'}</p><div class="coach-actions"><button type="button" class="ui-button" data-first-mission>Explore the campaign ↗</button></div><div class="coach-footer"><button type="button" class="text-button" data-coach-replay>Fly the course again</button><button type="button" class="text-button" data-hide-checklist>Hide coach</button></div>`;
    } else {
      body = `<div class="coach-eyebrow"><span>PRACTICE</span><span>${s.earned ? 'QUALIFIED ✓' : 'NO PRESSURE'}</span></div><h3 tabindex="-1">Your airspace. Your pace.</h3><p>No enemies or clock. Try your setup, explore the landscape, and recover whenever you need.</p><div class="coach-actions"><button type="button" class="ui-button" data-coach-retry>Reset to level flight</button></div><div class="coach-footer"><button type="button" class="text-button" data-coach-replay>${s.earned ? 'Replay' : 'Start'} flight school</button><button type="button" class="text-button" data-hide-checklist>Hide coach</button></div>`;
    }
    // Rebuilding is limited to exercise/binding changes, so the live readings
    // never remove a focused button while someone is using keyboard navigation.
    const focusedAction = this.el.contains(document.activeElement) ? Object.keys(document.activeElement.dataset).find(name => name.startsWith('coach') || name === 'hideChecklist' || name === 'firstMission') : null;
    this.el.innerHTML = body + '<p class="coach-visually-hidden" role="status" aria-live="polite" data-coach-announcement></p>';
    this.progressEl = this.el.querySelector('progress');
    const bind = (selector, fn) => this.el.querySelector(selector)?.addEventListener('click', fn);
    bind('[data-coach-retry]', () => this.retry());
    bind('[data-coach-replay]', () => this.replay());
    bind('[data-coach-free]', () => this.freeFlight());
    bind('[data-coach-controls]', () => this.onControls?.());
    bind('[data-first-mission]', () => this.onCampaign?.());
    bind('[data-hide-checklist]', () => { this.setVisible(false); this.onHide?.(); this.focusFlight(); });
    if (focusedAction) {
      const name = focusedAction.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
      (this.el.querySelector(`[data-${name}]`) || this.el.querySelector('h3'))?.focus({ preventScroll: true });
    }
    this.el.querySelector('[data-coach-announcement]').textContent = s.notice;
    this.paintTelemetry();
    this.el.hidden = !this.visible || this.paused;
  }

  paintTelemetry({ numeric = true } = {}) {
    if (this.course.status !== 'active') return;
    const telemetry = this.course.telemetry;
    const s = this.course.snapshot();
    const readout = this.el.querySelector('[data-coach-readout]');
    if (!telemetry || !readout) return;
    let current, target, feedback;
    if (s.id === 'throttle' || s.id === 'cruise') {
      current = `${Math.round(telemetry.throttle)}% throttle`;
      target = s.id === 'throttle' ? 'Target 60–70%' : 'Target 80–95%';
      const low = s.id === 'throttle' ? 60 : 80, high = s.id === 'throttle' ? 70 : 95;
      feedback = telemetry.throttle > high ? 'Ease off the throttle' : telemetry.throttle < low ? 'Add a little power' : 'Settle the aircraft';
    } else if (s.id === 'turn') {
      current = `Heading ${headingText(telemetry.heading)}`;
      target = `Target ${headingText(s.targetHeading)}`;
      const difference = headingDifference(s.targetHeading, telemetry.heading);
      feedback = Math.abs(difference) > 7 ? `${Math.abs(Math.round(difference))}° ${difference > 0 ? 'right' : 'left'} to target` : 'Ease the bank and settle';
    } else if (s.id === 'climb') {
      current = altitudeText(telemetry.altFt);
      target = `Target ${altitudeText(s.targetAltitude)}`;
      const difference = s.targetAltitude - telemetry.altFt;
      feedback = difference > 140 ? 'Raise the nose gently' : difference < -140 ? 'Lower the nose gently' : 'At your altitude. Level off';
    } else {
      current = `${Math.round(Math.abs(telemetry.roll))}° bank · ${Math.round(telemetry.pitch)}° pitch`;
      target = 'Wings level · nose near horizon';
      feedback = Math.abs(telemetry.roll) > 12 ? 'Ease the bank; aim near the horizon' : 'Bring the nose near the horizon';
    }
    if (telemetry.speedKt < 150) feedback = 'Low airspeed. Add power and lower the nose';
    else if (Number.isFinite(telemetry.aglFt) && telemetry.aglFt <= 300) feedback = 'Close to terrain. Climb or reset to level flight';
    else if (s.inTarget) feedback = 'On target. Hold steady';
    if (numeric) {
      readout.innerHTML = `<strong>${escapeHTML(current)}</strong><span>${escapeHTML(target)}</span>`;
      this.el.querySelector('[data-coach-seconds]').textContent = `${Math.min(s.duration, s.held).toFixed(1)} / ${s.duration}s`;
    }
    this.el.querySelector('[data-coach-feedback]').textContent = feedback;
    this.el.querySelector('progress').value = s.held;
    this.el.classList.toggle('on-target', s.inTarget);
  }

  destroy() {
    window.removeEventListener('raptor-bindings-change', this.onBindings);
    window.removeEventListener('raptor-settings-change', this.onBindings);
    this.el.remove();
  }
}
