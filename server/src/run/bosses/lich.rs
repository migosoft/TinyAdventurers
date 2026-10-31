//! Lich: guarded by disciples. Immune until every disciple is dead. It casts the abilities of its kit and
//! decides which, when and where to aim: Gloom Bolts (a fan), now and then a Nova that hurts and pushes every
//! hero around it, and three effect spells (see `SPELLS`): Blinding Curse (dark orb), Sleep Mist (purple orb)
//! and Stone Gaze (a beam that petrifies a hero the lich still sees when the wind-up ends). It also raises
//! skeletons (melee and archers). The numbers (damage, radius, push, wind-up, cooldown) are the kit's.

use super::{ahead, boss_idx, set_anim, target, BossBehaviour};
use crate::defs::abilities::AbilityId;
use crate::defs::bosses::{LICH_ARCHERS, LICH_BLIND_FIRST, LICH_DISCIPLES, LICH_GAZE_FIRST, LICH_GLOOM_FIRST, LICH_NOVA_EXTRA_WAIT, LICH_NOVA_FIRST, LICH_SKELETONS, LICH_SLEEP_FIRST};
use crate::defs::effects::EffectKind;
use crate::defs::enemies::EnemyType;
use crate::defs::kinds::Anim;
use crate::dungeon::Mover;
use crate::math::Vec2;
use crate::protocol::Ev;
use crate::run::abilities::monster_use;
use crate::run::ai::{move_toward, path_toward};
use crate::run::effects::Creature;
use crate::run::Run;
use rand::Rng;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Action {
    Summon,
    /// The wind-up of the ability, then its cast.
    Cast(AbilityId),
}

/// The lich's effect spells, tried in this order when ready. Take one out for balancing by deleting its entry.
pub(crate) const SPELLS: [AbilityId; 3] = [AbilityId::StoneGaze, AbilityId::SleepMist, AbilityId::BlindingCurse];

/// How long (s) after the fight starts each ability may first be cast: when it opens, not how an ability works.
const OPENING: [(AbilityId, f64); 5] = [
    (AbilityId::GloomBolts, LICH_GLOOM_FIRST),
    (AbilityId::Nova, LICH_NOVA_FIRST),
    (AbilityId::StoneGaze, LICH_GAZE_FIRST),
    (AbilityId::SleepMist, LICH_SLEEP_FIRST),
    (AbilityId::BlindingCurse, LICH_BLIND_FIRST),
];

pub struct Lich {
    summon_cd: f64,
    /// Seconds before the script may choose each ability (first casts, and the Nova's random extra wait). It
    /// only gates the script's decision; the kit's cooldowns (`cds`) are the casts' alone.
    not_before: Vec<(AbilityId, f64)>,
    action: Option<(Action, f64)>,
    announced: bool,
    /// The hero the gaze is locked on while it winds up.
    gaze: Option<u32>,
    /// The hero a blind or sleep orb is aimed at while it winds up.
    aim_at: Option<u32>,
}

impl Default for Lich {
    fn default() -> Self {
        Lich { summon_cd: 8.0, not_before: OPENING.to_vec(), action: None, announced: false, gaze: None, aim_at: None }
    }
}

pub fn living_disciples(run: &Run) -> usize {
    run.monsters.iter().filter(|m| m.alive && m.etype == Some(EnemyType::Disciple)).count()
}

/// Its kit's ability `id`.
fn kit(run: &Run, bi: usize, id: AbilityId) -> crate::sheet::ResolvedAbility {
    *run.monsters[bi].kit.get(id).expect("the lich's kit has it")
}

/// The effect the spell `id` applies.
fn effect_of(run: &Run, bi: usize, id: AbilityId) -> EffectKind {
    kit(run, bi, id).effect.expect("a lich spell has its own effect").kind
}

impl Lich {
    /// Is `id` off its not-before delay and off cooldown?
    fn ready(&self, run: &Run, bi: usize, id: AbilityId) -> bool {
        run.monsters[bi].cds.ready(id) && self.not_before.iter().all(|&(i, left)| i != id || left <= 0.0)
    }

