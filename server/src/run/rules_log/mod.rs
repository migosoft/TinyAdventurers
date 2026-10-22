//! The rules log: a toggleable text log that explains the game's rules. The game reaches it
//! only through one-line hooks (see the boundary test in `tests.rs`); everything else lives here.

use super::Run;
use crate::run::abilities::MeleeTarget;
use crate::run::targets::Skip;
use crate::defs::abilities::AbilityId;
use crate::defs::damage::{Damage, DamageType, Resistances, What};
use crate::defs::effects::EffectKind;
use crate::defs::kinds::EntityKind;
use crate::protocol::EntSnap;
use crate::run::effects::{Creature, Duration, EffectOutcome};

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
    /// Each also holds the records that must follow it (a death), filed right after it.
    open: Vec<(usize, LogRec, Vec<LogRec>)>,
    /// When "Too close" was last logged, per hero id and slot (`true` is the primary).
    too_close: Vec<(u32, bool, f64)>,
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

/// A hero, monster or object by id, as a record names it.
fn seen_by_id(run: &Run, id: u32) -> Option<record::Seen> {
    if let Some(i) = run.player_idx(id) {
        Some(record::seen_creature(run, Creature::Player(i)))
    } else if let Some(i) = run.monster_idx(id) {
        Some(record::seen_creature(run, Creature::Monster(i)))
    } else {
        run.objects.iter().position(|o| o.id == id).map(|oi| record::seen_object(run, oi))
    }
}

/// A hit begins: its record is built now and filed by `hit_end`.
pub fn hit_begin(run: &mut Run, f: HitFacts) {
    if !on(run) {
        return;
    }
    let target = creature_id(run, f.target);
    let mut who = vec![record::seen_creature(run, f.target)];
    who.extend(f.dmg.why.by.and_then(|by| seen_by_id(run, by)));
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
    run.log.open.push((at, rec, Vec::new()));
}

/// The hit that `hit_begin` opened last is over: its record is filed where it began.
pub fn hit_end(run: &mut Run) {
    if let Some((at, rec, after)) = run.log.open.pop() {
        let at = at.min(run.log.records.len());
        run.log.records.splice(at..at, std::iter::once(rec).chain(after));
    }
}

