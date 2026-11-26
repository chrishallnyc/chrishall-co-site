# chrishall.co

Personal homepage for Chris Hall — media operator. The public site at chall.net
is served by Vercel from the public mirror's `main` branch. The mirror also
retains its GitHub Pages deployment.

The homepage has two stages in one page.

1. **The poster.** A full-screen photograph of Chris set as a film poster. His
   name is lettered on the wall and passes behind his head, and a billing
   block of his real credits ends with the contact address.
2. **The article.** An encyclopedia-style article about him: a notice that Hall
   Media takes on client work, an info box with his portrait, and sections for
   early life, career, selected clients, disciplines, contact, references, and
   external links.

The article is a white sheet that rests at the foot of the poster. Its visible
edge, with a grabber and the article's own title, is the cue that there is
more. Scrolling slides the sheet up over the poster, which stays fixed behind
it. Where the browser supports scroll-driven animation the photograph also
pushes in and darkens, the lettering lifts away, and the sheet's corners
square off; elsewhere, and with reduced motion, the sheet simply slides over.

It is a professional, outward-facing page. It does not mention the side
projects that live in this folder.

Markup and styles live in `index.html`; there is no script. Files it uses:

- `images/poster-waist-1600.jpg`, `images/poster-waist-2400.jpg` — the poster
  photograph for every window wider than 4:5.
- `images/poster-waist-mask.png` — a cut-out of Chris in the wide photograph
  (black, with his outline in the alpha channel). A second copy of the
  photograph is drawn through it on top of the name, which is what puts the
  name behind his head. It was made with the macOS person-segmentation
  framework. If the wide photograph is ever re-cropped, the mask must be
  regenerated from the same crop, and both must keep the same aspect ratio
  and the same `object-position` / `mask-position`.
  Browsers keep images for a day, so a re-cropped photograph must also get a
  new file name (as these did: `poster-wide-*` became `poster-waist-*`), or
  returning visitors see the new layout over the old picture.
- `images/poster-tall-800.jpg`, `images/poster-tall-1170.jpg` — the upright
  crop for phones and narrow windows. He stands below the name there, so no
  cut-out is used and the credits sit centred at the foot.
- `images/chris-hall-2026-600.jpg`, `images/chris-hall-2026.jpg` — the info box
  portrait. All the photographs are crops of the August 2026 portrait by
  Oliver Covrett and carry only his credit in their metadata.
- `fonts/newsreader-display-500.woff2` — the name. Newsreader at its display
  size and weight 500, cut down to letters and basic punctuation. A character
  outside that set falls back to a system font, so re-cut the file (fontTools
  `varLib.instancer` then `subset`) before using one.
- `fonts/six-caps-credits.woff2` — the billing block. Six Caps, the complete
  Latin file. It is far narrower than any system font, so the stylesheet also
  declares two width-matched stand-ins built from local Arial.

The layout of the name depends on two measurements of the wide photograph:
his head sits at the horizontal centre, and the gap between "Chris" and
"Hall" is sized to it. The credits start a fixed distance to the right of his
sleeve and their type is sized to the room that leaves.

In the article the info box floats right on wide windows. At 720px and below
it becomes a full-width block under the notice, the portrait crops to a
square, and the two tables stack into single lists.

Every "[edit]" link opens an email to Chris. The category links jump to the
matching section of the page.

Facts on the page come from Chris's LinkedIn profile and his own statements.
Keep these exact when editing:

- He joined Y Combinator in January 2026. His work for Garry Tan (since March
  2020) and on The Social Radars predates that and was done through Hall
  Media. Y Combinator is his employer and is not listed as a client.
- Carolynn Levy is spelled with two n's.
- The contact address is `chris@chall.net`, everywhere on the page.
- The Y Combinator YouTube subscriber figure is rounded from the channel page;
  re-check it before changing the wording.

The poster photograph has a responsive, high-priority preload for each of its
two crops; keep each `imagesrcset` and `media` synchronized with the matching
`<source>` or `<img>`.

Preview from this directory:

```sh
python3 -m http.server 8874 --bind 127.0.0.1
```

Open <http://127.0.0.1:8874/>. There is no install or build step. Check the
page at narrow phone, tablet, laptop, and ultrawide sizes (320px through
1920px, both sides of 720px, upright and landscape) and at 200–400% zoom.
On the poster, check that the name sits on the wall above his head and the
credits stay readable. Scroll slowly from the top and check the hand-off, then
check it again with reduced motion turned on. In the article, check the info
box, both tables, horizontal overflow, keyboard focus on links, and that every
in-page link lands on its section.