    /// The script may not choose `id` for another `secs`.
    fn hold(&mut self, id: AbilityId, secs: f64) {
        self.not_before.retain(|&(i, _)| i != id);
        self.not_before.push((id, secs));
    }

    /// The first spell (in `SPELLS` order) that is ready and has a target: the nearest living,
    /// visible hero the lich sees and who does not already suffer its effect. Returns (spell, hero index).
    fn ready_spell(&self, run: &Run, bi: usize) -> Option<(AbilityId, usize)> {
        let m = &run.monsters[bi];
        let (sight, at) = (m.sight_now(), m.pos);
        SPELLS.iter().find_map(|&s| {
            if !self.ready(run, bi, s) {
                return None;
            }
            let effect = effect_of(run, bi, s);
            run.players
                .iter()
                .enumerate()
                .filter(|(pi, p)| p.alive && !run.has_effect(Creature::Player(*pi), effect) && crate::run::perception::sees(run, sight, at, p.pos()))
                .min_by(|a, b| at.dist(a.1.pos()).total_cmp(&at.dist(b.1.pos())))
                .map(|(pi, _)| (s, pi))
        })
    }

    /// Casts `id` at `at`; the lich's cast pose plays whatever the ability's own animation is.
    fn cast(run: &mut Run, bi: usize, id: AbilityId, at: Vec2) {
        let used = monster_use(run, bi, id, at);
        debug_assert!(used, "the lich's script only picks what its kit has, off cooldown");
        // Unlike `use_in_pose`, the pose is forced: every lich ability plays the same cast pose.
        set_anim(run, bi, Anim::Cast);
    }

    /// Tops the lich's raised skeletons up to LICH_SKELETONS melee and LICH_ARCHERS archers, in a ring around it.
    fn summon(run: &mut Run, bi: usize) {
        let (id, pos) = (run.monsters[bi].id, run.monsters[bi].pos);
        let alive = |run: &Run, t: EnemyType| run.monsters.iter().filter(|m| m.alive && m.owner == Some(id) && m.etype == Some(t)).count();
        let mut raise: Vec<EnemyType> = Vec::new();
        raise.extend(std::iter::repeat(EnemyType::RaisedSkeleton).take(LICH_SKELETONS.saturating_sub(alive(run, EnemyType::RaisedSkeleton))));
        raise.extend(std::iter::repeat(EnemyType::RaisedArcher).take(LICH_ARCHERS.saturating_sub(alive(run, EnemyType::RaisedArcher))));
        let n = raise.len();
        let a0 = run.rng.gen_range(0.0..std::f64::consts::TAU);
        for (k, t) in raise.into_iter().enumerate() {
            // Alternate melee and archers around the ring.
            let slot = if k % 2 == 0 { k / 2 } else { n - 1 - k / 2 };
            let spot = pos + Vec2::from_angle(a0 + slot as f64 * std::f64::consts::TAU / n as f64) * 22.0;
            let spot = if run.layout.map.blocks_at(spot, Mover::Enemy) { pos } else { spot };
            run.spawn_enemy(t, spot, Some(id));
            run.event(Ev::Raise { x: spot.x as f32, y: spot.y as f32, k: 2 }, Some(spot));
        }
    }
}

impl BossBehaviour for Lich {
    fn gaze_target(&self) -> Option<u32> {
        self.gaze
    }

