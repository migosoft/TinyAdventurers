//! Horned red demon: it uses the abilities of its kit and decides which, when and where to aim. Strike
//! with its claws (the cleave), Swoop (a charge on foot) and Ring of Fire. The numbers (damage, reach, push,
//! wind-up, cooldown) are the kit's. Each attack's animation starts with its wind-up and runs on through a
//! short recovery, so the client plays wind-up, strike and recovery frames.

use super::{ahead, boss_idx, use_in_pose, set_anim, target, BossBehaviour};
use crate::defs::abilities::AbilityId;
use crate::defs::bosses::{DEMON_CLEAVE_RECOVER, DEMON_RING_RECOVER, DEMON_SWOOP_RECOVER};
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::kinds::Anim;
use crate::math::Vec2;
use crate::run::abilities::tick_monster_dash;
use crate::run::ai::path_toward;
use crate::run::Run;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Action {
    Cleave,
    SwoopWindup,
    /// The dash runs (`Monster.dash`) until it ends.
    Swoop,
    Ring,
    /// The strike frames play out; the animation set at the wind-up keeps running.
    Recover,
}

pub struct Demon {
    action: Option<(Action, f64)>,
    swoop_dir: Vec2,
    /// Seconds before the script may first choose each ability: when it opens, not how an ability works. It
    /// only gates the script's decision; the kit's cooldowns (`cds`) are the uses' alone.
    opening: Vec<(AbilityId, f64)>,
}

impl Default for Demon {
    fn default() -> Self {
        Demon { action: None, swoop_dir: Vec2::ZERO, opening: OPENING.to_vec() }
    }
}

/// How long (s) after the fight starts each ability may first be used.
const OPENING: [(AbilityId, f64); 3] = [(AbilityId::Strike, 1.0), (AbilityId::Swoop, 4.0), (AbilityId::RingOfFire, 7.0)];
/// How far (px, centre distance) a hero must be for the swoop to start.
const SWOOP_FROM: f64 = 50.0;
/// The cleave starts this far (px) inside its reach, like the enemies' swings.
const CLEAVE_SLACK: f64 = 6.0;

/// Its kit's ability `id`.
fn kit(run: &Run, bi: usize, id: AbilityId) -> crate::sheet::ResolvedAbility {
    *run.monsters[bi].kit.get(id).expect("the demon's kit has it")
}

impl Demon {
    /// Is `id` off its opening delay and off cooldown?
    fn ready(&self, run: &Run, bi: usize, id: AbilityId) -> bool {
        run.monsters[bi].cds.ready(id) && self.opening.iter().all(|&(i, left)| i != id || left <= 0.0)
    }

    fn start(&mut self, run: &mut Run, bi: usize, action: Action, id: AbilityId, anim: Anim) {
        self.action = Some((action, kit(run, bi, id).windup));
        set_anim(run, bi, anim);
    }
}

