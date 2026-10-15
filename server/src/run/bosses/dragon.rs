//! Red dragon: fire breath cone (leaves burning patches), a bite against the
//! hero straight in front of it, a claw swipe against heroes at its face, a
//! tail whip against heroes behind it, and fireball volleys. Every attack but
//! the breath pushes. Every 10-12 s it takes off and hovers after the party:
//! melee cannot reach it then, and its only attack is the breath. It lands
//! with a ground smash that pushes everyone around it away.
//!
//! An attack's animation starts with its wind-up (the client shows the
//! wind-up pose, then the strike); the hit lands at the end of the wind-up.

use crate::run::objects::{hurt_object, hurt_objects_in, objects_in};
use super::{boss_idx, players_in, set_anim, target, BossBehaviour};
use crate::defs::bosses::*;
use crate::defs::damage::{Damage, DamageSplit, DamageType};
use crate::defs::kinds::{Anim, EntityKind};
use crate::math::{angle_diff, Vec2};
use crate::protocol::Ev;
use crate::run::abilities::spawn_monster_projectile;
use crate::run::ai::path_toward;
use crate::run::Run;
use rand::Rng;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Action {
    BreathWindup,
    Breath,
    Tail,
    Claw,
    Bite,
    Volley,
    /// After a strike: the strike frames play out, the dragon stands still.
    Recover,
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Flight {
    Ground,
    TakeOff,
    Air,
    Land,
}

pub struct Dragon {
    breath_cd: f64,
    tail_cd: f64,
    claw_cd: f64,
    bite_cd: f64,
    volley_cd: f64,
    /// Seconds until the next flight (on the ground) or of the current flight phase.
    flight_t: f64,
    flight: Flight,
    action: Option<(Action, f64)>,
    pulse: f64,
}

impl Default for Dragon {
    fn default() -> Self {
        Dragon {
            breath_cd: 3.0,
            tail_cd: 2.0,
            claw_cd: 1.5,
            bite_cd: 2.0,
            volley_cd: 6.0,
            flight_t: DRAGON_FLIGHT_EVERY.0,
            flight: Flight::Ground,
            action: None,
            pulse: 0.0,
        }
    }
}

const BREATH_RANGE: f64 = 115.0;
const BREATH_HALF_ANGLE: f64 = 0.38;
/// Front claw: hits heroes within this centre distance in front of it.
const CLAW_RANGE: f64 = 40.0;
const CLAW_HALF_ANGLE: f64 = 0.8;
/// Strike frames after the hit (s): claw and bite, tail whip, volley.
const RECOVER_CLAW: f64 = 0.3;
const RECOVER_TAIL: f64 = 0.5;
const RECOVER_VOLLEY: f64 = 0.35;
/// Hovering, it does not chase heroes closer than this.
const HOVER_KEEP: f64 = 30.0;

impl Dragon {
    /// Starts an action whose animation (wind-up first) is `anim`.
    fn start(&mut self, run: &mut Run, bi: usize, action: Action, t: f64, anim: Anim) {
        self.action = Some((action, t));
        set_anim(run, bi, anim);
    }

    fn land_smash(run: &mut Run, bi: usize, pos: Vec2, aim: f64) {
        let r = DRAGON_SMASH_RADIUS;
        run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: r as f32, k: 5 }, Some(pos));
        hurt_objects_in(run, pos, r, None, Damage::new(DRAGON_SMASH_DAMAGE, run.monsters[bi].melee));
        for pi in players_in(run, pos, r, None) {
            run.hurt_player(pi, Damage::new(DRAGON_SMASH_DAMAGE, run.monsters[bi].melee));
            run.knock_player(pi, pos, aim, DRAGON_SMASH_KNOCK);
        }
    }

    /// Take-off, flight and landing; true while they take over the turn.
    fn fly(&mut self, run: &mut Run, bi: usize, dt: f64) -> bool {
        self.flight_t -= dt;
        match self.flight {
            Flight::Ground => {
                if self.flight_t > 0.0 || self.action.is_some() {
                    return false;
                }
                self.flight = Flight::TakeOff;
                self.flight_t = DRAGON_TAKEOFF;
                set_anim(run, bi, Anim::TakeOff);
                true
            }
            Flight::TakeOff => {
                if self.flight_t <= 0.0 {
                    self.flight = Flight::Air;
                    self.flight_t = DRAGON_FLIGHT;
                    run.monsters[bi].airborne = true;
                    set_anim(run, bi, Anim::Idle);
                }
                true
            }
            Flight::Air => {
                // Lands once the flight is over and a breath under way has ended.
                if self.flight_t > 0.0 || self.action.is_some() {
                    return false;
                }
                self.flight = Flight::Land;
                self.flight_t = DRAGON_LAND;
                set_anim(run, bi, Anim::Land);
                true
            }
            Flight::Land => {
                if self.flight_t <= 0.0 {
                    let (pos, aim) = (run.monsters[bi].pos, run.monsters[bi].aim);
                    Self::land_smash(run, bi, pos, aim);
                    run.monsters[bi].airborne = false;
                    self.flight = Flight::Ground;
                    self.flight_t = run.rng.gen_range(DRAGON_FLIGHT_EVERY.0..DRAGON_FLIGHT_EVERY.1);
                    set_anim(run, bi, Anim::Idle);
                }
                true
            }
        }
    }
}

