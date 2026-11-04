use super::abilities::AbilityId;
use super::attributes::{Attr, Attributes};
use super::races::{self, Adjust, Race, Profile};
use super::items::{self, ItemBase, ItemId};
use super::kinds::EntityKind;
use super::damage::DamageSplit;
use crate::protocol::BossId;

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
}

impl EnemyType {
    #[cfg(test)]
    pub const ALL: [EnemyType; 17] = [
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
    ];
}

#[derive(Debug, Clone, Copy)]
pub struct EnemyDef {
    pub kind: EntityKind,
    pub hp: f64,
    pub speed: f64,
    pub radius: f64,
    /// The stat block's Attributes (CON included: `hp` is the total, see `base_hp`).
    pub attrs: Attributes,
    /// Weight for pushes (see the spec's section 4).
    pub weight: f64,
    /// Vision (tiles); overrides the race's. Enemies only notice players inside it with line of sight.
    pub vision: f64,
    /// The abilities it uses: the main one first, then the alt (own cooldown). The alt is used when
    /// the target is in reach for a melee one, from afar for a bolt (imps claw, chorts throw fire bolts).
    pub abilities: &'static [AbilityId],
    /// What the abilities use: the melee weapon (else the race's natural one), then the bow.
    pub weapons: &'static [ItemId],
    /// The distance (px) a shooter keeps from its target; 0 for those who close in.
    pub preferred: f64,
}

/// The weapon an enemy strikes with: its melee weapon, else its race's first natural weapon.
pub fn melee_item(t: EnemyType) -> ItemId {
    def(t).weapons[0]
}

/// The race's first natural weapon (what an enemy without a melee weapon punches with).
#[cfg(test)]
fn natural_melee(t: EnemyType) -> ItemId {
    races::race_def(races(t)[0]).natural[0]
}

