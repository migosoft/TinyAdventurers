use super::record::{LineKind, Seen, Unseen};
use super::send::{LineW, LOG_BYTES_PER_SNAP};
use super::tags::{export_tag_names, tag_name};
use super::text::{n1, pct, type_name};
use super::*;
use crate::collision::line_of_sight;
use super::text;
use crate::dungeon::{Map, Tile};
use crate::protocol::ClientMsg;
use crate::run::effects::Creature;
use crate::run::visibility::{dark_range, send_snapshots, Dark};
use crate::run::RunCmd;
use crate::vispoly::View;
use crate::wire::{encode_snap, BossW, EntW, EvW, LightW, SelfW, SnapW};
use serde::Serialize;
use crate::defs::bosses;
use crate::defs::enemies::{self, EnemyType};
use crate::protocol::{BossId, ClassId};
use crate::run::tests::{test_run, test_run_seed};
use std::collections::BTreeMap;

fn count(run: &Run, kind: EntityKind) -> usize {
    run.monsters.iter().filter(|m| m.kind == kind).count()
}

/// A fresh run whose level setup has a mimic (about one chest in four is one).
fn run_with_a_mimic() -> Run {
    (1..200)
        .map(|seed| test_run_seed(&[ClassId::Wizard], BossId::Demon, seed))
        .find(|r| r.monsters.iter().any(|m| m.kind == EntityKind::Mimic))
        .expect("some seed has a mimic")
}

fn ent(id: u32, kind: EntityKind) -> EntSnap {
    EntSnap(id, kind as u8, 0.0, 0.0, 0, 0, 0.0, 0, 0, 0, 0)
}

#[test]
fn monsters_are_numbered_per_kind_in_spawn_order() {
    let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
    let n = count(&run, EntityKind::GoblinArcher);
    let m = count(&run, EntityKind::OrcWarrior);
    let pos = run.players[0].pos();
    let a = run.spawn_enemy(EnemyType::GoblinArcher, pos, None);
    let b = run.spawn_enemy(EnemyType::GoblinArcher, pos, None);
    let c = run.spawn_enemy(EnemyType::OrcWarrior, pos, None);
    let d = run.spawn_enemy(EnemyType::GoblinArcher, pos, None);
    assert_eq!(tag_of(&run, a), format!("Goblin Archer {}", n + 1));
    assert_eq!(tag_of(&run, b), format!("Goblin Archer {}", n + 2));
    assert_eq!(tag_of(&run, c), format!("Orc Warrior {}", m + 1));
    assert_eq!(tag_of(&run, d), format!("Goblin Archer {}", n + 3));
}

#[test]
fn a_hidden_mimic_is_a_chest_until_revealed() {
    let mut run = run_with_a_mimic();
    let mi = run.monsters.iter().position(|m| m.kind == EntityKind::Mimic).unwrap();
    let id = run.monsters[mi].id;
    let tag = tag_of(&run, id);
    assert!(tag.starts_with("Chest "), "{tag}");
    let sent = snapshot_tags(&run, &[ent(id, EntityKind::Chest)]);
    assert_eq!(sent.len(), 1);
    assert_eq!((sent[0].0, sent[0].1), (id, EntityKind::Chest as u8));
    run.wake_mimic(mi);
    assert_eq!(tag_of(&run, id), "Mimic 1");
    assert_eq!(snapshot_tags(&run, &[ent(id, EntityKind::Mimic)]), vec![(id, EntityKind::Mimic as u8, 1)]);
    run.wake_mimic(mi);
    assert_eq!(tag_of(&run, id), "Mimic 1");
}

#[test]
fn mimics_are_only_spawned_hiding() {
    let mut seen = 0;
    for boss in BossId::ALL {
        for seed in 1..60 {
            let run = test_run_seed(&[ClassId::Wizard], boss, seed);
            for m in run.monsters.iter().filter(|m| m.kind == EntityKind::Mimic) {
                assert!(m.hiding, "mimic {} spawned awake under {boss:?}, seed {seed}", m.id);
                seen += 1;
            }
        }
    }
    assert!(seen > 0, "no seed had a mimic");
}

#[test]
fn heroes_and_the_wolf_go_by_name() {
    let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
    let hero = run.players[0].id;
    let name = run.players[0].name.clone();
    assert_eq!(tag_of(&run, hero), name);
    let wolf = crate::run::companion::spawn_wolf(&mut run, 0);
    assert_eq!(tag_of(&run, wolf), format!("{name}'s wolf"));
    assert!(snapshot_tags(&run, &[ent(wolf, EntityKind::DireWolf), ent(hero, EntityKind::ElvenRanger)]).is_empty());
    assert_eq!(tag_of(&run, 999_999), "something");
}

#[test]
fn every_creature_and_object_kind_has_a_tag_name() {
    for t in EnemyType::ALL {
        assert!(tag_name(enemies::def(t).kind).is_some(), "{t:?}");
    }
    for b in BossId::ALL {
        assert!(tag_name(bosses::def(b).kind).is_some(), "{b:?}");
    }
    assert_eq!(tag_name(EntityKind::Chest), Some("Chest"));
    assert_eq!(tag_name(EntityKind::Barrel), Some("Barrel"));
    assert_eq!(tag_name(EntityKind::Torch), None);
    assert!(export_tag_names().contains("\"Goblin Archer\""));
}

fn walk(dir: &std::path::Path, root: &std::path::Path, out: &mut BTreeMap<String, usize>) {
    for e in std::fs::read_dir(dir).unwrap() {
        let path = e.unwrap().path();
        if path.is_dir() {
            walk(&path, root, out);
        } else if path.extension().is_some_and(|x| x == "rs") {
            let rel = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            if rel.starts_with("run/rules_log/") {
                continue;
            }
            let n = std::fs::read_to_string(&path).unwrap().lines().filter(|l| l.contains("rules_log") || l.contains("RulesLog")).count();
            if n > 0 {
                out.insert(rel, n);
            }
        }
    }
}

#[test]
fn rules_log_is_reached_only_through_its_hooks() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut found = BTreeMap::new();
    walk(&root, &root, &mut found);
    // Lines naming `rules_log` outside the module, per file. Each task updates this with its hooks.
    let hooks: BTreeMap<String, usize> =
        [("run/mod.rs", 18), ("run/effects.rs", 5), ("run/abilities.rs", 12), ("run/levels/boss.rs", 1), ("run/objects.rs", 1), ("run/visibility.rs", 2), ("protocol.rs", 2), ("main.rs", 1), ("wire.rs", 1), ("export.rs", 2)].into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    assert_eq!(found, hooks);
}

#[test]
fn n1_rounds_to_one_decimal_and_drops_dot_zero() {
    assert_eq!(n1(9.0), "9");
    assert_eq!(n1(10.55), "10.6");
    assert_eq!(n1(2.25), "2.3");
    assert_eq!(n1(-0.04), "0");
    assert_eq!(pct(0.2), "20 %");
    assert_eq!(pct(-0.5), "-50 %");
}

/// The ten fields as they were serialized before the log existed.
#[derive(Serialize)]
struct Legacy(u32, u32, Vec<EntW>, SelfW, Option<BossW>, Vec<EvW>, f32, Option<Vec<u32>>, Vec<LightW>, Vec<(u32, u8, u8)>);

fn a_snapw(log: Option<LogW>) -> SnapW {
    let me = SelfW(true, 10.0, 20.0, 1.5, 2.5, 0.0, 0.0, 0.0, 0.0, 0.0, None, None, 0, 9.0, vec![(1, 2.0)], 1.0, false);
    SnapW(7, 3, vec![EntW(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)], me, None, vec![], 0.25, None, vec![LightW(1, 2, 3, None)], vec![(1, 2, 3)], log)
}

#[test]
fn nothing_is_recorded_or_sent_while_off() {
    let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
    assert!(!on(&run));
    // The encoding without the log is the old ten-field array, byte for byte.
    let w = a_snapw(None);
    let old = Legacy(w.0, w.1, w.2.clone(), w.3.clone(), w.4.clone(), w.5.clone(), w.6, w.7.clone(), w.8.clone(), w.9.clone());
    assert_eq!(rmp_serde::to_vec(&w).unwrap(), rmp_serde::to_vec(&old).unwrap());
    let with = rmp_serde::to_vec(&a_snapw(Some(LogW(vec![], vec![])))).unwrap();
    assert_eq!(with[0], 0x9b, "eleven fields with the log");
    // A real tick: a ten-field array, and no record kept.
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    run.players[0].tx = Some(tx);
    run.step();
    send_snapshots(&mut run);
    record::push(&mut run, rec(LineKind::Hit, "x", vec![]));
    assert!(take(&mut run).is_empty(), "off: push keeps nothing");
    let mut bytes = None;
    while let Ok(axum::extract::ws::Message::Binary(b)) = rx.try_recv() {
        bytes = Some(b);
    }
    let bytes = bytes.expect("a snapshot was sent");
    assert_eq!(bytes[0], 0x9a, "fixarray of 10 fields");
    assert_eq!(encode_snap(&crate::wire::sample_snapshots().remove(1))[0], 0x9a);
}

fn rec(kind: LineKind, head: &str, who: Vec<Seen>) -> LogRec {
    LogRec { t: 1.0, kind, head: head.to_string(), details: vec![], who, unseen: None, dealt: None, secs: None }
}

/// Open floor around hero 0 with a wall two tiles east; darkvision makes lit-ness moot.
/// Returns the hero's tile.
fn walled(run: &mut Run) -> (i32, i32) {
    run.players[0].darkvision = Some(1.0);
    run.monsters.retain(|m| m.is_boss);
    let (tx, ty) = Map::tile_of(run.players[0].pos());
    for y in ty - 4..=ty + 4 {
        for x in tx - 7..=tx + 7 {
            run.layout.map.set(x, y, Tile::Floor);
        }
    }
    run.layout.map.set(tx + 2, ty, Tile::Wall);
    run.lights = crate::run::light::Lights::new(run.layout.map.w, run.layout.map.h);
    (tx, ty)
}

fn view_of(run: &mut Run, pi: usize) -> (View, Dark) {
    run.lights.refresh(&run.layout.map);
    let moving = run.moving_lights();
    run.lights.cast_moving(&run.layout.map, &moving);
    let sight = run.players[pi].sight_now();
    let pos = run.players[pi].pos();
    let mut view = View::new(run.layout.map.w, run.layout.map.h);
    view.compute(&run.layout.map, pos, sight.vision.round() as i32);
    (view, Dark { tile: Map::tile_of(pos), range: dark_range(&sight) })
}

fn orc_at(run: &mut Run, tile: (i32, i32)) -> usize {
    let id = run.spawn_enemy(EnemyType::OrcWarrior, Map::center_of(tile.0, tile.1), None);
    run.monster_idx(id).unwrap()
}

#[test]
fn a_line_naming_an_unseen_creature_is_not_sent() {
    let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
    let (tx, ty) = walled(&mut run);
    set_prefs(&mut run, 0, true, true);
    let mi = orc_at(&mut run, (tx + 4, ty));
    let hero = run.players[0].id;
    let (view, dark) = view_of(&mut run, 0);
    let r = rec(LineKind::Hit, "hit", vec![record::seen_creature(&run, Creature::Monster(mi))]);
    let log = for_viewer(&run, 0, hero, &view, &dark, &[], &[r]).unwrap();
    assert!(log.1.is_empty(), "behind the wall");
    run.monsters[mi].pos = Map::center_of(tx + 1, ty);
    let r = rec(LineKind::Hit, "hit", vec![record::seen_creature(&run, Creature::Monster(mi))]);
    let log = for_viewer(&run, 0, hero, &view, &dark, &[], &[r]).unwrap();
    assert_eq!(log.1.len(), 1, "in view");
}

