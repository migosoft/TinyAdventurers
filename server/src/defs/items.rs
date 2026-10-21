//! Items: equipment slots, base types and properties. Data only; the equip
//! rules and the hero sheet that reads it come later in plan 2.

use super::attributes::{Attr, Attributes};
use super::classes;
use super::damage::{DamageSplit, DamageType};
use super::effects::{EffectKind, OnHit};
use super::kinds::EntityKind;
use super::lights::LightKind;
use super::requirements::Requirement;
use super::weapons::{category, At, MeleeStats, RangedStats, WeaponCategory, WeaponKind};
use crate::protocol::ClassId;

super::enum_list::listed_enum! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub enum EquipSlot: u8 {
        Melee = 0,
        Ranged = 1,
        OffHand = 2,
        Armor = 3,
        Ring1 = 4,
        Ring2 = 5,
        Shoes = 6,
        Belt = 7,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Equipment {
    pub slots: [Option<ItemId>; EquipSlot::COUNT],
}

impl Equipment {
    pub fn get(&self, s: EquipSlot) -> Option<ItemId> {
        self.slots[s as usize]
    }

    pub fn with(mut self, s: EquipSlot, id: ItemId) -> Equipment {
        self.slots[s as usize] = Some(id);
        self
    }

    /// The class's starting weapons: Melee and, if it has one, Ranged.
    pub fn starter(class: ClassId) -> Equipment {
        let (melee, ranged) = classes::def(class).starter;
        let e = Equipment::default().with(EquipSlot::Melee, melee);
        match ranged {
            Some(r) => e.with(EquipSlot::Ranged, r),
            None => e,
        }
    }
}

super::enum_list::listed_enum! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub enum ItemId: u16 {
        RedStaff = 0,
        KnightSword = 1,
        GreatAxe = 2,
        Rapier = 3,
        ElvenBow = 4,
        EmberStaff = 5,
        StaffOfRot = 6,
        BoneStaff = 7,
        Knife = 8,
        GoldenSword = 9,
        FlameTongue = 10,
        ShortBow = 11,
        SilkRobe = 12,
        LeatherArmor = 13,
        ChainMail = 14,
        PlateArmor = 15,
        RingOfEmbers = 16,
        BandOfVigor = 17,
        RingOfInsight = 18,
        BootsOfHaste = 19,
        IronBoots = 20,
        GirdleOfWarding = 21,
        GoblinBow = 22,
        RustySword = 23,
        SkeletonLongbow = 24,
        Cleaver = 25,
        OrcBow = 26,
        SpikedClub = 27,
        MimicBite = 28,
        ImpClaws = 29,
        ChortClaws = 30,
        UnarmedStrike = 31,
        Bite = 32,
        Claws = 33,
        BeastBite = 34,
        Tail = 35,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ArmorClass {
    Cloth,
    Light,
    Medium,
    Heavy,
}

#[derive(Debug, Clone, Copy)]
pub struct ArmorStats {
    pub class: ArmorClass,
    pub physical: f64,
    pub weight: f64,
}

#[derive(Debug, Clone, Copy)]
pub enum ItemBase {
    Melee(WeaponKind, MeleeStats),
    Ranged(WeaponKind, RangedStats),
    Armor(ArmorStats),
    Ring,
    Shoes,
    Belt,
    /// Reserved; no item uses it.
    #[allow(dead_code)]
    Shield,
}

#[derive(Debug, Clone, Copy)]
pub struct ItemProperty {
    pub kind: PropKind,
    pub magical: bool,
}

#[derive(Debug, Clone, Copy)]
pub enum PropKind {
    DamageShare(DamageType, f64),
    OnHit(OnHit),
    Light(LightKind),
    Resist(DamageType, f64),
    Attr(Attr, i32),
    EffectResist(EffectKind, f64),
    Weight(f64),
    /// A fraction: 0.05 is +5 %.
    MoveSpeed(f64),
    MaxHp(f64),
}

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)] // id, name, sprite: plan 4 (drawing, the equip UI)
pub struct ItemDef {
    pub id: ItemId,
    pub name: &'static str,
    /// The atlas frame; "" for armor, rings, shoes, belts and natural weapons.
    pub sprite: &'static str,
    pub base: ItemBase,
    pub classes: &'static [ClassId],
    pub req: &'static [Requirement],
    pub props: &'static [ItemProperty],
}

