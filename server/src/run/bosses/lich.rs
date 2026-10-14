//! Lich: guarded by disciples. Immune and drawing life from them until every
//! disciple is dead. Casts gloom bolt volleys, raises skeletons (melee and
//! archers) and now and then unleashes a nova that hurts and pushes every hero
//! around it.

use super::{boss_idx, players_in, set_anim, target, BossBehaviour};
use crate::defs::bosses::{
    LICH_ARCHERS, LICH_DISCIPLES, LICH_DRAIN_PER_DISCIPLE, LICH_NOVA_DAMAGE, LICH_NOVA_EVERY, LICH_NOVA_KNOCK, LICH_NOVA_RADIUS, LICH_NOVA_WINDUP, LICH_SKELETONS,
};
use crate::defs::damage::{Damage, DamageSplit, DamageType};
use crate::defs::enemies::EnemyType;
use crate::defs::kinds::{Anim, EntityKind};
use crate::dungeon::Mover;
use crate::math::Vec2;
use crate::protocol::Ev;
use crate::run::abilities::spawn_monster_projectile;
use crate::run::ai::{move_toward, path_toward};
use crate::run::Run;
use rand::Rng;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Action {
    Volley,
    Summon,
    Nova,
}

pub struct Lich {
    volley_cd: f64,
    summon_cd: f64,
    nova_cd: f64,
    action: Option<(Action, f64)>,
    announced: bool,
}

impl Default for Lich {
    fn default() -> Self {
        Lich { volley_cd: 2.0, summon_cd: 8.0, nova_cd: 6.0, action: None, announced: false }
    }
}

pub fn living_disciples(run: &Run) -> usize {
    run.monsters.iter().filter(|m| m.alive && m.etype == Some(EnemyType::Disciple)).count()
}

impl Lich {
    /// The nova: a dark burst that hurts every hero within the radius and pushes them straight away.
    fn nova(run: &mut Run, pos: Vec2) {
        let r = LICH_NOVA_RADIUS;
        run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: r as f32, k: 6 }, Some(pos));
        for pi in players_in(run, pos, r, None) {
            let away = pos.angle_to(run.players[pi].pos());
            run.hurt_player(pi, Damage::new(LICH_NOVA_DAMAGE, DamageSplit::pure(DamageType::Magical)));
            run.knock_player(pi, pos, away, LICH_NOVA_KNOCK);
        }
    }

    /// Tops the lich's raised skeletons up to LICH_SKELETONS melee and LICH_ARCHERS archers, in a ring around it.
    fn summon(run: &mut Run, bi: usize) {
        let (id, pos) = (run.monsters[bi].id, run.monsters[bi].pos);
        let alive = |run: &Run, t: EnemyType| run.monsters.iter().filter(|m| m.alive && m.owner == Some(id) && m.etype == Some(t)).count();
        let mut raise: Vec<EnemyType> = Vec::new();
        raise.extend(std::iter::repeat(EnemyType::RaisedSkeleton).take(LICH_SKELETONS.saturating_sub(alive(run, EnemyType::RaisedSkeleton))));
        raise.extend(std::iter::repeat(EnemyType::RaisedArcher).take(LICH_ARCHERS.saturating_sub(alive(run, EnemyType::RaisedArcher))));
        let party = run.players.len();
        let n = raise.len();
        let a0 = run.rng.gen_range(0.0..std::f64::consts::TAU);
        for (k, t) in raise.into_iter().enumerate() {
            // Alternate melee and archers around the ring.
            let slot = if k % 2 == 0 { k / 2 } else { n - 1 - k / 2 };
            let spot = pos + Vec2::from_angle(a0 + slot as f64 * std::f64::consts::TAU / n as f64) * 22.0;
            let spot = if run.layout.map.blocks_at(spot, Mover::Enemy) { pos } else { spot };
            run.spawn_enemy(t, spot, Some(id), party);
            run.event(Ev::Raise { x: spot.x as f32, y: spot.y as f32, k: 2 }, Some(spot));
        }
    }
}

impl BossBehaviour for Lich {
    fn spawn_extras(&mut self, run: &mut Run, boss_pos: Vec2, party: usize) {
        let owner = run.level.boss().unwrap().boss_ent;
        for k in 0..LICH_DISCIPLES {
            let a = k as f64 * std::f64::consts::TAU / LICH_DISCIPLES as f64;
            let mut r = 88.0;
            let mut pos = boss_pos + Vec2::from_angle(a) * r;
            while run.layout.map.blocks_at(pos, Mover::Enemy) && r > 20.0 {
                r -= 8.0;
                pos = boss_pos + Vec2::from_angle(a) * r;
            }
            let id = run.spawn_enemy(EnemyType::Disciple, pos, Some(owner), party);
            let mi = run.monster_idx(id).unwrap();
            run.monsters[mi].asleep = true;
            run.monsters[mi].anim = Anim::Channel;
        }
    }