#[test]
fn the_unseen_short_line_goes_only_to_its_viewer() {
    let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin], BossId::Demon);
    let (tx, ty) = walled(&mut run);
    set_prefs(&mut run, 0, true, true);
    set_prefs(&mut run, 1, true, true);
    let (a, b) = (orc_at(&mut run, (tx + 4, ty)), orc_at(&mut run, (tx + 5, ty)));
    let (h0, h1) = (run.players[0].id, run.players[1].id);
    let (view, dark) = view_of(&mut run, 0);
    let mut r = rec(LineKind::Hit, "Orc Warrior 1 hits Orc Warrior 2", vec![record::seen_creature(&run, Creature::Monster(a)), record::seen_creature(&run, Creature::Monster(b))]);
    r.unseen = Some(Unseen { viewer: h0, head: "Something hits you".into(), details: vec![] });
    let got = for_viewer(&run, 0, h0, &view, &dark, &[], &[r.clone()]).unwrap();
    assert_eq!(got.1.len(), 1);
    assert_eq!(got.1[0].2, "Something hits you");
    // Hero 1 sees neither creature either, and is not the line's viewer.
    let got = for_viewer(&run, 1, h1, &view, &dark, &[], &[r.clone()]).unwrap();
    assert!(got.1.is_empty());
    // A spectator watching hero 0 gets what hero 0 gets.
    let got = for_viewer(&run, 1, h0, &view, &dark, &[], &[r]).unwrap();
    assert_eq!(got.1.len(), 1);
}

#[test]
fn party_members_are_always_seen() {
    let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin], BossId::Demon);
    walled(&mut run);
    set_prefs(&mut run, 0, true, true);
    run.players[1].mv.x += 3000.0;
    let h0 = run.players[0].id;
    let (view, dark) = view_of(&mut run, 0);
    let r = rec(LineKind::Heal, "heals", vec![record::seen_creature(&run, Creature::Player(1))]);
    assert_eq!(for_viewer(&run, 0, h0, &view, &dark, &[], &[r]).unwrap().1.len(), 1, "far away, but in the party");
}

#[test]
fn details_off_sends_headlines_only() {
    let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
    walled(&mut run);
    let h0 = run.players[0].id;
    let (view, dark) = view_of(&mut run, 0);
    let mut r = rec(LineKind::Hit, "head", vec![]);
    r.details = vec!["step 1".into(), "step 2".into()];
    set_prefs(&mut run, 0, true, false);
    let got = for_viewer(&run, 0, h0, &view, &dark, &[], &[r.clone()]).unwrap();
    assert_eq!((got.1[0].2.as_str(), got.1[0].3.len()), ("head", 0));
    set_prefs(&mut run, 0, true, true);
    let got = for_viewer(&run, 0, h0, &view, &dark, &[], &[r]).unwrap();
    assert_eq!(got.1[0].3, vec!["step 1".to_string(), "step 2".to_string()]);
    set_prefs(&mut run, 0, false, true);
    assert!(for_viewer(&run, 0, h0, &view, &dark, &[], &[]).is_none(), "off: no field at all");
}

#[test]
fn the_log_is_capped_per_snapshot() {
    let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
    walled(&mut run);
    set_prefs(&mut run, 0, true, true);
    let h0 = run.players[0].id;
    let (view, dark) = view_of(&mut run, 0);
    let recs: Vec<LogRec> = (0..200).map(|_| rec(LineKind::Hit, &"x".repeat(100), vec![])).collect();
    let got = for_viewer(&run, 0, h0, &view, &dark, &[], &recs).unwrap();
    let (real, note) = got.1.split_at(got.1.len() - 1);
    let bytes: usize = real.iter().map(|l: &LineW| l.2.len() + l.3.iter().map(String::len).sum::<usize>()).sum();
    assert!(bytes <= LOG_BYTES_PER_SNAP, "{bytes}");
    assert_eq!(real.len(), 40);
    assert_eq!(note[0].1, LineKind::Note as u8);
    assert_eq!(note[0].2, "… 160 more records (log limit)");
    // What is counted is records, not their detail lines.
    let recs: Vec<LogRec> = (0..200).map(|_| LogRec { details: vec!["d".repeat(100); 3], ..rec(LineKind::Hit, "head", vec![]) }).collect();
    let got = for_viewer(&run, 0, h0, &view, &dark, &[], &recs).unwrap();
    let kept = got.1.len() - 1;
    assert_eq!(got.1[kept].2, format!("… {} more records (log limit)", 200 - kept));
}

#[test]
fn the_log_message_turns_recording_on() {
    let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
    assert!(!on(&run));
    run.handle(RunCmd::Msg { conn: 1, msg: ClientMsg::RulesLog { on: true, details: false } });
    assert!(on(&run));
    assert_eq!(on_for(&run, run.players[0].id), Some(LogPrefs { on: true, details: false }));
    record::push(&mut run, rec(LineKind::Hit, "x", vec![]));
    assert_eq!(take(&mut run).len(), 1);
    run.handle(RunCmd::Msg { conn: 1, msg: ClientMsg::RulesLog { on: false, details: false } });
    assert!(!on(&run));
}

#[test]
fn leaving_forgets_the_player() {
    let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin], BossId::Demon);
    run.handle(RunCmd::Msg { conn: 2, msg: ClientMsg::RulesLog { on: true, details: true } });
    assert!(on(&run));
    run.handle(RunCmd::Leave { conn: 2 });
    assert!(!on(&run));
}

// ---- Damage records (Task 4) ----

use crate::defs::abilities::AbilityId;
use crate::defs::attributes::Attributes;
use crate::defs::damage::{resolve, Damage, DamageSplit, DamageType, Mult, What, MIN_RESISTANCE};
use crate::defs::items::Equipment;
use crate::defs::loadout::{Build, Loadout, Pick, Source};

/// A wizard with `id` as primary and `extra` Attribute points, on open floor, alone with the boss.
fn wizard_with(id: AbilityId, extra: Attributes) -> Run {
    let start = Loadout::start(ClassId::Wizard);
    let loadout = Loadout { primary: Pick { ability: id, source: Source::Own }, ..start };
    let build = Build { own: vec![id], loadout, extra, equipment: Equipment::starter(ClassId::Wizard), ..Build::start(ClassId::Wizard) };
    let mut run = crate::run::tests::test_run_with(&[(ClassId::Wizard, build)], BossId::Demon);
    let (tx, ty) = Map::tile_of(run.players[0].pos());
    for y in ty - 3..=ty + 3 {
        for x in tx - 2..=tx + 14 {
            run.layout.map.set(x, y, Tile::Floor);
        }
    }
    run.monsters.retain(|m| m.is_boss || m.owner.is_some());
    run.players[0].aim = 0.0;
    run.log.forced = true;
    run
}

fn goblin_near(run: &mut Run, hp: Option<f64>) -> usize {
    let pos = run.players[0].pos() + crate::math::Vec2::new(60.0, 0.0);
    let id = run.spawn_enemy(EnemyType::GoblinArcher, pos, None);
    let mi = run.monster_idx(id).unwrap();
    if let Some(hp) = hp {
        run.monsters[mi].hp = hp;
        run.monsters[mi].max_hp = hp;
    }
    mi
}

fn only_rec(run: &mut Run) -> LogRec {
    let mut recs = take(run);
    assert_eq!(recs.len(), 1, "{:?}", recs.iter().map(|r| &r.head).collect::<Vec<_>>());
    recs.remove(0)
}

fn fly(run: &mut Run) {
    for _ in 0..240 {
        crate::run::abilities::tick_projectiles(run, 1.0 / 60.0);
        run.projectiles.retain(|p| !p.dead);
        if run.projectiles.is_empty() {
            break;
        }
    }
}

#[test]
fn the_logged_damage_is_the_damage_dealt() {
    // One monster hit per case, hand-built the way each rule builds it; the record says what was lost.
    let hero_id = |run: &Run| run.players[0].id;
    let cases: Vec<(&str, Box<dyn Fn(&Run, u32) -> Damage>, EnemyType)> = vec![
        ("flank", Box::new(|run, _| Damage { amount: 14.0, ..Damage::physical(7.0) }.by(hero_id(run), What::Ability(AbilityId::FlankingThrust)).with_mult(Mult::Behind(2.0))), EnemyType::GoblinArcher),
        ("chain", Box::new(|run, _| Damage::new(9.3, DamageSplit::pure(DamageType::Magical)).by(hero_id(run), What::Ability(AbilityId::ChainSpark)).with_mult(Mult::Chain { jump: 2, factor: 0.64 })), EnemyType::GoblinArcher),
        ("overkill", Box::new(|run, other| Damage::physical(6.7).by(hero_id(run), What::Ability(AbilityId::MagicMissile)).with_mult(Mult::Overkill { from: other })), EnemyType::GoblinArcher),
        ("coat", Box::new(|run, _| Damage::new(8.1, DamageSplit::split(&[(DamageType::Poison, 0.3)])).by(hero_id(run), What::Ability(AbilityId::PoisonCoat)).with_mult(Mult::Coat(0.3))), EnemyType::GoblinArcher),
        ("fire on an imp", Box::new(|run, _| Damage::new(11.0, DamageSplit::pure(DamageType::Heat)).by(hero_id(run), What::Ability(AbilityId::Fireball))), EnemyType::Imp),
    ];
    for (name, make, etype) in cases {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.log.forced = true;
        run.monsters.retain(|m| m.is_boss);
        let pos = run.players[0].pos() + crate::math::Vec2::new(60.0, 0.0);
        let id = run.spawn_enemy(etype, pos, None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].hp = 1000.0;
        run.monsters[mi].max_hp = 1000.0;
        let _ = take(&mut run);
        let dmg = make(&run, id);
        let credited = run.players[0].damage;
        run.hurt_monster(mi, dmg, false, Some(0));
        let rec = only_rec(&mut run);
        let dealt = rec.dealt.unwrap();
        assert_eq!(dealt, run.players[0].damage - credited, "{name}: the value the rule credited");
        assert!((dealt - (1000.0 - run.monsters[mi].hp)).abs() < 1e-9, "{name}: the HP lost");
        assert!(rec.head.contains(&n1(dealt)), "{name}: {}", rec.head);
    }
    // An orc's melee on the Paladin: armor.
    let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
    run.log.forced = true;
    run.monsters.retain(|m| m.is_boss);
    let at = run.players[0].pos();
    let id = run.spawn_enemy(EnemyType::OrcWarrior, at - crate::math::Vec2::new(16.0, 0.0), None);
    let gi = run.monster_idx(id).unwrap();
    let attack = enemies::def(EnemyType::OrcWarrior).attack;
    run.players[0].sheet.armor = 0.25; // armor comes from items; the starter has none
    let _ = take(&mut run);
    let hp = run.players[0].hp;
    crate::run::ai::perform_attack(&mut run, gi, Creature::Player(0), attack, false, None);
    let rec = only_rec(&mut run);
    assert!(run.players[0].sheet.armor > 0.0);
    assert_eq!(rec.dealt, Some(hp - run.players[0].hp), "bit-equal to the HP lost");
    assert!(rec.head.contains(&n1(rec.dealt.unwrap())), "{}", rec.head);
    assert!(rec.details.last().unwrap().starts_with("armor "), "{:?}", rec.details);
    assert_eq!(rec.unseen.as_ref().map(|u| u.viewer), Some(run.players[0].id));
}

