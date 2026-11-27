//! Horned red demon: it uses the abilities of its kit and decides which, when and where to aim. Strike with
//! its claws, Cleave with its scimitar (from 3 s), Swoop (a charge on foot), Ring of Fire, Tail Whip against heroes behind it,
//! Fireball, Fire Breath and, on landing, Smash (the ice demon's twins: Frost Ball, Frost Breath, Ring of Frost, asked
//! by role: `breath`, `ball`, `ring`). Among the attacks it can use it picks at random; the tail
//! goes first when a foe is behind. Every 10-14 s it takes off and hovers after the party: only the ball and
//! the breath then. The numbers (damage, reach, push, wind-up, cooldown) are the kit's. Each attack's
//! animation starts with its wind-up and runs on through a short recovery, so the client plays wind-up,
//! strike and recovery frames.

use super::flight::{Flight, FlightTimes};
use super::{ahead, boss_idx, face_for, foe_behind, kit, ready, set_anim, target, use_in_pose, BossBehaviour};
use crate::defs::abilities::AbilityId;
use crate::defs::bosses::*;
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::kinds::Anim;
use crate::math::Vec2;
use crate::run::abilities::{announce_cast, tick_monster_dash};
use crate::run::ai::path_toward;
use crate::run::effects::Creature;
use crate::run::Run;
use rand::Rng;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Action {
    Claw,
    Scimitar,
    Tail,
    SwoopWindup,
    /// The dash runs (`Monster.dash`) until it ends.
    Swoop,
    /// Fireball or Ring of Fire: the pointing pose, then the release.
    Cast(AbilityId),
    BreathWindup,
    /// The channel runs until its time is up or it ends early.
    Breath,
    /// The strike frames play out; the animation set at the wind-up keeps running.
    Recover,
}

pub struct Demon {
    flight: Flight,
    action: Option<(Action, f64)>,
    swoop_dir: Vec2,
    /// Seconds before the script may first choose each ability: when it opens, not how an ability works. It
    /// only gates the script's decision; the kit's cooldowns (`cds`) are the uses' alone.
    opening: Vec<(AbilityId, f64)>,
    /// The kit's abilities in the three roles that differ between the fire and the ice demon.
    breath: AbilityId,
    ball: AbilityId,
    ring: AbilityId,
}

impl Demon {
    pub fn of(breath: AbilityId, ball: AbilityId, ring: AbilityId) -> Demon {
        Demon {
            flight: Flight::new(FlightTimes { takeoff: DEMON_TAKEOFF, air: DEMON_FLIGHT, land: DEMON_LAND, every: DEMON_FLIGHT_EVERY }, DEMON_FLIGHT_FIRST),
            action: None,
            swoop_dir: Vec2::ZERO,
            // How long (s) after the fight starts each ability may first be used.
            opening: vec![
                (AbilityId::Strike, 1.0),
                (AbilityId::Cleave, 3.0),
                (AbilityId::TailWhip, 2.0),
                (AbilityId::Swoop, 4.0),
                (ball, 5.0),
                (breath, 6.0),
                (ring, 7.0),
            ],
            breath,
            ball,
            ring,
        }
    }
}
/// How far (px, centre distance) a hero must be for the swoop to start.
const SWOOP_FROM: f64 = 50.0;
/// The claws and the scimitar start this far (px) inside their reach, like the enemies' swings.
const CLAW_SLACK: f64 = 6.0;
/// The tail whip starts this far (px) inside its reach.
const TAIL_SLACK: f64 = 2.0;
/// Hovering, it does not chase heroes closer than this.
const HOVER_KEEP: f64 = 30.0;

impl Demon {
    /// Starts an attack: its animation (wind-up first) is `anim`, the wind-up is announced.
    fn start(&mut self, run: &mut Run, bi: usize, action: Action, id: AbilityId, windup: f64, anim: Anim) {
        self.action = Some((action, windup));
        let aim = run.monsters[bi].aim;
        announce_cast(run, Creature::Monster(bi), id, windup, aim);
        set_anim(run, bi, anim);
    }
}

