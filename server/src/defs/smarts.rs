//! Smarts: what INT lets a creature do, and the dodge knobs. Knob 1 is the INT
//! each tier starts at (`tier_int`); knob 2 is the tier each behaviour needs
//! (`needs`). Below `tier_int[0]` a creature is very dumb. No creature or boss
//! type is named here: only INT decides.

use super::attributes::{Attr, Attributes, Scaled};

super::enum_list::listed_enum! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Smart: u8 {
        Dodge = 0,
        AdvancedDodge = 1,
        KeepDistance = 2,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SmartsDef {
    /// Knob 1: the INT each tier starts at (tier 0 = first smart tier). Below `tier_int[0]`: very dumb.
    pub tier_int: [i32; 4],
    /// Knob 2: the tier each behaviour needs, indexed by `Smart as usize`.
    pub needs: [u8; Smart::COUNT],
    /// Dodge: how far away a shot is noticed (px), from DEX.
    pub notice: Scaled,
    /// Dodge: seconds between noticing and stepping (not a cooldown).
    pub reaction: f64,
    /// Dodge: px past the shot's edge the step goes.
    pub margin: f64,
    /// Dodge: share of current HP a shot's resolved damage must reach.
    pub threat_share: f64,
}

pub const SMARTS: SmartsDef = SmartsDef {
    tier_int: [6, 11, 16, 21],
    needs: [0, 1, 1], // Dodge tier 0 (INT 6), AdvancedDodge tier 1 (INT 11), KeepDistance tier 1 (INT 11)
    notice: Scaled { value: 60.0, attr: Attr::Dex, pct: 0.03, at: 10 },
    reaction: 0.0,
    margin: 2.0,
    threat_share: 0.05,
};

impl SmartsDef {
    /// Whether INT `int` reaches the tier `s` needs.
    pub fn can(&self, int: i32, s: Smart) -> bool {
        int >= self.tier_int[self.needs[s as usize] as usize]
    }

    /// Notice distance (px) for these Attributes.
    pub fn notice_px(&self, attrs: &Attributes) -> f64 {
        self.notice.get(attrs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use Smart::*;

    #[test]
    fn tiers_start_at_6_11_16_21() {
        assert!(!SMARTS.can(5, Dodge));
        assert!(SMARTS.can(6, Dodge));
        assert!(!SMARTS.can(10, KeepDistance));
        assert!(SMARTS.can(11, KeepDistance));
        assert!(SMARTS.can(11, AdvancedDodge));
        assert!(!SMARTS.can(10, AdvancedDodge));
    }

    #[test]
    fn moving_a_threshold_moves_the_behaviour() {
        let mut s = SMARTS;
        s.tier_int[0] = 8;
        assert!(!s.can(7, Dodge));
        assert!(s.can(8, Dodge));
    }

    #[test]
    fn moving_a_behaviour_to_another_tier() {
        let mut s = SMARTS;
        s.needs[Dodge as usize] = 1;
        assert!(!s.can(10, Dodge));
        assert!(s.can(11, Dodge));
    }

    #[test]
    fn notice_grows_with_dex() {
        let a = |dex| Attributes::new(10, dex, 10, 10, 10, 10);
        assert_eq!(SMARTS.notice_px(&a(10)), 60.0);
        assert!((SMARTS.notice_px(&a(15)) - 60.0 * 1.15 / 1.0).abs() < 1e-9);
    }
}
