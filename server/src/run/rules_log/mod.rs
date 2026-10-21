//! The rules log: a toggleable text log that explains the game's rules. The game reaches it
//! only through one-line hooks (see the boundary test in `tests.rs`); everything else lives here.

use super::Run;
use crate::defs::kinds::EntityKind;
use crate::protocol::EntSnap;

pub mod record;
pub mod send;
pub mod tags;
pub mod text;
#[cfg(test)]
mod tests;

use record::LogRec;
#[derive(Default)]
pub struct RulesLog {
    tags: tags::Tags,
    /// For tests: records as if someone listened.
    pub forced: bool,
    /// Per player id: who listens, and whether they want the detail lines.
    prefs: Vec<(u32, LogPrefs)>,
    /// Records waiting for the next snapshot.
    records: Vec<LogRec>,
    /// Records still being filled by a hit in progress.
    #[allow(dead_code)] // Task 4 fills it.
    open: Vec<LogRec>,
}

/// An entity was spawned: it takes the next number of its name (whether or not the log is on).
pub fn spawned(run: &mut Run, id: u32, kind: EntityKind) {
    run.log.tags.spawned(id, kind);
}

/// A hiding mimic dropped its disguise: it takes its Mimic number, once.
pub fn revealed(run: &mut Run, id: u32) {
    run.log.tags.revealed(id);
}

#[allow(dead_code)] // Task 4 calls it.
/// How the log names an entity: "Ayla", "Ayla's wolf", "Goblin Archer 2".
pub(crate) fn tag_of(run: &Run, id: u32) -> String {
    tags::tag_of(run, id)
}

/// (entity id, the `EntityKind` id its name comes from, number) for each sent entity with a tag.
pub(crate) fn snapshot_tags(run: &Run, ents: &[EntSnap]) -> Vec<(u32, u8, u16)> {
    tags::snapshot_tags(run, ents)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LogPrefs {
    pub on: bool,
    pub details: bool,
}

/// Someone listens (or a test forces it): the hooks record. Every hook starts with this.
pub fn on(run: &Run) -> bool {
    run.log.forced || run.log.prefs.iter().any(|(_, p)| p.on)
}

/// The prefs of player `id` if their log is on.
pub(crate) fn on_for(run: &Run, id: u32) -> Option<LogPrefs> {
    run.log.prefs.iter().find(|(i, p)| *i == id && p.on).map(|(_, p)| *p)
}

/// The player at index `pi` turned the log on or off (and asked for details or not).
pub fn set_prefs(run: &mut Run, pi: usize, on: bool, details: bool) {
    let Some(id) = run.players.get(pi).map(|p| p.id) else { return };
    let prefs = LogPrefs { on, details };
    match run.log.prefs.iter_mut().find(|(i, _)| *i == id) {
        Some(entry) => entry.1 = prefs,
        None => run.log.prefs.push((id, prefs)),
    }
    if !self::on(run) {
        run.log.records.clear();
        run.log.open.clear();
    }
}

/// A player left the run: their prefs go.
pub fn forget(run: &mut Run, player_id: u32) {
    run.log.prefs.retain(|(i, _)| *i != player_id);
    if !self::on(run) {
        run.log.records.clear();
        run.log.open.clear();
    }
}

/// The records of this step, for the snapshots (empty while off).
pub fn take(run: &mut Run) -> Vec<LogRec> {
    std::mem::take(&mut run.log.records)
}

pub use send::{for_viewer, LogW};
