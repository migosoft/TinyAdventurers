//! How much leaf the woodland's trees carry, how many stand dead, and the colours of the leaves.
//! One `Foliage` per level kind; the plants copy the values they need when they are placed.

super::enum_list::listed_enum! {
    /// The colours a level's leaves take. The client has one ramp per palette.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum LeafPalette: u8 {
        Summer = 0,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Foliage {
    /// Of 100 roadside trees, how many stand dead (no leaves, bare limbs).
    pub dead_pct: u8,
    /// A living tree's leaf amount in percent (0 is bare but alive).
    pub leaf_pct: u8,
    pub palette: LeafPalette,
}

/// The woodland's foliage.
pub const WOODLAND_FOLIAGE: Foliage = Foliage { dead_pct: 5, leaf_pct: 100, palette: LeafPalette::Summer }; // first guess, balancing
