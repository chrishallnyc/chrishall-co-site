// Shape is shared across tiers; only curve sampling and subpixel detail vary.
// LOW/MED quality must cap geometry before the first frame, independently of
// the screen-size selector. These are deliberately not simulation settings.
export const F22_LEVELS = Object.freeze(['high', 'medium', 'low']);
export const F22_GEOMETRY_QUALITY = Object.freeze({
  high: Object.freeze({ longitudinal:120, transverse:22, nose:28, cockpit:72,
    canopyU:36, canopyV:72, frame:64, wing:20, chord:18, tail:18,
    fin:9, finChord:14, control:10, boomUpper:9, boomLower:8 }),
  medium: Object.freeze({ longitudinal:54, transverse:12, nose:18, cockpit:36,
    canopyU:20, canopyV:36, frame:32, wing:10, chord:10, tail:10,
    fin:6, finChord:8, control:4, boomUpper:6, boomLower:5 }),
  low: Object.freeze({ longitudinal:26, transverse:6, nose:12, cockpit:20,
    canopyU:12, canopyV:20, frame:20, wing:5, chord:6, tail:5,
    fin:3, finChord:5, control:2, boomUpper:4, boomLower:3 }),
});

export function f22Quality(value = 'high') {
  const key = String(value).toLowerCase();
  return key === 'med' ? 'medium' : F22_LEVELS.includes(key) ? key : 'high';
}
