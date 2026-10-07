# Tiny Adventurers — Player Guide

Gather a party of up to four heroes and crawl through a dungeon full of goblins, skeletons, orcs and necromancers. At the far end of the dungeon a final boss is waiting.

## Getting started

1. Open the game in your browser. Your host will give you the address, for example `http://192.168.1.20:8080`.
2. Enter your **name** at the top.
3. **Open a new run**, or **Join** an open run in the list. Runs already in progress can't be joined.
4. **Choose your class.** Several players may pick the same class.
5. The host **chooses the end boss**, or leaves it on **Random**. Everyone sees the choice.
6. Everyone except the host clicks **Ready!**. When the whole party is ready, the host clicks **Enter the dungeon**.

## Controls

| Input | Action |
|---|---|
| **W A S D** | Move |
| **Mouse** | Aim |
| **Left mouse button** | Primary attack, toward the mouse pointer. Hold it to keep attacking. |
| **Right mouse button** | Secondary ability |
| **Q / E** | After you die, switch which teammate you watch |
| **Esc** | Menu (leave the dungeon) |
| **F3** | Show ping, frame rate and network stats |

## The heroes

Each hero has a coloured ring on their base so you can tell the party apart.

### Wizard (blue ring), 70 HP
Fragile, but deadly from range.
- **Left – Magic Missile:** fast arcane bolts in quick succession.
- **Right – Fireball (6 s cooldown):** a slow ball of fire that explodes where your mouse pointer is, or earlier if it hits something. It damages every enemy in the blast. It can't hurt your friends.

### Paladin (gold ring), 120 HP
An armoured holy warrior who keeps the party alive.
- **Left – Sword:** a sweeping strike in front of you.
- **Right – Holy Light (10 s cooldown):** heals you and every ally close to you.

### Barbarian (red ring), 140 HP
The toughest hero.
- **Left – Great Axe:** a wide, heavy cleave. Slower than the sword, but it hits harder and wider.
- **Right – Charge (5 s cooldown):** dash toward the mouse pointer, hitting every enemy you run through.

### Assassin (green ring), 90 HP
The fastest hero. Strikes from the shadows.
- **Left – Crossbow / Dagger:** shoots crossbow bolts. When an enemy is right next to you, you stab with your dagger automatically instead, which is quicker.
- **Right – Hide (8 s cooldown):** vanish for up to 6 seconds. Enemies forget about you. Your **next attack from hiding deals ×4 critical damage** and reveals you. Your teammates still see you as a faint shimmer.

The two boxes at the bottom of the screen show your abilities. They darken while an ability recharges and light up gold when it is ready.

## Seeing in the dark

- You can only see what is in your **field of vision**: about nine tiles around you, and never through walls.
- The rest of the dungeon stays dimly visible, like a board in shadow, but **enemies outside your vision are hidden**.
- Enemies have the same limits. They only notice you when they can actually see you, so you can sneak around corners.

## Enemies

| Enemy | What to expect |
|---|---|
| Goblin archer | Weak and fast. Shoots arrows from a distance, usually in groups. |
| Skeleton warrior | Slow melee fighter. |
| Skeleton archer | Shoots arrows and keeps its distance. |
| Orc warrior | Tough melee fighter, hits hard. |
| Orc archer | Tough archer. |
| Necromancer | Casts green shadow bolts and **raises skeletons**. Kill the necromancer and all of its skeletons crumble. |

Enemies **flash red and shake** just before they strike. That is your moment to step away. Enemies get tougher the deeper you go, and halls hold the biggest groups.

## Final bosses

The boss sleeps in a large hall at the far end of the dungeon. Each run has one of three bosses: the one the host picked in the lobby, or a random one. It wakes as soon as someone enters the hall. **When the whole party is inside, a shimmering blue force field seals the entrance**: from then on, it's you or the boss. Bosses have a lot of health, more with a bigger party. Their health bar appears at the top of the screen.

### The Red Demon
- **Cleave:** a wide claw sweep in front of it.
- **Swoop:** charges across the hall at a hero.
- **Ring of fire:** fireballs fly out in every direction.
- **Enraged below 40 % health:** faster and more aggressive. The health bar shows **ENRAGED**.

Tip: stay mobile, and don't stand in a line between the demon and a wall.

### The Lich
- **Cannot be harmed** while its **disciples** live. The bar shows **IMMUNE**. There are at least five red-robed disciples around the hall.
- **Heals** from the disciples' life force: the red shimmering streams flowing to it.
- Casts **frost bolt volleys** and **summons skeletons**.

Tip: kill the disciples first. Once the last one falls, the lich's protection breaks.

### The Red Dragon
- **Fire breath:** smoke rises from its nostrils, then it breathes a cone of fire that **leaves burning ground** behind.
- **Tail swipe:** hits anyone standing behind it.
- **Fireball volley:** explosive fireballs.

Tip: when you see the smoke, get out of the area in front of its mouth. Don't stand directly behind it either.

## Death, victory and defeat

- If you fall, you are **out for this run**: there are no revives. You watch your teammates (Q / E to switch) until the run ends.
- If the whole party falls, the run is lost.
- **Slay the boss** to win. The end screen shows each hero's kills, damage, healing and **XP**.

## XP and upgrades

- Every kill gives **XP to every living member of the party**: 2 for a raised skeleton, 5 for a goblin, 8 for a skeleton, 12 for an orc, 20 for a disciple, 25 for a necromancer and **300 for the boss**. Once you have fallen, you stop earning.
- When the run ends, won or lost, your XP is added to your **profile**. If you leave early, you keep what you earned so far.
- Spend XP in the **Upgrades** panel in the lobby. Each stat has 10 levels; the first level costs 100 XP and each further level 75 XP more.

| Stat | Per level | At level 10 |
|---|---|---|
| Damage | +8 % damage | +80 % |
| Attack speed | +6 % attack speed (shorter cooldowns) | +60 % |
| Move speed | +4 % move speed | +40 % |
| Life | +10 % max life | +100 % |
| Armor | blocks 4 % of incoming damage | 40 % |

- Upgrades are **permanent** and apply to **every class** you play.
- Your profile is stored by the server and remembered by your browser. A different browser or device, or clearing the site data, starts a new profile.
- Runs where someone used debug mode give no XP.

## Tips

- Melee heroes hit a little farther than their weapon looks. The white swoosh shows the real reach.
- The Paladin's heal only reaches allies close by, so stick together.
- Archers keep their distance. Close in, or use the Wizard and Assassin to pick them off.
- Use corners: enemies can't attack what they can't see.
