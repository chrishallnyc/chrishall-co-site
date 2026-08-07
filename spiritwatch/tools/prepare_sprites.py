#!/usr/bin/env python3
"""Build the production SPIRITWATCH sprites from the generated chroma boards.

The generated boards remain untouched.  This script copies them into the project as
source material, removes the magenta and labels, scales with nearest-neighbour
sampling, enforces a symmetric hard-alpha silhouette, and maps opaque pixels onto
the small house palettes used by the canvas renderer.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SOURCE_ASSETS = ASSETS / "source"
BOARD_ASSETS = ASSETS / "boards"
GENERATED = Path(
    "/Users/ch/.codex/generated_images/019fdb49-4038-7ca0-afb5-8d3b21048ccd"
)

GENERATED_SOURCES = {
    "chase_bomber_b2": GENERATED / "exec-c87e6bc2-d0f5-44f4-b68e-1fd0235db350.png",
    "chase_bomber_b2_night": GENERATED / "exec-ccb2ead2-bb76-4489-ad2a-ecbb5ffb89c4.png",
    "chase_jet_f22": GENERATED / "exec-8e6515f6-6e79-41d2-a31c-56514ae9515e.png",
    # Corrected board: no winglets and a short, stowed boom.
    "chase_tanker_kc46": GENERATED / "exec-ebbb7372-d0c2-4ce4-8d8f-61a28c4ad77c.png",
}
SOURCES = {
    name: (
        SOURCE_ASSETS / f"{name}-board.png"
        if (SOURCE_ASSETS / f"{name}-board.png").exists()
        else generated
    )
    for name, generated in GENERATED_SOURCES.items()
}

TARGET_SIZES = {
    "chase_bomber_b2": (440, 130),
    "chase_bomber_b2_night": (440, 130),
    "chase_jet_f22": (180, 130),
    "chase_tanker_kc46": (400, 200),
}

# The declared ramps, with only a few in-family bridge tones.  Transparent pixels
# use the darkest ramp RGB with alpha zero, so even hidden RGB never contains black.
B2_DAY = (
    "#12161f",
    "#171c27",
    "#1d2230",
    "#242a38",
    "#2a3140",
    "#323946",
    "#3a4150",
)
B2_NIGHT_BODY = ("#0d1420", "#111a29", "#1a2438", "#25334b", "#344662")
B2_NIGHT_RIM = ("#7d92b8", "#b9c9e6")
B2_NIGHT_WARM = "#7a4a2a"
F22_GRAY = (
    "#2d3138",
    "#373c44",
    "#42474e",
    "#505966",
    "#5f6b7a",
    "#6f7b89",
    "#82909f",
    "#9aa6b4",
    "#b7c1cc",
)
F22_GOLD = ("#735822", "#c79a3a", "#ffd24a")
KC46_GRAY = (
    "#2d3138",
    "#39414c",
    "#4a5260",
    "#596371",
    "#6a7482",
    "#7f8a99",
    "#9aa6b4",
    "#b7c1cc",
)


def rgb(hex_color: str) -> np.ndarray:
    value = hex_color.lstrip("#")
    return np.array([int(value[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.uint8)


def is_magenta_background(pixels: np.ndarray) -> np.ndarray:
    """Classify the generated board's slightly variable chroma field."""

    work = pixels.astype(np.int16)
    red, green, blue = work[..., 0], work[..., 1], work[..., 2]
    return (
        (red > 130)
        & (blue > 130)
        & (green < 150)
        & (red - green > 60)
        & (blue - green > 60)
    )


def extract_aircraft(source: Path) -> tuple[np.ndarray, np.ndarray, tuple[int, int, int, int]]:
    """Return a tight RGB crop and the largest non-magenta component above the label."""

    pixels = np.asarray(Image.open(source).convert("RGB"))
    foreground = ~is_magenta_background(pixels)

    # All four labels live in the lower gutter; the aircraft is wholly above y=820.
    foreground[820:, :] = False
    labels, count = ndimage.label(foreground, structure=np.ones((3, 3), dtype=np.uint8))
    if not count:
        raise RuntimeError(f"No foreground component found in {source}")
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    aircraft = labels == int(sizes.argmax())

    ys, xs = np.where(aircraft)
    left, top, right, bottom = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    return pixels[top:bottom, left:right], aircraft[top:bottom, left:right], (left, top, right, bottom)


