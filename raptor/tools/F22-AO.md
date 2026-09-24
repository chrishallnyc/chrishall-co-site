# F-22 contact-occlusion authoring

This offline pipeline exports the procedural HIGH aircraft into Blender, bakes bounded-distance ambient occlusion in the authored UV charts, and packs that visibility into the existing coating maps. The exporter and Cycles baker write separate authoring artifacts. The normal coating baker reads the accepted AO sources and changes only ORM red; it does not change geometry, flight state, color, normal, roughness or metallic channels. The game loads its existing textures and needs no Blender dependency or extra runtime request.

```sh
node raptor/tools/f22-ao-export.mjs \
  --out .context/aircraft-rebuild/ao-tools/final

F22_AO_BLENDER="$PWD/.context/aircraft-rebuild/ao-tools/bin/Blender.app/Contents/MacOS/Blender"
"$F22_AO_BLENDER" --background --factory-startup \
  --python raptor/tools/f22-ao-bake.py -- \
  --input .context/aircraft-rebuild/ao-tools/final/aircraft.json \
  --out .context/aircraft-rebuild/ao-tools/final/bake \
  --width 2048 --samples 64 --radius .35 --strength .65 --final
```

The exporter discovers an existing Playwright installation and Chromium browser, with `--playwright`, `--browser`, `AIRCRAFT_QA_PLAYWRIGHT`, and `AIRCRAFT_QA_BROWSER` overrides. It does not download packages or create a GPU renderer. It freezes production JS/JSON into `source/`, records their combined SHA256, then exports actual world-space vertices, normals, triangle indices and unchanged UVs. The geometry fingerprint also includes receiver/exception flags, so an authoring-policy change cannot silently reuse an incompatible bake. `--source-overlay <saved/source>` can reuse a frozen revision.

The bake script requires an existing Blender installation with Cycles and its bundled NumPy. The verified authoring environment uses Blender **4.5.14 LTS**, macOS arm64. Its official mirror URL was [Blender's mirror selector](https://mirror.blender.org/release/Blender4.5/blender-4.5.14-macos-arm64.dmg), which selected the Berkeley mirror. SHA256 from the [official release checksum file](https://mirror.blender.org/release/Blender4.5/blender-4.5.14.sha256):

```text
65134d9b07b20e2fa8d3c9e44f6f44ffb5c9774dd521b95f50387310241ca170
```

The local binary lives only under the gitignored `.context/` directory and is not committed. Nothing was installed globally. Use any separately installed compatible Blender executable by setting the command path accordingly.

The export drives the actual render pose with neutral surface values and `GEAR=0` before collecting visible geometry. Gear/nozzle assemblies, glass/transmission, transparent effects, `aircraftEffect`, `excludeAO`, and `role: 'paint-marking'` meshes are omitted. Gear doors must follow the production stowed pose before a final export; hiding legs alone is insufficient. Unselected opaque surfaces remain occluders.

Receiver selection accounts for deliberate UV sharing:

- Upper/lower body charts retain both sides; the shared side strips use starboard faces that point outward.
- Wing and stabilator charts use the starboard representative.
- Each fin inner/outer face uses its unique positive/negative chart.
- Faces crossing chart boundaries and thin rims poorly aligned with their chart projection remain occluders but cannot write the atlas.

`report.json` records residual UV overlap after those filters. Triangles are assigned to UV layers with disjoint sampled coverage. Each layer is baked separately; the tool composites **maximum visibility** only over pixels actually covered by that layer. This is minimum occlusion, so a hidden duplicate cannot paint darkness over the exterior surface that shares its UVs. A one-texel binomial filter, weighted by covered pixels, reduces sampling stair steps on narrow projected surfaces. Uncovered pixels never enter that filter. Padding is extended only after composition and filtering. This avoids arbitrary overlapping-face write order. At a higher final resolution the layer assignment is recalculated, not reused from the low-resolution probe.

The steep fin-root fairings share their projected body chart with the booms underneath. They remain opaque occluders but are excluded as receivers; their ambiguous body-atlas footprint is neutralized, including a two-texel filtering margin, so the visible fairing cannot inherit the hidden boom's contact darkness. The report counts that footprint and its conflicting coverage, and the source manifest records this limitation. The separate fin charts retain root AO, other reliable body contacts retain their bake, and live self-shadows handle the fairings. No geometry or UV redesign is hidden in this authoring step.

The Cycles material emits the Ambient Occlusion node's scalar output with a finite distance. The final .35 m radius targets cockpit sills, fin roots, boom junctions and small recesses; the tool caps the radius at .5 m. This is neutral-pose ambient contact occlusion and contains no sun direction or directional shadows. It supplements the game's moving self-shadows. An asymmetric U/V calibration bake runs first and verifies data values and orientation. Output files include calibration PNG, individual transparent AO layers, composed AO maps, JSON measurements, and a diagnostic `.blend` file.

Use `--audit-only` to report overlap without baking. A quick provisional pass can omit `--final` and use `--width 512 --samples 16`; width is capped at 2048, matching the current high-quality data atlas, and height is half width. Samples are deterministic, CPU Cycles uses eight threads, and runtime measurements appear in the report. Timing is local offline bake cost, not aircraft rendering cost.

Outputs default to `provisional: true`. A final pass needs frozen closed-door geometry, full-resolution UV/conflict inspection and on-aircraft previews. `--final` requires 2048 width, at least 32 samples and an exported geometry fingerprint. It produces `body-ao.png`, `lifting-ao.png`, and `source-manifest.json`; the latter records checksums, geometry fingerprint, bake settings and packing strength (default .65). Diagnostic layer images and the blend file remain beside them.

After acceptance, store only those two source PNGs and the source manifest renamed to `manifest.json` under `src/aircraft/authoring/contact-ao/`. The existing `bake-f22.mjs` reads that directory and multiplies only ORM red by the strength-adjusted visibility before generating lower qualities. It retains color, normal, roughness and metalness. It writes the AO status and current/baked geometry fingerprints into the generated texture manifest. An initial bake without an AO manifest is allowed; an existing stale fingerprint fails before writing assets. `--allow-stale-ao 1` is an explicit inspection override and records `status: 'stale'` in the generated manifest.

Regenerate all 18 production coating maps with `node raptor/tools/bake-f22.mjs`. A geometry or UV change requires a fresh export and accepted AO bake before this command will overwrite maps. The source manifest records the geometry fingerprint, Blender version, radius, sample counts, strength, map dimensions and checksums; source PNGs remain available for future coating edits.

For reversible comparisons, the coating baker supports `--out <temporary-texture-directory>`, `--contact-ao 0` (unoccluded baseline), and `--ao-source <directory-containing-manifest.json>`. Provisional source maps are rejected for the production output directory. This supports validating red-only changes and previewing AO without overwriting committed maps.

Pass `--source-overlay <export/source>` to the coating baker to reuse the exact exported geometry and paint modules during a comparison. Both the baker and exporter freeze source modules at startup. The aircraft QA driver's `--texture-overlay <temporary-texture-directory>` then previews either output on the same saved source revision.
