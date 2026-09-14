import { STATES, CITIES, FEATURES } from './data/geography.js';
import { HISTORY_THEMES, HISTORY_ERAS, HISTORY_PLACES, HISTORY_TRAILS } from './data/history.js';
import { CITY_DETAILS, CITY_FOCUS } from './data/city-details.js';
import { TerrainMap } from './map.js';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stateByCode = new Map(STATES.map((state) => [state.code, state]));
const themeById = new Map(HISTORY_THEMES.map((theme) => [theme.id, theme]));
const eraById = new Map(HISTORY_ERAS.map((era) => [era.id, era]));
const trailById = new Map(HISTORY_TRAILS.map((trail) => [trail.id, trail]));
const cityPlaces = CITIES.map((place) => ({...place, type: 'city', focusBounds: CITY_FOCUS[place.id]?.bounds, region: CITY_FOCUS[place.id]?.region}));
const featurePlaces = [...FEATURES, ...CITY_DETAILS].map((place) => ({...place, type: 'feature'}));
const historyPlaces = HISTORY_PLACES.map((place) => ({...place, type: 'history'}));
const allPlaces = [...cityPlaces, ...featurePlaces, ...historyPlaces];
const placeById = new Map(allPlaces.map((place) => [place.id, place]));
const params = new URLSearchParams(location.search);
const initialPlace = placeById.get(params.get('place'));
const initialTrail = trailById.get(params.get('journey'));
const state = {
  code: initialPlace?.state || (stateByCode.has(params.get('state')?.toUpperCase()) ? params.get('state').toUpperCase() : 'CA'),
  layer: initialPlace ? (initialPlace.type === 'history' ? 'history' : 'geography') : (initialTrail || params.get('layer') === 'history' ? 'history' : 'geography'),
  theme: themeById.has(params.get('theme')) ? params.get('theme') : 'all',
  era: eraById.has(params.get('era')) ? params.get('era') : 'all',
  selectedId: initialPlace?.id || null,
  trailId: initialTrail?.id || null,
  surface: ['natural', 'elevation', 'contours'].includes(params.get('surface')) ? params.get('surface') : 'natural',
  relief: Math.min(30, Math.max(1, Number(params.get('relief')) || 20)),
  showCities: true,
  showFeatures: true,
};
// A journey link always opens at a valid stop, even if a stale place parameter was supplied.
if (initialTrail) {
  state.layer = 'history';
  if (!initialTrail.placeIds.includes(state.selectedId)) state.selectedId = initialTrail.placeIds[0];
  state.code = placeById.get(state.selectedId).state;
  state.theme = 'all';
  state.era = 'all';
}
if (initialPlace?.type === 'history' && !initialTrail) {
  const era = eraById.get(state.era);
  if ((state.theme !== 'all' && initialPlace.theme !== state.theme)
    || (era && (initialPlace.startYear > era.end || initialPlace.endYear < era.start))) {
    state.theme = 'all';
    state.era = 'all';
  }
}
let viewer;
let ready = false;
let bootSequence = 0;
let toastTimer;
let lastPlaceTrigger;
let closeFocusPending = false;
let resizeTimer;
const mobile = () => matchMedia('(max-width:760px)').matches;
const currentState = () => stateByCode.get(state.code);
const selectedPlace = () => placeById.get(state.selectedId);
const activeTrail = () => trailById.get(state.trailId);
const stateHistory = () => historyPlaces.filter((place) => place.state === state.code);
const trailPlaces = () => (activeTrail()?.placeIds || []).map((id) => placeById.get(id));
const focusRegion = () => CITY_FOCUS[state.selectedId] || CITY_FOCUS[selectedPlace()?.cityId]
  || Object.values(CITY_FOCUS).find((focus) => focus.featureIds.includes(state.selectedId));
