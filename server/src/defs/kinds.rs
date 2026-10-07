//! Numeric ids used in compact snapshots. Exported to `client/src/generated/kinds.ts`.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum EntityKind {
    // Players
    Wizard = 0,
    Paladin = 1,
    Barbarian = 2,
    Assassin = 3,
    // Monsters
    GoblinArcher = 10,
    SkeletonWarrior = 11,
    SkeletonArcher = 12,
    OrcWarrior = 13,
    OrcArcher = 14,
    Necromancer = 15,
    RaisedSkeleton = 16,
    Disciple = 17,
    // Bosses
    Demon = 30,
    Lich = 31,
    Dragon = 32,
    // Projectiles
    Missile = 50,
    Fireball = 51,
    Bolt = 52,
    Arrow = 53,
    ShadowBolt = 54,
    FrostBolt = 55,
    FireBreath = 56,
    FireOrb = 57,
    DragonFireball = 58,
    // Hazards
    FirePatch = 70,
}

impl EntityKind {
    pub const ALL: [EntityKind; 25] = [
        EntityKind::Wizard,
        EntityKind::Paladin,
        EntityKind::Barbarian,
        EntityKind::Assassin,
        EntityKind::GoblinArcher,
        EntityKind::SkeletonWarrior,
        EntityKind::SkeletonArcher,
        EntityKind::OrcWarrior,
        EntityKind::OrcArcher,
        EntityKind::Necromancer,
        EntityKind::RaisedSkeleton,
        EntityKind::Disciple,
        EntityKind::Demon,
        EntityKind::Lich,
        EntityKind::Dragon,
        EntityKind::Missile,
        EntityKind::Fireball,
        EntityKind::Bolt,
        EntityKind::Arrow,
        EntityKind::ShadowBolt,
        EntityKind::FrostBolt,
        EntityKind::FireBreath,
        EntityKind::FireOrb,
        EntityKind::DragonFireball,
        EntityKind::FirePatch,
    ];
}

/// Animation state of an entity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Anim {
    Idle = 0,
    Move = 1,
    Melee = 2,
    Shoot = 3,
    Cast = 4,
    Dash = 5,
    Windup = 6,
    Channel = 7,
    Breath = 8,
}

impl Anim {
    pub const ALL: [Anim; 9] =
        [Anim::Idle, Anim::Move, Anim::Melee, Anim::Shoot, Anim::Cast, Anim::Dash, Anim::Windup, Anim::Channel, Anim::Breath];
}

pub mod flags {
    pub const HIDDEN: u8 = 1;
    pub const IMMUNE: u8 = 2;
    pub const ENRAGED: u8 = 4;
    pub const ASLEEP: u8 = 8;
    pub const HURT: u8 = 16;
    pub const DEAD: u8 = 32;
}
