# Graphics 1.7 validation

This release was refined through six passes: redundant rendering work;
cloud morphology; cloud lighting and source resolution; geographic terrain and
surface materials; observer sky and lighting transitions; integration, moving
resource publication, quality presets and release checks. Native comparisons
used Chrome's Metal backend on an M1 Max at a recorded canvas size and camera,
with fixed atmosphere, cloud/water clocks and exposure. Other applications share
this machine, so frame intervals are observations rather than hardware guarantees.

## Seven measured improvements

These percentages describe individual measured quantities. They are not an
aggregate realism score or a claim that every view becomes 25% faster.

| Area | Comparison and result | Scope |
| --- | --- | --- |
| Cloud source detail | High 192³/96³ versus Standard 128³/64³: 35–46% lower interpolation RMSE across all eight channels. | 20,000 independent samples of the same continuous seeded fields; 30.375 MiB decoded storage. |
| Cloud lighting | 31.5% / 34.0% / 47.1% lower transfer error in Nellis / Valdez / Marianas. | Production High density, 256 occupied rays per front, compared with dense 4 m integration; 2 m convergence checked. Some individual rays worsen. |
| Nevada image alignment | 79.3% lower high-pass image-registration error. | Independent one-metre geographic witnesses; corrected recoverable NAIP blocks, preserved Sentinel fill. |
| Nearby aerial detail | One-metre imagery replaces approximately four-metre base sampling: 75% smaller ground pixel spacing. | Valid source coverage in the 12.288 km local grid, not the entire world. Sixteen samples cover the former ground pixel area. |
| Steep material projection | 66.3% lower projection distortion on steep slopes. | 1,360 source points with slope at least 60°; the three-plane projection slightly increases stretch on some shallow slopes. |
| Ocean shoreline work | FFT terrain lookups decrease from three to one; Gerstner from two to one. | 67% / 50% fewer lookups for the affected shading work. Far-shore shading also skips 20 unnecessary noise sine evaluations. Not a whole-frame speedup. |
| Day/night program changes | Eighteen newly created lighting programs decrease to zero. | Native repeated day/night/day transitions with stable light graphs and celestial warmup. Frame latency remains machine-dependent. |

The final production High cloud lighting A/B used the same compiled scene and
noise assets: direct-column median frame times of 183.8 and 156.9 ms versus
127.6 and 106.9 ms with the cache, reductions of 30.6% and 31.9%. These are
alternating stationary windows on a busy shared machine, after publication;
they isolate the cache rather than compare the entire release against 1.4.
The new detail can increase rendering cost. A close snow scene at native 4K
measured about 31.6 ms with scanned material detail, compared with 24.3 ms in
an earlier procedural-material comparison. No 25% cold-start or universal FPS
improvement is claimed.

The observer-sky cache reduces scattering marches while keeping direct horizon
integration. The native HDR comparison's visible-direction p95 error stayed
below 0.087%, with maximum below 0.176%. Extremely dim below-horizon directions
can have larger relative error. Repeated 4K windows showed roughly 5–7% lower
full-frame cost in the controlled sky view; this is separate from cloud timing.

## Correctness and limits

- Normal compiled scene/cloud renders preserve full-frame cloud metadata,
  opacity, physical depth and motion exactly with the light cache off/on/off.
  The RGB result changes, proving that the comparison actually uses the cache.
- Actual native prefix textures match the independent CPU producer within
  0.14% relative L2 in the tested sources. This is producer/filter fidelity,
  separate from the dense light-transport accuracy study above.
- Native movement at 240 m/s exercises complete texture publication, retained
  active-source validity, a public time change, and a 10 km camera cut/recovery.
  Partial volumes are never visible; original integration remains the fallback.
- Geographic movement exercises GPU tile replacement, upload-based fades,
  altitude/coverage fallback and fixed four-layer residency. Optional loaders
  have deadlines, checksum/shape checks and stale-result rejection.
- Full material graphs cover both shader backends: terrain stays within the
  standard 16 sampled-texture limit; the raw cloud path uses at most 12.
- High adds a 15.49 MB compressed cloud download, local imagery requests, and
  optional 3.91 MB scanned materials. The full local imagery package is 22.07 MB,
  but only the desired nearby tiles are fetched. Native 4K remains demanding.

Run permanent asset, controller, source geometry and shader checks with:

```sh
node --import ./raptor/qa/register-three.mjs --test raptor/qa/*.test.mjs
```

See [GRAPHICS.md](GRAPHICS.md) for contracts, comparison flags, source credits,
resource budgets and fallback behavior. Browser evidence is retained in the
workspace's `.context/graphics-eight/` directory, including rejected candidates
and invalid test runs, so unsuccessful experiments are not counted as passes.
