# Tiny Adventurers — Player Guide

Gather a party of up to four heroes and crawl through a dungeon full of goblins, skeletons, orcs and necromancers (or demons, if the demon is the end boss). At the far end of the dungeon a final boss is waiting.

## Getting started

1. Open the game in your browser. Your host will give you the address, for example `http://192.168.1.20:8080`.
2. **Create an account**: a name and a password, nothing else. No e-mail is stored, so **a forgotten password cannot be recovered**. Write it down or use a password manager. Next time, just log in.
3. **Create a character**: give it a name and choose its class. The class can't be changed later. You can have up to 8 characters, also several of the same class. Each one collects its own XP, coins and upgrades.
4. Click **Play** on a character. "Change character" in the lobby brings you back to the list.
5. **Open a new run**, or **Join** an open run in the list. Runs already in progress can't be joined. Several players may play the same class.
6. The host **chooses the end boss**, or leaves it on **Random**. Everyone sees the choice.
7. Everyone except the host clicks **Ready!**. When the whole party is ready, the host clicks **Enter the dungeon**.

## Controls

| Input | Action |
|---|---|
| **W A S D** | Move |
| **Mouse** | Aim |
| **Left mouse button** | Primary attack, toward the mouse pointer. Hold it to keep attacking. |
| **Right mouse button** | Secondary ability |
| **E** (while alive) | Wake a sleeping teammate next to you (see Status effects), push the barrel right next to you (see Explosive barrels), or light or put out the torch next to you (see Seeing in the dark) |
| **Q / E** | After you die, switch which teammate you watch |
| **Esc** | Menu (leave the dungeon) |
| **F3** | Show ping, frame rate and network stats |

## The heroes

Your teammates' names float above their heroes, and the party list (top left) shows everyone's health.

Bolts and spells stop at the first enemy they hit; they don't pass through a line of enemies. A fireball still explodes there and hurts everyone around it.

### Wizard, 70 HP
Fragile, but deadly from range.
- **Left – Magic Missile:** fast arcane bolts in quick succession.
- **Right – Fireball (6 s cooldown):** a slow ball of fire that explodes where your mouse pointer is, or earlier if it hits something. It damages every enemy in the blast. It can't hurt your friends.

### Paladin, 120 HP
An armoured holy warrior who keeps the party alive.
- **Left – Sword:** a sweeping strike in front of you.
- **Right – Holy Light (10 s cooldown):** heals you and every ally close to you.

### Barbarian, 140 HP
The toughest hero.
- **Left – Great Axe:** a wide, heavy cleave. Slower than the sword, but it hits harder and wider.
- **Right – Charge (5 s cooldown):** dash toward the mouse pointer, hitting every enemy you run through.

### Assassin, 90 HP
The fastest hero. Strikes from the shadows.
- **Left – Crossbow / Dagger:** shoots crossbow bolts. When an enemy is right next to you, you stab with your dagger automatically instead, which is quicker.
- **Right – Hide (8 s cooldown):** vanish for up to 6 seconds. Enemies forget about you. Your **next attack from hiding deals ×4 critical damage** and reveals you. Your teammates still see you as a faint shimmer.

The two boxes at the bottom of the screen show your abilities. They darken while an ability recharges and light up gold when it is ready.

## Seeing in the dark

