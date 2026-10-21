//! Status effects at run time: the timers on each creature and the only
//! API other code uses to touch them. Data: `defs/effects.rs`.

use crate::defs::damage::{Damage, DamageType, Resistances};
use crate::dungeon::Tile;
use crate::defs::attributes::Attr;
use crate::defs::effects::{def, effect_secs, resolve_stat, scaled_secs, EffectKind, EffectResistances, Stat, DOT_TICK, TYPE_EFFECT_POWER};
use crate::defs::races::Sight;
use crate::protocol::Ev;
use crate::run::{Run, DT};

pub use crate::defs::effects::OnHit;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ActiveEffect {
    pub kind: EffectKind,
    /// Seconds left.
    pub left: f64,
    /// Time since the last damage-over-time tick.
    pub dot_t: f64,
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
        self.0.push(ActiveEffect { kind: k, left: secs, dot_t: 0.0 });
        true
    }
    pub fn remove(&mut self, k: EffectKind) -> bool {
        let n = self.0.len();
        self.0.retain(|a| a.kind != k);
        self.0.len() != n
    }
    /// Counts down; returns the kinds that ran out (removed) and the
    /// damage-over-time ticks due this step.
    fn tick(&mut self, dt: f64) -> (Vec<EffectKind>, Vec<(DamageType, f64)>) {
        let mut hits = Vec::new();
        for a in &mut self.0 {
            if let Some((t, dps)) = def(a.kind).dot {
                a.dot_t += dt;
                if a.dot_t >= DOT_TICK - 1e-9 {
                    a.dot_t -= DOT_TICK;
                    hits.push((t, dps * DOT_TICK));
                }
            }
            a.left -= dt;
        }
        let gone: Vec<EffectKind> = self.0.iter().filter(|a| a.left <= 1e-9).map(|a| a.kind).collect();
        self.0.retain(|a| a.left > 1e-9);
        (gone, hits)
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
    pub fn effect_res(&self, base: EffectResistances) -> EffectResistances {
        let k = self.kinds();
        let mut r = base;
        for e in EffectKind::ALL {
            r.set(e, resolve_stat(base.get(e), Stat::ResistEffect(e), &k));
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
            Creature::Monster(i) if self.monsters.get(i).is_some_and(|m| m.is_ally()) => self.event_on_hero(ev, pos),
            Creature::Monster(_) => self.event(ev, Some(pos)),
        }
    }

    /// Puts `kind` on a creature for `secs` (default: its def's duration),
    /// shortened or refused by the creature's effect resistance (a damage-type
    /// effect: refused at full resistance to its type). Dead or sinking
    /// creatures take nothing. In this order:
    /// 1. an effect that cancels another (fire and ice) cancels it even when the
    ///    creature resists the new effect itself, and is not applied (false);
    /// 2. an effect whose stronger tier is on (an active effect `replaces` it) is refused;
    /// 3. resistance, water and `secs <= 0` refuse it;
    /// 4. it is added, and only then are the weaker tiers it `replaces` removed
    ///    (a refused Frozen leaves an existing Chilled alone).
    /// True when the effect is on afterwards.
    pub fn apply_effect(&mut self, c: Creature, kind: EffectKind, secs: Option<f64>) -> bool {
        let Some((_, _, pos, ok)) = self.creature(c) else { return false };
        if !ok {
            return false;
        }
        let cancelled: Vec<EffectKind> = def(kind).cancels.iter().copied().filter(|&k| self.has_effect(c, k)).collect();
        if !cancelled.is_empty() {
            for k in cancelled {
                self.remove_effect(c, k);
            }
            return false; // fire thaws ice / ice puts out fire
        }
        let held = match c {
            Creature::Player(i) => self.players.get(i).map(|p| p.effects.kinds()),
            Creature::Monster(i) => self.monsters.get(i).map(|m| m.effects.kinds()),
        };
        if held.is_some_and(|h| h.iter().any(|&k| def(k).replaces.contains(&kind))) {
            return false; // the stronger tier is on
        }
        let mut secs = secs.unwrap_or(def(kind).duration);
        if def(kind).resisted_by.is_none() {
            // A damage-type effect is resisted by its type's damage resistance (below) only.
            let r = match c {
                Creature::Player(i) => self.players.get(i).map(|p| p.effects.effect_res(p.sheet.effect_res).get(kind)),
                Creature::Monster(i) => self.monsters.get(i).map(|m| m.effects.effect_res(m.effect_res).get(kind)),
            };
            let Some(left) = r.and_then(|r| effect_secs(secs, r)) else { return false };
            secs = left;
        }
        if secs <= 0.0 {
            return false;
        }
        if def(kind).ends_in_water && self.in_water(pos) {
            return false; // no flicker on and off in water
        }
        if let Some(t) = def(kind).resisted_by {
            let res = match c {
                Creature::Player(i) => self.players.get(i).map(|p| p.effects.res(p.res).get(t)),
                Creature::Monster(i) => self.monsters.get(i).map(|m| m.effects.res(m.res).get(t)),
            };
            if res.is_some_and(|r| r >= 1.0) {
                return false; // immune to its damage: no effect at all
            }
        }
        let Some((fx, id, pos, _)) = self.creature(c) else { return false };
        if fx.add(kind, secs) {
            self.effect_event(c, id, pos, kind, true);
        }
        for &weaker in def(kind).replaces {
            self.remove_effect(c, weaker);
        }
        true
    }

    /// Like `apply_effect`, from a source of `power`: a harmful effect's time is
    /// scaled by the target's save (WIL against `magical`, else CON) before its
    /// effect resistance applies. Positive effects are never scaled.
    pub fn apply_effect_from(&mut self, c: Creature, kind: EffectKind, secs: Option<f64>, power: i32, magical: bool) -> bool {
        let base = secs.unwrap_or(def(kind).duration);
        if def(kind).positive {
            return self.apply_effect(c, kind, Some(base));
        }
        let save_attr = if magical { Attr::Wil } else { Attr::Con };
        let save = match c {
            Creature::Player(i) => self.players.get(i).map(|p| p.sheet.attrs.get(save_attr)),
            Creature::Monster(i) => self.monsters.get(i).map(|m| m.attrs.get(save_attr)),
        };
        let Some(save) = save else { return false };
        self.apply_effect(c, kind, Some(scaled_secs(base, power, save)))
    }

    fn in_water(&self, pos: crate::math::Vec2) -> bool {
        let tile = self.layout.map.tile_at(pos);
        tile == Tile::ShallowWater as u8 || tile == Tile::DeepWater as u8
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

    /// After a normal hit: each damage type making up at least a quarter of it applies its
    /// effect (the higher tier its share meets, see `type_effects`), non-magical (against the target's CON), at the power of its source's
    /// governing Attribute (`Damage::power`) but never below `TYPE_EFFECT_POWER`.
    pub fn type_effect_hit(&mut self, c: Creature, dmg: &crate::defs::damage::Damage) {
        if dmg.from_effect {
            return;
        }
        for k in crate::defs::effects::type_effects(&dmg.split) {
            self.apply_effect_from(c, k, None, dmg.power.max(TYPE_EFFECT_POWER), false);
        }
    }

    /// A hit's effect: always applied (no roll); the target's save and resistance only shorten or refuse it.
    pub fn hit_effect(&mut self, c: Creature, h: OnHit) {
        self.apply_effect_from(c, h.kind, Some(h.secs), h.power, h.magical);
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
            if !ok {
                for k in fx.take_all() {
                    self.effect_event(c, id, pos, k, false);
                }
                continue;
            }
            let kinds = fx.kinds();
            // Water puts out fire.
            if self.in_water(pos) {
                for k in kinds.into_iter().filter(|&k| def(k).ends_in_water) {
                    self.remove_effect(c, k);
                }
            }
            let Some((fx, ..)) = self.creature(c) else { continue };
            let (gone, hits) = fx.tick(DT);
            for k in gone {
                self.effect_event(c, id, pos, k, false);
            }
            for (t, amount) in hits {
                match c {
                    Creature::Player(i) => self.hurt_player(i, Damage::effect_tick(amount, t)),
                    Creature::Monster(i) => {
                        self.hurt_monster(i, Damage::effect_tick(amount, t), false, None);
                    }
                }
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
    use crate::defs::damage::DamageSplit;
    use crate::run::tests::test_run;
    use crate::run::DT;

    fn boss(run: &crate::run::Run) -> usize {
        run.monsters.iter().position(|m| m.is_boss).unwrap()
    }

    #[test]
    fn a_sleeping_curse_does_not_take_on_a_ranger() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        assert!(!run.apply_effect(Creature::Player(0), EffectKind::Sleep, None));
        assert!(run.apply_effect(Creature::Player(0), EffectKind::Blind, Some(1.0)));
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
    fn boss_effect_resistances_follow_the_table() {
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
        let id = run.spawn_enemy(crate::defs::enemies::EnemyType::Ogre, at, None);
        let mi = run.monster_idx(id).unwrap();
        for k in EffectKind::ALL {
            assert!(run.apply_effect(Creature::Monster(mi), k, Some(3.0)), "the ogre takes {k:?} in full");
            run.remove_effect(Creature::Monster(mi), k); // fire and ice cancel each other
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
        let s = e.sight(crate::defs::races::Sight { vision: 9.0, darkvision: 0.5 });
        assert_eq!(s.vision, 9.0);
        e.add(EffectKind::Blind, 1.0);
        let s = e.sight(crate::defs::races::Sight { vision: 9.0, darkvision: 0.5 });
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
        free.knock_player(0, from, 0.0, 40.0, crate::defs::bosses::BOSS_KNOCK_STR);
        run.apply_effect(Creature::Player(0), EffectKind::Petrified, Some(5.0));
        run.knock_player(0, from, 0.0, 40.0, crate::defs::bosses::BOSS_KNOCK_STR);
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
        let id = run.spawn_enemy(EnemyType::SkeletonArcher, at, None);
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
        run.spawn_enemy(EnemyType::OrcWarrior, at, None);
        run.players[0].darkvision = Some(1.0);
        run.apply_effect(Creature::Player(0), EffectKind::Blind, Some(5.0));
        let s = run.players[0].sight_now();
        assert_eq!((s.vision, s.darkvision), (0.0, 0.0), "darkvision does not help");
    }

    fn sleepy() -> OnHit {
        OnHit { kind: EffectKind::Sleep, secs: 2.0, magical: false, power: 10 }
    }

    #[test]
    fn a_hit_applies_its_effect() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.hurt_player(0, Damage::physical(1.0).with_effect(sleepy()));
        assert!(run.has_effect(Creature::Player(0), EffectKind::Sleep));
    }

    /// A fresh ogre next to the hero (no other monsters but the boss).
    fn fresh_ogre(run: &mut crate::run::Run) -> Creature {
        let at = run.players[0].pos();
        let id = run.spawn_enemy(crate::defs::enemies::EnemyType::Ogre, at, None);
        Creature::Monster(run.monster_idx(id).unwrap())
    }

    #[test]
    fn the_stronger_tier_replaces_the_weaker() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let c = fresh_ogre(&mut run);
        for (weak, strong) in [(EffectKind::Chilled, EffectKind::Frozen), (EffectKind::Singed, EffectKind::Burning), (EffectKind::Tainted, EffectKind::Poisoned)] {
            assert!(run.apply_effect(c, weak, None));
            assert!(run.apply_effect(c, strong, None));
            assert!(!run.has_effect(c, weak), "{strong:?} ends {weak:?}");
            assert!(!run.apply_effect(c, weak, None), "a creature with {strong:?} does not take {weak:?}");
            assert!(!run.has_effect(c, weak) && run.has_effect(c, strong));
            run.remove_effect(c, strong);
        }
    }

    #[test]
    fn a_refused_freeze_leaves_the_chill() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let c = fresh_ogre(&mut run);
        assert!(run.apply_effect(c, EffectKind::Chilled, None));
        let Creature::Monster(mi) = c else { unreachable!() };
        run.monsters[mi].res = Resistances::of(&[(DamageType::Cold, 1.0)]);
        assert!(!run.apply_effect(c, EffectKind::Frozen, None));
        assert!(run.has_effect(c, EffectKind::Chilled) && !run.has_effect(c, EffectKind::Frozen));
        run.monsters[mi].res = Resistances::NONE;
        let con = run.monsters[mi].attrs.get(crate::defs::attributes::Attr::Con);
        assert!(!run.apply_effect_from(c, EffectKind::Frozen, None, con - 20, false), "a save 20 above the power: 0 s");
        assert!(run.has_effect(c, EffectKind::Chilled) && !run.has_effect(c, EffectKind::Frozen));
    }

    #[test]
    fn fire_and_cold_cancel_across_tiers() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let c = fresh_ogre(&mut run);
        use EffectKind::*;
        for (cold, heat) in [(Frozen, Singed), (Chilled, Singed), (Frozen, Burning), (Chilled, Burning)] {
            assert!(run.apply_effect(c, cold, None));
            assert!(!run.apply_effect(c, heat, None), "{heat:?} is not applied itself");
            assert!(!run.has_effect(c, cold) && !run.has_effect(c, heat), "{heat:?} ends {cold:?}");
            assert!(run.apply_effect(c, heat, None));
            assert!(!run.apply_effect(c, cold, None), "{cold:?} is not applied itself");
            assert!(!run.has_effect(c, cold) && !run.has_effect(c, heat), "{cold:?} ends {heat:?}");
        }
    }

    #[test]
    fn a_resisted_singe_still_thaws() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let c = fresh_ogre(&mut run);
        let Creature::Monster(mi) = c else { unreachable!() };
        run.apply_effect(c, EffectKind::Frozen, None);
        run.monsters[mi].res = Resistances::of(&[(DamageType::Heat, 1.0)]);
        run.hit_effect(c, OnHit { kind: EffectKind::Singed, secs: 3.0, magical: false, power: 10 });
        assert!(!run.has_effect(c, EffectKind::Frozen) && !run.has_effect(c, EffectKind::Singed));
    }

    #[test]
    fn an_on_hit_effect_always_lands() {
        use rand::RngCore;
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mut twin = run.rng.clone();
        for _ in 0..20 {
            let c = fresh_ogre(&mut run);
            run.hit_effect(c, OnHit { kind: EffectKind::Blind, secs: 2.0, magical: false, power: 10 });
            assert!(run.has_effect(c, EffectKind::Blind));
        }
        assert_eq!(run.rng.next_u64(), twin.next_u64(), "no roll drew from the run's rng");
    }

    #[test]
    fn damage_immunity_does_not_block_the_effect_and_zero_damage_shows_no_number() {
        use crate::defs::damage::Resistances;
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.players[0].res = Resistances::of(&[(DamageType::Magical, 1.0)]);
        run.hurt_player(0, Damage::new(10.0, DamageSplit::pure(DamageType::Magical)).with_effect(sleepy()));
        assert!(run.has_effect(Creature::Player(0), EffectKind::Sleep));
        run.events.clear();
        let hp = run.players[0].hp;
        run.hurt_player(0, Damage::physical(0.0).with_effect(OnHit { kind: EffectKind::Blind, secs: 1.0, magical: false, power: 10 }));
        assert_eq!(run.players[0].hp, hp);
        assert!(run.has_effect(Creature::Player(0), EffectKind::Blind));
        assert!(!run.events.iter().any(|(e, _)| matches!(e, Ev::Dmg { .. })), "a pure effect hit shows no number");
    }

    #[test]
    fn a_killing_hit_applies_no_effect_and_sleep_survives_damage() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.hurt_player(0, Damage::physical(1.0).with_effect(sleepy()));
        run.hurt_player(0, Damage::physical(5.0));
        assert!(run.has_effect(Creature::Player(0), EffectKind::Sleep), "damage does not wake");
        run.hurt_player(0, Damage::physical(10_000.0).with_effect(OnHit { kind: EffectKind::Blind, secs: 1.0, magical: false, power: 10 }));
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

    use crate::defs::damage::Resistances;

    fn hp_loss_over(run: &mut crate::run::Run, steps: usize) -> f64 {
        let hp = run.players[0].hp;
        for _ in 0..steps {
            run.tick_effects();
        }
        hp - run.players[0].hp
    }

    #[test]
    fn burning_runs_out_after_its_duration_without_refreshing_itself() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        open(&mut run);
        run.apply_effect(Creature::Player(0), EffectKind::Burning, None);
        let steps = (3.0 / DT).round() as usize;
        assert!((hp_loss_over(&mut run, steps) - 18.0).abs() < 1e-6, "3 heat every 0.5 s for 3 s");
        assert!(!run.has_effect(Creature::Player(0), EffectKind::Burning), "its own ticks never refresh it");
        assert_eq!(hp_loss_over(&mut run, 60), 0.0);
    }

    #[test]
    fn partial_resistance_reduces_each_tick_and_full_resistance_refuses_the_effect() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        open(&mut run);
        run.players[0].res = Resistances::of(&[(DamageType::Heat, 0.5)]);
        run.apply_effect(Creature::Player(0), EffectKind::Burning, None);
        assert!((hp_loss_over(&mut run, 30) - 1.5).abs() < 1e-6);
        run.remove_effect(Creature::Player(0), EffectKind::Burning);
        run.apply_effect(Creature::Player(0), EffectKind::Petrified, None);
        assert!(!run.apply_effect(Creature::Player(0), EffectKind::Burning, None), "petrified: heat 0.5 + 0.5 = immune");
        run.players[0].res = Resistances::of(&[(DamageType::Poison, 1.0)]);
        assert!(!run.apply_effect(Creature::Player(0), EffectKind::Poisoned, None));
    }

    #[test]
    fn effect_damage_applies_no_effects() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.hurt_player(0, Damage::effect_tick(5.0, DamageType::Heat));
        assert!(run.players[0].effects.list().is_empty());
        run.hurt_player(0, Damage::effect_tick(5.0, DamageType::Heat).with_effect(OnHit { kind: EffectKind::Slowed, secs: 1.0, magical: false, power: 10 }));
        assert!(run.players[0].effects.list().is_empty(), "not even an on_hit");
    }

    #[test]
    fn fire_thaws_ice_and_ice_puts_out_fire() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        let me = Creature::Player(0);
        run.apply_effect(me, EffectKind::Frozen, None);
        assert!(!run.apply_effect(me, EffectKind::Burning, None));
        assert!(!run.has_effect(me, EffectKind::Frozen) && !run.has_effect(me, EffectKind::Burning), "thawed, not burning");
        run.apply_effect(me, EffectKind::Burning, None);
        assert!(!run.apply_effect(me, EffectKind::Frozen, None));
        assert!(!run.has_effect(me, EffectKind::Frozen) && !run.has_effect(me, EffectKind::Burning), "put out, not frozen");
    }

    #[test]
    fn a_resisted_effect_still_cancels_its_opposite() {
        use crate::defs::damage::{DamageType, Resistances};
        let me = Creature::Player(0);
        let frozen_then_fire = |run: &mut crate::run::Run, how: &str| {
            run.apply_effect(me, EffectKind::Frozen, None);
            assert!(run.has_effect(me, EffectKind::Frozen));
            assert!(!run.apply_effect_from(me, EffectKind::Burning, None, 10, false));
            assert!(!run.has_effect(me, EffectKind::Frozen), "{how}: the fire still thaws the ice");
            assert!(!run.has_effect(me, EffectKind::Burning), "{how}: and does not burn");
        };
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.players[0].sheet.attrs = run.players[0].sheet.attrs.plus(crate::defs::attributes::Attributes::new(0, 0, 40, 0, 0, 0));
        frozen_then_fire(&mut run, "saved to 0 s");
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.players[0].res = Resistances::of(&[(DamageType::Heat, 1.0)]);
        frozen_then_fire(&mut run, "immune to heat");
    }

    #[test]
    fn shallow_water_puts_out_fire() {
        use crate::dungeon::Tile;
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        open(&mut run);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        run.set_tile(tx, ty, Tile::ShallowWater);
        run.apply_effect(Creature::Player(0), EffectKind::Burning, None);
        run.apply_effect(Creature::Player(0), EffectKind::Poisoned, None);
        run.tick_effects();
        assert!(!run.has_effect(Creature::Player(0), EffectKind::Burning));
        assert!(run.has_effect(Creature::Player(0), EffectKind::Poisoned), "water only puts out fire");
    }

    #[test]
    fn burn_ticks_count_in_the_heros_damage_total() {
        use crate::defs::enemies::EnemyType;
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        open(&mut run);
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, at, None);
        let mi = run.monster_idx(id).unwrap();
        run.hurt_monster(mi, Damage::physical(1.0), false, Some(0));
        let before = run.players[0].damage;
        run.apply_effect(Creature::Monster(mi), EffectKind::Burning, None);
        let hp = run.monsters[mi].hp;
        for _ in 0..(1.0 / DT).round() as usize {
            run.tick_effects();
        }
        let lost = hp - run.monsters[mi].hp;
        assert!(lost > 0.0);
        assert!((run.players[0].damage - before - lost).abs() < 1e-9, "the burn counts: {} vs {lost}", run.players[0].damage - before);
    }

    #[test]
    fn water_refuses_burning_without_a_flicker() {
        use crate::dungeon::Tile;
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        open(&mut run);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        run.set_tile(tx, ty, Tile::ShallowWater);
        run.events.clear();
        assert!(!run.apply_effect(Creature::Player(0), EffectKind::Burning, None));
        run.hurt_player(0, Damage::new(4.0, crate::defs::damage::kind_split(crate::defs::kinds::EntityKind::Fireball)));
        assert!(!run.has_effect(Creature::Player(0), EffectKind::Burning));
        assert!(!run.events.iter().any(|(e, _)| matches!(e, Ev::Effect { .. })), "no Effect event at all");
        assert!(run.apply_effect(Creature::Player(0), EffectKind::Poisoned, None), "only fire is refused");
    }

    #[test]
    fn frozen_roots_and_ticks_cold() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        open(&mut run);
        run.apply_effect(Creature::Player(0), EffectKind::Frozen, None);
        let fx = &run.players[0].effects;
        assert!(fx.no_move() && fx.no_act() && fx.no_turn());
        assert!((hp_loss_over(&mut run, (2.0 / DT).round() as usize) - 8.0).abs() < 1e-6, "2 cold every 0.5 s for 2 s");
    }

    #[test]
    fn a_burn_kill_credits_the_last_hero_who_hit() {
        use crate::defs::enemies::EnemyType;
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        open(&mut run);
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, at, None);
        let mi = run.monster_idx(id).unwrap();
        run.hurt_monster(mi, Damage::physical(1.0), false, Some(0));
        run.monsters[mi].hp = 2.0;
        run.apply_effect(Creature::Monster(mi), EffectKind::Burning, None);
        for _ in 0..40 {
            run.tick_effects();
        }
        assert!(!run.monsters[mi].alive);
        assert_eq!(run.players[0].kills, 1);
    }

    #[test]
    fn mostly_heat_hits_and_lava_set_heroes_on_fire() {
        use crate::defs::damage::kind_split;
        use crate::defs::kinds::EntityKind;
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        open(&mut run);
        run.hurt_player(0, Damage::new(4.0, DamageSplit::split(&[(DamageType::Heat, 0.2)])));
        assert!(!run.has_effect(Creature::Player(0), EffectKind::Burning), "a claw with a fifth of heat does not burn");
        run.hurt_player(0, Damage::new(4.0, kind_split(EntityKind::Fireball)));
        assert!(run.has_effect(Creature::Player(0), EffectKind::Burning));
        run.remove_effect(Creature::Player(0), EffectKind::Burning);
        // Lava: one tick burns.
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        run.set_tile(tx, ty, crate::dungeon::Tile::Lava);
        run.step();
        assert!(run.has_effect(Creature::Player(0), EffectKind::Burning));
    }

    #[test]
    fn heat_immune_creatures_are_never_set_on_fire() {
        use crate::defs::enemies::EnemyType;
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        open(&mut run);
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        let id = run.spawn_enemy(EnemyType::Imp, at, None);
        let mi = run.monster_idx(id).unwrap();
        let hp = run.monsters[mi].hp;
        run.hurt_monster(mi, Damage::new(10.0, DamageSplit::pure(DamageType::Heat)), false, None);
        assert_eq!(run.monsters[mi].hp, hp);
        assert!(!run.has_effect(Creature::Monster(mi), EffectKind::Burning));
        let id = run.spawn_enemy(EnemyType::SkeletonWarrior, at, None);
        let si = run.monster_idx(id).unwrap();
        run.hurt_monster(si, Damage::new(10.0, DamageSplit::pure(DamageType::Poison)), false, None);
        assert!(!run.has_effect(Creature::Monster(si), EffectKind::Poisoned), "undead are never poisoned");
    }

    // ---- Durations by power against save ----

    fn left_of(run: &crate::run::Run, c: Creature, k: EffectKind) -> Option<f64> {
        let fx = match c {
            Creature::Player(i) => &run.players[i].effects,
            Creature::Monster(i) => &run.monsters[i].effects,
        };
        fx.list().iter().find(|a| a.kind == k).map(|a| a.left)
    }

    fn lich_sleep() -> OnHit {
        OnHit { kind: EffectKind::Sleep, secs: 2.0, magical: true, power: 22 }
    }

    #[test]
    fn duration_follows_power_against_save() {
        use crate::defs::effects::scaled_secs;
        assert!((scaled_secs(3.0, 15, 8) - 3.0 * 1.35).abs() < 1e-12);
        assert!((scaled_secs(3.0, 22, 14) - 3.0 * 1.4).abs() < 1e-12);
        assert_eq!(scaled_secs(3.0, 10, 30), 0.0);
    }

    #[test]
    fn lich_sleep_lasts_longer_on_the_paladin() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.hurt_player(0, Damage::physical(0.0).with_effect(lich_sleep()));
        let left = left_of(&run, Creature::Player(0), EffectKind::Sleep).expect("asleep");
        assert!((left - 3.0).abs() < 1e-12, "2 s × (1 + (22 − 12) / 20) = 3 s, got {left}");
    }

    #[test]
    fn elves_and_the_wolf_stay_immune_to_sleep() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let id = crate::run::companion::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(id).unwrap();
        run.hurt_player(0, Damage::physical(0.0).with_effect(lich_sleep()));
        assert!(!run.has_effect(Creature::Player(0), EffectKind::Sleep), "the elf");
        run.hit_effect(Creature::Monster(wi), lich_sleep());
        assert!(!run.has_effect(Creature::Monster(wi), EffectKind::Sleep), "the wolf");
    }

    #[test]
    fn burning_is_shorter_on_a_tough_hero() {
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        open(&mut run);
        run.type_effect_hit(Creature::Player(0), &Damage::new(4.0, DamageSplit::pure(DamageType::Heat)));
        let left = left_of(&run, Creature::Player(0), EffectKind::Burning).expect("burning");
        let want = crate::defs::effects::def(EffectKind::Burning).duration * 0.8;
        assert!((left - want).abs() < 1e-12, "power 10 against CON 14: ×0.8, got {left}");
    }

    #[test]
    fn effect_resistance_applies_after_the_save() {
        use crate::defs::attributes::Attr;
        use crate::defs::effects::{scaled_secs, EffectResistances};
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        open(&mut run);
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        let id = run.spawn_enemy(crate::defs::enemies::EnemyType::Ogre, at, None);
        let mi = run.monster_idx(id).unwrap();
        let c = Creature::Monster(mi);
        run.monsters[mi].effect_res = EffectResistances::of(&[(EffectKind::Sleep, 1.0)]);
        assert!(!run.apply_effect_from(c, EffectKind::Sleep, None, 40, true));
        assert!(!run.has_effect(c, EffectKind::Sleep));
        run.monsters[mi].effect_res = EffectResistances::of(&[(EffectKind::Sleep, 0.5)]);
        let wil = run.monsters[mi].attrs.get(Attr::Wil);
        assert!(run.apply_effect_from(c, EffectKind::Sleep, None, 10, true));
        let want = scaled_secs(4.0, 10, wil) * 0.5;
        assert!((left_of(&run, c, EffectKind::Sleep).unwrap() - want).abs() < 1e-9);
    }

    #[test]
    fn dragon_haste_is_halved() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Dragon);
        let c = Creature::Monster(boss(&run));
        assert!(run.apply_effect_from(c, EffectKind::Accelerated, None, 0, true));
        assert_eq!(left_of(&run, c, EffectKind::Accelerated), Some(crate::defs::effects::def(EffectKind::Accelerated).duration * 0.5));
    }

    #[test]
    fn buffs_are_never_shortened() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        let bi = boss(&run);
        assert_eq!(run.monsters[bi].attrs.get(crate::defs::attributes::Attr::Wil), 18);
        assert!(run.apply_effect_from(Creature::Monster(bi), EffectKind::Accelerated, None, 0, true));
        assert_eq!(left_of(&run, Creature::Monster(bi), EffectKind::Accelerated), Some(crate::defs::effects::def(EffectKind::Accelerated).duration));
    }

    #[test]
    fn an_immune_lich_is_not_set_on_fire() {
        use crate::defs::damage::kind_split;
        use crate::defs::kinds::EntityKind;
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        let bi = boss(&run);
        assert!(!run.hurt_monster(bi, Damage::new(10.0, kind_split(EntityKind::Fireball)), false, Some(0)), "disciples alive: refused");
        assert!(!run.has_effect(Creature::Monster(bi), EffectKind::Burning));
    }
}
