//! The Elven Ranger's wolf: a summoned companion (run/companion.rs) that fights through the melee base AI.
//! Spawn, the Ranger's button and death here.

use super::companion::summon_spot;
use super::entities::{Ai, Companion, Monster, HISTORY_LEN};
use super::targets::Side;
use super::Run;
use crate::defs::enemies::BaseAi;
use crate::defs::companions::*;
use crate::defs::damage::What;
use crate::defs::kinds::{Anim, EntityKind};
use crate::defs::races::Race;
use crate::dungeon::{self, Map, Mover};
use crate::math::Vec2;
use crate::protocol::Ev;
use std::collections::VecDeque;

/// Summons the wolf of hero `pi` beside them and returns its id.
pub fn spawn_wolf(run: &mut Run, pi: usize) -> u32 {
    let prof = wolf_profile();
    let stats = crate::sheet::wolf_stats();
    let owner = run.players[pi].id;
    let max_hp = WOLF_HP * run.players[pi].sheet.wolf.hp_mul;
    let base = crate::sheet::MonsterBase { sources: stats.sources, max_hp, speed: WOLF_SPEED, kit: crate::sheet::KitSource::Wolf(run.players[pi].sheet.wolf) };
    let spot = summon_spot(run, run.players[pi].pos());
    let (tx, ty) = Map::tile_of(spot);
    let id = run.alloc_id();
    run.monsters.push(Monster {
        id,
        res: prof.res,
        traits: prof.traits,
        invis_cd: 0.0,
        races: &[Race::MagicalBeast],
        etype: None,
        kind: EntityKind::DireWolf,
        pos: spot,
        hp: max_hp,
        max_hp,
        speed: WOLF_SPEED,
        base,
        radius: WOLF_RADIUS,
        sight: prof.sight,
        alive: true,
        aim: 0.0,
        aim_dist: 0.0,
        anim: Anim::Idle,
        anim_start: run.time,
        hurt_t: 0.0,
        kit: crate::sheet::kit_for(base.kit, &stats.attrs, &[]),
        cds: Default::default(),
        slam: None,
        channel: None,
        dash: None,
        wolf_bit: 0.0,
        // No pause before the first bite (an enemy starts with half a second).
        ai: Ai { cd: 0.0, ..Ai::new(spot) },
        base_ai: BaseAi::Melee,
        wanders: true,
        owner: None,
        history: VecDeque::with_capacity(HISTORY_LEN),
        is_boss: false,
        dormant: false,
        hiding: false,
        mover: Mover::Enemy,
        airborne: false,
        knock: Vec2::ZERO,
        sinking: None,
        burn_t: dungeon::LAVA_TICK,
        last_safe: Map::center_of(tx, ty),
        last_hit_by: None,
        effects: Default::default(),
        effect_res: prof.effect_res,
        sources: stats.sources,
        attrs: stats.attrs,
        weight: stats.weight,
        side: Side::Friendly,
        grudge: Default::default(),
        wild: None,
        charm: None,
        companion: Some(Companion {
            escort: &WOLF_ESCORT,
            leader: owner,
            recruiter: owner,
            summoned: true,
            prey: None,
            following: false,
            reach_t: 0.0,
        }),
    });
    run.players[pi].wolf = Some(id);
    run.event(Ev::Boom { x: spot.x as f32, y: spot.y as f32, r: 10.0, k: 9 }, None);
    id
}

/// The ranger's secondary: summons the wolf, or heals the living one by its share of max HP.
pub fn use_ability(run: &mut Run, pi: usize) {
    match run.players[pi].wolf.and_then(|id| run.monster_idx(id)) {
        Some(mi) if run.monsters[mi].alive => {
            run.heal_monster(mi, run.monsters[mi].max_hp * WOLF_HEAL_SHARE, Some((run.players[pi].id, What::Ability(crate::defs::abilities::AbilityId::SummonWolf))));
        }
        _ => {
            spawn_wolf(run, pi);
        }
    }
}

