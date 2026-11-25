//! `cargo test` writes generated client files:
//! - `client/src/generated/defs.ts`: entity kinds, animation ids, flags,
//!   class and ability numbers (so the client predicts with the same values)
//! - `client/src/generated/fixtures.json`: collision/FOV test vectors that the
//!   TypeScript ports must reproduce exactly.
//! - `client/src/generated/wire-fixtures.json`: sample snapshots as wire
//!   bytes and readable form for the client's unpack test.
//! The protocol types themselves are exported by ts-rs (`#[ts(export)]`).

use crate::collision::{step_move, MoveState, Solid};
use crate::defs::abilities::{self as ab, AbilityId};
use crate::defs::attributes::Attr;
use crate::defs::classes::{self, PLAYER_RADIUS};
use crate::defs::effects::{self, EffectKind};
use crate::defs::items::{self, EquipSlot, ItemBase, ItemId};
use crate::defs::weapons::{category, is_natural_like};
use crate::defs::{bosses, enemies};
use crate::defs::kinds::{flags, Anim, EntityKind};
use crate::dungeon::{Map, Tile, TILE};
use crate::fov::{Fov, PLAYER_FOV_RADIUS};
use crate::protocol::ClassId;
use crate::run::targets::Side;
use crate::run::{DT, SNAPSHOT_EVERY, TICK_HZ};
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde_json::json;
use std::path::PathBuf;

fn out_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client/src/generated")
}

