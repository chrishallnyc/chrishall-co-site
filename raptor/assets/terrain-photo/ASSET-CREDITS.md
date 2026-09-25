# Photographed terrain material detail

The two packed material maps derive from Poly Haven CC0 assets. The [Poly Haven asset license](https://polyhaven.com/license) permits modification and redistribution, including commercial use.

- [Rock Face 03](https://polyhaven.com/a/rock_face_03): Dario Barresi, photography; Rico Cilliers, processing. Published physical width: 2.7 m.
- [Snow 02](https://polyhaven.com/a/snow_02): Rob Tuytel. Published physical width: 2 m.

`manifest.json` records the original six 2K PNG URLs, authors, source byte hashes, bit depths, decoded packed hashes and conversion parameters. Only the two derived 512² RGBA16F gzip maps are shipped; original full-resolution photos and website previews are not included.

The packed channels are tangent slopes U/V, `roughness⁴ + 2 × squared slope`, and a bounded zero-mean linear-luminance residual. Source roughness/normal moments are formed before downsampling. Diffuse sRGB is decoded before luminance extraction; a 0.3 m low-frequency component and mean normal tilt are removed. Source rows flip once for the OpenGL normal orientation. AO is unused.

The shader mixes rotated copies at the published width and 1.431 times that width, with uniform physical enlargement of the relief. Slopes and intrinsic roughness are unchanged by that enlargement; only their direction rotates. Conservative moments retain unresolved detail. This is generic near-surface material appearance, not a claim that these scans depict Valdez, additional geographic imagery, or higher-resolution collision geometry.

The geographic aerial photograph remains the source of broad terrain color. Loader failure or its four-second deadline retains the existing material. LOW/MED and other fronts do not request these data. Actual enablement is fixed at boot and remains subject to the game's graphics policy.
