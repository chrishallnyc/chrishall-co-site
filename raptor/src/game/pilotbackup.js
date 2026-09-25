// Local, portable pilot profiles. Only explicit game-owned keys can be read or
// restored; renderer benchmarks and unrelated origin storage never travel.
import { CAMPAIGN, SCENARIOS } from '../campaign/authored.js';
import { ACES, operationChecksum } from '../campaign/engine.js';
import { ACTIVE_ACTIONS } from '../engine/binds.js';
import { validChord, chordIdentity } from '../engine/input.js';
import { validate as validateSettings } from './settings.js';
import { validateFlightPlan } from './flightplan.js';

export const BACKUP_LIMIT = 256 * 1024;
const OPERATION_FRONTS = Object.keys(ACES);
export const BACKUP_KEYS = Object.freeze([
  'raptor.auth.v1', ...OPERATION_FRONTS.map(front => 'raptor.op.v1:' + front),
  'raptor.flight-school.v1', 'raptor.settings.v1', 'raptor:binds:v3',
  'raptor.preflight.v1', 'raptor.practice.introduced', 'raptor:quality:v1', 'raptor:mute',
  'raptor.scenarios.v1',
]);
const RESTORE_KEYS = [...BACKUP_KEYS, 'raptor:binds:v2'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uint = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const fail = message => { throw new Error(message); };

function validateOperation(save, front) {
  const aceIds = ACES[front].map(ace => ace.id);
  if (!object(save) || save.v !== 1 || save.front !== front || !uint(save.seed) || !uint(save.sortieIndex)
    || !Number.isFinite(save.frontKm) || Math.abs(save.frontKm) > 16 || !['live','won','lost'].includes(save.status)
    || !Array.isArray(save.log) || save.log.length > 64 || !Array.isArray(save.aces) || save.aces.length !== aceIds.length
    || ![-1,...aceIds].includes(save.nemesisId)) return false;
  if (save.log.some(row => !object(row) || !uint(row.specHash) || ![-1,1].includes(row.result)
    || (row.simHash !== undefined && !/^[\da-f]{8}$/.test(row.simHash)))) return false;
  if (new Set(save.aces.map(ace => ace?.id)).size !== aceIds.length || save.aces.some(ace => !object(ace)
    || !aceIds.includes(ace.id) || !['fresh','escaped','killed'].includes(ace.state) || !uint(ace.escapes)
    || !Number.isFinite(ace.bonus) || ace.bonus < 0 || ace.bonus > 3)) return false;
  return typeof save.sum === 'string' && operationChecksum(save) === save.sum;
}

function validateEntry(key, value) {
  if (value === null) return;
  let good = false;
  if (key === 'raptor.auth.v1') good = object(value) && value.v === 1 && object(value.done)
    && Object.entries(value.done).every(([id, done]) => CAMPAIGN.some(m => m.id === id) && done === 1);
  else if (key === 'raptor.scenarios.v1') good = object(value) && value.v === 1 && object(value.done)
    && Object.entries(value.done).every(([id, done]) => SCENARIOS.some(m => m.id === id) && done === 1);
  else if (key.startsWith('raptor.op.v1:')) good = validateOperation(value, key.slice(13));
  else if (key === 'raptor.flight-school.v1') good = object(value) && value.version === 1
    && Number.isFinite(value.completedAt) && value.completedAt > 0 && Number.isInteger(value.completions)
    && value.completions >= 1 && value.completions <= 9999;
  else if (key === 'raptor.settings.v1') {
    const normalized = validateSettings(value);
    good = object(value) && Object.entries(value).every(([name, setting]) => Object.hasOwn(normalized, name) && Object.is(normalized[name], setting));
  }
  else if (key === 'raptor:binds:v3') good = object(value) && Object.entries(value).every(([id, binds]) =>
    Object.hasOwn(ACTIVE_ACTIONS, id) && Array.isArray(binds) && binds.length <= 4
    && binds.every(chord => validChord(chord)
      && (!chord.includes('Escape') || (id === 'menu' && chord.length === 1))
      && (!ACTIVE_ACTIONS[id].hold || !chord.some(code => code.startsWith('Wheel'))))
    && new Set(binds.map(chordIdentity)).size === binds.length
    && (id !== 'menu' || binds[0]?.length === 1 && binds[0][0] === 'Escape'));
  else if (key === 'raptor.preflight.v1') {
    const normalized = validateFlightPlan(value);
    good = object(value) && ['front','mode','time'].every(name => normalized[name] === value[name]);
  }
  else if (key === 'raptor.practice.introduced') good = typeof value === 'boolean';
  else if (key === 'raptor:quality:v1') good = ['LOW','MED','HIGH','ULTRA'].includes(value);
  else if (key === 'raptor:mute') good = value === '0' || value === '1';
  if (!good) fail('This backup contains an invalid pilot record. Your current profile has not changed.');
}

export function parsePilotBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > BACKUP_LIMIT) fail('Choose a Raptor backup smaller than 256 KB.');
  let backup;
  try { backup = JSON.parse(text); } catch { fail('This file is not valid JSON. Choose a Raptor pilot backup.'); }
  if (!object(backup) || backup.format !== 'raptor-pilot-backup' || backup.version !== 1
    || typeof backup.createdAt !== 'string' || !Number.isFinite(Date.parse(backup.createdAt)) || !object(backup.entries)) {
    fail('This is not a supported Raptor pilot backup. Your current profile has not changed.');
  }
  // Earlier version-1 exports predate standalone scenarios. Their explicit
  // empty scenario record is shown in the same replacement preview.
  if (!Object.hasOwn(backup.entries, 'raptor.scenarios.v1')) backup.entries['raptor.scenarios.v1'] = null;
  if (Object.keys(backup.entries).length !== BACKUP_KEYS.length || BACKUP_KEYS.some(key => !Object.hasOwn(backup.entries, key))) {
    fail('This pilot backup is incomplete or contains unsupported records.');
  }
  for (const key of BACKUP_KEYS) validateEntry(key, backup.entries[key]);
  return backup;
}

