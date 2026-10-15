//! Status effects: data only (like `defs/lights.rs`). The timers live in
//! `run/effects.rs`. Adding an effect: a new `EffectKind` (next id), its
//! `def`, a client visual in `client/src/game/status.ts` and a HUD glyph.

use super::damage::DamageType;
use serde::Serialize;

/// Open set. The id is the effect's bit in the snapshot's `u16` bitmask.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[repr(u8)]
pub enum EffectKind {
    Blind = 0,
    Sleep = 1,
    Petrified = 2,
    Slowed = 3,
    Accelerated = 4,
}

impl EffectKind {
    pub const COUNT: usize = 5;
    pub const ALL: [EffectKind; EffectKind::COUNT] = [EffectKind::Blind, EffectKind::Sleep, EffectKind::Petrified, EffectKind::Slowed, EffectKind::Accelerated];
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
}

const NONE: EffectDef = EffectDef { duration: 3.0, positive: false, mods: &[], no_move: false, no_act: false, no_turn: false, prone: false, wakes_on_damage: false, wakes_on_use: false };

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

pub fn def(k: EffectKind) -> EffectDef {
    match k {
        EffectKind::Blind => EffectDef { mods: BLIND_MODS, ..NONE },
        EffectKind::Sleep => EffectDef { duration: 4.0, mods: SLEEP_MODS, no_move: true, no_act: true, prone: true, wakes_on_use: true, ..NONE },
        EffectKind::Petrified => EffectDef { mods: PETRIFIED_MODS, no_move: true, no_act: true, no_turn: true, ..NONE },
        EffectKind::Slowed => EffectDef { mods: SLOWED_MODS, ..NONE },
        EffectKind::Accelerated => EffectDef { positive: true, mods: ACCELERATED_MODS, ..NONE },
    }
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
}
