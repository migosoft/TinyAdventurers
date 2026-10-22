//! The keystones that act during a run: hit factors that depend on the target or on the hero's HP,
//! and Berserker's cooldowns. The static ones (Arcane Overflow, Pyromancer, ...) live in `sheet`.

use super::entities::{Monster, Player};
use super::Run;
use crate::defs::abilities::{self as ab, AbilityCategory};
use crate::defs::damage::{Damage, DamageType, Mult, Resistances, What};
use crate::defs::effects::EffectKind;
use crate::defs::enemies;
use crate::defs::kinds::EntityKind;
use crate::defs::races::Race;
use crate::defs::trees::Keystone;

/// Berserker: damage, cooldown speed and (the other way) resistances change below half HP.
const BERSERK_DAMAGE: f64 = 1.25;
const BERSERK_RESIST: f64 = 0.10;
/// How long a wolf bite marks its prey for Pack Hunter (s).
pub const BITE_MARK_SECS: f64 = 2.0;

/// The keystone's name for the rules log.
pub fn name(k: Keystone) -> &'static str {
    match k {
        Keystone::ArcaneOverflow => "Arcane Overflow",
        Keystone::DeepWinter => "Deep Winter",
        Keystone::Pyromancer => "Pyromancer",
        Keystone::Radiant => "Radiant",
        Keystone::Unshaken => "Unshaken",
        Keystone::Bulwark => "Bulwark",
        Keystone::Berserker => "Berserker",
        Keystone::Juggernaut => "Juggernaut",
        Keystone::Unbreakable => "Unbreakable",
        Keystone::PackHunter => "Pack Hunter",
        Keystone::Deadeye => "Deadeye",
        Keystone::Venomancer => "Venomancer",
    }
}

/// Berserker is active: the hero owns it and has less than half their HP.
pub fn berserk(p: &Player) -> bool {
    p.sheet.keystones.has(Keystone::Berserker) && p.hp < 0.5 * p.sheet.max_hp
}

/// The factor on the hero's cooldowns, as the client predicts them.
pub fn cd_mul(p: &Player) -> f32 {
    if berserk(p) { (1.0 / BERSERK_DAMAGE) as f32 } else { 1.0 }
}

/// A cooldown the hero starts now.
pub fn cooldown(p: &Player, cd: f64) -> f64 {
    if berserk(p) { cd / BERSERK_DAMAGE } else { cd }
}

/// The hero's resistances against a hit: Berserker takes 10 points off every one.
pub fn hurt_res(p: &Player, res: Resistances) -> Resistances {
    if !berserk(p) {
        return res;
    }
    let mut out = res;
    for &t in DamageType::ALL.iter() {
        out.set(t, res.get(t) - BERSERK_RESIST);
    }
    out
}

/// The wolf's bite lands: its prey is marked for Pack Hunter.
pub fn bite(m: &mut Monster) {
    m.wolf_bit = BITE_MARK_SECS;
}

/// The mark counts down.
pub fn cool(m: &mut Monster, dt: f64) {
    m.wolf_bit = (m.wolf_bit - dt).max(0.0);
}

fn races(m: &Monster) -> Option<Race> {
    match (m.etype, m.kind) {
        (Some(t), _) => Some(enemies::race(t)),
        (None, EntityKind::Demon) => Some(Race::Demon),
        (None, EntityKind::Lich) => Some(Race::Undead),
        (None, EntityKind::Dragon) => Some(Race::Dragon),
        _ => None,
    }
}

/// The factors of hero `pi` hitting monster `mi`, in `Keystone` order.
pub fn outgoing(run: &Run, pi: usize, mi: usize, dmg: &Damage) -> Vec<(Keystone, f64)> {
    let (p, m) = (&run.players[pi], &run.monsters[mi]);
    let ks = p.sheet.keystones;
    let ability = if let What::Ability(id) = dmg.why.what { Some(ab::def(id)) } else { None };
    let mut out = Vec::new();
    if ks.has(Keystone::DeepWinter) && (m.effects.has(EffectKind::Chilled) || m.effects.has(EffectKind::Frozen)) {
        out.push((Keystone::DeepWinter, 1.0 + 0.2 * dmg.split.share(DamageType::Cold)));
    }
    if ks.has(Keystone::Radiant) && ability.is_some_and(|d| d.category == AbilityCategory::Innate) && matches!(races(m), Some(Race::Undead | Race::Demon)) {
        out.push((Keystone::Radiant, 1.2));
    }
    if berserk(p) {
        out.push((Keystone::Berserker, BERSERK_DAMAGE));
    }
    if ks.has(Keystone::PackHunter) && m.wolf_bit > 0.0 {
        out.push((Keystone::PackHunter, 1.2));
    }
    let held = [EffectKind::Slowed, EffectKind::Chilled, EffectKind::Entangled, EffectKind::Sleep].into_iter().any(|k| m.effects.has(k));
    if ks.has(Keystone::Deadeye) && ability.is_some_and(|d| d.ranged) && held {
        out.push((Keystone::Deadeye, 2.0));
    }
    if ks.has(Keystone::Venomancer) && m.effects.has(EffectKind::Poisoned) {
        out.push((Keystone::Venomancer, 1.15));
    }
    out
}

