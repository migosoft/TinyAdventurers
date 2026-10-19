use super::attributes::{Attr, Attributes};
use super::races::{self, Adjust, Race, Profile};
use super::kinds::EntityKind;
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
}

impl EnemyType {
    pub const ALL: [EnemyType; 15] = [
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
    ];
}

#[derive(Debug, Clone, Copy)]
pub enum AttackStyle {
    /// `knock`: knockback (px) on a hit; only strong melee pushes, ranged attacks never do.
    Melee { range: f64, damage: f64, cooldown: f64, windup: f64, knock: f64 },
    Ranged { projectile: EntityKind, speed: f64, damage: f64, cooldown: f64, range: f64, preferred: f64, windup: f64 },
    /// Ground slam: hits and pushes every hero whose centre is within `radius`
    /// (px from the attacker's centre) when the wind-up ends.
    Slam { radius: f64, damage: f64, cooldown: f64, windup: f64, knock: f64 },
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
    pub attack: AttackStyle,
    /// Second attack with its own cooldown. Melee is used when the target is
    /// in claw range, ranged otherwise (imps claw, chorts throw fire bolts).
    pub alt: Option<AttackStyle>,
}

pub fn def(t: EnemyType) -> EnemyDef {
    use AttackStyle::*;
    use EnemyType::*;
    match t {
        GoblinArcher => EnemyDef {
            kind: EntityKind::GoblinArcher,
            hp: 24.0,
            speed: 58.0,
            radius: 4.0,
            vision: 8.125,
            attrs: Attributes::new(8, 15, 10, 10, 8, 8),
            weight: 6.0,
            attack: Ranged { projectile: EntityKind::Arrow, speed: 170.0, damage: 6.0, cooldown: 1.4, range: 140.0, preferred: 90.0, windup: 0.3 },
            alt: None,
        },
        SkeletonWarrior | RaisedSkeleton => EnemyDef {
            kind: if t == RaisedSkeleton { EntityKind::RaisedSkeleton } else { EntityKind::SkeletonWarrior },
            hp: if t == RaisedSkeleton { 26.0 } else { 40.0 },
            speed: 46.0,
            radius: 5.0,
            vision: 7.5,
            attrs: Attributes::new(12, 12, if t == RaisedSkeleton { 12 } else { 15 }, 6, 8, 5),
            weight: 9.0,
            attack: Melee { range: 14.0, damage: 9.0, cooldown: 1.0, windup: 0.3, knock: 0.0 },
            alt: None,
        },
        SkeletonArcher | RaisedArcher => EnemyDef {
            kind: EntityKind::SkeletonArcher,
            hp: if t == RaisedArcher { 20.0 } else { 30.0 },
            speed: 44.0,
            radius: 5.0,
            vision: 8.75,
            attrs: Attributes::new(10, 15, if t == RaisedArcher { 12 } else { 13 }, 6, 8, 5),
            weight: 9.0,
            attack: Ranged { projectile: EntityKind::Arrow, speed: 180.0, damage: 7.0, cooldown: 1.6, range: 150.0, preferred: 100.0, windup: 0.35 },
            alt: None,
        },
        OrcWarrior => EnemyDef {
            kind: EntityKind::OrcWarrior,
            hp: 70.0,
            speed: 52.0,
            radius: 6.0,
            vision: 7.8125,
            attrs: Attributes::new(16, 12, 16, 7, 11, 10),
            weight: 13.0,
            attack: Melee { range: 16.0, damage: 14.0, cooldown: 1.2, windup: 0.35, knock: 20.0 },
            alt: None,
        },
        OrcArcher => EnemyDef {
            kind: EntityKind::OrcArcher,
            hp: 50.0,
            speed: 48.0,
            radius: 6.0,
            vision: 8.75,
            attrs: Attributes::new(14, 14, 14, 7, 11, 10),
            weight: 13.0,
            attack: Ranged { projectile: EntityKind::Arrow, speed: 190.0, damage: 10.0, cooldown: 1.7, range: 150.0, preferred: 100.0, windup: 0.35 },
            alt: None,
        },
        Necromancer | Summoner => EnemyDef {
            kind: if t == Summoner { EntityKind::Summoner } else { EntityKind::Necromancer },
            hp: 60.0,
            speed: 40.0,
            radius: 5.0,
            vision: 9.375,
            attrs: if t == Summoner { Attributes::new(9, 14, 12, 15, 12, 16) } else { Attributes::new(9, 14, 12, 17, 12, 11) },
            weight: 10.0,
            attack: Ranged {
                projectile: if t == Summoner { EntityKind::FireBolt } else { EntityKind::ShadowBolt },
                speed: 130.0,
                damage: 12.0,
                cooldown: 2.0,
                range: 160.0,
                preferred: 110.0,
                windup: 0.5,
            },
            alt: None,
        },
        Disciple => EnemyDef {
            kind: EntityKind::Disciple,
            hp: 45.0,
            speed: 0.0,
            radius: 5.0,
            vision: 12.5,
            attrs: Attributes::new(10, 12, 10, 13, 11, 10),
            weight: 10.0,
            attack: Ranged {
                projectile: EntityKind::ShadowBolt,
                speed: 120.0,
                damage: 8.0,
                cooldown: 3.0,
                range: 200.0,
                preferred: 0.0,
                windup: 0.5,
            },
            alt: None,
        },
        Mimic => EnemyDef {
            kind: EntityKind::Mimic,
            hp: 90.0,
            // Average speed: it only moves while airborne (see MIMIC_HOP_*).
            speed: 50.0,
            radius: 6.0,
            vision: 8.75,
            attrs: Attributes::new(17, 12, 15, 5, 13, 8),
            weight: 14.0,
            attack: Melee { range: 12.0, damage: 13.0, cooldown: 1.0, windup: 0.25, knock: 0.0 },
            alt: None,
        },
        Imp | SummonedImp => EnemyDef {
            kind: EntityKind::Imp,
            hp: if t == SummonedImp { 20.0 } else { 30.0 },
            speed: 44.0,
            radius: 5.0,
            vision: 8.75,
            attrs: Attributes::new(6, 17, if t == SummonedImp { 10 } else { 13 }, 11, 12, 14),
            weight: 4.0,
            attack: Ranged { projectile: EntityKind::FireBolt, speed: 130.0, damage: 7.0, cooldown: 1.6, range: 150.0, preferred: 90.0, windup: 0.3 },
            alt: Some(Melee { range: 12.0, damage: 6.0, cooldown: 0.9, windup: 0.25, knock: 0.0 }),
        },
        Chort => EnemyDef {
            kind: EntityKind::Chort,
            hp: 40.0,
            speed: 46.0,
            radius: 5.0,
            vision: 7.5,
            attrs: Attributes::new(14, 13, 13, 8, 10, 9),
            weight: 10.0,
            attack: Melee { range: 14.0, damage: 9.0, cooldown: 1.0, windup: 0.3, knock: 14.0 },
            alt: Some(Ranged { projectile: EntityKind::FireBolt, speed: 130.0, damage: 6.0, cooldown: 3.2, range: 130.0, preferred: 0.0, windup: 0.35 }),
        },
        Ogre => EnemyDef {
            kind: EntityKind::Ogre,
            hp: 260.0,
            speed: 40.0,
            // Wide: paths with clearance (see `ai::path_toward`); fits 3-tile corridors.
            radius: 10.0,
            vision: 9.375,
            attrs: Attributes::new(19, 8, 16, 5, 7, 7),
            weight: 20.0,
            attack: Melee { range: 18.0, damage: 18.0, cooldown: 1.6, windup: 0.5, knock: 28.0 },
            alt: Some(Slam { radius: OGRE_SLAM_RADIUS, damage: 14.0, cooldown: 5.0, windup: OGRE_SLAM_WINDUP, knock: 24.0 }),
        },
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

/// Demon types walk through lava unharmed (the demon boss too, see `levels::boss::spawn`).
pub fn is_demon(t: EnemyType) -> bool {
    matches!(t, EnemyType::Imp | EnemyType::Chort | EnemyType::Summoner | EnemyType::SummonedImp)
}

/// The ogre's ground slam: radius (px, hero centres) and wind-up (s). The
/// client draws the telegraph ring from these.
pub const OGRE_SLAM_RADIUS: f64 = 34.0;
pub const OGRE_SLAM_WINDUP: f64 = 0.9;

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

/// Necromancers raise skeletons (summoners summon imps) on this cooldown, up to this many alive.
pub const NECRO_RAISE_COOLDOWN: f64 = 7.0;
pub const NECRO_MAX_MINIONS: usize = 3;

/// HP multiplier for party size.
pub fn party_hp_scale(party: usize) -> f64 {
    0.75 + 0.25 * party.max(1) as f64
}

/// HP before the CON bonus: today's HP minus 5 per CON point above 10, so the total stays.
pub fn base_hp(t: EnemyType) -> f64 {
    let d = def(t);
    d.hp - 5.0 * (d.attrs.get(Attr::Con) - 10) as f64
}

/// Race of each enemy (see `races`).
pub fn race(t: EnemyType) -> Race {
    use EnemyType::*;
    match t {
        Necromancer | Summoner | Disciple => Race::Human,
        SkeletonWarrior | SkeletonArcher | RaisedSkeleton | RaisedArcher => Race::Undead,
        GoblinArcher => Race::Goblin,
        OrcWarrior | OrcArcher => Race::Orc,
        Ogre => Race::Ogre,
        Mimic => Race::Mimic,
        Imp | Chort | SummonedImp => Race::Demon,
    }
}

pub fn profile(t: EnemyType) -> Profile {
    races::profile(&[race(t)], Adjust { vision: Some(def(t).vision), ..Adjust::NONE })
}

/// An effect an enemy's attack (`alt`: its second attack) applies on a hit. None yet:
/// e.g. `(EnemyType::GoblinArcher, false) => Some(OnHit { kind: EffectKind::Slowed, secs: 2.0, chance: 0.3, magical: false,
/// power: def(t).attrs.get(Attr::Dex) })` (a bow: the wielder's DEX; a spell would be INT and magical).
pub fn on_hit(t: EnemyType, alt: bool) -> Option<super::effects::OnHit> {
    let _ = (t, alt);
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::attributes::{self, Attr, Attributes};

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
        let weights = [
            (GoblinArcher, 6.0), (SkeletonWarrior, 9.0), (SkeletonArcher, 9.0), (RaisedSkeleton, 9.0), (RaisedArcher, 9.0),
            (OrcWarrior, 13.0), (OrcArcher, 13.0), (Necromancer, 10.0), (Summoner, 10.0), (Disciple, 10.0),
            (Mimic, 14.0), (Imp, 4.0), (SummonedImp, 4.0), (Chort, 10.0), (Ogre, 20.0),
        ];
        assert_eq!(weights.len(), EnemyType::ALL.len());
        for (t, w) in weights {
            assert_eq!(def(t).weight, w, "{t:?}");
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
    fn enemy_races() {
        use EnemyType::*;
        let expect = [
            (GoblinArcher, Race::Goblin),
            (SkeletonWarrior, Race::Undead),
            (SkeletonArcher, Race::Undead),
            (RaisedSkeleton, Race::Undead),
            (RaisedArcher, Race::Undead),
            (OrcWarrior, Race::Orc),
            (OrcArcher, Race::Orc),
            (Necromancer, Race::Human),
            (Summoner, Race::Human),
            (Disciple, Race::Human),
            (Mimic, Race::Mimic),
            (Imp, Race::Demon),
            (SummonedImp, Race::Demon),
            (Chort, Race::Demon),
            (Ogre, Race::Ogre),
        ];
        assert_eq!(expect.len(), EnemyType::ALL.len());
        for (t, r) in expect {
            assert_eq!(race(t), r, "{t:?}");
        }
    }
}
