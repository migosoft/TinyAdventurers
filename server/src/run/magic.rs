//! The pause at run time: anti-magic on a creature and Dispel timers on effects and lasting sources
//! (worn items, tree nodes). A paused source counts for nothing; the creature's numbers are resolved
//! again and the client is told which effects went off or on. The data lives in `Effects`.

use super::effects::{Creature, Effects};
use super::light::Anchor;
use super::Run;
use crate::defs::attributes::Attributes;
use crate::defs::effects::{def, EffectKind, EffectLook};
use crate::defs::lights::LightKind;
use crate::sheet::Lasting;

/// Which side of a creature's magic a Dispel goes for: on an enemy `Positive`, on an ally `Negative`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // the Dispel spells (#217) build `Negative`
pub enum Want {
    Positive,
    Negative,
}

/// One thing a Dispel pauses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pick {
    Effect(EffectKind),
    Lasting(Lasting),
}

/// What a Dispel on a creature with effects `fx` and magic lasting `sources` picks, at most `n`: magic that is not already
/// under a Dispel, of the wanted side (lasting sources count as positive). Lasting sources first (they never run out),
/// in `Lasting` order; then effects by time left, longest first, ties by effect id.
pub fn dispel_picks(fx: &Effects, sources: &[Lasting], want: Want, n: usize) -> Vec<Pick> {
    let mut lasting: Vec<Lasting> = if want == Want::Positive { sources.iter().copied().filter(|s| fx.lasting_left(*s) <= 0.0).collect() } else { Vec::new() };
    lasting.sort();
    lasting.dedup();
    let mut effects: Vec<(EffectKind, f64)> = Vec::new();
    for a in fx.list() {
        // `dispel_effect` pauses the first magical entry of a kind, so that is the one that must be free.
        if a.magical && a.dispel <= 0.0 && (def(a.kind).positive == (want == Want::Positive)) && !effects.iter().any(|e| e.0 == a.kind) && fx.list().iter().find(|b| b.kind == a.kind && b.magical).is_some_and(|b| b.dispel <= 0.0) {
            effects.push((a.kind, a.left));
        }
    }
    effects.sort_by(|a, b| b.1.total_cmp(&a.1).then((a.0 as u8).cmp(&(b.0 as u8))));
    lasting.into_iter().map(Pick::Lasting).chain(effects.into_iter().map(|e| Pick::Effect(e.0))).take(n).collect()
}

/// What the pause changes, as it stood at one moment: the kinds that count, the muted sources and the Attribute delta.
pub(super) struct PauseState {
    bits: u32,
    muted: Vec<Lasting>,
    delta: Attributes,
}

impl Run {
    /// The lasting magic `c` has: the worn items with a magical property and the bought magic nodes of a hero,
    /// the magical weapons of a monster. Sorted.
    pub fn magic_sources(&self, c: Creature) -> Vec<Lasting> {
        match c {
            Creature::Player(i) => self.players.get(i).map(|p| crate::sheet::magic_sources_hero(p.class, &p.build)).unwrap_or_default(),
            Creature::Monster(i) => self.monsters.get(i).map(|m| crate::sheet::magic_sources_monster(m.base.kit)).unwrap_or_default(),
        }
    }

    /// The sources whose properties do not count now: all the magic ones under anti-magic, else those a Dispel holds.
    pub(super) fn muted_list(&self, c: Creature) -> Vec<Lasting> {
        let fx = match c {
            Creature::Player(i) => self.players.get(i).map(|p| &p.effects),
            Creature::Monster(i) => self.monsters.get(i).map(|m| &m.effects),
        };
        match fx {
            Some(fx) if fx.anti_magic => self.magic_sources(c),
            Some(fx) => fx.dispelled(),
            None => Vec::new(),
        }
    }

    pub(super) fn pause_state(&self, c: Creature) -> Option<PauseState> {
        let fx = match c {
            Creature::Player(i) => &self.players.get(i)?.effects,
            Creature::Monster(i) => &self.monsters.get(i)?.effects,
        };
        Some(PauseState { bits: fx.bits(), muted: self.muted_list(c), delta: fx.attr_delta() })
    }

