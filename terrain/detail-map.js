import * as maplibregl from './vendor/maplibre-gl.mjs';
import mlcontour from './vendor/maplibre-contour.mjs';

const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const WATER_URL = 'https://tiles.openfreemap.org/planet';
const EMPTY = { type: 'FeatureCollection', features: [] };
const DEM_CREDIT = '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain: USGS · NOAA · Mapzen</a>';
const IMAGE_CREDIT = '<a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" rel="noopener">Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community</a>';
const ELEVATION_COLORS = ['interpolate', ['linear'], ['elevation'],
  -7000, '#07161f', -1, '#12313b', 0, '#426a54', 150, '#64805b',
  600, '#989564', 1400, '#bca477', 2400, '#ad8369', 3400, '#c2b3a1',
  4400, '#e5dfd3', 6200, '#faf8ef'];
const CONTOUR_COLORS = ['interpolate', ['linear'], ['elevation'],
  -7000, '#08151c', -1, '#122d34', 0, '#253e34', 400, '#354b39',
  1200, '#535a42', 2500, '#78735b', 4200, '#a49b82', 6200, '#ded7be'];

function coordinates(place) {
  if (Array.isArray(place?.coordinates)) return place.coordinates;
  if (Number.isFinite(place?.lng) && Number.isFinite(place?.lat)) return [place.lng, place.lat];
  return null;
}

function asBounds(bounds) {
  return bounds?.length === 4 ? [[bounds[0], bounds[1]], [bounds[2], bounds[3]]] : bounds;
}

