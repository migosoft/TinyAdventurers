//! The character sheet: every number of a hero or monster, resolved from its
//! class or stat block and its Attributes. At the start Attributes each number
//! equals today's `defs` value bit for bit (see `defs::attributes::Scaled`);
//! each Attribute point above or below moves it. The simulation reads heroes
//! and monsters from here.

use crate::defs::abilities::{self as ab, AbilityDef, AbilityId, AbilitySlot, Uses};
use crate::defs::attributes::{self, Attr, Attributes, Scaled, CHA_DMG, CON_MOVE, INT_DMG};
use crate::defs::bosses;
use crate::defs::classes::{self, PLAYER_RADIUS};
use crate::defs::companions::{wolf_base_hp, WOLF_ATTRS, WOLF_SPEED, WOLF_WEIGHT};
use crate::defs::damage::{kind_split, DamageSplit, DamageType, Resistances};
use crate::defs::effects::{EffectResistances, OnHit};
use crate::defs::enemies::{self, EnemyType};
use crate::defs::items::{self, EquipSlot, ItemBase, ItemId, PropKind};
#[cfg(test)]
use crate::defs::items::Equipment;
use crate::defs::lights::{self, LightKind};
use crate::defs::loadout::{apply_mods, check_pick, pick_version, AbilityMod, Build, LoadoutError, Pick};
#[cfg(test)]
use crate::defs::progression::StatUpgrades;
use crate::defs::races::Sight;
use crate::defs::weapons::{resolve_melee, resolve_ranged, ResolvedWeapon};
use crate::protocol::{BossId, ClassId};
use serde::Serialize;
use ts_rs::TS;

/// An ability with its numbers resolved for one hero.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct ResolvedAbility {
    pub id: AbilityId,
    pub cooldown: f64,
    pub damage: f64,
    pub range: f64,
    pub arc: f64,
    pub speed: f64,
    pub radius: f64,
    pub duration: f64,
    /// How many more enemies a shot may hit by overkill: 0 none, `u8::MAX` no limit.
    pub pierce: u8,
    /// How many enemies a shot passes through with full damage before the overkill rule.
    pub pierce_through: u8,
    /// In melee a ranged primary falls back to Strike, a ranged secondary is blocked.
    pub ranged: bool,
    /// The `EntityKind` id of its projectile.
    #[ts(type = "number | null")]
    pub projectile: Option<u8>,
    /// Sent as the non-zero shares by damage-type name (see `DamageSplit`'s `Serialize`).
    #[ts(type = "Record<string, number>")]
    pub split: DamageSplit,
    #[serde(skip)]
    #[ts(skip)]
    pub on_hit: Option<OnHit>,
    /// The power of its damage-type effects.
    #[serde(skip)]
    #[ts(skip)]
    pub power: i32,
    /// The push of its weapon (px).
    #[serde(skip)]
    #[ts(skip)]
    pub push: f64,
    /// The STR it pushes with.
    #[serde(skip)]
    #[ts(skip)]
    pub push_str: i32,
}

#[derive(Debug, Clone, Copy)]
pub struct Sheet {
    /// Class + race + `extra` + item points.
    pub attrs: Attributes,
    pub max_hp: f64,
    pub speed: f64,
    pub weight: f64,
    pub res: Resistances,
    pub effect_res: EffectResistances,
    /// The Melee slot's weapon, or the class starter.
    pub melee: ResolvedWeapon,
    /// The Ranged slot's weapon; none when the slot is empty.
    pub ranged: Option<ResolvedWeapon>,
    /// The light of the worn item with the largest radius.
    pub light: Option<LightKind>,
    pub sight: Sight,
    pub primary: ResolvedAbility,
    pub secondary: ResolvedAbility,
    /// Strike with the melee weapon: what a ranged primary does in melee.
    pub fallback: ResolvedAbility,
    /// How far the hero's melee reaches (px): `HERO_REACH + PLAYER_RADIUS`.
    pub reach: f64,
    /// Fraction of incoming damage blocked by the old armor upgrade (removed in plan 4).
    pub armor: f64,
    /// What the Summon Wolf version's mods do to the wolf.
    pub wolf: WolfMods,
}

