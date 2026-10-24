//! Status effects: data only (like `defs/lights.rs`). The timers live in
//! `run/effects.rs`. Adding an effect: a new `EffectKind` (next id), its
//! `def`, a client visual in `client/src/game/status.ts` and a HUD glyph. A damage-type
//! effect (one a hit applies by its share of a damage type) also sets `resisted_by` (its
//! type's damage resistance alone resists it), `replaces` (the weaker tier it ends) and
//! gets a row in `TYPE_EFFECTS`.

use super::attributes::Attr;
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
        Chilled = 8,
        Singed = 9,
        Tainted = 10,
        Entangled = 11,
        Fear = 12,
        Warded = 13,
        Coated = 14,
    }
}

super::enum_list::listed_enum! {
    /// How an active effect is drawn: the source picks it (Entangle's vines, later a web's
    /// webbing). `Plain` is the effect's default look; the rest travel to the client with it.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub enum EffectLook: u8 {
        Plain = 0,
        Vines = 1,
    }
}

impl Serialize for EffectLook {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u8(*self as u8)
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
    /// Lying down (drawn rotated on the client; exported, so the server never reads it).
    #[allow(dead_code)]
    pub prone: bool,
    /// Damage ends it (none yet; for a future monster sleep).
    pub wakes_on_damage: bool,
    /// A teammate's E next to the creature ends it.
    pub wakes_on_use: bool,
    /// Damage over time: its type and damage per second, dealt every `DOT_TICK`
    /// as effect damage. A creature fully resistant to the type never takes the effect.
    pub dot: Option<(DamageType, f64)>,
    /// The damage type whose resistance alone resists this effect (a damage-type effect:
    /// 100 % refuses it, and it has no effect resistance of its own).
    pub resisted_by: Option<DamageType>,
    /// The weaker tier of the same type: it ends when this effect lands, and a creature
    /// that has this effect does not take it.
    pub replaces: &'static [EffectKind],
    /// Applying this effect ends these instead (fire thaws ice, ice puts out fire).
    pub cancels: &'static [EffectKind],
    /// Standing in shallow or deep water ends it.
    pub ends_in_water: bool,
    /// The Attribute that shortens it (strength breaks roots, will resists fear);
    /// `None`: WIL against a magical source, else CON.
    pub save: Option<Attr>,
    /// The creature runs away from the effect's source and cannot attack (Fear).
    pub flees: bool,
}

const NONE: EffectDef = EffectDef { duration: 3.0, positive: false, mods: &[], no_move: false, no_act: false, no_turn: false, prone: false, wakes_on_damage: false, wakes_on_use: false, dot: None, resisted_by: None, replaces: &[], cancels: &[], ends_in_water: false, save: None, flees: false };

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
/// The effects hostile sources apply magically today (the lich's spells); Fear is saved with
/// WIL but is not magic, so it is left out.
const WARDED_MODS: &[StatMod] = &[m(ResistEffect(EffectKind::Blind), Add, 1.0), m(ResistEffect(EffectKind::Sleep), Add, 1.0), m(ResistEffect(EffectKind::Petrified), Add, 1.0)];
const SLOWED_MODS: &[StatMod] = &[m(MoveSpeed, Mul, 0.5)];
const ACCELERATED_MODS: &[StatMod] = &[m(MoveSpeed, Mul, 1.5)];
const CHILLED_MODS: &[StatMod] = &[m(MoveSpeed, Mul, 0.7)];
/// Any heat effect ends any cold effect and the other way round.
const HEAT_CANCELS: &[EffectKind] = &[EffectKind::Frozen, EffectKind::Chilled];
const COLD_CANCELS: &[EffectKind] = &[EffectKind::Burning, EffectKind::Singed];

