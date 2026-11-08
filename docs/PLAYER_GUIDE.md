# Tiny Adventurers — Player Guide

Gather a party of up to four heroes and crawl through a dungeon full of goblins, skeletons, orcs and necromancers (or demons, if the demon is the end boss). At the far end of the dungeon a final boss is waiting. Or take the party down a sunlit forest road, the **Woodland** (see "The Woodland").

## Getting started

1. Open the game in your browser. Your host will give you the address, for example `http://192.168.1.20:8080`.
2. **Create an account**: a name and a password, nothing else. No e-mail is stored, so **a forgotten password cannot be recovered**. Write it down or use a password manager. Next time, just log in.
3. **Create a character**: give it a name and choose its class. The class can't be changed later. You can have up to 8 characters, also several of the same class. Each one collects its own XP and coins and has its own Attributes, skill tree and items.
4. Click a character card to open its **character screen**. "To the dungeon" there takes you to the runs. "< Character" brings you back, and "< Roster" in the character screen brings you back to the list.
5. **Open a new run**, or **Join** an open run in the list. Runs already in progress can't be joined. Several players may play the same class.
6. The host **chooses the level**, **Dungeon** or **Woodland**. For the Dungeon the host also **chooses the end boss**, or leaves it on **Random**. Everyone sees the choices.
7. Everyone except the host clicks **Ready!**. When the whole party is ready, the host clicks **Enter the dungeon** (or **Enter the woodland**).

## Controls

| Input | Action |
|---|---|
| **W A S D** | Move |
| **Mouse** | Aim |
| **Left mouse button** | Primary attack, toward the mouse pointer. Hold it to keep attacking. |
| **Right mouse button** | Secondary ability |
| **E** (while alive) | Wake a sleeping teammate next to you (see Status effects), recruit the neutral knight next to you (see Sides and companions), push the barrel right next to you (see Explosive barrels), or light or put out the torch next to you (see Seeing in the dark) |
| **Q / E** | After you die, switch which teammate you watch |
| **Esc** | Menu: resume, Settings or leave the dungeon |
| **L** | Turn the rules log on or off (see The rules log) |
| **Shift+L** | Show or hide the calculation lines of the rules log |
| **F3** | Show ping, frame rate and network stats |

The **Settings** view of the Esc menu has a checkbox for each switch: the rules log (L), its calculation lines (Shift+L) and the network stats (F3). The keys and the checkboxes always agree.

On the screen, the **E** hint is a small gold key cap that floats over the thing you can use (a chest, a door, a sleeping teammate with the word "Wake", the neutral knight with the word "Recruit"). A **critical hit** shows as a big gold number. Messages come in two kinds: story messages in the middle of the screen (a force field, a teammate leaving the dungeon) and small notices (such as "You have fallen").

## The heroes

Your teammates' names float above their heroes, and the party list (top left) shows everyone's health.

**Abilities.** Every hero has two: left mouse button (primary) and right (secondary). The four starting names are **Strike** (hit with your melee weapon), **Shoot** (fire your ranged weapon), **Charge** (a dash that hurts everything you run through) and **Holy Light** (a heal for you and your friends). Spells such as Magic Missile and Fireball are abilities too. **Enemies and bosses use the same abilities, with the same rules and their own Attributes**: an ability's name always means the same thing, whoever uses it. A melee **Strike** or **Bite** hits everything in the weapon's arc, barrels and chests included; **Ground Slam** hits no barrels or chests; **Swoop** and **Pounce** hit creatures only. Every class has four more, two for the left button and two for the right, listed under its heading below. You learn them in the skill tree (see "XP, coins and the character"). Each needs Attribute values (INT, CHA, STR, DEX, WIL; items count) and some a kind of weapon, shown after its name.

**Cooldowns and Attributes.** Every ability recharges faster with the right Attribute, **10 % per point** above 10 (and slower below 10). **Spells** (Fireball, Frost Nova, Haste) follow **INT**, **innate** abilities (Holy Light, Dire Wolf, Consecrate) follow **CHA**, and **techniques and weapon attacks** (Charge, Strike, Shoot, Volley) follow **DEX**. A cooldown never falls below 0.05 seconds. Status effects change the speed too: Slowed and Chilled make cooldowns run 25 % slower, Accelerated 25 % faster. **The cooldowns listed for the hero abilities below are at Attribute 10**; your own are shorter with more, and the character screen and the ability cards show the steps. Enemies and bosses follow the same rule with their own Attributes.