#[test]
fn export_defs() {
    let kinds: serde_json::Map<String, serde_json::Value> = EntityKind::ALL.iter().map(|k| (format!("{k:?}"), json!(*k as u8))).collect();
    let anims: serde_json::Map<String, serde_json::Value> = Anim::ALL.iter().map(|a| (format!("{a:?}"), json!(*a as u8))).collect();
    let class_defs: serde_json::Map<String, serde_json::Value> = ClassId::ALL
        .iter()
        .map(|c| {
            let d = classes::def(*c);
            let start = classes::attr_sources(*c).total();
            let attrs: serde_json::Map<String, serde_json::Value> = Attr::ALL.iter().map(|a| (format!("{a:?}"), json!(start.get(*a)))).collect();
            (
                format!("{c:?}"),
                json!({ "kind": d.kind as u8, "hp": d.hp, "speed": d.speed, "attrs": attrs, "weight": d.weight, "base_hp": d.base_hp, "primary": d.primary, "secondary": d.secondary, "weapons": d.weapons.iter().map(|k| format!("{k:?}")).collect::<Vec<_>>(), "starter": { "melee": d.starter.0, "ranged": d.starter.1 } }),
            )
        })
        .collect();
    let abilities: serde_json::Map<String, serde_json::Value> = ab::AbilityId::ALL
        .iter()
        .map(|&a| {
            let d = ab::def(a);
            (format!("{a:?}"), json!({ "name": d.name, "slot": d.slot, "ranged": d.ranged, "shape": d.shape, "arcs": d.arcs, "classes": d.classes, "hero": d.for_heroes() }))
        })
        .collect();
    // The weapon items (the client's debug weapon selects): slot, kind and the classes that can hold them.
    let items: serde_json::Map<String, serde_json::Value> = ItemId::ALL
        .iter()
        .filter_map(|&i| {
            let d = items::def(i);
            let (slot, kind) = match d.base {
                ItemBase::Melee(k, _) if !is_natural_like(category(k)) => (EquipSlot::Melee, k),
                ItemBase::Ranged(k, _) => (EquipSlot::Ranged, k),
                ItemBase::Melee(..) | ItemBase::Armor(_) | ItemBase::Ring | ItemBase::Shoes | ItemBase::Belt | ItemBase::Shield => return None,
            };
            Some((format!("{i:?}"), json!({ "name": d.name, "slot": slot, "kind": format!("{kind:?}"), "classes": d.classes })))
        })
        .collect();
    // The ogre's slam telegraph: the radius and wind-up of its Ground Slam.
    let ogre_slam = crate::sheet::kit_for(crate::sheet::KitSource::Enemy(enemies::EnemyType::Ogre), &crate::defs::enemies::attr_sources(enemies::EnemyType::Ogre).total(), &[]).get(ab::AbilityId::GroundSlam).expect("the ogre slams").clone();
    // The dragon's telegraphs: the numbers of the abilities in its kit.
    let dragon_kit = crate::sheet::kit_for(crate::sheet::KitSource::Boss(crate::protocol::BossId::Dragon), &crate::defs::bosses::attr_sources(crate::protocol::BossId::Dragon).total(), &[]);
    let dragon_ability = |id: AbilityId| dragon_kit.get(id).expect("the dragon uses it").clone();
    let demon_kit = crate::sheet::kit_for(crate::sheet::KitSource::Boss(crate::protocol::BossId::Demon), &crate::defs::bosses::attr_sources(crate::protocol::BossId::Demon).total(), &[]);
    let demon_ability = |id: AbilityId| demon_kit.get(id).expect("the demon uses it").clone();
    let lich_kit = crate::sheet::kit_for(crate::sheet::KitSource::Boss(crate::protocol::BossId::Lich), &crate::defs::bosses::attr_sources(crate::protocol::BossId::Lich).total(), &[]);
    let lich_ability = |id: AbilityId| lich_kit.get(id).expect("the lich casts it").clone();
    let mut consts = json!({
        "TILE": TILE,
        "TICK_HZ": TICK_HZ,
        "DT": DT,
        "MIN_COOLDOWN": crate::defs::loadout::MIN_COOLDOWN,
        "COOLDOWN_LEEWAY": crate::run::abilities::COOLDOWN_LEEWAY,
        "SNAPSHOT_HZ": TICK_HZ / SNAPSHOT_EVERY as f64,
        "PLAYER_RADIUS": PLAYER_RADIUS,
        "FOV_RADIUS": PLAYER_FOV_RADIUS,
        "DASH_SPEED": ab::DASH_SPEED,
        "KNOCK_DECAY": ab::KNOCK_DECAY,
        "KNOCK_MIN_SPEED": ab::KNOCK_MIN_SPEED,
        "MIMIC_HOP_CYCLE": enemies::MIMIC_HOP_CYCLE,
        "MIMIC_HOP_AIR_START": enemies::MIMIC_HOP_AIR.0,
        "MIMIC_HOP_AIR_END": enemies::MIMIC_HOP_AIR.1,
        "MIMIC_WAKE_T": enemies::MIMIC_WAKE_T,
        "OGRE_SLAM_RADIUS": ogre_slam.radius,
        "OGRE_SLAM_WINDUP": ogre_slam.windup,
        "OGRE_SLAM_KNOCK": ogre_slam.push,
        "DRAGON_CLAW_WINDUP": dragon_ability(AbilityId::Strike).windup,
        "DRAGON_BITE_WINDUP": dragon_ability(AbilityId::Bite).windup,
        // The client telegraph measures from the hero's centre: the kit range reaches the hero's edge.
        "DRAGON_BITE_RANGE": dragon_ability(AbilityId::Bite).range + PLAYER_RADIUS,
        "DRAGON_BITE_KNOCK": dragon_ability(AbilityId::Bite).push,
        "DRAGON_TAIL_WINDUP": dragon_ability(AbilityId::TailWhip).windup,
        "DRAGON_BREATH_WINDUP": dragon_ability(AbilityId::FireBreath).windup,
        "DRAGON_BREATH_TIME": dragon_ability(AbilityId::FireBreath).duration,
        "DRAGON_TAKEOFF": bosses::DRAGON_TAKEOFF,
        "DRAGON_LAND": bosses::DRAGON_LAND,
        "DRAGON_SMASH_RADIUS": dragon_ability(AbilityId::Smash).radius,
        "DRAGON_SMASH_KNOCK": dragon_ability(AbilityId::Smash).push,
        "DRAGON_CLAW_KNOCK": dragon_ability(AbilityId::Strike).push,
        "DRAGON_TAIL_KNOCK": dragon_ability(AbilityId::TailWhip).push,
        "DRAGON_FIREBALL_KNOCK": dragon_ability(AbilityId::Fireball).push,
        "LICH_NOVA_RADIUS": lich_ability(AbilityId::Nova).radius,
        "LICH_NOVA_WINDUP": lich_ability(AbilityId::Nova).windup,
        "LICH_NOVA_KNOCK": lich_ability(AbilityId::Nova).push,
        "LICH_NOVA_STR": lich_ability(AbilityId::Nova).push_str,
        "SHALLOW_SPEED": crate::dungeon::SHALLOW_SPEED,
        "LAVA_SPEED": crate::dungeon::LAVA_SPEED,
        "FALL_TIME": crate::dungeon::FALL_TIME,
        "DROWN_TIME": crate::dungeon::DROWN_TIME,
        "POS_SCALE": crate::wire::POS_SCALE,
    });
    // A second object: one json! with all of them hits the macro recursion limit.
    let demon = json!({
        "DEMON_CLEAVE_WINDUP": demon_ability(AbilityId::Strike).windup,
        "DEMON_SWOOP_WINDUP": demon_ability(AbilityId::Swoop).windup,
        "DEMON_SWOOP_TIME": demon_ability(AbilityId::Swoop).duration,
        "DEMON_CAST_WINDUP": demon_ability(AbilityId::RingOfFire).windup,
        "DEMON_CLEAVE_RECOVER": bosses::DEMON_CLEAVE_RECOVER,
        "DEMON_SWOOP_RECOVER": bosses::DEMON_SWOOP_RECOVER,
        "DEMON_CAST_RECOVER": bosses::DEMON_CAST_RECOVER,
        "DEMON_TAIL_WINDUP": demon_ability(AbilityId::TailWhip).windup,
        "DEMON_TAIL_RECOVER": bosses::DEMON_TAIL_RECOVER,
        // The client telegraph measures from the hero's centre: the kit range reaches the hero's edge.
        "DEMON_TAIL_RANGE": demon_ability(AbilityId::TailWhip).range + PLAYER_RADIUS,
        "DEMON_BREATH_WINDUP": demon_ability(AbilityId::FireBreath).windup,
        "DEMON_BREATH_TIME": demon_ability(AbilityId::FireBreath).duration,
        "DEMON_TAKEOFF": bosses::DEMON_TAKEOFF,
        "DEMON_FLIGHT": bosses::DEMON_FLIGHT,
        "DEMON_LAND": bosses::DEMON_LAND,
        "DEMON_SMASH_RADIUS": demon_ability(AbilityId::Smash).radius,
        "DEMON_CLEAVE_KNOCK": demon_ability(AbilityId::Strike).push,
        "DEMON_SWOOP_KNOCK": demon_ability(AbilityId::Swoop).push,
    });
    consts.as_object_mut().unwrap().extend(demon.as_object().unwrap().clone());
    let lich = json!({
        "LICH_ORB_SPEED": lich_ability(AbilityId::BlindingCurse).speed,
        "LICH_GAZE_WINDUP": lich_ability(AbilityId::StoneGaze).windup,
        "LICH_BLIND_WINDUP": lich_ability(AbilityId::BlindingCurse).windup,
        "LICH_SLEEP_WINDUP": lich_ability(AbilityId::SleepMist).windup,
        "LICH_GLOOM_WINDUP": lich_ability(AbilityId::GloomBolts).windup,
        "MINION_WINDUP": ab::MINION_WINDUP,
    });
    consts.as_object_mut().unwrap().extend(lich.as_object().unwrap().clone());
    consts.as_object_mut().unwrap().insert("AMBUSH_WARNING".into(), json!(crate::run::ambush::AMBUSH_WARNING));
    let shots = json!({ "SHOT_HEIGHT": crate::run::entities::SHOT_HEIGHT, "GRAVITY": crate::run::entities::GRAVITY, "DRAGON_LIFT": crate::run::entities::DRAGON_LIFT });
    consts.as_object_mut().unwrap().extend(shots.as_object().unwrap().clone());
    let hero = json!({ "VOLLEY_ARROWS": ab::VOLLEY_ARROWS, "VOLLEY_SPREAD": ab::VOLLEY_SPREAD, "HERO_REACH": classes::HERO_REACH });
    consts.as_object_mut().unwrap().extend(hero.as_object().unwrap().clone());
    let objs = json!({
        "BARREL_RADIUS": crate::defs::objects::BARREL_RADIUS, "CHEST_RADIUS": crate::defs::objects::CHEST_RADIUS, "TORCH_RADIUS": crate::defs::objects::TORCH_RADIUS, "CRYSTAL_RADIUS": crate::defs::objects::CRYSTAL_RADIUS,
        "BARREL_FUSE": crate::defs::objects::BARREL_FUSE,
        "BARREL_BLAST_R": crate::defs::objects::BARREL_BLAST_R, "USE_REACH": crate::defs::objects::USE_REACH,
    });
    consts.as_object_mut().unwrap().extend(objs.as_object().unwrap().clone());
    // The half size of every solid object kind, by kind id: what blocks the hero's prediction.
    let solid_objects: serde_json::Map<_, _> = EntityKind::ALL
        .into_iter()
        .filter_map(|k| crate::defs::objects::object_def(k).filter(|d| d.solid).map(|d| ((k as u8).to_string(), json!(d.radius))))
        .collect();
    consts.as_object_mut().unwrap().insert("SOLID_OBJECTS".into(), json!(solid_objects));
    let fl = json!({
        "IMMUNE": flags::IMMUNE,
        "HIDING": flags::HIDING, "DORMANT": flags::DORMANT, "HURT": flags::HURT, "DEAD": flags::DEAD, "AIRBORNE": flags::AIRBORNE, "INCORPOREAL": flags::INCORPOREAL, "WILD": flags::WILD,
    });
    let side = json!({ "Neutral": Side::Neutral as u8, "Hostile": Side::Hostile as u8, "Friendly": Side::Friendly as u8 });
    let tiles: serde_json::Map<_, _> = Tile::ALL.iter().map(|t| (format!("{t:?}"), json!(*t as u8))).collect();
    // Shot hitboxes per monster kind (`Monster::shot_dist`): footprint radius and drawn height.
    let mut hitbox = serde_json::Map::new();
    let monsters = enemies::EnemyType::ALL.iter().map(|&t| (enemies::def(t).kind, enemies::def(t).radius));
    let boss_defs = crate::protocol::BossId::ALL.iter().map(|&b| (bosses::def(b).kind, bosses::def(b).radius));
    for (kind, r) in monsters.chain(boss_defs) {
        hitbox.insert((kind as u8).to_string(), json!({ "r": r, "h": kind.body_height() }));
    }
    hitbox.insert((EntityKind::Barrel as u8).to_string(), json!({ "r": crate::defs::objects::BARREL_RADIUS, "h": 0.0 }));
    // Closed chests stop shots too (the client skips opened ones).
    hitbox.insert((EntityKind::Chest as u8).to_string(), json!({ "r": crate::defs::objects::CHEST_RADIUS, "h": 0.0 }));
    let ev: serde_json::Map<String, serde_json::Value> =
        crate::wire::EV_CODES.iter().enumerate().map(|(i, n)| (n.to_string(), json!(i))).collect();
    let dmg_types: serde_json::Map<_, _> = crate::defs::damage::DamageType::ALL.iter().map(|t| (t.name().to_string(), json!(*t as u8))).collect();
    let light_kinds: serde_json::Map<_, _> =
        crate::defs::lights::LightKind::ALL.iter().map(|k| (format!("{k:?}"), json!(*k as u8))).collect();
    let light_defs: serde_json::Map<_, _> = crate::defs::lights::LightKind::ALL
        .iter()
        .map(|k| ((*k as u8).to_string(), serde_json::to_value(crate::defs::lights::def(*k)).unwrap()))
        .collect();
    let effect_ids: serde_json::Map<_, _> = EffectKind::ALL.iter().map(|k| (format!("{k:?}"), json!(*k as u8))).collect();
    let effect_defs: serde_json::Map<_, _> = EffectKind::ALL
        .iter()
        .map(|k| {
            let d = effects::def(*k);
            ((*k as u8).to_string(), json!({ "positive": d.positive, "prone": d.prone, "no_turn": d.no_turn, "flees": d.flees, "duration": d.duration, "cd_rate": effects::resolve_stat(1.0, effects::Stat::CooldownRate, &[*k]) }))
        })
        .collect();
    let effect_look: serde_json::Map<_, _> = effects::EffectLook::ALL.iter().map(|l| (format!("{l:?}"), json!(*l as u8))).collect();
    let rune_look: serde_json::Map<_, _> = crate::defs::looks::RuneLook::ALL.iter().map(|l| (format!("{l:?}"), json!(*l as u8))).collect();
    let ability_runes: serde_json::Map<_, _> = ab::AbilityId::ALL
        .iter()
        .filter_map(|&a| {
            let rune = crate::defs::looks::default_look(a).rune?;
            Some((format!("{a:?}"), json!({ "look": rune as u8, "primary": ab::def(a).slot == ab::AbilitySlot::Primary })))
        })
        .collect();
    let leaf_palette: serde_json::Map<_, _> = crate::defs::foliage::LeafPalette::ALL.iter().map(|k| (format!("{k:?}"), json!(*k as u8))).collect();
    let plant_kind: serde_json::Map<_, _> = crate::dungeon::woodland::PlantKind::ALL.iter().map(|k| (format!("{k:?}"), json!(*k as u8))).collect();
    assert_eq!(anims.get("Summon"), Some(&json!(16)));
    assert_eq!(consts["MINION_WINDUP"], json!(0.7));
    assert_eq!(consts["LICH_GLOOM_WINDUP"], json!(0.5));
    let p = |v: &serde_json::Value| serde_json::to_string_pretty(v).unwrap();
    let ts = format!(
        "// Generated by `cargo test` (server/src/export.rs). Do not edit.\n\n\
         import type {{ AbilityId }} from \"./AbilityId\";\n\n\
         export const KIND = {} as const;\n\n\
         export const ANIM = {} as const;\n\n\
         export const FLAG = {} as const;\n\n\
         export const SIDE = {} as const;\n\n\
         export const TILE_ID = {} as const;\n\n\
         export const CONST = {} as const;\n\n\
         export const CLASSES = {} as const;\n\n\
         export const ABILITIES = {} as const;\n\n\
         export const ITEMS = {} as const;\n\n\
         export const HITBOX: Record<number, {{ r: number; h: number }}> = {};\n\n\
         export const EV = {} as const;\n\n\
         export const DMG_TYPE = {} as const;\n\n\
         export const LIGHT_KIND = {} as const;\n\n\
         export const LIGHT: Record<number, {{ radius: number; colour: number; intensity: number; flicker: number }}> = {};\n\n\
         export const EFFECT = {} as const;\n\n\
         export const EFFECTS: Record<number, {{ positive: boolean; prone: boolean; no_turn: boolean; flees: boolean; duration: number; cd_rate: number }}> = {};\n\n\
         export const EFFECT_LOOK = {} as const;\n\n\
         export const RUNE_LOOK = {} as const;\n\n\
         export const ABILITY_RUNES: Partial<Record<AbilityId, {{ look: number; primary: boolean }}>> = {};\n\n\
         export const LEAF_PALETTE = {} as const;\n\n\
         export const PLANT_KIND = {} as const;\n\n\
         export const ENEMY_KINDS = {} as const;\n\n{}",
        p(&json!(kinds)),
        p(&json!(anims)),
        p(&fl),
        p(&side),
        p(&json!(tiles)),
        p(&consts),
        p(&json!(class_defs)),
        p(&json!(abilities)),
        p(&json!(items)),
        p(&json!(hitbox)),
        p(&json!(ev)),
        p(&json!(dmg_types)),
        p(&json!(light_kinds)),
        p(&json!(light_defs)),
        p(&json!(effect_ids)),
        p(&json!(effect_defs)),
        p(&json!(effect_look)),
        p(&json!(rune_look)),
        p(&json!(ability_runes)),
        p(&json!(leaf_palette)),
        p(&json!(plant_kind)),
        p(&json!(enemy_kinds())),
        crate::run::rules_log::tags::export_tag_names(),
    );
    std::fs::create_dir_all(out_dir()).unwrap();
    std::fs::write(out_dir().join("defs.ts"), ts).unwrap();
}

