//! What a hero must have to use an item. Checked against the Attributes
//! without items (class + race + shop + tree).

use super::attributes::{Attr, Attributes};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Requirement {
    Attr(Attr, i32),
}

impl Requirement {
    pub fn met(&self, attrs: &Attributes) -> bool {
        match *self {
            Requirement::Attr(a, n) => attrs.get(a) >= n,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requirements_compare_the_attribute() {
        let r = Requirement::Attr(Attr::Int, 14);
        assert!(r.met(&Attributes::new(10, 10, 10, 14, 10, 10)));
        assert!(!r.met(&Attributes::new(10, 10, 10, 13, 10, 10)));
    }
}
