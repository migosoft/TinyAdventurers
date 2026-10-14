//! Horned red demon: cleave, swoop (a charge on foot), ring of fire; enrages below 40% HP.
//! Each attack's animation starts with its wind-up and runs on through a short
//! recovery, so the client plays wind-up, strike and recovery frames.

use crate::run::objects::hurt_objects_in;
use super::{boss_idx, players_in, set_anim, target, BossBehaviour};
use crate::defs::bosses::{DEMON_CLEAVE_KNOCK, DEMON_CLEAVE_RECOVER, DEMON_CLEAVE_WINDUP, DEMON_ENRAGED_PACE, DEMON_RING_RECOVER, DEMON_RING_WINDUP, DEMON_SWOOP_KNOCK, DEMON_SWOOP_RECOVER, DEMON_SWOOP_TIME, DEMON_SWOOP_WINDUP};
use crate::defs::damage::Damage;
use crate::defs::kinds::{Anim, EntityKind};
use crate::math::Vec2;
use crate::run::abilities::spawn_monster_projectile;
use crate::run::ai::{move_toward, path_toward};
use crate::run::Run;

#[derive(Clone, Copy, PartialEq)]
enum Action {
    Cleave,
    SwoopWindup,
    Swoop,
    Ring,
    /// The strike frames play out; the animation set at the wind-up keeps running.
    Recover,
}

pub struct Demon {
    cleave_cd: f64,
    swoop_cd: f64,
    ring_cd: f64,
    action: Option<(Action, f64)>,
    swoop_dir: Vec2,
    swoop_hit: Vec<u32>,
    enraged: bool,
}

impl Default for Demon {
    fn default() -> Self {
        Demon { cleave_cd: 1.0, swoop_cd: 4.0, ring_cd: 7.0, action: None, swoop_dir: Vec2::ZERO, swoop_hit: Vec::new(), enraged: false }
    }
}

const CLEAVE_RANGE: f64 = 34.0;

impl BossBehaviour for Demon {
    fn enraged(&self) -> bool {
        self.enraged
    }

    fn tick(&mut self, run: &mut Run, dt: f64) {
        let Some(bi) = boss_idx(run) else { return };
        if !self.enraged && run.monsters[bi].hp < run.monsters[bi].max_hp * 0.4 {
            self.enraged = true;
            run.event(crate::protocol::Ev::Msg { text: "The demon is enraged!".into() }, None);
        }
        let rate = if self.enraged { 1.0 / DEMON_ENRAGED_PACE } else { 1.0 };
        let speed = run.monsters[bi].speed * if self.enraged { 1.3 } else { 1.0 };
        self.cleave_cd -= dt * rate;
        self.swoop_cd -= dt * rate;
        self.ring_cd -= dt * rate;
        let pos = run.monsters[bi].pos;

        if let Some((action, t)) = self.action {
            let t = t - dt * rate;
            match action {
                Action::Swoop => {
                    let to = pos + self.swoop_dir * 40.0;
                    move_toward(run, bi, to, 260.0, dt);
                    let pos = run.monsters[bi].pos;
                    let reach = run.monsters[bi].radius + 8.0;
                    hurt_objects_in(run, pos, reach, None, Damage::new(30.0, run.monsters[bi].melee));
                    for pi in players_in(run, pos, reach, None) {
                        let id = run.players[pi].id;
                        if !self.swoop_hit.contains(&id) {
                            self.swoop_hit.push(id);
                            run.hurt_player(pi, Damage::new(30.0, run.monsters[bi].melee));
                            run.knock_player(pi, pos, self.swoop_dir.angle(), DEMON_SWOOP_KNOCK);
                        }
                    }
                }
                _ => {}
            }
            if t > 0.0 {
                self.action = Some((action, t));
                return;
            }
            self.action = None;
            let aim = run.monsters[bi].aim;
            match action {
                Action::Cleave => {
                    hurt_objects_in(run, pos, CLEAVE_RANGE + 6.0, Some((aim, 1.05)), Damage::new(25.0, run.monsters[bi].melee));
                    for pi in players_in(run, pos, CLEAVE_RANGE + 6.0, Some((aim, 1.05))) {
                        run.hurt_player(pi, Damage::new(25.0, run.monsters[bi].melee));
                        run.knock_player(pi, pos, aim, DEMON_CLEAVE_KNOCK);
                    }
                    self.action = Some((Action::Recover, DEMON_CLEAVE_RECOVER));
                }
                Action::SwoopWindup => {
                    self.swoop_hit.clear();
                    self.action = Some((Action::Swoop, DEMON_SWOOP_TIME));
                }
                Action::Ring => {
                    let id = run.monsters[bi].id;
                    for k in 0..16 {
                        let dir = Vec2::from_angle(k as f64 * std::f64::consts::TAU / 16.0 + run.time);
                        spawn_monster_projectile(run, id, EntityKind::FireOrb, pos + dir * 10.0, dir, 105.0, 12.0, 2.2, 0.0, 0, 0.0);
                    }
                    run.event(crate::protocol::Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: 30.0, k: 2 }, Some(pos));
                    self.action = Some((Action::Recover, DEMON_RING_RECOVER));
                }
                Action::Swoop => self.action = Some((Action::Recover, DEMON_SWOOP_RECOVER)),
                Action::Recover => set_anim(run, bi, Anim::Idle),
            }
            return;
        }

