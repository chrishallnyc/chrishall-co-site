import { missionObjectiveRows } from './missionguidance.js';

const count = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
const sumKnown = (a, b) => a === null && b === null ? null : (a || 0) + (b || 0);

export function flightDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds), hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60, remainder = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}

// A detached snapshot of the first observed completed frame. The final orbit
// can keep advancing the simulator; reopening the debrief must not change it.
// Pool kill counters mean enemy losses, not player-attributed weapon kills.
export function captureFlightDebrief(state) {
  const match = state?.match;
  if (match?.over !== 1 && match?.over !== -1) return null;
  const won = match.over === 1;
  const objectives = missionObjectiveRows(state).map(objective => {
    const protection = objective.kind === 'protect_tag';
    const status = objective.failed ? 'failed' : objective.done ? 'complete' : protection ? (won ? 'protected' : 'held') : 'incomplete';
    const need = count(objective.need), progress = count(objective.count);
    return Object.freeze({ label: objective.label, status,
      detail: protection ? '' : need > 1 && progress !== null ? `${Math.min(progress, need)} / ${need}` : '',
    });
  });
  const metrics = [
    { label: 'Flight time', value: flightDuration(state.sim?.time) },
    { label: 'Enemy aircraft lost', value: count(state.bandits?.kills) },
    { label: 'Enemy surface losses', value: count(state.battlefield?.kills) },
    { label: 'Your aircraft lost', value: count(state.player?.crashes) },
  ].filter(metric => metric.value !== null).map(metric => Object.freeze(metric));
  const noAircraft = Number.isFinite(match.blue) && match.blue <= 0;
  const hp = state.player?.hp;
  // Player.reset() spawns a fresh cosmetic jet even on the final defeat. Its
  // full hull and stores must never be presented as a surviving aircraft.
  const aircraft = !noAircraft && Number.isFinite(match.blue) && match.blue > 0 && Number.isFinite(hp) ? Object.freeze({
    hull: Math.round(Math.max(0, Math.min(100, hp))),
    cannon: count(state.player.gun?.ammo), missiles: count(state.player.missiles?.ammo),
  }) : null;
  const surfaceFriendly = count(state.battlefield?.blueLosses), airFriendly = count(state.bandits?.blueLosses);
  const friendlyLosses = (state.battlefield && surfaceFriendly === null) || (state.bandits && airFriendly === null)
    ? null : sumKnown(surfaceFriendly, airFriendly);
  return Object.freeze({ won, noAircraft, metrics: Object.freeze(metrics), objectives: Object.freeze(objectives), aircraft, friendlyLosses });
}
