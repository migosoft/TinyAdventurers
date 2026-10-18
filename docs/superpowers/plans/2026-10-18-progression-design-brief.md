# Brief: progression design (Attributes, items, class skill trees, loadouts, new pre-run UI)

For: the next session, which builds the demo pages, takes the screenshots and writes the design document. Everything decided in the brainstorming session (2026-10-18, with the user) is below. Do not re-ask what is decided. Ask the user only about things marked open.

## 1. The job

The user wants **a design document that another agent can implement from**, plus **screenshots of the important new screens**.
- **Nothing in the game is implemented.**
- **The demo pages are a throwaway spike.** They use mock data and need no server. Their only purpose is the screenshots.
- **Branch:** `feature/skill-tree-design` (created from `main` at `ac36d0c`, no commits yet).
- **Already done:**
  - `npm ci` in `client/` and `tools/e2e/`;
  - `npm run atlas`, so `client/public/assets/atlas.{png,json}` exists.

**Deliverables:**
1. `client/src/uidemo/`: demo screens, opened with `?uidemo=<screen>`. Hook this into `client/src/main.ts` the same way `?gallery` and the `DEMOS` map are checked.
2. `tools/e2e/ui-shots.mjs`, modelled on `tools/e2e/gallery-shots.mjs` (playwright-core, 1280×720). It must log page errors.
3. Screenshots in `docs/superpowers/specs/img/2026-10-18-progression/`.
4. The spec `docs/superpowers/specs/2026-10-18-progression-design.md`, in the format of the existing specs in that folder.
5. **Builder check:**
   - Have a fresh subagent read the spec with the brainstorming skill's `builder-check-prompt.md` (in `~/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0/skills/brainstorming/`).
   - Sort its questions into three groups: answered already (put the answer in the spec), minor (decide it yourself and mark it "(my call)" in the spec), and the user's.
   - Ask the user's questions in **one** message, most important first.
6. **Update the docs:**
   - Put a pointer in `HANDOFF.md` ("Next session") and in `docs/TODO.md` priority 4.
   - Hand over with the list of "(my call)" decisions, and offer superpowers:writing-plans.
   - Commit only when the user asks.

## 2. Environment (this machine is Linux; the environment notes in HANDOFF.md are from an old Windows machine)

- **Node 26.12.0** comes through nvm (`~/.nvm`); the system Node 18 is too old for Vite 7.
  - Non-interactive shells don't load nvm, so run commands with `bash -lic '…'`, or first `. ~/.nvm/nvm.sh`.
  - Dev server: `cd client && npx vite --port 5173`. The demo pages need no backend.
- **Browser:** `BROWSER=/usr/bin/brave-browser` for playwright-core. Keep the SwiftShader args from `gallery-shots.mjs`.
- **No Rust and no Docker are needed** for this job.
- **Checks:** `npm run typecheck` and `npm test` in `client/` must stay green. Without `?uidemo` the game must start unchanged.
- **Art:**
  - Hero figures: `ui/classes.ts` `FIG` / `classFigure`, `ui/atlas.ts` `spritePreview`.
  - Weapon icons: atlas frames `weapon_*` (anime_sword, arrow, baton_with_spikes, big_hammer, bow, bow_2, double_axe, cleaver, duel_sword, golden_sword, green_magic_staff, hammer, katana, knife, knight_sword, lavish_sword, mace, saw_sword, machete, red_gem_sword, red_magic_staff, regular_sword, rusty_sword, spear, waraxe, throwing_axe, axe, lich_staff).
  - Style: `client/src/style.css` tokens (`--bg`, `--panel`, `--panel-edge`, `--gold`, the 'Press Start 2P' pixel font).
  - The art rule from HANDOFF: no self-made art without the user's go-ahead. Draw node and slot icons from atlas frames, letters or CSS.

## 3. The code today (for the spec's data model)

