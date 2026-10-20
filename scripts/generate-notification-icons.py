# Draws the Recharge mark (mobile/web-static/favicon.svg, a 64-unit square) into the PNGs the installed web app and its
# notifications use:
#   badge-96.png               the small icon in the phone's status bar and at the top left of a notification. Android
#                              keeps only the alpha channel and paints it white, so it must be a white mark on a transparent
#                              background (a solid square shows as a plain white square).
#   icon-maskable-192/512.png  the home-screen icon for Android, whose launcher cuts it to a circle or squircle: a full-bleed
#                              green square with the mark inside the safe zone (the middle 80%).
# Run: python3 scripts/generate-notification-icons.py (Pillow). The output is committed; run again only when the mark changes.
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "mobile" / "web-static"
GREEN = (0x1C, 0x39, 0x34, 255)
SUPER = 16  # drawn larger, then scaled down for smooth edges


def mark(size, scale, offset):
    """The mark as an alpha mask: the ring, the bed, the head and the pillow, with the bolt cut out of the pillow."""
    big = size * SUPER
    mask = Image.new("L", (big, big), 0)
    g = ImageDraw.Draw(mask)
    s = scale * SUPER
    p = lambda x, y: ((offset + x * scale) * SUPER, (offset + y * scale) * SUPER)
    stroke = 5 * s

    def dot(x, y, r):
        cx, cy = p(x, y)
        g.ellipse((cx - r * s, cy - r * s, cx + r * s, cy + r * s), fill=255)

    def line(points):
        g.line([p(*q) for q in points], fill=255, width=round(stroke))
        for q in points:
            dot(*q, 2.5)  # round caps and joins

    cx, cy = p(32, 32)
    g.ellipse((cx - 27.5 * s, cy - 27.5 * s, cx + 27.5 * s, cy + 27.5 * s), outline=255, width=round(stroke))
    line([(18, 15), (18, 49)])
    line([(18, 39), (47, 39), (47, 49)])
    dot(27, 31, 6)
    # The pillow: 35..47 by 25..39, its top right corner rounded (radius 4).
    g.rounded_rectangle((*p(35, 25), *p(47, 39)), radius=4 * s, fill=255, corners=(False, True, False, False))
    g.polygon([p(41, 26), p(37, 33), p(40, 33), p(38, 41), p(46, 30), p(42, 30), p(45, 26)], fill=0)
    return mask.resize((size, size), Image.LANCZOS)


def badge(size=96, padding=2):
    # The ring spans 4.5..59.5 of the 64 units; it fills the badge with a small margin.
    scale = (size - 2 * padding) / 55
    alpha = mark(size, scale, padding - 4.5 * scale)
    out = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    out.putalpha(alpha)
    return out


def maskable(size):
    # The mark's 55 units take 66% of the side, well inside the 80% safe circle.
    scale = size * 0.66 / 55
    alpha = mark(size, scale, size / 2 - 32 * scale)
    out = Image.new("RGBA", (size, size), GREEN)
    out.paste(Image.new("RGBA", (size, size), (255, 255, 255, 255)), (0, 0), alpha)
    return out


if __name__ == "__main__":
    badge().save(OUT / "badge-96.png", optimize=True)
    for size in (192, 512):
        maskable(size).save(OUT / f"icon-maskable-{size}.png", optimize=True)
    print("Wrote badge-96.png, icon-maskable-192.png and icon-maskable-512.png to", OUT)