impl BossBehaviour for Dragon {
    fn tick(&mut self, run: &mut Run, dt: f64) {
        let Some(bi) = boss_idx(run) else { return };
        self.breath_cd -= dt;
        self.tail_cd -= dt;
        self.claw_cd -= dt;
        self.bite_cd -= dt;
        self.volley_cd -= dt;
        if self.fly(run, bi, dt) {
            return;
        }
        let pos = run.monsters[bi].pos;
        let aim = run.monsters[bi].aim;
        let air = self.flight == Flight::Air;

        if let Some((action, t)) = self.action {
            let t = t - dt;
            if action == Action::Breath {
                // Damage pulses inside the cone; leave burning patches.
                self.pulse -= dt;
                if self.pulse <= 0.0 {
                    self.pulse = 0.2;
                    let breath = Damage::new(6.0, DamageSplit::pure(DamageType::Heat));
                    for pi in players_in(run, pos, BREATH_RANGE, Some((aim, BREATH_HALF_ANGLE))) {
                        if crate::collision::line_of_sight(&run.layout.map, pos, run.players[pi].pos()) {
                            run.hurt_player(pi, breath);
                        }
                    }
                    for oi in objects_in(run, pos, BREATH_RANGE, Some((aim, BREATH_HALF_ANGLE))) {
                        if crate::collision::line_of_sight(&run.layout.map, pos, run.objects[oi].pos) {
                            hurt_object(run, oi, breath, None);
                        }
                    }
                    if run.rng.gen_bool(0.5) {
                        let a = aim + run.rng.gen_range(-BREATH_HALF_ANGLE..BREATH_HALF_ANGLE);
                        let d = run.rng.gen_range(30.0..BREATH_RANGE);
                        let at = pos + Vec2::from_angle(a) * d;
                        if !run.layout.map.opaque_at(at) {
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
                // The Breath animation already runs since the wind-up began.
                Action::BreathWindup => {
                    self.action = Some((Action::Breath, DRAGON_BREATH_TIME));
                    self.pulse = 0.0;
                }
                Action::Breath | Action::Recover => set_anim(run, bi, Anim::Idle),
                Action::Tail => {
                    let behind = aim + std::f64::consts::PI;
                    hurt_objects_in(run, pos, 46.0, Some((behind, 1.2)), Damage::new(25.0, run.monsters[bi].melee));
                    for pi in players_in(run, pos, 46.0, Some((behind, 1.2))) {
                        run.hurt_player(pi, Damage::new(25.0, run.monsters[bi].melee));
                        run.knock_player(pi, pos, behind, DRAGON_TAIL_KNOCK);
                    }
                    self.action = Some((Action::Recover, RECOVER_TAIL));
                }
                Action::Claw => {
                    hurt_objects_in(run, pos, CLAW_RANGE, Some((aim, CLAW_HALF_ANGLE)), Damage::new(20.0, run.monsters[bi].melee));
                    for pi in players_in(run, pos, CLAW_RANGE, Some((aim, CLAW_HALF_ANGLE))) {
                        run.hurt_player(pi, Damage::new(20.0, run.monsters[bi].melee));
                        run.knock_player(pi, pos, aim, DRAGON_CLAW_KNOCK);
                    }
                    self.action = Some((Action::Recover, RECOVER_CLAW));
                }
                Action::Bite => {
                    hurt_objects_in(run, pos, DRAGON_BITE_RANGE, Some((aim, DRAGON_BITE_HALF_ANGLE)), Damage::new(DRAGON_BITE_DAMAGE, run.monsters[bi].melee));
                    for pi in players_in(run, pos, DRAGON_BITE_RANGE, Some((aim, DRAGON_BITE_HALF_ANGLE))) {
                        run.hurt_player(pi, Damage::new(DRAGON_BITE_DAMAGE, run.monsters[bi].melee));
                        run.knock_player(pi, pos, aim, DRAGON_BITE_KNOCK);
                    }
                    self.action = Some((Action::Recover, RECOVER_CLAW));
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
                        spawn_monster_projectile(run, id, EntityKind::DragonFireball, pos + dir * 16.0, dir, 120.0, 20.0, 2.5, 30.0, 4, DRAGON_FIREBALL_KNOCK);
                    }
                    self.action = Some((Action::Recover, RECOVER_VOLLEY));
                }
            }
            return;
        }

        let Some((_pi, ppos, dist)) = target(run, bi) else {
            set_anim(run, bi, Anim::Idle);
            return;
        };
        let to_target = pos.angle_to(ppos);
        // Tail whip when someone sneaks behind (not in the air).
        let someone_behind = run
            .players
            .iter()
            .any(|p| p.alive && p.pos().dist(pos) < 44.0 && angle_diff(pos.angle_to(p.pos()), aim).abs() > 2.0);
        if !air && someone_behind && self.tail_cd <= 0.0 {
            self.tail_cd = 3.0;
            self.start(run, bi, Action::Tail, DRAGON_TAIL_WINDUP, Anim::Tail);
            return;
        }
        run.monsters[bi].aim = to_target;
        if self.breath_cd <= 0.0 && dist < BREATH_RANGE {
            self.breath_cd = 6.5;
            self.start(run, bi, Action::BreathWindup, DRAGON_BREATH_WINDUP, Anim::Breath);
        } else if air {
            // Flying: hover after the party.
            if dist > HOVER_KEEP {
                let speed = run.monsters[bi].speed;
                path_toward(run, bi, ppos, speed, dt);
                set_anim(run, bi, Anim::Move);
            } else {
                set_anim(run, bi, Anim::Idle);
            }
        } else if self.bite_cd <= 0.0 && dist <= DRAGON_BITE_RANGE - 4.0 {
            self.bite_cd = DRAGON_BITE_COOLDOWN;
            self.start(run, bi, Action::Bite, DRAGON_BITE_WINDUP, Anim::Bite);
        } else if self.claw_cd <= 0.0 && dist <= CLAW_RANGE - 4.0 {
            self.claw_cd = 2.5;
            self.start(run, bi, Action::Claw, DRAGON_CLAW_WINDUP, Anim::Melee);
        } else if self.volley_cd <= 0.0 {
            self.volley_cd = 7.0;
            self.start(run, bi, Action::Volley, 0.6, Anim::Windup);
        } else if dist > 60.0 {
            let speed = run.monsters[bi].speed;
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

    /// A dragon run with heroes at `offs` from the dragon; only the attacks named ready.
    fn dragon_with(offs: &[Vec2]) -> (Run, Dragon, usize) {
        let classes = vec![ClassId::Paladin; offs.len()];
        let mut run = test_run(&classes, BossId::Dragon);
        let bi = boss_idx(&run).unwrap();
        run.monsters[bi].dormant = false;
        run.monsters[bi].aim = 0.0;
        let at = run.monsters[bi].pos;
        for (p, off) in run.players.iter_mut().zip(offs) {
            p.mv.x = at.x + off.x;
            p.mv.y = at.y + off.y;
        }
        let d = Dragon { breath_cd: 99.0, tail_cd: 99.0, claw_cd: 0.0, bite_cd: 0.0, volley_cd: 99.0, flight_t: 99.0, ..Dragon::default() };
        (run, d, bi)
    }

    fn ticks(run: &mut Run, d: &mut Dragon, secs: f64) {
        for _ in 0..(secs / DT).ceil() as usize {
            d.tick(run, DT);
        }
    }

    #[test]
    fn bites_the_hero_in_front_first_then_claws() {
        let (mut run, mut d, bi) = dragon_with(&[Vec2::new(30.0, 0.0)]);
        let hp = run.players[0].hp;
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Bite, "the bite animation starts with its wind-up");
        ticks(&mut run, &mut d, DRAGON_BITE_WINDUP + DT);
        assert!(run.players[0].hp < hp, "bitten");
        assert!(run.players[0].mv.knock_vx > 0.0, "pushed away");

        let (mut run, mut d, bi) = dragon_with(&[Vec2::new(30.0, 0.0)]);
        d.bite_cd = 1.0;
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Melee, "bite not ready: claw");
    }

    #[test]
    fn the_bite_only_hits_straight_ahead() {
        let off = Vec2::from_angle(0.9) * 35.0;
        let (mut run, mut d, _) = dragon_with(&[Vec2::new(30.0, 0.0), off]);
        let hp = run.players[1].hp;
        ticks(&mut run, &mut d, DRAGON_BITE_WINDUP + DT);
        assert_eq!(run.players[1].hp, hp, "the hero off to the side is spared");
    }

    #[test]
    fn takes_off_hovers_without_melee_and_lands_with_a_smash() {
        let (mut run, mut d, bi) = dragon_with(&[Vec2::new(20.0, 0.0)]);
        d.flight_t = 0.0;
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::TakeOff);
        ticks(&mut run, &mut d, DRAGON_TAKEOFF + DT);
        assert!(run.monsters[bi].airborne, "in the air after taking off");

        // In the air: no bite, claw or tail even with a hero right in front.
        let hp = run.players[0].hp;
        ticks(&mut run, &mut d, DRAGON_FLIGHT - 0.1);
        assert!(run.monsters[bi].airborne);
        assert_eq!(run.players[0].hp, hp, "no melee from the air");

        run.events.clear();
        ticks(&mut run, &mut d, 0.2);
        assert_eq!(run.monsters[bi].anim, Anim::Land);
        ticks(&mut run, &mut d, DRAGON_LAND + DT);
        assert!(!run.monsters[bi].airborne, "landed");
        assert!(run.players[0].hp < hp, "the landing smash hits");
        assert!(run.players[0].mv.knock_vx > 0.0, "and pushes away");
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Boom { k: 5, .. })), "shockwave event");
        assert!(d.flight_t >= DRAGON_FLIGHT_EVERY.0, "next flight in 10-12 s");
    }

    #[test]
    fn the_breath_is_heat() {
        use crate::defs::damage::Resistances;
        let breathe = |res: Resistances| {
            let (mut run, mut d, _) = dragon_with(&[Vec2::new(30.0, 0.0)]);
            run.players[0].res = res;
            let hp = run.players[0].hp;
            d.action = Some((Action::Breath, 1.0));
            d.pulse = 0.0;
            d.tick(&mut run, DT);
            hp - run.players[0].hp
        };
        assert!((breathe(Resistances::NONE) - 6.0).abs() < 1e-9, "a pulse hurts");
        assert_eq!(breathe(Resistances::of(&[(DamageType::Heat, 1.0)])), 0.0, "heat resistance stops it");
    }

    fn barrel_lit(run: &Run, oi: usize) -> bool {
        matches!(&run.objects[oi].state, crate::run::objects::ObjState::Barrel(b) if b.fuse.is_some())
    }

    /// A barrel at `off` from the dragon (the dungeon's own removed); its index.
    fn barrel_near(run: &mut Run, bi: usize, off: Vec2) -> usize {
        use crate::run::objects::{Barrel, ObjState};
        run.objects.retain(|o| o.kind != EntityKind::Barrel);
        let at = run.monsters[bi].pos + off;
        run.spawn_object(EntityKind::Barrel, at, ObjState::Barrel(Barrel::new()));
        run.objects.len() - 1
    }

    #[test]
    fn the_breath_lights_a_barrel_in_its_cone() {
        let (mut run, mut d, bi) = dragon_with(&[Vec2::new(0.0, 60.0)]);
        let oi = barrel_near(&mut run, bi, Vec2::new(40.0, 0.0));
        d.action = Some((Action::Breath, 1.0));
        d.pulse = 0.0;
        d.tick(&mut run, DT);
        assert!(barrel_lit(&run, oi));
    }

    #[test]
    fn the_breath_spares_a_barrel_outside_its_cone() {
        let (mut run, mut d, bi) = dragon_with(&[Vec2::new(0.0, 60.0)]);
        let oi = barrel_near(&mut run, bi, Vec2::new(0.0, -40.0));
        d.action = Some((Action::Breath, 1.0));
        d.pulse = 0.0;
        d.tick(&mut run, DT);
        assert!(!barrel_lit(&run, oi));
    }

    #[test]
    fn the_smash_and_the_claw_light_barrels() {
        let (mut run, _, bi) = dragon_with(&[Vec2::new(0.0, 60.0)]);
        let oi = barrel_near(&mut run, bi, Vec2::new(-20.0, 0.0));
        let pos = run.monsters[bi].pos;
        Dragon::land_smash(&mut run, bi, pos, 0.0);
        assert!(barrel_lit(&run, oi), "the smash");

        let (mut run, mut d, bi) = dragon_with(&[Vec2::new(0.0, 60.0)]);
        let oi = barrel_near(&mut run, bi, Vec2::new(30.0, 0.0));
        d.action = Some((Action::Claw, DT / 2.0));
        d.tick(&mut run, DT);
        assert!(barrel_lit(&run, oi), "the claw");
    }

    #[test]
    fn the_smash_spares_heroes_outside_its_radius() {
        let (mut run, _, bi) = dragon_with(&[Vec2::new(DRAGON_SMASH_RADIUS + 8.0, 0.0)]);
        let hp = run.players[0].hp;
        let pos = run.monsters[bi].pos;
        Dragon::land_smash(&mut run, bi, pos, 0.0);
        assert_eq!(run.players[0].hp, hp);
        assert!(!run.players[0].mv.knocked());
    }
}
