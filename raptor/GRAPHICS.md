# Graphics

RAPTOR renders from native ES modules with the pinned Three distribution in
`vendor/`. Serve `raptor/` as the document root; assets use absolute `/assets/`
paths. WebGPU supplies volumetric clouds, temporal antialiasing, bloom, and
spectral water. WebGL2 retains physical atmosphere, lit cloud cards, material
detail, the Moon and stars, and Gerstner water.

The [cloud and terrain validation report](GRAPHICS-1.7.md) records six refinement
passes, seven measured improvements, native comparisons and remaining limits for
that work. Its component timings do not measure the combined aircraft and world
release.

## Coordinate and lighting contracts

Flight dynamics and combat state use local ENU metres: X east, Y north, Z up.
Rendering, geographic sampling, weather and wave fields use X east, Y up,
Z north; the game adapters convert between them. `planetcurvature.js` bends
render positions around a shared moving observer at a 6,360 km radius. Terrain,
water, objects, cloud sampling, shadows, motion vectors, and HUD projections
must use that same frame.
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

Standard cloud noise is 128³ base plus 64³ detail; High is 192³ plus 96³,
and Ultra is 256³ plus 128³. All three
sample the same seeded physical fields. High and Ultra increase spatial sampling density
without enlarging cloud cells or moving the weather planes. Compressed local
assets are dimension-checked and verified against decoded SHA-256 hashes. Failed
High/Ultra loads fall back to standard assets, then a standard CPU bake.

The native WebGPU cloud pass caches cumulative optical depth along the Sun,
Moon and two diffuse-light directions. Four published 3D volumes and one staging
volume rotate ownership only after a complete update. Each frame produces at
most 640 columns; stale source directions and large camera cuts immediately use
the original light integration. Source-specific frozen curvature keeps the
cache aligned while the observer moves. This changes cloud radiance only; the
original view march still owns alpha, distance, depth and motion. Typical cache
storage is about 115–160 MiB, depending on source angles and staging dimensions.
WebGL and the optional adaptive cloud pass retain their original lighting path.

The observer sky uses a 1024×512 RGBA16F scattering cache above a one-megapixel
render buffer. It retains the direct 32-step atmosphere near the horizon and
rebuilds when altitude, source direction or irradiance changes. Discs, cirrus,
airglow, stars, probes and surface aerial perspective keep their existing paths.
Failure or a smaller render buffer selects direct scattering. Day/night source
changes retain compiled light programs; stars and Moon warm up during loading.

The billboard fallback joins tropical tower puffs into overlapping columns,
uses a shared height gradient, and omits interior cap planes. Dense tower cores
have greater optical depth to reduce background showing through, while soft rims
and distance/view fades remain unchanged. Ordinary puffs, coverage shadows and
wind motion retain their existing behavior. These remain soft card approximations;
they do not provide volumetric cloud detail or occlusion.

The default `SpatialCloudPass` integrates full-resolution radiance, depth and
motion, then filters only compatible cloud samples. Geometry edges and opaque
occluders constrain the filter; scene color is composed afterward. Midpoint
samples and secondary billows improve solid cloud bodies without changing the
seeded weather. The pass owns five full-resolution textures (44 bytes per pixel,
about 348 MiB at 3840×2160). Native 4K is a demanding quality option, not a frame
rate guarantee. `AdaptiveCloudPass` remains available for measured comparisons;
its rejected edges use the full-resolution march.

HIGH/ULTRA load an 8192² cirrus optical-density atlas when the GPU supports that
size. Narrow, irregular fibres add actual detail to the same broad weather
pattern. LOW/MED and limited devices use the 2048² atlas. The loader validates
dimensions and releases its decode canvas; a failed 8K load falls back to 2K,
then a clear placeholder. All sky and reflection paths share the selected field.
The 8K R8 texture with mips adds 80 MiB over the 2K version.

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
of shimmering highlights. HIGH/ULTRA use a 512² fine spectral cascade over a
32 m tile; LOW/MED use 128². The larger cascade resolves smaller waves, while
scratch FFT targets omit unused mip chains. Final filtered moment mips remain.
Nonrepeating 512-second numerical epochs preserve wave phase during long flights;
they do not loop the sea or reset its foam. Allocation stays fixed until reload.
Near and far meshes share an exact boundary; overlapping ocean surfaces lose
depth precision at flight distances even when they share a material.

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

