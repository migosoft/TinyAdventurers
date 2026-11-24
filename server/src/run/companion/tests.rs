use super::*;
use crate::defs::companions::KNIGHT_ESCORT;
use crate::defs::enemies::EnemyType;
use crate::math::Vec2;
use crate::protocol::{BossId, ClassId, Ev};
use crate::run::entities::Companion;
use crate::run::targets::Side;
use crate::run::tests::test_run;
use crate::dungeon::Map;
use crate::run::Run;

/// Three heroes (host first) and an orc that hero 1 recruited.
fn recruited() -> (Run, usize) {
    let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin, ClassId::Barbarian], BossId::Demon);
    run.monsters.retain(|m| m.is_boss);
    let id = run.spawn_enemy(EnemyType::OrcWarrior, Vec2::new(100.0, 100.0), None);
    let mi = run.monster_idx(id).unwrap();
    let m = &mut run.monsters[mi];
    m.side = Side::Friendly;
    m.companion = Some(Companion {
        escort: &KNIGHT_ESCORT,
        leader: run.players[1].id,
        recruiter: run.players[1].id,
        summoned: false,
        prey: None,
        following: false,
        reach_t: 0.0,
    });
    (run, mi)
}

fn leader_id(run: &Run, mi: usize) -> Option<u32> {
    let c = run.monsters[mi].companion.as_ref().unwrap();
    leader_of(run, c, run.monsters[mi].side).map(|l| run.creature_id(l))
}

#[test]
fn leader_hierarchy() {
    let (mut run, mi) = recruited();
    assert_eq!(leader_id(&run, mi), Some(run.players[1].id), "the recruiter leads");
    run.players[1].alive = false;
    assert_eq!(leader_id(&run, mi), Some(run.players[0].id), "then the host");
    run.players[0].alive = false;
    assert_eq!(leader_id(&run, mi), Some(run.players[2].id), "then the next living hero");
    run.players[2].alive = false;
    assert_eq!(leader_id(&run, mi), None);
}

#[test]
fn recruiter_is_host_then_next() {
    let (mut run, mi) = recruited();
    let host = run.players[0].id;
    run.monsters[mi].companion.as_mut().unwrap().recruiter = host;
    assert_eq!(leader_id(&run, mi), Some(host));
    run.players[0].alive = false;
    assert_eq!(leader_id(&run, mi), Some(run.players[1].id));
}

#[test]
fn summoned_vanishes_with_its_summoner() {
    let mut run = test_run(&[ClassId::ElvenRanger, ClassId::Wizard], BossId::Demon);
    run.monsters.retain(|m| m.is_boss);
    let id = crate::run::wolf::spawn_wolf(&mut run, 1);
    run.players[1].alive = false;
    run.events.clear();
    update_leaders(&mut run);
    let mi = run.monster_idx(id).unwrap();
    assert!(!run.monsters[mi].alive);
    assert_eq!(run.players[1].wolf, None);
    assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Boom { k: 9, .. })), "the puff");
}

#[test]
fn recruited_stays_when_its_recruiter_falls() {
    let (mut run, mi) = recruited();
    run.players[1].alive = false;
    update_leaders(&mut run);
    assert!(run.monsters[mi].alive);
    assert_eq!(run.monsters[mi].companion.as_ref().unwrap().leader, run.players[0].id);
}

// ---- The knight: follow, guard and fight through the enemy AI ----

/// Open lit floor around the heroes; two heroes (host first).
fn knight_run() -> Run {
    let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin], BossId::Demon);
    run.monsters.retain(|m| m.is_boss);
    crate::run::ai::tests::open_floor(&mut run);
    run.lights.fill();
    run
}

/// A Friendly knight recruited by hero `recruiter`, 20 px east of them.
fn knight_with(run: &mut Run, recruiter: usize) -> usize {
    let at = run.players[recruiter].pos() + Vec2::new(20.0, 0.0);
    let id = run.spawn_enemy(EnemyType::Knight, at, None);
    let mi = run.monster_idx(id).unwrap();
    let hero = run.players[recruiter].id;
    let m = &mut run.monsters[mi];
    m.side = Side::Friendly;
    m.companion = Some(Companion { escort: &KNIGHT_ESCORT, leader: hero, recruiter: hero, summoned: false, prey: None, following: false, reach_t: 0.0 });
    mi
}

