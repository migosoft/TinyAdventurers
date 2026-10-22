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
}

/// The Attribute value at which every factor is 1.
pub const BASELINE: i32 = 10;

/// Per-point effects.
pub const STR_DMG: f64 = 0.05;
pub const STR_RANGE: f64 = 0.02;
pub const DEX_DMG: f64 = 0.05;
pub const DEX_ARC: f64 = 0.03;
pub const DEX_SPEED: f64 = 0.02;
pub const CON_HP: f64 = 5.0;
pub const CON_MOVE: f64 = 0.01;
pub const INT_DMG: f64 = 0.05;
pub const CHA_DMG: f64 = 0.05;

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
#[allow(dead_code)] // plan 4 (the Attribute shop) uses the prices
pub const ATTR_WEIGHT: [f64; 6] = [1.0, 1.25, 1.0, 1.0, 0.8, 1.0];

/// Gold to raise `a` from `current` by one point.
#[allow(dead_code)] // plan 4 (the Attribute shop)
pub fn attr_price(a: Attr, current: i32) -> u32 {
    ((100 + 25 * (current - BASELINE).max(0)) as f64 * ATTR_WEIGHT[a as usize]).round() as u32
}

#[cfg(test)]
mod tests {
    use super::Attr::*;
    use super::*;

    #[test]
    fn push_needs_str_above_weight() {
        assert_eq!(push_dist(20.0, 9, 9.0), 0.0);
        assert_eq!(push_dist(20.0, 16, 13.0), 15.0);
        assert_eq!(push_dist(20.0, 19, 13.0), 20.0);
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

        let t = Scaled { value: 3.0, attr: Dex, pct: 0.02, at: 13 };
        assert_eq!(t.per(&wizard), 3.0 / (factor(14, 0.02) / factor(13, 0.02)));
        let mut d13 = wizard;
        d13.add(Dex, -1);
        assert_eq!(t.per(&d13), 3.0);
        let mut d15 = wizard;
        d15.add(Dex, 1);
        assert!((t.per(&d15) - 3.0 / (1.10 / 1.06)).abs() < 1e-12);
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
