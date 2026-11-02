//! Raising minions: what Raise Dead and Summon Imps do, for every caster.

use super::Run;
use crate::defs::abilities as ab;
use crate::defs::enemies::EnemyType;
use crate::dungeon::Mover;
use crate::math::Vec2;
use crate::protocol::Ev;
use crate::sheet::ResolvedAbility;
use rand::Rng;
use std::f64::consts::TAU;

/// How far (px) from the caster the minions of one cast appear, evenly around it.
const MINION_RING: f64 = 22.0;

/// The types of the living monsters of caster `mi` that are among `kinds` (the lich's disciples are not skeletons).
fn living(run: &Run, mi: usize, kinds: &[EnemyType]) -> Vec<EnemyType> {
    let id = run.monsters[mi].id;
    run.monsters.iter().filter(|o| o.alive && o.owner == Some(id)).filter_map(|o| o.etype.filter(|t| kinds.contains(t))).collect()
}

/// How many minions a cast of `a` by monster `mi` raises now: its per-cast number, less what would
/// pass its alive limit. 0 for an ability that raises none.
pub fn room(run: &Run, mi: usize, a: &ResolvedAbility) -> usize {
    let Some(own) = ab::def(a.id).own.minions else { return 0 };
    let alive = living(run, mi, own.kind.raises()).len();
    (a.per_cast as usize).min((a.alive as usize).saturating_sub(alive))
}

