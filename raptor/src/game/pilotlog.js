import { CAMPAIGN, SCENARIOS, loadAuth, isUnlocked, loadSortie, loadScenarioProgress } from '../campaign/authored.js';
import { loadSave, summarize } from '../campaign/engine.js';
import { GameDialog, escapeHTML } from './ui.js';

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
        type:sortie.spec.type || 'mission',minutes:Math.round((sortie.spec.timeLimitS || 0)/60)};
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
    this.filter='ALL'; this.selected=null; this.catalog=[];
  }
  async show(missionId) {
    this.body.innerHTML='<p class="dialog-intro" role="status">Loading your campaign…</p>';
    super.show();
    this.catalog=await campaignCatalog();
    if(!this.open)return;
    const progress=campaignProgress();
    if (missionId && this.catalog.some(c=>c.id===missionId)) {
      this.selected=missionId;
      this.filter='ALL';
    }
    this.selected ||= progress.next?.id || this.catalog[0]?.id;
    this.render();
  }
  render() {
    const p=campaignProgress();
    const selected=this.catalog.find(c=>c.id===this.selected) || this.catalog[0];
    const open=selected && isUnlocked(p.saved,selected.index);
    const done=selected && !!p.saved.done[selected.id];
    const filtered=this.catalog.filter(c=>this.filter==='ALL'||c.front===this.filter);
    this.body.innerHTML=`<div class="log-summary"><div><strong>${p.completed}<span> / ${p.total}</span></strong><p>missions completed</p></div><div class="log-progress"><progress max="${p.total}" value="${p.completed}" aria-label="Campaign completion"></progress><p>${p.next?`Next up: ${escapeHTML(this.catalog.find(c=>c.id===p.next.id)?.title || p.next.id)}`:'Campaign complete. Replay any mission.'}</p></div><span class="save-note">Local progress</span></div>
      <div class="log-filters" role="group" aria-label="Filter missions by region">${[['ALL','All regions'],...Object.entries(FRONTS).filter(([id])=>CAMPAIGN.some(c=>c.front===id)).map(([id,f])=>[id,f.name])].map(([id,name])=>`<button type="button" class="ui-button ${this.filter===id?'selected':''}" aria-pressed="${this.filter===id}" data-filter="${id}">${name}</button>`).join('')}</div>
      <div class="log-layout"><div class="mission-list" role="list" aria-label="Campaign missions">${filtered.map(c=>{
        const complete=!!p.saved.done[c.id],unlocked=isUnlocked(p.saved,c.index);
        return `<div role="listitem"><button type="button" class="mission-row ${c.id===this.selected?'selected':''}" data-mission="${c.id}" aria-pressed="${c.id===this.selected}"><span class="mission-number">${String(c.index+1).padStart(2,'0')}</span><span><b>${escapeHTML(c.title)}</b><small>${FRONTS[c.front].name} · ${complete?'Completed':unlocked?'Ready to fly':'Locked'}</small></span><span class="mission-state" aria-hidden="true">${complete?'✓':unlocked?'↗':'—'}</span></button></div>`;
      }).join('')}</div><article class="mission-briefing"><p class="eyebrow">${selected?`${FRONTS[selected.front].name} / Mission ${String(selected.index+1).padStart(2,'0')}`:''}</p><h3>${escapeHTML(selected?.title)}</h3><div class="briefing-tags"><span>${escapeHTML(missionTypeLabel(selected?.type))}</span>${selected?.minutes?`<span>${selected.minutes} minute limit</span>`:''}<span>${done?'Completed':open?'Available':'Locked'}</span></div>${selected?.briefing.map(line=>`<p>${escapeHTML(line)}</p>`).join('') || ''}
      ${!open?`<div class="info-callout">Complete <b>${escapeHTML(this.catalog.find(c=>c.id===p.next?.id)?.title || 'the earlier missions')}</b> to advance through the campaign. You can read every briefing now.</div>`:''}
      <button class="ui-button primary" type="button" data-launch-mission ${!open||selected?.unavailable?'disabled':''}>${done?'Replay mission':open?'Fly this mission':'Mission locked'} <span aria-hidden="true">↗</span></button></article></div>
      <section class="operation-ledger"><h3>Standalone scenarios</h3><p class="section-description">Optional stories with their own briefings and completion record.</p><div class="operation-grid">${SCENARIOS.map(s=>`<article><p class="eyebrow">${escapeHTML(FRONTS[s.front].name)} · ${escapeHTML(s.category)}</p><strong>${escapeHTML(s.title)}</strong><p>${escapeHTML(s.description)}</p><button class="ui-button" type="button" data-scenario="${s.id}">${loadScenarioProgress().done[s.id]?'Replay briefing':'Read briefing'} ↗</button></article>`).join('')}</div></section>
      <section class="operation-ledger"><h3>Ongoing operations</h3><p class="section-description">Combat regions have their own persistent front line, separate from the campaign.</p><div class="operation-grid">${Object.entries(FRONTS).filter(([,f])=>f.operation!==false).map(([id,f])=>{const s=operationSummary(id);return `<article><p class="eyebrow">${f.name}</p><strong>${s.frontKm>0?'+':''}${s.frontKm.toFixed(1)} km</strong><p>${s.sortieIndex} sorties flown · ${s.status==='live'?'In progress':s.status==='won'?'Won':'Lost'}</p><small>Next: ${escapeHTML(missionTypeLabel(s.nextType))} · ${escapeHTML(s.nextZoneName)}</small></article>`;}).join('')}</div></section>`;
    for(const b of this.body.querySelectorAll('[data-filter]'))b.onclick=()=>{
      this.filter=b.dataset.filter;
      if(this.filter!=='ALL' && selected?.front!==this.filter)this.selected=this.catalog.find(c=>c.front===this.filter)?.id;
      this.render();this.body.querySelector(`[data-filter="${this.filter}"]`).focus();
    };
    for(const b of this.body.querySelectorAll('[data-mission]'))b.onclick=()=>{this.selected=b.dataset.mission;this.render();this.body.querySelector(`[data-mission="${this.selected}"]`)?.focus();};
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
  }
}