/// Moves every hero to `to`.
fn move_heroes(run: &mut Run, to: Vec2) {
    for p in run.players.iter_mut() {
        p.mv.x = to.x;
        p.mv.y = to.y;
    }
}

/// An orc `dx` px east of hero 0 that stands still (held) with plenty of HP, so only the knight's blows count.
fn dummy_orc(run: &mut Run, dx: f64) -> usize {
    let id = run.spawn_enemy(EnemyType::OrcWarrior, run.players[0].pos() + Vec2::new(dx, 0.0), None);
    let oi = run.monster_idx(id).unwrap();
    run.monsters[oi].ai.hold = 1e9;
    run.monsters[oi].hp = 1000.0;
    run.monsters[oi].max_hp = 1000.0;
    oi
}

#[test]
fn knight_follows_its_leader() {
    let mut run = knight_run();
    let mi = knight_with(&mut run, 0);
    let to = run.players[0].pos() + Vec2::new(100.0, 0.0);
    move_heroes(&mut run, to);
    for _ in 0..60 {
        run.step();
    }
    let d = run.monsters[mi].pos.dist(run.players[0].pos());
    assert!(d <= KNIGHT_ESCORT.follow, "the knight caught up: {d}");
}

#[test]
fn knight_fights_the_enemy_nearest_its_leader() {
    let mut run = knight_run();
    let mi = knight_with(&mut run, 0);
    // The knight stands 20 px west of the hero. The orc at +30 is nearer the leader, the one at -50 nearer the knight;
    // both are inside `guard`.
    let at = run.players[0].pos() + Vec2::new(-20.0, 0.0);
    run.monsters[mi].pos = at;
    let (near_leader, near_knight) = (dummy_orc(&mut run, 30.0), dummy_orc(&mut run, -50.0));
    let (max0, max1) = (run.players[0].max_hp, run.players[1].max_hp);
    assert!(run.monsters[near_leader].pos.dist(run.players[0].pos()) < run.monsters[near_knight].pos.dist(run.players[0].pos()));
    assert!(run.monsters[near_knight].pos.dist(at) < run.monsters[near_leader].pos.dist(at));
    let mut first_hurt = None;
    for _ in 0..240 {
        run.step();
        if first_hurt.is_none() {
            first_hurt = [near_leader, near_knight].into_iter().find(|&o| run.monsters[o].hp < 1000.0);
        }
    }
    assert_eq!(first_hurt, Some(near_leader), "the orc nearest the leader was hit first");
    // The orcs are held, so any damage to a hero or the knight's own side would come from the knight.
    assert!(run.players[0].hp == max0 && run.players[1].hp == max1, "no hero was hurt");
    assert!(run.monsters[mi].hp == run.monsters[mi].max_hp, "the knight was not hurt");
}

#[test]
fn a_recruited_knight_paths_around_a_chasm_to_its_prey() {
    use crate::dungeon::Tile;
    let mut run = knight_run();
    let mi = knight_with(&mut run, 0);
    let (tx, ty) = Map::tile_of(run.players[0].pos());
    // A chasm wall two tiles east of the heroes, open at its north end; the orc stands behind it.
    for y in ty - 2..=ty + 3 {
        run.layout.map.set(tx + 2, y, Tile::Chasm);
    }
    run.layout.map.set(tx + 2, ty - 3, Tile::Floor);
    let orc = dummy_orc(&mut run, 56.0);
    run.monsters[mi].pos = Map::center_of(tx + 1, ty);
    let reach = run.monsters[mi].radius + run.monsters[orc].radius + 14.0;
    let mut reached = None;
    for i in 0..360 {
        run.step();
        if reached.is_none() && run.monsters[mi].pos.dist(run.monsters[orc].pos) <= reach {
            reached = Some(i);
        }
    }
    assert!(reached.is_some(), "the knight walked around the chasm; it stands at {:?}", run.monsters[mi].pos);
}

