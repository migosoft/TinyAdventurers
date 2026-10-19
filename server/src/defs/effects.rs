//! Status effects: data only (like `defs/lights.rs`). The timers live in
//! `run/effects.rs`. Adding an effect: a new `EffectKind` (next id), its
//! `def`, a client visual in `client/src/game/status.ts` and a HUD glyph.

use super::damage::DamageType;
use serde::Serialize;

super::enum_list::listed_enum! {
    /// Open set. The id is the effect's bit in the snapshot's `u16` bitmask.
    /// `ALL` and `COUNT` grow with a new variant (`listed_enum!`).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
    pub enum EffectKind: u8 {
        Blind = 0,
        Sleep = 1,
        Petrified = 2,
        Slowed = 3,
        Accelerated = 4,
        Burning = 5,
        Frozen = 6,
        Poisoned = 7,
    }
}

const _: () = assert!(EffectKind::COUNT <= 16, "an effect's id is its bit in the snapshot's u16 mask");

impl EffectKind {
    pub fn bit(self) -> u16 {
        1 << self as u8
    }
    pub fn from_u8(v: u8) -> Option<EffectKind> {
        EffectKind::ALL.get(v as usize).copied()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Stat {
    /// Factor on the creature's move speed (base 1).
    MoveSpeed,
    /// Tiles.
    Vision,
    /// Share of vision.
    Darkvision,
    Resist(DamageType),
    /// An effect resistance (see `EffectResistances`).
    ResistEffect(EffectKind),
    /// Factor on knockback distances taken (base 1).
    KnockTaken,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Add,
    Mul,
    Set,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StatMod {
    pub stat: Stat,
    pub op: Op,
    pub value: f64,
}

const fn m(stat: Stat, op: Op, value: f64) -> StatMod {
    StatMod { stat, op, value }
}

#[derive(Debug, Clone, Copy)]
pub struct EffectDef {
    /// Default seconds (a source may pass its own).
    pub duration: f64,
    /// Good for the creature (HUD frame green instead of red).
    pub positive: bool,
    pub mods: &'static [StatMod],
    pub no_move: bool,
    pub no_act: bool,
    pub no_turn: bool,
    /// Lying down (drawn rotated on the client).
    pub prone: bool,
    /// Damage ends it (none yet; for a future monster sleep).
    pub wakes_on_damage: bool,
    /// A teammate's E next to the creature ends it.
    pub wakes_on_use: bool,
    /// Damage over time: its type and damage per second, dealt every `DOT_TICK`
    /// as effect damage. A creature fully resistant to the type never takes the effect.
    pub dot: Option<(DamageType, f64)>,
    /// Applying this effect ends these instead (fire thaws ice, ice puts out fire).
    pub cancels: &'static [EffectKind],
    /// Standing in shallow or deep water ends it.
    pub ends_in_water: bool,
}

const NONE: EffectDef = EffectDef { duration: 3.0, positive: false, mods: &[], no_move: false, no_act: false, no_turn: false, prone: false, wakes_on_damage: false, wakes_on_use: false, dot: None, cancels: &[], ends_in_water: false };

use DamageType::*;
use Op::*;
use Stat::*;

const BLIND_MODS: &[StatMod] = &[m(Vision, Set, 0.0), m(Darkvision, Set, 0.0)];
const SLEEP_MODS: &[StatMod] = &[m(Vision, Mul, 0.15)];
const PETRIFIED_MODS: &[StatMod] = &[
    m(Resist(Physical), Add, 0.75),
    m(Resist(Cold), Add, 0.5),
    m(Resist(Heat), Add, 0.5),
    m(Resist(Magical), Add, 0.5),
    m(Resist(Poison), Add, 0.5),
    m(KnockTaken, Mul, 0.4),
];
const SLOWED_MODS: &[StatMod] = &[m(MoveSpeed, Mul, 0.5)];
const ACCELERATED_MODS: &[StatMod] = &[m(MoveSpeed, Mul, 1.5)];
const FROZEN_CANCELS: &[EffectKind] = &[EffectKind::Frozen];
const BURNING_CANCELS: &[EffectKind] = &[EffectKind::Burning];

pub fn def(k: EffectKind) -> EffectDef {
    match k {
        EffectKind::Blind => EffectDef { mods: BLIND_MODS, ..NONE },
        EffectKind::Sleep => EffectDef { duration: 4.0, mods: SLEEP_MODS, no_move: true, no_act: true, prone: true, wakes_on_use: true, ..NONE },
        EffectKind::Petrified => EffectDef { mods: PETRIFIED_MODS, no_move: true, no_act: true, no_turn: true, ..NONE },
        EffectKind::Slowed => EffectDef { mods: SLOWED_MODS, ..NONE },
        EffectKind::Accelerated => EffectDef { positive: true, mods: ACCELERATED_MODS, ..NONE },
        EffectKind::Burning => EffectDef { dot: Some((Heat, 6.0)), cancels: FROZEN_CANCELS, ends_in_water: true, ..NONE },
        EffectKind::Frozen => EffectDef { duration: 2.0, dot: Some((Cold, 4.0)), cancels: BURNING_CANCELS, no_move: true, no_act: true, no_turn: true, ..NONE },
        EffectKind::Poisoned => EffectDef { duration: 4.0, dot: Some((Poison, 4.0)), ..NONE },
    }
}

/// Damage over time ticks this often (s).
pub const DOT_TICK: f64 = 0.5;
/// A hit whose share of a damage type is at least this applies the type's effect.
pub const TYPE_EFFECT_SHARE: f64 = 0.5;
/// Damage type → the effect its hits apply (the damage-type effects). A new one is one
/// line here plus its def's `dot` type (`type_effects_match_their_defs` checks both agree).
pub const TYPE_EFFECTS: [(DamageType, EffectKind); 3] = [(Heat, EffectKind::Burning), (Cold, EffectKind::Frozen), (Poison, EffectKind::Poisoned)];

/// The effects a hit with this split applies (in `TYPE_EFFECTS` order).
pub fn type_effects(split: &super::damage::DamageSplit) -> Vec<EffectKind> {
    TYPE_EFFECTS.iter().filter(|(t, _)| split.share(*t) >= TYPE_EFFECT_SHARE - 1e-9).map(|&(_, k)| k).collect()
}

/// How much a creature resists each effect, as a fraction: 0.5 halves the time,
/// 1 or more refuses it, a negative value lengthens it (floored at
/// `MIN_RESISTANCE`). Held next to the damage `Resistances` (race, the entity's
/// own `Adjust`, later items and tree nodes; effects through `Stat::ResistEffect`).
/// A damage-type effect (one whose def has a `dot`) has none: its type's damage
/// resistance alone resists it. One slot per effect, so a new effect has one at 0.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EffectResistances([f64; EffectKind::COUNT]);

impl EffectResistances {
    pub const NONE: EffectResistances = EffectResistances([0.0; EffectKind::COUNT]);
    pub fn of(parts: &[(EffectKind, f64)]) -> Self {
        let mut r = Self::NONE;
        for &(k, v) in parts {
            r.0[k as usize] += v;
        }
        r
    }
    pub fn get(&self, k: EffectKind) -> f64 {
        self.0[k as usize]
    }
    pub fn set(&mut self, k: EffectKind, v: f64) {
        self.0[k as usize] = v;
    }
    pub fn plus(self, o: EffectResistances) -> Self {
        let mut r = self.0;
        for (a, b) in r.iter_mut().zip(o.0) {
            *a += b;
        }
        EffectResistances(r)
    }
}

/// An effect's seconds after an effect resistance `r`: `secs × (1 − r)`, with `r`
/// floored at `MIN_RESISTANCE`; `None` (refused) at `r >= 1`.
pub fn effect_secs(secs: f64, r: f64) -> Option<f64> {
    (r < 1.0).then(|| secs * (1.0 - r.max(super::damage::MIN_RESISTANCE)))
}

/// An effect a hit applies after its damage (see `Damage::on_hit`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OnHit {
    pub kind: EffectKind,
    pub secs: f64,
    /// 0..=1; 1 or more applies without a roll.
    pub chance: f64,
    /// Saved against with WIL (spells, innate magic) instead of CON.
    pub magical: bool,
    /// The source's key Attribute (spells INT, innate magic CHA, a weapon's
    /// wielder its key Attribute, terrain 10); see `scaled_secs`.
    pub power: i32,
}

/// The least power of a damage-type effect from a hit's split (non-magical): terrain,
/// barrels and sources without a governing Attribute use it; stronger sources their own.
pub const TYPE_EFFECT_POWER: i32 = 10;

/// A harmful effect's seconds after the target's save:
/// `base × max(0, 1 + (power − save) / 20)`. A save 20 above the power: 0 s.
pub fn scaled_secs(base: f64, power: i32, save: i32) -> f64 {
    base * (1.0 + (power - save) as f64 / 20.0).max(0.0)
}

/// `base` with every mod on `stat` of the active `kinds`: all `Add`s, then
/// all `Mul`s, then the lowest `Set`. An effect never lifts a resistance
/// above 1 (immunity) unless the base already is.
pub fn resolve_stat(base: f64, stat: Stat, kinds: &[EffectKind]) -> f64 {
    let mods = || kinds.iter().flat_map(|&k| def(k).mods.iter()).filter(move |md| md.stat == stat);
    let mut v = base + mods().filter(|md| md.op == Op::Add).map(|md| md.value).sum::<f64>();
    v *= mods().filter(|md| md.op == Op::Mul).map(|md| md.value).product::<f64>();
    if let Some(set) = mods().filter(|md| md.op == Op::Set).map(|md| md.value).reduce(f64::min) {
        v = set;
    }
    if matches!(stat, Stat::Resist(_) | Stat::ResistEffect(_)) && v > base {
        v = v.min(base.max(1.0));
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::damage::DamageType::*;

    #[test]
    fn add_then_mul_then_lowest_set() {
        assert_eq!(resolve_stat(100.0, Stat::MoveSpeed, &[]), 100.0);
        assert!((resolve_stat(1.0, Stat::MoveSpeed, &[EffectKind::Slowed, EffectKind::Accelerated]) - 0.75).abs() < 1e-12);
        assert_eq!(resolve_stat(9.0, Stat::Vision, &[EffectKind::Blind]), 0.0);
        assert_eq!(resolve_stat(9.0, Stat::Vision, &[EffectKind::Blind, EffectKind::Sleep]), 0.0, "Set wins over Mul");
        assert!((resolve_stat(9.0, Stat::Vision, &[EffectKind::Sleep]) - 1.35).abs() < 1e-12);
        assert_eq!(resolve_stat(1.0, Stat::Darkvision, &[EffectKind::Blind]), 0.0, "darkvision does not help against blindness");
        assert!((resolve_stat(1.0, Stat::KnockTaken, &[EffectKind::Petrified]) - 0.4).abs() < 1e-12);
        assert!((resolve_stat(0.1, Stat::Resist(Physical), &[EffectKind::Petrified]) - 0.85).abs() < 1e-12);
        assert!((resolve_stat(0.0, Stat::Resist(Heat), &[EffectKind::Petrified]) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn petrify_never_turns_immunity_into_healing() {
        assert_eq!(resolve_stat(1.0, Stat::Resist(Poison), &[EffectKind::Petrified]), 1.0, "undead stay exactly immune");
        assert_eq!(resolve_stat(0.8, Stat::Resist(Physical), &[EffectKind::Petrified]), 1.0, "capped at immunity");
        assert_eq!(resolve_stat(1.5, Stat::Resist(Poison), &[EffectKind::Petrified]), 1.5, "an existing heal stays");
    }

    #[test]
    fn flags_and_defaults_match_the_spec() {
        let s = def(EffectKind::Sleep);
        assert!(s.no_move && s.no_act && s.prone && s.wakes_on_use && !s.no_turn && !s.wakes_on_damage);
        let p = def(EffectKind::Petrified);
        assert!(p.no_move && p.no_act && p.no_turn && !p.wakes_on_use);
        assert!(def(EffectKind::Accelerated).positive);
        assert!(EffectKind::ALL.iter().filter(|&&k| k != EffectKind::Accelerated).all(|&k| !def(k).positive));
        for k in EffectKind::ALL {
            assert_eq!(EffectKind::from_u8(k as u8), Some(k));
            assert_eq!(k.bit(), 1 << k as u8);
        }
        assert_eq!(EffectKind::from_u8(EffectKind::COUNT as u8), None);
    }

    #[test]
    fn effect_resistances_default_to_zero() {
        let r = EffectResistances::of(&[(EffectKind::Sleep, 1.0)]);
        assert_eq!(r.get(EffectKind::Sleep), 1.0);
        assert_eq!(r.get(EffectKind::Blind), 0.0);
        assert_eq!(EffectResistances::NONE.get(EffectKind::Petrified), 0.0);
    }

    #[test]
    fn effect_secs_scales_and_refuses() {
        assert_eq!(effect_secs(4.0, 0.5), Some(2.0));
        assert_eq!(effect_secs(4.0, 1.0), None);
        assert_eq!(effect_secs(4.0, 0.0), Some(4.0));
    }

    #[test]
    fn negative_effect_resistance_lengthens_at_most_double() {
        assert_eq!(effect_secs(4.0, -0.5), Some(6.0));
        assert_eq!(effect_secs(4.0, -3.0), Some(8.0));
    }

    /// One number per thing: a damage-type effect is resisted only by its type's
    /// damage resistance, so no creature holds an effect resistance for it.
    #[test]
    fn damage_type_effects_have_no_effect_resistance() {
        use crate::defs::races::{self, Adjust, Race};
        use crate::defs::{bosses, classes, companions, enemies};
        use crate::protocol::{BossId, ClassId};
        let races = [Race::Human, Race::Goblin, Race::Orc, Race::Ogre, Race::Mimic, Race::Undead, Race::Demon, Race::Dragon, Race::Elf, Race::MagicalBeast, Race::Object];
        let mut tables: Vec<(String, EffectResistances)> = races.iter().map(|&r| (format!("{r:?}"), races::profile(&[r], Adjust::NONE).effect_res)).collect();
        tables.extend(BossId::ALL.iter().map(|&b| (format!("{b:?}"), bosses::profile(b).effect_res)));
        tables.extend(ClassId::ALL.iter().map(|&c| (format!("{c:?}"), classes::profile(c).effect_res)));
        tables.extend(enemies::EnemyType::ALL.iter().map(|&t| (format!("{t:?}"), enemies::profile(t).effect_res)));
        tables.push(("wolf".into(), companions::wolf_profile().effect_res));
        for (who, t) in tables {
            for k in EffectKind::ALL.into_iter().filter(|&k| def(k).dot.is_some()) {
                assert_eq!(t.get(k), 0.0, "{who} sets an effect resistance for the damage-type effect {k:?}");
            }
        }
    }

    #[test]
    fn boss_effect_resistances_follow_the_table() {
        use crate::defs::bosses;
        use crate::protocol::BossId;
        use EffectKind::*;
        let want = |b| match b {
            BossId::Lich => EffectResistances::of(&[(Sleep, 1.0), (Blind, 1.0), (Petrified, 0.5)]),
            BossId::Dragon => EffectResistances::of(&[(Sleep, 1.0), (Blind, 0.5), (Petrified, 0.5), (Slowed, 0.5), (Accelerated, 0.5)]),
            BossId::Demon => EffectResistances::of(&[(Sleep, 1.0)]),
        };
        for b in BossId::ALL {
            assert_eq!(bosses::profile(b).effect_res, want(b), "{b:?}");
        }
    }

    #[test]
    fn damage_type_effects_match_the_spec() {
        let b = def(EffectKind::Burning);
        assert_eq!((b.dot, b.duration, b.ends_in_water), (Some((Heat, 6.0)), 3.0, true));
        assert_eq!(b.cancels, &[EffectKind::Frozen]);
        assert!(!b.no_move && !b.positive);
        let f = def(EffectKind::Frozen);
        assert_eq!((f.dot, f.duration, f.ends_in_water), (Some((Cold, 4.0)), 2.0, false));
        assert_eq!(f.cancels, &[EffectKind::Burning]);
        assert!(f.no_move && f.no_act && f.no_turn && !f.prone);
        let p = def(EffectKind::Poisoned);
        assert_eq!((p.dot, p.duration), (Some((Poison, 4.0)), 4.0));
        assert!(p.cancels.is_empty() && !p.ends_in_water && !p.no_move);
        for k in [EffectKind::Blind, EffectKind::Sleep, EffectKind::Petrified, EffectKind::Slowed, EffectKind::Accelerated] {
            assert!(def(k).dot.is_none() && def(k).cancels.is_empty() && !def(k).ends_in_water, "{k:?}");
        }
        assert_eq!((EffectKind::Burning as u8, EffectKind::Frozen as u8, EffectKind::Poisoned as u8), (5, 6, 7));
        assert_eq!(EffectKind::COUNT, 8);
    }

    #[test]
    fn type_effects_match_their_defs() {
        for (t, k) in TYPE_EFFECTS {
            assert_eq!(def(k).dot.map(|d| d.0), Some(t), "{k:?} is resisted by {t:?}");
        }
        for k in EffectKind::ALL.into_iter().filter(|&k| def(k).dot.is_some()) {
            assert!(TYPE_EFFECTS.iter().any(|&(_, e)| e == k), "{k:?} has a damage type but no hit applies it");
        }
    }

    #[test]
    fn a_hit_applies_the_effect_of_each_damage_type_making_up_half_of_it() {
        use crate::defs::damage::DamageSplit;
        assert_eq!(type_effects(&DamageSplit::pure(Heat)), vec![EffectKind::Burning]);
        assert_eq!(type_effects(&DamageSplit::split(&[(Heat, 0.7), (Magical, 0.2)])), vec![EffectKind::Burning], "fireball");
        assert_eq!(type_effects(&DamageSplit::split(&[(Heat, 0.5)])), vec![EffectKind::Burning], "barrel blast: exactly half");
        assert!(type_effects(&DamageSplit::split(&[(Heat, 0.2)])).is_empty(), "claws");
        assert_eq!(type_effects(&DamageSplit::pure(Cold)), vec![EffectKind::Frozen]);
        assert_eq!(type_effects(&DamageSplit::pure(Poison)), vec![EffectKind::Poisoned]);
        assert!(type_effects(&DamageSplit::physical()).is_empty());
        assert_eq!(type_effects(&DamageSplit::split(&[(Heat, 0.5), (Cold, 0.5)])), vec![EffectKind::Burning, EffectKind::Frozen]);
    }
}