pub fn def(k: EffectKind) -> EffectDef {
    match k {
        EffectKind::Blind => EffectDef { mods: BLIND_MODS, ..NONE },
        EffectKind::Sleep => EffectDef { duration: 4.0, mods: SLEEP_MODS, no_move: true, no_act: true, prone: true, wakes_on_use: true, ..NONE },
        EffectKind::Petrified => EffectDef { mods: PETRIFIED_MODS, no_move: true, no_act: true, no_turn: true, ..NONE },
        EffectKind::Slowed => EffectDef { mods: SLOWED_MODS, ..NONE },
        EffectKind::Accelerated => EffectDef { positive: true, mods: ACCELERATED_MODS, ..NONE },
        EffectKind::Burning => EffectDef { dot: Some((Heat, 6.0)), resisted_by: Some(Heat), replaces: &[EffectKind::Singed], cancels: HEAT_CANCELS, ends_in_water: true, ..NONE },
        EffectKind::Frozen => EffectDef { duration: 2.0, dot: Some((Cold, 4.0)), resisted_by: Some(Cold), replaces: &[EffectKind::Chilled], cancels: COLD_CANCELS, no_move: true, no_act: true, no_turn: true, ..NONE },
        EffectKind::Poisoned => EffectDef { duration: 4.0, dot: Some((Poison, 4.0)), resisted_by: Some(Poison), replaces: &[EffectKind::Tainted], ..NONE },
        EffectKind::Chilled => EffectDef { resisted_by: Some(Cold), mods: CHILLED_MODS, cancels: COLD_CANCELS, ..NONE },
        EffectKind::Singed => EffectDef { dot: Some((Heat, 3.0)), resisted_by: Some(Heat), cancels: HEAT_CANCELS, ends_in_water: true, ..NONE },
        EffectKind::Tainted => EffectDef { dot: Some((Poison, 2.0)), resisted_by: Some(Poison), ..NONE },
        EffectKind::Entangled => EffectDef { no_move: true, save: Some(Attr::Str), ..NONE },
        EffectKind::Fear => EffectDef { save: Some(Attr::Wil), flees: true, ..NONE },
        EffectKind::Warded => EffectDef { positive: true, mods: WARDED_MODS, ..NONE },
        EffectKind::Coated => EffectDef { positive: true, ..NONE },
    }
}

/// Damage over time ticks this often (s).
pub const DOT_TICK: f64 = 0.5;
/// A hit whose share of a damage type is at least this applies the type's higher tier.
pub const TYPE_EFFECT_SHARE: f64 = 0.5;
/// ... at least this (below `TYPE_EFFECT_SHARE`) its lower tier (Chilled, Singed, Tainted).
pub const TYPE_EFFECT_LOW: f64 = 0.25;
/// (damage type, least share of a hit, effect it applies): the damage-type effects. The
/// stronger tier of a type comes first. A new one is a row here plus its def's
/// `resisted_by`/`replaces` (`type_effect_rows_match_their_defs` checks they agree).
pub const TYPE_EFFECTS: [(DamageType, f64, EffectKind); 6] = [
    (Heat, TYPE_EFFECT_SHARE, EffectKind::Burning),
    (Heat, TYPE_EFFECT_LOW, EffectKind::Singed),
    (Cold, TYPE_EFFECT_SHARE, EffectKind::Frozen),
    (Cold, TYPE_EFFECT_LOW, EffectKind::Chilled),
    (Poison, TYPE_EFFECT_SHARE, EffectKind::Poisoned),
    (Poison, TYPE_EFFECT_LOW, EffectKind::Tainted),
];

/// The effects a hit with this split applies: at most one per damage type, the highest
/// tier its share meets (in `TYPE_EFFECTS` order).
pub fn type_effects(split: &super::damage::DamageSplit) -> Vec<EffectKind> {
    let mut out: Vec<(DamageType, EffectKind)> = Vec::new();
    for &(t, least, k) in &TYPE_EFFECTS {
        if split.share(t) >= least - 1e-9 && !out.iter().any(|&(o, _)| o == t) {
            out.push((t, k));
        }
    }
    out.into_iter().map(|(_, k)| k).collect()
}