function nearbyFeatures() {
  const focus = focusRegion();
  if (focus) return focus.featureIds.map((id) => placeById.get(id)).filter(Boolean);
  return featurePlaces.filter((place) => place.state === state.code && !place.cityId);
}
function featuredCity() {
  const preferred = {CA: 'city-5391959', TX: 'city-4671654', NY: 'city-5128581'};
  return placeById.get(preferred[state.code]) || cityPlaces.find((place) => place.state === state.code);
}
const stateDescriptions = {CA: 'Pacific coast. Central Valley. Sierra Nevada.', TX: 'Hill Country, open plains, and a winding coast.', NY: 'Mountain lakes, river valleys, and an island city.'};
const cityDescriptions = {CA: 'Hills, headlands, and the bay.', TX: 'Where the hills meet the river.', NY: 'Five boroughs, one extraordinary harbor.'};

function visibleHistory() {
  const era = eraById.get(state.era);
  const trail = activeTrail();
  return stateHistory().filter((place) => (!trail || trail.placeIds.includes(place.id))
    && (state.theme === 'all' || place.theme === state.theme)
    && (!era || (place.startYear <= era.end && place.endYear >= era.start)))
    .sort((a, b) => trail ? trail.placeIds.indexOf(a.id) - trail.placeIds.indexOf(b.id) : a.startYear - b.startYear);
}

function announce(message) { $('announcement').textContent = message; }
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
}
function syncURL() {
  const query = new URLSearchParams({state: state.code});
  if (state.layer === 'history') query.set('layer', 'history');
  if (state.theme !== 'all') query.set('theme', state.theme);
  if (state.era !== 'all') query.set('era', state.era);
  if (state.selectedId) query.set('place', state.selectedId);
  if (state.trailId) query.set('journey', state.trailId);
  if (state.surface !== 'natural') query.set('surface', state.surface);
  if (state.relief !== 20) query.set('relief', state.relief);
  history.replaceState(null, '', `${location.pathname}?${query}`);
  document.title = `${selectedPlace()?.name || currentState().name} — TERRAIN · CHALL.NET`;
}
function updatePadding() {
  if (!viewer || !ready) return;
  if (mobile()) {
    const panelHeight = $('explorer').getBoundingClientRect().height;
    const sheetOpen = Boolean(state.selectedId) || $('explorer').classList.contains('expanded');
    viewer.setPadding(sheetOpen ? {top: 75, left: 20, right: 55, bottom: panelHeight + 25}
      : {top: Math.min(270, $('explorer').getBoundingClientRect().bottom + 12), left: 15, right: 38, bottom: 173});
  } else {
    viewer.setPadding({top: 72, left: innerWidth > 1599 ? 400 : innerWidth > 1150 ? 365 : 320, right: 95, bottom: 130});
  }
}
function syncMap(fit = false) {
  if (!ready) return;
  updatePadding();
  if (fit) viewer.setState(currentState());
  viewer.setPlaces({
    cities: cityPlaces.filter((place) => place.state === state.code),
    features: nearbyFeatures(),
    history: visibleHistory(),
    selectedId: state.selectedId,
    showCities: state.showCities,
    showFeatures: state.showFeatures,
    showHistory: state.layer === 'history',
  });
  viewer.setTrail(state.layer === 'history' ? trailPlaces() : []);
}
function row(place, {period = false} = {}) {
  const button = document.createElement('button');
  button.className = 'place-row';
  button.dataset.placeId = place.id;
  button.setAttribute('aria-pressed', String(state.selectedId === place.id));
  button.innerHTML = `<span class="place-dot" aria-hidden="true"></span><span class="row-main"><span>${esc(place.name)}</span>${period ? `<span class="row-sub">${esc(place.period)}</span>` : ''}</span><span class="row-arrow" aria-hidden="true">↗</span>`;
  button.addEventListener('click', () => selectPlace(place, {trigger: button}));
  return button;
}
function distance(a, b) {
  const radians = Math.PI / 180;
  const dx = (a.lng - b.lng) * Math.cos((a.lat + b.lat) / 2 * radians);
  const dy = a.lat - b.lat;
  return Math.hypot(dx, dy);
}