- The dungeon is **dark**. You carry no light, so you can only see what is lit **and** within your **field of vision** (about nine tiles around you, never through walls). Everything else is black, and **enemies in the dark are hidden**, even right next to you. **You vanish in the dark too:** your hero, your teammates and your shots only show where light falls (glowing shots carry their own light). Your health bar and abilities at the bottom of the screen always show; damage and heal numbers on a hero in the dark vanish with the hero.
- **Torches** hang on the walls of rooms and corridors, about every six tiles, and light the area around them in orange. Some rooms and stretches of corridor have none, so expect **dark pockets**. The starting room and the boss hall always have torches.
- **Torches can go out.** Press **E** next to a torch to light it or put it out (a small **E** appears over it). **Fire lights a torch**: a fireball, a fire bolt, a fire patch or an exploding barrel. **Any other hit puts it out**: a sword swing, an arrow, a dash, a frost bolt. So a swing at an enemy next to a torch can leave you in the dark.
- **Glowing shots light the way:** fireballs and fire bolts light the corridor they fly through, and magic bolts glow violet, blue or purple. A shot fired into a dark corridor shows what is in it for a moment.
- **Explosions light up** their surroundings for a moment: a fireball, a dragon's fireball or an exploding barrel shows what stands around it. The paladin's healing wave lights up its surroundings in pale gold, too.
- **Lava glows red** and lights the floor around it. Light of different colours mixes: a torch next to lava gives a deeper orange.
- Your shots fly on into the dark, and you still see their damage numbers when they hit something there.
- **Enemies see in the dark only if they are built for it.** An enemy notices you when you are in its line of sight and either lit or very close. **Humans** (the necromancer, the summoner, the lich's disciples) do not see you in the dark at all, however close. **Monsters** (goblin and orc archers, orc warriors, mimics, the ogre) see you in the dark only from about three tiles away. **Undead** (skeletons, the lich), **demons** (imps, chorts, the Red Demon) and the **Red Dragon** see you in the dark as well as in the light.
- **Hide in the dark.** Put out a torch, or stay out of the light, to slip past humans and monsters. Anything you light up (a fireball, a torch you relight, an exploding barrel) can be seen too, so fire is loud. Skeletons and demons are not fooled by darkness.

## Enemies

| Enemy | What to expect |
|---|---|
| Goblin archer | Weak and fast. Shoots arrows from a distance, usually in groups. |
| Skeleton warrior | Slow melee fighter. |
| Skeleton archer | Shoots arrows and keeps its distance. |
| Orc warrior | Tough melee fighter, hits hard and **knocks you back**. |
| Orc archer | Tough archer. |
| Necromancer | Casts green shadow bolts and **raises skeletons**. Kill the necromancer and all of its skeletons crumble. |
| Mimic | Looks exactly like a treasure chest. Walk up to it (or hit it) and its lid flies open: it **hops after you** and bites. It stops chasing when you get out of sight and waits where it was found. Worth 25 coins. |

**The demon's dungeon** (when the demon is the end boss) has demons instead of skeletons:

| Enemy | What to expect |
|---|---|
| Imp | Small demon in place of the skeleton archer. Keeps its distance and shoots **fire bolts**, but claws you if you get close. |
| Chort | Horned demon in place of the skeleton warrior. Closes in and claws (a **small knockback**), and throws a fire bolt now and then while you are out of reach. |
| Summoner | Red-robed caster in place of the necromancer. Shoots fire bolts and **summons imps**. Kill the summoner and its imps vanish. |

### The ogre (mini-boss)

Every dungeon has **one ogre**, roaming one of the deeper rooms like any other enemy. It is big, slow and tough, and always shows a **wide health bar** over its head. It is worth 60 XP and 30 coins.

- **Spiked club:** a heavy swing that **knocks you back further than any other enemy** (28 px, almost two tiles).
- **Ground slam:** when two heroes are close to it (or one, while its club is still recovering), it raises its club and a **red circle** appears on the floor around it. The circle fills up from the middle; when it is full the club comes down. **Everyone inside the circle** takes damage and is pushed straight away from the ogre (24 px). Step out of the circle before it fills.
- Tip: fight it away from chasms and deep water, and don't crowd around it.

Enemies **flash red and shake** just before they strike. That is your moment to step away. Enemies get tougher the deeper you go, and halls hold the biggest groups.

### Knockback

Strong melee hits **push you away** from the attacker:

| Attacker | Push |
|---|---|
| Orc warrior | about a tile (20 px) |
| Ogre: club / ground slam | almost 2 tiles (28 px) / 1.5 tiles (24 px), everyone in the circle |
| Chort (its claw) | a little less (14 px) |
| Red Demon: cleave / swoop | 3.5 / 4 tiles (56 / 64 px) |
| Red Dragon: front claw / bite / tail whip | 2 / 1.5 / almost 3 tiles (32 / 24 / 44 px) |
| Red Dragon: landing smash / exploding fireball | over 2 tiles (36 px), everyone in the circle / about a tile (20 px) |
| Lich: nova | **4 tiles (64 px)**, everyone in the circle: the strongest push in the game |

- The push slides you for a moment. **You have no control until it ends**: no walking, no attacks, and a dash can't break out of it.
- Walls stop the slide, but **chasms and deep water do not**: a push over the edge is a fall or a drowning. Lava just burns.
- **Ranged attacks never push**, except the dragon's exploding fireballs (the lich's nova is a blast around it, not a projectile). Imps, skeletons and mimics don't push either.
- A Barbarian in the middle of a dash is in the air and can't be pushed.
- Tip: don't fight orcs or bosses with your back to a chasm or deep water.