/// How much a creature resists each effect, as a fraction: 0.5 halves the time,
/// 1 or more refuses it, a negative value lengthens it (floored at
/// `MIN_RESISTANCE`). Held next to the damage `Resistances` (race, the entity's
/// own `Adjust`, later items and tree nodes; effects through `Stat::ResistEffect`).
/// A damage-type effect (one whose def has `resisted_by`) has none: its type's damage
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
    /// Saved against with WIL (spells, innate magic) instead of CON.
    pub magical: bool,
    /// The source's key Attribute (spells INT, innate magic CHA, a weapon's
    /// wielder its key Attribute, terrain 10); see `scaled_secs`.
    pub power: i32,
    /// How the effect is drawn (`Plain` for every source today).
    pub look: EffectLook,
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
        assert!(EffectKind::ALL.iter().filter(|&&k| !matches!(k, EffectKind::Accelerated | EffectKind::Warded | EffectKind::Coated)).all(|&k| !def(k).positive));
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
            for k in EffectKind::ALL.into_iter().filter(|&k| def(k).resisted_by.is_some()) {
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
            BossId::Lich => EffectResistances::of(&[(Sleep, 1.0), (Blind, 1.0), (Petrified, 0.5), (Fear, 1.0)]),
            BossId::Dragon => EffectResistances::of(&[(Sleep, 1.0), (Blind, 0.5), (Petrified, 0.5), (Slowed, 0.5), (Accelerated, 0.5), (Fear, 1.0)]),
            BossId::Demon => EffectResistances::of(&[(Sleep, 1.0), (Fear, 1.0)]),
        };
        for b in BossId::ALL {
            assert_eq!(bosses::profile(b).effect_res, want(b), "{b:?}");
        }
    }

    #[test]
    fn damage_type_effects_match_the_spec() {
        let b = def(EffectKind::Burning);
        assert_eq!((b.dot, b.duration, b.ends_in_water), (Some((Heat, 6.0)), 3.0, true));
        assert_eq!(b.cancels, &[EffectKind::Frozen, EffectKind::Chilled]);
        assert!(!b.no_move && !b.positive);
        let f = def(EffectKind::Frozen);
        assert_eq!((f.dot, f.duration, f.ends_in_water), (Some((Cold, 4.0)), 2.0, false));
        assert_eq!(f.cancels, &[EffectKind::Burning, EffectKind::Singed]);
        assert!(f.no_move && f.no_act && f.no_turn && !f.prone);
        let p = def(EffectKind::Poisoned);
        assert_eq!((p.dot, p.duration), (Some((Poison, 4.0)), 4.0));
        assert!(p.cancels.is_empty() && !p.ends_in_water && !p.no_move);
        for k in [EffectKind::Blind, EffectKind::Sleep, EffectKind::Petrified, EffectKind::Slowed, EffectKind::Accelerated] {
            assert!(def(k).dot.is_none() && def(k).cancels.is_empty() && !def(k).ends_in_water, "{k:?}");
        }
        assert_eq!((EffectKind::Burning as u8, EffectKind::Frozen as u8, EffectKind::Poisoned as u8), (5, 6, 7));
        assert_eq!(EffectKind::COUNT, 15);
    }

    #[test]
    fn type_effect_rows_match_their_defs() {
        for (t, _, k) in TYPE_EFFECTS {
            assert_eq!(def(k).resisted_by, Some(t), "{k:?} is resisted by {t:?}");
        }
        for k in EffectKind::ALL.into_iter().filter(|&k| def(k).resisted_by.is_some()) {
            assert_eq!(TYPE_EFFECTS.iter().filter(|&&(_, _, e)| e == k).count(), 1, "{k:?} has a damage type, so exactly one row applies it");
            for r in def(k).replaces {
                assert_eq!(def(*r).resisted_by, def(k).resisted_by, "{k:?} replaces a tier of another type");
            }
        }
        for t in [Heat, Cold, Poison] {
            let rows: Vec<f64> = TYPE_EFFECTS.iter().filter(|r| r.0 == t).map(|r| r.1).collect();
            assert!(rows.windows(2).all(|w| w[0] > w[1]), "{t:?}: the stronger tier comes first");
        }
    }

    #[test]
    fn tiers_pick_one_effect_per_type() {
        use crate::defs::damage::DamageSplit;
        assert_eq!(type_effects(&DamageSplit::split(&[(Cold, 0.4)])), vec![EffectKind::Chilled]);
        assert_eq!(type_effects(&DamageSplit::pure(Cold)), vec![EffectKind::Frozen]);
        assert_eq!(type_effects(&DamageSplit::split(&[(Heat, 0.25)])), vec![EffectKind::Singed]);
        assert_eq!(type_effects(&DamageSplit::split(&[(Heat, 0.2)])), vec![], "the claws' 20 % stay below the floor");
        assert_eq!(type_effects(&DamageSplit::split(&[(Poison, 0.3)])), vec![EffectKind::Tainted]);
        assert_eq!(type_effects(&DamageSplit::split(&[(Heat, 0.7), (Magical, 0.2)])), vec![EffectKind::Burning]);
    }

    #[test]
    fn tier_effects_have_their_numbers() {
        let c = def(EffectKind::Chilled);
        assert_eq!((c.resisted_by, c.mods), (Some(Cold), &[m(MoveSpeed, Mul, 0.7)][..]));
        assert_eq!((def(EffectKind::Singed).dot, def(EffectKind::Singed).duration), (Some((Heat, 3.0)), 3.0));
        assert!(def(EffectKind::Singed).ends_in_water);
        assert_eq!((def(EffectKind::Tainted).dot, def(EffectKind::Tainted).duration), (Some((Poison, 2.0)), 3.0));
        assert_eq!(def(EffectKind::Frozen).replaces, &[EffectKind::Chilled]);
        assert_eq!(def(EffectKind::Burning).replaces, &[EffectKind::Singed]);
        assert_eq!(def(EffectKind::Poisoned).replaces, &[EffectKind::Tainted]);
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

    #[test]
    fn new_effects_have_their_rules() {
        use crate::defs::attributes::Attr;
        let e = def(EffectKind::Entangled);
        assert!(e.no_move && !e.no_act && !e.no_turn && !e.positive && !e.flees);
        assert_eq!(e.save, Some(Attr::Str));
        let f = def(EffectKind::Fear);
        assert!(f.flees && !f.positive && !f.no_move);
        assert_eq!((f.save, f.duration), (Some(Attr::Wil), 3.0));
        let w = def(EffectKind::Warded);
        assert!(w.positive && !w.flees);
        assert_eq!(w.mods, &[m(ResistEffect(EffectKind::Blind), Add, 1.0), m(ResistEffect(EffectKind::Sleep), Add, 1.0), m(ResistEffect(EffectKind::Petrified), Add, 1.0)]);
        let c = def(EffectKind::Coated);
        assert!(c.positive && c.mods.is_empty());
        assert_eq!((EffectKind::Entangled as u8, EffectKind::Fear as u8, EffectKind::Warded as u8, EffectKind::Coated as u8), (11, 12, 13, 14));
        assert_eq!(EffectKind::COUNT, 15);
        for k in EffectKind::ALL.into_iter().filter(|k| !matches!(k, EffectKind::Entangled | EffectKind::Fear)) {
            assert_eq!(def(k).save, None, "{k:?} keeps the rule of section 5");
        }
        assert_eq!(EffectKind::ALL.iter().filter(|&&k| def(k).flees).count(), 1);
        assert_eq!((EffectLook::Plain as u8, EffectLook::Vines as u8), (0, 1));
        assert_eq!(serde_json::to_string(&EffectLook::Vines).unwrap(), "1");
    }
}
