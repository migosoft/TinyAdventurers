//! Horned red demon: it uses the abilities of its kit and decides which, when and where to aim. Strike with
//! its claws (the cleave), Swoop (a charge on foot), Ring of Fire, Tail Whip against heroes behind it,
//! Fireball, Fire Breath and, on landing, Smash. Among the attacks it can use it picks at random; the tail
//! goes first when a foe is behind. Every 10-14 s it takes off and hovers after the party: only Fireball and
//! the breath then. The numbers (damage, reach, push, wind-up, cooldown) are the kit's. Each attack's
//! animation starts with its wind-up and runs on through a short recovery, so the client plays wind-up,
//! strike and recovery frames.

use super::flight::{Flight, FlightTimes};
use super::{ahead, boss_idx, foe_behind, kit, ready, set_anim, target, use_in_pose, BossBehaviour};
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
}

impl Default for Demon {
    fn default() -> Self {
        Demon {
            flight: Flight::new(FlightTimes { takeoff: DEMON_TAKEOFF, air: DEMON_FLIGHT, land: DEMON_LAND, every: DEMON_FLIGHT_EVERY }, DEMON_FLIGHT_FIRST),
            action: None,
            swoop_dir: Vec2::ZERO,
            opening: OPENING.to_vec(),
        }
    }
}

