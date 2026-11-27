//! Final bosses. Each boss implements `BossBehaviour`; adding a boss means a
//! new file here plus an entry in `create` and `defs::bosses`.

mod demon;
mod dragon;
pub(crate) mod flight;
pub(crate) mod lich;

use super::ai::find_visible_hero;
use super::Run;
use crate::defs::kinds::Anim;
use crate::defs::abilities::AbilityId;
use crate::math::{angle_diff, Vec2};
use crate::sheet::ResolvedAbility;
use crate::protocol::BossId;

pub trait BossBehaviour: Send {
    /// Spawn extra monsters (e.g. lich disciples) when the run is created.
    fn spawn_extras(&mut self, _run: &mut Run, _boss_pos: Vec2) {}
    /// Special damage condition (lich: all disciples dead).
    fn can_be_damaged(&self, _run: &Run) -> bool {
        true
    }
    /// The hero the boss currently locks its gaze on (lich), sent as the boss's `EntSnap.extra`.
    fn gaze_target(&self) -> Option<u32> {
        None
    }
    /// The script is in the middle of its own action (wind-up, cast, flight): the boss doesn't dodge.
    fn busy(&self) -> bool {
        false
    }
    /// The script is in an attack's wind-up or recovery (not only flying): the head looks ahead, no glances.
    fn acting(&self) -> bool {
        self.busy()
    }
    fn tick(&mut self, run: &mut Run, dt: f64);
}

pub fn create(id: BossId) -> Box<dyn BossBehaviour> {
    match id {
        BossId::FireDemon | BossId::IceDemon => Box::new(demon::Demon::default()),
        BossId::Lich => Box::new(lich::Lich::default()),
        BossId::Dragon => Box::new(dragon::Dragon::default()),
    }
}

/// Index of the boss monster, if alive.
pub(crate) fn boss_idx(run: &Run) -> Option<usize> {
    let ent = run.level.boss().map_or(0, |b| b.boss_ent);
    run.monsters.iter().position(|m| m.id == ent && m.alive)
}

pub(crate) fn set_anim(run: &mut Run, bi: usize, a: Anim) {
    let m = &mut run.monsters[bi];
    if m.anim != a {
        m.anim = a;
        m.anim_start = run.time;
    }
}

/// Nearest hero the boss can see (bosses never target allies).
pub(crate) fn target(run: &Run, bi: usize) -> Option<(usize, Vec2, f64)> {
    let m = &run.monsters[bi];
    find_visible_hero(run, m.pos, m.sight_now(), m.gaze_dir(), m.side).map(|pi| {
        let p = run.players[pi].pos();
        (pi, p, p.dist(m.pos))
    })
}

/// Boss `bi` looks at `at`; true when its body faces it within the gate of `id`. When it does not, the body
/// turns toward it (the script then keeps moving or stands).
pub(crate) fn face_for(run: &mut Run, bi: usize, at: Vec2, id: AbilityId) -> bool {
    let gate = super::facing::gate(&kit(run, bi, id));
    let ok = super::facing::faces(run, bi, at, gate);
    if !ok {
        run.monsters[bi].face_to = Some(run.monsters[bi].pos.angle_to(at));
    }
    ok
}

/// A point straight ahead of boss `bi`: a use "at" it keeps the aim.
pub(crate) fn ahead(run: &Run, bi: usize) -> Vec2 {
    let m = &run.monsters[bi];
    m.pos + Vec2::from_angle(m.aim) * 30.0
}

/// Boss `bi` uses `id` at `at`; the animation its wind-up began with plays on (the script sets the pose, the
/// use only does the effect).
pub(crate) fn use_in_pose(run: &mut Run, bi: usize, id: crate::defs::abilities::AbilityId, at: Vec2) {
    let (anim, since) = (run.monsters[bi].anim, run.monsters[bi].anim_start);
    super::abilities::monster_use(run, bi, id, at);
    run.monsters[bi].anim = anim;
    run.monsters[bi].anim_start = since;
}

/// The boss's kit ability `id` (panics if the kit lacks it).
pub(crate) fn kit(run: &Run, bi: usize, id: AbilityId) -> ResolvedAbility {
    run.monsters[bi].kit.get(id).expect("the boss's kit has it").clone()
}

/// Off its opening delay (`opening`) and off cooldown.
pub(crate) fn ready(run: &Run, bi: usize, opening: &[(AbilityId, f64)], id: AbilityId) -> bool {
    run.monsters[bi].cds.ready(id) && opening.iter().all(|&(i, left)| i != id || left <= 0.0)
}

