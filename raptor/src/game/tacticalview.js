import { GameDialog, escapeHTML, bindingLabel } from './ui.js';
import { captureTacticalMap, renderTacticalMapSVG } from './tacticalmap.js';
import { radioHistory, formatRadioTime } from './radiolog.js';
import { flightBrief } from './flightbrief.js';
import { winsAtTimeLimit } from './missions.js';
import { missionObjectivePurpose } from './missioncatalog.js';
import { REARM_AGL_MAX, REARM_SPEED_MAX, REARM_TIME } from './match.js';

const statusLabel = { pending: 'In progress', complete: 'Complete', failed: 'Failed', holding: 'Intact' };
const heading = degrees => `${String(Math.round(degrees) % 360).padStart(3, '0')}°`;

// Built only when opened, after Cockpit pauses. Closing never changes a route,
// target, objective, saved profile or simulation clock.
export class TacticalView extends GameDialog {
  constructor({state, input, onClose, onResume}) {
    super({title: 'Tactical map', label: 'Flight paused · Plan your next move', className: 'tactical-dialog', onClose});
    Object.assign(this, {state, input, onResume});
    this.held = new Set();
    window.addEventListener('blur', () => this.held.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.held.clear(); });
    this.el.addEventListener('keyup', event => this.held.delete(event.code));
    this.el.addEventListener('keydown', event => {
      if (event.repeat || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
      // Keep native button activation and Escape intact. All bindings, even
      // mouse/wheel shortcuts, retain the visible Close and Resume controls.
      if (['Escape', 'Tab', 'Enter', 'Space'].includes(event.code)) return;
      this.held.add(event.code);
      for (const [name, active] of [['Shift', event.shiftKey], ['Control', event.ctrlKey], ['Alt', event.altKey], ['Meta', event.metaKey]]) {
        if (!active) { this.held.delete(name + 'Left'); this.held.delete(name + 'Right'); }
      }
      if (this.input.matchingActions(event.code, this.held).includes('map')) {
        event.preventDefault(); this.close();
      }
    });
  }
  show(heldCodes = []) {
    if (this.open) return;
    // Retain shortcut modifiers across opening, while Cockpit separately
    // clears every flight control. Keyup/blur keep this local set accurate.
    this.held = new Set(heldCodes);
    const map = captureTacticalMap(this.state), brief = flightBrief(this.state);
    const history = radioHistory(this.state), spec = this.state.script?.spec;
    const over = this.state.match?.over;
    const time = formatRadioTime(this.state.sim?.time || 0);
    const key = bindingLabel(this.input, 'map');
    const objectives = map.objectives.map((objective, index) => {
      const detail = brief?.objectives[index]?.detail;
      const purpose = spec ? missionObjectivePurpose(spec, objective) : '';
      return `<li class="tactical-objective ${objective.status}"><span class="tactical-number" aria-label="${objective.markerNumber ? 'Map marker' : 'Status'}">${objective.markerNumber || (objective.status === 'complete' ? '✓' : objective.status === 'failed' ? '×' : '·')}</span><div><b>${escapeHTML(objective.label)}</b><small>${purpose ? escapeHTML(purpose) + ' · ' : ''}${statusLabel[objective.status] || 'In progress'}${detail ? ' · ' + escapeHTML(detail) : ''}</small></div></li>`;
    }).join('');
    const nav = map.navigation;
    const af = map.airfield, own = map.ownship;
    const course = af && own ? `HDG ${heading((Math.atan2(af.x - own.x, af.y - own.y) * 180 / Math.PI + 360) % 360)} · ${(Math.hypot(af.x - own.x, af.y - own.y) / 1000).toFixed(1)} km` : '';
    const clock = over ? (over > 0 ? 'Mission complete' : 'Mission ended') : brief?.remaining ? `${brief.remaining} remaining` : 'No mission clock';
    this.body.innerHTML = `<div class="tactical-summary"><div><span class="status-dot"></span>World paused <span>· ${escapeHTML(time)} elapsed</span></div><strong>${escapeHTML(clock)}</strong></div>
      <div class="tactical-layout"><section class="tactical-chart" aria-label="Flight navigation chart">${renderTacticalMapSVG(map)}<p>North up · Distances in kilometers · Numbered locations match your objectives.</p></section>
      <section class="tactical-details" aria-label="Flight plan">
        ${nav ? `<div class="tactical-course"><span class="eyebrow">Current objective${nav.markerNumber ? ' · ' + nav.markerNumber : ''}</span><h3>${escapeHTML(nav.label)}</h3><p>${escapeHTML(nav.text)}</p></div>` : `<div class="tactical-course"><span class="eyebrow">${spec ? 'Mission overview' : 'Explore the region'}</span><h3>${over ? 'Sortie finished' : spec ? 'Your mission, at a glance' : 'Your position, at a glance'}</h3><p>${over ? 'Review the final objectives and radio calls below.' : spec ? 'Check your objectives and the latest radio calls below.' : 'The arrow shows your aircraft and current heading.'}</p></div>`}
        ${objectives ? `<h3 class="tactical-section-title">Objectives</h3><ul class="tactical-objectives">${objectives}</ul>${!over && winsAtTimeLimit(spec) ? '<p class="tactical-note">Hold all protection conditions until the clock runs out, or complete the early-victory objectives.</p>' : ''}` : `<p class="tactical-note">${over ? 'Review the final flight position and return to the flight menu for your debrief.' : af ? 'Destroy enemy ground targets to win the battle. Return to the airfield whenever you need supplies.' : 'Practice has no enemies or mission deadline. Resume whenever you’re ready.'}</p>`}
        ${af ? `<section class="tactical-airfield"><span class="eyebrow">＋ Airfield · Rearm & repair</span><p>${escapeHTML(course)}</p><small>Stay within ${(af.radiusM / 1000).toFixed(1)} km, below ${Math.floor(REARM_AGL_MAX * 3.28084).toLocaleString('en-US')} ft above terrain and under ${Math.floor(REARM_SPEED_MAX * 1.94384)} kt total speed for ${REARM_TIME} seconds.</small></section>` : ''}
      </section></div>
      <section class="tactical-radio" aria-labelledby="tactical-radio-title"><div class="tactical-radio-heading"><h3 id="tactical-radio-title">Radio log</h3><span>${history.length ? `${history.length} received · newest first` : 'Awaiting transmission'}</span></div>
        ${history.length ? `<ol tabindex="0" aria-label="Received radio messages, newest first">${history.map(line => `<li><time>${escapeHTML(formatRadioTime(line.timeS))}</time><p>${escapeHTML(line.text)}</p></li>`).join('')}</ol>` : '<p class="tactical-note">No radio messages received in this flight.</p>'}
      </section>
      <div class="tactical-footer"><p>${key === 'Unassigned' ? 'Assign a map shortcut in Controls.' : `<kbd>${escapeHTML(key)}</kbd> opens this view during flight.`}</p><button type="button" class="ui-button primary" data-tactical-resume>${over ? 'Return to flight view' : 'Resume flight'} ↗</button></div>`;
    this.body.querySelector('[data-tactical-resume]').onclick = () => { this.afterCloseAction = this.onResume; this.close(); };
    this.body.scrollTop = 0;
    super.show();
  }
}
