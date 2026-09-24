// Resolve the requested flight before allocating a renderer or starting a sim.
// A mission is an explicit choice: a failed download must never turn it into
// a different battle or update progress for the wrong type of flight.
export class FlightLoadError extends Error {
  constructor(message, { cause, request } = {}) {
    super(message, { cause });
    this.name = 'FlightLoadError';
    this.request = request;
  }
}

const importModules = {
  missions: () => import('./missions.js'),
  authored: () => import('../campaign/authored.js'),
  operation: () => import('../campaign/engine.js'),
};

export function requestedFlight(flags) {
  const mission = flags.get('mission');
  const sortie = flags.get('sortie');
  if (mission) return { kind: 'mission', id: mission };
  if (sortie) return { kind: 'campaign', id: sortie };
  if (flags.get('op')) return { kind: 'operation', id: (flags.get('front') || 'NELLIS').toUpperCase() };
  return null;
}

export async function loadRequestedFlight(flags, modules = importModules) {
  const request = requestedFlight(flags);
  if (!request) return null;
  try {
    if (flags.get('nomatch') === '1' || flags.get('nobattle') === '1' || flags.get('demo') === '1') {
      throw new Error('This mission link disables a required flight system.');
    }
    const M = await modules.missions();
    let spec, extraLines = null, authored = null, campaign = null;
    if (request.kind === 'campaign') {
      const A = await modules.authored();
      const sortie = await A.loadSortie(request.id);
      spec = sortie.spec;
      extraLines = sortie.lines;
      authored = { A, id: request.id, saved: false };
    } else if (request.kind === 'operation') {
      if (!['NELLIS', 'VALDEZ', 'MARIANAS'].includes(request.id)) throw new Error('Unknown operation region.');
      const E = await modules.operation();
      const save = E.loadSave(request.id);
      spec = M.loadMission(E.genMission(save));
      extraLines = E.OP_LINES || null;
      campaign = { E, save, spec, saved: false };
    } else {
      spec = M.loadMission(request.id);
    }
    return { request, spec, authored, campaign, lines: { ...M.COMMS_LINES, ...extraLines } };
  } catch (cause) {
    throw new FlightLoadError('The selected mission could not be prepared.', { cause, request });
  }
}

export function bootFailureMessage(error, stage) {
  if (error instanceof FlightLoadError) return {
    title: 'YOUR MISSION COULDN’T LOAD',
    detail: 'The selected mission could not be prepared. Retry this mission, or return to preflight to choose another flight. Your saved progress is unchanged.',
    retry: 'Retry mission',
  };
  if (stage === 'graphics-device' || stage === 'warmup') return {
    title: 'YOUR FLIGHT COULDN’T START',
    detail: 'The graphics system could not finish preparing this flight. Try again, or return to preflight and choose Low graphics in Settings.',
    retry: 'Try again',
  };
  return {
    title: 'YOUR FLIGHT COULDN’T LOAD',
    detail: 'A required flight file could not load. Check your connection and try again, or return to preflight. Your saved progress is unchanged.',
    retry: 'Retry flight',
  };
}
