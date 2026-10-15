//! Status effects at run time: the timers on each creature and the only
//! API other code uses to touch them. Data: `defs/effects.rs`.

use crate::defs::damage::{DamageType, Resistances};
use crate::defs::effects::{def, resolve_stat, EffectKind, EffectResponse, Stat, EFFECT_REDUCED};
use crate::defs::entity_types::Sight;
use crate::protocol::Ev;
use crate::run::{Run, DT};

pub use crate::defs::effects::OnHit;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ActiveEffect {
    pub kind: EffectKind,
    /// Seconds left.
    pub left: f64,
}

/// The effects on one creature (a handful at most) and its stats through them.
#[derive(Debug, Clone, Default)]
pub struct Effects(Vec<ActiveEffect>);

impl Effects {
    pub fn list(&self) -> &[ActiveEffect] {
        &self.0
    }
    pub fn has(&self, k: EffectKind) -> bool {
        self.0.iter().any(|a| a.kind == k)
    }
    pub fn kinds(&self) -> Vec<EffectKind> {
        self.0.iter().map(|a| a.kind).collect()
    }
    pub fn bits(&self) -> u16 {
        self.0.iter().fold(0, |b, a| b | a.kind.bit())
    }
    /// Refresh: the longer of the remaining and the new time. True when newly added.
    pub fn add(&mut self, k: EffectKind, secs: f64) -> bool {
        if let Some(a) = self.0.iter_mut().find(|a| a.kind == k) {
            a.left = a.left.max(secs);
            return false;
        }
        self.0.push(ActiveEffect { kind: k, left: secs });
        true
    }
    pub fn remove(&mut self, k: EffectKind) -> bool {
        let n = self.0.len();
        self.0.retain(|a| a.kind != k);
        self.0.len() != n
    }
    /// Counts down; returns the kinds that ran out (removed).
    fn tick(&mut self, dt: f64) -> Vec<EffectKind> {
        for a in &mut self.0 {
            a.left -= dt;
        }
        let gone: Vec<EffectKind> = self.0.iter().filter(|a| a.left <= 0.0).map(|a| a.kind).collect();
        self.0.retain(|a| a.left > 0.0);
        gone
    }
    fn take_all(&mut self) -> Vec<EffectKind> {
        std::mem::take(&mut self.0).into_iter().map(|a| a.kind).collect()
    }
    fn any(&self, f: impl Fn(&crate::defs::effects::EffectDef) -> bool) -> bool {
        self.0.iter().any(|a| f(&def(a.kind)))
    }
    pub fn no_move(&self) -> bool {
        self.any(|d| d.no_move)
    }
    pub fn no_act(&self) -> bool {
        self.any(|d| d.no_act)
    }
    pub fn no_turn(&self) -> bool {
        self.any(|d| d.no_turn)
    }
    /// Factor on the creature's move speed; 0 while it cannot move.
    pub fn speed_mul(&self) -> f64 {
        if self.no_move() {
            return 0.0;
        }
        resolve_stat(1.0, Stat::MoveSpeed, &self.kinds())
    }
    pub fn sight(&self, base: Sight) -> Sight {
        let k = self.kinds();
        Sight { vision: resolve_stat(base.vision, Stat::Vision, &k), darkvision: resolve_stat(base.darkvision, Stat::Darkvision, &k) }
    }
    pub fn res(&self, base: Resistances) -> Resistances {
        let k = self.kinds();
        let mut r = base;
        for t in DamageType::ALL {
            r.set(t, resolve_stat(base.get(t), Stat::Resist(t), &k));
        }
        r
    }
    pub fn knock_taken(&self) -> f64 {
        resolve_stat(1.0, Stat::KnockTaken, &self.kinds())
    }
}

/// Who an effect is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Creature {
    Player(usize),
    Monster(usize),
}

impl Run {
    fn creature(&mut self, c: Creature) -> Option<(&mut Effects, u32, crate::math::Vec2, bool)> {
        match c {
            Creature::Player(i) => {
                let p = self.players.get_mut(i)?;
                let ok = p.alive && p.sinking.is_none();
                let pos = p.pos();
                Some((&mut p.effects, p.id, pos, ok))
            }
            Creature::Monster(i) => {
                let m = self.monsters.get_mut(i)?;
                let ok = m.alive && m.sinking.is_none();
                Some((&mut m.effects, m.id, m.pos, ok))
            }
        }
    }

    fn effect_event(&mut self, c: Creature, id: u32, pos: crate::math::Vec2, k: EffectKind, on: bool) {
        let ev = Ev::Effect { id, kind: k as u8, on };
        match c {
            Creature::Player(_) => self.event_on_hero(ev, pos),
            Creature::Monster(_) => self.event(ev, Some(pos)),
        }
    }