/// The effect line per Attribute (spec §1 table), per point above (below) 10.
fn attr_text(a: Attr) -> &'static str {
    match a {
        Attr::Str => "Melee, thrown and natural-attack damage ±5 %. Push power. Range and projectile speed of ranged weapons ±2 % each.",
        Attr::Dex => "Finesse and ranged weapon damage ±5 %. The arc of every melee attack ±3 %. Weapon attack and technique cooldowns ÷ DEX/10. Sets how far shots pierce.",
        Attr::Con => "HP ±5. Move speed ±1 %. The save against non-magical effects.",
        Attr::Int => "Spell damage ±5 %. Spell effect power. Spell cooldowns ÷ INT/10.",
        Attr::Wil => "The save against hostile magical effects: shorter duration only, never less damage.",
        Attr::Cha => "Innate magic: damage and heals ±5 %, effect power, auras. Innate cooldowns ÷ CHA/10.",
    }
}

/// `client/src/generated/progression.ts`: the skill trees, Attribute info, hero items and the
/// respec price, for the skill-tree, shop and item screens.
#[test]
fn export_progression() {
    use crate::defs::items::PropKind;
    use crate::defs::loadout::requirement_text;
    use crate::defs::trees::{self, NodeKind};
    let mut tree_map = serde_json::Map::new();
    for c in ClassId::ALL {
        let mut nodes = serde_json::Map::new();
        for d in trees::tree(c) {
            let (kind, ability) = match d.kind {
                NodeKind::Start => ("Start", None),
                NodeKind::Unlock(a) => ("Unlock", Some(a)),
                NodeKind::Improve(a, _) => ("Improve", Some(a)),
                NodeKind::Proficiency(_) => ("Proficiency", None),
                NodeKind::Resist(..) => ("Resist", None),
                NodeKind::Keystone(_) => ("Keystone", None),
            };
            let links: Vec<String> = trees::neighbours(d.id).iter().map(|n| format!("{n:?}")).collect();
            let mut n = json!({
                "pos": [d.pos.0, d.pos.1], "kind": kind, "name": d.name, "text": d.text, "cost": d.cost,
                "req": d.req.iter().map(requirement_text).collect::<Vec<_>>(), "links": links,
            });
            if let Some(a) = ability {
                n["ability"] = json!(format!("{a:?}"));
            }
            nodes.insert(format!("{:?}", d.id), n);
        }
        tree_map.insert(format!("{c:?}"), json!({ "start": format!("{:?}", trees::start(c)), "nodes": nodes }));
    }
    let attrs: serde_json::Map<String, serde_json::Value> = Attr::ALL
        .iter()
        .map(|&a| (format!("{a:?}"), json!({ "short": a.short(), "weight": crate::defs::attributes::ATTR_WEIGHT[a as usize], "text": attr_text(a) })))
        .collect();
    let item_map: serde_json::Map<String, serde_json::Value> = ItemId::ALL
        .iter()
        .map(|&i| {
            let d = items::def(i);
            let slot = match d.base {
                ItemBase::Melee(..) => "Melee",
                ItemBase::Ranged(..) => "Ranged",
                ItemBase::Armor(_) => "Armor",
                ItemBase::Ring => "Ring",
                ItemBase::Shoes => "Shoes",
                ItemBase::Belt => "Belt",
                ItemBase::Shield => "OffHand",
            };
            let grants: Vec<String> = d
                .props
                .iter()
                .filter_map(|p| match p.kind {
                    PropKind::GrantAbility { id, .. } => Some(format!("{id:?}")),
                    _ => None,
                })
                .collect();
            let kind = match &d.base {
                ItemBase::Ring => "Ring".to_string(),
                ItemBase::Shoes => "Shoes".to_string(),
                ItemBase::Belt => "Belt".to_string(),
                ItemBase::Shield => "Shield".to_string(),
                b => crate::sheet::item_prof(b).unwrap(),
            };
            let props: Vec<serde_json::Value> = d.props.iter().map(|p| json!({ "text": items::prop_text(p), "magical": p.magical })).collect();
            (format!("{i:?}"), json!({ "name": d.name, "sprite": d.sprite, "kind": kind, "prof": crate::sheet::item_prof(&d.base), "base": items::base_text(&d.base), "props": props, "req": d.req.iter().map(requirement_text).collect::<Vec<_>>(), "slot": slot, "classes": d.classes.iter().map(|c| format!("{c:?}")).collect::<Vec<_>>(), "hero": items::hero_can_hold(&d), "grants": grants }))
        })
        .collect();
    let ability_map: serde_json::Map<String, serde_json::Value> = AbilityId::ALL
        .iter()
        .map(|&id| {
            let d = ab::def(id);
            let tint = if d.uses != ab::Uses::Nothing {
                Some("Physical")
            } else if d.own.damage > 0.0 {
                d.own.split.or_else(|| d.own.kind.map(crate::defs::damage::kind_split)).map(|s| s.main_type().name())
            } else {
                None
            };
            (
                format!("{id:?}"),
                json!({
                    "category": format!("{:?}", d.category), "uses": format!("{:?}", d.uses),
                    "req": d.req.iter().map(requirement_text).collect::<Vec<_>>(), "text": ab::text(id), "tint": tint,
                }),
            )
        })
        .collect();
    let p = |v: &serde_json::Value| serde_json::to_string_pretty(v).unwrap();
    let ts = format!(
        "// Generated by `cargo test` (server/src/export.rs). Do not edit.\n\n\
         export const TREES = {} as const;\n\n\
         export const ATTRS = {} as const;\n\n\
         export const ITEMS = {} as const;\n\n\
         export const ABILITY_INFO = {} as const;\n\n\
         export const RESPEC = {{ base: {}, per: {} }} as const;\n",
        p(&json!(tree_map)),
        p(&json!(attrs)),
        p(&json!(item_map)),
        p(&json!(ability_map)),
        crate::progress::RESPEC_BASE,
        crate::progress::RESPEC_PER,
    );
    std::fs::create_dir_all(out_dir()).unwrap();
    std::fs::write(out_dir().join("progression.ts"), ts).unwrap();
}

