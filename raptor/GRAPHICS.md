# Graphics

RAPTOR renders from native ES modules with the pinned Three distribution in
`vendor/`. Serve `raptor/` as the document root; assets use absolute `/assets/`
paths. WebGPU supplies volumetric clouds, temporal antialiasing, bloom, and
spectral water. WebGL2 retains physical atmosphere, lit cloud cards, material
detail, the Moon and stars, and Gerstner water.

## Coordinate and lighting contracts

Simulation, geographic data, weather, waves, and collision queries use local
metres: X east, Y up, Z north. `planetcurvature.js` bends render positions around
a shared moving observer at a 6,360 km radius. Terrain, water, objects, cloud
sampling, shadows, motion vectors, and HUD projections must use that same frame.
Previous-frame transforms retain the previous origin. Do not bend simulation
positions or feed curved coordinates into a geographic texture.

`daycycle.js` owns the shared Sun/Moon directions, irradiance, and night exposure
gain. `hillaire.js` and `sky-radiance.js` provide atmosphere transport for the sky,
surfaces, clouds, and reflection probes. Surface aerial perspective applies once
to completed lighting. Direct cloud shadows must not multiply ambient lighting
or darken receivers above the cloud layer.

Cloud lighting samples incident Sun and Moon illumination at each scattering
point, including local planet visibility and atmosphere attenuation. Its default
omission bound can skip an imperceptible source column; `cloudtransport=strict`
retains both. Reflection probes freeze their observer, time, and lighting inputs
for an entire cube update. Their sky excludes celestial discs because direct
surface lighting supplies those glints separately.

## Resolution and temporal rendering

Standard cloud noise is 128³ base plus 64³ detail; Ultra is 256³ plus 128³. Both
sample the same seeded physical fields. Ultra increases spatial sampling density
without enlarging cloud cells or moving the weather planes. Compressed local
assets are dimension-checked and verified against decoded SHA-256 hashes. Failed
Ultra loads fall back to standard assets, then a standard CPU bake.

The billboard fallback joins tropical tower puffs into overlapping columns,
uses a shared height gradient, and omits interior cap planes. Dense tower cores
have greater optical depth to reduce background showing through, while soft rims
and distance/view fades remain unchanged. Ordinary puffs, coverage shadows and
wind motion retain their existing behavior. These remain soft card approximations;
they do not provide volumetric cloud detail or occlusion.

`CloudPass` composes full-resolution color, cloud-aware depth, and motion in one
march. `AdaptiveCloudPass` can integrate a smaller layer and reconstruct compatible
pixels, while evaluating the exact full-resolution march at rejected edges and
occluders. Scale 1 bypasses the smaller layer. Native is currently the default;
the adaptive mode remains available for measured image comparisons.

`TemporalResolveNode` retains the pinned TRAA lifecycle and resets from the current
image on camera cuts, lens changes, resize, and time changes. Render-only wave and
cloud clocks are independent of simulation timescale. Pausing the simulation
alone is insufficient for matched graphics screenshots.

WebGPU uses reversed float depth by default to preserve precision at distant
terrain, water, and cloud intersections. Temporal motion selection compares raw
reversed depths before converting them to the pinned resolver's convention.
WebGL uses logarithmic depth to reduce distant coast and sea-floor conflicts;
`logdepth=0` restores ordinary forward depth. Native depth24/4× comparisons
reduced the measured coast's conservative mixed-pixel count from 315 to 5,
with no retained-terrain loss. Those five MSAA edge pixels remain a documented
limit, rather than an exact-visibility guarantee. The quality profile includes
a rendering policy version so older measurements are not reused after defaults change.

The exposure meter samples an already-rendered HDR texture into a 16² target and
allows one asynchronous read at a time. It handles padded WebGPU rows, rejects
stale results after cuts, and falls back to the atmosphere's exposure palette on
failure. Never replace this with a canvas read in the animation loop.

Water uses filtered slope moments so unresolved waves become roughness instead
of shimmering highlights. Its fine spectral cascade supplies sub-metre surface
detail. Near and far meshes share an exact boundary; overlapping ocean surfaces
lose depth precision at flight distances even when they share a material.

Terrain decodes packed height texels before interpolation, matching its CPU
collision field. Nearby HIGH/ULTRA terrain uses a stitched grid with about 8 m
spacing, morphing from the coarse parent triangles. Quality changes fade that
detail over 0.3 seconds and retain the actual previous surface for motion
vectors. LOW/MED use coarse geometry; the shared fine grid is allocated only
when a nearby draw needs it.

Auto selects a fixed asset class from the device heuristic before loading.
After loading, its cached render tier is matched against the actual source,
imagery, water and cloud assets. Live quality changes affect rendering while
the geographic field and water allocation stay fixed. Manual tiers select
their asset class on reload; the controls indicate when a reload is needed.

Valdez WebGPU HIGH/ULTRA assets include a central 16 km square of real 5 m USGS
IfSAR elevations and normals derived from those heights. Both decoded payloads
are hash-checked before use. A 512 m collar joins the original field, and load
failure retains the original terrain. This adds geographic relief in that
region; it does not increase the photographic imagery's resolution.

## Assets

- `bakery/bake_cloud_noise.mjs`: deterministic standard/Ultra noise assets.
- `bakery/bake_cirrus.mjs`: 2048² optical-density atlas of broken cirrus veils
  and irregular fallstreaks; source notes are in `assets/clouds/ASSET-CREDITS.md`.
