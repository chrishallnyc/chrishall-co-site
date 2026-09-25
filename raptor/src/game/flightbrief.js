// Render-side mission overview, using the same authoritative script state as
// the flight HUD. Never infers victory from a local display counter.
const LABELS = {destroy_tag:'Destroy the marked targets',protect_tag:'Keep the protected units alive',reach_zone:'Reach the marked area',survive_until:'Hold your position',kill_ace:'Defeat the enemy ace'};
export function flightBrief(state) {
  const script=state.script;
  if (!script) return null;
  const lines=state.missionData?.lines||{};
  const objectives=script.objectiveSummary().map(o=>({
    label: lines[o.labelId] || LABELS[o.kind] || 'Complete the objective',
    status:o.failed?'failed':o.kind==='protect_tag'&&state.match?.over===1?'protected':o.done?'done':'pending',
    protection:o.kind==='protect_tag',
    // Protection counters measure losses, never progress toward a reward.
    detail:o.kind==='protect_tag'?'Keep safe':o.need>1?`${Math.min(o.count,o.need)} / ${o.need}`:'',
  }));
  const limit=script.spec.timeLimitS;
  const remaining=Number.isFinite(limit)&&limit>0?Math.max(0,Math.ceil(limit-(state.sim?.time||0))):null;
  return {objectives,completed:objectives.filter(o=>!o.protection&&o.status==='done').length,total:objectives.filter(o=>!o.protection).length,
    remaining:remaining===null?null:`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`};
}
