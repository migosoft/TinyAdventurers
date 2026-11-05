//! The ambush AI of the incorporeal enemies (their kit holds Vanish): vanish on sight, drift unseen
//! through walls to the straggler of the party, warn for half a second, then strike. Everything else
//! (a hit that reveals it, Invisible running out, the strike itself) is the ordinary AI.

use super::ai::{can_rest, move_toward, set_anim, SWING_SLACK};
use super::effects::Creature;
use super::entities::Windup;
use super::Run;
use crate::defs::abilities::AbilityId;
use crate::defs::effects::EffectKind;
use crate::defs::enemies;
use crate::defs::kinds::Anim;
use crate::defs::races::Sight;
use crate::math::Vec2;

/// How long the creature shows itself (`Anim::Ambush`) before its strike lands, so a hero can step away.
pub const AMBUSH_WARNING: f64 = 0.5;

/// Two distances this close are a tie.
const TIE: f64 = 1e-6;

/// Of the living heroes visible from `from` (as `find_visible_hero` sees them), the one furthest from
/// their centre; a tie goes to the one nearest `from`. With one hero, that hero.
pub fn straggler(run: &Run, from: Vec2, sight: Sight) -> Option<usize> {
    let seen: Vec<(usize, Vec2)> = run
        .players
        .iter()
        .enumerate()
        .filter(|(_, p)| p.alive && !p.effects.has(EffectKind::Invisible))
        .map(|(i, p)| (i, p.pos()))
        .filter(|&(_, pos)| super::perception::sees(run, sight, from, pos))
        .collect();
    let n = seen.len() as f64;
    let centre = seen.iter().fold(Vec2::ZERO, |sum, &(_, p)| sum + p) * (1.0 / n);
    seen.into_iter()
        .map(|(i, p)| (i, p.dist(centre), p.dist(from)))
        .reduce(|best, c| if c.1 > best.1 + TIE || (c.1 > best.1 - TIE && c.2 < best.2) { c } else { best })
        .map(|(i, _, _)| i)
}

