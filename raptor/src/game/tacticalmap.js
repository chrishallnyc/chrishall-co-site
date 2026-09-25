// A paused, detached view of navigation the pilot already has. Dynamic target
// positions come only from missionNavigation; this is not a second radar.
import { missionObjectiveRows, missionNavigation } from './missionguidance.js';
import { BOUNDARY } from './match.js';

const finite = Number.isFinite;
const freeze = Object.freeze;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const statusOf = row => row.failed ? 'failed' : row.done ? 'complete' : row.kind === 'protect_tag' ? 'holding' : 'pending';
const validZone = zone => zone && finite(zone.x) && finite(zone.y) && finite(zone.r) && zone.r > 0;

function ownship(state) {
  const st = state.player?.fm?.state;
  if (!st || !finite(st[0]) || !finite(st[1])) return null;
  // Body +X is forward in the FM's ENU quaternion, exactly as in Player's HUD.
  const [qw, qx, qy, qz] = [st[3], st[4], st[5], st[6]];
  const east = 1 - 2 * (qy * qy + qz * qz), north = 2 * (qx * qy + qw * qz);
  const headingDeg = [qw, qx, qy, qz].every(finite) && Math.hypot(qw, qx, qy, qz) > 1e-8 && Math.hypot(east, north) > 1e-8
    ? (Math.atan2(east, north) * 180 / Math.PI + 360) % 360 : null;
  return freeze({ x: st[0], y: st[1], headingDeg });
}

function mapBounds(player, boundary, airfield, markers) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x, y, r = 0) => {
    minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r);
  };
  if (boundary) { include(boundary.minX, boundary.minY); include(boundary.maxX, boundary.maxY); }
  if (player) include(player.x, player.y);
  if (airfield) include(airfield.x, airfield.y, airfield.radiusM);
  for (const marker of markers) include(marker.x, marker.y, marker.radiusM);
  if (!finite(minX)) { minX = minY = -5000; maxX = maxY = 5000; }
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  // A square scale preserves circles and bearings. Always include an aircraft
  // outside the battle square, with enough inset for its heading symbol.
  const half = Math.max(5000, maxX - minX, maxY - minY) * .58;
  return freeze({ minX: centerX - half, maxX: centerX + half, minY: centerY - half, maxY: centerY + half });
}

export function captureTacticalMap(state = {}) {
  const player = ownship(state);
  const boundary = state.match ? freeze({ minX: -BOUNDARY, maxX: BOUNDARY, minY: -BOUNDARY, maxY: BOUNDARY }) : null;
  const af = state.match?.airfield;
  const airfield = validZone(af) ? freeze({ x: af.x, y: af.y, radiusM: af.r, label: 'Airfield / rearm' }) : null;
  const rows = missionObjectiveRows(state);
  const navigation = missionNavigation(state, rows);
  const markers = [];
  for (const row of rows) {
    const zone = row.definition.zone;
    if (!['reach_zone', 'protect_tag'].includes(row.kind) || !validZone(zone)) continue;
    markers.push({ id: `objective-${row.id}`, objectiveId: row.id, x: zone.x, y: zone.y, radiusM: zone.r,
      kind: row.kind === 'reach_zone' ? 'reach' : 'protect', label: row.label, status: statusOf(row),
      active: navigation?.objectiveId === row.id, number: markers.length + 1 });
  }
  let destination = null;
  if (navigation && player) {
    const row = rows.find(candidate => candidate.id === navigation.objectiveId);
    let marker = markers.find(candidate => candidate.objectiveId === navigation.objectiveId);
    if (!marker) {
      const angle = navigation.bearing * Math.PI / 180;
      marker = { id: `objective-${navigation.objectiveId}`, objectiveId: navigation.objectiveId,
        x: player.x + Math.sin(angle) * navigation.distanceM, y: player.y + Math.cos(angle) * navigation.distanceM,
        radiusM: 0, kind: 'navigation', label: row.label, status: statusOf(row), active: true, number: markers.length + 1 };
      markers.push(marker);
    }
    destination = freeze({ ...navigation, label: row.label, x: marker.x, y: marker.y, markerNumber: marker.number });
  }
  const objectives = rows.map(row => freeze({ id: row.id, label: row.label, kind: row.kind, status: statusOf(row),
    markerNumber: markers.find(marker => marker.objectiveId === row.id)?.number ?? null }));
  const bounds = mapBounds(player, boundary, airfield, markers);
  return freeze({ ownship: player, boundary, airfield, markers: freeze(markers.map(freeze)),
    objectives: freeze(objectives), navigation: destination, bounds });
}