    /// Puts `kind` on a creature for `secs` (default: its def's duration),
    /// shortened or refused by the creature's response. Dead or sinking
    /// creatures take nothing. True when the effect is on afterwards.
    pub fn apply_effect(&mut self, c: Creature, kind: EffectKind, secs: Option<f64>) -> bool {
        let response = match c {
            Creature::Player(_) => EffectResponse::Full,
            Creature::Monster(i) => self.monsters.get(i).map_or(EffectResponse::Immune, |m| m.responses.get(kind)),
        };
        let mut secs = secs.unwrap_or(def(kind).duration);
        match response {
            EffectResponse::Immune => return false,
            EffectResponse::Reduced => secs *= EFFECT_REDUCED,
            EffectResponse::Full => {}
        }
        let Some((fx, id, pos, ok)) = self.creature(c) else { return false };
        if !ok || secs <= 0.0 {
            return false;
        }
        if fx.add(kind, secs) {
            self.effect_event(c, id, pos, kind, true);
        }
        true
    }

    pub fn remove_effect(&mut self, c: Creature, kind: EffectKind) -> bool {
        let Some((fx, id, pos, _)) = self.creature(c) else { return false };
        let removed = fx.remove(kind);
        if removed {
            self.effect_event(c, id, pos, kind, false);
        }
        removed
    }

    pub fn has_effect(&self, c: Creature, kind: EffectKind) -> bool {
        match c {
            Creature::Player(i) => self.players.get(i).is_some_and(|p| p.effects.has(kind)),
            Creature::Monster(i) => self.monsters.get(i).is_some_and(|m| m.effects.has(kind)),
        }
    }

    /// A hit's effect: rolled on the run's rng unless certain (chance >= 1 draws nothing).
    pub fn hit_effect(&mut self, c: Creature, h: OnHit) {
        let lands = h.chance >= 1.0 || (h.chance > 0.0 && rand::Rng::gen::<f64>(&mut self.rng) < h.chance);
        if lands {
            self.apply_effect(c, h.kind, Some(h.secs));
        }
    }

    /// Damage ends effects that break on it (none yet).
    pub fn damage_wakes(&mut self, c: Creature) {
        let kinds = match c {
            Creature::Player(i) => self.players[i].effects.kinds(),
            Creature::Monster(i) => self.monsters[i].effects.kinds(),
        };
        for k in kinds.into_iter().filter(|&k| def(k).wakes_on_damage) {
            self.remove_effect(c, k);
        }
    }

    /// Once per step: timers count down; the dead and sinking lose everything.
    pub fn tick_effects(&mut self) {
        let n = (self.players.len(), self.monsters.len());
        let all = (0..n.0).map(Creature::Player).chain((0..n.1).map(Creature::Monster));
        for c in all.collect::<Vec<_>>() {
            let Some((fx, id, pos, ok)) = self.creature(c) else { continue };
            if fx.list().is_empty() {
                continue;
            }
            let gone = if ok { fx.tick(DT) } else { fx.take_all() };
            for k in gone {
                self.effect_event(c, id, pos, k, false);
            }
        }
    }