#[test]
fn a_frost_shard_line_reads_like_the_spec() {
    // Wizard at INT 16 against a fresh goblin.
    let probe = wizard_with(AbilityId::FrostShard, Attributes::default());
    let have = probe.players[0].sheet.primary.base.scale.expect("scaled by an Attribute").have;
    let mut run = wizard_with(AbilityId::FrostShard, Attributes::new(0, 0, 0, 16 - have, 0, 0));
    let mi = goblin_near(&mut run, None);
    let goblin = tag_of(&run, run.monsters[mi].id);
    let hp0 = run.monsters[mi].hp;
    let res = run.monsters[mi].effects.res(run.monsters[mi].res);
    let a = run.players[0].sheet.primary;
    let b = a.base;
    let s = b.scale.unwrap();
    assert_eq!(s.have, 16);
    crate::run::abilities::try_use(&mut run, 0, true, 1);
    let _ = take(&mut run);
    fly(&mut run);
    let rec = only_rec(&mut run);
    let dealt = resolve(&Damage::new(a.damage, a.split), &res).min(hp0);
    let after = (hp0 - resolve(&Damage::new(a.damage, a.split), &res)).max(0.0);
    let name = run.players[0].name.clone();
    // The shard also chills (Task 5): the effect rides on the hit, as a suffix and a last detail.
    assert_eq!(rec.head, format!("{name} ▸ Frost Shard ▸ {goblin}: {} damage (HP {} → {}) · Chilled", n1(dealt), n1(hp0), n1(after)));
    let mut want = vec![format!("base {} (given at INT {}), your INT {}: ×{:.2} → {}", n1(b.given), s.at, s.have, s.ratio, n1(b.given * s.ratio))];
    let mut v = b.given * s.ratio;
    if b.ability_mult != 1.0 {
        v *= b.ability_mult;
        want.push(format!("Frost Shard ×{:.2} → {}", b.ability_mult, n1(v)));
    }
    if b.mods_mult != 1.0 {
        v = (v * b.mods_mult).max(0.0);
        want.push(format!("items ×{:.2} → {}", b.mods_mult, n1(v)));
    }
    if b.upgrade_mult != 1.0 {
        want.push(format!("upgrades ×{:.2} → {}", b.upgrade_mult, n1(b.amount())));
    }
    for t in DamageType::ALL {
        let share = a.split.share(t);
        if share > 0.0 {
            let r = res.get(t).max(MIN_RESISTANCE);
            want.push(format!("{} {}  {} × (1 − {} resist) = {}", type_name(t), pct(share), n1(a.damage * share), pct(r), n1(a.damage * share * (1.0 - r))));
        }
    }
    assert!(rec.details.last().unwrap().starts_with("Chilled: applied"), "{:?}", rec.details);
    assert_eq!(rec.details[..rec.details.len() - 1], want);
    assert_eq!(rec.kind, LineKind::Hit);
    println!("{}\n  {}", rec.head, rec.details.join("\n  "));
}

#[test]
fn an_immune_hit_says_so() {
    let mut run = wizard_with(AbilityId::MagicMissile, Attributes::default());
    let mi = goblin_near(&mut run, Some(50.0));
    run.monsters[mi].res.set(DamageType::Physical, 1.0);
    let hero = run.players[0].id;
    let goblin = tag_of(&run, run.monsters[mi].id);
    let name = run.players[0].name.clone();
    run.hurt_monster(mi, Damage::physical(5.0).by(hero, What::Attack), false, Some(0));
    let rec = only_rec(&mut run);
    assert_eq!(rec.head, format!("{name} ▸ attack ▸ {goblin}: no damage (immune)"));
    assert_eq!(rec.dealt, Some(0.0));
    // Over 100 %: it heals.
    run.monsters[mi].res.set(DamageType::Physical, 1.5);
    run.monsters[mi].hp = 40.0;
    run.hurt_monster(mi, Damage::physical(10.0).by(hero, What::Attack), false, Some(0));
    let rec = only_rec(&mut run);
    assert_eq!(rec.head, format!("{name} ▸ attack ▸ {goblin}: healed 5 (resistance over 100 %)"));
    assert_eq!(rec.kind, LineKind::Heal);
}

#[test]
fn the_shielded_boss_says_so() {
    let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
    run.log.forced = true;
    let bi = run.monsters.iter().position(|m| m.is_boss).unwrap();
    let hero = run.players[0].id;
    let boss = tag_of(&run, run.monsters[bi].id);
    let name = run.players[0].name.clone();
    let hp = run.monsters[bi].hp;
    let _ = take(&mut run);
    assert!(!run.hurt_monster(bi, Damage::physical(100.0).by(hero, What::Attack), false, Some(0)));
    let rec = only_rec(&mut run);
    assert_eq!(rec.head, format!("{name} ▸ attack ▸ {boss}: no damage ({boss} cannot be hurt now)"));
    assert_eq!(run.monsters[bi].hp, hp);
}

#[test]
fn damage_from_an_unseen_attacker_gives_the_short_line() {
    let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin], BossId::Demon);
    let (tx, ty) = walled(&mut run);
    set_prefs(&mut run, 0, true, true);
    set_prefs(&mut run, 1, true, true);
    // Put the Paladin (armor) in the hit's place so there is an armor line.
    let archer = run.spawn_enemy(EnemyType::GoblinArcher, Map::center_of(tx + 4, ty), None);
    let (h0, h1) = (run.players[0].id, run.players[1].id);
    let _ = take(&mut run);
    let hp = run.players[0].hp;
    run.hurt_player(0, Damage::physical(6.0).by(archer, What::Attack));
    let recs = take(&mut run);
    assert_eq!(recs.len(), 1);
    let dealt = hp - run.players[0].hp;
    let (view, dark) = view_of(&mut run, 0);
    let got = for_viewer(&run, 0, h0, &view, &dark, &[], &recs).unwrap();
    assert_eq!(got.1.len(), 1);
    let name = run.players[0].name.clone();
    assert_eq!(got.1[0].2, format!("{name} took {} from something unseen", n1(dealt)));
    let shown: Vec<&String> = std::iter::once(&got.1[0].2).chain(got.1[0].3.iter()).collect();
    assert!(shown.iter().all(|l| !l.contains("Goblin") && !l.contains("attack")), "{shown:?}");
    assert_eq!(got.1[0].3.len(), recs[0].unseen.as_ref().unwrap().details.len());
    assert!(got.1[0].3[0].starts_with("physical 100 %"), "{:?}", got.1[0].3);
    let got = for_viewer(&run, 1, h1, &view, &dark, &[], &recs).unwrap();
    assert!(got.1.is_empty(), "hero 1 sees nothing");
}

#[test]
fn a_hit_that_sets_off_another_files_both_in_order() {
    // Two hits opened one inside the other, as a kill that sets off a blast would: the outer one is filed first.
    let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
    run.log.forced = true;
    let hero = run.players[0].id;
    let (mi, mj) = (goblin_near(&mut run, Some(100.0)), goblin_near(&mut run, Some(100.0)));
    let res = run.monsters[mi].res;
    let facts = |run: &Run, mi: usize, amount: f64| {
        let dmg = Damage::physical(amount).by(hero, What::Attack);
        let parts = crate::defs::damage::resolve_parts(&dmg, &res);
        let hp = run.monsters[mi].hp;
        HitFacts { target: Creature::Monster(mi), dmg, res, parts, armor: 0.0, hp_before: hp, hp_after: hp - amount, dealt: amount, taken: amount, outcome: HitOutcome::Dealt }
    };
    let _ = take(&mut run);
    let (f1, f2) = (facts(&run, mi, 1.0), facts(&run, mj, 2.0));
    hit_begin(&mut run, f1);
    hit_begin(&mut run, f2);
    hit_end(&mut run);
    hit_end(&mut run);
    let recs = take(&mut run);
    assert_eq!(recs.iter().map(|r| r.dealt).collect::<Vec<_>>(), vec![Some(1.0), Some(2.0)]);
    assert!(run.log.open.is_empty());
}

#[test]
fn the_damage_text_is_exhaustive_and_plain() {
    assert_eq!(text::what(What::Unknown), "something");
    assert_eq!(text::what(What::Hazard(EntityKind::HolyGround)), "Holy Ground");
    assert_eq!(text::what(What::Hazard(EntityKind::FirePatch)), "fire");
    assert_eq!(text::what(What::Hazard(EntityKind::Torch)), "hazard");
    assert_eq!(text::what(What::Ability(AbilityId::FrostShard)), "Frost Shard");
    assert_eq!(text::what(What::Tick(crate::defs::effects::EffectKind::Burning)), "Burning");
}

// ---- Task 5: effect outcomes ----

use crate::defs::effects::{EffectKind, EffectLook, OnHit};
use crate::run::effects::{Apply, EffectOutcome};

fn timer(run: &Run, c: Creature, k: EffectKind) -> Option<f64> {
    let fx = match c {
        Creature::Player(i) => &run.players[i].effects,
        Creature::Monster(i) => &run.monsters[i].effects,
    };
    fx.list().iter().find(|a| a.kind == k).map(|a| a.left)
}

fn all_text(r: &LogRec) -> String {
    format!("{}\n{}", r.head, r.details.join("\n"))
}

/// A Barbarian alone with the boss, on open floor, with `id` as secondary and `extra` Attribute points.
fn hero_secondary(class: ClassId, id: AbilityId, extra: Attributes) -> Run {
    let start = Loadout::start(class);
    let loadout = Loadout { secondary: Pick { ability: id, source: Source::Own }, ..start };
    let build = Build { own: vec![id], loadout, extra, equipment: Equipment::starter(class), ..Build::start(class) };
    let mut run = crate::run::tests::test_run_with(&[(class, build)], BossId::Demon);
    let (tx, ty) = Map::tile_of(run.players[0].pos());
    for y in ty - 3..=ty + 3 {
        for x in tx - 2..=tx + 14 {
            run.layout.map.set(x, y, Tile::Floor);
        }
    }
    run.monsters.retain(|m| m.is_boss || m.owner.is_some());
    run.players[0].aim = 0.0;
    run.log.forced = true;
    run
}

fn enemy_near(run: &mut Run, t: EnemyType) -> usize {
    let pos = run.players[0].pos() + crate::math::Vec2::new(60.0, 0.0);
    let id = run.spawn_enemy(t, pos, None);
    run.monster_idx(id).unwrap()
}

fn burn(power: i32) -> Apply {
    Apply { power: Some(power), ..Apply::plain(EffectKind::Burning, None) }
}

