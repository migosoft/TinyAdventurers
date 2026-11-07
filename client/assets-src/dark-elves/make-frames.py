"""Builds the dark elf frames (#12) from the 0x72 and Enchanted Forest packs.

Run from the repo root:  python3 -I client/assets-src/dark-elves/make-frames.py
Writes <figure>/<figure>_{idle,run}_anim_f{0..3}.png next to this script and
preview.png (all frames on a 0x72 floor, enlarged).

Agreed with the user on 2026-11-07 (details in issue #12):
- Colours: "scheme C with red eyes", pack colours only.
- Priestess: 0x72 elf_f head on elf_m body, clothes 2a2a3a, skin collar,
  brooch pixel kept, hair ornament removed, crimson spider emblem,
  circlet 1f1833 with a red gem between the eyes.
- Males: Enchanted Forest Elf Male, Elven King, Elven Knight, Ranger
  (Ranger: beard removed, shirt and its dark line moved up one row).

The splice, emblem, circlet and Ranger edit are drawn for this game
("drawn for this game with Claude Code"); the rest is pack art recoloured.
To be ported to a TypeScript frame builder when the figures go into the atlas.
"""
import glob
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
SHEET = os.path.join(SRC, '0x72', '0x72_DungeonTilesetII_v1.7.png')
TILES = os.path.join(SRC, '0x72', 'tile_list_v1.7')
FOREST = os.path.join(SRC, 'enchanted-forest', 'frames')

hx = lambda p: '%02x%02x%02x' % p[:3]
rgba = lambda h: tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)

# Scheme C with scheme A's red eyes, by role.
C = dict(skin='5f2d56', skinD='38262d', hairL='cae6f5', hairD='b6cbcf', clothL='323e4f',
         clothD='1f1833', eyes='da4e38', acc='9f294e', metalL='414859', metalD='2a2a3a')
OUTLINE = '222222'


def recolour(im, mapping):
    im = im.copy()
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            p = px[x, y]
            if p[3] and hx(p) in mapping:
                px[x, y] = rgba(mapping[hx(p)])
    return im


def cells(im, colour):
    px = im.load()
    return [(x, y) for y in range(im.height) for x in range(im.width) if px[x, y][3] and hx(px[x, y]) == colour]


def rows_with(im, colour):
    return sorted({y for _, y in cells(im, colour)})


# ---------- 0x72: the priestess ----------
sheet = Image.open(SHEET).convert('RGBA')
tiles = {l.split()[0]: list(map(int, l.split()[1:5])) for l in open(TILES) if len(l.split()) >= 5}


def pack_frame(name, i):
    x, y, w, h = tiles['%s_%s_anim_f%d' % (name, 'idle' if i < 4 else 'run', i % 4)]
    return sheet.crop((x, y, x + w, y + h))


PRIESTESS = {'fccba3': C['skin'], 'e2b694': C['skinD'], 'facb3e': C['hairL'], 'ee8e2e': C['hairD'],
             '4ba747': '2a2a3a', '3d734f': '2a2a3a', '314152': '2a2a3a', '5698cc': C['eyes'],
             'da4e38': C['acc']}