// Macros, not `const fn`s: only struct literals are promoted to `'static`.
macro_rules! mag {
    ($k:expr) => {
        ItemProperty { kind: $k, magical: true }
    };
}

macro_rules! plain {
    ($k:expr) => {
        ItemProperty { kind: $k, magical: false }
    };
}

fn melee(kind: WeaponKind, damage: f64, cooldown: f64, arc: f64, push: f64, split: DamageSplit, at: At) -> ItemBase {
    ItemBase::Melee(kind, MeleeStats { damage, cooldown, arc, push, split, at })
}

#[allow(clippy::too_many_arguments)]
fn ranged(kind: WeaponKind, damage: f64, cooldown: f64, range: f64, projectile_speed: f64, radius: f64, projectile: EntityKind, at: At) -> ItemBase {
    ItemBase::Ranged(kind, RangedStats { damage, cooldown, range, projectile_speed, radius, projectile, split: DamageSplit::physical(), at })
}

fn armor(class: ArmorClass, physical: f64, weight: f64) -> ItemBase {
    ItemBase::Armor(ArmorStats { class, physical, weight })
}

const ALL: &[ClassId] = &ClassId::ALL;
const WIZARD: &[ClassId] = &[ClassId::Wizard];
const RANGER: &[ClassId] = &[ClassId::ElvenRanger];

