//! Damage types, typed damage and resistances. `resolve` is the only damage
//! formula: every hit on a hero, monster or object goes through it.

use super::kinds::EntityKind;

/// Open set: a new type is a new variant, and `COUNT` and `ALL` grow with it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum DamageType {
    Physical = 0,
    Cold = 1,
    Heat = 2,
    Magical = 3,
    Poison = 4,
}

impl DamageType {
    pub const COUNT: usize = 5;
    pub const ALL: [DamageType; DamageType::COUNT] = [DamageType::Physical, DamageType::Cold, DamageType::Heat, DamageType::Magical, DamageType::Poison];
    pub fn name(self) -> &'static str {
        match self {
            DamageType::Physical => "Physical",
            DamageType::Cold => "Cold",
            DamageType::Heat => "Heat",
            DamageType::Magical => "Magical",
            DamageType::Poison => "Poison",
        }
    }
}

/// How one hit splits by type. The shares always sum to 1.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DamageSplit([f64; DamageType::COUNT]);

impl DamageSplit {
    pub fn physical() -> Self {
        Self::pure(DamageType::Physical)
    }
    pub fn pure(t: DamageType) -> Self {
        let mut s = [0.0; DamageType::COUNT];
        s[t as usize] = 1.0;
        DamageSplit(s)
    }
    /// The listed shares; whatever is left up to 100 % is physical.
    pub fn split(parts: &[(DamageType, f64)]) -> Self {
        let mut s = [0.0; DamageType::COUNT];
        for &(t, share) in parts {
            s[t as usize] += share;
        }
        let listed: f64 = s.iter().sum();
        debug_assert!(listed <= 1.0 + 1e-9, "damage split over 100 %: {parts:?}");
        s[DamageType::Physical as usize] += (1.0 - listed).max(0.0);
        DamageSplit(s)
    }
    pub fn share(&self, t: DamageType) -> f64 {
        self.0[t as usize]
    }
    /// The type with the largest share (ties: the first in `ALL`); the damage number's colour.
    pub fn main_type(&self) -> DamageType {
        let mut best = DamageType::Physical;
        for t in DamageType::ALL {
            if self.share(t) > self.share(best) {
                best = t;
            }
        }
        best
    }
}

/// Resistance per type as a fraction (0.5 = 50 %). A missing type is 0. A
/// negative value is a weakness, floored at `MIN_RESISTANCE` in `resolve`;
/// above 1 the hit heals.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Resistances([f64; DamageType::COUNT]);

pub const MIN_RESISTANCE: f64 = -1.0;

impl Resistances {
    pub const NONE: Resistances = Resistances([0.0; DamageType::COUNT]);
    pub fn of(parts: &[(DamageType, f64)]) -> Self {
        let mut r = [0.0; DamageType::COUNT];
        for &(t, v) in parts {
            r[t as usize] += v;
        }
        Resistances(r)
    }
    pub fn get(&self, t: DamageType) -> f64 {
        self.0[t as usize]
    }
    pub fn set(&mut self, t: DamageType, v: f64) {
        self.0[t as usize] = v;
    }
    pub fn plus(self, o: Resistances) -> Self {
        let mut r = self.0;
        for (a, b) in r.iter_mut().zip(o.0) {
            *a += b;
        }
        Resistances(r)
    }
}

/// One hit: an amount and how it splits by type.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Damage {
    pub amount: f64,
    pub split: DamageSplit,
    /// An effect the hit applies after its damage, if the target lives (sleep poison arrow).
    pub on_hit: Option<super::effects::OnHit>,
    /// Dealt by an effect over time: applies no effects (no loops).
    pub from_effect: bool,
    /// The source's governing Attribute (spell INT, innate CHA, weapon STR or DEX):
    /// the power of the element effects the hit applies, at least `ELEMENT_POWER`.
    /// 0 for sources without one (terrain, barrels, effect ticks).
    pub power: i32,
}

impl Damage {
    pub fn new(amount: f64, split: DamageSplit) -> Self {
        Damage { amount, split, on_hit: None, from_effect: false, power: 0 }
    }
    pub fn with_power(mut self, power: i32) -> Self {
        self.power = power;
        self
    }
    pub fn with_effect(mut self, h: super::effects::OnHit) -> Self {
        self.on_hit = Some(h);
        self
    }
    pub fn effect_tick(amount: f64, t: DamageType) -> Self {
        Damage { from_effect: true, ..Damage::new(amount, DamageSplit::pure(t)) }
    }
    pub fn physical(amount: f64) -> Self {
        Damage::new(amount, DamageSplit::physical())
    }
}

