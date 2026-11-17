# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Yousaf Khan
#
# The JPEG reader's fixtures (test/jpeg_test.js): synthetic pictures only
# (no game art), written with Pillow (libjpeg-turbo) and Pillow's own reading
# of each kept as raw RGB (<name>.rgb.gz) for the test to compare against.
# Run once, by hand, when the fixtures change (not in CI):
#   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/native/vizualyse-steam/test/fixtures/jpeg:/f" -w /f \
#       python:3.12-slim sh -c 'pip install -q pillow==11.0.0 && python make.py'
import gzip
import math
import random

from PIL import Image


def picture(w, h, seed):
    rnd = random.Random(seed)
    im = Image.new('RGB', (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            r = int(127 + 127 * math.sin(x / 7.0 + seed))
            g = int(127 + 127 * math.cos(y / 5.0 - seed))
            b = (x * 3 + y * 5 + rnd.randint(0, 40)) % 256
            # hard edges too: a block of saturated colour
            if (x // 16 + y // 16) % 5 == 0:
                r, g, b = 230, 20, 40
            px[x, y] = (r, g, b)
    return im


CASES = [
    # name, size, Pillow's options
    ('c444', (64, 48), dict(quality=90, subsampling=0)),
    ('c422', (64, 48), dict(quality=85, subsampling=1)),
    ('c420', (64, 48), dict(quality=80, subsampling=2)),
    ('odd420', (37, 23), dict(quality=75, subsampling=2)),
    ('odd422', (53, 17), dict(quality=75, subsampling=1)),
    ('restart', (80, 40), dict(quality=85, subsampling=2, restart_marker_blocks=1)),
    ('low', (48, 48), dict(quality=10, subsampling=2)),
]

for name, size, opts in CASES:
    picture(size[0], size[1], len(name)).save(name + '.jpg', 'JPEG', **opts)
picture(41, 29, 3).convert('L').save('grey.jpg', 'JPEG', quality=85)
picture(64, 48, 9).save('progressive.jpg', 'JPEG', quality=85, progressive=True)

for name in [c[0] for c in CASES] + ['grey']:
    im = Image.open(name + '.jpg')
    im.load()
    with gzip.open(name + '.rgb.gz', 'wb') as f:
        f.write(im.convert('RGB').tobytes())
    print(name, im.size, im.mode)