## Treasure chests

Some rooms have a **treasure chest** against a wall. Walk into it to open it: **every living hero in the party** gets 8 to 15 coins.

About one chest in four is a **mimic**. A mimic stays a closed chest until someone comes close or hits it. Then it jumps open and attacks. A chest that rattles when you come near is a bad sign.

**Hitting a chest smashes it.** Any blow, arrow, spell or explosion breaks a closed chest, and most of the coins are lost in the cracks: the party gets only a third. So testing chests for mimics with a shot from afar costs you gold, and so does fighting carelessly next to a chest (enemy area attacks and barrel blasts break chests too). A closed chest stops shots, just as a mimic does. Poison does not hurt chests.

## Explosive barrels

Wooden **barrels** stand in some rooms, usually two to four together, and a few in every boss hall. They are solid: neither you nor the enemies can walk through them, and shots stop at them.

- **What lights them:** any hit. A sword swing, an arrow, a spell, an enemy's arrow or fire bolt, another explosion. The barrel flashes for about a third of a second, then **explodes**.
- **The blast** reaches about two and a half tiles (40 px). It does 30 damage, half fire and half physical, to **everyone it reaches with a clear line**, heroes and enemies alike, your own party included. It **pushes** heroes and enemies away from the barrel (about 2.5 tiles). A boss takes the damage but is never pushed.
- **Chain reaction:** a blast lights every barrel in its reach, so a group goes off one after the other, a third of a second apart.
- **Pushing:** stand right next to a barrel (touching it) and press **E**. It slides about three tiles straight away from you, until a wall, another barrel, a hero or an enemy stops it. A small **E** appears over the barrel you would push.
- **Terrain:** a barrel pushed over a **chasm** falls, one pushed into **deep water** sinks, and neither explodes. One pushed into **lava** explodes at once.
- **Enemies in the blast:** an enemy that is pushed over a chasm or into deep water **falls or drowns** and counts as a kill for you, as if you had made it. In lava it burns.
- **Archers use them too:** an enemy with a ranged attack that sees a barrel next to you may shoot the **barrel** instead of you. It will not do that if the blast would catch it as well. Don't stand next to barrels when archers are about.
- **Kills and damage** from a chain count for the hero who lit the first barrel. If an enemy lit it, nobody gets credit.

Tip: light a group from far away while the enemies stand around it, or push a barrel into a crowd and shoot it. Never fight with a barrel at your back.

## Damage types and resistances

Every attack has one or more **damage types**: physical (blades, arrows, claws), heat (fire), magical (spells), cold and poison. The colour of a damage number shows the main type of the hit:

| Colour | Type |
|---|---|
| White (on enemies), red (on heroes) | Physical |
| Orange | Heat |
| Purple | Magical |
| Light blue | Cold |
| Green | Poison |

