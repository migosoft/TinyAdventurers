//! Lich: guarded by disciples. Immune and drawing life from them until every
//! disciple is dead. Casts gloom bolt volleys, raises skeletons (melee and
//! archers) and now and then unleashes a nova that hurts and pushes every hero
//! around it. Three effect spells (see `SPELLS`): a blinding curse (dark orb),
//! a sleep mist (purple orb) and a stone gaze (a beam that petrifies a hero the
//! lich still sees when the wind-up ends).

use super::{boss_idx, set_anim, target, BossBehaviour};
use crate::defs::bosses::{
    LICH_ARCHERS, LICH_BLIND_COOLDOWN, LICH_BLIND_DAMAGE, LICH_BLIND_FIRST, LICH_BLIND_SECS, LICH_BLIND_WINDUP, LICH_DISCIPLES, LICH_DRAIN_PER_DISCIPLE, LICH_GAZE_COOLDOWN,
    LICH_GAZE_FIRST, LICH_GAZE_SECS, LICH_GAZE_WINDUP, LICH_NOVA_DAMAGE, LICH_NOVA_EVERY, LICH_NOVA_KNOCK, LICH_NOVA_RADIUS, LICH_NOVA_WINDUP, LICH_ORB_SPEED,
    LICH_SKELETONS, LICH_SLEEP_COOLDOWN, LICH_SLEEP_FIRST, LICH_SLEEP_SECS, LICH_SLEEP_WINDUP, BOSS_KNOCK_STR,
};
use crate::defs::damage::{Damage, DamageSplit, DamageType};
use crate::defs::effects::EffectKind;
use crate::defs::enemies::EnemyType;
use crate::defs::kinds::{Anim, EntityKind};
use crate::dungeon::Mover;
use crate::math::Vec2;
use crate::protocol::Ev;
use crate::run::abilities::spawn_monster_projectile;
use crate::run::ai::{move_toward, path_toward};
use crate::run::effects::{Creature, OnHit};
use crate::run::Run;
use rand::Rng;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Action {
    Volley,
    Summon,
    Nova,
    Spell(Spell),
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum Spell {
    Blind,
    Sleep,
    Gaze,
}

/// The lich's effect spells, tried in this order when their cooldown is up.
/// Take one out for balancing by deleting its entry.
pub(crate) const SPELLS: [Spell; 3] = [Spell::Gaze, Spell::Sleep, Spell::Blind];

impl Spell {
    fn effect(self) -> EffectKind {
        match self {
            Spell::Blind => EffectKind::Blind,
            Spell::Sleep => EffectKind::Sleep,
            Spell::Gaze => EffectKind::Petrified,
        }
    }
    fn windup(self) -> f64 {
        match self {
            Spell::Blind => LICH_BLIND_WINDUP,
            Spell::Sleep => LICH_SLEEP_WINDUP,
            Spell::Gaze => LICH_GAZE_WINDUP,
        }
    }
    fn cooldown(self) -> f64 {
        match self {
            Spell::Blind => LICH_BLIND_COOLDOWN,
            Spell::Sleep => LICH_SLEEP_COOLDOWN,
            Spell::Gaze => LICH_GAZE_COOLDOWN,
        }
    }
    fn first(self) -> f64 {
        match self {
            Spell::Blind => LICH_BLIND_FIRST,
            Spell::Sleep => LICH_SLEEP_FIRST,
            Spell::Gaze => LICH_GAZE_FIRST,
        }
    }
}

pub struct Lich {
    volley_cd: f64,
    summon_cd: f64,
    nova_cd: f64,
    spell_cd: [f64; SPELLS.len()],
    action: Option<(Action, f64)>,
    announced: bool,
    /// The hero the gaze is locked on while it winds up.
    gaze: Option<u32>,
    /// The hero a blind or sleep orb is aimed at while it winds up.
    aim_at: Option<u32>,
}

impl Default for Lich {
    fn default() -> Self {
        Lich { volley_cd: 2.0, summon_cd: 8.0, nova_cd: 6.0, spell_cd: SPELLS.map(|s| s.first()), action: None, announced: false, gaze: None, aim_at: None }
    }
}

pub fn living_disciples(run: &Run) -> usize {
    run.monsters.iter().filter(|m| m.alive && m.etype == Some(EnemyType::Disciple)).count()
}

impl Lich {
    /// The first spell (in `SPELLS` order) that is off cooldown and has a target: the nearest living,
    /// visible hero the lich sees and who does not already suffer its effect. Returns (spell, hero index).
    fn ready_spell(&self, run: &Run, bi: usize) -> Option<(usize, usize)> {
        let m = &run.monsters[bi];
        let (sight, at) = (m.sight_now(), m.pos);
        SPELLS.iter().enumerate().find_map(|(k, s)| {
            if self.spell_cd[k] > 0.0 {
                return None;
            }
            run.players
                .iter()
                .enumerate()
                .filter(|(pi, p)| p.alive && !run.has_effect(Creature::Player(*pi), s.effect()) && crate::run::perception::sees(run, sight, at, p.pos()))
                .min_by(|a, b| at.dist(a.1.pos()).total_cmp(&at.dist(b.1.pos())))
                .map(|(pi, _)| (k, pi))
        })
    }

    /// The nova: a dark burst that hurts every hero and ally within the radius and pushes them straight away.
    pub(crate) fn nova(run: &mut Run, pos: Vec2) {
        let r = LICH_NOVA_RADIUS;
        run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: r as f32, k: 6 }, Some(pos));
        let dmg = Damage::new(LICH_NOVA_DAMAGE, DamageSplit::pure(DamageType::Magical));
        crate::run::objects::hurt_objects_in(run, pos, r, None, dmg);
        for c in run.foes_in(pos, r, None) {
            let away = pos.angle_to(run.creature_pos(c));
            run.hurt_creature(c, dmg);
            run.knock_creature(c, pos, away, LICH_NOVA_KNOCK, BOSS_KNOCK_STR);
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
    fn gaze_target(&self) -> Option<u32> {
        self.gaze
    }

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
            run.monsters[mi].dormant = true;
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
        for c in &mut self.spell_cd {
            *c -= dt;
        }
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
                Action::Spell(s) => {
                    set_anim(run, bi, Anim::Cast);
                    match s {
                        Spell::Gaze => {
                            let target = self.gaze.take().and_then(|t| run.player_idx(t));
                            if let Some(pi) = target {
                                let sight = run.monsters[bi].sight_now();
                                let p = &run.players[pi];
                                if p.alive && crate::run::perception::sees(run, sight, pos, p.pos()) {
                                    let h = OnHit { kind: EffectKind::Petrified, secs: LICH_GAZE_SECS, chance: 1.0 };
                                    run.hurt_player(pi, Damage::physical(0.0).with_effect(h));
                                }
                            }
                        }
                        Spell::Blind | Spell::Sleep => {
                            let Some(pi) = self.aim_at.take().and_then(|t| run.player_idx(t)) else { return };
                            let dir = (run.players[pi].pos() - pos).norm();
                            let (kind, dmg, secs) = if s == Spell::Blind {
                                (EntityKind::BlindOrb, LICH_BLIND_DAMAGE, LICH_BLIND_SECS)
                            } else {
                                (EntityKind::SleepOrb, 0.0, LICH_SLEEP_SECS)
                            };
                            spawn_monster_projectile(run, id, kind, pos + dir * 8.0, dir, LICH_ORB_SPEED, dmg, 3.0, 0.0, 0, 0.0);
                            // The orb just spawned carries the effect.
                            run.projectiles.last_mut().unwrap().damage.on_hit = Some(OnHit { kind: s.effect(), secs, chance: 1.0 });
                        }
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
        } else if self.nova_cd <= 0.0 {
            // The anim starts with the wind-up; the client fills the telegraph ring over it.
            self.nova_cd = run.rng.gen_range(LICH_NOVA_EVERY.0..LICH_NOVA_EVERY.1);
            self.action = Some((Action::Nova, LICH_NOVA_WINDUP));
            set_anim(run, bi, Anim::Slam);
        } else if let Some((k, pi)) = self.ready_spell(run, bi) {
            let s = SPELLS[k];
            run.monsters[bi].aim = pos.angle_to(run.players[pi].pos());
            self.spell_cd[k] = s.cooldown();
            self.action = Some((Action::Spell(s), s.windup()));
            if s == Spell::Gaze {
                self.gaze = Some(run.players[pi].id);
                set_anim(run, bi, Anim::Gaze);
            } else {
                self.gaze = None;
                self.aim_at = Some(run.players[pi].id);
                set_anim(run, bi, Anim::Windup);
            }
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
pub(crate) mod tests {
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
    pub(crate) fn lich_with(offs: &[Vec2]) -> (Run, usize) {
        let classes = vec![ClassId::Paladin; offs.len()];
        let mut run = test_run(&classes, BossId::Lich);
        let bi = boss_idx(&run).unwrap();
        run.monsters[bi].dormant = false;
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
    fn the_nova_lights_barrels_in_range() {
        use crate::run::objects::{Barrel, ObjState};
        let (mut run, bi) = lich_with(&[Vec2::new(0.0, 30.0)]);
        run.objects.retain(|o| o.kind != EntityKind::Barrel);
        let pos = run.monsters[bi].pos;
        run.spawn_object(EntityKind::Barrel, pos + Vec2::new(LICH_NOVA_RADIUS, 0.0), ObjState::Barrel(Barrel::new()));
        run.spawn_object(EntityKind::Barrel, pos + Vec2::new(-(LICH_NOVA_RADIUS + 10.0), 0.0), ObjState::Barrel(Barrel::new()));
        Lich::nova(&mut run, pos);
        let lit: Vec<bool> = run.objects.iter().filter(|o| o.kind == EntityKind::Barrel).map(|o| matches!(&o.state, ObjState::Barrel(b) if b.fuse.is_some())).collect();
        assert_eq!(lit, vec![true, false]);
    }

    #[test]
    fn the_nova_is_magical() {
        use crate::defs::damage::Resistances;
        let (mut run, bi) = lich_with(&[Vec2::new(30.0, 0.0)]);
        run.players[0].res = Resistances::of(&[(DamageType::Magical, 1.0)]);
        let hp = run.players[0].hp;
        let pos = run.monsters[bi].pos;
        Lich::nova(&mut run, pos);
        assert_eq!(run.players[0].hp, hp, "magic resistance blocks the nova");
        run.players[0].res = Resistances::of(&[(DamageType::Heat, 1.0), (DamageType::Physical, 1.0)]);
        Lich::nova(&mut run, pos);
        assert_eq!(run.players[0].hp, hp - LICH_NOVA_DAMAGE, "heat and physical resistance do not");
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

    use crate::defs::effects::EffectKind;
    use crate::run::effects::Creature;

    fn kill_disciples(run: &mut Run) {
        let ids: Vec<u32> = run.monsters.iter().filter(|m| m.etype == Some(EnemyType::Disciple)).map(|m| m.id).collect();
        for id in ids {
            let i = run.monster_idx(id).unwrap();
            run.kill_monster(i);
        }
    }

    /// A lich whose only ready action is `spell` (everything else on cooldown).
    fn only(spell: Spell, off: Vec2) -> (Run, Lich) {
        let (mut run, _) = lich_with(&[off]);
        kill_disciples(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let mut l = Lich { volley_cd: 99.0, summon_cd: 99.0, nova_cd: 99.0, spell_cd: [99.0; SPELLS.len()], ..Lich::default() };
        l.spell_cd[SPELLS.iter().position(|&s| s == spell).unwrap()] = 0.0;
        (run, l)
    }

    fn fly(run: &mut Run, l: &mut Lich, secs: f64) {
        for _ in 0..(secs / DT).round() as usize {
            l.tick(run, DT);
            crate::run::abilities::tick_projectiles(run, DT);
            run.projectiles.retain(|p| !p.dead);
        }
    }

    #[test]
    fn the_blinding_curse_blinds_and_hurts() {
        let (mut run, mut l) = only(Spell::Blind, Vec2::new(60.0, 0.0));
        let hp = run.players[0].hp;
        fly(&mut run, &mut l, LICH_BLIND_WINDUP + 1.0);
        assert!(run.has_effect(Creature::Player(0), EffectKind::Blind));
        assert!(run.players[0].hp < hp);
    }

    #[test]
    fn the_sleep_mist_puts_a_hero_to_sleep_without_damage() {
        let (mut run, mut l) = only(Spell::Sleep, Vec2::new(60.0, 0.0));
        let hp = run.players[0].hp;
        fly(&mut run, &mut l, LICH_SLEEP_WINDUP + 1.0);
        assert!(run.has_effect(Creature::Player(0), EffectKind::Sleep));
        assert_eq!(run.players[0].hp, hp);
    }

    #[test]
    fn the_stone_gaze_petrifies_a_seen_hero_and_marks_its_target() {
        let (mut run, mut l) = only(Spell::Gaze, Vec2::new(60.0, 0.0));
        ticks(&mut run, &mut l, 0.1);
        let bi = boss_idx(&run).unwrap();
        assert_eq!(run.monsters[bi].anim, Anim::Gaze);
        assert_eq!(l.gaze_target(), Some(run.players[0].id));
        ticks(&mut run, &mut l, LICH_GAZE_WINDUP);
        assert!(run.has_effect(Creature::Player(0), EffectKind::Petrified));
    }

    #[test]
    fn a_hero_behind_a_wall_escapes_the_gaze() {
        let (mut run, mut l) = only(Spell::Gaze, Vec2::new(60.0, 0.0));
        ticks(&mut run, &mut l, 0.1);
        // Break line of sight: put the hero far outside the hall.
        run.players[0].mv.x = 4.0;
        run.players[0].mv.y = 4.0;
        let bi = boss_idx(&run).unwrap();
        let (sight, at) = (run.monsters[bi].sight_now(), run.monsters[bi].pos);
        assert!(!crate::run::perception::sees(&run, sight, at, run.players[0].pos()), "precondition: out of sight");
        ticks(&mut run, &mut l, LICH_GAZE_WINDUP);
        assert!(!run.has_effect(Creature::Player(0), EffectKind::Petrified));
    }

    #[test]
    fn blind_and_sleep_skip_a_hero_who_already_has_it() {
        let (mut run, mut l) = only(Spell::Blind, Vec2::new(60.0, 0.0));
        run.apply_effect(Creature::Player(0), EffectKind::Blind, Some(10.0));
        ticks(&mut run, &mut l, 0.1);
        let bi = boss_idx(&run).unwrap();
        assert_ne!(run.monsters[bi].anim, Anim::Windup, "no target without the effect: no cast");
    }

    #[test]
    fn the_orb_windup_faces_the_spells_target() {
        // Hero 0 is nearest but already blind, so the orb goes to hero 1 (above the lich).
        let (mut run, bi) = lich_with(&[Vec2::new(40.0, 0.0), Vec2::new(0.0, -80.0)]);
        kill_disciples(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let bi = boss_idx(&run).unwrap_or(bi);
        run.apply_effect(Creature::Player(0), EffectKind::Blind, Some(10.0));
        let mut l = Lich { volley_cd: 99.0, summon_cd: 99.0, nova_cd: 99.0, spell_cd: [99.0; SPELLS.len()], ..Lich::default() };
        l.spell_cd[SPELLS.iter().position(|&s| s == Spell::Blind).unwrap()] = 0.0;
        l.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Windup);
        let (pos, to) = (run.monsters[bi].pos, run.players[1].pos());
        assert!((run.monsters[bi].aim - pos.angle_to(to)).abs() < 1e-9, "faces the hero the orb is aimed at");
    }
}