    fn spawn_extras(&mut self, run: &mut Run, boss_pos: Vec2) {
        let owner = run.level.boss().unwrap().boss_ent;
        for k in 0..LICH_DISCIPLES {
            let a = k as f64 * std::f64::consts::TAU / LICH_DISCIPLES as f64;
            let mut r = 88.0;
            let mut pos = boss_pos + Vec2::from_angle(a) * r;
            while run.layout.map.blocks_at(pos, Mover::Enemy) && r > 20.0 {
                r -= 8.0;
                pos = boss_pos + Vec2::from_angle(a) * r;
            }
            let id = run.spawn_enemy(EnemyType::Disciple, pos, Some(owner));
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
        if living_disciples(run) == 0 && !self.announced {
            self.announced = true;
            run.event(Ev::Msg { text: "The lich's protection is broken!".into() }, None);
        }
        self.summon_cd -= dt;
        for (_, left) in &mut self.not_before {
            *left -= dt;
        }
        let pos = run.monsters[bi].pos;

        if let Some((action, t)) = self.action {
            let t = t - dt;
            if t > 0.0 {
                self.action = Some((action, t));
                return;
            }
            self.action = None;
            match action {
                Action::Summon => {
                    set_anim(run, bi, Anim::Cast);
                    Self::summon(run, bi);
                }
                Action::Cast(AbilityId::StoneGaze) => {
                    // The hero it stared at; one that has left is not gazed at.
                    if let Some(pi) = self.gaze.take().and_then(|t| run.player_idx(t)) {
                        Self::cast(run, bi, AbilityId::StoneGaze, run.players[pi].pos());
                    }
                }
                Action::Cast(id @ (AbilityId::SleepMist | AbilityId::BlindingCurse)) => {
                    if let Some(pi) = self.aim_at.take().and_then(|t| run.player_idx(t)) {
                        Self::cast(run, bi, id, run.players[pi].pos());
                    }
                }
                Action::Cast(id) => {
                    Self::cast(run, bi, id, ahead(run, bi));
                    if id == AbilityId::Nova {
                        self.hold(id, run.rng.gen_range(0.0..LICH_NOVA_EXTRA_WAIT));
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
        } else if self.ready(run, bi, AbilityId::Nova) {
            // The anim starts with the wind-up; the client fills the telegraph ring over it.
            self.action = Some((Action::Cast(AbilityId::Nova), kit(run, bi, AbilityId::Nova).windup));
            set_anim(run, bi, Anim::Slam);
        } else if let Some((s, pi)) = self.ready_spell(run, bi) {
            run.monsters[bi].aim = pos.angle_to(run.players[pi].pos());
            self.action = Some((Action::Cast(s), kit(run, bi, s).windup));
            if s == AbilityId::StoneGaze {
                self.gaze = Some(run.players[pi].id);
                set_anim(run, bi, Anim::Gaze);
            } else {
                self.gaze = None;
                self.aim_at = Some(run.players[pi].id);
                set_anim(run, bi, Anim::Windup);
            }
        } else if self.ready(run, bi, AbilityId::GloomBolts) {
            self.action = Some((Action::Cast(AbilityId::GloomBolts), kit(run, bi, AbilityId::GloomBolts).windup));
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
    use crate::defs::attributes::push_dist;
    use crate::defs::damage::{Damage, DamageType};
    use crate::defs::kinds::EntityKind;
    use crate::protocol::{BossId, ClassId};
    use crate::run::tests::test_run;
    use crate::run::DT;

    /// The lich's own abilities, apart from the spells.
    const OTHERS: [AbilityId; 2] = [AbilityId::Nova, AbilityId::GloomBolts];

    #[test]
    fn lich_spawns_with_at_least_five_disciples_and_is_immune_until_they_die() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        assert!(living_disciples(&run) >= 5);
        let bi = boss_idx(&run).unwrap();
        let hp = run.monsters[bi].hp;
        assert!(!run.hurt_monster(bi, Damage::physical(100.0), false, Some(0)));
        assert_eq!(run.monsters[bi].hp, hp, "immune while disciples live");

        kill_disciples(&mut run);
        let bi = boss_idx(&run).unwrap();
        let before = run.monsters[bi].hp;
        assert!(run.hurt_monster(bi, Damage::physical(100.0), false, Some(0)));
        assert_eq!(run.monsters[bi].hp, before - 50.0, "the lich resists physical damage by half");
    }

    #[test]
    fn the_lich_no_longer_heals_from_disciples() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        assert!(living_disciples(&run) >= 5);
        let bi = boss_idx(&run).unwrap();
        let hurt = run.monsters[bi].hp - 200.0;
        run.monsters[bi].hp = hurt;
        run.level.boss_mut().unwrap().awake = true;
        for _ in 0..120 {
            run.step();
        }
        let bi = boss_idx(&run).unwrap();
        assert_eq!(run.monsters[bi].hp, hurt, "no drain from the living disciples");
    }

    /// A lich with its heroes (of `classes`) placed at `offs` from it, awake and facing right.
    pub(crate) fn lich_with_classes(classes: &[ClassId], offs: &[Vec2]) -> (Run, usize) {
        let mut run = test_run(classes, BossId::Lich);
        let bi = boss_idx(&run).unwrap();
        run.monsters[bi].dormant = false;
        let at = run.monsters[bi].pos;
        for (p, off) in run.players.iter_mut().zip(offs) {
            p.mv.x = at.x + off.x;
            p.mv.y = at.y + off.y;
        }
        (run, bi)
    }

    /// A lich with Paladins placed at `offs` from it, awake and facing right.
    pub(crate) fn lich_with(offs: &[Vec2]) -> (Run, usize) {
        lich_with_classes(&vec![ClassId::Paladin; offs.len()], offs)
    }

    fn ticks(run: &mut Run, l: &mut Lich, secs: f64) {
        for _ in 0..(secs / DT).round() as usize {
            l.tick(run, DT);
        }
    }

    fn nova_of(run: &Run, bi: usize) -> crate::sheet::ResolvedAbility {
        kit(run, bi, AbilityId::Nova)
    }

    /// The lich casts its Nova now, whatever its cooldown.
    pub(crate) fn nova(run: &mut Run, bi: usize) {
        run.monsters[bi].cds = Default::default();
        let pos = run.monsters[bi].pos;
        assert!(monster_use(run, bi, AbilityId::Nova, pos));
    }

    #[test]
    fn the_nova_lights_barrels_in_range() {
        use crate::run::objects::{Barrel, ObjState};
        let (mut run, bi) = lich_with(&[Vec2::new(0.0, 30.0)]);
        run.objects.retain(|o| o.kind != EntityKind::Barrel);
        let pos = run.monsters[bi].pos;
        let radius = nova_of(&run, bi).radius;
        run.spawn_object(EntityKind::Barrel, pos + Vec2::new(radius, 0.0), ObjState::Barrel(Barrel::new()));
        run.spawn_object(EntityKind::Barrel, pos + Vec2::new(-(radius + 10.0), 0.0), ObjState::Barrel(Barrel::new()));
        nova(&mut run, bi);
        let lit: Vec<bool> = run.objects.iter().filter(|o| o.kind == EntityKind::Barrel).map(|o| matches!(&o.state, ObjState::Barrel(b) if b.fuse.is_some())).collect();
        assert_eq!(lit, vec![true, false]);
    }

    #[test]
    fn the_nova_is_magical() {
        use crate::defs::damage::Resistances;
        let (mut run, bi) = lich_with(&[Vec2::new(30.0, 0.0)]);
        run.players[0].res = Resistances::of(&[(DamageType::Magical, 1.0)]);
        let hp = run.players[0].hp;
        nova(&mut run, bi);
        assert_eq!(run.players[0].hp, hp, "magic resistance blocks the nova");
        run.players[0].res = Resistances::of(&[(DamageType::Heat, 1.0), (DamageType::Physical, 1.0)]);
        nova(&mut run, bi);
        assert_eq!(run.players[0].hp, hp - nova_of(&run, bi).damage, "heat and physical resistance do not");
    }

    #[test]
    fn the_nova_winds_up_then_hurts_every_hero_around() {
        let (mut run, bi) = lich_with(&[Vec2::new(30.0, 0.0)]);
        for id in SPELLS.into_iter().chain([AbilityId::GloomBolts]) {
            run.monsters[bi].cds.start(id, 99.0);
        }
        let mut l = Lich { summon_cd: 99.0, not_before: Vec::new(), ..Lich::default() };
        let (hp, nova) = (run.players[0].hp, nova_of(&run, bi));
        assert_eq!((nova.damage, nova.windup, nova.radius), (24.0, 1.2, 56.0), "today's nova");
        l.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Slam, "the wind-up shows the telegraph");
        ticks(&mut run, &mut l, nova.windup - 0.1);
        assert_eq!(run.players[0].hp, hp, "nothing before the wind-up ends");
        run.events.clear();
        // Up to the tick the wind-up ends on.
        while l.action.is_some() {
            l.tick(&mut run, DT);
        }
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Boom { k: 6, .. })), "nova event");
        assert_eq!(run.players[0].hp, hp - nova.damage);
        assert_eq!(run.monsters[bi].anim, Anim::Cast, "the lich casts it");
        assert!(!run.monsters[bi].cds.ready(AbilityId::Nova), "its cooldown runs from the cast");
        let (_, extra) = *l.not_before.iter().find(|&&(i, _)| i == AbilityId::Nova).expect("a random extra wait");
        assert!((0.0..LICH_NOVA_EXTRA_WAIT).contains(&extra), "{extra}");
    }