    /// E next to a teammate with a `wakes_on_use` effect (asleep) ends those
    /// effects. True when someone was woken; waking beats using an object.
    pub fn wake_teammate(&mut self, pi: usize) -> bool {
        use crate::defs::{classes::PLAYER_RADIUS, objects::USE_REACH};
        let at = self.players[pi].pos();
        let near = self
            .players
            .iter()
            .enumerate()
            .filter(|&(qi, q)| qi != pi && q.alive && q.effects.list().iter().any(|a| def(a.kind).wakes_on_use))
            .map(|(qi, q)| (qi, q.pos().dist(at) - 2.0 * PLAYER_RADIUS))
            .filter(|&(_, gap)| gap <= USE_REACH)
            .min_by(|a, b| a.1.total_cmp(&b.1));
        let Some((qi, _)) = near else { return false };
        for k in self.players[qi].effects.kinds().into_iter().filter(|&k| def(k).wakes_on_use) {
            self.remove_effect(Creature::Player(qi), k);
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{BossId, ClassId, Ev};
    use crate::defs::damage::{Damage, DamageSplit};
    use crate::run::tests::test_run;
    use crate::run::DT;

    fn boss(run: &crate::run::Run) -> usize {
        run.monsters.iter().position(|m| m.is_boss).unwrap()
    }

    #[test]
    fn apply_adds_refreshes_to_the_longer_timer_and_expires() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let me = Creature::Player(0);
        run.events.clear();
        assert!(run.apply_effect(me, EffectKind::Slowed, Some(1.0)));
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Effect { kind: 3, on: true, .. })));
        run.apply_effect(me, EffectKind::Slowed, Some(0.5));
        assert_eq!(run.players[0].effects.list()[0].left, 1.0, "refresh keeps the longer timer");
        run.apply_effect(me, EffectKind::Slowed, Some(2.0));
        assert_eq!(run.players[0].effects.list()[0].left, 2.0);
        assert_eq!(run.players[0].effects.list().len(), 1);
        run.events.clear();
        for _ in 0..(2.0 / DT).round() as usize + 1 {
            run.tick_effects();
        }
        assert!(!run.has_effect(me, EffectKind::Slowed));
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Effect { kind: 3, on: false, .. })));
    }

    #[test]
    fn boss_responses_follow_the_table() {
        for (b, sleep, blind, petrify) in [
            (BossId::Lich, None, None, Some(1.5)),
            (BossId::Dragon, None, Some(1.5), Some(1.5)),
            (BossId::Demon, None, Some(3.0), Some(3.0)),
        ] {
            let mut run = test_run(&[ClassId::Wizard], b);
            let c = Creature::Monster(boss(&run));
            for (k, want) in [(EffectKind::Sleep, sleep), (EffectKind::Blind, blind), (EffectKind::Petrified, petrify)] {
                run.apply_effect(c, k, Some(3.0));
                let got = run.monsters[boss(&run)].effects.list().iter().find(|a| a.kind == k).map(|a| a.left);
                assert_eq!(got, want, "{b:?} {k:?}");
            }
        }
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let at = run.players[0].pos();
        let id = run.spawn_enemy(crate::defs::enemies::EnemyType::Ogre, at, None, 1);
        let mi = run.monster_idx(id).unwrap();
        for k in EffectKind::ALL {
            assert!(run.apply_effect(Creature::Monster(mi), k, Some(3.0)), "the ogre takes {k:?} in full");
        }
    }

    #[test]
    fn a_dead_hero_loses_every_effect() {
        let mut run = test_run(&[ClassId::Paladin, ClassId::Wizard], BossId::Demon);
        run.apply_effect(Creature::Player(0), EffectKind::Sleep, None);
        run.apply_effect(Creature::Player(0), EffectKind::Petrified, None);
        run.hurt_player(0, crate::defs::damage::Damage::physical(10_000.0));
        run.tick_effects();
        assert!(run.players[0].effects.list().is_empty());
        assert!(!run.apply_effect(Creature::Player(0), EffectKind::Blind, None), "the dead take no effects");
    }

    #[test]
    fn stats_follow_the_active_effects() {
        let mut e = Effects::default();
        assert_eq!(e.speed_mul(), 1.0);
        e.add(EffectKind::Slowed, 1.0);
        e.add(EffectKind::Accelerated, 1.0);
        assert!((e.speed_mul() - 0.75).abs() < 1e-12);
        e.add(EffectKind::Petrified, 1.0);
        assert_eq!(e.speed_mul(), 0.0, "no_move stops even an accelerated creature");
        assert!(e.no_act() && e.no_turn() && !e.has(EffectKind::Blind));
        assert_eq!(e.bits(), EffectKind::Slowed.bit() | EffectKind::Accelerated.bit() | EffectKind::Petrified.bit());
        let s = e.sight(crate::defs::entity_types::Sight { vision: 9.0, darkvision: 0.5 });
        assert_eq!(s.vision, 9.0);
        e.add(EffectKind::Blind, 1.0);
        let s = e.sight(crate::defs::entity_types::Sight { vision: 9.0, darkvision: 0.5 });
        assert_eq!((s.vision, s.darkvision), (0.0, 0.0));
    }

    use crate::math::Vec2;
    use crate::run::entities::AiState;

    fn walk(run: &mut crate::run::Run, mx: i8) {
        let seq = run.players[0].ack + 1;
        run.players[0].inputs.push_back(crate::protocol::InputMsg { seq, mx, my: 0, aim: 1.0, aim_dist: 30.0, primary: None, secondary: None, view_lag: 0, rtt: 0, act: false });
        run.step();
    }

    fn open(run: &mut crate::run::Run) {
        run.monsters.clear();
        run.objects.clear();
    }

    #[test]
    fn slowed_and_accelerated_heroes_walk_at_their_speed() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        open(&mut run);
        let x0 = run.players[0].mv.x;
        walk(&mut run, 1);
        let base = run.players[0].mv.x - x0;
        run.apply_effect(Creature::Player(0), EffectKind::Slowed, Some(5.0));
        let x1 = run.players[0].mv.x;
        walk(&mut run, 1);
        assert!(((run.players[0].mv.x - x1) - base * 0.5).abs() < 1e-6);
        run.apply_effect(Creature::Player(0), EffectKind::Sleep, Some(5.0));
        let x2 = run.players[0].mv.x;
        walk(&mut run, 1);
        assert_eq!(run.players[0].mv.x, x2, "asleep: no moves");
    }

    #[test]
    fn a_petrified_hero_slides_shorter_and_cannot_dash_attack_or_turn() {
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        open(&mut run);
        let from = run.players[0].pos() - Vec2::new(10.0, 0.0);
        let mut free = test_run(&[ClassId::Barbarian], BossId::Demon);
        open(&mut free);
        free.knock_player(0, from, 0.0, 40.0);
        run.apply_effect(Creature::Player(0), EffectKind::Petrified, Some(5.0));
        run.knock_player(0, from, 0.0, 40.0);
        let (a, b) = (free.players[0].mv.knock_vx, run.players[0].mv.knock_vx);
        assert!(b > 0.0 && b < a, "still pushed, but less: {b} < {a}");
        // Let the slide end, then try to act and turn.
        for _ in 0..120 {
            walk(&mut run, 0);
        }
        let aim = run.players[0].aim;
        let seq = run.players[0].ack + 1;
        run.players[0].inputs.push_back(crate::protocol::InputMsg { seq, mx: 1, my: 0, aim: aim as f32 + 1.0, aim_dist: 30.0, primary: Some(1), secondary: Some(2), view_lag: 0, rtt: 0, act: true });
        run.step();
        let p = &run.players[0];
        assert_eq!((p.cd1, p.cd2, p.mv.dash_t), (0.0, 0.0, 0.0), "no abilities");
        assert_eq!(p.aim, aim, "no turning");
    }

    #[test]
    fn petrified_heroes_take_a_quarter_of_physical_and_half_of_magic() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.apply_effect(Creature::Player(0), EffectKind::Petrified, Some(5.0));
        let hp = run.players[0].hp;
        run.hurt_player(0, Damage::physical(20.0));
        assert!((hp - run.players[0].hp - 5.0).abs() < 1e-9);
        let hp = run.players[0].hp;
        run.hurt_player(0, Damage::new(20.0, DamageSplit::pure(DamageType::Magical)));
        assert!((hp - run.players[0].hp - 10.0).abs() < 1e-9);
    }

    #[test]
    fn a_blind_monster_sees_no_one_and_an_asleep_one_does_nothing() {
        use crate::defs::enemies::EnemyType;
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        open(&mut run);
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        let id = run.spawn_enemy(EnemyType::SkeletonArcher, at, None, 1);
        let mi = run.monster_idx(id).unwrap();
        run.apply_effect(Creature::Monster(mi), EffectKind::Blind, Some(5.0));
        crate::run::ai::tick_monster(&mut run, mi, DT);
        assert_ne!(run.monsters[mi].ai.state, AiState::Chase, "blind: the hero 40 px away is not seen");
        run.remove_effect(Creature::Monster(mi), EffectKind::Blind);
        crate::run::ai::tick_monster(&mut run, mi, DT);
        assert_eq!(run.monsters[mi].ai.state, AiState::Chase);
        run.monsters[mi].ai.windup = Some(crate::run::entities::Windup { t: 0.2, aim: 0.0, alt: false, at: None });
        run.apply_effect(Creature::Monster(mi), EffectKind::Sleep, Some(5.0));
        let pos = run.monsters[mi].pos;
        for _ in 0..30 {
            run.step();
        }
        let mi = run.monster_idx(id).unwrap();
        assert!(run.monsters[mi].ai.windup.is_none(), "the wind-up is cancelled");
        assert_eq!(run.monsters[mi].pos, pos, "it does not move");
        assert!(run.projectiles.iter().all(|p| p.owner != id), "and does not shoot");
    }

    #[test]
    fn a_blind_hero_is_sent_no_enemies() {
        use crate::defs::enemies::EnemyType;
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        open(&mut run);
        let at = run.players[0].pos() + Vec2::new(20.0, 0.0);
        run.spawn_enemy(EnemyType::OrcWarrior, at, None, 1);
        run.players[0].darkvision = Some(1.0);
        run.apply_effect(Creature::Player(0), EffectKind::Blind, Some(5.0));
        let s = run.players[0].sight_now();
        assert_eq!((s.vision, s.darkvision), (0.0, 0.0), "darkvision does not help");
    }

    fn sleepy(chance: f64) -> OnHit {
        OnHit { kind: EffectKind::Sleep, secs: 2.0, chance }
    }

    #[test]
    fn a_hit_applies_its_effect_by_chance() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.hurt_player(0, Damage::physical(1.0).with_effect(sleepy(0.0)));
        assert!(!run.has_effect(Creature::Player(0), EffectKind::Sleep), "chance 0 never");
        run.hurt_player(0, Damage::physical(1.0).with_effect(sleepy(1.0)));
        assert!(run.has_effect(Creature::Player(0), EffectKind::Sleep), "chance 1 always");
    }

    #[test]
    fn damage_immunity_does_not_block_the_effect_and_zero_damage_shows_no_number() {
        use crate::defs::damage::Resistances;
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.players[0].res = Resistances::of(&[(DamageType::Magical, 1.0)]);
        run.hurt_player(0, Damage::new(10.0, DamageSplit::pure(DamageType::Magical)).with_effect(sleepy(1.0)));
        assert!(run.has_effect(Creature::Player(0), EffectKind::Sleep));
        run.events.clear();
        let hp = run.players[0].hp;
        run.hurt_player(0, Damage::physical(0.0).with_effect(OnHit { kind: EffectKind::Blind, secs: 1.0, chance: 1.0 }));
        assert_eq!(run.players[0].hp, hp);
        assert!(run.has_effect(Creature::Player(0), EffectKind::Blind));
        assert!(!run.events.iter().any(|(e, _)| matches!(e, Ev::Dmg { .. })), "a pure effect hit shows no number");
    }

    #[test]
    fn a_killing_hit_applies_no_effect_and_sleep_survives_damage() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.hurt_player(0, Damage::physical(1.0).with_effect(sleepy(1.0)));
        run.hurt_player(0, Damage::physical(5.0));
        assert!(run.has_effect(Creature::Player(0), EffectKind::Sleep), "damage does not wake");
        run.hurt_player(0, Damage::physical(10_000.0).with_effect(OnHit { kind: EffectKind::Blind, secs: 1.0, chance: 1.0 }));
        assert!(!run.has_effect(Creature::Player(0), EffectKind::Blind));
    }

    fn pair(gap: f64) -> crate::run::Run {
        let mut run = test_run(&[ClassId::Paladin, ClassId::Wizard], BossId::Demon);
        open(&mut run);
        let at = run.players[0].pos();
        run.players[1].mv.x = at.x + 10.0 + gap; // two 5 px radii plus the gap
        run.players[1].mv.y = at.y;
        run.apply_effect(Creature::Player(1), EffectKind::Sleep, None);
        run
    }

    fn press_e(run: &mut crate::run::Run, pi: usize) {
        crate::run::objects::use_object(run, pi);
    }

    #[test]
    fn a_teammate_in_reach_wakes_the_sleeper_before_any_object() {
        use crate::run::objects::{Barrel, ObjState};
        let mut run = pair(4.0);
        let at = run.players[0].pos() - Vec2::new(10.0, 0.0);
        run.spawn_object(crate::defs::kinds::EntityKind::Barrel, at, ObjState::Barrel(Barrel::new()));
        press_e(&mut run, 0);
        assert!(!run.has_effect(Creature::Player(1), EffectKind::Sleep));
        let b = run.objects.iter().find(|o| o.kind == crate::defs::kinds::EntityKind::Barrel).unwrap();
        assert!(matches!(&b.state, ObjState::Barrel(b) if b.vel == Vec2::ZERO), "the barrel is not pushed");
    }

    #[test]
    fn out_of_reach_does_nothing() {
        let mut run = pair(crate::defs::objects::USE_REACH + 2.0);
        press_e(&mut run, 0);
        assert!(run.has_effect(Creature::Player(1), EffectKind::Sleep));
    }

    #[test]
    fn a_sleeping_hero_cannot_wake_a_sleeping_neighbour() {
        let mut run = pair(4.0);
        run.apply_effect(Creature::Player(0), EffectKind::Sleep, None);
        let seq = run.players[0].ack + 1;
        run.players[0].inputs.push_back(crate::protocol::InputMsg { seq, mx: 0, my: 0, aim: 0.0, aim_dist: 0.0, primary: None, secondary: None, view_lag: 0, rtt: 0, act: true });
        run.step();
        assert!(run.has_effect(Creature::Player(1), EffectKind::Sleep));
    }
}