    fn can_be_damaged(&self, run: &Run) -> bool {
        living_disciples(run) == 0
    }

    fn tick(&mut self, run: &mut Run, dt: f64) {
        let Some(bi) = boss_idx(run) else { return };
        let disciples = living_disciples(run);
        if disciples > 0 {
            let m = &mut run.monsters[bi];
            m.hp = (m.hp + LICH_DRAIN_PER_DISCIPLE * disciples as f64 * dt).min(m.max_hp);
        } else if !self.announced {
            self.announced = true;
            run.event(Ev::Msg { text: "The lich's protection is broken!".into() }, None);
        }
        self.volley_cd -= dt;
        self.summon_cd -= dt;
        self.nova_cd -= dt;
        let pos = run.monsters[bi].pos;

        if let Some((action, t)) = self.action {
            let t = t - dt;
            if t > 0.0 {
                self.action = Some((action, t));
                return;
            }
            self.action = None;
            let id = run.monsters[bi].id;
            match action {
                Action::Volley => {
                    set_anim(run, bi, Anim::Cast);
                    let aim = run.monsters[bi].aim;
                    for k in -2..=2 {
                        let dir = Vec2::from_angle(aim + k as f64 * 0.2);
                        spawn_monster_projectile(run, id, EntityKind::GloomBolt, pos + dir * 8.0, dir, 140.0, 10.0, 2.0, 0.0, 0, 0.0);
                    }
                }
                Action::Summon => {
                    set_anim(run, bi, Anim::Cast);
                    Self::summon(run, bi);
                }
                Action::Nova => {
                    set_anim(run, bi, Anim::Cast);
                    Self::nova(run, pos);
                }
            }
            return;
        }

        let Some((_pi, ppos, dist)) = target(run, bi) else {
            set_anim(run, bi, Anim::Idle);
            return;
        };
        run.monsters[bi].aim = pos.angle_to(ppos);
        if self.summon_cd <= 0.0 {
            self.summon_cd = 12.0;
            self.action = Some((Action::Summon, 0.7));
            set_anim(run, bi, Anim::Windup);
        } else if self.nova_cd <= 0.0 {
            // The anim starts with the wind-up; the client fills the telegraph ring over it.
            self.nova_cd = run.rng.gen_range(LICH_NOVA_EVERY.0..LICH_NOVA_EVERY.1);
            self.action = Some((Action::Nova, LICH_NOVA_WINDUP));
            set_anim(run, bi, Anim::Slam);
        } else if self.volley_cd <= 0.0 {
            self.volley_cd = 2.5;
            self.action = Some((Action::Volley, 0.5));
            set_anim(run, bi, Anim::Windup);
        } else {
            let speed = run.monsters[bi].speed;
            // Keep a casting distance.
            let to = if dist < 90.0 { pos + (pos - ppos).norm() * 16.0 } else if dist > 140.0 { ppos } else { pos };
            if to == ppos {
                path_toward(run, bi, to, speed, dt);
                set_anim(run, bi, Anim::Move);
            } else if to != pos {
                move_toward(run, bi, to, speed, dt);
                set_anim(run, bi, Anim::Move);
            } else {
                set_anim(run, bi, Anim::Idle);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{BossId, ClassId};
    use crate::run::tests::test_run;
    use crate::run::DT;

    #[test]
    fn lich_spawns_with_at_least_five_disciples_and_is_immune_until_they_die() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        assert!(living_disciples(&run) >= 5);
        let bi = boss_idx(&run).unwrap();
        let hp = run.monsters[bi].hp;
        assert!(!run.hurt_monster(bi, Damage::physical(100.0), false, Some(0)));
        assert_eq!(run.monsters[bi].hp, hp, "immune while disciples live");

        // Damaged lich heals from its disciples.
        run.monsters[bi].hp = hp - 200.0;
        run.level.boss_mut().unwrap().awake = true;
        for _ in 0..60 {
            run.step();
        }
        let bi = boss_idx(&run).unwrap();
        assert!(run.monsters[bi].hp > hp - 200.0, "drains life from disciples");

        let disciples: Vec<u32> = run.monsters.iter().filter(|m| m.etype == Some(EnemyType::Disciple)).map(|m| m.id).collect();
        for id in disciples {
            let i = run.monster_idx(id).unwrap();
            run.kill_monster(i);
        }
        let bi = boss_idx(&run).unwrap();
        let before = run.monsters[bi].hp;
        assert!(run.hurt_monster(bi, Damage::physical(100.0), false, Some(0)));
        assert_eq!(run.monsters[bi].hp, before - 50.0, "the lich resists physical damage by half");
    }

    /// A lich with its heroes placed at `offs` from it, awake and facing right.
    fn lich_with(offs: &[Vec2]) -> (Run, usize) {
        let classes = vec![ClassId::Paladin; offs.len()];
        let mut run = test_run(&classes, BossId::Lich);
        let bi = boss_idx(&run).unwrap();
        run.monsters[bi].asleep = false;
        let at = run.monsters[bi].pos;
        for (p, off) in run.players.iter_mut().zip(offs) {
            p.mv.x = at.x + off.x;
            p.mv.y = at.y + off.y;
        }
        (run, bi)
    }

    fn ticks(run: &mut Run, l: &mut Lich, secs: f64) {
        for _ in 0..(secs / DT).round() as usize {
            l.tick(run, DT);
        }
    }

    #[test]
    fn the_nova_winds_up_then_hurts_and_pushes_heroes_far() {
        let (mut run, bi) = lich_with(&[Vec2::new(30.0, 0.0)]);
        let mut l = Lich { volley_cd: 99.0, summon_cd: 99.0, nova_cd: 0.0, ..Lich::default() };
        let hp = run.players[0].hp;
        l.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Slam, "the wind-up shows the telegraph");
        ticks(&mut run, &mut l, LICH_NOVA_WINDUP - 0.1);
        assert_eq!(run.players[0].hp, hp, "nothing before the wind-up ends");
        run.events.clear();
        ticks(&mut run, &mut l, 0.2);
        assert_eq!(run.players[0].hp, hp - LICH_NOVA_DAMAGE);
        assert!(run.players[0].mv.knock_vx > 0.0, "pushed straight away from the lich");
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Boom { k: 6, .. })), "nova event");
        assert!(l.nova_cd >= LICH_NOVA_EVERY.0 - 1.0, "next nova in 10-12 s");
    }

    #[test]
    fn the_nova_pushes_further_than_any_normal_enemy_and_spares_heroes_outside() {
        assert!(LICH_NOVA_KNOCK > 28.0, "the ogre's club pushes 28 px");
        let (mut run, bi) = lich_with(&[Vec2::new(LICH_NOVA_RADIUS + 8.0, 0.0)]);
        let hp = run.players[0].hp;
        let pos = run.monsters[bi].pos;
        Lich::nova(&mut run, pos);
        assert_eq!(run.players[0].hp, hp);
        assert!(!run.players[0].mv.knocked());
    }

    #[test]
    fn a_summon_raises_five_skeletons_and_five_archers_and_tops_them_up() {
        let (mut run, bi) = lich_with(&[Vec2::new(100.0, 0.0)]);
        let id = run.monsters[bi].id;
        let count = |run: &Run, t: EnemyType| run.monsters.iter().filter(|m| m.alive && m.owner == Some(id) && m.etype == Some(t)).count();
        Lich::summon(&mut run, bi);
        assert_eq!(count(&run, EnemyType::RaisedSkeleton), LICH_SKELETONS);
        assert_eq!(count(&run, EnemyType::RaisedArcher), LICH_ARCHERS);
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Raise { k: 2, .. })), "dark purple raise");
        let archer = run.monsters.iter().position(|m| m.alive && m.etype == Some(EnemyType::RaisedArcher)).unwrap();
        assert_eq!(run.monsters[archer].kind, EntityKind::SkeletonArcher, "raised archers look like skeleton archers");
        run.kill_monster(archer);
        Lich::summon(&mut run, bi);
        assert_eq!(count(&run, EnemyType::RaisedSkeleton), LICH_SKELETONS, "no stacking beyond five");
        assert_eq!(count(&run, EnemyType::RaisedArcher), LICH_ARCHERS, "the fallen archer is replaced");
    }

    #[test]
    fn the_volley_is_gloom_bolts() {
        let (mut run, _) = lich_with(&[Vec2::new(100.0, 0.0)]);
        let mut l = Lich { volley_cd: 0.0, summon_cd: 99.0, nova_cd: 99.0, ..Lich::default() };
        ticks(&mut run, &mut l, 0.6);
        let bolts: Vec<_> = run.projectiles.iter().filter(|p| !p.dead).collect();
        assert_eq!(bolts.len(), 5);
        assert!(bolts.iter().all(|p| p.kind == EntityKind::GloomBolt));
    }
}