    #[test]
    fn the_nova_pushes_with_the_lichs_own_str() {
        // The lich keeps STR 10 (user's ruling): only a hero lighter than that is pushed, and a Wizard
        // (weight 9) barely.
        let (mut run, bi) = lich_with_classes(&[ClassId::Wizard, ClassId::Paladin], &[Vec2::new(30.0, 0.0), Vec2::new(0.0, 30.0)]);
        let ability = nova_of(&run, bi);
        assert_eq!(ability.push_str, 10, "the lich's own STR");
        let (wizard, paladin) = (run.players[0].sheet.weight, run.players[1].sheet.weight);
        assert!(wizard < 10.0 && paladin >= 10.0, "{wizard} {paladin}");
        nova(&mut run, bi);
        let pushed = push_dist(ability.push, 10, wizard);
        assert!(pushed > 0.0 && pushed < ability.push, "{pushed}");
        assert_eq!(run.players[0].mv.knock_vx, crate::collision::knock_speed(pushed, DT), "pushed straight away at STR 10");
        assert!(run.players[0].mv.knock_vx > 0.0);
        assert!(!run.players[1].mv.knocked(), "a hero as heavy as the lich is not moved");
    }

    #[test]
    fn the_nova_spares_heroes_outside() {
        let (mut run, bi) = lich_with(&[Vec2::new(nova_radius() + 8.0, 0.0)]);
        let hp = run.players[0].hp;
        nova(&mut run, bi);
        assert_eq!(run.players[0].hp, hp);
        assert!(!run.players[0].mv.knocked());
    }