- **Progression:** `server/src/defs/progression.rs`. `StatUpgrades` (damage, attack_speed, move_speed, life, armor; 10 levels each) feeds `Modifiers`, which the simulation reads. `Modifiers` is sent in `RunStartInfo` for the client's prediction.
- **Saved progress:** `server/src/progress.rs` holds `Progress`, one JSONB document per character (`version`, `rev`, `xp`, `total_xp`, `coins`, `upgrades`). A structural change bumps `CURRENT_VERSION` and adds a step to `upgrade()`; no SQL migration is needed.
- **Classes:** `defs/classes.rs`. Each class has fixed `hp`, `speed`, `primary` and `secondary` (`AbilityId`). The hero profile is always `EntityType::Human`.
- **Abilities:**
  - `defs/abilities.rs` has 8 abilities with their stats, plus `on_hit` (a stub) and `ALL`.
  - `run/abilities.rs` `try_use` holds the CrossbowDagger rule: `dagger_target` uses the dagger when an enemy is within `DAGGER_RANGE`.
  - The client predicts cooldowns in `client/src/game/GameScene.ts` (around line 464).
- **Entity types:** `defs/entity_types.rs`. Human, Undead, Monster, Demon, Dragon and Object, each with resistances, melee split and sight. An entity can add its own `Adjust` on top.
- **Enemies and bosses:** `defs/enemies.rs` (`EnemyType`, `AttackStyle` Melee/Ranged/Slam, an `alt` attack) and `defs/bosses.rs`. Status effects (with `EffectResponses` such as Immune) are in `defs/effects.rs`.
- **Protocol:** `server/src/protocol.rs`: `SelectCharacter`, `BuyUpgrade`, `CharacterInfo` (with upgrades, mods, costs), `RunStartInfo`.
- **UI:**
  - `client/src/ui/characters.ts`: the character list and creation.
  - `ui/lobby.ts`: home (hero, runs, upgrades panel) and the waiting room (party, boss cards, upgrades).
  - `ui/text.ts`: `CLASS_TEXT`, `STAT_TEXT`.
  - The client's TS types are generated by ts-rs (`client/src/generated/`).
- **Visuals:** the enemy weapon visuals are in `client/src/game/anim/defs.ts`.

## 4. Decisions (the user's, unless marked "my call")

### 4.1 Attributes
- **Names:** six **Attributes**: STR, DEX, CON, INT, WIL, CHA.
  - "Ability" now means only the LMB **primary ability** and the RMB **secondary ability**.
  - The shop is the **Attribute shop**.
  - The UI and the spec must not say "ability score".
- **Loosely D&D, with no dice and no caps** (no maximum, for heroes and enemies alike; late-game balancing comes later).
- **Every point counts:** effects are linear per point above or below 10. There are no D&D half-steps (my call).
- **The class sets the starting Attributes.** My call: all classes use the standard array.

| Class | STR | DEX | CON | INT | WIL | CHA | Base HP + 5×(CON−10) = HP | Weight |
|---|---|---|---|---|---|---|---|---|
| Wizard | 8 | 14 | 12 | 15 | 13 | 10 | 60 → 70 | 9 |
| Paladin | 15 | 8 | 13 | 10 | 12 | 14 | 105 → 120 | 12 (+ armor) |
| Barbarian | 15 | 13 | 14 | 8 | 12 | 10 | 120 → 140 | 13 |
| Assassin | 10 | 15 | 12 | 8 | 14 | 13 | 80 → 90 | 10 |

**What each Attribute does (final):**

| Attribute | Effect |
|---|---|
| STR | Melee, thrown and natural-attack damage ±5 % per point. Pushes (see 4.3). The projectile speed and range of ranged weapons. |
| DEX | Finesse and ranged weapon damage ±5 % per point. The arc of **every** melee attack +3 % per point. Melee attack speed and ranged firing speed +2 % per point. Through damage it also sets piercing (4.4). **Not DEX:** move speed, blast damage reduction (dropped), projectile speed and range, thrown damage. |
| CON | HP = class base + 5 per point above 10. Move speed +1 % per point (the user, added 2026-10-18 after the brainstorming; the size is my call). The save against non-magical effects. |
| INT | Spell damage ±5 % per point. Spell effect power. |
| WIL | The save against hostile **magical** effects. It shortens their duration only, never damage. |
| CHA | Innate magic: damage and heal ±5 % per point, effect power, auras. Later also prices and NPCs. |