/// Each enemy kind's max HP and damage resistances, from the first enemy type of that kind
/// (the client estimates an enemy's HP from its HP share to predict a kill).
fn enemy_kinds() -> serde_json::Map<String, serde_json::Value> {
    let mut out = serde_json::Map::new();
    for t in enemies::EnemyType::ALL {
        let key = format!("{:?}", enemies::def(t).kind);
        if out.contains_key(&key) {
            continue;
        }
        let res = enemies::profile(t).res;
        let res: serde_json::Map<_, _> = crate::defs::damage::DamageType::ALL.iter().map(|&dt| (dt.name().to_string(), json!(res.capped(dt)))).collect();
        out.insert(key, json!({ "max_hp": crate::sheet::enemy_stats(t).max_hp, "res": res }));
    }
    out
}

#[test]
fn each_enemy_kind_is_its_first_enemy_type() {
    use crate::defs::damage::DamageType;
    use enemies::EnemyType;
    let kinds = enemy_kinds();
    for t in EnemyType::ALL {
        let kind = enemies::def(t).kind;
        let first = *EnemyType::ALL.iter().find(|&&u| enemies::def(u).kind == kind).unwrap();
        let e = &kinds[&format!("{kind:?}")];
        assert_eq!(e["max_hp"], json!(crate::sheet::enemy_stats(first).max_hp), "{t:?}");
        let res = enemies::profile(first).res;
        for dt in DamageType::ALL {
            assert_eq!(e["res"][dt.name()], json!(res.get(dt)), "{t:?} {dt:?}");
        }
    }
    let distinct: std::collections::HashSet<_> = EnemyType::ALL.iter().map(|&t| enemies::def(t).kind).collect();
    assert_eq!(kinds.len(), distinct.len());
    // A kind shared by two types takes the normal one's HP.
    assert_eq!(kinds["SkeletonArcher"]["max_hp"], json!(30.0));
    assert_eq!(kinds["Imp"]["max_hp"], json!(30.0));
}

