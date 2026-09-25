import { CAMPAIGN, SCENARIOS, loadAuth, isUnlocked, loadSortie, loadScenarioProgress } from '../campaign/authored.js';
import { loadSave, summarize } from '../campaign/engine.js';
import { GameDialog, escapeHTML } from './ui.js';
import { filterMissions, missionPreparation } from './missioncatalog.js';
import { winsAtTimeLimit } from './missions.js';

export const FRONTS = {
  NELLIS:{name:'Nellis',place:'Nevada test range',description:'Desert basins, long sightlines and a clear horizon.',asset:'nellis',tag:'Recommended first flight'},
  VALDEZ:{name:'Valdez',place:'Prince William Sound, Alaska',description:'Glacier valleys, mountain passes and coastal shipping.',asset:'valdez',tag:'Mountain flying'},
  MARIANAS:{name:'Marianas',place:'Western Pacific',description:'Open ocean, island terrain and a carrier battle group.',asset:'marianas',tag:'Ocean operations'},
  NEWYORK:{name:'New York',place:'New York City & harbor',description:'Manhattan, the five boroughs and the waterways of New York Harbor.',asset:'newyork',tag:'City flight',battle:false,operation:false,scenario:'Y01'},
};
const MISSION_LABELS = {
  strike:'Strike',sead:'Air defense suppression',anti_ship:'Anti-ship',convoy:'Convoy',
  intercept:'Intercept',escort:'Escort',fleet_defense:'Fleet defense',cap:'Combat air patrol',
};
export function missionTypeLabel(type) {
  if (Object.hasOwn(MISSION_LABELS,type)) return MISSION_LABELS[type];
  return typeof type==='string' && type.trim() ? type.replace(/_/g,' ').replace(/^./,letter=>letter.toUpperCase()) : 'Mission';
}
let catalogPromise;
export function campaignCatalog() {
  return catalogPromise ||= Promise.all(CAMPAIGN.map(async (entry, index) => {
    try {
      const sortie = await loadSortie(entry.id);
      return {...entry,index,title:sortie.lines[sortie.meta.titleId] || entry.id,
        briefing:sortie.meta.briefingIds.map(id => sortie.lines[id]).filter(Boolean),
        type:sortie.spec.type || 'mission',typeLabel:missionTypeLabel(sortie.spec.type),
        objectives:missionPreparation(sortie),timeoutWin:winsAtTimeLimit(sortie.spec),minutes:Math.round((sortie.spec.timeLimitS || 0)/60)};
    } catch { return {...entry,index,title:entry.id,briefing:['Briefing unavailable. Try reloading the page.'],unavailable:true}; }
  }));
}
export function campaignProgress() {
  const saved=loadAuth();
  const completed=CAMPAIGN.filter(c=>saved.done[c.id]).length;
  const next=CAMPAIGN.find((c,i)=>!saved.done[c.id] && isUnlocked(saved,i));
  return {saved,completed,total:CAMPAIGN.length,next};
}
export function operationSummary(front) {
  const save=loadSave(front);
  return {...summarize(save),log:save.log || []};
}
export function sortieURL(sortie) {
  return `?front=${encodeURIComponent(sortie.front)}&sortie=${encodeURIComponent(sortie.id)}`;
}