/// How long (s) after the fight starts each ability may first be used.
const OPENING: [(AbilityId, f64); 6] = [
    (AbilityId::Strike, 1.0),
    (AbilityId::TailWhip, 2.0),
    (AbilityId::Swoop, 4.0),
    (AbilityId::Fireball, 5.0),
    (AbilityId::FireBreath, 6.0),
    (AbilityId::RingOfFire, 7.0),
];
/// How far (px, centre distance) a hero must be for the swoop to start.
const SWOOP_FROM: f64 = 50.0;
/// The cleave starts this far (px) inside its reach, like the enemies' swings.
const CLEAVE_SLACK: f64 = 6.0;
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
                    self.action = Some((Action::Recover, DEMON_CLEAVE_RECOVER));
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
                    let at = if id == AbilityId::Fireball { target(run, bi).map_or_else(|| ahead(run, bi), |(_, ppos, _)| ppos) } else { ahead(run, bi) };
                    use_in_pose(run, bi, id, at);
                    self.action = Some((Action::Recover, DEMON_CAST_RECOVER));
                }
                Action::BreathWindup => {
                    use_in_pose(run, bi, AbilityId::FireBreath, ahead(run, bi));
                    self.action = Some((Action::Breath, kit(run, bi, AbilityId::FireBreath).duration));
                }
                Action::Breath | Action::Recover => set_anim(run, bi, Anim::Idle),
                Action::Swoop => {}
            }
            return;
        }

        let Some((_pi, ppos, dist)) = target(run, bi) else {
            set_anim(run, bi, Anim::Idle);
            return;
        };
        // Tail whip when someone sneaks behind (not in the air), before turning to the target.
        let tail = kit(run, bi, AbilityId::TailWhip);
        // A kit range is measured to the target's edge: the centre distance adds the hero's radius.
        if !air && foe_behind(run, bi, tail.range + PLAYER_RADIUS - TAIL_SLACK) && ready(run, bi, &self.opening, AbilityId::TailWhip) {
            self.start(run, bi, Action::Tail, AbilityId::TailWhip, tail.windup, Anim::Tail);
            return;
        }
        let to_target = pos.angle_to(ppos);
        run.monsters[bi].aim = to_target;
        let cleave_from = kit(run, bi, AbilityId::Strike).range + PLAYER_RADIUS - CLEAVE_SLACK;
        let breath = kit(run, bi, AbilityId::FireBreath);
        let usable = |id: AbilityId| ready(run, bi, &self.opening, id);
        let mut picks: Vec<AbilityId> = Vec::new();
        if !air && usable(AbilityId::Strike) && dist <= cleave_from {
            picks.push(AbilityId::Strike);
        }
        if !air && usable(AbilityId::Swoop) && dist > SWOOP_FROM {
            picks.push(AbilityId::Swoop);
        }
        if usable(AbilityId::FireBreath) && dist < breath.range {
            picks.push(AbilityId::FireBreath);
        }
        if usable(AbilityId::Fireball) {
            picks.push(AbilityId::Fireball);
        }
        if !air && usable(AbilityId::RingOfFire) {
            picks.push(AbilityId::RingOfFire);
        }
        if !picks.is_empty() {
            let id = picks[run.rng.gen_range(0..picks.len())];
            let cast_time = kit(run, bi, AbilityId::RingOfFire).windup;
            match id {
                AbilityId::Strike => self.start(run, bi, Action::Claw, id, kit(run, bi, id).windup, Anim::Melee),
                AbilityId::Swoop => {
                    self.swoop_dir = (ppos - pos).norm();
                    self.start(run, bi, Action::SwoopWindup, id, kit(run, bi, id).windup, Anim::Dash);
                }
                AbilityId::FireBreath => self.start(run, bi, Action::BreathWindup, id, breath.windup, Anim::Breath),
                _ => self.start(run, bi, Action::Cast(id), id, cast_time, Anim::Cast),
            }
            return;
        }
        let walk = if air { dist > HOVER_KEEP } else { dist > cleave_from * 0.8 };
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

    const SIX: [AbilityId; 6] = [AbilityId::Strike, AbilityId::Swoop, AbilityId::RingOfFire, AbilityId::TailWhip, AbilityId::Fireball, AbilityId::FireBreath];

    /// A demon run with heroes at `offs` from the demon; only the abilities named are ready (of the six the
    /// script chooses from; Smash is the landing's), no opening waits, the first flight far away.
    fn demon_with_heroes(offs: &[Vec2], ready: &[AbilityId]) -> (Run, Demon, usize) {
        let classes = vec![ClassId::Paladin; offs.len()];
        let mut run = test_run(&classes, BossId::Demon);
        let bi = boss_idx(&run).unwrap();
        run.monsters[bi].dormant = false;
        run.monsters[bi].aim = 0.0;
        let at = run.monsters[bi].pos;
        for (p, off) in run.players.iter_mut().zip(offs) {
            p.mv.x = at.x + off.x;
            p.mv.y = at.y + off.y;
        }
        for id in SIX {
            if !ready.contains(&id) {
                run.monsters[bi].cds.start(id, 99.0);
            }
        }
        let mut d = Demon { opening: Vec::new(), ..Demon::default() };
        d.flight.t = 99.0;
        (run, d, bi)
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
        let (mut run, mut d, bi) = flying_demon_with(&[Vec2::new(20.0, 0.0)], &SIX);
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
            let (mut run, mut d, _) = demon_with(Vec2::new(dist, 0.0), &SIX);
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
        assert_eq!(Demon::default().flight.t, DEMON_FLIGHT_FIRST);
        let (mut run, _, _) = demon_with(Vec2::new(20.0, 0.0), &SIX);
        let mut d = Demon::default();
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
        assert_eq!(run.players[0].hp, hp, "no melee from the air");
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
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.objects.retain(|o| o.kind != EntityKind::Barrel);
        let bi = boss_idx(&run).unwrap();
        run.monsters[bi].aim = 0.0;
        let pos = run.monsters[bi].pos;
        run.spawn_object(EntityKind::Barrel, pos + Vec2::new(34.0, 0.0), ObjState::Barrel(Barrel::new()));
        run.spawn_object(EntityKind::Barrel, pos + Vec2::new(-34.0, 0.0), ObjState::Barrel(Barrel::new()));
        let mut d = Demon { action: Some((Action::Claw, DT / 2.0)), ..Demon::default() };
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
        ticks(&mut run, &mut d, DEMON_CLEAVE_RECOVER + 3.0 * DT);
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
}
