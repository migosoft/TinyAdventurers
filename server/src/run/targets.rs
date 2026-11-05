//! Which monsters an area or chaining ability may hit, and why one is passed over. The rules and the
//! rules log share this one decision.

use super::effects::Creature;
use super::Run;
use crate::collision::line_of_sight;
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::damage::DamageSplit;
use crate::defs::effects::EffectKind;
use crate::math::{angle_diff, Vec2};

/// Whom a creature fights for. `Neutral` is nobody's foe and nobody's friend: it is never a target and
/// nothing hurts it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Side {
    Neutral = 0,
    Hostile = 1,
    Friendly = 2,
}

/// Do `a` and `b` fight each other? Only a Hostile and a Friendly do; a Neutral has no foes.
pub fn foes(a: Side, b: Side) -> bool {
    matches!((a, b), (Side::Hostile, Side::Friendly) | (Side::Friendly, Side::Hostile))
}

/// The side creature `c` fights for.
pub fn side(run: &Run, c: Creature) -> Side {
    match c {
        Creature::Player(i) => run.players[i].side,
        Creature::Monster(mi) => run.monsters[mi].side,
    }
}

/// Why a creature is not a target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Skip {
    Dead,
    Ally,
    /// Neutral: nobody's foe, never a target.
    Neutral,
    Hiding,
    /// Under the Invisible effect; skipped where a target is picked (`skip_invisible`).
    Invisible,
    Dormant,
    Airborne,
    /// The attack passes through it: it has no body and resists every type of the attack fully.
    Bodiless,
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
    /// The damage split of the attack, if it deals damage: a bodiless creature that fully resists it is passed
    /// through (`Skip::Bodiless`) and gets nothing from it. `None` for a rule that only applies effects.
    pub passes: Option<DamageSplit>,
}

