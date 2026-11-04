//! Status effects at run time: the timers on each creature and the only
//! API other code uses to touch them. Data: `defs/effects.rs`.

use crate::defs::damage::{Damage, DamageType, Resistances, What, Why, MIN_RESISTANCE};
use crate::dungeon::Tile;
use crate::defs::attributes::{Attr, Attributes};
use crate::defs::effects::{attr_amount, def, effect_secs, resolve_stat, scaled_secs, EffectKind, EffectLook, EffectResistances, Stat, DOT_TICK, TYPE_EFFECT_POWER};
use crate::math::Vec2;
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
    /// How it is drawn, chosen by whoever applied it.
    pub look: EffectLook,
    /// The creature that applied it (Fear: who it runs from), if any.
    pub source: Option<u32>,
    /// Where the source was last seen; `Vec2::ZERO` when there is no source.
    pub from: Vec2,
    /// The signed amount an Attribute effect changes its Attribute by (summed over its stacks); 0 for every other effect.
    pub amount: i32,
}

/// One application of an effect: the single description every source builds (a hit's
/// `OnHit`, an aura, terrain) and `Run::apply` takes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Apply {
    pub kind: EffectKind,
    /// Seconds before the target's save and resistance (default: the def's duration).
    pub secs: Option<f64>,
    /// The source's power: a harmful effect's time is scaled by the target's save. `None`: unscaled.
    pub power: Option<i32>,
    /// Saved against with WIL instead of CON (unless the effect names its own save).
    pub magical: bool,
    pub look: EffectLook,
    /// Who applied it and where they stand.
    pub source: Option<(u32, Vec2)>,
    /// A standalone application's cause (an ability), for the rules log: who and what.
    pub origin: Option<(u32, What)>,
}

/// What `apply_traced` did with an application.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EffectOutcome {
    Added,
    Refreshed,
    /// The effect cancelled others (fire and ice) and was not applied: the kinds removed, as `EffectKind::bit`s.
    Cancelled { removed: u32 },
    /// A stronger tier is on.
    StrongerOn(EffectKind),
    SavedToZero,
    Resisted,
    TypeImmune(DamageType),
    InWater,
    /// Dead, sinking or unknown target.
    NotThere,
}

/// The numbers `apply` computed on the way to the seconds, as it computed them.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Duration {
    /// Seconds before the target's save and resistance.
    pub base: f64,
    /// The source's power, the save Attribute, its value on the target, and the seconds after the save.
    pub save: Option<(i32, Attr, i32, f64)>,
    /// The effect resistance as used, and the seconds after it.
    pub resist: Option<(f64, f64)>,
    /// The seconds the effect got (as far as it got).
    pub secs: f64,
}