    fn nova_radius() -> f64 {
        crate::sheet::boss_kit(BossId::Lich).get(AbilityId::Nova).unwrap().radius
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
        let (mut run, bi) = lich_with(&[Vec2::new(100.0, 0.0)]);
        let mut l = Lich { summon_cd: 99.0, not_before: vec![(AbilityId::Nova, 99.0)], ..Lich::default() };
        l.not_before.retain(|&(i, _)| i != AbilityId::GloomBolts);
        for s in SPELLS {
            run.monsters[bi].cds.start(s, 99.0);
        }
        let gloom = kit(&run, bi, AbilityId::GloomBolts);
        ticks(&mut run, &mut l, gloom.windup + 0.1);
        let bolts: Vec<_> = run.projectiles.iter().filter(|p| !p.dead).collect();
        assert_eq!(bolts.len(), 5);
        assert!(bolts.iter().all(|p| p.kind == EntityKind::GloomBolt && p.damage.amount == 10.0));
        assert!(!run.monsters[bi].cds.ready(AbilityId::GloomBolts), "its cooldown runs from the cast");
    }

    use crate::defs::effects::EffectKind;

    fn kill_disciples(run: &mut Run) {
        let ids: Vec<u32> = run.monsters.iter().filter(|m| m.etype == Some(EnemyType::Disciple)).map(|m| m.id).collect();
        for id in ids {
            let i = run.monster_idx(id).unwrap();
            run.kill_monster(i);
        }
    }

