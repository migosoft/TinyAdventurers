use super::abilities::AbilityId;
use super::attributes::{Attr, Attributes};
use super::races::{self, Adjust, Race, Profile};
use super::items::ItemId;
use super::kinds::EntityKind;
use crate::protocol::BossId;
use crate::run::targets::Reaction;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EnemyType {
    GoblinArcher,
    SkeletonWarrior,
    SkeletonArcher,
    OrcWarrior,
    OrcArcher,
    Necromancer,
    RaisedSkeleton,
    /// Skeleton archer raised by the lich (weaker, dies with it; looks like a skeleton archer).
    RaisedArcher,
    Disciple,
    /// Hides as a treasure chest until a player comes close or hits it.
    Mimic,
    // Demon dungeons: these replace the skeletons and the necromancer (see `for_boss`).
    /// Small demon: fire bolts from range, claws when a hero comes close.
    Imp,
    /// Horned demon: claws in melee, a fire bolt now and then from afar.
    Chort,
    /// Red-robed necromancer that summons imps instead of raising skeletons.
    Summoner,
    /// Imp summoned by a summoner (weaker, dies with it).
    SummonedImp,
    /// Mini-boss, one per run: a spiked club that pushes hard and a ground
    /// slam that hits and pushes every hero around it.
    Ogre,
    /// Incorporeal ambusher haunting the lich's dungeon (see `haunt_for`): vanishes, appears next to a hero and touches.
    Ghost,
    /// Incorporeal ambusher haunting the demon's dungeon (see `haunt_for`): the Ghost's twin, draining CON.
    Shade,
    /// A soldier who can join the party (#149): never placed by level generation, only by the start room.
    Knight,
    /// Wildlife (#227): runs from whoever hit it. Spawned in the nymph's cove.
    Bunny,
    /// Wildlife (#227): runs from whoever hit it; the spotted deer.
    Deer,
    /// Wildlife (#227): the deer's twin with antlers, its own type with the deer's numbers.
    Stag,
    /// Wildlife (#227): fights back against the side that hit it.
    Boar,
}

impl EnemyType {
    #[cfg(test)]
    pub const ALL: [EnemyType; 22] = [
        EnemyType::GoblinArcher,
        EnemyType::SkeletonWarrior,
        EnemyType::SkeletonArcher,
        EnemyType::OrcWarrior,
        EnemyType::OrcArcher,
        EnemyType::Necromancer,
        EnemyType::RaisedSkeleton,
        EnemyType::RaisedArcher,
        EnemyType::Disciple,
        EnemyType::Mimic,
        EnemyType::Imp,
        EnemyType::Chort,
        EnemyType::Summoner,
        EnemyType::SummonedImp,
        EnemyType::Ogre,
        EnemyType::Ghost,
        EnemyType::Shade,
        EnemyType::Knight,
        EnemyType::Bunny,
        EnemyType::Deer,
        EnemyType::Stag,
        EnemyType::Boar,
    ];
}

#[derive(Debug, Clone, Copy)]
pub struct EnemyDef {
    pub kind: EntityKind,
    /// At the kind's own CON (10 + modifier), before races.
    pub hp: f64,
    /// At the kind's own CON (10 + modifier), before races.
    pub speed: f64,
    pub radius: f64,
    /// The kind's modifier from 10; read the Attributes through `attrs(…)`.
    pub attr_mods: Attributes,
    /// Weight for pushes (see the spec's section 4).
    pub weight: f64,
    /// Vision (tiles); overrides the race's. Enemies only notice players inside it with line of sight.
    pub vision: f64,
    /// The abilities it uses: the main one first, then the alt (own cooldown). The alt is used when
    /// the target is in reach for a melee one, from afar for a bolt (imps claw, chorts throw fire bolts).
    pub abilities: &'static [AbilityId],
    /// What the abilities use: the melee weapon (or natural one: fists, claws, bite), then the bow.
    pub weapons: &'static [ItemId],
    /// How it moves and when it uses its main attack (the base AI layer, run/behaviour.rs).
    pub base_ai: BaseAi,
    /// Whether it wanders around its home when it has nothing to do. The Disciple and the awake Mimic stay put.
    pub wanders: bool,
    /// Set for a wild animal (#227): it is Neutral, calm until hit, and reacts as this says.
    pub wild: Option<Reaction>,
}

/// How a creature moves and fights: the base AI under its role and over its ability modules. The
/// bosses' scripts (run/bosses/) are a base of their own and read none of this.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BaseAi {
    /// Closes in on its foe and swings.
    Melee,
    /// Keeps `preferred` px from its foe, backing off when closer, and shoots.
    Ranged { preferred: f64 },
    /// Never moves: it only attacks what is in reach or in sight (the Disciple, speed 0).
    Stationary,
}

