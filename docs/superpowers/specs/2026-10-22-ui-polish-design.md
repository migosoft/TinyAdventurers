# UI polishing: design

Date: 2026-10-22. Status: builder check done (2026-10-22); waiting for the user's approval.
Branch: `feature/ui-polish` (from `main` at `150ab56`).
Mockups: [2026-10-22-ui-polish/ui-font-trial.html](2026-10-22-ui-polish/ui-font-trial.html) (screens) and [2026-10-22-ui-polish/ui-ingame-trial.html](2026-10-22-ui-polish/ui-ingame-trial.html) (in the run). Open them in a browser. The user approved what they show, with the choices below. Where this text and a mockup disagree, this text wins.

## Why

The user finds the text hard to read. Press Start 2P, the pixel font used for every text today, is "far too boxy". The user also wants the buttons smaller, so that the screens have more room for what matters, and less text on the game board, because text there hides the action. The look should fit an adventure game, but it does not have to follow the pixel style of the game area.

## Goals

1. **One readable text face everywhere.** Inter replaces Press Start 2P for every text: menus, buttons, fields, the character screens, tooltips, the HUD, the rules log, and the texts drawn in the game world (name tags, damage and heal numbers, the Z and ! marks, sound texts, the E use hint, "+N coins", "immune").
2. **A heading face for large text only.** IM Fell English SC for screen titles, panel titles, character names in the hub and the roster, item names in tooltips, the boss name, the room messages, the rules log title and the menu titles. Never below about 16 px: it gets hard to read when small.
3. **"Leather & brass" controls and panels** (the user's choice): buttons, text fields, selects, checkboxes, tabs, panels, cards and tooltips.
4. **The HUD in the same look**, with a new cooldown display: the slot's gold rim fills up.
5. **Effect symbols instead of letters**, and no effect words on the board.
6. **The admin page** uses the new look too.

## Non-goals

- The pixel art of the game area (tiles, figures, the logo image) does not change.
- No new colour meanings: the dark plum panels, gold, red, green and the class accents keep their roles. Their values move to the mockups' palette (see "Palette").
- No game rule changes. Crits stay what they are (see "Crits").
- No new settings beyond the switches the game already has (see "Settings").
- No layout redesign of the screens. The hub, roster, Create, waiting room and HUD keep their structure; only type, sizes, spacing and control styling change.

## Anti-goals (a failure even if it technically works)

- Text that is still hard to read: tiny sizes, low contrast, or the heading face used for small text.
- Bigger controls that eat space. The user explicitly asked for tighter button padding than the first draft.
- More text on the game board than today.
- A flash of the old font, or Phaser texts that render in a fallback font because the web font was not loaded yet.

## Fonts

- **Inter** (weights 400, 500, 600, 700, 800) for all text. Numbers use Inter's fixed-width digits (`font-variant-numeric: tabular-nums`) wherever numbers stand in columns or change in place (sheet, prices, HP, coins, cooldown seconds, rules log).
- **IM Fell English SC** (one weight, 400) for headings as listed in Goal 2.
- **Press Start 2P and JetBrains Mono are removed** from the client. The rules log uses Inter too (the user's choice, knowing its calculation lines no longer line up in columns).
- **Loading:** Google Fonts, the way `client/index.html` loads Press Start 2P today, and the way `rulesLog/panel.ts` loads JetBrains Mono (`FONT_HREF`, pinned by a test). Self-hosting is not needed. *(My call.)*
- **Phaser texts** must not be created before Inter is ready, or they render in a fallback and keep it. Wait on `document.fonts.load(...)` for the weights used in the game before the first scene creates text. *(How to wait is left to the builder.)*
- **Base sizes** (from the mockups): body text 15 px, small text 13 px, the smallest labels 11.5 px; the HUD 13 px. No text in the HTML UI below 11 px.

## Palette

*(My call, from the builder check.)* The `:root` tokens take the mockups' values, because those are what the user saw and approved:
- `--bg` `#0f090e`, `--panel` `#221620`, `--muted` `#b3a3a8` (brighter than today, for readability), `--red` `#e05050`, `--green` `#5cc870`;
- `--text`, `--gold` and `--panel-edge` (`#5a3a4a`) are unchanged;
- new tokens: `--faint` `#847379`, `--well` `#150d13`, `--gold-deep` `#9a7420`, `--gold-ink` `#2a1806`, `--edge-soft` `#3d2834`.

The brass gradients and edges in the mockup's rules may stay literal in the control rules, or become tokens; that is the builder's choice. The admin page uses the same tokens.

## Leather & brass

Read the exact values from the mockup's `[data-style="brass"]` rules. In words:

- **Panels:** a dark plum gradient, a 1 px edge, 12 px rounded corners, a faint warm highlight on the top edge and a soft drop shadow.
- **Buttons:** a plum gradient, a 1 px edge, 6 px corners, an inner highlight and a 2 px dark shadow below. They move down 1 px when pressed. **Padding 5 px × 10 px with line height 1.3** (the user's correction; the first draft had 9 × 15).
  - **Primary** buttons (To the dungeon, Create, Resume): a gold gradient with dark ink.
  - **Danger** buttons (Respec, Leave): dark red.
  - **Ghost** buttons (Back to the roster): transparent with a muted text that turns gold on hover.
  - **Disabled** buttons are at 40 % opacity.
- **Tabs:** no box. Muted text that turns gold when active, with a gold underline bar. Padding 7 × 12.
- **Text fields and selects:** a dark inset well, a 1 px edge, 8 px corners, padding 10 × 12 (unchanged from the first draft). Focus shows a gold edge and a soft gold ring. An invalid field shows a red edge and ring. Selects get a small gold arrow.
- **Checkboxes:** 18 px rounded boxes that turn gold with a dark tick.
- **Tooltips:** a panel with a stronger shadow. The item name uses the heading face in gold, the kind line is small caps in a faint colour, and the "you have" reason is red.
- **Focus:** every control shows a visible gold focus ring.

This applies to every screen built in plan 5 and earlier: login and register, roster, Create, the character hub with its four tabs (Sheet, Skill tree, Equipment, Loadout), the waiting room with its picker, the Esc menu, the end-of-run screen, the rules log panel and the debug row (`?debug`). The skill tree's node labels and the equipment doll get the new font. Their layout is kept, but sizes may grow where the 6 px labels were unreadable (see TODO "Plan 5 follow-ups").

## In the run

The in-game mockup shows all of these in the new look:

- **World texts** (Phaser): Inter with a 1 px black outline.
  - Name tags: 600 weight, about 13 px in screen terms.
  - Damage numbers: 800 weight. Heals are green, hits on heroes red, hits on monsters white (today's colours, kept).
  - The Z and ! marks: Inter 800.
  - Sound texts: Inter 600 italic, keeping today's dark fill with a light outline (`SOUND_TEXT`).
  - "+N coins" and "immune": Inter, today's colours.
- **Crits:** today a crit shows "CRIT 24" in larger yellow pixel text. New: **only the number**, larger and gold, with a short pop. Crits are deterministic: today only Flanking Thrust from behind (`BEHIND_MULT`) sets `Ev::Dmg.crit`. No rule change.
- **E use hint:** a small gold key cap with a dark "E" instead of the plain white letter.
- **HUD** (Inter, Leather & brass): the party list (name 600 weight, "(you)" muted, a rounded mini bar with a thin rim); the boss name in the heading face with a pill for Enraged or Immune; messages (see "Messages" below); the HP bar with a rounded rim and bold numbers; coins in bold gold; the ability slots (see below).
- **Help line:** key caps (`WASD` move, `LMB` `RMB` attack, `L` log, `Esc` menu, `F3` stats) instead of the "·"-separated text.
- **Esc menu:** a Leather & brass panel. The title is in the heading face. The existing hint line ("The dungeon keeps going while this is open.") stays under the title. The buttons are Resume (primary), **Settings** (new, see below) and Leave dungeon (danger).
- **End-of-run screen:** the same panel and fonts. Its table uses fixed-width digits.

### Messages

*(My call, from the builder check.)* `hud.message` shows two kinds of text today:
- **Game messages** come from the server's `Ev::Msg` ("The lich rises - slay its disciples!", "A demon awakens!", "{name} fell into the abyss"). They use the heading face in gold, about 20 px, with a dark shadow.
- **System notices** come from the client ("Connection lost. Reload the page to reconnect.", "You have fallen. Q / E to watch your party.", the debug notice, "{name} left the dungeon"). They use Inter 600, about 14 px, in a light warm colour.

The HUD gets a way to tell the two apart, for example a second method or a kind argument. **No protocol change.** The mockup's second line ("Defeat him to open the doors") is only an example: no message has a second line today, and none is added here.

### Cooldowns: the gold rim fills up

The user's request: make cooldowns more visible by filling the golden border.

- While an ability cools down, the slot's rim is drawn as a ring that **fills clockwise from the top** in gold, in step with the cooldown. The part not yet filled is the dim plum edge.
- The name and key are dimmed (60 %) while cooling. The **seconds left** show in the slot's corner with one decimal.
- When the ring closes, the slot **flashes once** (a short scale and brighten, about 0.4 s), then shows the **ready glow** (full gold rim and a soft gold halo) until the ability is used.
- The dark sweep inside the slot (today's display) is removed.
- The ring follows the same cooldown values as today's sweep (`cd1`, `cd2` and their maxima in `hud.ts`), including the Berserker speed-up.
- With `prefers-reduced-motion`, the flash is skipped; the ring still fills.

### Effect symbols, and no effect words on the board

- The one-letter effect boxes (`EFFECT_GLYPH` in `ui/text.ts`: B, Z, P, …) become **symbols**, in the HUD effect row and in the party list. The box keeps its meaning colour (red edge for harmful, green edge for helpful). The remaining-time digit (`<i>` in the box) stays.
- **One symbol per effect** (the mockup's legend):
  - Burning: a flame. Frozen: a snowflake. Poisoned: a drop.
  - Their weaker steps (Singed, Chilled, Tainted) use **the same symbol drawn as an outline**.
  - Sleep: a moon. Blind: a crossed-out eye. Petrified: a cracked stone. Slowed: an hourglass. Entangled: a vine. Fear: a skull.
  - Accelerated: a double chevron. Warded: a shield. Coated: a blade.
- Every symbol has its own colour (in the mockup). Like the letters today, a new effect must not be addable without its symbol: the test that guards `EFFECT_GLYPH` today guards the symbols.
- **On the board:** a hero with an effect shows its symbols **small, next to the name tag**. Monsters don't get symbols; their effects keep showing as today's tints and particles.
- **No effect words on the board**, now or later.
- **The asleep hint** ("Asleep. A teammate can wake you (E).") moves **off the board**: it sits above the HP bar as a small panel with the moon symbol and the E key cap. Today it sits at 58 % of the screen height, under the figure.

### Settings

The Esc menu gets a Settings button (the user approved it). The game has no settings today, so the screen holds **only the switches that exist already**, as checkboxes *(my call)*:
- Rules log shown (today `L`).
- Calculation lines shown (today `Shift+L` or the log's "details" button).
- Network stats shown (today `F3`).

Each checkbox and its key stay in sync, and the rules log's saved choices (localStorage) keep working. A Back button returns to the Esc menu. Future settings (sound, key bindings) go here.

## Admin page

The admin page (`client/admin.html`, `src/admin/admin.css`) has its own plain light-and-dark tool look today (system font). It gets Inter for text, the heading face for its page and section titles, and the Leather & brass controls and panels. *(My call:)* it becomes dark-only like the game, and its charts keep their two series colours but take their text and grid colours from the new palette.

## Constraints

- Desktop browsers; the game is not built for phones. The HTML UI must still not overflow at 1280 × 720, the smoke test's size.
- Keep the existing CSS structure (`style.css`, `ui/screens.css`, `rulesLog/rulesLog.css`, `admin/admin.css`). Colours and fonts go through the `:root` tokens (`--font` today); add tokens rather than repeating literals.
- The smoke test (`tools/e2e/smoke.mjs`) and the vitest suite must stay green. Tests that pin font names (for example `FONT_HREF` in `rulesLog/panel.test.ts`) are updated, not deleted.
- The rules log boundary test counts the client lines that reach `client/src/rulesLog/`. A change there must keep it green; update the count deliberately if a line is added.
- Update docs: TECHNICAL (the fonts, the cooldown ring, the effect symbols, Settings), PLAYER_GUIDE (cooldown ring, effect symbols, Settings), README credits if fonts are credited there, TODO (close "UI polishing", note the follow-ups).

## Left to the builder

- How the web fonts are awaited before Phaser creates text, and the exact Phaser font sizes and resolutions that give the sizes above on screen.
- How the effect symbols are drawn: inline SVG in the HTML HUD, and textures for the name-tag symbols in Phaser. The mockup's SVG paths may be used as they are.
- How the cooldown ring is drawn (the mockup uses a conic gradient with a mask).
- The exact pixel values that the mockups don't settle, as long as they follow this text.
- The order of the work and how to split it into tasks.

## Calls I made (for the user to check)

1. Google Fonts as today; no self-hosting.
2. The Settings screen holds only today's three switches (rules log, calculation lines, network stats).
3. The admin page becomes dark-only, like the game.
4. Fields and selects keep their padding (10 × 12); only buttons and tabs got tighter.
5. Monsters get no effect symbols; only heroes, next to their name tag.
6. The weaker step of a damage-type effect is its symbol as an outline.
7. Game messages (from the server) use the heading face; the client's system notices use Inter. No second message lines, no protocol change.
8. The colour tokens move to the mockups' palette, which has a brighter muted text and a slightly darker background and panels.