impl BossBehaviour for Demon {
    /// A wind-up or strike, or any part of the flight (take-off, flying, landing).
    fn busy(&self) -> bool {
        self.action.is_some() || !self.flight.grounded()
    }
    fn acting(&self) -> bool {
        self.action.is_some()
    }
    fn tick(&mut self, run: &mut Run, dt: f64) {
        let Some(bi) = boss_idx(run) else { return };
        let cdt = run.monsters[bi].effects.cooldown_dt(dt);
        for (_, left) in &mut self.opening {
            *left -= cdt;
        }
        if self.flight.tick(run, bi, dt, self.action.is_some()) {
            return;
        }
        let pos = run.monsters[bi].pos;
        let air = self.flight.in_air();

        if let Some((action, t)) = self.action {
            if action == Action::Swoop {
                // The dash is ticked here; it ends with its time (or if something cut it short).
                if run.monsters[bi].dash.is_none() || tick_monster_dash(run, bi, dt).is_some() {
                    self.action = Some((Action::Recover, DEMON_SWOOP_RECOVER));
                }
                return;
            }
            let mut t = t - dt;
            // A breath whose channel ended early (the demon was put to sleep) ends with it.
            if action == Action::Breath && run.monsters[bi].channel.is_none() {
                t = 0.0;
            }
            if t > 0.0 {
                self.action = Some((action, t));
                return;
            }
            self.action = None;
            match action {
                Action::Claw => {
                    use_in_pose(run, bi, AbilityId::Strike, ahead(run, bi));
                    self.action = Some((Action::Recover, DEMON_CLAW_RECOVER));
                }
                Action::Scimitar => {
                    use_in_pose(run, bi, AbilityId::Cleave, ahead(run, bi));
                    self.action = Some((Action::Recover, DEMON_SCIMITAR_RECOVER));
                }
                Action::Tail => {
                    use_in_pose(run, bi, AbilityId::TailWhip, ahead(run, bi));
                    self.action = Some((Action::Recover, DEMON_TAIL_RECOVER));
                }
                Action::SwoopWindup => {
                    use_in_pose(run, bi, AbilityId::Swoop, pos + self.swoop_dir * 30.0);
                    self.action = Some((Action::Swoop, 0.0));
                }
                Action::Cast(id) => {
                    let at = if id == self.ball { target(run, bi).map_or_else(|| ahead(run, bi), |(_, ppos, _)| ppos) } else { ahead(run, bi) };
                    use_in_pose(run, bi, id, at);
                    self.action = Some((Action::Recover, DEMON_CAST_RECOVER));
                }
                Action::BreathWindup => {
                    use_in_pose(run, bi, self.breath, ahead(run, bi));
                    self.action = Some((Action::Breath, kit(run, bi, self.breath).duration));
                }
                Action::Breath | Action::Recover => set_anim(run, bi, Anim::Idle),
                Action::Swoop => {}
            }
            return;
        }

        // Tail whip when someone sneaks behind (not in the air), before turning to the target. It feels the foe
        // behind it, so it needs no sight of it.
        let tail = kit(run, bi, AbilityId::TailWhip);
        // A kit range is measured to the target's edge: the centre distance adds the hero's radius.
        if !air && foe_behind(run, bi, tail.range + PLAYER_RADIUS - TAIL_SLACK) && ready(run, bi, &self.opening, AbilityId::TailWhip) {
            self.start(run, bi, Action::Tail, AbilityId::TailWhip, tail.windup, Anim::Tail);
            return;
        }
        let Some((_pi, ppos, dist)) = target(run, bi) else {
            set_anim(run, bi, Anim::Idle);
            return;
        };
        let to_target = pos.angle_to(ppos);
        // The head follows the hero; the body turns only for an attack it wants to start.
        run.monsters[bi].look_to = Some(to_target);
        let claw_from = kit(run, bi, AbilityId::Strike).range + PLAYER_RADIUS - CLAW_SLACK;
        let scimitar_from = kit(run, bi, AbilityId::Cleave).range + PLAYER_RADIUS - CLAW_SLACK;
        let breath = kit(run, bi, self.breath);
        let usable = |id: AbilityId| ready(run, bi, &self.opening, id);
        let mut picks: Vec<AbilityId> = Vec::new();
        if !air && usable(AbilityId::Strike) && dist <= claw_from {
            picks.push(AbilityId::Strike);
        }
        if !air && usable(AbilityId::Cleave) && dist <= scimitar_from {
            picks.push(AbilityId::Cleave);
        }
        if !air && usable(AbilityId::Swoop) && dist > SWOOP_FROM {
            picks.push(AbilityId::Swoop);
        }
        if usable(self.breath) && dist < breath.range {
            picks.push(self.breath);
        }
        if usable(self.ball) {
            picks.push(self.ball);
        }
        if !air && usable(self.ring) {
            picks.push(self.ring);
        }
        picks.retain(|&id| face_for(run, bi, ppos, id));
        if !picks.is_empty() {
            let id = picks[run.rng.gen_range(0..picks.len())];
            let cast_time = kit(run, bi, self.ring).windup;
            match id {
                AbilityId::Strike => self.start(run, bi, Action::Claw, id, kit(run, bi, id).windup, Anim::Melee),
                AbilityId::Cleave => self.start(run, bi, Action::Scimitar, id, kit(run, bi, id).windup, Anim::Cleave),
                AbilityId::Swoop => {
                    self.swoop_dir = (ppos - pos).norm();
                    self.start(run, bi, Action::SwoopWindup, id, kit(run, bi, id).windup, Anim::Dash);
                }
                _ if id == self.breath => self.start(run, bi, Action::BreathWindup, id, breath.windup, Anim::Breath),
                _ if id == self.ball || id == self.ring => self.start(run, bi, Action::Cast(id), id, cast_time, Anim::Cast),
                other => unreachable!("the demon's pick has no start for {other:?}"),
            }
            return;
        }
        let walk = if air { dist > HOVER_KEEP } else { dist > claw_from * 0.8 };
        if walk {
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
    use crate::defs::abilities::{self as ab};
    use crate::defs::damage::What;
    use crate::defs::kinds::EntityKind;
    use crate::protocol::{BossId, ClassId, Ev};
    use crate::run::abilities::tick_channel;
    use crate::run::bosses::flight::Phase;
    use crate::run::tests::test_run;
    use crate::run::DT;
    use rand::SeedableRng;

    const SEVEN: [AbilityId; 7] = [AbilityId::Strike, AbilityId::Cleave, AbilityId::Swoop, AbilityId::RingOfFire, AbilityId::TailWhip, AbilityId::Fireball, AbilityId::FireBreath];

    /// A demon run with heroes at `offs` from the demon; only the abilities named are ready (of the six the
    /// script chooses from; Smash is the landing's), no opening waits, the first flight far away.
    fn demon_with_heroes(offs: &[Vec2], ready: &[AbilityId]) -> (Run, Demon, usize) {
        demon_run(BossId::FireDemon, offs, ready)
    }

    /// The same for the ice demon: its three role abilities are the cold ones.
    fn ice_demon_with_heroes(offs: &[Vec2], ready: &[AbilityId]) -> (Run, Demon, usize) {
        demon_run(BossId::IceDemon, offs, ready)
    }

    fn demon_run(boss: BossId, offs: &[Vec2], ready: &[AbilityId]) -> (Run, Demon, usize) {
        let classes = vec![ClassId::Paladin; offs.len()];
        let mut run = test_run(&classes, boss);
        let bi = boss_idx(&run).unwrap();
        run.monsters[bi].dormant = false;
        run.monsters[bi].aim = 0.0;
        let at = run.monsters[bi].pos;
        for (p, off) in run.players.iter_mut().zip(offs) {
            p.mv.x = at.x + off.x;
            p.mv.y = at.y + off.y;
        }
        let mut d = if boss == BossId::IceDemon { ice_demon() } else { fire_demon() };
        d.opening = Vec::new();
        for id in [AbilityId::Strike, AbilityId::Cleave, AbilityId::Swoop, d.ring, AbilityId::TailWhip, d.ball, d.breath] {
            if !ready.contains(&id) {
                run.monsters[bi].cds.start(id, 99.0);
            }
        }
        d.flight.t = 99.0;
        (run, d, bi)
    }

    fn fire_demon() -> Demon {
        Demon::of(AbilityId::FireBreath, AbilityId::Fireball, AbilityId::RingOfFire)
    }

    fn ice_demon() -> Demon {
        Demon::of(AbilityId::FrostBreath, AbilityId::FrostBall, AbilityId::RingOfFrost)
    }

    fn demon_with(off: Vec2, ready: &[AbilityId]) -> (Run, Demon, usize) {
        demon_with_heroes(&[off], ready)
    }

    /// The same, in the air.
    fn flying_demon_with(offs: &[Vec2], ready: &[AbilityId]) -> (Run, Demon, usize) {
        let (mut run, mut d, bi) = demon_with_heroes(offs, ready);
        d.flight.phase = Phase::Air;
        run.monsters[bi].airborne = true;
        (run, d, bi)
    }

    fn ticks(run: &mut Run, d: &mut Demon, secs: f64) {
        for _ in 0..(secs / DT).ceil() as usize {
            d.tick(run, DT);
        }
    }

    fn windup(run: &Run, bi: usize, id: AbilityId) -> f64 {
        kit(run, bi, id).windup
    }

    #[test]
    fn the_kit_resolves_with_both_weapons() {
        let (run, _, bi) = demon_with(Vec2::new(20.0, 0.0), &[]);
        for id in [AbilityId::Strike, AbilityId::Swoop, AbilityId::RingOfFire, AbilityId::TailWhip, AbilityId::Fireball, AbilityId::FireBreath, AbilityId::Smash] {
            assert!(run.monsters[bi].kit.get(id).is_some(), "{id:?}");
        }
        use crate::defs::damage::{DamageSplit, DamageType};
        let claws = kit(&run, bi, AbilityId::Strike).split;
        assert_ne!(claws, DamageSplit::pure(DamageType::Physical), "the claws' damage (partly heat), not the tail's");
        assert_eq!(kit(&run, bi, AbilityId::Swoop).split, claws);
        assert_eq!(kit(&run, bi, AbilityId::Smash).split, claws);
        let tail = kit(&run, bi, AbilityId::TailWhip);
        assert_eq!(tail.range, 22.0 + 11.0);
        assert_eq!(tail.split, DamageSplit::pure(DamageType::Physical));
        assert_eq!(windup(&run, bi, AbilityId::Swoop), 0.6, "the claws' wind-up");
        assert!(kit(&run, bi, AbilityId::Smash).radius > 0.0);
    }

    #[test]
    fn the_claw_is_unchanged_and_the_scimitar_is_its_own_blow() {
        let (run, _, bi) = demon_with(Vec2::new(20.0, 0.0), &[]);
        let (claw, blade) = (kit(&run, bi, AbilityId::Strike), kit(&run, bi, AbilityId::Cleave));
        assert_eq!((claw.windup, claw.range), (0.45, 24.0 + 11.0), "today's numbers");
        assert_eq!((blade.windup, blade.cd_steps.base, blade.range),(0.8, 4.0, 34.0 + 11.0));
        assert!(blade.damage > claw.damage);
    }

    /// Plays a demon beside a hero for `secs`, the hero kept alive; the animations seen, each with the time it first showed.
    fn anims_seen(ready: &[AbilityId], secs: f64) -> (Run, Vec<(Anim, f64)>) {
        let (mut run, mut d, bi) = demon_with_heroes(&[Vec2::new(20.0, 0.0)], ready);
        d.opening = fire_demon().opening;
        let mut seen: Vec<(Anim, f64)> = Vec::new();
        for i in 0..(secs / DT) as usize {
            let cdt = run.monsters[bi].effects.cooldown_dt(DT);
            run.monsters[bi].cds.tick(cdt);
            d.tick(&mut run, DT);
            run.players[0].hp = run.players[0].max_hp;
            let a = run.monsters[bi].anim;
            if !seen.iter().any(|(s, _)| *s == a) {
                seen.push((a, i as f64 * DT));
            }
        }
        (run, seen)
    }

    #[test]
    fn the_scimitar_opens_at_three_seconds_and_plays_its_own_anim() {
        let (_, seen) = anims_seen(&[AbilityId::Cleave], 2.9);
        assert!(seen.iter().all(|(a, _)| *a != Anim::Cleave), "no scimitar before its opening: {seen:?}");
        let (_, seen) = anims_seen(&[AbilityId::Strike, AbilityId::Cleave], 30.0);
        let first = |anim: Anim| seen.iter().find(|(a, _)| *a == anim).map(|(_, t)| *t);
        assert!(first(Anim::Melee).is_some(), "the claws are used: {seen:?}");
        assert!(first(Anim::Cleave).expect("the scimitar is used") >= 2.9, "{seen:?}");
    }

    #[test]
    fn the_burning_scimitar_singes_and_the_claws_do_not() {
        use crate::defs::effects::EffectKind;
        let hit_by = |id: AbilityId| {
            let (mut run, mut d, bi) = demon_with(Vec2::new(20.0, 0.0), &[id]);
            run.monsters[bi].cds.start(AbilityId::Smash, 99.0);
            let w = kit(&run, bi, id).windup;
            ticks(&mut run, &mut d, w + 2.0 * DT);
            assert_eq!(run.last_hit.clone().expect("a hit").why.what, What::Ability(id));
            run.players[0].effects.has(EffectKind::Singed)
        };
        assert!(hit_by(AbilityId::Cleave), "the scimitar singes");
        assert!(!hit_by(AbilityId::Strike), "the claws do not");
    }

    #[test]
    fn the_tail_goes_first_when_a_foe_is_behind() {
        let (mut run, mut d, bi) = demon_with_heroes(&[Vec2::new(-25.0, 0.0), Vec2::new(25.0, 0.0)], &[AbilityId::TailWhip, AbilityId::Strike]);
        let hp: Vec<f64> = run.players.iter().map(|p| p.hp).collect();
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Tail);
        assert_eq!(run.monsters[bi].aim, 0.0, "it does not turn to the hero behind");
        let w = windup(&run, bi, AbilityId::TailWhip);
        ticks(&mut run, &mut d, w + DT);
        assert!(run.players[0].hp < hp[0], "the hero behind is lashed");
        assert_eq!(run.last_hit.clone().expect("a hit").why.what, What::Ability(AbilityId::TailWhip));
        assert!(run.players[0].mv.knock_vx < 0.0, "pushed west");
        assert_eq!(run.players[1].hp, hp[1], "the hero in front is spared");
        assert_eq!(run.monsters[bi].anim, Anim::Tail);
        ticks(&mut run, &mut d, DEMON_TAIL_RECOVER - 3.0 * DT);
        assert_eq!(run.monsters[bi].anim, Anim::Tail, "the recovery keeps the pose");
    }

    #[test]
    fn no_tail_from_the_air_or_mid_action() {
        let (mut run, mut d, bi) = flying_demon_with(&[Vec2::new(-25.0, 0.0)], &[AbilityId::TailWhip]);
        let hp = run.players[0].hp;
        for _ in 0..(1.0 / DT) as usize {
            d.tick(&mut run, DT);
            assert_ne!(run.monsters[bi].anim, Anim::Tail, "no tail from the air");
        }
        assert_eq!(run.players[0].hp, hp);
        assert!(d.action.is_none());

        let (mut run, mut d, bi) = demon_with(Vec2::new(-25.0, 0.0), &[AbilityId::TailWhip]);
        d.action = Some((Action::Recover, 0.2));
        set_anim(&mut run, bi, Anim::Melee);
        d.tick(&mut run, DT);
        assert_eq!(d.action.map(|(a, _)| a), Some(Action::Recover), "the action under way goes on");
        assert_eq!(run.monsters[bi].anim, Anim::Melee);
        ticks(&mut run, &mut d, 0.3);
        assert_eq!(run.monsters[bi].anim, Anim::Tail, "once it is over, the tail");
    }

    #[test]
    fn the_fireball_is_the_wizards_by_the_demons_int() {
        use crate::sheet::{resolve_ability, Body};
        let (mut run, mut d, bi) = demon_with(Vec2::new(90.0, 0.0), &[AbilityId::Fireball]);
        run.events.clear();
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Cast);
        let casts: Vec<(u8, u16)> = run.events.iter().filter_map(|(e, _)| if let Ev::Cast { look, windup_ms, .. } = e { Some((*look, *windup_ms)) } else { None }).collect();
        assert_eq!(casts, vec![(crate::defs::looks::RuneLook::Fire as u8, 500)]);
        ticks(&mut run, &mut d, 0.5 - 3.0 * DT);
        assert!(run.projectiles.is_empty(), "no ball during the wind-up");
        ticks(&mut run, &mut d, 4.0 * DT);
        assert_eq!(run.projectiles.len(), 1, "one ball per cast");
        let ball = &run.projectiles[0];
        assert_eq!(ball.kind, EntityKind::Fireball);
        assert_eq!(ball.damage.why.what, What::Ability(AbilityId::Fireball));
        let attrs = run.monsters[bi].attrs;
        let expected = resolve_ability(&ab::def(AbilityId::Fireball), &attrs, &[], Body { radius: 11.0 }).unwrap();
        assert!((ball.damage.amount - expected.damage).abs() < 1e-9);
        assert!(!run.monsters[bi].cds.ready(AbilityId::Fireball), "the kit's cooldown runs");
        assert_eq!(run.events.iter().filter(|(e, _)| matches!(e, Ev::Cast { .. })).count(), 1, "announced once");
    }

