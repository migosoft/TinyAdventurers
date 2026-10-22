//! Which monsters an area or chaining ability may hit, and why one is passed over. The rules and the
//! rules log share this one decision.

use super::Run;
use crate::collision::line_of_sight;
use crate::defs::classes::PLAYER_RADIUS;
use crate::math::{angle_diff, Vec2};

/// Why a monster is not a target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Skip {
    Dead,
    Ally,
    Hiding,
    Dormant,
    Airborne,
    OutOfReach,
    OutsideArc,
    NoLineOfSight,
    AlreadyHit,
}

#[derive(Clone, Copy)]
/// What an ability needs of a monster. A monster that is dead, an ally, already hit or out of reach is
/// never a target; the other filters are switched on by the rule.
pub struct Rule {
    /// Where the ability reaches from.
    pub at: Vec2,
    pub reach: f64,
    /// The monster's body radius is added to `reach`.
    pub plus_radius: bool,
    /// (aim, whole arc): only inside it, or touching the user.
    pub arc: Option<(f64, f64)>,
    /// Needs a clear line from `at`.
    pub los: bool,
    pub skip_hiding: bool,
    pub skip_dormant: bool,
    pub skip_airborne: bool,
}

/// Is monster `mi`, standing at `pos`, a target of `rule`? `hit` are those already hit. The checks are
/// a plain conjunction; the line of sight, which costs most, comes last.
pub fn check(run: &Run, mi: usize, pos: Vec2, rule: &Rule, hit: &[usize]) -> Result<(), Skip> {
    let m = &run.monsters[mi];
    if !m.alive {
        return Err(Skip::Dead);
    }
    let d = pos.dist(rule.at);
    let limit = if rule.plus_radius { rule.reach + m.radius } else { rule.reach };
    if !(d <= limit) {
        return Err(Skip::OutOfReach);
    }
    if let Some((aim, arc)) = rule.arc {
        let in_arc = angle_diff(rule.at.angle_to(pos), aim).abs() <= arc / 2.0 || d < m.radius + PLAYER_RADIUS;
        if !in_arc {
            return Err(Skip::OutsideArc);
        }
    }
    if m.is_ally() {
        return Err(Skip::Ally);
    }
    if rule.skip_hiding && m.hiding {
        return Err(Skip::Hiding);
    }
    if rule.skip_dormant && m.dormant {
        return Err(Skip::Dormant);
    }
    if rule.skip_airborne && m.airborne {
        return Err(Skip::Airborne);
    }
    if hit.contains(&mi) {
        return Err(Skip::AlreadyHit);
    }
    if rule.los && !line_of_sight(&run.layout.map, rule.at, pos) {
        return Err(Skip::NoLineOfSight);
    }
    Ok(())
}

/// The monsters (by index, ascending) that pass `check` with `pos_of` as their position, and, only when
/// `collect` is set (the log is on), the others with their reason.
pub fn select(run: &Run, rule: &Rule, hit: &[usize], collect: bool, pos_of: impl Fn(usize) -> Vec2) -> (Vec<usize>, Vec<(usize, Skip)>) {
    let (mut chosen, mut skips) = (Vec::new(), Vec::new());
    for mi in 0..run.monsters.len() {
        match check(run, mi, pos_of(mi), rule, hit) {
            Ok(()) => chosen.push(mi),
            Err(why) if collect => skips.push((mi, why)),
            Err(_) => {}
        }
    }
    (chosen, skips)
}

/// Adds `more` to `skips`, once per monster.
pub fn merge(skips: &mut Vec<(usize, Skip)>, more: Vec<(usize, Skip)>) {
    for s in more {
        if !skips.iter().any(|(mi, _)| *mi == s.0) {
            skips.push(s);
        }
    }
}

/// The nearest monster that would pass `rule` with twice its reach but is beyond its reach, and how far.
pub fn nearest_beyond(run: &Run, rule: &Rule, hit: &[usize]) -> Option<(usize, f64)> {
    let wide = Rule { reach: 2.0 * rule.reach, ..*rule };
    let (near, _) = select(run, &wide, hit, false, |mi| run.monsters[mi].pos);
    near.into_iter().map(|mi| (mi, run.monsters[mi].pos.dist(rule.at))).filter(|&(_, d)| d > rule.reach).min_by(|a, b| a.1.total_cmp(&b.1))
}
