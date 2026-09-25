// Render-side mission overview, using the same authoritative script state as
// the flight HUD. Never infers victory from a local display counter.
import { missionObjectiveRows } from './missionguidance.js';
export function flightBrief(state) {
  const script=state.script;
  if (!script) return null;
  const objectives=missionObjectiveRows(state).map(o=>({
    label: o.label,
    status:o.failed?'failed':o.kind==='protect_tag'&&state.match?.over===1?'protected':o.done?'done':'pending',
    protection:o.kind==='protect_tag',
    // Protection counters measure losses, never progress toward a reward.
    detail:o.kind==='protect_tag'?'Keep safe':o.need>1?`${Math.min(o.count,o.need)} / ${o.need}`:'',
  }));
  const limit=script.spec.timeLimitS;
  const remaining=Number.isFinite(limit)&&limit>0?Math.max(0,Math.ceil(limit-(state.sim?.time||0))):null;
  const meta=state.missionData?.meta,lines=state.missionData?.lines||{};
  return {objectives,completed:objectives.filter(o=>!o.protection&&o.status==='done').length,total:objectives.filter(o=>!o.protection).length,
    title:meta?lines[meta.titleId]||'':'',briefing:meta?.meta?.standalone?(meta.briefingIds||[]).map(id=>lines[id]).filter(Boolean):[],contentNote:meta?lines[meta.contentNoteId]||'':'',
    remaining:remaining===null?null:`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`};
}
