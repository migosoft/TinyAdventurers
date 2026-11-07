//! The six Attributes (STR, DEX, CON, INT, WIL, CHA) and the one scaling rule
//! every number shares: `factor(v, pct) = max(0.1, 1 + pct × (v − 10))`.
//! A scaled number is stored as its value at a reference Attribute (`Scaled`),
//! so at that reference it resolves bit-exactly to the stored value.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Attr {
    Str,
    Dex,
    Con,
    Int,
    Wil,
    Cha,
}

impl Attr {
    pub const COUNT: usize = 6;
    pub const ALL: [Attr; Attr::COUNT] = [Attr::Str, Attr::Dex, Attr::Con, Attr::Int, Attr::Wil, Attr::Cha];
    pub fn short(self) -> &'static str {
        match self {
            Attr::Str => "STR",
            Attr::Dex => "DEX",
            Attr::Con => "CON",
            Attr::Int => "INT",
            Attr::Wil => "WIL",
            Attr::Cha => "CHA",
        }
    }
}

/// One value per Attribute, indexed by `Attr`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Attributes([i32; 6]);

impl Attributes {
    pub const fn new(strength: i32, dex: i32, con: i32, int: i32, wil: i32, cha: i32) -> Self {
        Attributes([strength, dex, con, int, wil, cha])
    }
    pub fn get(&self, a: Attr) -> i32 {
        self.0[a as usize]
    }
    pub fn add(&mut self, a: Attr, n: i32) {
        self.0[a as usize] += n;
    }
    pub fn plus(self, o: Attributes) -> Attributes {
        let mut r = self;
        for a in Attr::ALL {
            r.add(a, o.get(a));
        }
        r
    }
    /// `self` with a signed delta applied; a lowered Attribute stops at 1 (or stays where it
    /// already was below that).
    pub fn with_delta(self, d: Attributes) -> Attributes {
        let mut r = self;
        for a in Attr::ALL {
            let (base, dv) = (self.get(a), d.get(a));
            r.0[a as usize] = if dv >= 0 { base + dv } else { (base + dv).max(base.min(1)) };
        }
        r
    }
}

/// The Attribute value at which every factor is 1.
pub const BASELINE: i32 = 10;

/// Layer 1 of every creature's Attributes: `BASELINE` for all six.
pub const BASELINE_ATTRS: Attributes = Attributes::new(BASELINE, BASELINE, BASELINE, BASELINE, BASELINE, BASELINE);

/// Every source of a creature's Attributes, kept apart: `base` (layer 1), `race` (2), `kind` (its class or
/// stat-block modifier, 3), the Attribute Buy, the usable items' points and the run-time `effects`.
/// No `Default`: the base is not zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AttrSources {
    pub base: Attributes,
    pub race: Attributes,
    pub kind: Attributes,
    pub buy: Attributes,
    pub items: Attributes,
    pub effects: Attributes,
}

impl AttrSources {
    /// Everything but the items and the effects: the Attribute price, the debug lift and item requirements start here.
    pub fn before_items(&self) -> Attributes {
        self.base.plus(self.race).plus(self.kind).plus(self.buy)
    }
    /// The Attributes in play: every source, then the effects (the one place a lowered Attribute is floored at 1).
    pub fn total(&self) -> Attributes {
        self.before_items().plus(self.items).with_delta(self.effects)
    }
}

/// Per-point effects.
pub const STR_DMG: f64 = 0.05;
pub const STR_RANGE: f64 = 0.02;
pub const DEX_DMG: f64 = 0.05;
pub const DEX_ARC: f64 = 0.03;
pub const CON_HP: f64 = 5.0;
pub const CON_MOVE: f64 = 0.01;
pub const INT_DMG: f64 = 0.05;
pub const CHA_DMG: f64 = 0.05;
/// Cooldowns: every Attribute's per-point steepness; the reference is `BASELINE`.
pub const CD_PCT: f64 = 0.10;

/// Linear around `BASELINE`, never below a tenth.
pub fn factor(v: i32, pct: f64) -> f64 {
    (1.0 + pct * (v - BASELINE) as f64).max(0.1)
}

/// Maximum HP: `CON_HP` per CON point from the baseline.
pub fn hp(base: f64, con: i32) -> f64 {
    base + CON_HP * (con - BASELINE) as f64
}

/// How far a push of `base` px moves a target of `weight`: nothing unless the
/// pusher's STR is above the weight, the full distance from 4 points above.
pub fn push_dist(base: f64, str: i32, weight: f64) -> f64 {
    let over = str as f64 - weight;
    if over <= 0.0 {
        0.0
    } else {
        base * (over / 4.0).min(1.0)
    }
}

/// A number stored as its value at the reference Attribute value `at`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Scaled {
    pub value: f64,
    pub attr: Attr,
    pub pct: f64,
    pub at: i32,
}

impl Scaled {
    pub(crate) fn ratio(&self, a: &Attributes) -> f64 {
        // Ratio first: x / x is exactly 1.0, so the reference value is bit-exact.
        factor(a.get(self.attr), self.pct) / factor(self.at, self.pct)
    }
    /// The value for `a`: damage, range, speed.
    pub fn get(&self, a: &Attributes) -> f64 {
        self.value * self.ratio(a)
    }
    /// For times (cooldowns): a higher Attribute shortens the wait.
    pub fn per(&self, a: &Attributes) -> f64 {
        self.value / self.ratio(a)
    }
}

/// Price weight per Attribute, indexed by `Attr`.
pub const ATTR_WEIGHT: [f64; 6] = [1.0, 1.25, 1.0, 1.0, 0.8, 1.0];