Nellis High/Ultra WebGPU streams real one-metre NAIP imagery over a 12.288 km
square around the normal flight area. Thirty tiles provide valid source imagery
across 67.45% of that square; transparent holes and positions outside coverage
retain the base image. Four resident 2064² tiles use about 86.7 MiB including
mips, with at most two requests in flight. Detail fades from actual upload,
across missing neighbors, and with pixel footprint. It is disabled above 2500 m
AGL. A failed tile keeps the base image without repeated automatic requests.
The older Nellis base image also has its NAIP block aspect distortion repaired;
Sentinel fill, coverage masks, terrain heights and normals retain their mapping.
A small 0.241% of the area retains legacy feather pixels where no original
radiance was recoverable. Source details are in the imagery credits below.

Terrain material relief now follows three physical projection planes on steep
slopes. Valdez High/Ultra adds optional scanned rock and snow microrelief with
rotated, differently scaled samples and filtered slope/roughness moments. The
photographs describe material appearance, not new geographic terrain. Their
bounded four-second load completes before material compilation; any failure
keeps the procedural material. Other fronts and lower asset tiers do not fetch
them. The packed array adds about 9.3 MiB over the procedural material textures.

## Assets

- `bakery/bake_cloud_noise.mjs`: deterministic Standard/High/Ultra noise assets.
- `bakery/bake_cirrus.mjs`: 2048²/8192² optical-density atlases of broken cirrus
  veils, fine fibres, and irregular fallstreaks;
  [source notes](assets/clouds/ASSET-CREDITS.md) describe their procedural origin.
- `bakery/bake_terrain_source.py`: reproducible central Valdez height/normal
  pair, with [source request, hashes and credits](assets/terrain/source/ASSET-CREDITS.md).
- [Nellis imagery credits](assets/terrain/nellis-imagery/ASSET-CREDITS.md):
  USGS/USDA sources, geographic grid and base-image correction.
- [Scanned material credits](assets/terrain-photo/ASSET-CREDITS.md): CC0 rock
  and snow, physical scales, hashes and filtered moment encoding.
- [Lunar map credits](assets/sky/ASSET-CREDITS.md): source and attribution.
- [Bright-star credits](assets/sky/BRIGHT-STARS-CREDITS.md): NASA catalog, source query,
  redistribution declaration, hashes, and reproducible baker instructions.

The star catalog supplies measured positions, visual magnitudes, colors, and
proper motions. A seeded field remains available if the local asset fails.
Terrain material relief supplements the existing geographic imagery and DEM;
it does not reconstruct geographic features absent from those source assets.

## Aircraft integration

`aircraft/lighting.js` adapts physical materials without replacing their authored
normal, roughness, metalness or ambient-occlusion maps. The F-22's base normal
uses its UV0 paint atlas; `coating-detail.js` supplies cached micro-normal and
roughness maps for the clearcoat layer on metre-scale UV1. HIGH/MED share these
small maps across both coating atlases; LOW omits them. In the pinned Three
renderer, clearcoat roughness samples red; the scalar detail map carries that
value in all RGB channels. Independent left/right wing and stabilator charts
retain distinct repair histories within the existing atlas dimensions.

`PlanetObjectBender` resolves each normal layer in its original surface frame
before applying curvature once, preserving the velocity output. Refresh aircraft
materials before bending when a livery changes, and update the shadow target
after the current atmosphere observer. Aerial perspective composites completed
aircraft lighting through the same Sun/Moon transport as the world.

`aircraft/environment.js` captures sky radiance at the player's rendered altitude.
It uses the shared atmosphere/cirrus source and volumetric cloud source when that
path is active. Below the horizon, a regional average ground color receives
direct and ambient light. This is a diffuse ground approximation, not a terrain
render, nearby-object reflection, or separate probe for each enemy. All aircraft
share this map while retaining their authored material reflection strengths;
the landscape and sea-level water probe keep their own environments.

