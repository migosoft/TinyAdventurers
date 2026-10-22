//! The character sheet: every number of a hero or monster, resolved from its
//! class or stat block and its Attributes. At the start Attributes each number
//! equals today's `defs` value bit for bit (see `defs::attributes::Scaled`);
//! each Attribute point above or below moves it. The simulation reads heroes
//! and monsters from here.

use crate::defs::abilities::{self as ab, AbilityCategory, AbilityDef, AbilityId, AbilitySlot, Uses};
use crate::defs::attributes::{self, Attr, Attributes, Scaled, CON_MOVE};
use crate::defs::bosses;
use crate::defs::classes::{self, PLAYER_RADIUS};
use crate::defs::companions::{wolf_base_hp, WOLF_ATTRS, WOLF_SPEED, WOLF_WEIGHT};
use crate::defs::damage::{kind_split, Base, BaseScale, DamageSplit, DamageType, Resistances};
use crate::defs::effects::{EffectKind, EffectResistances, OnHit};
use crate::defs::enemies::{self, EnemyType};
use crate::defs::items::{self, ArmorClass, EquipSlot, ItemBase, ItemId, PropKind};
#[cfg(test)]
use crate::defs::items::Equipment;
use crate::defs::lights::{self, LightKind};
use crate::defs::loadout::{apply_mods, check_pick, pick_version, AbilityMod, Build, Loadout, LoadoutError, Pick};
use crate::defs::races::Sight;
use crate::defs::trees::{self, Keystone, KeystoneSet, NodeId, Prof};
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
    /// `damage` as its breakdown for the rules log: `damage == base.amount()`.
    #[serde(skip)]
    #[ts(skip)]
    pub base: Base,
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
    /// The half-angle (rad) of the "from behind" cone; 0 = none.
    pub behind: f64,
    /// The effect it applies by itself (an `OwnEffect` resolved for this hero).
    #[serde(skip)]
    #[ts(skip)]
    pub effect: Option<OnHit>,
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
    /// Class + race + `extra` + tree + item points.
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
    /// The light of the worn item with the largest radius, or the Radiant keystone's glow when that reaches further (or nothing is worn).
    pub light: Option<LightKind>,
    /// The keystones the hero owns; the run reads the dynamic ones from here.
    pub keystones: KeystoneSet,
    pub sight: Sight,
    pub primary: ResolvedAbility,
    pub secondary: ResolvedAbility,
    /// Strike with the melee weapon: what a ranged primary does in melee.
    pub fallback: ResolvedAbility,
    /// How far the hero's melee reaches (px): `HERO_REACH + PLAYER_RADIUS`.
    pub reach: f64,
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
            Pierce(_) | PierceThrough(_) | RadiusMul(_) | RangeMul(_) | DurationAdd(_) | CooldownAdd(_) | DamageMul(_) | ArcMul(_) | AddShare(..) | PushStr(_) | AddOnHit(_) | BehindArc(_) => {}
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

