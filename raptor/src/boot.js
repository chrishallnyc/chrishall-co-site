import { hasFlightRequest } from './game/flightplan.js';
import { createAppState } from './appstate.js';

// Decide before resolving the flight engine's module graph. Choosing controls,
// browsing missions, and viewing preflight never need a GPU or aircraft assets.
// Keep the import awaited so index.html can show its existing recovery screen.
if (hasFlightRequest(new URLSearchParams(location.search))) {
  await import('./main.js');
} else {
  const { showFlightdeck } = await import('./game/flightdeck.js');
  const state = createAppState();
  window.__RAPTOR = state;
  showFlightdeck(state);
}
