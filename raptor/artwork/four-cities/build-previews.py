#!/usr/bin/env python3
"""Build smaller gallery previews and contact sheets without image API requests.

Run with: uv run --with pillow python artwork/four-cities/build-previews.py
"""

import argparse
import json
import shutil
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile

from PIL import Image, ImageDraw, ImageFont, ImageOps


HERE = Path(__file__).resolve().parent
RAPTOR = HERE.parents[1]
OUTPUT = RAPTOR / "output/imagegen/four-cities"
FONT = RAPTOR / "arcade/assets/silkscreen.ttf"
INK, PAPER, MINT, DIM = "#10182e", "#fff2ce", "#95e6db", "#a6b1c3"


def gallery_preview(item):
    """Keep pixel edges sharp; encode the 1280px display image as lossless WebP."""
    source = (HERE / item["file"]).resolve()
    target = (HERE / item["preview"]).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as original:
        image = original.convert("RGBA" if "A" in original.getbands() else "RGB")
        width = min(1280, image.width)
        height = round(image.height * width / image.width)
        image = image.resize((width, height), Image.Resampling.NEAREST)
        # Local viewers can remain open while previews rebuild; never expose a partial file.
        temporary = None
        try:
            with NamedTemporaryFile(prefix=f".{target.stem}-", suffix=".webp", dir=target.parent, delete=False) as stream:
                temporary = Path(stream.name)
                image.save(stream, format="WEBP", lossless=True, method=6)
            temporary.replace(target)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return target


def contact_sheet(items, title, filename):
    margin, gap, width, image_height, caption_height = 48, 32, 960, 600, 96
    header, footer = 156, 64
    rows = (len(items) + 1) // 2
    height = header + rows * (image_height + caption_height) + (rows - 1) * gap + footer
    sheet = Image.new("RGB", (2048, height), INK)
    draw = ImageDraw.Draw(sheet)
    heading = ImageFont.truetype(str(FONT), 42)
    label = ImageFont.truetype(str(FONT), 24)
    small = ImageFont.truetype(str(FONT), 16)
    draw.text((margin, 32), "RAPTOR / PIXEL WING", font=heading, fill=PAPER)
    draw.text((margin, 99), title, font=small, fill=MINT)
    for index, item in enumerate(items):
        x = margin + (index % 2) * (width + gap)
        y = header + (index // 2) * (image_height + caption_height + gap)
        image_path = (HERE / item["file"]).resolve()
        with Image.open(image_path) as original:
            image = ImageOps.contain(original.convert("RGB"), (width, image_height), Image.Resampling.NEAREST)
        draw.rectangle((x, y, x + width - 1, y + image_height - 1), fill="#0b1222")
        sheet.paste(image, (x + (width - image.width) // 2, y + (image_height - image.height) // 2))
        draw.text((x, y + image_height + 17), item["title"], font=label, fill=PAPER)
        # Titles are short; subtitles are wrapped at word boundaries when needed.
        line, lines = "", []
        for word in item["subtitle"].split():
            candidate = f"{line} {word}".strip()
            if draw.textlength(candidate, font=small) > width:
                lines.append(line)
                line = word
            else:
                line = candidate
        lines.append(line)
        for offset, line in enumerate(lines):
            draw.text((x, y + image_height + 55 + offset * 20), line, font=small, fill=DIM)
    draw.text((margin, height - 37), "FOUR-CITY ART COLLECTION / VISUAL DEVELOPMENT / 2026", font=small, fill=DIM)
    target = OUTPUT / filename
    sheet.save(target, optimize=True)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview-dir", type=Path, help="Also copy overview PNGs here.")
    parser.add_argument("--archive", type=Path, help="Write a portable gallery ZIP at this path.")
    parser.add_argument("--previews-only", action="store_true", help="Only rebuild the lossless WebP gallery previews.")
    args = parser.parse_args()
    if args.previews_only and (args.preview_dir or args.archive):
        parser.error("--previews-only cannot be combined with overview copies or an archive")
    manifest = json.loads((HERE / "manifest.json").read_text())
    inventory, gallery_previews = [], []
    for item in manifest:
        path = (HERE / item["file"]).resolve()
        preview = gallery_preview(item)
        gallery_previews.append(preview)
        with Image.open(path) as image:
            image.load()
            inventory.append({"file": path.name, "width": image.width, "height": image.height,
                              "bytes": path.stat().st_size, "preview": preview.name,
                              "preview_bytes": preview.stat().st_size})
    original_bytes = sum(item["bytes"] for item in inventory)
    preview_bytes = sum(item["preview_bytes"] for item in inventory)
    savings = {"original_bytes": original_bytes, "preview_bytes": preview_bytes,
               "saved_bytes": original_bytes - preview_bytes,
               "saved_percent": round((1 - preview_bytes / original_bytes) * 100, 1)}
    if args.previews_only:
        print(json.dumps({"boards": inventory, "gallery_previews": [str(path) for path in gallery_previews],
                          "gallery_savings": savings}, indent=2))
        return
    previews = [
        contact_sheet(manifest[:4], "NEW YORK / SAN FRANCISCO / AUSTIN / WASHINGTON, DC", "city-overview.png"),
        contact_sheet(manifest[4:], "TITLE / AIRCRAFT / ENEMIES / LANDMARKS / EFFECTS / INTERFACE", "art-kit-overview.png"),
        contact_sheet(manifest, "THE COMPLETE TEN-BOARD COLLECTION", "complete-overview.png"),
    ]
    if args.preview_dir:
        args.preview_dir.mkdir(parents=True, exist_ok=True)
        for path in previews:
            shutil.copy2(path, args.preview_dir / path.name)
    if args.archive:
        args.archive.parent.mkdir(parents=True, exist_ok=True)
        files = list(HERE.glob("*")) + [(HERE / item["file"]).resolve() for item in manifest] + gallery_previews + previews + [FONT, FONT.with_name("FONT-LICENSE.txt")]
        with ZipFile(args.archive, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(files):
                if path.is_file():
                    archive.write(path, Path("raptor") / path.relative_to(RAPTOR))
        print(f"Archive: {args.archive}")
    print(json.dumps({"boards": inventory, "previews": [str(path) for path in previews],
                      "gallery_previews": [str(path) for path in gallery_previews],
                      "gallery_savings": savings}, indent=2))


if __name__ == "__main__":
    main()
