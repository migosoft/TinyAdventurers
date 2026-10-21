//! Weapon kinds, their categories and stats. A weapon's numbers are stored as
//! their values at the Attributes of a reference wielder (`At`), so the
//! weapon resolves bit-exactly to them there and moves with STR and DEX around it.

use super::attributes::{Attr, Attributes, Scaled, DEX_ARC, DEX_DMG, DEX_SPEED, STR_DMG, STR_RANGE};
use super::damage::{Base, BaseScale, DamageSplit};
use super::effects::OnHit;
use super::kinds::EntityKind;

super::enum_list::listed_enum! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub enum WeaponKind: u8 {
        Sword = 0,
        Axe = 1,
        Hammer = 2,
        Mace = 3,
        Club = 4,
        Spear = 5,
        Staff = 6,
        Dagger = 7,
        DuellingSword = 8,
        Katana = 9,
        Machete = 10,
        Bow = 11,
        Longbow = 12,
        Crossbow = 13,
        ThrowingAxe = 14,
        Unarmed = 15,
        Bite = 16,
        Claws = 17,
        Tail = 18,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeaponCategory {
    Melee,
    Finesse,
    Ranged,
    Thrown,
    Natural,
}

/// A new kind without a category does not compile.
pub fn category(k: WeaponKind) -> WeaponCategory {
    use WeaponCategory as C;
    use WeaponKind as K;
    match k {
        K::Sword | K::Axe | K::Hammer | K::Mace | K::Club | K::Spear | K::Staff => C::Melee,
        K::Dagger | K::DuellingSword | K::Katana | K::Machete => C::Finesse,
        K::Bow | K::Longbow | K::Crossbow => C::Ranged,
        K::ThrowingAxe => C::Thrown,
        K::Unarmed | K::Bite | K::Claws | K::Tail => C::Natural,
    }
}

/// The Attribute that governs a category's damage (and the power of its effects).
pub fn key_attr(c: WeaponCategory) -> Attr {
    match c {
        WeaponCategory::Melee | WeaponCategory::Thrown | WeaponCategory::Natural => Attr::Str,
        WeaponCategory::Finesse | WeaponCategory::Ranged => Attr::Dex,
    }
}

/// The STR and DEX at which a weapon's stored numbers hold.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct At {
    pub str: i32,
    pub dex: i32,
}

impl At {
    /// Sample items.
    pub const BASE: At = At { str: 10, dex: 10 };
}

/// `cooldown` is the time between attacks in seconds.
#[derive(Debug, Clone, Copy)]
pub struct MeleeStats {
    pub damage: f64,
    pub cooldown: f64,
    pub arc: f64,
    pub push: f64,
    pub split: DamageSplit,
    pub at: At,
}

#[derive(Debug, Clone, Copy)]
pub struct RangedStats {
    pub damage: f64,
    pub cooldown: f64,
    pub range: f64,
    pub projectile_speed: f64,
    pub radius: f64,
    pub projectile: EntityKind,
    pub split: DamageSplit,
    pub at: At,
}

/// A weapon's numbers for one wielder. Fields that do not apply are 0 or `None`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolvedWeapon {
    pub kind: WeaponKind,
    pub damage: f64,
    /// `damage` as its breakdown: `damage == base.amount()`.
    pub base: Base,
    pub cooldown: f64,
    pub arc: f64,
    pub push: f64,
    pub range: f64,
    pub projectile_speed: f64,
    pub radius: f64,
    pub projectile: Option<EntityKind>,
    pub split: DamageSplit,
    pub on_hit: Option<OnHit>,
    /// The wielder's key Attribute: the power of the weapon's effects.
    pub power: i32,
    /// Enemies its shots pass with full damage (the sum of its `PropKind::Pierce`).
    pub pierce_through: u8,
}

/// Damage by the category's key Attribute, cooldown by DEX.
fn damage_and_cooldown(kind: WeaponKind, damage: f64, cooldown: f64, at: At, a: &Attributes) -> (f64, f64, BaseScale) {
    let (attr, pct, at_key) = match key_attr(category(kind)) {
        Attr::Str => (Attr::Str, STR_DMG, at.str),
        Attr::Dex => (Attr::Dex, DEX_DMG, at.dex),
        other => unreachable!("key_attr returned {other:?}"),
    };
    let scaled = Scaled { value: damage, attr, pct, at: at_key };
    let ratio = scaled.ratio(a);
    let dmg = scaled.value * ratio;
    let cd = Scaled { value: cooldown, attr: Attr::Dex, pct: DEX_SPEED, at: at.dex }.per(a);
    (dmg, cd, BaseScale { attr, at: at_key, have: a.get(attr), ratio })
}

pub fn resolve_melee(kind: WeaponKind, s: &MeleeStats, attrs: &Attributes) -> ResolvedWeapon {
    let (damage, cooldown, scale) = damage_and_cooldown(kind, s.damage, s.cooldown, s.at, attrs);
    let base = Base { given: s.damage, scale: Some(scale), ability_mult: 1.0, mods_mult: 1.0, upgrade_mult: 1.0 };
    debug_assert_eq!(damage.to_bits(), base.amount().to_bits());
    ResolvedWeapon {
        kind,
        damage: base.amount(),
        base,
        cooldown,
        arc: Scaled { value: s.arc, attr: Attr::Dex, pct: DEX_ARC, at: s.at.dex }.get(attrs),
        push: s.push,
        range: 0.0,
        projectile_speed: 0.0,
        radius: 0.0,
        projectile: None,
        split: s.split,
        on_hit: None,
        power: attrs.get(key_attr(category(kind))),
        pierce_through: 0,
    }
}

