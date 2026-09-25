import { Input } from '../engine/input.js';
import { ControlsMenu } from './controlsmenu.js';
import * as SETTINGS from './settings.js';
import { PilotLog, FRONTS, campaignCatalog, campaignProgress, operationSummary, missionTypeLabel } from './pilotlog.js';
import { PREFLIGHT_KEY, validateFlightPlan, flightURL } from './flightplan.js';
import { jetMark, escapeHTML, bindingLabel, readLocal, writeLocal, createGuide, confirmAction, fullscreen } from './ui.js';

// Lightweight aircraft linework keeps preflight independent of the 3D renderer.
const deckAircraft = `<svg class="deck-aircraft" viewBox="0 0 340 260" aria-hidden="true" focusable="false">
  <g class="aircraft-guides" fill="none" stroke="currentColor" stroke-width=".6">
    <path d="M24 130H316M170 16V244" stroke-dasharray="2 7"/>
    <path d="M44 53V40H57M283 40H296V53M44 207V220H57M283 220H296V207"/>
    <path d="M76 205H264M76 201V209M264 201V209"/>
  </g>
  <g transform="translate(170 16) scale(.94)" stroke="currentColor" stroke-linejoin="round">
    <path class="aircraft-body" d="M0 0 9 22 17 43 23 68 28 87 108 142 99 158 39 149 35 175 65 195 59 212 20 205 15 218 6 225 0 221 -6 225 -15 218 -20 205 -59 212 -65 195 -35 175 -39 149 -99 158 -108 142 -28 87 -23 68 -17 43 -9 22Z"/>
    <g fill="none" stroke-width=".7" class="aircraft-panels">
      <path d="M0 12V51M0 94V202M-8 49Q0 36 8 49L10 79Q0 92 -10 79ZM-17 86 -19 139 -11 182 -11 217M17 86 19 139 11 182 11 217M-28 87 -19 139 -99 158M28 87 19 139 99 158M-39 149 -22 158 -35 175M39 149 22 158 35 175M-19 139 -11 182 -59 212M19 139 11 182 59 212M-11 182H11M-11 208H11"/>
    </g>
  </g>
  <text x="170" y="257" text-anchor="middle">F-22 RAPTOR / AIR SUPERIORITY</text>
</svg>`;

const MODES=[
  {id:'practice',name:'Practice flight',note:'Learn at your own pace',number:'01'},
  {id:'battle',name:'Quick battle',note:'Straight into combat',number:'02'},
  {id:'campaign',name:'Campaign',note:'30 authored missions',number:'03'},
  {id:'operation',name:'Operation',note:'A persistent front line',number:'04'},
];

