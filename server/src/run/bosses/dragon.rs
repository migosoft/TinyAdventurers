//! Red dragon: fire breath cone (leaves burning patches), a claw swipe against
//! heroes at its face, a tail swipe against heroes behind it (both push), and
//! fireball volleys.

use super::{boss_idx, players_in, set_anim, target, BossBehaviour};
use crate::defs::kinds::{Anim, EntityKind};
use crate::math::{angle_diff, Vec2};
use crate::run::abilities::spawn_monster_projectile;
use crate::run::ai::path_toward;
use crate::run::Run;
use rand::Rng;

#[derive(Clone, Copy, PartialEq)]
enum Action {
    BreathWindup,
    Breath,
    Tail,
    Claw,
    Volley,
}

pub struct Dragon {
    breath_cd: f64,
    tail_cd: f64,
    claw_cd: f64,
    volley_cd: f64,
    action: Option<(Action, f64)>,
    pulse: f64,
}

impl Default for Dragon {
    fn default() -> Self {
        Dragon { breath_cd: 3.0, tail_cd: 2.0, claw_cd: 1.5, volley_cd: 6.0, action: None, pulse: 0.0 }
    }
}

const BREATH_RANGE: f64 = 115.0;
const BREATH_HALF_ANGLE: f64 = 0.38;
/// Front claw: hits heroes within this centre distance in front of it.
const CLAW_RANGE: f64 = 40.0;
const CLAW_HALF_ANGLE: f64 = 0.8;
/// Knockback (px) of the claw and the tail swipe.
const CLAW_KNOCK: f64 = 32.0;
const TAIL_KNOCK: f64 = 44.0;

impl BossBehaviour for Dragon {
    fn tick(&mut self, run: &mut Run, dt: f64) {
        let Some(bi) = boss_idx(run) else { return };
        self.breath_cd -= dt;
        self.tail_cd -= dt;
        self.claw_cd -= dt;
        self.volley_cd -= dt;
        let pos = run.monsters[bi].pos;
        let aim = run.monsters[bi].aim;

        if let Some((action, t)) = self.action {
            let t = t - dt;
            if action == Action::Breath {
                // Damage pulses inside the cone; leave burning patches.
                self.pulse -= dt;
                if self.pulse <= 0.0 {
                    self.pulse = 0.2;
                    for pi in players_in(run, pos, BREATH_RANGE, Some((aim, BREATH_HALF_ANGLE))) {
                        if crate::collision::line_of_sight(&run.dungeon.map, pos, run.players[pi].pos()) {
                            run.hurt_player(pi, 6.0);
                        }
                    }
                    if run.rng.gen_bool(0.5) {
                        let a = aim + run.rng.gen_range(-BREATH_HALF_ANGLE..BREATH_HALF_ANGLE);
                        let d = run.rng.gen_range(30.0..BREATH_RANGE);
                        let at = pos + Vec2::from_angle(a) * d;
                        if !run.dungeon.map.opaque_at(at) {
                            run.spawn_hazard(EntityKind::FirePatch, at, 10.0, 3.0, 8.0);
                        }
                    }
                }
            }
            if t > 0.0 {
                self.action = Some((action, t));
                return;
            }
            self.action = None;
            match action {
                Action::BreathWindup => {
                    self.action = Some((Action::Breath, 1.4));
                    self.pulse = 0.0;
                    set_anim(run, bi, Anim::Breath);
                }
                Action::Breath => set_anim(run, bi, Anim::Idle),
                Action::Tail => {
                    set_anim(run, bi, Anim::Tail);
                    let behind = aim + std::f64::consts::PI;
                    for pi in players_in(run, pos, 46.0, Some((behind, 1.2))) {
                        run.hurt_player(pi, 25.0);
                        run.knock_player(pi, pos, behind, TAIL_KNOCK);
                    }
                }
                Action::Claw => {
                    set_anim(run, bi, Anim::Melee);
                    for pi in players_in(run, pos, CLAW_RANGE, Some((aim, CLAW_HALF_ANGLE))) {
                        run.hurt_player(pi, 20.0);
                        run.knock_player(pi, pos, aim, CLAW_KNOCK);
                    }
                }
                Action::Volley => {
                    set_anim(run, bi, Anim::Cast);
                    let id = run.monsters[bi].id;
                    let targets: Vec<Vec2> = run.players.iter().filter(|p| p.alive).map(|p| p.pos()).collect();
                    for k in 0..3 {
                        if targets.is_empty() {
                            break;
                        }
                        let tp = targets[k % targets.len()];
                        let dir = (tp - pos).norm();
                        let dir = Vec2::from_angle(dir.angle() + (k as f64 - 1.0) * 0.12);
                        spawn_monster_projectile(run, id, EntityKind::DragonFireball, pos + dir * 16.0, dir, 120.0, 20.0, 2.5, 30.0, 4);
                    }
                }
            }
            return;
        }

        let Some((_pi, ppos, dist)) = target(run, bi) else {
            set_anim(run, bi, Anim::Idle);
            return;
        };
        let to_target = pos.angle_to(ppos);
        // Tail swipe when someone sneaks behind.
        let someone_behind = run
            .players
            .iter()
            .any(|p| p.alive && p.pos().dist(pos) < 44.0 && angle_diff(pos.angle_to(p.pos()), aim).abs() > 2.0);
        if someone_behind && self.tail_cd <= 0.0 {
            self.tail_cd = 3.0;
            self.action = Some((Action::Tail, 0.4));
            set_anim(run, bi, Anim::Windup);
            return;
        }
        run.monsters[bi].aim = to_target;
        if self.breath_cd <= 0.0 && dist < BREATH_RANGE {
            self.breath_cd = 6.5;
            self.action = Some((Action::BreathWindup, 0.8));
            set_anim(run, bi, Anim::Windup);
        } else if self.claw_cd <= 0.0 && dist <= CLAW_RANGE - 4.0 {
            self.claw_cd = 2.5;
            self.action = Some((Action::Claw, 0.4));
            set_anim(run, bi, Anim::Windup);
        } else if self.volley_cd <= 0.0 {
            self.volley_cd = 7.0;
            self.action = Some((Action::Volley, 0.6));
            set_anim(run, bi, Anim::Windup);
        } else if dist > 60.0 {
            let speed = run.monsters[bi].speed;
            path_toward(run, bi, ppos, speed, dt);
            set_anim(run, bi, Anim::Move);
        } else {
            set_anim(run, bi, Anim::Idle);
        }
    }
}
