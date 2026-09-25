// Radio presentation reads only messages already emitted by Script. Its
// fixed numeric ring remains the authority; these caches never modify it.
const histories = new WeakMap();
const layouts = new WeakMap();
const EMPTY = Object.freeze([]);
export const RADIO_LIFETIME_S = 9;
const FONT = 'ui-monospace, Menlo, monospace';

export function formatRadioTime(seconds) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minute = Math.floor(total / 60), second = String(total % 60).padStart(2, '0');
  return minute < 60 ? `${String(minute).padStart(2, '0')}:${second}`
    : `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}:${second}`;
}

// Immutable, newest-first snapshots can be shared by the live feed and the
// paused mission log. Unchanged rings return the same array without creating
// a readComms() array or message objects on every render frame. Comparing the
// retained entries also handles a reset/replay that reaches the same head.
export function radioHistory(state) {
  const script = state?.script, lines = state?.missionData?.lines;
  if (!script || !lines || !Number.isSafeInteger(script.commsHead) || script.commsHead < 0) return EMPTY;
  const ids = script.commsLine, times = script.commsT;
  if (!ids?.length || ids.length !== times?.length) return EMPTY;
  const now = Number.isFinite(state?.sim?.time) ? state.sim.time : 0;
  const count = Math.min(script.commsHead, ids.length);
  const prior = histories.get(script) || EMPTY;
  let rows = null, kept = 0;
  for (let i = 0; i < count; i++) {
    const slot = (script.commsHead - 1 - i) % ids.length;
    const lineId = ids[slot], timeS = times[slot];
    const text = Object.hasOwn(lines, lineId) ? lines[lineId] : null;
    if (!Number.isInteger(lineId) || !Number.isFinite(timeS) || timeS < 0 || timeS > now
        || typeof text !== 'string' || !text.trim()) continue;
    const previous = prior[kept];
    if (!rows && (!previous || previous.lineId !== lineId || previous.timeS !== timeS || previous.text !== text)) {
      rows = prior.slice(0, kept);
    }
    if (rows) rows.push(Object.freeze({ lineId, timeS, text }));
    kept++;
  }
  if (!rows && kept === prior.length) return prior;
  const snapshot = kept ? Object.freeze(rows || prior.slice(0, kept)) : EMPTY;
  histories.set(script, snapshot);
  return snapshot;
}

function fittingPrefix(text, width, measure) {
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid)) <= width) lo = mid;
    else hi = mid - 1;
  }
  // Never divide a Unicode surrogate pair when breaking an unspaced call.
  if (lo && lo < text.length && /[\uD800-\uDBFF]/.test(text[lo - 1]) && /[\uDC00-\uDFFF]/.test(text[lo])) lo--;
  return lo;
}

// Width is measured with the exact canvas font. Long words and compact
// languages wrap too; a capacity-limited last line ends with an ellipsis.
export function wrapRadioText(text, width, measure, maxLines = 6) {
  if (typeof text !== 'string' || !(width > 0) || !(maxLines > 0)) return [];
  let remaining = text.replace(/\s+/g, ' ').trim();
  const rows = [];
  while (remaining && rows.length < Math.floor(maxLines)) {
    if (measure(remaining) <= width) { rows.push(remaining); break; }
    let end = fittingPrefix(remaining, width, measure);
    if (!end) break;
    const space = remaining.lastIndexOf(' ', end);
    if (space > 0) end = space;
    let line = remaining.slice(0, end).trimEnd();
    remaining = remaining.slice(end).trimStart();
    if (rows.length === Math.floor(maxLines) - 1 && remaining) {
      if (measure('…') > width) break;
      line = line.slice(0, fittingPrefix(line, width - measure('…'), measure)).trimEnd() + '…';
    }
    rows.push(line);
  }
  return rows;
}

function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