#[test]
fn the_logged_duration_is_the_duration_applied() {
    // Fireball's Burning on a skeleton (a standalone application).
    let mut run = wizard_with(AbilityId::MagicMissile, Attributes::default());
    let si = enemy_near(&mut run, EnemyType::SkeletonWarrior);
    let c = Creature::Monster(si);
    let _ = take(&mut run);
    assert!(run.apply(c, burn(14)));
    let rec = only_rec(&mut run);
    let left = timer(&run, c, EffectKind::Burning).unwrap();
    assert_eq!(rec.secs, Some(left), "bit-equal");
    assert!(all_text(&rec).contains(&format!("= {} s", n1(left))), "{}", all_text(&rec));
    // The Duration the rule itself returns is the same number, bit for bit (a twin skeleton, same application).
    let twin = Creature::Monster(enemy_near(&mut run, EnemyType::SkeletonWarrior));
    let (outcome, d, _) = run.apply_traced(twin, burn(14));
    assert_eq!(outcome, EffectOutcome::Added);
    assert_eq!(d.secs.to_bits(), timer(&run, twin, EffectKind::Burning).unwrap().to_bits(), "the Duration is the timer");
    assert_eq!(d.secs.to_bits(), left.to_bits(), "and what the log states");
    println!("{}\n  {}", rec.head, rec.details.join("\n  "));
    // Frost Nova's Frozen on a goblin: the effect rides on the nova's hit.
    let mut run = hero_secondary(ClassId::Wizard, AbilityId::FrostNova, Attributes::new(0, 0, 0, 4, 0, 0));
    let gi = goblin_near(&mut run, Some(500.0));
    run.monsters[gi].pos = run.players[0].pos() + crate::math::Vec2::new(20.0, 0.0);
    let _ = take(&mut run);
    crate::run::abilities::try_use(&mut run, 0, false, 1);
    let recs = take(&mut run);
    let hit = recs.iter().find(|r| r.kind == LineKind::Hit).expect("the nova's hit");
    assert!(recs.iter().all(|r| r.kind != LineKind::Effect));
    let left = timer(&run, Creature::Monster(gi), EffectKind::Frozen).expect("frozen");
    assert_eq!(hit.secs, Some(left), "bit-equal");
    assert!(all_text(hit).contains(&n1(left)), "{}", all_text(hit));
    // The lich's Sleep on a hero.
    let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
    run.log.forced = true;
    let _ = take(&mut run);
    let sleep = OnHit { kind: EffectKind::Sleep, secs: 2.0, magical: true, power: 22, look: EffectLook::Plain };
    run.hit_effect(Creature::Player(0), sleep);
    let rec = only_rec(&mut run);
    let left = timer(&run, Creature::Player(0), EffectKind::Sleep).unwrap();
    assert_eq!(rec.secs, Some(left));
    assert!(all_text(&rec).contains(&format!("2 s × (1 + (power 22 − WIL {}) / 20) = {} s", run.players[0].sheet.attrs.get(crate::defs::attributes::Attr::Wil), n1(left))), "{}", all_text(&rec));
    println!("{}\n  {}", rec.head, rec.details.join("\n  "));
}

#[test]
fn fear_on_a_skeleton_is_refused_by_its_undead_resistance() {
    let mut run = hero_secondary(ClassId::Barbarian, AbilityId::WarCry, Attributes::new(1, 0, 0, 0, 0, 0));
    let si = enemy_near(&mut run, EnemyType::SkeletonWarrior);
    run.monsters[si].pos = run.players[0].pos() + crate::math::Vec2::new(30.0, 0.0);
    let skeleton = tag_of(&run, run.monsters[si].id);
    let name = run.players[0].name.clone();
    let _ = take(&mut run);
    crate::run::abilities::try_use(&mut run, 0, false, 1);
    let recs: Vec<LogRec> = take(&mut run).into_iter().filter(|r| r.kind == LineKind::Effect).collect();
    let fear: Vec<&LogRec> = recs.iter().filter(|r| r.head.contains(&skeleton)).collect();
    assert_eq!(fear.len(), 1, "{:?}", recs.iter().map(|r| &r.head).collect::<Vec<_>>());
    assert_eq!(fear[0].head, format!("{name} ▸ War Cry ▸ {skeleton}: Fear refused"));
    assert!(fear[0].details.iter().any(|l| l.contains("undead resist Fear 100 %")), "{:?}", fear[0].details);
    assert!(!run.has_effect(Creature::Monster(si), EffectKind::Fear));
    println!("{}\n  {}", fear[0].head, fear[0].details.join("\n  "));
}

#[test]
fn each_refusal_names_its_rule() {
    let mut run = wizard_with(AbilityId::MagicMissile, Attributes::default());
    let gi = goblin_near(&mut run, Some(500.0));
    let c = Creature::Monster(gi);
    let one = |run: &mut Run, a: Apply| {
        let _ = take(run);
        let r = run.apply(c, a);
        (r, only_rec(run))
    };
    let said = |rec: &LogRec, s: &str| assert!(rec.details.iter().any(|l| l.contains(s)), "want {s:?} in {:?}", rec.details);
    // StrongerOn: Chilled while Frozen.
    run.apply_effect_from(c, EffectKind::Frozen, None, 14, true);
    let (r, rec) = one(&mut run, Apply { power: Some(14), ..Apply::plain(EffectKind::Chilled, None) });
    assert!(!r);
    said(&rec, "Chilled: refused (Frozen is on)");
    assert!(rec.head.ends_with(": Chilled refused"), "{}", rec.head);
    // Cancelled: Singed on Frozen.
    let (r, rec) = one(&mut run, Apply { power: Some(14), ..Apply::plain(EffectKind::Singed, None) });
    assert!(!r);
    said(&rec, "Singed: cancelled Frozen");
    assert!(!run.has_effect(c, EffectKind::Frozen));
    // replaced: Frozen over Chilled.
    run.apply_effect_from(c, EffectKind::Chilled, None, 14, true);
    let (r, rec) = one(&mut run, Apply { power: Some(14), ..Apply::plain(EffectKind::Frozen, None) });
    assert!(r);
    said(&rec, "Frozen: replaced Chilled");
    assert!(!run.has_effect(c, EffectKind::Chilled));
    // SavedToZero: power 10 against CON 40.
    let mut run = wizard_with(AbilityId::MagicMissile, Attributes::default());
    let gi = goblin_near(&mut run, Some(500.0));
    let c = Creature::Monster(gi);
    run.monsters[gi].attrs = Attributes::new(10, 10, 40, 10, 10, 10);
    let _ = take(&mut run);
    assert!(!run.apply(c, burn(10)));
    let rec = only_rec(&mut run);
    said(&rec, "Burning: refused (saved down to 0 s: power 10 − CON 40)");
    println!("{}\n  {}", rec.head, rec.details.join("\n  "));
    // TypeImmune: Burning on heat resistance 1.
    run.monsters[gi].attrs = Attributes::new(10, 10, 10, 10, 10, 10);
    run.monsters[gi].res.set(DamageType::Heat, 1.0);
    let _ = take(&mut run);
    assert!(!run.apply(c, burn(10)));
    said(&only_rec(&mut run), "Burning: refused (immune to heat)");
    // InWater: Burning in shallow water.
    run.monsters[gi].res.set(DamageType::Heat, 0.0);
    let (tx, ty) = Map::tile_of(run.monsters[gi].pos);
    run.layout.map.set(tx, ty, Tile::ShallowWater);
    let _ = take(&mut run);
    assert!(!run.apply(c, burn(10)));
    said(&only_rec(&mut run), "Burning: refused (in water)");
    // A hero's race: the elf is immune to Sleep.
    let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
    run.log.forced = true;
    let _ = take(&mut run);
    run.hit_effect(Creature::Player(0), OnHit { kind: EffectKind::Sleep, secs: 2.0, magical: true, power: 22, look: EffectLook::Plain });
    said(&only_rec(&mut run), "elf resist Sleep 100 %");
    // Dead targets give no line.
    let mut run = wizard_with(AbilityId::MagicMissile, Attributes::default());
    let gi = goblin_near(&mut run, Some(500.0));
    run.monsters[gi].alive = false;
    let _ = take(&mut run);
    assert!(!run.apply(Creature::Monster(gi), burn(10)));
    assert!(take(&mut run).is_empty());
}

#[test]
fn effect_lines_ride_on_their_hit() {
    let mut run = wizard_with(AbilityId::FrostShard, Attributes::default());
    let mi = goblin_near(&mut run, Some(500.0));
    crate::run::abilities::try_use(&mut run, 0, true, 1);
    let _ = take(&mut run);
    fly(&mut run);
    let rec = only_rec(&mut run);
    assert_eq!(rec.kind, LineKind::Hit);
    assert!(rec.head.ends_with(" · Chilled"), "{}", rec.head);
    assert!(rec.details.iter().any(|l| l.starts_with("Chilled: applied")), "{:?}", rec.details);
    let left = timer(&run, Creature::Monster(mi), EffectKind::Chilled).unwrap();
    assert_eq!(rec.secs, Some(left));
    println!("{}\n  {}", rec.head, rec.details.join("\n  "));
}

#[test]
fn an_effect_that_runs_out_says_so() {
    let mut run = wizard_with(AbilityId::MagicMissile, Attributes::default());
    let gi = goblin_near(&mut run, Some(500.0));
    let c = Creature::Monster(gi);
    let goblin = tag_of(&run, run.monsters[gi].id);
    run.apply_effect(c, EffectKind::Slowed, Some(0.5));
    let _ = take(&mut run);
    for _ in 0..40 {
        run.tick_effects();
    }
    assert!(!run.has_effect(c, EffectKind::Slowed));
    let recs = take(&mut run);
    assert_eq!(recs.len(), 1);
    assert_eq!(recs[0].head, format!("Slowed on {goblin} ended"));
    assert_eq!(recs[0].kind, LineKind::Effect);
    // Water puts out fire.
    run.apply(c, burn(10));
    let (tx, ty) = Map::tile_of(run.monsters[gi].pos);
    run.layout.map.set(tx, ty, Tile::ShallowWater);
    let _ = take(&mut run);
    run.tick_effects();
    let recs = take(&mut run);
    assert!(recs.iter().any(|r| r.head == format!("Burning on {goblin} ended (water)")), "{:?}", recs.iter().map(|r| &r.head).collect::<Vec<_>>());
}

#[test]
fn purify_says_what_it_ended() {
    let mut run = hero_secondary(ClassId::Paladin, AbilityId::Purify, Attributes::new(0, 0, 0, 0, 2, 0));
    let name = run.players[0].name.clone();
    run.apply_effect(Creature::Player(0), EffectKind::Blind, Some(5.0));
    let _ = take(&mut run);
    crate::run::abilities::try_use(&mut run, 0, false, 1);
    assert!(!run.has_effect(Creature::Player(0), EffectKind::Blind));
    let recs = take(&mut run);
    let heads: Vec<&String> = recs.iter().map(|r| &r.head).collect();
    let ended = heads.iter().position(|h| **h == format!("Blind on {name} ended (Purify)")).unwrap_or_else(|| panic!("{heads:?}"));
    let warded = heads.iter().position(|h| **h == format!("{name} ▸ Purify ▸ {name}: Warded applied")).unwrap_or_else(|| panic!("{heads:?}"));
    assert!(ended < warded);
}

#[test]
fn apply_still_returns_what_it_did() {
    // Each scenario twice: `apply` and `apply_traced` on identical runs.
    let scenario = |n: usize| -> (Run, Creature, Apply) {
        let mut run = wizard_with(AbilityId::MagicMissile, Attributes::default());
        let gi = goblin_near(&mut run, Some(500.0));
        let c = Creature::Monster(gi);
        let mut a = burn(14);
        match n {
            0 => {}
            1 => {
                run.apply(c, burn(14));
            }
            2 => {
                run.apply(c, Apply { power: Some(14), ..Apply::plain(EffectKind::Frozen, None) });
                a = Apply { power: Some(14), ..Apply::plain(EffectKind::Singed, None) };
            }
            3 => {
                run.apply(c, Apply { power: Some(14), ..Apply::plain(EffectKind::Frozen, None) });
                a = Apply { power: Some(14), ..Apply::plain(EffectKind::Chilled, None) };
            }
            4 => run.monsters[gi].attrs = Attributes::new(10, 10, 40, 10, 10, 10),
            5 => run.monsters[gi].res.set(DamageType::Heat, 1.0),
            6 => {
                let (tx, ty) = Map::tile_of(run.monsters[gi].pos);
                run.layout.map.set(tx, ty, Tile::ShallowWater);
            }
            7 => run.monsters[gi].alive = false,
            8 => a = Apply::plain(EffectKind::Sleep, Some(2.0)),
            _ => a = Apply::plain(EffectKind::Slowed, Some(0.0)),
        }
        (run, c, a)
    };
    let mut seen = std::collections::HashSet::new();
    for n in 0..10 {
        let (mut r1, c, a) = scenario(n);
        let (mut r2, _, _) = scenario(n);
        let got = r1.apply(c, a);
        let (outcome, _, _) = r2.apply_traced(c, a);
        assert_eq!(got, matches!(outcome, EffectOutcome::Added | EffectOutcome::Refreshed), "scenario {n}: {outcome:?}");
        let Creature::Monster(i) = c else { unreachable!() };
        assert_eq!(r1.monsters[i].effects.bits(), r2.monsters[i].effects.bits(), "scenario {n}");
        seen.insert(std::mem::discriminant(&outcome));
    }
    assert!(seen.len() >= 6, "the scenarios reach several outcomes: {}", seen.len());
}