function renderGeography() {
  const cities = cityPlaces.filter((place) => place.state === state.code);
  const selected = selectedPlace();
  let features = nearbyFeatures();
  if (selected && selected.type !== 'history') features = [...features].sort((a, b) => distance(a, selected) - distance(b, selected));
  $('city-count').textContent = String(cities.length).padStart(2, '0');
  $('city-list').replaceChildren(...cities.map((place) => row(place)));
  $('feature-list').replaceChildren(...features.map((place) => row(place)));
  $('show-cities').checked = state.showCities;
  $('show-features').checked = state.showFeatures;
  const city = featuredCity();
  $('preview-city-name').textContent = city?.name || currentState().name;
  $('preview-city-description').textContent = cityDescriptions[state.code] || 'Discover the land around the city.';
  $('preview-city-action').textContent = state.code === 'CA' ? 'Explore the Bay Area' : `Explore ${city?.name || currentState().name}`;
  $('places-browser-label').textContent = selected && state.layer === 'geography' ? 'Nearby features' : 'Cities & landscapes';
  const invitation = state.code === 'CA' ? 'Follow the Gold Rush' : state.code === 'TX' ? 'Beyond the cowboy legend' : state.code === 'NY' ? 'New York, many Americas' : `${currentState().name}, through time`;
  $('invitation-title').innerHTML = `${esc(invitation)} <span aria-hidden="true">↗</span>`;
}

function renderHistory() {
  const places = stateHistory();
  const themes = HISTORY_THEMES.filter((theme) => places.some((place) => place.theme === theme.id) || state.theme === theme.id);
  const buttons = [{id: 'all', label: 'All stories'}, ...themes].map((theme) => {
    const count = theme.id === 'all' ? places.length : places.filter((place) => place.theme === theme.id).length;
    const button = document.createElement('button');
    button.className = 'theme-chip';
    button.dataset.theme = theme.id;
    button.setAttribute('aria-pressed', String(state.theme === theme.id));
    button.innerHTML = `${esc(theme.label)}<span class="theme-count">${count}</span>`;
    if (theme.description) button.title = theme.description;
    button.addEventListener('click', () => changeFilters({theme: theme.id}));
    return button;
  });
  $('theme-filters').replaceChildren(...buttons);
  $('era-filter').value = state.era;
  $('clear-filters').hidden = state.theme === 'all' && state.era === 'all' && !state.trailId;
  const shown = visibleHistory();
  $('history-count').textContent = `${shown.length} / ${places.length}`;
  $('history-list-title').textContent = state.trailId ? 'JOURNEY STOPS IN THIS STATE' : 'PLACES WITH A PAST';
  $('history-list').replaceChildren(...shown.map((place) => row(place, {period: true})));
  if (!shown.length) {
    $('history-list').innerHTML = '<div class="empty-state">No places in this collection match that era and theme.<button id="empty-reset">Show all stories in this state →</button></div>';
    $('empty-reset').addEventListener('click', () => changeFilters({theme: 'all', era: 'all'}));
  }
  const trail = activeTrail();
  $('active-journey').hidden = !trail;
  $('journey-picker').hidden = Boolean(trail);
  if (trail) {
    $('active-journey').innerHTML = `<span class="eyebrow">A GUIDED JOURNEY · ${trail.placeIds.length} PLACES</span><h3>${esc(trail.title)}</h3><p>${esc(trail.description)}</p><button class="quiet-button" id="end-journey">End journey ×</button>`;
    $('end-journey').addEventListener('click', endJourney);
  } else {
    const trails = HISTORY_TRAILS.filter((journey) => journey.states.includes(state.code)).sort((a, b) => a.states.length - b.states.length);
    $('journey-picker').replaceChildren(...trails.slice(0, 2).map((journey) => {
      const button = document.createElement('button');
      button.className = 'journey-card';
      button.dataset.journeyId = journey.id;
      button.innerHTML = `<span class="eyebrow">GUIDED JOURNEY · ${journey.placeIds.length} PLACES</span><span class="journey-card-title">${esc(journey.title)} <span aria-hidden="true">↗</span></span><span class="journey-card-copy">${esc(journey.description)}</span>`;
      button.addEventListener('click', () => startJourney(journey.id));
      return button;
    }));
  }
}