/// A small room with pillars, a corridor and every kind of terrain for the
/// shared test vectors.
fn fixture_map() -> Map {
    let mut m = Map::new(24, 20);
    for y in 1..19 {
        for x in 1..23 {
            m.set(x, y, Tile::Floor);
        }
    }
    for (x, y) in [(6, 5), (7, 5), (6, 6), (12, 9), (13, 9), (13, 10), (17, 4), (5, 14), (18, 15), (19, 15)] {
        m.set(x, y, Tile::Wall);
    }
    for y in 1..12 {
        m.set(10, y, Tile::Wall);
    }
    for x in 11..23 {
        m.set(x, 1, Tile::ShallowWater);
        m.set(x, 2, Tile::ShallowWater);
    }
    for x in 1..10 {
        m.set(x, 17, Tile::ShallowWater);
        m.set(x, 18, Tile::ShallowWater);
    }
    for (x, y) in [(15, 6), (16, 6), (15, 7), (16, 7)] {
        m.set(x, y, Tile::DeepWater);
    }
    for y in 5..9 {
        m.set(20, y, Tile::Chasm);
        m.set(21, y, Tile::Chasm);
    }
    for y in 13..16 {
        for x in 14..18 {
            m.set(x, y, Tile::Lava);
        }
    }
    // A tree trunk: it stops walking, dashing and sight, but not light.
    m.set(3, 10, Tile::Trunk);
    // A thicket strip (a wall that lets light through) and a road strip (open ground).
    for x in 5..8 {
        m.set(x, 11, Tile::Thicket);
    }
    for x in 15..18 {
        m.set(x, 16, Tile::Road);
    }
    // An invisible wall (#259): stops walking and dashing, not sight or light.
    for x in 11..15 {
        m.set(x, 18, Tile::Barrier);
    }
    // A wall with a one-tile doorway (open) and a closed door, and two walls touching only at a corner.
    for y in 9..15 {
        m.set(21, y, Tile::Wall);
    }
    m.set(21, 12, Tile::DoorOpen);
    m.set(21, 10, Tile::DoorClosed);
    m.set(19, 10, Tile::Wall);
    m.set(20, 11, Tile::Wall);
    m
}

/// Barrels in the fixture room (floor tiles), so the port is checked against solids too.
fn fixture_solids() -> Vec<Solid> {
    vec![Solid { x: 4.5 * TILE, y: 8.5 * TILE, half: 6.0 }, Solid { x: 8.5 * TILE, y: 12.5 * TILE, half: 6.0 }, Solid { x: 13.5 * TILE, y: 4.5 * TILE, half: 6.0 }]
}

