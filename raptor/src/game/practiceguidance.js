// Practice guidance reads current telemetry only. A descent projection uses
// clearance over the ground below the aircraft; it is not a terrain radar.
const finiteFlight = t => t && ['speedKt', 'roll', 'pitch'].every(key => Number.isFinite(t[key]));
const headingDelta = (target, current) => ((target - current) % 360 + 540) % 360 - 180;
const cue = (id, tone, title, feedback) => ({ id, tone, title, feedback });

// Lessons and urgent guidance share this boundary, so a dangerous descent
// cannot earn a steady-flight hold while the coach is asking for recovery.
export function practiceTerrainRisk(telemetry) {
  if (!Number.isFinite(telemetry?.aglFt)) return false;
  const vertical = Number.isFinite(telemetry.verticalSpeedFpm) ? telemetry.verticalSpeedFpm : 0;
  return telemetry.aglFt <= 300 || (vertical < -600 && telemetry.aglFt + vertical / 60 * 6 <= 300);
}

// The model's lift curve peaks near 35 degrees and then falls gradually.
// This is a recovery cue for basic flight, not a declaration of a hard stall:
// the aircraft remains controllable at higher angles of attack.
export function practiceHighAlpha(telemetry) {
  return Number.isFinite(telemetry?.aoa) && telemetry.aoa >= 35;
}

// Commanded gear and its four-second actuator travel are distinct. Keep this
// separate from safety/lesson advice, and never suggest retracting near the
// ground or while another recovery needs the pilot's attention.
export function practiceGearGuidance(telemetry) {
  const position = telemetry?.gearPosition;
  if (typeof telemetry?.gearDown !== 'boolean' || !Number.isFinite(position) || position < 0 || position > 1) return null;
  if (!telemetry.gearDown && position <= .001) return null;
  if (!telemetry.gearDown) return { id: 'gear-retracting', title: 'Gear retracting', retract: false };
  return {
    id: position < .999 ? 'gear-extending' : 'gear-down',
    title: position < .999 ? 'Gear extending' : 'Gear down',
    retract: telemetry.aglFt >= 900 && telemetry.speedKt >= 190 && !practiceTerrainRisk(telemetry) && !practiceHighAlpha(telemetry),
  };
}

export function practiceGuidance(telemetry, lesson = {}) {
  if (!finiteFlight(telemetry)) return null;
  const t = telemetry;
  const clearance = Number.isFinite(t.aglFt) ? t.aglFt : Infinity;
  const vertical = Number.isFinite(t.verticalSpeedFpm) ? t.verticalSpeedFpm : 0;
  const descending = vertical < -600;
  const low = t.speedKt < 150;
  // Prioritize terrain over stall advice: pointing down while already low is
  // the wrong first instruction, even if more than one condition is present.
  if (practiceTerrainRisk(t)) {
    return cue('terrain', 'danger', 'Climb away from terrain', low
      ? 'Low and slow. Add power, level the wings, and reset if you need room.'
      : 'Level the wings and climb. Reset to level flight if you need room.');
  }
  if (low && clearance < 900) {
    return cue('low-slow', 'danger', 'Low and slow', 'Add power and level the wings. Reset to level flight if you need more room.');
  }
  if (practiceHighAlpha(t)) {
    if (clearance < 900) return cue('high-alpha-low', 'danger', 'Make room to recover', 'The nose is far above your flight path. Add power and level the wings. Reset to level flight if you need more room.');
    return { ...cue('high-alpha', 'danger', 'Ease the pull', 'Release pitch-up and center aim on your flight path. Add power and regain speed before climbing.'), action: 'recenter_aim' };
  }
  if (low) return cue('airspeed', 'danger', 'Build airspeed', 'Low airspeed. Add power and ease the nose toward the horizon.');
  if (descending && clearance + vertical / 60 * 12 <= 300) {
    return cue('descent', 'caution', 'Check your descent', 'You are descending toward the ground. Level the wings and ease into a climb.');
  }
  if (Math.abs(t.roll) >= 70) return cue('bank', 'caution', 'Level the wings', 'Ease the bank before pulling into a climb. Reset if you lose the horizon.');
  if (t.speedKt < 190) return cue('slow', 'caution', 'Airspeed is low', 'Add a little power and keep turns gentle.');

  if (lesson.status === 'active') {
    if (lesson.inTarget) return cue('on-target', 'normal', 'On target', 'On target. Hold steady');
    let feedback;
    if (lesson.id === 'throttle' || lesson.id === 'cruise') {
      const lowPower = lesson.id === 'throttle' ? 60 : 80;
      const highPower = lesson.id === 'throttle' ? 70 : 95;
      feedback = t.throttle > highPower ? 'Ease off the throttle' : t.throttle < lowPower ? 'Add a little power'
        : Math.abs(t.roll) > (lesson.id === 'throttle' ? 20 : 12) ? 'Ease the bank; aim near the horizon'
        : Math.abs(t.pitch) > (lesson.id === 'throttle' ? 12 : 7) ? 'Bring the nose near the horizon' : 'Settle the aircraft';
    } else if (lesson.id === 'turn') {
      const difference = headingDelta(lesson.targetHeading, t.heading);
      feedback = Math.abs(difference) > 7 ? `${Math.abs(Math.round(difference))}° ${difference > 0 ? 'right' : 'left'} to target` : 'Ease the bank and settle';
    } else if (lesson.id === 'climb') {
      const difference = lesson.targetAltitude - t.altFt;
      const approaching = difference * vertical > 0 && Math.abs(vertical) > 300 && Math.abs(difference) <= Math.abs(vertical) / 60 * 6;
      feedback = approaching ? 'Start leveling off; your target altitude is approaching'
        : Math.abs(difference) <= 140 && Math.abs(vertical) > 900 ? 'Ease toward level and let your vertical speed settle'
        : difference > 140 ? 'Raise the nose gently' : difference < -140 ? 'Lower the nose gently' : 'At your altitude. Level off';
    } else feedback = Math.abs(t.roll) > 12 ? 'Ease the bank; aim near the horizon' : 'Bring the nose near the horizon';
    return cue('exercise', 'normal', 'Your next correction', feedback);
  }
  if (vertical > 300) return cue('climbing', 'normal', 'Climbing', 'Ease your aim toward the horizon when you reach your altitude.');
  if (vertical < -300) return cue('descending', 'normal', 'Descending', 'Watch your height above the ground as you descend.');
  if (Math.abs(t.roll) > 20) return cue('turning', 'normal', 'Turning', 'Bring your aim near the horizon as you reach your heading.');
  return cue('steady', 'normal', 'Steady flight', 'Your airspace is clear. Explore at your own pace.');
}