Heroes, enemies and barrels can **resist** a type: that part of the hit is reduced. An attack with several types (the fireball is mostly heat, partly magical and physical) is reduced part by part, so an enemy immune to fire still takes the rest. When a hit does nothing at all, the number says **immune**. Some resist so strongly that the hit **heals** them, and a **weakness** adds damage, at most double.

| Enemy | Resists | Weak to |
|---|---|---|
| Skeletons, raised skeletons, the Lich | physical 10 %, **poison completely** (the Lich: physical about half, magical 40 %) | heat 10 % more |
| Imps, chorts, summoners, the Red Demon | **heat completely**, magical 20 % (the Red Demon 40 %) | cold |
| Red Dragon | **heat completely**, magical half, physical 10 % | |
| Barrels and chests | physical half, poison completely | |

- Fire does nothing to demons or the dragon; use arrows, blades and bolts there. Fire hurts skeletons a little more.
- The Red Demon's claws and the Red Dragon's claws are partly fire.
- Fire also sets things **burning** and poison **poisons** (see Status effects): a creature that resists the element completely is immune to the effect.
- Your own **armour** upgrade still works on top of all this.

## Water, lava and chasms

Some rooms and halls hold terrain. **Chasms** appear in every dungeon. **Water** appears in the lich's and the dragon's dungeons, **lava** in the demon's.

| Terrain | What happens |
|---|---|
| Shallow water (the light rim of a pool) | Slows everyone down, heroes and enemies alike. |
| Deep water (the dark centre) | You can't walk into it. A hero whose **dash ends** in deep water, or who is **knocked** into it, **drowns**. |
| Chasm | Step in, or get **knocked** in, and you **fall to your death** ("X fell into the abyss"). Every chasm across a room leaves a bridge of floor. |
| Lava | You can walk in, but it slows you a lot and **burns for 20 damage a second**, and it sets you **burning** (see Status effects). |

- The Barbarian's **dash jumps** deep water, chasms and lava. Only where the dash ends counts: land on solid ground.
- No chasm is wider than 3 tiles, so a dash can always clear it.
- **Demons** (imps, chorts, summoners and the Red Demon) walk through lava unharmed and at full speed. Other enemies go around lava, and no enemy follows you into a chasm or deep water.
- Shots and sight pass over all terrain.
- Enemies can fall, drown and burn too, if a **barrel blast** pushes them in (see Explosive barrels).
- In debug mode a hero who falls or drowns climbs back out onto the last safe tile.

## Final bosses

The boss sleeps in a large hall at the far end of the dungeon. Each run has one of three bosses: the one the host picked in the lobby, or a random one. It wakes as soon as someone enters the hall. **When the whole party is inside, a shimmering blue force field seals the entrance**: from then on, it's you or the boss. Bosses have a lot of health, more with a bigger party. Their health bar appears at the top of the screen.

**Every boss hall has chasms:** one or two drop-offs along the walls and one or two pits in the floor. The entrance and the middle of the hall stay clear. The demon, the dragon and the lich can **knock you in** (see Knockback).

**The demon's hall also has a pool of lava.** The demon walks through it unharmed and at full speed; you burn and slow down in it, and its cleave and swoop can knock you in.

### The Red Demon
- **Cleave:** a wide claw sweep in front of it.
- **Swoop:** lowers its horns and charges across the hall at a hero.
- Both the cleave and the swoop **hurl you back** a long way (56 and 64 px, 3.5 and 4 tiles).
- **Ring of fire:** fireballs fly out in every direction.
- **Enraged below 40 % health:** faster and more aggressive. The health bar shows **ENRAGED**.

Tip: stay mobile, and don't stand between the demon and a chasm.

