import * as SETTINGS from './settings.js';
import { GameDialog, createGuide, confirmAction, fullscreen, jetMark, bindingLabel, escapeHTML, readLocal, writeLocal } from './ui.js';
import { PilotLog, FRONTS, campaignProgress, campaignCatalog, sortieURL } from './pilotlog.js';
import { FlightCoach } from './flightcoach.js';
import { mountQuickTune } from './quicktune.js';
import { flightBrief } from './flightbrief.js';

// One owner for the flight/menu boundary. Pausing never changes sim.timescale
// or persisted audio preferences; the frame loop simply stops advancing.
export class Cockpit {
  constructor({state,input,controls,audio,hud,flags}) {
    Object.assign(this,{state,input,controls,audio,hud,flags});
    this.paused=false;this.reason='manual';this.hudHidden=false;this.afterPauseClose=null;
    this.practice=flags.get('mode')==='practice';
    this.samples=[];this.lastStatus=0;this.resultAt=null;this.resultShown=false;
    this.pauseDialog=new GameDialog({title:'Flight paused',label:'Take your time',className:'pause-dialog',onClose:()=>{
      const next=this.afterPauseClose;this.afterPauseClose=null;
      if(next)next();else this.resume(false);
    }});
    this.guide=createGuide(input,{onClose:()=>this.showPause(),onControls:()=>this.openControls('controls')});
    this.log=new PilotLog({onClose:()=>this.showPause(),onLaunch:s=>this.confirmLeave(()=>location.assign(sortieURL(s)),'Fly this mission?')});
    this.toolbar=document.createElement('div');this.toolbar.className='flight-toolbar';this.toolbar.dataset.gameUi='';
    const front=FRONTS[flags.get('front')?.toUpperCase()] || FRONTS.NELLIS;
    this.toolbar.innerHTML=`<div class="flight-brand">${jetMark} RAPTOR <small>${escapeHTML(front.name)} · ${this.practice?'Practice':flags.has('sortie')?'Campaign':flags.has('op')?'Operation':'Quick battle'}</small></div><nav class="flight-tools" aria-label="Flight menu"><button type="button" class="ui-button" data-flight-action="pause">Ⅱ Pause <kbd>Esc</kbd></button><button type="button" class="ui-button" data-flight-action="controls">Controls</button><button type="button" class="ui-button" data-flight-action="settings">Settings</button><button type="button" class="ui-button" data-flight-action="progress">Pilot log</button><button type="button" class="ui-button" data-flight-action="guide" aria-label="How to fly">?</button><button type="button" class="ui-button" data-flight-action="capture" aria-pressed="false" title="Keep steering at the window edges. Escape releases the pointer and pauses flight.">Capture pointer</button></nav><p class="mouse-capture-note" role="status" hidden>Pointer captured · Esc frees the cursor and pauses</p>`;
    document.getElementById('chrome')?.replaceWith(this.toolbar);
    this.toolbarBottom=80;
    this.toolbarObserver=new ResizeObserver(()=>{this.toolbarBottom=this.toolbar.hidden?0:this.toolbar.getBoundingClientRect().bottom;this.coach?.el.style.setProperty('--flight-toolbar-bottom',`${this.toolbarBottom+16}px`);});
    this.toolbarObserver.observe(this.toolbar);
    for(const b of this.toolbar.querySelectorAll('[data-flight-action]'))b.onclick=()=>{
      const action=b.dataset.flightAction;
      if(action==='pause')this.toggle();
      else if(action==='controls'||action==='settings')this.openControls(action);
      else if(action==='guide')this.openGuide();else if(action==='capture')this.toggleMouseCapture();else this.openLog();
    };
    const tune=document.createElement('button');tune.type='button';tune.className='ui-button';tune.dataset.flightAction='tune';tune.textContent='Tune feel';
    tune.onclick=()=>{this.pause('tune');this.pauseDialog.body.querySelector('.quick-tune summary')?.focus();};
    this.toolbar.querySelector('[data-flight-action="controls"]').after(tune);
    this.setupMouseCapture();
    this.flightCanvas?.addEventListener('pointermove',event=>{
      if(this.edgeTipShown||this.paused||this.mouseCaptured||this.captureButton.hidden||!event.isTrusted)return;
      if(event.clientX<12||event.clientX>innerWidth-12||event.clientY>innerHeight-12){
        this.edgeTipShown=true;
        this.toast('Running out of room? Capture pointer keeps mouse and trackpad steering free at the window edges.');
      }
    });
    this.performance=document.createElement('div');this.performance.className='flight-performance';this.performance.hidden=true;
    this.performance.setAttribute('aria-label','Flight frame rate');document.body.append(this.performance);
    this.hints=document.createElement('div');this.hints.className='flight-hints';this.hints.dataset.gameUi='';document.body.append(this.hints);
    this.coach=this.practice?new FlightCoach({state,input,getSettings:()=>SETTINGS.current(),
      onRecover:()=>this.recoverPractice(),onControls:()=>this.openControls('controls'),onCampaign:()=>this.openLog(),
      onHide:()=>SETTINGS.saveSettings({showChecklist:false})}):null;
    this.renderHints();this.renderPractice();this.applyOptions();
    window.addEventListener('raptor-settings-change',()=>{this.applyOptions();this.renderHints();this.renderPractice();});
    window.addEventListener('raptor-bindings-change',()=>{this.renderHints();this.renderPractice();});
    window.addEventListener('blur',()=>{if(state.ready&&!this.paused)this.pause('focus');});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.ready&&!this.paused)this.pause('focus');});
    // Programmatic/gamepad pause shortcuts still work when input is suspended.
    this.pauseDialog.el.addEventListener('keydown',e=>{
      const modifier=code=>code.startsWith('Shift')?e.shiftKey:code.startsWith('Control')?e.ctrlKey:code.startsWith('Alt')?e.altKey:code.startsWith('Meta')?e.metaKey:false;
      const matches=this.input.actions.game_pause?.binds.some(chord=>chord.at(-1)===e.code && chord.slice(0,-1).every(modifier));
      if(matches && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)){e.preventDefault();this.resume();}
    });
  }
  setupMouseCapture() {
    this.flightCanvas=document.getElementById('game');
    this.captureButton=this.toolbar.querySelector('[data-flight-action="capture"]');
    this.captureNote=this.toolbar.querySelector('.mouse-capture-note');
    this.mouseCaptured=false;this.capturePending=false;
    const available=!!this.flightCanvas?.requestPointerLock && matchMedia('(any-pointer: fine)').matches;
    this.captureButton.hidden=!available;
    this._captureError=()=>{
      if(!this.capturePending)return;
      this.capturePending=false;this.captureButton.disabled=false;
      this.toast('Pointer capture is unavailable. You can keep flying with the free cursor.');
    };
    document.addEventListener('pointerlockerror',this._captureError);
    document.addEventListener('pointerlockchange',()=>{
      const captured=document.pointerLockElement===this.flightCanvas;
      const wasCaptured=this.mouseCaptured;
      this.mouseCaptured=captured;this.capturePending=false;this.captureButton.disabled=false;
      this.captureButton.innerHTML=captured?'Free cursor <kbd>Esc</kbd>':'Capture pointer';
      this.captureButton.setAttribute('aria-pressed',String(captured));
      this.captureButton.title=captured?'Release the pointer and pause flight.':'Keep steering at the window edges. Escape releases the pointer and pauses flight.';
      this.captureNote.hidden=!captured;
      if(captured){
        // A pending request may resolve after the game lost focus. Never
        // capture the pointer over a paused setup or a native modal dialog.
        if(this.paused){document.exitPointerLock();return;}
        this.clearInput();this.flightCanvas.focus({preventScroll:true});
      } else if(wasCaptured&&!this.paused) this.pause('pointer');
    });
  }
  toggleMouseCapture() {
    if(document.pointerLockElement===this.flightCanvas){document.exitPointerLock();return;}
    if(this.paused||this.capturePending||!this.flightCanvas?.requestPointerLock)return;
    this.capturePending=true;this.captureButton.disabled=true;
    try {
      // Called synchronously from the explicit button gesture. Never capture
      // on load, on automatic resume, or simply because the canvas was clicked.
      const request=this.flightCanvas.requestPointerLock();
      request?.catch?.(this._captureError);
    } catch (_) {this._captureError();}
  }
  applyOptions() {
    const s=SETTINGS.current();
    const hidden=this.flags.get('chrome')==='0';
    this.toolbar.hidden=hidden;
    this.hints.hidden=hidden||!s.showHints||this.paused;
    this.coach?.setVisible(!hidden&&s.showChecklist);
    this.coach?.el.style.setProperty('--flight-instrument-gutter',`${Math.ceil(140*s.hudScale)}px`);
    this.coach?.setPaused(this.paused);
    this.performance.hidden=!s.showFps||hidden;
  }
  clearInput() {this.input.clear?.();this.input.down.clear();this.input.consumeFrame();this.state.player?.clearInput();}
  quiet(paused) {
    if(this.audio?.ctx){
      this.audio.gun?.fire(false);
      this.audio.setPaused(paused);
    }
    // Radio can be enabled while this menu is already paused.
    if('speechSynthesis' in window){
      if(paused)window.speechSynthesis.pause();else window.speechSynthesis.resume();
    }
  }
  pause(reason='manual',show=true) {
    this.reason=reason;this.paused=true;this.state.paused=true;
    this.clearInput();this.input.suspended=true;
    this.quiet(true);
    this.applyOptions();
    if(document.pointerLockElement)document.exitPointerLock();
    if(show)this.showPause();
  }
  toggle(){if(!this.confirmDialog?.open)this.paused?this.resume():this.pause();}
  resume(closeDialog=true) {
    if(this.controls.open||this.guide.open||this.log.open||this.confirmDialog?.open)return;
    if(closeDialog&&this.pauseDialog.open){this.afterPauseClose=()=>this.resume(false);this.pauseDialog.close();return;}
    this.clearInput();this.input.suspended=false;this.paused=false;this.state.paused=false;
    // A visibility/focus gap must never become catch-up time in the next frame.
    this.state.resetFrameClock=true;
    this.quiet(false);this.renderPractice();this.applyOptions();
    if(this.practice)writeLocal('raptor.practice.introduced',true);
    document.getElementById('game')?.focus({preventScroll:true});
  }
  switchView(open) {
    this.pause('menu',false);
    if(this.pauseDialog.open){this.afterPauseClose=open;this.pauseDialog.close();}else open();
  }
  openControls(section='controls'){this.switchView(()=>this.controls.show(section));}
  onControlsOpen(){this.pause('controls',false);}
  onControlsClose(){this.input.suspended=true;this.showPause();}
  openGuide(){this.switchView(()=>this.guide.show());}
  openLog(){this.switchView(()=>this.log.show(this.flags.get('sortie')));}
  showPause() {
    if(!this.paused||this.controls.open||this.guide.open||this.log.open)return;
    this.input.suspended=true;
    const p=this.state.player;
    const ready=this.reason==='welcome';
    const complete=this.reason==='result';
    const won=this.state.match?.over===1;
    const title=ready?'Ready for your first flight?':this.reason==='recovery'?'A fresh start in the air':this.reason==='tune'?'Find your flight feel':complete?(won?'Mission complete':'Let’s fly again'):'Flight paused';
    this.pauseDialog.el.querySelector('h2').textContent=title;
    this.pauseDialog.el.setAttribute('aria-label',title);
    this.pauseDialog.el.querySelector('.eyebrow').textContent=ready?'A little space to learn':complete?'Debrief':'Take your time';
    const saveMessage=this.state.progressSaved===true?'Your progress has been saved in this browser.':this.state.progressSaved===false?'Your browser could not save this result. Check that local storage is available before starting another mission.':this.flags.has('sortie')?'This mission is still available in your pilot log. Complete its objectives to advance.':'Quick battles do not change your campaign progress.';
    const description=ready?'You’re already airborne. Five short exercises will teach you to steer, turn, climb and manage power. There are no enemies or time pressure. You can switch to free flight at any point.':this.reason==='recovery'?'Your aircraft touched down too hard. You’re safely airborne again, with the world paused. Take a breath, adjust your setup, and try the exercise again.':complete?`${saveMessage} ${won?'Ready for the next sortie?':'Take a moment, adjust your setup, and try again.'}`:this.reason==='focus'?'You left the game window, so your flight was paused. Resume when you’re ready.':this.reason==='pointer'?'The cursor is free and your flight is paused. Resume when you’re ready; pointer capture is always your choice.':'The aircraft and the world are paused. Adjust anything you need before returning to flight.';
    const hs=p?.hudState();
    const next=campaignProgress().next;
    const options=SETTINGS.current();
    const nextTier=options.tier==='AUTO'?(this.state.recommendedTier||this.state.tier):options.tier;
    const pendingTier=nextTier!==this.state.tier || this.state.assetReloadRequired===true;
    const graphicsSaved=SETTINGS.storageAvailable();
    const graphicsNote=!graphicsSaved ? 'Graphics changes are active on this page. Browser storage is unavailable, so restarting may restore your previous settings.'
      : nextTier!==this.state.tier ? `Graphics: ${escapeHTML(this.state.tier)} running · ${escapeHTML(nextTier)} on restart.`
        : 'Your selected graphics preset needs a restart to load its full detail.';
    this.pauseDialog.body.innerHTML=`<p class="pause-message">${description}</p>${hs?`<div class="pause-overview"><div><span>AIRSPEED</span><strong>${Math.round(hs.speedKt)} <small>kt</small></strong></div><div><span>ALTITUDE</span><strong>${Math.round(hs.altFt).toLocaleString()} <small>ft</small></strong></div><div><span>THROTTLE</span><strong>${hs.throttle}%</strong></div></div>`:''}
      ${this.renderFlightBrief()}<div data-quick-tune></div>
      <div class="pause-grid"><button type="button" class="ui-button" data-pause="controls">Customize controls <span>↗</span></button><button type="button" class="ui-button" data-pause="settings">Display & sound <span>↗</span></button><button type="button" class="ui-button" data-pause="guide">How to fly <span>↗</span></button><button type="button" class="ui-button" data-pause="progress">Your pilot log <span>↗</span></button></div>
      ${complete&&won&&this.flags.has('sortie')&&next?`<button type="button" class="ui-button primary pause-primary" data-next>Fly next campaign mission ↗</button>`:''}
      <button type="button" class="ui-button ${complete?'':'primary'} pause-primary" data-resume>${ready?'Start flying':complete?'Return to flight view':'Resume flight'} <kbd>Esc</kbd></button>
      ${pendingTier?`<p class="pause-graphics-note">${graphicsNote} Your current flight stays paused until you resume.</p>`:''}
      <div class="pause-secondary"><button type="button" class="text-button" data-restart>${pendingTier&&graphicsSaved?'Restart with new graphics':'Restart this flight'}</button><button type="button" class="text-button" data-hangar>Back to preflight ↗</button><button type="button" class="text-button" data-fullscreen>Fullscreen</button></div>
      <div class="pause-guidance"><button type="button" class="text-button" data-reminders>${options.showHints?'Hide':'Show'} key reminders</button>${this.practice?`<button type="button" class="text-button" data-checklist>${options.showChecklist?'Hide':'Show'} flight coach</button><button type="button" class="text-button" data-recover>Reset to level flight</button><button type="button" class="text-button" data-school>${this.coach.course.status==='active'?'Switch to free flight':'Start flight school'}</button>`:''}</div>
      <p class="pause-note">${ready?'The flight tips stay on screen until you hide them.':complete?'Campaign and operation results save when a sortie finishes.':'Controls and settings save automatically. An unfinished sortie starts over if you leave or reload.'}</p>`;
    for(const b of this.pauseDialog.body.querySelectorAll('[data-pause]'))b.onclick=()=>{
      const a=b.dataset.pause;
      if(a==='controls'||a==='settings')this.openControls(a);else if(a==='guide')this.openGuide();else this.openLog();
    };
    mountQuickTune(this.pauseDialog.body.querySelector('[data-quick-tune]'),{expanded:ready||this.reason==='tune',onControls:()=>this.openControls('controls')});
    this.pauseDialog.body.querySelector('[data-resume]').onclick=()=>this.resume();
    this.pauseDialog.body.querySelector('[data-reminders]').onclick=()=>{SETTINGS.saveSettings({showHints:!SETTINGS.current().showHints});this.showPause();this.pauseDialog.body.querySelector('[data-reminders]').focus();};
    this.pauseDialog.body.querySelector('[data-checklist]')?.addEventListener('click',()=>{SETTINGS.saveSettings({showChecklist:!SETTINGS.current().showChecklist});this.showPause();this.pauseDialog.body.querySelector('[data-checklist]').focus();});
    this.pauseDialog.body.querySelector('[data-recover]')?.addEventListener('click',()=>{this.recoverPractice();this.coach.reset();this.showPause();this.pauseDialog.body.querySelector('[data-resume]').focus();});
    this.pauseDialog.body.querySelector('[data-school]')?.addEventListener('click',()=>{
      if(this.coach.course.status==='active')this.coach.freeFlight();else{this.coach.replay();SETTINGS.saveSettings({showChecklist:true});}
      this.showPause();this.pauseDialog.body.querySelector('[data-resume]').focus();
    });
    this.pauseDialog.body.querySelector('[data-restart]').onclick=()=>this.confirmLeave(()=>location.reload(),'Restart this flight?');
    this.pauseDialog.body.querySelector('[data-hangar]').onclick=()=>this.confirmLeave(()=>location.assign('/'),'Return to preflight?');
    this.pauseDialog.body.querySelector('[data-fullscreen]').onclick=e=>fullscreen(e.currentTarget);
    this.pauseDialog.body.querySelector('[data-next]')?.addEventListener('click',()=>location.assign(sortieURL(next)));
    this.pauseDialog.show();
  }
  confirmLeave(action,title) {
    this.pause('menu',false);
    const resultMessage=this.state.progressSaved===false?'This result could not be saved in this browser. Leaving will lose this result.':this.state.progressSaved===true?'Your completed result is saved.':'Your earlier campaign progress is kept.';
    const leaveMessage=this.input.storageAvailable&&SETTINGS.storageAvailable()?'Your control settings and completed missions are saved. This unfinished flight will start over.':'This browser cannot save all of your current settings. Unsaved changes will reset and this unfinished flight will start over.';
    const dialog=confirmAction({title,message:this.state.match?.over?resultMessage:leaveMessage,action:title.startsWith('Restart')?'Restart flight':title.startsWith('Return')?'Back to preflight':'Fly mission',onConfirm:action});
    this.confirmDialog=dialog;
    dialog.el.addEventListener('close',()=>{if(this.paused&&!this.log.open&&!this.pauseDialog.open)this.showPause();});
  }
  onReady(){
    if(this.practice&&!readLocal('raptor.practice.introduced',false))this.pause('welcome');
    else if(document.hidden||!document.hasFocus())this.pause('focus');
  }
  renderHints() {
    const key=id=>`<kbd>${escapeHTML(bindingLabel(this.input,id))}</kbd>`;
    this.hints.innerHTML=`<span>${key('throttle_up')} / ${key('throttle_down')} Throttle</span><span>${key('roll_left')} / ${key('roll_right')} Roll</span><span>${key('recenter_aim')} Recenter</span><span>${key('fire_mguns')} Cannon</span><span>${key('fire_aam')} Missile</span><button type="button" aria-label="Hide key reminders">✕</button>`;
    this.hints.querySelector('button').onclick=()=>SETTINGS.saveSettings({showHints:false});
  }
  renderPractice(){this.coach?.refresh();}
  recoverPractice() {
    if(!this.practice||!this.state.recoverPractice?.())return false;
    this.clearInput();
    this.toast('Back in level flight. Your current exercise is ready to try again.');
    return true;
  }
  onPracticeCrash() {
    if(!this.practice)return;
    this.coach?.reset();
    this.pause('recovery');
  }
  renderFlightBrief() {
    if(this.practice){
      const s=this.coach.course.snapshot();
      return `<section class="pause-brief" aria-label="Practice progress"><div><span class="eyebrow">${s.status==='active'?`FLIGHT SCHOOL · ${s.step} / ${s.total}`:s.status==='complete'?'FLIGHT SCHOOL COMPLETE':'FREE FLIGHT'}</span><strong>${escapeHTML(s.status==='active'?s.title:s.status==='complete'?'Ready for your first mission':'Room to explore')}</strong></div><p>${s.status==='active'?`${s.held.toFixed(1)} of ${s.duration} seconds held on target. Your exercise continues when you resume.`:s.status==='complete'?'Replay the course or open your pilot log to choose a mission.':'Start the course below whenever you want some guidance.'}</p></section>`;
    }
    const brief=flightBrief(this.state);
    if(!brief)return '';
    return `<section class="pause-brief" aria-label="Mission objectives"><div><span class="eyebrow">YOUR OBJECTIVES</span><small>${brief.remaining===null?'':brief.remaining+' remaining · '}${brief.completed} / ${brief.total} complete</small></div><ul>${brief.objectives.map(o=>`<li class="${o.status}"><span aria-label="${o.status}">${['done','protected'].includes(o.status)?'✓':o.status==='failed'?'×':'○'}</span><b>${escapeHTML(o.label)}</b><small>${escapeHTML(o.detail)}</small></li>`).join('')}</ul></section>`;
  }
  update(now,dtMs) {
    if(this.paused)return;
    if(this.state.ready)this.coach?.update(Math.min(dtMs/1000,10/120));
    if(this.state.ready){this.samples.push(dtMs);if(this.samples.length>180)this.samples.shift();}
    if(now-this.lastStatus>750){
      this.lastStatus=now;
      const mean=this.samples.reduce((a,b)=>a+b,0)/Math.max(1,this.samples.length);
      this.performance.textContent=`${Math.round(1000/Math.max(1,mean))} FPS · ${this.state.tier}`;
      this.state.frameMetrics={meanMs:mean,frames:this.samples.length};
    }
    if(this.state.match?.over && !this.resultShown){
      this.resultAt ??=now;
      if(now-this.resultAt>3500){this.resultShown=true;this.pause('result');}
    }
  }
  toggleHUD(){
    this.hudHidden=!this.hudHidden;
    if(this.hud.canvas)this.hud.canvas.style.display=this.hudHidden?'none':'';
    this.toast(this.hudHidden?'HUD hidden. Use your HUD shortcut to show it again.':'HUD visible.');
  }
  toast(message){
    this.toastEl?.remove();clearTimeout(this.toastTimer);
    const el=document.createElement('div');el.className='flight-toast';el.setAttribute('role','status');el.textContent=message;document.body.append(el);this.toastEl=el;
    this.toastTimer=setTimeout(()=>el.remove(),3500);
  }
}
