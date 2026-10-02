"""Probe Minecraft skin PNGs: size, used regions, and cross-region pixel equality.

Evidence gathering for the UV-layout contract of the skin editor.
"""
import sys, os
from PIL import Image

REGIONS = [
    # name, x, y, w, h  (modern 64x64 coordinates)
    ("head_top", 8, 0, 8, 8), ("head_bottom", 16, 0, 8, 8),
    ("head_right", 0, 8, 8, 8), ("head_front", 8, 8, 8, 8),
    ("head_left", 16, 8, 8, 8), ("head_back", 24, 8, 8, 8),
    ("hat_top", 40, 0, 8, 8), ("hat_bottom", 48, 0, 8, 8),
    ("hat_right", 32, 8, 8, 8), ("hat_front", 40, 8, 8, 8),
    ("hat_left", 48, 8, 8, 8), ("hat_back", 56, 8, 8, 8),
    ("torso_top", 20, 16, 8, 4), ("torso_bottom", 28, 16, 8, 4),
    ("torso_right", 16, 20, 4, 12), ("torso_front", 20, 20, 8, 12),
    ("torso_left", 28, 20, 4, 12), ("torso_back", 32, 20, 8, 12),
    ("jacket_top", 20, 32, 8, 4), ("jacket_bottom", 28, 32, 8, 4),
    ("jacket_right", 16, 36, 4, 12), ("jacket_front", 20, 36, 8, 12),
    ("jacket_left", 28, 36, 4, 12), ("jacket_back", 32, 36, 8, 12),
    ("rarm_top", 44, 16, 4, 4), ("rarm_bottom", 48, 16, 4, 4),
    ("rarm_right", 40, 20, 4, 12), ("rarm_front", 44, 20, 4, 12),
    ("rarm_left", 48, 20, 4, 12), ("rarm_back", 52, 20, 4, 12),
    ("rleg_top", 4, 16, 4, 4), ("rleg_bottom", 8, 16, 4, 4),
    ("rleg_right", 0, 20, 4, 12), ("rleg_front", 4, 20, 4, 12),
    ("rleg_left", 8, 20, 4, 12), ("rleg_back", 12, 20, 4, 12),
    ("larm_top", 44, 48, 4, 4), ("larm_bottom", 48, 48, 4, 4),
    ("larm_right", 40, 52, 4, 12), ("larm_front", 44, 52, 4, 12),
    ("larm_left", 48, 52, 4, 12), ("larm_back", 52, 52, 4, 12),
    ("lleg_top", 4, 48, 4, 4), ("lleg_bottom", 8, 48, 4, 4),
    ("lleg_right", 0, 52, 4, 12), ("lleg_front", 4, 52, 4, 12),
    ("lleg_left", 8, 52, 4, 12), ("lleg_back", 12, 52, 4, 12),
    ("lsleeve_top", 52, 32, 4, 4), ("lsleeve_bottom", 56, 32, 4, 4),
    ("lsleeve_right", 48, 36, 4, 12), ("lsleeve_front", 52, 36, 4, 12),
    ("lsleeve_left", 56, 36, 4, 12), ("lsleeve_back", 60, 36, 4, 12),
    ("rpants_top", 4, 32, 4, 4), ("rpants_bottom", 8, 32, 4, 4),
    ("rpants_right", 0, 36, 4, 12), ("rpants_front", 4, 36, 4, 12),
    ("rpants_left", 8, 36, 4, 12), ("rpants_back", 12, 36, 4, 12),
    ("lpants_top", 4, 48 + 0, 0, 0),  # placeholder, fixed below
]
# left pants overlap left leg region in modern layout - separate row
REGIONS = [r for r in REGIONS if r[3] > 0]
REGIONS.append(("lpants_top", 4, 48, 4, 4))


def used_fraction(img, box):
    x, y, w, h = box
    px = img.load()
    n = 0
    for j in range(y, y + h):
        for i in range(x, x + w):
            if i < img.width and j < img.height:
                if px[i, j][3] > 0:
                    n += 1
    return n / float(w * h)


def main(paths):
    for path in paths:
        img = Image.open(path).convert("RGBA")
        print("=" * 70)
        print("FILE %s  size=%s" % (os.path.basename(path), img.size))
        # full-image used fraction
        alpha = img.split()[3]
        total = img.width * img.height
        used = sum(1 for v in alpha.getdata() if v > 0)
        print("  used_pixels=%d/%d (%.1f%%)" % (used, total, 100.0 * used / total))
        for name, x, y, w, h in REGIONS:
            if x + w > img.width or y + h > img.height:
                continue
            f = used_fraction(img, (x, y, w, h))
            flag = ""
            if name.startswith(("larm", "lleg", "lsleeve", "lpants", "jacket", "hat")) and img.height == 32:
                flag = "  <- beyond 64x32? no"
            print("  %-14s box=(%2d,%2d,%2d,%2d) used=%5.1f%%%s" % (name, x, y, w, h, 100 * f, flag))
        # equality checks that distinguish mirrored vs copied duplicates
        px = img.load()
        def region(box):
            x, y, w, h = box
            return [[px[x + i, y + j] for i in range(w)] for j in range(h)]
        def eq(a, b):
            return a == b
        def mirror(rows):
            return [list(reversed(r)) for r in rows]
        if img.height == 64:
            pairs = [
                ("torso_front vs jacket_front", region((20, 20, 8, 12)), region((20, 36, 8, 12))),
                ("head_front vs hat_front", region((8, 8, 8, 8)), region((40, 8, 8, 8))),
                ("rarm_front vs larm_front", region((44, 20, 4, 12)), region((44, 52, 4, 12))),
                ("rarm_front vs mirror(larm_front)", region((44, 20, 4, 12)), mirror(region((44, 52, 4, 12)))),
                ("rleg_front vs lleg_front", region((4, 20, 4, 12)), region((4, 52, 4, 12))),
                ("rleg_front vs mirror(lleg_front)", region((4, 20, 4, 12)), mirror(region((4, 52, 4, 12)))),
                ("rarm_front vs rarm_right", region((44, 20, 4, 12)), region((40, 20, 4, 12))),
            ]
            for label, a, b in pairs:
                print("  %-38s identical=%s" % (label, eq(a, b)))
        # which column layout does this skin use? check alpha presence column-wise
        print("  region alpha map (16px grid):")
        for gy in range(0, img.height, 16):
            row = ""
            for gx in range(0, img.width, 16):
                block = img.crop((gx, gy, gx + 16, gy + 16))
                a = block.split()[3]
                nz = sum(1 for v in a.getdata() if v > 0)
                row += "%4d" % (100 * nz // 256)
            print("    y=%2d: %s" % (gy, row))


if __name__ == "__main__":
    main(sys.argv[1:])