/// The wolf's numbers from the Summon Wolf version: its max HP is multiplied by `hp_mul`,
/// and `dash_cooldown_add` is added to its dash cooldown.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WolfMods {
    pub hp_mul: f64,
    pub dash_cooldown_add: f64,
}

impl WolfMods {
    pub const NONE: WolfMods = WolfMods { hp_mul: 1.0, dash_cooldown_add: 0.0 };
}

/// The companion mods of a version; the others do nothing to the wolf.
pub fn wolf_mods(mods: &[AbilityMod]) -> WolfMods {
    use AbilityMod::*;
    let mut hp: Vec<f64> = vec![];
    let mut dash: Vec<f64> = vec![];
    for &m in mods {
        match m {
            CompanionHpMul(f) => hp.push(f),
            CompanionDashCooldownAdd(s) => dash.push(s),
            Pierce(_) | PierceThrough(_) | RadiusMul(_) | RangeMul(_) | DurationAdd(_) | CooldownAdd(_) | DamageMul(_) | ArcMul(_) | AddShare(..) | PushStr(_) => {}
        }
    }
    // A fixed order, so the order of the mods never matters.
    hp.sort_by(f64::total_cmp);
    dash.sort_by(f64::total_cmp);
    WolfMods { hp_mul: hp.into_iter().product(), dash_cooldown_add: dash.into_iter().sum() }
}

/// Movement speed: `base` is the value at `ref_con`; CON moves it by `CON_MOVE` per point.
fn move_speed(base: f64, ref_con: i32, attrs: &Attributes) -> f64 {
    Scaled { value: base, attr: Attr::Con, pct: CON_MOVE, at: ref_con }.get(attrs)
}

/// One ability for a hero with `attrs`, its weapons and its melee `reach`. `None` if it
/// shoots the ranged weapon and the hero has none.
fn resolve_ability(d: &AbilityDef, attrs: &Attributes, melee: &ResolvedWeapon, ranged: Option<&ResolvedWeapon>, reach: f64) -> Option<ResolvedAbility> {
    let own = d.own;
    let mult = d.weapon_mult;
    // A technique or weapon attack: its own cooldown, else the weapon's interval.
    let cooldown = |w: &ResolvedWeapon| if own.cooldown > 0.0 { own.cooldown } else { w.cooldown * mult.time };
    // What every rule fills in the same way; the numbers it does not set stay 0.
    let blank = ResolvedAbility {
        id: d.id,
        cooldown: 0.0,
        damage: 0.0,
        range: 0.0,
        arc: 0.0,
        speed: 0.0,
        radius: 0.0,
        duration: 0.0,
        pierce: 0,
        pierce_through: 0,
        ranged: d.ranged,
        projectile: None,
        split: DamageSplit::physical(),
        on_hit: None,
        power: 0,
        push: 0.0,
        push_str: attrs.get(Attr::Str),
    };
    Some(match d.uses {
        Uses::Melee => ResolvedAbility {
            cooldown: cooldown(melee),
            damage: melee.damage * mult.damage,
            range: reach,
            arc: mult.arc.unwrap_or(melee.arc),
            speed: own.speed,
            radius: own.radius,
            duration: own.duration,
            split: melee.split,
            on_hit: melee.on_hit,
            power: melee.power,
            push: melee.push,
            ..blank
        },
        Uses::Ranged => {
            let w = ranged?;
            ResolvedAbility {
                cooldown: cooldown(w),
                damage: w.damage * mult.damage,
                range: w.range,
                speed: w.projectile_speed,
                radius: w.radius,
                duration: own.duration,
                pierce: u8::MAX,
                pierce_through: w.pierce_through,
                projectile: w.projectile.map(|k| k as u8),
                split: w.split,
                on_hit: w.on_hit,
                power: w.power,
                ..blank
            }
        }
        Uses::Nothing => {
            let gov = ab::governing(d.category);
            let damage = match gov {
                Some(attr) => {
                    let pct = match attr {
                        Attr::Int => INT_DMG,
                        Attr::Cha => CHA_DMG,
                        other => unreachable!("governing returned {other:?}"),
                    };
                    Scaled { value: own.damage, attr, pct, at: own.at }.get(attrs)
                }
                None => own.damage,
            };
            ResolvedAbility {
                cooldown: own.cooldown,
                damage,
                range: own.range,
                speed: own.speed,
                radius: own.radius,
                duration: own.duration,
                projectile: own.kind.map(|k| k as u8),
                split: own.kind.map_or(DamageSplit::physical(), kind_split),
                power: if own.damage > 0.0 { gov.map_or(0, |a| attrs.get(a)) } else { 0 },
                ..blank
            }
        }
    })
}

