# chrishall.co

Personal homepage for Chris Hall — media operator. The public site at chall.net
is served by Vercel from the public mirror's `main` branch. The mirror also
retains its GitHub Pages deployment.

The homepage pairs a seated black-and-white portrait with the career timeline.
Its markup and styles live in `index.html`; the two responsive portrait assets
are in `images/`. The biography uses a native disclosure. The timeline retains
its desktop rails on wide mouse-driven layouts, with fluid type, portrait,
and rail spacing inside a bounded 1440px composition. Below 1280px (80em),
or on devices with a primary coarse pointer and no hover, it switches to a
stacked header and horizontal skill/client bands. The bands use two columns
on tablets and one column at 600px and below. Extra-narrow panes below 320px
use a smaller portrait and wrapping labels.
Skill disclosures preserve their state and keyboard focus across viewport
changes; height-only browser chrome changes do not rebuild them. Timeline
size changes also recalculate desktop rails, keeping them aligned after reflow.

The portrait has a responsive, high-priority preload; keep its `imagesrcset`
and `imagesizes` synchronized with the image's `srcset` and `sizes`. The image
files retain their original encoding and quality. Desktop rails cache each
milestone's geometry and are inserted together. The size observer skips its
unchanged initial notification, avoiding redundant startup builds while
retaining later reflow updates (with a load fallback for older browsers).

Preview from this directory:

```sh
python3 -m http.server 8874 --bind 127.0.0.1
```

Open <http://127.0.0.1:8874/>. There is no install or build step. Check the
homepage at narrow phone, tablet, laptop, and ultrawide sizes (240px through
3840px, including both sides of 320px, 600px, and 1280px). Include landscape
tablets with touch emulation, short windows, and 200–400% browser zoom.
Check the biography, skill disclosures, keyboard interaction, portrait
loading, horizontal overflow, and clearance below rail labels. Open a skill
and resize the viewport width and height to check state and focus retention.
