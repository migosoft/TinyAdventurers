//! The rules log: a toggleable text log that explains the game's rules. The game reaches it
//! only through one-line hooks (see the boundary test in `tests.rs`); everything else lives here.

use super::Run;
use crate::defs::kinds::EntityKind;
use crate::protocol::EntSnap;

pub mod tags;
#[cfg(test)]
mod tests;

#[derive(Default)]
pub struct RulesLog {
    tags: tags::Tags,
    /// For tests: records as if someone listened.
    #[allow(dead_code)]
    pub forced: bool,
}

/// An entity was spawned: it takes the next number of its name (whether or not the log is on).
pub fn spawned(run: &mut Run, id: u32, kind: EntityKind) {
    run.log.tags.spawned(id, kind);
}

/// A hiding mimic dropped its disguise: it takes its Mimic number, once.
pub fn revealed(run: &mut Run, id: u32) {
    run.log.tags.revealed(id);
}

pub use tags::tag_name;

/// How the log names an entity: "Ayla", "Ayla's wolf", "Goblin Archer 2".
pub(crate) fn tag_of(run: &Run, id: u32) -> String {
    tags::tag_of(run, id)
}

/// (entity id, the `EntityKind` id its name comes from, number) for each sent entity with a tag.
pub(crate) fn snapshot_tags(run: &Run, ents: &[EntSnap]) -> Vec<(u32, u8, u16)> {
    tags::snapshot_tags(run, ents)
}

pub fn export_tag_names() -> String {
    tags::export_tag_names()
}