export function showFlightdeck(state) {
  document.getElementById('veil')?.remove();
  document.getElementById('chrome')?.remove();
  const root=document.getElementById('hangar');
  root.removeAttribute('role');root.removeAttribute('aria-label');
  root.className='flightdeck';root.style.display='block';
  const input=new Input(window);input.suspended=true;
  const plan=validateFlightPlan(readLocal(PREFLIGHT_KEY,null));
  let catalog=[],launching=false,planStorageAvailable=true,missionStatus='',briefFooter='';
  const controls=new ControlsMenu(input,{onClose:()=>{input.suspended=true;refreshSetup();}});
  const guide=createGuide(input,{onControls:()=>controls.show('controls')});
  const log=new PilotLog();
  Object.assign(state,{hangar:true,input,controls,pilotLog:log});

  root.innerHTML=`<div class="deck-wrap"><header class="deck-header"><a class="game-brand" href="/" aria-label="RAPTOR home">${jetMark}<span>RAPTOR<small>F-22 AIR COMBAT</small></span></a><nav class="deck-nav" aria-label="Game setup"><button class="ui-button" type="button" data-open="controls">Controls <span aria-hidden="true">⌘</span></button><button class="ui-button" type="button" data-open="settings">Settings</button><button class="ui-button" type="button" data-open="progress">Pilot log</button><button class="ui-button" type="button" data-open="guide">How to fly <span aria-hidden="true">?</span></button></nav></header>
    <main><section class="deck-intro">${deckAircraft}<div class="deck-welcome"><p class="eyebrow"><span class="status-dot"></span><span id="readiness-status">Your aircraft is ready</span></p><h1>The sky is yours.</h1><p>Pick your controls. Find your rhythm.<br>Your first flight starts already airborne.</p></div><div class="deck-readiness"><span class="readiness-label">YOUR FLIGHT CHECK</span><button type="button" class="readiness-link" data-open="controls"><span>01</span><span>Set your controls<small id="readiness-controls"></small></span><b>↗</b></button><button type="button" class="readiness-link" data-open="settings"><span>02</span><span>Find your comfort<small id="readiness-comfort"></small></span><b>↗</b></button><button type="button" class="readiness-link" data-open="guide"><span>03</span><span>Learn the essentials<small>A guide, then five flying exercises</small></span><b>↗</b></button></div></section>
    <section class="deck-input" aria-label="Choose your aiming setup"><div><span class="eyebrow">FLIGHT CONTROLS</span><b>Keyboard + your choice of aim</b></div><div class="deck-input-choices" role="group" aria-label="Pointing device"><button type="button" class="ui-button" data-deck-device="mouse" aria-pressed="false">Mouse</button><button type="button" class="ui-button" data-deck-device="trackpad" aria-pressed="false">MacBook trackpad</button></div><button type="button" class="text-button" data-tune-aim>Tune & test ↗</button></section>
    <div class="deck-key-reference" id="deck-key-reference" aria-label="Your current essential keys"></div>
    <div class="deck-control-warning" id="deck-control-warning" role="status" hidden><span></span><button type="button" class="ui-button" data-review-keys>Review missing keys ↗</button></div>
    <section class="flight-selector" aria-labelledby="flight-style-title"><div class="section-heading"><h2 id="flight-style-title">Choose your flight</h2><div class="deck-campaign-progress"><span id="campaign-count"></span><progress id="deck-campaign-meter" max="30" value="0" aria-label="Campaign missions completed"></progress></div></div><div class="mode-grid" role="group" aria-label="Flight type">${MODES.map(m=>`<button type="button" class="mode-card" data-mode="${m.id}" aria-pressed="false"><span class="mode-number">${m.number}</span><b>${m.name}</b><small>${m.note}</small><span class="mode-check" aria-hidden="true">✓</span></button>`).join('')}</div></section>
    <section class="launch-layout"><div class="region-picker"><div class="section-heading"><h2 id="region-label">Select a region</h2><span id="region-note">Real terrain. Different challenges.</span></div><div class="region-grid" role="group" aria-labelledby="region-label">${Object.entries(FRONTS).map(([id,f])=>`<button type="button" class="region-card" data-front="${id}" aria-pressed="false"><span class="region-art" style="--terrain-image:url('/assets/preflight/${f.asset}.webp')"><span class="region-tag">${f.tag}</span><span class="region-compass" aria-hidden="true">N<br>↑</span></span><span class="region-copy"><b>${f.name}</b><small>${f.place}</small></span><span class="region-check" aria-hidden="true">✓</span></button>`).join('')}</div><div class="time-picker"><span id="conditions-label">Time of day</span><div class="time-choices" role="group" aria-label="Time of day">${[['noon','High noon'],['afternoon','Afternoon'],['golden','Golden hour']].map(([id,label])=>`<button type="button" class="ui-button" data-time="${id}" aria-pressed="false">${label}</button>`).join('')}</div><span id="mission-conditions" hidden>Conditions are part of the mission.</span></div></div>
    <article class="flight-brief" aria-labelledby="brief-title"><p class="eyebrow" id="brief-eyebrow"></p><h2 id="brief-title"></h2><p id="brief-copy"></p><ul id="brief-features"></ul><button class="text-button" type="button" id="brief-more" hidden>Read the full briefing <span aria-hidden="true">↗</span></button><div class="brief-footer" id="brief-footer"></div></article></section>
    <section class="launch-bar" aria-label="Launch your flight"><div><b id="launch-label">Ready for a practice flight</b><span id="setup-summary"></span></div><button id="flyBtn" class="ui-button primary launch-button" type="button"><span id="launch-action">Start practice</span><span aria-hidden="true">↗</span></button></section>
    <p id="deck-status" class="deck-status" role="status" aria-live="polite"></p></main>
    <footer class="deck-footer"><span id="deck-storage-note">Progress & preferences use this browser’s storage.</span><div><button type="button" class="text-button" data-fullscreen>Fullscreen</button><a href="/audio-credits.html" target="_blank" rel="noopener">Sound credits ↗</a><a href="/devlog.html" target="_blank" rel="noopener">Development notes ↗</a><span>RAPTOR 1.10.0</span></div></footer></div>`;

  function refreshSetup() {
    const s=SETTINGS.current();
    const persistent=input.storageAvailable && SETTINGS.storageAvailable() && planStorageAvailable;
    const essentials=Object.values(input.actions).filter(action=>action.essential);
    const missing=essentials.filter(action=>!action.binds.length);
    root.querySelector('#readiness-status').textContent=missing.length?'A few controls need your attention':'Ready when you are';
    root.querySelector('#readiness-controls').textContent=`${essentials.length-missing.length} / ${essentials.length} essential keyboard actions assigned`;
    root.querySelector('#readiness-comfort').textContent=`${s.pointingDevice==='trackpad'?'Trackpad':'Mouse'} · ${s.tier==='AUTO'?'Automatic graphics':s.tier+' graphics'} · ${s.muted?'Muted':Math.round(s.masterVol*100)+'% volume'}`;
    const warning=root.querySelector('#deck-control-warning');
    warning.hidden=!missing.length;
    warning.querySelector('span').textContent=`Unassigned: ${missing.map(action=>action.label).join(', ')}. Review these keys before flying; controller mappings are still available.`;
    root.querySelector('#deck-key-reference').innerHTML=[['throttle_up','Throttle up'],['throttle_down','Throttle down'],['roll_left','Roll left'],['roll_right','Roll right'],['fire_mguns','Cannon'],['fire_aam','Missile'],['recenter_aim','Recenter']].map(([id,label])=>`<span><kbd>${escapeHTML(bindingLabel(input,id))}</kbd>${label}</span>`).join('');
    root.querySelector('#setup-summary').textContent=`${s.pointingDevice==='trackpad'?'Trackpad':'Mouse'} aiming · ${s.tier==='AUTO'?'Automatic graphics':({LOW:'Performance',MED:'Balanced',HIGH:'High',ULTRA:'Ultra'}[s.tier]+' graphics')} · ${persistent?'Setup saves in this browser':'Setup is session only'}`;
    for(const button of root.querySelectorAll('[data-deck-device]'))button.setAttribute('aria-pressed',String(s.pointingDevice===button.dataset.deckDevice));
    root.querySelector('#deck-storage-note').textContent=persistent?'Progress & preferences use this browser’s storage.':'Browser storage unavailable · setup is session only.';
    const storageStatus=persistent?'':'Storage is unavailable. Preferences reset when you launch or reload.';
    root.querySelector('#deck-status').textContent=[missionStatus,storageStatus].filter(Boolean).join(' ');
    root.querySelector('#brief-footer').textContent=!persistent && (plan.mode==='campaign'||plan.mode==='operation')?'Progress cannot be saved while browser storage is unavailable.':briefFooter;
  }
  function setText(id,value){root.querySelector('#'+id).textContent=value;}
  function refresh() {
    const progress=campaignProgress(),next=catalog.find(c=>c.id===progress.next?.id);
    const scripted=plan.mode==='campaign'||plan.mode==='operation';
    for(const b of root.querySelectorAll('[data-mode]')){b.classList.toggle('selected',b.dataset.mode===plan.mode);b.setAttribute('aria-pressed',String(b.dataset.mode===plan.mode));}
    for(const b of root.querySelectorAll('[data-front]')){
      const chosen=plan.mode==='campaign'?(next?.front||plan.front):plan.front;
      b.classList.toggle('selected',b.dataset.front===chosen);b.setAttribute('aria-pressed',String(b.dataset.front===chosen));
      b.disabled=plan.mode==='campaign';
    }
    for(const b of root.querySelectorAll('[data-time]')){b.classList.toggle('selected',b.dataset.time===plan.time);b.setAttribute('aria-pressed',String(b.dataset.time===plan.time));}
    root.querySelector('.time-choices').hidden=scripted;
    root.querySelector('#mission-conditions').hidden=!scripted;
    setText('conditions-label',scripted?'Flight conditions':'Time of day');
    setText('region-label',plan.mode==='campaign'?'Your next mission region':'Select a region');
    setText('region-note',plan.mode==='campaign'?'The campaign takes you across all three fronts.':'Real terrain. Different challenges.');
    setText('campaign-count',`${progress.completed} / ${progress.total} campaign missions complete`);
    root.querySelector('#deck-campaign-meter').value=progress.completed;
    root.querySelector('#deck-campaign-meter').max=progress.total;
    const info={
      practice:{eyebrow:'A little room to learn',title:'Find your wings.',copy:`Learn to fly over ${FRONTS[plan.front].name} with five short exercises, or switch to free flight and explore at your own pace.`,features:['Live coaching for turns, climbs and throttle','Reset to level flight whenever you need','No enemies. No score or clock to protect.'],action:'Start practice',label:'Ready for a practice flight',foot:'New here? This is the best place to start.'},
      battle:{eyebrow:'Clear for combat',title:'Choose your own fight.',copy:`Enter a live battle over ${FRONTS[plan.front].name}. Find enemy targets, protect your aircraft and break the opposing ground force.`,features:['Enemy air and ground threats','Limited aircraft and ammunition','Return to your airfield to rearm'],action:'Launch battle',label:'Ready for a quick battle',foot:'Comfortable with the controls? You’re ready.'},
      campaign:{eyebrow:progress.next?`Campaign / Mission ${String((next?.index||0)+1).padStart(2,'0')}`:'Campaign complete',title:next?.title || (progress.next?'Loading your next mission…':'Every mission. Completed.'),copy:next?.briefing[0] || (progress.next?'Your briefing is on its way.':'Revisit your favorite missions in the pilot log.'),features:next?[`${FRONTS[next.front].place}`,`${missionTypeLabel(next.type)} mission`,`${progress.completed} of ${progress.total} complete`]:[],action:progress.next?'Fly next mission':'Open pilot log',label:progress.next?'Your campaign continues':'Campaign complete',foot:'Mission completions save automatically.'},
      operation:{eyebrow:'The war continues',title:'Move the front line.',copy:'Each sortie changes the next. Win ground, meet returning opponents and shape an ongoing operation in this region.',features:[],action:'Fly operation',label:'Ready for the next sortie',foot:'Results save after each completed sortie.'},
    }[plan.mode];
    if(plan.mode==='operation'){
      const op=operationSummary(plan.front);
      info.features=[`${op.frontKm>0?'+':''}${op.frontKm.toFixed(1)} km front line · ${op.sortieIndex} sorties flown`,`Next: ${missionTypeLabel(op.nextType)} at ${op.nextZoneName}`,op.nemesisName?`Returning opponent: ${op.nemesisName}`:'Your choices shape the next mission'];
      if(op.status!=='live'){info.title=op.status==='won'?'Operation won.':'Time to regroup.';info.action='Start new operation';info.foot='You’ll confirm before replacing this operation.';}
    }
    setText('brief-eyebrow',info.eyebrow);setText('brief-title',info.title);setText('brief-copy',info.copy);briefFooter=info.foot;
    root.querySelector('#brief-features').innerHTML=info.features.map(f=>`<li>${escapeHTML(f)}</li>`).join('');
    root.querySelector('#brief-more').hidden=plan.mode!=='campaign';
    setText('launch-action',info.action);setText('launch-label',info.label);
    root.querySelector('#flyBtn').disabled=launching||(plan.mode==='campaign'&&!!progress.next&&(!next||next.unavailable));
    missionStatus=plan.mode==='campaign'&&next?.unavailable?'This mission’s briefing could not load. Reload the page to try again, or choose Practice flight.':'';
    planStorageAvailable=writeLocal(PREFLIGHT_KEY,plan);
    refreshSetup();
  }
  function launch() {
    if(launching)return;
    const progress=campaignProgress();
    if(plan.mode==='campaign'&&!progress.next){log.show();return;}
    const go=()=>{
      const url=flightURL(plan,progress.next);
      if(!url)return;
      launching=true;root.querySelector('#flyBtn').disabled=true;setText('launch-action','Preparing flight…');location.assign(url);
    };
    if(plan.mode==='operation'&&operationSummary(plan.front).status!=='live'){
      confirmAction({title:'Start a new operation?',message:`This replaces the completed ${FRONTS[plan.front].name} operation. Your campaign mission completions and other regions are kept.`,action:'Start new operation',onConfirm:()=>{
        try{localStorage.removeItem('raptor.op.v1:'+plan.front);}catch{setText('deck-status','This browser could not reset the operation. Enable local storage, or choose a practice flight.');return;}
        go();
      }});
    } else go();
  }
  for(const b of root.querySelectorAll('[data-open]'))b.onclick=()=>{
    if(b.dataset.open==='controls'||b.dataset.open==='settings')controls.show(b.dataset.open);
    else if(b.dataset.open==='guide')guide.show();else log.show();
  };
  for(const b of root.querySelectorAll('[data-mode]'))b.onclick=()=>{plan.mode=b.dataset.mode;refresh();};
  for(const b of root.querySelectorAll('[data-front]'))b.onclick=()=>{plan.front=b.dataset.front;refresh();};
  for(const b of root.querySelectorAll('[data-time]'))b.onclick=()=>{plan.time=b.dataset.time;refresh();};
  root.querySelector('#brief-more').onclick=()=>log.show();
  for(const button of root.querySelectorAll('[data-deck-device]'))button.onclick=()=>{const settings=SETTINGS.saveSettings({pointingDevice:button.dataset.deckDevice});input.setOptions(SETTINGS.getAimOptions(settings));};
  root.querySelector('[data-tune-aim]').onclick=()=>controls.show('controls');
  root.querySelector('[data-review-keys]').onclick=()=>controls.showMissingControls();
  root.querySelector('#flyBtn').onclick=launch;
  root.querySelector('[data-fullscreen]').onclick=e=>fullscreen(e.currentTarget);
  refresh();
  campaignCatalog().then(items=>{catalog=items;refresh();});
  window.addEventListener('raptor-settings-change',refreshSetup);
  window.addEventListener('raptor-bindings-change',refreshSetup);
  document.title='RAPTOR — Preflight';
  return {input,controls,guide,log};
}