#[test]
fn knight_keeps_its_leash() {
    let mut run = knight_run();
    let mi = knight_with(&mut run, 0);
    let orc = dummy_orc(&mut run, 40.0);
    for _ in 0..30 {
        run.step();
    }
    let id = run.monsters[orc].id;
    assert_eq!(run.monsters[mi].companion.as_ref().unwrap().prey, Some(id), "the knight went for the orc inside its guard");
    // The orc is now beyond the leash but in the knight's sight (a hero walks off; the knight is not lost: < reappear).
    let hero = run.players[0].pos();
    let far = KNIGHT_ESCORT.leash + 20.0;
    assert!(far < KNIGHT_ESCORT.reappear);
    run.monsters[orc].pos = hero + Vec2::new(far, 0.0);
    run.monsters[orc].ai.hold = 1e9;
    let sight = run.monsters[mi].sight_now();
    assert!(crate::run::perception::sees(&run, sight, run.monsters[mi].pos, run.monsters[mi].gaze_dir(), run.monsters[orc].pos), "the orc is in sight");
    let hp = run.monsters[orc].hp;
    for _ in 0..120 {
        run.step();
        let d = run.monsters[mi].pos.dist(hero);
        assert!(d <= KNIGHT_ESCORT.leash, "the knight stayed within its leash: {d}");
    }
    assert_eq!(run.monsters[mi].companion.as_ref().unwrap().prey, None, "the knight dropped the prey");
    assert_eq!(run.monsters[orc].hp, hp, "the orc beyond the leash was left alone");
}

#[test]
fn knight_reappears_when_lost() {
    let mut run = knight_run();
    let mi = knight_with(&mut run, 0);
    let to = run.players[0].pos() + Vec2::new(300.0, 0.0);
    move_heroes(&mut run, to);
    run.step();
    let d = run.monsters[mi].pos.dist(run.players[0].pos());
    assert!(d <= 20.0, "the knight is beside the hero: {d}");
}

#[test]
fn knight_kill_pays_the_party() {
    let mut run = knight_run();
    let mi = knight_with(&mut run, 0);
    let id = run.spawn_enemy(EnemyType::OrcWarrior, run.players[0].pos() + Vec2::new(30.0, 0.0), None);
    let oi = run.monster_idx(id).unwrap();
    run.monsters[oi].ai.hold = 1e9;
    let xp = crate::defs::progression::xp_for_kill(Some(EnemyType::OrcWarrior));
    let before: Vec<u32> = run.players.iter().map(|p| p.xp).collect();
    let kid = run.monsters[mi].id;
    let gone = |run: &Run| run.monsters.iter().all(|m| m.id != id || !m.alive);
    for _ in 0..1200 {
        run.step();
        if gone(&run) {
            break;
        }
    }
    assert!(gone(&run), "the knight killed the orc");
    assert!(run.monsters.iter().any(|m| m.id == kid && m.alive), "the knight lives");
    for (p, b) in run.players.iter().zip(before) {
        assert_eq!(p.xp, b + xp, "every hero gained the XP");
    }
    assert_eq!(run.players[0].kills, 1, "the leader is credited");
    assert_eq!(run.players[1].kills, 0);
}

#[test]
fn companion_falling_gives_nothing() {
    use crate::run::entities::Sink;
    let mut run = knight_run();
    let mi = knight_with(&mut run, 0);
    let kid = run.monsters[mi].id;
    run.monsters[mi].sinking = Some((0.05, Sink::Fall));
    run.events.clear();
    let before: Vec<(u32, u32, u32)> = run.players.iter().map(|p| (p.xp, p.kills, p.coins)).collect();
    for _ in 0..10 {
        run.step();
    }
    assert!(run.monsters.iter().all(|m| m.id != kid || (!m.alive && m.hp == 0.0)), "the knight is dead");
    let after: Vec<(u32, u32, u32)> = run.players.iter().map(|p| (p.xp, p.kills, p.coins)).collect();
    assert_eq!(before, after, "no XP, kills or coins");
    assert!(!run.events.iter().any(|(e, _)| matches!(e, Ev::Coins { .. })));
    assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Msg { text } if text == "The Knight has fallen")), "the message");
    assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Died { .. })));
}

