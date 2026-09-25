// A US MacBook keyboard drawn in physical units. Codes are KeyboardEvent.code,
// so a key's position is stable even when the operating-system layout changes.
// Fn/Globe and Touch ID belong to macOS; the browser cannot assign them.
export const KEYBOARD_BOUNDS = Object.freeze({ width: 15, height: 6 });

const NAMES = {
  Escape: ["esc", "Escape"], Backquote: ["`", "Backquote"],
  Minus: ["−", "Minus"], Equal: ["=", "Equals"],
  Backspace: ["delete", "Delete / Backspace"], Tab: ["tab", "Tab"],
  BracketLeft: ["[", "Left bracket"], BracketRight: ["]", "Right bracket"],
  Backslash: ["\\", "Backslash"], CapsLock: ["caps lock", "Caps Lock"],
  Semicolon: [";", "Semicolon"], Quote: ["'", "Quote"], Enter: ["return", "Return / Enter"],
  ShiftLeft: ["⇧", "Left Shift"], ShiftRight: ["⇧", "Right Shift"],
  Comma: [",", "Comma"], Period: [".", "Period"], Slash: ["/", "Slash"],
  Fn: ["fn", "Fn / Globe — controlled by macOS"],
  ControlLeft: ["⌃", "Left Control"], ControlRight: ["⌃", "Right Control"],
  AltLeft: ["⌥", "Left Option / Alt"], AltRight: ["⌥", "Right Option / Alt"],
  MetaLeft: ["⌘", "Left Command"], MetaRight: ["⌘", "Right Command"],
  Space: ["space", "Space"], TouchID: ["◉", "Touch ID / Power — controlled by macOS"],
  ArrowLeft: ["←", "Left arrow"], ArrowUp: ["↑", "Up arrow"],
  ArrowDown: ["↓", "Down arrow"], ArrowRight: ["→", "Right arrow"],
  Mouse0: ["Left click", "Left mouse button"], Mouse1: ["Middle", "Middle mouse button"],
  Mouse2: ["Right click", "Right mouse button"], Mouse3: ["Mouse 4", "Mouse button 4"],
  Mouse4: ["Mouse 5", "Mouse button 5"], WheelUp: ["Scroll ↑", "Mouse wheel up"],
  WheelDown: ["Scroll ↓", "Mouse wheel down"],
  NumpadAdd: ["Num +", "Number pad plus"], NumpadSubtract: ["Num −", "Number pad minus"],
  NumpadMultiply: ["Num ×", "Number pad multiply"], NumpadDivide: ["Num /", "Number pad divide"],
  NumpadDecimal: ["Num .", "Number pad decimal"], NumpadEnter: ["Num ↵", "Number pad Enter"],
};

function labels(code) {
  const fallback = code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ");
  return NAMES[code] || [fallback, fallback];
}

function key(code, x, y, width = 1, height = 1) {
  const [label, name] = labels(code);
  return Object.freeze({ code, label, name, x, y, width, height, bindable: code !== "Fn" && code !== "TouchID" });
}

function row(id, label, y, entries) {
  let x = 0;
  const keys = entries.map(entry => {
    const [code, width = 1] = Array.isArray(entry) ? entry : [entry];
    const descriptor = key(code, x, y, width);
    x += width;
    return descriptor;
  });
  return Object.freeze({ id, label, keys: Object.freeze(keys) });
}

