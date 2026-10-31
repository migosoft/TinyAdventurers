//! Red dragon: it casts the abilities of its kit and decides which, when and where to aim. Strike with its
//! claws, Bite straight ahead, Tail Whip against heroes behind it, Fire Breath, Fireball and, on landing,
//! Smash. Every 10-12 s it takes off and hovers after the party: melee cannot reach it then, and its
//! only attack is the breath. The numbers (damage, reach, push, wind-up, cooldown) are the kit's.
//!
//! An attack's animation starts with its wind-up (the client shows the wind-up pose, then the strike); the
//! script waits the ability's own wind-up (`kit.get(id).windup`) and casts it when that ends.

use super::{ahead, boss_idx, cast_in_pose, set_anim, target, BossBehaviour};
use crate::defs::abilities::AbilityId;
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::bosses::*;
use crate::defs::kinds::Anim;
use crate::math::angle_diff;
use crate::run::abilities::monster_cast;
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
    Fireball,
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
    /// Seconds until the next flight (on the ground) or of the current flight phase.
    flight_t: f64,
    flight: Flight,
    action: Option<(Action, f64)>,
    /// Seconds before the script may first choose each ability: when it opens, not how an ability works. It
    /// only gates the script's decision; the kit's cooldowns (`cds`) are the casts' alone.
    opening: Vec<(AbilityId, f64)>,
}

impl Default for Dragon {
    fn default() -> Self {
        Dragon { flight_t: DRAGON_FLIGHT_EVERY.0, flight: Flight::Ground, action: None, opening: OPENING.to_vec() }
    }
}

/// How long (s) after the fight starts each ability may first be cast: the dragon does not open with all of
/// them at once.
const OPENING: [(AbilityId, f64); 5] = [(AbilityId::FireBreath, 3.0), (AbilityId::TailWhip, 2.0), (AbilityId::Strike, 1.5), (AbilityId::Bite, 2.0), (AbilityId::Fireball, 6.0)];
/// Strike frames after the hit (s): claw and bite, tail whip, fireball.
const RECOVER_CLAW: f64 = 0.3;
const RECOVER_TAIL: f64 = 0.5;
const RECOVER_FIREBALL: f64 = 0.35;
/// How long (s) it stands in its cast pose before a Fireball leaves: the pose is animation, the ball has no wind-up.
const FIREBALL_POSE: f64 = 0.6;
/// How far inside its reach (px, centre distance) a hero must stand for a strike or the tail whip to start.
const STRIKE_SLACK: f64 = 4.0;
const TAIL_SLACK: f64 = 2.0;
/// Hovering, it does not chase heroes closer than this.
const HOVER_KEEP: f64 = 30.0;

/// Its kit's ability `id`.
fn kit(run: &Run, bi: usize, id: AbilityId) -> crate::sheet::ResolvedAbility {
    *run.monsters[bi].kit.get(id).expect("the dragon's kit has it")
}


impl Dragon {
    /// Is `id` off its opening delay and off cooldown?
    fn ready(&self, run: &Run, bi: usize, id: AbilityId) -> bool {
        run.monsters[bi].cds.ready(id) && self.opening.iter().all(|&(i, left)| i != id || left <= 0.0)
    }