    /// Tells the client of every kind (but `skip`) whose bit changed since `before`, and resolves the numbers
    /// again when the muted sources or an Attribute drain changed.
    pub(super) fn settle_pause(&mut self, c: Creature, before: PauseState, skip: &[EffectKind]) {
        let Some(after) = self.pause_state(c) else { return };
        let Some((fx, id, pos, ok)) = self.creature(c) else { return };
        let looks = fx.looks();
        if ok {
            for k in EffectKind::ALL.into_iter().filter(|k| !skip.contains(k) && (before.bits ^ after.bits) & k.bit() != 0) {
                let on = after.bits & k.bit() != 0;
                let look = looks.iter().find(|l| l.0 == k).map_or(EffectLook::Plain, |l| l.1);
                self.effect_event(c, id, pos, k, on, look);
            }
        }
        if before.muted != after.muted || before.delta != after.delta {
            self.refresh_attrs(c);
        }
    }

    /// Applies `f` to `c`'s effects and settles the pause (see `settle_pause`).
    fn repause(&mut self, c: Creature, f: impl FnOnce(&mut Effects)) {
        let Some(before) = self.pause_state(c) else { return };
        if let Some((fx, ..)) = self.creature(c) {
            f(fx);
        }
        self.settle_pause(c, before, &[]);
    }

    /// An anti-magic zone is on or off `c`: its magic is paused or back.
    pub fn set_anti_magic(&mut self, c: Creature, on: bool) {
        self.repause(c, |fx| fx.anti_magic = on);
    }

    /// A Dispel pauses the lasting source `src` of `c` for `secs`.
    #[allow(dead_code)] // single pauses; `dispel` pauses through `repause` itself
    pub fn pause_lasting(&mut self, c: Creature, src: Lasting, secs: f64) {
        self.repause(c, |fx| fx.dispel_lasting(src, secs));
    }

    /// A Dispel pauses the magic entry of `kind` on `c` for `secs`.
    #[allow(dead_code)] // single pauses; `dispel` pauses through `repause` itself
    pub fn pause_effect(&mut self, c: Creature, kind: EffectKind, secs: f64) {
        self.repause(c, |fx| {
            fx.dispel_effect(kind, secs);
        });
    }

    /// A Dispel on `c`: pauses what `dispel_picks` picks for `secs`, all in one `repause`, so the events and the refresh happen once.
    pub fn dispel(&mut self, c: Creature, want: Want, n: usize, secs: f64) -> Vec<Pick> {
        let sources = self.magic_sources(c);
        let picks = match c {
            Creature::Player(i) => self.players.get(i).map(|p| dispel_picks(&p.effects, &sources, want, n)),
            Creature::Monster(i) => self.monsters.get(i).map(|m| dispel_picks(&m.effects, &sources, want, n)),
        }
        .unwrap_or_default();
        let todo = picks.clone();
        self.repause(c, move |fx| {
            for p in todo {
                match p {
                    Pick::Effect(k) => {
                        fx.dispel_effect(k, secs);
                    }
                    Pick::Lasting(l) => fx.dispel_lasting(l, secs),
                }
            }
        });
        picks
    }

