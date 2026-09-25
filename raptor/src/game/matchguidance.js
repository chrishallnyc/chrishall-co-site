// Match navigation reads the authoritative rules and state; it never steers,
// refills or damages an aircraft. ENU coordinates use meters throughout.
import { REARM_AGL_MAX, REARM_SPEED_MAX, REARM_TIME, BOUNDARY, BOUNDARY_GRACE, BOUNDARY_DPS } from './match.js';
import { formatCombatRange } from './combathud.js';

const FT_PER_M = 3.28084, KT_PER_MS = 1.94384;
const FONT = 'ui-monospace, Menlo, monospace';
const altitudeLimit = Math.floor(REARM_AGL_MAX * FT_PER_M).toLocaleString('en-US');
const speedLimit = Math.floor(REARM_SPEED_MAX * KT_PER_MS);
const rearmLimits = `< ${altitudeLimit} ft AGL · Total speed < ${speedLimit} kt`;
const headingTo = (east, north) => (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
const headingLabel = degrees => String(Math.round(degrees) % 360).padStart(3, '0');
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function airfieldGuidance(match, player = match?.player, out = {}) {
  if (!match || match.over || !player?.fm?.state) return null;
  const st = player.fm.state, af = match.airfield;
  if (!af || !Number.isFinite(af.x) || !Number.isFinite(af.y) || !Number.isFinite(af.r) || af.r <= 0) return null;
  const needs = player.gun.ammo < 480 || player.missiles.ammo < 4 || player.hp < 100;
  if (!needs) return null;
  const east = af.x - st[0], north = af.y - st[1];
  const distanceM = Math.hypot(east, north);
  const speedMs = Math.hypot(st[7], st[8], st[9]);
  // Match intentionally uses total world velocity, including vertical speed.
  // fm.out.v and the displayed airspeed must not substitute for this value.
  const ground = player.terrain ? player.terrain.heightAt(st[0], st[1]) : 0;
  const aglM = st[2] - Math.max(ground, 0);
  if (!Number.isFinite(distanceM) || !Number.isFinite(speedMs) || !Number.isFinite(aglM)) return null;
  out.distanceM = distanceM;
  out.heading = headingTo(east, north);
  out.radiusM = af.r;
  out.aglM = aglM; out.speedMs = speedMs;
  out.inside = distanceM < af.r;
  out.lowEnough = aglM < REARM_AGL_MAX;
  out.slowEnough = speedMs < REARM_SPEED_MAX;
  out.eligible = out.inside && out.lowEnough && out.slowEnough;
  out.rearming = !!match.rearming && out.eligible;
  out.progress = out.rearming ? clamp((Number.isFinite(match.rearmT) ? match.rearmT : 0) / REARM_TIME, 0, 1) : 0;
  out.remainingS = REARM_TIME * (1 - out.progress);
  // A few spent rounds do not summon a persistent navigation card. Surface
  // it when supplies are low, the aircraft is damaged, or a refill is nearby.
  out.visible = !match.outside && (out.rearming || distanceM <= af.r * 3
    || player.gun.ammo <= 120 || player.missiles.ammo === 0 || player.hp <= 50);
  out.reason = !out.inside ? 'outside' : !out.lowEnough && !out.slowEnough ? 'high-fast'
    : !out.lowEnough ? 'high' : !out.slowEnough ? 'fast' : 'ready';
  return out;
}

export function boundaryGuidance(match, player = match?.player, out = {}) {
  if (!match || match.over || !player?.fm?.state) return null;
  const st = player.fm.state, x = st[0], y = st[1];
  if (!Number.isFinite(x) || !Number.isFinite(y) || (Math.abs(x) <= BOUNDARY && Math.abs(y) <= BOUNDARY)) return null;
  // Aim just inside the nearest edge/corner, not at the distant arena center.
  // This gets the pilot out of the penalty with the shortest useful course.
  const inset = 100;
  const east = clamp(x, -BOUNDARY + inset, BOUNDARY - inset) - x;
  const north = clamp(y, -BOUNDARY + inset, BOUNDARY - inset) - y;
  const elapsed = match.outside && Number.isFinite(match.boundaryT) ? Math.max(0, match.boundaryT) : 0;
  out.heading = headingTo(east, north);
  out.distanceM = Math.hypot(east, north);
  out.remainingS = Math.max(0, BOUNDARY_GRACE - elapsed);
  out.penalty = elapsed > BOUNDARY_GRACE;
  return out;
}

function text(ctx, value, x, y, color, width, size = 11, bold = false) {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,10,14,.92)';
  ctx.strokeText(value, x, y, width);
  ctx.fillStyle = color; ctx.fillText(value, x, y, width);
}