/// The wolf `mi` has fallen: no XP, no coins, no kill; the ranger waits for the next one.
pub fn wolf_died(run: &mut Run, mi: usize) {
    let m = &mut run.monsters[mi];
    m.alive = false;
    m.hp = 0.0;
    let (id, pos, kind) = (m.id, m.pos, m.kind as u8);
    let owner = m.companion.as_ref().map(|c| c.leader);
    run.event(Ev::Died { id, x: pos.x as f32, y: pos.y as f32, kind }, None);
    if let Some(pi) = owner.and_then(|o| run.player_idx(o)) {
        let p = &mut run.players[pi];
        p.wolf = None;
        // The dead-wolf cooldown is divided by how much shorter the sheet makes Summon Wolf's cooldown than its base (this form is bit-exact to `/ attack_speed`); a run-time speed-up such as Berserk is not in it.
        // The sheet's cooldown is above 0 (`loadout::MIN_COOLDOWN`); the guard only keeps a 0 from dividing.
        let cooldown = p.sheet.secondary.cooldown.max(f64::MIN_POSITIVE);
        p.cd2 = WOLF_DEAD_COOLDOWN / (crate::defs::abilities::def(crate::defs::abilities::AbilityId::SummonWolf).own.cooldown / cooldown);
        let name = p.name.clone();
        run.event(Ev::Msg { text: format!("{name}'s wolf has fallen") }, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities::AbilityId;
    use crate::defs::enemies::BaseAi;
    use crate::run::abilities::monster_use;
    use crate::run::companion::find_prey;
    use crate::defs::damage::{Damage, DamageType};
    use crate::defs::effects::EffectKind;
    use crate::defs::kinds::EntityKind;
    use crate::dungeon::{Map, Tile};
    use crate::math::Vec2;
    use crate::protocol::{BossId, ClassId, Ev};
    use crate::run::abilities::{melee_target, dash_contact, tick_monster_dash, tick_projectiles, try_use};
    use crate::run::modules::dash_back;
    use crate::run::effects::Creature;
    use crate::run::tests::test_run;
    use crate::run::visibility::{dark_range, snapshot_ents, Dark};
    use crate::run::{Run, DT};

    fn ranger_with_wolf() -> (Run, u32) {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let id = spawn_wolf(&mut run, 0);
        (run, id)
    }

    fn companion_mut(run: &mut Run, mi: usize) -> &mut Companion {
        run.monsters[mi].companion.as_mut().expect("a companion")
    }

    fn wolf_idx(run: &Run, id: u32) -> usize {
        run.monster_idx(id).unwrap()
    }

    /// A run with the given heroes (all on the first hero's spot) and the first hero's
    /// wolf `dx` px east of hero `at`.
    fn run_with_wolf_beside(classes: &[ClassId], at: usize, dx: f64) -> (Run, u32) {
        let mut run = test_run(classes, BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let id = spawn_wolf(&mut run, 0);
        let pos = run.players[0].pos();
        for p in run.players.iter_mut() {
            p.mv.x = pos.x;
            p.mv.y = pos.y;
        }
        let mi = wolf_idx(&run, id);
        run.monsters[mi].pos = run.players[at].pos() + Vec2::new(dx, 0.0);
        (run, id)
    }

    fn untouched(run: &Run, id: u32, what: &str) {
        let m = &run.monsters[wolf_idx(run, id)];
        assert_eq!(m.hp, 80.0, "{what}: the wolf lost no HP");
        assert_eq!(m.knock, Vec2::ZERO, "{what}: and was not pushed");
    }

    /// One input of hero `pi` per step (cooldowns tick per processed input), with the secondary pressed or not.
    fn press(run: &mut Run, pi: usize, secondary: bool) {
        let seq = run.players[pi].ack + 1;
        let secondary = secondary.then_some(1);
        run.players[pi].inputs.push_back(crate::protocol::InputMsg { seq, secondary, ..Default::default() });
        run.step();
    }

    fn wolves(run: &Run) -> Vec<&crate::run::entities::Monster> {
        run.monsters.iter().filter(|m| m.alive && m.companion.as_ref().is_some_and(|c| c.summoned)).collect()
    }

    #[test]
    fn right_click_summons_then_heals_and_the_wolf_never_doubles() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        press(&mut run, 0, true);
        assert_eq!(wolves(&run).len(), 1);
        assert!((run.players[0].cd2 - 8.0 * 10.0 / 13.0).abs() < 0.1, "Summon Wolf is an Innate (CHA 13): cd2 {}", run.players[0].cd2);
        press(&mut run, 0, true);
        assert_eq!(wolves(&run).len(), 1, "the cooldown refuses a second wolf");
        let id = run.players[0].wolf.unwrap();
        let wi = wolf_idx(&run, id);
        run.monsters[wi].hp = 50.0;
        run.players[0].cd2 = 0.0;
        press(&mut run, 0, true);
        assert_eq!(run.monsters[wolf_idx(&run, id)].hp, 66.0);
        assert_eq!(wolves(&run).len(), 1);
        run.players[0].cd2 = 0.0;
        press(&mut run, 0, true);
        assert_eq!(run.monsters[wolf_idx(&run, id)].hp, 80.0, "the heal stops at the maximum");
        assert!((run.players[0].cd2 - 8.0 * 10.0 / 13.0).abs() < 0.1, "a heal at full HP still costs the cooldown: {}", run.players[0].cd2);
    }

    #[test]
    fn the_cooldowns_follow_attack_speed() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        run.players[0].sheet.secondary.cooldown = 4.0; // attack speed ×2 on the 8 s summon
        press(&mut run, 0, true);
        assert!((run.players[0].cd2 - 4.0).abs() < 0.1, "cd2 {}", run.players[0].cd2);
        let id = run.players[0].wolf.unwrap();
        let wi = wolf_idx(&run, id);
        run.hurt_monster(wi, Damage::physical(200.0), false, None);
        assert!((run.players[0].cd2 - 30.0).abs() < 1e-9);
    }

    #[test]
    fn after_the_wolf_falls_the_button_waits_60_s_then_summons() {
        let (mut run, id) = ranger_with_wolf();
        let wi = wolf_idx(&run, id);
        run.hurt_monster(wi, Damage::physical(200.0), false, None);
        press(&mut run, 0, true);
        assert!(wolves(&run).is_empty(), "no wolf during the wait");
        for _ in 0..60 * 60 {
            press(&mut run, 0, false);
        }
        press(&mut run, 0, true);
        assert_eq!(wolves(&run).len(), 1, "a new wolf after 60 s");
    }

    #[test]
    fn two_rangers_each_keep_their_own_wolf() {
        let mut run = test_run(&[ClassId::ElvenRanger, ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        press(&mut run, 0, true);
        press(&mut run, 1, true);
        assert_eq!(wolves(&run).len(), 2);
        let (a, b) = (run.players[0].wolf.unwrap(), run.players[1].wolf.unwrap());
        assert_eq!(run.monsters[wolf_idx(&run, a)].companion.as_ref().unwrap().leader, run.players[0].id);
        assert_eq!(run.monsters[wolf_idx(&run, b)].companion.as_ref().unwrap().leader, run.players[1].id);
        let ai = wolf_idx(&run, a);
        run.monsters[ai].hp = 30.0;
        run.players[1].cd2 = 0.0;
        press(&mut run, 1, true);
        assert_eq!(run.monsters[wolf_idx(&run, a)].hp, 30.0, "ranger B does not heal wolf A");
        assert_eq!(run.monsters[wolf_idx(&run, b)].hp, 80.0);
        assert!((run.players[1].cd2 - 8.0 * 10.0 / 13.0).abs() < 0.1);
    }

    #[test]
    fn the_wolf_vanishes_when_its_ranger_falls_or_leaves() {
        let mut run = test_run(&[ClassId::ElvenRanger, ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        press(&mut run, 0, true);
        press(&mut run, 1, true);
        assert_eq!(wolves(&run).len(), 2);

        run.events.clear();
        run.hurt_player(0, Damage::physical(999.0));
        run.step();
        assert_eq!(run.players[0].wolf, None);
        assert_eq!(wolves(&run).len(), 1, "only the fallen ranger's wolf is gone");
        assert!(run.events.iter().any(|(e, at)| matches!(e, Ev::Boom { k: 9, .. }) && at.is_none()));
        assert!(!run.events.iter().any(|(e, _)| matches!(e, Ev::Msg { text } if text.contains("wolf has fallen"))));
        assert_eq!(run.players[0].xp, 0);

        run.events.clear();
        let conn = run.players[1].conn;
        run.handle(crate::run::RunCmd::Leave { conn });
        run.step();
        assert_eq!(run.players[1].wolf, None);
        assert!(wolves(&run).is_empty());
        assert!(run.events.iter().any(|(e, at)| matches!(e, Ev::Boom { k: 9, .. }) && at.is_none()));
        assert!(!run.events.iter().any(|(e, _)| matches!(e, Ev::Msg { text } if text.contains("wolf has fallen"))));
        assert_eq!(run.players[1].xp, 0);

        // A dead ranger's secondary is ignored.
        run.players[0].cd2 = 0.0;
        press(&mut run, 0, true);
        assert!(wolves(&run).is_empty());
    }

    #[test]
    fn a_summoned_wolf_has_its_numbers() {
        let (run, id) = ranger_with_wolf();
        let m = &run.monsters[wolf_idx(&run, id)];
        assert_eq!((m.hp, m.max_hp), (80.0, 80.0));
        assert!((m.res.get(DamageType::Cold) - 0.2).abs() < 1e-12);
        assert!((m.res.get(DamageType::Poison) - 0.1).abs() < 1e-12);
        assert!((m.res.get(DamageType::Magical) - 0.1).abs() < 1e-12);
        assert_eq!(m.effect_res.get(EffectKind::Sleep), 1.0);
        assert_eq!(m.kind, EntityKind::DireWolf);
        assert_eq!(m.companion.as_ref().unwrap().leader, run.players[0].id);
        assert_eq!(run.players[0].wolf, Some(id));
        assert!(run.events.iter().any(|(e, at)| matches!(e, Ev::Boom { k: 9, .. }) && at.is_none()), "the green puff goes to the whole party");
    }

    #[test]
    fn wolf_mods_change_the_wolf() {
        use crate::defs::loadout::AbilityMod::{CompanionDashCooldownAdd, CompanionHpMul};
        use crate::sheet::{wolf_mods, WolfMods};
        let mods = wolf_mods(&[CompanionHpMul(1.25), CompanionDashCooldownAdd(-2.0)]);
        assert_eq!(mods, WolfMods { hp_mul: 1.25, pounce: Some(crate::defs::loadout::AbilityMod::CooldownAdd(-2.0)) });
        assert_eq!(wolf_mods(&[]), WolfMods::NONE);
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        assert_eq!(run.players[0].sheet.wolf, WolfMods::NONE, "the start version");
        run.players[0].sheet.wolf = mods;
        let id = spawn_wolf(&mut run, 0);
        let mi = wolf_idx(&run, id);
        assert_eq!((run.monsters[mi].hp, run.monsters[mi].max_hp), (WOLF_HP * 1.25, WOLF_HP * 1.25));
        dash_back(&mut run, mi, AbilityId::Pounce);
        assert!(!run.monsters[mi].cds.ready(AbilityId::Pounce));
        assert!((run.monsters[mi].kit.get(AbilityId::Pounce).unwrap().cooldown - (5.0 * 10.0 / 15.0 - 2.0)).abs() < 1e-12, "the wolf's DEX 15, then the mod");
    }

    #[test]
    fn a_pounce_cooldown_mod_lengthens_only_the_wolfs_pounce() {
        use crate::defs::loadout::AbilityMod::CooldownAdd;
        let mods = crate::sheet::WolfMods { hp_mul: 1.0, pounce: Some(CooldownAdd(1.5)) };
        let (plain, modded) = (crate::sheet::kit_for(crate::sheet::KitSource::Wolf(crate::sheet::WolfMods::NONE), &crate::defs::companions::wolf_attrs(), &[]), crate::sheet::kit_for(crate::sheet::KitSource::Wolf(mods), &crate::defs::companions::wolf_attrs(), &[]));
        let (p, m) = (plain.get(AbilityId::Pounce).unwrap(), modded.get(AbilityId::Pounce).unwrap());
        assert!((p.cooldown - 5.0 * 10.0 / 15.0).abs() < 1e-12 && (m.cooldown - (5.0 * 10.0 / 15.0 + 1.5)).abs() < 1e-12, "the wolf's DEX 15, then the mod: {} {}", p.cooldown, m.cooldown);
        assert_eq!(plain.get(AbilityId::Bite), modded.get(AbilityId::Bite), "the bite is the same");
        let (mut run, _) = ranger_with_wolf();
        run.players[0].sheet.wolf = mods;
        let id = spawn_wolf(&mut run, 0);
        assert!((run.monsters[wolf_idx(&run, id)].kit.get(AbilityId::Pounce).unwrap().cooldown - (5.0 * 10.0 / 15.0 + 1.5)).abs() < 1e-12);
        assert!((run.monsters[wolf_idx(&run, id)].kit.get(AbilityId::Bite).unwrap().cooldown - 0.9 * 10.0 / 15.0).abs() < 1e-12, "the bite: its 0.9 at DEX 15");
    }

    #[test]
    fn no_hero_attack_hurts_the_wolf() {
        // The rapier: a wolf 10 px away is no melee target, the bow fires instead.
        let (mut run, id) = run_with_wolf_beside(&[ClassId::ElvenRanger], 0, 10.0);
        assert_eq!(melee_target(&run, 0), None);
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.projectiles.len(), 1, "a bolt is fired");
        untouched(&run, id, "rapier");

        // A bolt flies straight through it.
        let (mut run, id) = run_with_wolf_beside(&[ClassId::ElvenRanger], 0, 40.0);
        try_use(&mut run, 0, true, 1);
        for _ in 0..30 {
            tick_projectiles(&mut run, DT);
        }
        untouched(&run, id, "bolt");

        // Sword and axe swings.
        let (mut run, id) = run_with_wolf_beside(&[ClassId::ElvenRanger, ClassId::Paladin, ClassId::Barbarian], 1, 10.0);
        try_use(&mut run, 1, true, 1);
        untouched(&run, id, "sword");
        try_use(&mut run, 2, true, 1);
        untouched(&run, id, "axe");

        // The Barbarian's dash.
        try_use(&mut run, 2, false, 1);
        dash_contact(&mut run, Creature::Player(2));
        untouched(&run, id, "dash");

        // A fireball that goes off on it.
        let (mut run, id) = run_with_wolf_beside(&[ClassId::ElvenRanger, ClassId::Wizard], 1, 30.0);
        run.players[1].aim_dist = 30.0;
        try_use(&mut run, 1, false, 1); // the fireball (the Wizard's secondary)
        for _ in 0..60 {
            tick_projectiles(&mut run, DT);
        }
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Boom { k: 0, .. })), "the fireball did explode");
        untouched(&run, id, "fireball");

        // The safety net.
        let (mut run, id) = ranger_with_wolf();
        let mi = wolf_idx(&run, id);
        assert!(!run.hurt_monster(mi, Damage::physical(50.0), false, Some(0)));
        untouched(&run, id, "hurt_monster");
    }

    #[test]
    fn the_wolf_dies_without_paying_and_starts_the_wait() {
        let (mut run, id) = ranger_with_wolf();
        let mi = wolf_idx(&run, id);
        run.hurt_monster(mi, Damage::physical(200.0), false, None);
        let p = &run.players[0];
        assert!(p.xp == 0 && p.coins == 0 && p.kills == 0);
        assert_eq!(p.wolf, None);
        assert!((p.cd2 - 60.0 * 10.0 / 13.0).abs() < 1e-9, "the wait is shortened by the same CHA 13 step as Summon Wolf: {}", p.cd2);
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Msg { text } if text == "p0's wolf has fallen")));
        assert!(run.events.iter().any(|(e, at)| matches!(e, Ev::Died { id: i, .. } if *i == id) && at.is_none()));
        assert!(run.ended.is_none(), "the run goes on");
    }

    #[test]
    fn the_wolf_is_sent_to_the_party_even_in_the_dark() {
        let (mut run, id) = ranger_with_wolf();
        run.players[0].darkvision = Some(0.0);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 4..=ty + 4 {
            for x in tx - 2..=tx + 14 {
                run.layout.map.set(x, y, Tile::Floor);
            }
        }
        run.lights = crate::run::light::Lights::new(run.layout.map.w, run.layout.map.h);
        let far = Map::center_of(tx + 12, ty);
        let mi = wolf_idx(&run, id);
        run.monsters[mi].pos = far;
        let goblin = run.spawn_enemy(crate::defs::enemies::EnemyType::GoblinArcher, far, None);
        let p = run.players[0].pos();
        run.players[0].view.compute(&run.layout.map, p, 18);
        run.lights.refresh(&run.layout.map);
        let dark = Dark { tile: (tx, ty), range: dark_range(&run.players[0].sight_now()) };
        let view = std::mem::replace(&mut run.players[0].view, crate::vispoly::View::new(0, 0));
        let ents = snapshot_ents(&run, 0, &view, &dark);
        let wolf = ents.iter().find(|e| e.0 == id).expect("the wolf is sent");
        assert_eq!(wolf.9, run.players[0].id, "extra is the owner");
        assert!(!ents.iter().any(|e| e.0 == goblin), "an unlit enemy there is not");
    }

    #[test]
    fn damage_on_the_wolf_is_shown_like_damage_on_a_hero() {
        let (mut run, id) = ranger_with_wolf();
        run.events.clear();
        run.on_hero.clear();
        let mi = wolf_idx(&run, id);
        run.hurt_monster(mi, Damage::physical(5.0), false, None);
        let i = run.events.iter().position(|(e, _)| matches!(e, Ev::Dmg { p: true, .. })).expect("a hero-style Dmg");
        assert!(run.on_hero.contains(&i));
    }
    /// Open floor and light around hero 0, 14 tiles east and 3 tiles up and down; hero 0 in debug mode.
    fn lit_arena(run: &mut Run) {
        crate::run::ai::tests::open_floor(run);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 3..=ty + 3 {
            for x in tx - 8..=tx + 14 {
                run.layout.map.set(x, y, Tile::Floor);
            }
        }
        run.lights.fill();
        run.players[0].debug = true;
    }

    #[test]
    fn an_orc_attacks_the_wolf_when_it_is_the_nearest_foe() {
        use crate::defs::enemies::EnemyType;
        let (mut run, id) = ranger_with_wolf();
        lit_arena(&mut run);
        // The ranger is 9 tiles away, beyond the orc's sight; the wolf stands 20 px from it.
        let far = run.players[0].pos() + Vec2::new(9.0 * crate::dungeon::TILE, 0.0);
        let mi = wolf_idx(&run, id);
        run.monsters[mi].pos = far;
        let orc = run.spawn_enemy(EnemyType::OrcWarrior, far + Vec2::new(20.0, 0.0), None);
        for _ in 0..120 {
            // Held there: the wolf would follow its ranger (out of its leash, the orc is no prey).
            let wi = wolf_idx(&run, id);
            if run.monsters[wi].knock == Vec2::ZERO {
                run.monsters[wi].pos = far;
            }
            run.step();
        }
        assert!(run.monsters[wolf_idx(&run, id)].hp < 80.0, "the orc hurt the wolf");
        let oi = run.monster_idx(orc).unwrap();
        assert_eq!(run.monsters[oi].ai.target, Some(crate::run::entities::Target::Monster(id)));
    }

    #[test]
    fn an_enemy_arrow_hits_the_wolf() {
        let (mut run, id) = ranger_with_wolf();
        lit_arena(&mut run);
        let mi = wolf_idx(&run, id);
        let at = run.players[0].pos() + Vec2::new(6.0 * crate::dungeon::TILE, 0.0);
        run.monsters[mi].pos = at;
        let from = at - Vec2::new(30.0, 0.0);
        crate::run::tests::enemy_use(&mut run, EnemyType::GoblinArcher, from, AbilityId::Shoot, at);
        let arrow = run.projectiles.last().unwrap().damage.amount;
        for _ in 0..40 {
            tick_projectiles(&mut run, DT);
        }
        let hp = run.monsters[wolf_idx(&run, id)].hp;
        assert!((hp - (80.0 - arrow)).abs() < 1e-9, "the arrow's {arrow} damage, got hp {hp}");
        assert!(run.projectiles.iter().all(|p| p.dead), "and it stopped there");
    }

    #[test]
    fn area_attacks_hit_the_wolf() {
        use crate::run::objects::{explode_barrel, Barrel, ObjState};
        // The ogre's slam.
        let (mut run, oi) = crate::run::ai::tests::ogre_among(&[Vec2::new(200.0, 0.0)]);
        let id = spawn_wolf(&mut run, 0);
        let wi = wolf_idx(&run, id);
        run.players[0].debug = true;
        run.monsters[wi].pos = run.monsters[oi].pos + Vec2::new(crate::run::ai::tests::slam_radius() - 4.0, 0.0);
        crate::run::ai::perform_attack(&mut run, oi, Creature::Monster(wi), true, None);
        while run.monsters[oi].slam.is_some() {
            crate::run::abilities::tick_monster_slam(&mut run, oi, crate::run::DT);
        }
        let w = &run.monsters[wolf_idx(&run, id)];
        assert!(w.hp < 80.0, "the slam hurt the wolf");
        assert!(w.knock.x > 0.0, "and pushed it away from the ogre");

        // A fire patch.
        let (mut run, id) = ranger_with_wolf();
        lit_arena(&mut run);
        let at = run.monsters[wolf_idx(&run, id)].pos + Vec2::new(5.0 * crate::dungeon::TILE, 0.0);
        let wi = wolf_idx(&run, id);
        run.monsters[wi].pos = at;
        // The ranger stands beside it, so the wolf stays in the fire instead of following.
        run.players[0].mv.x = at.x - 16.0;
        run.players[0].mv.y = at.y;
        crate::run::spawn_fire_patch(&mut run, at, 10.0, 2.0, 5.0);
        for _ in 0..30 {
            run.step();
        }
        assert!(run.monsters[wolf_idx(&run, id)].hp < 80.0, "the fire burned the wolf within half a second");

        // A barrel blast.
        let (mut run, id) = ranger_with_wolf();
        lit_arena(&mut run);
        let wi = wolf_idx(&run, id);
        let at = run.players[0].pos() + Vec2::new(5.0 * crate::dungeon::TILE, 0.0);
        run.monsters[wi].pos = at;
        run.spawn_object(EntityKind::Barrel, at - Vec2::new(10.0, 0.0), ObjState::Barrel(Barrel::new()));
        let bi = run.objects.len() - 1;
        explode_barrel(&mut run, bi);
        let w = &run.monsters[wolf_idx(&run, id)];
        assert!(w.hp < 80.0 && w.knock.x > 0.0, "the blast hurt and pushed the wolf");
    }

    #[test]
    fn a_bosses_area_attack_hits_the_wolf_but_the_boss_targets_heroes() {
        let (mut run, bi) = crate::run::bosses::lich::tests::lich_with(&[Vec2::new(0.0, 4.0 * crate::dungeon::TILE)]);
        let boss_pos = run.monsters[bi].pos;
        let id = spawn_wolf(&mut run, 0);
        let wi = wolf_idx(&run, id);
        let nova = run.monsters[bi].kit.get(AbilityId::Nova).expect("the lich casts a nova").clone();
        run.monsters[wi].pos = boss_pos + Vec2::new(nova.radius - 10.0, 0.0);
        crate::run::bosses::lich::tests::nova(&mut run, bi);
        let hp = run.monsters[wolf_idx(&run, id)].hp;
        assert!((hp - (80.0 - nova.damage * 0.9)).abs() < 1e-9, "magical resistance 10 %: hp {hp}");
        // The boss sees the wolf (it is nearer than the hero) but targets the hero.
        let seen = crate::run::bosses::target(&run, bi);
        assert_eq!(seen.map(|t| t.0), Some(0));
    }

    #[test]
    fn holy_light_heals_the_wolf_and_counts_as_healing() {
        let (mut run, id) = run_with_wolf_beside(&[ClassId::ElvenRanger, ClassId::Paladin], 1, 20.0);
        let wi = wolf_idx(&run, id);
        run.monsters[wi].hp = 40.0;
        run.events.clear();
        try_use(&mut run, 1, false, 1);
        assert_eq!(run.monsters[wolf_idx(&run, id)].hp, 75.0);
        assert_eq!(run.players[1].healing, 35.0);
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Heal { v, p: true, .. } if *v == 35.0)));
    }

    #[test]
    fn a_wolf_blown_into_deep_water_drowns_without_paying_and_starts_the_wait() {
        use crate::run::objects::{explode_barrel, Barrel, ObjState};
        let (mut run, id) = ranger_with_wolf();
        lit_arena(&mut run);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for x in tx + 7..=tx + 9 {
            run.layout.map.set(x, ty, Tile::DeepWater);
        }
        let wi = wolf_idx(&run, id);
        // Pounce cooling down: with it ready the wolf would leap out (modules::on_danger).
        run.monsters[wi].cds.start(AbilityId::Pounce, 99.0);
        let at = Map::center_of(tx + 6, ty);
        run.monsters[wi].pos = at;
        run.spawn_object(EntityKind::Barrel, at - Vec2::new(10.0, 0.0), ObjState::Barrel(Barrel::new()));
        let bi = run.objects.len() - 1;
        run.events.clear();
        explode_barrel(&mut run, bi);
        for _ in 0..8 {
            run.step();
        }
        assert!(run.monsters[wolf_idx(&run, id)].sinking.is_some(), "it went into the water");
        for _ in 0..240 {
            run.step();
        }
        assert!(run.monsters.iter().all(|m| m.id != id || !m.alive), "the wolf is gone");
        let p = &run.players[0];
        assert!(p.xp == 0 && p.coins == 0 && p.kills == 0);
        assert_eq!(p.wolf, None);
        assert!(p.cd2 > 55.0 * 10.0 / 13.0 && p.cd2 <= 60.0 * 10.0 / 13.0, "the wait for the next wolf started: {}", p.cd2);
    }

    // ---- Behaviour: follow, guard, dash, bite, leash, reappear, chasm escape ----

    use crate::defs::enemies::EnemyType;

    /// Ranger with wolf on lit open floor (the ranger in debug mode); the wolf beside the ranger.
    fn guard_run() -> (Run, u32) {
        let (mut run, id) = ranger_with_wolf();
        lit_arena(&mut run);
        (run, id)
    }

    fn wolf(run: &Run, id: u32) -> &crate::run::entities::Monster {
        &run.monsters[wolf_idx(run, id)]
    }

    fn ally(run: &Run, id: u32) -> &crate::run::entities::Companion {
        wolf(run, id).companion.as_ref().unwrap()
    }

    fn set_wolf_pos(run: &mut Run, id: u32, p: Vec2) {
        let wi = wolf_idx(run, id);
        run.monsters[wi].pos = p;
    }

    fn move_ranger(run: &mut Run, p: Vec2) {
        run.players[0].mv.x = p.x;
        run.players[0].mv.y = p.y;
    }

    fn orc_at(run: &mut Run, p: Vec2) -> u32 {
        run.spawn_enemy(EnemyType::OrcWarrior, p, None)
    }

    fn hp_of(run: &Run, id: u32) -> Option<f64> {
        run.monster_idx(id).map(|i| run.monsters[i].hp)
    }

    /// The wolf finishes a bite wind-up on a fresh `t` beside it; returns that enemy's push velocity.
    fn bite_knock(t: EnemyType) -> Vec2 {
        let (mut run, id) = ranger_with_wolf();
        let wi = wolf_idx(&run, id);
        let w = run.monsters[wi].pos;
        let ei = {
            let e = run.spawn_enemy(t, w, None);
            run.monster_idx(e).unwrap()
        };
        let gap = run.monsters[wi].radius + run.monsters[ei].radius + 2.0;
        run.monsters[ei].pos = w + Vec2::new(gap, 0.0);
        let eid = run.monsters[ei].id;
        companion_mut(&mut run, wi).prey = Some(eid);
        run.monsters[wi].ai.windup = Some(crate::run::entities::Windup { t: 0.0, aim: 0.0, alt: false, at: None, id: None });
        crate::run::behaviour::tick(&mut run, wi, DT, true);
        run.monsters[run.monster_idx(eid).unwrap()].knock
    }

    #[test]
    fn wolf_bite_pushes_an_orc_not_an_ogre() {
        // STR 17: the orc (weight 13) the full bite push, the ogre (weight 20) not at all.
        assert_eq!(bite_knock(EnemyType::OrcWarrior), Vec2::new(crate::collision::knock_speed(8.0, DT), 0.0));
        assert_eq!(bite_knock(EnemyType::Ogre), Vec2::ZERO);
    }

    #[test]
    fn the_wolf_bites_with_bite_for_ten() {
        let (mut run, id) = guard_run();
        let wi = wolf_idx(&run, id);
        let w = run.monsters[wi].pos;
        let orc = orc_at(&mut run, w + Vec2::new(14.0, 0.0));
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].ai.hold = 99.0;
        companion_mut(&mut run, wi).prey = Some(orc);
        run.monsters[wi].ai.windup = Some(crate::run::entities::Windup { t: 0.0, aim: 0.0, alt: false, at: None, id: None });
        crate::run::behaviour::tick(&mut run, wi, DT, true);
        let hit = run.last_hit.clone().expect("the bite landed");
        assert_eq!(hit.why.what, What::Ability(AbilityId::Bite));
        assert_eq!(hit.why.by, Some(id));
        assert_eq!(hit.amount, 10.0, "at the wolf's start stat block");
        assert!(run.monsters[oi].hp < run.monsters[oi].max_hp);
        assert!(run.monsters[oi].wolf_bit > 0.0, "and the prey is marked for Pack Hunter");
    }

    #[test]
    fn the_wolf_never_hurts_heroes() {
        let (mut run, id) = guard_run();
        run.players[0].debug = false;
        let wi = wolf_idx(&run, id);
        let w = run.monsters[wi].pos;
        // The ranger stands on the wolf's bite and in the way of its pounce, beside the orc.
        let orc = orc_at(&mut run, w + Vec2::new(14.0, 0.0));
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].ai.hold = 99.0;
        move_ranger(&mut run, w + Vec2::new(8.0, 0.0));
        let hp = run.players[0].hp;
        let at = run.monsters[oi].pos;
        assert!(monster_use(&mut run, wi, AbilityId::Bite, at));
        assert!(run.monsters[oi].hp < run.monsters[oi].max_hp, "the bite hurt the orc");
        assert!(monster_use(&mut run, wi, AbilityId::Pounce, at));
        for _ in 0..30 {
            tick_monster_dash(&mut run, wi, DT);
        }
        assert_eq!(run.players[0].hp, hp, "no hero was hurt");
        assert_eq!(run.players[0].mv.knocked(), false, "or pushed");
        assert_eq!((run.players[0].kills, run.players[0].damage > 0.0), (0, true), "the ranger is paid for the wolf's damage");
    }

    #[test]
    fn a_pounce_through_an_invisible_monsters_spot_hits_and_reveals_it() {
        let (mut run, id) = guard_run();
        let wi = wolf_idx(&run, id);
        let w = run.monsters[wi].pos;
        let ghost = orc_at(&mut run, w + Vec2::new(30.0, 0.0));
        let gi = run.monster_idx(ghost).unwrap();
        run.monsters[gi].ai.hold = 99.0;
        run.monsters[gi].hp = 500.0;
        run.monsters[gi].effects.add(EffectKind::Invisible, 30.0);
        let at = w + Vec2::new(44.0, 0.0);
        assert!(monster_use(&mut run, wi, AbilityId::Pounce, at));
        for _ in 0..60 {
            if tick_monster_dash(&mut run, wi, DT).is_some() {
                break;
            }
        }
        assert_eq!(hp_of(&run, ghost), Some(480.0), "the leap hits what it passes over");
        assert!(!run.has_effect(Creature::Monster(gi), EffectKind::Invisible), "and shows it");
    }

    #[test]
    fn a_wind_up_on_prey_that_went_invisible_is_dropped() {
        for alt in [false, true] {
            let (mut run, id) = guard_run();
            let wi = wolf_idx(&run, id);
            let w = run.monsters[wi].pos;
            let orc = orc_at(&mut run, w + Vec2::new(14.0, 0.0));
            let oi = run.monster_idx(orc).unwrap();
            run.monsters[oi].ai.hold = 99.0;
            run.monsters[oi].hp = 500.0;
            companion_mut(&mut run, wi).prey = Some(orc);
            run.monsters[wi].ai.windup = Some(crate::run::entities::Windup { t: 0.0, aim: 0.0, alt, at: None, id: None });
            run.monsters[oi].effects.add(EffectKind::Invisible, 30.0);
            crate::run::behaviour::tick(&mut run, wi, DT, true);
            assert_eq!(hp_of(&run, orc), Some(500.0), "alt {alt}: no bite");
            assert!(run.monsters[wi].dash.is_none(), "alt {alt}: no leap");
            assert!(run.monsters[wi].ai.windup.is_none(), "alt {alt}: the wind-up is over");
        }
    }

    #[test]
    fn a_pounce_hits_each_foe_once_and_stops_at_the_first() {
        let (mut run, id) = guard_run();
        let wi = wolf_idx(&run, id);
        let w = run.monsters[wi].pos;
        let near = orc_at(&mut run, w + Vec2::new(30.0, 0.0));
        let far = orc_at(&mut run, w + Vec2::new(44.0, 0.0));
        for o in [near, far] {
            let oi = run.monster_idx(o).unwrap();
            run.monsters[oi].ai.hold = 99.0;
            run.monsters[oi].hp = 500.0;
        }
        let at = run.monsters[run.monster_idx(far).unwrap()].pos;
        assert!(monster_use(&mut run, wi, AbilityId::Pounce, at));
        let mut ended = None;
        for _ in 0..60 {
            if let Some(done) = tick_monster_dash(&mut run, wi, DT) {
                ended = Some(done);
                break;
            }
        }
        let done = ended.expect("the pounce ended");
        assert_eq!(done.hit, vec![near], "it stopped at the first foe, which it hit once");
        assert_eq!(hp_of(&run, near), Some(480.0));
        assert_eq!(hp_of(&run, far), Some(500.0));
    }

    #[test]
    fn the_wolf_winds_up_for_its_pounce_with_the_kits_windup() {
        let (mut run, id) = guard_run();
        let r = run.players[0].pos();
        set_wolf_pos(&mut run, id, r + Vec2::new(10.0, 0.0));
        let orc = orc_at(&mut run, r - Vec2::new(40.0, 0.0));
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].ai.hold = 99.0;
        run.monsters[oi].hp = 500.0;
        let windup = wolf(&run, id).kit.get(AbilityId::Pounce).unwrap().windup;
        assert!((windup - 0.2).abs() < 1e-9, "own 0 + Beast Bite's 0.2: {windup}");
        let (mut wound, mut leapt) = (None, None);
        for t in 0..40 {
            run.step();
            let w = wolf(&run, id);
            if wound.is_none() && w.ai.windup.is_some_and(|u| u.alt) {
                wound = Some(t);
            }
            if leapt.is_none() && w.dash.is_some() {
                leapt = Some(t);
            }
        }
        let (wound, leapt) = (wound.expect("it wound up"), leapt.expect("it leapt"));
        assert!(leapt - wound >= (windup * 60.0) as i32 - 1, "the leap waited for the wind-up: {wound} {leapt}");
    }

    #[test]
    fn the_wolf_follows_and_stands_still_with_the_ranger() {
        let (mut run, id) = guard_run();
        let to = run.players[0].pos() + Vec2::new(80.0, 0.0);
        move_ranger(&mut run, to);
        for _ in 0..90 {
            run.step();
        }
        let d = wolf(&run, id).pos.dist(to);
        assert!(d <= WOLF_FOLLOW, "the wolf followed: {d} px from the ranger");
        let at = wolf(&run, id).pos;
        for _ in 0..60 {
            run.step();
        }
        let w = wolf(&run, id);
        assert!(w.pos.dist(at) < 0.5, "it stands still: moved {}", w.pos.dist(at));
        assert_eq!(w.anim, Anim::Idle);
    }

    #[test]
    fn the_wolf_bites_an_enemy_near_the_ranger_and_the_kill_pays_the_ranger() {
        let (mut run, _) = guard_run();
        let at = run.players[0].pos() + Vec2::new(30.0, 0.0);
        let orc = orc_at(&mut run, at);
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].hp = 15.0;
        for _ in 0..180 {
            if hp_of(&run, orc).is_none() {
                break;
            }
            run.step();
        }
        assert!(hp_of(&run, orc).is_none(), "the wolf killed the orc");
        let p = &run.players[0];
        assert_eq!(p.kills, 1);
        assert!(p.xp > 0, "the kill pays XP");
        assert!(p.damage >= 15.0 - 1e-9, "the ranger is credited with the damage: {}", p.damage);
    }

    #[test]
    fn the_wolf_opens_with_a_dash_and_then_bites() {
        let (mut run, id) = guard_run();
        let r = run.players[0].pos();
        set_wolf_pos(&mut run, id, r + Vec2::new(10.0, 0.0));
        let orc = orc_at(&mut run, r - Vec2::new(40.0, 0.0));
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].ai.hold = 99.0;
        run.monsters[oi].hp = 500.0;
        let mut hits: Vec<(usize, f64)> = Vec::new();
        let mut dashed = false;
        for t in 0..5 * 60 {
            let before = hp_of(&run, orc).unwrap();
            run.step();
            let lost = before - hp_of(&run, orc).unwrap();
            if lost > 1e-9 {
                hits.push((t, lost));
            }
            if t < 30 && wolf(&run, id).anim == Anim::Dash {
                dashed = true;
            }
        }
        assert!(dashed, "the wolf dashed");
        assert!(hits.len() >= 2, "hits {hits:?}");
        let (t0, first) = hits[0];
        assert!(t0 < 30 && (first - 20.0).abs() < 1e-9, "the pounce hit for 20 within 0.5 s: {hits:?}");
        let (t1, second) = hits[1];
        assert!((second - 10.0).abs() < 1e-9 && t1 - t0 <= 90, "a bite of 10 followed within 1.5 s: {hits:?}");
        let pounces = hits.iter().filter(|(_, v)| (v - 20.0).abs() < 1e-9).count();
        assert_eq!(pounces, 1, "no second pounce hit within 5 s: {hits:?}");
    }

    #[test]
    fn a_pounce_that_hurts_holds_the_next_bite_one_cooldown_in_the_ai() {
        let (mut run, id) = guard_run();
        let r = run.players[0].pos();
        set_wolf_pos(&mut run, id, r + Vec2::new(10.0, 0.0));
        let orc = orc_at(&mut run, r - Vec2::new(40.0, 0.0));
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].ai.hold = 99.0;
        run.monsters[oi].hp = 500.0;
        for _ in 0..30 {
            run.step();
            if run.monsters[oi].hp < 500.0 {
                break;
            }
        }
        assert!(run.monsters[oi].hp < 500.0, "the pounce hurt the orc");
        let w = wolf(&run, id);
        assert!(w.cds.ready(AbilityId::Bite), "the kit's Bite cooldown is not started by the leap");
        assert!(w.ai.cd > 0.0, "the AI's wait holds the next bite back");
    }

    #[test]
    fn pounce_crosses_a_chasm_and_hits_its_prey_once() {
        let (mut run, id) = guard_run();
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        move_ranger(&mut run, Map::center_of(tx, ty));
        for y in ty - 1..=ty + 1 {
            run.layout.map.set(tx - 2, y, Tile::Chasm);
        }
        set_wolf_pos(&mut run, id, Map::center_of(tx - 3, ty));
        let orc = orc_at(&mut run, Map::center_of(tx, ty) + Vec2::new(10.0, 0.0));
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].ai.hold = 99.0;
        run.monsters[oi].hp = 500.0;
        let mut dashed = false;
        for _ in 0..40 {
            run.step();
            dashed |= wolf(&run, id).anim == Anim::Dash;
            assert!(wolf(&run, id).sinking.is_none(), "it never falls");
        }
        let w = wolf(&run, id);
        assert!(dashed && w.alive && w.sinking.is_none());
        assert!(w.pos.x > Map::center_of(tx - 2, ty).x + 8.0, "it crossed the chasm: {:?}", w.pos);
        assert_eq!(run.layout.map.tile_at(w.pos), Tile::Floor as u8, "and ended on floor");
        assert_eq!(hp_of(&run, orc), Some(500.0 - 20.0), "and hit the orc once, for 20");
    }

    #[test]
    fn a_wolf_blown_over_a_chasm_escapes_only_with_its_dash_ready() {
        use crate::run::objects::{explode_barrel, Barrel, ObjState};
        let blast = |run: &mut Run, id: u32| {
            let at = wolf(run, id).pos - Vec2::new(10.0, 0.0);
            run.spawn_object(EntityKind::Barrel, at, ObjState::Barrel(Barrel::new()));
            let bi = run.objects.len() - 1;
            explode_barrel(run, bi);
        };
        let sank = |run: &Run, id: u32| run.events.iter().any(|(e, _)| matches!(e, Ev::Sink { id: i, how: 0, .. } if *i == id));
        let (mut run, id) = ranger_with_wolf();
        let (tx, ty) = Map::tile_of(run.layout.player_spawns[0]);
        run.layout.map.set(tx + 2, ty, Tile::Chasm);
        run.players[0].debug = true;
        set_wolf_pos(&mut run, id, Map::center_of(tx + 1, ty));
        run.step();
        assert_eq!(wolf(&run, id).last_safe, Map::center_of(tx + 1, ty));

        // Dash ready: it dashes back to the last safe tile.
        run.events.clear();
        blast(&mut run, id);
        let mut started = false;
        for _ in 0..60 {
            run.step();
            assert!(wolf(&run, id).sinking.is_none(), "never sinking");
            if !started && wolf(&run, id).dash.is_some() {
                started = true;
                assert!(!wolf(&run, id).cds.ready(AbilityId::Pounce), "the escape uses the pounce");
            }
        }
        assert!(started, "it dashed back");
        let w = wolf(&run, id);
        let (wx, wy) = Map::tile_of(w.pos);
        assert!(w.alive && run.layout.map.safe(wx, wy), "on a safe tile at {:?}", w.pos);
        assert!(!sank(&run, id), "no Sink event");
        assert_eq!(run.players[0].wolf, Some(id));
        assert!(!wolf(&run, id).cds.ready(AbilityId::Pounce), "the pounce cooldown runs");

        // Dash on cooldown: it falls.
        run.events.clear();
        blast(&mut run, id);
        for _ in 0..30 {
            run.step();
            if sank(&run, id) {
                break;
            }
        }
        assert!(sank(&run, id), "it sinks");
        for _ in 0..=(crate::dungeon::FALL_TIME / DT) as usize + 1 {
            run.step();
        }
        assert!(run.monster_idx(id).is_none(), "the wolf is gone");
        let p = &run.players[0];
        assert!(p.xp == 0 && p.coins == 0 && p.kills == 0);
        assert!((p.cd2 - WOLF_DEAD_COOLDOWN * 10.0 / 13.0).abs() < 0.1, "cd2 {}", p.cd2);
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Msg { text } if text == "p0's wolf has fallen")));
    }

    #[test]
    fn the_wolf_ignores_enemies_far_from_the_ranger_and_never_leaves_the_leash() {
        let (mut run, id) = guard_run();
        let r = run.players[0].pos();
        let orc = orc_at(&mut run, r + Vec2::new(80.0, 0.0));
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].ai.hold = 99.0;
        let hp = run.monsters[oi].hp;
        for _ in 0..120 {
            run.step();
            assert!(wolf(&run, id).pos.dist(r) <= WOLF_LEASH);
        }
        assert_eq!(hp_of(&run, orc), Some(hp), "the wolf left the orc alone");
    }

    #[test]
    fn the_wolf_fights_back() {
        let (mut run, id) = guard_run();
        let r = run.players[0].pos();
        set_wolf_pos(&mut run, id, r + Vec2::new(44.0, 0.0));
        let orc = orc_at(&mut run, r + Vec2::new(60.0, 0.0));
        let hp = hp_of(&run, orc).unwrap();
        for _ in 0..120 {
            run.step();
        }
        assert!(hp_of(&run, orc).map_or(true, |h| h < hp), "the wolf bit back");
    }

    #[test]
    fn the_wolf_never_bites_dormant_or_hiding_monsters() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Lich);
        run.monsters.retain(|m| m.is_boss || m.etype == Some(EnemyType::Disciple));
        let id = spawn_wolf(&mut run, 0);
        lit_arena(&mut run);
        let r = run.players[0].pos();
        // The dormant lich and one of its idle disciples, moved beside the ranger, and a hiding mimic.
        let bi = run.monsters.iter().position(|m| m.is_boss).unwrap();
        run.monsters[bi].pos = r + Vec2::new(0.0, -20.0);
        let di = run.monsters.iter().position(|m| m.etype == Some(EnemyType::Disciple)).unwrap();
        run.monsters[di].pos = r + Vec2::new(-20.0, 0.0);
        let mimic = run.spawn_enemy(EnemyType::Mimic, r + Vec2::new(0.0, 20.0), None);
        let mi = run.monster_idx(mimic).unwrap();
        run.monsters[mi].hiding = true;
        let (boss, disciple) = (run.monsters[bi].id, run.monsters[di].id);
        let full: Vec<f64> = [boss, disciple, mimic].iter().map(|&m| hp_of(&run, m).unwrap()).collect();
        for _ in 0..120 {
            run.step();
        }
        let now: Vec<f64> = [boss, disciple, mimic].iter().map(|&m| hp_of(&run, m).unwrap()).collect();
        assert_eq!(now, full, "nobody was bitten");
        let m = |i: u32| &run.monsters[run.monster_idx(i).unwrap()];
        assert!(m(boss).dormant && m(disciple).dormant && m(mimic).hiding, "and they keep their state");
        assert!(ally(&run, id).prey.is_none());
    }

    #[test]
    fn the_wolf_ignores_invisible_monsters() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let id = spawn_wolf(&mut run, 0);
        lit_arena(&mut run);
        let r = run.players[0].pos();
        let oid = run.spawn_enemy(EnemyType::SkeletonWarrior, r + Vec2::new(30.0, 0.0), None);
        let oi = run.monster_idx(oid).unwrap();
        let wi = run.monster_idx(id).unwrap();
        assert_eq!(find_prey(&run, wi, r, &WOLF_ESCORT), Some(oi), "the wolf goes for a visible enemy");
        run.monsters[oi].effects.add(EffectKind::Invisible, 30.0);
        assert_eq!(find_prey(&run, wi, r, &WOLF_ESCORT), None, "but not an invisible one");
    }

    /// The boss hall, a floor spot 3 tiles inside its door and one 2 tiles outside it.
    fn by_the_door(run: &Run) -> (crate::dungeon::Rect, Vec2, Vec2) {
        let b = run.level.boss().unwrap();
        let (hall, door) = (b.arena, b.door[0]);
        let inward = [(1, 0), (-1, 0), (0, 1), (0, -1)]
            .into_iter()
            .find(|&(dx, dy)| hall.contains_tile(door.0 + dx, door.1 + dy) && !hall.contains_tile(door.0 - dx, door.1 - dy))
            .unwrap();
        let inside = Map::center_of(door.0 + 3 * inward.0, door.1 + 3 * inward.1);
        let outside = Map::center_of(door.0 - 2 * inward.0, door.1 - 2 * inward.1);
        assert!(!run.layout.map.blocks_at(outside, crate::dungeon::Mover::Enemy));
        assert!(!run.layout.map.blocks_at(inside, crate::dungeon::Mover::Enemy));
        assert!(hall.contains(inside) && !hall.contains(outside));
        (hall, inside, outside)
    }

    #[test]
    fn the_wolf_dash_never_stops_over_a_chasm_in_front_of_its_prey() {
        let (mut run, id) = guard_run();
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        move_ranger(&mut run, Map::center_of(tx + 1, ty));
        for y in ty - 1..=ty + 1 {
            run.layout.map.set(tx - 1, y, Tile::Chasm);
        }
        // The orc stands right at the chasm's far edge: the dash touches it over the chasm.
        let edge = tx as f64 * crate::dungeon::TILE;
        let orc = orc_at(&mut run, Vec2::new(edge + 6.0, Map::center_of(tx, ty).y));
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].ai.hold = 99.0;
        run.monsters[oi].hp = 500.0;
        set_wolf_pos(&mut run, id, Map::center_of(tx - 4, ty));
        for _ in 0..60 {
            run.step();
            assert!(wolf(&run, id).sinking.is_none(), "it never falls");
        }
        let w = wolf(&run, id);
        assert!(w.alive && w.sinking.is_none());
        assert_eq!(run.layout.map.tile_at(w.pos), Tile::Floor as u8, "it ended on floor at {:?}", w.pos);
        assert!(hp_of(&run, orc).unwrap() <= 500.0 - 20.0 + 1e-9, "the pounce hit the orc");
    }

    #[test]
    fn the_wolf_reappears_beside_the_ranger_when_far_or_locked_out() {
        // Far: 250 px away.
        let (mut run, id) = guard_run();
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 2..=ty + 2 {
            for x in tx..=tx + 20 {
                run.layout.map.set(x, y, Tile::Floor);
            }
        }
        let to = run.players[0].pos() + Vec2::new(250.0, 0.0);
        move_ranger(&mut run, to);
        run.events.clear();
        run.step();
        assert!(wolf(&run, id).pos.dist(to) <= 16.0, "beside the ranger: {:?}", wolf(&run, id).pos);
        assert!(run.events.iter().any(|(e, at)| matches!(e, Ev::Boom { k: 9, .. }) && at.is_none()), "with the green puff");

        // Locked out: the hall door closes with the ranger inside and the wolf outside.
        let (mut run, id) = ranger_with_wolf();
        run.players[0].debug = true;
        let (hall, inside, outside) = by_the_door(&run);
        assert!(inside.dist(outside) < WOLF_REAPPEAR, "near enough: only the door keeps it out");
        // Both outside first, so the reach check runs on its own clock.
        move_ranger(&mut run, outside);
        set_wolf_pos(&mut run, id, outside);
        for _ in 0..10 {
            run.step();
        }
        move_ranger(&mut run, inside);
        set_wolf_pos(&mut run, id, outside);
        crate::run::levels::boss::check_arena(&mut run);
        assert!(run.level.boss().unwrap().door_closed);
        for _ in 0..31 {
            run.step();
        }
        assert!(hall.contains(wolf(&run, id).pos), "the wolf is inside the hall: {:?}", wolf(&run, id).pos);
    }

    /// The ranger (debug, so the lava spares her) in the middle of a 3x3 patch of lava on lit open floor.
    fn ranger_on_lava() -> (Run, u32, (i32, i32)) {
        let (mut run, id) = guard_run();
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 1..=ty + 1 {
            for x in tx - 1..=tx + 1 {
                run.layout.map.set(x, y, Tile::Lava);
            }
        }
        move_ranger(&mut run, Map::center_of(tx, ty));
        (run, id, (tx, ty))
    }

    #[test]
    fn the_wolf_never_reappears_onto_lava_beside_a_ranger_standing_on_it() {
        let (mut run, id, (tx, ty)) = ranger_on_lava();
        set_wolf_pos(&mut run, id, Map::center_of(tx - 4, ty));
        for _ in 0..120 {
            run.step();
            let w = wolf(&run, id);
            assert!(w.alive, "the wolf lives");
            assert!(!run.layout.map.blocks_at(w.pos, Mover::Enemy), "the wolf stands on walkable ground: {:?}", w.pos);
        }
    }

    #[test]
    fn a_summon_beside_lava_lands_on_walkable_ground() {
        let (mut run, _, (tx, ty)) = ranger_on_lava();
        // Standing on the lava, no point beside her is safe: the nearest walkable tile centre.
        run.monsters.retain(|m| m.is_boss);
        let id = spawn_wolf(&mut run, 0);
        let w = wolf(&run, id);
        assert!(!run.layout.map.blocks_at(w.pos, Mover::Enemy), "on walkable ground: {:?}", w.pos);
        assert!(w.pos.dist(Map::center_of(tx, ty)) <= 2.0 * crate::dungeon::TILE * 1.5);
        // Beside a lava tile: a free point beside her.
        let (mut run, _) = guard_run();
        run.monsters.retain(|m| m.is_boss);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        run.layout.map.set(tx + 1, ty, Tile::Lava);
        let id = spawn_wolf(&mut run, 0);
        assert!(!run.layout.map.blocks_at(wolf(&run, id).pos, Mover::Enemy));
    }

    #[test]
    fn only_heroes_wake_the_boss_open_chests_and_reveal_mimics() {
        use crate::run::objects::ObjState;
        // The wolf alone in the boss hall, the ranger just outside the open door (near enough
        // and with a path, so the wolf does not reappear beside them).
        let (mut run, id) = ranger_with_wolf();
        let (hall, inside, outside) = by_the_door(&run);
        assert!(inside.dist(outside) < WOLF_REAPPEAR);
        move_ranger(&mut run, outside);
        for _ in 0..60 {
            set_wolf_pos(&mut run, id, inside);
            run.step();
            assert!(hall.contains(wolf(&run, id).pos), "the wolf was in the hall: {:?}", wolf(&run, id).pos);
            assert!(!hall.contains(run.players[0].pos()));
        }
        let b = run.level.boss().unwrap();
        assert!(!b.awake && !b.door_closed, "the wolf does not wake the boss or seal the door");
        assert!(run.monsters.iter().find(|m| m.is_boss).unwrap().dormant);

        // On a chest and beside a hiding mimic.
        let (mut run, id) = guard_run();
        let r = run.players[0].pos();
        let chest = run.spawn_object(EntityKind::Chest, r + Vec2::new(25.0, 0.0), ObjState::Chest { opened: None });
        let mimic = run.spawn_enemy(EnemyType::Mimic, r + Vec2::new(25.0, 10.0), None);
        let mi = run.monster_idx(mimic).unwrap();
        run.monsters[mi].hiding = true;
        for _ in 0..30 {
            set_wolf_pos(&mut run, id, r + Vec2::new(25.0, 2.0));
            run.step();
        }
        let o = run.objects.iter().find(|o| o.id == chest).unwrap();
        assert!(matches!(o.state, ObjState::Chest { opened: None }), "the wolf opens no chest");
        assert!(run.monsters[run.monster_idx(mimic).unwrap()].hiding, "and reveals no mimic");
    }

    #[test]
    fn a_frozen_wolf_does_nothing_and_a_sleep_never_takes() {
        let (mut run, id) = guard_run();
        let to = run.players[0].pos() + Vec2::new(80.0, 0.0);
        move_ranger(&mut run, to);
        let wi = wolf_idx(&run, id);
        assert!(run.apply_effect(Creature::Monster(wi), EffectKind::Frozen, Some(1.0)));
        let at = wolf(&run, id).pos;
        for _ in 0..55 {
            run.step();
        }
        assert_eq!(wolf(&run, id).pos, at, "frozen: it stays");
        for _ in 0..30 {
            run.step();
        }
        assert!(wolf(&run, id).pos.dist(at) > 5.0, "thawed: it follows again");
        let wi = wolf_idx(&run, id);
        assert!(!run.apply_effect(Creature::Monster(wi), EffectKind::Sleep, Some(5.0)));
    }

    #[test]
    fn wolf_ignores_foe_it_cannot_hurt() {
        let (mut run, id) = guard_run();
        let wi = wolf_idx(&run, id);
        let w = run.monsters[wi].pos;
        let ghost = orc_at(&mut run, w + Vec2::new(30.0, 0.0));
        let gi = run.monster_idx(ghost).unwrap();
        let prof = crate::defs::races::profile(&[crate::defs::races::Race::Incorporeal], crate::defs::races::Adjust::NONE);
        run.monsters[gi].res = prof.res;
        run.monsters[gi].traits = prof.traits;
        let ranger = run.players[0].pos();
        // The wolf's bite is 20 % Magical, which a ghost does not resist: the bite hurts it, so it is prey.
        assert_eq!(find_prey(&run, wi, ranger, &WOLF_ESCORT), Some(gi), "the Magical share hits");
        run.monsters[gi].res.set(DamageType::Magical, 1.0);
        assert_eq!(find_prey(&run, wi, ranger, &WOLF_ESCORT), None, "its whole bite would pass through");
        run.monsters[gi].traits = Default::default();
        assert_eq!(find_prey(&run, wi, ranger, &WOLF_ESCORT), Some(gi), "control: with a body it is prey");
    }

    #[test]
    fn the_wolf_has_no_script_of_its_own() {
        // `tick_wolf` and `WolfState` are gone (this module compiles without them); a wolf beside an orc bites
        // through the shared melee AI: perception, wind-up, and the AI's own bite pacing.
        let (mut run, id) = guard_run();
        let wi = wolf_idx(&run, id);
        let w = run.monsters[wi].pos;
        let orc = orc_at(&mut run, w + Vec2::new(14.0, 0.0));
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].ai.hold = 99.0;
        run.monsters[oi].hp = 500.0;
        let mut bites = vec![];
        for t in 0..120 {
            run.step();
            if run.monsters[oi].hp < 500.0 && bites.last().map_or(true, |&(_, hp)| hp > run.monsters[oi].hp) {
                bites.push((t, run.monsters[oi].hp));
            }
        }
        assert!(bites.len() >= 2, "it bit more than once: {bites:?}");
        let gap = (bites[1].0 - bites[0].0) as f64 * DT;
        let bite = wolf(&run, id).kit.get(AbilityId::Bite).unwrap();
        assert!(gap >= bite.cooldown - 0.1, "paced by the bite's cooldown ({}): gap {gap}", bite.cooldown);
        assert_eq!(wolf(&run, id).base_ai, BaseAi::Melee);
        assert!(wolf(&run, id).etype.is_none());
    }

    #[test]
    fn the_bite_wait_counts_down_while_following_and_while_dashing() {
        // With no prey the wolf follows; mid-dash it flies. Either way ai.cd runs, once per tick.
        let (mut run, id) = guard_run();
        let wi = wolf_idx(&run, id);
        run.monsters[wi].ai.cd = 1.0;
        run.step();
        assert!((wolf(&run, id).ai.cd - (1.0 - DT)).abs() < 1e-9, "following: {}", wolf(&run, id).ai.cd);
        let far = run.monsters[wi].pos + Vec2::new(40.0, 0.0);
        assert!(monster_use(&mut run, wi, AbilityId::Pounce, far));
        run.monsters[wi].ai.cd = 1.0;
        run.step();
        assert!(wolf(&run, id).dash.is_some());
        assert!((wolf(&run, id).ai.cd - (1.0 - DT)).abs() < 1e-9, "dashing: {}", wolf(&run, id).ai.cd);
    }

    #[test]
    fn the_wolfs_bite_wait_runs_on_its_clock() {
        let (mut run, id) = guard_run();
        let wi = wolf_idx(&run, id);
        run.apply_effect(Creature::Monster(wi), EffectKind::Accelerated, Some(30.0));
        run.monsters[wi].ai.cd = 1.0;
        crate::run::behaviour::tick(&mut run, wi, DT, true);
        let left = wolf(&run, id).ai.cd;
        assert!((left - (1.0 - 1.25 * DT)).abs() < 1e-9, "{left}");
    }
}