/// A real run of a Barbarian through a fixed input list, recorded step by step (`world.test.ts` replays it through
/// `Predictor.step` and `Predictor.reconcile`). It covers: a Charge; a Strike and a refused one (cooldown); a push with
/// two Strikes sent inside the slide while the cooldown is 0 (ignored); an Entangled root with a Strike (allowed); a
/// Sleep with a Strike (ignored); an Accelerated span (cooldown rate 1.25) with Strikes wherever the client and the
/// server cannot differ over the leeway; a walk into a chasm and on after the fall began. Not covered: a charmed hero,
/// Berserker's cooldown factor, a ranged ability in melee, the melee fallback.
fn predictor_case() -> serde_json::Value {
    use crate::protocol::{BossId, InputMsg};
    use crate::run::abilities::COOLDOWN_LEEWAY;
    use crate::run::effects::Creature;
    use crate::run::tests::test_run;
    let mut run = test_run(&[ClassId::Barbarian], BossId::Lich);
    run.monsters.retain(|m| m.is_boss);
    run.objects.clear(); // no solids: the client predicts without any here
    let (tx, ty) = Map::tile_of(run.players[0].pos());
    for y in ty - 2..=ty + 2 {
        for x in tx - 1..=tx + 12 {
            run.layout.map.set(x, y, if (tx + 8..=tx + 9).contains(&x) && (ty - 1..=ty + 1).contains(&y) { Tile::Chasm } else { Tile::Floor });
        }
    }
    let start = Map::center_of(tx, ty);
    run.players[0].mv = MoveState::at(start.x, start.y);
    let sheet = run.players[0].sheet.clone();
    let mut steps: Vec<serde_json::Value> = Vec::new();
    for i in 0..400u32 {
        let mx: i8 = if i < 20 || (60..100).contains(&i) || (100..180).contains(&i) || i >= 230 { 1 } else { 0 };
        let mut primary = matches!(i, 4 | 6 | 62 | 64 | 105 | 150);
        // From the Accelerated span on, ask whenever both sides surely agree: the cooldown is 0 before the tick (the client fires then) or stays above the leeway after it (the server refuses).
        if i >= 180 {
            let cd1 = run.players[0].cd1;
            let after = |dt: f64| (cd1 - dt).max(0.0);
            primary = cd1 == 0.0 || [DT, DT * 1.25].iter().all(|&dt| after(dt) > COOLDOWN_LEEWAY);
        }
        let secondary = i == 2;
        let mut knock = json!(null);
        match i {
            60 => {
                let from = run.players[0].pos() + crate::math::Vec2::new(10.0, 0.0);
                run.knock_player(0, from, 0.0, 20.0, crate::run::tests::PUSH_STR);
                knock = json!([run.players[0].mv.knock_vx, run.players[0].mv.knock_vy]);
                assert_eq!(run.players[0].cd1, 0.0, "a Strike inside the push is sent with the cooldown at 0");
            }
            100 => assert!(run.apply_effect(Creature::Player(0), EffectKind::Entangled, Some(0.5))),
            140 => assert!(run.apply_effect(Creature::Player(0), EffectKind::Sleep, Some(0.5))),
            180 => assert!(run.apply_effect(Creature::Player(0), EffectKind::Accelerated, Some(1.0))),
            _ => {}
        }
        let before = (run.players[0].cd1, run.players[0].cd2);
        if matches!(i, 62 | 64) {
            assert!(run.players[0].mv.knocked(), "step {i} is inside the push slide");
        }
        let input = InputMsg { seq: i + 1, mx, primary: primary.then_some(i as u16 + 1), secondary: secondary.then_some(i as u16 + 1), ..Default::default() };
        run.players[0].inputs.push_back(input);
        run.step();
        let p = &run.players[0];
        if matches!(i, 62 | 64 | 150) {
            assert_eq!((before.0, p.cd1), (0.0, 0.0), "step {i}: the Strike is ignored by the server ({before:?} {})", p.cd1);
        }
        steps.push(json!({
            "mx": mx, "primary": primary, "secondary": secondary, "knock": knock,
            "speedMul": p.effects.speed_mul(), "noAct": p.effects.no_act(), "cdRate": p.effects.cooldown_dt(DT) / DT,
            "x": p.mv.x, "y": p.mv.y, "dashT": p.mv.dash_t, "dashDx": p.mv.dash_dx, "dashDy": p.mv.dash_dy,
            "knockVx": p.mv.knock_vx, "knockVy": p.mv.knock_vy,
            "cd1": p.cd1, "cd2": p.cd2, "sinking": p.sinking.is_some(),
        }));
        if !p.alive {
            break;
        }
    }
    let any = |key: &str, v: serde_json::Value| steps.iter().any(|s| s[key] == v);
    assert!(any("sinking", json!(true)), "the walk ends in the chasm");
    assert!(any("speedMul", json!(0.0)) && any("noAct", json!(true)) && any("cdRate", json!(1.25)), "root, sleep and acceleration all held");
    let uses = |range: std::ops::Range<usize>| (range.start..range.end).filter(|&i| steps[i]["cd1"].as_f64().unwrap() > steps[i - 1]["cd1"].as_f64().unwrap()).count();
    assert!(uses(180..270) >= 2, "Strikes are used while accelerated: {}", uses(180..270));
    assert!(steps[105]["cd1"].as_f64().unwrap() > 0.0, "the Strike while entangled is used");
    json!({ "speed": sheet.speed, "abilities": [sheet.primary, sheet.secondary], "fallback": sheet.fallback, "start": [start.x, start.y], "steps": steps, "map": { "w": run.layout.map.w, "h": run.layout.map.h, "tiles": run.layout.map.tiles } })
}