### The Lich
- **Cannot be harmed** while its **disciples** live. The bar shows **IMMUNE**. There are at least five red-robed disciples around the hall.
- **Heals** from the disciples' life force: the red shimmering streams flowing to it.
- All its magic is **dark purple gloom**.
- Casts **volleys of five gloom bolts**.
- **Summons skeletons:** every 12 seconds it raises its army back up to **five skeletons and five skeleton archers** around it.
- **Nova:** about every 10 seconds it stops, raises its staff and a **purple circle** fills up on the floor around it. When it is full, a dark blast hurts **everyone inside** and throws them **4 tiles away**, far enough to send you into a chasm. Step out of the circle in time, and don't stand between the lich and an edge.
- **Three curses**, each aimed at one hero it can see (it sees only what you would see: it cannot curse you from behind a wall. A hero who already suffers *that* curse is passed over, and the lich picks the nearest hero it sees):
  - **Blinding curse:** about every 10 seconds the lich flings a **dark orb**. It is slow, so **step aside**. A hit does a little damage and **blinds** you for 3 seconds: you see almost nothing, not even with darkvision.
  - **Sleep mist:** about every 14 seconds, a **purple orb**. A hit puts you to **sleep** for 4 seconds: you lie on the floor and cannot move, attack or use abilities, and you see only a little around you. **Step aside** from the orb, and **wake a sleeping teammate** by standing next to them and pressing **E**.
  - **Stone gaze:** about every 18 seconds the lich stares at one hero and a **thin grey beam** links them for a second. When it ends, that hero **turns to stone** for 3 seconds: you cannot move, attack or turn, but you take much less damage and are hard to push. **Break the line of sight** (duck behind a pillar or a wall) before the beam ends and nothing happens.
- Its drain beams show even when the lich or a disciple is out of your sight, so they point the way to both.

Tip: kill the disciples first. Once the last one falls, the lich's protection breaks.

### The Red Dragon
Every attack shows its pose first, while the dragon flashes red: that is your moment to step away.
- **Fire breath:** it rears its head back while smoke rises from its nostrils, then it breathes a cone of fire that **leaves burning ground** behind. The breath does not push.
- **Bite:** it pulls its head back, then lunges straight ahead with its neck, a little further than its claw reaches. Hard-hitting, pushes you back (24 px). Only the hero right in front of its mouth is bitten.
- **Front claw:** raises a paw and swipes at heroes in front of its face, pushing them back (32 px).
- **Tail whip:** curls its tail, then whips anyone standing behind it and flings them away (44 px).
- **Fireball volley:** exploding fireballs that push you a little (20 px).
- **Flight:** every 10 to 12 seconds it takes off and hovers after the party for a few seconds. **Swords, axes, the dagger and the dash can't reach it in the air**; bolts, missiles and spells still hit. In the air its only attack is the fire breath, also from above.
- **Landing smash:** a red circle on the ground shows where it comes down. The landing hits everyone inside the circle and pushes them away (36 px).

Tip: when you see the smoke, get out of the area in front of its mouth. Don't stand directly behind it either, least of all with a chasm at your back. When it takes off, ranged heroes do the work; get out of the red circle before it lands.

## Status effects

Some attacks do more than damage. Your own effects show as small icons with the seconds left under your health bar, and your party's effects as icons in the party list (top left). Red icons are bad, green ones are good.

| Icon | Effect | What it does |
|---|---|---|
| **B** | Blind | You see nothing around you (darkvision does not help) |
| **Z** | Asleep | You lie down: no moving, attacking or abilities, and a very short view. A teammate's **E** wakes you at once |
| **P** | Petrified | Stone: no moving, attacking or turning, but you take far less damage and are hard to push |
| **S** | Slowed | You walk at half speed |
| **A** | Accelerated | You walk half as fast again (only the debug key gives this so far) |
| **F** | Burning | Fire eats at you: heat damage for 3 seconds. Water puts it out |
| **I** | Frozen | Ice: you cannot move, act or turn for 2 seconds, and the cold hurts a little |
| **X** | Poisoned | Poison eats at you for 4 seconds |

