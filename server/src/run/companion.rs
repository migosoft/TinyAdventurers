//! The Elven Ranger's wolf: an ally monster. Spawn and death here.

use super::entities::{Ai, Ally, Monster, HISTORY_LEN};
use super::Run;
use crate::defs::companions::*;
use crate::defs::kinds::{Anim, EntityKind};
use crate::dungeon::{self, Map, Mover};
use crate::math::Vec2;
use crate::protocol::Ev;
use std::collections::VecDeque;

/// The first of 8 points 12 px around `pos` (east first, then clockwise) where the
/// wolf can stand: walkable ground, clear of solid objects. Else `pos` itself.
pub fn spot_beside(run: &Run, pos: Vec2) -> Vec2 {
    let solids = run.solids(None);
    (0..8)
        .map(|i| pos + Vec2::from_angle(i as f64 * std::f64::consts::FRAC_PI_4) * 12.0)
        .find(|&p| !run.layout.map.blocks_at(p, Mover::Enemy) && !solids.iter().any(|s| (p.x - s.x).abs() < s.half + WOLF_RADIUS && (p.y - s.y).abs() < s.half + WOLF_RADIUS))
        .unwrap_or(pos)
}

/// Summons the wolf of hero `pi` beside them and returns its id.
pub fn spawn_wolf(run: &mut Run, pi: usize) -> u32 {
    let prof = wolf_profile();
    let owner = run.players[pi].id;
    let spot = spot_beside(run, run.players[pi].pos());
    let (tx, ty) = Map::tile_of(spot);
    let id = run.alloc_id();
    run.monsters.push(Monster {
        id,
        res: prof.res,
        melee: prof.melee,
        etype: None,
        kind: EntityKind::DireWolf,
        pos: spot,
        hp: WOLF_HP,
        max_hp: WOLF_HP,
        speed: WOLF_SPEED,
        radius: WOLF_RADIUS,
        sight: prof.sight,
        alive: true,
        aim: 0.0,
        anim: Anim::Idle,
        anim_start: run.time,
        hurt_t: 0.0,
        ai: Ai::new(spot),
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
        last_hit_by: None,
        effects: Default::default(),
        responses: wolf_responses(),
        ally: Some(Ally {
            owner,
            growled: Vec::new(),
            growl_cd: 0.0,
            growl_to: None,
            hold: 0.0,
            prey: None,
            following: false,
            reach_t: 0.0,
            dash: None,
            dash_cd: 0.0,
            last_safe: Map::center_of(tx, ty),
        }),
    });
    run.players[pi].wolf = Some(id);
    run.event(Ev::Boom { x: spot.x as f32, y: spot.y as f32, r: 10.0, k: 9 }, None);
    id
}