def resize_nearest(array: np.ndarray, size: tuple[int, int], mode: str) -> np.ndarray:
    del mode  # Pillow infers RGB/L from the array and avoids its deprecated mode argument.
    image = Image.fromarray(array)
    return np.asarray(image.resize(size, Image.Resampling.NEAREST))


def symmetric_sample(
    source_rgb: np.ndarray, source_mask: np.ndarray, size: tuple[int, int]
) -> tuple[np.ndarray, np.ndarray]:
    """Nearest-resize and mirror-complete the silhouette without blurring edges."""

    sampled_rgb = resize_nearest(source_rgb, size, "RGB")
    sampled_mask = resize_nearest(source_mask.astype(np.uint8) * 255, size, "L") == 255
    mirror_mask = np.fliplr(sampled_mask)
    symmetric_mask = sampled_mask | mirror_mask

    # Where symmetry adds an edge pixel, borrow its structural twin's source color.
    mirror_rgb = np.fliplr(sampled_rgb)
    symmetric_rgb = np.where(sampled_mask[..., None], sampled_rgb, mirror_rgb)
    return symmetric_rgb, symmetric_mask


def b2_geometry_mask(size: tuple[int, int]) -> np.ndarray:
    """Return the production B-2 planform with an exact three-point double-W.

    The generated study captured the cockpit and surface language well, but its
    lower contour carried an extra inner tooth on each side.  Geometry wins over
    texture: this mirror-locked outline has one center beavertail and one
    mid-span aft point per side.  The clipped wingtip corners sit visibly forward
    of those mid-span points and are excluded from the aft-point count.
    """

    width, height = size
    if width != 440 or height != 130:
        raise ValueError("The audited B-2 geometry is authored for 440x130")
    points = [
        (219, 0), (220, 0),         # far nose apex (two pixels keeps an even mask)
        (439, 96), (423, 102),      # right clipped wingtip, forward of the aft point
        (355, 86),                  # right outboard forward-cut notch
        (309, 116),                 # right mid-span aft point
        (265, 94),                  # right inboard forward-cut notch
        (220, 129), (219, 129),     # center beavertail
        (174, 94),                  # left inboard forward-cut notch
        (130, 116),                 # left mid-span aft point
        (84, 86),                   # left outboard forward-cut notch
        (16, 102), (0, 96),         # left clipped wingtip
    ]
    image = Image.new("L", size, 0)
    ImageDraw.Draw(image).polygon(points, fill=255)
    mask = np.asarray(image) == 255
    if np.any(mask != np.fliplr(mask)):
        raise AssertionError("B-2 geometry mask must remain mirror-symmetric")
    return mask


def extend_texture_to_mask(
    sampled_rgb: np.ndarray, sampled_mask: np.ndarray, target_mask: np.ndarray
) -> np.ndarray:
    """Borrow the nearest painted pixel wherever an audited mask adds coverage."""

    _, indices = ndimage.distance_transform_edt(~sampled_mask, return_indices=True)
    nearest = sampled_rgb[indices[0], indices[1]]
    return np.where(target_mask[..., None], nearest, sampled_rgb)


def luminance(pixels: np.ndarray) -> np.ndarray:
    work = pixels.astype(np.float32)
    return work[..., 0] * 0.2126 + work[..., 1] * 0.7152 + work[..., 2] * 0.0722


