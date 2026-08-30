#!/usr/bin/env python3
"""Draw the disk image background.

    python3 macos/dmg/make-background.py

Writes background.png and background@2x.png beside this file. The script is
committed rather than only the images so the artwork can be adjusted and
regenerated instead of edited by hand in a pixel editor.

The geometry here is tied to macos/dmg/settings.py: the icon coordinates in
that file have to line up with the arrow drawn between them here, so change
both together or the arrow will point at nothing.

Colours are the app's own — #fcfcf9 ground, #8f8f85 for text and #c4c4bd for
the arrow are the same tones the interface uses for muted labels, so the
window reads as part of Rapid Log rather than as a generic installer.
"""

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 660, 400

# The app's own page colour. It was briefly matched to the icon's baked
# background, back when the icon was an opaque square and the match was the only
# way to hide its edges. The icon now has transparent corners, so the ground can
# differ again — and has to, because the icon body is itself cream and would
# disappear into a cream window.
GROUND = "#fcfcf9"
TEXT = "#8f8f85"
ARROW = "#c4c4bd"

# Must match the `icon_locations` in settings.py.
APP_X, APPS_X, ICON_Y = 180, 480, 170
ICON_SIZE = 128

LABEL = "DRAG TO INSTALL"
LABEL_Y = 300
TRACKING = 0.30  # em, matching the interface's uppercase labels
FONT_SIZE = 13
FONT_CANDIDATES = [
    ("/System/Library/Fonts/Menlo.ttc", 0),
    ("/System/Library/Fonts/SFNSMono.ttf", None),
    ("/System/Library/Fonts/Supplemental/Courier New.ttf", None),
]


def load_font(px):
    for path, index in FONT_CANDIDATES:
        try:
            if index is None:
                return ImageFont.truetype(path, px)
            return ImageFont.truetype(path, px, index=index)
        except OSError:
            continue
    raise SystemExit("no monospace font found; add one to FONT_CANDIDATES")


def draw_tracked_text(draw, text, font, centre_x, baseline_y, fill, tracking_px):
    """Pillow has no letter-spacing, so lay the glyphs out individually."""
    widths = [draw.textlength(c, font=font) for c in text]
    total = sum(widths) + tracking_px * (len(text) - 1)
    x = centre_x - total / 2
    for c, w in zip(text, widths):
        draw.text((x, baseline_y), c, font=font, fill=fill, anchor="ls")
        x += w + tracking_px


def render(scale):
    w, h = WIDTH * scale, HEIGHT * scale
    img = Image.new("RGB", (w, h), GROUND)
    d = ImageDraw.Draw(img)

    # The arrow spans the gap between the two icons rather than a fixed span,
    # so it stays correct if the icons move.
    gap_start = (APP_X + ICON_SIZE / 2 + 18) * scale
    gap_end = (APPS_X - ICON_SIZE / 2 - 18) * scale
    y = ICON_Y * scale
    line_w = max(1, round(1.5 * scale))

    d.line([(gap_start, y), (gap_end, y)], fill=ARROW, width=line_w)

    # A chevron rather than a filled triangle: lighter, and it matches the
    # hairline weight of the app icon's crosshair. Drawn a step heavier than the
    # shaft, because at hairline weight the head reads as a stray ">" instead of
    # an arrow.
    head = 13 * scale
    head_w = max(1, round(2 * scale))
    d.line([(gap_end - head, y - head * 0.55), (gap_end, y)], fill=ARROW, width=head_w)
    d.line([(gap_end - head, y + head * 0.55), (gap_end, y)], fill=ARROW, width=head_w)

    font = load_font(FONT_SIZE * scale)
    draw_tracked_text(
        d, LABEL, font,
        centre_x=w / 2,
        baseline_y=LABEL_Y * scale,
        fill=TEXT,
        tracking_px=FONT_SIZE * scale * TRACKING,
    )
    return img


if __name__ == "__main__":
    import pathlib

    here = pathlib.Path(__file__).parent
    render(1).save(here / "background.png")
    render(2).save(here / "background@2x.png")
    print(f"wrote {here/'background.png'} ({WIDTH}x{HEIGHT})")
    print(f"wrote {here/'background@2x.png'} ({WIDTH*2}x{HEIGHT*2})")