pub fn def(id: ItemId) -> ItemDef {
    use ItemId as I;
    use WeaponKind as K;
    let phys = DamageSplit::physical;
    let at = |str, dex| At { str, dex };
    let item = |name, sprite, base, classes, req, props| ItemDef { id, name, sprite, base, classes, req, props };
    match id {
        I::RedStaff => item("Red Staff", "weapon_red_magic_staff", melee(K::Staff, 6.0, 1.0, 1.6, 0.0, phys(), at(8, 14)), WIZARD, &[], &[]),
        I::KnightSword => item("Knight Sword", "weapon_knight_sword", melee(K::Sword, 20.0, 0.45, 1.75, 0.0, phys(), at(15, 8)), ALL, &[], &[]),
        I::GreatAxe => item("Great Axe", "weapon_double_axe", melee(K::Axe, 32.0, 0.8, 2.45, 0.0, phys(), at(15, 13)), ALL, &[], &[]),
        I::Rapier => item("Rapier", "weapon_duel_sword", melee(K::DuellingSword, 18.0, 0.35, 1.0, 0.0, phys(), at(10, 15)), ALL, &[], &[]),
        I::ElvenBow => item("Elven Bow", "weapon_bow", ranged(K::Bow, 16.0, 0.7, 260.0, 290.0, 2.0, EntityKind::Bolt, at(10, 15)), RANGER, &[], &[]),
        I::EmberStaff => item(
            "Ember Staff",
            "weapon_red_magic_staff",
            melee(K::Staff, 6.0, 1.0, 1.6, 0.0, phys(), At::BASE),
            WIZARD,
            &[],
            &[mag!(PropKind::DamageShare(DamageType::Heat, 0.25)), mag!(PropKind::Light(LightKind::Fire))],
        ),
        I::StaffOfRot => item(
            "Staff of Rot",
            "weapon_green_magic_staff",
            melee(K::Staff, 6.0, 1.0, 1.6, 0.0, phys(), At::BASE),
            WIZARD,
            &[Requirement::Attr(Attr::Int, 14)],
            &[
                plain!(PropKind::DamageShare(DamageType::Poison, 0.3)),
                plain!(PropKind::OnHit(OnHit { kind: EffectKind::Poisoned, secs: 3.0, chance: 0.15, magical: false, power: 0 })),
            ],
        ),
        I::BoneStaff => item(
            "Bone Staff",
            "weapon_lich_staff",
            melee(K::Staff, 7.0, 1.0, 1.6, 0.0, phys(), At::BASE),
            WIZARD,
            &[Requirement::Attr(Attr::Int, 18)],
            &[mag!(PropKind::Light(LightKind::Magic))],
        ),
        I::Knife => item("Knife", "weapon_knife", melee(K::Dagger, 14.0, 0.45, 1.2, 0.0, phys(), At::BASE), ALL, &[], &[]),
        I::GoldenSword => item("Golden Sword", "weapon_golden_sword", melee(K::Sword, 22.0, 0.5, 1.8, 0.0, phys(), At::BASE), ALL, &[], &[mag!(PropKind::Light(LightKind::Holy))]),
        I::FlameTongue => item(
            "Flame Tongue",
            "weapon_red_gem_sword",
            melee(K::Sword, 18.0, 0.5, 1.75, 0.0, phys(), At::BASE),
            ALL,
            &[Requirement::Attr(Attr::Str, 13)],
            &[mag!(PropKind::DamageShare(DamageType::Heat, 0.5))],
        ),
        I::ShortBow => item("Short Bow", "weapon_bow", ranged(K::Bow, 12.0, 0.77, 220.0, 260.0, 2.0, EntityKind::Bolt, At::BASE), ALL, &[], &[]),
        I::SilkRobe => item("Silk Robe", "", armor(ArmorClass::Cloth, 0.05, 1.0), ALL, &[], &[mag!(PropKind::Resist(DamageType::Magical, 0.10))]),
        I::LeatherArmor => item("Leather Armor", "", armor(ArmorClass::Light, 0.08, 2.0), ALL, &[], &[]),
        I::ChainMail => item("Chain Mail", "", armor(ArmorClass::Medium, 0.15, 4.0), ALL, &[], &[]),
        I::PlateArmor => item("Plate Armor", "", armor(ArmorClass::Heavy, 0.25, 7.0), ALL, &[], &[]),
        I::RingOfEmbers => item("Ring of Embers", "", ItemBase::Ring, ALL, &[], &[mag!(PropKind::Resist(DamageType::Heat, 0.15))]),
        I::BandOfVigor => item("Band of Vigor", "", ItemBase::Ring, ALL, &[], &[mag!(PropKind::Attr(Attr::Con, 1))]),
        I::RingOfInsight => item("Ring of Insight", "", ItemBase::Ring, ALL, &[], &[mag!(PropKind::Attr(Attr::Int, 1))]),
        I::BootsOfHaste => item("Boots of Haste", "", ItemBase::Shoes, ALL, &[], &[mag!(PropKind::MoveSpeed(0.05))]),
        I::IronBoots => item("Iron Boots", "", ItemBase::Shoes, ALL, &[], &[mag!(PropKind::Weight(3.0)), mag!(PropKind::MoveSpeed(-0.05))]),
        I::GirdleOfWarding => item("Girdle of Warding", "", ItemBase::Belt, ALL, &[], &[mag!(PropKind::EffectResist(EffectKind::Blind, 1.0)), mag!(PropKind::MaxHp(10.0))]),
        I::GoblinBow => item("Goblin Bow", "weapon_bow", ranged(K::Bow, 6.0, 1.4, 140.0, 170.0, 3.0, EntityKind::Arrow, at(8, 15)), ALL, &[], &[]),
        I::RustySword => item("Rusty Sword", "weapon_rusty_sword", melee(K::Sword, 9.0, 1.0, 1.6, 0.0, phys(), at(12, 12)), ALL, &[], &[]),
        I::SkeletonLongbow => item("Skeleton Longbow", "weapon_bow_2", ranged(K::Longbow, 7.0, 1.6, 150.0, 180.0, 3.0, EntityKind::Arrow, at(10, 15)), ALL, &[], &[]),
        I::Cleaver => item("Cleaver", "weapon_cleaver", melee(K::Axe, 14.0, 1.2, 1.8, 20.0, phys(), at(16, 12)), ALL, &[], &[]),
        I::OrcBow => item("Orc Bow", "weapon_bow", ranged(K::Bow, 10.0, 1.7, 150.0, 190.0, 3.0, EntityKind::Arrow, at(14, 14)), ALL, &[], &[]),
        I::SpikedClub => item("Spiked Club", "weapon_baton_with_spikes", melee(K::Club, 18.0, 1.6, 2.0, 28.0, phys(), at(19, 8)), ALL, &[], &[]),
        I::MimicBite => item("Mimic Bite", "", melee(K::Bite, 13.0, 1.0, 1.0, 0.0, phys(), at(17, 12)), ALL, &[], &[]),
        I::ImpClaws => item("Imp Claws", "", melee(K::Claws, 6.0, 0.9, 1.6, 0.0, heat(), at(6, 17)), ALL, &[], &[]),
        I::ChortClaws => item("Chort Claws", "", melee(K::Claws, 9.0, 1.0, 1.6, 14.0, heat(), at(14, 13)), ALL, &[], &[]),
        I::UnarmedStrike => item("Unarmed Strike", "", melee(K::Unarmed, 3.0, 1.0, 1.4, 0.0, phys(), At::BASE), ALL, &[], &[]),
        I::Bite => item("Bite", "", melee(K::Bite, 8.0, 1.0, 1.0, 0.0, phys(), At::BASE), ALL, &[], &[]),
        I::Claws => item("Claws", "", melee(K::Claws, 6.0, 0.8, 1.6, 0.0, heat(), At::BASE), ALL, &[], &[]),
        I::BeastBite => item("Beast Bite", "", melee(K::Bite, 10.0, 0.9, 1.0, 0.0, DamageSplit::split(&[(DamageType::Magical, 0.2)]), At::BASE), ALL, &[], &[]),
        I::Tail => item("Tail", "", melee(K::Tail, 10.0, 1.25, 2.4, 10.0, phys(), At::BASE), ALL, &[], &[]),
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EquipError {
    WrongSlot,
    ClassNotListed,
    NotProficient,
    Requirement(Requirement),
}

/// Whether `item` can be worn by `class` in `slot`. `attrs` are the Attributes
/// without item points. Order: slot, class, proficiency, requirements.
pub fn check_equip(class: ClassId, slot: EquipSlot, item: ItemId, attrs: &Attributes) -> Result<(), EquipError> {
    let d = def(item);
    let fits = match (slot, d.base) {
        (EquipSlot::Melee, ItemBase::Melee(k, _)) => category(k) != WeaponCategory::Natural,
        (EquipSlot::Ranged, ItemBase::Ranged(..)) => true,
        (EquipSlot::Armor, ItemBase::Armor(_)) => true,
        (EquipSlot::Ring1 | EquipSlot::Ring2, ItemBase::Ring) => true,
        (EquipSlot::Shoes, ItemBase::Shoes) => true,
        (EquipSlot::Belt, ItemBase::Belt) => true,
        _ => false,
    };
    if !fits {
        return Err(EquipError::WrongSlot);
    }
    if !d.classes.contains(&class) {
        return Err(EquipError::ClassNotListed);
    }
    let cd = classes::def(class);
    let proficient = match d.base {
        ItemBase::Melee(k, _) | ItemBase::Ranged(k, _) => cd.weapons.contains(&k),
        ItemBase::Armor(a) => a.class <= cd.max_armor,
        _ => true,
    };
    if !proficient {
        return Err(EquipError::NotProficient);
    }
    match d.req.iter().find(|r| !r.met(attrs)) {
        Some(r) => Err(EquipError::Requirement(*r)),
        None => Ok(()),
    }
}

/// Checks every filled slot, in slot order.
pub fn check_equipment(class: ClassId, e: &Equipment, attrs: &Attributes) -> Result<(), (EquipSlot, EquipError)> {
    for slot in EquipSlot::ALL {
        if let Some(item) = e.get(slot) {
            check_equip(class, slot, item, attrs).map_err(|err| (slot, err))?;
        }
    }
    Ok(())
}

fn heat() -> DamageSplit {
    DamageSplit::split(&[(DamageType::Heat, 0.2)])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::attributes::Attr;
    use crate::defs::damage::{DamageSplit, DamageType};
    use crate::defs::weapons::{category, At, WeaponCategory as C, WeaponKind as K};

    #[test]
    fn item_data_follows_the_rules() {
        for id in ItemId::ALL {
            let d = def(id);
            assert_eq!(d.id, id);
            assert!(!d.classes.is_empty(), "{id:?}");
            let weapon = matches!(d.base, ItemBase::Melee(..) | ItemBase::Ranged(..));
            if matches!(d.base, ItemBase::Ring | ItemBase::Shoes | ItemBase::Belt) {
                assert!(d.props.iter().all(|p| p.magical), "{id:?}");
            }
            let on_hits = d.props.iter().filter(|p| matches!(p.kind, PropKind::OnHit(_))).count();
            assert!(on_hits <= 1, "{id:?}");
            for p in d.props {
                if matches!(p.kind, PropKind::DamageShare(..) | PropKind::OnHit(_)) {
                    assert!(weapon, "{id:?}");
                }
                assert!(!matches!(p.kind, PropKind::DamageShare(DamageType::Physical, _)), "{id:?}");
            }
            match d.base {
                ItemBase::Melee(k, _) => assert!(matches!(category(k), C::Melee | C::Finesse | C::Natural), "{id:?}"),
                ItemBase::Ranged(k, _) => assert!(matches!(category(k), C::Ranged | C::Thrown), "{id:?}"),
                ItemBase::Shield => panic!("{id:?} uses Shield"),
                _ => {}
            }
            let natural = matches!(d.base, ItemBase::Melee(k, _) | ItemBase::Ranged(k, _) if category(k) == C::Natural);
            if weapon && !natural {
                assert!(!d.sprite.is_empty(), "{id:?}");
            }
        }
    }

    #[test]
    fn every_item_sprite_is_in_the_atlas() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client/public/assets/atlas.json");
        let atlas: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let frames = atlas["frames"].as_object().unwrap();
        for id in ItemId::ALL {
            let s = def(id).sprite;
            assert!(s.is_empty() || frames.contains_key(s), "{id:?}: {s}");
        }
    }

    #[test]
    fn items_carry_the_listed_numbers() {
        match def(ItemId::GreatAxe).base {
            ItemBase::Melee(k, s) => {
                assert_eq!(k, K::Axe);
                assert_eq!((s.damage, s.cooldown, s.arc, s.push), (32.0, 0.8, 2.45, 0.0));
                assert_eq!(s.split, DamageSplit::physical());
                assert_eq!(s.at, At { str: 15, dex: 13 });
            }
            _ => panic!(),
        }
        match def(ItemId::ImpClaws).base {
            ItemBase::Melee(_, s) => assert_eq!(s.split.share(DamageType::Heat), 0.2),
            _ => panic!(),
        }
        match def(ItemId::BeastBite).base {
            ItemBase::Melee(_, s) => assert_eq!(s.split.share(DamageType::Magical), 0.2),
            _ => panic!(),
        }
        assert_eq!(def(ItemId::StaffOfRot).req, &[Requirement::Attr(Attr::Int, 14)]);
    }

    use crate::defs::attributes::Attributes;
    use crate::defs::classes::start_attrs;
    use EquipSlot as S;
    use ItemId as I;

    fn ok(c: ClassId, slot: EquipSlot, item: ItemId) -> Result<(), EquipError> {
        check_equip(c, slot, item, &start_attrs(c))
    }

    #[test]
    fn starters_are_valid() {
        for c in ClassId::ALL {
            assert_eq!(check_equipment(c, &Equipment::starter(c), &start_attrs(c)), Ok(()), "{c:?}");
        }
        assert_eq!(Equipment::starter(ClassId::ElvenRanger).get(S::Ranged), Some(I::ElvenBow));
        assert_eq!(Equipment::starter(ClassId::Wizard).get(S::Ranged), None);
    }

    #[test]
    fn proficiency_gates_weapons_and_armor() {
        use ClassId as C;
        assert_eq!(ok(C::Wizard, S::Melee, I::KnightSword), Err(EquipError::NotProficient));
        assert_eq!(ok(C::Wizard, S::Melee, I::Knife), Ok(()));
        assert_eq!(ok(C::Paladin, S::Armor, I::PlateArmor), Ok(()));
        assert_eq!(ok(C::Barbarian, S::Armor, I::PlateArmor), Err(EquipError::NotProficient));
        assert_eq!(ok(C::Barbarian, S::Armor, I::ChainMail), Ok(()));
        assert_eq!(ok(C::ElvenRanger, S::Armor, I::ChainMail), Err(EquipError::NotProficient));
        assert_eq!(ok(C::ElvenRanger, S::Armor, I::LeatherArmor), Ok(()));
        assert_eq!(ok(C::ElvenRanger, S::Armor, I::SilkRobe), Ok(()));
        assert_eq!(ok(C::Barbarian, S::Melee, I::Cleaver), Ok(()));
    }

    #[test]
    fn slots_take_their_own_bases() {
        use ClassId as C;
        assert_eq!(ok(C::Paladin, S::Ring1, I::BandOfVigor), Ok(()));
        assert_eq!(ok(C::Paladin, S::Ring2, I::BandOfVigor), Ok(()));
        assert_eq!(ok(C::Paladin, S::Shoes, I::BandOfVigor), Err(EquipError::WrongSlot));
        assert_eq!(ok(C::Paladin, S::Shoes, I::IronBoots), Ok(()));
        assert_eq!(ok(C::Paladin, S::Belt, I::GirdleOfWarding), Ok(()));
        assert_eq!(ok(C::Paladin, S::Melee, I::Claws), Err(EquipError::WrongSlot));
        assert_eq!(ok(C::Paladin, S::OffHand, I::Knife), Err(EquipError::WrongSlot));
        assert_eq!(ok(C::Paladin, S::OffHand, I::SilkRobe), Err(EquipError::WrongSlot));
        assert_eq!(ok(C::ElvenRanger, S::Melee, I::ElvenBow), Err(EquipError::WrongSlot));
        assert_eq!(ok(C::ElvenRanger, S::Ranged, I::ElvenBow), Ok(()));
    }

    #[test]
    fn classes_restrict_items() {
        assert_eq!(ok(ClassId::Paladin, S::Melee, I::StaffOfRot), Err(EquipError::ClassNotListed));
        assert_eq!(ok(ClassId::Barbarian, S::Ranged, I::ElvenBow), Err(EquipError::ClassNotListed));
    }

    #[test]
    fn item_requirements_ignore_item_points() {
        let c = ClassId::Wizard;
        let low = start_attrs(c).plus(Attributes::new(0, 0, 0, -2, 0, 0));
        let want = EquipError::Requirement(Requirement::Attr(Attr::Int, 14));
        assert_eq!(check_equip(c, S::Melee, I::StaffOfRot, &low), Err(want));
        let e = Equipment::default().with(S::Melee, I::StaffOfRot).with(S::Ring1, I::RingOfInsight);
        assert_eq!(check_equipment(c, &e, &low), Err((S::Melee, want)));
        let ok14 = start_attrs(c).plus(Attributes::new(0, 0, 0, -1, 0, 0));
        assert_eq!(check_equipment(c, &e, &ok14), Ok(()));
    }
}
