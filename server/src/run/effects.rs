//! Status effects at run time: the timers on each creature and the only
//! API other code uses to touch them. Data: `defs/effects.rs`.

#![allow(dead_code)] // temporary: the API is consumed by later effect tasks

use crate::defs::damage::{DamageType, Resistances};
use crate::defs::effects::{def, resolve_stat, EffectKind, EffectResponse, Stat, EFFECT_REDUCED};
use crate::defs::entity_types::Sight;
use crate::protocol::Ev;
use crate::run::{Run, DT};

#[allow(unused_imports)] // used by the hit-effect tasks
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{BossId, ClassId, Ev};
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
}
