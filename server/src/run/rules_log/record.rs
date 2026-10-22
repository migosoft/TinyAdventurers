//! What the game hands over, kept until the snapshot: log records with who they name.

use super::{on, Run};
use crate::math::Vec2;
use crate::run::effects::Creature;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)] // Tasks 5-6 push the other kinds.
pub enum LineKind {
    Hit,
    Heal,
    Effect,
    Death,
    Skip,
    Note,
}

/// A creature or object a record names, with what the visibility rule needs.
#[derive(Clone, Debug)]
pub struct Seen {
    pub id: u32,
    pub pos: Vec2,
    pub radius: f64,
    /// A hero or an ally: always in the party's snapshot, so always seen by it.
    pub party: bool,
    pub object: bool,
}

/// The short line for the one viewer who sees only part of a record.
#[derive(Clone, Debug)]
pub struct Unseen {
    /// The hero id this line is for: the target hero, or the wolf's owner.
    pub viewer: u32,
    pub head: String,
    pub details: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct LogRec {
    pub t: f64,
    pub kind: LineKind,
    pub head: String,
    pub details: Vec<String>,
    pub who: Vec<Seen>,
    pub unseen: Option<Unseen>,
    #[allow(dead_code)] // Only tests read it.
    /// HP lost, as the record states it (kept for tests, not sent).
    pub dealt: Option<f64>,
    #[allow(dead_code)] // Task 5's tests read it.
    /// Seconds applied, as the record states it (kept for tests, not sent).
    pub secs: Option<f64>,
}

/// Keeps a record for the next snapshot (nothing while the log is off).
#[allow(dead_code)] // Tasks 5-6 call it.
pub(crate) fn push(run: &mut Run, rec: LogRec) {
    if on(run) {
        run.log.records.push(rec);
    }
}

pub(crate) fn seen_creature(run: &Run, c: Creature) -> Seen {
    match c {
        Creature::Player(i) => {
            let p = &run.players[i];
            Seen { id: p.id, pos: p.pos(), radius: 0.0, party: true, object: false }
        }
        Creature::Monster(i) => {
            let m = &run.monsters[i];
            Seen { id: m.id, pos: m.pos, radius: m.radius, party: m.is_ally(), object: false }
        }
    }
}

pub(crate) fn seen_object(run: &Run, oi: usize) -> Seen {
    let o = &run.objects[oi];
    Seen { id: o.id, pos: o.pos, radius: 0.0, party: false, object: true }
}
