# THE SALON — a rotating hanging of the public domain

salon.chall.net — a screensaver of masterpieces. Public-domain paintings in gold gilded frames,
hung on a quiet wall that follows the sun. Every image comes from a museum open-access program
(CC0 / Public Domain Mark) or a Wikimedia Commons PD-Art file; every URL in the collection was
live-verified at bake time. No keys, no tracking, no build step.

## The room
- **The door** — click to enter; the one gesture buys fullscreen + a screen wake lock.
- **Solo** — one work, centered; **a wall of three** (`v`) hangs a gallery row, swapping the
  oldest work at half the dwell.
- **The frames** — every work hangs in a gilded gold frame with a linen liner (`b` bares the canvas).
- **The wall** — follows the sun (NOAA-lite, offset-meridian): paper + dot grid by day, near-black
  after sunset; dims further past 23:00. `m` cycles sun / day / night.
- **The plates** — brass-plate captions (`ARTIST · title, year · museum`) appear after each hang,
  rest after 9s; `i` holds them.
- **The clock** — seeded-daily shuffle ("tonight's hanging" is the same all evening), dwell 75s
  by default, `[` `]` to change, space pauses, arrows walk.
- **The rooms** — `g` opens the index (DUTCH LIGHT, THE IMPRESSION, VINCENT & AFTER, THE FLOATING
  WORLD, THE STORM, THE QUIET NORTH, OLD MASTERS, THE AMERICANS, VIENNA GOLD, JAMAICA).
- **`?` shows the keys.** Touch: swipe walks, tap shows plates, double-tap fullscreens.

## Reliability armor
- Every work carries descending image tiers; the loader picks by screen size, fails over
  tier-by-tier (25s timeout each), and quarantines dead works in `localStorage` (version-keyed
  to the bake, so a re-bake clears the graveyard).
- Service worker: shell network-first (version-keyed), artwork cache-first LRU (42 works) —
  revisits are instant and network blips don't dark the wall.
- Wake lock re-acquires on `visibilitychange`; rotation pauses while the tab is hidden.
- Burn-in care: plates are ephemeral, the stage pixel-shifts ±2px per hang, late-night dim.
- `prefers-reduced-motion`: 340ms fades, no drift.

## URL params
`?room=<slug>` `?work=<id>` `?mode=gallery|solo` `?dwell=<sec>` `?seed=<n>` `?still=1` (no
rotation) `?door=0` (skip door) `?cursor=1` (never hide cursor) `?sunat=<ISO>` (offset the whole
clock — QA) `?audit` (self-check; title ends AUDIT-CLEAN-SALON).

## QA
- Hooks: `window.__SALON.info()/next()/prev()/mode()/room()/sun()/dead()/verify(n)/enter()`.
- Battery: `node salon/qa/battery.mjs` (local, ephemeral port) / `--live` / `--webkit`.
- `?audit` gates on a baked collection (`COLLECTION_V >= 1`) — the placeholder set fails by design.

## The bake
`salon/bake/bake.py` merges curator room files (`bake/rooms/*.json`), dedupes, enforces the
legal + size gates, **re-verifies every primary URL live** (status + JPEG SOF dims / IIIF
info.json), corrects dimensions from the wire, writes `bake/collection.json` (provenance) and
injects the `/*COLLECTION-START*/…/*COLLECTION-END*/` block in `index.html`.

Legal doctrine (research dossier lives with the fleet): US public domain = published before 1931
or artist dead 70+ years; Bridgeman v. Corel + EU DSM Art. 14 mean faithful scans of PD paintings
carry no rights of their own; sources are museum CC0/open-access programs and Commons PD-Art.
Attribution is not required by CC0 but every plate credits artist + museum anyway. Roster rule
baked into curation: artist dead before 1926 (or work verifiably published pre-1931), museum PD
flag required. No Hilma af Klint (US-copyrighted until 2047), no post-1930 estates.

## Hosting
Own Vercel project `salon` (git-linked to chrishall-co-site, rootDirectory `salon`), served at
salon.chall.net; leafed on the admin.chall.net tree. Images hotlink museum CDNs (all verified
CORS-open or plain-img safe) — the SW keeps a local cache; a self-hosted tier bake is the
documented upgrade path if link rot ever bites.