- **Calibration (my call):** at the starting Attributes every number equals today's. Base values are worked back from the starting Attributes, and balancing is TODO priority 18.
- **Two layers that never mix:**
  - **Resistances** (% per damage type: physical, cold, heat, magical, poison) reduce **damage**. They come from the race, the entity's own adjustment, items and tree nodes.
  - **Attributes** do everything else and never touch resistances.
  - Armor's damage reduction is physical resistance. The XP "Armor" upgrade goes away.

### 4.2 Growth, prices, respec
- **The Attribute shop** (XP): price per point = (100 + 25 × max(0, current − 10)) × weight.
  - Weights: DEX 1.25, WIL 0.8, STR / CON / INT / CHA 1.0.
  - The weights live in **one data table** in `defs/`, easy to change; the user may add WIL-based abilities later.
- **Skill tree nodes** cost XP directly. There are no character levels and no skill points.
- Tree nodes and items can also add Attributes.
- **Respec** costs coins. It resets the tree **and** the bought Attributes, refunds all the XP spent and returns the character to the class start. My call: the price grows with the XP spent.
- **Migration** (my call): today's `StatUpgrades` are removed, and existing characters get their spent XP back. This is `Progress` v2, with no backwards compatibility.
- DEX is worth the most per point: +7 % damage per second for its own builds, plus speed and arc for every weapon user. WIL is worth the least. That is why the weights above differ.

### 4.3 Weight and pushes
- Every entity (heroes, monsters, bosses, objects) has a **weight**.
- A push happens only if the pusher's **STR is above** the target's weight.
  - Distance = base push × min(1, (STR − weight) / 4) (my call).
  - Blasts carry their own STR value. My call: barrel 18.
  - Heroes' weight = body + gear: armor adds weight, so heavy armor makes a hero harder to push.
- **Weights (my call):**
  - Heroes: see the table in 4.1.
  - Small enemies: imp 4, goblin 6, skeleton 9, chort 10.
  - Large enemies: orc 13, mimic 14, ogre 20.
  - Bosses: 40, so they are never pushed (as today).
  - Barrel: 6, so even the Wizard (STR 8) can push it with E.

### 4.4 Effects without dice
- **Duration** = base × max(0, 1 + (power − save) / 20) (my call).
  - **Power** is the source's key Attribute: INT for spells, CHA for innate magic, or the weapon or source for non-magical effects.
  - **Save** is WIL against magical effects and CON against non-magical ones (a poisoned blade, burning ground).
  - A save 20 points above the power gives 0 s, which means immune.
- **Hard immunities** from the race or entity type (for example, bosses are immune to Sleep) still override the formula.
- **Effects from allies** (heals, buffs) are never reduced.
- **Examples:**
  - The Wizard's Sleep (INT 15) on a goblin (WIL 8) lasts ×1.35.
  - The lich's Sleep mist (INT 22) on the Assassin (WIL 14) lasts ×1.4.

### 4.5 Races (entity types become D&D-like races)
- **Each race gives:** resistances, sight, Attribute bonuses (for example Undead CON +2, the planned Elf DEX +2), hard immunities and a **natural attack**.
- **`Monster` is split into Goblin, Orc, Ogre and Mimic.** Each keeps Monster's current resistances (none) and darkvision (1/3).
- **Every race has a natural attack**, so every entity always has a melee fallback:

| Race | Natural attack | Members |
|---|---|---|
| Human | Unarmed strike | Heroes, necromancer, summoner, disciple |
| Goblin | Unarmed strike | Goblin archer |
| Orc | Unarmed strike | Orc warrior, orc archer |
| Ogre | Unarmed strike | Ogre |
| Mimic | Bite | Mimic |
| Undead | Unarmed strike | Skeletons, lich |
| Demon | Claws | Imp, chort, Red Demon |
| Dragon | Bite, claws, tail | Red Dragon |
| Object | none | Chests, barrels |

### 4.6 Enemies
- **Enemies have no classes** (the user asked; the answer was no). A stat block per enemy type is enough: Attributes, base HP, weight, weapons, proficiencies, abilities. A template layer for elite variants can be added later as data.
- **Enemies use the same weapon model:** they carry weapons, they have the proficiencies for them, and their natural weapons come from their race. Their AI behaviour stays as today.

**Enemy Attributes (my call, loosely from the D&D Monster Manual):**