export const KEYBOARD_ROWS = Object.freeze([
  row("function", "Function keys", 0, [["Escape", 1.5], ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`), ["TouchID", 1.5]]),
  row("number", "Number keys", 1, ["Backquote", ...[..."1234567890"].map(number => `Digit${number}`), "Minus", "Equal", ["Backspace", 2]]),
  row("top", "Top letter row", 2, [["Tab", 1.5], ...[..."QWERTYUIOP"].map(letter => `Key${letter}`), "BracketLeft", "BracketRight", ["Backslash", 1.5]]),
  row("home", "Home letter row", 3, [["CapsLock", 1.75], ...[..."ASDFGHJKL"].map(letter => `Key${letter}`), "Semicolon", "Quote", ["Enter", 2.25]]),
  row("lower", "Lower letter row", 4, [["ShiftLeft", 2.25], ...[..."ZXCVBNM"].map(letter => `Key${letter}`), "Comma", "Period", "Slash", ["ShiftRight", 2.75]]),
  Object.freeze({
    id: "bottom", label: "Modifiers, space and arrows", keys: Object.freeze([
      ...row("modifiers", "Modifiers", 5, ["Fn", "ControlLeft", "AltLeft", ["MetaLeft", 1.5], ["Space", 5], ["MetaRight", 1.5], "AltRight"]).keys,
      key("ArrowLeft", 12, 5.5, 1, .5), key("ArrowUp", 13, 5, 1, .5),
      key("ArrowDown", 13, 5.5, 1, .5), key("ArrowRight", 14, 5.5, 1, .5),
    ]),
  }),
]);

export const KEYBOARD_KEYS = Object.freeze(KEYBOARD_ROWS.flatMap(item => item.keys));
export const KEYBOARD_CODES = new Set(KEYBOARD_KEYS.map(item => item.code));
const BY_CODE = new Map(KEYBOARD_KEYS.map(item => [item.code, item]));

// Buttons 4 and 5 are included: a saved side-button binding must not disappear
// just because a MacBook trackpad has fewer physical inputs.
export const POINTER_KEYS = Object.freeze(["Mouse0", "Mouse1", "Mouse2", "Mouse3", "Mouse4", "WheelUp", "WheelDown"].map(code => {
  const [label, name] = labels(code);
  return Object.freeze({ code, label, name, bindable: true });
}));
const POINTER_BY_CODE = new Map(POINTER_KEYS.map(item => [item.code, item]));

export const CATEGORY_LABELS = Object.freeze({ flight: "Flying", weapons: "Weapons", systems: "Aircraft", interface: "Interface" });
export const ACTION_TOKENS = Object.freeze({
  throttle_up: "THR +", throttle_down: "THR −", roll_left: "BANK L", roll_right: "BANK R",
  pitch_up: "NOSE ↑", pitch_down: "NOSE ↓", yaw_left: "YAW L", yaw_right: "YAW R",
  fire_mguns: "CANNON", fire_aam: "MISSILE", gear: "GEAR", wheel_brakes: "BRAKE",
  menu: "PAUSE", game_pause: "PAUSE", help: "GUIDE", recenter_aim: "CENTER",
  hide_hud: "HUD", debug: "DETAILS",
});

/** Labels for physical keys, mouse inputs, or external-keyboard extras. */
export function keyDescriptor(code) {
  if (BY_CODE.has(code)) return BY_CODE.get(code);
  if (POINTER_BY_CODE.has(code)) return POINTER_BY_CODE.get(code);
  const [label, name] = labels(code);
  return { code, label, name, bindable: true, external: true };
}

/** Index every current binding by its final trigger, including modifier-only chords. */
export function bindingMap(actions) {
  const map = new Map();
  for (const [id, action] of Object.entries(actions)) {
    action.binds.forEach((chord, slot) => {
      const code = chord.at(-1);
      if (!map.has(code)) map.set(code, []);
      map.get(code).push({
        id, slot, chord: [...chord], label: action.label,
        category: Object.hasOwn(CATEGORY_LABELS, action.cat) ? action.cat : "interface",
        essential: !!action.essential, locked: !!action.lockedPrimary && slot === 0,
      });
    });
  }
  return map;
}

/**
 * Roving focus follows physical geometry. Arrow keys do not wrap to another
 * row at the board edge; previous/next provide an explicit linear traversal.
 * Passing a filtered set keeps navigation within currently rendered buttons.
 */
export function moveKeyboardFocus(code, direction, keys = KEYBOARD_KEYS) {
  const available = keys.filter(item => item.bindable !== false);
  if (!available.length) return null;
  const index = available.findIndex(item => item.code === code);
  if (direction === "home") return available[0].code;
  if (direction === "end") return available.at(-1).code;
  if (index < 0) return available[0].code;
  if (direction === "previous" || direction === "next") {
    const step = direction === "next" ? 1 : -1;
    return available[Math.max(0, Math.min(available.length - 1, index + step))].code;
  }
  if (!["left", "right", "up", "down"].includes(direction)) return code;

  const current = available[index];
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const cx = current.x + current.width / 2, cy = current.y + current.height / 2;
  const candidates = available.filter(item => item !== current).map(item => {
    const ix = item.x + item.width / 2, iy = item.y + item.height / 2;
    const primary = (horizontal ? ix - cx : iy - cy) * sign;
    const perpendicular = Math.abs(horizontal ? iy - cy : ix - cx);
    // Prefer a key in the same physical row/column. Wider keys naturally
    // overlap adjacent columns; the small centre penalty breaks ties toward
    // the closest staggered key instead of the first item in source order.
    const overlap = horizontal
      ? Math.min(current.y + current.height, item.y + item.height) - Math.max(current.y, item.y)
      : Math.min(current.x + current.width, item.x + item.width) - Math.max(current.x, item.x);
    return { item, primary, perpendicular, overlap };
  }).filter(({ item, primary }) => primary > 0.001 && (horizontal
    ? Math.abs(item.y - current.y) < .51
    : direction === "up" ? item.y + item.height <= current.y + .001 : item.y >= current.y + current.height - .001));
  if (!candidates.length) return code;

  // For vertical movement, choose the nearest physical row first. Otherwise
  // a perfectly aligned key two rows away could skip the intervening row.
  const nearestBand = Math.min(...candidates.map(item => item.primary));
  const band = horizontal ? candidates : candidates.filter(item => item.primary <= nearestBand + .26);
  band.sort((a, b) => horizontal
    ? a.primary - b.primary || a.perpendicular - b.perpendicular
    : (a.overlap > 0 ? 0 : 1) - (b.overlap > 0 ? 0 : 1)
      || a.perpendicular - b.perpendicular || a.primary - b.primary);
  return band[0].item.code;
}
