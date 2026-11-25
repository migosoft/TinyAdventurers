# Tiny Adventurers: notes for coding agents

Read [README.md](README.md) (what the game is, how to run it), [docs/TECHNICAL.md](docs/TECHNICAL.md) (§2a "Where to find things" maps topics to files; architecture, protocol, simulation, netcode, rendering, how to extend, known limitations) and [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md) (the game as players see it; keep it in sync when gameplay changes). There is no HANDOFF file: the state of the work is on the board below.

## Which work to do

1. If the user names an issue ("implement #42"), work on that one.
2. Otherwise resume the top card in **In progress** (unfinished work comes first; its latest comment says where it stopped). Cards in **In Review** wait for the user (a play-test, a look to judge, a decision): don't resume them on your own; pick them up when the user reports back. Cards in **Waiting** are blocked by another issue (see "Blocked work" below): never take them.

**Fable work** (the user, 2026-11-21): creative work (shapes, paint, glow, poses, motion: a look judged by eye) is done only by a session running on Fable, wherever the issue is on the board. Such issues carry the label `fable`. A session on another model skips `fable` cards in every step of this list, unless the issue's comments name a part as not creative (that part any model may do). A session on Fable takes the top `fable` card first (In progress, then Next) and follows the normal order only when there is none. A new issue that is mainly look work gets the label when it is created.
3. Otherwise take the top card in **Next**. The order of the cards in a column is the priority; the user sets it by dragging.
4. If Next is empty, ask the user. Never pick from the Backlog on your own.

`gh project item-list` does not keep the board order. Read the columns in order with (it marks `fable` cards):

```sh
gh api graphql --paginate -f query='query($endCursor:String){user(login:"migosoft"){projectV2(number:1){items(first:100,after:$endCursor,orderBy:{field:POSITION,direction:ASC}){pageInfo{hasNextPage endCursor} nodes{content{... on Issue{number title labels(first:20){nodes{name}}}} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}' --jq '.data.user.projectV2.items.nodes[] | select(.fieldValueByName.name=="In progress" or .fieldValueByName.name=="Next") | "\(.fieldValueByName.name)\t#\(.content.number) \(.content.title)\(if any(.content.labels.nodes[]; .name=="fable") then "  [fable]" else "" end)"'
```

Read the issue, its comments and any spec or plan it links before starting. Move the card to In progress when you begin, and to In Review when the work waits on the user (a play-test, a comparison, a decision); its latest comment says what the user is asked to check.

**Stopping before an issue is done:** leave a comment on the issue: the branch, what is done (commits), what is next, open questions, and links to the spec and plan. The next session starts from that comment.

**Finishing:** before an issue is closed, always update the technical documentation ([docs/TECHNICAL.md](docs/TECHNICAL.md)) and the player documentation ([docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md)) to match the finished work, and commit the update with it. If one of them needs no change, say so in the closing comment. The closing comment names the commits, the verification run, and whether it is merged, pushed and deployed. Leftovers become new issues ("Follow-up of #N"). Then release what it blocked (below).

