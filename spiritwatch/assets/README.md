# SPIRITWATCH chase art

The four PNGs in this directory are the transparent runtime sprites. They are
painted at double native resolution and downsampled by the canvas renderer with
nearest-neighbor sampling.

- `chase_bomber_b2.png` — 440×130, 7 colors
- `chase_bomber_b2_night.png` — 440×130, 8 colors; exact day silhouette
- `chase_jet_f22.png` — 180×130, 12 colors
- `chase_tanker_kc46.png` — 400×200, 8 colors

`boards/` contains the final labeled `#ff00ff` production boards at the same
native scale. `source/` preserves the generated studies used for texture and
lighting. Rebuild and validate every invariant with:

```sh
python3 spiritwatch/tools/prepare_sprites.py
```

The build fails on soft alpha, excess colors, structural asymmetry, pure black,
day/night silhouette drift, excess night exhaust warmth, or a B-2 outline other
than the locked three-point double-W.