fn kinds_of(recs: &[LogRec], kind: LineKind) -> Vec<&LogRec> {
    recs.iter().filter(|r| r.kind == kind).collect()
}

#[test]
fn holy_light_logs_each_heal_with_its_source() {
    let mut run = hero_secondary(ClassId::Paladin, AbilityId::HolyLight, Attributes::default());
    let wolf = crate::run::companion::spawn_wolf(&mut run, 0);
    let wi = run.monster_idx(wolf).unwrap();
    run.players[0].hp = run.players[0].max_hp - 3.0;
    run.monsters[wi].hp = 1.0;
    run.monsters[wi].pos = run.players[0].pos();
    let (hero_before, wolf_before) = (run.players[0].hp, run.monsters[wi].hp);
    let (hero, name) = (run.players[0].id, run.players[0].name.clone());
    let _ = take(&mut run);
    crate::run::abilities::try_use(&mut run, 0, false, 1);
    let recs = take(&mut run);
    let heals = kinds_of(&recs, LineKind::Heal);
    assert_eq!(heals.len(), 2, "{:?}", recs.iter().map(|r| &r.head).collect::<Vec<_>>());
    let after = |hp: f64| n1(hp);
    assert_eq!(heals[0].head, format!("{name} ▸ Holy Light ▸ {name}: healed 3 (HP {} → {})", after(hero_before), after(run.players[0].max_hp)));
    let wolf_tag = tag_of(&run, wolf);
    assert_eq!(heals[1].head, format!("{name} ▸ Holy Light ▸ {wolf_tag}: healed {} (HP {} → {})", n1(run.monsters[wi].hp - wolf_before), n1(wolf_before), n1(run.monsters[wi].hp)));
    assert_eq!(heals[0].who.iter().map(|w| w.id).collect::<Vec<_>>(), vec![hero, hero]);
}

#[test]
fn a_full_hero_gets_no_heal_line() {
    let mut run = hero_secondary(ClassId::Paladin, AbilityId::HolyLight, Attributes::default());
    assert_eq!(run.players[0].hp, run.players[0].max_hp);
    let _ = take(&mut run);
    crate::run::abilities::try_use(&mut run, 0, false, 1);
    assert!(take(&mut run).is_empty());
}

#[test]
fn a_resistance_heal_gets_only_its_hit_record() {
    // Resistance over 100 %: the Healed hit already says it, the heal adds no line of its own.
    let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
    run.log.forced = true;
    run.players[0].hp = 1.0;
    run.players[0].res.set(DamageType::Heat, 1.5);
    let _ = take(&mut run);
    run.hurt_player(0, Damage::new(4.0, DamageSplit::pure(DamageType::Heat)));
    let recs = take(&mut run);
    assert_eq!(recs.len(), 1, "{:?}", recs.iter().map(|r| &r.head).collect::<Vec<_>>());
    assert_eq!(recs[0].kind, LineKind::Heal);
}

#[test]
fn a_kill_names_the_killer() {
    let mut run = wizard_with(AbilityId::MagicMissile, Attributes::default());
    let mi = goblin_near(&mut run, Some(5.0));
    let (hero, name) = (run.players[0].id, run.players[0].name.clone());
    let goblin = tag_of(&run, run.monsters[mi].id);
    let _ = take(&mut run);
    run.hurt_monster(mi, Damage::physical(50.0).by(hero, What::Attack), false, Some(0));
    let recs = take(&mut run);
    assert_eq!(recs.iter().map(|r| r.kind).collect::<Vec<_>>(), vec![LineKind::Hit, LineKind::Death]);
    assert_eq!(recs[1].head, format!("{goblin} died (killed by {name})"));
    assert!(run.log.open.is_empty());
}

#[test]
fn a_death_follows_its_own_hit_even_when_hits_nest() {
    // A hit sets off another before it ends (as a kill that sets off a blast would): both are filed in
    // order, each death right after the hit that caused it.
    let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
    run.log.forced = true;
    let hero = run.players[0].id;
    let (mi, mj) = (goblin_near(&mut run, Some(100.0)), goblin_near(&mut run, Some(100.0)));
    let res = run.monsters[mi].res;
    let facts = |run: &Run, mi: usize| {
        let dmg = Damage::physical(1.0).by(hero, What::Attack);
        let parts = crate::defs::damage::resolve_parts(&dmg, &res);
        let hp = run.monsters[mi].hp;
        HitFacts { target: Creature::Monster(mi), dmg, res, parts, armor: 0.0, hp_before: hp, hp_after: 0.0, dealt: 1.0, taken: 1.0, outcome: HitOutcome::Dealt }
    };
    let death = |mi: usize| DeathFacts { target: Creature::Monster(mi), by: Some(hero), tick: None, credit: None };
    let _ = take(&mut run);
    let (f1, f2) = (facts(&run, mi), facts(&run, mj));
    hit_begin(&mut run, f1);
    death_of(&mut run, death(mi));
    hit_begin(&mut run, f2);
    death_of(&mut run, death(mj));
    hit_end(&mut run);
    hit_end(&mut run);
    let recs = take(&mut run);
    let (a, b) = (tag_of(&run, run.monsters[mi].id), tag_of(&run, run.monsters[mj].id));
    let kinds = recs.iter().map(|r| r.kind).collect::<Vec<_>>();
    assert_eq!(kinds, vec![LineKind::Hit, LineKind::Death, LineKind::Hit, LineKind::Death]);
    assert!(recs[1].head.starts_with(&a) && recs[3].head.starts_with(&b), "{:?}", recs.iter().map(|r| &r.head).collect::<Vec<_>>());
}

fn death_of(run: &mut Run, f: DeathFacts) {
    death(run, f);
}

#[test]
fn a_burn_kill_credits_the_hero() {
    let mut run = wizard_with(AbilityId::MagicMissile, Attributes::default());
    let mi = goblin_near(&mut run, Some(1.0));
    let (hero, name) = (run.players[0].id, run.players[0].name.clone());
    let goblin = tag_of(&run, run.monsters[mi].id);
    run.monsters[mi].last_hit_by = Some(0);
    let _ = take(&mut run);
    let tick = Damage { why: crate::defs::damage::Why { by: Some(hero), what: What::Tick(EffectKind::Burning), ..crate::defs::damage::Why::NONE }, ..Damage::effect_tick(5.0, DamageType::Heat) };
    run.hurt_monster(mi, tick, false, None);
    let recs = take(&mut run);
    let deaths = kinds_of(&recs, LineKind::Death);
    assert_eq!(deaths.len(), 1);
    assert_eq!(deaths[0].head, format!("{goblin} died (Burning; credited to {name})"));
    assert_eq!(run.players[0].kills, 1);
}

#[test]
fn a_hero_death_names_the_killer_or_says_unseen() {
    let mut run = wizard_with(AbilityId::MagicMissile, Attributes::default());
    let mi = goblin_near(&mut run, Some(100.0));
    let (hero, name) = (run.players[0].id, run.players[0].name.clone());
    let goblin_id = run.monsters[mi].id;
    let goblin = tag_of(&run, goblin_id);
    run.players[0].hp = 1.0;
    let _ = take(&mut run);
    run.hurt_player(0, Damage::physical(50.0).by(goblin_id, What::Attack));
    let recs = take(&mut run);
    let deaths = kinds_of(&recs, LineKind::Death);
    assert_eq!(deaths.len(), 1);
    assert_eq!(deaths[0].head, format!("{name} fell (killed by {goblin})"));
    let unseen = deaths[0].unseen.as_ref().expect("a short line for the dead hero");
    assert_eq!((unseen.viewer, unseen.head.as_str()), (hero, format!("{name} fell to something unseen").as_str()));
    assert_eq!(recs.last().unwrap().kind, LineKind::Death, "after its hit");
}

#[test]
fn chain_spark_logs_why_it_did_not_jump() {
    let mut run = wizard_with(AbilityId::ChainSpark, Attributes::new(0, 0, 0, 3, 0, 0));
    let first = goblin_near(&mut run, Some(1000.0));
    let wolf = crate::run::companion::spawn_wolf(&mut run, 0);
    let at = run.monsters[first].pos;
    let wi = run.monster_idx(wolf).unwrap();
    run.monsters[wi].pos = at + crate::math::Vec2::new(0.0, 20.0);
    let (tx, ty) = Map::tile_of(at);
    for x in tx - 1..=tx + 1 {
        run.layout.map.set(x, ty + 1, Tile::Wall);
    }
    let behind = run.spawn_enemy(EnemyType::GoblinArcher, Map::center_of(tx, ty + 2), None);
    let (behind_tag, wolf_tag) = (tag_of(&run, behind), tag_of(&run, wolf));
    let _ = take(&mut run);
    crate::run::abilities::try_use(&mut run, 0, true, 1);
    fly(&mut run);
    let recs = take(&mut run);
    let skips: Vec<&str> = kinds_of(&recs, LineKind::Skip).iter().map(|r| r.head.as_str()).collect();
    assert_eq!(skips.len(), 2, "{skips:?}");
    assert!(skips.contains(&format!("Chain Spark did not jump to {behind_tag}: no line of sight").as_str()), "{skips:?}");
    assert!(skips.contains(&format!("Chain Spark did not jump to {wolf_tag}: an ally").as_str()), "{skips:?}");
}

#[test]
fn a_chain_that_stops_names_what_was_just_out_of_reach() {
    let mut run = wizard_with(AbilityId::ChainSpark, Attributes::new(0, 0, 0, 3, 0, 0));
    let first = goblin_near(&mut run, Some(1000.0));
    let at = run.monsters[first].pos;
    let far = run.spawn_enemy(EnemyType::GoblinArcher, at + crate::math::Vec2::new(0.0, 60.0), None);
    let far_tag = tag_of(&run, far);
    let _ = take(&mut run);
    crate::run::abilities::try_use(&mut run, 0, true, 1);
    fly(&mut run);
    let recs = take(&mut run);
    let skips: Vec<&str> = kinds_of(&recs, LineKind::Skip).iter().map(|r| r.head.as_str()).collect();
    assert_eq!(skips, vec![format!("Chain Spark stopped: {far_tag} is out of reach (60 > 48)").as_str()]);
}

#[test]
fn a_hidden_mimic_is_never_a_skip_line() {
    for (class, id, primary) in [(ClassId::Wizard, AbilityId::FrostNova, false), (ClassId::Barbarian, AbilityId::WarCry, false), (ClassId::Barbarian, AbilityId::WarCry, true)] {
        // In reach and in the open (War Cry skips it), then in reach behind a wall (Nova and Strike would log "no line of sight").
        for walled in [false, true] {
            let mut run = hero_secondary(class, id, Attributes::new(1, 0, 0, 7, 0, 0));
            let mimic = enemy_near(&mut run, EnemyType::Mimic);
            run.monsters[mimic].hiding = true;
            if walled {
                let (tx, ty) = Map::tile_of(run.players[0].pos());
                run.layout.map.set(tx + 1, ty, Tile::Wall);
                run.monsters[mimic].pos = Map::center_of(tx + 1, ty);
            } else {
                run.monsters[mimic].pos = run.players[0].pos() + crate::math::Vec2::new(20.0, 0.0);
            }
            let _ = take(&mut run);
            crate::run::abilities::try_use(&mut run, 0, primary, 1);
            let recs = take(&mut run);
            assert!(kinds_of(&recs, LineKind::Skip).is_empty(), "{id:?} walled {walled}: {:?}", recs.iter().map(|r| &r.head).collect::<Vec<_>>());
        }
    }
}

