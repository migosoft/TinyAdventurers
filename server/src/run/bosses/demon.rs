//! Bat-winged red demon: cleave, swoop charge, ring of fire; enrages below 40% HP.

use super::{boss_idx, players_in, set_anim, target, BossBehaviour};
use crate::defs::kinds::{Anim, EntityKind};
use crate::math::Vec2;
use crate::run::abilities::spawn_monster_projectile;
use crate::run::ai::move_toward;
use crate::run::Run;

#[derive(Clone, Copy, PartialEq)]
enum Action {
    Cleave,
    SwoopWindup,
    Swoop,
    Ring,
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
        let rate = if self.enraged { 1.0 / 0.6 } else { 1.0 };
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
                    for pi in players_in(run, pos, run.monsters[bi].radius + 8.0, None) {
                        let id = run.players[pi].id;
                        if !self.swoop_hit.contains(&id) {
                            self.swoop_hit.push(id);
                            run.hurt_player(pi, 30.0);
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
                    set_anim(run, bi, Anim::Melee);
                    for pi in players_in(run, pos, CLEAVE_RANGE + 6.0, Some((aim, 1.05))) {
                        run.hurt_player(pi, 25.0);
                    }
                }
                Action::SwoopWindup => {
                    self.swoop_hit.clear();
                    self.action = Some((Action::Swoop, 0.55));
                    set_anim(run, bi, Anim::Dash);
                }
                Action::Ring => {
                    set_anim(run, bi, Anim::Cast);
                    let id = run.monsters[bi].id;
                    for k in 0..16 {
                        let dir = Vec2::from_angle(k as f64 * std::f64::consts::TAU / 16.0 + run.time);
                        spawn_monster_projectile(run, id, EntityKind::FireOrb, pos + dir * 10.0, dir, 105.0, 12.0, 2.2, 0.0, 0);
                    }
                    run.event(crate::protocol::Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: 30.0, k: 2 }, Some(pos));
                }
                Action::Swoop => set_anim(run, bi, Anim::Idle),
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
            self.action = Some((Action::Ring, 0.5));
            set_anim(run, bi, Anim::Windup);
        } else if self.swoop_cd <= 0.0 && dist > 50.0 {
            self.swoop_cd = 6.0;
            self.swoop_dir = (ppos - pos).norm();
            self.action = Some((Action::SwoopWindup, 0.6));
            set_anim(run, bi, Anim::Windup);
        } else if dist <= CLEAVE_RANGE && self.cleave_cd <= 0.0 {
            self.cleave_cd = 1.6;
            self.action = Some((Action::Cleave, 0.45));
            set_anim(run, bi, Anim::Windup);
        } else if dist > CLEAVE_RANGE * 0.8 {
            move_toward(run, bi, ppos, speed, dt);
            set_anim(run, bi, Anim::Move);
        } else {
            set_anim(run, bi, Anim::Idle);
        }
    }
}
