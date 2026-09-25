import * as SETTINGS from './settings.js';
import { GameDialog, createGuide, confirmAction, fullscreen, jetMark, bindingLabel, escapeHTML, readLocal, writeLocal } from './ui.js';
import { PilotLog, FRONTS, campaignProgress, operationSummary, sortieURL } from './pilotlog.js';
import { FlightCoach } from './flightcoach.js';
import { mountQuickTune } from './quicktune.js';
import { flightBrief } from './flightbrief.js';
import { captureFlightDebrief } from './flightdebrief.js';
import { PREFLIGHT_KEY, validateFlightPlan } from './flightplan.js';
import { SCENARIOS, isStandaloneSortie } from '../campaign/authored.js';
import { TacticalView } from './tacticalview.js';

// Reloading an operation generates a sortie from its last persisted front.
// A campaign continuation must never send a failed save back to the same mission.
export function flightContinuation({flags, match, progressSaved, operationStatus}, next = null) {
  const finished = !!match?.over;
  const current = flags.get('sortie');
  const scenario = SCENARIOS.find(s => s.id === current);
  const operation = finished && !current && flags.has('op');
  const saved = progressSaved === true;
  if (operation && saved && operationStatus === undefined) {
    const front = flags.get('front')?.toUpperCase();
    operationStatus = operationSummary(FRONTS[front] ? front : 'NELLIS').status;
  }
  const operationComplete = operation && saved && ['won', 'lost'].includes(operationStatus);
  return {
    nextMission: finished && match.over === 1 && current && !scenario && saved && next?.id && next.id !== current ? next : null,
    operation,
    operationComplete,
    resultTitle: scenario && finished ? (match.over === 1 ? `${scenario.title} complete` : 'Protection window closed') : operationComplete ? (operationStatus === 'won' ? 'Operation won' : 'Operation lost') : null,
    restartLabel: scenario ? `Replay ${scenario.title}` : operationComplete ? 'Back to preflight' : operation ? (saved ? 'Continue operation' : 'Retry operation sortie') : 'Restart this flight',
    restartTitle: scenario ? `Replay ${scenario.title}?` : operationComplete ? 'Return to preflight?' : operation ? (saved ? 'Continue operation?' : 'Retry this operation sortie?') : 'Restart this flight?',
    consequence: operationComplete ? 'Start a new operation from preflight. This completed operation stays saved until you confirm its replacement.' : operation ? (saved
      ? 'Continue operation loads the next sortie from your saved front line.'
      : 'Retry loads the last saved front line. This unsaved result will be lost.') : '',
  };
}

