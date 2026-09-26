# RAPTOR — four-city pixel-art collection

Ten concept boards, reviewed across three refinement passes. Open the
[public gallery](https://raptor.chall.net/artwork/four-cities/) or
[local gallery](index.html) to view the collection and download individual PNGs.
Play all four cities in [Pixel Wing](https://raptor.chall.net/arcade/), either
as one campaign or as individual missions. This gallery is the companion
concept collection; the game uses its own authored pixel scenery and sprites.

## Deliverables

| Board | Artwork |
| --- | --- |
| 01-new-york | New York City — Blue hour / harbor to Midtown |
| 02-san-francisco | San Francisco — Morning fog / Golden Gate and the bay |
| 03-austin | Austin, Texas — Sunset / Lady Bird Lake and Congress Avenue |
| 04-washington-dc | Washington, DC — Spring light / the Mall and Tidal Basin |
| 05-title-art | Title artwork — Four cities / one campaign |
| 06-aircraft | Aircraft and flight states — Player / allies / transport |
| 07-enemies-bosses | Enemies and bosses — Combat silhouettes / four city encounters |
| 08-city-kit | City terrain and landmark kit — Four environment families |
| 09-effects | Weapons, pickups and effects — Combat language / animation studies |
| 10-interface | Interface and campaign flow — Title / region / briefing / flight / pause / debrief |

The four city keyframes lead the presentation. The six supporting boards cover title art, player/ally/transport craft, enemies and four city boss designs, landmark/terrain families, weapons and effects, and six interface states.

## Visual contract

Build on Pixel Wing's existing near-top-down, vertically scrolling art direction and 640 × 400 logical canvas. Preserve its ink/navy, titanium, mint, teal, gold, coral, violet and cream palette; give each city its own environmental colors. Use coherent upper-left lighting, hard pixel edges, deliberate clusters and legible silhouettes. Aircraft and hostile effects must read against busy city roofs.

City scenes use deliberate spatial compression. They are illustrated arcade maps, not navigation maps. New York is contemporary, independent of the 3D game's historical Harbor Watch scenario.

- New York: dense tapered island, two river corridors, harbor islands; blue hour.
- San Francisco: peninsula and stepped hills, Golden Gate in the northwest, eastern bay waterfront; morning fog.
- Austin: Lady Bird Lake, Congress Avenue Bridge and the Capitol spine; warm dusk.
- Washington, DC: low monumental skyline, east-west Mall, Tidal Basin to the south; spring daylight.

## Relationship to the playable game

Pixel Wing now includes New York City, San Francisco, Austin, and Washington, DC as playable levels, with four bosses, individual city selection, three campaign upgrade stops, and separate score records. Its native Canvas2D art supplies landmark routes, animated aircraft, combat effects, and gameplay interfaces. See the [arcade README](../../arcade/README.md) for city links, controls, and verification.

These generated boards remain visual concepts. They illustrate a broader art direction and interface study; their sheet layouts are not runtime sprite atlases or exact screenshots of the playable levels.

## Prompt set and files

- `prompts.jsonl`: exact ten image prompts, one distinct board per line.
- `manifest.json`: presentation titles and selected original/preview image paths.
- `index.html`: standalone gallery; open directly in a browser. Click an image to enlarge it, use arrow keys to browse, and Escape to close. Closing restores focus to the selected plate. Full-resolution links also work with JavaScript disabled or a failed preview.
- Final renders: `raptor/output/imagegen/four-cities/`. Nine boards are 1920 × 1200; the interface board is 2048 × 2048.
- Display previews: `raptor/output/imagegen/four-cities/previews/`. Images are reduced to 1280 pixels wide with nearest-neighbor sampling and encoded as lossless WebP. The first preview loads immediately; the other nine use native lazy loading. Original PNGs load when opened or downloaded.
- [City overview](../../output/imagegen/four-cities/city-overview.png), [supporting artwork overview](../../output/imagegen/four-cities/art-kit-overview.png), and [complete collection](../../output/imagegen/four-cities/complete-overview.png).
- `generation.json`: selected files, dimensions, checksums and generation details.
- `refinement-austin.txt`, `refinement-austin-pass1.txt`, `refinement-aircraft-pass1.txt`, and `refinement-austin-masked.txt`: the exact targeted edit prompts. `refinement-austin-mask.png` defines the final Austin edit region.
- `build-previews.py`: reproduces display previews and overview sheets, and optionally packages a portable gallery ZIP. Rebuilding these files makes no image API requests.

The user-approved imagegen CLI/API fallback generated the boards with
`gpt-image-2` at high quality. There were ten initial generations and four
targeted edit requests: Austin's bridge, an unsuccessful duplicate-tower
correction, aircraft roll studies, and the final masked Austin tower correction.
The selected Austin and aircraft images are `03-austin-v4.png` and
`06-aircraft-v2.png`. The finished title is `05-title-art-v2.png`, with lettering
typeset using the project's Silkscreen font. Earlier renders remain in the
workspace's ignored `.context/raptor-artwork/` archive and are excluded from the
published collection.

The scenes, aircraft, enemies, landmark atlas, effects and interface boards were inspected visually. The generated sheets are design studies: pose counts, bank/roll geometry, scale, shadows and animation registration need to be authored and verified for gameplay. City geography and individual buildings are stylized.

Rebuild display previews and overview sheets from the website project directory
(`projects/chrishall-co-site` in the monorepo):

```sh
uv run --with pillow python raptor/artwork/four-cities/build-previews.py
```

Use `--previews-only` to rebuild only the display WebPs. Add
`--archive /path/to/raptor-four-cities-artwork.zip` to the full build command to
package the ten selected PNGs, display previews, overview sheets, gallery, art
brief, prompts, refinement mask, generation record, build script, and licensed
local font. Extract the ZIP and open `raptor/artwork/four-cities/index.html`;
no server, installation, or API key is required to view it. In Chrome, a local
`file://` PNG download may open the image in a new tab; use **Save image as**
there. The hosted gallery provides normal PNG downloads.

## Verify the gallery

From the website project directory, using an existing Playwright installation
and Google Chrome:

```sh
node raptor/qa/artwork-gallery.browser.mjs
```

This opens the local `file://` gallery. To check the served gallery and HTTP
downloads, start `python3 -m http.server 8082 --bind 127.0.0.1 --directory raptor`
and run:

```sh
RAPTOR_BASE_URL=http://127.0.0.1:8082/ node raptor/qa/artwork-gallery.browser.mjs
```

Set `PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs` if Playwright is
outside Node's resolution path. `HEADED=1` shows Chrome. Screenshots and the
JSON report go to `.context/raptor-artwork/qa/` at the workspace root; override
that with `RAPTOR_TEST_OUTPUT` to keep local and HTTP runs separately.

The nine checks cover manifest consistency, preview loading and deferral,
original-image links, keyboard lightbox navigation and focus restoration,
downloads, missing-preview recovery, JavaScript-disabled viewing, and narrow
mobile layouts. Gallery checks establish presentation behavior, not gameplay
readiness of the concept sheets.

## Reference sources

These official sources informed the landmark relationships. Palette, lighting, composition and compression are artistic choices.

- NYC: [official visitor map](https://www.nyctourism.com/NYCTourismOVM-090924.pdf), [NPS Liberty Island](https://www.nps.gov/places/000/liberty-island.htm).
- San Francisco: [SF Travel landmarks](https://www.sftravel.com/things-to-do/attractions/iconic-san-francisco), [Ferry Building and waterfront](https://www.sftravel.com/article/top-20-attractions-san-francisco).
- Austin: [City of Austin Congress Avenue](https://www.austintexas.gov/transportation-public-works/congress-avenue), [Visit Austin bats](https://www.austintexas.org/things-to-do/outdoors/bat-watching/).
- Washington: [NPS National Mall map](https://www.nps.gov/nationalmallplan/images/study%20area.pdf), [Lincoln Memorial Reflecting Pool](https://www.nps.gov/places/000/lincoln-memorial-reflecting-pool.htm), [Capitol grounds](https://www.aoc.gov/explore-capitol-campus/buildings-grounds/capitol-grounds/reflecting-pool).