#[test]
fn a_goblin_hit_on_a_later_jump_has_no_did_not_jump_line() {
    // C is behind a wall from the first target F but in sight of B, the jump after F: it is hit, so no line says otherwise.
    let mut run = wizard_with(AbilityId::ChainSpark, Attributes::new(0, 0, 0, 3, 0, 0));
    let f = goblin_near(&mut run, Some(1000.0));
    let (tx, ty) = Map::tile_of(run.monsters[f].pos);
    run.layout.map.set(tx, ty + 1, Tile::Wall);
    let b = run.spawn_enemy(EnemyType::GoblinArcher, Map::center_of(tx + 2, ty + 1), None);
    let c = run.spawn_enemy(EnemyType::GoblinArcher, Map::center_of(tx + 1, ty + 2), None);
    let (bi, ci) = (run.monster_idx(b).unwrap(), run.monster_idx(c).unwrap());
    let map = &run.layout.map;
    assert!(line_of_sight(map, run.monsters[f].pos, run.monsters[bi].pos), "F sees B");
    assert!(!line_of_sight(map, run.monsters[f].pos, run.monsters[ci].pos), "F does not see C");
    assert!(line_of_sight(map, run.monsters[bi].pos, run.monsters[ci].pos), "B sees C");
    let (hp_b, hp_c) = (run.monsters[bi].hp, run.monsters[ci].hp);
    let _ = take(&mut run);
    crate::run::abilities::try_use(&mut run, 0, true, 1);
    fly(&mut run);
    assert!(run.monsters[bi].hp < hp_b && run.monsters[ci].hp < hp_c, "both jumped to");
    let recs = take(&mut run);
    let skips: Vec<&str> = kinds_of(&recs, LineKind::Skip).iter().map(|r| r.head.as_str()).collect();
    assert!(!skips.iter().any(|h| h.contains("no line of sight")), "{skips:?}");
}

#[test]
fn leaving_forgets_the_too_close_throttle() {
    let mut run = hero_secondary(ClassId::ElvenRanger, AbilityId::Entangle, Attributes::new(0, 0, 0, 0, 0, 10));
    let mi = enemy_near(&mut run, EnemyType::GoblinArcher);
    run.monsters[mi].pos = run.players[0].pos() + crate::math::Vec2::new(10.0, 0.0);
    crate::run::abilities::try_use(&mut run, 0, false, 1);
    assert_eq!(run.log.too_close.len(), 1);
    let id = run.players[0].id;
    forget(&mut run, id);
    assert!(run.log.too_close.is_empty());
}

#[test]
fn a_ring_logs_the_ally_it_passed_over() {
    let mut run = hero_secondary(ClassId::Wizard, AbilityId::FrostNova, Attributes::new(0, 0, 0, 7, 0, 0));
    let wolf = crate::run::companion::spawn_wolf(&mut run, 0);
    let wi = run.monster_idx(wolf).unwrap();
    run.monsters[wi].pos = run.players[0].pos() + crate::math::Vec2::new(0.0, 20.0);
    let wolf_tag = tag_of(&run, wolf);
    let _ = take(&mut run);
    crate::run::abilities::try_use(&mut run, 0, false, 1);
    let recs = take(&mut run);
    let skips: Vec<&str> = kinds_of(&recs, LineKind::Skip).iter().map(|r| r.head.as_str()).collect();
    assert_eq!(skips, vec![format!("Frost Nova did not reach {wolf_tag}: an ally").as_str()]);
}

#[test]
fn too_close_is_logged_once_a_second() {
    // Volley is a ranger's primary: held next to an enemy it strikes instead, and says so once a second.
    let start = Loadout::start(ClassId::ElvenRanger);
    let loadout = Loadout { primary: Pick { ability: AbilityId::Volley, source: Source::Own }, ..start };
    let build = Build { own: vec![AbilityId::Volley], loadout, equipment: Equipment::starter(ClassId::ElvenRanger), ..Build::start(ClassId::ElvenRanger) };
    let mut run = crate::run::tests::test_run_with(&[(ClassId::ElvenRanger, build)], BossId::Demon);
    run.monsters.retain(|m| m.is_boss || m.owner.is_some());
    run.log.forced = true;
    let mi = enemy_near(&mut run, EnemyType::GoblinArcher);
    run.monsters[mi].pos = run.players[0].pos() + crate::math::Vec2::new(10.0, 0.0);
    run.monsters[mi].hp = 1e9;
    run.monsters[mi].max_hp = 1e9;
    let (name, goblin) = (run.players[0].name.clone(), tag_of(&run, run.monsters[mi].id));
    let _ = take(&mut run);
    for _ in 0..120 {
        run.time += crate::run::DT;
        run.players[0].cd1 = 0.0;
        crate::run::abilities::try_use(&mut run, 0, true, 1);
    }
    let recs = take(&mut run);
    let notes = kinds_of(&recs, LineKind::Note);
    assert_eq!(notes.len(), 2, "{:?}", recs.iter().map(|r| &r.head).collect::<Vec<_>>());
    assert_eq!(notes[0].head, format!("{name} ▸ Volley: {goblin} is in melee reach, strikes instead"));
}

#[test]
fn a_blocked_secondary_says_why() {
    let mut run = hero_secondary(ClassId::ElvenRanger, AbilityId::Entangle, Attributes::new(0, 0, 0, 0, 0, 10));
    let mi = enemy_near(&mut run, EnemyType::GoblinArcher);
    run.monsters[mi].pos = run.players[0].pos() + crate::math::Vec2::new(10.0, 0.0);
    let (name, goblin) = (run.players[0].name.clone(), tag_of(&run, run.monsters[mi].id));
    let _ = take(&mut run);
    crate::run::abilities::try_use(&mut run, 0, false, 1);
    let recs = take(&mut run);
    let notes = kinds_of(&recs, LineKind::Note);
    assert_eq!(notes.len(), 1, "{:?}", recs.iter().map(|r| &r.head).collect::<Vec<_>>());
    assert_eq!(notes[0].head, format!("{name} ▸ Entangle: blocked, {goblin} is in melee reach (Too close)"));
}

#[test]
fn a_primary_that_strikes_instead_says_so() {
    let mut run = wizard_with(AbilityId::MagicMissile, Attributes::default());
    let mi = goblin_near(&mut run, Some(1000.0));
    run.monsters[mi].pos = run.players[0].pos() + crate::math::Vec2::new(10.0, 0.0);
    let (name, goblin) = (run.players[0].name.clone(), tag_of(&run, run.monsters[mi].id));
    let _ = take(&mut run);
    crate::run::abilities::try_use(&mut run, 0, true, 1);
    let recs = take(&mut run);
    let notes = kinds_of(&recs, LineKind::Note);
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].head, format!("{name} ▸ Magic Missile: {goblin} is in melee reach, strikes instead"));
}

#[test]
fn a_hidden_mimic_behind_a_wall_is_no_slam_skip_line() {
    let pick = Pick { ability: AbilityId::GroundSlam, source: Source::Own };
    let equipment = Equipment::starter(ClassId::Barbarian).with(crate::defs::items::EquipSlot::Melee, crate::defs::items::ItemId::WarHammer);
    let build = Build { own: vec![AbilityId::GroundSlam], loadout: Loadout { secondary: pick, ..Loadout::start(ClassId::Barbarian) }, extra: Attributes::new(2, 0, 0, 0, 0, 0), equipment, ..Build::start(ClassId::Barbarian) };
    let mut run = crate::run::tests::test_run_with(&[(ClassId::Barbarian, build)], BossId::Demon);
    run.log.forced = true;
    let (tx, ty) = Map::tile_of(run.players[0].pos());
    for y in ty - 3..=ty + 3 {
        for x in tx - 2..=tx + 14 {
            run.layout.map.set(x, y, Tile::Floor);
        }
    }
    run.layout.map.set(tx + 1, ty, Tile::Wall);
    let id = run.spawn_enemy(EnemyType::Mimic, Map::center_of(tx + 1, ty), None);
    let mi = run.monster_idx(id).unwrap();
    run.monsters[mi].hiding = true;
    let _ = take(&mut run);
    crate::run::abilities::land_slam(&mut run, 0);
    let recs = take(&mut run);
    assert!(kinds_of(&recs, LineKind::Skip).is_empty(), "{:?}", recs.iter().map(|r| &r.head).collect::<Vec<_>>());
}

// ---- Leak tests (Task 7) ----

/// What `send_snapshots` would hand each player for the records since the last call:
/// the same view, darkness and entity list, then the same filter.
struct Sent {
    log: LogW,
    ents: Vec<u32>,
}

fn sent_to_all(run: &mut Run) -> Vec<Sent> {
    let records = take(run);
    let mut out = Vec::new();
    for pi in 0..run.players.len() {
        let me = &run.players[pi];
        let viewed = if me.alive { pi } else { me.spectating.and_then(|s| run.players.iter().position(|q| q.id == s)).unwrap_or(pi) };
        let viewed_id = run.players[viewed].id;
        let (view, dark) = view_of(run, viewed);
        let ents = crate::run::visibility::snapshot_ents(run, pi, &view, &dark);
        let log = for_viewer(run, pi, viewed_id, &view, &dark, &ents, &records).expect("log is on");
        out.push(Sent { log, ents: ents.iter().map(|e| e.0).collect() });
    }
    out
}

fn text_of(l: &LineW) -> String {
    format!("{}\n{}", l.2, l.3.join("\n"))
}

/// Does `text` contain `tag` as a whole tag ("Goblin Archer 1" is not in "Goblin Archer 12")?
fn names(text: &str, tag: &str) -> bool {
    text.match_indices(tag).any(|(i, _)| !text[i + tag.len()..].starts_with(|c: char| c.is_ascii_digit()))
}

/// Hero 0 (`class`) fights goblins on open floor; hero 1 stands in a far room of his own.
fn leak_run(class: ClassId, primary: AbilityId, secondary: AbilityId) -> Run {
    let loadout = Loadout { primary: Pick { ability: primary, source: Source::Own }, secondary: Pick { ability: secondary, source: Source::Own } };
    let build = Build { own: vec![primary, secondary], loadout, extra: Attributes::new(1, 0, 0, 7, 0, 7), equipment: Equipment::starter(class), ..Build::start(class) };
    let mut run = crate::run::tests::test_run_with(&[(class, build), (ClassId::Paladin, Build::start(ClassId::Paladin))], BossId::Demon);
    run.monsters.retain(|m| m.is_boss || m.owner.is_some());
    let (tx, ty) = Map::tile_of(run.players[0].pos());
    for y in ty - 4..=ty + 4 {
        for x in tx - 2..=tx + 14 {
            run.layout.map.set(x, y, Tile::Floor);
        }
    }
    // Hero 1: a closed room in the far corner.
    let (w, h) = (run.layout.map.w as i32, run.layout.map.h as i32);
    let (fx, fy) = if tx < w / 2 { (w - 6, h - 6) } else { (5, 5) };
    for y in fy - 2..=fy + 2 {
        for x in fx - 2..=fx + 2 {
            run.layout.map.set(x, y, if x.abs_diff(fx) == 2 || y.abs_diff(fy) == 2 { Tile::Wall } else { Tile::Floor });
        }
    }
    let far = Map::center_of(fx, fy);
    run.players[1].mv.x = far.x;
    run.players[1].mv.y = far.y;
    for pi in 0..2 {
        run.players[pi].max_hp = 1e6;
        run.players[pi].hp = 1e6;
        set_prefs(&mut run, pi, true, true);
    }
    run.players[0].darkvision = Some(0.5);
    run.players[0].aim = 0.0;
    run.lights = crate::run::light::Lights::new(run.layout.map.w, run.layout.map.h);
    run
}

