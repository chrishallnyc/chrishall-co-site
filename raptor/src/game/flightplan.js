export const PREFLIGHT_KEY='raptor.preflight.v1';
export const FRONTS=['NELLIS','VALDEZ','MARIANAS'];
export const MODES=['practice','battle','campaign','operation'];
export const TIMES=['noon','afternoon','golden'];
export function validateFlightPlan(value) {
  const v=value && typeof value==='object'?value:{};
  return {front:FRONTS.includes(v.front)?v.front:'NELLIS',mode:MODES.includes(v.mode)?v.mode:'practice',time:TIMES.includes(v.time)?v.time:'noon'};
}
export function flightURL(value, sortie) {
  const p=validateFlightPlan(value);
  const query=new URLSearchParams({front:p.front});
  if(p.mode==='campaign') {
    if(!sortie || !/^[NVM]\d{2}$/.test(sortie.id) || !FRONTS.includes(sortie.front))return null;
    query.set('front',sortie.front);query.set('sortie',sortie.id);
  } else if(p.mode==='operation')query.set('op','1');
  else {
    const golden={NELLIS:18.8,VALDEZ:21.4,MARIANAS:17.8};
    query.set('tod',String(p.time==='noon'?12:p.time==='afternoon'?15.5:golden[p.front]));
    if(p.mode==='practice'){query.set('mode','practice');query.set('nobattle','1');query.set('nomatch','1');}
  }
  return '?'+query;
}
export function hasFlightRequest(query) {
  // Sharing/analytics parameters should not throw a new pilot into combat.
  return query.get('mode') === 'practice' || ['front','sortie','mission','op','demo','gl','noterrain','nobattle','nomatch','frame','fixyaw'].some(k=>query.has(k));
}