export function drawAirfieldGuidance(ctx, cue, { width, height, top = 100, bottom = 100, incomingMissile = false, palette }) {
  if (!cue?.visible || incomingMissile) return false;
  const safeTop = Math.max(12, top), safeBottom = height - bottom;
  const available = safeBottom - safeTop;
  // Navigation yields to the toolbar, tickets and bottom instruments. Keep
  // all three useful lines in a compact card, or wait until there is room.
  if (available < 60 || width < 48) return false;
  const compact = available < 76, cardH = compact ? 60 : 76;
  const cardW = Math.min(width - 24, 360), x = width / 2;
  const cardTop = clamp(height * .62 - 14, safeTop, safeBottom - cardH);
  const y = cardTop + (compact ? 12 : 14);
  const color = cue.rearming ? palette.good : palette.lock;
  ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(8,15,20,.76)'; ctx.fillRect(x - cardW / 2, cardTop, cardW, cardH);
  text(ctx, `AIRFIELD · HDG ${headingLabel(cue.heading)}° · ${formatCombatRange(cue.distanceM)}`, x, y + 1, color, cardW - 18, 11, true);
  const action = cue.rearming ? `REARMING ${Math.floor(cue.progress * 100)}% · ${cue.remainingS.toFixed(1)}s remaining`
    : cue.reason === 'outside' ? `Enter the ${formatCombatRange(cue.radiusM)} airfield zone to rearm`
      : cue.reason === 'high-fast' ? 'Descend and slow down to rearm'
        : cue.reason === 'high' ? 'Descend to rearm' : cue.reason === 'fast' ? 'Slow down to rearm'
          : 'Hold these conditions to rearm and repair';
  text(ctx, action, x, y + (compact ? 17 : 21), '#e1ece6', cardW - 18, compact ? 10 : 11);
  text(ctx, rearmLimits, x, y + (compact ? 32 : 39), '#c5d1d6', cardW - 18, 10);
  const barY = y + (compact ? 41 : 50);
  ctx.fillStyle = 'rgba(163,188,202,.2)'; ctx.fillRect(x - cardW / 2 + 12, barY, cardW - 24, 3);
  if (cue.rearming) { ctx.fillStyle = color; ctx.fillRect(x - cardW / 2 + 12, barY, (cardW - 24) * cue.progress, 3); }
  ctx.restore();
  return true;
}

// Returns its bottom edge so an incoming-missile warning can stack below it.
export function drawBoundaryGuidance(ctx, cue, { width, height, top = 100, bottom = 12, reserveMissile = true, palette, time = 0, motionReduce = false }) {
  if (!cue) return null;
  const safeTop = Math.max(12, top), safeBottom = height - Math.max(12, bottom) - (reserveMissile ? 74 : 0);
  const available = safeBottom - safeTop;
  if (available < 48 || width < 48) return null;
  const compact = available < 66, cardH = compact ? 48 : 66;
  const cardW = Math.min(width - 24, 330), x = width / 2;
  const cardTop = clamp(height * .18 - 15, safeTop, safeBottom - cardH);
  const y = cardTop + (compact ? 12 : 15);
  ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(8,15,20,.82)'; ctx.fillRect(x - cardW / 2, cardTop, cardW, cardH);
  ctx.globalAlpha = motionReduce || Math.floor(time / 300) % 2 === 0 ? 1 : .7;
  text(ctx, 'RETURN TO BATTLE', x, y + 1, palette.warn, cardW - 18, compact ? 12 : 17, true);
  ctx.globalAlpha = 1;
  text(ctx, `HDG ${headingLabel(cue.heading)}° · ${formatCombatRange(cue.distanceM)} to safety`, x, y + (compact ? 16 : 21), '#fff1da', cardW - 18, compact ? 10 : 11);
  text(ctx, cue.penalty ? `HULL DRAIN · ${BOUNDARY_DPS} HP / SECOND` : `${Math.ceil(cue.remainingS)}s until hull damage`, x, y + (compact ? 30 : 40), '#fff1da', cardW - 18, compact ? 9 : 10);
  ctx.restore();
  return cardTop + cardH;
}