const heading = degrees => `${String(Math.round(degrees) % 360).padStart(3, '0')}°`;
const decimal = value => Number(value.toFixed(2));
const statusText = marker => marker.status === 'complete' ? 'complete' : marker.status === 'failed' ? 'failed'
  : marker.kind === 'protect' ? 'holding' : marker.active ? 'current navigation' : 'pending';

export function renderTacticalMapSVG(snapshot, { idPrefix = 'tactical-map' } = {}) {
  const prefix = String(idPrefix).replace(/[^a-zA-Z0-9_-]/g, '') || 'tactical-map';
  const { bounds, ownship: player, boundary, airfield, markers, navigation } = snapshot;
  const inset = 48, size = 544, scale = size / (bounds.maxX - bounds.minX);
  const px = value => decimal(inset + (value - bounds.minX) * scale);
  const py = value => decimal(inset + (bounds.maxY - value) * scale);
  const label = (value, x, y, attributes = '') => `<text x="${x}" y="${y}" fill="#dbe7ee" font-size="12" ${attributes}>${escape(value)}</text>`;
  const description = [player ? `Your aircraft${player.headingDeg === null ? '' : ` heading ${heading(player.headingDeg)}`}.` : 'Aircraft position unavailable.',
    boundary ? 'The dashed square is the playable battle boundary.' : '', airfield ? 'The square marked BASE is the airfield rearm zone.' : '',
    ...markers.map(marker => `Marker ${marker.number}: ${marker.label}, ${statusText(marker)}.`),
    'Only the current mission navigation target and authored mission zones are shown. Other aircraft are not plotted.'].filter(Boolean).join(' ');
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" class="tactical-map-svg" viewBox="0 0 640 640" width="640" height="640" role="img" aria-labelledby="${prefix}-title ${prefix}-description" style="display:block;max-width:100%;height:auto;font-family:ui-monospace,Menlo,monospace">`,
    `<title id="${prefix}-title">Tactical map, north up</title><desc id="${prefix}-description">${escape(description)}</desc>`,
    '<rect x="1" y="1" width="638" height="638" rx="14" fill="#0a1721" stroke="#29404e"/>'];
  // Four subdivisions keep the reading calm at every world scale. These are
  // ENU distances with a scale bar, not geographic latitude and longitude.
  for (let i = 0; i <= 4; i++) {
    const position = inset + size * i / 4;
    out.push(`<path d="M${position} ${inset}V${inset + size}M${inset} ${position}H${inset + size}" fill="none" stroke="#1d303d" stroke-width="1"/>`);
  }
  out.push(label('N', 600, 24, 'text-anchor="middle" font-weight="700"'), '<path d="M600 43V29M595 35L600 29L605 35" fill="none" stroke="#dbe7ee" stroke-width="2"/>',
    label('WEST', 48, 25), label('EAST', 553, 25), label('SOUTH', 320, 618, 'text-anchor="middle"'));
  if (boundary) {
    out.push(`<rect data-map-kind="boundary" x="${px(boundary.minX)}" y="${py(boundary.maxY)}" width="${decimal((boundary.maxX - boundary.minX) * scale)}" height="${decimal((boundary.maxY - boundary.minY) * scale)}" fill="#173342" fill-opacity=".25" stroke="#82929e" stroke-dasharray="8 6" stroke-width="1.5"/>`);
    out.push(label('BATTLE BOUNDARY', px(boundary.minX) + 6, py(boundary.maxY) + 17));
  }
  for (const marker of markers) {
    if (!marker.radiusM) continue;
    const color = marker.status === 'failed' ? '#ffad96' : marker.status === 'complete' ? '#90c5a7' : marker.kind === 'protect' ? '#b0bbff' : '#e1c47b';
    out.push(`<circle data-map-kind="${marker.kind}-zone" cx="${px(marker.x)}" cy="${py(marker.y)}" r="${decimal(marker.radiusM * scale)}" fill="${color}" fill-opacity=".09" stroke="${color}" stroke-width="1.5"${marker.kind === 'protect' ? ' stroke-dasharray="4 3"' : ''}/>`);
  }
  if (navigation && player) out.push(`<path data-map-kind="course" d="M${px(player.x)} ${py(player.y)}L${px(navigation.x)} ${py(navigation.y)}" fill="none" stroke="#e1c47b" stroke-width="1.5" stroke-dasharray="4 5"/>`);
  if (airfield) {
    const x = px(airfield.x), y = py(airfield.y);
    out.push(`<g data-map-kind="airfield"><title>${escape(airfield.label)}</title><circle cx="${x}" cy="${y}" r="${decimal(airfield.radiusM * scale)}" fill="#8fd4be" fill-opacity=".13" stroke="#8fd4be"/><rect x="${x - 5}" y="${y - 5}" width="10" height="10" fill="#0a1721" stroke="#8fd4be" stroke-width="2"/></g>`,
      label('BASE', x + 11, y + 4, 'font-weight="700"'));
  }
  // Markers use shapes and explicit numbers, not colors alone. Offset a number
  // when nearby markers share its normal position; their actual centers stay put.
  const placed = [];
  for (const marker of markers) {
    const x = px(marker.x), y = py(marker.y), color = marker.status === 'failed' ? '#ffad96' : marker.status === 'complete' ? '#90c5a7' : '#e1c47b';
    const title = `Marker ${marker.number}: ${marker.label}, ${statusText(marker)}`;
    let labelY = y - 14;
    while (placed.some(point => Math.abs(point.x - x) < 40 && Math.abs(point.y - labelY) < 22)) labelY += 24;
    placed.push({ x, y: labelY });
    out.push(`<g data-map-kind="${marker.kind}" data-objective-id="${escape(marker.objectiveId)}"><title>${escape(title)}</title>`);
    if (marker.active) out.push(`<circle cx="${x}" cy="${y}" r="13" fill="none" stroke="${color}" stroke-width="2"/>`);
    out.push(marker.kind === 'protect'
      ? `<path d="M${x - 6} ${y - 6}H${x + 6}V${y + 1}L${x} ${y + 7}L${x - 6} ${y + 1}Z" fill="#0a1721" stroke="${color}" stroke-width="2"/>`
      : `<path d="M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z" fill="#0a1721" stroke="${color}" stroke-width="2"/>`);
    if (labelY !== y - 14) out.push(`<path d="M${x + 8} ${y}L${x + 18} ${labelY}" fill="none" stroke="${color}" stroke-width="1"/>`);
    const symbol = marker.status === 'complete' ? '✓ ' : marker.status === 'failed' ? '× ' : '';
    out.push(label(`${symbol}${marker.number}`, x + 12, labelY + 4, 'font-weight="700" paint-order="stroke" stroke="#0a1721" stroke-width="4" stroke-linejoin="round"'), '</g>');
  }
  if (player) {
    const x = px(player.x), y = py(player.y);
    out.push(`<g data-map-kind="ownship" transform="translate(${x} ${y})"><circle r="15" fill="#0a1721" fill-opacity=".85"/>`,
      player.headingDeg === null ? '<circle r="5" fill="#fff"/>'
        : `<path d="M0 -12L8 9L0 5L-8 9Z" transform="rotate(${decimal(player.headingDeg)})" fill="#fff" stroke="#0a1721" stroke-width="1.5"/>`, '</g>',
      label(`YOU${player.headingDeg === null ? '' : ` ${heading(player.headingDeg)}`}`, x, y + 30, 'text-anchor="middle" font-weight="700" paint-order="stroke" stroke="#0a1721" stroke-width="4" stroke-linejoin="round"'));
  }
  // A readable 1/2/5 km scale fits in the lower left without affecting bounds.
  const target = 110 / scale, power = 10 ** Math.floor(Math.log10(target));
  const distance = (target / power >= 5 ? 5 : target / power >= 2 ? 2 : 1) * power;
  const scaleWidth = decimal(distance * scale);
  out.push(`<path d="M48 608V614H${48 + scaleWidth}V608" fill="none" stroke="#b5c8d5" stroke-width="1.5"/>`,
    label(`${decimal(distance / 1000)} km`, 48, 602), '</svg>');
  return out.join('');
}