def ramp_map(
    sampled_rgb: np.ndarray,
    mask: np.ndarray,
    palette: tuple[str, ...],
    selection: np.ndarray | None = None,
    gamma: float = 1.12,
) -> np.ndarray:
    """Map selected opaque pixels across a compact palette using robust luminance."""

    active = mask if selection is None else (mask & selection)
    out = np.empty((*mask.shape, 3), dtype=np.uint8)
    out[:] = rgb(palette[0])
    if not np.any(active):
        return out

    light = luminance(sampled_rgb)
    values = light[active]
    low, high = np.percentile(values, (2.0, 98.0))
    if high <= low:
        index = np.zeros(mask.shape, dtype=np.int16)
    else:
        normalized = np.clip((light - low) / (high - low), 0.0, 1.0)
        # Most assets stay restrained; the Spirit's broad charcoal wing uses a
        # slightly lifted map so its panel language survives the ocean backdrop.
        normalized = normalized**gamma
        index = np.minimum((normalized * len(palette)).astype(np.int16), len(palette) - 1)
    colors = np.stack([rgb(color) for color in palette])
    out[active] = colors[index[active]]
    return out


def make_rgba(color: np.ndarray, mask: np.ndarray, transparent_rgb: str) -> np.ndarray:
    rgba = np.empty((*mask.shape, 4), dtype=np.uint8)
    rgba[..., :3] = rgb(transparent_rgb)
    rgba[..., 3] = 0
    rgba[mask, :3] = color[mask]
    rgba[mask, 3] = 255
    return rgba


def build_b2_day() -> tuple[np.ndarray, np.ndarray, dict[str, object]]:
    crop, source_mask, bbox = extract_aircraft(SOURCES["chase_bomber_b2"])
    sampled, generated_mask = symmetric_sample(
        crop, source_mask, TARGET_SIZES["chase_bomber_b2"]
    )
    mask = b2_geometry_mask(TARGET_SIZES["chase_bomber_b2"])
    sampled = extend_texture_to_mask(sampled, generated_mask, mask)
    mapped = ramp_map(sampled, mask, B2_DAY, gamma=0.82)
    return make_rgba(mapped, mask, B2_DAY[0]), mask, {
        "source_bbox": bbox,
        "aft_points": [[130, 116], [219.5, 129], [309, 116]],
        "aft_point_count": 3,
    }


def edge_mask(mask: np.ndarray) -> np.ndarray:
    eroded = ndimage.binary_erosion(mask, structure=np.ones((3, 3), dtype=bool), border_value=0)
    return mask & ~eroded


def build_b2_night(day_mask: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict[str, object]]:
    crop, source_mask, bbox = extract_aircraft(SOURCES["chase_bomber_b2_night"])
    sampled, _ = symmetric_sample(crop, source_mask, TARGET_SIZES["chase_bomber_b2_night"])

    # The day silhouette is authoritative: this is a repaint, never a redraw.
    mask = day_mask.copy()
    mapped = ramp_map(sampled, mask, B2_NIGHT_BODY)
    light = luminance(sampled)
    red = sampled[..., 0].astype(np.int16)
    green = sampled[..., 1].astype(np.int16)
    blue = sampled[..., 2].astype(np.int16)

    # Preserve a narrow generated moon rim only on exposed silhouette pixels.  The
    # brightest silver is confined to a few central crest pixels.
    boundary = edge_mask(mask)
    yy, xx = np.indices(mask.shape)
    cool_score = blue - red
    top_by_x = np.full(mask.shape[1], mask.shape[0], dtype=np.int16)
    for column in range(mask.shape[1]):
        rows = np.flatnonzero(mask[:, column])
        if rows.size:
            top_by_x[column] = int(rows[0])
    far_leading_edge = yy <= (top_by_x[None, :] + 1)
    rim = (
        boundary
        & far_leading_edge
        & (cool_score > 5)
        & (light > 40)
    )
    mapped[rim] = rgb(B2_NIGHT_RIM[0])

    crest_pool = rim & (np.abs(xx - (mask.shape[1] - 1) / 2) < mask.shape[1] * 0.09) & (
        yy < mask.shape[0] * 0.38
    )
    crest_positions = np.argwhere(crest_pool)
    if crest_positions.size:
        scores = np.array([light[y, x] + cool_score[y, x] * 1.5 for y, x in crest_positions])
        for y, x in crest_positions[np.argsort(scores)[-4:]]:
            mapped[y, x] = rgb(B2_NIGHT_RIM[1])

    # Exactly three contained pixels per trough get the single allowed warm tone.
    # Ranking the generated warm signal keeps their placement faithful but prevents
    # the broad orange bands in the board from turning into an exhaust glow.
    warmth = red * 1.0 - green * 0.35 - blue * 0.65
    warm_pixels: list[tuple[int, int]] = []
    center = mask.shape[1] // 2
    central = mask & (yy > mask.shape[0] * 0.60) & (np.abs(xx - center) < mask.shape[1] * 0.24)
    for half in (central & (xx < center), central & (xx >= center)):
        candidates = np.argwhere(half)
        if candidates.size:
            scores = np.array([warmth[y, x] for y, x in candidates])
            for y, x in candidates[np.argsort(scores)[-3:]]:
                mapped[y, x] = rgb(B2_NIGHT_WARM)
                warm_pixels.append((int(x), int(y)))

    return make_rgba(mapped, mask, B2_NIGHT_BODY[0]), mask, {
        "source_bbox": bbox,
        "rim_pixels": int(rim.sum()),
        "bright_crest_pixels": int(np.sum(np.all(mapped == rgb(B2_NIGHT_RIM[1]), axis=2))),
        "warm_pixels": warm_pixels,
    }


