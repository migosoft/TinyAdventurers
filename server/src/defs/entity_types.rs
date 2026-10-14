//! Entity types: the base forms of things in the game (templates). Each has
//! resistances and a melee damage split; an entity can have several, plus
//! its own adjustments (`Adjust`). Balancing edits only this data.

use super::damage::{DamageSplit, DamageType::*, Resistances};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityType {
    Human,
    Undead,
    Monster,
    Demon,
    Dragon,
    /// Inanimate objects (chests, barrels): every one resists poison fully.
    Object,
}

pub struct TypeDef {
    pub res: Resistances,
    pub melee: DamageSplit,
}

pub fn type_def(t: EntityType) -> TypeDef {
    match t {
        EntityType::Human | EntityType::Monster => TypeDef { res: Resistances::NONE, melee: DamageSplit::physical() },
        EntityType::Undead => TypeDef { res: Resistances::of(&[(Physical, 0.1), (Heat, -0.1), (Poison, 1.0)]), melee: DamageSplit::physical() },
        EntityType::Demon => TypeDef { res: Resistances::of(&[(Magical, 0.2), (Heat, 1.0), (Cold, -0.5)]), melee: DamageSplit::split(&[(Heat, 0.2)]) },
        EntityType::Dragon => TypeDef { res: Resistances::of(&[(Magical, 0.5), (Physical, 0.1)]), melee: DamageSplit::physical() },
        EntityType::Object => TypeDef { res: Resistances::of(&[(Physical, 0.5), (Poison, 1.0)]), melee: DamageSplit::physical() },
    }
}

/// One entity's own changes on top of its entity types.
#[derive(Debug, Clone, Copy)]
pub struct Adjust {
    pub res: Resistances,
    /// Replaces the melee split of the entity types.
    pub melee: Option<DamageSplit>,
}

impl Adjust {
    pub const NONE: Adjust = Adjust { res: Resistances::NONE, melee: None };
}

/// What an entity takes and deals: stored on it at spawn.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Profile {
    pub res: Resistances,
    pub melee: DamageSplit,
}

/// Resistances of all its types plus the adjustment; the adjustment's melee
/// split, else the first type's.
pub fn profile(types: &[EntityType], adj: Adjust) -> Profile {
    let res = types.iter().fold(Resistances::NONE, |r, &t| r.plus(type_def(t).res)).plus(adj.res);
    let melee = adj.melee.unwrap_or_else(|| types.first().map_or(DamageSplit::physical(), |&t| type_def(t).melee));
    Profile { res, melee }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::damage::DamageType::*;
    use crate::defs::enemies::{self, EnemyType};
    use crate::defs::{bosses, classes};
    use crate::protocol::{BossId, ClassId};

    #[test]
    fn adjustments_add_to_the_entity_types() {
        let lich = bosses::profile(BossId::Lich);
        assert!((lich.res.get(Physical) - 0.5).abs() < 1e-12, "undead 10 + lich 40");
        assert!((lich.res.get(Magical) - 0.4).abs() < 1e-12);
        assert!((lich.res.get(Heat) + 0.1).abs() < 1e-12, "undead weakness to heat");
        assert_eq!(lich.res.get(Poison), 1.0);
        let dragon = bosses::profile(BossId::Dragon);
        assert_eq!(dragon.res.get(Heat), 1.0);
        assert!((dragon.melee.share(Heat) - 0.2).abs() < 1e-12, "the dragon's claws burn");
        let demon = bosses::profile(BossId::Demon);
        assert!((demon.res.get(Magical) - 0.4).abs() < 1e-12);
        assert!((demon.res.get(Cold) + 0.5).abs() < 1e-12);
    }

    #[test]
    fn every_enemy_has_its_entity_type() {
        let p = enemies::profile;
        assert!((p(EnemyType::SkeletonWarrior).res.get(Physical) - 0.1).abs() < 1e-12);
        assert_eq!(p(EnemyType::RaisedArcher).res.get(Poison), 1.0);
        assert_eq!(p(EnemyType::Imp).res.get(Heat), 1.0);
        assert!((p(EnemyType::Chort).melee.share(Heat) - 0.2).abs() < 1e-12, "demon claws burn");
        assert_eq!(p(EnemyType::Ogre), profile(&[EntityType::Monster], Adjust::NONE));
        assert_eq!(p(EnemyType::Necromancer), profile(&[EntityType::Human], Adjust::NONE));
        assert_eq!(p(EnemyType::Disciple).res, Resistances::NONE);
        for c in ClassId::ALL {
            assert_eq!(classes::profile(c), profile(&[EntityType::Human], Adjust::NONE));
        }
        let obj = profile(&[EntityType::Object], Adjust::NONE);
        assert_eq!((obj.res.get(Physical), obj.res.get(Poison)), (0.5, 1.0));
    }
}
