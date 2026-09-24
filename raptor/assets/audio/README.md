# Afterburner texture

`f119-afterburner.wav` is an eight-second mono PCM16 loop (48 kHz, 768,044
bytes). The original recording is credited on `/audio-credits.html`; exact
source identifiers, hashes, and processing are in `sources.json`.

The loop supports afterburner only. Idle, dry power, airflow, airframe and
combat remain authored synthesis. The two engine channels use different loop
offsets and slight playback-rate variation. If fetching or decoding fails,
the procedural afterburner remains available; flight startup does not wait
for the asset.

Reauthor using `audio-tools/author_textures.py` with the decoded official
source recording. The script's `a-grounded` output matches the shipped file.
The source video and alternative audition candidates are development material
under `.context/`, not runtime downloads or game dependencies.