/// A living foe within `reach` px (centre distance) whose direction differs from the boss's aim by more than 2.0 rad.
pub(crate) fn foe_behind(run: &Run, bi: usize, reach: f64) -> bool {
    let (pos, aim, side) = (run.monsters[bi].pos, run.monsters[bi].aim, run.monsters[bi].side);
    run.players.iter().any(|p| crate::run::targets::foes(side, p.side) && p.alive && !p.effects.has(crate::defs::effects::EffectKind::Invisible) && p.pos().dist(pos) < reach && angle_diff(pos.angle_to(p.pos()), aim).abs() > 2.0)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::defs::damage::Damage;
    use crate::defs::effects::EffectKind;
    use crate::protocol::ClassId;
    use crate::run::entities::AiState;
    use crate::run::tests::test_run;
    use crate::run::DT;

    /// A awake boss alone on open floor facing `aim`, one Paladin `off` px from it.
    pub(crate) fn arena(boss: BossId, aim: f64, off: Vec2) -> (Run, usize) {
        let mut run = test_run(&[ClassId::Paladin], boss);
        let bi = boss_idx(&run).unwrap();
        let at = run.monsters[bi].pos;
        run.players[0].mv.x = at.x + off.x;
        run.players[0].mv.y = at.y + off.y;
        crate::run::ai::tests::open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let bi = boss_idx(&run).unwrap();
        run.monsters[bi].dormant = false;
        run.monsters[bi].aim = aim;
        run.monsters[bi].gaze = 0.0;
        run.level.boss_mut().unwrap().awake = true;
        (run, bi)
    }

    fn steps(run: &mut Run, secs: f64) {
        for _ in 0..(secs / DT).round() as usize {
            run.step();
        }
    }

    #[test]
    fn a_boss_held_mid_action_reacts_like_any_monster() {
        let (mut run, bi) = arena(BossId::FireDemon, 0.0, Vec2::new(100.0, 0.0));
        run.monsters[bi].ai.acting = true; // its script was mid-action when the hold began
        run.monsters[bi].effects.add(EffectKind::Petrified, 5.0);
        run.step();
        assert!(!run.monsters[bi].ai.acting, "a held boss is not acting");
    }

    #[test]
    fn a_flying_boss_that_loses_a_hero_only_looks() {
        let (mut run, bi) = arena(BossId::Dragon, 0.0, Vec2::new(100.0, 0.0));
        run.monsters[bi].airborne = true;
        steps(&mut run, 0.3);
        assert!(run.monsters[bi].ai.target.is_some());
        let at = run.monsters[bi].pos;
        run.players[0].mv.x = at.x - 100.0;
        run.players[0].mv.y = at.y;
        run.step();
        let g = run.monsters[bi].ai.glance.expect("it looks to where it lost the hero");
        assert!(!g.body, "the body follows the flight, only the head looks");
    }

    /// Hit from behind with no hero seen: the head turns first, then the body; it does not move.
    pub(crate) fn hit_from_behind(boss: BossId) {
        let (mut run, bi) = arena(boss, std::f64::consts::PI, Vec2::new(300.0, 0.0));
        run.players[0].effects.add(EffectKind::Invisible, 60.0);
        let (pos, aim0) = (run.monsters[bi].pos, run.monsters[bi].aim);
        run.hurt_monster(bi, Damage::physical(1.0).along(Vec2::new(-1.0, 0.0)), false, Some(0));
        let (mut head_at, mut body_at) = (None, None);
        for i in 0..(3.0 / DT) as usize {
            run.step();
            let m = &run.monsters[bi];
            if head_at.is_none() && m.gaze.abs() > 0.01 {
                head_at = Some(i);
            }
            if body_at.is_none() && angle_diff(m.aim, aim0).abs() > 0.01 {
                body_at = Some(i);
            }
        }
        let m = &run.monsters[bi];
        assert!(head_at.is_some() && head_at <= body_at, "the gaze moves first: {head_at:?} {body_at:?}");
        // The body turns only as far as the head cannot reach: the blow ends up within the neck.
        assert!(angle_diff(m.aim, 0.0).abs() <= m.sight_now().neck.to_radians() + 0.05, "the body turned toward the blow: {}", m.aim);
        assert_eq!(m.pos, pos, "it did not walk or search");
        assert_ne!(m.ai.state, AiState::Search);
    }

    /// A hero it saw slips out of its cone: it looks (head and body) to where it was, and does not search.
    pub(crate) fn looks_to_where_it_lost_a_hero(boss: BossId) {
        let (mut run, bi) = arena(boss, 0.0, Vec2::new(100.0, 0.0));
        steps(&mut run, 0.3);
        assert!(run.monsters[bi].ai.target.is_some(), "it sees the hero");
        let at = run.monsters[bi].pos;
        run.players[0].mv.x = at.x - 100.0; // behind it, out of the cone
        run.players[0].mv.y = at.y;
        run.step();
        let ai = &run.monsters[bi].ai;
        assert!(ai.target.is_none());
        assert_eq!(ai.state, AiState::Look);
        assert!(ai.glance.is_some_and(|g| g.body), "head and body look to where it was");
        assert!(ai.search.is_none(), "a boss never searches");
    }
}