/// `split` with a weapon ability's added share, if it has one.
fn with_share(split: DamageSplit, share: Option<(DamageType, f64)>) -> DamageSplit {
    share.map_or(split, |s| split.with_shares(&[s]))
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
        base: Base::plain(0.0),
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
        behind: d.behind,
        effect: own.effect.map(|e| OnHit { kind: e.kind, secs: own.duration, magical: matches!(d.category, AbilityCategory::Spell | AbilityCategory::Innate), power: attrs.get(e.power), look: e.look }),
        power: 0,
        push: 0.0,
        push_str: attrs.get(Attr::Str),
    };
    Some(match d.uses {
        Uses::Melee => {
            let base = Base { ability_mult: mult.damage, ..melee.base };
            ResolvedAbility {
                cooldown: cooldown(melee),
                damage: base.amount(),
                base,
                range: reach,
                arc: mult.arc.unwrap_or(melee.arc),
                speed: own.speed,
                radius: own.radius,
                duration: own.duration,
                split: with_share(melee.split, mult.share),
                on_hit: melee.on_hit,
                power: melee.power,
                push: melee.push,
                ..blank
            }
        }
        Uses::Ranged => {
            let w = ranged?;
            let base = Base { ability_mult: mult.damage, ..w.base };
            ResolvedAbility {
                cooldown: cooldown(w),
                damage: base.amount(),
                base,
                range: w.range,
                speed: w.projectile_speed,
                radius: w.radius,
                duration: own.duration,
                pierce: u8::MAX,
                pierce_through: w.pierce_through,
                projectile: w.projectile.map(|k| k as u8),
                split: with_share(w.split, mult.share),
                on_hit: w.on_hit,
                power: w.power,
                ..blank
            }
        }
        Uses::Nothing => {
            let gov = ab::governing(d.category);
            let base = match gov {
                Some((attr, pct)) => {
                    let ratio = Scaled { value: own.damage, attr, pct, at: own.at }.ratio(attrs);
                    Base { given: own.damage, scale: Some(BaseScale { attr, at: own.at, have: attrs.get(attr), ratio }), ability_mult: 1.0, mods_mult: 1.0, keystone_mult: 1.0 }
                }
                None => Base::plain(own.damage),
            };
            ResolvedAbility {
                cooldown: own.cooldown,
                damage: base.amount(),
                base,
                range: own.range,
                speed: own.speed,
                radius: own.radius,
                duration: own.duration,
                projectile: own.kind.map(|k| k as u8),
                split: own.split.unwrap_or_else(|| own.kind.map_or(DamageSplit::physical(), kind_split)),
                power: if own.damage > 0.0 { gov.map_or(0, |(a, _)| attrs.get(a)) } else { 0 },
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

/// The proficiencies of a hero: the class's own plus what the owned `nodes` teach.
pub fn profs(class: ClassId, nodes: &[NodeId]) -> Vec<Prof> {
    let mut v = classes::prof_base(class);
    v.extend(trees::gains(nodes).profs);
    v
}

/// Start Attributes + the shop's `extra` + the tree's Attribute nodes; no item points.
pub fn attrs_without_items(class: ClassId, b: &Build) -> Attributes {
    classes::start_attrs(class).plus(b.extra).plus(trees::gains(&b.nodes).attrs)
}

/// The worn items, with the starter in an empty Melee slot.
fn worn_items(class: ClassId, b: &Build) -> Vec<(EquipSlot, ItemId)> {
    let (starter_melee, _) = classes::def(class).starter;
    EquipSlot::ALL
        .iter()
        .filter_map(|&s| {
            let id = match s {
                EquipSlot::Melee => Some(b.equipment.get(s).unwrap_or(starter_melee)),
                EquipSlot::Ranged | EquipSlot::OffHand | EquipSlot::Armor | EquipSlot::Ring1 | EquipSlot::Ring2 | EquipSlot::Shoes | EquipSlot::Belt => b.equipment.get(s),
            };
            id.map(|id| (s, id))
        })
        .collect()
}

/// `attrs_without_items` plus the worn items' Attribute points, whatever the loadout.
pub fn attrs_with_items(class: ClassId, b: &Build) -> Attributes {
    let mut attrs = attrs_without_items(class, b);
    for (_, id) in worn_items(class, b) {
        for p in items::def(id).props {
            if let PropKind::Attr(a, n) = p.kind {
                attrs.add(a, n);
            }
        }
    }
    attrs
}

/// The sheet of a hero with build `b`, in the spec's order (§10): class, race, shop (`extra`),
/// tree nodes (Attributes, resistances, proficiencies), items; then the derived numbers, the
/// weapons and the two picks. The equipment is checked first, against the Attributes without
/// items; then each pick: its version, its requirements, its weapon, its mods (the version's
/// and the tree's improvements for that ability). An empty Melee slot uses the class's starter;
/// an empty Ranged slot is no ranged weapon.
pub fn hero_sheet(class: ClassId, b: &Build) -> Result<Sheet, LoadoutError> {
    let def = classes::def(class);
    let start = classes::start_attrs(class);
    let unequipped = attrs_without_items(class, b);
    let equip = &b.equipment;
    let tree = trees::gains(&b.nodes);
    items::check_equipment(class, &profs(class, &b.nodes), equip, &unequipped).map_err(|(s, e)| LoadoutError::Equip(s, e))?;
    let prof = classes::profile(class);

    let worn = worn_items(class, b);

    // Armor bases first, then the properties (spec §10).
    let mut res = prof.res;
    for &(t, v) in &tree.res {
        res.set(t, res.get(t) + v);
    }
    let ks = tree.keystones;
    let mut weight = def.weight;
    let armor_weight = if ks.has(Keystone::Bulwark) { 0.5 } else { 1.0 };
    for &(_, id) in &worn {
        if let ItemBase::Armor(a) = items::def(id).base {
            res.set(DamageType::Physical, res.get(DamageType::Physical) + a.physical);
            weight += a.weight * armor_weight;
        }
    }
    if ks.has(Keystone::Bulwark) {
        res.set(DamageType::Physical, res.get(DamageType::Physical) + 0.1);
    }
    if ks.has(Keystone::Juggernaut) {
        weight += 4.0;
    }
    let mut attrs = unequipped;
    let mut effect_res = prof.effect_res;
    if ks.has(Keystone::Unshaken) {
        effect_res.set(EffectKind::Sleep, effect_res.get(EffectKind::Sleep) + 1.0);
    }
    if ks.has(Keystone::Juggernaut) {
        for k in [EffectKind::Slowed, EffectKind::Chilled, EffectKind::Entangled] {
            effect_res.set(k, effect_res.get(k) + 1.0);
        }
    }
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

    // Abilities: version, requirements, weapon, mods (version, then the tree's improvements).
    let reach = classes::HERO_REACH + PLAYER_RADIUS;
    let ability = |slot: AbilitySlot, p: Pick| -> Result<(ResolvedAbility, Vec<AbilityMod>), LoadoutError> {
        let (version, waive_attrs) = pick_version(class, b, slot, p)?;
        let d = ab::def(p.ability);
        let weapon = match d.uses {
            Uses::Melee => Some(melee.kind),
            Uses::Ranged => ranged.map(|w| w.kind),
            Uses::Nothing => None,
        };
        check_pick(&d, waive_attrs, &attrs, weapon)?;
        let r = resolve_ability(&d, &attrs, &melee, ranged.as_ref(), reach).ok_or(LoadoutError::NoWeapon(p.ability, EquipSlot::Ranged))?;
        let mods: Vec<AbilityMod> = version.iter().copied().chain(tree.improves.iter().filter(|(a, _)| *a == p.ability).map(|&(_, m)| m)).collect();
        Ok((keystone_ability(apply_mods(r, &mods), &d, &ks), mods))
    };
    let (primary, _) = ability(AbilitySlot::Primary, b.loadout.primary)?;
    let (secondary, secondary_mods) = ability(AbilitySlot::Secondary, b.loadout.secondary)?;
    let wolf = if secondary.id == AbilityId::SummonWolf { wolf_mods(&secondary_mods) } else { WolfMods::NONE };
    let strike_def = ab::def(AbilityId::Strike);
    let strike = resolve_ability(&strike_def, &attrs, &melee, ranged.as_ref(), reach).expect("Strike uses the melee weapon");
    let strike = keystone_ability(strike, &strike_def, &ks);
    // Radiant lights two tiles, unless a worn light reaches further.
    if ks.has(Keystone::Radiant) && light.is_none_or(|l| lights::def(LightKind::Radiant).radius > lights::def(l).radius) {
        light = Some(LightKind::Radiant);
    }
    Ok(Sheet {
        attrs,
        max_hp: attributes::hp(def.base_hp, attrs.get(Attr::Con)) + bonus_hp,
        speed: move_speed(def.speed, start.get(Attr::Con), &attrs) * (1.0 + move_frac),
        weight,
        res,
        effect_res,
        melee,
        ranged,
        light,
        keystones: ks,
        sight: prof.sight,
        primary,
        secondary,
        fallback: strike,
        reach,
        wolf,
    })
}

/// One Attribute of the character screen, by source.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct AttrLine {
    pub attr: Attr,
    pub total: i32,
    /// Class and race.
    pub class: i32,
    /// Points bought in the shop (and the debug lift).
    pub shop: i32,
    pub tree: i32,
    pub items: i32,
}

/// What the character screen shows of a build: the sheet's numbers and why the loadout may not play.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct SheetSummary {
    pub attrs: Vec<AttrLine>,
    pub hp: f64,
    pub speed: f64,
    pub weight: f64,
    /// The STR the hero pushes with.
    pub push: i32,
    pub save_con: i32,
    pub save_wil: i32,
    /// The non-zero resistances by damage type.
    #[ts(type = "Array<[string, number]>")]
    pub res: Vec<(DamageType, f64)>,
    /// The non-zero effect resistances by effect.
    #[ts(type = "Array<[string, number]>")]
    pub effect_res: Vec<(EffectKind, f64)>,
    /// "Sword", "Light armor", ...
    pub profs: Vec<String>,
    pub keystones: Vec<Keystone>,
    /// Why the build cannot play (Ready and Start refuse it); the numbers are then those of the same
    /// build with the start loadout, or the starter equipment too when the equipment is what fails.
    pub loadout_error: Option<String>,
}

fn spaced(name: &str) -> String {
    let mut out = String::new();
    for (i, ch) in name.chars().enumerate() {
        if i > 0 && ch.is_uppercase() {
            out.push(' ');
        }
        out.push(ch);
    }
    out
}

pub fn prof_name(p: Prof) -> String {
    match p {
        Prof::Weapon(k) => spaced(&format!("{k:?}")),
        Prof::Armor(a) => format!(
            "{} armor",
            match a {
                ArmorClass::Cloth => "Cloth",
                ArmorClass::Light => "Light",
                ArmorClass::Medium => "Medium",
                ArmorClass::Heavy => "Heavy",
            }
        ),
    }
}

/// The proficiency an item needs, spelled like `SheetSummary.profs`; `None` for rings, shoes and belts.
#[allow(dead_code)] // read by the progression.ts export (a test) only
pub fn item_prof(b: &ItemBase) -> Option<String> {
    match b {
        ItemBase::Melee(k, _) | ItemBase::Ranged(k, _) => Some(prof_name(Prof::Weapon(*k))),
        ItemBase::Armor(a) => Some(prof_name(Prof::Armor(a.class))),
        _ => None,
    }
}

/// The character screen's numbers for `b`.
pub fn summary(class: ClassId, b: &Build) -> SheetSummary {
    let (sheet, used, loadout_error) = match hero_sheet(class, b) {
        Ok(s) => (s, b.clone(), None),
        Err(e) => {
            let err = Some(e.message());
            let with_start = Build { loadout: Loadout::start(class), ..b.clone() };
            match hero_sheet(class, &with_start) {
                Ok(s) => (s, with_start, err),
                Err(_) => {
                    let starters = Build { equipment: items::Equipment::starter(class), ..with_start };
                    match hero_sheet(class, &starters) {
                        Ok(s) => (s, starters, err),
                        Err(_) => {
                            let start = Build::start(class);
                            (hero_sheet(class, &start).expect("the class start is valid"), start, err)
                        }
                    }
                }
            }
        }
    };
    let base = classes::start_attrs(class);
    let tree = trees::gains(&used.nodes).attrs;
    let attrs = Attr::ALL
        .iter()
        .map(|&a| {
            let total = sheet.attrs.get(a);
            let (class, shop, tree) = (base.get(a), used.extra.get(a), tree.get(a));
            AttrLine { attr: a, total, class, shop, tree, items: total - class - shop - tree }
        })
        .collect();
    let mut profs: Vec<String> = Vec::new();
    for p in self::profs(class, &used.nodes) {
        let name = prof_name(p);
        if !profs.contains(&name) {
            profs.push(name);
        }
    }
    SheetSummary {
        attrs,
        hp: sheet.max_hp,
        speed: sheet.speed,
        weight: sheet.weight,
        push: sheet.attrs.get(Attr::Str),
        save_con: sheet.save(Attr::Con),
        save_wil: sheet.save(Attr::Wil),
        res: DamageType::ALL.iter().map(|&t| (t, sheet.res.get(t))).filter(|r| r.1 != 0.0).collect(),
        effect_res: EffectKind::ALL.iter().map(|&k| (k, sheet.effect_res.get(k))).filter(|r| r.1 != 0.0).collect(),
        profs,
        keystones: sheet.keystones.iter().collect(),
        loadout_error,
    }
}

impl Sheet {
    /// The Attribute a save is made with: its value, and Unbreakable adds 4 to CON.
    pub fn save(&self, a: Attr) -> i32 {
        self.attrs.get(a) + if a == Attr::Con && self.keystones.has(Keystone::Unbreakable) { UNBREAKABLE_CON } else { 0 }
    }
}

/// What Unbreakable adds to the CON of every save.
const UNBREAKABLE_CON: i32 = 4;

/// The static keystones that change a resolved ability: Arcane Overflow (spells) and Pyromancer.
fn keystone_ability(mut r: ResolvedAbility, d: &AbilityDef, ks: &KeystoneSet) -> ResolvedAbility {
    if ks.has(Keystone::ArcaneOverflow) && d.category == AbilityCategory::Spell {
        r.base.keystone_mult *= 1.15;
        r.cooldown *= 1.1;
    }
    if ks.has(Keystone::Pyromancer) {
        r.base.keystone_mult *= 1.0 + 0.2 * r.split.share(DamageType::Heat) - 0.2 * r.split.share(DamageType::Cold);
    }
    r.damage = r.base.amount();
    r
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
    use crate::defs::kinds::EntityKind;
    use crate::defs::companions::WOLF_HP;

    #[test]
    fn item_prof_names_the_needed_proficiency() {
        assert_eq!(item_prof(&items::def(ItemId::Rapier).base).as_deref(), Some("Duelling Sword"));
        assert_eq!(item_prof(&items::def(ItemId::SilkRobe).base).as_deref(), Some("Cloth armor"));
        assert_eq!(item_prof(&items::def(ItemId::BandOfVigor).base), None);
    }

    fn plus(a: Attr, n: i32) -> Attributes {
        let mut x = Attributes::default();
        x.add(a, n);
        x
    }

    #[test]
    fn own_split_and_share_and_effect_resolve() {
        use crate::defs::abilities::{OwnEffect, WeaponMult};
        use crate::defs::effects::EffectLook;
        let sheet = hero_sheet(ClassId::Paladin, &Build::start(ClassId::Paladin)).unwrap();
        let resolve = |d: &AbilityDef| resolve_ability(d, &sheet.attrs, &sheet.melee, sheet.ranged.as_ref(), sheet.reach).unwrap();
        // An own split wins over the projectile's.
        let mm = ab::def(AbilityId::MagicMissile);
        let cold = DamageSplit::pure(DamageType::Cold);
        assert_eq!(resolve(&mm).split, kind_split(EntityKind::Missile));
        let own = ab::OwnStats { split: Some(cold), ..mm.own };
        assert_eq!(resolve(&AbilityDef { own, ..mm }).split, cold);
        // A weapon share on top of the sword.
        let strike = ab::def(AbilityId::Strike);
        assert_eq!(resolve(&strike).split, sheet.melee.split);
        let shared = AbilityDef { weapon_mult: WeaponMult { share: Some((DamageType::Magical, 0.3)), ..WeaponMult::ONE }, ..strike };
        let r = resolve(&shared);
        assert!((r.split.share(DamageType::Magical) - 0.3).abs() < 1e-12 && (r.split.share(DamageType::Physical) - 0.7).abs() < 1e-12, "{:?}", r.split);
        // An own effect: power from its Attribute, secs from the duration.
        let hl = ab::def(AbilityId::HolyLight);
        assert_eq!(resolve(&hl).effect, None);
        let own = ab::OwnStats { duration: 4.0, effect: Some(OwnEffect { kind: EffectKind::Warded, power: Attr::Cha, look: EffectLook::Plain }), ..hl.own };
        let e = resolve(&AbilityDef { own, ..hl }).effect.expect("an own effect");
        assert_eq!((e.kind, e.secs, e.power, e.magical, e.look), (EffectKind::Warded, 4.0, sheet.attrs.get(Attr::Cha), true, EffectLook::Plain));
    }

    /// The class start with `extra` Attribute points and `equip`.
    fn sheet_of(class: ClassId, extra: Attributes, equip: &Equipment) -> Sheet {
        let b = Build { extra, equipment: *equip, ..Build::start(class) };
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
            let s = sheet_of(c, Attributes::default(), &Equipment::starter(c));
            assert_eq!(s.max_hp, d.hp, "{c:?}");
            assert_eq!(s.speed, d.speed, "{c:?}");
            assert_eq!(s.weight, d.weight, "{c:?}");
            same(&s.primary, primary);
            same(&s.secondary, secondary);
            assert_eq!(s.reach, 22.0, "{c:?}");
            assert_eq!(s.fallback.id, Strike, "{c:?}");
            assert_eq!(s.fallback.range, 22.0, "{c:?}");
            assert_eq!((s.fallback.damage, s.fallback.cooldown), (s.melee.damage, s.melee.cooldown), "{c:?}");
            assert_eq!(s.melee.split, DamageSplit::physical(), "{c:?}");
            assert_eq!(s.light, None, "{c:?}");
            assert_eq!(s.res, classes::profile(c).res, "{c:?}");
        }
        let sheet = |c| sheet_of(c, Attributes::default(), &Equipment::starter(c));
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
    fn tree_points_resistances_and_proficiencies_reach_the_sheet() {
        use crate::defs::trees::NodeId;
        let c = ClassId::Wizard;
        let b = Build { nodes: vec![NodeId::WA1, NodeId::WF1, NodeId::WF3, NodeId::WB1, NodeId::WB3], ..Build::start(c) };
        let s = hero_sheet(c, &b).unwrap();
        let start = hero_sheet(c, &Build::start(c)).unwrap();
        assert_eq!(s.attrs.get(Attr::Int), start.attrs.get(Attr::Int) + 1);
        assert_eq!(s.max_hp, start.max_hp + 5.0, "CON +1");
        assert!((s.res.get(DamageType::Cold) - start.res.get(DamageType::Cold) - 0.2).abs() < 1e-12);
        // Light armor: refused without the node, fine with it.
        let robe = |nodes: Vec<NodeId>| Build { nodes, equipment: Equipment::starter(c).with(EquipSlot::Armor, ItemId::LeatherArmor), ..Build::start(c) };
        assert!(matches!(hero_sheet(c, &robe(vec![])), Err(LoadoutError::Equip(EquipSlot::Armor, items::EquipError::NotProficient))));
        assert!(hero_sheet(c, &robe(vec![NodeId::WB1, NodeId::WB3])).is_ok());
    }

    #[test]
    fn a_weapon_proficiency_node_lets_the_class_wield_it() {
        use crate::defs::trees::NodeId;
        let c = ClassId::ElvenRanger;
        let bow = |nodes: Vec<NodeId>| Build { nodes, equipment: Equipment::starter(c).with(EquipSlot::Ranged, ItemId::SkeletonLongbow), ..Build::start(c) };
        let r = hero_sheet(c, &bow(vec![]));
        assert!(matches!(r, Err(LoadoutError::Equip(EquipSlot::Ranged, items::EquipError::NotProficient))), "{r:?}");
        assert!(hero_sheet(c, &bow(vec![NodeId::EL3])).is_ok());
    }

    #[test]
    fn an_unlock_puts_the_ability_in_the_pool() {
        use crate::defs::loadout::Source;
        use crate::defs::trees::NodeId;
        let c = ClassId::Wizard;
        let pick = Pick { ability: AbilityId::FrostShard, source: Source::Own };
        let mut b = Build::start(c);
        b.loadout.primary = pick;
        assert_eq!(hero_sheet(c, &b).err(), Some(LoadoutError::NotInPool(AbilityId::FrostShard)));
        b.nodes = vec![NodeId::WF1];
        assert_eq!(hero_sheet(c, &b).unwrap().primary.id, AbilityId::FrostShard);
    }

    #[test]
    fn improvements_apply_only_to_the_equipped_ability() {
        use crate::defs::trees::NodeId;
        let c = ClassId::Paladin;
        let plain = hero_sheet(c, &Build::start(c)).unwrap();
        let honed = hero_sheet(c, &Build { nodes: vec![NodeId::PR1], ..Build::start(c) }).unwrap();
        assert!((honed.primary.damage - plain.primary.damage * 1.1).abs() < 1e-9, "Strike equipped");
        assert_eq!(honed.fallback.damage, plain.fallback.damage, "never on the fallback");
        // Greater Light (PU2) behind +1 CHA (PU1): compare with the same CHA bought in the shop.
        let cha = hero_sheet(c, &Build { extra: Attributes::new(0, 0, 0, 0, 0, 1), ..Build::start(c) }).unwrap();
        let greater = hero_sheet(c, &Build { nodes: vec![NodeId::PU1, NodeId::PU2], ..Build::start(c) }).unwrap();
        assert!((greater.secondary.damage - cha.secondary.damage * 1.25).abs() < 1e-9, "Holy Light equipped");
        // Not equipped, not improved: Strike's node does nothing to a Paladin whose primary is another ability.
        let hl_only = hero_sheet(c, &Build { nodes: vec![NodeId::PR1], ..Build::start(c) }).unwrap();
        assert_eq!(hl_only.secondary.damage, plain.secondary.damage);
    }

    #[test]
    fn an_item_version_gets_the_tree_improvement_too() {
        use crate::defs::loadout::Source;
        use crate::defs::trees::NodeId;
        // Ruling 1: a Wizard with Piercing Missiles (WA1, WA2) picking the Seeker's Band's Magic Missile pierces 2.
        let c = ClassId::Wizard;
        let equipment = Equipment::starter(c).with(EquipSlot::Ring1, ItemId::SeekersBand);
        let item_pick = Pick { ability: AbilityId::MagicMissile, source: Source::Item(EquipSlot::Ring1) };
        let with = |nodes: Vec<NodeId>, pick: Pick| {
            let mut b = Build { nodes, equipment, ..Build::start(c) };
            b.loadout.primary = pick;
            hero_sheet(c, &b).unwrap().primary
        };
        let own_pick = Pick { ability: AbilityId::MagicMissile, source: Source::Own };
        assert_eq!(with(vec![], item_pick).pierce, 1, "the band alone");
        assert_eq!(with(vec![NodeId::WA1, NodeId::WA2], item_pick).pierce, 2, "the band and the node");
        assert_eq!(with(vec![NodeId::WA1, NodeId::WA2], own_pick).pierce, 1, "the node alone");
    }

    #[test]
    fn attrs_with_and_without_items() {
        use crate::defs::trees::NodeId;
        let c = ClassId::Paladin;
        let b = Build { nodes: vec![NodeId::PU1], extra: Attributes::new(1, 0, 0, 0, 0, 0), equipment: Equipment::starter(c).with(EquipSlot::Ring1, ItemId::BandOfVigor), ..Build::start(c) };
        let without = attrs_without_items(c, &b);
        assert_eq!(without.get(Attr::Str), 16);
        assert_eq!(without.get(Attr::Cha), 15);
        assert!(attrs_with_items(c, &b).get(Attr::Con) > without.get(Attr::Con), "the band's CON counts with items only");
        assert_eq!(attrs_with_items(c, &b), hero_sheet(c, &b).unwrap().attrs, "the same numbers the sheet uses");
    }

    #[test]
    fn profs_are_the_class_plus_the_tree() {
        use crate::defs::trees::NodeId;
        let c = ClassId::Wizard;
        assert_eq!(profs(c, &[]), classes::prof_base(c));
        assert!(profs(c, &[NodeId::WB3]).contains(&Prof::Armor(crate::defs::items::ArmorClass::Light)));
    }

    #[test]
    fn attributes_move_the_numbers() {
        let w = sheet_of(ClassId::Wizard, plus(Attr::Int, 2), &Equipment::starter(ClassId::Wizard));
        assert!((w.primary.damage - 12.0 * 1.35 / 1.25).abs() < 1e-12);
        let b = sheet_of(ClassId::Barbarian, plus(Attr::Dex, 2), &Equipment::starter(ClassId::Barbarian));
        assert!((b.primary.cooldown - 0.8 / (1.10 / 1.06)).abs() < 1e-12);
        assert!((b.primary.arc - 2.45 * 1.15 / 1.09).abs() < 1e-12);
        let p = sheet_of(ClassId::Paladin, plus(Attr::Con, 2), &Equipment::starter(ClassId::Paladin));
        assert_eq!(p.max_hp, 130.0);
        assert!((p.speed - 66.0 * 1.05 / 1.03).abs() < 1e-12);
    }

    #[test]
    fn attributes_move_the_ranger_numbers() {
        // The ranger starts at DEX 15 (class 13 + Elf 2) and STR 10.
        let dex = sheet_of(ClassId::ElvenRanger, plus(Attr::Dex, 2), &Equipment::starter(ClassId::ElvenRanger));
        let bow = dex.primary;
        assert!((bow.damage - 16.0 * 1.35 / 1.25).abs() < 1e-12, "bow damage by DEX");
        assert!((bow.cooldown - 0.7 / (1.14 / 1.10)).abs() < 1e-12, "firing speed by DEX");
        assert_eq!((bow.range, bow.speed), (260.0, 290.0), "DEX does not move the reach");
        let thrust = dex.fallback;
        assert!((thrust.damage - 18.0 * 1.35 / 1.25).abs() < 1e-12, "rapier damage by DEX");
        assert!((thrust.cooldown - 0.35 / (1.14 / 1.10)).abs() < 1e-12, "rapier speed by DEX");
        assert_eq!(thrust.range, 22.0);
        let str2 = sheet_of(ClassId::ElvenRanger, plus(Attr::Str, 2), &Equipment::starter(ClassId::ElvenRanger)).primary;
        assert!((str2.range - 260.0 * 1.04 / 1.00).abs() < 1e-12, "range by STR");
        assert!((str2.speed - 290.0 * 1.04 / 1.00).abs() < 1e-12, "projectile speed by STR");
        assert_eq!((str2.damage, str2.cooldown), (16.0, 0.7), "STR does not move damage or speed");
    }

    /// Every (class, ability) the class's loadout allows, with the sheet built around it.
    fn every_allowed_ability(extra: Attributes, ring: Option<ItemId>) -> Vec<(ClassId, ResolvedAbility, ResolvedAbility)> {
        use crate::defs::abilities as ab;
        use crate::defs::loadout::{Loadout, Source};
        let mut out = vec![];
        for class in ClassId::ALL {
            for id in AbilityId::ALL {
                let slot = ab::def(id).slot;
                let mut picks = vec![Pick { ability: id, source: Source::Own }];
                let mut equipment = Equipment::starter(class);
                if let Some(r) = ring {
                    equipment = equipment.with(EquipSlot::Ring1, r);
                    picks.push(Pick { ability: id, source: Source::Item(EquipSlot::Ring1) });
                }
                for pick in picks {
                    let start = Loadout::start(class);
                    let loadout = match slot {
                        AbilitySlot::Primary => Loadout { primary: pick, ..start },
                        AbilitySlot::Secondary => Loadout { secondary: pick, ..start },
                    };
                    let build = Build { extra, equipment, loadout, own: vec![id], ..Build::start(class) };
                    if let Ok(s) = hero_sheet(class, &build) {
                        out.push((class, if slot == AbilitySlot::Primary { s.primary } else { s.secondary }, s.fallback));
                    }
                }
            }
        }
        out
    }

    #[test]
    fn damage_is_its_base_amount_for_every_ability() {
        let mut seen = 0;
        {
            for lift in [0, 4] {
                for attr in [Attr::Int, Attr::Str, Attr::Dex] {
                    let mut extra = Attributes::default();
                    extra.add(attr, lift);
                    for ring in [None, Some(ItemId::RingOfTheMagus)] {
                        for (class, a, fb) in every_allowed_ability(extra, ring) {
                            assert_eq!(a.damage.to_bits(), a.base.amount().to_bits(), "{class:?} {:?} {attr:?}+{lift}", a.id);
                            assert_eq!(fb.damage.to_bits(), fb.base.amount().to_bits(), "{class:?} fallback");
                            assert_eq!(fb.base.keystone_mult, 1.0, "{class:?} fallback");
                            assert_eq!(a.base.keystone_mult, 1.0, "{class:?} {:?}", a.id);
                            if a.id == AbilityId::MagicMissile && a.base.mods_mult != 1.0 {
                                assert_eq!(a.base.mods_mult, 0.75, "the ring's DamageMul");
                            } else {
                                assert_eq!(a.base.mods_mult, 1.0);
                            }
                            seen += 1;
                        }
                    }
                }
            }
        }
        assert!(seen > 100, "{seen} sheets");
        let wiz = every_allowed_ability(Attributes::default(), Some(ItemId::RingOfTheMagus));
        assert!(wiz.iter().any(|(_, a, _)| a.id == AbilityId::MagicMissile && a.base.mods_mult == 0.75), "the ring's version was built");
    }

    #[test]
    fn the_base_names_the_governing_attribute() {
        use crate::defs::abilities as ab;
        use crate::defs::loadout::{Loadout, Source};
        let class = ClassId::Wizard;
        let at = ab::def(AbilityId::FrostShard).own.at;
        let pick = Pick { ability: AbilityId::FrostShard, source: Source::Own };
        let mk = |extra| hero_sheet(class, &Build { extra, loadout: Loadout { primary: pick, ..Loadout::start(class) }, own: vec![AbilityId::FrostShard], ..Build::start(class) }).unwrap().primary;
        let have0 = mk(Attributes::default()).base.scale.expect("scaled").have;
        let mut extra = Attributes::default();
        extra.add(Attr::Int, 16 - have0);
        let sc = mk(extra).base.scale.expect("a spell is scaled");
        assert_eq!((sc.attr, sc.have, sc.at), (Attr::Int, 16, at));

        let strike = hero_sheet(ClassId::Paladin, &Build::start(ClassId::Paladin)).unwrap().primary;
        assert_eq!(strike.id, AbilityId::Strike);
        let sc = strike.base.scale.expect("a weapon is scaled");
        let ItemBase::Melee(_, stats) = items::def(Equipment::starter(ClassId::Paladin).get(EquipSlot::Melee).unwrap()).base else { panic!("a melee starter") };
        assert_eq!((sc.attr, sc.at), (Attr::Str, stats.at.str));
        assert_eq!(strike.base.given, stats.damage);
    }

    fn with(c: ClassId, extra: Attributes, items: &[(EquipSlot, ItemId)]) -> Sheet {
        let e = items.iter().fold(Equipment::starter(c), |e, &(s, i)| e.with(s, i));
        sheet_of(c, extra, &e)
    }

    #[test]
    fn an_empty_melee_slot_is_the_starter() {
        let c = ClassId::Paladin;
        let a = sheet_of(c, Attributes::default(), &Equipment::default());
        let b = sheet_of(c, Attributes::default(), &Equipment::starter(c));
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
        let start = sheet_of(ClassId::Wizard, Attributes::default(), &Equipment::starter(ClassId::Wizard));
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

    fn with_nodes(c: ClassId, nodes: &[NodeId]) -> Sheet {
        hero_sheet(c, &Build { nodes: nodes.to_vec(), extra: Attributes::new(5, 5, 5, 5, 5, 5), ..Build::start(c) }).unwrap()
    }

    #[test]
    fn arcane_overflow_and_pyromancer_change_spells() {
        let c = ClassId::Wizard;
        let base = with_nodes(c, &[]);
        // Only the keystone node, so the Attributes stay equal and the damage compares directly.
        let arc = with_nodes(c, &[NodeId::WA5]);
        assert_eq!(base.primary.base.keystone_mult, 1.0);
        assert_eq!(arc.primary.base.keystone_mult, 1.15);
        assert_eq!(arc.secondary.base.keystone_mult, 1.15);
        assert!((arc.primary.cooldown - base.primary.cooldown * 1.1).abs() < 1e-12);
        assert!((arc.secondary.cooldown - base.secondary.cooldown * 1.1).abs() < 1e-12);
        assert!((arc.primary.damage - base.primary.damage * 1.15).abs() < 1e-9);
        assert_eq!(arc.fallback.base.keystone_mult, 1.0, "Strike is a weapon attack");
        assert_eq!(arc.fallback.cooldown, base.fallback.cooldown);
        let pyro = with_nodes(c, &[NodeId::WR5]);
        assert!(pyro.secondary.split.share(DamageType::Heat) > 0.69 && pyro.secondary.split.share(DamageType::Heat) < 0.71);
        assert!((pyro.secondary.base.keystone_mult - (1.0 + 0.2 * pyro.secondary.split.share(DamageType::Heat))).abs() < 1e-12);
        assert_eq!(pyro.primary.base.keystone_mult, 1.0, "Magic Missile has no heat or cold");
        assert_eq!(pyro.primary.cooldown, base.primary.cooldown);
        assert!((pyro.secondary.damage - base.secondary.damage * pyro.secondary.base.keystone_mult).abs() < 1e-9);
        assert_eq!(pyro.keystones.iter().collect::<Vec<_>>(), vec![Keystone::Pyromancer]);
    }

    #[test]
    fn defensive_keystones() {
        let p0 = with_nodes(ClassId::Paladin, &[]);
        let p = with_nodes(ClassId::Paladin, &[NodeId::PL5]);
        assert_eq!(p.effect_res.get(EffectKind::Sleep), 1.0 + p0.effect_res.get(EffectKind::Sleep));
        let j = with_nodes(ClassId::Barbarian, &[NodeId::BL5]);
        let b0 = with_nodes(ClassId::Barbarian, &[]);
        assert_eq!(j.weight, b0.weight + 4.0);
        for k in [EffectKind::Slowed, EffectKind::Chilled, EffectKind::Entangled] {
            assert_eq!(j.effect_res.get(k), b0.effect_res.get(k) + 1.0);
        }
        let u = with_nodes(ClassId::Barbarian, &[NodeId::BD5]);
        assert_eq!(u.save(Attr::Con), u.attrs.get(Attr::Con) + 4);
        assert_eq!(u.save(Attr::Wil), u.attrs.get(Attr::Wil));
        assert_eq!((u.weight, u.max_hp, u.speed), (b0.weight, b0.max_hp, b0.speed), "saves only");
        assert_eq!(b0.save(Attr::Con), b0.attrs.get(Attr::Con));
    }

    #[test]
    fn bulwark_halves_armor_weight() {
        let c = ClassId::Paladin;
        let build = |nodes: &[NodeId]| Build { nodes: nodes.to_vec(), extra: Attributes::new(5, 5, 5, 5, 5, 5), equipment: Equipment::starter(c).with(EquipSlot::Armor, ItemId::PlateArmor), ..Build::start(c) };
        let plain = hero_sheet(c, &build(&[])).unwrap();
        let bul = hero_sheet(c, &build(&[NodeId::PR5])).unwrap();
        assert_eq!(plain.weight, 12.0 + 7.0);
        assert_eq!(bul.weight, 12.0 + 3.5);
        assert!((bul.res.get(DamageType::Physical) - plain.res.get(DamageType::Physical) - 0.1).abs() < 1e-12);
    }

    #[test]
    fn radiant_sheds_light() {
        let c = ClassId::Paladin;
        let r = with_nodes(c, &[NodeId::PU5]);
        assert_eq!(r.light, Some(LightKind::Radiant));
        assert_eq!(with_nodes(c, &[]).light, None);
        let gold = hero_sheet(c, &Build { nodes: vec![NodeId::PU5], extra: Attributes::new(5, 5, 5, 5, 5, 5), equipment: Equipment::starter(c).with(EquipSlot::Melee, ItemId::GoldenSword), ..Build::start(c) }).unwrap();
        assert_eq!(gold.light, Some(LightKind::Holy), "the larger light wins");
    }

    #[test]
    fn summary_lists_sources() {
        use crate::defs::trees::NodeId;
        let c = ClassId::Paladin;
        let b = Build { nodes: vec![NodeId::PU1], extra: Attributes::new(1, 0, 0, 0, 0, 0), equipment: Equipment::starter(c).with(EquipSlot::Ring1, ItemId::BandOfVigor).with(EquipSlot::Armor, ItemId::PlateArmor), ..Build::start(c) };
        let s = summary(c, &b);
        assert_eq!(s.loadout_error, None);
        let line = |a: Attr| s.attrs.iter().find(|l| l.attr == a).unwrap();
        let cha = line(Attr::Cha);
        assert_eq!((cha.class, cha.shop, cha.tree, cha.items, cha.total), (14, 0, 1, 0, 15));
        let str_ = line(Attr::Str);
        assert_eq!((str_.shop, str_.tree, str_.items), (1, 0, 0));
        let con = line(Attr::Con);
        assert_eq!((con.shop, con.tree, con.items), (0, 0, 1));
        for l in &s.attrs {
            assert_eq!(l.total, l.class + l.shop + l.tree + l.items, "{:?}", l.attr);
        }
        let sheet = hero_sheet(c, &b).unwrap();
        assert_eq!(s.attrs.iter().map(|l| l.total).collect::<Vec<_>>(), Attr::ALL.map(|a| sheet.attrs.get(a)).to_vec());
        assert_eq!((s.hp, s.speed, s.weight, s.push), (sheet.max_hp, sheet.speed, sheet.weight, sheet.attrs.get(Attr::Str)));
        assert_eq!((s.save_con, s.save_wil), (sheet.save(Attr::Con), sheet.save(Attr::Wil)));
        assert!(s.res.iter().all(|r| r.1 != 0.0) && s.effect_res.iter().all(|r| r.1 != 0.0), "only non-zero resistances");
        assert!(s.res.iter().any(|r| r.0 == DamageType::Physical), "the paladin's armor shows");
        assert!(s.profs.iter().any(|p| p == "Sword") && s.profs.iter().any(|p| p == "Heavy armor"), "{:?}", s.profs);
        assert!(s.keystones.is_empty());
        let radiant = summary(c, &Build { nodes: vec![NodeId::PU5], ..Build::start(c) });
        assert_eq!(radiant.keystones, vec![Keystone::Radiant]);
    }

    #[test]
    fn unequipping_a_granting_item_reports_the_loadout() {
        let c = ClassId::Paladin;
        let mut b = Build::start(c);
        b.equipment = Equipment::starter(c).with(EquipSlot::Ring1, ItemId::RingOfTheMagus);
        b.loadout.primary = Pick { ability: AbilityId::MagicMissile, source: crate::defs::loadout::Source::Item(EquipSlot::Ring1) };
        assert_eq!(summary(c, &b).loadout_error, None);
        b.equipment.set(EquipSlot::Ring1, None);
        let s = summary(c, &b);
        assert_eq!(s.loadout_error.as_deref(), Some("Magic Missile is not one of your abilities."));
        assert_eq!(s.attrs.len(), Attr::COUNT);
        assert!(s.hp > 0.0, "the numbers come from the start loadout");
    }

    #[test]
    fn a_failing_equipment_falls_back_to_the_starters() {
        let c = ClassId::Paladin;
        let mut b = Build::start(c);
        b.equipment.set(EquipSlot::Armor, Some(ItemId::LeatherArmor));
        b.equipment.set(EquipSlot::Melee, Some(ItemId::StaffOfRot));
        let s = summary(c, &b);
        assert!(s.loadout_error.is_some() && s.hp > 0.0);
    }
}