    /// A hero's item light changed (its source was muted or came back): the entity-anchored light is swapped.
    pub(super) fn swap_entity_light(&mut self, id: u32, old: Option<LightKind>, new: Option<LightKind>) {
        if let Some(old) = old {
            let found = self.lights.sources.iter().find(|s| s.anchor == Anchor::Entity(id) && s.kind == old).map(|s| s.id);
            if let Some(light) = found {
                self.remove_light(light);
            }
        }
        if let Some(new) = new {
            self.add_light(new, Anchor::Entity(id), None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::attributes::Attr;
    use crate::defs::enemies::EnemyType;
    use crate::defs::items::{EquipSlot, Equipment, ItemId};
    use crate::defs::loadout::Build;
    use crate::protocol::{BossId, ClassId, Ev};
    use crate::run::effects::Apply;
    use crate::run::tests::{test_run, test_run_with};
    use crate::run::DT;

    fn magic(kind: EffectKind, secs: f64) -> Apply {
        Apply { magical: true, ..Apply::plain(kind, Some(secs)) }
    }

    fn told(run: &Run, kind: EffectKind, on: bool) -> bool {
        run.events.iter().any(|(e, _)| matches!(e, Ev::Effect { kind: k, on: o, .. } if *k == kind as u8 && *o == on))
    }

    fn steps(run: &mut Run, secs: f64) {
        for _ in 0..(secs / DT).round() as usize {
            run.tick_effects();
        }
    }

    fn wearing(class: ClassId, slot: EquipSlot, id: ItemId) -> Vec<(ClassId, Build)> {
        vec![(class, Build { equipment: Equipment::starter(class).with(slot, id), ..Build::start(class) })]
    }

    #[test]
    fn anti_magic_pauses_and_restores_a_buff() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let me = Creature::Player(0);
        assert!(run.apply(me, magic(EffectKind::Accelerated, 20.0)));
        assert!(run.players[0].effects.speed_mul() > 1.0);
        run.events.clear();
        run.set_anti_magic(me, true);
        assert_eq!(run.players[0].effects.speed_mul(), 1.0);
        assert_eq!(run.players[0].effects.bits() & EffectKind::Accelerated.bit(), 0, "the snapshot bit is off");
        assert!(told(&run, EffectKind::Accelerated, false));
        run.events.clear();
        run.set_anti_magic(me, false);
        assert!(run.players[0].effects.speed_mul() > 1.0);
        assert_ne!(run.players[0].effects.bits() & EffectKind::Accelerated.bit(), 0);
        assert!(told(&run, EffectKind::Accelerated, true));
        run.events.clear();
        run.set_anti_magic(me, false);
        assert!(run.events.iter().all(|(e, _)| !matches!(e, Ev::Effect { .. })), "no change, no event");
    }

    #[test]
    fn a_paused_drain_gives_the_attribute_back() {
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        let me = Creature::Player(0);
        let str0 = run.players[0].sheet.attrs.get(Attr::Str);
        let hp0 = run.players[0].max_hp;
        run.apply(me, magic(EffectKind::Weakened, 30.0));
        run.apply(me, magic(EffectKind::Weakened, 30.0));
        assert_eq!(run.players[0].sheet.attrs.get(Attr::Str), str0 - 2);
        run.set_anti_magic(me, true);
        assert_eq!(run.players[0].sheet.attrs.get(Attr::Str), str0, "the Attribute is back");
        run.set_anti_magic(me, false);
        assert_eq!(run.players[0].sheet.attrs.get(Attr::Str), str0 - 2, "and taken again");
        // HP is clamped as before: a smaller maximum cuts it, a restored one does not refill it.
        let con0 = run.players[0].sheet.attrs.get(Attr::Con);
        run.apply(me, magic(EffectKind::Frail, 30.0));
        assert!(run.players[0].max_hp < hp0);
        run.players[0].hp = run.players[0].max_hp;
        run.set_anti_magic(me, true);
        assert_eq!(run.players[0].sheet.attrs.get(Attr::Con), con0);
        assert_eq!(run.players[0].max_hp, hp0);
        assert!(run.players[0].hp < hp0, "HP is not refilled");
        run.set_anti_magic(me, false);
        assert!(run.players[0].hp <= run.players[0].max_hp && run.players[0].hp >= 1.0);
    }

    #[test]
    fn an_effect_running_out_while_paused_ends_normally() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let me = Creature::Player(0);
        run.log.forced = true;
        run.apply(me, magic(EffectKind::Slowed, 1.0));
        run.set_anti_magic(me, true);
        run.events.clear();
        crate::run::rules_log::take(&mut run);
        steps(&mut run, 1.5);
        assert!(run.players[0].effects.list().is_empty());
        assert!(told(&run, EffectKind::Slowed, false), "the end event");
        let heads: Vec<String> = crate::run::rules_log::take(&mut run).into_iter().map(|r| r.head).collect();
        assert!(heads.iter().any(|h| h.starts_with("Slowed on") && h.ends_with("ended")), "RanOut: {heads:?}");
    }

    #[test]
    fn paused_invisibility_shows_the_ghost() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos() + crate::math::Vec2::new(30.0, 0.0);
        let id = run.spawn_enemy(EnemyType::SkeletonWarrior, at, None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].traits.invisibility = true;
        let c = Creature::Monster(mi);
        assert!(run.go_invisible(mi, 10.0, 3.0));
        assert!(run.has_effect(c, EffectKind::Invisible), "hidden from the heroes' snapshot");
        run.events.clear();
        run.set_anti_magic(c, true);
        // The snapshot filter reads `has(Invisible)`.
        assert!(!run.monsters[mi].effects.has(EffectKind::Invisible), "the ghost shows");
        assert!(told(&run, EffectKind::Invisible, false), "the client plays the appear");
        run.events.clear();
        run.set_anti_magic(c, false);
        assert!(run.monsters[mi].effects.has(EffectKind::Invisible));
        assert!(told(&run, EffectKind::Invisible, true), "and the vanish");
    }

