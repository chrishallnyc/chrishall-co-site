// Presentation-only combat cues. Pool reads never change targeting, guidance,
// weapon state or the simulation hash. Callers reuse the small output records.
const TAU = Math.PI * 2;
const FONT = 'ui-monospace, Menlo, monospace';
const HALO = 'rgba(0,10,14,.9)';
const SOLID = [];
const ACQUIRING = [4, 4];

// Ticket bars track both the toolbar and enlarged flight instruments. Their
// labels must reserve the same top edge, even when HUD scale dominates.
export function ticketBarTop(toolbarBottom = 0, hudScale = 1) {
  return Math.max(86, 70 * (hudScale || 1) + 12, (toolbarBottom || 0) + 9);
}

export function combatLabelTop(toolbarBottom = 0, hudScale = 1, hasTickets = false) {
  return hasTickets ? ticketBarTop(toolbarBottom, hudScale) + 24 : (toolbarBottom || 70) + 20;
}

export function targetKinematics(player, position, velocity, out = {}) {
  const dx = position[0] - player[0], dy = position[1] - player[1], dz = position[2] - player[2];
  const rangeM = Math.hypot(dx, dy, dz);
  const closingMs = rangeM > 0
    ? (dx * (player[7] - velocity[0]) + dy * (player[8] - velocity[1]) + dz * (player[9] - velocity[2])) / rangeM : 0;
  if (!Number.isFinite(rangeM) || !Number.isFinite(closingMs)) return null;
  out.rangeM = rangeM;
  out.closingMs = closingMs;
  return out;
}

// SAMs all target the player; bandit missiles may target surface units instead.
// Select the nearest actual player threat and report all incoming shots. No
// invented impact countdown: maneuvering missiles can miss or self-destruct.
export function nearestMissileThreat(player, battlefield, bandits, out = {}) {
  out.count = 0;
  out.rangeM = Infinity;
  for (let pool = 0; pool < 2; pool++) {
    const live = pool === 0 ? battlefield?.samLive : bandits?.mLive;
    const values = pool === 0 ? battlefield?.sam : bandits?.msl;
    if (!live || !values) continue;
    const stride = pool === 0 ? 11 : 12;
    for (let slot = 0; slot < live.length; slot++) {
      const offset = slot * stride;
      if (!live[slot] || (pool === 1 && values[offset + 11] !== -2)) continue;
      const dx = values[offset] - player[0], dy = values[offset + 1] - player[1], dz = values[offset + 2] - player[2];
      const rangeM = Math.hypot(dx, dy, dz);
      if (!Number.isFinite(rangeM)) continue;
      out.count++;
      if (rangeM >= out.rangeM) continue;
      out.rangeM = rangeM;
      out.dx = dx; out.dy = dy; out.dz = dz;
    }
  }
  if (!out.count) return null;
  // ENU heading increases toward north. Clock bearing increases toward the
  // pilot's right, so a south-side missile while eastbound is at 3 o'clock.
  const qw = player[3], qx = player[4], qy = player[5], qz = player[6];
  let fx = 1 - 2 * (qy * qy + qz * qz), fy = 2 * (qx * qy + qw * qz);
  const horizontalNose = Math.hypot(fx, fy);
  if (!Number.isFinite(horizontalNose) || horizontalNose < .001) { fx = player[7]; fy = player[8]; }
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) { fx = 1; fy = 0; }
  const heading = Math.atan2(fy, fx);
  const bearing = heading - Math.atan2(out.dy, out.dx);
  out.bearing = ((bearing % TAU) + TAU) % TAU;
  out.clock = Math.round(out.bearing * 6 / Math.PI) % 12 || 12;
  out.vertical = Math.hypot(out.dx, out.dy) < 1 ? (out.dz < 0 ? 'BELOW' : 'ABOVE') : null;
  return out;
}

export function formatCombatRange(rangeM) {
  return rangeM < 1000 ? `${Math.max(0, Math.round(rangeM / 10) * 10)} M` : `${(rangeM / 1000).toFixed(1)} KM`;
}