/// Σ part × (1 − resistance) over the types. Negative = the hit heals.
pub fn resolve(d: &Damage, r: &Resistances) -> f64 {
    DamageType::ALL.iter().map(|&t| d.amount * d.split.share(t) * (1.0 - r.get(t).max(MIN_RESISTANCE))).sum()
}

/// The split of a shot, spell effect or hazard by its kind. Shots default to
/// physical, magic to magical.
pub fn kind_split(kind: EntityKind) -> DamageSplit {
    use DamageType::*;
    use EntityKind as K;
    match kind {
        K::Missile | K::ShadowBolt | K::GloomBolt | K::BlindOrb | K::SleepOrb => DamageSplit::pure(Magical),
        K::Fireball => DamageSplit::split(&[(Heat, 0.7), (Magical, 0.2)]),
        K::FireBolt | K::FireOrb => DamageSplit::split(&[(Heat, 0.7), (Magical, 0.3)]),
        K::FrostBolt => DamageSplit::pure(Cold),
        K::DragonFireball | K::FireBreath | K::FirePatch => DamageSplit::pure(Heat),
        _ => DamageSplit::physical(),
    }
}

#[cfg(test)]
mod tests {
    use super::DamageType::*;
    use super::*;

    #[test]
    fn a_partial_split_is_filled_up_with_physical() {
        let s = DamageSplit::split(&[(Heat, 0.3)]);
        assert!((s.share(Heat) - 0.3).abs() < 1e-12);
        assert!((s.share(Physical) - 0.7).abs() < 1e-12);
        let f = DamageSplit::split(&[(Heat, 0.7), (Magical, 0.2)]);
        assert!((f.share(Physical) - 0.1).abs() < 1e-12, "the fireball's rest is physical");
        assert_eq!(DamageSplit::physical().share(Physical), 1.0);
        assert_eq!(DamageSplit::pure(Cold).share(Cold), 1.0);
    }

    #[test]
    fn resolve_reduces_each_part_by_its_own_resistance() {
        let none = Resistances::NONE;
        assert_eq!(resolve(&Damage::physical(12.0), &none), 12.0, "no entry: full damage");
        let d = Damage::new(10.0, DamageSplit::split(&[(Heat, 0.5)]));
        let res = Resistances::of(&[(Heat, 1.0)]);
        assert!((resolve(&d, &res) - 5.0).abs() < 1e-9, "immune to heat: only the physical half");
        let half = Resistances::of(&[(Physical, 0.5)]);
        assert!((resolve(&Damage::physical(10.0), &half) - 5.0).abs() < 1e-9);
    }

    #[test]
    fn full_resistance_is_immunity_and_more_heals() {
        let d = Damage::new(10.0, DamageSplit::pure(Poison));
        assert_eq!(resolve(&d, &Resistances::of(&[(Poison, 1.0)])), 0.0);
        assert!((resolve(&d, &Resistances::of(&[(Poison, 1.5)])) + 5.0).abs() < 1e-9, "150 %: a 10-point part heals 5");
    }

    #[test]
    fn a_weakness_adds_damage_but_at_most_doubles_it() {
        let d = Damage::new(10.0, DamageSplit::pure(Cold));
        assert!((resolve(&d, &Resistances::of(&[(Cold, -0.5)])) - 15.0).abs() < 1e-9);
        assert!((resolve(&d, &Resistances::of(&[(Cold, -3.0)])) - 20.0).abs() < 1e-9, "floored at -100 %");
    }

    #[test]
    fn resistances_add_up_and_main_type_is_the_largest_share() {
        let r = Resistances::of(&[(Physical, 0.1)]).plus(Resistances::of(&[(Physical, 0.4), (Magical, 0.4)]));
        assert!((r.get(Physical) - 0.5).abs() < 1e-12);
        assert_eq!(DamageSplit::split(&[(Heat, 0.7), (Magical, 0.3)]).main_type(), Heat);
        assert_eq!(DamageSplit::split(&[(Heat, 0.2)]).main_type(), Physical);
    }

    #[test]
    fn attacks_by_kind_have_their_types() {
        use crate::defs::kinds::EntityKind as K;
        assert_eq!(kind_split(K::Arrow), DamageSplit::physical());
        assert_eq!(kind_split(K::Bolt), DamageSplit::physical());
        assert_eq!(kind_split(K::Missile), DamageSplit::pure(Magical));
        assert_eq!(kind_split(K::GloomBolt), DamageSplit::pure(Magical));
        assert!((kind_split(K::Fireball).share(Heat) - 0.7).abs() < 1e-12);
        assert!((kind_split(K::FireBolt).share(Magical) - 0.3).abs() < 1e-12);
        assert_eq!(kind_split(K::FirePatch), DamageSplit::pure(Heat));
        assert_eq!(kind_split(K::DragonFireball), DamageSplit::pure(Heat));
    }
}
