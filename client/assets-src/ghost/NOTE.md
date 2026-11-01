# Ghost sprite sheet

`ghost_sheet.png` (1536x1024) is AI-generated art: made with ChatGPT by the user on 2026-10-31
(reference sheet, then a labelled IDLE / MOVE prompt). Copied unchanged from the untracked
`images/ghost/ghost-sheet.png`.

Layout: a white label strip above each of two rows (IDLE, MOVE) of four 384-px cells on #ff00ff;
the figure faces right.

Cut by `client/scripts/spectre-frames.ts` at atlas build time (no pre-cut files are kept):
the figure is drawn as ~11 px blocks, so the cut fits one block size per sheet and a grid phase
per frame, samples each block at its centre, keys out the magenta, snaps colours to a 6-colour
k-means palette, and places the figure in 24x24 (centred, lowest row at y = 23; a tail wider than
24 game px is clipped on its left end). Frames: `ghost_idle_anim_f0..3` (IDLE) and
`ghost_run_anim_f0..3` (MOVE).
