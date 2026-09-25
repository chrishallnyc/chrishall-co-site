import { isUnlocked } from '../campaign/authored.js';
import { objectiveLabel } from './missionguidance.js';
import { winsAtTimeLimit } from './missions.js';

const searchable = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export function missionStatus(entry, saved) {
  return saved.done[entry.id] ? 'completed' : isUnlocked(saved, entry.index) ? 'ready' : 'locked';
}

export function filterMissions(catalog, saved, {front = 'ALL', status = 'all', query = ''} = {}) {
  const words = searchable(query).trim().split(/\s+/).filter(Boolean);
  return catalog.filter(entry => {
    if (front !== 'ALL' && entry.front !== front) return false;
    if (status !== 'all' && missionStatus(entry, saved) !== status) return false;
    const text = searchable([entry.id, entry.title, entry.front, entry.type,
      entry.typeLabel, ...(entry.briefing || [])].join(' '));
    return words.every(word => text.includes(word));
  });
}

// Briefing data only. Do not invent live target locations or reveal identities
// from later radio calls; use the same objective labels as the cockpit.
export function missionObjectivePurpose(spec, objective) {
  return (spec.winWhen || []).includes(objective.id) ? (winsAtTimeLimit(spec) ? 'For early victory' : 'Required')
    : (spec.loseWhen || []).includes(objective.id) ? 'Must hold'
      : objective.kind === 'reach_zone' ? 'Navigation' : 'Optional';
}

export function missionPreparation(sortie) {
  const spec = sortie.spec;
  return (spec.objectives || []).map(objective => ({
    label: objectiveLabel(objective, objective, {missionData: {lines: sortie.lines}}),
    count: objective.kind === 'destroy_tag' && Number.isInteger(objective.need) && objective.need > 1 ? objective.need : null,
    purpose: missionObjectivePurpose(spec, objective),
  }));
}