fn spawn_at(run: &mut Run, t: EnemyType, tile: (i32, i32), hp: f64) -> u32 {
    let id = run.spawn_enemy(t, Map::center_of(tile.0, tile.1), None);
    let mi = run.monster_idx(id).unwrap();
    run.monsters[mi].hp = hp;
    run.monsters[mi].max_hp = hp;
    id
}

struct Fight {
    /// Every hero 1 snapshot's lines.
    hero1: Vec<LineW>,
    /// Hero 0's, with the snapshot's entity ids and the ids of monsters alive after the tick.
    hero0: Vec<(LineW, Vec<u32>, Vec<u32>)>,
    /// Every unseen line of every record of the run.
    unseen: Vec<(String, Vec<String>)>,
    dark: u32,
    walled: u32,
    heads: Vec<String>,
    tags: std::collections::HashMap<u32, std::collections::BTreeSet<String>>,
}

fn fight(class: ClassId, primary: AbilityId, secondary: AbilityId, spectate: bool) -> (Run, Fight) {
    let mut run = leak_run(class, primary, secondary);
    if spectate {
        run.players[1].alive = false;
        run.players[1].spectating = Some(run.players[0].id);
    }
    let (tx, ty) = Map::tile_of(run.players[0].pos());
    // F is the chain's first target; W stands behind walls from F and from the hero; D is out in the dark.
    for x in tx + 2..=tx + 3 {
        run.layout.map.set(x, ty + 1, Tile::Wall);
    }
    spawn_at(&mut run, EnemyType::GoblinArcher, (tx + 3, ty), 5000.0);
    let walled = spawn_at(&mut run, EnemyType::GoblinArcher, (tx + 3, ty + 2), 5000.0);
    let dark = spawn_at(&mut run, EnemyType::GoblinArcher, (tx + 10, ty + 3), 5000.0);
    let near: Vec<u32> = [(3, -2, 40.0), (4, -1, 5000.0), (2, -3, 40.0)].iter().map(|&(dx, dy, hp)| spawn_at(&mut run, EnemyType::GoblinArcher, (tx + dx, ty + dy), hp)).collect();
    let hero = run.players[0].id;
    let mut f = Fight { hero1: vec![], hero0: vec![], unseen: vec![], dark, walled, heads: vec![], tags: Default::default() };
    let mut prev_ents: Vec<u32> = vec![];
    for tick in 0..300u32 {
        // Burn a goblin early; it runs out later.
        if tick == 3 {
            let mi = run.monster_idx(near[1]).unwrap();
            let at = run.players[0].pos();
            run.apply(Creature::Monster(mi), Apply { power: Some(2), secs: Some(2.0), source: Some((hero, at)), origin: Some((hero, What::Ability(primary))), ..Apply::plain(EffectKind::Burning, None) });
        }
        if tick % 25 == 5 {
            run.players[0].cd1 = 0.0;
            crate::run::abilities::try_use(&mut run, 0, true, 1);
        }
        if tick % 40 == 10 {
            run.players[0].cd2 = 0.0;
            crate::run::abilities::try_use(&mut run, 0, false, 1);
        }
        if tick == 150 {
            // A kill next to the hero, whatever the abilities did to the others.
            let victim = spawn_at(&mut run, EnemyType::GoblinArcher, (tx + 1, ty - 1), 5.0);
            let vi = run.monster_idx(victim).unwrap();
            run.hurt_monster(vi, Damage::physical(50.0).by(hero, What::Ability(primary)), false, Some(0));
        }
        if tick % 40 == 20 {
            // The goblin in the dark hits hero 0.
            run.hurt_player(0, Damage::physical(6.0).by(dark, What::Attack));
        }
        if tick % 40 == 30 {
            // Hits with a multiplier and with another type: their steps are the attacker's, not hero 0's.
            run.hurt_player(0, Damage { amount: 12.0, ..Damage::physical(6.0) }.by(dark, What::Ability(AbilityId::FlankingThrust)).with_mult(Mult::Behind(2.0)));
            run.hurt_player(0, Damage::new(9.3, DamageSplit::pure(DamageType::Magical)).by(dark, What::Ability(AbilityId::ChainSpark)).with_mult(Mult::Chain { jump: 2, factor: 0.64 }));
        }
        run.step();
        f.heads.extend(run.log.records.iter().map(|r| r.head.clone()));
        for m in &run.monsters {
            f.tags.entry(m.id).or_default().insert(tag_of(&run, m.id));
        }
        for o in &run.objects {
            f.tags.entry(o.id).or_default().insert(tag_of(&run, o.id));
        }
        for r in &run.log.records {
            if let Some(u) = &r.unseen {
                f.unseen.push((u.head.clone(), u.details.clone()));
            }
        }
        let got = sent_to_all(&mut run);
        let mut got = got.into_iter();
        let (g0, g1) = (got.next().unwrap(), got.next().unwrap());
        f.hero1.extend(g1.log.1);
        assert!(spectate || g1.ents.iter().all(|id| !f.tags.contains_key(id)), "hero 1 sees no creature or object: {:?}", g1.ents);
        f.hero0.extend(g0.log.1.into_iter().map(|l| (l, g0.ents.clone(), prev_ents.clone())));
        prev_ents = g0.ents.clone();
    }
    (run, f)
}

#[test]
fn no_line_names_a_creature_its_viewer_cannot_see() {
    for (class, primary, secondary) in [(ClassId::Wizard, AbilityId::ChainSpark, AbilityId::FrostNova), (ClassId::Barbarian, Loadout::start(ClassId::Barbarian).primary.ability, AbilityId::WarCry)] {
        let (run, f) = fight(class, primary, secondary, false);
        // Hero 1 saw nothing of the fight: not one creature tag in any line.
        for l in &f.hero1 {
            for tags in f.tags.values() {
                for t in tags {
                    assert!(!names(&text_of(l), t), "{class:?}: hero 1 got {t}: {}", l.2);
                }
            }
        }
        // Hero 0: every creature tag is of a creature in that snapshot or the one before (one that died in between was seen).
        let mut named = 0;
        for (l, ents, prev) in &f.hero0 {
            for (id, tags) in &f.tags {
                for t in tags.iter().filter(|t| *t != "something") {
                    if names(&text_of(l), t) {
                        assert!(ents.contains(id) || prev.contains(id), "{class:?}: hero 0 got {t} unseen: {}", l.2);
                        named += 1;
                    }
                }
            }
        }
        assert!(named > 5, "{class:?}: the fight reached hero 0 ({named})");
        // The goblin behind the wall and the one in the dark: the game did write lines about them, and hero 0 got
        // those only in snapshots that had the goblin in them.
        let (walled_tag, dark_tag) = (tag_of(&run, f.walled), tag_of(&run, f.dark));
        assert!(f.heads.iter().any(|h| names(h, &walled_tag)), "{class:?}: the game wrote a line about {walled_tag}");
        assert!(f.heads.iter().any(|h| names(h, &dark_tag)), "{class:?}: the game wrote a line about {dark_tag}");
        for (l, ents, _) in &f.hero0 {
            assert!(!names(&text_of(l), &walled_tag) || ents.contains(&f.walled), "{class:?}: {walled_tag}: {}", l.2);
            assert!(!names(&text_of(l), &dark_tag) || ents.contains(&f.dark), "{class:?}: {dark_tag}: {}", l.2);
        }
        // The fight covers every kind of line, and hero 0 got each.
        let all: Vec<String> = f.hero0.iter().map(|(l, _, _)| text_of(l)).collect();
        let got = |what: &str| assert!(all.iter().any(|t| t.contains(what)), "{class:?}: hero 0 never got a line with {what:?}");
        got("died (killed by");
        got("Burning ▸");
        got("Burning on ");
        got("ended");
        got(if secondary == AbilityId::FrostNova { "Frost Nova ▸" } else { "War Cry" });
        if primary == AbilityId::ChainSpark {
            got("Chain Spark jump 1");
        }
        // The walled goblin was out of hero 0's snapshot at least once.
        assert!(f.hero0.iter().any(|(_, ents, _)| !ents.contains(&f.walled)), "{class:?}: walled goblin never hidden");
        // The dark goblin did hit hero 0, and that arrived as a short line.
        assert!(f.hero0.iter().any(|(l, _, _)| l.2.contains("from something unseen")), "{class:?}: unseen hits arrive as short lines");
    }
}

#[test]
fn a_chain_that_stops_names_nothing_its_viewer_cannot_see() {
    let mut run = leak_run(ClassId::Wizard, AbilityId::ChainSpark, AbilityId::FrostNova);
    let (tx, ty) = Map::tile_of(run.players[0].pos());
    let first = spawn_at(&mut run, EnemyType::GoblinArcher, (tx + 3, ty), 5000.0);
    // E is just beyond the spark's reach from F, and far enough from the hero to be in the dark.
    let e = spawn_at(&mut run, EnemyType::GoblinArcher, (tx + 3, ty + 4), 5000.0);
    let (e_tag, f_tag) = (tag_of(&run, e), tag_of(&run, first));
    run.players[0].darkvision = Some(0.5);
    let _ = take(&mut run);
    run.players[0].cd1 = 0.0;
    crate::run::abilities::try_use(&mut run, 0, true, 1);
    fly(&mut run);
    assert!(run.log.records.iter().any(|r| r.head.contains(&format!("stopped: {e_tag} is out of reach"))), "the game wrote the stop line");
    let got = sent_to_all(&mut run);
    assert!(got[0].log.1.iter().any(|l| l.2.contains(&f_tag)), "hero 0 saw the hit on F");
    assert!(!got[0].ents.contains(&e), "E is in the dark");
    for pi in 0..2 {
        assert!(got[pi].log.1.iter().all(|l| !names(&text_of(l), &e_tag)), "hero {pi} was told about {e_tag}");
    }
}