pub fn def(t: EnemyType) -> EnemyDef {
    use AbilityId::{Bite, FireBolt, GroundSlam, RaiseDead, ShadowBolt, Shoot, Strike, SummonImps, Touch, Vanish};
    use EnemyType::*;
    use ItemId::*;
    match t {
        GoblinArcher => {
            let attr_mods = Attributes::new(-2, 5, 0, 0, -2, -2);
            EnemyDef {
                kind: EntityKind::GoblinArcher,
                hp: 24.0,
                speed: 58.0,
                radius: 4.0,
                vision: 8.125,
                attr_mods,
                weight: 6.0,
                abilities: &[Shoot, Strike],
                weapons: &[UnarmedStrike, GoblinShortbow],
                base_ai: BaseAi::Ranged { preferred: 90.0 },
                wanders: true,
                wild: None,
            }
        }
        SkeletonWarrior | RaisedSkeleton => {
            let attr_mods = Attributes::new(2, 2, if t == RaisedSkeleton { 2 } else { 5 }, -9, -2, -5);
            EnemyDef {
                kind: if t == RaisedSkeleton { EntityKind::RaisedSkeleton } else { EntityKind::SkeletonWarrior },
                hp: if t == RaisedSkeleton { 26.0 } else { 40.0 },
                speed: 46.0,
                radius: 5.0,
                vision: 7.5,
                attr_mods,
                weight: 9.0,
                abilities: &[Strike],
                weapons: &[SkeletonSword],
                base_ai: BaseAi::Melee,
                wanders: true,
                wild: None,
            }
        }
        SkeletonArcher | RaisedArcher => {
            let attr_mods = Attributes::new(0, 5, if t == RaisedArcher { 2 } else { 3 }, -9, -2, -5);
            EnemyDef {
                kind: EntityKind::SkeletonArcher,
                hp: if t == RaisedArcher { 20.0 } else { 30.0 },
                speed: 44.0,
                radius: 5.0,
                vision: 8.75,
                attr_mods,
                weight: 9.0,
                abilities: &[Shoot, Strike],
                weapons: &[UnarmedStrike, SkeletonBow],
                base_ai: BaseAi::Ranged { preferred: 100.0 },
                wanders: true,
                wild: None,
            }
        }
        OrcWarrior => {
            let attr_mods = Attributes::new(6, 2, 6, -3, 1, 0);
            EnemyDef {
                kind: EntityKind::OrcWarrior,
                hp: 70.0,
                speed: 52.0,
                radius: 6.0,
                vision: 7.8125,
                attr_mods,
                weight: 13.0,
                abilities: &[Strike],
                weapons: &[OrcCleaver],
                base_ai: BaseAi::Melee,
                wanders: true,
                wild: None,
            }
        }
        OrcArcher => {
            let attr_mods = Attributes::new(4, 4, 4, -3, 1, 0);
            EnemyDef {
                kind: EntityKind::OrcArcher,
                hp: 50.0,
                speed: 48.0,
                radius: 6.0,
                vision: 8.75,
                attr_mods,
                weight: 13.0,
                abilities: &[Shoot, Strike],
                weapons: &[UnarmedStrike, OrcWarbow],
                base_ai: BaseAi::Ranged { preferred: 100.0 },
                wanders: true,
                wild: None,
            }
        }
        Necromancer | Summoner => {
            let attr_mods = if t == Summoner { Attributes::new(-1, 4, 2, 5, 2, 6) } else { Attributes::new(-1, 4, 2, 7, 2, 1) };
            EnemyDef {
                kind: if t == Summoner { EntityKind::Summoner } else { EntityKind::Necromancer },
                hp: 60.0,
                speed: 40.0,
                radius: 5.0,
                vision: 9.375,
                attr_mods,
                weight: 10.0,
                abilities: if t == Summoner { &[FireBolt, Strike, SummonImps] } else { &[ShadowBolt, Strike, RaiseDead] },
                weapons: if t == Summoner { &[SummonerRod] } else { &[NecromancerRod] },
                base_ai: BaseAi::Ranged { preferred: 110.0 },
                wanders: true,
                wild: None,
            }
        }
        Disciple => {
            let attr_mods = Attributes::new(0, 2, 0, 3, 1, 0);
            EnemyDef {
                kind: EntityKind::Disciple,
                hp: 45.0,
                speed: 0.0,
                radius: 5.0,
                vision: 12.5,
                attr_mods,
                weight: 10.0,
                abilities: &[ShadowBolt, Strike],
                weapons: &[UnarmedStrike],
                base_ai: BaseAi::Stationary,
                wanders: false,
                wild: None,
            }
        }
        Mimic => {
            let attr_mods = Attributes::new(7, 2, 5, -5, 3, -2);
            EnemyDef {
                kind: EntityKind::Mimic,
                hp: 90.0,
                // Average speed: it only moves while airborne (see MIMIC_HOP_*).
                speed: 50.0,
                radius: 6.0,
                vision: 8.75,
                attr_mods,
                weight: 14.0,
                abilities: &[Bite],
                weapons: &[MimicBite],
                base_ai: BaseAi::Melee,
                wanders: false,
                wild: None,
            }
        }
        Imp | SummonedImp => {
            let attr_mods = Attributes::new(-4, 7, if t == SummonedImp { 0 } else { 3 }, 1, 2, 4);
            EnemyDef {
                kind: EntityKind::Imp,
                hp: if t == SummonedImp { 20.0 } else { 30.0 },
                speed: 44.0,
                radius: 5.0,
                vision: 8.75,
                attr_mods,
                weight: 4.0,
                abilities: &[FireBolt, Strike],
                weapons: &[ImpClaws],
                base_ai: BaseAi::Ranged { preferred: 90.0 },
                wanders: true,
                wild: None,
            }
        }
        Chort => {
            let attr_mods = Attributes::new(4, 3, 3, -2, 0, -1);
            EnemyDef {
                kind: EntityKind::Chort,
                hp: 40.0,
                speed: 46.0,
                radius: 5.0,
                vision: 7.5,
                attr_mods,
                weight: 10.0,
                abilities: &[Strike, FireBolt],
                weapons: &[ChortClaws],
                base_ai: BaseAi::Melee,
                wanders: true,
                wild: None,
            }
        }
        // Ghost (#169): a first guess (label `balancing`). It floats through walls; Vanish and the ambush (`run/ambush.rs`) are its tactics.
        Ghost => {
            let attr_mods = Attributes::new(-4, 4, 0, 0, 2, 4);
            EnemyDef {
                kind: EntityKind::Ghost,
                hp: 32.0,
                speed: 50.0,
                radius: 6.0,
                vision: 8.75,
                attr_mods,
                weight: 3.0,
                abilities: &[Touch, Vanish],
                weapons: &[GhostTouch],
                base_ai: BaseAi::Melee,
                wanders: true,
                wild: None,
            }
        }
        // Shade (#170): a first guess (label `balancing`), the Ghost's twin: a little sturdier and slower, it drains CON.
        Shade => {
            let attr_mods = Attributes::new(-2, 2, 2, 0, 4, 5);
            EnemyDef {
                kind: EntityKind::Shade,
                hp: 40.0,
                speed: 44.0,
                radius: 6.0,
                vision: 8.75,
                attr_mods,
                weight: 3.0,
                abilities: &[Touch, Vanish],
                weapons: &[ShadeTouch],
                base_ai: BaseAi::Melee,
                wanders: true,
                wild: None,
            }
        }
        // Knight (#149): a first guess (label `balancing`); its speed keeps up with the heroes (66-72).
        Knight => {
            let attr_mods = Attributes::new(4, 2, 4, -2, 0, 2);
            EnemyDef {
                kind: EntityKind::Knight,
                hp: 60.0,
                speed: 68.0,
                radius: 5.0,
                vision: 8.0,
                attr_mods,
                weight: 12.0,
                abilities: &[Strike],
                weapons: &[SoldierSword],
                base_ai: BaseAi::Melee,
                wanders: true,
                wild: None,
            }
        }
        // Wildlife (#227): first guesses (label `balancing`). A bunny is a bunny: it dies to almost any hit.
        Bunny => {
            let attr_mods = Attributes::new(-6, 6, -4, -8, -2, -4);
            EnemyDef {
                kind: EntityKind::Bunny,
                hp: 5.0,
                speed: 80.0,
                radius: 4.0,
                vision: 6.0,
                attr_mods,
                weight: 2.0,
                abilities: &[],
                weapons: &[],
                base_ai: BaseAi::Melee,
                wanders: true,
                wild: Some(Reaction::Flee),
            }
        }
        // The deer lets the player see fleeing (the user, 2026-11-06); the stag is its twin with antlers.
        Deer | Stag => {
            let attr_mods = Attributes::new(-2, 6, 2, -8, 0, -2);
            EnemyDef {
                kind: if t == Stag { EntityKind::Stag } else { EntityKind::Deer },
                hp: 40.0,
                speed: 90.0,
                radius: 6.0,
                vision: 8.0,
                attr_mods,
                weight: 12.0,
                abilities: &[],
                weapons: &[],
                base_ai: BaseAi::Melee,
                wanders: true,
                wild: Some(Reaction::Flee),
            }
        }
        Boar => {
            let attr_mods = Attributes::new(4, 0, 4, -8, -2, -4);
            EnemyDef {
                kind: EntityKind::Boar,
                hp: 40.0,
                speed: 64.0,
                radius: 6.0,
                vision: 6.0,
                attr_mods,
                weight: 14.0,
                abilities: &[Strike],
                weapons: &[BoarTusks],
                base_ai: BaseAi::Melee,
                wanders: true,
                wild: Some(Reaction::FightBack),
            }
        }
        Ogre => {
            let attr_mods = Attributes::new(9, -2, 6, -5, -3, -3);
            EnemyDef {
                kind: EntityKind::Ogre,
                hp: 260.0,
                speed: 40.0,
                // Wide: paths with clearance (see `ai::path_toward`); fits 3-tile corridors.
                radius: 10.0,
                vision: 9.375,
                attr_mods,
                weight: 20.0,
                abilities: &[Strike, GroundSlam],
                weapons: &[OgreClub],
                base_ai: BaseAi::Melee,
                wanders: true,
                wild: None,
            }
        }
    }
}

