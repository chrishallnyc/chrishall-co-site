// Pointer coordinates stay correct when the phone layout adds space for HUD
// and touch buttons above/below the undistorted 640×400 flight arena.
export function canvasPoint(clientX, clientY, rect, width = 640, height = 400) {
  const scale = Math.min(rect.width / width, rect.height / height);
  if (!(scale > 0)) return { x: width / 2, y: height * .8 };
  return {
    x: (clientX - rect.left - (rect.width - width * scale) / 2) / scale,
    y: (clientY - rect.top - (rect.height - height * scale) / 2) / scale,
  };
}

export function stick(value = 0) {
  if (!Number.isFinite(value) || Math.abs(value) < .15) return 0;
  return Math.sign(value) * Math.min(1, (Math.abs(value) - .15) / .85);
}

export function readController(pad) {
  if (!pad || pad.connected === false) return { x: 0, y: 0, missile: false, roll: false, pause: false };
  const pressed = index => !!pad.buttons?.[index]?.pressed;
  return {
    x: pressed(14) ? -1 : pressed(15) ? 1 : stick(pad.axes?.[0]),
    y: pressed(12) ? -1 : pressed(13) ? 1 : stick(pad.axes?.[1]),
    missile: pressed(0) || pressed(7), roll: pressed(1) || pressed(5), pause: pressed(9),
  };
}
