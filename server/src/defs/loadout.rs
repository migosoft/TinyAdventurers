//! The loadout: which ability sits in each slot, and from where (the hero's own pool or a
//! worn item's version). A version is the ability with its item's `AbilityMod`s.

use super::abilities::{self as ab, AbilityDef, AbilityId, AbilitySlot};
use super::attributes::{Attr, Attributes};
use super::classes;
use super::damage::{Base, DamageType};
use super::effects::OnHit;
use super::items::{self, EquipError, EquipSlot, Equipment, PropKind};
use super::requirements::Requirement;
use super::trees::{self, NodeId};
use super::weapons::WeaponKind;
use crate::protocol::ClassId;
use crate::sheet::ResolvedAbility;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where a picked ability comes from.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub enum Source {
    /// The hero's own pool: the class start and what `Build.own` unlocked.
    Own,
    /// The version granted by the item worn in this slot.
    Item(EquipSlot),
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub struct Pick {
    pub ability: AbilityId,
    pub source: Source,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Loadout {
    pub primary: Pick,
    pub secondary: Pick,
}

impl Loadout {
    /// The class's two starting abilities, from its own pool.
    pub fn start(class: ClassId) -> Loadout {
        let d = classes::def(class);
        Loadout { primary: Pick { ability: d.primary, source: Source::Own }, secondary: Pick { ability: d.secondary, source: Source::Own } }
    }
}

/// How an item's version changes an ability. Additions are summed and multipliers
/// multiplied, so the order never matters (`apply_mods`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AbilityMod {
    /// More enemies hit by overkill.
    Pierce(u8),
    /// More enemies passed through with full damage. No item or node uses it yet.
    #[allow(dead_code)]
    PierceThrough(u8),
    RadiusMul(f64),
    RangeMul(f64),
    DurationAdd(f64),
    /// No item or node uses it yet.
    #[allow(dead_code)]
    CooldownAdd(f64),
    DamageMul(f64),
    ArcMul(f64),
    /// A non-physical share added to the split. No item or node uses it yet.
    #[allow(dead_code)]
    AddShare(DamageType, f64),
    PushStr(i32),
    /// An effect on its hits (a `power` of 0 takes the ability's own).
    AddOnHit(OnHit),
    /// Radians added to the half-angle of the "from behind" cone.
    BehindArc(f64),
    /// The summoned wolf's max HP (read by `sheet::wolf_mods`).
    CompanionHpMul(f64),
    /// The summoned wolf's dash cooldown (read by `sheet::wolf_mods`).
    CompanionDashCooldownAdd(f64),
}

/// The product of `xs`, multiplied in a fixed order so the result never depends on theirs.
fn product(mut xs: Vec<f64>) -> f64 {
    xs.sort_by(f64::total_cmp);
    xs.into_iter().product()
}

/// The sum of `xs`, added in a fixed order so the result never depends on theirs.
fn sum(mut xs: Vec<f64>) -> f64 {
    xs.sort_by(f64::total_cmp);
    xs.into_iter().sum()
}

/// The shortest cooldown mods can give an ability (three ticks at 60 Hz), so `CooldownAdd` never
/// drives it to 0 or below (`companion::wolf_died` divides by it, too).
pub const MIN_COOLDOWN: f64 = 0.05;

/// `r` with a version's mods.
pub fn apply_mods(r: ResolvedAbility, mods: &[AbilityMod]) -> ResolvedAbility {
    use AbilityMod::*;
    let (mut radius, mut range, mut damage, mut arc) = (vec![], vec![], vec![], vec![]);
    let (mut duration, mut cooldown, mut behind) = (vec![], vec![], vec![]);
    let mut on_hit = r.on_hit;
    let mut shares: Vec<(DamageType, f64)> = vec![];
    let (mut pierce, mut through, mut push_str) = (r.pierce, r.pierce_through, r.push_str);
    for &m in mods {
        match m {
            Pierce(n) => pierce = pierce.saturating_add(n),
            PierceThrough(n) => through = through.saturating_add(n),
            RadiusMul(f) => radius.push(f),
            RangeMul(f) => range.push(f),
            DurationAdd(s) => duration.push(s),
            CooldownAdd(s) => cooldown.push(s),
            DamageMul(f) => damage.push(f),
            ArcMul(f) => arc.push(f),
            AddShare(t, v) => {
                debug_assert!(t != DamageType::Physical, "AddShare names Physical");
                shares.push((t, v));
            }
            PushStr(n) => push_str += n,
            AddOnHit(h) => on_hit = Some(OnHit { power: if h.power == 0 { r.power } else { h.power }, ..h }),
            BehindArc(a) => behind.push(a),
            CompanionHpMul(_) | CompanionDashCooldownAdd(_) => {}
        }
    }
    // `with_shares` sums the added shares: sort them so their order does not matter either.
    shares.sort_by(|a, b| (a.0 as u8).cmp(&(b.0 as u8)).then(a.1.total_cmp(&b.1)));
    let longer = !duration.is_empty();
    let new_duration = (r.duration + sum(duration)).max(0.0);
    let base = Base { mods_mult: r.base.mods_mult * product(damage), ..r.base };
    ResolvedAbility {
        // Clamped: a negative factor or a large negative add never makes a number negative.
        radius: (r.radius * product(radius)).max(0.0),
        range: (r.range * product(range)).max(0.0),
        damage: base.amount(),
        base,
        arc: (r.arc * product(arc)).max(0.0),
        duration: new_duration,
        // The ability's own effect lasts as long as the ability does.
        effect: if longer { r.effect.map(|e| OnHit { secs: new_duration, ..e }) } else { r.effect },
        cooldown: if cooldown.is_empty() { r.cooldown } else { (r.cooldown + sum(cooldown)).max(MIN_COOLDOWN) },
        split: if shares.is_empty() { r.split } else { r.split.with_shares(&shares) },
        behind: (r.behind + sum(behind)).max(0.0),
        on_hit,
        pierce,
        pierce_through: through,
        push_str,
        ..r
    }
}

/// Everything a hero brings into a run besides the class.
#[derive(Debug, Clone, PartialEq)]
pub struct Build {
    /// Attribute points on top of the class's start Attributes (the shop, and the debug lift).
    pub extra: Attributes,
    /// The owned skill-tree nodes.
    pub nodes: Vec<NodeId>,
    pub equipment: Equipment,
    pub loadout: Loadout,
    /// Abilities unlocked beyond the class start and the tree (the debug pool only).
    pub own: Vec<AbilityId>,
}

impl Build {
    /// The class start: starter weapons, the starting abilities, no extra points or nodes.
    pub fn start(class: ClassId) -> Build {
        Build { extra: Attributes::default(), nodes: Vec::new(), equipment: Equipment::starter(class), loadout: Loadout::start(class), own: Vec::new() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LoadoutError {
    Equip(EquipSlot, EquipError),
    /// Neither the hero's pool nor the named item holds it.
    NotInPool(AbilityId),
    WrongSlot(AbilityId),
    Requirement(AbilityId, Requirement),
    /// It uses the weapon of this slot, and the slot is empty.
    NoWeapon(AbilityId, EquipSlot),
}

fn slot_name(s: EquipSlot) -> &'static str {
    match s {
        EquipSlot::Melee => "melee",
        EquipSlot::Ranged => "ranged",
        EquipSlot::OffHand => "off-hand",
        EquipSlot::Armor => "armor",
        EquipSlot::Ring1 => "first ring",
        EquipSlot::Ring2 => "second ring",
        EquipSlot::Shoes => "shoes",
        EquipSlot::Belt => "belt",
    }
}

fn attr_name(a: Attr) -> &'static str {
    match a {
        Attr::Str => "STR",
        Attr::Dex => "DEX",
        Attr::Con => "CON",
        Attr::Int => "INT",
        Attr::Wil => "WIL",
        Attr::Cha => "CHA",
    }
}

pub fn requirement_text(r: &Requirement) -> String {
    match *r {
        Requirement::Attr(a, n) => format!("{} {n}", attr_name(a)),
        Requirement::WeaponKind(kinds) => {
            let names: Vec<String> = kinds.iter().map(|k| crate::sheet::spaced(&format!("{k:?}"))).collect();
            format!("a weapon of kind {}", names.join(" or "))
        }
    }
}

impl LoadoutError {
    /// What the player reads.
    pub fn message(&self) -> String {
        let name = |id: AbilityId| ab::def(id).name;
        match *self {
            LoadoutError::Equip(slot, e) => {
                let s = slot_name(slot);
                match e {
                    EquipError::WrongSlot => format!("That item does not fit the {s} slot."),
                    EquipError::ClassNotListed => format!("Your class cannot use the item in the {s} slot."),
                    EquipError::NotProficient => format!("You are not trained in the item in the {s} slot."),
                    EquipError::Requirement(r) => format!("The item in the {s} slot needs {}.", requirement_text(&r)),
                }
            }
            LoadoutError::NotInPool(id) => format!("{} is not one of your abilities.", name(id)),
            LoadoutError::WrongSlot(id) => {
                let other = match ab::def(id).slot {
                    AbilitySlot::Primary => "secondary",
                    AbilitySlot::Secondary => "primary",
                };
                format!("{} cannot go in the {other} slot.", name(id))
            }
            LoadoutError::Requirement(id, r) => format!("{} needs {}.", name(id), requirement_text(&r)),
            LoadoutError::NoWeapon(id, slot) => format!("{} needs a {} weapon.", name(id), slot_name(slot)),
        }
    }
}

/// The version `p` names for `slot`: its mods and whether it waives the Attribute
/// requirements. Order: the def's slot, then the source.
pub fn pick_version(class: ClassId, b: &Build, slot: AbilitySlot, p: Pick) -> Result<(&'static [AbilityMod], bool), LoadoutError> {
    let id = p.ability;
    let d = ab::def(id);
    if d.slot != slot {
        return Err(LoadoutError::WrongSlot(id));
    }
    match p.source {
        Source::Own => {
            let cd = classes::def(class);
            let pooled = cd.primary == id || cd.secondary == id || b.own.contains(&id) || trees::gains(&b.nodes).unlocks.contains(&id);
            if pooled && d.classes.contains(&class) {
                Ok((&[], false))
            } else {
                Err(LoadoutError::NotInPool(id))
            }
        }
        Source::Item(s) => b
            .equipment
            .get(s)
            .and_then(|item| {
                items::def(item).props.iter().find_map(|prop| match prop.kind {
                    PropKind::GrantAbility { id: granted, mods, waive_attrs } if granted == id => Some((mods, waive_attrs)),
                    PropKind::GrantAbility { .. }
                    | PropKind::DamageShare(..)
                    | PropKind::OnHit(_)
                    | PropKind::Light(_)
                    | PropKind::Resist(..)
                    | PropKind::Attr(..)
                    | PropKind::EffectResist(..)
                    | PropKind::Weight(_)
                    | PropKind::MoveSpeed(_)
                    | PropKind::MaxHp(_)
                    | PropKind::Pierce(_) => None,
                })
            })
            .ok_or(LoadoutError::NotInPool(id)),
    }
}

/// Whether a hero can use `d`. `attrs` count item points; `waive_attrs` (the version's)
/// skips the Attribute requirements. `weapon` is the kind in the slot the ability uses:
/// weapon-kind requirements are always checked.
pub fn check_pick(d: &AbilityDef, waive_attrs: bool, attrs: &Attributes, weapon: Option<WeaponKind>) -> Result<(), LoadoutError> {
    for r in d.req {
        let checked = match r {
            Requirement::Attr(..) => !waive_attrs,
            Requirement::WeaponKind(_) => true,
        };
        if checked && !r.met(attrs, weapon) {
            return Err(LoadoutError::Requirement(d.id, *r));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities::{def, AbilityId::*};
    use crate::defs::attributes::{Attr, Attributes};
    use crate::defs::items::{EquipSlot, Equipment, ItemId};
    use crate::defs::requirements::Requirement;
    use crate::defs::weapons::WeaponKind;
    use crate::protocol::ClassId;
    use crate::sheet::{hero_sheet, ResolvedAbility};

    fn shoot() -> ResolvedAbility {
        hero_sheet(ClassId::ElvenRanger, &Build::start(ClassId::ElvenRanger)).unwrap().primary
    }

    #[test]
    fn mods_stack_in_any_order() {
        use AbilityMod::*;
        let r = hero_sheet(ClassId::Wizard, &Build::start(ClassId::Wizard)).unwrap().secondary;
        let mods = [DamageMul(1.1), DamageMul(0.5), CooldownAdd(-1.0), RadiusMul(1.2), CooldownAdd(0.5)];
        let mut rev = mods;
        rev.reverse();
        let a = apply_mods(r, &mods);
        assert_eq!(a, apply_mods(r, &rev));
        assert!((a.damage - r.damage * 0.55).abs() < 1e-9, "{}", a.damage);
        assert!((a.cooldown - (r.cooldown - 0.5)).abs() < 1e-12);
        assert!((a.radius - r.radius * 1.2).abs() < 1e-12);
        assert_eq!((a.range, a.arc, a.speed, a.duration, a.pierce), (r.range, r.arc, r.speed, r.duration, r.pierce));
    }

    #[test]
    fn each_mod_moves_its_number() {
        use crate::defs::damage::DamageType;
        use AbilityMod::*;
        let r = hero_sheet(ClassId::Barbarian, &Build::start(ClassId::Barbarian)).unwrap().secondary;
        let a = apply_mods(r, &[RangeMul(2.0), DurationAdd(0.1), ArcMul(0.5), AddShare(DamageType::Heat, 0.25), PushStr(3), PierceThrough(2)]);
        assert_eq!((a.range, a.arc, a.push_str, a.pierce_through), (r.range * 2.0, r.arc * 0.5, r.push_str + 3, 2));
        assert!((a.duration - (r.duration + 0.1)).abs() < 1e-12);
        assert!((a.split.share(DamageType::Heat) - 0.25).abs() < 1e-12 && (a.split.share(DamageType::Physical) - 0.75).abs() < 1e-12);
        let c = apply_mods(r, &[CompanionHpMul(2.0), CompanionDashCooldownAdd(-1.0)]);
        assert_eq!(c, r, "the companion mods leave the ability alone");
    }

    #[test]
    fn mods_never_drive_a_number_below_its_floor() {
        use AbilityMod::*;
        let r = hero_sheet(ClassId::Wizard, &Build::start(ClassId::Wizard)).unwrap().secondary;
        let a = apply_mods(r, &[CooldownAdd(-100.0), DurationAdd(-100.0), DamageMul(-1.0), RadiusMul(-1.0), RangeMul(-1.0), ArcMul(-1.0)]);
        assert_eq!(a.cooldown, MIN_COOLDOWN, "a cooldown never reaches 0");
        assert_eq!((a.duration, a.damage, a.radius, a.range, a.arc), (0.0, 0.0, 0.0, 0.0, 0.0), "no negative numbers");
        assert_eq!(apply_mods(r, &[]).cooldown, r.cooldown, "no mods, no floor");
    }

    #[test]
    fn a_duration_mod_lengthens_the_own_effect() {
        let r = hero_sheet(ClassId::Wizard, &Build::start(ClassId::Wizard)).unwrap().secondary;
        let mut r = r;
        r.effect = Some(OnHit { kind: crate::defs::effects::EffectKind::Accelerated, secs: r.duration, magical: true, power: 5, look: crate::defs::effects::EffectLook::Plain });
        let a = apply_mods(r, &[AbilityMod::DurationAdd(2.0)]);
        assert_eq!(a.duration, r.duration + 2.0);
        assert_eq!(a.effect.unwrap().secs, a.duration, "the effect follows the duration");
        assert_eq!(apply_mods(r, &[]).effect, r.effect, "no mod, no change");
    }

    #[test]
    fn add_on_hit_and_behind_arc_mods() {
        use crate::defs::effects::{EffectKind, EffectLook, OnHit};
        let r = hero_sheet(ClassId::Paladin, &Build::start(ClassId::Paladin)).unwrap().primary;
        assert_eq!(r.id, Strike);
        let hit = OnHit { kind: EffectKind::Poisoned, secs: 2.0, magical: true, power: 0, look: EffectLook::Plain };
        let a = apply_mods(r, &[AbilityMod::AddOnHit(hit)]);
        assert_eq!(a.on_hit, Some(OnHit { power: r.power, ..hit }), "a power of 0 takes the ability's");
        let own = OnHit { power: 17, ..hit };
        assert_eq!(apply_mods(r, &[AbilityMod::AddOnHit(own)]).on_hit, Some(own));
        let b = ResolvedAbility { behind: 1.0, ..r };
        assert_eq!(apply_mods(b, &[AbilityMod::BehindArc(0.5), AbilityMod::BehindArc(0.5)]).behind, 2.0);
        assert_eq!(apply_mods(b, &[AbilityMod::BehindArc(-5.0)]).behind, 0.0);
        assert_eq!(apply_mods(r, &[]).behind, 0.0);
    }

    #[test]
    fn pierce_saturates() {
        let s = apply_mods(shoot(), &[AbilityMod::Pierce(200), AbilityMod::Pierce(200)]);
        assert_eq!(s.pierce, u8::MAX);
        let m = apply_mods(hero_sheet(ClassId::Wizard, &Build::start(ClassId::Wizard)).unwrap().primary, &[AbilityMod::PierceThrough(200), AbilityMod::PierceThrough(200)]);
        assert_eq!(m.pierce_through, u8::MAX);
    }

    #[test]
    fn the_start_loadout_is_valid() {
        for c in ClassId::ALL {
            let b = Build::start(c);
            assert!(b.own.is_empty());
            assert_eq!(b.loadout, Loadout::start(c));
            assert_eq!(b.loadout.primary.source, Source::Own);
            assert!(hero_sheet(c, &b).is_ok(), "{c:?}: {:?}", hero_sheet(c, &b).err());
        }
    }

    fn paladin_with_rings(primary: Pick) -> Build {
        let c = ClassId::Paladin;
        let mut b = Build::start(c);
        b.equipment = Equipment::starter(c).with(EquipSlot::Ring1, ItemId::RingOfTheMagus).with(EquipSlot::Ring2, ItemId::SeekersBand);
        b.loadout.primary = primary;
        b
    }

    #[test]
    fn item_versions_are_independent() {
        let c = ClassId::Paladin;
        let magus = hero_sheet(c, &paladin_with_rings(Pick { ability: MagicMissile, source: Source::Item(EquipSlot::Ring1) })).unwrap();
        let seeker = hero_sheet(c, &paladin_with_rings(Pick { ability: MagicMissile, source: Source::Item(EquipSlot::Ring2) })).unwrap();
        // The missile as the Paladin casts it, without any version's mods.
        let missile = seeker.primary.damage;
        assert_eq!(magus.primary.id, MagicMissile);
        assert!((magus.primary.damage - missile * 0.75).abs() < 1e-12);
        assert_eq!(magus.primary.pierce, 0);
        assert_eq!(seeker.primary.pierce, 1);
        let plain = apply_mods(seeker.primary, &[]);
        assert_eq!(plain.damage, missile, "the Seeker's Band leaves the damage alone");
        let own = hero_sheet(c, &paladin_with_rings(Pick { ability: MagicMissile, source: Source::Own }));
        assert_eq!(own.err(), Some(LoadoutError::NotInPool(MagicMissile)));
    }

    #[test]
    fn an_item_version_leaves_with_its_item() {
        let c = ClassId::Paladin;
        let pick = Pick { ability: MagicMissile, source: Source::Item(EquipSlot::Ring1) };
        let mut empty = Build::start(c);
        empty.loadout.primary = pick;
        assert_eq!(hero_sheet(c, &empty).err(), Some(LoadoutError::NotInPool(MagicMissile)));
        let mut other = empty.clone();
        other.equipment = Equipment::starter(c).with(EquipSlot::Ring1, ItemId::BandOfVigor);
        assert_eq!(hero_sheet(c, &other).err(), Some(LoadoutError::NotInPool(MagicMissile)));
    }

    #[test]
    fn a_waiver_is_per_version() {
        const INT18: Requirement = Requirement::Attr(Attr::Int, 18);
        let d = crate::defs::abilities::AbilityDef { req: &[INT18], ..def(MagicMissile) };
        let int15 = Attributes::new(10, 10, 10, 15, 10, 10);
        assert_eq!(check_pick(&d, false, &int15, None), Err(LoadoutError::Requirement(MagicMissile, INT18)));
        assert_eq!(check_pick(&d, true, &int15, None), Ok(()));
        assert_eq!(check_pick(&d, false, &Attributes::new(10, 10, 10, 18, 10, 10), None), Ok(()));
        const HAMMER: Requirement = Requirement::WeaponKind(&[WeaponKind::Hammer]);
        let h = crate::defs::abilities::AbilityDef { req: &[HAMMER], ..def(Strike) };
        assert_eq!(check_pick(&h, true, &int15, Some(WeaponKind::Axe)), Err(LoadoutError::Requirement(Strike, HAMMER)));
        assert_eq!(check_pick(&h, true, &int15, Some(WeaponKind::Hammer)), Ok(()));
        let msg = LoadoutError::Requirement(MagicMissile, INT18).message();
        assert_eq!(msg, "Magic Missile needs INT 18.");
    }

    #[test]
    fn wrong_slot_and_no_weapon() {
        let w = ClassId::Wizard;
        let mut b = Build::start(w);
        b.loadout.primary = Pick { ability: Fireball, source: Source::Own };
        let wrong = hero_sheet(w, &b).err().unwrap();
        assert_eq!(wrong, LoadoutError::WrongSlot(Fireball));
        assert_eq!(wrong.message(), "Fireball cannot go in the primary slot.");

        let r = ClassId::ElvenRanger;
        let mut b = Build::start(r);
        b.equipment.slots[EquipSlot::Ranged as usize] = None;
        let none = hero_sheet(r, &b).err().unwrap();
        assert_eq!(none, LoadoutError::NoWeapon(Shoot, EquipSlot::Ranged));
        assert_eq!(none.message(), "Shoot needs a ranged weapon.");

        for e in [LoadoutError::NotInPool(MagicMissile), LoadoutError::Requirement(Strike, Requirement::WeaponKind(&[WeaponKind::Hammer, WeaponKind::Mace]))] {
            let m = e.message();
            assert!(!m.is_empty());
            let name = match e {
                LoadoutError::NotInPool(id) | LoadoutError::Requirement(id, _) => def(id).name,
                other => panic!("{other:?}"),
            };
            assert!(m.contains(name), "{m}");
        }
        let equip = LoadoutError::Equip(EquipSlot::Melee, crate::defs::items::EquipError::NotProficient).message();
        assert!(!equip.is_empty());
    }
}
