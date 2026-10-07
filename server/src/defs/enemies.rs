use super::kinds::EntityKind;

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
        },
        SkeletonWarrior | RaisedSkeleton => EnemyDef {
            kind: if t == RaisedSkeleton { EntityKind::RaisedSkeleton } else { EntityKind::SkeletonWarrior },
            hp: if t == RaisedSkeleton { 26.0 } else { 40.0 },
            speed: 46.0,
            radius: 5.0,
            sight: 120.0,
            attack: Melee { range: 14.0, damage: 9.0, cooldown: 1.0, windup: 0.3 },
        },
        SkeletonArcher => EnemyDef {
            kind: EntityKind::SkeletonArcher,
            hp: 30.0,
            speed: 44.0,
            radius: 5.0,
            sight: 140.0,
            attack: Ranged { projectile: EntityKind::Arrow, speed: 180.0, damage: 7.0, cooldown: 1.6, range: 150.0, preferred: 100.0, windup: 0.35 },
        },
        OrcWarrior => EnemyDef {
            kind: EntityKind::OrcWarrior,
            hp: 70.0,
            speed: 52.0,
            radius: 6.0,
            sight: 125.0,
            attack: Melee { range: 16.0, damage: 14.0, cooldown: 1.2, windup: 0.35 },
        },
        OrcArcher => EnemyDef {
            kind: EntityKind::OrcArcher,
            hp: 50.0,
            speed: 48.0,
            radius: 6.0,
            sight: 140.0,
            attack: Ranged { projectile: EntityKind::Arrow, speed: 190.0, damage: 10.0, cooldown: 1.7, range: 150.0, preferred: 100.0, windup: 0.35 },
        },
        Necromancer => EnemyDef {
            kind: EntityKind::Necromancer,
            hp: 60.0,
            speed: 40.0,
            radius: 5.0,
            sight: 150.0,
            attack: Ranged {
                projectile: EntityKind::ShadowBolt,
                speed: 130.0,
                damage: 12.0,
                cooldown: 2.0,
                range: 160.0,
                preferred: 110.0,
                windup: 0.5,
            },
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
        },
    }
}

/// Necromancers raise skeletons on this cooldown, up to this many alive.
pub const NECRO_RAISE_COOLDOWN: f64 = 7.0;
pub const NECRO_MAX_MINIONS: usize = 3;
