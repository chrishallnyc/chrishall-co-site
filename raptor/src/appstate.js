// Shared diagnostics for the lightweight flight deck and the running simulator.
export function createAppState() {
  return {
    version: '1.13.1', phase: 13, ready: false, paused: false,
    backend: null, tier: null, failure: null,
  };
}
