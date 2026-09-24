// Render-only transition. The prior strength always describes the preceding
// main frame; shadow/probe renders never advance this state.
export const TERRAIN_DETAIL_FADE_SECONDS = .3;

export function tierHasNearTerrain(tier) {
  return tier === 'HIGH' || tier === 'ULTRA';
}

export class TerrainDetailTransition {
  constructor(capable = true) {
    this.capable = !!capable;
    this.current = this.previous = this.target = this.capable ? 1 : 0;
    this._from = this.current;
    this._elapsed = TERRAIN_DETAIL_FADE_SECONDS;
    this._rendered = false;
  }

  setEnabled(enabled) {
    const target = this.capable && enabled ? 1 : 0;
    if (target === this.target) return false;
    this.target = target;
    if (!this._rendered) {
      this.current = this.previous = this._from = target;
      this._elapsed = TERRAIN_DETAIL_FADE_SECONDS;
    } else {
      this._from = this.current;
      this._elapsed = 0;
    }
    return true;
  }

  advance(seconds = 0, historyValid = true) {
    this.previous = this.current;
    if (this.current !== this.target) {
      const dt = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
      this._elapsed = Math.min(TERRAIN_DETAIL_FADE_SECONDS, this._elapsed + dt);
      const t = this._elapsed / TERRAIN_DETAIL_FADE_SECONDS;
      this.current = t >= 1 ? this.target
        : this._from + (this.target - this._from) * t * t * (3 - 2 * t);
    }
    if (!historyValid) this.previous = this.current;
    this._rendered = true;
  }

  get useFine() { return this.current > 0 || this.previous > 0 || this.target > 0; }
  get settling() { return this.current !== this.target || this.previous !== this.current; }
}