impl BossBehaviour for Demon {
    fn tick(&mut self, run: &mut Run, dt: f64) {
        let Some(bi) = boss_idx(run) else { return };
        let cdt = run.monsters[bi].effects.cooldown_dt(dt);
        for (_, left) in &mut self.opening {
            *left -= cdt;
        }
        let pos = run.monsters[bi].pos;

        if let Some((action, t)) = self.action {
            if action == Action::Swoop {
                // The dash is ticked here; it ends with its time (or if something cut it short).
                if run.monsters[bi].dash.is_none() || tick_monster_dash(run, bi, dt).is_some() {
                    self.action = Some((Action::Recover, DEMON_SWOOP_RECOVER));
                }
                return;
            }
            let t = t - dt;
            if t > 0.0 {
                self.action = Some((action, t));
                return;
            }
            self.action = None;
            match action {
                Action::Cleave => {
                    use_in_pose(run, bi, AbilityId::Strike, ahead(run, bi));
                    self.action = Some((Action::Recover, DEMON_CLEAVE_RECOVER));
                }
                Action::SwoopWindup => {
                    use_in_pose(run, bi, AbilityId::Swoop, pos + self.swoop_dir * 30.0);
                    self.action = Some((Action::Swoop, 0.0));
                }
                Action::Ring => {
                    use_in_pose(run, bi, AbilityId::RingOfFire, ahead(run, bi));
                    self.action = Some((Action::Recover, DEMON_RING_RECOVER));
                }
                Action::Swoop => {}
                Action::Recover => set_anim(run, bi, Anim::Idle),
            }
            return;
        }

        let Some((_pi, ppos, dist)) = target(run, bi) else {
            set_anim(run, bi, Anim::Idle);
            return;
        };
        run.monsters[bi].aim = pos.angle_to(ppos);
        // A kit range is measured to the target's edge: the centre distance adds the hero's radius.
        let cleave_from = kit(run, bi, AbilityId::Strike).range + PLAYER_RADIUS - CLEAVE_SLACK;
        if self.ready(run, bi, AbilityId::RingOfFire) {
            self.start(run, bi, Action::Ring, AbilityId::RingOfFire, Anim::Cast);
        } else if self.ready(run, bi, AbilityId::Swoop) && dist > SWOOP_FROM {
            self.swoop_dir = (ppos - pos).norm();
            self.start(run, bi, Action::SwoopWindup, AbilityId::Swoop, Anim::Dash);
        } else if self.ready(run, bi, AbilityId::Strike) && dist <= cleave_from {
            self.start(run, bi, Action::Cleave, AbilityId::Strike, Anim::Melee);
        } else if dist > cleave_from * 0.8 {
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
    use crate::defs::damage::What;
    use crate::defs::kinds::EntityKind;
    use crate::protocol::{BossId, ClassId};
    use crate::run::tests::test_run;
    use crate::run::DT;

    const ALL: [AbilityId; 3] = [AbilityId::Strike, AbilityId::Swoop, AbilityId::RingOfFire];

    /// A demon run with one hero at `off` from the demon; only the abilities named are ready.
    fn demon_with(off: Vec2, ready: &[AbilityId]) -> (Run, Demon, usize) {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        let bi = boss_idx(&run).unwrap();
        run.monsters[bi].dormant = false;
        run.monsters[bi].aim = 0.0;
        let at = run.monsters[bi].pos;
        run.players[0].mv.x = at.x + off.x;
        run.players[0].mv.y = at.y + off.y;
        for id in ALL {
            if !ready.contains(&id) {
                run.monsters[bi].cds.start(id, 99.0);
            }
        }
        (run, Demon { opening: Vec::new(), ..Demon::default() }, bi)
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
    fn the_cleave_lights_a_barrel_in_front() {
        use crate::run::objects::{Barrel, ObjState};
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.objects.retain(|o| o.kind != EntityKind::Barrel);
        let bi = boss_idx(&run).unwrap();
        run.monsters[bi].aim = 0.0;
        let pos = run.monsters[bi].pos;
        run.spawn_object(EntityKind::Barrel, pos + Vec2::new(34.0, 0.0), ObjState::Barrel(Barrel::new()));
        run.spawn_object(EntityKind::Barrel, pos + Vec2::new(-34.0, 0.0), ObjState::Barrel(Barrel::new()));
        let mut d = Demon { action: Some((Action::Cleave, DT / 2.0)), ..Demon::default() };
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
            assert_eq!(d.action.map(|(a, _)| a) == Some(Action::Cleave), starts, "{dist} px");
        }
        let (mut run, mut d, bi) = demon_with(Vec2::new(20.0, 0.0), &[AbilityId::Strike]);
        let hp = run.players[0].hp;
        d.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Melee, "the cleave animation starts with its wind-up");
        let w = windup(&run, bi, AbilityId::Strike);
        assert_eq!(w, 0.45);
        ticks(&mut run, &mut d, w + DT);
        assert!(run.players[0].hp < hp, "hit at the end of the wind-up");
        assert_eq!(run.last_hit.expect("a hit").why.what, What::Ability(AbilityId::Strike));
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
        assert_eq!(run.last_hit.expect("a hit").why.what, What::Ability(AbilityId::Swoop));
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