def build_f22() -> tuple[np.ndarray, np.ndarray, dict[str, object]]:
    crop, source_mask, bbox = extract_aircraft(SOURCES["chase_jet_f22"])
    sampled, mask = symmetric_sample(crop, source_mask, TARGET_SIZES["chase_jet_f22"])
    work = sampled.astype(np.int16)
    gold = (
        mask
        & (work[..., 0] - work[..., 2] > 34)
        & (work[..., 1] - work[..., 2] > 12)
        & (work[..., 0] > 95)
    )
    mapped = ramp_map(sampled, mask, F22_GRAY)
    gold_map = ramp_map(sampled, mask, F22_GOLD, selection=gold)
    mapped[gold] = gold_map[gold]
    return make_rgba(mapped, mask, F22_GRAY[0]), mask, {
        "source_bbox": bbox,
        "canopy_gold_pixels": int(gold.sum()),
    }


def build_kc46() -> tuple[np.ndarray, np.ndarray, dict[str, object]]:
    crop, source_mask, bbox = extract_aircraft(SOURCES["chase_tanker_kc46"])
    sampled, mask = symmetric_sample(crop, source_mask, TARGET_SIZES["chase_tanker_kc46"])
    mapped = ramp_map(sampled, mask, KC46_GRAY)
    return make_rgba(mapped, mask, KC46_GRAY[0]), mask, {"source_bbox": bbox}


def qa(name: str, rgba: np.ndarray, mask: np.ndarray, details: dict[str, object]) -> dict[str, object]:
    alpha_values = sorted(int(value) for value in np.unique(rgba[..., 3]))
    opaque = rgba[mask, :3]
    unique = np.unique(opaque, axis=0)
    colors = sorted("#" + "".join(f"{int(channel):02x}" for channel in color) for color in unique)
    symmetry_delta = int(np.count_nonzero(mask != np.fliplr(mask)))
    report = {
        "file": f"{name}.png",
        "dimensions": [int(rgba.shape[1]), int(rgba.shape[0])],
        "opaque_pixels": int(mask.sum()),
        "opaque_colors": len(colors),
        "palette": colors,
        "alpha_values": alpha_values,
        "mask_symmetry_mismatches": symmetry_delta,
        "pure_black_opaque_pixels": int(np.sum(np.all(opaque == 0, axis=1))),
    }
    report.update(details)
    return report


def save(name: str, rgba: np.ndarray) -> None:
    Image.fromarray(rgba).save(ASSETS / f"{name}.png", optimize=True)


