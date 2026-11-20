# Make apps/ahg_digital_garage/assets/scene.json from the Digital Garage concept art:
#   python tools/make-dg-art.py <concept.png> apps/ahg_digital_garage/assets/scene.json <preview.png>
# Crops the scene panel (below the title chips), reduces it to a 4 px grid with 64 colours, stores merged rectangles.
import sys, json, base64, zlib, struct
from PIL import Image
src, out, prev = sys.argv[1], sys.argv[2], sys.argv[3]
im = Image.open(src).convert('RGB').crop((312, 237, 1188, 698))  # scene panel, below the baked-in title chips
F = 4
w, h = im.width // F, im.height // F
small = im.resize((w, h), Image.BOX)
q = small.quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
pal = q.getpalette()[:64*3]
px = list(q.getdata())
used = sorted(set(px))
# greedy rectangles: horizontal runs extended downward
done = [False]*(w*h); rects = []
for y in range(h):
    x = 0
    while x < w:
        i = y*w+x
        if done[i]: x += 1; continue
        c = px[i]; x2 = x
        while x2+1 < w and px[y*w+x2+1] == c and not done[y*w+x2+1]: x2 += 1
        y2 = y
        while y2+1 < h and all(px[(y2+1)*w+k] == c and not done[(y2+1)*w+k] for k in range(x, x2+1)): y2 += 1
        for yy in range(y, y2+1):
            for k in range(x, x2+1): done[yy*w+k] = True
        rects.append((x, y, x2-x+1, y2-y+1, c)); x = x2+1
colors = ['#%02x%02x%02x' % tuple(pal[c*3:c*3+3]) for c in range(64)]
buf = b''.join(struct.pack('<BBBBB', *r) for r in rects)
json.dump({'width': w, 'height': h, 'palette': colors, 'count': len(rects),
           'rects': base64.b64encode(zlib.compress(buf, 9)).decode()}, open(out, 'w'))
q.convert('RGB').resize((w*F, h*F), Image.NEAREST).save(prev)
print(w, h, len(rects), 'rects', len(used), 'colours')