    #[test]
    fn the_breath_winds_up_channels_and_ends() {
        let (mut run, mut d, bi) = demon_with(Vec2::new(40.0, 0.0), &[AbilityId::FireBreath]);
        let hp = run.players[0].hp;
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Breath, "the breath pose starts with its wind-up");
        let step = |run: &mut Run, d: &mut Demon| {
            d.tick(run, DT);
            tick_channel(run, bi, DT);
        };
        let mut steps = 0;
        while run.monsters[bi].channel.is_none() {
            step(&mut run, &mut d);
            steps += 1;
            assert!(steps < 1000);
        }
        assert!((steps as f64 * DT - windup(&run, bi, AbilityId::FireBreath)).abs() < 0.1);
        steps = 0;
        while run.monsters[bi].channel.is_some() {
            step(&mut run, &mut d);
            steps += 1;
            assert!(steps < 1000);
        }
        let duration = kit(&run, bi, AbilityId::FireBreath).duration;
        assert!((steps as f64 * DT - duration).abs() < 0.1, "it lasts its {duration} s: {steps} steps");
        assert!(run.players[0].hp < hp, "the hero in the cone burns");
        assert_eq!(run.last_hit.clone().expect("a hit").why.what, What::Ability(AbilityId::FireBreath));
        ticks(&mut run, &mut d, 2.0 * DT);
        assert_ne!(run.monsters[bi].anim, Anim::Breath, "the pose is over (it walks or stands)");
        assert!(d.action.is_none());
    }

    #[test]
    fn the_breath_burns_the_rangers_wolf() {
        // The demon turns to the hero (east); the wolf stands between them, in the cone.
        let (mut run, mut d, bi) = demon_with(Vec2::new(70.0, 0.0), &[AbilityId::FireBreath]);
        let id = crate::run::wolf::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(id).unwrap();
        let max = run.monsters[wi].max_hp;
        run.monsters[wi].pos = run.monsters[bi].pos + Vec2::new(35.0, 0.0);
        for _ in 0..(5.0 / DT) as usize {
            d.tick(&mut run, DT);
            tick_channel(&mut run, bi, DT);
        }
        assert!(run.monsters[wi].hp < max, "the wolf in the cone burns");
    }

    #[test]
    fn a_breath_cut_short_frees_the_demon() {
        let (mut run, mut d, bi) = demon_with(Vec2::new(40.0, 0.0), &[AbilityId::FireBreath]);
        let mut steps = 0;
        while run.monsters[bi].channel.is_none() {
            d.tick(&mut run, DT);
            tick_channel(&mut run, bi, DT);
            steps += 1;
            assert!(steps < 1000);
        }
        d.tick(&mut run, DT);
        assert_eq!(d.action.map(|(a, _)| a), Some(Action::Breath));
        run.monsters[bi].channel = None;
        d.tick(&mut run, DT);
        assert!(d.action.is_none(), "free again");
        assert_eq!(run.monsters[bi].anim, Anim::Idle);
    }

    #[test]
    fn in_the_air_only_fireball_and_breath() {
        let (mut run, mut d, bi) = flying_demon_with(&[Vec2::new(20.0, 0.0)], &SEVEN);
        let hp = run.players[0].hp;
        let mut seen = Vec::new();
        for _ in 0..(3.0 / DT) as usize {
            d.tick(&mut run, DT);
            tick_channel(&mut run, bi, DT);
            let a = run.monsters[bi].anim;
            if !seen.contains(&a) {
                seen.push(a);
            }
            if let Some(h) = &run.last_hit {
                assert!(h.why.what != What::Ability(AbilityId::Strike) && h.why.what != What::Ability(AbilityId::TailWhip) && h.why.what != What::Ability(AbilityId::Swoop));
            }
        }
        assert!(seen.iter().all(|a| matches!(a, Anim::Idle | Anim::Move | Anim::Cast | Anim::Breath)), "{seen:?}");
        assert!(seen.iter().any(|a| matches!(a, Anim::Cast | Anim::Breath)), "it did attack: {seen:?}");
        assert!(run.projectiles.iter().all(|p| p.kind != EntityKind::FireOrb), "no Ring of Fire");
        let _ = hp;
    }

    #[test]
    fn the_pick_is_among_usable_attacks_only() {
        let first = |dist: f64, seed: u64| {
            let (mut run, mut d, _) = demon_with(Vec2::new(dist, 0.0), &SEVEN);
            run.rng = rand_chacha::ChaCha8Rng::seed_from_u64(seed);
            d.tick(&mut run, DT);
            d.action.map(|(a, _)| a).expect("it starts something")
        };
        let mut seen = Vec::new();
        for s in 0..20 {
            let a = first(100.0, s);
            assert!(matches!(a, Action::SwoopWindup | Action::Cast(AbilityId::Fireball) | Action::Cast(AbilityId::RingOfFire) | Action::BreathWindup), "{a:?}");
            if !seen.contains(&a) {
                seen.push(a);
            }
            assert_ne!(first(20.0, s), Action::SwoopWindup, "no swoop up close");
        }
        assert!(seen.len() >= 3, "a real pick: {seen:?}");
    }

    #[test]
    fn it_waits_its_opening_delays() {
        assert_eq!(fire_demon().flight.t, DEMON_FLIGHT_FIRST);
        let (mut run, _, _) = demon_with(Vec2::new(20.0, 0.0), &SEVEN);
        let mut d = fire_demon();
        d.flight.t = 99.0;
        ticks(&mut run, &mut d, 0.9);
        assert!(d.action.is_none(), "nothing before 1 s");
        ticks(&mut run, &mut d, 0.2);
        assert_eq!(d.action.map(|(a, _)| a), Some(Action::Claw));
    }

    #[test]
    fn it_flies_and_lands_with_a_smash() {
        let (mut run, mut d, bi) = demon_with(Vec2::new(20.0, 0.0), &[]);
        d.flight.t = 0.0;
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::TakeOff);
        ticks(&mut run, &mut d, DEMON_TAKEOFF + DT);
        assert!(run.monsters[bi].airborne);
        let hp = run.players[0].hp;
        ticks(&mut run, &mut d, DEMON_FLIGHT - 0.1);
        assert!(run.monsters[bi].airborne);
        ticks(&mut run, &mut d, 0.2);
        assert_eq!(run.monsters[bi].anim, Anim::Land);
        ticks(&mut run, &mut d, DEMON_LAND + DT);
        assert!(!run.monsters[bi].airborne, "landed");
        assert!(run.players[0].hp < hp, "the landing smash hits");
        assert_eq!(run.last_hit.clone().expect("a hit").why.what, What::Ability(AbilityId::Smash));
        assert!((DEMON_FLIGHT_EVERY.0..=DEMON_FLIGHT_EVERY.1).contains(&d.flight.t), "next flight in 10-14 s: {}", d.flight.t);
    }

    #[test]
    fn the_cleave_lights_a_barrel_in_front() {
        use crate::run::objects::{Barrel, ObjState};
        let mut run = test_run(&[ClassId::Paladin], BossId::FireDemon);
        run.objects.retain(|o| o.kind != EntityKind::Barrel);
        let bi = boss_idx(&run).unwrap();
        run.monsters[bi].aim = 0.0;
        let pos = run.monsters[bi].pos;
        run.spawn_object(EntityKind::Barrel, pos + Vec2::new(34.0, 0.0), ObjState::Barrel(Barrel::new()));
        run.spawn_object(EntityKind::Barrel, pos + Vec2::new(-34.0, 0.0), ObjState::Barrel(Barrel::new()));
        let mut d = Demon { action: Some((Action::Claw, DT / 2.0)), ..fire_demon() };
        d.tick(&mut run, DT);
        let lit: Vec<bool> = run.objects.iter().filter(|o| o.kind == EntityKind::Barrel).map(|o| matches!(&o.state, ObjState::Barrel(b) if b.fuse.is_some())).collect();
        assert_eq!(lit, vec![true, false], "in front, not behind");
    }

    #[test]
    fn the_cleave_is_strike_with_demon_claws_and_starts_at_todays_distance() {
        // Today's cleave starts within 34 px of the hero's centre, and not beyond.
        for (dist, starts) in [(34.0, true), (34.5, false)] {
            let (mut run, mut d, _) = demon_with(Vec2::new(dist, 0.0), &[AbilityId::Strike]);
            d.tick(&mut run, DT);
            assert_eq!(d.action.map(|(a, _)| a) == Some(Action::Claw), starts, "{dist} px");
        }
        let (mut run, mut d, bi) = demon_with(Vec2::new(20.0, 0.0), &[AbilityId::Strike]);
        let hp = run.players[0].hp;
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Melee, "the cleave animation starts with its wind-up");
        let w = windup(&run, bi, AbilityId::Strike);
        assert_eq!(w, 0.45);
        ticks(&mut run, &mut d, w + DT);
        assert!(run.players[0].hp < hp, "hit at the end of the wind-up");
        assert_eq!(run.last_hit.clone().expect("a hit").why.what, What::Ability(AbilityId::Strike));
        assert!(run.players[0].mv.knock_vx > 0.0, "pushed away");
        assert_eq!(run.monsters[bi].anim, Anim::Melee, "the strike frames play out");
        ticks(&mut run, &mut d, DEMON_CLAW_RECOVER + 3.0 * DT);
        assert_ne!(run.monsters[bi].anim, Anim::Melee, "back to idle or walking after the recovery");
    }

    #[test]
    fn the_swoop_is_swoop_through_the_monster_dash_and_hurts_each_foe_once() {
        let (mut run, mut d, bi) = demon_with(Vec2::new(120.0, 0.0), &[AbilityId::Swoop]);
        let start_pos = run.monsters[bi].pos;
        let hp = run.players[0].hp;
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Dash);
        let start = run.monsters[bi].anim_start;
        let w = windup(&run, bi, AbilityId::Swoop);
        assert_eq!(w, 0.6, "the ability's 0.15 s and the claws' 0.45 s");
        let time = kit(&run, bi, AbilityId::Swoop).duration;
        ticks(&mut run, &mut d, w - DT);
        assert!(run.monsters[bi].dash.is_none(), "still winding up");
        ticks(&mut run, &mut d, 3.0 * DT);
        let dash = run.monsters[bi].dash.clone().expect("the dash runs");
        assert_eq!((dash.id, dash.attack), (AbilityId::Swoop, true));
        // Dashing through the hero: one hit, with Swoop's own name, and a push.
        run.players[0].mv.x = run.monsters[bi].pos.x + 15.0;
        run.players[0].mv.y = run.monsters[bi].pos.y;
        ticks(&mut run, &mut d, time + DEMON_SWOOP_RECOVER - 3.0 * DT);
        assert_eq!(run.monsters[bi].anim, Anim::Dash);
        assert_eq!(run.monsters[bi].anim_start, start, "one animation, not restarted");
        assert!(run.monsters[bi].pos.dist(start_pos) > 50.0, "it rushed forward");
        assert_eq!(run.last_hit.clone().expect("a hit").why.what, What::Ability(AbilityId::Swoop));
        let once = hp - run.players[0].hp;
        assert!(once > 0.0 && once < 40.0, "hurt once: {once}");
        ticks(&mut run, &mut d, 8.0 * DT);
        assert_ne!(run.monsters[bi].anim, Anim::Dash);
        assert!(run.monsters[bi].dash.is_none());
    }

    #[test]
    fn the_ring_of_fire_bursts_at_the_end_of_its_use_wind_up() {
        let (mut run, mut d, bi) = demon_with(Vec2::new(60.0, 0.0), &[AbilityId::RingOfFire]);
        let orbs = |run: &Run| run.projectiles.iter().filter(|p| p.kind == EntityKind::FireOrb).count();
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Cast);
        let w = windup(&run, bi, AbilityId::RingOfFire);
        ticks(&mut run, &mut d, w - 2.0 * DT);
        assert_eq!(orbs(&run), 0, "nothing during the wind-up");
        ticks(&mut run, &mut d, 3.0 * DT);
        assert_eq!(orbs(&run), 16);
        assert_eq!(run.monsters[bi].anim, Anim::Cast, "the burst frames play out");
        assert!(run.projectiles.iter().all(|p| p.damage.why.what == What::Ability(AbilityId::RingOfFire)));
    }

    #[test]
    fn the_demon_never_speeds_up_at_low_hp() {
        // The same fight at full health and at 10 %: the cleave lands on the same tick (same wind-up), a
        // second cleave comes after the same cooldown, and it walks as fast.
        let fight = |hp_frac: f64| {
            let (mut run, mut d, bi) = demon_with(Vec2::new(20.0, 0.0), &[AbilityId::Strike]);
            run.monsters[bi].hp = run.monsters[bi].max_hp * hp_frac;
            let mut hits = Vec::new();
            let mut hp = run.players[0].hp;
            for tick in 0..(5.0 / DT) as usize {
                let cdt = run.monsters[bi].effects.cooldown_dt(DT);
                run.monsters[bi].cds.tick(cdt);
                d.tick(&mut run, DT);
                if run.players[0].hp < hp {
                    hits.push(tick);
                    hp = run.players[0].hp;
                }
                run.players[0].hp = run.players[0].max_hp;
                hp = hp.max(run.players[0].hp);
            }
            let (mut run, mut d, bi) = demon_with(Vec2::new(100.0, 0.0), &[]);
            run.monsters[bi].hp = run.monsters[bi].max_hp * hp_frac;
            let from = run.monsters[bi].pos;
            ticks(&mut run, &mut d, 1.0);
            (hits, run.monsters[bi].speed, run.monsters[bi].pos.dist(from))
        };
        let (full, low) = (fight(1.0), fight(0.1));
        assert!(full.0.len() >= 2, "it cleaved more than once: {:?}", full.0);
        assert_eq!(full.0, low.0, "the same cleave ticks");
        assert_eq!(full.1, low.1);
        assert!(full.2 > 10.0 && (full.2 - low.2).abs() < 1e-9, "walks equally far: {} vs {}", full.2, low.2);
    }

    #[test]
    fn the_ice_kit_mirrors_the_fire_kit() {
        use crate::defs::damage::{kind_split, DamageSplit, DamageType::{Cold, Magical}};
        let (fire, _, fb) = demon_with(Vec2::new(20.0, 0.0), &[]);
        let (ice, _, ib) = ice_demon_with_heroes(&[Vec2::new(20.0, 0.0)], &[]);
        for (f, i) in [(AbilityId::FireBreath, AbilityId::FrostBreath), (AbilityId::Fireball, AbilityId::FrostBall), (AbilityId::RingOfFire, AbilityId::RingOfFrost)] {
            let (f, i) = (kit(&fire, fb, f), kit(&ice, ib, i));
            assert_eq!((f.damage, f.cooldown, f.range, f.windup, f.duration), (i.damage, i.cooldown, i.range, i.windup, i.duration));
        }
        // The whole definition but the name, the id, the projectile kind and the classes.
        let bare = |id: AbilityId| format!("{:?}", ab::AbilityDef { id: AbilityId::Strike, name: "", own: ab::OwnStats { kind: None, ..ab::def(id).own }, classes: &[], ..ab::def(id) });
        for (f, i) in [(AbilityId::FireBreath, AbilityId::FrostBreath), (AbilityId::Fireball, AbilityId::FrostBall), (AbilityId::RingOfFire, AbilityId::RingOfFrost)] {
            assert_eq!(bare(f), bare(i), "{i:?}");
        }
        assert_eq!(kind_split(EntityKind::FrostOrb), DamageSplit::split(&[(Cold, 0.7), (Magical, 0.3)]));
        assert_eq!(kind_split(EntityKind::FrostBall), DamageSplit::split(&[(Cold, 0.7), (Magical, 0.2)]));
        assert_eq!(kind_split(EntityKind::FrostBreath), DamageSplit::pure(Cold));
        assert_eq!(kind_split(EntityKind::FrostPatch), DamageSplit::split(&[(Cold, 0.4), (Magical, 0.6)]));
    }

    #[test]
    fn the_ice_demon_never_uses_a_fire_ability() {
        use crate::defs::looks::RuneLook;
        let (mut run, mut d, bi) = ice_demon_with_heroes(&[Vec2::new(60.0, 0.0)], &[AbilityId::FrostBreath, AbilityId::FrostBall, AbilityId::RingOfFrost]);
        d.opening = ice_demon().opening;
        let (mut casts, mut most_orbs, mut balls, mut patches) = (0, 0, 0, 0);
        for _ in 0..(60.0 / DT) as usize {
            let cdt = run.monsters[bi].effects.cooldown_dt(DT);
            run.monsters[bi].cds.tick(cdt);
            d.tick(&mut run, DT);
            tick_channel(&mut run, bi, DT);
            run.players[0].hp = run.players[0].max_hp;
            for (e, _) in run.events.drain(..) {
                if let Ev::Cast { look, .. } = e {
                    casts += 1;
                    assert_eq!(look, RuneLook::Cold as u8, "a cold cast");
                }
            }
            for p in &run.projectiles {
                assert!(!matches!(p.kind, EntityKind::FireOrb | EntityKind::Fireball | EntityKind::FireBreath), "{:?}", p.kind);
            }
            most_orbs = most_orbs.max(run.projectiles.iter().filter(|p| p.kind == EntityKind::FrostOrb).count());
            balls += run.projectiles.iter().filter(|p| p.kind == EntityKind::FrostBall).count();
            run.projectiles.clear();
            assert!(run.hazards.iter().all(|h| h.kind != EntityKind::FirePatch));
            patches = patches.max(run.hazards.iter().filter(|h| h.kind == EntityKind::FrostPatch).count());
        }
        assert!(casts > 3, "it cast: {casts}");
        assert_eq!(most_orbs, 16, "the ring");
        assert!(balls > 0 && patches > 0, "balls {balls}, patches {patches}");
    }

    /// Plays the real fight with only `id` ready until a blast has gone off; the kinds and colours of the flashes then alive.
    fn flashes_after_a_blast(boss: BossId, id: AbilityId) -> Vec<(crate::defs::lights::LightKind, crate::defs::lights::Colour)> {
        let (mut run, mut d, bi) = demon_run(boss, &[Vec2::new(90.0, 0.0)], &[id]);
        let radius = kit(&run, bi, id).radius;
        for _ in 0..(8.0 / DT) as usize {
            run.events.clear();
            d.tick(&mut run, DT);
            run.step();
            run.players[0].hp = run.players[0].max_hp;
            // The ball's own radius: the landing's Smash is a Boom too.
            if run.events.iter().any(|(e, _)| matches!(e, Ev::Boom { r, .. } if *r == radius as f32)) {
                return run.lights.sources.iter().filter(|s| s.expires.is_some()).map(|s| (s.kind, s.colour)).collect();
            }
        }
        panic!("no blast in 8 s");
    }

    #[test]
    fn the_frost_ball_flashes_cold_and_the_fireball_stays_a_blast() {
        use crate::defs::lights::LightKind;
        let ice = flashes_after_a_blast(BossId::IceDemon, AbilityId::FrostBall);
        assert!(ice.contains(&(LightKind::Magic, ab::NOVA_TINT)), "{ice:?}");
        assert!(!ice.iter().any(|f| f.0 == LightKind::Blast), "no orange flash: {ice:?}");
        let fire = flashes_after_a_blast(BossId::FireDemon, AbilityId::Fireball);
        assert!(fire.iter().any(|f| f.0 == LightKind::Blast) &&!fire.iter().any(|f| f.0 == LightKind::Magic), "{fire:?}");
    }

    #[test]
    fn the_ice_claws_and_scimitar_are_cold() {
        use crate::defs::damage::DamageType::Cold;
        use crate::defs::effects::EffectKind;
        let (mut run, mut d, bi) = ice_demon_with_heroes(&[Vec2::new(20.0, 0.0)], &[AbilityId::Cleave]);
        assert!((kit(&run, bi, AbilityId::Strike).split.share(Cold) - 0.2).abs() < 1e-9);
        run.monsters[bi].cds.start(AbilityId::Smash, 99.0);
        let w = kit(&run, bi, AbilityId::Cleave).windup;
        ticks(&mut run, &mut d, w + 2.0 * DT);
        assert_eq!(run.last_hit.clone().expect("a hit").why.what, What::Ability(AbilityId::Cleave));
        assert!(run.players[0].effects.has(EffectKind::Chilled), "the scimitar chills");
    }

    #[test]
    fn a_boss_hit_from_behind_looks_then_turns_to_the_blow() {
        crate::run::bosses::tests::hit_from_behind(BossId::FireDemon);
    }

    #[test]
    fn a_boss_looks_to_where_it_lost_a_hero() {
        crate::run::bosses::tests::looks_to_where_it_lost_a_hero(BossId::FireDemon);
    }
}
