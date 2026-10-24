# Tiny Adventurers — Player Guide

Gather a party of up to four heroes and crawl through a dungeon full of goblins, skeletons, orcs and necromancers (or demons, if the demon is the end boss). At the far end of the dungeon a final boss is waiting.

## Getting started

1. Open the game in your browser. Your host will give you the address, for example `http://192.168.1.20:8080`.
2. **Create an account**: a name and a password, nothing else. No e-mail is stored, so **a forgotten password cannot be recovered**. Write it down or use a password manager. Next time, just log in.
3. **Create a character**: give it a name and choose its class. The class can't be changed later. You can have up to 8 characters, also several of the same class. Each one collects its own XP and coins and has its own Attributes, skill tree and items.
4. Click a character card to open its **character screen**. "To the dungeon" there takes you to the runs. "< Character" brings you back, and "< Roster" in the character screen brings you back to the list.
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
| **Esc** | Menu: resume, Settings or leave the dungeon |
| **L** | Turn the rules log on or off (see The rules log) |
| **Shift+L** | Show or hide the calculation lines of the rules log |
| **F3** | Show ping, frame rate and network stats |

The **Settings** view of the Esc menu has a checkbox for each switch: the rules log (L), its calculation lines (Shift+L) and the network stats (F3). The keys and the checkboxes always agree.

On the screen, the **E** hint is a small gold key cap that floats over the thing you can use (a chest, a door, a sleeping teammate with the word "Wake"). A **critical hit** shows as a big gold number. Messages come in two kinds: story messages in the middle of the screen (a force field, a teammate leaving the dungeon) and small notices (such as "You have fallen").

## The heroes

Your teammates' names float above their heroes, and the party list (top left) shows everyone's health.

**Abilities.** Every hero has two: left mouse button (primary) and right (secondary). The four starting names are **Strike** (hit with your melee weapon), **Shoot** (fire your ranged weapon), **Charge** (a dash that hurts everything you run through) and **Holy Light** (a heal for you and your friends). Spells such as Magic Missile and Fireball are abilities too. Every class has four more, two for the left button and two for the right, listed under its heading below. You learn them in the skill tree (see "XP, coins and the character"). Each needs Attribute values (INT, CHA, STR, DEX, WIL; items count) and some a kind of weapon, shown after its name.