/// The demon's dungeon has demons instead of skeletons: imps for archers,
/// chorts for warriors and summoners for necromancers. Swapped when the run
/// starts, so the generator (and every seed's map) stays the same.
pub fn for_boss(t: EnemyType, boss: BossId) -> EnemyType {
    use EnemyType::*;
    match (boss, t) {
        (BossId::Demon, SkeletonArcher) => Imp,
        (BossId::Demon, SkeletonWarrior) => Chort,
        (BossId::Demon, Necromancer) => Summoner,
        _ => t,
    }
}

/// The extra enemy that haunts a dungeon of this boss (rare, on top of the usual ones; see
/// `Dungeon::haunts`): the lich has ghosts, the demon shades; the dragon has none.
pub fn haunt_for(boss: BossId) -> Option<EnemyType> {
    match boss {
        BossId::Lich => Some(EnemyType::Ghost),
        BossId::Demon => Some(EnemyType::Shade),
        BossId::Dragon => None,
    }
}

/// Demon types walk through lava unharmed (the demon boss too, see `levels::boss::spawn`).
pub fn is_demon(t: EnemyType) -> bool {
    matches!(t, EnemyType::Imp | EnemyType::Chort | EnemyType::Summoner | EnemyType::SummonedImp)
}

/// A fleeing wild animal calms down, after `WILD_MIN_FLEE`, once the one it runs from is this far away (px, centre distance) or 48 px farther than at the hit, whichever is more; or out of sight (#227).
pub const WILD_CALM_DIST: f64 = 96.0;

