# Valdez central terrain source

The height field derives from the U.S. Geological Survey 3D Elevation Program: **USGS Alaska 5 Meter NRCS_USGS_USFS_BLM_Alaska_Mid_Accuracy_DEM 1369**, `AK_IFSAR-NRCS-C255_2012`, raster object 6412. Acquisition: 2012; publication: August 1, 2015; vertical datum: NAVD88. It is a 5 m IfSAR terrain product. Source spacing is not an assertion of 5 m absolute accuracy.

USGS makes 3DEP products available without use restrictions. See [USGS product terms](https://www.usgs.gov/3dep-product-news) and the [Alaska Mapping Initiative](https://www.usgs.gov/ngp-user-engagement-office/alaska-mapping-initiative). The original TIFF URL, complete locked export request, source item attributes and hashes are recorded in `valdez-inland-16km.provenance.json` and the runtime manifest.

The packaged extent is 16 km square, world X −8000…8000 m and Z −12000…4000 m, centered on X0/Z−4000 in the canonical Valdez map frame. The source was exported with bilinear reprojection from one explicitly locked raster at 3200² samples. All samples, including the 512 m blend collar, are valid inland terrain. A 5 m output interval preserves the source product's sampling scale within the existing local map convention; this is not a new surveyed coordinate system.

`valdez-inland-16km-height.png` packs quantized height as high byte R / low byte G. `valdez-inland-16km-normal.png` contains central-difference normals derived from those exact decoded heights, with east/north/up in RGB. Geometry and collision decode before scalar bilinear interpolation. The manifest records compressed PNG hashes and the decoded packed-height / RGBA-normal hashes enforced at runtime. Geographic imagery is unchanged.

To regenerate, use Python 3 with NumPy and Pillow:

```sh
python raptor/bakery/bake_terrain_source.py \
  --source-tiff /path/to/inland-16km-5m-6412.tif \
  --out /path/to/review-output
```

The exact source export has SHA-256 `3de3040bbc1876050f6575bca18fe86e2d829dd23adc76e1785d412025c05f1e`. The pinned request is in the provenance file. The raw 39 MiB F32 export is a bake input rather than a browser asset. The baker rejects changed source or output hashes so a service revision or encoder difference requires review; it does not silently redefine the accepted field.

Only this 16 km pair ships. The 2 km and 8 km proof crops remain development artifacts. The paired download is 19,969,944 bytes (19.045 MiB). Retained CPU height bytes, CPU normal pixels, GPU RG8 height, and GPU RGBA normal mips total approximately 130.208 MiB before driver overhead. Decode and SHA-256 staging are transient additional memory. Keep the geographic source fixed for the page lifetime; runtime mesh quality changes do not replace collision heights.