// ---- The start room's knight and recruiting with E ----

/// A Neutral knight `dx` px east of hero 0.
fn neutral_knight(run: &mut Run, dx: f64) -> usize {
    let id = run.spawn_enemy(EnemyType::Knight, run.players[0].pos() + Vec2::new(dx, 0.0), None);
    let mi = run.monster_idx(id).unwrap();
    run.monsters[mi].side = Side::Neutral;
    mi
}

/// Hero `pi` presses E.
fn press_e(run: &mut Run, pi: usize) {
    let seq = run.players[pi].ack + 1;
    run.players[pi].inputs.push_back(crate::protocol::InputMsg { seq, act: true, ..Default::default() });
}

#[test]
fn every_dungeon_starts_with_a_neutral_knight() {
    use crate::run::tests::test_run_seed;
    for boss in BossId::ALL {
        for seed in 1..=5 {
            let run = test_run_seed(&[ClassId::Wizard], boss, seed);
            let knights: Vec<_> = run.monsters.iter().filter(|m| m.etype == Some(EnemyType::Knight)).collect();
            assert_eq!(knights.len(), 1, "{boss:?} seed {seed}");
            let k = knights[0];
            assert_eq!(k.side, Side::Neutral);
            let crate::run::levels::Level::Dungeon(d) = &run.level else { panic!() };
            let room = &d.rooms[d.start].rect;
            let (tx, ty) = Map::tile_of(k.pos);
            assert!((room.x..room.x + room.w).contains(&tx) && (room.y..room.y + room.h).contains(&ty), "{boss:?} seed {seed}: in the start room");
            assert!(run.layout.player_spawns.iter().all(|s| s.dist(k.pos) >= 20.0), "{boss:?} seed {seed}: clear of the spawns");
        }
    }
}

#[test]
fn e_recruits_the_knight() {
    let mut run = knight_run();
    let ki = neutral_knight(&mut run, 12.0);
    run.events.clear();
    press_e(&mut run, 0);
    run.step();
    let k = &run.monsters[ki];
    assert_eq!(k.side, Side::Friendly);
    let c = k.companion.as_ref().expect("a companion");
    assert_eq!((c.recruiter, c.leader, c.summoned), (run.players[0].id, run.players[0].id, false));
    assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Msg { text } if text == "p0 recruited the Knight")), "the message");
    assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Boom { k: 9, .. })), "the puff");
}

#[test]
fn wake_comes_before_recruit() {
    use crate::run::effects::Creature;
    let mut run = knight_run();
    let ki = neutral_knight(&mut run, 12.0);
    let near = run.players[0].pos() + Vec2::new(0.0, 10.0);
    move_player(&mut run, 1, near);
    assert!(run.apply_effect(Creature::Player(1), crate::defs::effects::EffectKind::Sleep, Some(30.0)));
    press_e(&mut run, 0);
    run.step();
    assert!(!run.has_effect(Creature::Player(1), crate::defs::effects::EffectKind::Sleep), "the teammate woke");
    assert_eq!(run.monsters[ki].side, Side::Neutral, "the knight waited");
    press_e(&mut run, 0);
    run.step();
    assert_eq!(run.monsters[ki].side, Side::Friendly, "the second E recruits");
}

fn move_player(run: &mut Run, pi: usize, to: Vec2) {
    run.players[pi].mv.x = to.x;
    run.players[pi].mv.y = to.y;
}