export function createPilotBackup(storage, { settings, bindings, now = new Date() } = {}) {
  const entries = {};
  try {
    for (const key of BACKUP_KEYS) {
      if (key === 'raptor.settings.v1' && settings) {entries[key] = validateSettings(settings); continue;}
      if (key === 'raptor:binds:v3' && bindings) {entries[key] = bindings; continue;}
      const raw = storage.getItem(key);
      entries[key] = raw === null ? null : ['raptor:quality:v1','raptor:mute'].includes(key) ? raw : JSON.parse(raw);
    }
  } catch { fail('Your browser could not read the saved pilot profile. No backup was created.'); }
  // Include the current, normalized controls/settings, including legacy layouts
  // already migrated in memory, without writing to the browser while exporting.
  if (settings) {
    entries['raptor.settings.v1'] = validateSettings(settings);
    entries['raptor:quality:v1'] = settings.tier === 'AUTO' ? null : settings.tier;
  }
  if (bindings) entries['raptor:binds:v3'] = bindings;
  const backup = { format: 'raptor-pilot-backup', version: 1, createdAt: now.toISOString(), entries };
  return parsePilotBackup(JSON.stringify(backup));
}

export function summarizePilotBackup(backup) {
  const e = backup.entries;
  return {
    missions: Object.keys(e['raptor.auth.v1']?.done || {}).length,
    scenarios: Object.keys(e['raptor.scenarios.v1']?.done || {}).length,
    operations: OPERATION_FRONTS.filter(front => e['raptor.op.v1:' + front] !== null).length,
    graduated: !!e['raptor.flight-school.v1'],
    settings: !!e['raptor.settings.v1'], bindings: !!e['raptor:binds:v3'],
    createdAt: backup.createdAt,
  };
}

export function restorePilotBackup(storage, backup) {
  // Revalidate at the write boundary, even if a caller bypasses the preview.
  const validated = parsePilotBackup(JSON.stringify(backup));
  const before = new Map();
  try { for (const key of RESTORE_KEYS) before.set(key, storage.getItem(key)); }
  catch { fail('Your browser could not read the current profile. Nothing was changed.'); }
  const changed = [];
  try {
    for (const key of RESTORE_KEYS) {
      // Null/default bindings must not resurrect the previous pilot's legacy
      // layout through Input's migration fallback after the page reloads.
      const value = key === 'raptor:binds:v2' ? null : validated.entries[key];
      const serialized = value === null ? null : ['raptor:quality:v1','raptor:mute'].includes(key) ? value : JSON.stringify(value);
      if (serialized === before.get(key)) continue;
      // Storage mutations are atomic individually; only completed writes need
      // rollback. A blocked write cannot prevent restoration of untouched keys.
      if (serialized === null) storage.removeItem(key); else storage.setItem(key, serialized);
      changed.push(key);
    }
  } catch {
    let restored = true;
    for (const key of changed.reverse()) {
      try { const value = before.get(key); if (value === null) storage.removeItem(key); else storage.setItem(key, value); }
      catch { restored = false; }
    }
    fail(restored ? 'Restore failed. Your previous profile was kept. Check browser storage and try again.'
      : 'Restore was interrupted and some records may have changed. Keep this backup and retry when browser storage is available.');
  }
  return summarizePilotBackup(validated);
}