/// Is `c`, standing at `pos`, a target of `rule` for a user of `side`? `hit` are those already hit. The
/// checks are a plain conjunction; the line of sight, which costs most, comes last.
pub fn check(run: &Run, side: Side, c: Creature, pos: Vec2, rule: &Rule, hit: &[Creature]) -> Result<(), Skip> {
    let (alive, radius, their, hiding, dormant, airborne) = match c {
        Creature::Player(i) => (run.players[i].alive, PLAYER_RADIUS, run.players[i].side, false, false, false),
        Creature::Monster(i) => {
            let m = &run.monsters[i];
            // A Friendly monster that is sinking is no target of the Hostile.
            (m.alive && (side != Side::Hostile || m.side != Side::Friendly || m.sinking.is_none()), m.radius, m.side, m.hiding, m.dormant, m.airborne)
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
    if their == Side::Neutral {
        return Err(Skip::Neutral);
    }
    if !foes(side, their) {
        return Err(Skip::Ally);
    }
    if let Some(split) = &rule.passes {
        if run.passes_through(c, split) {
            return Err(Skip::Bodiless);
        }
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
        Side::Friendly => (0..run.monsters.len()).map(Creature::Monster).collect(),
        Side::Hostile => {
            let heroes = (0..run.players.len()).map(Creature::Player);
            let allies = (0..run.monsters.len()).filter(|&mi| run.monsters[mi].side == Side::Friendly).map(Creature::Monster);
            heroes.chain(allies).collect()
        }
        // #224 widens the sets: a Neutral user will look at both sides.
        Side::Neutral => Vec::new(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::damage::{kind_split, Damage};
    use crate::defs::enemies::EnemyType;
    use crate::defs::kinds::EntityKind;
    use crate::protocol::{BossId, ClassId};
    use crate::run::abilities::explode;
    use crate::run::tests::test_run;

    /// A lone ranger, a wolf, a Hostile orc, and a Neutral orc beside the hero (indices of the last two).
    fn fixture() -> (Run, usize, usize, usize) {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        let spot = run.players[0].pos();
        run.monsters[wi].pos = spot + Vec2::new(-30.0, 0.0);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, spot + Vec2::new(0.0, 100.0), None);
        let oi = run.monster_idx(id).unwrap();
        let id = run.spawn_enemy(EnemyType::OrcWarrior, spot + Vec2::new(12.0, 0.0), None);
        let ni = run.monster_idx(id).unwrap();
        run.monsters[ni].side = Side::Neutral;
        (run, wi, oi, ni)
    }

    fn rule(at: Vec2) -> Rule {
        Rule { at, reach: 60.0, plus_radius: true, arc: None, los: false, skip_hiding: false, skip_dormant: false, skip_airborne: false, skip_invisible: false, passes: None }
    }

    #[test]
    fn foes_table() {
        use Side::*;
        assert!(foes(Hostile, Friendly) && foes(Friendly, Hostile));
        for s in [Neutral, Hostile, Friendly] {
            assert!(!foes(Neutral, s) && !foes(s, Neutral));
        }
        assert!(!foes(Friendly, Friendly) && !foes(Hostile, Hostile));
    }

    #[test]
    fn side_reads_state() {
        let (mut run, wi, oi, ni) = fixture();
        assert_eq!(side(&run, Creature::Player(0)), Side::Friendly);
        assert_eq!(side(&run, Creature::Monster(wi)), Side::Friendly);
        assert_eq!(side(&run, Creature::Monster(oi)), Side::Hostile);
        assert_eq!(side(&run, Creature::Monster(ni)), Side::Neutral);
        run.monsters[oi].side = Side::Friendly;
        assert_eq!(side(&run, Creature::Monster(oi)), Side::Friendly);
    }

    #[test]
    fn neutral_is_never_a_target() {
        let (run, _, _, ni) = fixture();
        let neutral = Creature::Monster(ni);
        let r = rule(run.players[0].pos());
        for user in [Side::Friendly, Side::Hostile] {
            let (chosen, skips) = select(&run, user, &r, &[], true, |c| run.creature_pos(c));
            assert!(!chosen.contains(&neutral), "{user:?} must not target it");
            if user == Side::Friendly {
                assert!(skips.contains(&(neutral, Skip::Neutral)), "{skips:?}");
            }
        }
    }

    #[test]
    fn neutral_is_untouchable() {
        use crate::defs::effects::EffectKind;
        use crate::run::effects::Creature as C;
        let (mut run, _, _, ni) = fixture();
        let hp = run.monsters[ni].hp;
        let dmg = || Damage::physical(5.0);
        assert!(!run.hurt_monster(ni, dmg(), false, Some(0)));
        assert!(!run.hurt_monster(ni, dmg(), false, None));
        assert_eq!(run.monsters[ni].hp, hp);
        assert!(!run.apply_effect_from(C::Monster(ni), EffectKind::Slowed, Some(5.0), 1, false));
        assert!(!run.monsters[ni].effects.has(EffectKind::Slowed));
        let from = run.monsters[ni].pos - Vec2::new(10.0, 0.0);
        run.knock_monster(ni, from, 30.0, 30);
        assert_eq!(run.monsters[ni].knock, Vec2::ZERO);
        run.monsters[ni].hp = hp - 1.0;
        assert_eq!(run.heal_monster(ni, 5.0, None), 0.0);
        assert_eq!(run.monsters[ni].hp, hp - 1.0);
        run.monsters[ni].hp = hp;
        let at = run.monsters[ni].pos;
        let fireball = Damage::new(10.0, kind_split(EntityKind::Fireball));
        explode(&mut run, at, 30.0, fireball, Side::Friendly, Some(0), 0, false, 20.0, 30);
        explode(&mut run, at, 30.0, dmg(), Side::Hostile, None, 4, false, 20.0, 30);
        assert_eq!(run.monsters[ni].hp, hp);
        assert_eq!(run.monsters[ni].knock, Vec2::ZERO);
    }

    #[test]
    fn enemy_ignores_neutral() {
        let (mut run, wi, oi, ni) = fixture();
        run.monsters[wi].alive = false;
        run.players[0].alive = false;
        let from = run.monsters[ni].pos + Vec2::new(8.0, 0.0);
        let sight = run.monsters[oi].sight_now();
        assert_eq!(super::super::ai::find_visible_foe(&run, from, sight), None);
    }
}