A sleeping or petrified hero cannot dodge, and a blind one cannot see what is coming, so the party's job is to keep the enemies off them. The final bosses resist some effects: all of them are immune to sleep. The effects end by themselves after a few seconds.

The last three come from elements. A hit that is **at least half heat, cold or poison** puts the matching effect on whoever it hits, hero or enemy: fireballs, fire bolts, barrel blasts and the dragon's fire burn, and so does **lava**. The damage over time hits twice a second, and a creature that resists the element takes less of it.
- **Burning:** water puts it out, in a pool or in the shallows. Fire and ice cancel each other: a fire hit on a frozen creature thaws it instead of burning it, and a cold hit on a burning one puts the fire out. **Demons and the Red Dragon are immune** to burning (they resist heat completely), so use something else on them. A hero who burns a monster to death still gets the kill.
- **Frozen:** rooted and unable to act or turn until the ice ends, so a frozen hero needs the party to cover them. Fire thaws it at once. Nothing freezes anyone yet, so only the debug key gives it so far.
- **Poisoned:** no other effect, just the damage. **Undead are immune** (they resist poison completely). Nothing poisons anyone yet either.

## Death, victory and defeat

- If you fall, you are **out for this run**: there are no revives. You watch your teammates (Q / E to switch) until the run ends.
- If the whole party falls, the run is lost.
- **Slay the boss** to win. The end screen shows each hero's kills, damage, healing, **XP** and **coins**.

## XP, coins and upgrades

- **Coins** come from treasure chests, mimics (25) and the boss (50). Like XP, they go to every living hero and are added to your character when the run ends. The lobby shows your coins next to your XP. There is nothing to buy with them yet: they are saved for loadouts.

- Every kill gives **XP to every living member of the party**: 2 for a raised skeleton or summoned imp, 5 for a goblin, 8 for a skeleton, imp or chort, 12 for an orc, 20 for a disciple, 25 for a necromancer or summoner and **300 for the boss**. Once you have fallen, you stop earning.
- When the run ends, won or lost, your XP is added to the **character** you played. If you leave early, you keep what you earned so far.
- Spend XP in the **Upgrades** panel in the lobby. Each stat has 10 levels; the first level costs 100 XP and each further level 75 XP more.

| Stat | Per level | At level 10 |
|---|---|---|
| Damage | +8 % damage | +80 % |
| Attack speed | +6 % attack speed (shorter cooldowns) | +60 % |
| Move speed | +4 % move speed | +40 % |
| Life | +10 % max life | +100 % |
| Armor | blocks 4 % of incoming damage | 40 % |

- Upgrades are **permanent** and belong to the **character** that bought them. Your other characters have their own.
- Your characters are stored on the server, so you can log in from any browser or device. If you log in somewhere else, the game in the first window closes.
- **Deleting a character or your account is final.** Deleting the account removes all of its characters. Both are on the character screen.
- Runs where someone used debug mode give no XP and no coins.

## Tips

- Melee heroes hit a little farther than their weapon looks. The white swoosh shows the real reach.
- The Paladin's heal only reaches allies close by, so stick together.
- Archers keep their distance. Close in, or use the Wizard and Assassin to pick them off.
- Use corners: enemies can't attack what they can't see.
- Skeletons, demons and the dragon see you in the dark, so a lit torch behind you helps you see them. Humans and most monsters lose you in the dark: put out a torch (any non-fire hit does it) to slip past them, and light it again with **E** or with fire when you fight.
- Barrels are a weapon and a danger: light them from a distance, and keep your back free. Archers shoot barrels next to you.
- Put a chasm or a pool between you and melee enemies: they have to walk around it. In the demon's dungeon, lava doesn't stop the demons.
- Against the lich, don't stand in a straight line with it for long: the dark and sleep orbs are slow but only a step to the side dodges them, and the stone gaze needs a clear line to you. When a teammate falls asleep, kill what is next to them first, then press **E**.