**Fighting up close.** A ranged ability does not work with an enemy (or a closed chest) right next to you, about a body's width and a bit more.
- Your **left button then strikes with your melee weapon** instead: the Wizard hits with his staff (weakly, so step back), the Elven Ranger thrusts her rapier. It hits the nearest target. If the blow kills it with damage to spare, the rest of the blow carries on to the next target in reach.
- Your **right button** does nothing if it is a ranged ability (the Wizard's Fireball) and shows "Too close"; it costs no cooldown. Holy Light, Charge and the Dire Wolf still work up close.
- Enemies follow the same rule: archers punch, and the Necromancer and the Summoner hit with their staffs when you get close.

**Piercing shots.** An arrow (or any shot from a ranged weapon) that **kills** an enemy flies on with the damage it had left, and can hit the next one, and the next. It stops at an enemy it does not kill, or one that is immune. Shots that are spells (Magic Missile) stop at the first enemy they hit, unless an item gives them piercing; a fireball still explodes there and hurts everyone around it. Some items make a shot pass through a number of enemies at full damage first (the Hunter's Bow: two). You see this as you shoot: a shot that kills keeps flying.

### Wizard, 70 HP
Fragile, but deadly from range.
- **Left – Magic Missile:** fast arcane bolts in quick succession. With an enemy right next to you, you hit with your staff instead.
- **Right – Fireball (6 s cooldown):** a slow ball of fire that explodes where your mouse pointer is, or earlier if it hits something. It damages every enemy in the blast and **pushes** them: **up to 20 px**, and only if your STR beats the enemy's weight (a push is full once your STR is 4 above the weight). A starting Wizard (STR 8) moves only light enemies: an imp 20 px, a goblin archer (weight 6) 10 px, and nothing heavier. Never a boss, a friend of yours, or a hiding mimic. It can't hurt your friends. It cannot be cast with an enemy right next to you.
- **More, left button:** **Frost Shard** (INT 14): a quick bolt that is mostly cold and chills what it hits (slows it). **Chain Spark** (INT 18): a bolt that jumps to up to two more enemies close by, weaker each time, with a line of lightning between them.
- **More, right button:** **Frost Nova** (INT 17, 9 s): a ring of cold around you that hurts every enemy in sight and freezes it. **Haste** (INT 15, WIL 14, 14 s): you and the friends close to you run faster for 4 seconds. **Charm Monster** (INT 15, CHA 14, 20 s; a skill-tree node next to Light Armor): a pink orb that **charms** the monster it hits: for about 8 seconds (shortened by its Willpower) it fights for you, then turns back. See "Charmed monsters" under "Sides and companions".

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
- **Right – Dire Wolf (8 s cooldown):** with no wolf, **summons** one beside you in a puff of green sparkles. With the wolf alive, it **heals** the wolf for 20 % of its health (also at full health; the cooldown starts anyway). When the wolf falls, the box waits **60 seconds** (shortened by the same CHA step as the Dire Wolf's own cooldown, so about 46 seconds at CHA 13) before you can summon a new one. There is only ever one wolf per ranger.
- **More, left button:** **Volley** (DEX 15, needs a bow or longbow): three arrows in a fan, each weaker, and it takes longer to nock. **Flanking Thrust** (DEX 16, needs a dagger, duelling sword, katana or machete): a thrust that does **double damage** to an enemy you hit from behind.
- **More, right button:** **Poison Coat** (WIL 15, 16 s): for 6 seconds your weapon attacks add poison and poison what they hit, on top of the weapon's own effects. **Entangle** (CHA 14, 14 s): vines grow where you aim, up to 120 pixels away and not through walls, and root the enemies in them for 4 seconds (a strong enemy breaks free sooner). You cannot aim it with an enemy right next to you. A rooted enemy still attacks.

**Your wolf**
- It has 80 HP, runs a little faster than you and uses **Bite** for 10 about once a second, with a small push.
- **It guards you.** It stays close, bites any enemy that comes within about three tiles of you, and fights back when something attacks it. It does not run off after what you shoot at, and it turns back when it has strayed about six tiles from you.
- **It opens a fight with a leap:** from up to four tiles away it dashes at its prey for 20 damage (about every 3.3 seconds), and this is its **Pounce**, and it crosses chasms. A push into a chasm, deep water or lava is escaped the same way, with the dash, if the dash is ready and the wolf can act. With the dash resting, or while the wolf is asleep, petrified or frightened, it falls, drowns or burns like any monster. After a leap that bites, it waits a moment before the next bite.
- **Nobody gets locked out.** If it falls far behind, or you are in the sealed boss hall without it, it appears next to you again in green sparkles.
- **Enemies fight it.** They attack it and their area attacks hit it. Your own arrows, fireballs and swords, and those of your friends, **never** hurt it. The Paladin's Holy Light heals it.
- **Its figure shows only where there is light**, but its small green health bar, like a hero's, shows even in the dark, with the name "<your name>'s wolf" above it. Its kills count as yours; its death gives no XP or coins, shows a message and starts the 60 seconds.
- **If you fall, the wolf vanishes**, also when you leave the dungeon. Debug mode does not make it immortal.

The two boxes at the bottom of the screen show your abilities. While an ability recharges, the gold rim around its box fills up clockwise and the seconds left show inside; the box flashes once when the ability is ready again.

## Sides and companions

Every creature fights for a side: the monsters against you, you and your friends for you. Some creatures stand on neither side until you ask them.

- **The knight.** In the start room of every dungeon stands a **knight**, a human soldier with a sword, a little north of where the party begins. He shows a **blue-grey health bar and his name**, and a small **Recruit** key cap appears over him when you are within reach. He does nothing and nothing hurts him: your attacks, enemies and traps all pass him by, and no effect lands on him.
- **Press E next to him to recruit him.** If a sleeping teammate is also in reach, E wakes the teammate first. The knight then joins you in green sparkles: his bar turns green like a hero's, and a message names who recruited him.
- **Whom he follows.** The hero who recruited him. If that hero falls, he follows the host, or the next living hero if the host has fallen too, and goes on fighting.
- **He fights near his hero.** He stays close, attacks the enemies that come near you (or him) and does not chase far from you. If he falls far behind or you are in a sealed boss hall without him, he appears beside you again.
- **Your side cannot hurt him.** No hero's attack hurts him, not your arrows, spells or swords nor your friends'; your shots fly past him. Enemies and their area attacks, however, do hurt him.
- **Your help reaches him.** The Paladin's **Holy Light** heals him, and **Haste**, **Purify** and **War Cry** reach him like they reach a teammate.
- **His death costs nothing** but the knight himself: no XP, coins or penalty, and nobody else is harmed. A message tells you he has fallen.

**Charmed monsters.** The Wizard's **Charm Monster** turns a monster into a companion for a few seconds. A small pink heart bobs over its head and its bar turns green.
- **It follows the Wizard who charmed it** and fights the monsters near you with its own attacks, like the knight. If that Wizard falls or leaves, it follows the next hero. Your side cannot hurt it while it is charmed.
- **A master takes its minions along:** charm a necromancer or a summoner and its skeletons or imps fight for you too, also the ones it raises while charmed. They turn back with it.
- **Bosses can be charmed** (not the Lich): the boss stops its own pattern and follows the Wizard for a short while, then picks up where it left off.
- **When the charm ends** it is its old self again, right where it stands: an enemy attacks you again, a wild animal goes back to its place. Magic that is paused also pauses the charm, which comes back if time is left.
- **Killing it counts as it would uncharmed**: an enemy gives XP and coins as usual, a calm wild animal nothing, and a charmed boss that dies still wins the fight.
- **Who resists:** undead cannot be charmed at all; dragons and demons only half as long. The knight and other friends cannot be charmed, and no hero can be.

The Elven Ranger's wolf is a companion of its own kind, summoned with the right button; see "Your wolf" above.

## Seeing in the dark

- The dungeon is **dark**. You carry no light, so you can only see what is lit **and** within your **field of vision** (about nine tiles around you, never through walls). Everything else is black, and **enemies in the dark are hidden**, even right next to you. **You vanish in the dark too:** your hero, your teammates and your shots only show where light falls (glowing shots carry their own light). Your health bar and abilities at the bottom of the screen always show.
- **Torches** hang on the walls of rooms and corridors, about every six tiles, and light the area around them in orange. Some rooms and stretches of corridor have none, so expect **dark pockets**. The starting room and the boss hall always have torches (in a sunlit starting room they start out, but you can light them).
- **Torches can go out.** Press **E** next to a torch to light it or put it out (a small **E** appears over it). **Fire lights a torch**: a fireball, a fire bolt, a fire patch or an exploding barrel. **Any other hit puts it out**: a sword swing, an arrow, a dash, a frost bolt. So a swing at an enemy next to a torch can leave you in the dark.
- **Glowing shots light the way:** fireballs and fire bolts light the corridor they fly through, and magic bolts glow violet, blue or purple. A shot fired into a dark corridor shows what is in it for a moment.
- **Explosions light up** their surroundings for a moment: a fireball, a dragon's fireball or an exploding barrel shows what stands around it. The paladin's healing wave lights up its surroundings in pale gold, too.
- **The air is not clean.** Torches smoke, dust drifts in the light, lava smokes and throws sparks, and water pools drip. It is only for looks and changes nothing in play. Dust and smoke swirl around anything moving through them: a running hero, a monster, an arrow or a fireball stirs the air, and dust clouds a passer-by disturbs fade away, and new dust gathers at once somewhere else in the light. Torchlight is warm, and colours stay true near the flames.
- **Some rooms are lit by sunlight** falling through cracks in the ceiling, with a pale beam and a bright patch on the floor. A level has at most two such rooms (never the boss hall), and their torches start out, but you can still light them with **E** or fire.
- **Every dungeon has one nymph's cove:** a large, sunlit room (as big as the boss hall) with a **big tree** in the middle, a grass carpet with flowers and bushes, and pixies fluttering around the leaves. It is **quiet**: no enemies, no chests, no barrels, no pools or chasms, but it is home to **wild animals** (see "Animals in the cove"). The torches there start out, since five sunbeams light it. The **trunk blocks the way** for you and your dash (ghosts and shades slip through it), and it **blocks sight and shots like a pillar**: arrows and spells stop at it, and you cannot see what stands right behind it, though the ground there is only dimmed and the light still reaches it. When you walk behind the tree, a pale outline of your hero shows through the leaves. A calm place to catch your breath, but there is no treasure to find.
- **Lava glows red** and lights the floor around it. Light of different colours mixes: a torch next to lava gives a deeper orange.
- **Sounds show in the dark.** The wolf's "grrrr", spoken words and the sleeping "Z" are drawn above the darkness, in dark letters with a light outline, so you notice them even where you can see nothing else.
- Numbers and health bars on heroes and the wolf show even in the dark; numbers and health bars on enemies show only where you can see the enemy.
- **Enemies see in the dark only if they are built for it.** An enemy notices you when you are in its line of sight and either lit or very close. **Humans** (the necromancer, the summoner, the lich's disciples) do not see you in the dark at all, however close. **Monsters** (goblin and orc archers, orc warriors, mimics, the ogre) see you in the dark only from about three tiles away. **Undead** (skeletons, the lich), **demons** (imps, chorts, the Red Demon) and the **Red Dragon** see you in the dark as well as in the light.
- **Slip past in the dark.** Put out a torch, or stay out of the light, to slip past humans and monsters. Anything you light up (a fireball, a torch you relight, an exploding barrel) can be seen too, so fire is loud. Skeletons and demons are not fooled by darkness.

## The Woodland

The host can pick the **Woodland** in the lobby instead of the dungeon. It is a long **forest road** under open sky: it is **daylight**, so nothing is dark and you see as far as your field of vision reaches. Beyond that the forest is still drawn, only **hazy** (pale and a little washed out, never darker; the edge of your sight fades in softly, and a tree you can see is never hazy), but any creature out there stays hidden until it comes into your sight. Trees and bushes cast **shadows** on the ground, and they follow that day's sun: the sun stands on the left or the right and high or low, so some days the shadows are short pools and others long ones across the road. Dark cloud shadows drift over the ground, and bees and butterflies fly about (cloud shadows, bees and butterflies are only for looks).

- **The goal:** follow the road from the left to the far **clearing at the road's end**. As soon as one living hero stands in it, the party wins, and every hero still alive earns **150 XP** (a first guess). There is no boss and no treasure. If the whole party falls, the run is lost.
- **The road** winds between a thick wall of undergrowth (you cannot walk through the thicket) and open grass with bushes. The party starts at the left end of its stretch of road. The road and the forest go on beyond both ends, but an **invisible wall** stops you there (your shots and your sight pass it; nothing lives beyond it). Small clearings open to the side of the road.
- **Trees block sight and shots.** Every trunk stops you and your dash (ghosts and shades slip through), and works like a pillar: **arrows and spells stop at it, and you cannot see what stands behind it**. The ground behind a trunk is only hazy (clear at the trunk, hazier the further behind it), so you can still see the grass, but an enemy or animal there stays hidden until you step aside. Trees keep clear of the road's centre, so you can walk it freely. When you stand behind a tree's crown, a pale outline of your hero shows through the leaves, also where several crowns overlap.
- **The thick forest at the edge** blocks your movement and your sight: creatures beyond it stay hidden, though its ground shows hazy.
- **Enemies:** groups of two to four goblin archers, orc warriors and orc archers wait in some of the clearings, away from where you start. They notice you as they would in the light.
- **Animals:** bunnies, deer (with a stag among them) and boars live in the wood and wander about. They behave as the cove's animals do (see "Animals in the cove").

## Animals in the cove

Every nymph's cove is home to 15 wild animals: a boar, a stag, three deer and ten bunnies. They wander near where they live and take no side: enemies ignore them and they ignore you. Killing a calm animal pays nothing, and you cannot recruit them.

- **Bunnies, deer and the stag run.** Hit one and it runs from whoever hit it, for at least a second and a half after every hit. It calms down again once you are out of its sight or far enough away. A bunny usually dies at once. They give no XP, coins or kills.
- **The boar fights back.** Leave it alone and it wanders. Hit it, and it holds a grudge against your side: it charges and strikes, and it does not forget. If you lose it, it searches, goes home and wanders again. Killing a boar that holds a grudge against you gives its XP, but no coins.
- **Enemies can anger it too.** An enemy that hits the boar makes it an enemy of the enemies, so a goblin lured into the cove ends up fighting the boar it hit.
- **Only a hit counts.** Fear, roots and the like do not anger a boar: a War Cry frightens it without starting a fight. Lava does not anger it either.
- **Chains and jumps** (Chain Spark and similar) skip calm animals, and arrows and spells can hit them like enemies. Area attacks and swings hit any animal in reach.
- **They show no health bar until hurt.**

## Enemies

| Enemy | What to expect |
|---|---|
| Goblin archer | Weak and fast. Shoots arrows from a distance, usually in groups. |
| Skeleton warrior | Slow melee fighter. |
| Skeleton archer | Shoots arrows. Too simple to back away from you. |
| Orc warrior | Tough melee fighter, hits hard and **knocks you back**. |
| Orc archer | Tough archer. |
| Necromancer | Casts **Shadow Bolts** (green) and casts **Raise Dead**: after a short wind-up (0.7 s) it raises **two** skeletons or skeleton archers around itself, about every 7 seconds, up to **four alive** at a time. Kill the necromancer and all of its minions crumble. |
| Mimic | Looks exactly like a treasure chest. Walk up to it (or hit it) and its lid flies open: it **hops after you** and bites. It stops chasing when you get out of sight and waits where it was found. Worth 25 coins. |

**Smart enemies step aside.** Clever enemies (the orcs and demons, for example, but not the skeletons) and your wolf **step out of the way of a shot they see coming**. No dice are rolled: they simply walk sideways, and whether it works depends on how early they notice the shot (nimble ones notice farther away), how big and slow they are, and how soon the shot arrives. Big, slow creatures such as the dragon almost never get out of the way. They ignore shots that would barely scratch them (until they are wounded), and the cleverest also step aside from shots that carry a dangerous effect such as sleep or charm. They are busy and take the hit while they **wind up an attack or cast**, when they cannot see the shot (an arrow from the dark), and when walls block the step. To land your shots: shoot from **close range**, hit them **while they wind up or cast**, shoot **from the dark** (most enemies see an arrow there only once it is close, demons and ghosts see it anyway, and everyone sees fire), and aim at **big, slow ones**.

**Ghosts and Shades** are rare extras that haunt the deeper rooms and halls (about one room in four, from about a third of the way in). The lich's dungeon has **Ghosts**, the demon's dungeon has **Shades**; the dragon's dungeon has neither. They are the ghostly dead and no ordinary weapon scratches them (see Damage types and resistances): only magic hurts them.

| Enemy | What to expect |
|---|---|
| Ghost | Pale and see-through, its body pulses faintly. Its **Touch** is mostly magical with a little cold, and leaves you **Weakened** (your Strength drains, see Status effects). Worth 10 XP. |
| Shade | A pitch-black figure with red eyes in a cloud of dark strands that streams behind it when it moves. Its **Touch** leaves you **Frail** (your Constitution drains). A little tougher than the Ghost. Worth 12 XP. |

Both fight by ambush. When they notice you they **vanish**, then drift through the walls toward the hero who has strayed furthest from the rest of the party (a lone hero is always the target). When they are close enough they **appear for half a second** before they strike. The warning tells you where: the Ghost **flickers rapidly** at the spot, the Shade shows a **dark silhouette** that darkens in. That half second is your chance to **dash away** or to stand with your party. If they have not reached you within about five seconds, they show themselves and simply fight. Hitting one while it is invisible shows it at once. Each touch stacks another drain, so stay out of reach once they are visible, and kill them with magic before the drains pile up. After their invisibility has been used, they vanish and come again every 13 to 15 seconds.

*All their numbers (health, damage, XP, cooldowns) are first guesses and may change while the game is balanced.*

**The demon's dungeon** (when the demon is the end boss) has demons instead of skeletons:

| Enemy | What to expect |
|---|---|
| Imp | Small demon in place of the skeleton archer. Uses **Fire Bolt** and, being clever, backs away from you, but uses **Strike** (its claws) on you if you get close. |
| Chort | Horned demon in place of the skeleton warrior. Closes in and claws (a **small knockback**), and uses a **Fire Bolt** now and then while you are out of reach. |
| Summoner | Red-robed caster in place of the necromancer. Uses **Fire Bolt** and casts **Summon Imps**: after a short wind-up (0.7 s) it summons **two** imps every 8 seconds, up to **four alive** at a time. Kill the summoner and its imps vanish. |

### The ogre (mini-boss)

Every dungeon has **one ogre**, roaming one of the deeper rooms like any other enemy. It is big, slow and tough, and always shows a **wide health bar** over its head. It is worth 60 XP and 30 coins.

- **Spiked club:** a heavy swing that **knocks you back further than any other enemy** (28 px, almost two tiles).
- **Ground Slam** (the same ability as the Barbarian's): when two heroes are close to it (or one, while its club is still recovering), it raises its club and a **red circle** appears on the floor around it. The circle fills up from the middle; when it is full the club comes down. **Everyone inside the circle** takes damage and is pushed straight away from the ogre (28 px). Step out of the circle before it fills.
- Tip: fight it away from chasms and deep water, and don't crowd around it.

Enemies **flash red and shake** just before they strike. That is your moment to step away. Enemies get tougher the deeper you go, and halls hold the biggest groups.

### Knockback

Some attacks **push you away** from the attacker. Every push is a **maximum** distance: the pusher's **STR** must beat the target's weight, and the push is full only when it beats it by 4 or more (a pusher that does not beat the weight moves nothing). The same rule works for you: your **Fireball** pushes the enemies it hits, **up to 20 px**. The numbers below are the full push; a pusher with less STR moves the heavier heroes (Paladin 12, Barbarian 13) less. The bosses' STR (22 to 24) gives the full push against every hero, except the lich (STR 10):

| Attacker | Push |
|---|---|
| Orc warrior | about a tile (20 px) |
| Ogre: club / ground slam | almost 2 tiles (28 px) for both; the slam hits everyone in the circle |
| Chort (its claw) | a little less (14 px) |
| Red Demon: cleave / swoop | a long way (about 3.5 / 4 tiles) |
| Red Dragon: front claw / bite / tail whip | 2 / 1.5 / almost 3 tiles (32 / 24 / 44 px) |
| Red Dragon: landing smash / Fireball | over 2 tiles (36 px), everyone in the circle / about a tile (20 px) |
| Lich: Nova | only the Wizard, 16 px (the lich's STR is only 10) |

- The push slides you for a moment. **You have no control until it ends**: no walking, no attacks, and a dash can't break out of it.
- Walls stop the slide, but **chasms and deep water do not**: a push over the edge is a fall or a drowning. Lava just burns.
- **Only a few attacks push**: the orc warrior's and chort's claws, the ogre's club and Ground Slam, the bosses' big attacks, and any **Fireball**. Imps, skeletons, mimics and other shots don't push.
- **Bosses are never pushed**, not even by your Fireball. Neither are your friends by your Fireball, nor a mimic that is still hiding.
- The bosses push with **their own STR**. The lich is weak (STR 10): its Nova hardly moves anyone any more.
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

Heroes, enemies and barrels can **resist** a type: that part of the hit is reduced. An attack with several types (the fireball is mostly heat, partly magical and physical) is reduced part by part, so an enemy immune to fire still takes the rest. When a hit does nothing at all, the number says **immune**. Resisting tops out at full immunity (nothing heals by resisting), and a **weakness** adds damage, at most double.

| Enemy | Resists | Weak to |
|---|---|---|
| Skeletons, raised skeletons, the Lich | physical 10 %, **poison completely** (the Lich: physical about half, magical 40 %) | heat 10 % more |
| Imps, chorts, summoners, the Red Demon | **heat completely**, magical 20 % (the Red Demon 40 %) | cold |
| Red Dragon | **heat completely**, magical half, physical 10 % | |
| Barrels and chests | physical half, poison completely | |

- **Incorporeal creatures** (Ghosts and Shades) have no solid body: an attack they fully resist goes right through them, with no damage, no side effect and no push, and arrows fly on. **Only magic hurts them, and a little extra** (10 % more). A mixed attack does only its magic part. Some heroes have no magic yet, and cannot hurt them at all. They float through walls and solid objects, but never stop inside one, and hover over chasms, deep water and lava without harm. You cannot push them, roots cannot hold them, and they always look see-through. They can also **vanish**: you see nothing of them, your wolf, gazes and Chain Spark's jumps ignore them, and monsters cannot see an invisible hero either. Being invisible gives them no protection of its own: an area attack or War Cry that could hurt or frighten them still does. A hit shows them again, even a hit that does no damage, and so does a harmful effect that takes hold. An effect they shrug off does not. They also show themselves when they attack; healing and buffs do not. A creature that is both, such as a ghost, takes the stronger resistance of each type; no resistance goes above 100 %, so nothing heals by resisting.
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
- Both the cleave (**Strike** with its demon claws) and the **Swoop** hurl you back a long way.
- **Ring of Fire:** fireballs fly out in every direction.
- It never gets angrier: the demon fights the same from the first hit to the last.

Tip: stay mobile, and don't stand between the demon and a chasm.

### The Lich
- **Cannot be harmed** while its **disciples** live. The bar shows **IMMUNE**. There are at least five red-robed disciples around the hall.
- The red shimmering streams flowing to it show its protection: while they flow, it cannot be harmed.
- All its magic is **dark purple gloom**.
- Casts **Gloom Bolts**: a fan of five.
- **Raise Dead:** about every 5.5 seconds, after a short wind-up, it raises **three** skeletons or skeleton archers around it (half and half), up to **five alive** at a time. It starts with this about eight seconds into the fight. The disciples do not count towards the five.
- **Nova:** about every 5 to 6 seconds it stops, raises its staff and a **purple circle** fills up on the floor around it. When it is full, a dark blast hurts **everyone inside** and pushes them. The lich is weak (STR 10): only the Wizard (weight 9) is pushed, a little (16 px); every other hero stands firm. Step out of the circle in time.
- **Three curses**, each aimed at one hero it can see (it sees only what you would see: it cannot curse you from behind a wall. A hero who already suffers *that* curse is passed over, and the lich picks the nearest hero it sees):
  - **Blinding Curse:** about every 4.5 seconds the lich flings a **dark orb**. It is slow, so **step aside**. A hit does a little damage and **blinds** you for 3 seconds: you see almost nothing, not even with darkvision.
  - **Sleep Mist:** about every 6.5 seconds, a **purple orb**. A hit puts you to **sleep** for 4 seconds: you lie on the floor and cannot move, attack or use abilities, and you see only a little around you. **Step aside** from the orb, and **wake a sleeping teammate** by standing next to them and pressing **E**.
  - **Stone Gaze:** about every 8 seconds the lich stares at one hero and a **thin grey beam** links them for a second. When it ends, that hero **turns to stone** for 3 seconds: you cannot move, attack or turn, but you take much less damage and are hard to push. **Break the line of sight** (duck behind a pillar or a wall) before the beam ends and nothing happens.
- Those streams show even when the lich or a disciple is out of your sight, so they point the way to both.

Tip: kill the disciples first. Once the last one falls, the lich's protection breaks.

### The Red Dragon
Every attack shows its pose first, while the dragon flashes red: that is your moment to step away.
- **Fire Breath:** it rears its head back while smoke rises from its nostrils, then it breathes a cone of fire that **leaves burning ground** behind. The breath does not push.
- **Bite:** it pulls its head back, then lunges straight ahead with its neck, a little further than its claw reaches. Hard-hitting, pushes you back (24 px). Only the hero right in front of its mouth is bitten.
- **Front claw** (**Strike**): raises a paw and swipes at heroes in front of its face, pushing them back (32 px).
- **Tail Whip:** curls its tail, then whips anyone standing behind it and flings them away (44 px). The tail is physical damage.
- **Fireball:** the Wizard's spell, which the dragon casts too: an exploding ball that pushes you a little (20 px).
- **Flight:** every 10 to 12 seconds it takes off and hovers after the party for a few seconds. **Swords, axes, the dagger and the dash can't reach it in the air**; bolts, missiles and spells still hit. In the air its only attack is the Fire Breath, also from above.
- **Smash (landing):** a red circle on the ground shows where it comes down. The landing hits everyone inside the circle and pushes them away (36 px).

Tip: when you see the smoke, get out of the area in front of its mouth. Don't stand directly behind it either, least of all with a chasm at your back. When it takes off, ranged heroes do the work; get out of the red circle before it lands.

## Status effects

Some attacks do more than damage. Your own effects show as small symbols with the seconds left under your health bar, and your party's effects as symbols in the party list (top left). A teammate's effects also show beside their floating name. A **thin outline symbol** is the weaker tier of an effect (Singed, Chilled, Tainted). While you are asleep, a panel with a moon appears above your health bar.

| Symbol | Effect | What it does |
|---|---|---|
| Crossed-out eye | Blind | You see nothing around you (darkvision does not help) |
| Moon | Asleep | You lie down: no moving, attacking or abilities, and a very short view. A teammate's **E** wakes you at once |
| Cracked stone | Petrified | Stone: no moving, attacking or turning, but you take far less damage and are hard to push |
| Hourglass | Slowed | You walk at half speed, and your cooldowns run 25 % slower |
| Double arrow | Accelerated | You walk half as fast again, and your cooldowns run 25 % faster (Haste and War Cry give it to heroes) |
| Flame | Burning | Fire eats at you: heat damage for 3 seconds. Water puts it out |
| Snowflake | Frozen | Ice: you cannot move, act or turn for 2 seconds, and the cold hurts a little |
| Drop | Poisoned | Poison eats at you for 4 seconds |
| Thin snowflake | Chilled | Cold slows you to 70 % speed for 3 seconds, and your cooldowns run 25 % slower |
| Thin flame | Singed | A weaker burn: a little heat damage for 3 seconds. Water puts it out |
| Thin drop | Tainted | A weaker poison: a little poison damage for 3 seconds |
| Vine | Entangled | Roots hold you: you cannot move for a few seconds, but you can still turn and attack |
| Skull | Fear | You run away from whoever scared you and cannot attack (enemies only, for now) |
| Shield | Warded | Gold: nothing can blind, sleep or petrify you (Purify) |
| Blade | Coated | Green: your weapon attacks add poison and poison what they hit, on top of the weapon's own effects (Poison Coat) |
| Eye | Invisible | Nobody can see you (enemies cannot target you) and you look faint to your party. A hit on you, or attacking yourself, ends it. No hero can do this yet; Ghosts and Shades vanish this way |
| Down arrow (coloured by Attribute) | Weakened | Your **Strength** drops by 1 or more for about 20 seconds (shortened by your save). Purify ends it |
| Down arrow (coloured by Attribute) | Clumsy | Your **Dexterity** drops by 1 or more for about 20 seconds (shortened by your save). Purify ends it |
| Heart | Charmed | Pink: the monster fights for the hero who charmed it, then turns back (Charm Monster; never on heroes yet) |
| Down arrow (coloured by Attribute) | Frail | Your **Constitution** drops by 1 or more for about 20 seconds (shortened by your save). Purify ends it |

**One hit can apply several effects at once.** A weapon or a spell may poison and weaken in the same blow, and each effect keeps its own strength and is shortened by its own save. If two of them cancel each other (fire and cold), the later one wins.

A sleeping or petrified hero cannot dodge, and a blind one cannot see what is coming, so the party's job is to keep the enemies off them. The final bosses resist some effects: all of them resist sleep completely, and some shorten other effects. The effects end by themselves after a few seconds.

The effects from damage types work in two tiers. A hit that is **at least half heat, cold or poison** puts the strong effect on whoever it hits, hero or enemy: Burning, Frozen or Poisoned. A hit that is **at least a quarter** (and less than half) puts the weak one: Singed, Chilled or Tainted. Fireballs, fire bolts, barrel blasts and the dragon's fire burn, and so does **lava**. The strong effect replaces the weak one of its kind. There is no chance involved: the effect always starts, and the target's resistance or toughness only shortens it or stops it. The damage over time hits twice a second, and a creature that resists the type takes less of it.
- **Burning and Singed:** water puts them out, in a pool or in the shallows. Fire and ice cancel each other, weak and strong: a fire hit on a frozen or chilled creature thaws it instead of burning it, and a cold hit on a burning or singed one puts the fire out. **Demons and the Red Dragon never burn** (they resist heat completely), so use something else on them. A hero who burns a monster to death still gets the kill.
- **Frozen and Chilled:** Frozen roots a creature and stops it from acting or turning until the ice ends, so a frozen hero needs the party to cover them. Fire thaws it at once. Frost Shard chills, and Frost Nova freezes. The Ember Staff now singes.
- **Poisoned and Tainted:** just the damage. **Undead are never poisoned** (they resist poison completely). The Staff of Rot poisons, and Poison Coat poisons what your weapon hits.
- **Entangled** (Entangle) and **Fear** (War Cry): your **Strength** shortens roots and your **Willpower** shortens fear, on you and on enemies alike, so a strong monster breaks out sooner. A rooted enemy can still attack you, and an enemy that runs away comes back when the fear ends. **Undead and bosses cannot be frightened** (and undead cannot be put to sleep either), and demons only half as long.

**Attribute drains (Weakened, Clumsy, Frail).** These lower one of your Attributes while they last, and everything that depends on it follows: damage, health, speed, saves. The chip shows how much (for example -2). The number counts every touch, so it can be larger than the real drop once the Attribute is at its floor of 1. Touching you again **stacks** another -1 (a stronger source drains more per touch) and renews the time; there is no limit, but an Attribute never drops below 1. Your **Willpower** (against magical sources) or **Constitution** (otherwise) only shortens the time, and a creature that resists the effect completely drains nothing.
- **Health:** a drain on Constitution lowers your maximum health. Your current health is only cut down to the new maximum and never below 1, so a drain cannot kill you. When it ends, your maximum comes back but your health does not, so heal up.
- **Gear and abilities:** an item's requirement counts your other usable items, drain included. If a drain leaves you below it, the item gives you nothing until it ends (and an item that only worked thanks to it stops too) (a melee weapon you cannot use is replaced by your class's starter weapon). An ability's requirement counts your usable items like anywhere else; one you can no longer use (also because its weapon stopped working) is greyed out and does nothing (pressing it tells you which Attribute it needs, for example "Needs DEX 14"), though a ranged primary (left button) ability still falls back to Strike in melee. Your light, keystones and sight do not change (a drain never dims your light; only a pause of the light item does, see below).
- Enemies can be drained too, and get weaker the same way.

**Magic and non-magic effects.** Every effect is either magic or not. Effects from spells and innate abilities are magic: Haste (Accelerated), Charm Monster (Charmed), Purify (Warded), Vanish (Invisible), the Ghost's and Shade's Touch (Weakened, Frail), and the sleep, blind, stone and root spells of the lich and the Entangle ability. Burning, Frozen, Poisoned and their weaker tiers are not magic, whatever hit caused them, and neither are War Cry, Poison Coat or an ordinary weapon hit. Worn items with magical properties (the Flame Sword's fire and light, rings, the Boots of Haste and so on) and the Radiant node in the skill tree are magic too; a class's natural traits and a monster's own toughness never are. Magic can be paused: a paused effect does nothing, and its icon turns grey while its seconds keep counting down; a paused item or skill node shows as a grey chip with its name, and loses its magical properties until it is back (its base numbers and its non-magical properties keep working). **Nothing in a normal game pauses magic yet**, so you will not see this in play for now.

## Death, victory and defeat

- If you fall, you are **out for this run**: there are no revives. You watch your teammates (Q / E to switch) until the run ends.
- If the whole party falls, the run is lost.
- **Slay the boss** to win the dungeon; in the Woodland, **reach the clearing at the road's end** instead. The end screen shows each hero's kills, damage, healing, **XP** and **coins**.

## XP, coins and the character

- Every kill gives **XP to every living member of the party**: 2 for a raised skeleton or summoned imp, 5 for a goblin, 8 for a skeleton, imp or chort, 12 for an orc, 20 for a disciple, 25 for a necromancer or summoner and **300 for the boss**. Once you have fallen, you stop earning.
- **Coins** come from treasure chests, mimics (25) and the boss (50). Like XP, they go to every living hero. They pay for a respec (below).
- When the run ends, won or lost, your XP and coins are added to the **character** you played. If you leave early, you keep what you earned so far.
- **Debug mode** is a developer tool on test accounts that the admin marks. It never mixes with normal games: debug accounts see only debug rooms, and you cannot turn it on yourself.

**The roster and the character screen.** After login you see one card per character, with its figure holding its weapon (a Ranger also shows its ranged weapon; other heroes hold their melee weapon). Click a card to open the character screen, or click **New character** to create a character (its screen opens at once). The screen has four tabs: **Sheet**, **Skill tree**, **Equipment** and **Loadout**. You can change your build there while you are not Ready and not in a run; otherwise the game says "Not while ready." or "Not during a run."

Red means a choice does not work yet. The reason is in its tooltip or under it, with a hint on how to fix it. You can still click a red item or pick; the server refuses it and tells you why.

- **Sheet tab, Attributes.** STR, DEX, CON, INT, WIL and CHA. Each line shows the total and what it is made of: base 10, your race, your class, the points you bought with XP ("bought") and your items. Only the parts that add something are listed. Click the **+1** button of an Attribute to buy a point with XP. The button shows the price, which rises with every point you buy. The price rises with the Attribute: 100 XP for a point at 10 and 25 more for each point above 10, times a weight (DEX costs a quarter more, WIL a fifth less). Items never raise the price.
- **Skill tree tab.** Hover a node to read what it does and what it needs. Click a node you can buy; a confirm asks first. In the tooltip, "you have" turns red when you are short of XP or of an Attribute. Gold nodes are owned, bright ones are reachable and can be bought, dim ones are not reachable yet. A red ring means an Attribute requirement is not met. Every class has its own tree, starting at a free first node. You can buy a node that touches one you own, if you have the XP and meet its requirement (an Attribute value, your items count). A node can give a resistance, a kind of weapon or armour you may use, a new ability, or an improvement of one ability (it works only while you have that ability equipped, also when an item gives it to you). The last node of a branch is a **keystone**, a big change to how you play:
  - Wizard: **Arcane Overflow** (spells +15 % damage, +10 % cooldown), **Deep Winter** (+20 % cold damage to chilled or frozen enemies), **Pyromancer** (+20 % heat damage, −20 % cold damage).
  - Paladin: **Radiant** (innate abilities +20 % against the undead and demons, and a glow around you), **Unshaken** (sleep cannot affect you), **Bulwark** (armour weighs half, +10 % physical resistance).
  - Barbarian: **Berserker** (below half life +25 % damage and cooldowns 25 % faster, but every resistance 10 points lower), **Juggernaut** (heavier, and slow, chill and roots cannot hold you), **Unbreakable** (your CON counts 4 higher for every saving throw).
  - Elven Ranger: **Pack Hunter** (enemies your wolf bit in the last 2 seconds take 20 % more from you), **Deadeye** (shots from a ranged ability do double damage to slowed, chilled, rooted or sleeping enemies), **Venomancer** (poisoned enemies take 15 % more from you).
  - A keystone's damage bonus counts only your own hits, not your wolf's bites or burning and poison ticks.
- **Respec** (Sheet tab). Gives back all the XP you spent on Attributes and the tree, for coins: 20 coins plus 1 for every 50 XP spent. It also resets your chosen abilities. Items you can no longer wear go back to your inventory; nothing is lost.
- **Equipment tab, items.** Click an item in the inventory to put it into its slot (a ring goes to the first free ring slot). You can also drag it onto a slot. Click a worn item, or drag it back to the inventory, to take it off. A red item has a reason in its tooltip. The class starters are ordinary items. You can wear an item only if your class is proficient with it and you meet its requirement. Your other worn items count: a ring with +1 INT can lift you to the INT a staff needs. An item's own bonus never counts for itself, and the item you replace does not count either. If you take off the ring, the staff stays on but is greyed out and gives nothing until you meet its requirement again. In a debug game the screen can also add any item to your inventory.
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
- Only the clever archers back away from you; the simple ones stand and shoot. Close in, or use the Wizard and the Elven Ranger to pick them off. Clever enemies dodge shots they see coming, so shoot from close range or while they wind up.
- Use corners: enemies can't attack what they can't see.
- Skeletons, demons and the dragon see you in the dark, so a lit torch behind you helps you see them. Humans and most monsters lose you in the dark: put out a torch (any non-fire hit does it) to slip past them, and light it again with **E** or with fire when you fight.
- Barrels are a weapon and a danger: light them from a distance, and keep your back free. Archers shoot barrels next to you.
- Put a chasm or a pool between you and melee enemies: they have to walk around it. In the demon's dungeon, lava doesn't stop the demons.
- Against the lich, don't stand in a straight line with it for long: the dark and sleep orbs are slow but only a step to the side dodges them, and the stone gaze needs a clear line to you. When a teammate falls asleep, kill what is next to them first, then press **E**.