- `bakery/bake_terrain_source.py`: reproducible central Valdez height/normal
  pair, with source request, hashes and credits in `assets/terrain/source/`.
- `assets/sky/ASSET-CREDITS.md`: lunar map source and attribution.
- `assets/sky/BRIGHT-STARS-CREDITS.md`: NASA bright-star catalog, source query,
  redistribution declaration, hashes, and reproducible baker instructions.

The star catalog supplies measured positions, visual magnitudes, colors, and
proper motions. A seeded field remains available if the local asset fails.
Terrain material relief supplements the existing geographic imagery and DEM;
it does not reconstruct geographic features absent from those source assets.

## Afterburner rendering

Each nozzle carries an axis-constrained plume ribbon and a fixed rectangular
aperture matching the aircraft rig. The effect uses a shared 512×256 procedural
RGBA8 atlas with ten supplied energy-aware mips: filtering preserves emitted
RGB times alpha and accounts for alpha quantization. Both nozzles together use
four draws/eight triangles and 699,052 bytes of texture data; there are no network
images or extra screen passes. Per-FlightFX resources are released by the
idempotent disposeAfterburner() method.

Throttle spool, length response, nozzle hierarchy and simulation remain
unchanged. Stable object transforms retain the existing planet-bending and
motion-vector path. Disabled effects have zero opacity and hidden meshes.
The colors and compression cells are visual approximations, not measured F119
radiometry or fluid simulation.

Matched native WebGPU comparisons cover night chase, daylight rear/side,
qualified front occlusion, and 360-frame day/night sequences with axis crossing,
roll, thrust vectoring and spool-down. Source controls, temporal cuts and sampled
disabled color/motion fields agree. Offline material graphs cover both APIs.
A centered distant static pixel proves nonzero terminal-mip emission; the moving
subpixel fixture is unresolved, so stable visible emission at every distance
is not established. Packed terminal mips also do not prove per-region angular
energy conservation.

## Reproducible comparisons

Use a fixed front, parked pose, time of day, manual quality tier, canvas size,
and exposure. For example:

```text
/?front=MARIANAS&camx=7680&camz=13824&camh=2800&yaw=218&pitch=-8&tod=15.5&hud=0&audio=0&nobattle=1&autoexp=0
```

`camh` is height above the local terrain, so record the actual camera position.
Check both a stationary view and motion before accepting a detail change.
Read `__RAPTOR.cloudNoise`, `cloudRendering`, `depthMode`, `fineOcean`, and `meter`
to confirm the path that actually loaded. `bootAssetTier`, `bootAssetRequest`
and `bootAssets` distinguish requested assets, loaded assets and live quality.
For scenery-only comparisons, hide and restore the player jet explicitly:
`nobattle=1` still creates it, and its position can change during boot.

Useful comparison flags:

| Flag | Purpose |
| --- | --- |
| `gl=1` | Force WebGL2. |
| `cloudmode=native\|adaptive` | Select the cloud compositor at boot. |
| `cloudscale=.5` through `1` | Override the adaptive integration scale. |
| `cloudnoise=standard\|ultra` | Select noise assets independently of output size. |
| `cloudtransport=legacy\|strict\|toa` | Compare fitted lighting, unomitted calibrated sources, or uncalibrated sources. |
| `reversedepth=0` | Compare forward depth with the WebGPU reversed-depth default. |
| `logdepth=0` | Restore ordinary forward depth on WebGL2. WebGPU is unchanged. |
| `rawtaa=0` | Compare native temporal depth selection with the raw-depth default. |
| `curvature=0` | Compare the legacy flat render frame. |
| `terrainnear=0` | Disable the near terrain grid at every quality tier. |
| `terrainsource=0\|16` | Compare original and central 5 m Valdez elevation data. |
| `snowdetail=0` | Disable added wind-packed snow material relief. |
| `waterfine=0\|128\|256` | Compare the fine water cascade. |
| `ocean=gerstner` | Use the non-compute water fallback. |
| `atmo=preetham` | Compare the lightweight atmosphere fallback. |
| `vclouds=0` | Use cloud cards while retaining post processing. |
| `post=0` | Disable the WebGPU post chain. |
| `ao=1` / `flare=1` | Opt into ambient occlusion or stylized lens ghosts. |

The renderer is tied to the pinned Three version. In particular, the WebGL index
state adapter and reversed-depth sort/depth adapters compensate verified vendor
behavior. Recheck these adapters when upgrading Three. The owned reversed-depth
TRAA setup derives from Three's MIT-licensed implementation; its license is
retained in `vendor/LICENSE`. For GPU timings, collect
unique per-frame query IDs and raw start/end timestamps for every cloud stage.
Report their elapsed envelope and overlap separately: Apple GPUs can overlap
vertex and fragment stages, so summing pass durations can double-count work.
A last-pass or aggregate timestamp can also silently omit work.

Run the portable graphics regression checks with Node 22.15 or later:

```sh
node --import ./raptor/qa/register-three.mjs --test raptor/qa/*.test.mjs
```

These check quality selection, asynchronous exposure ownership and failure
handling, shipped cloud-asset hashes, star-catalog validation, and conservation
of fine-wave modes across resolutions. They also exercise source-field
interpolation/collars/corruption fallback, actual controls, cached asset
profiles, and near-grid allocation and transitions. Browser rendering and
visual comparisons are still needed to accept shader or appearance changes.