pub fn def(t: EnemyType) -> EnemyDef {
    use AbilityId::{Bite, FireBolt, GroundSlam, RaiseDead, ShadowBolt, Shoot, Strike, SummonImps, Touch, Vanish};
    use EnemyType::*;
    use ItemId::*;
    match t {
        GoblinArcher => {
            let attrs = Attributes::new(8, 15, 10, 10, 8, 8);
            EnemyDef {
                kind: EntityKind::GoblinArcher,
                hp: 24.0,
                speed: 58.0,
                radius: 4.0,
                vision: 8.125,
                attrs,
                weight: 6.0,
                abilities: &[Shoot, Strike],
                weapons: &[UnarmedStrike, GoblinShortbow],
                preferred: 90.0,
            }
        }
        SkeletonWarrior | RaisedSkeleton => {
            let attrs = Attributes::new(12, 12, if t == RaisedSkeleton { 12 } else { 15 }, 6, 8, 5);
            EnemyDef {
                kind: if t == RaisedSkeleton { EntityKind::RaisedSkeleton } else { EntityKind::SkeletonWarrior },
                hp: if t == RaisedSkeleton { 26.0 } else { 40.0 },
                speed: 46.0,
                radius: 5.0,
                vision: 7.5,
                attrs,
                weight: 9.0,
                abilities: &[Strike],
                weapons: &[SkeletonSword],
                preferred: 0.0,
            }
        }
        SkeletonArcher | RaisedArcher => {
            let attrs = Attributes::new(10, 15, if t == RaisedArcher { 12 } else { 13 }, 6, 8, 5);
            EnemyDef {
                kind: EntityKind::SkeletonArcher,
                hp: if t == RaisedArcher { 20.0 } else { 30.0 },
                speed: 44.0,
                radius: 5.0,
                vision: 8.75,
                attrs,
                weight: 9.0,
                abilities: &[Shoot, Strike],
                weapons: &[UnarmedStrike, SkeletonBow],
                preferred: 100.0,
            }
        }
        OrcWarrior => {
            let attrs = Attributes::new(16, 12, 16, 7, 11, 10);
            EnemyDef {
                kind: EntityKind::OrcWarrior,
                hp: 70.0,
                speed: 52.0,
                radius: 6.0,
                vision: 7.8125,
                attrs,
                weight: 13.0,
                abilities: &[Strike],
                weapons: &[OrcCleaver],
                preferred: 0.0,
            }
        }
        OrcArcher => {
            let attrs = Attributes::new(14, 14, 14, 7, 11, 10);
            EnemyDef {
                kind: EntityKind::OrcArcher,
                hp: 50.0,
                speed: 48.0,
                radius: 6.0,
                vision: 8.75,
                attrs,
                weight: 13.0,
                abilities: &[Shoot, Strike],
                weapons: &[UnarmedStrike, OrcWarbow],
                preferred: 100.0,
            }
        }
        Necromancer | Summoner => {
            let attrs = if t == Summoner { Attributes::new(9, 14, 12, 15, 12, 16) } else { Attributes::new(9, 14, 12, 17, 12, 11) };
            EnemyDef {
                kind: if t == Summoner { EntityKind::Summoner } else { EntityKind::Necromancer },
                hp: 60.0,
                speed: 40.0,
                radius: 5.0,
                vision: 9.375,
                attrs,
                weight: 10.0,
                abilities: if t == Summoner { &[FireBolt, Strike, SummonImps] } else { &[ShadowBolt, Strike, RaiseDead] },
                weapons: if t == Summoner { &[SummonerRod] } else { &[NecromancerRod] },
                preferred: 110.0,
            }
        }
        Disciple => {
            let attrs = Attributes::new(10, 12, 10, 13, 11, 10);
            EnemyDef {
                kind: EntityKind::Disciple,
                hp: 45.0,
                speed: 0.0,
                radius: 5.0,
                vision: 12.5,
                attrs,
                weight: 10.0,
                abilities: &[ShadowBolt, Strike],
                weapons: &[UnarmedStrike],
                preferred: 0.0,
            }
        }
        Mimic => {
            let attrs = Attributes::new(17, 12, 15, 5, 13, 8);
            EnemyDef {
                kind: EntityKind::Mimic,
                hp: 90.0,
                // Average speed: it only moves while airborne (see MIMIC_HOP_*).
                speed: 50.0,
                radius: 6.0,
                vision: 8.75,
                attrs,
                weight: 14.0,
                abilities: &[Bite],
                weapons: &[MimicBite],
                preferred: 0.0,
            }
        }
        Imp | SummonedImp => {
            let attrs = Attributes::new(6, 17, if t == SummonedImp { 10 } else { 13 }, 11, 12, 14);
            EnemyDef {
                kind: EntityKind::Imp,
                hp: if t == SummonedImp { 20.0 } else { 30.0 },
                speed: 44.0,
                radius: 5.0,
                vision: 8.75,
                attrs,
                weight: 4.0,
                abilities: &[FireBolt, Strike],
                weapons: &[ImpClaws],
                preferred: 90.0,
            }
        }
        Chort => {
            let attrs = Attributes::new(14, 13, 13, 8, 10, 9);
            EnemyDef {
                kind: EntityKind::Chort,
                hp: 40.0,
                speed: 46.0,
                radius: 5.0,
                vision: 7.5,
                attrs,
                weight: 10.0,
                abilities: &[Strike, FireBolt],
                weapons: &[ChortClaws],
                preferred: 0.0,
            }
        }
        // Ghost (#169): a first guess (label `balancing`). It floats through walls; Vanish and the ambush (`run/ambush.rs`) are its tactics.
        Ghost => {
            let attrs = Attributes::new(6, 14, 10, 10, 12, 14);
            EnemyDef {
                kind: EntityKind::Ghost,
                hp: 32.0,
                speed: 50.0,
                radius: 6.0,
                vision: 8.75,
                attrs,
                weight: 3.0,
                abilities: &[Touch, Vanish],
                weapons: &[GhostTouch],
                preferred: 0.0,
            }
        }
        // Shade (#170): a first guess (label `balancing`), the Ghost's twin: a little sturdier and slower, it drains CON.
        Shade => {
            let attrs = Attributes::new(8, 12, 12, 10, 14, 15);
            EnemyDef {
                kind: EntityKind::Shade,
                hp: 40.0,
                speed: 44.0,
                radius: 6.0,
                vision: 8.75,
                attrs,
                weight: 3.0,
                abilities: &[Touch, Vanish],
                weapons: &[ShadeTouch],
                preferred: 0.0,
            }
        }
        Ogre => {
            let attrs = Attributes::new(19, 8, 16, 5, 7, 7);
            EnemyDef {
                kind: EntityKind::Ogre,
                hp: 260.0,
                speed: 40.0,
                // Wide: paths with clearance (see `ai::path_toward`); fits 3-tile corridors.
                radius: 10.0,
                vision: 9.375,
                attrs,
                weight: 20.0,
                abilities: &[Strike, GroundSlam],
                weapons: &[OgreClub],
                preferred: 0.0,
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

/// HP before the CON bonus: today's HP minus 5 per CON point above 10, so the total stays.
pub fn base_hp(t: EnemyType) -> f64 {
    let d = def(t);
    d.hp - 5.0 * (d.attrs.get(Attr::Con) - 10) as f64
}

/// The split of an enemy's melee hits: its melee weapon's.
pub fn melee_split(t: EnemyType) -> DamageSplit {
    match items::def(melee_item(t)).base {
        ItemBase::Melee(_, s) => s.split,
        b => panic!("{t:?}: {b:?} is not a melee weapon"),
    }
}

/// The races of each enemy (see `races`).
pub fn races(t: EnemyType) -> &'static [Race] {
    use EnemyType::*;
    match t {
        Necromancer | Summoner | Disciple => &[Race::Human],
        SkeletonWarrior | SkeletonArcher | RaisedSkeleton | RaisedArcher => &[Race::Undead],
        GoblinArcher => &[Race::Goblin],
        OrcWarrior | OrcArcher => &[Race::Orc],
        Ogre => &[Race::Ogre],
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
    use crate::defs::items::ItemBase;

    #[test]
    fn enemy_stat_blocks_match_the_spec() {
        use EnemyType::*;
        assert_eq!(def(Ogre).attrs, Attributes::new(19, 8, 16, 5, 7, 7));
        assert_eq!(def(Ogre).weight, 20.0);
        assert_eq!(def(Imp).attrs, Attributes::new(6, 17, 13, 11, 12, 14));
        assert_eq!(def(Imp).weight, 4.0);
        assert_eq!(def(RaisedSkeleton).attrs.get(Attr::Con), 12);
        assert_eq!(def(RaisedSkeleton).attrs.get(Attr::Str), def(SkeletonWarrior).attrs.get(Attr::Str));
        assert_eq!(def(RaisedArcher).attrs.get(Attr::Con), 12);
        assert_eq!(def(RaisedArcher).attrs.get(Attr::Dex), 15);
        assert_eq!(def(SummonedImp).attrs.get(Attr::Con), 10);
        assert_eq!(def(SummonedImp).attrs.get(Attr::Dex), 17);
        assert_eq!(def(Disciple).weight, 10.0);
        assert_eq!(def(GoblinArcher).attrs, Attributes::new(8, 15, 10, 10, 8, 8));
        assert_eq!(def(SkeletonWarrior).attrs, Attributes::new(12, 12, 15, 6, 8, 5));
        assert_eq!(def(SkeletonArcher).attrs, Attributes::new(10, 15, 13, 6, 8, 5));
        assert_eq!(def(OrcWarrior).attrs, Attributes::new(16, 12, 16, 7, 11, 10));
        assert_eq!(def(OrcArcher).attrs, Attributes::new(14, 14, 14, 7, 11, 10));
        assert_eq!(def(Necromancer).attrs, Attributes::new(9, 14, 12, 17, 12, 11));
        assert_eq!(def(Summoner).attrs, Attributes::new(9, 14, 12, 15, 12, 16));
        assert_eq!(def(Disciple).attrs, Attributes::new(10, 12, 10, 13, 11, 10));
        assert_eq!(def(Mimic).attrs, Attributes::new(17, 12, 15, 5, 13, 8));
        assert_eq!(def(Chort).attrs, Attributes::new(14, 13, 13, 8, 10, 9));
        assert_eq!(def(Ghost).attrs, Attributes::new(6, 14, 10, 10, 12, 14));
        assert_eq!(def(Shade).attrs, Attributes::new(8, 12, 12, 10, 14, 15));
        let shade = def(Shade);
        assert_eq!((shade.hp, shade.speed, shade.radius, shade.vision, shade.preferred), (40.0, 44.0, 6.0, 8.75, 0.0));
        assert_eq!((shade.abilities, shade.weapons), (&[AbilityId::Touch, AbilityId::Vanish][..], &[ItemId::ShadeTouch][..]));
        let ghost = def(Ghost);
        assert_eq!((ghost.hp, ghost.speed, ghost.radius, ghost.vision, ghost.preferred), (32.0, 50.0, 6.0, 8.75, 0.0));
        assert_eq!((ghost.abilities, ghost.weapons), (&[AbilityId::Touch, AbilityId::Vanish][..], &[ItemId::GhostTouch][..]));
        let weights = [
            (GoblinArcher, 6.0), (SkeletonWarrior, 9.0), (SkeletonArcher, 9.0), (RaisedSkeleton, 9.0), (RaisedArcher, 9.0),
            (OrcWarrior, 13.0), (OrcArcher, 13.0), (Necromancer, 10.0), (Summoner, 10.0), (Disciple, 10.0),
            (Mimic, 14.0), (Imp, 4.0), (SummonedImp, 4.0), (Chort, 10.0), (Ogre, 20.0), (Ghost, 3.0), (Shade, 3.0),
        ];
        assert_eq!(weights.len(), EnemyType::ALL.len());
        for (t, w) in weights {
            assert_eq!(def(t).weight, w, "{t:?}");
        }
    }

    /// Every ability of every enemy resolves with its weapons, and the first weapon is a melee one.
    #[test]
    fn every_enemy_kit_resolves() {
        for t in EnemyType::ALL {
            let d = def(t);
            let kit = crate::sheet::kit_for(crate::sheet::KitSource::Enemy(t), &crate::defs::enemies::def(t).attrs);
            for &id in d.abilities {
                assert!(kit.get(id).is_some(), "{t:?} {id:?}");
            }
            assert!(matches!(items::def(d.weapons[0]).base, ItemBase::Melee(..)), "{t:?}: its first weapon is a melee one");
        }
    }

    /// A bow goes with Shoot; every enemy has a melee ability.
    #[test]
    fn enemy_abilities_fit_their_weapons() {
        for t in EnemyType::ALL {
            let d = def(t);
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

    /// An enemy with no melee weapon of its own punches with its race's natural one.
    #[test]
    fn enemies_without_a_melee_weapon_use_their_races_natural_one() {
        for t in EnemyType::ALL {
            let w = def(t).weapons[0];
            let species = matches!(t, EnemyType::Mimic | EnemyType::Imp | EnemyType::SummonedImp | EnemyType::Chort | EnemyType::Ghost | EnemyType::Shade);
            let ItemBase::Melee(k, _) = items::def(w).base else { panic!("{t:?}") };
            let natural_kind = crate::defs::weapons::is_natural_like(crate::defs::weapons::category(k));
            // Mimic, imps and chorts have a species weapon of their own; a weapon-less enemy its race's.
            assert!(species || !natural_kind || w == natural_melee(t), "{t:?}");
        }
    }

    #[test]
    fn enemy_weapons_fit_their_proficiencies() {
        use super::super::weapons::WeaponKind as K;
        use EnemyType::*;
        // Spec §7. The skeleton archer's weapon is a Longbow, which the spec's "Bow" stands for.
        let table: [(EnemyType, &[K]); 10] = [
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
            let con = def(t).attrs.get(Attr::Con);
            assert_eq!(base_hp(t) + 5.0 * (con - 10) as f64, def(t).hp, "{t:?}");
            assert_eq!(attributes::hp(base_hp(t), con), def(t).hp, "{t:?}");
        }
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
        let expect: [(EnemyType, &[Race]); 17] = [
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
        ];
        let near = |a: f64, b: f64| (a - b).abs() < 1e-9;
        for t in EnemyType::ALL {
            let kit = crate::sheet::kit_for(crate::sheet::KitSource::Enemy(t), &crate::defs::enemies::def(t).attrs);
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
