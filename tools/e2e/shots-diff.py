"""Compares two folders of shots (#364).

Usage: python3 shots-diff.py <dirA> <dirB> <outDir> [skipRegex]

For every PNG name in both folders: the count of differing pixels and their bounding box, one line each, sorted by count. For each file
that differs, <outDir>/<name>.png shows the differing pixels in magenta over a dimmed B. Names in only one folder are listed. A last line
gives the totals. The exit code is always 0: the reader judges.
"""
import os
import re
import sys

from PIL import Image, ImageChops

if len(sys.argv) < 4:
    print(__doc__)
    sys.exit(0)
a_dir, b_dir, out_dir = sys.argv[1:4]
skip = re.compile(sys.argv[4]) if len(sys.argv) > 4 else None


def names(d):
    return {f for f in os.listdir(d) if f.lower().endswith(".png") and not (skip and skip.search(f[:-4]))}


na, nb = names(a_dir), names(b_dir)
os.makedirs(out_dir, exist_ok=True)
rows = []
for n in sorted(na & nb):
    a = Image.open(os.path.join(a_dir, n)).convert("RGB")
    b = Image.open(os.path.join(b_dir, n)).convert("RGB")
    if a.size != b.size:
        rows.append((10**12, f"{n}\tsize differs {a.size} vs {b.size}"))
        continue
    diff = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v else 0)
    box = diff.getbbox()
    if box is None:
        rows.append((0, f"{n}\t0"))
        continue
    count = diff.histogram()[255]
    dim = b.point(lambda v: v // 3)
    dim.paste(Image.new("RGB", b.size, (255, 0, 255)), mask=diff)
    dim.save(os.path.join(out_dir, n))
    rows.append((count, f"{n}\t{count}\tbox x {box[0]}..{box[2]} y {box[1]}..{box[3]}"))
rows.sort(key=lambda r: -r[0])
for _, line in rows:
    print(line)
for n in sorted(na - nb):
    print(f"{n}\tonly in A")
for n in sorted(nb - na):
    print(f"{n}\tonly in B")
differing = sum(1 for c, _ in rows if c > 0)
total = sum(c for c, _ in rows if c < 10**12)
print(f"total: {len(rows)} compared, {differing} differ, {total} differing pixels, {len(na - nb)} only in A, {len(nb - na)} only in B")
