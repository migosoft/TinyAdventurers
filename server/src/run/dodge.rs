//! Dodging, part 1: which in-flight shots threaten a monster. `course_hit` replays a shot's flight with the
//! rules of `abilities::advance_projectile`, and judges a hit by `Monster::shot_dist_at`, the capsule of the real
//! hit, so a dodge that clears `course_hit` is never hit anyway.

use super::effects::Creature;
use super::entities::Pierce;
use super::targets::{self, Side};
use super::{perception, Run};
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::damage::resolve;
use crate::defs::smarts::Smart;
use crate::math::Vec2;

/// Px between the sampled points of a flight: `advance_projectile`'s own largest step.
const STEP: f64 = 4.0;

/// A shot that would hit a monster as it flies now.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Threat {
    /// The projectile's id.
    pub shot: u32,
    /// Seconds until the shot reaches its first hitting point on its current path.
    pub arrive: f64,
    /// Unit direction of the shot's flight.
    pub dir: Vec2,
}

/// Whether projectile `pi`, flying on as it is, would hit monster `mi` standing at `at`, and if so after how many
/// px of flight. `extra` widens the hit test (0 = the real one; `margin` for "clear").
///
/// It samples `pr.pos + pr.vel * t` every `STEP` px and stops where `advance_projectile` stops the shot: at the end
/// of its life, at its aim point, at an opaque tile, at an object that stops shots, and at another creature it
/// would hit first (unless it flies through, `Pierce::Through`).
pub fn course_hit(run: &Run, pi: usize, mi: usize, at: Vec2, extra: f64) -> Option<f64> {
    let pr = &run.projectiles[pi];
    let m = &run.monsters[mi];
    let speed = pr.vel.len();
    if speed <= 0.0 {
        return None;
    }
    // The shot's life runs out after a whole tick: it flies the tick it ends in.
    let reach = speed * super::DT * (pr.life / super::DT).ceil().max(0.0);
    let steps = (reach / STEP).ceil() as i32;
    let flies_through = matches!(pr.pierce, Pierce::Through { left, .. } if left > 0);
    for k in 0..=steps {
        let s = (k as f64 * STEP).min(reach);
        let p = pr.pos + pr.vel * (s / speed);
        if k > 0 {
            if let Some(t) = pr.target {
                if (t - p).x * pr.vel.x + (t - p).y * pr.vel.y <= 0.0 {
                    return None;
                }
            }
            if run.layout.map.opaque_at(p) {
                return None;
            }
            if run.objects.iter().any(|o| o.stops_shots() && o.pos.dist(p) < o.radius + pr.radius) {
                return None;
            }
        }
        // Who the real flight would hit here: heroes first, then monsters in order (its own side's friends
        // excepted). `at` stands in for this monster's position.
        let me = m.shot_dist_at(at, p) < m.radius + pr.radius + extra;
        let other = |j: usize, o: &super::entities::Monster| {
            j != mi
                && o.alive
                && !pr.hit.contains(&o.id)
                && o.shot_dist(p) < o.radius + pr.radius
                && if pr.side == Side::Friendly { targets::heroes_may_hit(o) && !run.passes_through(Creature::Monster(j), &pr.damage.split) } else { targets::enemies_may_hit(o) && o.sinking.is_none() }
        };
        if !flies_through {
            if pr.side != Side::Friendly && run.players.iter().any(|h| h.alive && !pr.hit.contains(&h.id) && h.pos().dist(p) < PLAYER_RADIUS + pr.radius) {
                return None;
            }
            if run.monsters.iter().enumerate().any(|(j, o)| j < mi && other(j, o)) {
                return None;
            }
        }
        if me {
            return Some(s);
        }
        if !flies_through && run.monsters.iter().enumerate().any(|(j, o)| j > mi && other(j, o)) {
            return None;
        }
    }
    None
}

