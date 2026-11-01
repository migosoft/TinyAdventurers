//! Which monsters an area or chaining ability may hit, and why one is passed over. The rules and the
//! rules log share this one decision.

use super::effects::Creature;
use super::Run;
use crate::collision::line_of_sight;
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::effects::EffectKind;
use crate::math::{angle_diff, Vec2};

/// Which team a user fights for. A hero or an ally (the wolf) is `Heroes`; every other monster is `Monsters`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Heroes,
    Monsters,
}

/// The side creature `c` fights for.
pub fn side(run: &Run, c: Creature) -> Side {
    match c {
        Creature::Player(_) => Side::Heroes,
        Creature::Monster(mi) if run.monsters[mi].is_ally() => Side::Heroes,
        Creature::Monster(_) => Side::Monsters,
    }
}

/// Why a creature is not a target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Skip {
    Dead,
    Ally,
    Hiding,
    /// Under the Invisible effect; skipped where a target is picked (`skip_invisible`).
    Invisible,
    Dormant,
    Airborne,
    OutOfReach,
    OutsideArc,
    NoLineOfSight,
    AlreadyHit,
}

/// The cone of a swing.
#[derive(Clone, Copy)]
pub struct Arc {
    pub aim: f64,
    /// The whole angle (rad).
    pub width: f64,
    /// The user's body radius: a creature closer than that and its own radius touches the user.
    pub user_radius: f64,
}

#[derive(Clone, Copy)]
/// What an ability needs of a creature. One that is dead, on the user's side, already hit or out of reach is
/// never a target; the other filters are switched on by the rule.
pub struct Rule {
    /// Where the ability reaches from.
    pub at: Vec2,
    pub reach: f64,
    /// The creature's body radius is added to `reach`.
    pub plus_radius: bool,
    /// Only inside it, or touching the user.
    pub arc: Option<Arc>,
    /// Needs a clear line from `at`.
    pub los: bool,
    /// Skips a hiding mimic.
    pub skip_hiding: bool,
    pub skip_dormant: bool,
    pub skip_airborne: bool,
    /// Skips an invisible creature: only where a target is picked (a jump, a gaze); an area, a swing or a dash
    /// that covers one still hits it.
    pub skip_invisible: bool,
}

/// Is `c`, standing at `pos`, a target of `rule` for a user of `side`? `hit` are those already hit. The
/// checks are a plain conjunction; the line of sight, which costs most, comes last.
pub fn check(run: &Run, side: Side, c: Creature, pos: Vec2, rule: &Rule, hit: &[Creature]) -> Result<(), Skip> {
    // `ally`: on the user's own side, so never a foe.
    let (alive, radius, ally, hiding, dormant, airborne) = match c {
        Creature::Player(i) => (run.players[i].alive, PLAYER_RADIUS, side == Side::Heroes, false, false, false),
        Creature::Monster(i) => {
            let m = &run.monsters[i];
            // An ally that is sinking is no target of the monsters.
            (m.alive && (side == Side::Heroes || m.sinking.is_none()), m.radius, m.is_ally() == (side == Side::Heroes), m.hiding, m.dormant, m.airborne)
        }
    };
    if !alive {
        return Err(Skip::Dead);
    }
    let d = pos.dist(rule.at);
    let limit = if rule.plus_radius { rule.reach + radius } else { rule.reach };
    if !(d <= limit) {
        return Err(Skip::OutOfReach);
    }
    if let Some(arc) = rule.arc {
        let in_arc = angle_diff(rule.at.angle_to(pos), arc.aim).abs() <= arc.width / 2.0 || d < radius + arc.user_radius;
        if !in_arc {
            return Err(Skip::OutsideArc);
        }
    }
    if ally {
        return Err(Skip::Ally);
    }
    if rule.skip_hiding && hiding {
        return Err(Skip::Hiding);
    }
    if rule.skip_invisible && run.has_effect(c, EffectKind::Invisible) {
        return Err(Skip::Invisible);
    }
    if rule.skip_dormant && dormant {
        return Err(Skip::Dormant);
    }
    if rule.skip_airborne && airborne {
        return Err(Skip::Airborne);
    }
    if hit.contains(&c) {
        return Err(Skip::AlreadyHit);
    }
    if rule.los && !line_of_sight(&run.layout.map, rule.at, pos) {
        return Err(Skip::NoLineOfSight);
    }
    Ok(())
}

/// Who a user of `side` may look at: the monsters (the heroes' side also meets its own allies here, to
/// tell why they are passed over), or, for the monsters, the heroes and then the allies. Monsters first
/// by index for the heroes' side, as before.
fn candidates(run: &Run, side: Side) -> Vec<Creature> {
    match side {
        Side::Heroes => (0..run.monsters.len()).map(Creature::Monster).collect(),
        Side::Monsters => {
            let heroes = (0..run.players.len()).map(Creature::Player);
            let allies = (0..run.monsters.len()).filter(|&mi| run.monsters[mi].is_ally()).map(Creature::Monster);
            heroes.chain(allies).collect()
        }
    }
}

/// The creatures that pass `check` with `pos_of` as their position (the foes of `side`: for the heroes
/// enemy monsters, for the monsters heroes and allies), and, only when `collect` is set (the log is on),
/// the others with their reason.
pub fn select(run: &Run, side: Side, rule: &Rule, hit: &[Creature], collect: bool, pos_of: impl Fn(Creature) -> Vec2) -> (Vec<Creature>, Vec<(Creature, Skip)>) {
    let (mut chosen, mut skips) = (Vec::new(), Vec::new());
    for c in candidates(run, side) {
        match check(run, side, c, pos_of(c), rule, hit) {
            Ok(()) => chosen.push(c),
            Err(why) if collect => skips.push((c, why)),
            Err(_) => {}
        }
    }
    (chosen, skips)
}

/// Adds `more` to `skips`, once per creature.
pub fn merge(skips: &mut Vec<(Creature, Skip)>, more: Vec<(Creature, Skip)>) {
    for s in more {
        if !skips.iter().any(|(c, _)| *c == s.0) {
            skips.push(s);
        }
    }
}

/// The nearest creature that would pass `rule` with twice its reach but is beyond its reach, and how far.
pub fn nearest_beyond(run: &Run, side: Side, rule: &Rule, hit: &[Creature]) -> Option<(Creature, f64)> {
    let wide = Rule { reach: 2.0 * rule.reach, ..*rule };
    let (near, _) = select(run, side, &wide, hit, false, |c| run.creature_pos(c));
    near.into_iter().map(|c| (c, run.creature_pos(c).dist(rule.at))).filter(|&(_, d)| d > rule.reach).min_by(|a, b| a.1.total_cmp(&b.1))
}