    #[test]
    fn anti_magic_mutes_magic_gear_and_its_light() {
        let mut run = test_run_with(&wearing(ClassId::Wizard, EquipSlot::Melee, ItemId::EmberStaff), BossId::Demon);
        let me = Creature::Player(0);
        let id = run.players[0].id;
        let lit = |run: &Run| run.lights.sources.iter().filter(|s| s.anchor == Anchor::Entity(id)).count();
        let heat = |run: &Run| run.players[0].sheet.melee.split.share(crate::defs::damage::DamageType::Heat);
        assert!(heat(&run) > 0.0 && lit(&run) == 1);
        assert_eq!(run.magic_sources(me), vec![Lasting::Item(ItemId::EmberStaff)]);
        run.set_anti_magic(me, true);
        assert_eq!(heat(&run), 0.0, "no heat share");
        assert_eq!(lit(&run), 0, "the light is removed");
        run.set_anti_magic(me, false);
        assert!(heat(&run) > 0.0);
        assert_eq!(lit(&run), 1, "and back");
    }

    #[test]
    fn a_dispel_pause_ends_after_its_time() {
        let mut run = test_run_with(&wearing(ClassId::Paladin, EquipSlot::Ring1, ItemId::BandOfVigor), BossId::Demon);
        let me = Creature::Player(0);
        let con = |run: &Run| run.players[0].sheet.attrs.get(Attr::Con);
        let con0 = con(&run);
        run.pause_lasting(me, Lasting::Item(ItemId::BandOfVigor), 2.0);
        assert_eq!(con(&run), con0 - 1);
        steps(&mut run, 1.5);
        assert_eq!(con(&run), con0 - 1, "still paused");
        steps(&mut run, 0.6);
        assert_eq!(con(&run), con0, "and back");
    }