function text(ctx, message, x, y, color, width) {
  // Labels follow their target while staying readable at either screen edge.
  const maxWidth = Math.max(1, width - 24);
  const half = Math.min(maxWidth, ctx.measureText(message).width) / 2;
  const anchor = Math.max(half + 12, Math.min(width - half - 12, x));
  ctx.lineWidth = 3.5; ctx.strokeStyle = HALO;
  ctx.strokeText(message, anchor, y, maxWidth);
  ctx.fillStyle = color;
  ctx.fillText(message, anchor, y, maxWidth);
}

export function drawSeekerCue(ctx, {
  x, y, width, height, rangeM, closingMs, locked, progress = 0, ammo,
  friendly = false, ace = false, launchKey = 'Space', showHints = true, palette,
  top = 100, bottom = 100,
}) {
  // The caller keeps the ordinary contact diamond when a complete seeker
  // marker cannot fit. Returning false must never suppress that edge cue.
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 16 || x > width - 16 || y < 16 || y > height - 16) return false;
  const color = friendly ? palette.friendly : ammo <= 0 ? palette.warn : locked ? palette.lock : palette.good;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.setLineDash(locked ? SOLID : ACQUIRING);
  ctx.strokeStyle = HALO; ctx.lineWidth = 4;
  ctx.strokeRect(x - 14, y - 14, 28, 28);
  ctx.strokeStyle = color; ctx.lineWidth = locked ? 2 : 1.5;
  ctx.strokeRect(x - 14, y - 14, 28, 28);
  ctx.setLineDash(SOLID);

  // Keep the marker centered on the aircraft; move only its labels when a
  // target approaches the toolbar or bottom status. A selected bandit's old
  // range label is suppressed by the caller, so this is the only readout.
  const below = y - 28 < top;
  const above = !below && y + 48 > height - bottom;
  let statusY = below ? Math.max(y + 30, top + 14) : above ? Math.min(y - 62, height - bottom - 48) : y - 25;
  let rangeY = below || above ? statusY + 16 : y + 30;
  let actionY = rangeY + 16;
  const safeTop = Math.max(14, Math.min(top + 14, height - 14));
  const safeBottom = Math.max(safeTop, Math.min(height - 14, height - bottom));
  const showRange = safeBottom - safeTop >= 16;
  const showAction = safeBottom - safeTop >= 32 && (friendly || (showHints && ammo > 0));
  // Short windows may need the entire label block moved together. When the
  // toolbar leaves less than three lines, keep status and range and omit the
  // optional hint; a friendly warning stays explicit in the status itself.
  const finalY = showAction ? actionY : showRange ? rangeY : statusY;
  if (statusY < safeTop || finalY > safeBottom) {
    const blockHeight = (Number(showRange) + Number(showAction)) * 16;
    statusY = Math.max(safeTop, Math.min(safeBottom - blockHeight, statusY));
    rangeY = statusY + 16; actionY = rangeY + 16;
  }
  ctx.font = `bold 11px ${FONT}`;
  const status = friendly ? (showAction ? 'FRIENDLY' : 'FRIENDLY · HOLD FIRE') : ammo <= 0 ? 'NO MISSILES' : locked ? 'LOCK' : 'ACQUIRING';
  text(ctx, ace ? `★ ${status}` : status, x, statusY, color, width);

  if (!locked && ammo > 0 && !friendly) {
    const fraction = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    ctx.fillStyle = HALO; ctx.fillRect(x - 16, y + 16, 32, 5);
    ctx.fillStyle = color; ctx.fillRect(x - 15, y + 17, 30 * fraction, 3);
  }
  ctx.font = `10px ${FONT}`;
  const closureKt = Math.round(Math.abs(closingMs) * 1.94384 / 10) * 10;
  const closure = closureKt < 10 ? 'RANGE STEADY' : `${closingMs > 0 ? 'CLOSING' : 'OPENING'} ${closureKt} KT`;
  if (showRange) text(ctx, `${formatCombatRange(rangeM)} · ${closure}`, x, rangeY, '#e1ece6', width);
  if (showAction && friendly) text(ctx, 'HOLD FIRE', x, actionY, color, width);
  else if (showAction) {
    const action = !locked ? 'Keep target ahead' : launchKey === 'Unassigned' ? 'Assign a missile key in Controls' : `${launchKey} · launch missile`;
    text(ctx, action, x, actionY, color, width);
  }
  ctx.restore();
  return true;
}

