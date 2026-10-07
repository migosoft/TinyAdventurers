//! Lich: guarded by disciples. Immune and drawing life from them until every
//! disciple is dead. Casts frost bolt volleys and summons skeletons.

use super::{boss_idx, set_anim, target, BossBehaviour};
use crate::defs::bosses::{LICH_DISCIPLES, LICH_DRAIN_PER_DISCIPLE};
use crate::defs::enemies::EnemyType;
use crate::defs::kinds::{Anim, EntityKind};
use crate::math::Vec2;
use crate::protocol::Ev;
use crate::run::abilities::spawn_monster_projectile;
use crate::run::ai::move_toward;
use crate::run::Run;

#[derive(Clone, Copy, PartialEq)]
enum Action {
    Volley,
    Summon,
}

pub struct Lich {
    volley_cd: f64,
    summon_cd: f64,
    action: Option<(Action, f64)>,
    announced: bool,
}

impl Default for Lich {
    fn default() -> Self {
        Lich { volley_cd: 2.0, summon_cd: 8.0, action: None, announced: false }
    }
}

pub fn living_disciples(run: &Run) -> usize {
    run.monsters.iter().filter(|m| m.alive && m.etype == Some(EnemyType::Disciple)).count()
}

impl BossBehaviour for Lich {
    fn spawn_extras(&mut self, run: &mut Run, boss_pos: Vec2, party: usize) {
        let owner = run.boss_ent;
        for k in 0..LICH_DISCIPLES {
            let a = k as f64 * std::f64::consts::TAU / LICH_DISCIPLES as f64;
            let mut r = 88.0;
            let mut pos = boss_pos + Vec2::from_angle(a) * r;
            while run.dungeon.map.solid_at(pos) && r > 20.0 {
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
                        spawn_monster_projectile(run, id, EntityKind::FrostBolt, pos + dir * 8.0, dir, 140.0, 10.0, 2.0, 0.0, 0);
                    }
                }
                Action::Summon => {
                    set_anim(run, bi, Anim::Cast);
                    let party = run.players.len();
                    let alive = run.monsters.iter().filter(|m| m.alive && m.owner == Some(id) && m.etype == Some(EnemyType::RaisedSkeleton)).count();
                    for k in 0..2usize.min(4usize.saturating_sub(alive)) {
                        let spot = pos + Vec2::from_angle(run.time + k as f64 * 3.0) * 20.0;
                        let spot = if run.dungeon.map.solid_at(spot) { pos } else { spot };
                        run.spawn_enemy(EnemyType::RaisedSkeleton, spot, Some(id), party);
                        run.event(Ev::Raise { x: spot.x as f32, y: spot.y as f32 }, Some(spot));
                    }
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
        } else if self.volley_cd <= 0.0 {
            self.volley_cd = 2.5;
            self.action = Some((Action::Volley, 0.5));
            set_anim(run, bi, Anim::Windup);
        } else {
            let speed = run.monsters[bi].speed;
            // Keep a casting distance.
            let to = if dist < 90.0 { pos + (pos - ppos).norm() * 16.0 } else if dist > 140.0 { ppos } else { pos };
            if to != pos {
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

    #[test]
    fn lich_spawns_with_at_least_five_disciples_and_is_immune_until_they_die() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        assert!(living_disciples(&run) >= 5);
        let bi = boss_idx(&run).unwrap();
        let hp = run.monsters[bi].hp;
        assert!(!run.hurt_monster(bi, 100.0, false, Some(0)));
        assert_eq!(run.monsters[bi].hp, hp, "immune while disciples live");

        // Damaged lich heals from its disciples.
        run.monsters[bi].hp = hp - 200.0;
        run.boss_awake = true;
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
        assert!(run.hurt_monster(bi, 100.0, false, Some(0)));
        assert_eq!(run.monsters[bi].hp, before - 100.0);
    }
}