pub fn resolve_ranged(kind: WeaponKind, s: &RangedStats, attrs: &Attributes) -> ResolvedWeapon {
    let (damage, cooldown, scale) = damage_and_cooldown(kind, s.damage, s.cooldown, s.at, attrs);
    let base = Base { given: s.damage, scale: Some(scale), ability_mult: 1.0, mods_mult: 1.0, upgrade_mult: 1.0 };
    debug_assert_eq!(damage.to_bits(), base.amount().to_bits());
    ResolvedWeapon {
        kind,
        damage: base.amount(),
        base,
        cooldown,
        arc: 0.0,
        push: 0.0,
        range: Scaled { value: s.range, attr: Attr::Str, pct: STR_RANGE, at: s.at.str }.get(attrs),
        projectile_speed: Scaled { value: s.projectile_speed, attr: Attr::Str, pct: STR_RANGE, at: s.at.str }.get(attrs),
        radius: s.radius,
        projectile: Some(s.projectile),
        split: s.split,
        on_hit: None,
        power: attrs.get(key_attr(category(kind))),
        pierce_through: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::WeaponCategory as C;
    use super::WeaponKind as K;
    use super::*;

    fn sword() -> MeleeStats {
        MeleeStats { damage: 20.0, cooldown: 0.45, arc: 1.75, push: 0.0, split: DamageSplit::physical(), at: At { str: 15, dex: 8 } }
    }

    #[test]
    fn every_kind_has_its_category() {
        let table = [
            (K::Sword, C::Melee),
            (K::Axe, C::Melee),
            (K::Hammer, C::Melee),
            (K::Mace, C::Melee),
            (K::Club, C::Melee),
            (K::Spear, C::Melee),
            (K::Staff, C::Melee),
            (K::Dagger, C::Finesse),
            (K::DuellingSword, C::Finesse),
            (K::Katana, C::Finesse),
            (K::Machete, C::Finesse),
            (K::Bow, C::Ranged),
            (K::Longbow, C::Ranged),
            (K::Crossbow, C::Ranged),
            (K::ThrowingAxe, C::Thrown),
            (K::Unarmed, C::Natural),
            (K::Bite, C::Natural),
            (K::Claws, C::Natural),
            (K::Tail, C::Natural),
        ];
        assert_eq!(table.len(), WeaponKind::COUNT);
        for (k, c) in table {
            assert_eq!(category(k), c, "{k:?}");
        }
        for c in [C::Melee, C::Thrown, C::Natural] {
            assert_eq!(key_attr(c), Attr::Str);
        }
        for c in [C::Finesse, C::Ranged] {
            assert_eq!(key_attr(c), Attr::Dex);
        }
    }

    #[test]
    fn a_weapon_is_exact_at_its_reference() {
        let w = resolve_melee(K::Sword, &sword(), &Attributes::new(15, 8, 10, 10, 10, 10));
        assert_eq!(w.damage, 20.0);
        assert_eq!(w.cooldown, 0.45);
        assert_eq!(w.arc, 1.75);
    }

    #[test]
    fn strength_and_dexterity_move_the_right_numbers() {
        let strong = resolve_melee(K::Sword, &sword(), &Attributes::new(17, 8, 10, 10, 10, 10));
        assert!((strong.damage - 20.0 * 1.35 / 1.25).abs() < 1e-12);
        let nimble = resolve_melee(K::Sword, &sword(), &Attributes::new(15, 10, 10, 10, 10, 10));
        assert!((nimble.cooldown - 0.45 / (1.00 / 0.96)).abs() < 1e-12);
        assert!((nimble.arc - 1.75 * 1.00 / 0.94).abs() < 1e-12);

        let rapier = resolve_melee(K::DuellingSword, &sword(), &Attributes::new(15, 10, 10, 10, 10, 10));
        assert!((rapier.damage - 20.0 * 1.00 / 0.90).abs() < 1e-12, "finesse scales by DEX");
        let rapier_str = resolve_melee(K::DuellingSword, &sword(), &Attributes::new(17, 8, 10, 10, 10, 10));
        assert_eq!(rapier_str.damage, 20.0, "STR does not matter");

        let bow = RangedStats {
            damage: 16.0,
            cooldown: 0.7,
            range: 260.0,
            projectile_speed: 290.0,
            radius: 5.0,
            projectile: EntityKind::Arrow,
            split: DamageSplit::physical(),
            at: At { str: 10, dex: 15 },
        };
        let w = resolve_ranged(K::Bow, &bow, &Attributes::new(12, 15, 10, 10, 10, 10));
        assert!((w.range - 260.0 * 1.04).abs() < 1e-9);
        assert!((w.projectile_speed - 290.0 * 1.04).abs() < 1e-9);
        assert_eq!(w.damage, 16.0);
        assert_eq!(w.projectile, Some(EntityKind::Arrow));

        assert_eq!(resolve_melee(K::Sword, &sword(), &Attributes::new(15, 8, 10, 10, 10, 10)).power, 15);
        assert_eq!(w.power, 15);
    }
}