/// The wolf `mi` has fallen: no XP, no coins, no kill; the ranger waits for the next one.
pub fn wolf_died(run: &mut Run, mi: usize) {
    let m = &mut run.monsters[mi];
    m.alive = false;
    m.hp = 0.0;
    let (id, pos, kind) = (m.id, m.pos, m.kind as u8);
    let owner = m.ally.as_ref().map(|a| a.owner);
    run.event(Ev::Died { id, x: pos.x as f32, y: pos.y as f32, kind }, None);
    if let Some(pi) = owner.and_then(|o| run.player_idx(o)) {
        let p = &mut run.players[pi];
        p.wolf = None;
        p.cd2 = WOLF_DEAD_COOLDOWN / p.mods.attack_speed;
        let name = p.name.clone();
        run.event(Ev::Msg { text: format!("{name}'s wolf has fallen") }, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities::AbilityId;
    use crate::defs::damage::{Damage, DamageType};
    use crate::defs::effects::{EffectKind, EffectResponse};
    use crate::defs::kinds::EntityKind;
    use crate::dungeon::{Map, Tile};
    use crate::math::Vec2;
    use crate::protocol::{BossId, ClassId, Ev};
    use crate::run::abilities::{dagger_target, dash_contact, tick_projectiles, try_use};
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

    #[test]
    fn a_summoned_wolf_has_its_numbers() {
        let (run, id) = ranger_with_wolf();
        let m = &run.monsters[wolf_idx(&run, id)];
        assert_eq!((m.hp, m.max_hp), (80.0, 80.0));
        assert!((m.res.get(DamageType::Cold) - 0.2).abs() < 1e-12);
        assert!((m.res.get(DamageType::Poison) - 0.1).abs() < 1e-12);
        assert!((m.res.get(DamageType::Magical) - 0.1).abs() < 1e-12);
        assert_eq!(m.responses.get(EffectKind::Sleep), EffectResponse::Immune);
        assert_eq!(m.kind, EntityKind::DireWolf);
        assert_eq!(m.ally.as_ref().unwrap().owner, run.players[0].id);
        assert_eq!(run.players[0].wolf, Some(id));
        assert!(run.events.iter().any(|(e, at)| matches!(e, Ev::Boom { k: 9, .. }) && at.is_none()), "the green puff goes to the whole party");
    }

    #[test]
    fn no_hero_attack_hurts_the_wolf() {
        // The dagger: a wolf 10 px away is no dagger target, the crossbow fires instead.
        let (mut run, id) = run_with_wolf_beside(&[ClassId::ElvenRanger], 0, 10.0);
        assert_eq!(dagger_target(&run, 0), None);
        try_use(&mut run, 0, AbilityId::CrossbowDagger, 1, true);
        assert_eq!(run.projectiles.len(), 1, "a bolt is fired");
        untouched(&run, id, "dagger");

        // A bolt flies straight through it.
        let (mut run, id) = run_with_wolf_beside(&[ClassId::ElvenRanger], 0, 40.0);
        try_use(&mut run, 0, AbilityId::CrossbowDagger, 1, true);
        for _ in 0..30 {
            tick_projectiles(&mut run, DT);
        }
        untouched(&run, id, "bolt");

        // Sword and axe swings.
        let (mut run, id) = run_with_wolf_beside(&[ClassId::ElvenRanger, ClassId::Paladin, ClassId::Barbarian], 1, 10.0);
        try_use(&mut run, 1, AbilityId::Sword, 1, true);
        untouched(&run, id, "sword");
        try_use(&mut run, 2, AbilityId::Axe, 1, true);
        untouched(&run, id, "axe");

        // The Barbarian's dash.
        try_use(&mut run, 2, AbilityId::Dash, 1, false);
        dash_contact(&mut run, 2);
        untouched(&run, id, "dash");

        // A fireball that goes off on it.
        let (mut run, id) = run_with_wolf_beside(&[ClassId::ElvenRanger, ClassId::Wizard], 1, 30.0);
        run.players[1].aim_dist = 30.0;
        try_use(&mut run, 1, AbilityId::Fireball, 1, true);
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
        assert!((p.cd2 - 60.0).abs() < 1e-9);
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
        let goblin = run.spawn_enemy(crate::defs::enemies::EnemyType::GoblinArcher, far, None, 1);
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
        let orc = run.spawn_enemy(EnemyType::OrcWarrior, far + Vec2::new(20.0, 0.0), None, 1);
        for _ in 0..120 {
            run.step();
        }
        assert!(run.monsters[wolf_idx(&run, id)].hp < 80.0, "the orc hurt the wolf");
        let oi = run.monster_idx(orc).unwrap();
        assert_eq!(run.monsters[oi].ai.target, Some(crate::run::entities::Target::Ally(id)));
    }

    #[test]
    fn an_enemy_arrow_hits_the_wolf() {
        let (mut run, id) = ranger_with_wolf();
        lit_arena(&mut run);
        let mi = wolf_idx(&run, id);
        let at = run.players[0].pos() + Vec2::new(6.0 * crate::dungeon::TILE, 0.0);
        run.monsters[mi].pos = at;
        crate::run::abilities::spawn_monster_projectile(&mut run, 999, EntityKind::Arrow, at - Vec2::new(30.0, 0.0), Vec2::new(1.0, 0.0), 180.0, 7.0, 2.0, 0.0, 0, 0.0);
        for _ in 0..40 {
            tick_projectiles(&mut run, DT);
        }
        let hp = run.monsters[wolf_idx(&run, id)].hp;
        assert!((hp - 73.0).abs() < 1e-9, "the arrow's 7 damage, got hp {hp}");
        assert!(run.projectiles.iter().all(|p| p.dead), "and it stopped there");
    }

    #[test]
    fn area_attacks_hit_the_wolf() {
        use crate::defs::enemies::{self, EnemyType};
        use crate::run::objects::{explode_barrel, Barrel, ObjState};
        // The ogre's slam.
        let (mut run, oi) = crate::run::ai::tests::ogre_among(&[Vec2::new(200.0, 0.0)]);
        let id = spawn_wolf(&mut run, 0);
        let wi = wolf_idx(&run, id);
        run.players[0].debug = true;
        run.monsters[wi].pos = run.monsters[oi].pos + Vec2::new(enemies::OGRE_SLAM_RADIUS - 4.0, 0.0);
        let slam = enemies::def(EnemyType::Ogre).alt.unwrap();
        crate::run::ai::perform_attack(&mut run, oi, Creature::Monster(wi), slam, true, None);
        let w = &run.monsters[wolf_idx(&run, id)];
        assert!(w.hp < 80.0, "the slam hurt the wolf");
        assert!(w.knock.x > 0.0, "and pushed it away from the ogre");

        // A fire patch.
        let (mut run, id) = ranger_with_wolf();
        lit_arena(&mut run);
        let at = run.monsters[wolf_idx(&run, id)].pos + Vec2::new(5.0 * crate::dungeon::TILE, 0.0);
        let wi = wolf_idx(&run, id);
        run.monsters[wi].pos = at;
        run.spawn_hazard(EntityKind::FirePatch, at, 10.0, 2.0, 5.0);
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
        use crate::defs::bosses::{LICH_NOVA_DAMAGE, LICH_NOVA_RADIUS};
        let (mut run, bi) = crate::run::bosses::lich::tests::lich_with(&[Vec2::new(0.0, 4.0 * crate::dungeon::TILE)]);
        let boss_pos = run.monsters[bi].pos;
        let id = spawn_wolf(&mut run, 0);
        let wi = wolf_idx(&run, id);
        run.monsters[wi].pos = boss_pos + Vec2::new(LICH_NOVA_RADIUS - 10.0, 0.0);
        crate::run::bosses::lich::Lich::nova(&mut run, boss_pos);
        let hp = run.monsters[wolf_idx(&run, id)].hp;
        assert!((hp - (80.0 - LICH_NOVA_DAMAGE * 0.9)).abs() < 1e-9, "magical resistance 10 %: hp {hp}");
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
        try_use(&mut run, 1, AbilityId::Heal, 1, false);
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
        assert!(p.cd2 > 55.0 && p.cd2 <= 60.0, "the wait for the next wolf started: {}", p.cd2);
    }
}
