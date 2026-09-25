# RAPTOR · Pixel Wing

A complete browser arcade game, built with native Canvas2D and Web Audio.
No installation, dependencies, build, account, or server-side state.

[Play Pixel Wing](https://raptor.chall.net/arcade/)

## Play

Choose **Take flight**. Clear Pacific Coast, Red Canyon, and Neon Harbor,
defeat each boss, and choose an upgrade between sectors. A winning flight
takes about four minutes. Cannons fire automatically; collect glowing supplies
for stronger weapons, armor repairs, and points. Consecutive kills build a
score multiplier. Damage resets the chain.

| Action | Keyboard | Pointer / touch | Standard gamepad |
| --- | --- | --- | --- |
| Fly | WASD or arrows | Drag in the arena | Left stick or D-pad |
| Missiles | Space | Missiles button | A or right trigger |
| Dodge | Shift | Dodge button | B or right bumper |
| Pause / resume | Escape or P | Pause / resume button | Start |

Use keyboard or pointer for menus. Missiles recharge in seven seconds;
dodges recharge in three. The bright point at the jet's center is its small
collision core. Dodge rolls grant brief invulnerability. **Relaxed** offers
eight armor segments and slower enemy bullets; **Arcade** starts with six.

The sound button remembers mute. Pause offers a reduced-effects toggle;
the initial choice follows `prefers-reduced-motion`. Switching tabs or leaving
the window pauses flight. Scores and preferences use the separate localStorage
key `raptor.arcade.v1`; unavailable storage does not prevent play.

## Run and verify

From the repository root:

```sh
python3 -m http.server 8193 --bind 127.0.0.1 --directory raptor
```

Open `http://localhost:8193/arcade/`.

```sh
node --test raptor/arcade/qa/*.test.mjs
RAPTOR_BASE_URL=http://127.0.0.1:8193/arcade/ node raptor/arcade/qa/browser.mjs
```

The browser suite uses an installed Playwright and Chrome. Set
`PLAYWRIGHT_MODULE` to an absolute Playwright module entry if it is outside
Node's normal resolution path. Set `RAPTOR_TEST_OUTPUT` for screenshots and
results; the default is `.context/arcade/qa/`. `HEADED=1` shows the browser.
Set `RAPTOR_FULL_FLIGHT=1` to add a full real-time campaign rehearsal on Relaxed:
the browser steers with pointer events, presses abilities, collects supplies,
and clicks earned upgrades. It captures all three bosses and the final result
without modifying simulation state or advancing the clock.

Native tests cover frame-rate independence, collision and damage grace,
cooldowns, real defeat, upgrades, boss patterns, entity limits, and a complete
campaign won using ordinary movement and abilities. Browser checks use real
keyboard, pointer, and touch events. Explicit upgrade/result fixtures exercise
the UI and persistence separately; only the optional full-flight rehearsal
claims an earned browser win.
Controller routing uses a simulated standard gamepad.

## Implementation

- `src/sim.js`: seeded, renderer-independent 120 Hz simulation. Authored waves,
  collision, scoring, bosses, pickups, abilities, upgrades, and run lifecycle.
- `src/art.js`: original code-drawn pixel sprites, cached scenery strips,
  parallax, shadows, weather, trails, projectiles, and explosions. Logical
  resolution is 640 × 400; the browser scales with nearest-neighbor sampling.
- `src/audio.js`: three original eight-bar arrangements and layered sound effects.
  Gesture-started Web Audio uses bounded voices and a look-ahead scheduler.
- `src/main.js`: DOM menus, HUD, persistence, input routing, pause, and RAF.
- `src/input.js`: coordinate mapping through portrait letterboxing and
  standard gamepad dead zones/button mapping.

`window.__PIXEL_RAPTOR` exposes read-only snapshots for diagnostics. The explicit
`?qa=1` URL additionally exposes mutable test state and simulation advancement.
This is a local single-player game with no shared leaderboard or trust boundary.
The arcade does not require WebGL/WebGPU or register its own service worker.
Neon Harbor is stylized fictional scenery, separate from Harbor Watch.

## Credits

Scenery, aircraft, effects, music, and sound synthesis are original code-native
artwork for Pixel Wing. The locally served **Silkscreen** font by Jason Kottke
is distributed under the SIL Open Font License; see
[`assets/FONT-LICENSE.txt`](assets/FONT-LICENSE.txt). Its source is the
[Google Fonts Silkscreen directory](https://github.com/google/fonts/tree/main/ofl/silkscreen).