/// What `apply` hands over: its outcome and the numbers it used.
#[derive(Clone, Copy, Debug)]
pub struct EffectFacts {
    pub target: Creature,
    pub kind: EffectKind,
    pub outcome: EffectOutcome,
    pub duration: Duration,
    /// The weaker tiers it removed (`EffectKind::bit`s).
    pub replaced: u16,
    /// The creature's timer for `kind` after the call.
    pub left: f64,
    pub origin: Option<(u32, What)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EndReason {
    RanOut,
    Water,
    Purify,
}

/// An effect application has an outcome. During a hit on the same creature its line becomes a detail of
/// that hit's record and the headline gets a suffix; otherwise it is a record of its own.
pub fn effect(run: &mut Run, f: EffectFacts) {
    if !on(run) || f.outcome == EffectOutcome::NotThere {
        return;
    }
    let target = creature_id(run, f.target);
    let lines = text::effect_lines(run, &f);
    let left = matches!(f.outcome, EffectOutcome::Added | EffectOutcome::Refreshed).then_some(f.left);
    if let Some((_, rec, _)) = run.log.open.last_mut().filter(|(_, r, _)| r.who.first().is_some_and(|w| w.id == target)) {
        // The suffix is appended to the finished head in place: the hit's head is built once, by `hit_begin`.
        rec.head.push_str(&text::effect_suffix(&f));
        rec.details.extend(lines);
        rec.secs = left.or(rec.secs);
        return;
    }
    let mut who = vec![record::seen_creature(run, f.target)];
    who.extend(f.origin.and_then(|(by, _)| seen_by_id(run, by)));
    let head = text::effect_head(run, &f, target);
    record::push(run, LogRec { t: run.time, kind: LineKind::Effect, head, details: lines, who, unseen: None, dealt: None, secs: left });
}

/// An effect ended on its own (it ran out, water, Purify).
pub fn ended(run: &mut Run, c: Creature, kind: EffectKind, why: EndReason) {
    if !on(run) {
        return;
    }
    let head = text::ended_head(run, creature_id(run, c), kind, why);
    let who = vec![record::seen_creature(run, c)];
    record::push(run, LogRec { t: run.time, kind: LineKind::Effect, head, details: vec![], who, unseen: None, dealt: None, secs: None });
}

/// What a heal hands over. `healed` is what the creature gained (0 when it was full).
#[derive(Clone, Copy, Debug)]
pub struct HealFacts {
    pub target: Creature,
    pub by: Option<(u32, What)>,
    pub healed: f64,
    pub hp_before: f64,
}

/// A creature was healed. Nothing is logged for a heal of 0.
pub fn heal(run: &mut Run, f: HealFacts) {
    if !on(run) || f.healed <= 0.0 {
        return;
    }
    let target = creature_id(run, f.target);
    let hp_after = match f.target {
        Creature::Player(i) => run.players[i].hp,
        Creature::Monster(i) => run.monsters[i].hp,
    };
    let mut who = vec![record::seen_creature(run, f.target)];
    who.extend(f.by.and_then(|(by, _)| seen_by_id(run, by)));
    let head = text::heal_head(run, &f, target, hp_after);
    record::push(run, LogRec { t: run.time, kind: LineKind::Heal, head, details: vec![], who, unseen: None, dealt: None, secs: None });
}

/// What a death hands over: who got the kill, or the effect that ticked it down and who it is credited to.
#[derive(Clone, Copy, Debug)]
pub struct DeathFacts {
    pub target: Creature,
    pub by: Option<u32>,
    pub tick: Option<EffectKind>,
    /// The index of the hero credited with a tick's kill.
    pub credit: Option<usize>,
}

/// A creature died of a hit. While the hit's record is open the death waits and is filed right after it.
pub fn death(run: &mut Run, f: DeathFacts) {
    if !on(run) {
        return;
    }
    let target = creature_id(run, f.target);
    let mut who = vec![record::seen_creature(run, f.target)];
    who.extend(f.by.and_then(|by| seen_by_id(run, by)));
    let viewer = match f.target {
        Creature::Player(i) => Some(run.players[i].id),
        Creature::Monster(i) => run.monsters[i].ally.as_ref().map(|a| a.owner),
    };
    let unseen = viewer.map(|viewer| Unseen { viewer, head: text::death_unseen_head(run, f.target, target), details: vec![] });
    let rec = LogRec { t: run.time, kind: LineKind::Death, head: text::death_head(run, &f, target), details: vec![], who, unseen, dealt: None, secs: None };
    match run.log.open.last_mut() {
        Some((_, _, after)) => after.push(rec),
        None => record::push(run, rec),
    }
}

/// Ability `what` of hero `by` passed over monsters: one record each, for the reasons worth telling.
/// `chain_stop` is the nearest monster a Chain Spark stopped short of, and how far it was.
pub fn skipped(run: &mut Run, by: u32, what: What, skips: &[(usize, Skip)], chain_stop: Option<(usize, f64)>) {
    if !on(run) {
        return;
    }
    let chain = matches!(what, What::Ability(AbilityId::ChainSpark));
    for &(mi, skip) in skips {
        let Some(reason) = text::skip_reason(skip) else { continue };
        let id = run.monsters[mi].id;
        let mut who = vec![record::seen_creature(run, Creature::Monster(mi))];
        who.extend(seen_by_id(run, by));
        let head = text::skip_head(run, what, chain, id, reason);
        record::push(run, LogRec { t: run.time, kind: LineKind::Skip, head, details: vec![], who, unseen: None, dealt: None, secs: None });
    }
    if let Some((mi, d)) = chain_stop {
        let id = run.monsters[mi].id;
        let mut who = vec![record::seen_creature(run, Creature::Monster(mi))];
        who.extend(seen_by_id(run, by));
        let head = text::chain_stop_head(run, id, d);
        record::push(run, LogRec { t: run.time, kind: LineKind::Skip, head, details: vec![], who, unseen: None, dealt: None, secs: None });
    }
}

/// "Too close" is told at most this often (seconds) per hero and slot.
pub const TOO_CLOSE_EVERY: f64 = 1.0;

/// Hero `pi`'s ability is blocked (a secondary) or becomes a Strike (a primary) by `target` in melee reach.
pub fn too_close(run: &mut Run, pi: usize, primary: bool, target: MeleeTarget) {
    if !on(run) {
        return;
    }
    let hero = run.players[pi].id;
    let now = run.time;
    match run.log.too_close.iter_mut().find(|(h, p, _)| *h == hero && *p == primary) {
        Some((_, _, last)) if now - *last < TOO_CLOSE_EVERY - 1e-9 => return,
        Some((_, _, last)) => *last = now,
        None => run.log.too_close.push((hero, primary, now)),
    }
    let (target_id, seen) = match target {
        MeleeTarget::Monster(mi) => (run.monsters[mi].id, record::seen_creature(run, Creature::Monster(mi))),
        MeleeTarget::Object(oi) => (run.objects[oi].id, record::seen_object(run, oi)),
    };
    let ability = if primary { run.players[pi].sheet.primary.id } else { run.players[pi].sheet.secondary.id };
    let head = text::too_close_head(run, hero, ability, primary, target_id);
    let who = vec![record::seen_creature(run, Creature::Player(pi)), seen];
    record::push(run, LogRec { t: run.time, kind: LineKind::Note, head, details: vec![], who, unseen: None, dealt: None, secs: None });
}