#[test]
fn second_recruit_falls_through() {
    use crate::run::objects::{Barrel, ObjState};
    let mut run = knight_run();
    let ki = neutral_knight(&mut run, 12.0);
    let h0 = run.players[0].pos();
    move_player(&mut run, 1, h0 + Vec2::new(0.0, 10.0));
    let h1 = run.players[1].pos();
    let gap = crate::defs::classes::PLAYER_RADIUS + crate::defs::objects::BARREL_RADIUS + 4.0;
    let start = h1 + Vec2::new(-gap, 0.0);
    let id = run.spawn_object(crate::defs::kinds::EntityKind::Barrel, start, ObjState::Barrel(Barrel::new()));
    press_e(&mut run, 0);
    press_e(&mut run, 1);
    run.step();
    assert_eq!(run.monsters[ki].companion.as_ref().unwrap().recruiter, run.players[0].id, "the first hero recruited it");
    for _ in 0..30 {
        run.step();
    }
    let o = run.objects.iter().find(|o| o.id == id).unwrap();
    assert!(o.pos.dist(start) > 4.0, "the second hero's E pushed the barrel");
}

#[test]
fn starting_knight_survives_a_fireball_and_a_barrel() {
    use crate::run::objects::{explode_barrel, Barrel, ObjState};
    let mut run = knight_run();
    let ki = neutral_knight(&mut run, 60.0);
    let (pos, hp) = (run.monsters[ki].pos, run.monsters[ki].max_hp);
    let seq = run.players[0].ack + 1;
    run.players[0].inputs.push_back(crate::protocol::InputMsg { seq, aim: 0.0, aim_dist: 60.0, secondary: Some(1), ..Default::default() });
    run.step();
    assert!(run.projectiles.iter().any(|p| p.kind == crate::defs::kinds::EntityKind::Fireball), "the Wizard cast a Fireball");
    let bid = run.spawn_object(crate::defs::kinds::EntityKind::Barrel, pos + Vec2::new(10.0, 0.0), ObjState::Barrel(Barrel::new()));
    let oi = run.objects.iter().position(|o| o.id == bid).unwrap();
    explode_barrel(&mut run, oi);
    for _ in 0..60 {
        run.step();
    }
    let k = &run.monsters[ki];
    assert!(k.alive && k.hp == hp, "full HP");
    assert!(k.effects.present_kinds().is_empty(), "no effects");
    assert_eq!((k.knock, k.pos), (Vec2::ZERO, pos), "no knock");
}

#[test]
fn monsters_ignore_the_neutral_knight_then_attack_it() {
    use crate::run::entities::Target;
    let mut run = knight_run();
    let (tx, ty) = Map::tile_of(run.players[0].pos());
    for y in ty - 3..=ty + 3 {
        for x in tx - 60..=tx + 8 {
            run.layout.map.set(x, y, crate::dungeon::Tile::Floor);
        }
    }
    // The knight and an orc stand apart from the heroes, out of the orc's sight of them.
    let orc_id = run.spawn_enemy(EnemyType::OrcWarrior, run.players[0].pos() + Vec2::new(-300.0, 0.0), None);
    let oi = run.monster_idx(orc_id).unwrap();
    run.monsters[oi].hp = 1000.0;
    run.monsters[oi].max_hp = 1000.0;
    let vision = run.monsters[oi].sight_now().vision_px();
    let home = run.monsters[oi].pos;
    let ki = neutral_knight(&mut run, -300.0 - 40.0);
    let kid = run.monsters[ki].id;
    let away = home + Vec2::new(-(vision + 100.0), 0.0);
    for p in 0..2 {
        move_player(&mut run, p, away);
    }
    for _ in 0..30 {
        run.step();
        assert_eq!(run.monsters[oi].ai.target, None, "the orc sees only a neutral");
    }
    // Hero 0 recruits it, then stands back where the orc cannot see them.
    let k = run.monsters[ki].pos;
    move_player(&mut run, 0, k + Vec2::new(10.0, 0.0));
    assert!(recruit(&mut run, 0));
    move_player(&mut run, 0, k + Vec2::new(-(vision * 0.9), 0.0));
    move_player(&mut run, 1, k + Vec2::new(-(vision * 0.9), 10.0));
    crate::run::tests::face(&mut run, oi, k);
    let mut targeted = false;
    for _ in 0..30 {
        run.step();
        targeted |= run.monsters[oi].ai.target == Some(Target::Monster(kid));
    }
    assert!(targeted, "the orc attacks the recruited knight");
}

