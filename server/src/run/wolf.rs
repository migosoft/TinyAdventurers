//! The Elven Ranger's wolf: a summoned companion (run/companion.rs) that fights through the melee base AI.
//! Spawn, the Ranger's button and death here.

use super::companion::summon_spot;
use super::entities::{Ai, Companion, Monster, HISTORY_LEN};
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
        announced: None,
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
        dodge: None,
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
        // The ranger's side: a charmed ranger's wolf is born on the charmed side (`charm::sync` keeps it there).
        side: run.players[pi].side,
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
        // Charmed over to the other side, the wolf is not the ranger's to heal (and it is not replaced: it comes back).
        Some(mi) if run.monsters[mi].alive && run.monsters[mi].side != run.players[pi].side => {}
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
    // The ranger, even while the wolf fights for the other side.
    let owner = m.companion.as_ref().map(|c| c.recruiter);
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
mod tests;