// One owner for the flight/menu boundary. Pausing never changes sim.timescale
// or persisted audio preferences; the frame loop simply stops advancing.
export class Cockpit {
  constructor({state,input,controls,audio,hud,flags}) {
    Object.assign(this,{state,input,controls,audio,hud,flags});
    this.paused=false;this.reason='manual';this.hudHidden=false;this.afterPauseClose=null;
    this.practice=flags.get('mode')==='practice';
    this.samples=[];this.lastStatus=0;this.resultAt=null;this.resultShown=false;
    this.missileLaunchSequence=0;this.lastMissileFeedback=-Infinity;
    this.pauseDialog=new GameDialog({title:'Flight paused',label:'Take your time',className:'pause-dialog',onClose:()=>{
      const next=this.afterPauseClose;this.afterPauseClose=null;
      if(next)next();else this.resume(false);
    }});
    this.guide=createGuide(input,{onClose:()=>this.showPause(),onControls:()=>this.openControls('controls')});
    this.log=new PilotLog({onClose:()=>this.showPause(),onLaunch:s=>this.confirmLeave(()=>location.assign(sortieURL(s)),'Fly this mission?')});
    this.tactical=new TacticalView({state,input,onClose:()=>this.tacticalFromPause?this.showPause():this.resume(),onResume:()=>this.resume()});
    this.toolbar=document.createElement('div');this.toolbar.className='flight-toolbar';this.toolbar.dataset.gameUi='';
    const front=FRONTS[flags.get('front')?.toUpperCase()] || FRONTS.NELLIS;
    const scenario=SCENARIOS.find(s=>s.id===flags.get('sortie'));
    this.toolbar.innerHTML=`<div class="flight-brand">${jetMark} RAPTOR <small>${escapeHTML(front.name)} · ${this.practice?'Practice':scenario?`${escapeHTML(scenario.title)} · Alternate history`:flags.has('sortie')?'Campaign':flags.has('op')?'Operation':'Quick battle'}</small></div><nav class="flight-tools" aria-label="Flight menu"><button type="button" class="ui-button" data-flight-action="pause">Ⅱ Pause <kbd>Esc</kbd></button>${this.practice?'':'<button type="button" class="ui-button" data-flight-action="controls">Controls</button><button type="button" class="ui-button" data-flight-action="settings">Settings</button><button type="button" class="ui-button" data-flight-action="progress">Pilot log</button>'}<button type="button" class="ui-button" data-flight-action="guide">How to fly</button><button type="button" class="ui-button" data-flight-action="capture" aria-pressed="false" title="Keep steering at the window edges. Escape releases the pointer and pauses flight.">Capture pointer</button></nav><p class="mouse-capture-note" role="status" hidden>Pointer captured · Esc frees the cursor and pauses</p>`;
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
    this.toolbar.querySelector('[data-flight-action="pause"]').after(tune);
    const map=document.createElement('button');map.type='button';map.className='ui-button';map.dataset.flightAction='map';map.onclick=()=>this.openTactical();
    tune.after(map);
    this.renderMapButton();
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
    window.addEventListener('raptor-settings-change',()=>{this.applyOptions();this.renderHints();this.renderPractice();this.refreshSaveNote();});
    window.addEventListener('raptor-bindings-change',()=>{this.renderHints();this.renderMapButton();this.renderPractice();this.refreshSaveNote();});
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
    this.missileLaunchSequence=this.state.player?.missiles?.launchSequence||0;
    this.lastMissileFeedback=-Infinity;this.clearMissileFeedback();
    this.clearInput();this.input.suspended=true;
    this.quiet(true);
    this.applyOptions();
    if(document.pointerLockElement)document.exitPointerLock();
    if(show)this.showPause();
  }
  toggle(){if(!this.confirmDialog?.open)this.paused?this.resume():this.pause();}
  resume(closeDialog=true) {
    if(this.controls.open||this.guide.open||this.log.open||this.tactical?.open||this.confirmDialog?.open)return;
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
  openTactical(){
    if(this.tactical.open||this.controls.open||this.guide.open||this.log.open||this.confirmDialog?.open)return;
    this.tacticalFromPause=this.paused;
    const heldCodes=[...this.input.down];
    this.switchView(()=>this.tactical.show(heldCodes));
  }
  renderMapButton(){
    const button=this.toolbar.querySelector('[data-flight-action="map"]');
    const label=bindingLabel(this.input,'map');
    button.innerHTML=`Tactical map${label==='Unassigned'?'':` <kbd>${escapeHTML(label)}</kbd>`}`;
  }
  showPause() {
    if(!this.paused||this.controls.open||this.guide.open||this.log.open||this.tactical?.open)return;
    this.input.suspended=true;
    const p=this.state.player;
    const ready=this.reason==='welcome';
    const scenario=SCENARIOS.find(s=>s.id===this.flags.get('sortie'));
    const scenarioReady=!!scenario&&this.reason==='scenario';
    const complete=this.reason==='result'||!!this.state.match?.over;
    const won=this.state.match?.over===1;
    const requestedFront=this.flags.get('front')?.toUpperCase();
    const operationFront=FRONTS[requestedFront]?requestedFront:'NELLIS';
    const progress=campaignProgress();
    const continuation=flightContinuation({flags:this.flags,match:this.state.match,progressSaved:this.state.progressSaved},progress.next);
    const next=continuation.nextMission;
    const campaignFinished=complete&&won&&!scenario&&this.flags.has('sortie')&&this.state.progressSaved===true&&!progress.next;
    const resultRestart=complete&&!this.practice&&!scenario&&!continuation.operation&&!next&&!campaignFinished;
    const restartLabel=resultRestart?(this.flags.has('sortie')||this.flags.has('mission')?(won?'Fly mission again':'Retry mission'):'Fly battle again'):continuation.restartLabel;
    const title=ready?'Ready to fly':scenarioReady?scenario.title:this.reason==='recovery'?'A fresh start in the air':this.reason==='tune'?'Find your flight feel':complete?(continuation.resultTitle||(won?'Mission complete':'Let’s fly again')):scenario?`${scenario.title} paused`:'Flight paused';
    this.pauseDialog.el.querySelector('h2').textContent=title;
    this.pauseDialog.el.setAttribute('aria-label',title);
    this.pauseDialog.el.setAttribute('data-pause-kind',ready?'welcome':complete?'result':'paused');
    this.pauseDialog.el.querySelector('.icon-button').setAttribute?.('aria-label',ready?'Start flying':complete?'Return to flight view':'Resume flight');
    this.pauseDialog.el.querySelector('.eyebrow').textContent=scenario?'Alternate history · Standalone scenario':ready?'A little space to learn':complete?'Debrief':'Take your time';
    const saveMessage=scenario?`${won?'Both hostile tracks were intercepted and the city protection zones held.':'The interception was not completed. The scenario ends before any impact is depicted.'} ${this.state.progressSaved===false?'This browser could not save your completion. ':''}Replay Harbor Watch whenever you are ready. Your campaign progress is unchanged.`:this.state.progressSaved===true?'Your progress has been saved in this browser.':this.state.progressSaved===false?'Your browser could not save this result. Leaving this page will lose it.':this.flags.has('sortie')?'This mission is still available in your pilot log. Complete its objectives to advance.':this.flags.has('op')?'Your operation continues from its last saved front line.':'Quick battles do not change your campaign progress.';
    const description=ready?'You’re already airborne. No enemies, no time pressure.':scenarioReady?'Read the scenario briefing, then begin from your airborne harbor patrol. The mission clock is paused.':this.reason==='recovery'?'You’re safely airborne again. Take a breath and try the exercise when you’re ready.':complete?saveMessage:this.reason==='focus'?'Your flight paused when you left the window. Resume when you’re ready.':this.reason==='pointer'?'The cursor is free and your flight is paused. Resume when you’re ready.':'Your aircraft and the world are paused.';
    const hs=p?.hudState();
    const options=SETTINGS.current();
    const key=id=>`<kbd>${escapeHTML(bindingLabel(this.input,id))}</kbd>`;
    const steering=options.pointingDevice==='trackpad'?'Slide one finger to steer, without clicking. Lift and reposition between strokes.':'Move the mouse gently to steer. The aircraft follows your aim.';
    const settingsSaved=this.input.storageAvailable&&SETTINGS.storageAvailable();
    const optionsOpen=this.pauseDialog.open&&this.pauseDialog.body.querySelector('.pause-options')?.open;
    const tuneOpen=!ready&&(this.reason==='tune'||this.pauseDialog.open&&this.pauseDialog.body.querySelector('.quick-tune')?.open);
    const nextTier=options.tier==='AUTO'?(this.state.recommendedTier||this.state.tier):options.tier;
    const pendingTier=nextTier!==this.state.tier || this.state.assetReloadRequired===true;
    const graphicsSaved=SETTINGS.storageAvailable();
    const graphicsNote=!graphicsSaved ? 'Graphics changes are active on this page. Browser storage is unavailable, so restarting may restore your previous settings.'
      : nextTier!==this.state.tier ? `Graphics: ${escapeHTML(this.state.tier)} running · ${escapeHTML(nextTier)} on restart.`
        : 'Your selected graphics preset needs a restart to load its full detail.';
    this.pauseDialog.body.innerHTML=`<p class="pause-message">${description}</p>
      ${ready?`<div class="welcome-guidance"><p>${steering}</p><div class="welcome-keys"><span>${key('throttle_up')} / ${key('throttle_down')} Throttle</span><span>${key('recenter_aim')} Center aim</span><span><kbd>Esc</kbd> Pause</span></div></div>`:complete&&!this.practice?this.renderDebrief():this.renderFlightBrief()}
      ${complete&&next?`<button type="button" class="ui-button primary pause-primary" data-next>Fly next campaign mission ↗</button>`:''}
      ${scenario&&complete?`<button type="button" class="ui-button primary pause-primary" data-replay-scenario>${continuation.restartLabel} ↗</button>`:''}
      ${continuation.operation?`<p class="pause-continuation">${continuation.consequence}</p><button type="button" class="ui-button primary pause-primary" data-restart>${continuation.restartLabel} ↗</button>`:''}
      ${resultRestart?`<button type="button" class="ui-button primary pause-primary" data-restart>${restartLabel} ↗</button>`:''}
      ${campaignFinished?'<button type="button" class="ui-button primary pause-primary" data-debrief-log>Explore your completed campaign ↗</button>':''}
      <button type="button" class="ui-button ${complete?'':'primary'} pause-primary" data-resume>${ready?'Start flying':scenarioReady?'Begin Harbor Watch':complete?'Return to flight view':'Resume flight'} <kbd>Esc</kbd></button>
      ${!ready?'<button type="button" class="text-button pause-tactical" data-tactical>Tactical map & radio log ↗</button>':''}
      ${this.practice&&!ready?`<div class="pause-handoff"><span>New pilot?<small>Begin with level flight and five guided exercises.</small></span><div class="pause-practice-actions"><button type="button" class="ui-button" data-school-start>${this.coach.course.record||this.coach.course.elapsed>0?'Replay':'Start'} flight school</button><button type="button" class="text-button" data-recover>Reset to level flight</button></div></div>`:''}
      ${pendingTier?`<p class="pause-graphics-note">${graphicsNote} Your current flight stays paused until you resume.</p>`:''}
      <div data-quick-tune></div>
      <details class="pause-options" ${optionsOpen||pendingTier?'open':''}><summary>Flight options <span>Controls, display & more</span></summary>
        <div class="pause-grid"><button type="button" class="ui-button" data-pause="controls">Customize controls <span>↗</span></button><button type="button" class="ui-button" data-pause="settings">Display & sound <span>↗</span></button><button type="button" class="ui-button" data-pause="guide">How to fly <span>↗</span></button><button type="button" class="ui-button" data-pause="progress">Your pilot log <span>↗</span></button></div>
        ${!ready&&hs?`<div class="pause-overview"><div><span>AIRSPEED</span><strong>${Math.round(hs.speedKt)} <small>kt</small></strong></div><div><span>ALTITUDE</span><strong>${Math.round(hs.altFt).toLocaleString()} <small>ft</small></strong></div><div><span>THROTTLE</span><strong>${hs.throttle}%</strong></div></div>`:''}
        <div class="pause-guidance"><button type="button" class="text-button" data-reminders>${options.showHints?'Hide':'Show'} key reminders</button>${this.practice?`<button type="button" class="text-button" data-checklist>${options.showChecklist?'Hide':'Show'} flight coach</button><button type="button" class="text-button" data-school>${this.coach.course.status==='active'?'Switch to free flight':'Start flight school'}</button>`:''}</div>
        <div class="pause-secondary">${continuation.operation||resultRestart?'':`<button type="button" class="text-button" data-restart>${pendingTier&&graphicsSaved?'Restart with new graphics':continuation.restartLabel}</button>`}<button type="button" class="text-button" data-fullscreen>Fullscreen</button></div>
      </details>
      <div class="pause-exit"><button type="button" class="text-button" data-hangar>Back to preflight ↗</button><p class="pause-note" ${!ready&&!complete?'data-settings-save':''}>${ready?'Five short exercises. Learn at your own pace.':complete?this.state.progressSaved===false?'This result is not saved.':this.state.progressSaved===true?'This result is saved in this browser.':'Choose another flight from your pilot log.':settingsSaved?'Controls and settings save in this browser.':'Some settings are available for this session only.'}</p></div>`;
    for(const b of this.pauseDialog.body.querySelectorAll('[data-pause]'))b.onclick=()=>{
      const a=b.dataset.pause;
      if(a==='controls'||a==='settings')this.openControls(a);else if(a==='guide')this.openGuide();else this.openLog();
    };
    mountQuickTune(this.pauseDialog.body.querySelector('[data-quick-tune]'),{expanded:!!tuneOpen,onControls:()=>this.openControls('controls')});
    this.pauseDialog.body.querySelector('[data-resume]').onclick=()=>this.resume();
    this.pauseDialog.body.querySelector('[data-tactical]')?.addEventListener('click',()=>this.openTactical());
    this.pauseDialog.body.querySelector('[data-reminders]').onclick=()=>{SETTINGS.saveSettings({showHints:!SETTINGS.current().showHints});this.showPause();this.pauseDialog.body.querySelector('[data-reminders]').focus();};
    this.pauseDialog.body.querySelector('[data-checklist]')?.addEventListener('click',()=>{SETTINGS.saveSettings({showChecklist:!SETTINGS.current().showChecklist});this.showPause();this.pauseDialog.body.querySelector('[data-checklist]').focus();});
    this.pauseDialog.body.querySelector('[data-recover]')?.addEventListener('click',()=>{this.recoverPractice();this.coach.reset();this.showPause();this.pauseDialog.body.querySelector('[data-resume]').focus();});
    this.pauseDialog.body.querySelector('[data-school]')?.addEventListener('click',()=>{
      if(this.coach.course.status==='active')this.coach.freeFlight();else{this.coach.replay();SETTINGS.saveSettings({showChecklist:true});}
      this.showPause();this.pauseDialog.body.querySelector('[data-resume]').focus();
    });
    this.pauseDialog.body.querySelector('[data-school-start]')?.addEventListener('click',()=>this.startFlightSchool());
    const returnToPreflight=()=>{
      if(continuation.operationComplete){
        const plan=validateFlightPlan(readLocal(PREFLIGHT_KEY,null));
        writeLocal(PREFLIGHT_KEY,{...plan,mode:'operation',front:operationFront});
      }
      location.assign('/');
    };
    const restart=()=>this.confirmLeave(continuation.operationComplete?returnToPreflight:()=>location.reload(),resultRestart?`${restartLabel}?`:continuation.restartTitle,{label:continuation.operation||scenario||resultRestart?restartLabel:undefined,detail:continuation.consequence});
    this.pauseDialog.body.querySelector('[data-restart]').onclick=restart;
    this.pauseDialog.body.querySelector('[data-replay-scenario]')?.addEventListener('click',restart);
    this.pauseDialog.body.querySelector('[data-hangar]').onclick=()=>this.confirmLeave(returnToPreflight,'Return to preflight?');
    this.pauseDialog.body.querySelector('[data-fullscreen]').onclick=e=>fullscreen(e.currentTarget);
    this.pauseDialog.body.querySelector('[data-next]')?.addEventListener('click',()=>{if(next)location.assign(sortieURL(next));});
    this.pauseDialog.body.querySelector('[data-debrief-log]')?.addEventListener('click',()=>this.openLog());
    this.pauseDialog.show();
  }
  startFlightSchool() {
    if(!this.practice||!this.coach)return;
    this.recoverPractice();
    this.coach.replay();
    SETTINGS.saveSettings({showChecklist:true,showHints:true});
    this.reason='welcome';this.showPause();
    this.pauseDialog.body.querySelector('[data-resume]').focus();
  }
  refreshSaveNote() {
    const note=this.pauseDialog.body.querySelector('[data-settings-save]');
    if(note)note.textContent=this.input.storageAvailable&&SETTINGS.storageAvailable()?'Controls and settings save in this browser.':'Some settings are available for this session only.';
  }
  confirmLeave(action,title,{label,detail=''}={}) {
    this.pause('menu',false);
    const resultMessage=this.state.progressSaved===false?'This result could not be saved in this browser. Leaving will lose this result.':this.state.progressSaved===true?'Your completed result is saved.':'Your earlier campaign progress is kept.';
    const leaveMessage=this.input.storageAvailable&&SETTINGS.storageAvailable()?'Your control settings and completed missions are saved. This unfinished flight will start over.':'This browser cannot save all of your current settings. Unsaved changes will reset and this unfinished flight will start over.';
    const message=`${this.state.match?.over?resultMessage:leaveMessage}${detail?' '+detail:''}`;
    const dialog=confirmAction({title,message,action:label||(title.startsWith('Restart')?'Restart flight':title.startsWith('Return')?'Back to preflight':'Fly mission'),onConfirm:action});
    this.confirmDialog=dialog;
    dialog.el.addEventListener('close',()=>{if(this.paused&&!this.log.open&&!this.pauseDialog.open)this.showPause();});
  }
  onReady(){
    if(this.practice&&!readLocal('raptor.practice.introduced',false))this.pause('welcome');
    else if(isStandaloneSortie(this.flags.get('sortie')))this.pause('scenario');
    else if(document.hidden||!document.hasFocus())this.pause('focus');
  }
  renderHints() {
    const key=id=>`<kbd>${escapeHTML(bindingLabel(this.input,id))}</kbd>`;
    this.hints.innerHTML=`<span>${key('throttle_up')} / ${key('throttle_down')} Throttle</span><span>${key('roll_left')} / ${key('roll_right')} Roll</span><span>${key('recenter_aim')} Center aim</span>${this.practice?'':`<span>${key('fire_mguns')} Cannon</span><span>${key('fire_aam')} Missile</span>`}<button type="button" aria-label="Hide key reminders">✕</button>`;
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
    return `${brief.briefing.length?`<section class="pause-brief" aria-label="Scenario briefing"><strong>${escapeHTML(brief.title)}</strong>${brief.briefing.map(line=>`<p>${escapeHTML(line)}</p>`).join('')}${brief.contentNote?`<p class="save-note">${escapeHTML(brief.contentNote)}</p>`:''}</section>`:''}<section class="pause-brief" aria-label="Mission objectives"><div><span class="eyebrow">YOUR OBJECTIVES</span><small>${brief.remaining===null?'':brief.remaining+' remaining · '}${brief.completed} / ${brief.total} complete</small></div><ul>${brief.objectives.map(o=>`<li class="${o.status}"><span aria-label="${o.status}">${['done','protected'].includes(o.status)?'✓':o.status==='failed'?'×':'○'}</span><b>${escapeHTML(o.label)}</b><small>${escapeHTML(o.detail)}</small></li>`).join('')}</ul></section>`;
  }
  captureDebrief() {
    if(this.practice)return null;
    this.debrief ??=captureFlightDebrief(this.state);
    return this.debrief;
  }
  renderDebrief() {
    const report=this.captureDebrief();
    if(!report)return '';
    const statuses={complete:'Complete',protected:'Protected',held:'Held at finish',failed:'Failed',incomplete:'Incomplete'};
    const aircraft=report.aircraft;
    const stores=aircraft?[`${aircraft.hull}% hull`,aircraft.cannon===null?'':`${aircraft.cannon} cannon rounds`,aircraft.missiles===null?'':`${aircraft.missiles} missiles`].filter(Boolean).join(' · '):'';
    return `<section class="sortie-debrief" aria-label="Sortie report"><div class="sortie-report-heading"><span class="eyebrow">SORTIE REPORT</span><span>At mission end</span></div>
      ${report.metrics.length?`<dl class="sortie-metrics">${report.metrics.map(metric=>`<div><dt>${escapeHTML(metric.label)}</dt><dd>${escapeHTML(metric.value)}</dd></div>`).join('')}</dl>`:''}
      ${report.noAircraft?'<p class="sortie-aircraft lost">No aircraft remaining.</p>':aircraft?`<p class="sortie-aircraft"><b>Aircraft at finish</b><span>${escapeHTML(stores)}</span></p>`:''}
      ${report.friendlyLosses===null?'':`<p class="sortie-friendly">Friendly units lost: <b>${report.friendlyLosses}</b></p>`}
      ${report.objectives.length?`<details class="sortie-objectives" ${report.won?'':'open'}><summary>Objective results <span>${report.objectives.filter(o=>o.status==='complete'||o.status==='protected'||o.status==='held').length} / ${report.objectives.length} fulfilled or held</span></summary><ul>${report.objectives.map(objective=>`<li class="${objective.status}"><span aria-hidden="true">${['complete','protected','held'].includes(objective.status)?'✓':objective.status==='failed'?'×':'○'}</span><b>${escapeHTML(objective.label)}</b><small>${escapeHTML(objective.detail)}${objective.detail?' · ':''}${statuses[objective.status]}</small></li>`).join('')}</ul></details>`:''}
    </section>`;
  }
  update(now,dtMs) {
    if(this.paused)return;
    this.captureDebrief();
    this.updateMissileFeedback(now);
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
  updateMissileFeedback(now) {
    const weapon=this.state.player?.missiles;
    if(!weapon?.launchSequence||weapon.launchSequence===this.missileLaunchSequence)return;
    this.missileLaunchSequence=weapon.launchSequence;
    if(weapon.launchOutcome==='launched'){
      this.clearMissileFeedback();return;
    }
    const message=weapon.launchOutcome==='empty'?'No missiles remaining.'
      :weapon.launchOutcome==='no-lock'?'No missile lock. Keep a target ahead until LOCK appears.':null;
    if(!message||now-this.lastMissileFeedback<2000)return;
    this.lastMissileFeedback=now;
    this.toast(message,1800);this.missileFeedbackToast=this.toastEl;
  }
  clearMissileFeedback() {
    if(this.missileFeedbackToast&&this.missileFeedbackToast===this.toastEl){
      clearTimeout(this.toastTimer);this.toastEl.remove();
    }
    this.missileFeedbackToast=null;
  }
  toggleHUD(){
    this.hudHidden=!this.hudHidden;
    if(this.hud.canvas)this.hud.canvas.style.display=this.hudHidden?'none':'';
    this.toast(this.hudHidden?'HUD hidden. Use your HUD shortcut to show it again.':'HUD visible.');
  }
  toast(message,duration=3500){
    this.toastEl?.remove();clearTimeout(this.toastTimer);
    const el=document.createElement('div');el.className='flight-toast';el.setAttribute('role','status');el.textContent=message;document.body.append(el);this.toastEl=el;
    this.toastTimer=setTimeout(()=>el.remove(),duration);
  }
}