impl Apply {
    pub fn plain(kind: EffectKind, secs: Option<f64>) -> Apply {
        Apply { kind, secs, power: None, magical: false, look: EffectLook::Plain, source: None, origin: None }
    }
    pub fn from_hit(h: OnHit) -> Apply {
        Apply { kind: h.kind, secs: Some(h.secs), power: Some(h.power), magical: h.magical, look: h.look, source: None, origin: None }
    }
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
    pub fn bits(&self) -> u32 {
        self.0.iter().fold(0, |b, a| b | a.kind.bit())
    }
    /// Refresh: the longer of the remaining and the new time. True when newly added.
    #[cfg(test)]
    pub fn add(&mut self, k: EffectKind, secs: f64) -> bool {
        self.add_with(k, secs, EffectLook::Plain, None, 0)
    }
    /// `add` with a look, a source and the `amount` of an Attribute effect (0 for the others); a refresh
    /// takes the new look, source and position too, and adds the amount when the effect stacks,
    /// else replaces it.
    pub fn add_with(&mut self, k: EffectKind, secs: f64, look: EffectLook, source: Option<(u32, Vec2)>, amount: i32) -> bool {
        let (source, from) = source.map_or((None, Vec2::ZERO), |(id, at)| (Some(id), at));
        if let Some(a) = self.0.iter_mut().find(|a| a.kind == k) {
            a.left = a.left.max(secs);
            (a.look, a.source, a.from) = (look, source, from);
            a.amount = if def(k).stacks { a.amount + amount } else { amount };
            return false;
        }
        self.0.push(ActiveEffect { kind: k, left: secs, dot_t: 0.0, look, source, from, amount });
        true
    }
    /// The signed amount of `k` (0 when it is not on, or has none).
    pub fn amount(&self, k: EffectKind) -> i32 {
        self.0.iter().find(|a| a.kind == k).map_or(0, |a| a.amount)
    }
    /// What the active effects add to each Attribute (summed, not yet floored: see `Attributes::with_delta`).
    pub fn attr_delta(&self) -> Attributes {
        let mut d = Attributes::default();
        for a in &self.0 {
            if let Some(attr) = def(a.kind).attr {
                d.add(attr, a.amount);
            }
        }
        d
    }
    /// The non-`Plain` looks (the client draws them).
    pub fn looks(&self) -> impl Iterator<Item = (EffectKind, EffectLook)> + '_ {
        self.0.iter().filter(|a| a.look != EffectLook::Plain).map(|a| (a.kind, a.look))
    }
    /// The source and last known position of the effect that makes the creature flee.
    pub fn fear_from(&self) -> Option<(Option<u32>, Vec2)> {
        self.0.iter().find(|a| def(a.kind).flees).map(|a| (a.source, a.from))
    }
    /// The frightening source was seen at `at`.
    pub fn set_fear_from(&mut self, at: Vec2) {
        for a in self.0.iter_mut().filter(|a| def(a.kind).flees) {
            a.from = at;
        }
    }
    pub fn remove(&mut self, k: EffectKind) -> bool {
        let n = self.0.len();
        self.0.retain(|a| a.kind != k);
        self.0.len() != n
    }
    /// Counts down; returns the kinds that ran out (removed) and the
    /// damage-over-time ticks due this step.
    fn tick(&mut self, dt: f64) -> (Vec<EffectKind>, Vec<(DamageType, f64, EffectKind, Option<u32>)>) {
        let mut hits = Vec::new();
        for a in &mut self.0 {
            if let Some((t, dps)) = def(a.kind).dot {
                a.dot_t += dt;
                if a.dot_t >= DOT_TICK - 1e-9 {
                    a.dot_t -= DOT_TICK;
                    hits.push((t, dps * DOT_TICK, a.kind, a.source));
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
    /// Factor on how fast the creature's cooldowns count down.
    pub fn cooldown_rate(&self) -> f64 {
        resolve_stat(1.0, Stat::CooldownRate, &self.kinds())
    }
    /// `dt` as the creature's cooldowns see it: every cooldown-like timer of a creature ticks with this,
    /// never with plain `dt`. Durations that are not cooldowns (effects, hazards, wind-ups, dashes) do not.
    pub fn cooldown_dt(&self, dt: f64) -> f64 {
        dt * self.cooldown_rate()
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

    fn effect_event(&mut self, c: Creature, id: u32, pos: crate::math::Vec2, k: EffectKind, on: bool, look: EffectLook) {
        let ev = Ev::Effect { id, kind: k as u8, on, look: look as u8 };
        match c {
            Creature::Player(_) => self.event_on_hero(ev, pos),
            Creature::Monster(i) if self.monsters.get(i).is_some_and(|m| m.is_ally()) => self.event_on_hero(ev, pos),
            // Invisible's own start and end are told (the client plays the vanish and the appear); no other
            // effect of an invisible monster is, as it would show where it stands.
            Creature::Monster(i) if k != EffectKind::Invisible && self.monsters.get(i).is_some_and(|m| m.effects.has(EffectKind::Invisible)) => {}
            Creature::Monster(_) => self.event(ev, Some(pos)),
        }
    }

    /// Puts an effect on a creature: the one apply path. A harmful effect with a `power` is
    /// first scaled by the target's save (the effect's own `save`, else WIL against `magical`,
    /// CON otherwise; positive effects are never scaled); then the creature's effect
    /// resistance shortens or refuses it (a damage-type effect: refused at full resistance to
    /// its type). Dead or sinking creatures take nothing. In this order:
    /// 1. an effect that cancels another (fire and ice) cancels it even when the
    ///    creature resists the new effect itself, and is not applied (false);
    /// 2. an effect whose stronger tier is on (an active effect `replaces` it) is refused;
    /// 3. save, resistance, water and `secs <= 0` refuse it;
    /// 4. it is added, and only then are the weaker tiers it `replaces` removed
    ///    (a refused Frozen leaves an existing Chilled alone).
    /// True when the effect is on afterwards.
    pub fn apply(&mut self, c: Creature, a: Apply) -> bool {
        let (outcome, duration, replaced) = self.apply_traced(c, a);
        let left = self.effect_left(c, a.kind);
        super::rules_log::effect(self, super::rules_log::EffectFacts { target: c, kind: a.kind, outcome, duration, replaced, left, origin: a.origin });
        matches!(outcome, EffectOutcome::Added | EffectOutcome::Refreshed)
    }

    /// Seconds left of `kind` on `c` (0 when it is not on).
    fn effect_left(&self, c: Creature, kind: EffectKind) -> f64 {
        let fx = match c {
            Creature::Player(i) => self.players.get(i).map(|p| &p.effects),
            Creature::Monster(i) => self.monsters.get(i).map(|m| &m.effects),
        };
        fx.and_then(|fx| fx.list().iter().find(|e| e.kind == kind)).map_or(0.0, |e| e.left)
    }

    /// The body of `apply`: what happened, the numbers on the way, and the weaker tiers it removed (bits).
    pub fn apply_traced(&mut self, c: Creature, a: Apply) -> (EffectOutcome, Duration, u32) {
        let r = self.apply_untold(c, a);
        if !def(a.kind).positive && matches!(r.0, EffectOutcome::Added | EffectOutcome::Refreshed) {
            // The landing effect's own Ev::Effect start event is suppressed for a creature that was still invisible
            // (the client draws from the snapshot mask).
            self.reveal(c, super::rules_log::EndReason::RevealedByEffect); // only an effect that takes hold
        }
        r
    }

    fn apply_untold(&mut self, c: Creature, a: Apply) -> (EffectOutcome, Duration, u32) {
        let kind = a.kind;
        let mut d = Duration::default();
        let Some((_, _, pos, ok)) = self.creature(c) else { return (EffectOutcome::NotThere, d, 0) };
        if !ok {
            return (EffectOutcome::NotThere, d, 0);
        }
        let cancelled: Vec<EffectKind> = def(kind).cancels.iter().copied().filter(|&k| self.has_effect(c, k)).collect();
        if !cancelled.is_empty() {
            let mut removed = 0;
            for k in cancelled {
                self.remove_effect(c, k);
                removed |= k.bit();
            }
            return (EffectOutcome::Cancelled { removed }, d, 0); // fire thaws ice / ice puts out fire
        }
        let held = match c {
            Creature::Player(i) => self.players.get(i).map(|p| p.effects.kinds()),
            Creature::Monster(i) => self.monsters.get(i).map(|m| m.effects.kinds()),
        };
        if let Some(k) = held.and_then(|h| h.into_iter().find(|&k| def(k).replaces.contains(&kind))) {
            return (EffectOutcome::StrongerOn(k), d, 0); // the stronger tier is on
        }
        let mut secs = a.secs.unwrap_or(def(kind).duration);
        d.base = secs;
        d.secs = secs;
        if let (Some(power), false) = (a.power, def(kind).positive) {
            let save_attr = def(kind).save.unwrap_or(if a.magical { Attr::Wil } else { Attr::Con });
            let save = match c {
                Creature::Player(i) => self.players.get(i).map(|p| p.sheet.save(save_attr)),
                Creature::Monster(i) => self.monsters.get(i).map(|m| m.attrs.get(save_attr)),
            };
            let Some(save) = save else { return (EffectOutcome::NotThere, d, 0) };
            secs = scaled_secs(secs, power, save);
            d.save = Some((power, save_attr, save, secs));
            d.secs = secs;
        }
        if def(kind).resisted_by.is_none() {
            // A damage-type effect is resisted by its type's damage resistance (below) only.
            let r = match c {
                Creature::Player(i) => self.players.get(i).map(|p| p.effects.effect_res(p.sheet.effect_res).get(kind)),
                Creature::Monster(i) => self.monsters.get(i).map(|m| m.effects.effect_res(m.effect_res).get(kind)),
            };
            let Some(r) = r else { return (EffectOutcome::NotThere, d, 0) };
            d.resist = Some((r.max(MIN_RESISTANCE), 0.0));
            let Some(left) = effect_secs(secs, r) else { return (EffectOutcome::Resisted, d, 0) };
            secs = left;
            d.resist = Some((r.max(MIN_RESISTANCE), left));
            d.secs = secs;
        }
        if secs <= 0.0 {
            return (EffectOutcome::SavedToZero, d, 0);
        }
        if def(kind).ends_in_water && self.in_water(pos) {
            return (EffectOutcome::InWater, d, 0); // no flicker on and off in water
        }
        if let Some(t) = def(kind).resisted_by {
            let res = match c {
                Creature::Player(i) => self.players.get(i).map(|p| p.effects.res(p.res).get(t)),
                Creature::Monster(i) => self.monsters.get(i).map(|m| m.effects.res(m.res).get(t)),
            };
            if res.is_some_and(|r| r >= 1.0) {
                return (EffectOutcome::TypeImmune(t), d, 0); // immune to its damage: no effect at all
            }
        }
        let Some((fx, id, pos, _)) = self.creature(c) else { return (EffectOutcome::NotThere, d, 0) };
        let added = fx.add_with(kind, secs, a.look, a.source, attr_amount(kind, a.power));
        if added {
            self.effect_event(c, id, pos, kind, true, a.look);
        }
        if def(kind).attr.is_some() {
            self.refresh_attrs(c);
        }
        let mut replaced = 0;
        for &weaker in def(kind).replaces {
            if self.remove_effect(c, weaker) {
                replaced |= weaker.bit();
            }
        }
        (if added { EffectOutcome::Added } else { EffectOutcome::Refreshed }, d, replaced)
    }

    /// A direct hit or harmful effect from outside reached `c`: every effect that `ends_when_hit`
    /// (Invisible) ends, and the client is told like for any ending. Never from a tick of an
    /// effect already on the creature, and never from terrain (those paths do not call it).
    pub fn reveal(&mut self, c: Creature, why: super::rules_log::EndReason) {
        self.end_effects(c, why, |d| d.ends_when_hit);
    }

    /// `c` starts an attack: every effect that `ends_when_attacking` (Invisible) ends. Not for Haste or Purify (`is_attack`).
    pub fn act(&mut self, c: Creature) {
        self.end_effects(c, super::rules_log::EndReason::Attacked, |d| d.ends_when_attacking);
    }

    fn end_effects(&mut self, c: Creature, why: super::rules_log::EndReason, f: impl Fn(&crate::defs::effects::EffectDef) -> bool) {
        let kinds = match c {
            Creature::Player(i) => self.players.get(i).map(|p| p.effects.kinds()),
            Creature::Monster(i) => self.monsters.get(i).map(|m| m.effects.kinds()),
        };
        for k in kinds.unwrap_or_default().into_iter().filter(|&k| f(&def(k))) {
            self.remove_effect_why(c, k, why);
        }
    }

    /// A monster starts a wind-up (an attack): it ends its Invisible.
    pub fn start_windup(&mut self, mi: usize, w: super::entities::Windup) {
        self.act(Creature::Monster(mi));
        self.monsters[mi].ai.windup = Some(w);
    }

    /// `apply` of `kind` for `secs` (default: its def's duration), unscaled and `Plain`.
    pub fn apply_effect(&mut self, c: Creature, kind: EffectKind, secs: Option<f64>) -> bool {
        self.apply(c, Apply::plain(kind, secs))
    }

    /// `apply` from a source of `power`: the time is scaled by the target's save (see `apply`).
    pub fn apply_effect_from(&mut self, c: Creature, kind: EffectKind, secs: Option<f64>, power: i32, magical: bool) -> bool {
        self.apply(c, Apply { power: Some(power), magical, ..Apply::plain(kind, secs) })
    }

    fn in_water(&self, pos: crate::math::Vec2) -> bool {
        let tile = self.layout.map.tile_at(pos);
        tile == Tile::ShallowWater as u8 || tile == Tile::DeepWater as u8
    }

    pub fn remove_effect(&mut self, c: Creature, kind: EffectKind) -> bool {
        let Some((fx, id, pos, _)) = self.creature(c) else { return false };
        let removed = fx.remove(kind);
        if removed {
            self.effect_event(c, id, pos, kind, false, EffectLook::Plain);
            if def(kind).attr.is_some() {
                self.refresh_attrs(c);
            }
        }
        removed
    }

    /// `remove_effect`, and the rules log is told why it ended.
    pub fn remove_effect_why(&mut self, c: Creature, kind: EffectKind, why: super::rules_log::EndReason) -> bool {
        let removed = self.remove_effect(c, kind);
        if removed {
            super::rules_log::ended(self, c, kind, why);
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
        self.apply(c, Apply::from_hit(h));
    }

    /// A pure effect hit (no damage): the same, with the hit's cause for the rules log.
    pub fn hit_effect_by(&mut self, c: Creature, h: OnHit, why: Why) {
        let origin = why.by.map(|by| (by, why.what));
        self.apply(c, Apply { origin, ..Apply::from_hit(h) });
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

    /// A monster with the Invisibility trait vanishes for `secs` and may do so again `cooldown` seconds after
    /// it is visible again (a reveal, its own attack, or running out). False, and nothing happens, without the
    /// trait, while the cooldown runs or while already Invisible.
    pub fn go_invisible(&mut self, mi: usize, secs: f64, cooldown: f64) -> bool {
        let m = &self.monsters[mi];
        if !m.alive || !m.traits.invisibility || m.invis_cd > 0.0 || m.effects.has(EffectKind::Invisible) {
            return false;
        }
        if !self.apply_effect(Creature::Monster(mi), EffectKind::Invisible, Some(secs)) {
            return false;
        }
        self.monsters[mi].invis_cd = cooldown;
        true
    }

    /// The creature's Attributes changed through its effects (a drain was added, grew, ended or was wiped): resolve its
    /// numbers again from the base and the delta. A hero gets its sheet (it keeps the light and the wolf mods it
    /// started with), a monster its `monster_numbers`. Current HP is clamped to the new maximum and never goes
    /// below 1, so a drain does not kill; when the drain ends the maximum comes back and HP does not. Nothing for
    /// the dead. The rules log gets a line per changed Attribute, and a hero whose speed or abilities changed is told.
    pub fn refresh_attrs(&mut self, c: Creature) {
        let changes: Vec<(Attr, i32, i32)> = match c {
            Creature::Player(i) => {
                let Some(p) = self.players.get_mut(i).filter(|p| p.alive) else { return };
                let mut sheet = crate::sheet::run_sheet(p.class, &p.build, p.effects.attr_delta());
                (sheet.light, sheet.wolf) = (p.sheet.light, p.sheet.wolf);
                p.res = sheet.res;
                p.max_hp = sheet.max_hp;
                p.hp = p.hp.min(p.max_hp);
                let old = std::mem::replace(&mut p.sheet, sheet);
                let sheet = &p.sheet;
                let changed = (old.speed, &old.primary, &old.secondary, &old.fallback, old.disabled) != (sheet.speed, &sheet.primary, &sheet.secondary, &sheet.fallback, sheet.disabled);
                let new_attrs = sheet.attrs;
                if changed {
                    let msg = crate::protocol::ServerMsg::HeroChanged { speed: sheet.speed, abilities: [sheet.primary.clone(), sheet.secondary.clone()], fallback: sheet.fallback.clone(), disabled: sheet.disabled };
                    self.send(&self.players[i], &msg);
                }
                Attr::ALL.into_iter().map(|a| (a, old.attrs.get(a), new_attrs.get(a))).collect()
            }
            Creature::Monster(i) => {
                let delta = self.monsters.get(i).map(|m| m.effects.attr_delta());
                let Some(m) = self.monsters.get_mut(i).filter(|m| m.alive) else { return };
                let old = m.attrs;
                let n = crate::sheet::monster_numbers(&m.base, delta.unwrap_or_default());
                (m.attrs, m.max_hp, m.speed, m.kit) = (n.attrs, n.max_hp, n.speed, n.kit);
                m.hp = m.hp.min(m.max_hp);
                Attr::ALL.into_iter().map(|a| (a, old.get(a), n.attrs.get(a))).collect()
            }
        };
        let changes: Vec<(Attr, i32, i32)> = changes.into_iter().filter(|&(_, old, new)| old != new).collect();
        super::rules_log::attrs_changed(self, c, &changes);
    }

    /// Once per step: timers count down; the dead and sinking lose everything.
    pub fn tick_effects(&mut self) {
        // The Invisibility cooldown runs only while visible.
        for m in self.monsters.iter_mut().filter(|m| m.invis_cd > 0.0 && !m.effects.has(EffectKind::Invisible)) {
            m.invis_cd = (m.invis_cd - m.effects.cooldown_dt(DT)).max(0.0);
        }
        let n = (self.players.len(), self.monsters.len());
        let all = (0..n.0).map(Creature::Player).chain((0..n.1).map(Creature::Monster));
        for c in all.collect::<Vec<_>>() {
            let Some((fx, id, pos, ok)) = self.creature(c) else { continue };
            if fx.list().is_empty() {
                continue;
            }
            if !ok {
                let mut drained = false;
                for k in fx.take_all() {
                    self.effect_event(c, id, pos, k, false, EffectLook::Plain);
                    drained |= def(k).attr.is_some();
                }
                if drained {
                    self.refresh_attrs(c);
                }
                continue;
            }
            let kinds = fx.kinds();
            // Water puts out fire.
            if self.in_water(pos) {
                for k in kinds.into_iter().filter(|&k| def(k).ends_in_water) {
                    self.remove_effect_why(c, k, super::rules_log::EndReason::Water);
                }
            }
            let Some((fx, ..)) = self.creature(c) else { continue };
            let (gone, hits) = fx.tick(DT);
            let mut drained = false;
            for k in gone {
                self.effect_event(c, id, pos, k, false, EffectLook::Plain);
                super::rules_log::ended(self, c, k, super::rules_log::EndReason::RanOut);
                drained |= def(k).attr.is_some();
            }
            if drained {
                self.refresh_attrs(c);
            }
            for (t, amount, kind, source) in hits {
                let tick = Damage { why: Why { by: source, what: What::Tick(kind), ..Why::NONE }, ..Damage::effect_tick(amount, t) };
                match c {
                    Creature::Player(i) => self.hurt_player(i, tick),
                    Creature::Monster(i) => {
                        self.hurt_monster(i, tick, false, None);
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
    use crate::defs::attributes::Attr;
    use crate::defs::damage::DamageSplit;
    use crate::run::tests::test_run;
    use crate::run::DT;

    fn boss(run: &crate::run::Run) -> usize {
        run.monsters.iter().position(|m| m.is_boss).unwrap()
    }

    /// An ogre beside the hero, made invisible (the effect added directly: no event, no reveal).
    fn invisible_ogre(run: &mut crate::run::Run) -> Creature {
        let c = fresh_ogre(run);
        let Creature::Monster(mi) = c else { unreachable!() };
        run.monsters[mi].res = Resistances::NONE;
        run.monsters[mi].effects.add(EffectKind::Invisible, 30.0);
        c
    }

    /// A skeleton given the Invisibility trait.
    fn ghostly(run: &mut crate::run::Run) -> usize {
        use crate::defs::enemies::EnemyType;
        open(run);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos() + Vec2::new(30.0, 0.0);
        let id = run.spawn_enemy(EnemyType::SkeletonWarrior, at, None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].traits.invisibility = true;
        mi
    }

    /// The effect steps `s` seconds take.
    fn secs(run: &mut crate::run::Run, s: f64) {
        for _ in 0..(s / DT).round() as usize {
            run.tick_effects();
        }
    }

    #[test]
    fn go_invisible_needs_the_trait() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mi = ghostly(&mut run);
        run.monsters[mi].traits.invisibility = false;
        assert!(!run.go_invisible(mi, 2.0, 3.0));
        assert!(!run.has_effect(Creature::Monster(mi), EffectKind::Invisible));
        assert_eq!(run.monsters[mi].invis_cd, 0.0);
    }

    #[test]
    fn invisibility_cooldown_starts_when_visible() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mi = ghostly(&mut run);
        let c = Creature::Monster(mi);
        assert!(run.go_invisible(mi, 2.0, 3.0));
        assert!(run.has_effect(c, EffectKind::Invisible));
        assert!(!run.go_invisible(mi, 2.0, 3.0), "not again at once");
        secs(&mut run, 2.0);
        assert!(!run.has_effect(c, EffectKind::Invisible), "it has run out");
        secs(&mut run, 2.0);
        assert!(!run.go_invisible(mi, 2.0, 3.0), "only 2 s of cooldown have passed");
        secs(&mut run, 1.01);
        assert!(run.go_invisible(mi, 2.0, 3.0), "5 s: ready");
        // Revealed by a hit at 1 s: the cooldown starts then.
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mi = ghostly(&mut run);
        let c = Creature::Monster(mi);
        run.monsters[mi].res = Resistances::NONE;
        assert!(run.go_invisible(mi, 2.0, 3.0));
        secs(&mut run, 1.0);
        assert!(run.has_effect(c, EffectKind::Invisible), "still invisible, no cooldown yet");
        run.hurt_monster(mi, Damage::physical(1.0), false, Some(0));
        assert!(!run.has_effect(c, EffectKind::Invisible));
        secs(&mut run, 2.9);
        assert!(!run.go_invisible(mi, 2.0, 3.0), "3.9 s: 2.9 s of cooldown since the reveal");
        secs(&mut run, 0.11);
        assert!(run.go_invisible(mi, 2.0, 3.0), "4.01 s: ready, 3 s after the reveal (not after the 2 s expiry)");
    }

    #[test]
    fn invisible_is_a_positive_effect_that_a_hit_or_an_attack_ends() {
        let d = def(EffectKind::Invisible);
        assert!(d.positive && d.ends_when_hit && d.ends_when_attacking && d.duration == 30.0);
        assert_eq!(EffectKind::Invisible as u8, 15, "the id the client draws Invisible by");
        assert!(EffectKind::ALL.iter().filter(|&&k| k != EffectKind::Invisible).all(|&k| !def(k).ends_when_hit && !def(k).ends_when_attacking));
    }

    #[test]
    fn zero_damage_hit_reveals() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        // Fully resisted Physical hit.
        let c = invisible_ogre(&mut run);
        let Creature::Monster(mi) = c else { unreachable!() };
        run.monsters[mi].res = Resistances::of(&[(DamageType::Physical, 1.0)]);
        run.hurt_monster(mi, Damage::physical(10.0), false, Some(0));
        assert_eq!(run.monsters[mi].hp, run.monsters[mi].max_hp, "no damage went through");
        assert!(!run.has_effect(c, EffectKind::Invisible), "still revealed");
        // An on-hit-only hit (no damage at all).
        let c = invisible_ogre(&mut run);
        let Creature::Monster(mi) = c else { unreachable!() };
        run.hurt_monster(mi, Damage::physical(0.0).with_effect(sleepy()), false, Some(0));
        assert!(!run.has_effect(c, EffectKind::Invisible));
        // A hit the shielded boss absorbs.
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        let bi = run.monsters.iter().position(|m| m.is_boss).unwrap();
        run.monsters[bi].effects.add(EffectKind::Invisible, 30.0);
        assert!(!run.hurt_monster(bi, Damage::physical(100.0), false, Some(0)), "the shield absorbs it");
        assert!(!run.has_effect(Creature::Monster(bi), EffectKind::Invisible));
    }

    #[test]
    fn a_hit_on_an_invisible_hero_reveals_it_too() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.players[0].effects.add(EffectKind::Invisible, 30.0);
        run.hurt_player(0, Damage::physical(1.0));
        assert!(!run.has_effect(Creature::Player(0), EffectKind::Invisible));
    }

    #[test]
    fn an_invisible_undead_cannot_be_put_to_sleep_and_stays_invisible() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mi = ghostly(&mut run);
        let c = Creature::Monster(mi);
        assert!(run.go_invisible(mi, 5.0, 3.0));
        let (outcome, _, _) = run.apply_traced(c, Apply::plain(EffectKind::Sleep, Some(4.0)));
        assert!(matches!(outcome, EffectOutcome::Resisted | EffectOutcome::TypeImmune(_)), "{outcome:?}");
        assert!(!run.has_effect(c, EffectKind::Sleep));
        assert!(run.has_effect(c, EffectKind::Invisible));
    }

    #[test]
    fn shrugged_off_effect_does_not_reveal() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let c = invisible_ogre(&mut run);
        let Creature::Monster(mi) = c else { unreachable!() };
        run.monsters[mi].effect_res.set(EffectKind::Fear, 1.0);
        let (outcome, _, _) = run.apply_traced(c, Apply::plain(EffectKind::Fear, Some(2.0)));
        assert_eq!(outcome, EffectOutcome::Resisted);
        assert!(run.has_effect(c, EffectKind::Invisible), "only an effect that takes hold reveals");
        let (outcome, _, _) = run.apply_traced(c, Apply::plain(EffectKind::Slowed, Some(2.0)));
        assert_eq!(outcome, EffectOutcome::Added);
        assert!(!run.has_effect(c, EffectKind::Invisible));
    }

    #[test]
    fn effect_ticks_do_not_reveal() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let c = invisible_ogre(&mut run);
        let Creature::Monster(mi) = c else { unreachable!() };
        run.hurt_monster(mi, Damage::effect_tick(1.0, DamageType::Heat), false, None);
        assert!(run.monsters[mi].hp < run.monsters[mi].max_hp);
        assert!(run.has_effect(c, EffectKind::Invisible));
    }

    #[test]
    fn positive_effects_do_not_reveal() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let c = invisible_ogre(&mut run);
        assert!(run.apply_effect(c, EffectKind::Warded, Some(2.0)));
        assert!(run.has_effect(c, EffectKind::Invisible));
    }

    #[test]
    fn attacking_reveals() {
        use crate::defs::enemies::EnemyType;
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        open(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos() + Vec2::new(30.0, 0.0);
        let id = run.spawn_enemy(EnemyType::SkeletonArcher, at, None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].effects.add(EffectKind::Invisible, 30.0);
        run.start_windup(mi, crate::run::entities::Windup { t: 0.5, aim: 0.0, alt: false, at: None });
        assert!(!run.has_effect(Creature::Monster(mi), EffectKind::Invisible));
        assert!(run.monsters[mi].ai.windup.is_some());
        // A hero who fires an ability.
        run.players[0].effects.add(EffectKind::Invisible, 30.0);
        crate::run::abilities::try_use(&mut run, 0, true, 0);
        assert!(!run.has_effect(Creature::Player(0), EffectKind::Invisible));
    }

    #[test]
    fn an_invisible_monster_tells_no_event_to_the_clients() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let c = fresh_ogre(&mut run);
        let Creature::Monster(mi) = c else { unreachable!() };
        let inv = EffectKind::Invisible as u8;
        run.events.clear();
        run.apply_effect(c, EffectKind::Invisible, None);
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Effect { kind, on: true, .. } if *kind == inv)), "going invisible is told");
        run.events.clear();
        run.hurt_monster(mi, Damage::effect_tick(1.0, DamageType::Heat), false, None);
        run.monsters[mi].effects.add(EffectKind::Slowed, 2.0);
        run.remove_effect(c, EffectKind::Slowed);
        assert!(run.events.iter().all(|(e, _)| !matches!(e, Ev::Effect { .. } | Ev::Dmg { .. })), "no tick number or other effect: {:?}", run.events);
        run.events.clear();
        run.hurt_monster(mi, Damage::physical(1.0), false, Some(0));
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Effect { kind, on: false, .. } if *kind == inv)), "the reveal is told");
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Dmg { .. })), "revealed: the hit shows");
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
        free.knock_player(0, from, 0.0, 40.0, crate::run::tests::PUSH_STR);
        run.apply_effect(Creature::Player(0), EffectKind::Petrified, Some(5.0));
        run.knock_player(0, from, 0.0, 40.0, crate::run::tests::PUSH_STR);
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
        let id = run.spawn_enemy(EnemyType::OrcArcher, at, None);
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
        OnHit { kind: EffectKind::Sleep, secs: 2.0, magical: false, power: 10, look: EffectLook::Plain }
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
        run.hit_effect(c, OnHit { kind: EffectKind::Singed, secs: 3.0, magical: false, power: 10, look: EffectLook::Plain });
        assert!(!run.has_effect(c, EffectKind::Frozen) && !run.has_effect(c, EffectKind::Singed));
    }

    #[test]
    fn an_on_hit_effect_always_lands() {
        use rand::RngCore;
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mut twin = run.rng.clone();
        for _ in 0..20 {
            let c = fresh_ogre(&mut run);
            run.hit_effect(c, OnHit { kind: EffectKind::Blind, secs: 2.0, magical: false, power: 10, look: EffectLook::Plain });
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
        run.hurt_player(0, Damage::physical(0.0).with_effect(OnHit { kind: EffectKind::Blind, secs: 1.0, magical: false, power: 10, look: EffectLook::Plain }));
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
        run.hurt_player(0, Damage::physical(10_000.0).with_effect(OnHit { kind: EffectKind::Blind, secs: 1.0, magical: false, power: 10, look: EffectLook::Plain }));
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
        run.hurt_player(0, Damage::effect_tick(5.0, DamageType::Heat).with_effect(OnHit { kind: EffectKind::Slowed, secs: 1.0, magical: false, power: 10, look: EffectLook::Plain }));
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
        OnHit { kind: EffectKind::Sleep, secs: 2.0, magical: true, power: 22, look: EffectLook::Plain }
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
    fn unbreakable_shortens_con_saves() {
        use crate::defs::loadout::Build;
        use crate::defs::trees::NodeId;
        let burn = |nodes: &[NodeId]| {
            let b = Build { nodes: nodes.to_vec(), ..Build::start(ClassId::Barbarian) };
            let mut run = crate::run::tests::test_run_with(&[(ClassId::Barbarian, b)], BossId::Demon);
            open(&mut run);
            assert!(run.apply_effect_from(Creature::Player(0), EffectKind::Burning, None, 15, false));
            left_of(&run, Creature::Player(0), EffectKind::Burning).expect("burning")
        };
        let (free, tough) = (burn(&[]), burn(&[NodeId::BD5]));
        assert!(tough < free, "{tough} vs {free}");
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

    #[test]
    fn an_incorporeal_monster_refuses_entangled() {
        use crate::defs::races::{profile, Adjust, Race};
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        open(&mut run);
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        let id = run.spawn_enemy(crate::defs::enemies::EnemyType::OrcWarrior, at, None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].effect_res = profile(&[Race::Incorporeal], Adjust::NONE).effect_res;
        let c = Creature::Monster(mi);
        assert_eq!(run.apply_effect(c, EffectKind::Entangled, Some(2.0)), false);
        assert!(!run.has_effect(c, EffectKind::Entangled));
    }

    #[test]
    fn an_effect_names_its_own_save() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        open(&mut run);
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        let spawn = |run: &mut crate::run::Run, t| {
            let id = run.spawn_enemy(t, at, None);
            Creature::Monster(run.monster_idx(id).unwrap())
        };
        use crate::defs::enemies::EnemyType;
        for magical in [false, true] {
            let goblin = spawn(&mut run, EnemyType::GoblinArcher);
            assert!(run.apply_effect_from(goblin, EffectKind::Fear, None, 16, magical));
            assert!((left_of(&run, goblin, EffectKind::Fear).unwrap() - 3.0 * 1.4).abs() < 1e-9, "WIL 8 whatever `magical` says");
            let orc = spawn(&mut run, EnemyType::OrcWarrior);
            assert!(run.apply_effect_from(orc, EffectKind::Fear, None, 16, magical));
            assert!((left_of(&run, orc, EffectKind::Fear).unwrap() - 3.75).abs() < 1e-9, "WIL 11");
        }
        let ogre = spawn(&mut run, EnemyType::Ogre);
        assert!(run.apply_effect_from(ogre, EffectKind::Entangled, None, 14, true));
        let want = 3.0 * (1.0 + (14.0 - 19.0) / 20.0);
        assert!((left_of(&run, ogre, EffectKind::Entangled).unwrap() - want).abs() < 1e-9, "STR 19");
    }

    #[test]
    fn the_look_and_source_ride_on_the_effect() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let c = fresh_ogre(&mut run);
        let (hid, hpos) = (run.players[0].id, run.players[0].pos());
        let vines = Apply { look: EffectLook::Vines, source: Some((hid, hpos)), ..Apply::plain(EffectKind::Entangled, Some(2.0)) };
        assert!(run.apply(c, vines));
        let Creature::Monster(mi) = c else { unreachable!() };
        let fx = &run.monsters[mi].effects;
        assert_eq!(fx.looks().collect::<Vec<_>>(), vec![(EffectKind::Entangled, EffectLook::Vines)]);
        let a = fx.list().iter().find(|a| a.kind == EffectKind::Entangled).unwrap();
        assert_eq!((a.source, a.from), (Some(hid), hpos));
        assert!(run.apply(c, Apply::plain(EffectKind::Entangled, Some(1.0))));
        let fx = &run.monsters[mi].effects;
        assert_eq!(fx.looks().count(), 0, "a refresh takes the new look");
        let a = fx.list().iter().find(|a| a.kind == EffectKind::Entangled).unwrap();
        assert_eq!((a.left, a.source, a.from), (2.0, None, Vec2::ZERO), "and keeps the longer time");
    }

    #[test]
    fn fear_remembers_its_source() {
        let mut e = Effects::default();
        assert_eq!(e.fear_from(), None);
        e.add_with(EffectKind::Fear, 3.0, EffectLook::Plain, Some((5, Vec2::new(1.0, 2.0))), 0);
        assert_eq!(e.fear_from(), Some((Some(5), Vec2::new(1.0, 2.0))));
        e.set_fear_from(Vec2::new(3.0, 4.0));
        assert_eq!(e.fear_from(), Some((Some(5), Vec2::new(3.0, 4.0))));
    }

    #[test]
    fn warded_refuses_the_lichs_spells_only() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        let me = Creature::Player(0);
        assert!(run.apply_effect(me, EffectKind::Warded, Some(3.0)));
        for k in [EffectKind::Sleep, EffectKind::Blind, EffectKind::Petrified] {
            assert!(!run.apply_effect(me, k, Some(2.0)), "{k:?} is refused");
        }
        for k in [EffectKind::Slowed, EffectKind::Burning] {
            assert!(run.apply_effect(me, k, Some(2.0)), "{k:?} still lands");
        }
    }

    #[test]
    fn undead_and_bosses_never_fear_and_demons_fear_half() {
        use crate::defs::enemies::EnemyType;
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        open(&mut run);
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        let id = run.spawn_enemy(EnemyType::SkeletonWarrior, at, None);
        let skel = Creature::Monster(run.monster_idx(id).unwrap());
        assert!(!run.apply_effect(skel, EffectKind::Fear, Some(3.0)), "undead are never frightened");
        let id = run.spawn_enemy(EnemyType::Imp, at, None);
        let imp = Creature::Monster(run.monster_idx(id).unwrap());
        assert!(run.apply_effect_from(imp, EffectKind::Fear, None, 16, false));
        let Creature::Monster(ii) = imp else { unreachable!() };
        let wil = run.monsters[ii].attrs.get(Attr::Wil);
        assert!((left_of(&run, imp, EffectKind::Fear).unwrap() - scaled_secs(3.0, 16, wil) * 0.5).abs() < 1e-9, "half the scaled time");
        for b in BossId::ALL {
            assert!(crate::defs::bosses::profile(b).effect_res.get(EffectKind::Fear) >= 1.0, "{b:?}");
        }
    }

    #[test]
    fn the_start_event_carries_the_look() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let c = fresh_ogre(&mut run);
        run.events.clear();
        assert!(run.apply(c, Apply { look: EffectLook::Vines, ..Apply::plain(EffectKind::Entangled, Some(1.0)) }));
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Effect { kind: 11, on: true, look: 1, .. })));
        run.remove_effect(c, EffectKind::Entangled);
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Effect { kind: 11, on: false, look: 0, .. })));
    }

    // ---- Attribute drains (Weakened, Clumsy, Frail) ----

    fn drain(run: &mut crate::run::Run, c: Creature, k: EffectKind, secs: f64, power: Option<i32>) -> EffectOutcome {
        run.apply_traced(c, Apply { power, ..Apply::plain(k, Some(secs)) }).0
    }

    fn fx_of(run: &crate::run::Run, c: Creature) -> &Effects {
        match c {
            Creature::Player(i) => &run.players[i].effects,
            Creature::Monster(i) => &run.monsters[i].effects,
        }
    }

    #[test]
    fn drains_stack_and_refresh() {
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        let h = Creature::Player(0);
        let str0 = run.players[0].sheet.attrs.get(Attr::Str);
        assert_eq!(drain(&mut run, h, EffectKind::Weakened, 20.0, None), EffectOutcome::Added);
        assert_eq!(fx_of(&run, h).amount(EffectKind::Weakened), -1);
        assert_eq!(drain(&mut run, h, EffectKind::Weakened, 30.0, None), EffectOutcome::Refreshed);
        assert_eq!(fx_of(&run, h).amount(EffectKind::Weakened), -2);
        assert_eq!(left_of(&run, h, EffectKind::Weakened), Some(30.0), "the longer time");
        assert_eq!(drain(&mut run, h, EffectKind::Weakened, 5.0, None), EffectOutcome::Refreshed);
        assert_eq!(left_of(&run, h, EffectKind::Weakened), Some(30.0), "a shorter touch does not shorten it");
        assert_eq!(fx_of(&run, h).amount(EffectKind::Weakened), -3);
        assert_eq!(fx_of(&run, h).attr_delta().get(Attr::Str), -3);
        assert_eq!(fx_of(&run, h).amount(EffectKind::Sleep), 0);
        assert_eq!(run.players[0].sheet.attrs.get(Attr::Str), str0 - 3);
        // Power 30 adds -2 in one touch.
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        drain(&mut run, h, EffectKind::Weakened, 20.0, Some(30));
        assert_eq!(fx_of(&run, h).amount(EffectKind::Weakened), -2);
        assert_eq!(run.players[0].sheet.attrs.get(Attr::Str), str0 - 2);
    }

    #[test]
    fn the_save_reads_the_current_attribute() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        let h = Creature::Player(0);
        let wil = run.players[0].sheet.attrs.get(Attr::Wil);
        let power = 22;
        let magical = |run: &mut crate::run::Run| run.apply_traced(h, Apply { power: Some(power), magical: true, ..Apply::plain(EffectKind::Frail, None) });
        for _ in 0..2 {
            let (outcome, d, _) = magical(&mut run);
            assert!(matches!(outcome, EffectOutcome::Added | EffectOutcome::Refreshed));
            let (p, a, v, secs) = d.save.expect("a save");
            assert_eq!((p, a, v), (power, Attr::Wil, wil), "Frail leaves WIL alone");
            assert!((secs - scaled_secs(20.0, power, wil)).abs() < 1e-12);
        }
        assert_eq!(fx_of(&run, h).amount(EffectKind::Frail), -2);
    }

    #[test]
    fn a_drain_ending_restores_the_numbers_but_not_hp() {
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        let h = Creature::Player(0);
        let before = run.players[0].sheet.clone();
        for _ in 0..3 {
            drain(&mut run, h, EffectKind::Frail, 20.0, None);
        }
        let want = before.max_hp - 3.0 * crate::defs::attributes::CON_HP;
        assert_eq!(run.players[0].max_hp, want);
        assert_eq!(run.players[0].sheet.max_hp, want);
        assert_eq!(run.players[0].hp, want, "clamped to the new maximum");
        assert!(run.players[0].sheet.speed < before.speed);
        for _ in 0..(20.0 / DT).round() as usize + 1 {
            run.tick_effects();
        }
        assert!(!run.has_effect(h, EffectKind::Frail));
        assert_eq!(run.players[0].sheet, before);
        assert_eq!(run.players[0].max_hp, before.max_hp);
        assert_eq!(run.players[0].hp, want, "hp is not given back");
    }

    #[test]
    fn a_drain_never_kills() {
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        let h = Creature::Player(0);
        run.players[0].hp = 3.0;
        assert!(matches!(drain(&mut run, h, EffectKind::Frail, 20.0, Some(300)), EffectOutcome::Added));
        let p = &run.players[0];
        assert!(p.alive && p.max_hp >= 1.0);
        assert_eq!(p.hp, 3.0f64.min(p.max_hp));
        assert!(p.hp >= 1.0);
    }

    #[test]
    fn monster_drain_rebuilds_its_kit() {
        use crate::defs::abilities::AbilityId;
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let at = run.players[0].pos();
        let id = run.spawn_enemy(crate::defs::enemies::EnemyType::OrcWarrior, at, None);
        let mi = run.monster_idx(id).unwrap();
        let c = Creature::Monster(mi);
        let (str0, dmg0) = (run.monsters[mi].attrs.get(Attr::Str), run.monsters[mi].kit.get(AbilityId::Strike).unwrap().damage);
        drain(&mut run, c, EffectKind::Weakened, 20.0, None);
        assert_eq!(run.monsters[mi].attrs.get(Attr::Str), str0 - 1);
        assert!(run.monsters[mi].kit.get(AbilityId::Strike).unwrap().damage < dmg0);
        run.remove_effect(c, EffectKind::Weakened);
        let m = &run.monsters[mi];
        let want = crate::sheet::monster_numbers(&m.base, crate::defs::attributes::Attributes::default());
        assert_eq!((m.attrs, m.max_hp, m.speed), (m.base.attrs, m.base.max_hp, m.base.speed));
        assert_eq!(m.kit, want.kit);
        assert_eq!(m.kit.get(AbilityId::Strike).unwrap().damage, dmg0);
    }

    #[test]
    fn monster_hp_floor() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let at = run.players[0].pos();
        let id = run.spawn_enemy(crate::defs::enemies::EnemyType::GoblinArcher, at, None);
        let c = Creature::Monster(run.monster_idx(id).unwrap());
        let Creature::Monster(mi) = c else { unreachable!() };
        for _ in 0..40 {
            drain(&mut run, c, EffectKind::Frail, 20.0, Some(400));
        }
        let m = &run.monsters[mi];
        assert!(m.alive, "a drain never kills");
        assert_eq!(m.max_hp, 1.0, "max HP sits on the floor");
        assert_eq!(m.hp, 1.0);
    }

    #[test]
    fn full_resistance_refuses_the_drain() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let c = fresh_ogre(&mut run);
        let Creature::Monster(mi) = c else { unreachable!() };
        run.monsters[mi].effect_res.set(EffectKind::Weakened, 1.0);
        let str0 = run.monsters[mi].attrs.get(Attr::Str);
        assert_eq!(drain(&mut run, c, EffectKind::Weakened, 20.0, Some(10)), EffectOutcome::Resisted);
        assert_eq!(fx_of(&run, c).attr_delta(), crate::defs::attributes::Attributes::default());
        assert_eq!(run.monsters[mi].attrs.get(Attr::Str), str0);
    }

    #[test]
    fn death_wipes_drains_without_panic() {
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        let h = Creature::Player(0);
        drain(&mut run, h, EffectKind::Frail, 20.0, None);
        drain(&mut run, h, EffectKind::Weakened, 20.0, None);
        run.players[0].alive = false;
        run.tick_effects();
        assert!(fx_of(&run, h).list().is_empty());
    }

    #[test]
    fn hero_changed_is_sent_on_a_change() {
        use crate::protocol::{encode, ServerMsg};
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        run.players[0].tx = Some(tx);
        let h = Creature::Player(0);
        drain(&mut run, h, EffectKind::Weakened, 20.0, None);
        let s = run.players[0].sheet.clone();
        let want = encode(&ServerMsg::HeroChanged { speed: s.speed, abilities: [s.primary, s.secondary], fallback: s.fallback, disabled: s.disabled });
        let Ok(axum::extract::ws::Message::Binary(got)) = rx.try_recv() else { panic!("a HeroChanged") };
        assert_eq!(got.to_vec(), want);
        assert!(rx.try_recv().is_err(), "one message");
        // Nothing the hero's numbers do not show: no message.
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        run.players[0].tx = Some(tx);
        run.refresh_attrs(h);
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn spawned_monsters_base_reproduces_their_numbers() {
        use crate::defs::attributes::Attributes;
        use crate::defs::enemies::EnemyType;
        use crate::sheet::{monster_numbers, WolfMods};
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        let at = run.players[0].pos();
        for t in EnemyType::ALL {
            run.spawn_enemy(t, at, None);
        }
        run.players[0].sheet.wolf = WolfMods { hp_mul: 1.5, ..WolfMods::NONE };
        crate::run::companion::spawn_wolf(&mut run, 0);
        assert!(run.monsters.iter().any(|m| m.is_boss));
        for m in &run.monsters {
            let n = monster_numbers(&m.base, Attributes::default());
            assert_eq!(n.attrs, m.attrs, "{:?}", m.kind);
            assert_eq!(n.max_hp, m.max_hp, "{:?}", m.kind);
            assert_eq!(n.speed.to_bits(), m.speed.to_bits(), "{:?}", m.kind);
            assert_eq!(n.kit, m.kit, "{:?}", m.kind);
        }
    }

    #[test]
    fn vanish_cooldown_pauses_while_invisible_and_runs_on_the_clock() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mi = ghostly(&mut run);
        run.monsters[mi].invis_cd = 2.0;
        run.apply_effect(Creature::Monster(mi), EffectKind::Invisible, Some(60.0));
        for _ in 0..30 {
            run.tick_effects();
        }
        assert_eq!(run.monsters[mi].invis_cd, 2.0, "paused while Invisible");
        run.monsters[mi].effects.remove(EffectKind::Invisible);
        run.apply_effect(Creature::Monster(mi), EffectKind::Slowed, Some(60.0));
        for _ in 0..30 {
            run.tick_effects();
        }
        assert!((run.monsters[mi].invis_cd - (2.0 - 30.0 * 0.75 * DT)).abs() < 1e-9, "{}", run.monsters[mi].invis_cd);
    }
}
