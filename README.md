# chrishall.co

Personal homepage for Chris Hall — media operator. The public site at chall.net
is served by Vercel from the public mirror's `main` branch. The mirror also
retains its GitHub Pages deployment.

The homepage is set as an encyclopedia article about Chris: a title, a notice
that Hall Media takes on client work, an info box with his portrait, and
sections for early life, career, selected clients, disciplines, contact,
references, and external links. It is a professional, outward-facing page.
It does not mention the side projects that live in this folder.

Its markup and styles live in `index.html`; there is no script. The two
responsive portrait files are `images/chris-hall-2026-600.jpg` and
`images/chris-hall-2026.jpg` (a 4:5 crop of the August 2026 portrait). The
info box floats right on wide windows. At 720px and below it becomes a
full-width block under the notice, the portrait crops to a square, and the
tables scroll sideways inside themselves when they do not fit.

Every "[edit]" link opens an email to Chris. The category links jump to the
matching section of the page.

Facts on the page come from Chris's LinkedIn profile and his own statements.
Keep these exact when editing:

- He joined Y Combinator in January 2026. His work for Garry Tan (since March
  2020) and on The Social Radars predates that and was done through Hall
  Media. Y Combinator is his employer and is not listed as a client.
- Carolynn Levy is spelled with two n's.
- The Y Combinator YouTube subscriber figure is rounded from the channel page;
  re-check it before changing the wording.

The portrait has a responsive, high-priority preload; keep its `imagesrcset`
and `imagesizes` synchronized with the image's `srcset` and `sizes`.

Preview from this directory:

```sh
python3 -m http.server 8874 --bind 127.0.0.1
```

Open <http://127.0.0.1:8874/>. There is no install or build step. Check the
homepage at narrow phone, tablet, laptop, and ultrawide sizes (320px through
1920px, including both sides of 720px) and at 200–400% browser zoom. Check
the info box, both tables, portrait loading, horizontal overflow, keyboard
focus on links, and that every in-page link lands on its section.
