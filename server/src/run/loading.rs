//! The hold at the start of a run (#322): the run waits until every client has built the level, so nobody
//! plays (or is hurt) behind a loading screen. A hero that is too slow starts `Neutral` and safe.

use super::targets::Side;
use super::Run;
use crate::protocol::ServerMsg;

/// Seconds the run waits for the slowest client before it starts without it.
pub const LOAD_TIMEOUT_S: f64 = 60.0;

impl Run {
    /// Every connected hero must report `Loaded` before the run goes on.
    pub fn begin_loading(&mut self) {
        for p in self.players.iter_mut().filter(|p| p.tx.is_some()) {
            p.loading = true;
        }
        self.waiting = true;
    }

    /// True when the hold ends: every connected hero has loaded, or `waited_s` reached `LOAD_TIMEOUT_S` and at least one
    /// has (with nobody loaded the hold goes on until the first `Loaded`: a run with no hero in it would end in defeat at once).
    pub fn hold_over(&self, waited_s: f64) -> bool {
        let mut heroes = self.players.iter().filter(|p| p.tx.is_some());
        self.waiting && (heroes.clone().all(|p| !p.loading) || (waited_s >= LOAD_TIMEOUT_S && heroes.any(|p| !p.loading)))
    }

    /// Ends the hold: loaded heroes start; a slow hero stays `Neutral` (monsters ignore it) until its `Loaded`.
    pub fn release(&mut self) {
        self.waiting = false;
        for pi in 0..self.players.len() {
            if self.players[pi].tx.is_none() {
                continue;
            }
            if self.players[pi].loading {
                self.players[pi].side = Side::Neutral;
            } else {
                self.send(&self.players[pi], &ServerMsg::RunBegins);
            }
        }
    }

    pub(super) fn loaded(&mut self, pi: usize) {
        if !self.players[pi].loading {
            return;
        }
        self.players[pi].loading = false;
        if self.waiting {
            self.send_loading();
        } else {
            self.players[pi].side = Side::Friendly;
            self.send(&self.players[pi], &ServerMsg::RunBegins);
        }
    }

