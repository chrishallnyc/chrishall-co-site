# Local overview relief

These 50 compact rasters provide real elevation measurements for the finite state models. They remove the need to assemble remote elevation tiles before drawing a state overview. California's longest raster axis is 1,024 samples; other states use 768. They are overview data, not a promise of survey resolution or enough detail for a close city view.

## Binary contract

Read the record for a state from `states.json`, fetch its `file`, and interpret the payload as **signed little-endian 16-bit integer meters**, without a header or trailer. The payload size is exactly `width * height * 2`. Heights are rounded to the nearest meter and are not exaggerated, colorized, or clamped to sea level.

- Rows run north to south, columns west to east, in row-major order.
- `bounds` is `[west, south, east, north]` in WGS84 degrees and matches the existing state's bounds.
- `mercatorBounds` is `[westX, northY, eastX, southY]` in normalized slippy-map Web Mercator coordinates. Y increases southward.
- Each sample is at its pixel center: `x = westX + (column + 0.5) / width * (eastX - westX)` and likewise for Y. For bilinear lookup at normalized model coordinates, use `column = u * width - 0.5`, `row = v * height - 0.5`, clamping at the edges.
- Alaska's longitudes and normalized X extend west of −180°/0. Source tile X is wrapped modulo `2 ** zoom` during baking; the raster itself remains continuous. Do not wrap the output into a world-spanning rectangle.
- `min` and `max` describe the **entire bounding rectangle**, including ocean and neighboring states. They are not a state's lowest and highest points. Apply the state geometry separately when drawing the model.
- Negative values include both real land depressions and seafloor measurements. Land masking and marine rendering are separate from these stored measurements.

## Provenance and processing

Accessed September 14, 2026 from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) / Mapzen. Source format: [Terrarium](https://github.com/tilezen/joerd/blob/master/docs/formats.md), decoded as `R * 256 + G + B / 256 - 32768` meters. Source zoom, tile count, sample dimensions, and access date are recorded per state. Source resolution varies by location and source dataset.

The bake selects a source grid at least as dense as the output, adds a tile halo, decodes elevations to floating point, then resizes to the exact Mercator bounds with bilinear downsampling. It rounds the resulting heights to signed integer meters. It does not interpolate encoded RGB channels, fabricate mountains, infer heights from an image, or substitute a generative landscape.

Some source tiles contain isolated spike/pit artifacts. Before downsampling, a conservative filter replaces a sample with its 5×5 local median only when its residual exceeds both 300 meters and six times the local median absolute residual. Rough terrain raises the rejection threshold. All other samples remain unchanged. The count of replaced source samples is recorded. This avoids known isolated artifacts such as a roughly 350-meter Connecticut neighborhood containing a source sample above 3,500 meters; it is not a claim that every source error has been removed. Downsampling also reduces sharp peak elevations, so sampled maxima must not be used as published summit elevations.

Terrain data include public U.S. government material and other openly licensed source material. Credit: Mapzen / AWS Terrain Tiles; U.S. Geological Survey (3DEP, SRTM, GMTED2010); DOC/NOAA/NESDIS/NCEI for global ETOPO1. Northern and border-region source mosaics may include ArcticDEM, Canadian, and Mexican data: ArcticDEM was created from DigitalGlobe imagery with funding under NSF awards 1043681, 1559691, and 1542736; Canadian material contains information licensed under the Open Government Licence – Canada; Mexican relief source: INEGI, Continental relief, 2016. See the [complete upstream attribution and license notes](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). The app should retain a visible terrain credit and link to these notes.

## Rebuild

The website needs no Python runtime. Rebuilding requires Python 3.9+, NumPy, SciPy, Pillow, Requests, and Node (to read the existing geography ES module).

```sh
python terrain/data/relief/bake.py
python terrain/data/relief/bake.py --states CA TX --force
python terrain/data/relief/validate.py
```

Downloaded source tiles are cached under the gitignored `.context/terrain-dem-cache/`. `states.json` is published atomically after each state so a renderer can use completed records while another bake is running.