/// Every shot that passes the design's tests 3-7 for monster `mi` now, soonest first. The tier test (1) and
/// busy test (2) are `tick`'s; the reach test (8) is `plan`'s.
pub fn threats(run: &Run, mi: usize) -> Vec<Threat> {
    let m = &run.monsters[mi];
    let smarts = &run.smarts;
    let notice = smarts.notice_px(&m.attrs);
    let res = m.effects.res(m.res);
    let advanced = smarts.can(m.attrs.get(crate::defs::attributes::Attr::Int), Smart::AdvancedDodge);
    let mut out = Vec::new();
    for (pi, pr) in run.projectiles.iter().enumerate() {
        if pr.dead || pr.owner == m.id || pr.hit.contains(&m.id) {
            continue;
        }
        let foe = match pr.side {
            Side::Friendly => targets::heroes_may_hit(m),
            Side::Hostile => targets::enemies_may_hit(m),
            Side::Neutral => false,
        };
        if !foe || pr.pos.dist(m.pos) > notice || !perception::sees(run, m.sight_now(), m.pos, pr.pos) {
            continue;
        }
        let Some(d) = course_hit(run, pi, mi, m.pos, 0.0) else { continue };
        if run.passes_through(Creature::Monster(mi), &pr.damage.split) {
            continue;
        }
        let dmg = resolve(&pr.damage, &res);
        let hurts = dmg > 0.0 && dmg >= smarts.threat_share * m.hp;
        if hurts || (advanced && pr.damage.on_hit.iter().any(|&h| run.would_take_hold(Creature::Monster(mi), h))) {
            out.push(Threat { shot: pr.id, arrive: d / pr.vel.len(), dir: pr.vel.norm() });
        }
    }
    out.sort_by(|a, b| a.arrive.total_cmp(&b.arrive));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities::AbilityId;
    use crate::defs::enemies::EnemyType;
    use crate::defs::kinds::EntityKind;
    use crate::defs::smarts::Smart;
    use crate::dungeon::{Map, Tile};
    use crate::protocol::{BossId, ClassId};
    use crate::run::ai::tests::open_floor;
    use crate::run::light::Lights;
    use crate::run::tests::{enemy_use, test_run};

    /// Open floor around hero 0 (of `class`), the boss gone, one orc `dist` px east of the hero that does not act.
    fn fixture(class: ClassId, dist: f64) -> (Run, usize) {
        let mut run = test_run(&[class], BossId::Lich);
        open_floor(&mut run);
        run.monsters.clear();
        let at = run.players[0].pos() + Vec2::new(dist, 0.0);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, at, None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].ai.cd = 1e9;
        (run, mi)
    }

    /// Player 0 uses `id`, lent the sheet of the first class that can hold it, aiming `aim` rad and `dist` px far.
    fn fire(run: &mut Run, id: AbilityId, aim: f64, dist: f64) {
        let owner = crate::defs::abilities::def(id).classes[0];
        let sheet = crate::sheet::hero_sheet(owner, &crate::defs::loadout::Build::start(owner)).unwrap();
        run.players[0].sheet = sheet.clone();
        run.players[0].cd1 = 0.0;
        run.players[0].cd2 = 0.0;
        run.players[0].aim = aim;
        run.players[0].aim_dist = dist;
        crate::run::abilities::try_use(run, 0, sheet.primary.id == id, 1);
        assert!(!run.projectiles.is_empty(), "{id:?} was fired");
    }

    fn dark(run: &mut Run) {
        run.lights = Lights::new(run.layout.map.w, run.layout.map.h);
        run.refresh_lights();
    }

    #[test]
    fn an_arrow_at_an_orc_is_a_threat() {
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        fire(&mut run, AbilityId::Shoot, 0.0, 50.0);
        let pr = &run.projectiles[0];
        let (r_orc, r_arrow, speed) = (run.monsters[mi].radius, pr.radius, pr.vel.len());
        let t = threats(&run, mi);
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].shot, pr.id);
        assert!((t[0].dir.x - 1.0).abs() < 1e-9 && t[0].dir.y.abs() < 1e-9);
        // The arrow is spawned 6 px from the hero's centre and fast-forwarded by half the hero's round trip
        // (spawn_shot), so it starts at `pr.pos`. It flies level with the orc, so the gap closes along x:
        // (orc.x - pr.pos.x) - s. The shot hits once that is under r_orc + r_arrow, so the first hitting point is
        // s = (orc.x - pr.pos.x) - (r_orc + r_arrow). The samples are STEP px apart, so it is found up to STEP px late.
        let exact = (run.monsters[mi].pos.x - pr.pos.x - r_orc - r_arrow) / speed;
        assert!(pr.pos.x - run.players[0].pos().x >= 6.0, "spawned 6 px out, then fast-forwarded");
        assert!(t[0].arrive >= exact && t[0].arrive - exact <= STEP / speed + 1e-9, "arrive {} vs {exact}", t[0].arrive);
    }

    #[test]
    fn own_side_shots_and_near_misses_are_not_threats() {
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        let from = run.monsters[mi].pos + Vec2::new(60.0, 0.0);
        let to = run.monsters[mi].pos;
        enemy_use(&mut run, EnemyType::Imp, from, AbilityId::FireBolt, to);
        assert!(threats(&run, mi).is_empty(), "an enemy's bolt does not threaten an enemy");
        run.projectiles.clear();
        // Aimed to pass 15 px south of the orc's edge (the capsule only reaches north).
        let r = run.monsters[mi].radius + 2.0 + 15.0;
        fire(&mut run, AbilityId::Shoot, r.atan2(50.0), 50.0);
        assert!(threats(&run, mi).is_empty(), "a near miss");
        run.projectiles.clear();
        fire(&mut run, AbilityId::Shoot, 0.0, 50.0);
        assert_eq!(threats(&run, mi).len(), 1, "the same arrow on target");
    }

    #[test]
    fn unseen_shots_are_not_threats() {
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        dark(&mut run);
        run.monsters[mi].sight.darkvision = 0.0;
        fire(&mut run, AbilityId::Shoot, 0.0, 50.0);
        assert!(threats(&run, mi).is_empty(), "an arrow in the dark, no darkvision");
        // A bolt carries its own light: an allied orc sees an imp's Fire Bolt coming.
        run.projectiles.clear();
        run.monsters[mi].side = Side::Friendly;
        let from = run.monsters[mi].pos + Vec2::new(60.0, 0.0);
        let to = run.monsters[mi].pos;
        enemy_use(&mut run, EnemyType::Imp, from, AbilityId::FireBolt, to);
        run.refresh_lights();
        assert_eq!(threats(&run, mi).len(), 1, "a Fire Bolt lights itself");
        // A wall between the arrow and the orc.
        run.projectiles.clear();
        run.monsters[mi].side = Side::Hostile;
        run.lights.fill();
        fire(&mut run, AbilityId::Shoot, 0.0, 50.0);
        assert_eq!(threats(&run, mi).len(), 1, "lit, seen, on course");
        let (wx, wy) = Map::tile_of(run.players[0].pos() + Vec2::new(28.0, 0.0));
        run.layout.map.set(wx, wy, Tile::Wall);
        assert!(threats(&run, mi).is_empty(), "behind a wall");
    }

    #[test]
    fn a_shot_that_stops_short_is_not_a_threat() {
        // A Fireball bursting at a point 20 px before the orc.
        let (mut run, mi) = fixture(ClassId::Wizard, 50.0);
        fire(&mut run, AbilityId::Fireball, 0.0, 30.0);
        assert_eq!(run.projectiles[0].target.map(|t| t.dist(run.players[0].pos())), Some(30.0));
        assert!(course_hit(&run, 0, mi, run.monsters[mi].pos, 0.0).is_none());
        assert!(threats(&run, mi).is_empty());
        // An arrow whose range ends before the orc.
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        fire(&mut run, AbilityId::Shoot, 0.0, 50.0);
        run.projectiles[0].life = 20.0 / run.projectiles[0].vel.len();
        assert!(course_hit(&run, 0, mi, run.monsters[mi].pos, 0.0).is_none());
        assert!(threats(&run, mi).is_empty());
        // A wall tile on the path.
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        fire(&mut run, AbilityId::Shoot, 0.0, 50.0);
        let (wx, wy) = Map::tile_of(run.players[0].pos() + Vec2::new(28.0, 0.0));
        run.layout.map.set(wx, wy, Tile::Wall);
        assert!(course_hit(&run, 0, mi, run.monsters[mi].pos, 0.0).is_none());
        // A crate (stops shots) on the path.
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        let at = run.players[0].pos() + Vec2::new(28.0, 0.0);
        run.spawn_object(EntityKind::Barrel, at, crate::run::objects::ObjState::Barrel(crate::run::objects::Barrel::new()));
        fire(&mut run, AbilityId::Shoot, 0.0, 50.0);
        assert!(run.objects.iter().any(|o| o.stops_shots()), "a barrel stops shots");
        assert!(course_hit(&run, 0, mi, run.monsters[mi].pos, 0.0).is_none());
        // The same arrow, nothing in the way (and the hero between is not a blocker for a hero's own shot).
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        fire(&mut run, AbilityId::Shoot, 0.0, 50.0);
        assert!(course_hit(&run, 0, mi, run.monsters[mi].pos, 0.0).is_some());
        // Another foe in front takes the arrow.
        let in_front = run.players[0].pos() + Vec2::new(25.0, 0.0);
        run.spawn_enemy(EnemyType::OrcWarrior, in_front, None);
        let mi = run.monster_idx(run.monsters[mi].id).unwrap();
        assert!(course_hit(&run, 0, mi, run.monsters[mi].pos, 0.0).is_none(), "another orc is hit first");
    }

    #[test]
    fn threat_share_scales_with_current_hp() {
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        fire(&mut run, AbilityId::Shoot, 0.0, 50.0);
        run.monsters[mi].hp = 900.0;
        assert!(threats(&run, mi).is_empty(), "900 HP ignores an arrow");
        run.monsters[mi].hp = 100.0;
        assert_eq!(threats(&run, mi).len(), 1, "100 HP does not");
    }

    #[test]
    fn advanced_dodge_counts_effects_it_would_suffer() {
        // An allied orc, and an allied skeleton at the same spot, face an imp's Sleep Mist (0 damage).
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        let at = run.monsters[mi].pos;
        run.monsters[mi].side = Side::Friendly;
        let sid = run.spawn_enemy(EnemyType::SkeletonWarrior, at + Vec2::new(0.0, 0.0), None);
        let si = run.monster_idx(sid).unwrap();
        run.monsters[si].side = Side::Friendly;
        run.monsters[si].ai.cd = 1e9;
        let from = at - Vec2::new(40.0, 0.0);
        enemy_use(&mut run, EnemyType::Imp, from, AbilityId::SleepMist, at);
        assert_eq!(run.projectiles[0].damage.amount, 0.0, "no damage");
        assert!(threats(&run, mi).is_empty(), "below the AdvancedDodge tier");
        run.smarts.needs[Smart::AdvancedDodge as usize] = 0;
        assert_eq!(threats(&run, mi).len(), 1, "with the knob at the orc's tier");
        assert!(threats(&run, si).is_empty(), "a skeleton is immune to Sleep");
    }

    #[test]
    fn shots_it_cannot_be_hurt_by_are_not_threats() {
        use crate::defs::damage::DamageType;
        use crate::defs::races::{profile, Adjust, Race};
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        fire(&mut run, AbilityId::Shoot, 0.0, 50.0);
        assert_eq!(threats(&run, mi).len(), 1);
        let prof = profile(&[Race::Incorporeal], Adjust::NONE);
        let m = &mut run.monsters[mi];
        m.res = prof.res;
        m.traits = prof.traits;
        assert!(m.traits.bodiless);
        assert!(threats(&run, mi).is_empty(), "a ghost flies the arrow through");
        // An orc fully resistant to Physical, a plain arrow.
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        fire(&mut run, AbilityId::Shoot, 0.0, 50.0);
        run.projectiles[0].damage.on_hit.clear();
        run.monsters[mi].res.set(DamageType::Physical, 1.0);
        assert!(threats(&run, mi).is_empty(), "no damage gets through");
    }

    #[test]
    fn the_capsule_matches_the_hit() {
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 60.0);
        run.monsters[mi].kind = EntityKind::Lich;
        run.monsters[mi].radius = 8.0;
        run.monsters[mi].hp = 40.0; // the arrow is a threat to it
        // The arrow flies level with the hero, 11 px north of the Lich's feet: outside a plain circle of radius
        // 8 + 2 (the arrow's), inside the capsule that reaches 12 px north.
        run.monsters[mi].pos.y += 11.0;
        let m = &run.monsters[mi];
        assert!(11.0 > m.radius + 2.0, "a plain circle would miss");
        assert!(m.shot_dist(m.pos - Vec2::new(0.0, 11.0)) < m.radius + 2.0, "the capsule does not");
        fire(&mut run, AbilityId::Shoot, 0.0, 60.0);
        assert_eq!(threats(&run, mi).len(), 1, "the capsule is on course");
        let hp = run.monsters[mi].hp;
        for _ in 0..60 {
            run.step();
        }
        assert!(run.monsters[mi].hp < hp, "and the arrow really hits it");
    }
}