    pub(super) fn send_loading(&self) {
        let heroes = || self.players.iter().filter(|p| p.tx.is_some());
        let msg = ServerMsg::Loading { ready: heroes().filter(|p| !p.loading).count() as u8, total: heroes().count() as u8 };
        for p in heroes() {
            self.send(p, &msg);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::Vec2;
    use crate::protocol::{BossId, ClassId, ClientMsg, InputMsg};
    use crate::defs::enemies::EnemyType;
    use crate::run::effects::Creature;
    use crate::run::tests::{test_run, without_neutrals};
    use crate::run::RunCmd;

    fn send(run: &mut Run, pi: usize, msg: ClientMsg) {
        let conn = run.players[pi].conn;
        run.handle(RunCmd::Msg { conn, msg });
    }

    fn two() -> Run {
        test_run(&[ClassId::Paladin, ClassId::Wizard], BossId::FireDemon)
    }

    #[test]
    fn the_hold_waits_for_every_client() {
        let mut run = two();
        run.begin_loading();
        assert!(!run.hold_over(1.0));
        send(&mut run, 0, ClientMsg::Loaded);
        assert!(!run.hold_over(1.0));
        send(&mut run, 1, ClientMsg::Loaded);
        assert!(run.hold_over(1.0));
        run.release();
        assert!(run.players.iter().all(|p| p.side == Side::Friendly && !p.loading));
        assert!(!run.waiting);
    }

    #[test]
    fn inputs_are_dropped_while_loading() {
        let mut run = two();
        run.begin_loading();
        send(&mut run, 0, ClientMsg::Input(InputMsg { seq: 1, ..Default::default() }));
        assert!(run.players[0].inputs.is_empty());
        send(&mut run, 0, ClientMsg::Loaded);
        send(&mut run, 1, ClientMsg::Loaded);
        run.release();
        send(&mut run, 0, ClientMsg::Input(InputMsg { seq: 1, ..Default::default() }));
        assert_eq!(run.players[0].inputs.len(), 1);
    }

    #[test]
    fn a_leave_during_the_hold_counts() {
        let mut run = two();
        run.begin_loading();
        let conn = run.players[1].conn;
        run.handle(RunCmd::Leave { conn });
        send(&mut run, 0, ClientMsg::Loaded);
        assert!(run.hold_over(0.0));
    }

    #[test]
    fn the_timeout_starts_without_the_slow_hero() {
        let mut run = two();
        run.begin_loading();
        assert!(!run.hold_over(LOAD_TIMEOUT_S - 0.1));
        send(&mut run, 0, ClientMsg::Loaded);
        assert!(!run.hold_over(LOAD_TIMEOUT_S - 0.1));
        assert!(run.hold_over(LOAD_TIMEOUT_S));
        run.release();
        assert_eq!(run.players[1].side, Side::Neutral);
        assert!(run.players[1].loading);
        assert_eq!(run.players[0].side, Side::Friendly);
    }

    #[test]
    fn with_nobody_loaded_the_hold_goes_on_past_the_timeout() {
        let mut run = two();
        run.begin_loading();
        assert!(!run.hold_over(LOAD_TIMEOUT_S));
        assert!(!run.hold_over(10.0 * LOAD_TIMEOUT_S));
        send(&mut run, 1, ClientMsg::Loaded);
        assert!(run.hold_over(10.0 * LOAD_TIMEOUT_S));
    }

    #[test]
    fn a_slow_hero_does_not_keep_a_dead_party_alive() {
        let mut run = two();
        run.begin_loading();
        send(&mut run, 0, ClientMsg::Loaded);
        run.release();
        run.step();
        assert!(run.ended.is_none());
        run.players[0].alive = false;
        run.step();
        assert_eq!(run.ended.map(|e| e.0), Some(false));
    }

    #[test]
    fn a_slow_hero_is_safe_until_loaded() {
        let mut run = two();
        run.begin_loading();
        send(&mut run, 0, ClientMsg::Loaded);
        run.release();
        without_neutrals(&mut run);
        crate::run::ai::tests::open_floor(&mut run);
        let here = run.players[1].pos();
        run.players[0].mv.x = here.x + 900.0;
        let id = run.spawn_enemy(EnemyType::SkeletonWarrior, here + Vec2::new(20.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        crate::run::tests::face(&mut run, mi, here);
        let hp = run.players[1].hp;
        for _ in 0..200 {
            run.step();
        }
        assert_eq!(run.players[1].hp, hp);
        assert_ne!(crate::run::ai::find_visible_foe(&run, mi), Some(Creature::Player(1)));
        send(&mut run, 1, ClientMsg::Loaded);
        assert_eq!(run.players[1].side, Side::Friendly);
        assert!(!run.players[1].loading);
        crate::run::tests::face(&mut run, mi, here); // it has wandered off its watch meanwhile
        for _ in 0..200 {
            run.step();
        }
        assert!(run.players[1].hp < hp);
    }

    #[test]
    fn a_slow_hero_is_not_hurt_or_pushed_by_a_barrel_blast() {
        let mut run = two();
        run.begin_loading();
        send(&mut run, 0, ClientMsg::Loaded);
        run.release();
        without_neutrals(&mut run);
        crate::run::ai::tests::open_floor(&mut run);
        let (pos, hp) = (run.players[1].pos(), run.players[1].hp);
        run.spawn_object(crate::defs::kinds::EntityKind::Barrel, pos + Vec2::new(20.0, 0.0), crate::run::objects::ObjState::Barrel(crate::run::objects::Barrel::new()));
        let oi = run.objects.len() - 1;
        crate::run::objects::explode_barrel(&mut run, oi);
        run.step();
        assert_eq!(run.players[1].hp, hp);
        assert_eq!(run.players[1].pos(), pos);
    }

    #[test]
    fn all_left_during_the_hold_ends_the_run() {
        let mut run = two();
        run.begin_loading();
        for pi in 0..2 {
            let conn = run.players[pi].conn;
            run.handle(RunCmd::Leave { conn });
        }
        assert!(run.players.iter().all(|p| p.tx.is_none()));
    }
}