**Blocked work** (the user, 2026-11-21): a card that cannot start until another issue is closed goes to **Waiting**, and the dependency is recorded with GitHub's issue dependencies, so the blocker knows what it blocks:
- Record: `gh api -X POST repos/migosoft/TinyAdventurers/issues/<blocked>/dependencies/blocked_by -F issue_id=$(gh api repos/migosoft/TinyAdventurers/issues/<blocker> --jq .id)` (the blocker's database id, not its number). Add a comment on the blocked issue naming what it waits for. Needing Fable is not a block: that is the `fable` label.
- Release: when you close an issue, run `gh api repos/migosoft/TinyAdventurers/issues/<N>/dependencies/blocking --jq '.[].number'`. For each issue listed, check `gh api repos/migosoft/TinyAdventurers/issues/<M> --jq .issue_dependencies_summary.blocked_by` (open blockers left). None left: move its card from Waiting back to Next, at the place its comment names (otherwise ask the user), and say in a comment and in your reply where it went.
- Use a dependency only when the blocked work really waits for the blocker to be **closed**. If it waits for part of a larger issue (e.g. one of two merges), say so in a comment and keep the card in Next after the blocker instead.

## Work tracking: GitHub issues and the project board

Open work lives in GitHub issues on `migosoft/TinyAdventurers`, shown on the project board **"Tiny Adventurers"** (https://github.com/users/migosoft/projects/1, project number 1, private; the issues themselves are public).

- **Board columns** (the project's Status field): Backlog, Next, In progress, Waiting (blocked by another issue), In Review (waits for the user), Done.
- **Labels:** an area (`progression`, `ui`, `effects`, `lighting`, `combat`, `enemies`, `classes`, `items`, `world-objects`, `terrain`, `levels`, `content`, `infra`, `art`) plus kinds: `balancing` (tune in the balancing pass), `review-finding`, `play-test` (the user checks it in the browser), `idea`, `design-question`, `bug` (something is wrong in play or in the code; not a tuning number), `fable` (creative work: only a session on Fable does it, see "Fable work"). Priority is the board order only; there are no priority labels.
- **New follow-up:** `gh issue create --repo migosoft/TinyAdventurers --title ... --label ... --body ...`, then `gh project item-add 1 --owner migosoft --url <issue url>` and set its Status (a card added this way has none). One issue per piece of work; put file names, numbers and decisions in the body so it stands alone.
- **Moving a card:** `gh project item-edit --project-id <id> --id <item id> --field-id <Status id> --single-select-option-id <option id>` (ids from `gh project view 1 --owner migosoft --format json`, `gh project field-list 1 --owner migosoft --format json`, `gh project item-list 1 --owner migosoft --format json`).
- **Decisions** made while working on an issue go into the issue as a comment (and into TECHNICAL.md when they shape the code).
- Issues are public (the repo is public): never put secrets, server addresses or personal data in them.
- **The open issues are the whole todo list.** The user deletes issues they no longer want. A todo mentioned in TECHNICAL, a spec, a plan or git history (including the old `HANDOFF.md` and `docs/TODO.md`) that has no issue was dropped: never recreate it from there. Ask the user if it seems important.

### Linking commits, branches and PRs to issues

GitHub links them by the issue number, so every piece of work names its issue:
- **Branches:** `feature/<N>-<short-name>` from `main` (or `gh issue develop N --name feature/N-short-name`, which also lists the branch on the issue).
- **Commits:** end each commit's subject or body with `(#N)` or `Refs #N`. The commit then shows in the issue's timeline. A commit touching several issues names each.
- **Closing:** `Closes #N` (or `Fixes #N`) in the PR description, or in the last commit, closes the issue once it reaches `main`. Use it only when the issue is fully done. Also set the card to Done if the board's "Item closed" workflow is off.
- **Fast-forward merges without a PR** work the same: the closing keyword in a commit message counts when the commit is pushed to `main`.
- **Specs and plans live in the issue, not in the repo** (the user, 2026-10-31). Once approved, the design is posted as a "Design" comment and the plan as an "Implementation plan" comment on the issue; no `.md` file for them is committed. Changes later on (picked values, plan fixes) are edited into those comments or added as new ones. The older files in `docs/superpowers/` are history; leave them.

## How the user wants work done

- **One feature per session.** When it is done: update the docs (TECHNICAL, PLAYER_GUIDE), run the verification below, then commit.
- **Branches:** `main` holds finished work. Ask before merging into `main` or pushing. Never delete remote branches without asking.
- **Bigger features, in three sessions** (the user, 2026-11-06): session 1 reads the issue, brainstorms, writes the design and posts it to the issue once the user approves, then stops. Session 2 reads the issue with the design and writes the implementation plan, then posts it. Draft both in the scratchpad, not in the repo (superpowers skills). Session 3 reads the issue with those comments and implements the plan, subagent-driven: implementers and fixers on **Sonnet**, task reviews and the final whole-branch review on **Opus** (small re-reviews of a fix may use Sonnet). Merges, pushes and the finishing step stay in the main session. On a `fable` issue the Fable session decides per task whether a subagent needs Fable too, by what the subagent takes over (look work: Fable; mechanical work such as wiring, tests or docs: the models above), and says so in the plan (the user, 2026-11-21).
- **Remote:** `origin` = https://github.com/migosoft/TinyAdventurers.git; `main` tracks `origin/main`. `.gitattributes` keeps LF line endings.

## Standing decisions

Lasting rules that are not one issue's business. Feature-specific decisions live in their issue and in TECHNICAL.md.

### Gameplay and design
- **Balancing waits:** every tuning number is a first guess until the balancing pass (label `balancing`), done once for progression, classes, enemies and bosses together. Don't tune piecemeal.
- **Party size** (2026-10-19): if bigger parties need harder fights, scale the number of enemies or their Attributes, never their HP.
- **Design rule for abilities** (2026-10-21): primaries are dependable damage with at most a mild effect; strong control goes on secondaries with long cooldowns. Check every new ability and tree node against it.
- **Progression is permanent** (meta-progression across runs) and **per character**. There are no Attribute maximums; Attributes are bought only on the Sheet.
- **Naming:** say "damage-type effects", never "elemental" (future types such as holy are not elements). A new enum variant must be impossible to half-add (`listed_enum!`).
- **Desktop only:** keyboard and mouse in a desktop browser. No phone layouts or touch controls.
- **Responsiveness is a priority** ("no lag"): keep prediction, interpolation and lag compensation working. Check with `?lag=150&jitter=40&loss=2` and F3.
- **Debug accounts** (2026-10-24, #151): only accounts the admin marks in `/admin` can use debug; they play only with each other; debug runs bank; unmarking wipes the account's progress. No `ALLOW_DEBUG`, no `?debug`, no URL boss preselect. Inside a debug run F9 switches only immortality.
- **Facing is left/right only** (the pack has no up/down frames); the code keeps a `Dir` hook.
- **Minions are never tinted:** raised skeletons and summoned imps look like the ordinary ones.
- **Demon dungeon:** imps (ranged, claw up close) and chorts (melee, a bolt from afar) replace skeletons; summoners (red robe, summon imps) replace necromancers.
- **Mimics hop after the players**, and their reveal animation stays.
- **Boss halls** have chasms, and no door: a shimmering, semi-transparent blue force field appears when the party is inside.
- **Ogre mini-boss:** one per run in every dungeon, roaming a deeper room; a wide HP bar instead of a boss bar; a blue debug path to it.
- **Coins** are a second currency.
- **Melee:** weapons are drawn small (0.6×); a swoosh at the real damage reach replaces the visible full swing. Melee reach is unchanged on the server.
- **Walls** are full 3D blocks: a top, and a face of laid or natural stone on every side that borders a lower cell (`client/src/render3d/heights.ts`, `worldMesh.ts`, `stone/`).
- **No miniature bases** under figures; they stand on a soft ground shadow (a floor ellipse under each figure, `pushShadow` in `client/src/render3d/cards.ts`).

### Art
- **Art rule:** no self-made art without the user's go-ahead. Sprites come from the 0x72 "16x16 DungeonTileset II" pack, plus free sets in its style (licence checked, a `LICENSE.txt` next to the files, a README credit for every source even where none is required).
- Self-made exceptions the user allowed: terrain tiles generated from pack colours (`client/scripts/terrain-tiles.ts`); the lich, hand-placed pixel art in pack colours (`client/scripts/lich-frames.ts`, credit "drawn for this game with Claude Code"; show changes in `?r3d=gallery` first); the Ghost and the Shade, an AI-generated ghost redrawn by hand at 16x16 (`client/scripts/spectre-frames.ts`, #200); the nymph's cove plants (hand-placed pixel grids in `client/scripts/cove-frames.ts`, #202) and `client/src/game/vegetation.ts`, which draws every tree, conifer and bush at run time, the cove tree included ("drawn for this game with Claude Code"; the user approved the sheets in #203); the wall torch's iron holder and its flame built in code (`client/src/render3d/torch/`; "drawn for this game with Claude Code", #391); the chest, Mimic and explosive barrel models built in code (`client/src/render3d/models/descs/chest.ts`, `mimic.ts`, `barrel.ts`; "drawn for this game with Claude Code", #317); the Ghost and Shade models built in code (`client/src/render3d/models/descs/ghost.ts`, `shade.ts`; "drawn for this game with Claude Code", #359); the lich's 3D model built in code (`client/src/render3d/lich/`; "drawn for this game with Claude Code after the user's description", #358); the dungeon's stonework built and painted in code: laid stone and natural rock, the carved friezes, summoning circles, mosaics, drain grates, puddles, cracks and the glowing crystals (`client/src/render3d/stone/`; "drawn for this game with Claude Code", #380); the arrows, bolts and thrown axe in flight built in code (`client/src/render3d/fx/frameShots.ts`; "drawn for this game with Claude Code", #407); the loading bar's rune glyphs, stroke paths in code (`RUNES` in `client/src/ui/loading.ts`; "drawn for this game with Claude Code", #405); small recolours of pack frames when asked (the summoner's red robe). Missing figures are pack sprites scaled or tinted; attacks animate pack weapon sprites; runtime effect shapes (particles, glows, swooshes, rings) are fine.
- **AI-generated art the user supplies** (the dragon, the demon, the explosion, the ghost the Ghost and Shade are redrawn from) is credited as AI-generated, not as the user's work. New dragon frames: ask the user for a strip (`client/assets-src/dragon/dragon_base.png` scaled up 16× with nearest neighbour is the reference; prompt pattern: same dragon, same pixel scale and palette, N frames in a row, flat #ff00ff background, no effects).
- **The user's asset inbox** is the untracked `images/` and `downloaded-assets/` folders (when present): copy a file into `client/assets-src/<name>/` to use it; never commit, delete or ask about deleting those folders.

### Stack, data and security
- Rust backend in a Docker container (required); TypeScript + three.js client; a dedicated server with a lobby; joining only before a run starts; permadeath with spectating.
- **Accounts:** no e-mail or other personal data, so no password recovery; login required. Up to 8 characters of any class per account; character names globally unique. Deleting an account or character is final.
- **Database:** PostgreSQL in its own container. Relational identity, progression as one versioned JSONB document per character: change the `Progress` struct, not the schema. No cache layer (Valkey etc.) until there are several game servers. Stored data is not critical yet (not in production use): it may be dropped instead of migrated.
- **Licences:** OSI open-source licences for infrastructure (MongoDB's SSPL was rejected).
- **Security:** the server is authoritative; never accept progress values from the client. Sessions are HMAC-signed cookies backed by the database.

### Plan 4 rulings (approved with the plan, confirmed by the user 2026-10-22)
1. Improvements apply to the equipped version from either source and stack with the item's mods.
2. Unbreakable: +4 CON for every save only (not HP, speed or prices).
3. Run-time keystones count the hero's own hits (not effect ticks, not the wolf).
4. Pyromancer and Deep Winter scale by the damage type's share of the hit.
5. Berserker: below 50 % HP, damage x1.25, cooldowns ÷ 1.25, every resistance −0.10 (also below 0).
6. Deadeye: hits of abilities with `ranged: true`; Slowed, Chilled, Entangled or Sleep targets.
7. Radiant: Innate-category abilities; Undead or Demon races; the new Radiant light.
8. Build changes are refused during a run and while Ready.
9. `SetLoadout` stores any pick that fits its slot; the sheet reports the rest; Ready and Start refuse it.
10. Equip moves items between the inventory and a slot; starters are ordinary items.
11. Respec unequips items the build can no longer wear.
12. Unknown ids in a stored document are dropped with a warning.
13. The debug flag stays (whole class pool, Attribute lift), on top of the real build; `DebugGrantItem`. Debug runs bank (#151).
14. Admin statistics count tree nodes bought.

## Environment (this machine)

- Linux, bash. Rust (`cargo`) is installed locally, Node via nvm (use `bash -lic '...'` so nvm's Node is on the PATH), `python3`, Docker. No local `psql` and no clippy.
- **Code intelligence:** Claude Code's LSP tool is backed by rust-analyzer (`server/`) and typescript-language-server (`client/`). Use it for find-references and go-to-definition, and before renaming or changing a signature, instead of grep/sed; confirm with `cargo check` / `tsc --noEmit`. Edit Rust and TypeScript source only with the Edit/Write tools, never with sed or scripts: rust-analyzer only sees changes made through them. After git checkout, merge or rebase, rust-analyzer's results are stale for the rest of the session: use grep and `cargo check` instead. Right after a session starts both servers can return partial results: never read "no references" as safe to rename; repeat the query and cross-check with grep before a rename. New code goes in `client/src`, `client/scripts` or `server/`. Don't use rust-analyzer's `ssr`/`search` commands: they crash in this version.
- **`.env`** (gitignored) holds `POSTGRES_PASSWORD` and `SESSION_SECRET` for the local stack; without it `docker compose up` refuses to start.
- **Database shell:** `docker compose exec db psql -U tiny -d tiny`.
- **Docker volumes** `ta-cargo` and `ta-target` (external) cache the test builds.
- **Browser tests** use `playwright-core` with the installed Brave: set `BROWSER=/usr/bin/brave-browser` (the scripts default to a Windows Edge path). Headless rendering is software (SwiftShader), so FPS in tests (~15–28) says nothing about real performance.
- **Fast client iteration:** `cd client && npx vite --port 5173` against the running container, then `http://localhost:5173/...`. Stop the Vite process afterwards.
- **The sprite pack** is in `client/assets-src/0x72/`. To re-download it from itch.io: `POST https://0x72.itch.io/dungeontileset-ii/file/9911410?source=view_game&as_props=1&after_download_lightbox=true` with the page's `csrf_token` and cookies.

## Verification after a change

1. Server: `cd server && cargo test -- --skip export_bindings` (bin-only crate; focused runs `cargo test --bin '*' <filter> -- --skip export_bindings`). The `export_bindings` tests regenerate `client/src/generated` and fail locally with EACCES (root owns some files); run them through the docker suite.
2. Client: `cd client && bash -lic 'npx vitest run && npx tsc --noEmit && npm run build'`.
3. Full suite against a throwaway Postgres: `docker compose -f docker-compose.test.yml run --rm test`, then `docker compose -f docker-compose.test.yml down`. Every change to exported data regenerates `client/src/generated` this way.
4. `docker compose up --build -d`, then `curl localhost:8080/health` prints `OK`.
5. Smoke: `cd tools/e2e && BROWSER=/usr/bin/brave-browser node smoke.mjs http://localhost:8080/ "" shots ElvenRanger,Paladin` (and `Wizard,Barbarian`; a sixth argument picks the level: `... ElvenRanger,Paladin woodland`, default `dungeon`). It plays a two-player run in the 3D view with ordinary accounts and should print "no browser errors"; look at the screenshots in `shots/`. The run of a debug account (debug keys, free camera, dev panel): `node r3d-run.mjs http://localhost:8080/ shots dungeon` (and `woodland`), same `BROWSER`; `BOSS=lich|dragon|demon` picks the boss before the start, which decides the dungeon's stone layout (laid, natural rock, both; #380).
6. Visual changes: the 3D view's dev pages, which need no server (`?r3d=<page>`; `node r3d-shot.mjs` shoots them): `?r3d=gallery` (every figure kind in every state, the objects and a corridor behind a wall; `&state=<state>&slow=10`; `node r3d-shot.mjs http://localhost:5173/ shots "&state=melee" webgl "" gallery`), `?r3d=cove` (the nymph's cove: willow, grass, pixies), `?r3d=lights` (the lights demo: torches, lava, a fireball, a frost bolt, an explosion flash; `node r3d-shot.mjs http://localhost:5173/ shots "" webgl "" lights`), `?r3d=demo` (the 3D view's dev scene; `node r3d-shot.mjs http://localhost:5173/ shots`, add `"" webgl lose` for a device loss), `?r3d=woodland` (the woodland's sun, shadows, wind and time of day; `node r3d-shot.mjs http://localhost:5173/ shots "&hour=18.5&yaw=45" webgl "" woodland`), `?r3d=mood` (the dungeon air in 3D: torch smoke, lava embers, dust, haze, pool drips, movers stirring the air; add `mood` as the last argument of `r3d-shot.mjs`), `?r3d=sunlight` (cracks, shafts and patches in 3D; keys or panel buttons 2, R, V; `sunlight` as the last argument), `?r3d=gallery&focus=models` (the 3D figure models in every state, #338; `&light=torch`, `&crowd=40`, `&aim=90`, `&at=variety:<row>`, `&at=spectre:<i>` (the spectre block of #359: places 0 to 2 the Ghost standing, walking and in its life loop, 3 to 5 the Shade; `&zoom=8`); `?r3d=gallery&focus=lineup` is the size line-up of every model key, shortest left (#356; whole row at `&zoom=1`, halves `&at=lineup:4&zoom=3` and `lineup:14`; `&circles=1` draws each figure's server hit circle as a ring on the ground); `?r3d=gallery&focus=models&at=object:<i>` (the object row of #317: places 0 chest, 1 opening chest, 2 barrel, 3 cycling explosive barrel, 4 hiding Mimic, 5 hopping Mimic, 6 a Mimic that reveals itself every 6 s); also `?r3d=woodland&models=1`; check shots: `node models-shots.mjs http://localhost:5173/ shots`, `GPU=1` for WebGPU on the real card), `?r3d=liquids` (sunken water, lava and chasm with wading, lava sink and pushed figures, #324; the water is the clear 3D surface with ripples, droplets and reflections, #345: `&refl=0` turns the reflections off, as quality Fast does; keys 1, 2, 3 push an imp into the chasm, an imp into the deep water and a barrel into the chasm, or the panel's buttons; `&push=chasm|water|barrel`, `&models=barrel` (only the barrel as a 3D model, #317), `&models=<key>` (any key of `MODEL_OF_KIND`, e.g. `stag`, `wolf`, `goblin`, `imp`, `npcKnight`: that kind plays every role as a 3D model, #357, #356), `&t=<s>` pins the clock; on every dev page `&zoom=1..48` and the panel's zoom slider go as close as a Goblin filling the window (`"&zoom=40"` in `r3d-shot.mjs`'s extra query); the lava is the molten 3D surface with bubbles, the knight sinks to the waist in an open ring and the heat shimmer wobbles the picture above it (#344: `&heat=0` turns the shimmer off, as quality Fast does); `node r3d-shot.mjs http://localhost:5173/ shots "&push=chasm&t=1.6" webgl "" liquids`), `?r3d=stone` (the stonework, #380: caves, a passage where rock turns into masonry, a laid hall, a room with the summoning circle and one with the mosaic and a grate, crystals in the caves; `&stone=laid|rock|zones`, `&at=cave|border|hall|circle|mosaic|cave2|door|grate|torch|rocktorch|puddle` (`puddle`: beside the nearest puddle, D walks through it; check shots `node puddle-shots.mjs http://localhost:5173/ shots`, #401), `&lamp=0` the knight's light off, `&break=1` every crystal broken, `&refl=0`, `&t=<s>` pins the clock; `node r3d-shot.mjs http://localhost:5173/ shots "&stone=rock&at=cave" webgl "" stone`), `?r3d=lich` (the built lich, #358: `&act=stand|glide|nova|raise|bolts|curse|mist|gaze|hurt|broken`, `&at=<s>`, `&glide=1`, `&fx=frozen|chilled|stone|immune`, `&t=<s>` pins the clock; `node lich-shot.mjs http://localhost:5173/ shots-lich webgl`, `webgpu` and `GPU=1` for the real card), `?r3d=fx` (the 3D effects, #308: groups `spells`, `booms`, `shots`, `figures`, `bosses`, `hazards`, `status`, `objects`; `&fx=<group>`, `&t=<s>` pins the clock, `&slow=<n>`; `node r3d-shot.mjs http://localhost:5173/ shots "&fx=booms&t=0.25" webgl "" fx`). Terrain tile changes: edit `client/scripts/terrain-tiles.ts`, then `npm run atlas`.
6a. 3D view (#302): the scripts that play a run (`smoke.mjs`, `r3d-run.mjs`, `charm-run.mjs`) share `tools/e2e/r3d-page.mjs`; the r3d e2e windows are 1280x768 because WebGPU on the dev notebook loses its device silently at 720 (the scripts fail on a "device lost" warning); `READBACK=1` saves `r3d-readback.png`, the way to see a WebGPU frame. Headless is SwiftShader: real frame rates and WebGPU need a real screen (a headed Brave window is allowed; it still captures WebGPU black). `HEADED=1 node r3d-shot.mjs <url> <dir> "" webgpu` runs the WebGPU mode in a visible window on the real GPU.
7. Fingerprint tests (`level_setup_is_unchanged`, `simulation_is_unchanged_after_waking_the_boss`, `plan_3a_fight_is_pinned`) must pass unchanged unless the change is meant to alter the simulation; then re-record them once and say so.

## Gotchas

- **Generated client files:** never edit `client/src/generated/*` by hand. Change Rust and regenerate.
- **Snapshots and inputs are arrays on the wire** (`wire.rs`, `wire.ts`). When you add a field to `Snapshot`, `SelfState`, `EntSnap`, `BossBar`, `Ev` or `InputMsg`, add it to the wire type, both converters and `sample_snapshots`; the fixture test fails otherwise. Test scripts that read the WebSocket must decode arrays (`m[3][3]` is the own x).
- **Message tag:** MessagePack enums are tagged with the field `t`, so no variant may have a field named `t` (that is why `Ping`/`Pong` use `time`).
- **Prediction parity:** client prediction relies on `client/src/sim/collision.ts` matching `server/src/collision.rs` exactly, and on the order *move, then abilities* in `Run::apply_input`. Change both and keep `sim.test.ts` green. The visibility polygon is shared the same way (`vispoly`), with a parity fixture.
- **Cooldowns** tick per processed input on both sides. Don't switch the server to wall-clock cooldowns without updating `Predictor`.
- **The lobby lock is a std `Mutex`:** never hold it across an `.await`. Do database work first, then lock and apply.
- **Boss behaviours** are taken out of the level's `BossEncounter.behaviour` during their tick (`Option::take`), so `hurt_monster`'s immunity check cannot see the boss during its own tick.
- **Stale client:** if a client looks older than the server, hard-reload (Ctrl+F5) first (`cache_headers` in `main.rs` normally prevents it).
- **Pack frame names** are used verbatim (`knight_m_run_anim_f2`). `necromancer` only has `necromancer_anim_f0-3`, used for both idle and run.
- **Dragon:** breath points come from `dragonPoints()` in `anim/dragonRig.ts`; if a strip is re-imported, update its `head` offsets in `DRAGON_SHEETS`. Dragon attack anims include the wind-up (other monsters use `Anim::Windup` then the attack anim).
- **Characters:** the client must send `SelectCharacter` after connecting; without it rooms are refused and nothing is banked.
- **Seeding test XP:** `docker compose exec db psql -U tiny -d tiny -c "update characters set progress = jsonb_set(progress, '{xp}', '1000') where name = 'Hero'"`, then reselect the character (the lobby caches it).
- **Test accounts:** the smoke test deletes its `e2e_*` accounts. If it crashes midway: `delete from accounts where name like 'e2e\_%'`.
- **Lobby screenshots:** the lobby scrolls inside `.lobby`, so Playwright `fullPage` shots are cut off; screenshot elements instead.
- **Rolling back past progression plan 4 is unsafe** for saved characters (the old reader drops `nodes`, `bought` and `xp_spent` on its next save).
