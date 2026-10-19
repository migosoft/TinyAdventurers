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
/// A hit whose share of an element is at least this applies the element's effect.
pub const ELEMENT_SHARE: f64 = 0.5;
/// Element → the effect its hits apply. A new elemental effect is one line here.
pub const ELEMENTS: [(DamageType, EffectKind); 3] = [(Heat, EffectKind::Burning), (Cold, EffectKind::Frozen), (Poison, EffectKind::Poisoned)];

/// The effects a hit with this split applies (in `ELEMENTS` order).
pub fn element_effects(split: &super::damage::DamageSplit) -> Vec<EffectKind> {
    ELEMENTS.iter().filter(|(t, _)| split.share(*t) >= ELEMENT_SHARE - 1e-9).map(|&(_, k)| k).collect()
}

/// Duration factor for a `Reduced` response.
pub const EFFECT_REDUCED: f64 = 0.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectResponse {
    Immune,
    Reduced,
    Full,
}

/// How a creature takes each effect; `Full` unless listed.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EffectResponses([EffectResponse; EffectKind::COUNT]);

impl EffectResponses {
    pub const FULL: EffectResponses = EffectResponses([EffectResponse::Full; EffectKind::COUNT]);
    pub fn of(parts: &[(EffectKind, EffectResponse)]) -> Self {
        let mut r = Self::FULL;
        for &(k, v) in parts {
            r.0[k as usize] = v;
        }
        r
    }
    pub fn get(&self, k: EffectKind) -> EffectResponse {
        self.0[k as usize]
    }
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

/// The least power of an element's effect from a hit's split (non-magical): terrain,
/// barrels and sources without a governing Attribute use it; stronger sources their own.
pub const ELEMENT_POWER: i32 = 10;

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
    if matches!(stat, Stat::Resist(_)) && v > base {
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
    fn responses_default_to_full() {
        let r = EffectResponses::of(&[(EffectKind::Sleep, EffectResponse::Immune)]);
        assert_eq!(r.get(EffectKind::Sleep), EffectResponse::Immune);
        assert_eq!(r.get(EffectKind::Blind), EffectResponse::Full);
        assert_eq!(EffectResponses::FULL.get(EffectKind::Petrified), EffectResponse::Full);
    }

    #[test]
    fn elemental_effects_match_the_spec() {
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
    fn a_hit_applies_the_effect_of_each_element_making_up_half_of_it() {
        use crate::defs::damage::DamageSplit;
        assert_eq!(element_effects(&DamageSplit::pure(Heat)), vec![EffectKind::Burning]);
        assert_eq!(element_effects(&DamageSplit::split(&[(Heat, 0.7), (Magical, 0.2)])), vec![EffectKind::Burning], "fireball");
        assert_eq!(element_effects(&DamageSplit::split(&[(Heat, 0.5)])), vec![EffectKind::Burning], "barrel blast: exactly half");
        assert!(element_effects(&DamageSplit::split(&[(Heat, 0.2)])).is_empty(), "claws");
        assert_eq!(element_effects(&DamageSplit::pure(Cold)), vec![EffectKind::Frozen]);
        assert_eq!(element_effects(&DamageSplit::pure(Poison)), vec![EffectKind::Poisoned]);
        assert!(element_effects(&DamageSplit::physical()).is_empty());
        assert_eq!(element_effects(&DamageSplit::split(&[(Heat, 0.5), (Cold, 0.5)])), vec![EffectKind::Burning, EffectKind::Frozen]);
    }
}