def priestess(i):
    f, m = pack_frame('elf_f', i), pack_frame('elf_m', i)
    fp, mp = f.load(), m.load()
    shoulder = max(set(rows_with(f, '4ba747')) & set(rows_with(f, 'ee8e2e')))  # elf_f: hair over the shoulders
    belt = rows_with(m, '314152')[0]                                             # elf_m: belt row
    out = Image.new('RGBA', m.size)
    op = out.load()
    for y in range(f.height):                  # head, hair and shoulders from elf_f, joined at elf_m's belt
        ty = y + belt - shoulder
        if 0 <= ty <= belt:
            for x in range(16):
                if fp[x, y][3]:
                    op[x, ty] = fp[x, y]
    for y in range(belt + 1, m.height):        # body from elf_m
        for x in range(16):
            if mp[x, y][3]:
                op[x, y] = mp[x, y]
    for y in range(belt):                      # elf_f's collar -> skin (no dark stripe under the chin)
        for x in range(16):
            if op[x, y][3] and hx(op[x, y]) == '3d734f':
                op[x, y] = rgba('fccba3')
    brooch = next((x, y) for y in range(belt, 28) for x in range(16) if op[x, y][3] and hx(op[x, y]) == 'fccba3')
    # hair ornament (elf_f's 3x3 flower) -> hair strand like the rows below it
    flower = [(x, y) for (x, y) in cells(out, 'da4e38') if y < belt - 2]
    for y in sorted({y for _, y in flower}):
        x0 = min(x for x, yy in flower if yy == y)
        op[x0 - 1, y] = (0, 0, 0, 0)
        op[x0, y] = rgba(OUTLINE)
        op[x0 + 1, y] = rgba('ee8e2e')
        op[x0 + 2, y] = rgba('facb3e')
    out = recolour(out, PRIESTESS)
    op = out.load()
    shirt = set(cells(out, '2a2a3a'))
    # spider emblem, centred on the shirt one row below the belt
    xs = [x for x, y in shirt if y == belt + 1]
    cx = (min(xs) + max(xs) + 1) // 2
    for dy, row in enumerate(['L...L', '.LBL.', '.LBL.', 'L...L']):
        for dx, c in enumerate(row):
            p = (cx - 2 + dx, belt + 1 + dy)
            if c != '.' and p in shirt:
                op[p] = rgba(C['acc'] if c == 'L' else C['eyes'])
    # circlet on the hair row above the face, gem centred between the eyes
    face_top = rows_with(out, C['skin'])[0]
    band = face_top - 1
    hair = [x for x in range(16) if op[x, band][3] and hx(op[x, band]) in (C['hairL'], C['hairD'])]
    eye_row = min(y for (x, y) in cells(out, C['eyes']) if (x, y) != brooch)
    eyes = sorted(x for (x, y) in cells(out, C['eyes']) if y == eye_row)
    left = next(a for a, b in zip(eyes, eyes[1:]) if b - a > 1)
    right = next(x for x in eyes if x > left)
    for x in hair[1:-1]:
        op[x, band] = rgba('1f1833')
    gem = (left + right) // 2
    op[gem, band] = rgba(C['eyes'])
    # four spider legs rising from the circlet through the hair; above the head each
    # one bends backwards (to the left, she faces right): up and over at the knee, tip down
    top = min(y for y in range(out.height) for x in range(16) if op[x, y][3])
    for i, fx in enumerate((gem - 3, gem - 1, gem + 1, gem + 3)):
        rise = 2 if i in (0, 3) else 3            # outer legs shorter than inner ones
        pts = [(fx, y) for y in range(top - rise, band)]
        pts += [(fx - 1, top - rise - 1), (fx - 2, top - rise)]
        for x, y in pts:
            if 0 <= x < 16 and 0 <= y < out.height:
                op[x, y] = rgba('1f1833')
    return out


# ---------- Enchanted Forest: the males ----------
ROLES = {
    'Elf - Male': {'fccba3': 'skin', 'e2b694': 'skinD', 'facb3e': 'hairL', 'ee8e2e': 'hairD',
                   'c56025': 'clothL', '8f4029': 'clothD', '62232f': 'acc', '5698cc': 'eyes'},
    'Elven King': {'fccba3': 'skin', 'e2b694': 'skinD', 'd6ad8e': 'skinD', '9f294e': 'clothL',
                   '62232f': 'clothD', 'aa8d7a': 'hairL', '775c55': 'hairD', '5698cc': 'eyes'},
    'Elven Knight': {'72d6ce': 'metalL', '417089': 'metalD', '4ba747': 'clothL', '3d734f': 'clothD',
                     'facb3e': 'eyes'},
    'Ranger': {'fccba3': 'skin', 'e2b694': 'skinD', 'facb3e': 'hairL', 'ee8e2e': 'hairD',
               '4ba747': 'clothL', '3d734f': 'clothD', '5698cc': 'eyes'},
}


