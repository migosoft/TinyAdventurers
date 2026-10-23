//! What a hero must have to use an item or an ability. An item's are checked
//! against the Attributes without items (class + race + shop).

use super::attributes::{Attr, Attributes};
use super::weapons::WeaponKind;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Requirement {
    Attr(Attr, i32),
    /// One of these weapon kinds in the slot the ability uses (abilities only).
    WeaponKind(&'static [WeaponKind]),
}

impl Requirement {
    /// `weapon`: the kind of the weapon the ability uses; items pass `None`.
    pub fn met(&self, attrs: &Attributes, weapon: Option<WeaponKind>) -> bool {
        match *self {
            Requirement::Attr(a, n) => attrs.get(a) >= n,
            Requirement::WeaponKind(kinds) => weapon.is_some_and(|w| kinds.contains(&w)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requirements_compare_the_attribute() {
        let r = Requirement::Attr(Attr::Int, 14);
        assert!(r.met(&Attributes::new(10, 10, 10, 14, 10, 10), None));
        assert!(!r.met(&Attributes::new(10, 10, 10, 13, 10, 10), None));
    }

    #[test]
    fn a_weapon_kind_requirement_reads_the_weapon() {
        use crate::defs::weapons::WeaponKind::{Axe, Club, Hammer};
        let r = Requirement::WeaponKind(&[Hammer, Club]);
        let a = Attributes::default();
        assert!(r.met(&a, Some(Club)));
        assert!(!r.met(&a, Some(Axe)));
        assert!(!r.met(&a, None));
    }
}
