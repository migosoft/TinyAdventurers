//! Races: the base forms of things in the game (templates). Each has
//! resistances, a melee damage split, sight, an Attribute bonus and how it
//! takes status effects; an entity can have several races, plus its own
//! adjustments (`Adjust`). Balancing edits only this data.

use super::attributes::Attributes;
use super::damage::{DamageSplit, DamageType::*, Resistances};
use super::effects::{EffectKind, EffectResistances};
use super::items::{self, ItemBase, ItemId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Race {
    Human,
    Goblin,
    Orc,
    Ogre,
    /// Mimics: hide as treasure chests.
    Mimic,
    Undead,
    Demon,
    Dragon,
    /// Elves: the Elven Ranger.
    Elf,
    /// Magical beasts: the Ranger's wolf.
    MagicalBeast,
    /// Inanimate objects (chests, barrels): every one resists poison fully.
    Object,
}

/// How far an entity sees, in tiles (fractions allowed): `vision` in the
/// light, `darkvision` into the dark.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sight {
    pub vision: f64,
    pub darkvision: f64,
}

impl Sight {
    pub const NONE: Sight = Sight { vision: 0.0, darkvision: 0.0 };

    /// Vision radius in px.
    pub fn vision_px(&self) -> f64 {
        self.vision * crate::dungeon::TILE
    }
}

pub struct RaceDef {
    pub res: Resistances,
    /// Its natural weapons (part of the body, never equipped).
    pub natural: &'static [ItemId],
    /// Vision and darkvision (tiles).
    pub vision: f64,
    pub darkvision: f64,
    /// Attribute bonus of the race (only the Elf has one).
    pub attrs: Attributes,
    /// Its effect resistances (elves and magical beasts never fall asleep).
    pub effect_res: EffectResistances,
}

pub fn race_def(r: Race) -> RaceDef {
    let none = Attributes::default();
    let never_sleeps = EffectResistances::of(&[(EffectKind::Sleep, 1.0)]);
    let plain = |res, natural: &'static [ItemId], vision, darkvision| RaceDef { res, natural, vision, darkvision, attrs: none, effect_res: EffectResistances::NONE };
    use ItemId::*;
    match r {
        Race::Human => plain(Resistances::NONE, &[UnarmedStrike], 9.0, 0.0),
        Race::Goblin | Race::Orc | Race::Ogre => plain(Resistances::NONE, &[UnarmedStrike], 8.0, 1.0 / 3.0),
        Race::Mimic => plain(Resistances::NONE, &[Bite], 8.0, 1.0 / 3.0),
        Race::Undead => plain(Resistances::of(&[(Physical, 0.1), (Heat, -0.1), (Poison, 1.0)]), &[UnarmedStrike], 8.0, 1.0),
        Race::Demon => plain(Resistances::of(&[(Magical, 0.2), (Heat, 1.0), (Cold, -0.5)]), &[Claws], 9.0, 1.0),
        Race::Dragon => plain(Resistances::of(&[(Magical, 0.5), (Physical, 0.1)]), &[Bite, Claws, Tail], 25.0, 1.0),
        Race::Object => plain(Resistances::of(&[(Physical, 0.5), (Poison, 1.0)]), &[], 0.0, 0.0),
        Race::Elf => RaceDef { attrs: Attributes::new(0, 2, 0, 0, 0, 0), effect_res: never_sleeps, ..plain(Resistances::of(&[(Poison, 0.1)]), &[UnarmedStrike], 18.0, 1.0 / 3.0) },
        Race::MagicalBeast => RaceDef { effect_res: never_sleeps, ..plain(Resistances::of(&[(Poison, 0.1), (Magical, 0.1)]), &[BeastBite], 18.0, 1.0) },
    }
}

/// The damage split of a natural weapon.
fn natural_split(id: ItemId) -> DamageSplit {
    match items::def(id).base {
        ItemBase::Melee(_, s) => s.split,
        _ => panic!("{id:?} is not a melee weapon"),
    }
}

/// The summed Attribute bonuses of the races.
pub fn race_attrs(races: &[Race]) -> Attributes {
    races.iter().fold(Attributes::default(), |a, &r| a.plus(race_def(r).attrs))
}

/// One entity's own changes on top of its races.
#[derive(Debug, Clone, Copy)]
pub struct Adjust {
    pub res: Resistances,
    pub effect_res: EffectResistances,
    /// Replaces the melee split of the races.
    pub melee: Option<DamageSplit>,
    /// Replace the vision and darkvision (tiles) of the races.
    pub vision: Option<f64>,
    pub darkvision: Option<f64>,
}