        let Some((_pi, ppos, dist)) = target(run, bi) else {
            set_anim(run, bi, Anim::Idle);
            return;
        };
        let aim = pos.angle_to(ppos);
        run.monsters[bi].aim = aim;
        if self.ring_cd <= 0.0 {
            self.ring_cd = 9.0;
            self.action = Some((Action::Ring, DEMON_RING_WINDUP));
            set_anim(run, bi, Anim::Cast);
        } else if self.swoop_cd <= 0.0 && dist > 50.0 {
            self.swoop_cd = 6.0;
            self.swoop_dir = (ppos - pos).norm();
            self.action = Some((Action::SwoopWindup, DEMON_SWOOP_WINDUP));
            set_anim(run, bi, Anim::Dash);
        } else if dist <= CLEAVE_RANGE && self.cleave_cd <= 0.0 {
            self.cleave_cd = 1.6;
            self.action = Some((Action::Cleave, DEMON_CLEAVE_WINDUP));
            set_anim(run, bi, Anim::Melee);
        } else if dist > CLEAVE_RANGE * 0.8 {
            path_toward(run, bi, ppos, speed, dt);
            set_anim(run, bi, Anim::Move);
        } else {
            set_anim(run, bi, Anim::Idle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{BossId, ClassId};
    use crate::run::tests::test_run;
    use crate::run::DT;

    /// A demon run with one hero at `off` from the demon; only the attacks named ready.
    fn demon_with(off: Vec2, d: Demon) -> (Run, Demon, usize) {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        let bi = boss_idx(&run).unwrap();
        run.monsters[bi].asleep = false;
        let at = run.monsters[bi].pos;
        run.players[0].mv.x = at.x + off.x;
        run.players[0].mv.y = at.y + off.y;
        (run, d, bi)
    }

    fn ticks(run: &mut Run, d: &mut Demon, secs: f64) {
        for _ in 0..(secs / DT).ceil() as usize {
            d.tick(run, DT);
        }
    }

    const NONE_READY: Demon = Demon { cleave_cd: 99.0, swoop_cd: 99.0, ring_cd: 99.0, action: None, swoop_dir: Vec2::ZERO, swoop_hit: Vec::new(), enraged: false };

    #[test]
    fn the_cleave_lights_a_barrel_in_front() {
        use crate::run::objects::{Barrel, ObjState};
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.objects.retain(|o| o.kind != EntityKind::Barrel);
        let bi = boss_idx(&run).unwrap();
        run.monsters[bi].aim = 0.0;
        let pos = run.monsters[bi].pos;
        run.spawn_object(EntityKind::Barrel, pos + Vec2::new(CLEAVE_RANGE, 0.0), ObjState::Barrel(Barrel::new()));
        run.spawn_object(EntityKind::Barrel, pos + Vec2::new(-CLEAVE_RANGE, 0.0), ObjState::Barrel(Barrel::new()));
        let mut d = Demon { action: Some((Action::Cleave, DT / 2.0)), ..Demon::default() };
        d.tick(&mut run, DT);
        let lit: Vec<bool> = run.objects.iter().filter(|o| o.kind == EntityKind::Barrel).map(|o| matches!(&o.state, ObjState::Barrel(b) if b.fuse.is_some())).collect();
        assert_eq!(lit, vec![true, false], "in front, not behind");
    }

    #[test]
    fn the_cleave_animation_runs_from_the_wind_up_through_the_recovery() {
        let (mut run, mut d, bi) = demon_with(Vec2::new(20.0, 0.0), Demon { cleave_cd: 0.0, ..NONE_READY });
        let hp = run.players[0].hp;
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Melee, "the cleave animation starts with its wind-up");
        ticks(&mut run, &mut d, DEMON_CLEAVE_WINDUP + DT);
        assert!(run.players[0].hp < hp, "hit at the end of the wind-up");
        assert!(run.players[0].mv.knock_vx > 0.0, "pushed away");
        assert_eq!(run.monsters[bi].anim, Anim::Melee, "the strike frames play out");
        ticks(&mut run, &mut d, DEMON_CLEAVE_RECOVER + 3.0 * DT);
        assert_ne!(run.monsters[bi].anim, Anim::Melee, "back to idle or walking after the recovery");
    }

    #[test]
    fn the_swoop_keeps_its_dash_animation_from_the_wind_up_to_the_stop() {
        let (mut run, mut d, bi) = demon_with(Vec2::new(120.0, 0.0), Demon { swoop_cd: 0.0, ..NONE_READY });
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Dash);
        let start = run.monsters[bi].anim_start;
        ticks(&mut run, &mut d, DEMON_SWOOP_WINDUP + DEMON_SWOOP_TIME + DEMON_SWOOP_RECOVER - 3.0 * DT);
        assert_eq!(run.monsters[bi].anim, Anim::Dash);
        assert_eq!(run.monsters[bi].anim_start, start, "one animation, not restarted");
        ticks(&mut run, &mut d, 8.0 * DT);
        assert_ne!(run.monsters[bi].anim, Anim::Dash);
    }

    #[test]
    fn the_ring_of_fire_bursts_at_the_end_of_its_cast_wind_up() {
        let (mut run, mut d, bi) = demon_with(Vec2::new(60.0, 0.0), Demon { ring_cd: 0.0, ..NONE_READY });
        let orbs = |run: &Run| run.projectiles.iter().filter(|p| p.kind == EntityKind::FireOrb).count();
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Cast);
        ticks(&mut run, &mut d, DEMON_RING_WINDUP - 2.0 * DT);
        assert_eq!(orbs(&run), 0, "nothing during the wind-up");
        ticks(&mut run, &mut d, 3.0 * DT);
        assert_eq!(orbs(&run), 16);
        assert_eq!(run.monsters[bi].anim, Anim::Cast, "the burst frames play out");
    }

    #[test]
    fn enraged_the_wind_ups_are_shorter() {
        let (mut run, mut d, _) = demon_with(Vec2::new(20.0, 0.0), Demon { cleave_cd: 0.0, enraged: true, ..NONE_READY });
        let hp = run.players[0].hp;
        ticks(&mut run, &mut d, DEMON_CLEAVE_WINDUP * DEMON_ENRAGED_PACE + 2.0 * DT);
        assert!(run.players[0].hp < hp);
    }
}