/// A fleeing wild animal runs at least this long (s) after every hit, whoever hit it from wherever (#227, first guess).
pub const WILD_MIN_FLEE: f64 = 1.5;

/// A second (alt) ranged attack is only used from at least this far away
/// (center distance, px): chorts throw fire bolts at heroes out of reach.
pub const ALT_BOLT_MIN_DIST: f64 = 40.0;

/// Mimic gait: one hop per cycle; it moves only between these fractions of
/// the cycle (crouch before, landing and rest after). The client draws the
/// same phases from the Move animation clock.
pub const MIMIC_HOP_CYCLE: f64 = 0.6;
pub const MIMIC_HOP_AIR: (f64, f64) = (0.2, 0.7);
/// After the reveal the mimic does nothing for this long (the lid flies open).
pub const MIMIC_WAKE_T: f64 = 0.6;
/// A player this close (center distance, px) opens a chest or wakes a mimic.
pub const CHEST_TOUCH: f64 = 12.0;

/// HP at CON 10: `hp` minus `CON_HP` per point of the kind's own CON modifier.
pub fn base_hp(t: EnemyType) -> f64 {
    let d = def(t);
    d.hp - super::attributes::CON_HP * d.attr_mods.get(Attr::Con) as f64
}

/// The enemy's Attributes: 10, its races' bonuses, its kind's modifier.
pub fn attrs(t: EnemyType) -> Attributes {
    races::creature_attrs(races(t), def(t).attr_mods)
}

/// The races of each enemy (see `races`).
pub fn races(t: EnemyType) -> &'static [Race] {
    use EnemyType::*;
    match t {
        Necromancer | Summoner | Disciple | Knight => &[Race::Human],
        SkeletonWarrior | SkeletonArcher | RaisedSkeleton | RaisedArcher => &[Race::Undead],
        GoblinArcher => &[Race::Goblin],
        OrcWarrior | OrcArcher => &[Race::Orc],
        Ogre => &[Race::Ogre],
        Bunny | Deer | Stag | Boar => &[Race::Animal],
        Mimic => &[Race::Mimic],
        Imp | Chort | SummonedImp => &[Race::Demon],
        Ghost | Shade => &[Race::Undead, Race::Incorporeal],
    }
}