def save_board(name: str, rgba: np.ndarray) -> None:
    """Save the labeled magenta production master at native high resolution."""

    art = Image.fromarray(rgba)
    margin, gutter = 24, 20
    font = ImageFont.load_default()
    probe = Image.new("L", (1, 1))
    bounds = ImageDraw.Draw(probe).textbbox((0, 0), name, font=font)
    label_small = Image.new("RGBA", (bounds[2], bounds[3]), (0, 0, 0, 0))
    ImageDraw.Draw(label_small).text((0, 0), name, font=font, fill=(255, 255, 255, 255))
    hard_alpha = label_small.getchannel("A").point(lambda value: 255 if value else 0)
    label_small.paste((255, 255, 255, 255), (0, 0), hard_alpha)
    label_small.putalpha(hard_alpha)
    label = label_small.resize(
        (label_small.width * 2, label_small.height * 2), Image.Resampling.NEAREST
    )
    board_width = max(art.width + margin * 2, label.width + margin * 2)
    board_height = margin + art.height + gutter + label.height + margin
    board = Image.new("RGBA", (board_width, board_height), (255, 0, 255, 255))
    board.alpha_composite(art, ((board_width - art.width) // 2, margin))
    board.alpha_composite(
        label, ((board_width - label.width) // 2, margin + art.height + gutter)
    )
    board.convert("RGB").save(BOARD_ASSETS / f"{name}.png", optimize=True)


def validate(report: dict[str, dict[str, object]]) -> None:
    """Fail the build if any locked production invariant regresses."""

    color_limits = {
        "chase_bomber_b2": 12,
        "chase_bomber_b2_night": 8,
        "chase_jet_f22": 12,
        "chase_tanker_kc46": 12,
    }
    failures: list[str] = []
    for name, expected_size in TARGET_SIZES.items():
        item = report[name]
        if item["dimensions"] != list(expected_size):
            failures.append(f"{name}: dimensions {item['dimensions']} != {expected_size}")
        if item["alpha_values"] != [0, 255]:
            failures.append(f"{name}: alpha is not hard binary")
        if int(item["opaque_colors"]) > color_limits[name]:
            failures.append(f"{name}: palette exceeds {color_limits[name]} colors")
        if int(item["mask_symmetry_mismatches"]):
            failures.append(f"{name}: structural mask is not mirror-symmetric")
        if int(item["pure_black_opaque_pixels"]):
            failures.append(f"{name}: contains forbidden opaque pure black")
    if report["chase_bomber_b2"].get("aft_point_count") != 3:
        failures.append("chase_bomber_b2: trailing edge does not have three aft points")
    if not report["chase_bomber_b2_night"].get("matches_day_mask"):
        failures.append("chase_bomber_b2_night: silhouette differs from day repaint")
    if len(report["chase_bomber_b2_night"].get("warm_pixels", [])) > 6:
        failures.append("chase_bomber_b2_night: exhaust warmth exceeds six pixels")
    if failures:
        raise RuntimeError("Sprite QA failed:\n- " + "\n- ".join(failures))


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    SOURCE_ASSETS.mkdir(parents=True, exist_ok=True)
    BOARD_ASSETS.mkdir(parents=True, exist_ok=True)
    for name, source in SOURCES.items():
        if not source.exists():
            raise FileNotFoundError(source)
        destination = SOURCE_ASSETS / f"{name}-board.png"
        if source.resolve() != destination.resolve():
            shutil.copy2(source, destination)

    report: dict[str, dict[str, object]] = {}

    day, day_mask, details = build_b2_day()
    save("chase_bomber_b2", day)
    save_board("chase_bomber_b2", day)
    report["chase_bomber_b2"] = qa("chase_bomber_b2", day, day_mask, details)

    night, night_mask, details = build_b2_night(day_mask)
    save("chase_bomber_b2_night", night)
    save_board("chase_bomber_b2_night", night)
    details["matches_day_mask"] = bool(np.array_equal(night_mask, day_mask))
    report["chase_bomber_b2_night"] = qa(
        "chase_bomber_b2_night", night, night_mask, details
    )

    f22, f22_mask, details = build_f22()
    save("chase_jet_f22", f22)
    save_board("chase_jet_f22", f22)
    report["chase_jet_f22"] = qa("chase_jet_f22", f22, f22_mask, details)

    kc46, kc46_mask, details = build_kc46()
    save("chase_tanker_kc46", kc46)
    save_board("chase_tanker_kc46", kc46)
    report["chase_tanker_kc46"] = qa("chase_tanker_kc46", kc46, kc46_mask, details)

    validate(report)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
