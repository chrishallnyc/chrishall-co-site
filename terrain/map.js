import { Diorama } from './diorama.js';

/** A sculpted state atlas with a separate real-world camera for city and site detail. */
export class TerrainMap {
  constructor(container, callbacks = {}) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.callbacks = callbacks;
    this.surface = 'natural';
    this.relief = 20;
    this.mode = 'diorama';
    this.places = {};
    this.trail = [];
    this.ready = false;
    this.focusSequence = 0;
    this.padding = { top: 70, left: 370, right: 95, bottom: 120 };
  }
  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    return this.initPromise;
  }
  async _init() {
    this.sculptureElement = document.createElement('div');
    this.sculptureElement.className = 'terrain-sculpture';
    this.sculptureElement.style.cssText = 'position:absolute;inset:0';
    this.detailElement = document.createElement('div');
    this.detailElement.className = 'terrain-city-map';
    this.detailElement.style.cssText = 'position:absolute;inset:0;visibility:hidden;pointer-events:none';
    this.container.append(this.sculptureElement, this.detailElement);
    try {
      this.diorama = new Diorama(this.sculptureElement, {
        onSelect: place => this.callbacks.onSelect?.(place),
        onMove: () => { if (this.mode === 'diorama') this.callbacks.onMove?.(this.getView()); },
        onError: error => { if (!this.destroyed) this.callbacks.onError?.(error); },
      });
      await this.diorama.init();
      if (this.destroyed) {
        this.diorama.destroy();
        throw new Error('Viewer was closed.');
      }
      this.diorama.setPadding(this.padding);
      this.diorama.setRelief(this.relief);
      this.diorama.setSurface(this.surface);
      this.ready = true;
      if (this.state) this.setState(this.state);
      this.callbacks.onReady?.();
      return this;
    } catch (cause) {
      const error = new Error(`The 3D sculpture could not start. ${cause.message || 'Enable hardware acceleration and reload.'}`, { cause });
      error.fatal = true;
      this.callbacks.onError?.(error);
      throw error;
    }
  }
  async _detail() {
    if (this.detailPromise) return this.detailPromise;
    this.detailPromise = (async () => {
      const { DetailMap } = await import('./detail-map.js');
      if (this.destroyed) throw new Error('Viewer was closed.');
      this.detail = new DetailMap(this.detailElement, {
        onSelect: place => this.callbacks.onSelect?.(place),
        onError: error => { if (!this.destroyed) this.callbacks.onError?.(error); },
        onMove: () => { if (this.mode === 'detail') this.callbacks.onMove?.(this.getView()); },
      });
      await this.detail.init();
      if (this.destroyed) { this.detail.destroy(); throw new Error('Viewer was closed.'); }
      this.detail.setPadding(this.padding);
      this.detail.map.on('idle', () => {
        if (this.mode !== 'detail' || this.destroyed) return;
        this.detailLoading = false;
        this.callbacks.onMove?.(this.getView());
      });
      return this.detail;
    })().catch(error => { this.detailPromise = null; throw error; });
    return this.detailPromise;
  }
  setState(state) {
    this.state = state;
    this.detailLoading = false;
    this.focusSequence++;
    if (!this.ready) return;
    this.mode = 'diorama';
    this.detail?.stopOrbit();
    this.detailElement.style.visibility = 'hidden';
    this.detailElement.style.pointerEvents = 'none';
    this.diorama.setActive(true);
    this.diorama.setState(state);
  }
  setPlaces(options) { this.places = options; this.diorama?.setPlaces(options); this.detail?.setPlaces(options); }
  setTrail(places) { this.trail = places; this.diorama?.setTrail(places); this.detail?.setTrail(places); }
  async focusPlace(place, options = {}) {
    const sequence = ++this.focusSequence;
    this.stopOrbit();
    this.detailLoading = true;
    this.callbacks.onMove?.(this.getView());
    try {
      const detail = await this._detail();
      if (sequence !== this.focusSequence || this.destroyed) return;
      this.mode = 'detail';
      this.diorama.setActive(false);
      this.detailElement.style.visibility = 'visible';
      this.detailElement.style.pointerEvents = 'auto';
      detail.resize();
      detail.setRelief(2);
      detail.setSurface(this.surface);
      detail.setState(this.state);
      detail.setPlaces(this.places);
      detail.setTrail(this.trail);
      detail.focusPlace(place, options);
      this.callbacks.onMove?.(this.getView());
    } catch (error) {
      if (sequence !== this.focusSequence || this.destroyed) return;
      this.detailLoading = false;
      this.callbacks.onError?.(error);
      this.callbacks.onMove?.(this.getView());
    }
  }
  resetView() {
    this.focusSequence++;
    this.detailLoading = false;
    this.mode = 'diorama';
    this.detail?.stopOrbit();
    this.detailElement.style.visibility = 'hidden';
    this.detailElement.style.pointerEvents = 'none';
    this.diorama?.setActive(true);
    this.diorama?.resetView();
    this.callbacks.onMove?.(this.getView());
  }
  setPadding(padding) { this.padding = { ...this.padding, ...padding }; this.diorama?.setPadding(this.padding); this.detail?.setPadding(this.padding); }
  setSurface(surface) {
    this.surface = surface;
    this.diorama?.setSurface(surface);
    if (this.detail) { this.detail.setSurface(surface); if (this.mode === 'detail') this.surface = this.detail.getView().surface; }
  }
  setRelief(value) { this.relief = Math.max(1, Math.min(30, Number(value) || 1)); this.diorama?.setRelief(this.relief); if (this.detail) this.detail.setRelief(2); }
  zoomIn() { (this.mode === 'detail' ? this.detail : this.diorama)?.zoomIn(); }
  zoomOut() { (this.mode === 'detail' ? this.detail : this.diorama)?.zoomOut(); }
  toggleOrbit() { return (this.mode === 'detail' ? this.detail : this.diorama)?.toggleOrbit() || false; }
  stopOrbit() { this.diorama?.stopOrbit(); this.detail?.stopOrbit(); }
  resize() { this.diorama?.resize(); this.detail?.resize(); }
  getView() {
    if (this.mode === 'detail' && this.detail?.ready) return { ...this.detail.getView(), renderer: 'detail', loading: !!this.detailLoading || this.detail.map.isMoving() || !this.detail.map.areTilesLoaded(), modelState: this.state?.code, modelKind: 'streamed-terrain', sculptedRelief: this.relief };
    return { ...(this.diorama?.getView() || { surface: this.surface, relief: this.relief, orbiting: false }), renderer: 'diorama', loading: !!this.detailLoading || !!this.diorama?.loading };
  }
  destroy() { this.destroyed = true; this.focusSequence++; this.ready = false; this.diorama?.destroy(); this.detail?.destroy(); this.container.replaceChildren(); }
}