def forest_frames(folder):
    fs = sorted(glob.glob(os.path.join(FOREST, folder, '*.png')))
    idle = [f for f in fs if '_Idle_' in f]
    walk = [f for f in fs if '_Walk_' in f]
    if not idle and not walk:      # the Elven King has 4 frames shared by idle and walk
        idle = fs
    return [Image.open(f).convert('RGBA') for f in idle + walk]


def ranger_edit(im):
    """Beard -> skin; shirt (with its dark line) moved up one row."""
    im = im.copy()
    px = im.load()
    W, H = im.size
    eyes = rows_with(im, '5698cc')
    hair_x = min(x for (x, y) in cells(im, 'ee8e2e') if y in eyes)
    for y in range(eyes[-1] + 1, H):           # beard and moustache -> skin
        for x in range(hair_x + 1, W):
            if px[x, y][3] and hx(px[x, y]) == 'ee8e2e':
                px[x, y] = rgba('fccba3')
    src = im.copy()
    sp = src.load()
    torso = ('fccba3', '4ba747', '3d734f')
    top = eyes[-1] + 3
    end = next(y for y in range(top, H) if sum(sp[x, y][3] > 0 and hx(sp[x, y]) == '3d734f' for x in range(W)) >= 6) - 1
    for y in range(top, end + 1):
        for x in range(hair_x + 1, W):
            if not (sp[x, y][3] and hx(sp[x, y]) in torso):
                continue
            if y + 1 <= end and sp[x, y + 1][3] and hx(sp[x, y + 1]) in torso:
                px[x, y] = sp[x, y + 1]
            else:
                px[x, y] = rgba('4ba747')
    for x in range(W):                          # keep the line's start at the shoulder
        if sp[x, top][3] and hx(sp[x, top]) == '3d734f':
            px[x, top] = sp[x, top]
    return im


FIGURES = {
    'dark_elf_priestess': lambda: [priestess(i) for i in range(8)],
    'dark_elf': lambda: [recolour(f, {k: C[r] for k, r in ROLES['Elf - Male'].items()}) for f in forest_frames('Elf - Male')],
    'dark_elf_king': lambda: [recolour(f, {k: C[r] for k, r in ROLES['Elven King'].items()}) for f in forest_frames('Elven King')],
    'dark_elf_knight': lambda: [recolour(f, {k: C[r] for k, r in ROLES['Elven Knight'].items()}) for f in forest_frames('Elven Knight')],
    'dark_elf_ranger': lambda: [recolour(ranger_edit(f), {k: C[r] for k, r in ROLES['Ranger'].items()}) for f in forest_frames('Ranger')],
}


def main():
    built = {}
    for name, make in FIGURES.items():
        frames = make()
        os.makedirs(os.path.join(HERE, name), exist_ok=True)
        for i, im in enumerate(frames):
            kind = 'idle' if i < 4 or len(frames) == 4 else 'run'
            im.save(os.path.join(HERE, name, '%s_%s_anim_f%d.png' % (name, kind, i % 4)))
        built[name] = frames
    # preview: one row per figure, every frame on a 0x72 floor, 6x
    x, y, w, h = tiles['floor_1']
    floor = sheet.crop((x, y, x + w, y + h))
    cw, ch, z = 26, 30, 6
    n = max(len(v) for v in built.values())
    out = Image.new('RGBA', (n * cw * z, len(built) * ch * z), (40, 34, 40, 255))
    for r, frames in enumerate(built.values()):
        for i, im in enumerate(frames):
            bg = Image.new('RGBA', (cw, ch))
            for ty in range(0, ch, 16):
                for tx in range(0, cw, 16):
                    bg.alpha_composite(floor, (tx, ty))
            fig = im.crop(im.getbbox())
            bg.alpha_composite(fig, ((cw - fig.width) // 2, ch - fig.height - 1))
            out.alpha_composite(bg.resize((cw * z, ch * z), Image.NEAREST), (i * cw * z, r * ch * z))
    out.save(os.path.join(HERE, 'preview.png'))
    for name, frames in built.items():
        print(name, len(frames), 'frames', frames[0].size)


if __name__ == '__main__':
    main()
