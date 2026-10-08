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
}

#[derive(Debug, Clone, Copy)]
pub enum AttackStyle {
    Melee { range: f64, damage: f64, cooldown: f64, windup: f64 },
    Ranged { projectile: EntityKind, speed: f64, damage: f64, cooldown: f64, range: f64, preferred: f64, windup: f64 },
}

#[derive(Debug, Clone, Copy)]
pub struct EnemyDef {
    pub kind: EntityKind,
    pub hp: f64,
    pub speed: f64,
    pub radius: f64,
    /// Sight radius (px). Enemies only notice players inside it with line of sight.
    pub sight: f64,
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
            sight: 130.0,
            attack: Ranged { projectile: EntityKind::Arrow, speed: 170.0, damage: 6.0, cooldown: 1.4, range: 140.0, preferred: 90.0, windup: 0.3 },
            alt: None,
        },
        SkeletonWarrior | RaisedSkeleton => EnemyDef {
            kind: if t == RaisedSkeleton { EntityKind::RaisedSkeleton } else { EntityKind::SkeletonWarrior },
            hp: if t == RaisedSkeleton { 26.0 } else { 40.0 },
            speed: 46.0,
            radius: 5.0,
            sight: 120.0,
            attack: Melee { range: 14.0, damage: 9.0, cooldown: 1.0, windup: 0.3 },
            alt: None,
        },
        SkeletonArcher => EnemyDef {
            kind: EntityKind::SkeletonArcher,
            hp: 30.0,
            speed: 44.0,
            radius: 5.0,
            sight: 140.0,
            attack: Ranged { projectile: EntityKind::Arrow, speed: 180.0, damage: 7.0, cooldown: 1.6, range: 150.0, preferred: 100.0, windup: 0.35 },
            alt: None,
        },
        OrcWarrior => EnemyDef {
            kind: EntityKind::OrcWarrior,
            hp: 70.0,
            speed: 52.0,
            radius: 6.0,
            sight: 125.0,
            attack: Melee { range: 16.0, damage: 14.0, cooldown: 1.2, windup: 0.35 },
            alt: None,
        },
        OrcArcher => EnemyDef {
            kind: EntityKind::OrcArcher,
            hp: 50.0,
            speed: 48.0,
            radius: 6.0,
            sight: 140.0,
            attack: Ranged { projectile: EntityKind::Arrow, speed: 190.0, damage: 10.0, cooldown: 1.7, range: 150.0, preferred: 100.0, windup: 0.35 },
            alt: None,
        },
        Necromancer | Summoner => EnemyDef {
            kind: if t == Summoner { EntityKind::Summoner } else { EntityKind::Necromancer },
            hp: 60.0,
            speed: 40.0,
            radius: 5.0,
            sight: 150.0,
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
            sight: 200.0,
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
            sight: 140.0,
            attack: Melee { range: 12.0, damage: 13.0, cooldown: 1.0, windup: 0.25 },
            alt: None,
        },
        Imp | SummonedImp => EnemyDef {
            kind: EntityKind::Imp,
            hp: if t == SummonedImp { 20.0 } else { 30.0 },
            speed: 44.0,
            radius: 5.0,
            sight: 140.0,
            attack: Ranged { projectile: EntityKind::FireBolt, speed: 130.0, damage: 7.0, cooldown: 1.6, range: 150.0, preferred: 90.0, windup: 0.3 },
            alt: Some(Melee { range: 12.0, damage: 6.0, cooldown: 0.9, windup: 0.25 }),
        },
        Chort => EnemyDef {
            kind: EntityKind::Chort,
            hp: 40.0,
            speed: 46.0,
            radius: 5.0,
            sight: 120.0,
            attack: Melee { range: 14.0, damage: 9.0, cooldown: 1.0, windup: 0.3 },
            alt: Some(Ranged { projectile: EntityKind::FireBolt, speed: 130.0, damage: 6.0, cooldown: 3.2, range: 130.0, preferred: 0.0, windup: 0.35 }),
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

/// Demon types walk through lava unharmed (the demon boss too, see `Run::spawn_boss`).
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

/// Necromancers raise skeletons (summoners summon imps) on this cooldown, up to this many alive.
pub const NECRO_RAISE_COOLDOWN: f64 = 7.0;
pub const NECRO_MAX_MINIONS: usize = 3;