#[test]
fn export_fixtures() {
    let map = fixture_map();
    let solids = fixture_solids();
    let mut rng = ChaCha8Rng::seed_from_u64(99);
    let mut moves = Vec::new();
    for case in 0..10 {
        let (tx, ty) = if case < 6 { (3, 3 + case * 2) } else { (12, 3 + (case - 6) * 4) };
        let mut s = MoveState::at(tx as f64 * TILE + 8.0, ty as f64 * TILE + 8.0);
        let start = s;
        let speed = 60.0 + case as f64 * 5.0;
        let mut inputs = Vec::new();
        let mut out = Vec::new();
        let (mut mx, mut my) = (1i8, 0i8);
        for step in 0..400 {
            if step % 25 == 0 {
                mx = rng.gen_range(-1..=1);
                my = rng.gen_range(-1..=1);
            }
            let dash = step % 97 == 50;
            if dash {
                let a: f64 = rng.gen_range(0.0..std::f64::consts::TAU);
                s.dash_t = 0.18;
                s.dash_dx = a.cos();
                s.dash_dy = a.sin();
            }
            // A push (14-44 px, any direction) now and then, carried into terrain and walls.
            let knock = step % 97 == 20;
            if knock {
                let a: f64 = rng.gen_range(0.0..std::f64::consts::TAU);
                let v = crate::collision::knock_speed(rng.gen_range(14.0..44.0), DT);
                s.knock_vx = a.cos() * v;
                s.knock_vy = a.sin() * v;
            }
            let pushed = [s.knock_vx, s.knock_vy];
            s = step_move(&map, &s, mx, my, speed, ab::DASH_SPEED, PLAYER_RADIUS, DT, &solids);
            inputs.push(json!({
                "mx": mx, "my": my,
                "dash": if dash { json!([s.dash_dx, s.dash_dy]) } else { json!(null) },
                "knock": if knock { json!(pushed) } else { json!(null) },
            }));
            out.push(json!([s.x, s.y]));
        }
        moves.push(json!({ "start": [start.x, start.y], "speed": speed, "inputs": inputs, "out": out }));
    }
    let mut fov = Fov::new(map.w, map.h);
    let mut fovs = Vec::new();
    use crate::dungeon::Blocker;
    for (cx, cy, b) in [(3, 3, Blocker::All), (8, 8, Blocker::All), (15, 12, Blocker::All), (11, 2, Blocker::All), (20, 17, Blocker::All), (3, 7, Blocker::All), (3, 7, Blocker::Hard), (6, 8, Blocker::All), (6, 8, Blocker::Hard), (19, 11, Blocker::All), (20, 12, Blocker::All)] {
        fov.compute(&map, cx, cy, PLAYER_FOV_RADIUS, b);
        let mut vis = Vec::new();
        for y in 0..map.h {
            for x in 0..map.w {
                if fov.is_visible(x, y) {
                    vis.push(y * map.w + x);
                }
            }
        }
        fovs.push(json!({ "x": cx, "y": cy, "hard": b == Blocker::Hard, "visible": vis }));
    }
    use crate::defs::lights::LightKind;
    use crate::run::light::{Anchor, Lights, Lit};
    let mut lights = Lights::new(map.w, map.h);
    for (x, y) in [(3, 3), (8, 8), (15, 12)] {
        lights.push(LightKind::Torch, Anchor::Tile(x, y), None);
    }
    // Daylight on open floor south of the lava, where no other light reaches fully.
    lights.push(LightKind::Daylight, Anchor::Tile(12, 16), None);
    for y in 0..map.h {
        for x in 0..map.w {
            if map.get(x, y) == Tile::Lava as u8 {
                lights.push(LightKind::Lava, Anchor::Tile(x, y), None);
            }
        }
    }
    lights.refresh(&map);
    let lit: Vec<i32> = (0..map.w * map.h).filter(|i| lights.static_lit(i % map.w, i / map.w)).collect();
    let srcs: Vec<serde_json::Value> = lights.sources.iter().map(|s| match s.anchor {
        Anchor::Tile(x, y) => json!([s.id, s.kind as u8, s.colour, x, y, true]),
        Anchor::Entity(_) | Anchor::Point(_) => unreachable!(),
    }).collect();
    // Moving lights (px, on the wire's 1/16 px grid): open floor, beside the
    // pillar's corner, against the long wall, exactly on a tile corner.
    let mut alone = Lights::new(map.w, map.h);
    let moving: Vec<serde_json::Value> = [(136.0, 216.0, LightKind::Fire), (95.0, 97.0, LightKind::Fire), (159.5, 72.0, LightKind::Fire), (176.0, 176.0, LightKind::Fire), (40.25, 250.0, LightKind::Magic)]
        .iter()
        .map(|&(x, y, kind)| {
            alone.cast_moving(&map, &[Lit::new(crate::math::Vec2::new(x, y), kind, crate::defs::lights::def(kind).colour)]);
            let lit: Vec<i32> = (0..map.w * map.h).filter(|i| alone.lit(i % map.w, i / map.w)).collect();
            json!({ "x": x, "y": y, "kind": kind as u8, "lit": lit })
        })
        .collect();
    // Darkvision: what a hero sees (FOV, and the static light or within range) from unlit floor,
    // partial ranges, so the circle's edge is tested: some unlit tile is seen only by darkvision
    // and some unlit FOV tile is not seen. Plus range 0 and the full range (the FOV radius).
    let mut view = crate::vispoly::View::new(map.w, map.h);
    let mut dark_cases = Vec::new();
    for (cx, cy, range) in [(12, 5, 3.0), (18, 4, 4.5), (3, 14, 3.0), (11, 7, 4.5), (20, 3, PLAYER_FOV_RADIUS as f64), (20, 17, 0.0)] {
        assert!(!lights.lit(cx, cy), "darkvision viewer {cx},{cy} stands on an unlit tile");
        view.compute(&map, Map::center_of(cx, cy), PLAYER_FOV_RADIUS);
        let seen: Vec<i32> = (0..map.w * map.h).filter(|i| crate::run::visibility::hero_tile_seen(&view, &lights, (cx, cy), range, i % map.w, i / map.w)).collect();
        let unlit_fov = |i: &i32| view.is_visible(i % map.w, i / map.w) && !lights.lit(i % map.w, i / map.w);
        let dark_only = seen.iter().filter(|i| unlit_fov(i)).count();
        let dark_unseen = (0..map.w * map.h).filter(|i| unlit_fov(i) && !seen.contains(i)).count();
        println!("DV {cx},{cy} r{range}: seen {} dark-only {dark_only} dark-unseen {dark_unseen}", seen.len());
        if range > 0.0 {
            assert!(dark_only > 0, "viewer {cx},{cy}: no unlit tile seen by darkvision");
            if range < PLAYER_FOV_RADIUS as f64 {
                assert!(dark_unseen > 0, "viewer {cx},{cy}: no unlit FOV tile outside the range");
            }
        }
        dark_cases.push(json!({ "x": cx, "y": cy, "range": range, "seen": seen }));
    }
    // The hero's view (vispoly.rs): polygon points and visible tiles from pixel positions beside
    // the long wall's end, the 3-tile pillar and the wall block, on a tile corner and in the open.
    let mut view_cases = Vec::new();
    // Also the trunk (3,10) and the thicket strip (5..7,11), under both blockers.
    // Radius 9 is the plain hero's; 18 is the Elven Ranger's.
    for (x, y, b, vision) in [(150.5, 200.3, Blocker::All, 9), (90.7, 108.2, Blocker::All, 9), (186.4, 168.9, Blocker::All, 9), (176.0, 208.0, Blocker::All, 9), (60.0, 200.0, Blocker::All, 9), (52.0, 120.0, Blocker::All, 9), (52.0, 120.0, Blocker::Hard, 9), (100.0, 136.0, Blocker::All, 9), (100.0, 136.0, Blocker::Hard, 9), (330.0, 200.0, Blocker::All, 9), (312.0, 184.0, Blocker::All, 9),
        (150.5, 200.3, Blocker::All, 18), (90.7, 108.2, Blocker::All, 18), (186.4, 168.9, Blocker::All, 18), (60.0, 200.0, Blocker::All, 18), (52.0, 120.0, Blocker::Hard, 18), (100.0, 136.0, Blocker::All, 18), (330.0, 200.0, Blocker::All, 18)] {
        let p = crate::math::Vec2::new(x, y);
        assert!(!map.opaque_at(p), "view viewer {x},{y} stands on open floor");
        view.compute_with(&map, p, vision, b);
        let poly = crate::vispoly::sight_polygon(&map, x, y, crate::vispoly::sight_radius(vision), 96, b);
        let points: Vec<f64> = poly.points.iter().flat_map(|&(a, b)| [a, b]).collect();
        let visible: Vec<i32> = (0..map.w * map.h).filter(|i| view.is_visible(i % map.w, i / map.w)).collect();
        view_cases.push(json!({ "x": x, "y": y, "hard": b == Blocker::Hard, "vision": vision, "points": points, "visible": visible }));
    }
    // Every tile's rules, so a new or changed tile fails the client's port: sight, light, walking and speed per mover.
    use crate::dungeon::Mover;
    let movers = [("hero", Mover::Hero), ("enemy", Mover::Enemy), ("demon", Mover::Demon), ("dash", Mover::Dash)];
    let tile_rules: Vec<serde_json::Value> = Tile::ALL
        .iter()
        .map(|&t| {
            let id = t as u8;
            let mut one = Map::new(1, 1);
            one.tiles[0] = id;
            let centre = crate::math::Vec2::new(TILE / 2.0, TILE / 2.0);
            let blocks: serde_json::Map<_, _> = movers.iter().map(|&(n, mv)| (n.to_string(), json!(one.blocks(0, 0, mv)))).collect();
            let speed: serde_json::Map<_, _> = movers.iter().map(|&(n, mv)| (n.to_string(), json!(one.speed_factor(centre, mv)))).collect();
            json!({ "id": id, "opaque": one.opaque(0, 0), "hardOpaque": one.hard_opaque(0, 0), "blocks": blocks, "speed": speed })
        })
        .collect();
    let light_case = json!({ "sources": srcs, "lit": lit, "moving": moving });
    let doc = json!({
        "lights": light_case, "darkvision": dark_cases, "view": view_cases,
        "w": map.w, "h": map.h, "tiles": map.tiles,
        "tileRules": tile_rules,
        "predictor": predictor_case(),
        "radius": PLAYER_RADIUS, "dt": DT, "dashSpeed": ab::DASH_SPEED, "fovRadius": PLAYER_FOV_RADIUS,
        "solids": solids.iter().map(|s| json!([s.x, s.y, s.half])).collect::<Vec<_>>(),
        "moves": moves, "fov": fovs,
    });
    std::fs::create_dir_all(out_dir()).unwrap();
    std::fs::write(out_dir().join("fixtures.json"), serde_json::to_string(&doc).unwrap()).unwrap();
}