/// A weapon item for one wielder, with the shares and on-hit its own properties gave it.
fn arm(id: ItemId, attrs: &Attributes, shares: &[(DamageType, f64)], on_hit: Option<OnHit>, pierce_through: u8) -> ResolvedWeapon {
    let w = match items::def(id).base {
        ItemBase::Melee(k, s) => resolve_melee(k, &s, attrs),
        ItemBase::Ranged(k, s) => resolve_ranged(k, &s, attrs),
        b => panic!("{id:?} is not a weapon: {b:?}"),
    };
    ResolvedWeapon { split: w.split.with_shares(shares), on_hit: on_hit.map(|h| OnHit { power: w.power, ..h }), pierce_through, ..w }
}

/// The sheet of a hero with build `b`. The equipment is checked first, against the
/// Attributes without items (class + race + `b.extra`); then each pick: its version, its
/// requirements, its weapon. An empty Melee slot uses the class's starter; an empty Ranged
/// slot is no ranged weapon.
pub fn hero_sheet(class: ClassId, b: &Build) -> Result<Sheet, LoadoutError> {
    let def = classes::def(class);
    let start = classes::start_attrs(class);
    let unequipped = start.plus(b.extra);
    let equip = &b.equipment;
    items::check_equipment(class, equip, &unequipped).map_err(|(s, e)| LoadoutError::Equip(s, e))?;
    let m = b.upgrades.modifiers();
    let prof = classes::profile(class);

    // The worn items, with the starter in an empty Melee slot.
    let (starter_melee, _) = def.starter;
    let worn: Vec<(EquipSlot, ItemId)> = EquipSlot::ALL
        .iter()
        .filter_map(|&s| {
            let id = match s {
                EquipSlot::Melee => Some(equip.get(s).unwrap_or(starter_melee)),
                EquipSlot::Ranged | EquipSlot::OffHand | EquipSlot::Armor | EquipSlot::Ring1 | EquipSlot::Ring2 | EquipSlot::Shoes | EquipSlot::Belt => equip.get(s),
            };
            id.map(|id| (s, id))
        })
        .collect();

    // Armor bases first, then the properties (spec §10).
    let mut res = prof.res;
    let mut weight = def.weight;
    for &(_, id) in &worn {
        if let ItemBase::Armor(a) = items::def(id).base {
            res.set(DamageType::Physical, res.get(DamageType::Physical) + a.physical);
            weight += a.weight;
        }
    }
    let mut attrs = unequipped;
    let mut effect_res = prof.effect_res;
    let (mut move_frac, mut bonus_hp) = (0.0, 0.0);
    let mut light: Option<LightKind> = None;
    // Index 0: the melee weapon, 1: the ranged one.
    let mut shares: [Vec<(DamageType, f64)>; 2] = Default::default();
    let mut on_hits: [Option<OnHit>; 2] = [None, None];
    let mut pierce: [u8; 2] = [0, 0];
    for &(slot, id) in &worn {
        let weapon = match slot {
            EquipSlot::Melee => Some(0),
            EquipSlot::Ranged => Some(1),
            EquipSlot::OffHand | EquipSlot::Armor | EquipSlot::Ring1 | EquipSlot::Ring2 | EquipSlot::Shoes | EquipSlot::Belt => None,
        };
        for p in items::def(id).props {
            match p.kind {
                PropKind::Attr(a, n) => attrs.add(a, n),
                PropKind::Resist(t, v) => res.set(t, res.get(t) + v),
                PropKind::EffectResist(k, v) => effect_res.set(k, effect_res.get(k) + v),
                PropKind::Weight(w) => weight += w,
                PropKind::MoveSpeed(f) => move_frac += f,
                PropKind::MaxHp(hp) => bonus_hp += hp,
                PropKind::Light(k) => {
                    if light.is_none_or(|l| lights::def(k).radius > lights::def(l).radius) {
                        light = Some(k);
                    }
                }
                // Weapon-only (a data test refuses them elsewhere): they go to their own weapon.
                PropKind::DamageShare(t, v) => {
                    if let Some(i) = weapon {
                        shares[i].push((t, v));
                    }
                }
                PropKind::OnHit(h) => {
                    if let Some(i) = weapon {
                        on_hits[i] = Some(OnHit { magical: p.magical, ..h });
                    }
                }
                PropKind::Pierce(n) => {
                    if let Some(i) = weapon {
                        pierce[i] = pierce[i].saturating_add(n);
                    }
                }
                // Read by the picks below (`pick_version`).
                PropKind::GrantAbility { .. } => {}
            }
        }
    }
    let melee_id = worn.iter().find(|w| w.0 == EquipSlot::Melee).map(|w| w.1).expect("a hero always has a melee weapon");
    let melee = arm(melee_id, &attrs, &shares[0], on_hits[0], pierce[0]);
    let ranged = worn.iter().find(|w| w.0 == EquipSlot::Ranged).map(|w| arm(w.1, &attrs, &shares[1], on_hits[1], pierce[1]));

    // Abilities: version, requirements, weapon, mods; the old upgrades multiply after
    // (damage not on Holy Light).
    let reach = classes::HERO_REACH + PLAYER_RADIUS;
    let upgraded = |r: ResolvedAbility| {
        let damage = if r.id == AbilityId::HolyLight { r.damage } else { r.damage * m.damage };
        ResolvedAbility { damage, cooldown: r.cooldown / m.attack_speed, ..r }
    };
    let ability = |slot: AbilitySlot, p: Pick| -> Result<(ResolvedAbility, &'static [AbilityMod]), LoadoutError> {
        let (mods, waive_attrs) = pick_version(class, b, slot, p)?;
        let d = ab::def(p.ability);
        let weapon = match d.uses {
            Uses::Melee => Some(melee.kind),
            Uses::Ranged => ranged.map(|w| w.kind),
            Uses::Nothing => None,
        };
        check_pick(&d, waive_attrs, &attrs, weapon)?;
        let r = resolve_ability(&d, &attrs, &melee, ranged.as_ref(), reach).ok_or(LoadoutError::NoWeapon(p.ability, EquipSlot::Ranged))?;
        Ok((upgraded(apply_mods(r, mods)), mods))
    };
    let (primary, _) = ability(AbilitySlot::Primary, b.loadout.primary)?;
    let (secondary, secondary_mods) = ability(AbilitySlot::Secondary, b.loadout.secondary)?;
    let wolf = if secondary.id == AbilityId::SummonWolf { wolf_mods(secondary_mods) } else { WolfMods::NONE };
    let strike = resolve_ability(&ab::def(AbilityId::Strike), &attrs, &melee, ranged.as_ref(), reach).expect("Strike uses the melee weapon");
    Ok(Sheet {
        attrs,
        max_hp: (attributes::hp(def.base_hp, attrs.get(Attr::Con)) + bonus_hp) * m.life,
        speed: move_speed(def.speed, start.get(Attr::Con), &attrs) * (1.0 + move_frac) * m.move_speed,
        weight,
        res,
        effect_res,
        melee,
        ranged,
        light,
        sight: prof.sight,
        primary,
        secondary,
        fallback: upgraded(strike),
        reach,
        armor: m.armor,
        wolf,
    })
}