function renderStory() {
  const place = selectedPlace();
  $('story-panel').hidden = !place;
  if (!place) return;
  const isHistory = place.type === 'history';
  $('story-kicker').textContent = isHistory ? 'A PLACE IN HISTORY' : place.type === 'city' ? 'A CLOSER LOOK / CITY' : 'A CLOSER LOOK / LANDSCAPE';
  $('story-period').textContent = isHistory ? place.period : stateByCode.get(place.state).name;
  $('story-title').textContent = place.name;
  const theme = themeById.get(place.theme);
  $('story-tags').innerHTML = `<span>${esc(isHistory ? theme?.label : place.type === 'city' ? 'City focus' : place.kind || 'Land & water')}</span><span>${esc(place.state)}</span>`;
  $('story-summary').textContent = place.summary || place.description || `Explore ${place.name} and its surrounding landscape. Zoom in to see the terrain, shoreline, and pattern of the city in more detail.`;
  $('landscape-connection').hidden = !place.landscape;
  $('story-landscape').textContent = place.landscape || '';
  const source = place.source || (place.sourceUrl ? {url: place.sourceUrl, label: place.sourceUrl.includes('geonames.org') ? 'GeoNames · place reference' : 'Explore this place · source'} : null);
  $('story-source').hidden = !source;
  if (source) {
    $('story-source').href = /^https:\/\//.test(source.url) ? source.url : '#';
    $('story-source').innerHTML = `${esc(source.label)} <span aria-hidden="true">↗</span>`;
  }
  const trail = activeTrail();
  const step = trail?.placeIds.indexOf(place.id) ?? -1;
  $('journey-navigation').hidden = !trail || step < 0;
  if (trail && step >= 0) {
    $('journey-progress').textContent = `PLACE ${step + 1} OF ${trail.placeIds.length} · ${trail.states.length === 1 ? 'ONE STATE' : `${trail.states.length} STATES`}`;
    $('previous-stop').disabled = step === 0;
    $('next-stop').disabled = step === trail.placeIds.length - 1;
  }
}