#[test]
fn a_hidden_mimic_is_a_chest_in_every_line() {
    let mut run = run_with_a_mimic();
    run.log.forced = true;
    run.monsters.retain(|m| m.is_boss || m.kind == EntityKind::Mimic);
    let mi = run.monsters.iter().position(|m| m.kind == EntityKind::Mimic).unwrap();
    let (id, hero) = (run.monsters[mi].id, run.players[0].id);
    let chest = tag_of(&run, id);
    assert!(chest.starts_with("Chest "), "{chest}");
    run.monsters[mi].hp = 1000.0;
    run.monsters[mi].max_hp = 1000.0;
    let _ = take(&mut run);
    // The revealing hit, with an effect on it: every line says Chest.
    let burn = Damage { on_hit: Some(OnHit { kind: EffectKind::Burning, secs: 2.0, magical: true, power: 5, look: EffectLook::Plain }), ..Damage::physical(5.0).by(hero, What::Ability(AbilityId::MagicMissile)) };
    run.hurt_monster(mi, burn, false, Some(0));
    assert!(!run.monsters[mi].hiding, "the hit woke it");
    let first = take(&mut run);
    assert!(!first.is_empty());
    assert!(first[0].head.contains(&chest), "{}", first[0].head);
    for r in &first {
        assert!(!all_text(r).contains("Mimic"), "before the reveal: {}", all_text(r));
        assert!(r.unseen.as_ref().map_or(true, |u| !u.head.contains("Mimic")));
    }
    // The next hit, and the kill after it, say Mimic 1.
    run.hurt_monster(mi, Damage::physical(5.0).by(hero, What::Ability(AbilityId::MagicMissile)), false, Some(0));
    let next = take(&mut run);
    assert!(next[0].head.contains("Mimic 1"), "{}", next[0].head);
    assert!(next.iter().all(|r| !all_text(r).contains("Chest")), "{:?}", next.iter().map(all_text).collect::<Vec<_>>());
    run.hurt_monster(mi, Damage::physical(5000.0).by(hero, What::Ability(AbilityId::MagicMissile)), false, Some(0));
    let kill = take(&mut run);
    assert!(kill.iter().any(|r| r.kind == LineKind::Death && r.head.starts_with("Mimic 1 died")), "{:?}", kill.iter().map(|r| &r.head).collect::<Vec<_>>());
}

#[test]
fn a_kill_line_reaches_who_saw_it_die() {
    let mut run = leak_run(ClassId::Wizard, AbilityId::MagicMissile, AbilityId::FrostNova);
    run.players[0].darkvision = Some(1.0);
    let (tx, ty) = Map::tile_of(run.players[0].pos());
    let id = spawn_at(&mut run, EnemyType::GoblinArcher, (tx + 3, ty), 5.0);
    let (mi, hero, tag) = (run.monster_idx(id).unwrap(), run.players[0].id, tag_of(&run, id));
    let name = run.players[0].name.clone();
    let _ = take(&mut run);
    // Seen now; killed on the first tick of the snapshot pair, so it is dead and gone from `ents` at the second.
    assert!(sent_to_all(&mut run)[0].ents.contains(&id));
    run.hurt_monster(mi, Damage::physical(50.0).by(hero, What::Ability(AbilityId::MagicMissile)), false, Some(0));
    assert!(!run.monsters[mi].alive);
    run.step();
    let got = sent_to_all(&mut run);
    assert!(!got[0].ents.contains(&id), "gone from the entity list");
    let heads: Vec<&str> = got[0].log.1.iter().map(|l| l.2.as_str()).collect();
    assert!(heads.iter().any(|h| h.contains(&format!("{name} ▸ Magic Missile ▸ {tag}"))), "{heads:?}");
    assert!(heads.contains(&format!("{tag} died (killed by {name})").as_str()), "{heads:?}");
    assert!(got[1].log.1.is_empty(), "hero 1 saw nothing of it");
    // The kill happened where it could not be seen: nobody is told.
    let dark = spawn_at(&mut run, EnemyType::GoblinArcher, (tx + 12, ty + 3), 5.0);
    run.players[0].darkvision = Some(0.0);
    let (di, dtag) = (run.monster_idx(dark).unwrap(), tag_of(&run, dark));
    let _ = take(&mut run);
    run.hurt_monster(di, Damage::physical(50.0).by(hero, What::Ability(AbilityId::MagicMissile)), false, Some(0));
    assert!(run.log.records.iter().any(|r| r.head.contains(&dtag)), "the game wrote the lines");
    for s in sent_to_all(&mut run) {
        assert!(s.log.1.is_empty(), "{:?}", s.log.1.iter().map(|l| &l.2).collect::<Vec<_>>());
    }
    // A heal between a goblin hero 0 sees and one in the dark, either way round: no line for anyone.
    run.players[0].darkvision = Some(0.3);
    let near = spawn_at(&mut run, EnemyType::GoblinArcher, (tx + 1, ty), 50.0);
    let far = spawn_at(&mut run, EnemyType::GoblinArcher, (tx + 12, ty + 4), 50.0);
    let ents = sent_to_all(&mut run)[0].ents.clone();
    assert!(ents.contains(&near) && !ents.contains(&far));
    for (healer, healed) in [(near, far), (far, near)] {
        let hi = run.monster_idx(healed).unwrap();
        run.monsters[hi].hp = 10.0;
        let _ = take(&mut run);
        run.heal_monster(hi, 20.0, Some((healer, What::Attack)));
        assert!(run.log.records.iter().any(|r| r.kind == LineKind::Heal), "the game wrote a heal line");
        for s in sent_to_all(&mut run) {
            assert!(s.log.1.is_empty(), "{:?}", s.log.1.iter().map(|l| &l.2).collect::<Vec<_>>());
        }
    }
}

#[test]
fn the_unseen_line_carries_no_attacker_data() {
    let mut checked = 0;
    for (class, primary, secondary) in [(ClassId::Wizard, AbilityId::ChainSpark, AbilityId::FrostNova), (ClassId::Barbarian, Loadout::start(ClassId::Barbarian).primary.ability, AbilityId::WarCry)] {
        let (_, f) = fight(class, primary, secondary, false);
        let tags: Vec<&String> = f.tags.values().flatten().filter(|t| *t != "something").collect();
        let kinds: Vec<String> = EntityKind::ALL.iter().flat_map(|&k| [Some(format!("{k:?}")), tag_name(k).map(String::from)]).flatten().collect();
        let words = ["base", "given at", "jump", "behind", "overkill", "Overkill", "coat", "Coat", "Behind", "Chain", "Flank", "attack"];
        let attributes = ["STR", "DEX", "CON", "INT", "WIL", "CHA"];
        for (head, details) in &f.unseen {
            let text = format!("{head}\n{}", details.join("\n"));
            assert!(head.contains("from something unseen"), "{head}");
            for t in &tags {
                assert!(!names(&text, t), "{class:?}: {t} in {text}");
            }
            for k in &kinds {
                assert!(!text.contains(k.as_str()), "{class:?}: {k} in {text}");
            }
            for w in words.iter().chain(attributes.iter()) {
                assert!(!text.contains(w), "{class:?}: {w} in {text}");
            }
            // Only the hero's own side: the amount in and the resistance steps.
            assert!(details.iter().all(|d| d.contains("resist")), "{details:?}");
            checked += 1;
        }
    }
    assert!(checked >= 20, "{checked}");
}

#[test]
fn a_spectator_gets_what_the_spectated_hero_gets() {
    let (_, f) = fight(ClassId::Wizard, AbilityId::ChainSpark, AbilityId::FrostNova, true);
    let key = |l: &LineW| (l.0.to_bits(), l.1, l.2.clone(), l.3.clone());
    let (a, b): (Vec<_>, Vec<_>) = (f.hero0.iter().map(|(l, _, _)| key(l)).collect(), f.hero1.iter().map(key).collect());
    assert!(a.len() > 30, "{}", a.len());
    assert!(a == b, "the spectator's log is the spectated hero's");
    assert!(b.iter().any(|l| l.2.contains("from something unseen")), "the short line too");
}

#[test]
fn an_arrow_from_a_dead_archer_does_not_name_it() {
    for lethal in [false, true] {
    let mut run = leak_run(ClassId::Wizard, AbilityId::ChainSpark, AbilityId::FrostNova);
    run.players[0].darkvision = Some(1.0);
    let (tx, ty) = Map::tile_of(run.players[0].pos());
    let id = spawn_at(&mut run, EnemyType::GoblinArcher, (tx + 8, ty), 50.0);
    let (gi, tag) = (run.monster_idx(id).unwrap(), tag_of(&run, id));
    let attack = enemies::def(EnemyType::GoblinArcher).attack;
    crate::run::ai::perform_attack(&mut run, gi, Creature::Player(0), attack, false, None);
    assert!(sent_to_all(&mut run)[0].ents.contains(&id), "hero 0 sees the archer");
    // The archer dies while its arrow flies (no line for that: it is made dead by hand) and is removed by a step.
    run.monsters[gi].alive = false;
    if lethal {
        run.players[0].hp = 1.0;
    }
    let hp = run.players[0].hp;
    for _ in 0..240 {
        run.step();
        if run.players[0].hp < hp || !run.players[0].alive {
            break;
        }
    }
    assert!(run.players[0].hp < hp || !run.players[0].alive, "the arrow landed");
    assert!(run.monster_idx(id).is_none(), "the archer is gone from the run");
    let name = run.players[0].name.clone();
    assert!(run.log.records.iter().any(|r| r.head.contains(&tag)), "the game named the archer");
    for (pi, s) in sent_to_all(&mut run).iter().enumerate() {
        assert!(s.log.1.iter().all(|l| !text_of(l).contains("Goblin Archer")), "hero {pi}: {:?}", s.log.1.iter().map(|l| &l.2).collect::<Vec<_>>());
        let heads: Vec<&str> = s.log.1.iter().map(|l| l.2.as_str()).collect();
        if pi == 0 {
            let want = if lethal { format!("{name} fell to something unseen") } else { format!("{name} took ") };
            assert!(heads.iter().any(|h| h.starts_with(&want)), "lethal {lethal}: {heads:?}");
        } else {
            assert!(heads.is_empty(), "{heads:?}");
        }
    }
    }
}

#[test]
fn an_effect_on_a_hit_from_something_unseen_adds_only_its_name_to_the_short_line() {
    // Ruling 11: the hero's own state may show, the attacker's power may not.
    let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin], BossId::Demon);
    let (tx, ty) = walled(&mut run);
    set_prefs(&mut run, 0, true, true);
    let archer = run.spawn_enemy(EnemyType::GoblinArcher, Map::center_of(tx + 4, ty), None);
    let chill = OnHit { kind: EffectKind::Chilled, secs: 4.0, magical: true, power: 33, look: EffectLook::Plain };
    let _ = take(&mut run);
    run.hurt_player(0, Damage::physical(6.0).by(archer, What::Attack).with_effect(chill));
    assert!(run.has_effect(Creature::Player(0), EffectKind::Chilled));
    let recs = take(&mut run);
    assert_eq!(recs.len(), 1);
    let u = recs[0].unseen.as_ref().expect("the short line");
    assert!(u.head.ends_with("from something unseen · Chilled"), "{}", u.head);
    let shown: Vec<&String> = std::iter::once(&u.head).chain(u.details.iter()).collect();
    assert!(shown.iter().all(|l| !l.contains("33") && !l.contains("power") && !l.contains("Chilled: ")), "{shown:?}");
    assert!(recs[0].head.ends_with(" · Chilled"), "the full record is unchanged: {}", recs[0].head);
}

#[test]
fn a_pure_effect_hit_from_something_unseen_does_not_reach_the_hero_with_its_power() {
    let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
    let (tx, ty) = walled(&mut run);
    set_prefs(&mut run, 0, true, true);
    let archer = run.spawn_enemy(EnemyType::GoblinArcher, Map::center_of(tx + 4, ty), None);
    let h0 = run.players[0].id;
    let sleep = OnHit { kind: EffectKind::Sleep, secs: 2.0, magical: true, power: 77, look: EffectLook::Plain };
    let _ = take(&mut run);
    run.hurt_player(0, Damage::physical(0.0).by(archer, What::Shot(EntityKind::SleepOrb)).with_effect(sleep));
    let recs = take(&mut run);
    assert_eq!(recs.len(), 1);
    assert!(recs[0].who.iter().any(|w| w.id == archer), "the record names the attacker: {:?}", recs[0].who);
    let (view, dark) = view_of(&mut run, 0);
    let got = for_viewer(&run, 0, h0, &view, &dark, &[], &recs);
    let lines = got.map(|g| g.1).unwrap_or_default();
    assert!(lines.is_empty(), "{lines:?}");
}