pub fn profile(t: EnemyType) -> Profile {
    races::profile(races(t), Adjust { vision: Some(def(t).vision), ..Adjust::NONE })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::attributes::{self, Attr, Attributes};
    use crate::defs::items::{self, ItemBase};

    #[test]
    fn enemy_stat_blocks_match_the_spec() {
        use EnemyType::*;
        assert_eq!(attrs(Ogre), Attributes::new(19, 8, 16, 5, 7, 7));
        assert_eq!(def(Ogre).weight, 20.0);
        assert_eq!(attrs(Imp), Attributes::new(6, 17, 13, 11, 12, 14));
        assert_eq!(def(Imp).weight, 4.0);
        assert_eq!(attrs(RaisedSkeleton).get(Attr::Con), 12);
        assert_eq!(attrs(RaisedSkeleton).get(Attr::Str), attrs(SkeletonWarrior).get(Attr::Str));
        assert_eq!(attrs(RaisedArcher).get(Attr::Con), 12);
        assert_eq!(attrs(RaisedArcher).get(Attr::Dex), 15);
        assert_eq!(attrs(SummonedImp).get(Attr::Con), 10);
        assert_eq!(attrs(SummonedImp).get(Attr::Dex), 17);
        assert_eq!(def(Disciple).weight, 10.0);
        assert_eq!(attrs(GoblinArcher), Attributes::new(8, 15, 10, 10, 8, 8));
        assert_eq!(attrs(SkeletonWarrior), Attributes::new(12, 12, 15, 1, 8, 5));
        assert_eq!(attrs(SkeletonArcher), Attributes::new(10, 15, 13, 1, 8, 5));
        assert_eq!(attrs(RaisedSkeleton).get(Attr::Int), 1);
        assert_eq!(attrs(RaisedArcher).get(Attr::Int), 1);
        assert_eq!((attrs(Ghost).get(Attr::Int), attrs(Shade).get(Attr::Int)), (10, 10), "INT −9 is the skeletons' kind, not Undead");
        assert_eq!(attrs(OrcWarrior), Attributes::new(16, 12, 16, 7, 11, 10));
        assert_eq!(attrs(OrcArcher), Attributes::new(14, 14, 14, 7, 11, 10));
        assert_eq!(attrs(Necromancer), Attributes::new(9, 14, 12, 17, 12, 11));
        assert_eq!(attrs(Summoner), Attributes::new(9, 14, 12, 15, 12, 16));
        assert_eq!(attrs(Disciple), Attributes::new(10, 12, 10, 13, 11, 10));
        assert_eq!(attrs(Mimic), Attributes::new(17, 12, 15, 5, 13, 8));
        assert_eq!(attrs(Chort), Attributes::new(14, 13, 13, 8, 10, 9));
        assert_eq!(attrs(Ghost), Attributes::new(6, 14, 10, 10, 12, 14));
        assert_eq!(attrs(Shade), Attributes::new(8, 12, 12, 10, 14, 15));
        let shade = def(Shade);
        assert_eq!((shade.hp, shade.speed, shade.radius, shade.vision, shade.base_ai), (40.0, 44.0, 6.0, 8.75, BaseAi::Melee));
        assert_eq!((shade.abilities, shade.weapons), (&[AbilityId::Touch, AbilityId::Vanish][..], &[ItemId::ShadeTouch][..]));
        let ghost = def(Ghost);
        assert_eq!((ghost.hp, ghost.speed, ghost.radius, ghost.vision, ghost.base_ai), (32.0, 50.0, 6.0, 8.75, BaseAi::Melee));
        assert_eq!((ghost.abilities, ghost.weapons), (&[AbilityId::Touch, AbilityId::Vanish][..], &[ItemId::GhostTouch][..]));
        let weights = [
            (GoblinArcher, 6.0), (SkeletonWarrior, 9.0), (SkeletonArcher, 9.0), (RaisedSkeleton, 9.0), (RaisedArcher, 9.0),
            (OrcWarrior, 13.0), (OrcArcher, 13.0), (Necromancer, 10.0), (Summoner, 10.0), (Disciple, 10.0),
            (Mimic, 14.0), (Imp, 4.0), (SummonedImp, 4.0), (Chort, 10.0), (Ogre, 20.0), (Ghost, 3.0), (Shade, 3.0),
            (Knight, 12.0), (Bunny, 2.0), (Deer, 12.0), (Stag, 12.0), (Boar, 14.0),
        ];
        assert_eq!(weights.len(), EnemyType::ALL.len());
        for (t, w) in weights {
            assert_eq!(def(t).weight, w, "{t:?}");
        }
    }

    /// The animals that never fight (bunny, deer, stag): no abilities and no weapons, so the kit rules skip them.
    fn is_unarmed_animal(t: EnemyType) -> bool {
        matches!(t, EnemyType::Bunny | EnemyType::Deer | EnemyType::Stag)
    }

    #[test]
    fn kit_for_keeps_the_defs_ability_order() {
        // The AI reads kit entry 0 as the main ability and entry 1 as the alt one.
        for t in EnemyType::ALL {
            let d = def(t);
            let kit = crate::sheet::kit_for(crate::sheet::KitSource::Enemy(t), &attrs(t), &[]);
            let ids: Vec<_> = kit.iter().map(|a| a.id).collect();
            assert_eq!(ids, d.abilities, "{t:?}");
        }
    }

    #[test]
    fn every_enemy_has_its_base_ai() {
        for t in EnemyType::ALL {
            let want = match t {
                EnemyType::Disciple => BaseAi::Stationary,
                EnemyType::GoblinArcher | EnemyType::Imp | EnemyType::SummonedImp => BaseAi::Ranged { preferred: 90.0 },
                EnemyType::SkeletonArcher | EnemyType::RaisedArcher | EnemyType::OrcArcher => BaseAi::Ranged { preferred: 100.0 },
                EnemyType::Necromancer | EnemyType::Summoner => BaseAi::Ranged { preferred: 110.0 },
                _ => BaseAi::Melee,
            };
            assert_eq!(def(t).base_ai, want, "{t:?}");
            assert_eq!(def(t).wanders, !matches!(t, EnemyType::Disciple | EnemyType::Mimic), "{t:?}");
        }
    }

    /// Every ability of every enemy resolves with its weapons, and the first weapon is a melee one.
    #[test]
    fn every_enemy_kit_resolves() {
        for t in EnemyType::ALL {
            let d = def(t);
            let kit = crate::sheet::kit_for(crate::sheet::KitSource::Enemy(t), &crate::defs::enemies::attrs(t), &[]);
            for &id in d.abilities {
                assert!(kit.get(id).is_some(), "{t:?} {id:?}");
            }
            if is_unarmed_animal(t) {
                continue;
            }
            assert!(matches!(items::def(d.weapons[0]).base, ItemBase::Melee(..)), "{t:?}: its first weapon is a melee one");
        }
    }

    /// A bow goes with Shoot; every enemy has a melee ability.
    #[test]
    fn enemy_abilities_fit_their_weapons() {
        for t in EnemyType::ALL {
            let d = def(t);
            if is_unarmed_animal(t) {
                assert!(d.abilities.is_empty() && d.weapons.is_empty(), "{t:?}");
                continue;
            }
            let ranged = d.weapons.iter().any(|&w| matches!(items::def(w).base, ItemBase::Ranged(..)));
            assert_eq!(ranged, d.abilities.contains(&AbilityId::Shoot), "{t:?}: a bow goes with Shoot");
            assert!(d.abilities.iter().any(|a| matches!(a, AbilityId::Strike | AbilityId::Bite | AbilityId::Touch)), "{t:?} has no melee ability");
            assert!(d.abilities.len() <= 3 && !d.abilities.is_empty(), "{t:?}");
            // A third ability is a minion summon, cast by its own wind-up (`run/ai.rs`), not the chase.
            if let Some(&third) = d.abilities.get(2) {
                assert!(crate::defs::abilities::def(third).own.minions.is_some(), "{t:?}: the third {third:?} is not a minion summon");
            }
            // The AI (`run/ai.rs`) uses an alt ability only if it swings, shoots or slams.
            if let Some(&alt) = d.abilities.get(1) {
                // Vanish (a buff) is the ambush module's, not the chase's.
                assert!(matches!(crate::defs::abilities::def(alt).shape, crate::defs::abilities::Shape::Swing | crate::defs::abilities::Shape::Projectile | crate::defs::abilities::Shape::Ring) || alt == AbilityId::Vanish, "{t:?}: the alt {alt:?} has a shape the AI does not handle");
            }
        }
    }

    #[test]
    fn enemy_weapons_fit_their_proficiencies() {
        use super::super::weapons::WeaponKind as K;
        use EnemyType::*;
        // Spec §7. The skeleton archer's weapon is a Longbow, which the spec's "Bow" stands for.
        let table: [(EnemyType, &[K]); 11] = [
            (GoblinArcher, &[K::Bow, K::Dagger]),
            (SkeletonWarrior, &[K::Sword]),
            (RaisedSkeleton, &[K::Sword]),
            (SkeletonArcher, &[K::Bow, K::Longbow, K::Sword]),
            (RaisedArcher, &[K::Bow, K::Longbow, K::Sword]),
            (OrcWarrior, &[K::Axe, K::Club]),
            (OrcArcher, &[K::Bow, K::Axe]),
            (Ogre, &[K::Club, K::Hammer]),
            (Necromancer, &[K::Staff]),
            (Summoner, &[K::Staff]),
            (Knight, &[K::Sword]),
        ];
        let natural = [K::Unarmed, K::Bite, K::Claws, K::Tail, K::Touch];
        for t in EnemyType::ALL {
            let allowed: &[K] = table.iter().find(|(e, _)| *e == t).map_or(&[], |(_, k)| k);
            let d = def(t);
            for &id in d.weapons {
                let kind = match items::def(id).base {
                    ItemBase::Melee(k, _) | ItemBase::Ranged(k, _) => k,
                    _ => panic!("{t:?}: {id:?} is not a weapon"),
                };
                assert!(allowed.contains(&kind) || natural.contains(&kind), "{t:?} wields {kind:?}");
            }
        }
    }

    #[test]
    fn enemy_base_hp_keeps_todays_hp() {
        for t in EnemyType::ALL {
            let con = attributes::BASELINE + def(t).attr_mods.get(Attr::Con);
            assert_eq!(base_hp(t) + 5.0 * (con - 10) as f64, def(t).hp, "{t:?}");
            assert_eq!(attributes::hp(base_hp(t), con), def(t).hp, "{t:?}");
        }
    }

    #[test]
    fn knight_stat_block() {
        use EnemyType::Knight;
        let k = def(Knight);
        assert_eq!(attrs(Knight), Attributes::new(14, 12, 14, 8, 10, 12));
        assert_eq!((k.hp, k.speed, k.radius, k.vision, k.base_ai), (60.0, 68.0, 5.0, 8.0, BaseAi::Melee));
        assert_eq!((k.abilities, k.weapons), (&[AbilityId::Strike][..], &[ItemId::SoldierSword][..]));
        assert_eq!(races(Knight), &[Race::Human]);
        assert_eq!(crate::defs::progression::xp_for_kill(Some(Knight)), 0);
    }

    /// The wildlife of #227: first guesses (label `balancing`).
    #[test]
    fn wildlife_stat_blocks() {
        use EnemyType::*;
        let bunny = def(Bunny);
        assert_eq!(attrs(Bunny), Attributes::new(4, 16, 6, 2, 8, 6));
        assert_eq!((bunny.hp, bunny.speed, bunny.radius, bunny.vision, bunny.wild), (5.0, 80.0, 4.0, 6.0, Some(Reaction::Flee)));
        for t in [Deer, Stag] {
            let d = def(t);
            assert_eq!(attrs(t), Attributes::new(8, 16, 12, 2, 10, 8), "{t:?}");
            assert_eq!((d.hp, d.speed, d.radius, d.vision, d.wild), (40.0, 90.0, 6.0, 8.0, Some(Reaction::Flee)), "{t:?}");
        }
        assert_eq!((def(Deer).kind, def(Stag).kind), (EntityKind::Deer, EntityKind::Stag));
        let boar = def(Boar);
        assert_eq!(attrs(Boar), Attributes::new(14, 10, 14, 2, 8, 6));
        assert_eq!((boar.hp, boar.speed, boar.radius, boar.vision, boar.wild), (40.0, 64.0, 6.0, 6.0, Some(Reaction::FightBack)));
        assert_eq!((boar.abilities, boar.weapons), (&[AbilityId::Strike][..], &[ItemId::BoarTusks][..]));
        for t in EnemyType::ALL {
            assert_eq!(def(t).wild.is_some(), matches!(t, Bunny | Deer | Stag | Boar), "{t:?}");
        }
        use crate::defs::progression::{coins_for_kill, xp_for_kill};
        assert_eq!([Bunny, Deer, Stag, Boar].map(|t| (xp_for_kill(Some(t)), coins_for_kill(Some(t)))), [(0, 0), (0, 0), (0, 0), (3, 0)]);
    }

    #[test]
    fn only_the_dragon_has_no_haunt() {
        assert_eq!(haunt_for(BossId::Lich), Some(EnemyType::Ghost));
        assert_eq!(haunt_for(BossId::Demon), Some(EnemyType::Shade));
        assert_eq!(haunt_for(BossId::Dragon), None);
    }

    #[test]
    fn enemy_races() {
        use EnemyType::*;
        let expect: [(EnemyType, &[Race]); 22] = [
            (GoblinArcher, &[Race::Goblin]),
            (SkeletonWarrior, &[Race::Undead]),
            (SkeletonArcher, &[Race::Undead]),
            (RaisedSkeleton, &[Race::Undead]),
            (RaisedArcher, &[Race::Undead]),
            (OrcWarrior, &[Race::Orc]),
            (OrcArcher, &[Race::Orc]),
            (Necromancer, &[Race::Human]),
            (Summoner, &[Race::Human]),
            (Disciple, &[Race::Human]),
            (Mimic, &[Race::Mimic]),
            (Imp, &[Race::Demon]),
            (SummonedImp, &[Race::Demon]),
            (Chort, &[Race::Demon]),
            (Ogre, &[Race::Ogre]),
            (Ghost, &[Race::Undead, Race::Incorporeal]),
            (Shade, &[Race::Undead, Race::Incorporeal]),
            (Knight, &[Race::Human]),
            (Bunny, &[Race::Animal]),
            (Deer, &[Race::Animal]),
            (Stag, &[Race::Animal]),
            (Boar, &[Race::Animal]),
        ];
        assert_eq!(expect.len(), EnemyType::ALL.len());
        for (t, r) in expect {
            assert_eq!(races(t), r, "{t:?}");
        }
    }
}

