# chrishall.co

Personal homepage for Chris Hall — media operator. Static site served via GitHub Pages.

The homepage pairs a seated black-and-white portrait with the career timeline.
Its markup and styles live in `index.html`; the two responsive portrait assets
are in `images/`. The biography uses a native disclosure. The timeline retains
its desktop rails and switches to horizontal skill/client bands at 1024px and
below. The bands use two columns on tablets and one column at 600px and below.
Skill disclosures preserve their state and keyboard focus across viewport
changes; height-only browser chrome changes do not rebuild them.

Preview from this directory:

```sh
python3 -m http.server 8874 --bind 127.0.0.1
```

Open <http://127.0.0.1:8874/>. There is no install or build step. Check the
homepage at desktop, tablet, and phone widths (including 320px and both sides
of the 600px and 1024px breakpoints). Check the biography, skill disclosures,
keyboard interaction, portrait loading, and horizontal overflow. Open a skill
and resize the viewport width and height to check state and focus retention.