function render({fit = false} = {}) {
  const place = selectedPlace();
  const cityFocus = place && state.layer === 'geography';
  document.body.classList.toggle('city-focus', Boolean(cityFocus));
  document.body.classList.toggle('selected-city', place?.type === 'city');
  document.body.classList.toggle('has-selection', Boolean(place));
  document.body.classList.toggle('history-mode', state.layer === 'history');
  document.body.classList.toggle('long-name', (cityFocus ? place.name : currentState().name).length > 13);
  $('state-code').textContent = state.code;
  $('state-breadcrumb').textContent = cityFocus ? `${currentState().name.toUpperCase()} / ${(focusRegion()?.region || 'A CLOSER LOOK').toUpperCase()}` : 'THE UNITED STATES, IN RELIEF';
  $('state-title').textContent = cityFocus ? place.name : currentState().name;
  $('state-description').textContent = cityFocus ? (focusRegion()?.description || 'A closer look at the land beneath the story.') : (stateDescriptions[state.code] || currentState().description);
  $('choose-state').setAttribute('aria-label', `Choose a state. Currently ${currentState().name}`);
  $('back-overview').hidden = !cityFocus;
  $('back-overview').textContent = `← ${currentState().name} overview`;
  document.querySelectorAll('[data-layer]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.layer === state.layer)));
  $('geography-panel').hidden = state.layer !== 'geography';
  $('history-panel').hidden = state.layer !== 'history';
  document.querySelectorAll('[data-surface]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.surface === state.surface)));
  $('relief').value = state.relief;
  $('relief-value').value = `${state.relief}×`;
  $('elevation-key').hidden = state.surface === 'natural';
  renderGeography();
  renderHistory();
  renderStory();
  syncURL();
  syncMap(fit);
}

function selectState(code, {preserveJourney = false, fit = true} = {}) {
  if (!stateByCode.has(code)) return;
  state.code = code;
  $('places-browser').open = false;
  state.selectedId = null;
  state.theme = 'all';
  state.era = 'all';
  if (!preserveJourney) state.trailId = null;
  viewer?.stopOrbit();
  $('orbit-view').setAttribute('aria-pressed', 'false');
  render({fit});
  document.querySelector('.explorer-body').scrollTop = 0;
  announce(`${currentState().name}. ${stateHistory().length} historical places available.`);
}

function selectPlace(input, {trigger, preserveJourney = false, focus = true, keyboardFocus} = {}) {
  const place = placeById.get(input.id);
  if (!place) return;
  trigger ||= document.activeElement?.closest('[data-place-id]');
  const shouldFocusDetails = keyboardFocus ?? Boolean(trigger?.matches(':focus-visible'));
  if (trigger) lastPlaceTrigger = trigger;
  const changeState = state.code !== place.state;
  if (changeState) {
    state.code = place.state;
    state.theme = 'all';
    state.era = 'all';
  }
  if (!preserveJourney && !activeTrail()?.placeIds.includes(place.id)) state.trailId = null;
  state.layer = place.type === 'history' ? 'history' : 'geography';
  if (place.type === 'history' && !visibleHistory().some((item) => item.id === place.id)) {
    state.theme = 'all';
    state.era = 'all';
  }
  state.selectedId = place.id;
  if (place.type !== 'history') $('places-browser').open = true;
  if (mobile()) setExpanded(false, false);
  render({fit: changeState});
  document.querySelector('.explorer-body').scrollTop = 0;
  if (focus && ready) viewer.focusPlace(place);
  announce(`${place.name}${place.period ? `. ${place.period}` : ''}. Details opened.`);
  // Keyboard selection puts the close control within reach without moving focus after pointer selection.
  if (shouldFocusDetails) $('close-story').focus({preventScroll: true});
}

function closeStory({reset = false} = {}) {
  state.selectedId = null;
  render();
  if (ready) viewer.resetView();
  if (closeFocusPending) {
    const replacement = lastPlaceTrigger?.dataset.placeId ? document.querySelector(`.place-row[data-place-id="${CSS.escape(lastPlaceTrigger.dataset.placeId)}"]`) : null;
    if (lastPlaceTrigger?.dataset.resultId) $('open-search').focus({preventScroll: true});
    else if (replacement) {
      if (replacement.closest('#places-browser')) $('places-browser').open = true;
      if (mobile()) setExpanded(true);
      replacement.focus({preventScroll: true});
      replacement.scrollIntoView({block: 'nearest'});
    }
    else if (lastPlaceTrigger?.isConnected && lastPlaceTrigger.getClientRects().length) lastPlaceTrigger.focus({preventScroll: true});
    else document.querySelector(`[data-layer="${state.layer}"]`)?.focus();
    closeFocusPending = false;
  }
}
function changeLayer(layer) {
  const wasSelected = Boolean(state.selectedId);
  state.layer = layer;
  state.selectedId = null;
  state.trailId = null;
  render();
  if (wasSelected && ready) viewer.resetView();
  document.querySelector('.explorer-body').scrollTop = 0;
  if (mobile()) setExpanded(true);
  announce(layer === 'history' ? `${visibleHistory().length} historical places in ${currentState().name}.` : `Cities and landscapes in ${currentState().name}.`);
}
function changeFilters(filters) {
  const restoreKeyboardFocus = document.activeElement?.matches(':focus-visible');
  const restoreToTheme = document.activeElement?.matches('.theme-chip,#clear-filters,#empty-reset');
  Object.assign(state, filters);
  state.trailId = null;
  if (!visibleHistory().some((place) => place.id === state.selectedId)) state.selectedId = null;
  render();
  if (restoreKeyboardFocus && restoreToTheme) document.querySelector(`[data-theme="${CSS.escape(state.theme)}"]`)?.focus({preventScroll: true});
  announce(`${visibleHistory().length} historical places match these filters.`);
}
function startJourney(id) {
  const trail = trailById.get(id);
  if (!trail) return;
  state.trailId = trail.id;
  state.theme = 'all';
  state.era = 'all';
  selectPlace(placeById.get(trail.placeIds[0]), {preserveJourney: true});
  toast(`${trail.placeIds.length} places. Follow the Next place button.`);
}
function endJourney() {
  state.trailId = null;
  state.selectedId = null;
  render({fit: true});
}
function stepJourney(direction) {
  const trail = activeTrail();
  if (!trail) return;
  const step = trail.placeIds.indexOf(state.selectedId);
  const next = trail.placeIds[step + direction];
  if (next) selectPlace(placeById.get(next), {preserveJourney: true});
}
function setExpanded(expanded, resize = true) {
  $('explorer').classList.toggle('expanded', expanded);
  $('toggle-panel').setAttribute('aria-expanded', String(expanded));
  $('toggle-panel').setAttribute('aria-label', expanded ? 'Collapse explorer' : 'Expand explorer');
  $('toggle-panel').textContent = expanded ? '×' : 'Explore places +';
  if (resize) setTimeout(updatePadding, 220);
}

function openSearch() {
  if ($('search-dialog').open) return;
  $('place-search').value = '';
  renderSearch();
  $('search-dialog').showModal();
  $('place-search').focus();
}
const normalize = (text) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function renderSearch() {
  const query = normalize($('place-search').value.trim());
  const aliases = {sf: 'san francisco', nyc: 'new york city', la: 'los angeles', 'gold rush': 'gold', cowboy: 'cowboy'};
  const needle = aliases[query] || query;
  const matches = (text) => normalize(text).includes(needle);
  const states = STATES.filter((item) => matches(`${item.name} ${item.code}`));
  const matchesPlace = (item) => matches(`${item.name} ${stateByCode.get(item.state).name} ${item.state} ${item.type === 'history' ? themeById.get(item.theme)?.label || '' : ''}`);
  const cities = query ? cityPlaces.filter(matchesPlace).slice(0, 12) : [];
  const features = query ? featurePlaces.filter(matchesPlace).slice(0, 8) : [];
  const stories = query ? historyPlaces.filter(matchesPlace).slice(0, 15) : [];
  const count = states.length + cities.length + features.length + stories.length;
  $('search-summary').textContent = query ? `${count} PLACES TO EXPLORE` : 'ALL 50 STATES · INCLUDING ALASKA & HAWAII';
  const results = $('search-results');
  results.replaceChildren();
  function addGroup(label, items, isState = false) {
    if (!items.length) return;
    const heading = document.createElement('h3');
    heading.className = 'search-group';
    heading.textContent = label;
    results.append(heading);
    const group = document.createElement('div');
    if (isState) group.className = 'state-grid';
    for (const item of items) {
      const button = document.createElement('button');
      button.className = 'search-result';
      button.dataset.resultId = isState ? item.code : item.id;
      button.innerHTML = `<span>${esc(item.name)}</span><small>${esc(isState ? item.code : item.state)} ↗</small>`;
      button.addEventListener('click', () => {
        const keyboardFocus = button.matches(':focus-visible');
        $('search-dialog').close();
        if (isState) selectState(item.code);
        else selectPlace(item, {trigger: button, keyboardFocus});
      });
      group.append(button);
    }
    results.append(group);
  }
  addGroup('STATES', states, true);
  addGroup('CITIES', cities);
  addGroup('HISTORICAL PLACES', stories);
  addGroup('LAND & WATER', features);
  if (!count) results.innerHTML = '<p class="empty-state">No matches in this collection. Try a state name, city, or a theme such as gold.</p>';
}

async function bootMap() {
  const sequence = ++bootSequence;
  ready = false;
  viewer?.destroy();
  $('map-notice').hidden = true;
  $('map-loading').hidden = false;
  document.body.classList.remove('map-ready');
  viewer = new TerrainMap($('map'), {
    onSelect: (place) => selectPlace(place),
    onError: (error) => {
      if (sequence !== bootSequence) return;
      $('map-notice-text').textContent = error.message || 'The map could not load. Check your connection and try again. You can still explore the place lists.';
      $('map-notice').hidden = false;
      if (error.fatal) $('map-loading').hidden = true;
    },
    onMove: (view) => {
      document.body.classList.toggle('detail-view', view.renderer === 'detail');
      $('compass-rose').style.transform = `rotate(${-view.bearing}deg)`;
      if (typeof view.loading === 'boolean') $('map-loading').hidden = !view.loading;
      document.querySelector('.desktop-hint').textContent = view.renderer === 'detail'
        ? 'Drag to pan · Right-drag to turn · Scroll to zoom'
        : 'Drag to rotate · Scroll to zoom · Right-drag to pan';
      $('orbit-view').setAttribute('aria-pressed', String(view.orbiting));
      $('orbit-view').setAttribute('aria-label', view.orbiting ? 'Stop automatic rotation' : 'Start automatic rotation');
      if (ready && view.surface !== state.surface) {
        state.surface = view.surface;
        document.querySelectorAll('[data-surface]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.surface === state.surface)));
        $('elevation-key').hidden = state.surface === 'natural';
        syncURL();
      }
    },
  });
  try {
    await viewer.init();
    if (sequence !== bootSequence) return;
    ready = true;
    $('map-loading').hidden = true;
    document.body.classList.add('map-ready');
    viewer.setRelief(state.relief);
    viewer.setSurface(state.surface);
    syncMap(true);
    if (selectedPlace()) viewer.focusPlace(selectedPlace());
  } catch (error) {
    if (sequence !== bootSequence) return;
    $('map-loading').hidden = true;
    $('map-notice-text').textContent = `${error.message} You can still browse the cities, features, and historical stories.`;
    $('map-notice').hidden = false;
  }
}

// Local place records make search, filters, and source reading available even if map tiles are offline.
document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  if (mobile()) setExpanded(true);
  $('explorer').focus({preventScroll: true});
});
$('era-filter').insertAdjacentHTML('beforeend', HISTORY_ERAS.map((era) => `<option value="${esc(era.id)}">${esc(era.label)}</option>`).join(''));
$('collection-coverage').textContent = `${STATES.length} states, ${CITIES.length} city locations, ${FEATURES.length + CITY_DETAILS.length} geographic features, and ${HISTORY_PLACES.length} curated historical places. Coverage is a starting collection, with deeper journeys in California and Texas; it is not a complete history of any state.`;
for (const id of ['open-search', 'choose-state', 'all-states']) $(id).addEventListener('click', openSearch);
$('explore-featured-city').addEventListener('click', (event) => {
  const place = featuredCity();
  if (place) selectPlace(place, {trigger: event.currentTarget});
});
$('close-search').addEventListener('click', () => $('search-dialog').close());
$('place-search').addEventListener('input', renderSearch);
$('place-search').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') { event.preventDefault(); $('search-results').querySelector('button')?.focus(); }
  if (event.key === 'Enter') { event.preventDefault(); $('search-results').querySelector('button')?.click(); }
});
$('search-results').addEventListener('keydown', (event) => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  const buttons = [...$('search-results').querySelectorAll('button')];
  const index = buttons.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const next = buttons[index + (event.key === 'ArrowDown' ? 1 : -1)];
  if (next) next.focus(); else if (event.key === 'ArrowUp') $('place-search').focus();
});
for (const id of ['search-dialog', 'about-dialog']) $(id).addEventListener('click', (event) => {
  if (event.target !== $(id)) return;
  const rect = $(id).getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $(id).close();
});
$('open-about').addEventListener('click', () => $('about-dialog').showModal());
$('close-about').addEventListener('click', () => $('about-dialog').close());
document.querySelectorAll('[data-layer]').forEach((button) => button.addEventListener('click', () => changeLayer(button.dataset.layer)));
$('era-filter').addEventListener('change', (event) => changeFilters({era: event.target.value}));
$('clear-filters').addEventListener('click', () => changeFilters({theme: 'all', era: 'all'}));
$('show-cities').addEventListener('change', (event) => { state.showCities = event.target.checked; syncMap(); });
$('show-features').addEventListener('change', (event) => { state.showFeatures = event.target.checked; syncMap(); });
$('history-invitation').addEventListener('click', () => {
  const journey = HISTORY_TRAILS.find((trail) => trail.states.length === 1 && trail.states[0] === state.code);
  if (journey) startJourney(journey.id); else changeLayer('history');
});
$('close-story').addEventListener('click', () => { closeFocusPending = true; closeStory(); });
$('story-state-view').addEventListener('click', () => closeStory({reset: true}));
$('back-overview').addEventListener('click', () => closeStory({reset: true}));
$('closer-view').addEventListener('click', () => {
  if (ready && selectedPlace()) viewer.focusPlace(selectedPlace(), {zoom: Math.min(15, Math.max(12.2, viewer.getView().zoom + 1.25))});
});
$('previous-stop').addEventListener('click', () => stepJourney(-1));
$('next-stop').addEventListener('click', () => stepJourney(1));
$('toggle-panel').addEventListener('click', () => setExpanded(!$('explorer').classList.contains('expanded')));
$('zoom-in').addEventListener('click', () => viewer?.zoomIn());
$('zoom-out').addEventListener('click', () => viewer?.zoomOut());
$('reset-view').addEventListener('click', () => closeStory({reset: true}));
$('compass').addEventListener('click', () => closeStory({reset: true}));
$('orbit-view').addEventListener('click', () => {
  if (!ready) return;
  viewer.toggleOrbit();
  const rotating = viewer.getView().orbiting;
  $('orbit-view').setAttribute('aria-pressed', String(rotating));
  $('orbit-view').setAttribute('aria-label', rotating ? 'Stop automatic rotation' : 'Start automatic rotation');
});
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else toast('Use your browser’s fullscreen or home-screen mode.');
  } catch { toast('Fullscreen is unavailable in this browser view.'); }
});
document.addEventListener('fullscreenchange', () => {
  $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
  viewer?.resize();
});
document.querySelectorAll('[data-surface]').forEach((button) => button.addEventListener('click', () => {
  state.surface = button.dataset.surface;
  viewer?.setSurface(state.surface);
  document.querySelectorAll('[data-surface]').forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.surface === state.surface)));
  $('elevation-key').hidden = state.surface === 'natural';
  syncURL();
}));
$('relief').addEventListener('input', (event) => {
  state.relief = Number(event.target.value);
  $('relief-value').value = `${state.relief}×`;
  viewer?.setRelief(state.relief);
  syncURL();
});
$('share-view').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); toast('Link copied. Your state, filters, and place are included.'); }
  catch { toast('Copy the address in your browser to share this view.'); }
});
$('retry-map').addEventListener('click', bootMap);
$('dismiss-notice').addEventListener('click', () => { $('map-notice').hidden = true; });
document.addEventListener('keydown', (event) => {
  const typing = event.target.matches('input,textarea,select,[contenteditable]');
  if ((event.key === '/' && !typing) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
    event.preventDefault();
    if (!$('about-dialog').open) openSearch();
  }
  if (event.key === 'Escape' && !$('search-dialog').open && !$('about-dialog').open) {
    viewer?.stopOrbit();
    $('orbit-view').setAttribute('aria-pressed', 'false');
    if (state.selectedId) { closeFocusPending = true; closeStory(); }
    else if (mobile()) setExpanded(false);
  }
});
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { viewer?.resize(); updatePadding(); }, 120);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    viewer?.stopOrbit();
    $('orbit-view').setAttribute('aria-pressed', 'false');
  }
});

setExpanded(false, false);
render();
bootMap();
// Read-only snapshot and ordinary UI actions for local QA; no network or private data.
window.__TERRAIN = {
  info: () => ({...state, ready, historyIds: visibleHistory().map((place) => place.id), counts: {states: STATES.length, cities: CITIES.length, features: FEATURES.length + CITY_DETAILS.length, history: HISTORY_PLACES.length}, view: ready ? viewer.getView() : null}),
  selectState,
  selectPlace: (id) => { const place = placeById.get(id); if (place) selectPlace(place); },
  startJourney,
};