/// One tick of the ambush. True when it handled the tick (the caller returns); false leaves the tick to
/// the ordinary AI, which fights with the creature's main ability.
pub fn tick(run: &mut Run, mi: usize, dt: f64, seen: Option<Creature>) -> bool {
    let m = &run.monsters[mi];
    // Never interrupt an attack: Vanish would silently lose it.
    if m.ai.windup.is_some() || m.slam.is_some() {
        return false;
    }
    let (pos, sight) = (m.pos, m.sight_now());
    if !m.effects.has(EffectKind::Invisible) {
        if seen.is_some() && m.invis_cd <= 0.0 && straggler(run, pos, sight).is_some() && super::abilities::monster_use(run, mi, AbilityId::Vanish, pos) {
            set_anim(run, mi, Anim::Move);
            return true;
        }
        // Revealed early, or the time ran out: an ordinary fight.
        return false;
    }
    let Some(h) = straggler(run, pos, sight) else {
        // Nobody to haunt: wait, still unseen, until the Invisible time runs out.
        set_anim(run, mi, Anim::Idle);
        return true;
    };
    let def = enemies::def(run.monsters[mi].etype.expect("only enemies ambush"));
    let main = run.monsters[mi].kit.get(def.abilities[0]).expect("an enemy has its main ability").clone();
    let hpos = run.players[h].pos();
    let reach = main.range + run.creature_radius(Creature::Player(h)) - SWING_SLACK;
    let aim = pos.angle_to(hpos);
    run.monsters[mi].aim = aim;
    // The warning starts only where it may rest, never inside a wall.
    if pos.dist(hpos) <= reach && can_rest(run, mi, pos) {
        run.start_windup(mi, Windup { t: AMBUSH_WARNING, aim, alt: false, at: None });
        set_anim(run, mi, Anim::Ambush);
    } else {
        let speed = run.monsters[mi].speed;
        move_toward(run, mi, hpos, speed, dt);
        set_anim(run, mi, Anim::Move);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::enemies::EnemyType;
    use crate::defs::races::{self, Adjust, Race};
    use crate::dungeon::{Map, Mover, Tile, TILE};
    use crate::protocol::{BossId, ClassId};
    use crate::run::ai::tick_monster;
    use crate::run::tests::test_run;

    const DT: f64 = 1.0 / 60.0;

    /// A lit open floor around hero 0 and only the boss left; `n` Paladins stand at hero 0's spot.
    fn field(n: usize) -> Run {
        let mut run = test_run(&vec![ClassId::Paladin; n], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        run.lights.fill();
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 3..=ty + 3 {
            for x in tx - 8..=tx + 8 {
                run.layout.map.set(x, y, Tile::Floor);
            }
        }
        run
    }

    fn put_hero(run: &mut Run, pi: usize, p: Vec2) {
        run.players[pi].mv.x = p.x;
        run.players[pi].mv.y = p.y;
    }

    /// A skeleton made a phantom (as `debug_incorporeal` does) whose kit is Strike and Vanish: Strike stands
    /// in for the Touch of a Ghost, whose item (GhostTouch) comes later. Visible, Vanish ready.
    fn phantom(run: &mut Run, at: Vec2) -> usize {
        let id = run.spawn_enemy(EnemyType::SkeletonWarrior, at, None);
        let mi = run.monster_idx(id).unwrap();
        let d = enemies::def(EnemyType::SkeletonWarrior);
        let m = &mut run.monsters[mi];
        let mut list = m.races.to_vec();
        list.push(Race::Incorporeal);
        let list: &'static [Race] = Box::leak(list.into_boxed_slice());
        let prof = races::profile(list, Adjust::NONE);
        (m.races, m.res, m.effect_res, m.traits, m.mover) = (list, prof.res, prof.effect_res, prof.traits, Mover::Incorporeal);
        m.kit = crate::sheet::monster_kit(&[AbilityId::Strike, AbilityId::Vanish], &m.attrs, d.weapons, crate::sheet::Body { radius: d.radius });
        m.invis_cd = 0.0;
        mi
    }

    fn invisible(run: &Run, mi: usize) -> bool {
        run.monsters[mi].effects.has(EffectKind::Invisible)
    }

    /// One step: the effect timers, then the monster's tick.
    fn step(run: &mut Run, mi: usize) {
        run.tick_effects();
        tick_monster(run, mi, DT);
    }

    /// The monster is invisible, the hero 0 within reach at once: ready for the warning.
    fn invisible_in_reach(run: &mut Run) -> usize {
        let hero = run.players[0].pos();
        let mi = phantom(run, hero + Vec2::new(12.0, 0.0));
        step(run, mi);
        assert!(invisible(run, mi));
        mi
    }

    #[test]
    fn ghost_touch_drains_str() {
        use crate::defs::attributes::Attr;
        use crate::defs::effects::{EffectLook, OnHit};
        let mut run = field(1);
        let hero = run.players[0].pos();
        let str0 = run.players[0].sheet.attrs.get(Attr::Str);
        let ghost_cha = enemies::def(EnemyType::Ghost).attrs.get(Attr::Cha);
        // The kit's Touch carries the drain: magical, its power the Ghost's CHA.
        let kit = crate::sheet::kit_for(crate::sheet::KitSource::Enemy(EnemyType::Ghost), &enemies::def(EnemyType::Ghost).attrs);
        let want = OnHit { kind: EffectKind::Weakened, secs: 20.0, magical: true, power: ghost_cha, look: EffectLook::Plain };
        assert_eq!(kit.get(AbilityId::Touch).unwrap().on_hit, vec![want]);
        // And a Touch that lands on a hero weakens them.
        crate::run::tests::enemy_use(&mut run, EnemyType::Ghost, hero + Vec2::new(12.0, 0.0), AbilityId::Touch, hero);
        for _ in 0..60 {
            run.step();
        }
        assert!(run.players[0].effects.has(EffectKind::Weakened), "the touch weakens the hero");
        assert!(run.players[0].sheet.attrs.get(Attr::Str) < str0);
    }

    #[test]
    fn shade_touch_drains_con() {
        use crate::defs::attributes::Attr;
        use crate::defs::effects::{EffectLook, OnHit};
        let mut run = field(1);
        let hero = run.players[0].pos();
        let con0 = run.players[0].sheet.attrs.get(Attr::Con);
        let shade_cha = enemies::def(EnemyType::Shade).attrs.get(Attr::Cha);
        let kit = crate::sheet::kit_for(crate::sheet::KitSource::Enemy(EnemyType::Shade), &enemies::def(EnemyType::Shade).attrs);
        let want = OnHit { kind: EffectKind::Frail, secs: 20.0, magical: true, power: shade_cha, look: EffectLook::Plain };
        assert_eq!(kit.get(AbilityId::Touch).unwrap().on_hit, vec![want]);
        crate::run::tests::enemy_use(&mut run, EnemyType::Shade, hero + Vec2::new(12.0, 0.0), AbilityId::Touch, hero);
        for _ in 0..60 {
            run.step();
        }
        assert!(run.players[0].effects.has(EffectKind::Frail), "the touch drains CON");
        assert!(run.players[0].sheet.attrs.get(Attr::Con) < con0);
    }

    #[test]
    fn straggler_is_furthest_from_the_centre() {
        let mut run = field(3);
        let p = run.players[0].pos();
        put_hero(&mut run, 1, p + Vec2::new(10.0, 0.0));
        put_hero(&mut run, 2, p + Vec2::new(100.0, 0.0));
        let mi = phantom(&mut run, p + Vec2::new(40.0, 20.0));
        assert_eq!(straggler(&run, run.monsters[mi].pos, run.monsters[mi].sight_now()), Some(2));
    }

    #[test]
    fn straggler_alone_is_that_hero() {
        let mut run = field(1);
        let p = run.players[0].pos();
        let mi = phantom(&mut run, p + Vec2::new(40.0, 0.0));
        assert_eq!(straggler(&run, run.monsters[mi].pos, run.monsters[mi].sight_now()), Some(0));
    }

    #[test]
    fn straggler_tie_goes_to_the_nearest() {
        let mut run = field(2);
        let p = run.players[0].pos();
        put_hero(&mut run, 1, p + Vec2::new(100.0, 0.0));
        let mi = phantom(&mut run, p + Vec2::new(-30.0, 0.0));
        assert_eq!(straggler(&run, run.monsters[mi].pos, run.monsters[mi].sight_now()), Some(0));
        let mi = phantom(&mut run, p + Vec2::new(130.0, 0.0));
        assert_eq!(straggler(&run, run.monsters[mi].pos, run.monsters[mi].sight_now()), Some(1));
    }

    #[test]
    fn vanishes_on_sight() {
        let mut run = field(1);
        let at = run.players[0].pos() + Vec2::new(5.0 * TILE, 0.0);
        let mi = phantom(&mut run, at);
        assert!(!invisible(&run, mi));
        step(&mut run, mi);
        assert!(invisible(&run, mi));
    }

    /// What the phantom sees may be an ally (the ranger's wolf): no hero to haunt, so no Vanish to waste.
    #[test]
    fn sight_of_only_a_companion_does_not_vanish() {
        let mut run = field(1);
        let hero = run.players[0].pos();
        let mi = phantom(&mut run, hero + Vec2::new(5.0 * TILE, 0.0));
        // A wall between them: the hero is out of sight, something else (a companion) is not.
        let (tx, ty) = Map::tile_of(hero + Vec2::new(2.0 * TILE, 0.0));
        for y in ty - 3..=ty + 3 {
            run.layout.map.set(tx, y, Tile::Wall);
        }
        assert!(!tick(&mut run, mi, DT, Some(Creature::Monster(mi))));
        assert!(!invisible(&run, mi));
        assert_eq!(run.monsters[mi].invis_cd, 0.0, "Vanish was not spent");
    }

    #[test]
    fn drifts_through_a_wall_to_the_straggler() {
        let mut run = field(1);
        let hero = run.players[0].pos();
        // The phantom starts inside a wall tile, a pace from its edge: an ordinary walker could not leave it.
        let (tx, ty) = Map::tile_of(hero + Vec2::new(5.0 * TILE, 0.0));
        run.layout.map.set(tx, ty, Tile::Wall);
        let start = Vec2::new(tx as f64 * TILE + 1.0, ty as f64 * TILE + TILE / 2.0);
        put_hero(&mut run, 0, Vec2::new(start.x - 4.0 * TILE, start.y));
        let mi = phantom(&mut run, start);
        for _ in 0..300 {
            step(&mut run, mi);
            if run.monsters[mi].ai.windup.is_some() {
                break;
            }
            assert!(invisible(&run, mi), "unseen all the way");
        }
        let m = &run.monsters[mi];
        assert!(m.ai.windup.is_some() && m.anim == Anim::Ambush, "it reached the hero and warns");
        assert!(m.pos.x < start.x - TILE, "it left the wall");
        assert!(m.pos.dist(run.players[0].pos()) < TILE * 2.0, "and stands next to the hero");
    }

    #[test]
    fn warns_before_striking() {
        let mut run = field(1);
        let mi = invisible_in_reach(&mut run);
        let hp = run.players[0].hp;
        step(&mut run, mi);
        assert_eq!(run.monsters[mi].anim, Anim::Ambush);
        assert!(!invisible(&run, mi), "the warning shows it");
        for _ in 0..(AMBUSH_WARNING / DT) as usize - 2 {
            step(&mut run, mi);
            assert_eq!(run.players[0].hp, hp, "no hit during the warning");
            assert_eq!(run.monsters[mi].anim, Anim::Ambush);
        }
        for _ in 0..4 {
            step(&mut run, mi);
        }
        assert!(run.players[0].hp < hp, "the strike lands");
    }

    #[test]
    fn dodging_the_warning_avoids_the_hit() {
        let mut run = field(1);
        let mi = invisible_in_reach(&mut run);
        step(&mut run, mi);
        assert_eq!(run.monsters[mi].anim, Anim::Ambush);
        let hp = run.players[0].hp;
        let away = run.monsters[mi].pos + Vec2::new(-4.0 * TILE, 0.0);
        put_hero(&mut run, 0, away);
        for _ in 0..40 {
            step(&mut run, mi);
        }
        assert_eq!(run.players[0].hp, hp);
    }

    #[test]
    fn gives_up_after_the_invisible_time() {
        let mut run = field(1);
        let hero = run.players[0].pos();
        let mi = phantom(&mut run, hero + Vec2::new(5.0 * TILE, 0.0));
        step(&mut run, mi);
        assert!(invisible(&run, mi));
        // The hero is behind a wall: the phantom waits, unseen, and Invisible runs out.
        let (tx, ty) = Map::tile_of(hero + Vec2::new(2.0 * TILE, 0.0));
        for y in ty - 3..=ty + 3 {
            run.layout.map.set(tx, y, Tile::Wall);
        }
        for _ in 0..(crate::defs::abilities::AMBUSH_MAX_INVISIBLE / DT) as usize + 2 {
            step(&mut run, mi);
            assert!(run.monsters[mi].ai.windup.is_none());
        }
        assert!(!invisible(&run, mi), "visible again");
        // Seen again at once (the wall is gone) it fights normally: the cooldown holds Vanish back.
        for y in ty - 3..=ty + 3 {
            run.layout.map.set(tx, y, Tile::Floor);
        }
        let beside = run.monsters[mi].pos + Vec2::new(-12.0, 0.0);
        put_hero(&mut run, 0, beside);
        step(&mut run, mi);
        assert!(!invisible(&run, mi));
        assert_eq!(run.monsters[mi].anim, Anim::Windup, "ordinary Chase");
    }

    #[test]
    fn never_vanishes_mid_windup() {
        let mut run = field(1);
        let at = run.players[0].pos() + Vec2::new(12.0, 0.0);
        let mi = phantom(&mut run, at);
        run.monsters[mi].ai.windup = Some(Windup { t: 0.4, aim: 0.0, alt: false, at: None });
        assert!(!tick(&mut run, mi, DT, Some(Creature::Player(0))));
        assert!(!invisible(&run, mi));
        run.monsters[mi].ai.windup = None;
        run.monsters[mi].slam = Some(0.4);
        assert!(!tick(&mut run, mi, DT, Some(Creature::Player(0))));
        assert!(!invisible(&run, mi));
    }

    #[test]
    fn revanishes_when_ready() {
        let mut run = field(1);
        let mi = invisible_in_reach(&mut run);
        for _ in 0..40 {
            step(&mut run, mi);
        }
        assert!(!invisible(&run, mi), "visible after the strike");
        assert!(run.monsters[mi].invis_cd > 0.0);
        run.monsters[mi].invis_cd = DT * 2.0;
        let mut vanished = false;
        for _ in 0..4 {
            step(&mut run, mi);
            vanished |= invisible(&run, mi);
        }
        assert!(vanished, "vanished again once ready");
    }

    #[test]
    fn a_dead_target_hands_over_to_the_next_straggler() {
        let mut run = field(2);
        let p = run.players[0].pos();
        put_hero(&mut run, 1, p + Vec2::new(100.0, 0.0));
        let mi = phantom(&mut run, p + Vec2::new(60.0, 30.0));
        step(&mut run, mi);
        let sight = run.monsters[mi].sight_now();
        let first = straggler(&run, run.monsters[mi].pos, sight).unwrap();
        run.players[first].alive = false;
        let other = 1 - first;
        step(&mut run, mi);
        assert_eq!(straggler(&run, run.monsters[mi].pos, sight), Some(other));
        assert!(invisible(&run, mi) && run.monsters[mi].anim == Anim::Move);
    }

    #[test]
    fn with_nobody_in_sight_it_waits_invisible() {
        let mut run = field(1);
        let hero = run.players[0].pos();
        let mi = phantom(&mut run, hero + Vec2::new(5.0 * TILE, 0.0));
        step(&mut run, mi);
        run.players[0].alive = false;
        let at = run.monsters[mi].pos;
        for _ in 0..30 {
            step(&mut run, mi);
        }
        assert_eq!(run.monsters[mi].pos, at, "no drifting");
        assert!(invisible(&run, mi));
        assert_eq!(run.monsters[mi].anim, Anim::Idle);
    }

    #[test]
    fn no_warning_inside_a_wall() {
        let mut run = field(1);
        let hero = run.players[0].pos();
        let (tx, ty) = Map::tile_of(hero + Vec2::new(3.0 * TILE, 0.0));
        run.layout.map.set(tx, ty, Tile::Wall);
        let start = Vec2::new(tx as f64 * TILE + 1.0, ty as f64 * TILE + TILE / 2.0);
        put_hero(&mut run, 0, Vec2::new(start.x - 11.0, start.y));
        let mi = phantom(&mut run, start);
        let mut walled_ticks = 0;
        for _ in 0..120 {
            let rests = can_rest(&run, mi, run.monsters[mi].pos);
            step(&mut run, mi);
            if !rests && invisible(&run, mi) {
                walled_ticks += 1;
            }
            if run.monsters[mi].ai.windup.is_some() {
                assert!(rests, "the warning began inside a wall");
                break;
            }
        }
        assert!(walled_ticks > 0, "it did start in the wall");
        assert!(run.monsters[mi].ai.windup.is_some(), "and warned once out of it");
    }

    #[test]
    fn revealed_early_it_fights_without_a_warning() {
        let mut run = field(1);
        let mi = invisible_in_reach(&mut run);
        let hp = run.players[0].hp;
        run.hurt_monster(mi, crate::defs::damage::Damage::new(1.0, crate::defs::damage::DamageSplit::pure(crate::defs::damage::DamageType::Magical)), false, Some(0));
        assert!(!invisible(&run, mi), "the hit reveals it");
        // A hit staggers it for a moment; then an ordinary attack, never the warning.
        for _ in 0..60 {
            step(&mut run, mi);
            assert_ne!(run.monsters[mi].anim, Anim::Ambush);
            assert!(!invisible(&run, mi), "its cooldown holds Vanish back");
        }
        assert!(run.players[0].hp < hp, "it fought");
    }
}