impl Adjust {
    pub const NONE: Adjust = Adjust { res: Resistances::NONE, effect_res: EffectResistances::NONE, melee: None, vision: None, darkvision: None };
}

/// What an entity takes and deals: stored on it at spawn.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Profile {
    pub res: Resistances,
    pub effect_res: EffectResistances,
    pub melee: DamageSplit,
    pub sight: Sight,
}

/// Resistances (damage and effect) of all its races plus the adjustment; the adjustment's melee
/// split, else that of the first race's first natural weapon. Sight: the best of the races, else the adjustment's.
pub fn profile(races: &[Race], adj: Adjust) -> Profile {
    let res = races.iter().fold(Resistances::NONE, |r, &t| r.plus(race_def(t).res)).plus(adj.res);
    let effect_res = races.iter().fold(EffectResistances::NONE, |r, &t| r.plus(race_def(t).effect_res)).plus(adj.effect_res);
    let melee = adj.melee.unwrap_or_else(|| races.first().and_then(|&t| race_def(t).natural.first().copied()).map_or(DamageSplit::physical(), natural_split));
    let best = |f: fn(&RaceDef) -> f64| races.iter().map(|&t| f(&race_def(t))).fold(0.0, f64::max);
    let sight = Sight { vision: adj.vision.unwrap_or_else(|| best(|d| d.vision)), darkvision: adj.darkvision.unwrap_or_else(|| best(|d| d.darkvision)) };
    Profile { res, effect_res, melee, sight }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::enemies::{self, EnemyType};
    use crate::defs::items::ItemId;
    use crate::defs::{bosses, classes};
    use crate::protocol::{BossId, ClassId};

    #[test]
    fn race_melee_comes_from_natural_weapons() {
        let melee = |r| profile(&[r], Adjust::NONE).melee;
        assert!((melee(Race::Demon).share(Heat) - 0.2).abs() < 1e-12);
        let b = melee(Race::MagicalBeast);
        assert!((b.share(Magical) - 0.2).abs() < 1e-12 && (b.share(Physical) - 0.8).abs() < 1e-12);
        assert_eq!(melee(Race::Human), DamageSplit::physical());
        assert_eq!(melee(Race::Object), DamageSplit::physical());
        assert!(race_def(Race::Object).natural.is_empty());
        assert_eq!(race_def(Race::Dragon).natural, &[ItemId::Bite, ItemId::Claws, ItemId::Tail]);
        assert!((bosses::profile(BossId::Dragon).melee.share(Heat) - 0.2).abs() < 1e-12);
    }

    #[test]
    fn adjustments_add_to_the_races() {
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
    fn every_enemy_has_its_race() {
        let p = enemies::profile;
        assert!((p(EnemyType::SkeletonWarrior).res.get(Physical) - 0.1).abs() < 1e-12);
        assert_eq!(p(EnemyType::RaisedArcher).res.get(Poison), 1.0);
        assert_eq!(p(EnemyType::Imp).res.get(Heat), 1.0);
        assert!((p(EnemyType::Chort).melee.share(Heat) - 0.2).abs() < 1e-12, "demon claws burn");
        let same = |t, e| {
            let (a, b) = (p(t), profile(&[e], Adjust::NONE));
            assert_eq!((a.res, a.melee), (b.res, b.melee), "{t:?}");
        };
        same(EnemyType::Ogre, Race::Ogre);
        same(EnemyType::GoblinArcher, Race::Goblin);
        same(EnemyType::OrcWarrior, Race::Orc);
        same(EnemyType::OrcArcher, Race::Orc);
        same(EnemyType::Mimic, Race::Mimic);
        same(EnemyType::Necromancer, Race::Human);
        assert_eq!(p(EnemyType::Disciple).res, Resistances::NONE);
        for c in [ClassId::Wizard, ClassId::Paladin, ClassId::Barbarian] {
            assert_eq!(classes::profile(c), profile(&[Race::Human], Adjust::NONE));
        }
        let obj = profile(&[Race::Object], Adjust::NONE);
        assert_eq!((obj.res.get(Physical), obj.res.get(Poison)), (0.5, 1.0));
    }

    #[test]
    fn the_ranger_is_an_elf_and_elves_and_magical_beasts_sleep_never() {
        use crate::defs::effects::{EffectKind, EffectResistances};
        let r = classes::profile(ClassId::ElvenRanger);
        assert!((r.res.get(Poison) - 0.1).abs() < 1e-12);
        assert_eq!(r.sight, Sight { vision: 18.0, darkvision: 1.0 / 3.0 });
        assert_eq!(r.melee, DamageSplit::physical());
        assert_eq!(r.effect_res.get(EffectKind::Sleep), 1.0);
        assert_eq!(classes::profile(ClassId::Wizard).effect_res, EffectResistances::NONE);
        let b = profile(&[Race::MagicalBeast], Adjust::NONE);
        assert_eq!((b.res.get(Poison), b.res.get(Magical)), (0.1, 0.1));
        assert!((b.melee.share(Magical) - 0.2).abs() < 1e-12 && (b.melee.share(Physical) - 0.8).abs() < 1e-12);
        assert_eq!(b.sight, Sight { vision: 18.0, darkvision: 1.0 });
        assert_eq!(profile(&[Race::Human, Race::MagicalBeast], Adjust::NONE).effect_res.get(EffectKind::Sleep), 1.0);
    }

    #[test]
    fn effect_res_sums_races_and_adjust() {
        use crate::defs::effects::{EffectKind, EffectResistances};
        let p = profile(&[Race::Elf], Adjust { effect_res: EffectResistances::of(&[(EffectKind::Blind, 0.25)]), ..Adjust::NONE });
        assert_eq!((p.effect_res.get(EffectKind::Sleep), p.effect_res.get(EffectKind::Blind)), (1.0, 0.25));
    }

    #[test]
    fn every_race_has_a_sight_and_several_take_the_best() {
        let s = |t| profile(&[t], Adjust::NONE).sight;
        assert_eq!(s(Race::Human), Sight { vision: 9.0, darkvision: 0.0 });
        for r in [Race::Goblin, Race::Orc, Race::Ogre, Race::Mimic] {
            let p = profile(&[r], Adjust::NONE);
            assert_eq!(p.sight, Sight { vision: 8.0, darkvision: 1.0 / 3.0 }, "{r:?}");
            assert_eq!((p.res, p.melee), (Resistances::NONE, DamageSplit::physical()), "{r:?}");
        }
        assert_eq!(s(Race::Undead).darkvision, 1.0);
        assert_eq!(s(Race::Dragon).vision, 25.0);
        assert_eq!(s(Race::Object), Sight { vision: 0.0, darkvision: 0.0 });
        let both = profile(&[Race::Human, Race::Undead], Adjust::NONE).sight;
        assert_eq!(both, Sight { vision: 9.0, darkvision: 1.0 });
        let adj = Adjust { vision: Some(12.5), darkvision: Some(0.5), ..Adjust::NONE };
        assert_eq!(profile(&[Race::Undead], adj).sight, Sight { vision: 12.5, darkvision: 0.5 });
    }

    #[test]
    fn enemy_and_boss_ranges_are_unchanged() {
        // Sight radii in px before vision existed (defs/enemies.rs, 2026-10-15).
        let old = [(EnemyType::GoblinArcher, 130.0), (EnemyType::SkeletonWarrior, 120.0), (EnemyType::RaisedSkeleton, 120.0),
            (EnemyType::SkeletonArcher, 140.0), (EnemyType::RaisedArcher, 140.0), (EnemyType::OrcWarrior, 125.0),
            (EnemyType::OrcArcher, 140.0), (EnemyType::Necromancer, 150.0), (EnemyType::Summoner, 150.0),
            (EnemyType::Disciple, 200.0), (EnemyType::Mimic, 140.0), (EnemyType::Imp, 140.0),
            (EnemyType::SummonedImp, 140.0), (EnemyType::Chort, 120.0), (EnemyType::Ogre, 150.0)];
        assert_eq!(old.len(), EnemyType::ALL.len());
        for (t, px) in old {
            assert_eq!(enemies::profile(t).sight.vision * 16.0, px, "{t:?}");
        }
        for b in BossId::ALL {
            assert_eq!(bosses::profile(b).sight.vision, 25.0, "{b:?}");
        }
    }

    #[test]
    fn only_the_elf_has_an_attribute_bonus() {
        assert_eq!(race_def(Race::Elf).attrs, Attributes::new(0, 2, 0, 0, 0, 0));
        for r in [Race::Human, Race::Goblin, Race::Orc, Race::Ogre, Race::Mimic, Race::Undead, Race::Demon, Race::Dragon, Race::MagicalBeast, Race::Object] {
            assert_eq!(race_def(r).attrs, Attributes::default(), "{r:?}");
        }
        assert_eq!(race_attrs(&[Race::Human, Race::Elf]), Attributes::new(0, 2, 0, 0, 0, 0));
    }
}