// Returns the cached layout for inspection; no message or wrapping allocation
// occurs while the radio, viewport, settings and visible message set stay put.
export function drawRadioFeed(ctx, history, { timeS, width, height, hudScale = 1,
  subtitleScale = 1, showHints = true, toolbarBottom = 0, top = 0, priorityCue = false } = {}) {
  // Threats, boundary recovery and a visible rearm card own this space first.
  // The complete radio history remains available in the paused mission view.
  if (priorityCue || !history?.length || !Number.isFinite(timeS) || !(width > 0) || !(height > 0)) return null;
  const scale = clamp(hudScale, .8, 1.4, 1), sub = clamp(subtitleScale, .8, 1.6, 1);
  const fontPx = Math.round(12 * sub), lineHeight = Math.ceil(fontPx * 1.45), padding = 10, gap = 6;
  const panelWidth = Math.min(640, width - 32);
  // G/M/AoA and throttle are scaled by HUD size; the ammunition readout and
  // optional key strip use CSS pixels. Keep the entire panel above all three.
  const bottom = height - Math.max(108 * scale, showHints ? 100 : 60);
  const safeTop = Math.max(12, toolbarBottom + 24, top);
  const maxHeight = Math.min(height * .26, bottom - safeTop);
  const maxLines = Math.min(6, Math.floor((maxHeight - padding * 2) / lineHeight));
  if (panelWidth < 96 || maxLines < 1) return null;
  let mask = 0, visible = 0;
  for (let i = 0; i < history.length && visible < 3; i++) {
    const age = timeS - history[i].timeS;
    if (age >= 0 && age < RADIO_LIFETIME_S) { mask = mask * 64 + i + 1; visible++; }
  }
  if (!visible) return null;
  let layout = layouts.get(ctx);
  if (!layout || layout.history !== history || layout.mask !== mask || layout.width !== width || layout.height !== height
      || layout.fontPx !== fontPx || layout.bottom !== bottom || layout.maxHeight !== maxHeight) {
    const font = `${fontPx}px ${FONT}`;
    ctx.save(); ctx.font = font;
    const measure = text => ctx.measureText(text).width;
    const messages = [];
    let usedHeight = padding * 2, remainingLines = maxLines;
    for (let i = 0; i < history.length && messages.length < 3; i++) {
      const age = timeS - history[i].timeS;
      if (age < 0 || age >= RADIO_LIFETIME_S) continue;
      const separator = messages.length ? gap : 0;
      const capacity = Math.min(remainingLines, Math.floor((maxHeight - usedHeight - separator) / lineHeight));
      if (capacity < 1) break;
      const rows = wrapRadioText('» ' + history[i].text, panelWidth - padding * 2, measure, capacity);
      if (!rows.length) continue;
      messages.push({ entry: history[i], rows });
      remainingLines -= rows.length;
      usedHeight += rows.length * lineHeight + separator;
    }
    layout = { history, mask, width, height, fontPx, font, bottom, maxHeight, messages, lineHeight, padding, gap,
      x: (width - panelWidth) / 2, y: bottom - usedHeight, panelWidth, panelHeight: usedHeight };
    layouts.set(ctx, layout);
    ctx.restore();
  }
  if (!layout.messages.length) return null;
  ctx.save();
  ctx.font = layout.font;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.globalAlpha = Math.min(1, Math.max(0, (RADIO_LIFETIME_S - (timeS - layout.messages[0].entry.timeS)) / 2));
  ctx.fillStyle = 'rgba(2,14,12,.78)';
  ctx.fillRect(layout.x, layout.y, layout.panelWidth, layout.panelHeight);
  ctx.fillStyle = '#cfe8cf';
  let y = layout.y + padding;
  // Chronological reading order, with the newest call nearest the bottom.
  for (let i = layout.messages.length - 1; i >= 0; i--) {
    const message = layout.messages[i];
    ctx.globalAlpha = Math.min(1, Math.max(0, (RADIO_LIFETIME_S - (timeS - message.entry.timeS)) / 2));
    for (const line of message.rows) { ctx.fillText(line, layout.x + padding, y); y += lineHeight; }
    y += gap;
  }
  ctx.restore();
  return layout;
}