    #[test]
    fn a_dispelled_effect_comes_back_with_its_events() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let me = Creature::Player(0);
        run.apply(me, magic(EffectKind::Accelerated, 20.0));
        run.events.clear();
        run.pause_effect(me, EffectKind::Accelerated, 1.0);
        assert!(told(&run, EffectKind::Accelerated, false));
        run.events.clear();
        steps(&mut run, 1.2);
        assert!(told(&run, EffectKind::Accelerated, true));
        assert!(run.players[0].effects.speed_mul() > 1.0);
    }

    #[test]
    fn plain_effects_are_never_paused() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let me = Creature::Player(0);
        run.apply(me, Apply::plain(EffectKind::Slowed, Some(10.0)));
        run.events.clear();
        run.set_anti_magic(me, true);
        assert!(run.players[0].effects.speed_mul() < 1.0);
        assert_ne!(run.players[0].effects.bits() & EffectKind::Slowed.bit(), 0);
        run.pause_effect(me, EffectKind::Slowed, 5.0);
        assert!(run.has_effect(me, EffectKind::Slowed), "a Dispel finds no magic entry of it");
        assert!(run.events.iter().all(|(e, _)| !matches!(e, Ev::Effect { .. })));
    }

    fn lasting_pair() -> Vec<(ClassId, Build)> {
        vec![(ClassId::Wizard, Build { equipment: Equipment::starter(ClassId::Wizard).with(EquipSlot::Melee, ItemId::EmberStaff).with(EquipSlot::Ring1, ItemId::BandOfVigor), ..Build::start(ClassId::Wizard) })]
    }

    #[test]
    fn picks_only_the_wanted_side() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let me = Creature::Player(0);
        run.apply(me, magic(EffectKind::Accelerated, 20.0));
        run.apply(me, magic(EffectKind::Slowed, 20.0));
        let fx = &run.players[0].effects;
        assert_eq!(dispel_picks(fx, &[], Want::Positive, 5), vec![Pick::Effect(EffectKind::Accelerated)]);
        assert_eq!(dispel_picks(fx, &[], Want::Negative, 5), vec![Pick::Effect(EffectKind::Slowed)]);
        let src = [Lasting::Item(ItemId::EmberStaff)];
        assert!(dispel_picks(fx, &src, Want::Negative, 5).iter().all(|p| matches!(p, Pick::Effect(_))), "lasting is positive");
    }

    #[test]
    fn lasting_sources_go_first() {
        let mut run = test_run_with(&lasting_pair(), BossId::Demon);
        let me = Creature::Player(0);
        run.apply(me, magic(EffectKind::Accelerated, 20.0));
        let src = run.magic_sources(me);
        assert_eq!(src.len(), 2);
        let picks = dispel_picks(&run.players[0].effects, &src, Want::Positive, 5);
        let want: Vec<Pick> = src.iter().map(|s| Pick::Lasting(*s)).chain([Pick::Effect(EffectKind::Accelerated)]).collect();
        assert_eq!(picks, want);
    }

    #[test]
    fn then_the_most_time_left() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let me = Creature::Player(0);
        run.apply(me, magic(EffectKind::Warded, 5.0));
        run.apply(me, magic(EffectKind::Accelerated, 20.0));
        run.apply(me, magic(EffectKind::Coated, 9.0));
        let picks = dispel_picks(&run.players[0].effects, &[], Want::Positive, 2);
        assert_eq!(picks, vec![Pick::Effect(EffectKind::Accelerated), Pick::Effect(EffectKind::Coated)]);
    }

    #[test]
    fn ties_break_by_effect_id() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let me = Creature::Player(0);
        run.apply(me, magic(EffectKind::Warded, 10.0));
        run.apply(me, magic(EffectKind::Coated, 10.0));
        run.apply(me, magic(EffectKind::Accelerated, 10.0));
        let mut kinds = vec![EffectKind::Warded, EffectKind::Coated, EffectKind::Accelerated];
        kinds.sort_by_key(|k| *k as u8);
        let want: Vec<Pick> = kinds.into_iter().map(Pick::Effect).collect();
        assert_eq!(dispel_picks(&run.players[0].effects, &[], Want::Positive, 5), want);
    }

    #[test]
    fn already_dispelled_is_skipped() {
        let mut run = test_run_with(&lasting_pair(), BossId::Demon);
        let me = Creature::Player(0);
        run.apply(me, magic(EffectKind::Accelerated, 20.0));
        run.apply(me, magic(EffectKind::Warded, 10.0));
        let src = run.magic_sources(me);
        run.pause_effect(me, EffectKind::Accelerated, 5.0);
        run.pause_lasting(me, src[0], 5.0);
        let picks = dispel_picks(&run.players[0].effects, &src, Want::Positive, 5);
        assert_eq!(picks, vec![Pick::Lasting(src[1]), Pick::Effect(EffectKind::Warded)]);
    }

    #[test]
    fn plain_is_never_picked() {
        let mut run = test_run_with(&lasting_pair(), BossId::Demon);
        let me = Creature::Player(0);
        run.apply(me, Apply::plain(EffectKind::Accelerated, Some(20.0)));
        run.apply(me, Apply::plain(EffectKind::Slowed, Some(20.0)));
        let fx = &run.players[0].effects;
        assert!(dispel_picks(fx, &[], Want::Positive, 5).is_empty());
        assert!(dispel_picks(fx, &[], Want::Negative, 5).is_empty());
    }

    #[test]
    fn n_zero_picks_nothing() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.apply(Creature::Player(0), magic(EffectKind::Accelerated, 20.0));
        assert!(dispel_picks(&run.players[0].effects, &[Lasting::Item(ItemId::EmberStaff)], Want::Positive, 0).is_empty());
    }

    #[test]
    fn dispel_pauses_what_it_picks() {
        let mut run = test_run_with(&lasting_pair(), BossId::Demon);
        let me = Creature::Player(0);
        run.apply(me, magic(EffectKind::Accelerated, 20.0));
        run.apply(me, magic(EffectKind::Slowed, 20.0));
        let src = run.magic_sources(me);
        run.events.clear();
        let picks = run.dispel(me, Want::Positive, 2, 4.0);
        assert_eq!(picks, vec![Pick::Lasting(src[0]), Pick::Lasting(src[1])]);
        assert_eq!(run.players[0].effects.dispelled(), src);
        assert!(run.players[0].effects.speed_mul() < 1.0, "the Slowed stays, Accelerated was not picked");
        let picks = run.dispel(me, Want::Positive, 2, 4.0);
        assert_eq!(picks, vec![Pick::Effect(EffectKind::Accelerated)]);
        assert!(told(&run, EffectKind::Accelerated, false));
        assert!(!run.players[0].effects.has(EffectKind::Accelerated));
        assert!(run.dispel(me, Want::Positive, 2, 4.0).is_empty(), "nothing left");
    }
}