/** A real, streamed elevation model. The UI and editorial records live outside this module. */
export class DetailMap {
  constructor(container, callbacks = {}) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.callbacks = callbacks;
    this.map = null;
    this.ready = false;
    this.state = null;
    this.boundaries = null;
    this.places = {};
    this.markers = new Map();
    this.surface = 'natural';
    this.relief = 2;
    this.orbiting = false;
    this.padding = { top: 100, left: 330, right: 90, bottom: 110 };
    this.sourceErrors = new Map();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._visibilityChange = () => { if (document.hidden) this.stopOrbit(); };
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._initialize();
    return this.initPromise;
  }

  async _initialize() {
    if (!this.container) throw new Error('The terrain viewer container was not found.');
    try {
      this.map = new maplibregl.Map({
        container: this.container,
        style: this._style(),
        center: [-119.5, 37.1],
        zoom: 5.5,
        pitch: 52,
        bearing: -18,
        minZoom: 2,
        maxZoom: 17,
        maxPitch: 85,
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
        fadeDuration: this.reducedMotion ? 0 : 250,
        maxTileCacheSize: 200,
        refreshExpiredTiles: false,
      });
    } catch (cause) {
      const error = new Error('This browser could not start the 3D viewer. Enable hardware acceleration or try a browser with WebGL 2 support.', { cause });
      error.fatal = true;
      this.callbacks.onError?.(error);
      throw error;
    }

    const map = this.map;
    map.getCanvas().setAttribute('aria-label', 'Interactive 3D terrain. Drag to pan; scroll to zoom. Right-drag to rotate and tilt. Arrow keys pan; plus and minus zoom.');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'imperial' }), 'bottom-left');
    map.addControl(new maplibregl.NavigationControl({ showZoom: false, showCompass: true, visualizePitch: true }), 'top-right');
    map.on('error', event => this._handleError(event));
    map.on('movestart', event => {
      if (event.originalEvent) {
        this.focusTarget = null;
        this.stopOrbit();
      }
    });
    map.on('idle', () => this._settleTerrainFocus());
    map.on('sourcedata', event => {
      if (event.sourceId !== 'terrain' || event.sourceDataType !== 'content' || this.terrainFrame) return;
      this.terrainFrame = requestAnimationFrame(() => {
        this.terrainFrame = null;
        this._settleTerrainFocus();
      });
    });
    map.on('moveend', () => {
      this._settleTerrainFocus();
      this._layoutMarkers();
      this.callbacks.onMove?.(this.getView());
    });
    map.on('render', () => this._scheduleMarkerLayout());
    map.on('webglcontextlost', () => {
      this.stopOrbit();
      const error = new Error('The graphics connection was interrupted. The viewer will recover when your browser restores it; reload if it does not.');
      error.fatal = false;
      this.callbacks.onError?.(error);
    });
    document.addEventListener('visibilitychange', this._visibilityChange);

    // Boundaries are local. A failed boundary request should not prevent terrain exploration.
    const boundariesPromise = fetch(new URL('./data/states.geojson', import.meta.url))
      .then(response => {
        if (!response.ok) throw new Error(`State boundaries: HTTP ${response.status}`);
        return response.json();
      }).then(data => { this.boundaries = data; }).catch(() => {
        const error = new Error('State outlines could not be loaded. Terrain and place exploration are still available.');
        error.fatal = false;
        this.callbacks.onError?.(error);
      });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error('The terrain is taking too long to load. Check your connection and reload the viewer.');
        error.fatal = true;
        this.callbacks.onError?.(error);
        reject(error);
      }, 25000);
      map.once('load', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    await boundariesPromise;
    this.ready = true;
    this.setPadding(this.padding);
    this.setSurface(this.surface);
    if (this.state) this.setState(this.state);
    this.setPlaces(this.places);
    if (this.trail) this.setTrail(this.trail);
    this.callbacks.onReady?.();
    return this;
  }

  _style() {
    const dem = { type: 'raster-dem', tiles: [DEM_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: DEM_CREDIT };
    return {
      version: 8,
      sources: {
        terrain: { ...dem },
        shading: { ...dem },
        imagery: { type: 'raster', tiles: [IMAGERY_URL], tileSize: 256, maxzoom: 19, attribution: IMAGE_CREDIT },
        water: { type: 'vector', url: WATER_URL, attribution: '<a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>' },
        'selected-state': { type: 'geojson', data: EMPTY },
        'outside-state': { type: 'geojson', data: EMPTY },
        trail: { type: 'geojson', data: EMPTY },
      },
      terrain: { source: 'terrain', exaggeration: this.relief },
      sky: {
        'sky-color': '#080e10', 'horizon-color': '#283630', 'fog-color': '#17241f',
        'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.75, 'fog-ground-blend': 0.75,
        'atmosphere-blend': 0,
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#101d20' } },
        { id: 'elevation', type: 'color-relief', source: 'shading', paint: { 'color-relief-color': ELEVATION_COLORS } },
        { id: 'imagery', type: 'raster', source: 'imagery', paint: {
          'raster-saturation': -0.08, 'raster-contrast': 0.08, 'raster-brightness-max': 0.96, 'raster-opacity': 0.84,
          'raster-fade-duration': 250,
        } },
        { id: 'hillshade', type: 'hillshade', source: 'shading', paint: {
          'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#101d24',
          'hillshade-highlight-color': '#dfc995', 'hillshade-accent-color': '#263d32',
          'hillshade-illumination-direction': 315, 'hillshade-illumination-anchor': 'map',
        } },
        // Real water polygons avoid imagery acquisition seams without confusing
        // below-sea-level land (such as Death Valley) with ocean or lake surfaces.
        { id: 'water-tone', type: 'fill', source: 'water', 'source-layer': 'water',
          filter: ['all', ['!=', ['get', 'brunnel'], 'tunnel'], ['!=', ['get', 'intermittent'], 1]],
          paint: { 'fill-color': '#15353f', 'fill-antialias': false } },
        { id: 'water-bridges', type: 'line', source: 'water', 'source-layer': 'transportation', minzoom: 10,
          filter: ['all', ['==', ['get', 'brunnel'], 'bridge'], ['!=', ['get', 'class'], 'path']],
          paint: { 'line-color': '#b8b6a4', 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 2.2, 17, 4] } },
        { id: 'outside-state', type: 'fill', source: 'outside-state', paint: { 'fill-color': '#050b0d', 'fill-opacity': 0.73, 'fill-antialias': true } },
        { id: 'state-glow', type: 'line', source: 'selected-state', paint: { 'line-color': '#d4bd8b', 'line-width': 6, 'line-opacity': 0.09, 'line-blur': 4 } },
        { id: 'state-outline', type: 'line', source: 'selected-state', paint: { 'line-color': '#ddc896', 'line-width': 1.2, 'line-opacity': 0.68 } },
        { id: 'trail-shadow', type: 'line', source: 'trail', paint: { 'line-color': '#17130f', 'line-width': 5, 'line-opacity': 0.7 }, layout: { 'line-cap': 'round', 'line-join': 'round' } },
        { id: 'trail-line', type: 'line', source: 'trail', paint: { 'line-color': '#edbd73', 'line-width': 2, 'line-opacity': 0.88, 'line-dasharray': [2, 2] }, layout: { 'line-cap': 'round', 'line-join': 'round' } },
      ],
    };
  }

  _handleError(event) {
    const source = event.sourceId || '';
    const count = (this.sourceErrors.get(source) || 0) + 1;
    this.sourceErrors.set(source, count);
    // Individual tile failures can be temporary; report persistent source failure once.
    if (count !== 4) return;
    if (source === 'imagery' && this.map.getLayer('elevation')) {
      this.imageryUnavailable = true;
      this.surface = 'elevation';
      if (this.ready) this.setSurface('elevation');
      else {
        this.map.setLayoutProperty('imagery', 'visibility', 'none');
        this.map.setLayoutProperty('elevation', 'visibility', 'visible');
      }
      const error = new Error('Satellite imagery is unavailable. The viewer is showing elevation colors while terrain and places remain interactive.');
      error.fatal = false;
      this.callbacks.onError?.(error);
      this.callbacks.onMove?.(this.getView());
    } else if (source === 'terrain' || source === 'shading') {
      const error = new Error('Some elevation tiles could not load. Check your internet connection; satellite imagery and place stories remain available.');
      error.fatal = false;
      this.callbacks.onError?.(error);
    }
  }

  setState(state, feature) {
    this.state = state;
    this.stopOrbit();
    if (!this.ready || !state) return;
    const boundary = feature || this.boundaries?.features.find(item => item.properties.code === state.code || item.properties.name === state.name);
    this.map.getSource('selected-state').setData(EMPTY);
    this.map.getSource('outside-state').setData(EMPTY);
    this.resetView();
  }

  setPlaces(options = {}) {
    this.places = options;
    if (!this.ready) return;
    const { cities = [], features = [], history = [], selectedId, showCities = true, showFeatures = true, showHistory = true } = options;
    const list = [
      ...(showCities ? cities.map(place => ({ ...place, type: 'city' })) : []),
      ...(showFeatures ? features.map(place => ({ ...place, type: 'feature' })) : []),
      ...(showHistory ? history.map(place => ({ ...place, type: 'history' })) : []),
    ];
    const visibleIds = new Set(list.map(place => place.id));
    for (const [id, item] of this.markers) {
      if (!visibleIds.has(id)) { item.marker.remove(); this.markers.delete(id); }
    }
    for (const place of list) {
      const point = coordinates(place);
      if (!point) continue;
      let item = this.markers.get(place.id);
      if (!item) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `terrain-marker terrain-marker--${place.type}`;
        button.dataset.placeId = place.id;
        button.dataset.type = place.type;
        const dot = document.createElement('span');
        dot.className = 'terrain-marker-dot';
        dot.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'terrain-marker-label';
        const name = document.createElement('span');
        name.className = 'terrain-marker-name';
        name.textContent = place.name || place.title;
        label.append(name);
        if (place.type === 'history' && (place.dateLabel || place.period || place.year || place.date)) {
          const date = document.createElement('span');
          date.className = 'terrain-marker-date';
          date.textContent = String(place.dateLabel || place.period || place.date || place.year).split(' · ')[0];
          label.append(date);
        }
        button.append(dot, label);
        button.title = `${place.name || place.title} — ${place.type === 'history' ? 'Explore this story' : 'Zoom in'}`;
        button.setAttribute('aria-label', button.title);
        button.addEventListener('click', event => {
          event.stopPropagation();
          this.callbacks.onSelect?.(this.markers.get(place.id)?.place || place);
        });
        const marker = new maplibregl.Marker({ element: button, anchor: 'left', offset: [-8, 0], subpixelPositioning: true }).setLngLat(point).addTo(this.map);
        item = { marker, button, place, point };
        this.markers.set(place.id, item);
      }
      item.place = place;
      item.button.classList.toggle('is-selected', place.id === selectedId);
      item.button.setAttribute('aria-pressed', String(place.id === selectedId));
      item.button.style.zIndex = place.id === selectedId ? '20' : place.type === 'history' ? '5' : '2';
    }
    this._layoutMarkers();
  }

  _scheduleMarkerLayout() {
    if (this.layoutFrame || !this.ready) return;
    this.layoutFrame = requestAnimationFrame(() => { this.layoutFrame = null; this._layoutMarkers(); });
  }

  _layoutMarkers() {
    if (!this.ready) return;
    const placed = [];
    const ordered = [...this.markers.values()].sort((a, b) => {
      const priority = item => item.button.classList.contains('is-selected') ? 1000000000 : item.place.type === 'history' ? 100000000 : item.place.type === 'city' ? 1000000 + (item.place.labelPriority || 0) * 10000000 + (item.place.population || 0) : 0;
      return priority(b) - priority(a);
    });
    for (const item of ordered) {
      const position = this.map.project(item.point);
      const width = Math.min(210, 30 + (item.place.name || item.place.title || '').length * 6);
      const height = item.place.type === 'history' ? 31 : 20;
      const box = { x: position.x, y: position.y - height / 2, width, height };
      const selected = item.button.classList.contains('is-selected');
      const collision = !selected && placed.some(other => box.x < other.x + other.width && box.x + box.width > other.x && box.y < other.y + other.height && box.y + box.height > other.y);
      item.button.classList.toggle('is-compact', collision);
      if (!collision) placed.push(box);
    }
  }

  setTrail(places = []) {
    this.trail = places;
    if (!this.ready) return;
    const points = places.map(coordinates).filter(Boolean);
    this.map.getSource('trail').setData(points.length < 2 ? EMPTY : {
      type: 'Feature', properties: { kind: 'story-connections' }, geometry: { type: 'LineString', coordinates: points },
    });
  }

  focusPlace(place, options = {}) {
    if (!this.ready) return;
    const center = coordinates(place);
    if (!center) return;
    this.stopOrbit();
    this.focusTarget = null;
    this.map.stop();
    this.focusTarget = center;
    let zoom = options.zoom ?? place.zoom ?? (place.type === 'city' ? 12.2 : place.type === 'feature' ? 10.8 : 12.8);
    if (place.focusBounds && options.zoom == null) {
      const fit = this.map.cameraForBounds(place.focusBounds, { padding: 0, bearing: this.map.getBearing(), maxZoom: 13.2 });
      if (fit) { center[0] = fit.center.lng; center[1] = fit.center.lat; zoom = fit.zoom + 0.2; this.focusTarget = center; }
    }
    this.map.flyTo({ center, zoom, pitch: 60, bearing: this.map.getBearing(), padding: this._safePadding(), duration: this.reducedMotion ? 0 : 1800, essential: false });
  }

  _settleTerrainFocus() {
    if (!this.ready || this.map.isMoving()) return;
    // A flight initially uses coarse DEM tiles. Re-anchor the camera once detailed
    // elevation arrives, or mountain destinations can drift below a story panel.
    // User camera gestures clear focusTarget, so this never undoes manual panning.
    if (this.focusTarget) {
      const elevation = this.map.queryTerrainElevation(this.focusTarget);
      if (Number.isFinite(elevation) && Math.abs(elevation - this.map.getCenterElevation()) > 0.5) {
        this.map.jumpTo({ center: this.focusTarget });
      }
    }
    // DOM markers also need a refresh when elevations refine without camera motion.
    this.markers.forEach(item => item.marker.setLngLat(item.point));
    this._layoutMarkers();
  }

  resetView() {
    if (!this.ready || !this.state) return;
    this.focusTarget = null;
    this.stopOrbit();
    const bounds = asBounds(this.state.bounds);
    if (bounds) {
      const padding = this._safePadding();
      this.map.setPadding(padding);
      // cameraForBounds adds its own padding to the map's persistent padding.
      // The map already reserves space for panels, so do not count it twice.
      const camera = this.map.cameraForBounds(bounds, { padding: 0, bearing: -18, maxZoom: 10 });
      this.map.flyTo({ ...camera, zoom: Math.min(camera.zoom + 0.2, 10), padding, pitch: 52, bearing: -18, duration: this.reducedMotion ? 0 : 1500 });
    } else this.map.flyTo({ center: this.state.center, zoom: 6, pitch: 52, bearing: -18, padding: this._safePadding(), duration: this.reducedMotion ? 0 : 1500 });
  }

  _ensureContours() {
    if (this.map.getSource('contours')) return;
    this.contours = new mlcontour.DemSource({ url: DEM_URL, encoding: 'terrarium', maxzoom: 15, worker: true, cacheSize: 100, timeoutMs: 15000 });
    this.contours.setupMaplibre(maplibregl);
    this.map.addSource('contours', {
      type: 'vector', maxzoom: 15,
      tiles: [this.contours.contourProtocolUrl({
        thresholds: { 4: [500, 1000], 7: [250, 1000], 9: [100, 500], 11: [50, 200], 13: [20, 100], 15: [10, 50] },
        elevationKey: 'elevation', levelKey: 'level', contourLayer: 'contours',
      })],
      attribution: DEM_CREDIT,
    });
    this.map.addLayer({
      id: 'contour-lines', type: 'line', source: 'contours', 'source-layer': 'contours',
      paint: { 'line-color': '#ddcf9f', 'line-opacity': 0.48, 'line-width': ['match', ['get', 'level'], 1, 1.1, 0.55] },
    }, 'outside-state');
  }

  setSurface(mode) {
    if (!['natural', 'elevation', 'contours'].includes(mode)) return;
    // Retain the elevation fallback if imagery failed before the initial load event.
    if (mode === 'natural' && this.imageryUnavailable) mode = 'elevation';
    this.surface = mode;
    if (!this.ready) return;
    if (mode === 'contours') this._ensureContours();
    this.map.setLayoutProperty('imagery', 'visibility', mode === 'natural' ? 'visible' : 'none');
    this.map.setLayoutProperty('elevation', 'visibility', 'visible');
    this.map.setLayoutProperty('water-tone', 'visibility', mode === 'natural' ? 'visible' : 'none');
    this.map.setLayoutProperty('water-bridges', 'visibility', mode === 'natural' ? 'visible' : 'none');
    this.map.setPaintProperty('elevation', 'color-relief-color', mode === 'contours' ? CONTOUR_COLORS : ELEVATION_COLORS);
    if (this.map.getLayer('contour-lines')) this.map.setLayoutProperty('contour-lines', 'visibility', mode === 'contours' ? 'visible' : 'none');
    this.map.setPaintProperty('hillshade', 'hillshade-exaggeration', mode === 'natural' ? 0.45 : 0.65);
    this.callbacks.onMove?.(this.getView());
  }

  setRelief(value) {
    if (!Number.isFinite(Number(value))) return;
    this.relief = Math.max(0, Math.min(8, Number(value)));
    if (this.ready) this.map.setTerrain({ source: 'terrain', exaggeration: this.relief });
  }

  setPadding(padding) {
    this.padding = { ...this.padding, ...padding };
    if (this.ready) this.map.setPadding(this._safePadding());
  }

  _safePadding() {
    const { clientWidth: width, clientHeight: height } = this.container;
    const result = { ...this.padding };
    const horizontal = result.left + result.right;
    const vertical = result.top + result.bottom;
    if (horizontal > width * 0.72) { result.left *= width * 0.72 / horizontal; result.right *= width * 0.72 / horizontal; }
    if (vertical > height * 0.65) { result.top *= height * 0.65 / vertical; result.bottom *= height * 0.65 / vertical; }
    return result;
  }

  zoomIn() { if (this.ready) { this.stopOrbit(); this.map.zoomIn({ duration: this.reducedMotion ? 0 : 300 }); } }
  zoomOut() { if (this.ready) { this.stopOrbit(); this.map.zoomOut({ duration: this.reducedMotion ? 0 : 300 }); } }

  toggleOrbit() {
    if (!this.ready) return false;
    if (this.orbiting) { this.stopOrbit(); return false; }
    this.orbiting = true;
    let previous;
    const rotate = timestamp => {
      if (!this.orbiting) return;
      const elapsed = previous ? Math.min(64, timestamp - previous) : 0;
      previous = timestamp;
      this.map.setBearing(this.map.getBearing() + elapsed * 0.003);
      this.orbitFrame = requestAnimationFrame(rotate);
    };
    this.orbitFrame = requestAnimationFrame(rotate);
    this.callbacks.onMove?.(this.getView());
    return true;
  }

  stopOrbit() {
    const wasOrbiting = this.orbiting;
    this.orbiting = false;
    if (this.orbitFrame) cancelAnimationFrame(this.orbitFrame);
    this.orbitFrame = null;
    if (wasOrbiting) this.callbacks.onMove?.(this.getView());
  }

  resize() { this.map?.resize(); if (this.ready) this.map.setPadding(this._safePadding()); }

  getView() {
    if (!this.map) return null;
    const center = this.map.getCenter();
    return { center: [center.lng, center.lat], zoom: this.map.getZoom(), bearing: this.map.getBearing(), pitch: this.map.getPitch(), relief: this.relief, surface: this.surface, orbiting: this.orbiting };
  }

  destroy() {
    this.stopOrbit();
    if (this.layoutFrame) cancelAnimationFrame(this.layoutFrame);
    if (this.terrainFrame) cancelAnimationFrame(this.terrainFrame);
    document.removeEventListener('visibilitychange', this._visibilityChange);
    this.markers.forEach(item => item.marker.remove());
    this.markers.clear();
    this.map?.remove();
    if (this.contours) {
      maplibregl.removeProtocol(this.contours.sharedDemProtocolId);
      maplibregl.removeProtocol(this.contours.contourProtocolId);
    }
    this.map = null;
    this.ready = false;
  }
}
