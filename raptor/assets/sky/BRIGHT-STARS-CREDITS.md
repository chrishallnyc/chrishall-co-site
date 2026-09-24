# Bright-star catalog

`bright-stars-v6.bin` is a deterministic subset of **NASA/HEASARC BSC5P**, the archive's corrected version of the Yale Bright Star Catalogue, 5th Revised Edition (Preliminary Version): Hoffleit, D. and Warren, W. H. Jr. (1991). Credit: Yale University Observatory and NASA/GSFC HEASARC.

The asset contains 5,080 stellar entries with catalog V magnitude ≤6.0. Fields are HR identifier, J2000 right ascension/declination, V magnitude, available B−V color, and J2000 tangential proper motions. Nonstellar HR entries are excluded. Missing B−V is explicitly marked; missing proper motion is zero. Runtime color is a restrained display approximation using the existing star palette, not a reconstructed spectrum.

- Authoritative table and column documentation: https://heasarc.gsfc.nasa.gov/W3Browse/all/bsc5p.html
- Catalog citation: Hoffleit, D. and Warren, W. H. Jr., 1991, *The Bright Star Catalogue, 5th Revised Edition (Preliminary Version)*, CDS catalog V/50.
- Dataset-specific license declaration: https://catalog.data.gov/dataset/bright-star-catalog (publisher NASA/HEASARC; `license` links to the U.S. government works terms).
- Referenced license terms: https://www.usa.gov/government-works (now redirects to https://www.usa.gov/government-copyright). The dataset is distributed under that government-works/public-domain declaration; no Creative Commons license is invented or attached here.
- HEASARC describes its archived materials as freely available for use: https://heasarc.gsfc.nasa.gov/docs/HHP_heasarc_info.html
- Downloaded directly from NASA's TAP endpoint on 2026-09-24. No ESA Hipparcos data is bundled; ESA's current Hipparcos catalog terms include a noncommercial restriction.

Source query, requested as VOTable BINARY:

```sql
SELECT hr,ra,dec,vmag,bv_color,pmra,pmdec,alt_name
FROM bsc5p WHERE vmag <= 6.5 ORDER BY hr
```

Endpoint: `https://heasarc.gsfc.nasa.gov/xamin/vo/tap/sync`, query parameters `REQUEST=doQuery`, `LANG=ADQL`, `FORMAT=votable`, and `QUERY` as above. The baker applies the final V≤6.0 selection and writes little-endian binary records. Rebuild with `node bakery/bake_bright_stars.mjs downloaded.vot assets/sky/bright-stars-v6.bin`.

Source VOTable SHA-256: `70ec7e499322ed8398caccb173e20a2c9556af1bf3d91fa33a7b1a3148e24f3f`.

Baked asset SHA-256: `d5f018a96c2218092c9ab821905c49ec4c6fde95ed2eaf7025059f76aae348ea` (91,464 bytes).

The runtime uses an independently implemented IAU 1976 precession formula, sufficient for the game's mean-of-date Moon and sidereal frame. Formula reference: U.S. Coast Guard Navigation Center, [IS-GPS-705](https://navcen.uscg.gov/sites/default/files/pdf/gps/IS_GPS_705.pdf), precession fundamental angles. The implementation was numerically checked against the [IAU SOFA 2023-10-11](https://www.iausofa.org/2023-10-11c) `pmat76` validation result. No SOFA software is bundled and no SOFA endorsement is implied.
