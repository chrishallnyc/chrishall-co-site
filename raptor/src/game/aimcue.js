// Camera-space aim projection. An off-screen aim must never suppress the
// rest of the combat HUD, and a lost marker always has a visible way home.
export function projectAimCue({ x, y, z, width, height, fov = 60, top = 100, bottom = 100 }) {
  if (![x,y,z,width,height,fov].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const cx = width / 2, cy = height / 2;
  const scale = height / (2 * Math.tan(fov * Math.PI / 360));
  const depth = Math.max(Math.abs(z), .00001);
  let dx = x / depth * scale, dy = -y / depth * scale;
  const bounds = { left: Math.min(64, width * .15), right: width - Math.min(64, width * .15),
    top: Math.min(top, cy - 30), bottom: Math.max(height - bottom, cy + 30) };
  const px = cx + dx, py = cy + dy;
  const behind = z >= 0;
  if (!behind && px >= bounds.left && px <= bounds.right && py >= bounds.top && py <= bounds.bottom)
    return { x: px, y: py, edge: false, behind: false, angle: 0 };
  if (Math.abs(dx) + Math.abs(dy) < .001) { dx = 0; dy = 1; }
  const tx = dx > 0 ? (bounds.right - cx) / dx : dx < 0 ? (bounds.left - cx) / dx : Infinity;
  const ty = dy > 0 ? (bounds.bottom - cy) / dy : dy < 0 ? (bounds.top - cy) / dy : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t, edge: true, behind, angle: Math.atan2(dy, dx) };
}

export function drawAimCue(ctx, cue, recenterKey = 'R') {
  if (!cue) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = '#09151b'; ctx.lineWidth = 5; ctx.globalAlpha = .96;
  ctx.beginPath();
  if (cue.edge) {
    const c = Math.cos(cue.angle), s = Math.sin(cue.angle);
    ctx.moveTo(cue.x - c * 8 - s * 6, cue.y - s * 8 + c * 6);
    ctx.lineTo(cue.x + c * 5, cue.y + s * 5);
    ctx.lineTo(cue.x - c * 8 + s * 6, cue.y - s * 8 - c * 6);
  } else ctx.arc(cue.x, cue.y, 10, 0, Math.PI * 2);
  ctx.stroke(); ctx.strokeStyle = '#b8f2dd'; ctx.lineWidth = 1.8; ctx.stroke();
  if (cue.edge) {
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.textAlign = cue.x < ctx.canvas.width / (globalThis.devicePixelRatio || 1) / 2 ? 'left' : 'right';
    const label = `${cue.behind ? 'Aim behind' : 'Aim outside view'} · ${recenterKey} recenter`;
    ctx.lineWidth = 4; ctx.strokeStyle = '#09151b';
    const lx = cue.x + (ctx.textAlign === 'left' ? 14 : -14), ly = cue.y + 24;
    ctx.strokeText(label,lx,ly); ctx.fillStyle = '#e0f7ef'; ctx.fillText(label,lx,ly);
  } else {
    ctx.beginPath();ctx.arc(cue.x,cue.y,1.8,0,Math.PI*2);ctx.fillStyle='#b8f2dd';ctx.fill();
  }
  ctx.restore();
}