`SkyEnvironment` freezes source uniforms, observer and time for a complete cube.
The first aircraft capture occurs behind the loading veil; later captures render
one face per frame, then convolve and publish only the complete result. The two
cube maps and their prefiltered results are reused. Ordinary refreshes are spaced
at least six seconds apart; explicit time cuts invalidate the probe immediately. Pre-exposure rescales
the published map without rebaking it, including after a refresh failure. A boot
failure retains scene lighting. Cube size is 128 on MED/HIGH/ULTRA and 64 on LOW;
live quality changes retain the boot allocation until restart. Curved recipients
rotate their reflection lookup toward the probe's +Y frame; one shared probe
still approximates weather, terrain and solar-angle variation across the map.

F-22 contact occlusion is an offline neutral-pose bake, packed only into ORM red.
It must be regenerated after geometry or UV changes and checked against a
matching flat-AO capture. Overlapping projected body charts use explicit receiver
filters; ambiguous fin-fairing footprints are kept neutral while live shadows
handle those contacts. The result is bounded ambient contact shading, not a
directional shadow or dynamic articulation bake. The exact export policy,
fingerprint checks and acceptance workflow are in [F22-AO.md](tools/F22-AO.md).

Solar visibility multiplies native aircraft self-shadow with cloud and planetary
visibility. LOW disables native shadow updates while retaining celestial
visibility. Shadow target size stays fixed for its compiled lifetime; reload to
allocate a larger target after upgrading from a lower boot tier.

Each nozzle uses the shared aircraft release's 32-step volumetric exhaust and
aperture glow. The field samples undeformed geometry coordinates before the
world bend. Fully transparent computed fragments are discarded before writing
motion, keeping the surrounding sky's history intact. Exhaust shape and color
are game effects, not measured F119 radiometry or fluid simulation.

Stars and the Moon render at far depth so distant opaque terrain can occlude
them. Their motion uses catalogue/disc positions rather than billboard corners;
newly visible or replaced celestial geometry rejects unrelated temporal history.
The Moon's 2K map loader preserves its neutral fallback on decode failure.

## Reproducible comparisons

Use a fixed front, parked pose, time of day, manual quality tier, canvas size,
and exposure. For example:

```text
/?front=MARIANAS&camx=7680&camz=13824&camh=2800&yaw=218&pitch=-8&tod=15.5&hud=0&audio=0&nobattle=1&autoexp=0
```

`camh` is added to `max(terrain.heightAt(camx, camz), 0)`: height above ground
on land and above sea level offshore. Record the actual camera position.
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
| `cloudnoise=standard\|high\|ultra` | Select noise assets independently of output size. |
| `cloudtransport=legacy\|strict\|toa` | Compare fitted lighting, unomitted calibrated sources, or uncalibrated sources. |
| `reversedepth=0` | Compare forward depth with the WebGPU reversed-depth default. |
| `logdepth=0` | Restore ordinary forward depth on WebGL2. WebGPU is unchanged. |
| `rawtaa=0` | Compare native temporal depth selection with the raw-depth default. |
| `curvature=0` | Compare the legacy flat render frame. |
| `aircraftenv=0` | Disable the dedicated aircraft reflection probe; retain scene lighting. |
| `skycache=0` | Compare direct observer-sky scattering. |
| `geographicdetail=0` | Disable streamed Nellis one-metre imagery. |
| `terrainphoto=0` | Disable optional scanned Valdez material detail. |
| `terrainnear=0` | Disable the near terrain grid at every quality tier. |
| `terrainsource=0\|16` | Compare original and central 5 m Valdez elevation data. |
| `snowdetail=0` | Disable added wind-packed snow material relief. |
| `waterfine=0\|128\|256\|512` | Compare the fine water cascade. |
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
handling, shipped cloud-asset hashes, star-catalog validation, conservation of
fine-wave modes across resolutions, and long-clock phase continuity. They also
exercise source-field interpolation/collars/corruption fallback, actual controls, cached asset
profiles, and near-grid allocation and transitions. Browser rendering and
visual comparisons are still needed to accept shader or appearance changes.
