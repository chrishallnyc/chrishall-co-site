# RAPTOR · Pixel Wing

A complete browser arcade game, built with native Canvas2D and Web Audio.
No installation, dependencies, build, account, or server-side state.

[Play Pixel Wing](https://raptor.chall.net/arcade/) · [Four Cities artwork](https://raptor.chall.net/artwork/four-cities/)

The **Four-city artwork** link in the game header opens ten concept boards for
New York City, San Francisco, Austin, and Washington, DC, plus the shared art
kit. The playable campaign visits all four cities with its own code-drawn
landmarks, aircraft, effects, and bosses. The
[artwork README](../artwork/four-cities/README.md) covers viewing, PNG downloads,
portable gallery packaging, and its separate browser checks.

## Play

| City | Landmarks along the route | Boss |
| --- | --- | --- |
| [New York City](https://raptor.chall.net/arcade/?city=new-york) | Statue of Liberty, World Trade Center, Midtown, Central Park | Harbor Warden |
| [San Francisco](https://raptor.chall.net/arcade/?city=san-francisco) | Alcatraz, Ferry Building, Transamerica Pyramid, Golden Gate Bridge | Fog Phantom |
| [Austin, Texas](https://raptor.chall.net/arcade/?city=austin) | Congress Avenue Bridge, bats, Frost Bank Tower, Texas Capitol | Copper Viper |
| [Washington, DC](https://raptor.chall.net/arcade/?city=washington-dc) | Tidal Basin, Lincoln Memorial, Reflecting Pool, Washington Monument, Capitol | Capital Sentinel |

Choose **Campaign → Start campaign** to fly New York City, San Francisco,
Austin, and Washington, DC in order. Defeat four bosses and choose an upgrade
after each of the first three cities. A winning flight takes about five minutes.
Or select any city and choose **Fly** to launch a standalone mission with a
fully armed jet, extra armor, and its own score record; each takes about a minute
plus the boss fight. Retry keeps the selected mission. Cannons fire automatically;
collect glowing supplies for stronger weapons, armor repairs, and points.
Consecutive kills build a score multiplier. Damage resets the chain.

| Action | Keyboard | Pointer / touch | Standard gamepad |
| --- | --- | --- | --- |
| Fly | WASD or arrows | Drag in the arena | Left stick or D-pad |
| Missiles | Space | Missiles button | A or right trigger |
| Dodge | Shift | Dodge button | B or right bumper |
| Pause / resume | Escape or P | Pause / resume button | Start |

Use keyboard or pointer for menus. Campaign missiles initially recharge in
seven seconds (about 5.4 seconds in city missions); dodges recharge in three.
The bright point at the jet's center is its small collision core. Dodge rolls
grant brief invulnerability. **Relaxed** offers
eight armor segments and slower enemy bullets; **Arcade** starts with six.
Standalone city missions add two armor segments on either difficulty.

The sound button remembers mute. Pause offers a reduced-effects toggle;
the initial choice follows `prefers-reduced-motion`. Switching tabs or leaving
the window pauses flight. Scores and preferences use the separate localStorage
key `raptor.arcade.v1`; unavailable storage does not prevent play. Campaign and
each city have separate best scores. The previous three-region best remains
preserved in storage; the new campaign begins a fresh record.

## Run and verify

From the website project directory (`projects/chrishall-co-site` in the monorepo):

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
and clicks earned upgrades. It captures all four bosses and the final result
without modifying simulation state or advancing the clock.

Native tests cover frame-rate independence, collision and damage grace,
cooldowns, real defeat, upgrades, boss patterns, entity limits, and an Arcade
campaign won using ordinary movement and abilities. All four standalone cities
are also won with ordinary controls on both difficulty settings. Camera tests
cover route progression and the held boss vista. Browser checks use real
keyboard, pointer, and touch events. Explicit upgrade/result fixtures exercise
the UI and persistence separately; only the optional full-flight rehearsal
claims an earned browser win.
Controller routing uses a simulated standard gamepad.

## Implementation

- `src/sim.js`: seeded, renderer-independent 120 Hz simulation. Authored waves,
  collision, scoring, bosses, pickups, abilities, upgrades, and run lifecycle.
- `src/city-scenes.js`: authored 2048-pixel scenery strips for San Francisco,
  Austin, and Washington, DC, plus shared city identifiers, attract vistas, and
  a camera that traverses each route once before holding the final boss scene.
- `src/art.js`: New York City's scenery strip, original code-drawn pixel sprites,
  cached city scenery, parallax, shadows, weather, trails, projectiles, and
  explosions. Logical resolution is 640 × 400; the browser scales with
  nearest-neighbor sampling.
- `src/audio.js`: four original eight-bar arrangements and layered sound effects.
  Gesture-started Web Audio uses bounded voices and a look-ahead scheduler.
- `src/main.js`: DOM menus, HUD, persistence, input routing, pause, and RAF.
- `src/input.js`: coordinate mapping through portrait letterboxing and
  standard gamepad dead zones/button mapping.

`window.__PIXEL_RAPTOR` exposes read-only snapshots for diagnostics. The explicit
`?qa=1` URL additionally exposes mutable test state and simulation advancement.
This is a local single-player game with no shared leaderboard or trust boundary.
The arcade does not require WebGL/WebGPU or register its own service worker.
City routes compress geography for the arcade perspective. Pixel Wing remains
a separate game from the 3D simulator and its Harbor Watch scenario.

## Credits

Scenery, aircraft, effects, music, and sound synthesis are original code-native
artwork for Pixel Wing. The locally served **Silkscreen** font by Jason Kottke
is distributed under the SIL Open Font License; see
[`assets/FONT-LICENSE.txt`](assets/FONT-LICENSE.txt). Its source is the
[Google Fonts Silkscreen directory](https://github.com/google/fonts/tree/main/ofl/silkscreen).
