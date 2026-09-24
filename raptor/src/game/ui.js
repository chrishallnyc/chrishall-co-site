// Shared DOM affordances for the hangar and paused flight menus.
import { current } from './settings.js';
export const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const jetMark = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 4 38 22 56 35 39 38 37 48 43 56 32 52 21 56 27 48 25 38 8 35 26 22Z" fill="currentColor"/></svg>`;

export function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
export function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export class GameDialog {
  constructor({title, label = '', className = '', onClose} = {}) {
    this.onClose = onClose;
    this.el = document.createElement('dialog');
    this.el.className = `game-dialog ${className}`;
    this.el.innerHTML = `<div class="dialog-header"><div><p class="eyebrow">${escapeHTML(label)}</p><h2 tabindex="-1">${escapeHTML(title)}</h2></div><button type="button" class="ui-button icon-button" aria-label="Close ${escapeHTML(title)}">✕</button></div><div class="dialog-body"></div>`;
    this.body = this.el.querySelector('.dialog-body');
    this.el.setAttribute('aria-label', title);
    document.body.append(this.el);
    this.el.querySelector('.icon-button').addEventListener('click', () => this.close());
    this.el.addEventListener('close', () => {
      if (this.returnFocus?.isConnected) this.returnFocus.focus({preventScroll:true});
      const next=this.afterCloseAction;this.afterCloseAction=null;
      if(next)next();else this.onClose?.();
    });
    this.el.addEventListener('click', (e) => {
      if (e.target !== this.el) return;
      const r = this.el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) this.close();
    });
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  show() {
    if (this.el.open) return;
    this.returnFocus = document.activeElement;
    this.el.showModal();
    this.el.querySelector('h2').focus();
  }
  close() { if (this.el.open) this.el.close(); }
  get open() { return this.el.open; }
}

export function confirmAction({title, message, action = 'Continue', onConfirm}) {
  const dialog = new GameDialog({title, label:'Confirm action', className:'confirm-dialog', onClose:() => dialog.el.remove()});
  dialog.body.innerHTML = `<p class="dialog-intro">${escapeHTML(message)}</p><div class="dialog-actions"><button class="ui-button" data-cancel type="button">Cancel</button><button class="ui-button primary" data-confirm type="button">${escapeHTML(action)}</button></div>`;
  dialog.body.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.body.querySelector('[data-confirm]').onclick = () => { dialog.close(); onConfirm(); };
  dialog.show();
  dialog.body.querySelector('[data-cancel]').focus();
  return dialog;
}

export function fullscreen(button) {
  const action = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
  Promise.resolve(action).catch(() => {
    if (button) {button.textContent = 'Fullscreen unavailable'; setTimeout(() => button.textContent = 'Fullscreen', 2500);}
  });
}

const NAMED_KEYS = {Mouse0:'Left click',Mouse1:'Middle click',Mouse2:'Right click',Space:'Space',Escape:'Esc',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',AltLeft:'Left Alt',AltRight:'Right Alt',ControlLeft:'Left Ctrl',ControlRight:'Right Ctrl',ShiftLeft:'Left Shift',ShiftRight:'Right Shift',WheelUp:'Wheel up',WheelDown:'Wheel down',Backquote:'`'};
export function bindingLabel(input, id) {
  const chord = input?.actions?.[id]?.binds?.[0];
  return chord?.length ? chord.map(k => NAMED_KEYS[k] || k.replace(/^Key|^Digit/,'').replace(/^Numpad/,'Num ')).join(' + ') : 'Unassigned';
}

export function createGuide(input, {onClose, onControls} = {}) {
  const dialog = new GameDialog({title:'A good first flight',label:'Flight guide',className:'guide-dialog',onClose});
  dialog.refresh = () => {
    const key = (id) => `<kbd>${escapeHTML(bindingLabel(input,id))}</kbd>`;
    const trackpad = current().pointingDevice === 'trackpad';
    dialog.body.innerHTML = `<p class="dialog-intro">Start with Practice flight. You are already airborne, with no enemies or mission clock. Get comfortable, then enter the campaign.</p>
      <div class="guide-steps"><article><span class="step-number">01</span><h3>Point where you want to fly</h3><p>${trackpad ? 'Slide one finger on your trackpad, without clicking or dragging. Lift and reposition between strokes.' : 'Move your mouse gently.'} The aircraft follows your aim. Use ${key('recenter_aim')} to align aim with your heading.</p></article>
      <article><span class="step-number">02</span><h3>Find your speed</h3><p>${key('throttle_up')} increases throttle; ${key('throttle_down')} decreases it. Hold increase past 100% for afterburner. Steering does not change throttle.</p></article>
      <article><span class="step-number">03</span><h3>Bank, turn, level out</h3><p>${key('roll_left')} / ${key('roll_right')} roll the aircraft. ${key('pitch_up')} raises the nose and ${key('pitch_down')} lowers it. Small inputs work best.</p></article>
      <article><span class="step-number">04</span><h3>Then take on a mission</h3><p>${key('fire_mguns')} fires the cannon. Keep an enemy ahead until the missile lock tone, then ${key('fire_aam')} launches. Campaign briefings explain each objective.</p></article></div>
      <div class="guide-readouts"><h3>Read your instruments</h3><p><b>Left:</b> airspeed in knots. <b>Right:</b> altitude in feet. <b>Top:</b> compass heading. <b>Bottom:</b> throttle, ammunition and aircraft health. The horizon ladder helps you keep level.</p></div>
      <div class="info-callout"><b>Make room to steer.</b> Use <b>Capture pointer</b> during flight to keep aiming at the edges of the window, with either device. <kbd>Esc</kbd> frees the cursor and pauses. Trackpad users can fire with a keyboard binding, leaving one hand free to steer. Change your aiming profile and test sensitivity in Controls.</div>
      <div class="info-callout"><b>You can always stop.</b> Press <kbd>Esc</kbd> or use Pause. The world pauses while you change controls, read a briefing or adjust settings. Leaving this window pauses too. ${key('help')} reopens this guide in flight.</div>
      <div class="dialog-actions"><button class="ui-button" type="button" data-guide-controls>Customize my controls</button><button class="ui-button primary" type="button" data-guide-done>Got it</button></div>`;
    dialog.body.querySelector('[data-guide-controls]').onclick = () => { dialog.afterCloseAction=onControls; dialog.close(); };
    dialog.body.querySelector('[data-guide-done]').onclick = () => dialog.close();
  };
  const show = dialog.show.bind(dialog);
  dialog.show = () => { dialog.refresh(); show(); };
  return dialog;
}
