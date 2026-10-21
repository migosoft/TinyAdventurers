use super::record::{LineKind, Seen, Unseen};
use super::send::{LineW, LOG_BYTES_PER_SNAP};
use super::tags::{export_tag_names, tag_name};
use super::text::{n1, pct};
use super::*;
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
            let n = std::fs::read_to_string(&path).unwrap().lines().filter(|l| l.contains("rules_log")).count();
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
        [("run/mod.rs", 7), ("run/levels/boss.rs", 1), ("run/objects.rs", 1), ("run/visibility.rs", 2), ("protocol.rs", 1), ("wire.rs", 1), ("export.rs", 1)].into_iter().map(|(k, v)| (k.to_string(), v)).collect();
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
    assert_eq!(note[0].2, "… 160 more lines (log limit)");
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
