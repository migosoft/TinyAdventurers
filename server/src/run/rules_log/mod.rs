//! The rules log: a toggleable text log that explains the game's rules. The game reaches it
//! only through one-line hooks (see the boundary test in `tests.rs`); everything else lives here.

use super::Run;
use crate::defs::damage::{Damage, DamageType, Resistances};
use crate::defs::kinds::EntityKind;
use crate::protocol::EntSnap;
use crate::run::effects::Creature;

pub mod record;
pub mod send;
pub mod tags;
pub mod text;
#[cfg(test)]
mod tests;

use record::{LineKind, LogRec, Unseen};
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
    /// With the `records.len()` they were opened at: a hit is filed where it began, so a nested hit
    /// follows the one that set it off.
    open: Vec<(usize, LogRec)>,
}

/// An entity was spawned: it takes the next number of its name (whether or not the log is on).
pub fn spawned(run: &mut Run, id: u32, kind: EntityKind) {
    run.log.tags.spawned(id, kind);
}

/// A hiding mimic dropped its disguise: it takes its Mimic number, once.
pub fn revealed(run: &mut Run, id: u32) {
    run.log.tags.revealed(id);
}

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

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum HitOutcome {
    Dealt,
    Immune,
    /// A resistance over 100 % turned the hit into healing: the HP it gave.
    Healed(f64),
    /// A boss that cannot be hurt right now.
    Shielded,
    /// A hero in debug mode: the hit shows, nothing is subtracted.
    DebugNoLoss,
}

/// What a hurt function hands over: the values it used.
#[derive(Clone, Copy, Debug)]
pub struct HitFacts {
    pub target: Creature,
    pub dmg: Damage,
    pub res: Resistances,
    /// `resolve_parts(&dmg, &res)`: the rule's `raw` is their sum.
    pub parts: [f64; DamageType::COUNT],
    /// A hero's armor (0 for everyone else, and when it was not applied).
    pub armor: f64,
    pub hp_before: f64,
    /// Clamped at 0.
    pub hp_after: f64,
    /// The HP lost (a monster's `applied`; a hero's before minus after).
    pub dealt: f64,
    /// The damage the rule applied before HP limits: a hero's `raw * (1 - armor)`, a monster's `raw`.
    pub taken: f64,
    pub outcome: HitOutcome,
}

fn creature_id(run: &Run, c: Creature) -> u32 {
    match c {
        Creature::Player(i) => run.players[i].id,
        Creature::Monster(i) => run.monsters[i].id,
    }
}

/// A hit begins: its record is built now and filed by `hit_end`.
pub fn hit_begin(run: &mut Run, f: HitFacts) {
    if !on(run) {
        return;
    }
    let target = creature_id(run, f.target);
    let mut who = vec![record::seen_creature(run, f.target)];
    if let Some(by) = f.dmg.why.by {
        if let Some(i) = run.player_idx(by) {
            who.push(record::seen_creature(run, Creature::Player(i)));
        } else if let Some(i) = run.monster_idx(by) {
            who.push(record::seen_creature(run, Creature::Monster(i)));
        } else if let Some(oi) = run.objects.iter().position(|o| o.id == by) {
            who.push(record::seen_object(run, oi));
        }
    }
    let viewer = match f.target {
        Creature::Player(i) => Some(run.players[i].id),
        Creature::Monster(i) => run.monsters[i].ally.as_ref().map(|a| a.owner),
    };
    let unseen = viewer.and_then(|viewer| {
        let shown = match f.outcome {
            HitOutcome::Dealt => f.dealt,
            HitOutcome::DebugNoLoss => f.taken,
            HitOutcome::Immune | HitOutcome::Healed(_) | HitOutcome::Shielded => return None,
        };
        Some(Unseen { viewer, head: format!("{} took {} from something unseen", tag_of(run, target), text::n1(shown)), details: text::part_lines(&f) })
    });
    let rec = LogRec {
        t: run.time,
        kind: if matches!(f.outcome, HitOutcome::Healed(_)) { LineKind::Heal } else { LineKind::Hit },
        head: text::hit_head(run, &f, target),
        details: text::hit_details(run, &f),
        who,
        unseen,
        dealt: Some(f.dealt),
        secs: None,
    };
    let at = run.log.records.len();
    run.log.open.push((at, rec));
}

/// The hit that `hit_begin` opened last is over: its record is filed where it began.
pub fn hit_end(run: &mut Run) {
    if let Some((at, rec)) = run.log.open.pop() {
        let at = at.min(run.log.records.len());
        run.log.records.insert(at, rec);
    }
}