    /// A lich whose only ready ability is `ready` (everything else on cooldown, nothing waiting).
    fn only(ready: AbilityId, off: Vec2) -> (Run, Lich) {
        let (mut run, bi) = lich_with(&[off]);
        kill_disciples(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let bi = boss_idx(&run).unwrap_or(bi);
        for id in OTHERS.into_iter().chain(SPELLS) {
            if id != ready {
                run.monsters[bi].cds.start(id, 99.0);
            }
        }
        (run, Lich { summon_cd: 99.0, not_before: Vec::new(), ..Lich::default() })
    }

    fn fly(run: &mut Run, l: &mut Lich, secs: f64) {
        for _ in 0..(secs / DT).round() as usize {
            l.tick(run, DT);
            crate::run::abilities::tick_projectiles(run, DT);
            run.projectiles.retain(|p| !p.dead);
        }
    }

    fn windup(run: &Run, id: AbilityId) -> f64 {
        kit(run, boss_idx(run).unwrap(), id).windup
    }

    #[test]
    fn the_spells_are_the_shared_abilities_in_their_order() {
        assert_eq!(SPELLS, [AbilityId::StoneGaze, AbilityId::SleepMist, AbilityId::BlindingCurse]);
    }

    #[test]
    fn the_spells_wait_for_their_first_cast_delays() {
        // No hero in sight: the script only counts its delays down.
        let (mut run, bi) = lich_with(&[Vec2::new(60.0, 0.0)]);
        run.players[0].mv.x = 4.0;
        run.players[0].mv.y = 4.0;
        let mut l = Lich::default();
        ticks(&mut run, &mut l, LICH_BLIND_FIRST - 0.1);
        assert!(!l.ready(&run, bi, AbilityId::BlindingCurse));
        ticks(&mut run, &mut l, 0.2);
        assert!(l.ready(&run, bi, AbilityId::BlindingCurse), "off its delay after {LICH_BLIND_FIRST} s");
        assert!(!l.ready(&run, bi, AbilityId::SleepMist) && !l.ready(&run, bi, AbilityId::StoneGaze));
        ticks(&mut run, &mut l, LICH_GAZE_FIRST - LICH_BLIND_FIRST);
        assert!(l.ready(&run, bi, AbilityId::SleepMist) && l.ready(&run, bi, AbilityId::StoneGaze));
        // The kit's own cooldown still gates it.
        run.monsters[bi].cds.start(AbilityId::StoneGaze, 5.0);
        assert!(!l.ready(&run, bi, AbilityId::StoneGaze));
    }

    #[test]
    fn the_blinding_curse_blinds_and_hurts() {
        let (mut run, mut l) = only(AbilityId::BlindingCurse, Vec2::new(60.0, 0.0));
        let hp = run.players[0].hp;
        let w = windup(&run, AbilityId::BlindingCurse);
        assert_eq!(w, 0.6);
        fly(&mut run, &mut l, w + 1.0);
        assert!(run.has_effect(Creature::Player(0), EffectKind::Blind));
        assert!(run.players[0].hp < hp);
    }

    #[test]
    fn the_sleep_mist_puts_a_hero_to_sleep_without_damage() {
        let (mut run, mut l) = only(AbilityId::SleepMist, Vec2::new(60.0, 0.0));
        let hp = run.players[0].hp;
        let w = windup(&run, AbilityId::SleepMist);
        assert_eq!(w, 0.8);
        fly(&mut run, &mut l, w + 1.0);
        assert!(run.has_effect(Creature::Player(0), EffectKind::Sleep));
        assert_eq!(run.players[0].hp, hp);
    }

    #[test]
    fn the_stone_gaze_petrifies_a_seen_hero_and_marks_its_target() {
        let (mut run, mut l) = only(AbilityId::StoneGaze, Vec2::new(60.0, 0.0));
        ticks(&mut run, &mut l, 0.1);
        let bi = boss_idx(&run).unwrap();
        assert_eq!(run.monsters[bi].anim, Anim::Gaze);
        assert_eq!(l.gaze_target(), Some(run.players[0].id));
        let w = windup(&run, AbilityId::StoneGaze);
        assert_eq!(w, 1.0);
        ticks(&mut run, &mut l, w);
        assert!(run.has_effect(Creature::Player(0), EffectKind::Petrified));
        assert_eq!(l.gaze_target(), None, "the lock ends with the gaze");
        assert!(!run.monsters[bi].cds.ready(AbilityId::StoneGaze), "its cooldown runs from the cast");
    }

    #[test]
    fn the_gaze_is_a_magical_hit_at_the_lich_int() {
        use crate::defs::attributes::Attr;
        use crate::defs::effects::scaled_secs;
        let (mut run, mut l) = only(AbilityId::StoneGaze, Vec2::new(60.0, 0.0));
        let bi = boss_idx(&run).unwrap();
        assert_eq!(run.monsters[bi].attrs.get(Attr::Int), 22, "the lich's INT from its stat block");
        let gaze = kit(&run, bi, AbilityId::StoneGaze);
        let h = gaze.effect.expect("its own effect");
        assert!(h.magical);
        assert_eq!((h.power, h.secs), (22, 3.0));
        // The real gaze: the Paladin (WIL 12) is petrified for the scaled time, not the base 3 s.
        ticks(&mut run, &mut l, gaze.windup + 0.1);
        let left = run.players[0].effects.list().iter().find(|e| e.kind == EffectKind::Petrified).expect("petrified").left;
        let wil = run.players[0].sheet.attrs.get(Attr::Wil);
        assert!((left - scaled_secs(3.0, 22, wil)).abs() < 1e-9, "left {left}");
        assert!(left > 3.0);
    }

    #[test]
    fn the_orbs_carry_a_magical_hit_at_the_lich_int() {
        for (spell, kind) in [(AbilityId::BlindingCurse, EffectKind::Blind), (AbilityId::SleepMist, EffectKind::Sleep)] {
            let (mut run, mut l) = only(spell, Vec2::new(60.0, 0.0));
            let mut hit = None;
            for _ in 0..((windup(&run, spell) + 1.0) / DT) as usize {
                l.tick(&mut run, DT);
                if let Some(p) = run.projectiles.iter().find(|p| !p.dead) {
                    hit = p.damage.on_hit;
                    break;
                }
            }
            let h = hit.unwrap_or_else(|| panic!("{spell:?} orb carries an effect"));
            assert_eq!(h.kind, kind);
            assert!(h.magical, "{spell:?}");
            assert_eq!(h.power, 22, "{spell:?}");
        }
    }

    #[test]
    fn a_hero_behind_a_wall_escapes_the_gaze() {
        let (mut run, mut l) = only(AbilityId::StoneGaze, Vec2::new(60.0, 0.0));
        ticks(&mut run, &mut l, 0.1);
        // Break line of sight: put the hero far outside the hall.
        run.players[0].mv.x = 4.0;
        run.players[0].mv.y = 4.0;
        let bi = boss_idx(&run).unwrap();
        let (sight, at) = (run.monsters[bi].sight_now(), run.monsters[bi].pos);
        assert!(!crate::run::perception::sees(&run, sight, at, run.players[0].pos()), "precondition: out of sight");
        let w = windup(&run, AbilityId::StoneGaze);
        ticks(&mut run, &mut l, w);
        assert!(!run.has_effect(Creature::Player(0), EffectKind::Petrified));
    }

    #[test]
    fn blind_and_sleep_skip_a_hero_who_already_has_it() {
        let (mut run, mut l) = only(AbilityId::BlindingCurse, Vec2::new(60.0, 0.0));
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
        for id in OTHERS.into_iter().chain(SPELLS) {
            if id != AbilityId::BlindingCurse {
                run.monsters[bi].cds.start(id, 99.0);
            }
        }
        let mut l = Lich { summon_cd: 99.0, not_before: Vec::new(), ..Lich::default() };
        l.tick(&mut run, DT);
        assert_eq!(run.monsters[bi].anim, Anim::Windup);
        let (pos, to) = (run.monsters[bi].pos, run.players[1].pos());
        assert!((run.monsters[bi].aim - pos.angle_to(to)).abs() < 1e-9, "faces the hero the orb is aimed at");
    }
}