/// The numbers a monster's spawn reads.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MonsterStats {
    pub attrs: Attributes,
    pub weight: f64,
    pub max_hp: f64,
    pub speed: f64,
}

/// Enemy stats. HP does not depend on the party size (TODO 4b).
pub fn enemy_stats(t: EnemyType) -> MonsterStats {
    let d = enemies::def(t);
    let con = d.attrs.get(Attr::Con);
    MonsterStats {
        attrs: d.attrs,
        weight: d.weight,
        max_hp: attributes::hp(enemies::base_hp(t), con),
        speed: move_speed(d.speed, con, &d.attrs),
    }
}

/// Boss stats. HP does not depend on the party size (TODO 4b).
pub fn boss_stats(b: BossId) -> MonsterStats {
    let d = bosses::def(b);
    let con = d.attrs.get(Attr::Con);
    // The boss HP is the total; take the CON bonus out and put it back.
    let base = d.hp - attributes::CON_HP * (con - attributes::BASELINE) as f64;
    MonsterStats { attrs: d.attrs, weight: d.weight, max_hp: attributes::hp(base, con), speed: move_speed(d.speed, con, &d.attrs) }
}

/// The Ranger's wolf.
pub fn wolf_stats() -> MonsterStats {
    let con = WOLF_ATTRS.get(Attr::Con);
    MonsterStats { attrs: WOLF_ATTRS, weight: WOLF_WEIGHT, max_hp: attributes::hp(wolf_base_hp(), con), speed: move_speed(WOLF_SPEED, con, &WOLF_ATTRS) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::attributes::{factor, STR_DMG};
    use crate::defs::effects::EffectKind;
    use crate::defs::kinds::EntityKind;
    use crate::defs::companions::WOLF_HP;

    fn plus(a: Attr, n: i32) -> Attributes {
        let mut x = Attributes::default();
        x.add(a, n);
        x
    }

    /// The class start with `extra` Attribute points, `equip` and `up`.
    fn sheet_of(class: ClassId, extra: Attributes, equip: &Equipment, up: &StatUpgrades) -> Sheet {
        let b = Build { extra, equipment: *equip, upgrades: *up, ..Build::start(class) };
        hero_sheet(class, &b).unwrap()
    }

    /// Today's numbers of an ability at the class start: id, cooldown, damage, range, arc, speed, radius, duration.
    type Row = (AbilityId, f64, f64, f64, f64, f64, f64, f64);

    fn same(r: &ResolvedAbility, want: Row) {
        let (id, cooldown, damage, range, arc, speed, radius, duration) = want;
        assert_eq!(r.id, id);
        assert_eq!(r.cooldown, cooldown, "{id:?} cooldown");
        assert_eq!(r.damage, damage, "{id:?} damage");
        assert_eq!(r.range, range, "{id:?} range");
        assert_eq!(r.arc, arc, "{id:?} arc");
        assert_eq!(r.speed, speed, "{id:?} speed");
        assert_eq!(r.radius, radius, "{id:?} radius");
        assert_eq!(r.duration, duration, "{id:?} duration");
    }

    #[test]
    fn hero_sheet_reproduces_today() {
        use AbilityId::*;
        // Today's numbers (the old `abilities::def` rows, with the weapon abilities' weapons), and the
        // deliberate exceptions: the Barbarian's Strike reaches 22 (was 25); Charge strikes with the axe
        // at 0.8 (25.6, was 25), and as a melee ability it carries the hero's reach and the axe's arc,
        // which the dash does not read (both were 0).
        let today: [(ClassId, Row, Row); 4] = [
            (ClassId::Wizard, (MagicMissile, 0.35, 12.0, 220.0, 0.0, 230.0, 3.0, 0.0), (Fireball, 6.0, 45.0, 260.0, 0.0, 140.0, 38.0, 0.0)),
            (ClassId::Paladin, (Strike, 0.45, 20.0, 22.0, 1.75, 0.0, 0.0, 0.0), (HolyLight, 10.0, 35.0, 64.0, 0.0, 0.0, 64.0, 0.0)),
            (ClassId::Barbarian, (Strike, 0.8, 32.0, 22.0, 2.45, 0.0, 0.0, 0.0), (Charge, 5.0, 32.0 * 0.8, 22.0, 2.45, ab::DASH_SPEED, 10.0, 0.18)),
            (ClassId::ElvenRanger, (Shoot, 0.7, 16.0, 260.0, 0.0, 290.0, 2.0, 0.0), (SummonWolf, 8.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)),
        ];
        for (c, primary, secondary) in today {
            let d = classes::def(c);
            let s = sheet_of(c, Attributes::default(), &Equipment::starter(c), &StatUpgrades::default());
            assert_eq!(s.max_hp, d.hp, "{c:?}");
            assert_eq!(s.speed, d.speed, "{c:?}");
            assert_eq!(s.weight, d.weight, "{c:?}");
            same(&s.primary, primary);
            same(&s.secondary, secondary);
            assert_eq!(s.reach, 22.0, "{c:?}");
            assert_eq!(s.fallback.id, Strike, "{c:?}");
            assert_eq!(s.fallback.range, 22.0, "{c:?}");
            assert_eq!((s.fallback.damage, s.fallback.cooldown), (s.melee.damage, s.melee.cooldown), "{c:?}");
            assert_eq!(s.armor, 0.0);
            assert_eq!(s.melee.split, DamageSplit::physical(), "{c:?}");
            assert_eq!(s.light, None, "{c:?}");
            assert_eq!(s.res, classes::profile(c).res, "{c:?}");
        }
        let sheet = |c| sheet_of(c, Attributes::default(), &Equipment::starter(c), &StatUpgrades::default());
        let r = sheet(ClassId::ElvenRanger);
        assert_eq!(r.attrs.get(Attr::Dex), 15);
        assert_eq!((r.fallback.damage, r.fallback.cooldown), (18.0, 0.35));
        assert_eq!(r.ranged.unwrap().projectile, Some(EntityKind::Bolt));
        assert_eq!(r.primary.projectile, Some(EntityKind::Bolt as u8));
        assert_eq!(r.primary.pierce, u8::MAX);
        assert!(r.primary.ranged);
        let w = sheet(ClassId::Wizard);
        assert_eq!(w.primary.pierce, 0);
        assert!(w.primary.ranged && w.secondary.ranged);
        // The power of each ability's damage-type effects.
        assert_eq!((w.primary.power, w.secondary.power), (15, 15), "the Wizard's INT");
        let p = sheet(ClassId::Paladin);
        assert_eq!((p.primary.power, p.secondary.power), (15, 14), "the sword's STR, Holy Light's CHA");
        assert!(!p.primary.ranged && !p.secondary.ranged);
        assert_eq!(r.primary.power, 15, "the bow's DEX");
        assert_eq!(r.secondary.power, 0, "Summon Wolf deals no damage");
        // The split goes to the client as its non-zero shares by name.
        assert_eq!(serde_json::to_value(p.primary).unwrap()["split"], serde_json::json!({ "Physical": 1.0 }));
    }

    #[test]
    fn attributes_move_the_numbers() {
        let up = StatUpgrades::default();
        let w = sheet_of(ClassId::Wizard, plus(Attr::Int, 2), &Equipment::starter(ClassId::Wizard), &up);
        assert!((w.primary.damage - 12.0 * 1.35 / 1.25).abs() < 1e-12);
        let b = sheet_of(ClassId::Barbarian, plus(Attr::Dex, 2), &Equipment::starter(ClassId::Barbarian), &up);
        assert!((b.primary.cooldown - 0.8 / (1.10 / 1.06)).abs() < 1e-12);
        assert!((b.primary.arc - 2.45 * 1.15 / 1.09).abs() < 1e-12);
        let p = sheet_of(ClassId::Paladin, plus(Attr::Con, 2), &Equipment::starter(ClassId::Paladin), &up);
        assert_eq!(p.max_hp, 130.0);
        assert!((p.speed - 66.0 * 1.05 / 1.03).abs() < 1e-12);
    }

    #[test]
    fn attributes_move_the_ranger_numbers() {
        let up = StatUpgrades::default();
        // The ranger starts at DEX 15 (class 13 + Elf 2) and STR 10.
        let dex = sheet_of(ClassId::ElvenRanger, plus(Attr::Dex, 2), &Equipment::starter(ClassId::ElvenRanger), &up);
        let bow = dex.primary;
        assert!((bow.damage - 16.0 * 1.35 / 1.25).abs() < 1e-12, "bow damage by DEX");
        assert!((bow.cooldown - 0.7 / (1.14 / 1.10)).abs() < 1e-12, "firing speed by DEX");
        assert_eq!((bow.range, bow.speed), (260.0, 290.0), "DEX does not move the reach");
        let thrust = dex.fallback;
        assert!((thrust.damage - 18.0 * 1.35 / 1.25).abs() < 1e-12, "rapier damage by DEX");
        assert!((thrust.cooldown - 0.35 / (1.14 / 1.10)).abs() < 1e-12, "rapier speed by DEX");
        assert_eq!(thrust.range, 22.0);
        let str2 = sheet_of(ClassId::ElvenRanger, plus(Attr::Str, 2), &Equipment::starter(ClassId::ElvenRanger), &up).primary;
        assert!((str2.range - 260.0 * 1.04 / 1.00).abs() < 1e-12, "range by STR");
        assert!((str2.speed - 290.0 * 1.04 / 1.00).abs() < 1e-12, "projectile speed by STR");
        assert_eq!((str2.damage, str2.cooldown), (16.0, 0.7), "STR does not move damage or speed");
    }

    #[test]
    fn upgrades_still_apply() {
        let up = StatUpgrades { damage: 2, attack_speed: 1, move_speed: 1, life: 1, armor: 1, ..Default::default() };
        let m = up.modifiers();
        let s = sheet_of(ClassId::Paladin, Attributes::default(), &Equipment::starter(ClassId::Paladin), &up);
        assert_eq!(s.primary.damage, 20.0 * m.damage);
        assert_eq!(s.primary.cooldown, 0.45 / m.attack_speed);
        assert_eq!(s.speed, 66.0 * m.move_speed);
        assert_eq!(s.max_hp, 120.0 * m.life);
        assert_eq!(s.armor, m.armor);
        assert_eq!(s.secondary.damage, 35.0, "the heal is no damage");
        // What the modifiers really give.
        assert!((m.damage - 1.16).abs() < 1e-12 && (m.attack_speed - 1.06).abs() < 1e-12);
        assert!((m.move_speed - 1.04).abs() < 1e-12 && (m.life - 1.10).abs() < 1e-12 && (m.armor - 0.04).abs() < 1e-12);
    }

    fn with(c: ClassId, extra: Attributes, items: &[(EquipSlot, ItemId)]) -> Sheet {
        let e = items.iter().fold(Equipment::starter(c), |e, &(s, i)| e.with(s, i));
        sheet_of(c, extra, &e, &StatUpgrades::default())
    }

    #[test]
    fn an_empty_melee_slot_is_the_starter() {
        let up = StatUpgrades::default();
        let c = ClassId::Paladin;
        let a = sheet_of(c, Attributes::default(), &Equipment::default(), &up);
        let b = sheet_of(c, Attributes::default(), &Equipment::starter(c), &up);
        assert_eq!((a.primary, a.secondary, a.fallback, a.melee), (b.primary, b.secondary, b.fallback, b.melee));
        // An empty Ranged slot is no ranged weapon: the ranger cannot shoot.
        let r = ClassId::ElvenRanger;
        let none = hero_sheet(r, &Build { equipment: Equipment::default(), ..Build::start(r) });
        assert_eq!(none.err(), Some(LoadoutError::NoWeapon(AbilityId::Shoot, EquipSlot::Ranged)));
    }

    #[test]
    fn equipment_is_checked_without_item_points() {
        let c = ClassId::Wizard;
        let low = Attributes::new(0, 0, 0, -2, 0, 0);
        let e = Equipment::starter(c).with(EquipSlot::Melee, ItemId::StaffOfRot).with(EquipSlot::Ring1, ItemId::RingOfInsight);
        let err = hero_sheet(c, &Build { extra: low, equipment: e, ..Build::start(c) }).err();
        assert_eq!(err, Some(LoadoutError::Equip(EquipSlot::Melee, items::EquipError::Requirement(crate::defs::requirements::Requirement::Attr(Attr::Int, 14)))));
    }

    #[test]
    fn another_weapon_changes_the_strike() {
        let p = with(ClassId::Paladin, Attributes::default(), &[(EquipSlot::Melee, ItemId::GoldenSword)]);
        let want = 22.0 * factor(15, STR_DMG) / factor(10, STR_DMG);
        assert!((p.primary.damage - want).abs() < 1e-12 && (want - 27.5).abs() < 1e-12, "{}", p.primary.damage);
        assert!((p.primary.cooldown - 0.5 / (0.96 / 1.0)).abs() < 1e-12);
        assert!((p.primary.arc - 1.8 * 0.94).abs() < 1e-12);
        assert_eq!(p.primary.range, p.reach);
        assert_eq!(p.light, Some(LightKind::Holy));
        let b = with(ClassId::Barbarian, Attributes::default(), &[(EquipSlot::Melee, ItemId::KnightSword)]);
        assert_eq!(b.primary.damage, 20.0);
        assert!((b.primary.cooldown - 0.45 / (1.06 / 0.96)).abs() < 1e-12);
    }

    #[test]
    fn armor_and_trinkets_fold_in() {
        let gear = [
            (EquipSlot::Armor, ItemId::PlateArmor),
            (EquipSlot::Ring1, ItemId::BandOfVigor),
            (EquipSlot::Shoes, ItemId::BootsOfHaste),
            (EquipSlot::Belt, ItemId::GirdleOfWarding),
        ];
        let p = with(ClassId::Paladin, Attributes::default(), &gear);
        assert_eq!(p.res.get(DamageType::Physical), 0.25);
        assert_eq!(p.weight, 12.0 + 7.0);
        assert_eq!(p.attrs.get(Attr::Con), 14);
        assert_eq!(p.max_hp, 125.0 + 10.0);
        assert!((p.speed - 66.0 * 1.04 / 1.03 * 1.05).abs() < 1e-12, "{}", p.speed);
        assert_eq!(p.effect_res.get(EffectKind::Blind), 1.0);
        let mut iron = gear;
        iron[2] = (EquipSlot::Shoes, ItemId::IronBoots);
        let q = with(ClassId::Paladin, Attributes::default(), &iron);
        assert_eq!(q.weight, 12.0 + 7.0 + 3.0);
        assert!((q.speed - 66.0 * 1.04 / 1.03 * 0.95).abs() < 1e-12, "{}", q.speed);
    }

    #[test]
    fn weapon_properties_fill_split_and_on_hit() {
        let start = sheet_of(ClassId::Wizard, Attributes::default(), &Equipment::starter(ClassId::Wizard), &StatUpgrades::default());
        let ember = with(ClassId::Wizard, Attributes::default(), &[(EquipSlot::Melee, ItemId::EmberStaff)]);
        assert!((ember.melee.split.share(DamageType::Heat) - 0.25).abs() < 1e-12);
        assert_eq!(ember.light, Some(LightKind::Fire));
        assert_eq!(ember.primary, start.primary, "Magic Missile ignores the staff");
        let rot = with(ClassId::Wizard, plus(Attr::Int, 0), &[(EquipSlot::Melee, ItemId::StaffOfRot)]);
        assert_eq!(rot.melee.on_hit, None, "the Staff of Rot poisons by its share, not an on-hit");
        assert!((rot.melee.split.share(DamageType::Poison) - 0.5).abs() < 1e-12);
        assert_eq!(rot.primary, start.primary, "Magic Missile ignores the staff");
    }

    #[test]
    fn enemy_stats_reproduce_today() {
        for t in EnemyType::ALL {
            let d = enemies::def(t);
            let s = enemy_stats(t);
            assert_eq!(s.max_hp, d.hp, "{t:?}: the party size no longer scales HP (TODO 4b)");
            assert_eq!(s.speed, d.speed, "{t:?}");
            assert_eq!(s.weight, d.weight);
        }
    }

    #[test]
    fn boss_stats_reproduce_today() {
        for b in BossId::ALL {
            let d = bosses::def(b);
            let s = boss_stats(b);
            assert_eq!(s.max_hp, d.hp, "{b:?}: the party size no longer scales HP (TODO 4b)");
            assert_eq!(s.speed, d.speed, "{b:?}");
            assert_eq!(s.weight, 40.0);
        }
    }

    #[test]
    fn wolf_stats_reproduce_today() {
        let s = wolf_stats();
        assert_eq!(s.max_hp, WOLF_HP);
        assert_eq!(s.speed, WOLF_SPEED);
        assert_eq!(s.weight, 10.0);
    }

    #[test]
    fn low_con_enemy_still_moves() {
        let block = Attributes::new(10, 10, -200, 10, 10, 10);
        assert!(move_speed(40.0, 12, &block) > 0.0);
    }
}
