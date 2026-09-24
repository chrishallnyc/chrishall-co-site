# Cirrus optical-density atlas

`cirrus-density.png` is an original procedural 2048×2048 grayscale field, reproduced by:

```sh
node raptor/bakery/bake_cirrus.mjs
```

The baker also writes `cirrus-density.json`, recording the deterministic recipe, encoded and decoded SHA-256 hashes, density statistics, and runtime sampling contract. It uses no external bitmap, generated-image service, or network input. No photographic pixels are included.

The morphology combines broken moisture veils with uneven wind-sheared fibres and independently terminating fall streaks. Visual references informed these choices:

- [NASA Langley cirrus gallery](https://scool.larc.nasa.gov/GLOBE/cirrus.html), including Lin Chambers' photographs of uneven veils and fibrous cirrus.
- [WMO Cloud Atlas, cirrus explanatory remarks](https://cloudatlas.wmo.int/en/explanatory-remarks-and-special-clouds-cirrus.html), describing dense heads and trailing ice-crystal fall streaks.
- [NASA Earth Observatory, transverse cirrus bands](https://science.nasa.gov/earth/earth-observatory/wispy-clouds-before-the-storm-145189/), showing that aligned cirrus occurs naturally; the atlas avoids repeating identical branch shapes.

These references are for visual direction only. Their photographs are not redistributed with the application. This field represents cloud optical density for the existing spherical-layer renderer, not a meteorological microphysics simulation.