#[cfg(test)]
mod kit_pins {
    use super::*;

    /// The numbers an ability resolves to for one enemy.
    struct Pin {
        damage: f64,
        cooldown: f64,
        range: f64,
        speed: f64,
        radius: f64,
        windup: f64,
        push: f64,
    }

    /// Each enemy's kit as the resolver gives it today, recorded with the move to shared abilities (#177):
    /// Strike and Bite reach is the weapon's reach plus the body (the old range plus 4), shots fly their
    /// range, the bolts' numbers are Fire Bolt's and Shadow Bolt's at the user's Attribute.
    #[test]
    fn enemy_kits_are_pinned() {
        use AbilityId::*;
        use EnemyType::*;
        let pins = [
            (GoblinArcher, Shoot, Pin { damage: 6.0, cooldown: 0.9333333333333333, range: 140.0, speed: 170.0, radius: 3.0, windup: 0.3, push: 0.0 }),
            (GoblinArcher, Strike, Pin { damage: 2.7, cooldown: 0.6666666666666666, range: 20.0, speed: 0.0, radius: 0.0, windup: 0.25, push: 0.0 }),
            (SkeletonWarrior, Strike, Pin { damage: 9.0, cooldown: 0.8333333333333334, range: 23.0, speed: 0.0, radius: 0.0, windup: 0.3, push: 0.0 }),
            (SkeletonArcher, Shoot, Pin { damage: 7.0, cooldown: 1.0666666666666667, range: 150.0, speed: 180.0, radius: 3.0, windup: 0.35, push: 0.0 }),
            (SkeletonArcher, Strike, Pin { damage: 3.0, cooldown: 0.6666666666666666, range: 21.0, speed: 0.0, radius: 0.0, windup: 0.25, push: 0.0 }),
            (OrcWarrior, Strike, Pin { damage: 14.0, cooldown: 1.0, range: 26.0, speed: 0.0, radius: 0.0, windup: 0.35, push: 20.0 }),
            (OrcArcher, Shoot, Pin { damage: 10.0, cooldown: 1.2142857142857142, range: 150.0, speed: 190.0, radius: 3.0, windup: 0.35, push: 0.0 }),
            (OrcArcher, Strike, Pin { damage: 3.5999999999999996, cooldown: 0.7142857142857143, range: 22.0, speed: 0.0, radius: 0.0, windup: 0.25, push: 0.0 }),
            (Necromancer, ShadowBolt, Pin { damage: 12.0, cooldown: 1.1764705882352942, range: 180.0, speed: 130.0, radius: 3.0, windup: 0.5, push: 0.0 }),
            (Necromancer, Strike, Pin { damage: 5.0, cooldown: 0.8571428571428571, range: 21.0, speed: 0.0, radius: 0.0, windup: 0.25, push: 0.0 }),
            (Necromancer, RaiseDead, Pin { damage: 0.0, cooldown: 7.0588235294117645, range: 0.0, speed: 0.0, radius: 0.0, windup: 0.7, push: 0.0 }),
            (RaisedSkeleton, Strike, Pin { damage: 9.0, cooldown: 0.8333333333333334, range: 23.0, speed: 0.0, radius: 0.0, windup: 0.3, push: 0.0 }),
            (RaisedArcher, Shoot, Pin { damage: 7.0, cooldown: 1.0666666666666667, range: 150.0, speed: 180.0, radius: 3.0, windup: 0.35, push: 0.0 }),
            (RaisedArcher, Strike, Pin { damage: 3.0, cooldown: 0.6666666666666666, range: 21.0, speed: 0.0, radius: 0.0, windup: 0.25, push: 0.0 }),
            (Disciple, ShadowBolt, Pin { damage: 10.222222222222221, cooldown: 1.5384615384615385, range: 180.0, speed: 130.0, radius: 3.0, windup: 0.5, push: 0.0 }),
            (Disciple, Strike, Pin { damage: 3.0, cooldown: 0.8333333333333334, range: 21.0, speed: 0.0, radius: 0.0, windup: 0.25, push: 0.0 }),
            (Mimic, Bite, Pin { damage: 13.0, cooldown: 0.8333333333333334, range: 22.0, speed: 0.0, radius: 0.0, windup: 0.25, push: 0.0 }),
            (Imp, FireBolt, Pin { damage: 7.0, cooldown: 1.4285714285714286, range: 150.0, speed: 130.0, radius: 3.0, windup: 0.35, push: 0.0 }),
            (Imp, Strike, Pin { damage: 6.0, cooldown: 0.5294117647058824, range: 21.0, speed: 0.0, radius: 0.0, windup: 0.25, push: 0.0 }),
            (Chort, Strike, Pin { damage: 9.0, cooldown: 0.7692307692307693, range: 23.0, speed: 0.0, radius: 0.0, windup: 0.3, push: 14.0 }),
            (Chort, FireBolt, Pin { damage: 5.541666666666666, cooldown: 2.2222222222222223, range: 150.0, speed: 130.0, radius: 3.0, windup: 0.35, push: 0.0 }),
            (Summoner, FireBolt, Pin { damage: 7.583333333333334, cooldown: 1.25, range: 150.0, speed: 130.0, radius: 3.0, windup: 0.35, push: 0.0 }),
            (Summoner, Strike, Pin { damage: 5.0, cooldown: 0.8571428571428571, range: 21.0, speed: 0.0, radius: 0.0, windup: 0.25, push: 0.0 }),
            (Summoner, SummonImps, Pin { damage: 0.0, cooldown: 8.0, range: 0.0, speed: 0.0, radius: 0.0, windup: 0.7, push: 0.0 }),
            (SummonedImp, FireBolt, Pin { damage: 7.0, cooldown: 1.4285714285714286, range: 150.0, speed: 130.0, radius: 3.0, windup: 0.35, push: 0.0 }),
            (SummonedImp, Strike, Pin { damage: 6.0, cooldown: 0.5294117647058824, range: 21.0, speed: 0.0, radius: 0.0, windup: 0.25, push: 0.0 }),
            (Ghost, Touch, Pin { damage: 7.2, cooldown: 0.7142857142857143, range: 22.0, speed: 0.0, radius: 0.0, windup: 0.25, push: 0.0 }),
            (Ghost, Vanish, Pin { damage: 0.0, cooldown: 14.285714285714286, range: 0.0, speed: 0.0, radius: 0.0, windup: 0.0, push: 0.0 }),
            (Shade, Touch, Pin { damage: 8.75, cooldown: 0.8333333333333334, range: 22.0, speed: 0.0, radius: 0.0, windup: 0.25, push: 0.0 }),
            (Shade, Vanish, Pin { damage: 0.0, cooldown: 13.333333333333334, range: 0.0, speed: 0.0, radius: 0.0, windup: 0.0, push: 0.0 }),
            (Ogre, Strike, Pin { damage: 18.0, cooldown: 2.0, range: 32.0, speed: 0.0, radius: 0.0, windup: 0.5, push: 28.0 }),
            (Ogre, GroundSlam, Pin { damage: 21.599999999999998, cooldown: 7.5, range: 32.0, speed: 0.0, radius: 34.0, windup: 1.0, push: 28.0 }),
            (Knight, Strike, Pin { damage: 13.09090909090909, cooldown: 0.8333333333333334, range: 23.0, speed: 0.0, radius: 0.0, windup: 0.3, push: 0.0 }),
            (Boar, Strike, Pin { damage: 8.0, cooldown: 1.0, range: 24.0, speed: 0.0, radius: 0.0, windup: 0.3, push: 0.0 }),
        ];
        let near = |a: f64, b: f64| (a - b).abs() < 1e-9;
        for t in EnemyType::ALL {
            let kit = crate::sheet::kit_for(crate::sheet::KitSource::Enemy(t), &crate::defs::enemies::attrs(t), &[]);
            for &id in def(t).abilities {
                let (_, _, p) = pins.iter().find(|(pt, pid, _)| *pt == t && *pid == id).unwrap_or_else(|| panic!("{t:?} {id:?} is not pinned"));
                let a = kit.get(id).unwrap();
                let got = [a.damage, a.cooldown, a.range, a.speed, a.radius, a.windup, a.push];
                let want = [p.damage, p.cooldown, p.range, p.speed, p.radius, p.windup, p.push];
                assert!(got.iter().zip(want).all(|(&g, w)| near(g, w)), "{t:?} {id:?}: {got:?} against {want:?}");
            }
        }
        assert_eq!(pins.len(), EnemyType::ALL.iter().map(|&t| def(t).abilities.len()).sum::<usize>(), "no stale pin");
    }
}
