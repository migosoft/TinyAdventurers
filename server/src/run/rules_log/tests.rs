use super::*;
use crate::defs::bosses;
use crate::defs::enemies::{self, EnemyType};
use crate::protocol::{BossId, ClassId};
use crate::run::tests::test_run;
use std::collections::BTreeMap;

fn count(run: &Run, kind: EntityKind) -> usize {
    run.monsters.iter().filter(|m| m.kind == kind).count()
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
    let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
    let pos = run.players[0].pos();
    // The level's chest loop spawns mimics hiding; do the same.
    let id = run.spawn_enemy(EnemyType::Mimic, pos, None);
    let mi = run.monster_idx(id).unwrap();
    run.monsters[mi].hiding = true;
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
    for boss in BossId::ALL {
        let run = test_run(&[ClassId::Wizard], boss);
        for m in run.monsters.iter().filter(|m| m.kind == EntityKind::Mimic) {
            assert!(m.hiding, "mimic {} spawned awake under {boss:?}", m.id);
        }
    }
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
        [("run/mod.rs", 5), ("run/levels/boss.rs", 1), ("run/objects.rs", 1), ("export.rs", 1)].into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    assert_eq!(found, hooks);
}
