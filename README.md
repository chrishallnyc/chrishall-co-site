# chrishall.co

Personal homepage for Chris Hall — media operator. Static site served via GitHub Pages.

The homepage pairs a seated black-and-white portrait with the career timeline.
Its markup and styles live in `index.html`; the two responsive portrait assets
are in `images/`. The biography uses a native disclosure. The timeline retains
its desktop rails and switches to horizontal skill/client bands on phones.

Preview from this directory:

```sh
python3 -m http.server 8874 --bind 127.0.0.1
```

Open <http://127.0.0.1:8874/>. There is no install or build step. Check the
homepage at desktop and phone widths, including the biography disclosure and
timeline interactions, when changing it.