/// A hit on monster `mi` with the run-time keystones of the hero who struck it applied: the amount
/// times each factor, and each factor shown in the hit's why (while it has a free slot).
/// Effect ticks and hits by anyone else (the wolf, monsters) are not "you".
pub fn on_hit(run: &Run, mi: usize, mut dmg: Damage) -> Damage {
    let Some(by) = dmg.why.by.filter(|_| !dmg.from_effect) else { return dmg };
    let Some(pi) = run.players.iter().position(|p| p.id == by) else { return dmg };
    for (k, f) in outgoing(run, pi, mi, &dmg) {
        dmg.amount *= f;
        if let Some(slot) = dmg.why.mults.iter_mut().find(|s| s.is_none()) {
            *slot = Some(Mult::Keystone(k, f));
        }
    }
    dmg
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities::AbilityId;
    use crate::defs::attributes::Attributes;
    use crate::defs::damage::{DamageSplit, DamageType, Mult, What};
    use crate::defs::effects::EffectKind;
    use crate::defs::enemies::EnemyType;
    use crate::defs::loadout::Build;
    use crate::defs::trees::NodeId;
    use crate::dungeon::{Map, Tile};
    use crate::math::Vec2;
    use crate::protocol::{BossId, ClassId};
    use crate::run::tests::test_run_with;

    /// A run of one hero of `class` who owns `nodes`, on open floor with no monsters but the boss.
    fn run_of(class: ClassId, nodes: &[NodeId]) -> Run {
        let build = Build { nodes: nodes.to_vec(), extra: Attributes::new(0, 0, 0, 16, 16, 0), ..Build::start(class) };
        let mut run = test_run_with(&[(class, build)], BossId::Demon);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 3..=ty + 3 {
            for x in tx - 2..=tx + 14 {
                run.layout.map.set(x, y, Tile::Floor);
            }
        }
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        run.players[0].aim = 0.0;
        run
    }

    fn enemy(run: &mut Run, t: EnemyType) -> usize {
        let at = run.players[0].pos() + Vec2::new(60.0, 0.0);
        let id = run.spawn_enemy(t, at, None);
        run.monster_idx(id).unwrap()
    }

    fn hero_hit(run: &Run, split: DamageSplit, what: What) -> Damage {
        Damage::new(10.0, split).by(run.players[0].id, what)
    }

    /// The hit `hurt_monster` ends up with for a 10-damage hit by hero 0 (`last_hit` is the hit as applied).
    fn hit(run: &mut Run, mi: usize, split: DamageSplit, what: What) -> Damage {
        let d = hero_hit(run, split, what);
        run.hurt_monster(mi, d, false, Some(0));
        run.last_hit.unwrap()
    }
    fn applied(run: &mut Run, mi: usize, d: Damage) -> Damage {
        run.hurt_monster(mi, d, false, Some(0));
        run.last_hit.unwrap()
    }

    fn has(d: &Damage, k: Keystone, f: f64) -> bool {
        d.why.mults.iter().flatten().any(|m| matches!(m, Mult::Keystone(kk, ff) if *kk == k && (ff - f).abs() < 1e-12))
    }

    #[test]
    fn venomancer_hits_poisoned_targets_harder() {
        let mut run = run_of(ClassId::ElvenRanger, &[NodeId::ED1, NodeId::ED3, NodeId::ED4]);
        assert!(run.players[0].sheet.keystones.has(Keystone::Venomancer));
        let mi = enemy(&mut run, EnemyType::OrcWarrior);
        let plain = hit(&mut run, mi, DamageSplit::physical(), What::Ability(AbilityId::Shoot));
        assert_eq!(plain.amount, 10.0);
        assert!(plain.why.mults.iter().all(|m| m.is_none()));
        run.monsters[mi].hp = run.monsters[mi].max_hp;
        run.monsters[mi].effects.add(EffectKind::Poisoned, 4.0);
        let h = hit(&mut run, mi, DamageSplit::physical(), What::Ability(AbilityId::Shoot));
        assert!((h.amount - 11.5).abs() < 1e-9, "{}", h.amount);
        assert!(has(&h, Keystone::Venomancer, 1.15), "{:?}", h.why.mults);
    }

    #[test]
    fn deadeye_doubles_ranged_hits_on_held_targets_only() {
        let mut run = run_of(ClassId::ElvenRanger, &[NodeId::EL5]);
        let mi = enemy(&mut run, EnemyType::GoblinArcher);
        let shot = |run: &mut Run, mi| hit(run, mi, DamageSplit::physical(), What::Ability(AbilityId::Shoot));
        let free = shot(&mut run, mi);
        assert_eq!(free.amount, 10.0, "not held");
        for k in [EffectKind::Entangled, EffectKind::Slowed, EffectKind::Chilled, EffectKind::Sleep] {
            run.monsters[mi].hp = run.monsters[mi].max_hp;
            run.monsters[mi].effects = Default::default();
            run.monsters[mi].effects.add(k, 4.0);
            let h = shot(&mut run, mi);
            assert_eq!(h.amount, 20.0, "{k:?}");
            assert!(has(&h, Keystone::Deadeye, 2.0));
        }
        run.monsters[mi].hp = run.monsters[mi].max_hp;
        run.monsters[mi].effects = Default::default();
        run.monsters[mi].effects.add(EffectKind::Entangled, 4.0);
        let melee = hit(&mut run, mi, DamageSplit::physical(), What::Ability(AbilityId::Strike));
        assert_eq!(melee.amount, 10.0, "the fallback strike is not a ranged hit");
        assert!(!has(&melee, Keystone::Deadeye, 2.0));
    }

    #[test]
    fn deep_winter_scales_with_the_cold_share() {
        let mut run = run_of(ClassId::Wizard, &[NodeId::WF6]);
        let mi = enemy(&mut run, EnemyType::OrcWarrior);
        let shard = DamageSplit::split(&[(DamageType::Cold, 0.4)]);
        let cold = hit(&mut run, mi, shard, What::Ability(AbilityId::FrostShard));
        assert_eq!(cold.amount, 10.0, "not chilled");
        run.monsters[mi].effects.add(EffectKind::Chilled, 4.0);
        let cold_hit = hit(&mut run, mi, shard, What::Ability(AbilityId::FrostShard));
        assert!((cold_hit.amount - 10.8).abs() < 1e-9, "{}", cold_hit.amount);
        assert!(has(&cold_hit, Keystone::DeepWinter, 1.08));
        let frozen = {
            run.monsters[mi].effects = Default::default();
            run.monsters[mi].effects.add(EffectKind::Frozen, 2.0);
            hit(&mut run, mi, DamageSplit::pure(DamageType::Cold), What::Ability(AbilityId::FrostShard))
        };
        assert!((frozen.amount - 12.0).abs() < 1e-9, "a pure cold hit on a Frozen target is x1.2");
    }

    #[test]
    fn radiant_only_innate_against_undead_and_demons() {
        let mut run = run_of(ClassId::Paladin, &[NodeId::PU5]);
        let skeleton = enemy(&mut run, EnemyType::SkeletonWarrior);
        let orc = enemy(&mut run, EnemyType::OrcWarrior);
        let imp = enemy(&mut run, EnemyType::Imp);
        let judge = |run: &mut Run, mi| hit(run, mi, DamageSplit::physical(), What::Ability(AbilityId::Judgement));
        let first = judge(&mut run, skeleton);
        assert!((first.amount - 12.0).abs() < 1e-9, "{}", first.amount);
        assert!(has(&first, Keystone::Radiant, 1.2));
        assert!((judge(&mut run, imp).amount - 12.0).abs() < 1e-9, "a demon too");
        assert_eq!(judge(&mut run, orc).amount, 10.0, "an orc is neither");
        let melee = hit(&mut run, skeleton, DamageSplit::physical(), What::Ability(AbilityId::Strike));
        assert_eq!(melee.amount, 10.0, "Strike is not innate");
    }

    #[test]
    fn pack_hunter_needs_a_recent_bite() {
        let mut run = run_of(ClassId::ElvenRanger, &[NodeId::EU5]);
        let mi = enemy(&mut run, EnemyType::OrcWarrior);
        let shot = |run: &mut Run, mi| hit(run, mi, DamageSplit::physical(), What::Ability(AbilityId::Shoot));
        assert_eq!(shot(&mut run, mi).amount, 10.0, "no bite yet");
        run.monsters[mi].wolf_bit = 2.0;
        let h = shot(&mut run, mi);
        assert!((h.amount - 12.0).abs() < 1e-9);
        assert!(has(&h, Keystone::PackHunter, 1.2));
        for _ in 0..126 {
            run.step();
        }
        assert_eq!(run.monsters[mi].wolf_bit, 0.0, "2.1 s later");
        assert_eq!(shot(&mut run, mi).amount, 10.0);
    }

    #[test]
    fn the_wolfs_bite_marks_the_prey() {
        let mut run = run_of(ClassId::ElvenRanger, &[]);
        let wolf = crate::run::companion::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        let mi = enemy(&mut run, EnemyType::OrcWarrior);
        run.monsters[wi].ai.windup = Some(crate::run::entities::Windup { t: 0.0, aim: 0.0, alt: false, at: None });
        let (e, w) = (run.monsters[mi].pos, wi);
        run.monsters[w].pos = e - Vec2::new(10.0, 0.0);
        let id = run.monsters[mi].id;
        run.monsters[w].ally.as_mut().unwrap().prey = Some(id);
        crate::run::companion::tick_wolf(&mut run, wi, 1.0 / 60.0);
        assert!(run.monsters[mi].wolf_bit > 1.9, "bitten: {}", run.monsters[mi].wolf_bit);
    }

    #[test]
    fn berserker_starts_below_half_hp() {
        let mut run = run_of(ClassId::Barbarian, &[NodeId::BU5]);
        let mi = enemy(&mut run, EnemyType::OrcWarrior);
        let max = run.players[0].sheet.max_hp;
        let strike = |run: &mut Run, mi| hit(run, mi, DamageSplit::physical(), What::Ability(AbilityId::Strike));
        run.players[0].hp = 0.5 * max;
        assert!(!berserk(&run.players[0]));
        assert_eq!(cd_mul(&run.players[0]), 1.0);
        assert_eq!(strike(&mut run, mi).amount, 10.0);
        let cd = run.players[0].sheet.primary.cooldown;
        crate::run::abilities::try_use(&mut run, 0, true, 1);
        assert_eq!(run.players[0].cd1, cd);
        let p = &run.players[0];
        let res = p.effects.res(p.res).get(DamageType::Physical);
        run.players[0].hp = 0.5 * max;
        run.hurt_player(0, Damage::physical(10.0));
        assert!((0.5 * max - run.players[0].hp - 10.0 * (1.0 - res)).abs() < 1e-9);

        run.players[0].hp = 0.5 * max - 0.01;
        run.players[0].cd1 = 0.0;
        assert!(berserk(&run.players[0]));
        assert_eq!(cd_mul(&run.players[0]), 0.8);
        let h = strike(&mut run, mi);
        assert!((h.amount - 12.5).abs() < 1e-9);
        assert!(has(&h, Keystone::Berserker, 1.25));
        crate::run::abilities::try_use(&mut run, 0, true, 1);
        assert!((run.players[0].cd1 - cd / 1.25).abs() < 1e-9, "{} vs {}", run.players[0].cd1, cd / 1.25);
        let before = run.players[0].hp;
        run.hurt_player(0, Damage::physical(10.0));
        assert!((before - run.players[0].hp - 10.0 * (1.0 - (res - 0.1))).abs() < 1e-9, "resistance -0.10");
    }

    #[test]
    fn two_keystones_multiply_and_the_log_agrees() {
        let mut run = run_of(ClassId::ElvenRanger, &[NodeId::ED4, NodeId::EL5]);
        let mi = enemy(&mut run, EnemyType::GoblinArcher);
        run.monsters[mi].effects.add(EffectKind::Poisoned, 4.0);
        run.monsters[mi].effects.add(EffectKind::Entangled, 4.0);
        let h = hit(&mut run, mi, DamageSplit::physical(), What::Ability(AbilityId::Shoot));
        assert!((h.amount - 10.0 * 1.15 * 2.0).abs() < 1e-9);
        assert!(has(&h, Keystone::Venomancer, 1.15) && has(&h, Keystone::Deadeye, 2.0));
        let factors: f64 = h.why.mults.iter().flatten().filter_map(|m| if let Mult::Keystone(_, f) = m { Some(*f) } else { None }).product();
        assert!((10.0 * factors - h.amount).abs() < 1e-9, "the shown factors give the amount");
    }

    #[test]
    fn effect_ticks_and_the_wolf_get_no_keystone() {
        let mut run = run_of(ClassId::ElvenRanger, &[NodeId::ED4]);
        let wolf = crate::run::companion::spawn_wolf(&mut run, 0);
        let mi = enemy(&mut run, EnemyType::OrcWarrior);
        run.monsters[mi].effects.add(EffectKind::Poisoned, 4.0);
        let hero = run.players[0].id;
        let tick = Damage { why: crate::defs::damage::Why { by: Some(hero), what: What::Tick(EffectKind::Poisoned), ..crate::defs::damage::Why::NONE }, ..Damage::effect_tick(4.0, DamageType::Poison) };
        run.hurt_monster(mi, tick, false, None);
        assert!(run.last_hit.unwrap().why.mults.iter().all(|m| m.is_none()) && run.last_hit.unwrap().amount == 4.0);
        let bite = Damage::physical(10.0).by(wolf, What::Attack);
        let h = applied(&mut run, mi, bite);
        assert_eq!(h.amount, 10.0);
        assert!(h.why.mults.iter().all(|m| m.is_none()));
        let _: &Monster = &run.monsters[mi];
    }
}