export function drawMissileWarning(ctx, threat, {
  width, height, color, time = 0, motionReduce = false, top = 100,
}) {
  if (!threat) return;
  const cx = width / 2, y = Math.max(top + 32, height * .3);
  const title = threat.count > 1 ? `MISSILES ×${threat.count}` : 'MISSILE';
  const direction = threat.vertical || `${threat.clock} O'CLOCK`;
  const detail = `${direction} · ${formatCombatRange(threat.rangeM)} · BREAK TURN`;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `11px ${FONT}`;
  const plateWidth = Math.min(width - 24, Math.max(280, ctx.measureText(detail).width + 28));
  ctx.fillStyle = 'rgba(8,15,20,.76)';
  ctx.fillRect(cx - plateWidth / 2, y - 34, plateWidth, 68);
  ctx.fillStyle = color; ctx.fillRect(cx - plateWidth / 2, y - 34, 3, 68);
  ctx.font = `bold 25px ${FONT}`;
  ctx.globalAlpha = motionReduce || Math.floor(time / 250) % 2 === 0 ? 1 : .65;
  text(ctx, title, cx + 15, y - 3, color, width);
  ctx.globalAlpha = 1;
  ctx.font = `11px ${FONT}`;
  text(ctx, detail, cx, y + 21, '#fff1da', width);

  // Compact aircraft-relative bearing dial: nose at the top, threat points
  // outward. Text repeats the direction, so color is never the only cue.
  const dx = cx - (threat.count > 1 ? 108 : 86), dy = y - 13, radius = 12;
  ctx.strokeStyle = color; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.arc(dx, dy, radius, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(dx, dy - radius - 5); ctx.lineTo(dx, dy - radius + 3); ctx.stroke();
  if (!threat.vertical) {
    const sx = Math.sin(threat.bearing), sy = -Math.cos(threat.bearing);
    ctx.beginPath(); ctx.moveTo(dx - sx * 3, dy - sy * 3);
    ctx.lineTo(dx + sx * 9, dy + sy * 9);
    ctx.lineTo(dx + sx * 4 - sy * 4, dy + sy * 4 + sx * 4);
    ctx.moveTo(dx + sx * 9, dy + sy * 9);
    ctx.lineTo(dx + sx * 4 + sy * 4, dy + sy * 4 - sx * 4);
    ctx.stroke();
  }
  ctx.restore();
}

// A range/cone explanation for an existing hostile diamond, not a seeker box
// or launch command. Keep its ordinary range/ace markers unobscured.
export function drawMissileEnvelopeCue(ctx, cue, {
  x, y, width, height, limits, gunAmmo = 0, showHints = true, palette, top = 100, bottom = 100,
}) {
  if (!cue || !Number.isFinite(x) || !Number.isFinite(y) || x < 16 || x > width - 16 || y < 16 || y > height - 16) return false;
  const safeTop = Math.max(14, top + 12), safeBottom = Math.min(height - 14, height - bottom);
  const lineHeight = showHints ? 14 : 0;
  let labelY = y - 48;
  if (labelY < safeTop) labelY = y + 43;
  if (labelY < safeTop || labelY + lineHeight > safeBottom) return false;
  const status = cue.reason === 'far' ? 'MISSILE · OUT OF RANGE' : cue.reason === 'near' ? 'MISSILE · TOO CLOSE'
    : cue.reason === 'off-axis' ? 'MISSILE · OUTSIDE SEEKER' : 'MISSILE · HOLD TARGET AHEAD';
  const action = cue.reason === 'far' ? `Close within ${formatCombatRange(limits.max)}`
    : cue.reason === 'near' ? `${gunAmmo > 0 ? 'Use cannon, or open' : 'Open range'} to ${formatCombatRange(limits.min)}`
      : cue.reason === 'off-axis' ? 'Turn toward the target' : 'Keep steady for acquisition';
  ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 11px ${FONT}`;
  text(ctx, status, x, labelY, palette.lock, width);
  if (showHints) {
    ctx.font = `10px ${FONT}`;
    text(ctx, action, x, labelY + 14, '#e1ece6', width);
  }
  ctx.restore();
  return true;
}