| Enemy | Race | STR | DEX | CON | INT | WIL | CHA |
|---|---|---|---|---|---|---|---|
| Goblin archer | Goblin | 8 | 15 | 10 | 10 | 8 | 8 |
| Skeleton warrior | Undead | 12 | 12 | 15 | 6 | 8 | 5 |
| Skeleton archer | Undead | 10 | 15 | 13 | 6 | 8 | 5 |
| Raised skeleton / raised archer | Undead | as their originals, CON 12 | | | | | |
| Orc warrior | Orc | 16 | 12 | 16 | 7 | 11 | 10 |
| Orc archer | Orc | 14 | 14 | 14 | 7 | 11 | 10 |
| Necromancer | Human | 9 | 14 | 12 | 17 | 12 | 11 |
| Summoner | Human | 9 | 14 | 12 | 15 | 12 | 16 |
| Disciple | Human | 10 | 12 | 10 | 13 | 11 | 10 |
| Mimic | Mimic | 17 | 12 | 15 | 5 | 13 | 8 |
| Imp | Demon | 6 | 17 | 13 | 11 | 12 | 14 |
| Summoned imp | Demon | as the imp, CON 10 | | | | | |
| Chort | Demon | 14 | 13 | 13 | 8 | 10 | 9 |
| Ogre | Ogre | 19 | 8 | 16 | 5 | 7 | 7 |
| Red Demon (boss) | Demon | 22 | 14 | 20 | 14 | 16 | 20 |
| Lich (boss) | Undead | 10 | 14 | 14 | 22 | 18 | 16 |
| Red Dragon (boss) | Dragon | 24 | 10 | 22 | 16 | 14 | 20 |

**Enemy weapons and proficiencies** (taken from the sprites in `anim/defs.ts`):

| Enemy | Melee | Ranged | Spells (INT) / innate (CHA) / techniques | Proficiencies |
|---|---|---|---|---|
| Goblin archer | (unarmed) | Bow | – | Bow, dagger |
| Skeleton warrior / raised | Rusty sword | – | – | Sword |
| Skeleton archer / raised | (unarmed) | Longbow (bow_2) | – | Bow, sword |
| Orc warrior | Cleaver | – | – | Axe, club |
| Orc archer | (unarmed) | Bow | – | Bow, axe |
| Necromancer | Green staff | – | Shadow Bolt, Raise Dead (spells) | Staff, dagger |
| Summoner | Red staff | – | Fire Bolt (spell), Summon Imps (innate) | Staff, dagger |
| Disciple | Staff | – | Shadow Bolt (spell) | Staff |
| Mimic | Bite | – | – | – |
| Imp / summoned imp | Claws | – | Fire Bolt (innate) | – |
| Chort | Claws | – | Fire Bolt (innate) | – |
| Ogre | Spiked club | – | Ground Slam (technique, uses the club) | Club, hammer |
| Red Demon | Claws (cleave) | – | Swoop (technique), Ring of Fire (innate) | – |
| Lich | Lich staff | – | Gloom Bolt, Blinding Curse, Sleep Mist, Stone Gaze, Raise, Nova (spells) | Staff |
| Red Dragon | Bite, claws, tail | – | Fire Breath, Fireball (innate), Ground Smash (technique) | – |

### 4.7 Abilities and weapons
- **Each ability declares:**
  - a **category**: WeaponAttack, Technique (a non-magical special move), Spell or Innate;
  - what it **uses**: the melee weapon, the ranged weapon, or nothing;
  - its **requirements**: Attributes and optionally a weapon kind. Requirements use the same `Requirement` type as items and tree nodes.
- **Weapon attacks and techniques** take damage, attack speed, arc or range, damage split and on-hit effects from the weapon. Their key Attribute comes from the **weapon category**.
- **Spells** use INT and **innate abilities** use CHA, each with the ability's own stats and damage split.
- **Weapon effects apply only to the attacks that use that weapon.** For example, a flaming sword makes Strike and Charge burn, but not spells.
- **Today's abilities merge:**
  - Sword and Axe become one generic **Strike**.
  - CrossbowDagger becomes **Shoot** plus auto-melee.
  - A new weapon then needs data and a sprite, but no new code.