#[test]
fn a_knight_pushed_into_lava_walks_out() {
    use crate::dungeon::Tile;
    let mut run = knight_run();
    let mi = knight_with(&mut run, 0);
    let (tx, ty) = Map::tile_of(run.players[0].pos());
    // A 2x2 pool: A* from inside it finds the floor around it, so `lost` does not rescue the knight.
    for y in ty..=ty + 1 {
        for x in tx + 2..=tx + 3 {
            run.layout.map.set(x, y, Tile::Lava);
        }
    }
    run.monsters[mi].pos = Map::center_of(tx + 2, ty);
    let id = run.monsters[mi].id;
    for _ in 0..180 {
        run.step();
    }
    let k = run.monsters.iter().find(|m| m.id == id).filter(|m| m.alive).expect("it did not burn to death");
    assert!(!run.layout.map.blocks_at(k.pos, k.mover), "it stands on ground again: {:?}", k.pos);
}

#[test]
fn heal_reaches_a_recruited_knight_and_fireball_spares_it() {
    let mut run = knight_run();
    let mi = knight_with(&mut run, 0);
    let hp = run.monsters[mi].max_hp;
    run.monsters[mi].hp = hp / 2.0;
    // Hero 1 (Paladin) casts Holy Light beside the knight.
    let at = run.players[0].pos();
    run.players[1].mv.x = at.x;
    run.players[1].mv.y = at.y;
    let seq = run.players[1].ack + 1;
    run.players[1].inputs.push_back(crate::protocol::InputMsg { seq, secondary: Some(1), ..Default::default() });
    run.step();
    assert!(run.monsters[mi].hp > hp / 2.0, "Holy Light healed the knight: {}", run.monsters[mi].hp);
    // Hero 0 (Wizard) fireballs at the knight.
    let full = run.monsters[mi].max_hp;
    run.monsters[mi].hp = full;
    let kp = run.monsters[mi].pos;
    let d = kp.dist(run.players[0].pos());
    let seq = run.players[0].ack + 1;
    run.players[0].inputs.push_back(crate::protocol::InputMsg { seq, aim: 0.0, aim_dist: d as f32, secondary: Some(1), ..Default::default() });
    for _ in 0..60 {
        run.step();
    }
    assert!(run.monsters[mi].hp >= full, "the Fireball did not hurt the knight");
}

#[test]
fn the_neutral_knight_is_not_nudged_by_a_hostile_overlap() {
    let mut run = knight_run();
    let ki = neutral_knight(&mut run, 40.0);
    let pos = run.monsters[ki].pos;
    let id = run.spawn_enemy(EnemyType::OrcWarrior, pos + Vec2::new(3.0, 0.0), None);
    let oi = run.monster_idx(id).unwrap();
    run.monsters[oi].ai.hold = 1e9;
    run.step();
    assert_eq!(run.monsters[ki].pos, pos, "a Neutral creature stands where it was placed");
}

#[test]
fn a_recruited_knight_is_tagged_as_a_knight() {
    let mut run = knight_run();
    let ki = neutral_knight(&mut run, 12.0);
    let id = run.monsters[ki].id;
    assert!(recruit(&mut run, 0));
    let tag = crate::run::rules_log::tags::tag_of(&run, id);
    assert!(!tag.contains("wolf"), "{tag}");
    assert!(tag.starts_with("Knight"), "{tag}");
}

#[test]
fn a_knight_following_with_no_prey_counts_its_waits_down() {
    let (mut run, mi) = recruited();
    let leader = run.players[1].pos();
    let m = &mut run.monsters[mi];
    m.pos = leader + Vec2::new(10.0, 0.0);
    m.ai.cd = 1.0;
    m.ai.alt_cd = 1.0;
    crate::run::behaviour::tick(&mut run, mi, 1.0 / 60.0, true);
    let m = &run.monsters[mi];
    assert!((m.ai.cd - (1.0 - 1.0 / 60.0)).abs() < 1e-9 && (m.ai.alt_cd - (1.0 - 1.0 / 60.0)).abs() < 1e-9, "{} {}", m.ai.cd, m.ai.alt_cd);
}