/// Gold to raise `a` from `current` by one point.
pub fn attr_price(a: Attr, current: i32) -> u32 {
    ((100 + 25 * (current - BASELINE).max(0)) as f64 * ATTR_WEIGHT[a as usize]).round() as u32
}

#[cfg(test)]
mod tests {
    use super::Attr::*;
    use super::*;

    #[test]
    fn with_delta_floors_a_lowered_attribute_at_one() {
        let d = |s| Attributes::new(s, 0, 0, 0, 0, 0);
        assert_eq!(Attributes::new(14, 1, 0, 10, 10, 10).with_delta(Attributes::new(-3, -2, -1, 2, 0, 0)), Attributes::new(11, 1, 0, 12, 10, 10));
        assert_eq!(d(3).with_delta(d(-5)), d(1));
        assert_eq!(d(7).with_delta(Attributes::default()), d(7));
    }

    #[test]
    fn push_needs_str_above_weight() {
        assert_eq!(push_dist(20.0, 9, 9.0), 0.0);
        assert_eq!(push_dist(20.0, 16, 13.0), 15.0);
        assert_eq!(push_dist(20.0, 19, 13.0), 20.0);
    }

    #[test]
    fn total_adds_every_source_and_floors_once() {
        let src = AttrSources {
            base: BASELINE_ATTRS,
            race: Attributes::new(0, 2, 0, 0, 0, 0),
            kind: Attributes::new(0, 0, 0, -9, 0, 0),
            buy: Attributes::new(1, 0, 0, 0, 0, 0),
            items: Attributes::new(0, 0, 1, 0, 0, 0),
            effects: Attributes::new(-5, 0, 0, 0, 0, 0),
        };
        // STR is 11 before the effects; DEX 12, CON 11, INT 1 are untouched by them.
        assert_eq!(src.total(), Attributes::new(6, 12, 11, 1, 10, 10));
        let drained = AttrSources { effects: Attributes::new(-20, 0, 0, 0, 0, 0), ..src };
        assert_eq!(drained.total().get(Str), 1);
        // The floor applies once, to the sum: INT 1 stays 1 under a further drain.
        let int_drained = AttrSources { effects: Attributes::new(0, 0, 0, -5, 0, 0), ..src };
        assert_eq!(int_drained.total().get(Int), 1);
        // An Attribute already at or below 1 stays where it is.
        let zero = Attributes::default();
        let low = AttrSources { base: Attributes::new(0, 10, 10, 10, 10, 10), race: zero, kind: zero, buy: zero, items: zero, effects: Attributes::new(-3, 0, 0, 0, 0, 0) };
        assert_eq!(low.total().get(Str), 0);
    }

    #[test]
    fn before_items_leaves_out_items_and_effects() {
        let src = AttrSources {
            base: BASELINE_ATTRS,
            race: Attributes::new(0, 2, 0, 0, 0, 0),
            kind: Attributes::new(5, 0, 0, 0, 0, 0),
            buy: Attributes::new(0, 0, 1, 0, 0, 0),
            items: Attributes::new(3, 3, 3, 3, 3, 3),
            effects: Attributes::new(-4, -4, -4, -4, -4, -4),
        };
        assert_eq!(src.before_items(), Attributes::new(15, 12, 11, 10, 10, 10));
        assert_eq!(src.total(), Attributes::new(14, 11, 10, 9, 9, 9));
    }

    #[test]
    fn factor_is_linear_around_ten() {
        assert_eq!(factor(10, 0.05), 1.0);
        assert_eq!(factor(15, 0.05), 1.25);
        assert!((factor(8, 0.03) - 0.94).abs() < 1e-12);
    }

    #[test]
    fn factor_floors_at_a_tenth() {
        assert_eq!(factor(-20, 0.05), 0.1);
        assert_eq!(factor(0, 0.1), 0.1);
    }

    #[test]
    fn hp_adds_five_per_con_point() {
        assert_eq!(hp(60.0, 12), 70.0);
        assert_eq!(hp(120.0, 14), 140.0);
        assert_eq!(hp(80.0, 8), 70.0);
    }

    #[test]
    fn scaled_is_exact_at_its_reference() {
        let wizard = Attributes::new(8, 14, 12, 15, 13, 10);
        let s = Scaled { value: 12.0, attr: Int, pct: 0.05, at: 15 };
        assert_eq!(s.get(&wizard), 12.0);
        let mut smarter = wizard;
        smarter.add(Int, 2);
        assert!((s.get(&smarter) - 12.0 * 1.35 / 1.25).abs() < 1e-12);

        let t = Scaled { value: 3.0, attr: Dex, pct: CD_PCT, at: 13 };
        assert_eq!(t.per(&wizard), 3.0 / (factor(14, CD_PCT) / factor(13, CD_PCT)));
        let mut d13 = wizard;
        d13.add(Dex, -1);
        assert_eq!(t.per(&d13), 3.0);
        let mut d15 = wizard;
        d15.add(Dex, 1);
        assert!((t.per(&d15) - 3.0 / (1.5 / 1.3)).abs() < 1e-12);
    }

    #[test]
    fn attr_price_uses_the_weights() {
        assert_eq!(attr_price(Int, 15), 225);
        assert_eq!(attr_price(Dex, 14), 250);
        assert_eq!(attr_price(Wil, 13), 140);
        assert_eq!(attr_price(Str, 8), 100);
    }

    #[test]
    fn attributes_add_and_plus() {
        let a = Attributes::new(1, 2, 3, 4, 5, 6).plus(Attributes::new(1, 1, 1, 1, 1, 1));
        assert_eq!(a.get(Cha), 7);
        assert_eq!(a.get(Str), 2);
    }
}