| Class | Melee weapon | Ranged weapon | Primary (LMB) | Secondary (RMB) |
|---|---|---|---|---|
| Wizard | Staff | – | Magic Missile (spell) | Fireball (spell) |
| Paladin | Sword | – | Strike | Holy Light (innate) |
| Barbarian | Great Axe | – | Strike | Charge (technique; my call: the weapon's damage × 0.8) |
| Assassin | Dagger (finesse) | Crossbow | Shoot | Hide (technique) |

- **Weapon kinds and categories:** every weapon kind maps to a category in **one exhaustive `match`**, so a new kind without a category does not compile. The user requires this to be enforced in the backend.

| Category (key Attribute) | Kinds |
|---|---|
| Melee (STR) | Sword (regular, knight, rusty, golden, lavish, red gem, anime, saw), Axe (axe, war axe, double axe, cleaver), Hammer (hammer, big hammer), Mace, Club (spiked baton), Spear, Staff (red, green, lich) |
| Finesse (**DEX only**) | Dagger (knife), duelling sword, katana, machete |
| Ranged (DEX) | Bow, longbow, crossbow (no sprite of its own; uses the bow sprite today), throwing knives (TODO's Assassin restyle) |
| Thrown (STR) | Throwing axe |
| Natural (STR, always proficient) | Unarmed, bite, claws, tail |

- **Melee rule:** **every ranged attack is blocked in melee, spells included** (the user).
  - When an enemy is within melee reach, a ranged primary ability switches to a strike with the melee weapon, or with the natural attack if there is none. The Wizard then hits with his staff; the user is fine with the Wizard being weaker in melee.
  - My call: "ranged" means delivered as a projectile or aimed at a distant spot. Self, aura, area, cone and dash abilities still work: Holy Light, Hide, Nova, breath, Charge, Ground Slam.
  - This matches today's imp and chort, which claw when close.
- **Proficiencies per class** (my call; tree nodes can add more):
  - Wizard: staff, dagger; cloth.
  - Paladin: sword, mace, hammer; all armor.
  - Barbarian: axe, hammer, club, sword, spear, throwing axe; light and medium armor.
  - Assassin: dagger, duelling sword, machete, bow, crossbow, throwing knives; light armor.
- **Hidden crits:** the ×4 from Hide applies to every attack from hiding, auto-melee included.
- **Torches:** "fire lights a torch" becomes "a hit with any heat share lights it", so a flaming sword lights torches too.

### 4.8 Weapon stats (the user's corrections)
- **Melee weapons:**
  - base damage, base attack speed (+2 %/DEX point), base arc (× +3 %/DEX point), push, damage split, effects (magical, such as flaming → a heat share; or non-magical, such as poison).
  - **No reach stat** (hard to animate with the assets). My call: reach is a constant plus the body radius, so the ogre and the demon reach further, as today.
- **Ranged weapons:** base damage, base firing speed (+2 %/DEX point), base range and base projectile speed (both raised by STR), damage split, effects (magical, such as a light arrow; or non-magical, such as poisoned).
- **Overkill piercing** (ranged and thrown weapons only):
  - A killing hit uses up only the damage needed to bring the target to 0 HP, after its resistances. The rest flies on to the next enemy.
  - An immune target stops the shot.
  - In effect, DEX sets how far shots pierce.
  - **Spell projectiles stop at the first enemy**, unless a tree node changes that.
- **Move speed** is a class or race base value, scaled by CON. Besides CON, only shoes, tree nodes and effects change it.

### 4.9 Items (the data model; item sources are out of scope)
- **Slots:**
  - Melee weapon: always filled (the class starter weapon).
  - Ranged weapon (optional).
  - Armor.
  - Ring ×2.
  - Shoes.
  - Belt.
  - Off-hand: reserved for shields later.
- **Item types:**
  - Armor: physical resistance %, weight, optional effects. Magical examples: an aura that makes everyone in its radius immune to an effect, or gives them more HP.
  - Rings: magical properties.
  - Shoes and belts (the user, decided after the brainstorming): magical bonuses only, like rings. They attach magical effects to a character while worn. No potions.
  - Items can grant abilities (added to the loadout pool while worn), optionally waiving the ability's Attribute requirements. Every item has a class requirement: one or more classes, all of them allowed (the user, decided after the brainstorming).
  - It must be easy to add more.
- **`ItemDef`:** an id, a slot, a base (`Melee(MeleeStats) | Ranged(RangedStats) | Armor(ArmorStats) | Ring | Shoes | Belt …`), requirements and a list of **`ItemProperty`**. Each property is flagged magical or non-magical.
  - Property kinds: damage share, on-hit effect, light, resistance, Attribute bonus, effect immunity, weight, and aura (a radius plus a property granted inside it).
- **The user wants an extensible, "object-oriented" backend.** The repo's idiom is data tables in `defs/*.rs` with `match`. Express "OO" as typed data plus exhaustive matches, and traits only where they help.
- **Out of scope:** item sources (drops, coin shop, rarities, inventory size). The Equipment tab shows sample items.
- **One character sheet:** class, race, Attributes, tree nodes, items and effects each add their contributions to it at run start.
  - The simulation reads only the sheet; it replaces `Modifiers` and `StatUpgrades`.
  - The server sends the **resolved** numbers of every equipped ability (cooldown, arc, range, speed, radius) in `RunStartInfo`. The client predicts from these and never computes them itself.
- **The loadout and the equipment are fixed for the whole run.** The server validates requirements and weapon kinds on Ready and Start.

### 4.10 Skill tree and loadout
- **A fully separate tree per class**, drawn as a **branching node graph**: nodes connected by lines, bought outward from the class start.
- **Buying a node:** it needs a bought neighbour and must meet its Attribute requirement (for example, a new Wizard spell needs INT 16). It costs XP.
- **Node types:**
  - +Attribute;
  - ability unlock;
  - **ability improvement**: works **only while that ability is equipped** (for example Magic Missile pierces);
  - proficiency;
  - keystone.
- **New abilities:** **2 new primary + 2 new secondary per class, 16 in all.** The spec must design them, each with its category, uses, requirements, stats and damage types (light and damage type from the start, as TODO says). Slowed and Accelerated still need an ability that causes them (TODO).
- **Loadout:** one primary (LMB) and one secondary (RMB) from the unlocked pool, chosen before each run.

### 4.11 UI flow (redo everything; no backwards compatibility)
1. **Login:** stays as it is.
2. **Roster:** character cards (figure, name, class, XP, coins) plus a "New character" card, and the account actions (logout, delete account).
3. **Create:** a class picker. Each class shows its starting Attributes, base HP, proficiencies, starter weapon and starting primary and secondary abilities. Plus a name field.
4. **Character hub**, with the tabs:
   - **Sheet:** the Attributes with their effects and the Attribute shop (+ buttons with prices), derived numbers (HP, speed, resistances, weight) and respec.
   - **Skill tree:** the node graph, with a tooltip showing cost, effect and requirement (red if not met).
   - **Equipment:** slots like a paper doll, item icons from the `weapon_*` frames, an item tooltip with properties, and a placeholder inventory.
   - **Loadout:** a primary and a secondary picker from the unlocked pool. An invalid choice (a requirement or weapon kind not met) shows red.
   - A header with "< Roster", the name and class, XP and coins, and a **"To the dungeon"** button.
5. **Runs list and waiting room:** like today, but the party list shows each player's loadout (icons for primary and secondary, plus the weapon). Your own loadout can be edited until you are Ready.

**Mockups for the screenshots:** `roster`, `create`, `sheet`, `tree` (the Wizard, with a tooltip on a node whose requirement is not met), `tree-barbarian`, `equipment` (with an item tooltip), `loadout` (with an invalid red state), `room`. Mock data: one Wizard with some XP, a few nodes bought and some sample items.

## 5. Implementation order for the spec (for the next agent)
1. Attributes and races (data, the sheet basics).
2. Character sheet and calibration: today's numbers must come out the same, checked by tests.
3. Weapons, items and proficiencies.
4. Abilities: categories, the Strike/Shoot merge, the melee rule, overkill piercing, loadout and validation.
5. Skill trees and the Attribute shop, `Progress` v2, respec.
6. The new UI.

Each step keeps the game playable.

## 6. How the user works
- They answer design questions one at a time and correct playbacks. They want honest assessments, for example "be honest whether enemies need classes".
- "(my call)" marks are welcome, but the user checks them, so list them at hand-over.
- **Ask the user only about:** shoes and belts, and anything the builder check produces that only the user can decide. Everything else in section 4 is settled.