/// Sample snapshots as wire bytes plus their readable form; the client's
/// `wire.test.ts` unpacks the bytes and compares.
#[test]
fn export_wire_fixtures() {
    // A third case: the second sample with a rules log (tags and lines, with and without details).
    let mut with_log = crate::wire::sample_snapshots().remove(1);
    with_log.log = Some(crate::run::rules_log::LogW(vec![(1, 2, 3), (7, 4, 0)], vec![crate::run::rules_log::send::LineW(1.5, 0, "Goblin 1 hits Mage".into(), vec!["9 Slashing".into(), "x2 vs Mage".into()]), crate::run::rules_log::send::LineW(2.25, 3, "Goblin 1 dies".into(), vec![])]));
    let mut samples = crate::wire::sample_snapshots();
    samples.push(with_log);
    let cases: Vec<serde_json::Value> = samples
        .iter()
        .map(|s| json!({ "bytes": crate::wire::encode_snap(s), "snap": s }))
        .collect();
    std::fs::create_dir_all(out_dir()).unwrap();
    std::fs::write(out_dir().join("wire-fixtures.json"), serde_json::to_string(&json!({ "cases": cases })).unwrap()).unwrap();
}

/// Three woodlands for the client's demo page: the tiles, the plants and every creature spot.
#[test]
fn export_woodland_demo() {
    let maps: Vec<serde_json::Value> = (1..=3u64)
        .map(|seed| {
            let (layout, w) = crate::dungeon::woodland::generate(seed);
            let spot = |t: enemies::EnemyType, p: crate::math::Vec2| json!([enemies::def(t).kind as u8, p.x.round() as i32, p.y.round() as i32]);
            let spawns: Vec<serde_json::Value> = layout.spawns.iter().map(|s| spot(s.enemy, s.pos)).chain(w.animals.iter().map(|&(t, p)| spot(t, p))).collect();
            json!({ "w": layout.map.w, "h": layout.map.h, "tiles": layout.map.tiles, "woodland": crate::protocol::WoodlandInfo::from(&w), "spawns": spawns })
        })
        .collect();
    std::fs::create_dir_all(out_dir()).unwrap();
    std::fs::write(out_dir().join("woodland-demo.json"), serde_json::to_string(&maps).unwrap()).unwrap();
}

/// Four woodlands for the pond's dev page (#360): the first seeds with no water works, an inflow under a road
/// bridge, an inflow and an outflow, and a bridge over the pond.
#[cfg(test)]
fn pond_demo_levels() -> Vec<(crate::dungeon::Layout, crate::dungeon::woodland::Woodland)> {
    use crate::dungeon::woodland::Pond;
    let wanted: [fn(&Pond) -> bool; 4] = [
        |p| p.streams.is_empty() && p.bridges.is_empty(),
        |p| p.streams.iter().any(|s| s.inflow) && p.bridges.iter().any(|b| b.road),
        |p| p.streams.iter().any(|s| s.inflow) && p.streams.iter().any(|s| !s.inflow),
        |p| p.bridges.iter().any(|b| !b.road),
    ];
    wanted
        .iter()
        .map(|want| (1..=2000u64).map(crate::dungeon::woodland::generate).find(|(_, w)| w.pond.as_ref().is_some_and(want)).expect("a seed for every pond case"))
        .collect()
}

/// The pond shape's parity fixture (#360): for each demo pond its blobs, its seed and `water_shapes::inside` on a
/// 20 x 15 grid over the blobs' bounds plus 3 tiles. The client's port (`pond/pondShape.ts`) must give the same values.
/// Named `export_bindings_…` so the local run's `--skip export_bindings` leaves it out: the docker suite creates the
/// file as root, and a local run cannot write it (as with the ts-rs bindings).
#[test]
fn export_bindings_pond_shape_fixture() {
    let ponds: Vec<serde_json::Value> = pond_demo_levels()
        .iter()
        .map(|(_, w)| {
            let p = w.pond.as_ref().unwrap();
            let (x0, x1) = (p.blobs.iter().map(|b| b.cx - b.rx).fold(f64::MAX, f64::min) - 3.0, p.blobs.iter().map(|b| b.cx + b.rx).fold(f64::MIN, f64::max) + 3.0);
            let (y0, y1) = (p.blobs.iter().map(|b| b.cy - b.ry).fold(f64::MAX, f64::min) - 3.0, p.blobs.iter().map(|b| b.cy + b.ry).fold(f64::MIN, f64::max) + 3.0);
            let samples: Vec<[f64; 3]> = (0..15)
                .flat_map(|j| (0..20).map(move |i| (x0 + (x1 - x0) * i as f64 / 19.0, y0 + (y1 - y0) * j as f64 / 14.0)))
                .map(|(x, y)| [x, y, crate::dungeon::water_shapes::inside(&p.blobs, p.seed, x, y)])
                .collect();
            json!({ "blobs": p.blobs.iter().map(|b| [b.cx, b.cy, b.rx, b.ry]).collect::<Vec<_>>(), "seed": p.seed, "samples": samples })
        })
        .collect();
    std::fs::create_dir_all(out_dir()).unwrap();
    std::fs::write(out_dir().join("pond-shape-fixture.json"), serde_json::to_string(&ponds).unwrap()).unwrap();
}

/// Named `export_bindings_…` for the same reason as the shape fixture above.
#[test]
fn export_bindings_pond_demo() {
    let maps: Vec<serde_json::Value> = pond_demo_levels()
        .iter()
        .map(|(layout, w)| {
            let spot = |t: enemies::EnemyType, p: crate::math::Vec2| json!([enemies::def(t).kind as u8, p.x.round() as i32, p.y.round() as i32]);
            let spawns: Vec<serde_json::Value> = layout.spawns.iter().map(|s| spot(s.enemy, s.pos)).chain(w.animals.iter().map(|&(t, p)| spot(t, p))).collect();
            json!({ "w": layout.map.w, "h": layout.map.h, "tiles": layout.map.tiles, "woodland": crate::protocol::WoodlandInfo::from(w), "spawns": spawns })
        })
        .collect();
    std::fs::create_dir_all(out_dir()).unwrap();
    std::fs::write(out_dir().join("pond-demo.json"), serde_json::to_string(&maps).unwrap()).unwrap();
}
