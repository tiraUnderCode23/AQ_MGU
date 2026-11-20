#!/usr/bin/env python3
"""The app's icon: apps/rubenrios_gearhud/icon.png, 140x140, transparent around it, as the kit's icons.

A head-up display's glass seen from the driver's seat, with S3 lit on it: the S in red, the 3 in soft grey. Drawn at 4x and scaled down.
Needs Pillow and the Ubuntu font (fonts-ubuntu):  python3 tools/make_icon.py [path/to/Ubuntu[wdth,wght].ttf]
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/truetype/ubuntu/Ubuntu[wdth,wght].ttf'
S = 4
N = 140 * S


def vgrad(w, h, top, bottom):
    g = Image.new('RGBA', (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        g.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(4)))
    return g.resize((w, h))


def main():
    icon = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    # the glass: a trapezoid leaning back, wider at the bottom, rounded corners
    glass = [(30 * S, 22 * S), (110 * S, 22 * S), (126 * S, 112 * S), (14 * S, 112 * S)]
    mask = Image.new('L', (N, N), 0)
    ImageDraw.Draw(mask).polygon(glass, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(3 * S)).point(lambda v: 255 if v > 128 else 0).filter(ImageFilter.GaussianBlur(S * 0.6))
    # chrome rim: the shape a little larger, light at the top and dark at the bottom
    rim_mask = mask.filter(ImageFilter.MaxFilter(4 * S + 1))
    icon.paste(vgrad(N, N, (232, 236, 240, 255), (70, 76, 84, 255)), (0, 0), rim_mask)
    # dark glass with a faint blue tint, lighter at the top (the sky behind)
    icon.paste(vgrad(N, N, (34, 44, 58, 255), (6, 8, 12, 255)), (0, 0), mask)
    # a soft reflection across the upper glass
    refl = Image.new('L', (N, N), 0)
    ImageDraw.Draw(refl).polygon([(30 * S, 22 * S), (110 * S, 22 * S), (114 * S, 44 * S), (26 * S, 52 * S)], fill=46)
    refl = Image.composite(refl, Image.new('L', (N, N), 0), mask).filter(ImageFilter.GaussianBlur(4 * S))
    icon.alpha_composite(Image.merge('RGBA', (Image.new('L', (N, N), 255),) * 3 + (refl,)))
    # S3 lit on the glass: the S red and a little smaller, the 3 soft grey, both with a glow
    try:
        big = ImageFont.truetype(FONT, 58 * S)
        small = ImageFont.truetype(FONT, 40 * S)
        for f in (big, small):
            try:
                f.set_variation_by_axes([75, 700])
            except Exception:
                pass
    except OSError:
        raise SystemExit('Ubuntu font not found: ' + FONT)
    text = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(text)
    base = 88 * S
    wd = d.textlength('S', font=small)
    w3 = d.textlength('3', font=big)
    gap = 3 * S
    x0 = (N - (wd + gap + w3)) / 2
    colour, red = (214, 219, 226, 255), (228, 40, 46, 255)
    d.text((x0, base), 'S', font=small, fill=red, anchor='ls')
    d.text((x0 + wd + gap, base), '3', font=big, fill=colour, anchor='ls')
    glow = text.getchannel('A').filter(ImageFilter.GaussianBlur(5 * S)).point(lambda v: v * 0.55)
    icon.alpha_composite(Image.merge('RGBA', (Image.new('L', (N, N), 150), Image.new('L', (N, N), 200), Image.new('L', (N, N), 255), glow)))
    icon.alpha_composite(text)
    # accent: a thin red line under the gear, the colour of S
    line = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(line).rounded_rectangle([46 * S, 98 * S, 94 * S, 101 * S], radius=S * 2, fill=red)
    icon.alpha_composite(line)
    out = os.path.join(ROOT, 'apps', 'rubenrios_gearhud', 'icon.png')
    icon.resize((140, 140), Image.LANCZOS).save(out, optimize=True)
    print(out, os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()