    /// Starts an action whose animation (wind-up first) is `anim`.
    fn start(&mut self, run: &mut Run, bi: usize, action: Action, t: f64, anim: Anim) {
        self.action = Some((action, t));
        set_anim(run, bi, anim);
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
                    let at = ahead(run, bi);
                    monster_cast(run, bi, AbilityId::Smash, at);
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
        for (_, left) in &mut self.opening {
            *left -= dt;
        }
        if self.fly(run, bi, dt) {
            return;
        }
        let pos = run.monsters[bi].pos;
        let aim = run.monsters[bi].aim;
        let air = self.flight == Flight::Air;

        if let Some((action, t)) = self.action {
            let mut t = t - dt;
            // A breath whose channel ended early (the dragon was put to sleep) ends with it.
            if action == Action::Breath && run.monsters[bi].channel.is_none() {
                t = 0.0;
            }
            if t > 0.0 {
                self.action = Some((action, t));
                return;
            }
            self.action = None;
            match action {
                // The Breath animation already runs since the wind-up began; the cast starts the channel.
                Action::BreathWindup => {
                    let at = ahead(run, bi);
                    monster_cast(run, bi, AbilityId::FireBreath, at);
                    self.action = Some((Action::Breath, kit(run, bi, AbilityId::FireBreath).duration));
                }
                Action::Breath | Action::Recover => set_anim(run, bi, Anim::Idle),
                Action::Tail => {
                    cast_in_pose(run, bi, AbilityId::TailWhip, ahead(run, bi));
                    self.action = Some((Action::Recover, RECOVER_TAIL));
                }
                Action::Claw => {
                    cast_in_pose(run, bi, AbilityId::Strike, ahead(run, bi));
                    self.action = Some((Action::Recover, RECOVER_CLAW));
                }
                Action::Bite => {
                    cast_in_pose(run, bi, AbilityId::Bite, ahead(run, bi));
                    self.action = Some((Action::Recover, RECOVER_CLAW));
                }
                Action::Fireball => {
                    let at = target(run, bi).map_or_else(|| ahead(run, bi), |(_, ppos, _)| ppos);
                    monster_cast(run, bi, AbilityId::Fireball, at);
                    self.action = Some((Action::Recover, RECOVER_FIREBALL));
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
        let tail = kit(run, bi, AbilityId::TailWhip);
        // A kit range is measured to the target's edge: the centre distance adds the hero's radius.
        let someone_behind = run
            .players
            .iter()
            .any(|p| p.alive && p.pos().dist(pos) < tail.range + PLAYER_RADIUS - TAIL_SLACK && angle_diff(pos.angle_to(p.pos()), aim).abs() > 2.0);
        if !air && someone_behind && self.ready(run, bi, AbilityId::TailWhip) {
            self.start(run, bi, Action::Tail, tail.windup, Anim::Tail);
            return;
        }
        run.monsters[bi].aim = to_target;
        let (breath, bite, claw) = (kit(run, bi, AbilityId::FireBreath), kit(run, bi, AbilityId::Bite), kit(run, bi, AbilityId::Strike));
        if self.ready(run, bi, AbilityId::FireBreath) && dist < breath.range {
            self.start(run, bi, Action::BreathWindup, breath.windup, Anim::Breath);
        } else if air {
            // Flying: hover after the party.
            if dist > HOVER_KEEP {
                let speed = run.monsters[bi].speed;
                path_toward(run, bi, ppos, speed, dt);
                set_anim(run, bi, Anim::Move);
            } else {
                set_anim(run, bi, Anim::Idle);
            }
        } else if self.ready(run, bi, AbilityId::Bite) && dist <= bite.range + PLAYER_RADIUS - STRIKE_SLACK {
            self.start(run, bi, Action::Bite, bite.windup, Anim::Bite);
        } else if self.ready(run, bi, AbilityId::Strike) && dist <= claw.range + PLAYER_RADIUS - STRIKE_SLACK {
            self.start(run, bi, Action::Claw, claw.windup, Anim::Melee);
        } else if self.ready(run, bi, AbilityId::Fireball) {
            self.start(run, bi, Action::Fireball, FIREBALL_POSE, Anim::Windup);
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
    use crate::defs::abilities::{self as ab, Shape};
    use crate::defs::damage::What;
    use crate::defs::kinds::EntityKind;
    use crate::math::Vec2;
    use crate::protocol::{BossId, ClassId, Ev};
    use crate::run::abilities::tick_channel;
    use crate::run::tests::test_run;
    use crate::run::DT;

    /// A dragon run with heroes at `offs` from the dragon; only the abilities named are ready.
    fn dragon_with_ready(offs: &[Vec2], ready: &[AbilityId]) -> (Run, Dragon, usize) {
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
        for id in [AbilityId::Strike, AbilityId::Bite, AbilityId::TailWhip, AbilityId::FireBreath, AbilityId::Fireball] {
            if !ready.contains(&id) {
                run.monsters[bi].cds.start(id, 99.0);
            }
        }
        let d = Dragon { flight_t: 99.0, opening: Vec::new(), ..Dragon::default() };
        (run, d, bi)
    }

    /// A dragon run in which a bite and a claw are ready.
    fn dragon_with(offs: &[Vec2]) -> (Run, Dragon, usize) {
        dragon_with_ready(offs, &[AbilityId::Strike, AbilityId::Bite])
    }

    fn ticks(run: &mut Run, d: &mut Dragon, secs: f64) {
        for _ in 0..(secs / DT).ceil() as usize {
            d.tick(run, DT);
        }
    }

    fn windup(run: &Run, bi: usize, id: AbilityId) -> f64 {
        kit(run, bi, id).windup
    }

    #[test]
    fn bites_the_hero_in_front_first_then_claws() {
        let (mut run, mut d, bi) = dragon_with(&[Vec2::new(30.0, 0.0)]);
        let hp = run.players[0].hp;
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Bite, "the bite animation starts with its wind-up");
        let w = windup(&run, bi, AbilityId::Bite);
        ticks(&mut run, &mut d, w + DT);
        assert!(run.players[0].hp < hp, "bitten");
        assert_eq!(run.last_hit.expect("a hit").why.what, What::Ability(AbilityId::Bite));
        assert!(run.players[0].mv.knock_vx > 0.0, "pushed away");
        assert_eq!(run.monsters[bi].anim, Anim::Bite, "the strike frames play out");

        let (mut run, mut d, bi) = dragon_with(&[Vec2::new(30.0, 0.0)]);
        run.monsters[bi].cds.start(AbilityId::Bite, 1.0);
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Melee, "bite not ready: claw");
    }

    #[test]
    fn the_bite_starts_at_todays_distance_from_a_hero() {
        // Today's bite: it starts within 46 - 4 px of the hero's centre, and not beyond.
        for (dist, starts) in [(42.0, true), (42.5, false)] {
            let (mut run, mut d, _) = dragon_with_ready(&[Vec2::new(dist, 0.0)], &[AbilityId::Bite]);
            d.tick(&mut run, DT);
            assert_eq!(d.action.map(|(a, _)| a) == Some(Action::Bite), starts, "{dist} px");
        }
        // And the hit reaches the 46 px of today.
        let (mut run, mut d, bi) = dragon_with_ready(&[Vec2::new(42.0, 0.0)], &[AbilityId::Bite]);
        let hp = run.players[0].hp;
        let w = windup(&run, bi, AbilityId::Bite);
        ticks(&mut run, &mut d, w + 2.0 * DT);
        assert!(run.players[0].hp < hp);
        let (mut run, _, bi) = dragon_with_ready(&[Vec2::new(46.0, 0.0), Vec2::new(47.0, 0.0)], &[AbilityId::Bite]);
        let hp: Vec<f64> = run.players.iter().map(|p| p.hp).collect();
        let at = ahead(&run, bi);
        assert!(monster_cast(&mut run, bi, AbilityId::Bite, at));
        assert!(run.players[0].hp < hp[0] && run.players[1].hp == hp[1], "reaches 46, not 47");
    }

    #[test]
    fn it_waits_its_opening_delay_without_touching_the_kits_cooldowns() {
        let (mut run, _, bi) = dragon_with(&[Vec2::new(30.0, 0.0)]);
        let all = [AbilityId::Strike, AbilityId::Bite, AbilityId::TailWhip, AbilityId::FireBreath, AbilityId::Fireball];
        for id in all {
            run.monsters[bi].cds.tick(100.0);
            assert!(run.monsters[bi].cds.ready(id), "{id:?}: the kit's cooldowns start empty");
        }
        let mut d = Dragon { flight_t: 99.0, ..Dragon::default() };
        ticks(&mut run, &mut d, 1.4);
        assert!(d.action.is_none(), "nothing before the first opening delay");
        assert!(all.iter().all(|&id| run.monsters[bi].cds.ready(id)), "the script left the cooldowns alone");
        ticks(&mut run, &mut d, 0.3);
        assert_eq!(d.action.map(|(a, _)| a), Some(Action::Claw), "the claw opens at 1.5 s, the bite only at 2 s");
    }

    #[test]
    fn the_claw_strikes_with_strike() {
        let (mut run, mut d, bi) = dragon_with_ready(&[Vec2::new(30.0, 0.0)], &[AbilityId::Strike]);
        let hp = run.players[0].hp;
        let w = windup(&run, bi, AbilityId::Strike);
        ticks(&mut run, &mut d, w + 2.0 * DT);
        assert!(run.players[0].hp < hp);
        assert_eq!(run.last_hit.expect("a hit").why.what, What::Ability(AbilityId::Strike));
    }

    #[test]
    fn the_bite_only_hits_straight_ahead() {
        let off = Vec2::from_angle(0.9) * 35.0;
        let (mut run, mut d, bi) = dragon_with(&[Vec2::new(30.0, 0.0), off]);
        let hp = run.players[1].hp;
        let w = windup(&run, bi, AbilityId::Bite);
        ticks(&mut run, &mut d, w + DT);
        assert_eq!(run.players[1].hp, hp, "the hero off to the side is spared");
    }

    #[test]
    fn the_tail_whip_hits_behind_only() {
        // One hero behind the dragon (it faces east), one in front and close.
        let (mut run, mut d, bi) = dragon_with_ready(&[Vec2::new(-30.0, 0.0), Vec2::new(30.0, 0.0)], &[AbilityId::TailWhip]);
        let hp: Vec<f64> = run.players.iter().map(|p| p.hp).collect();
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Tail, "the whip starts with its wind-up");
        let w = windup(&run, bi, AbilityId::TailWhip);
        ticks(&mut run, &mut d, w + DT);
        assert!(run.players[0].hp < hp[0], "the hero behind is lashed");
        assert_eq!(run.last_hit.expect("a hit").why.what, What::Ability(AbilityId::TailWhip));
        assert!(run.players[0].mv.knock_vx < 0.0, "and pushed away from the dragon");
        assert_eq!(run.players[1].hp, hp[1], "the hero in front is spared");
        assert_eq!(run.monsters[bi].aim, 0.0, "the dragon still faces east");
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
        assert_eq!(run.last_hit.expect("a hit").why.what, What::Ability(AbilityId::Smash));
        assert!(run.players[0].mv.knock_vx > 0.0, "and pushes away");
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Boom { k: 5, .. })), "shockwave event");
        assert!(d.flight_t >= DRAGON_FLIGHT_EVERY.0, "next flight in 10-12 s");
    }

    #[test]
    fn the_dragon_casts_the_wizards_fireball() {
        use crate::sheet::{resolve_ability, Body};
        let (mut run, mut d, bi) = dragon_with_ready(&[Vec2::new(90.0, 0.0)], &[AbilityId::Fireball]);
        run.events.clear();
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Windup, "it winds up in its cast pose");
        assert!(run.projectiles.is_empty());
        ticks(&mut run, &mut d, FIREBALL_POSE + DT);
        assert_eq!(run.projectiles.len(), 1, "one ball per cast");
        let ball = &run.projectiles[0];
        assert_eq!(ball.damage.why.what, What::Ability(AbilityId::Fireball));
        assert_eq!(ball.kind, EntityKind::DragonFireball, "the dragon's own ball");
        assert_eq!((ball.side, ball.explode_k), (crate::run::targets::Side::Monsters, 4));
        let attrs = run.monsters[bi].attrs;
        let expected = resolve_ability(&ab::def(AbilityId::Fireball), &attrs, &[], Body { radius: 17.0 }).unwrap();
        assert!((ball.damage.amount - expected.damage).abs() < 1e-9);
        assert!((ball.damage.amount - 46.8).abs() < 1e-9, "45 at INT 15, the dragon has INT 16: {}", ball.damage.amount);
        assert_eq!(ball.push, ab::FIREBALL_PUSH);
        assert!(!run.monsters[bi].cds.ready(AbilityId::Fireball), "the kit's cooldown runs");
        // It flies to the hero and bursts there, pushing and hurting.
        let hp = run.players[0].hp;
        for _ in 0..(3.0 / DT) as usize {
            crate::run::abilities::tick_projectiles(&mut run, DT);
        }
        assert!(run.players[0].hp < hp, "the blast hurts");
        assert!(run.players[0].mv.knocked(), "and pushes");
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Boom { k: 4, .. })));
    }

    #[test]
    fn the_breath_is_heat() {
        use crate::defs::damage::{DamageType, Resistances};
        let breathe = |res: Resistances| {
            let (mut run, _, bi) = dragon_with_ready(&[Vec2::new(30.0, 0.0)], &[AbilityId::FireBreath]);
            run.players[0].res = res;
            let hp = run.players[0].hp;
            let at = ahead(&run, bi);
            assert!(monster_cast(&mut run, bi, AbilityId::FireBreath, at));
            tick_channel(&mut run, bi, DT);
            hp - run.players[0].hp
        };
        assert!((breathe(Resistances::NONE) - 6.0).abs() < 1e-9, "a pulse hurts");
        assert_eq!(breathe(Resistances::of(&[(DamageType::Heat, 1.0)])), 0.0, "heat resistance stops it");
    }

    #[test]
    fn the_breath_burns_in_its_cone_for_its_duration() {
        // One hero in the cone, one just outside its angle, one beyond its range.
        let (mut run, mut d, bi) = dragon_with_ready(&[Vec2::new(60.0, 0.0), Vec2::from_angle(0.6) * 70.0, Vec2::new(150.0, 0.0)], &[AbilityId::FireBreath]);
        assert_eq!(ab::def(AbilityId::FireBreath).shape, Shape::Breath);
        let hp: Vec<f64> = run.players.iter().map(|p| p.hp).collect();
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Breath, "the breath animation starts with its wind-up");
        let w = windup(&run, bi, AbilityId::FireBreath);
        ticks(&mut run, &mut d, w - 3.0 * DT);
        assert_eq!(run.players[0].hp, hp[0], "nothing burns during the wind-up");
        assert!(run.monsters[bi].channel.is_none());
        // The cast starts the channel; the run ticks it each step, as `Run::step` does.
        let mut steps = 0;
        let step = |run: &mut Run, d: &mut Dragon| {
            d.tick(run, DT);
            tick_channel(run, bi, DT);
        };
        while run.monsters[bi].channel.is_none() {
            step(&mut run, &mut d);
        }
        while run.monsters[bi].channel.is_some() {
            step(&mut run, &mut d);
            steps += 1;
            assert!(steps < 1000);
        }
        let duration = kit(&run, bi, AbilityId::FireBreath).duration;
        assert!((steps as f64 * DT - duration).abs() < 0.1, "it lasts its {duration} s: {steps} steps");
        assert!(run.players[0].hp < hp[0], "the hero in the cone burns");
        assert_eq!(run.last_hit.expect("a hit").why.what, What::Ability(AbilityId::FireBreath));
        assert_eq!(run.players[1].hp, hp[1], "outside the angle");
        assert_eq!(run.players[2].hp, hp[2], "beyond the range");
        // It ended: the dragon stands idle again and the cooldown runs.
        ticks(&mut run, &mut d, DT * 2.0);
        assert_eq!(run.monsters[bi].anim, Anim::Idle);
        assert!(!run.monsters[bi].cds.ready(AbilityId::FireBreath));
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

    /// The dragon breathes once at its aim, and the first pulse lands.
    fn breathe_once(run: &mut Run, bi: usize) {
        let at = ahead(run, bi);
        assert!(monster_cast(run, bi, AbilityId::FireBreath, at));
        tick_channel(run, bi, DT);
    }

    #[test]
    fn the_breath_lights_a_barrel_in_its_cone() {
        let (mut run, _, bi) = dragon_with_ready(&[Vec2::new(0.0, 60.0)], &[AbilityId::FireBreath]);
        let oi = barrel_near(&mut run, bi, Vec2::new(40.0, 0.0));
        breathe_once(&mut run, bi);
        assert!(barrel_lit(&run, oi));
    }

    #[test]
    fn the_breath_spares_a_barrel_outside_its_cone() {
        let (mut run, _, bi) = dragon_with_ready(&[Vec2::new(0.0, 60.0)], &[AbilityId::FireBreath]);
        let oi = barrel_near(&mut run, bi, Vec2::new(0.0, -40.0));
        breathe_once(&mut run, bi);
        assert!(!barrel_lit(&run, oi));
    }

    #[test]
    fn the_smash_and_the_claw_light_barrels() {
        let (mut run, _, bi) = dragon_with(&[Vec2::new(0.0, 60.0)]);
        let oi = barrel_near(&mut run, bi, Vec2::new(-20.0, 0.0));
        let at = ahead(&run, bi);
        assert!(monster_cast(&mut run, bi, AbilityId::Smash, at));
        assert!(barrel_lit(&run, oi), "the smash");

        let (mut run, mut d, bi) = dragon_with(&[Vec2::new(0.0, 60.0)]);
        let oi = barrel_near(&mut run, bi, Vec2::new(30.0, 0.0));
        d.action = Some((Action::Claw, DT / 2.0));
        d.tick(&mut run, DT);
        assert!(barrel_lit(&run, oi), "the claw");
    }

    #[test]
    fn the_smash_spares_heroes_outside_its_radius() {
        let radius = ab::def(AbilityId::Smash).own.radius;
        let (mut run, _, bi) = dragon_with(&[Vec2::new(radius + 8.0, 0.0)]);
        let hp = run.players[0].hp;
        let at = ahead(&run, bi);
        assert!(monster_cast(&mut run, bi, AbilityId::Smash, at));
        assert_eq!(run.players[0].hp, hp);
        assert!(!run.players[0].mv.knocked());
    }

    #[test]
    fn the_breath_burns_at_the_dragons_cha() {
        use crate::defs::attributes::Attr;
        use crate::defs::effects::{def, scaled_secs, EffectKind};
        let (mut run, _, bi) = dragon_with_ready(&[Vec2::new(30.0, 0.0)], &[AbilityId::FireBreath]);
        assert_eq!(run.monsters[bi].attrs.get(Attr::Cha), 20);
        breathe_once(&mut run, bi);
        let left = run.players[0].effects.list().iter().find(|a| a.kind == EffectKind::Burning).map(|a| a.left);
        assert_eq!(left, Some(scaled_secs(def(EffectKind::Burning).duration, 20, 13)), "CHA 20 against the Paladin's CON 13");
    }
}
