# TODO

## Progression follow-ups

Progression is live (profiles by token, XP banked at run end, lobby upgrade shop). See TECHNICAL.md §11a.
- **Tune** `upgrade_cost` and the per-level bonuses in `defs/progression.rs` as part of the balancing pass. A typical cleared run gives a few hundred XP plus 300 for the boss; maxing one stat costs 4,375 XP.
- **Identity is a browser token.** If players want their profile on several devices, add accounts or a "show/enter my token" field in the lobby.
- The same token can be in one run twice (two tabs), which banks its XP twice. Reject a second join with the same token if that becomes a problem.

## Other follow-ups
- **Balancing pass (later, all at once):** progression, classes, enemies and boss fights together. All three bosses were played live without problems; their numbers are in `server/src/run/bosses/*.rs` and `defs/bosses.rs`.
- **Loadouts:** choose primary/secondary per class. Each class has only its one pair today, so new abilities (server executor, client prediction, pack-sprite visuals) are needed first. The picker and a field on `Member` are the easy part.
- **More classes and bosses:** add to `defs/classes.rs` / `defs/bosses.rs` plus a `BossBehaviour` file, and add the visual entry in `client/src/game/anim/defs.ts`.
- **Art gaps in the 0x72 pack:**
  - The red dragon is the pack lizard, scaled and hue-shifted.
  - The lich is a scaled, tinted necromancer.
  - The demon has no bat wings.
  - There are no attack animation frames.
  - Dedicated sprite sheets can be added to `client/assets-src/` and referenced in `anim/defs.ts`.
- **4-direction sprites:** the animation code keeps a `Dir` value. Up/down frames can be added there once sheets exist.
- **Sound effects.**
- **Network:**
  - delta-compressed snapshots (currently full FOV-filtered snapshots, about 250 B each)
  - optional WebTransport transport for lossy connections