**Fighting up close.** A ranged ability does not work with an enemy (or a closed chest) right next to you, about a body's width and a bit more.
- Your **left button then strikes with your melee weapon** instead: the Wizard hits with his staff (weakly, so step back), the Elven Ranger thrusts her rapier. It hits the nearest target. If the blow kills it with damage to spare, the rest of the blow carries on to the next target in reach.
- Your **right button** does nothing if it is a ranged ability (the Wizard's Fireball) and shows "Too close"; it costs no cooldown. Holy Light, Charge and the Dire Wolf still work up close.
- Enemies follow the same rule: archers punch, and the Necromancer and the Summoner hit with their staffs when you get close.

**Piercing shots.** An arrow (or any shot from a ranged weapon) that **kills** an enemy flies on with the damage it had left, and can hit the next one, and the next. It stops at an enemy it does not kill, or one that is immune. Shots that are spells (Magic Missile) stop at the first enemy they hit, unless an item gives them piercing; a fireball still explodes there and hurts everyone around it. Some items make a shot pass through a number of enemies at full damage first (the Hunter's Bow: two). You see this as you shoot: a shot that kills keeps flying.

### Wizard, 70 HP
Fragile, but deadly from range.
- **Left – Magic Missile:** fast arcane bolts in quick succession. With an enemy right next to you, you hit with your staff instead.
- **Right – Fireball (6 s cooldown):** a slow ball of fire that explodes where your mouse pointer is, or earlier if it hits something. It damages every enemy in the blast. It can't hurt your friends. It cannot be cast with an enemy right next to you.
- **More, left button:** **Frost Shard** (INT 14): a quick bolt that is mostly cold and chills what it hits (slows it). **Chain Spark** (INT 18): a bolt that jumps to up to two more enemies close by, weaker each time, with a line of lightning between them.
- **More, right button:** **Frost Nova** (INT 17, 9 s): a ring of cold around you that hurts every enemy in sight and freezes it. **Haste** (INT 15, WIL 14, 14 s): you and the friends close to you run faster for 4 seconds.

### Paladin, 120 HP
An armoured holy warrior who keeps the party alive.
- **Left – Strike (Sword):** a swing of your sword toward the mouse pointer. It hits every enemy in reach in front of you.
- **Right – Holy Light (10 s cooldown):** heals you and every ally close to you.
- **More, left button:** **Judgement** (CHA 16): a bolt of holy light. **Smite** (CHA 15, needs a sword, mace or hammer): a slow, hard swing with a holy part, and a gold flash where it lands.
- **More, right button:** **Purify** (WIL 14, 15 s): clears every bad effect from you and your friends close to you, and for 3 seconds nothing can blind, sleep or petrify them. **Consecrate** (CHA 15, 12 s): holy ground under your feet for 5 seconds that hurts the enemies standing on it.

### Barbarian, 140 HP
The toughest hero.
- **Left – Strike (Great Axe):** a heavy swing toward the mouse pointer that hits every enemy in reach in front of you. Slower than the sword, but it hits harder.
- **Right – Charge (5 s cooldown):** dash toward the mouse pointer, hitting every enemy you run through with your axe (a little weaker than a strike). It works with enemies right next to you.
- **More, left button:** **Hurl** (needs Throwing Axes in the ranged slot): throw an axe that spins as it flies. **Whirl** (DEX 14): a swing all the way around you, weaker and slower than a strike.
- **More, right button:** **War Cry** (STR 16, 12 s): a shout that sends the enemies close to you running for 3 seconds (they cannot attack while afraid), and speeds up you and your friends close to you. **Ground Slam** (STR 17, needs a hammer or a club, 6 s): you raise your weapon, and half a second later it lands, hurting and pushing the enemies around you.

### Elven Ranger, 90 HP
The fastest hero, and the only one who fights with a companion. An elf: she sees **twice as far** as the others (18 tiles, still only where there is light and no wall), she sees a third of that range into the dark, she shrugs off a tenth of poison and she **cannot be put to sleep**.
- **Left – Shoot (Bow) / Strike (Rapier):** shoots arrows, which pierce enemies they kill. When an enemy is right next to you, you thrust with the rapier automatically instead, which is quicker.
- **Right – Dire Wolf (8 s cooldown):** with no wolf, **summons** one beside you in a puff of green sparkles. With the wolf alive, it **heals** the wolf for 20 % of its health (also at full health; the cooldown starts anyway). When the wolf falls, the box waits **60 seconds** before you can summon a new one. There is only ever one wolf per ranger.
- **More, left button:** **Volley** (DEX 15, needs a bow or longbow): three arrows in a fan, each weaker, and it takes longer to nock. **Flanking Thrust** (DEX 16, needs a dagger, duelling sword, katana or machete): a thrust that does **double damage** to an enemy you hit from behind.
- **More, right button:** **Poison Coat** (WIL 15, 16 s): for 6 seconds your weapon attacks add poison and poison what they hit. **Entangle** (CHA 14, 14 s): vines grow where you aim, up to 120 pixels away and not through walls, and root the enemies in them for 4 seconds (a strong enemy breaks free sooner). You cannot aim it with an enemy right next to you. A rooted enemy still attacks.

**Your wolf**
- It has 80 HP, runs a little faster than you and bites for 10 about once a second, with a small push.
- **It guards you.** It stays close, bites any enemy that comes within about three tiles of you, and fights back when something attacks it. It does not run off after what you shoot at, and it turns back when it has strayed about six tiles from you.
- **It opens a fight with a leap:** from up to four tiles away it dashes at its prey for 20 damage (every 5 seconds), and the leap crosses chasms. A push into a chasm is escaped the same way, with the dash. With the dash resting it falls and dies, like any monster. It drowns in deep water and burns in lava.
- **Nobody gets locked out.** If it falls far behind, or you are in the sealed boss hall without it, it appears next to you again in green sparkles.
- **It growls.** When it notices an enemy, it steps a tile or two toward it, shakes and shows "grrrr" above its head (at most every four seconds). The growl shows even in total darkness: it is an early warning. It also **growls at hiding mimics**, so a wolf that growls at a chest is a hint (it does not bite them). It ignores enemies that merely wait, such as the boss before the fight.
- **Enemies fight it.** They attack it and their area attacks hit it. Your own arrows, fireballs and swords, and those of your friends, **never** hurt it. The Paladin's Holy Light heals it.
- **Its figure shows only where there is light**, but its small health bar, like a hero's, shows even in the dark. Its kills count as yours; its death gives no XP or coins, shows a message and starts the 60 seconds.
- **If you fall, the wolf vanishes**, also when you leave the dungeon. Debug mode does not make it immortal.

The two boxes at the bottom of the screen show your abilities. While an ability recharges, the gold rim around its box fills up clockwise and the seconds left show inside; the box flashes once when the ability is ready again.

## Seeing in the dark

- The dungeon is **dark**. You carry no light, so you can only see what is lit **and** within your **field of vision** (about nine tiles around you, never through walls). Everything else is black, and **enemies in the dark are hidden**, even right next to you. **You vanish in the dark too:** your hero, your teammates and your shots only show where light falls (glowing shots carry their own light). Your health bar and abilities at the bottom of the screen always show.
- **Torches** hang on the walls of rooms and corridors, about every six tiles, and light the area around them in orange. Some rooms and stretches of corridor have none, so expect **dark pockets**. The starting room and the boss hall always have torches.
- **Torches can go out.** Press **E** next to a torch to light it or put it out (a small **E** appears over it). **Fire lights a torch**: a fireball, a fire bolt, a fire patch or an exploding barrel. **Any other hit puts it out**: a sword swing, an arrow, a dash, a frost bolt. So a swing at an enemy next to a torch can leave you in the dark.
- **Glowing shots light the way:** fireballs and fire bolts light the corridor they fly through, and magic bolts glow violet, blue or purple. A shot fired into a dark corridor shows what is in it for a moment.
- **Explosions light up** their surroundings for a moment: a fireball, a dragon's fireball or an exploding barrel shows what stands around it. The paladin's healing wave lights up its surroundings in pale gold, too.
- **The air is not clean.** Torches smoke, dust drifts in the light, lava smokes and throws sparks, and water pools drip. It is only for looks and changes nothing in play. Dust and smoke swirl around anything moving through them: a running hero, a monster, an arrow or a fireball stirs the air, and dust clouds a passer-by disturbs fade away and drift back later. Torchlight is warm, and colours stay true near the flames.
- **Lava glows red** and lights the floor around it. Light of different colours mixes: a torch next to lava gives a deeper orange.
- **Sounds show in the dark.** The wolf's "grrrr", spoken words and the sleeping "Z" are drawn above the darkness, in dark letters with a light outline, so you notice them even where you can see nothing else.
- Numbers and health bars on heroes and the wolf show even in the dark; numbers and health bars on enemies show only where you can see the enemy.
- **Enemies see in the dark only if they are built for it.** An enemy notices you when you are in its line of sight and either lit or very close. **Humans** (the necromancer, the summoner, the lich's disciples) do not see you in the dark at all, however close. **Monsters** (goblin and orc archers, orc warriors, mimics, the ogre) see you in the dark only from about three tiles away. **Undead** (skeletons, the lich), **demons** (imps, chorts, the Red Demon) and the **Red Dragon** see you in the dark as well as in the light.
- **Slip past in the dark.** Put out a torch, or stay out of the light, to slip past humans and monsters. Anything you light up (a fireball, a torch you relight, an exploding barrel) can be seen too, so fire is loud. Skeletons and demons are not fooled by darkness.

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

About one chest in four is a **mimic**. A mimic stays a closed chest until someone comes close or hits it. Then it jumps open and attacks. A chest that rattles when you come near is a bad sign, and so is a wolf that growls at one.

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
- Fire also sets things **burning** and poison **poisons** (see Status effects), and a smaller share of a type has a weaker effect: a creature that resists the type completely never takes the effect.
- Armour comes from the armour you wear, not from XP.

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
- In debug mode (test accounts only) a hero who falls or drowns climbs back out onto the last safe tile.

## Final bosses

The boss sleeps in a large hall at the far end of the dungeon. Each run has one of three bosses: the one the host picked in the lobby, or a random one. It wakes as soon as someone enters the hall. **When the whole party is inside, a shimmering blue force field seals the entrance**: from then on, it's you or the boss. Bosses have a lot of health, the same however many heroes come. Their health bar appears at the top of the screen.

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

Some attacks do more than damage. Your own effects show as small symbols with the seconds left under your health bar, and your party's effects as symbols in the party list (top left). A teammate's effects also show beside their floating name. A **thin outline symbol** is the weaker tier of an effect (Singed, Chilled, Tainted). While you are asleep, a panel with a moon appears above your health bar.

| Symbol | Effect | What it does |
|---|---|---|
| Crossed-out eye | Blind | You see nothing around you (darkvision does not help) |
| Moon | Asleep | You lie down: no moving, attacking or abilities, and a very short view. A teammate's **E** wakes you at once |
| Cracked stone | Petrified | Stone: no moving, attacking or turning, but you take far less damage and are hard to push |
| Hourglass | Slowed | You walk at half speed |
| Double arrow | Accelerated | You walk half as fast again (Haste and War Cry give it to heroes) |
| Flame | Burning | Fire eats at you: heat damage for 3 seconds. Water puts it out |
| Snowflake | Frozen | Ice: you cannot move, act or turn for 2 seconds, and the cold hurts a little |
| Drop | Poisoned | Poison eats at you for 4 seconds |
| Thin snowflake | Chilled | Cold slows you to 70 % speed for 3 seconds |
| Thin flame | Singed | A weaker burn: a little heat damage for 3 seconds. Water puts it out |
| Thin drop | Tainted | A weaker poison: a little poison damage for 3 seconds |
| Vine | Entangled | Roots hold you: you cannot move for a few seconds, but you can still turn and attack |
| Skull | Fear | You run away from whoever scared you and cannot attack (enemies only, for now) |
| Shield | Warded | Gold: nothing can blind, sleep or petrify you (Purify) |
| Blade | Coated | Green: your weapon attacks add poison and poison what they hit (Poison Coat) |

A sleeping or petrified hero cannot dodge, and a blind one cannot see what is coming, so the party's job is to keep the enemies off them. The final bosses resist some effects: all of them resist sleep completely, and some shorten other effects. The effects end by themselves after a few seconds.

The effects from damage types work in two tiers. A hit that is **at least half heat, cold or poison** puts the strong effect on whoever it hits, hero or enemy: Burning, Frozen or Poisoned. A hit that is **at least a quarter** (and less than half) puts the weak one: Singed, Chilled or Tainted. Fireballs, fire bolts, barrel blasts and the dragon's fire burn, and so does **lava**. The strong effect replaces the weak one of its kind. There is no chance involved: the effect always starts, and the target's resistance or toughness only shortens it or stops it. The damage over time hits twice a second, and a creature that resists the type takes less of it.
- **Burning and Singed:** water puts them out, in a pool or in the shallows. Fire and ice cancel each other, weak and strong: a fire hit on a frozen or chilled creature thaws it instead of burning it, and a cold hit on a burning or singed one puts the fire out. **Demons and the Red Dragon never burn** (they resist heat completely), so use something else on them. A hero who burns a monster to death still gets the kill.
- **Frozen and Chilled:** Frozen roots a creature and stops it from acting or turning until the ice ends, so a frozen hero needs the party to cover them. Fire thaws it at once. Frost Shard chills, and Frost Nova freezes. The Ember Staff now singes.
- **Poisoned and Tainted:** just the damage. **Undead are never poisoned** (they resist poison completely). The Staff of Rot poisons, and Poison Coat poisons what your weapon hits.
- **Entangled** (Entangle) and **Fear** (War Cry): your **Strength** shortens roots and your **Willpower** shortens fear, on you and on enemies alike, so a strong monster breaks out sooner. A rooted enemy can still attack you, and an enemy that runs away comes back when the fear ends. **Undead and bosses cannot be frightened**, and demons only half as long.

## Death, victory and defeat

- If you fall, you are **out for this run**: there are no revives. You watch your teammates (Q / E to switch) until the run ends.
- If the whole party falls, the run is lost.
- **Slay the boss** to win. The end screen shows each hero's kills, damage, healing, **XP** and **coins**.

## XP, coins and the character

- Every kill gives **XP to every living member of the party**: 2 for a raised skeleton or summoned imp, 5 for a goblin, 8 for a skeleton, imp or chort, 12 for an orc, 20 for a disciple, 25 for a necromancer or summoner and **300 for the boss**. Once you have fallen, you stop earning.
- **Coins** come from treasure chests, mimics (25) and the boss (50). Like XP, they go to every living hero. They pay for a respec (below).
- When the run ends, won or lost, your XP and coins are added to the **character** you played. If you leave early, you keep what you earned so far.
- **Debug mode** is a developer tool on test accounts that the admin marks. It never mixes with normal games: debug accounts see only debug rooms, and you cannot turn it on yourself.

**The roster and the character screen.** After login you see one card per character, with its figure holding its weapon (a Ranger also shows its ranged weapon; other heroes hold their melee weapon). Click a card to open the character screen, or click **New character** to create a character (its screen opens at once). The screen has four tabs: **Sheet**, **Skill tree**, **Equipment** and **Loadout**. You can change your build there while you are not Ready and not in a run; otherwise the game says "Not while ready." or "Not during a run."

Red means a choice does not work yet. The reason is in its tooltip or under it, with a hint on how to fix it. You can still click a red item or pick; the server refuses it and tells you why.

- **Sheet tab, Attributes.** STR, DEX, CON, INT, WIL and CHA. Each line shows the total and where it comes from: class and race, XP you bought, and your items. Click the **+1** button of an Attribute to buy a point with XP. The button shows the price, which rises with every point you buy. The price rises with the Attribute: 100 XP for a point at 10 and 25 more for each point above 10, times a weight (DEX costs a quarter more, WIL a fifth less). Items never raise the price.
- **Skill tree tab.** Hover a node to read what it does and what it needs. Click a node you can buy; a confirm asks first. In the tooltip, "you have" turns red when you are short of XP or of an Attribute. Gold nodes are owned, bright ones are reachable and can be bought, dim ones are not reachable yet. A red ring means an Attribute requirement is not met. Every class has its own tree, starting at a free first node. You can buy a node that touches one you own, if you have the XP and meet its requirement (an Attribute value, your items count). A node can give a resistance, a kind of weapon or armour you may use, a new ability, or an improvement of one ability (it works only while you have that ability equipped, also when an item gives it to you). The last node of a branch is a **keystone**, a big change to how you play:
  - Wizard: **Arcane Overflow** (spells +15 % damage, +10 % cooldown), **Deep Winter** (+20 % cold damage to chilled or frozen enemies), **Pyromancer** (+20 % heat damage, −20 % cold damage).
  - Paladin: **Radiant** (innate abilities +20 % against the undead and demons, and a glow around you), **Unshaken** (sleep cannot affect you), **Bulwark** (armour weighs half, +10 % physical resistance).
  - Barbarian: **Berserker** (below half life +25 % damage and cooldowns 25 % faster, but every resistance 10 points lower), **Juggernaut** (heavier, and slow, chill and roots cannot hold you), **Unbreakable** (your CON counts 4 higher for every saving throw).
  - Elven Ranger: **Pack Hunter** (enemies your wolf bit in the last 2 seconds take 20 % more from you), **Deadeye** (shots from a ranged ability do double damage to slowed, chilled, rooted or sleeping enemies), **Venomancer** (poisoned enemies take 15 % more from you).
  - A keystone's damage bonus counts only your own hits, not your wolf's bites or burning and poison ticks.
- **Respec** (Sheet tab). Gives back all the XP you spent on Attributes and the tree, for coins: 20 coins plus 1 for every 50 XP spent. It also resets your chosen abilities. Items you can no longer wear go back to your inventory; nothing is lost.
- **Equipment tab, items.** Click an item in the inventory to put it into its slot (a ring goes to the first free ring slot). You can also drag it onto a slot. Click a worn item, or drag it back to the inventory, to take it off. A red item has a reason in its tooltip. The class starters are ordinary items. You can wear an item only if your class is proficient with it and you meet its requirement (Attributes without items). In a debug game the screen can also add any item to your inventory.
- **Loadout tab, abilities.** Click a card to pick the left button (LMB) and the right button (RMB) ability from those you have unlocked, or that a worn item gives you. Abilities you have not unlocked yet are shown dim, with the numbers they would have. If a pick cannot be played (a missing weapon, a requirement not met) the card is red and says why and **Ready** and **Enter the dungeon** are refused until you fix it. In the **waiting room** you can change both picks again in your own row, with two lists, until you click Ready (the host: until the run starts). A pick that does not work reads, for example, "Frost Nova (needs INT 17.)". In the run, every hero holds its melee weapon, and a Ranger also its ranged one.
- Your characters are stored on the server, so you can log in from any browser or device. If you log in somewhere else, the game in the first window closes.
- **Deleting a character or your account is final.** Deleting the account removes all of its characters. The delete controls are on the roster.
- Characters from before the skill tree got all the XP they had spent on stat upgrades back, once.

## The rules log

Press **L** to open a log that explains what the rules are doing. It answers two questions: why did that enemy take that much damage, and why was it not affected by my ability? It is off at first, and your choice is remembered in this browser.

- **The panel** sits at the bottom left, newest line at the bottom; scroll it with the mouse wheel. Clicks on the panel stay on the panel, so aim past it. It keeps the last 300 records (each with its calculation lines).
- **Each event is a headline** with the time in seconds: who hit whom with what, the damage and the target's HP before and after. For example `12.4s  Ayla ▸ Frost Shard ▸ Goblin 3: 9 damage (HP 14 → 5)`.
- **Under it, the calculation**, step by step: the base number and your Attributes, the split by damage type, each resistance, every multiplier (from behind, Poison Coat, Chain Spark falloff, carried-on damage) and the result. Effects show whether they were applied (with the duration formula and the save), refused (and why), replaced or cancelled.
- **Shift+L** (or the small button on the panel) hides the calculation lines and leaves one headline per event. Use it in a big fight.
- **Other lines:** hits enemies land on you (so you see your own resistances at work), heals, damage over time (one short line per tick), kills and deaths, abilities that skipped a target with the reason (Chain Spark found no line of sight, a wall was in the way), "Too close" when a secondary is blocked in melee, and "... is in melee reach, strikes instead" when a primary turns into a Strike.
- **Tags:** while the log is on, every creature shows a small name above its figure, such as "Goblin 3", and the log uses the same names, so you can match a line to a figure. Everyone in the party sees the same numbers. A hidden mimic is tagged as a chest until it shows itself.
- **You only read what you can see.** A hit on something in the dark, or behind a wall, has no line, and neither does anything you could not have seen. The one exception is damage you take: "<your name> took 7 from something unseen", with your own resistance steps and nothing about the attacker (an effect that came with the hit adds only its name, such as " · Chilled").
- In a very big fight the panel may end with "… n more records (log limit)".

## Tips

- Melee heroes hit a little farther than their weapon looks. The white swoosh shows the real reach.
- The Paladin's heal only reaches allies close by, so stick together.
- Archers keep their distance. Close in, or use the Wizard and the Elven Ranger to pick them off.
- Use corners: enemies can't attack what they can't see.
- Skeletons, demons and the dragon see you in the dark, so a lit torch behind you helps you see them. Humans and most monsters lose you in the dark: put out a torch (any non-fire hit does it) to slip past them, and light it again with **E** or with fire when you fight.
- Barrels are a weapon and a danger: light them from a distance, and keep your back free. Archers shoot barrels next to you.
- Put a chasm or a pool between you and melee enemies: they have to walk around it. In the demon's dungeon, lava doesn't stop the demons.
- Against the lich, don't stand in a straight line with it for long: the dark and sleep orbs are slow but only a step to the side dodges them, and the stone gaze needs a clear line to you. When a teammate falls asleep, kill what is next to them first, then press **E**.
