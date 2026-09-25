// Presentation only: objective status and target positions remain owned by
// Script and the combat pools. Coordinates are ENU (east, north, altitude).
const SHIPS = new Set(['cargo_ship', 'destroyer', 'carrier']);
const AIR_DEFENSE = new Set(['zsu', 'sam_tel', 'sam_radar']);

function targetSlots(definition, state) {
  const air = definition.air || definition.kind === 'kill_ace';
  const pool = air ? state.bandits : state.battlefield;
  if (!pool) return [];
  if (!air && definition.bfIdx?.length) return definition.bfIdx;
  if (definition.kind !== 'kill_ace' && !Number.isFinite(definition.tag)) return [];
  const slots = [];
  const candidates = air && state.script?._bSlots
    ? state.script._bSlots : Array.from({ length: air ? pool.live.length : (pool.cap || pool.n) }, (_, i) => i);
  for (const slot of candidates) {
    if (slot < 0 || (!air && pool.slotUsed && !pool.slotUsed[slot])) continue;
    if (definition.kind === 'kill_ace' ? pool.aceId?.[slot] === definition.aceId : pool.tag?.[slot] === definition.tag) slots.push(slot);
  }
  return slots;
}

export function objectiveLabel(objective, definition = objective, state = {}) {
  const authored = state.missionData?.lines?.[objective.labelId ?? definition.labelId];
  if (authored) return authored;
  if (objective.kind === 'reach_zone') return 'Reach the mission area';
  if (objective.kind === 'survive_until') return 'Survive the countdown';
  if (objective.kind === 'kill_ace') return 'Defeat the enemy ace';
  if (objective.kind === 'protect_tag' && definition.air && definition.zone) return 'Keep enemy aircraft out of the protected area';
  const protection = objective.kind === 'protect_tag';
  if (definition.air) return protection ? 'Protect friendly aircraft' : 'Destroy enemy aircraft';
  const types = targetSlots(definition, state).map(slot => state.battlefield?.types?.[slot]).filter(Boolean);
  if (types.length && types.every(type => SHIPS.has(type))) return protection ? 'Protect friendly ships' : 'Destroy enemy ships';
  if (types.length && types.every(type => type === 'supply_truck')) return protection ? 'Protect the convoy' : 'Destroy the convoy trucks';
  if (!protection && types.length && types.every(type => AIR_DEFENSE.has(type))) return 'Destroy the air defenses';
  return protection ? 'Protect friendly units' : objective.kind === 'destroy_tag' ? 'Destroy ground targets' : 'Complete the objective';
}

export function missionObjectiveRows(state, summary = state.script?.objectiveSummary() || []) {
  const definitions = state.missionData?.spec?.objectives || state.script?.spec?.objectives || [];
  return summary.map(objective => {
    const definition = definitions.find(candidate => candidate.id === objective.id) || objective;
    return { ...objective, definition, label: objectiveLabel(objective, definition, state) };
  });
}

export function missionNavigation(state, rows = missionObjectiveRows(state)) {
  const player = state.player?.fm?.state;
  if (!player || state.match?.over) return null;
  // Preserve authored ingress/required-task order, without letting optional
  // combat goals divert the pilot from a remaining victory condition. Script
  // has no activation flags; a missing required target must not reveal a
  // later wave. Older callers without winWhen retain the authored sequence.
  const required = state.missionData?.spec?.winWhen ?? state.script?.spec?.winWhen;
  const objective = rows.find(row => !row.done && !row.failed && row.kind !== 'protect_tag'
    && (!required || row.kind === 'reach_zone' || required.includes(row.id)));
  if (!objective) return null;
  const definition = objective.definition;
  let east, north;
  if (objective.kind === 'reach_zone') {
    east = definition.zone?.x; north = definition.zone?.y;
  } else if (objective.kind === 'destroy_tag' || objective.kind === 'kill_ace') {
    const air = definition.air || objective.kind === 'kill_ace';
    const pool = air ? state.bandits : state.battlefield;
    const stride = air ? 14 : 5;
    let nearest = Infinity;
    for (const slot of targetSlots(definition, state)) {
      if (!pool.alive(slot)) continue;
      const offset = slot * stride;
      const x = pool.state[offset], y = pool.state[offset + 1];
      const range = Math.hypot(x - player[0], y - player[1]);
      if (range < nearest) { nearest = range; east = x; north = y; }
    }
  }
  if (![east, north, player[0], player[1]].every(Number.isFinite)) return null;
  const distanceM = Math.hypot(east - player[0], north - player[1]);
  const bearing = (Math.atan2(east - player[0], north - player[1]) * 180 / Math.PI + 360) % 360;
  const heading = String(Math.round(bearing) % 360).padStart(3, '0');
  const zone = definition.zone;
  const atArea = objective.kind === 'reach_zone' && distanceM <= zone.r;
  const altitude = Number.isFinite(zone?.aglMax) && zone.aglMax >= 0
    ? `Below ${Math.round(zone.aglMax * 3.28084).toLocaleString('en-US')} ft above terrain` : '';
  return { objectiveId: objective.id, bearing, distanceM,
    text: atArea && altitude ? `In mission area · ${altitude}` : `Heading ${heading}° · ${(distanceM / 1000).toFixed(1)} km`,
  };
}