export class PilotLog extends GameDialog {
  constructor({onClose,onLaunch}={}) {
    super({title:'Your pilot log',label:'Campaign & operations',className:'pilot-log',onClose});
    this.onLaunch=onLaunch || (sortie=>location.assign(sortieURL(sortie)));
    this.filter='ALL'; this.status='all'; this.query=''; this.selected=null; this.catalog=[];
  }
  async show(missionId) {
    this.body.innerHTML='<p class="dialog-intro" role="status">Loading your campaign…</p>';
    super.show();
    this.catalog=await campaignCatalog();
    if(!this.open)return;
    const progress=campaignProgress();
    if (missionId && this.catalog.some(c=>c.id===missionId)) {
      this.selected=missionId;
      this.filter='ALL';this.status='all';this.query='';
    }
    this.selected ||= progress.next?.id || this.catalog[0]?.id;
    this.render();
  }
  render() {
    const p=campaignProgress();
    const filtered=filterMissions(this.catalog,p.saved,{front:this.filter,status:this.status,query:this.query});
    const selected=filtered.find(c=>c.id===this.selected) || filtered[0];
    this.selected=selected?.id || null;
    const open=selected && isUnlocked(p.saved,selected.index);
    const done=selected && !!p.saved.done[selected.id];
    const listScroll=this.body.querySelector('.mission-list')?.scrollTop || 0;
    const sameResults=[...this.body.querySelectorAll('[data-mission]')].map(row=>row.dataset.mission).join(',')===filtered.map(row=>row.id).join(',');
    this.body.innerHTML=`<div class="log-summary"><div><strong>${p.completed}<span> / ${p.total}</span></strong><p>missions completed</p></div><div class="log-progress"><progress max="${p.total}" value="${p.completed}" aria-label="Campaign completion"></progress><p>${p.next?`Next up: ${escapeHTML(this.catalog.find(c=>c.id===p.next.id)?.title || p.next.id)}`:'Campaign complete. Replay any mission.'}</p></div><button type="button" class="ui-button log-backup-button" data-pilot-backup>Backup & restore</button></div><p class="backup-status" role="status" data-backup-load-status></p>
      <div class="log-filters" role="group" aria-label="Filter missions by region">${[['ALL','All regions'],...Object.entries(FRONTS).filter(([id])=>CAMPAIGN.some(c=>c.front===id)).map(([id,f])=>[id,f.name])].map(([id,name])=>`<button type="button" class="ui-button ${this.filter===id?'selected':''}" aria-pressed="${this.filter===id}" data-filter="${id}">${name}</button>`).join('')}</div>
      <div class="log-search"><label>Find a mission<input type="search" data-mission-search placeholder="Name, mission ID, or mission type" value="${escapeHTML(this.query)}" autocomplete="off" spellcheck="false"></label><label>Mission status<select data-mission-status>${[['all','All missions'],['ready','Ready to fly'],['completed','Completed'],['locked','Locked']].map(([id,label])=>`<option value="${id}" ${this.status===id?'selected':''}>${label}</option>`).join('')}</select></label></div>
      <div class="log-results"><p role="status" aria-live="polite" data-mission-count>${filtered.length} of ${this.catalog.length} missions${this.query.trim()?` matching “${escapeHTML(this.query.trim())}”`:''}</p>${p.next?'<button type="button" class="text-button" data-next-briefing>Jump to next mission ↗</button>':'<span>Campaign complete · Every mission is replayable</span>'}</div>
      <div class="log-layout" ${selected?'':'hidden'}><div class="mission-list" role="list" aria-label="Campaign missions">${filtered.map(c=>{
        const complete=!!p.saved.done[c.id],unlocked=isUnlocked(p.saved,c.index);
        return `<div role="listitem"><button type="button" class="mission-row ${c.id===this.selected?'selected':''}" data-mission="${c.id}" aria-pressed="${c.id===this.selected}" aria-controls="pilot-mission-briefing"><span class="mission-number">${c.id}</span><span><b>${escapeHTML(c.title)}</b><small>${FRONTS[c.front].name} · ${complete?'Completed':unlocked?'Ready to fly':'Locked'}</small><small class="mission-row-type">${escapeHTML(missionTypeLabel(c.type))}${c.minutes?` · ${c.minutes} min limit`:''}</small></span><span class="mission-state" aria-hidden="true">${complete?'✓':unlocked?'↗':'—'}</span></button></div>`;
      }).join('')}</div><article class="mission-briefing" id="pilot-mission-briefing"><p class="eyebrow">${selected?`${FRONTS[selected.front].name} / ${selected.id} / Mission ${String(selected.index+1).padStart(2,'0')}`:''}</p><h3 tabindex="-1">${escapeHTML(selected?.title)}</h3><div class="briefing-tags"><span>${escapeHTML(missionTypeLabel(selected?.type))}</span>${selected?.minutes?`<span>${selected.minutes} minute limit</span>`:''}<span>${done?'Completed':open?'Available':'Locked'}</span></div>
      <button class="ui-button primary" type="button" data-launch-mission ${!open||selected?.unavailable?'disabled':''}>${done?'Replay mission':open?'Fly this mission':'Mission locked'} <span aria-hidden="true">↗</span></button>
      ${selected?.briefing.map(line=>`<p>${escapeHTML(line)}</p>`).join('') || ''}
      ${selected?.objectives?.length?`<details class="briefing-objectives"><summary>Plan your sortie <span>${selected.objectives.length} objectives</span></summary>${selected.timeoutWin?'<p class="briefing-win-rule">Hold until the time limit to win. Keep your remaining aircraft and all “Must hold” objectives safe; completing the early-victory objectives finishes the mission sooner.</p>':''}<ol>${selected.objectives.map(objective=>`<li><b>${escapeHTML(objective.label)}${objective.count?` · ${objective.count} targets`:''}</b><small>${objective.purpose}</small></li>`).join('')}</ol></details>`:''}
      ${!open?`<div class="info-callout">Complete <b>${escapeHTML(this.catalog.find(c=>c.id===p.next?.id)?.title || 'the earlier missions')}</b> to advance through the campaign. You can read every briefing now.</div>`:''}
      </article></div>
      ${!selected?'<div class="log-empty"><h3>No missions match these filters</h3><p>Try a mission name, an ID such as N01, or a type such as escort.</p><button type="button" class="ui-button" data-clear-mission-filters>Clear filters</button></div>':''}
      <section class="operation-ledger"><h3>Standalone scenarios</h3><p class="section-description">Optional stories with their own briefings and completion record.</p><div class="operation-grid">${SCENARIOS.map(s=>`<article><p class="eyebrow">${escapeHTML(FRONTS[s.front].name)} · ${escapeHTML(s.category)}</p><strong>${escapeHTML(s.title)}</strong><p>${escapeHTML(s.description)}</p><button class="ui-button" type="button" data-scenario="${s.id}">${loadScenarioProgress().done[s.id]?'Replay briefing':'Read briefing'} ↗</button></article>`).join('')}</div></section>
      <section class="operation-ledger"><h3>Ongoing operations</h3><p class="section-description">Combat regions have their own persistent front line, separate from the campaign.</p><div class="operation-grid">${Object.entries(FRONTS).filter(([,f])=>f.operation!==false).map(([id,f])=>{const s=operationSummary(id);return `<article><p class="eyebrow">${f.name}</p><strong>${s.frontKm>0?'+':''}${s.frontKm.toFixed(1)} km</strong><p>${s.sortieIndex} sorties flown · ${s.status==='live'?'In progress':s.status==='won'?'Won':'Lost'}</p><small>Next: ${escapeHTML(missionTypeLabel(s.nextType))} · ${escapeHTML(s.nextZoneName)}</small></article>`;}).join('')}</div></section>`;
    for(const b of this.body.querySelectorAll('[data-filter]'))b.onclick=()=>{
      this.filter=b.dataset.filter;
      this.render();this.body.querySelector(`[data-filter="${this.filter}"]`).focus();
    };
    const list=this.body.querySelector('.mission-list');
    list.scrollTop=sameResults?listScroll:0;
    if(!sameResults&&selected){
      const row=list.querySelector(`[data-mission="${this.selected}"]`);
      const rowBottom=row.getBoundingClientRect().bottom-list.getBoundingClientRect().top;
      if(rowBottom>list.clientHeight)list.scrollTop=rowBottom-list.clientHeight;
    }
    for(const b of this.body.querySelectorAll('[data-mission]'))b.onclick=()=>{
      this.selected=b.dataset.mission;this.render();
      if(matchMedia('(max-width:760px)').matches)this.focusBriefing();
      else this.body.querySelector(`[data-mission="${this.selected}"]`)?.focus({preventScroll:true});
    };
    this.body.querySelector('[data-mission-search]').oninput=event=>{
      const input=event.currentTarget,position=input.selectionStart;
      this.query=input.value;this.render();
      const restored=this.body.querySelector('[data-mission-search]');restored.focus({preventScroll:true});
      if(position!==null)restored.setSelectionRange?.(position,position);
    };
    this.body.querySelector('[data-mission-status]').onchange=event=>{this.status=event.currentTarget.value;this.render();this.body.querySelector('[data-mission-status]').focus({preventScroll:true});};
    this.body.querySelector('[data-clear-mission-filters]')?.addEventListener('click',()=>{
      this.filter='ALL';this.status='all';this.query='';this.selected=p.next?.id || null;this.render();this.body.querySelector('[data-mission-search]').focus({preventScroll:true});
    });
    this.body.querySelector('[data-next-briefing]')?.addEventListener('click',()=>{
      this.filter='ALL';this.status='ready';this.query='';this.selected=p.next.id;this.render();this.focusBriefing();
    });
    this.body.querySelector('[data-launch-mission]')?.addEventListener('click',()=>{if(open&&!selected.unavailable)this.onLaunch(selected);});
    for(const b of this.body.querySelectorAll('[data-scenario]')) b.onclick=async()=>{
      const entry=SCENARIOS.find(s=>s.id===b.dataset.scenario);
      if(!entry)return;
      b.disabled=true;
      try {
        const sortie=await loadSortie(entry.id);
        if(!this.open)return;
        const dialog=new GameDialog({title:entry.title,label:entry.category,onClose:()=>dialog.el.remove()});
        dialog.body.innerHTML=sortie.meta.briefingIds.map(id=>`<p>${escapeHTML(sortie.lines[id])}</p>`).join('')+`<p class="save-note">${escapeHTML(sortie.lines[sortie.meta.contentNoteId])}</p><button class="ui-button primary" type="button" data-fly-scenario>Fly ${escapeHTML(entry.title)} ↗</button>`;
        dialog.body.querySelector('[data-fly-scenario]').onclick=()=>this.onLaunch(entry);
        dialog.show();
      } catch { b.textContent='Briefing unavailable · retry'; }
      finally { b.disabled=false; }
    };
    this.body.querySelector('[data-pilot-backup]').onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;
      try {
        const {PilotBackupMenu}=await import('./pilotbackupmenu.js');
        if(this.open)new PilotBackupMenu().show();
      } catch {this.body.querySelector('[data-backup-load-status]').textContent='Backup tools could not load. Check your connection and try again.';}
      finally {button.disabled=false;}
    };
  }
  focusBriefing() {
    const briefing=this.body.querySelector('.mission-briefing');
    briefing.querySelector('h3').focus({preventScroll:true});
    // Focusing a heading can reveal only its last line at the bottom of the
    // dialog. Align the whole briefing so its launch action is visible too.
    briefing.scrollIntoView({block:'start'});
  }
}