/// Monster `mi` raises `room` minions of ability `a` around it. Each is the type with fewer living (the
/// ones just raised count), the melee one on a tie.
pub fn raise(run: &mut Run, mi: usize, a: &ResolvedAbility) {
    let Some(own) = ab::def(a.id).own.minions else { return };
    let n = room(run, mi, a);
    if n == 0 {
        return;
    }
    let (pos, id, boss) = (run.monsters[mi].pos, run.monsters[mi].id, run.monsters[mi].is_boss);
    let kinds = own.kind.raises();
    let mut count: Vec<usize> = {
        let now = living(run, mi, kinds);
        kinds.iter().map(|&t| now.iter().filter(|&&l| l == t).count()).collect()
    };
    let a0 = run.rng.gen_range(0.0..TAU);
    // The look of the raise: summoned imps are fire, a boss's skeletons dark purple.
    let k = if a.id == ab::AbilityId::SummonImps { 1 } else if boss { 2 } else { 0 };
    for i in 0..n {
        let slot = (0..kinds.len()).min_by_key(|&s| count[s]).expect("a summon raises something");
        count[slot] += 1;
        let mut spot = pos + Vec2::from_angle(a0 + i as f64 * TAU / n as f64) * MINION_RING;
        if run.layout.map.blocks_at(spot, Mover::Enemy) {
            spot = pos;
        }
        run.spawn_enemy(kinds[slot], spot, Some(id));
        run.event(Ev::Raise { x: spot.x as f32, y: spot.y as f32, k }, Some(spot));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities::AbilityId;
    use crate::defs::kinds::EntityKind;
    use crate::protocol::{BossId, ClassId};
    use crate::run::abilities::monster_use;
    use crate::run::tests::test_run;

    /// A run with only the boss and its minions, a caster of `t` 60 px from the hero.
    fn caster(t: EnemyType) -> (Run, u32, usize, Vec2) {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let id = run.spawn_enemy(t, ppos + Vec2::new(60.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        (run, id, mi, ppos)
    }

    fn owned(run: &Run, id: u32, t: EnemyType) -> usize {
        run.monsters.iter().filter(|m| m.owner == Some(id) && m.alive && m.etype == Some(t)).count()
    }

    fn living_of(run: &Run, id: u32) -> usize {
        run.monsters.iter().filter(|m| m.owner == Some(id) && m.alive).count()
    }

    #[test]
    fn a_necromancer_raises_two_and_stops_at_four() {
        let (mut run, id, ni, ppos) = caster(EnemyType::Necromancer);
        assert!(monster_use(&mut run, ni, AbilityId::RaiseDead, ppos));
        assert_eq!((living_of(&run, id), owned(&run, id, EnemyType::RaisedSkeleton), owned(&run, id, EnemyType::RaisedArcher)), (2, 1, 1));
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Raise { k: 0, .. })), "a necromancer's raise is the plain look");
        run.monsters[ni].cds = Default::default();
        assert!(monster_use(&mut run, ni, AbilityId::RaiseDead, ppos));
        assert_eq!(living_of(&run, id), 4);
        run.monsters[ni].cds = Default::default();
        assert!(!monster_use(&mut run, ni, AbilityId::RaiseDead, ppos));
        assert_eq!(living_of(&run, id), 4);
        assert!(run.monsters[ni].cds.ready(AbilityId::RaiseDead), "no cooldown spent at the limit");
    }

    #[test]
    fn a_cast_with_room_for_one_raises_one_of_the_fewer_type() {
        let (mut run, id, ni, ppos) = caster(EnemyType::Necromancer);
        for t in [EnemyType::RaisedSkeleton, EnemyType::RaisedSkeleton, EnemyType::RaisedArcher] {
            run.spawn_enemy(t, ppos, Some(id));
        }
        assert!(monster_use(&mut run, ni, AbilityId::RaiseDead, ppos));
        assert_eq!(living_of(&run, id), 4);
        assert_eq!(owned(&run, id, EnemyType::RaisedArcher), 2);
    }

    #[test]
    fn the_summoner_summons_imps_that_look_like_imps_and_die_with_it() {
        let (mut run, s, si, ppos) = caster(EnemyType::Summoner);
        run.events.clear();
        assert!(monster_use(&mut run, si, AbilityId::SummonImps, ppos));
        let imps: Vec<_> = run.monsters.iter().filter(|m| m.owner == Some(s) && m.alive).collect();
        assert_eq!(imps.len(), 2);
        assert!(imps.iter().all(|m| m.etype == Some(EnemyType::SummonedImp) && m.kind == EntityKind::Imp), "summoned imps look like imps");
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Raise { k: 1, .. })));
        run.kill_monster(si);
        assert_eq!(living_of(&run, s), 0);
    }

    #[test]
    fn a_necromancers_skeletons_die_with_it() {
        let (mut run, necro, ni, ppos) = caster(EnemyType::Necromancer);
        assert!(monster_use(&mut run, ni, AbilityId::RaiseDead, ppos));
        run.monsters[ni].cds = Default::default();
        assert!(monster_use(&mut run, ni, AbilityId::RaiseDead, ppos));
        assert!(living_of(&run, necro) >= 1);
        run.kill_monster(ni);
        assert_eq!(living_of(&run, necro), 0);
    }

    #[test]
    fn a_blocked_ring_spot_falls_back_to_the_caster() {
        use crate::dungeon::Tile;
        let (mut run, id, ni, ppos) = caster(EnemyType::Necromancer);
        let pos = run.monsters[ni].pos;
        // Walls on every tile around the caster, so every ring spot is blocked.
        let (tx, ty) = crate::dungeon::Map::tile_of(pos);
        for dy in -2..=2 {
            for dx in -2..=2 {
                if (dx, dy) != (0, 0) {
                    run.layout.map.set(tx + dx, ty + dy, Tile::Wall);
                }
            }
        }
        assert!(monster_use(&mut run, ni, AbilityId::RaiseDead, ppos));
        let minions: Vec<_> = run.monsters.iter().filter(|m| m.owner == Some(id)).collect();
        assert_eq!(minions.len(), 2);
        for m in minions {
            assert!(!run.layout.map.blocks_at(m.pos, Mover::Enemy));
            assert!(m.pos.dist(pos) < 1e-9, "on the caster's spot");
        }
    }

    #[test]
    fn other_owned_monsters_do_not_count_toward_the_limit() {
        let (mut run, id, ni, ppos) = caster(EnemyType::Necromancer);
        for _ in 0..4 {
            run.spawn_enemy(EnemyType::SkeletonWarrior, ppos, Some(id));
        }
        assert!(monster_use(&mut run, ni, AbilityId::RaiseDead, ppos));
        assert_eq!(owned(&run, id, EnemyType::RaisedSkeleton) + owned(&run, id, EnemyType::RaisedArcher), 2);
    }

    #[test]
    fn a_boss_raises_with_the_dark_look() {
        let (mut run, _, ni, ppos) = caster(EnemyType::Necromancer);
        run.monsters[ni].is_boss = true;
        run.events.clear();
        assert!(monster_use(&mut run, ni, AbilityId::RaiseDead, ppos));
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Raise { k: 2, .. })));
    }
}
