//! Dodging, part 1: which in-flight shots threaten a monster. `course_hit` replays a shot's flight with the
//! rules of `abilities::advance_projectile`, and judges a hit by `Monster::shot_dist_at`, the capsule of the real
//! hit, so a dodge that clears `course_hit` is never hit anyway.

use super::effects::Creature;
use super::abilities::{aim_reached, shot_takes, stopping_object};
use super::entities::{Dodge, Monster, Pierce};
use super::targets::{self, Side};
use super::{perception, Run};
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::attributes::Attr;
use crate::defs::damage::resolve;
use crate::defs::kinds::Anim;
use crate::defs::smarts::Smart;
use crate::math::Vec2;

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
/// It replays the flight at the very points `advance_projectile` visits (its substeps, at most 4 px apart; it never
/// tests the point it starts on, so neither does this) and applies the same stop rules, from the same helpers
/// (`aim_reached`, `opaque_at`, `stopping_object`) and the same "would it hit this creature" test (`shot_takes`).
/// It ends where the shot's life does, and where another creature would take the shot first, unless the shot flies
/// through creatures (`Pierce::Through { left > 0 }`: treated as passing any number of them, an approximation).
pub fn course_hit(run: &Run, pi: usize, mi: usize, at: Vec2, extra: f64) -> Option<f64> {
    let pr = &run.projectiles[pi];
    let m = &run.monsters[mi];
    let speed = pr.vel.len();
    if speed <= 0.0 {
        return None;
    }
    // Per tick the real flight takes `substeps` equal steps; its life runs out after a whole tick.
    let substeps = ((speed * super::DT) / 4.0).ceil().max(1.0);
    let step = speed * super::DT / substeps;
    let steps = ((pr.life / super::DT).ceil().max(0.0) * substeps) as i32;
    let flies_through = matches!(pr.pierce, Pierce::Through { left, .. } if left > 0);
    for k in 1..=steps {
        let s = k as f64 * step;
        let p = pr.pos + pr.vel * (s / speed);
        if aim_reached(pr, p) || run.layout.map.opaque_at(p) || stopping_object(run, p, pr.radius).is_some() {
            return None;
        }
        // Who the real flight takes here: heroes first, then monsters in order. `at` stands in for this monster.
        let takes_other = |j: usize| j != mi && shot_takes(run, pr, Creature::Monster(j)) && run.monsters[j].shot_dist(p) < run.monsters[j].radius + pr.radius;
        if !flies_through {
            if run.players.iter().enumerate().any(|(h, o)| shot_takes(run, pr, Creature::Player(h)) && o.pos().dist(p) < PLAYER_RADIUS + pr.radius) {
                return None;
            }
            if (0..mi).any(takes_other) {
                return None;
            }
        }
        if m.shot_dist_at(at, p) < m.radius + pr.radius + extra {
            return Some(s);
        }
        if !flies_through && (mi + 1..run.monsters.len()).any(takes_other) {
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

/// The farthest sideways step searched (px). An internal search limit, not a knob.
const MAX_STEP: f64 = 48.0;

/// Busy creatures don't dodge: a wind-up, minion cast, dash, Ground Slam, channel, a mimic's reveal hold,
/// dormant or hiding. `script_busy` is the boss script's own answer.
pub fn busy(m: &Monster, script_busy: bool) -> bool {
    script_busy
        || m.ai.windup.is_some()
        || m.ai.cast.is_some()
        || m.dash.is_some()
        || m.slam.is_some()
        || m.channel.is_some()
        || m.ai.hold > 0.0
        || m.dormant
        || m.hiding
}

/// Where monster `mi` ends up walking from its place toward `to` through the normal collision, in pieces of at
/// most 2 px.
fn walk_end(run: &Run, mi: usize, to: Vec2) -> Vec2 {
    let m = &run.monsters[mi];
    let solids = run.solids_for(m.mover, None);
    let mut p = m.pos;
    let total = p.dist(to);
    let dir = (to - p).norm();
    let mut done = 0.0;
    while done < total {
        let piece = (total - done).min(2.0);
        let v = dir * piece;
        let (x, y) = crate::collision::move_box(&run.layout.map, p.x, p.y, v.x, v.y, m.radius, m.mover, &solids);
        p = Vec2::new(x, y);
        done += piece;
    }
    p
}

/// How far (px, up to `MAX_STEP`) the monster walks along `dir` before something stops it.
fn room(run: &Run, mi: usize, dir: Vec2) -> f64 {
    let pos = run.monsters[mi].pos;
    let mut best = 0.0;
    for s in 1..=MAX_STEP as i32 {
        let s = s as f64;
        if walk_end(run, mi, pos + dir * s).dist(pos + dir * s) > 0.5 {
            break;
        }
        best = s;
    }
    best
}

fn shot_index(run: &Run, id: u32) -> Option<usize> {
    run.projectiles.iter().position(|p| p.id == id && !p.dead)
}

/// Whether the shot `t` misses monster `mi` standing at `at` by the safety margin (or is gone).
fn clears(run: &Run, mi: usize, t: &Threat, at: Vec2) -> bool {
    shot_index(run, t.shot).map_or(true, |pi| course_hit(run, pi, mi, at, run.smarts.margin).is_none())
}

/// The step for the soonest threat, or None when no side passes the reach test.
pub fn plan(run: &Run, mi: usize, threats: &[Threat]) -> Option<Dodge> {
    let t = threats.first()?;
    let m = &run.monsters[mi];
    let pi = shot_index(run, t.shot)?;
    // The reach test uses the hop's average speed for the mimic, not the phase it is in.
    let walk = m.speed * m.effects.speed_mul();
    if walk <= 0.0 {
        return None;
    }
    let n = t.dir.perp();
    let sides = [n, n * -1.0];
    let heading = m.pos - m.history.get(m.history.len().saturating_sub(5)).copied().unwrap_or(m.pos);
    let first = if heading.len() >= 0.5 {
        if sides[0].x * heading.x + sides[0].y * heading.y > 0.0 { 0 } else { 1 }
    } else if room(run, mi, sides[0]) >= room(run, mi, sides[1]) {
        0
    } else {
        1
    };
    let order = [sides[first], sides[1 - first]];
    let mut passing: Vec<(f64, Vec2)> = Vec::new();
    for side in order {
        // Reach: the longest step that still arrives in time.
        let limit = (((t.arrive - run.smarts.reaction) * walk).ceil() - 1.0).min(MAX_STEP);
        let mut s = 1.0;
        while s <= limit {
            let to = m.pos + side * s;
            if s / walk + run.smarts.reaction < t.arrive
                && course_hit(run, pi, mi, to, run.smarts.margin).is_none()
                && walk_end(run, mi, to).dist(to) <= 0.5
                && super::ai::can_rest(run, mi, to)
            {
                passing.push((s, to));
                break;
            }
            s += 1.0;
        }
    }
    let (_, to) = passing
        .iter()
        .find(|(_, to)| threats[1..].iter().all(|o| clears(run, mi, o, *to)))
        .or(passing.first())
        .copied()?;
    Some(Dodge { shot: t.shot, to, wait: run.smarts.reaction })
}

/// The hook. True when monster `mi` spent this tick dodging (the caller skips its normal behaviour).
pub fn tick(run: &mut Run, mi: usize, dt: f64, script_busy: bool) -> bool {
    let m = &run.monsters[mi];
    if !run.smarts.can(m.attrs.get(Attr::Int), Smart::Dodge) || busy(m, script_busy) || m.effects.speed_mul() <= 0.0 {
        run.monsters[mi].dodge = None;
        return false;
    }
    let ts = threats(run, mi);
    let m = &run.monsters[mi];
    // A dodge in progress carries on while its shot flies and the spot is not reached.
    let mut cur = m.dodge.filter(|d| shot_index(run, d.shot).is_some() && m.pos.dist(d.to) > 0.01);
    if let Some(d) = cur {
        let mine = ts.iter().find(|t| t.shot == d.shot).map_or(f64::INFINITY, |t| t.arrive);
        if ts.iter().any(|t| t.arrive < mine && t.shot != d.shot && !clears(run, mi, t, d.to)) {
            if let Some(new) = plan(run, mi, &ts) {
                super::debug::send_dodge(run, m.pos, new.to);
                cur = Some(new);
            }
        }
    } else if !ts.is_empty() {
        cur = plan(run, mi, &ts);
        if let Some(d) = cur {
            super::debug::send_dodge(run, m.pos, d.to);
        }
    }
    run.monsters[mi].dodge = cur;
    let Some(mut d) = cur else { return false };
    if d.wait > 0.0 {
        super::ai::count_cooldowns(run, mi, dt);
        d.wait -= dt;
        run.monsters[mi].dodge = Some(d);
        super::ai::set_anim(run, mi, Anim::Idle);
        return true;
    }
    let m = &run.monsters[mi];
    let walk = super::ai::gait(run, mi, m.speed) * m.effects.speed_mul();
    let remaining = m.pos.dist(d.to);
    let v = (d.to - m.pos).norm() * (walk * dt).min(remaining);
    let solids = run.solids_for(m.mover, None);
    let (x, y) = crate::collision::move_box(&run.layout.map, m.pos.x, m.pos.y, v.x, v.y, m.radius, m.mover, &solids);
    let moved = Vec2::new(x, y);
    let m = &mut run.monsters[mi];
    let went = moved.dist(m.pos) > 1e-9;
    m.pos = moved;
    m.dodge = if m.pos.dist(d.to) <= 0.01 || (!went && walk > 0.0) { None } else { Some(d) };
    let active = went || m.dodge.is_some();
    if active {
        super::ai::count_cooldowns(run, mi, dt); // a false return lets the normal behaviour count them
    }
    super::ai::set_anim(run, mi, Anim::Move);
    active
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities::AbilityId;
    use crate::defs::enemies::EnemyType;
    use crate::defs::kinds::EntityKind;
    use crate::dungeon::{Map, Tile};
    use crate::protocol::{BossId, ClassId};
    use crate::run::ai::tests::open_floor;
    use crate::run::entities::Monster;
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
        // s = (orc.x - pr.pos.x) - (r_orc + r_arrow). The replay visits the real flight's points (<= 2.5 px apart at
        // this speed), so it is found at most one such step late.
        let exact = (run.monsters[mi].pos.x - pr.pos.x - r_orc - r_arrow) / speed;
        assert!(pr.pos.x - run.players[0].pos().x >= 6.0, "spawned 6 px out, then fast-forwarded");
        assert!(t[0].arrive >= exact && t[0].arrive - exact <= super::super::DT / (speed * super::super::DT / 4.0).ceil() + 1e-9, "arrive {} vs {exact}", t[0].arrive);
    }

    #[test]
    fn own_side_shots_and_near_misses_are_not_threats() {
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        let from = run.monsters[mi].pos + Vec2::new(60.0, 0.0);
        let to = run.monsters[mi].pos;
        enemy_use(&mut run, EnemyType::Imp, from, AbilityId::FireBolt, to);
        assert!(threats(&run, mi).is_empty(), "an enemy's bolt does not threaten an enemy");
        run.projectiles.clear();
        // Aimed to pass about 13 px south of the orc's edge (the capsule only reaches north).
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
        // An allied orc faces an imp's Sleep Mist (0 damage).
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        let at = run.monsters[mi].pos;
        run.monsters[mi].side = Side::Friendly;
        enemy_use(&mut run, EnemyType::Imp, at + Vec2::new(60.0, 0.0), AbilityId::SleepMist, at);
        assert_eq!(run.projectiles[0].damage.amount, 0.0, "no damage");
        assert!(threats(&run, mi).is_empty(), "below the AdvancedDodge tier");
        run.smarts.needs[Smart::AdvancedDodge as usize] = 0;
        assert_eq!(threats(&run, mi).len(), 1, "with the knob at the orc's tier");

        // A lone allied skeleton (immune to Sleep) in the same spot: the shot is on course, it just cannot take hold.
        let (mut run, oi) = fixture(ClassId::ElvenRanger, 50.0);
        let at = run.monsters[oi].pos;
        run.monsters.clear();
        let sid = run.spawn_enemy(EnemyType::SkeletonWarrior, at, None);
        let si = run.monster_idx(sid).unwrap();
        run.monsters[si].side = Side::Friendly;
        run.monsters[si].ai.cd = 1e9;
        run.smarts.needs[Smart::AdvancedDodge as usize] = 0;
        enemy_use(&mut run, EnemyType::Imp, at + Vec2::new(60.0, 0.0), AbilityId::SleepMist, at);
        let si = run.monster_idx(sid).unwrap();
        assert!(course_hit(&run, 0, si, run.monsters[si].pos, 0.0).is_some(), "on course");
        assert!(threats(&run, si).is_empty(), "a skeleton is immune to Sleep");
    }

    #[test]
    fn extra_widens_the_hit_test_for_a_near_miss() {
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        let r = run.monsters[mi].radius + 2.0 + 1.0; // passes 1 px past the real hit (south side)
        fire(&mut run, AbilityId::Shoot, r.atan2(50.0), 50.0);
        let pos = run.monsters[mi].pos;
        assert!(course_hit(&run, 0, mi, pos, 0.0).is_none(), "a near miss with the real test");
        assert!(course_hit(&run, 0, mi, pos, run.smarts.margin + 2.0).is_some(), "a hit once widened");
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

    // ---- the step and the hook ----

    use crate::defs::effects::EffectKind;

    /// Floor for `r` tiles around `c`.
    fn floor_around(run: &mut Run, c: Vec2, r: i32) {
        let (tx, ty) = Map::tile_of(c);
        for y in ty - r..=ty + r {
            for x in tx - r..=tx + r {
                run.layout.map.set(x, y, Tile::Floor);
            }
        }
    }

    /// Like `fixture`, but the orc stands on a tile centre and hero 0 `dist` px west of it on its row; the notice
    /// distance is wide, so tests can pick how far the arrow starts.
    fn row(dist: f64) -> (Run, usize) {
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        let (tx, ty) = Map::tile_of(run.monsters[mi].pos);
        let at = Map::center_of(tx, ty);
        run.monsters[mi].pos = at;
        floor_around(&mut run, at, 10);
        run.players[0].mv.x = at.x - dist;
        run.players[0].mv.y = at.y;
        run.smarts.notice.value = 300.0;
        (run, mi)
    }

    /// Steps the run `n` ticks; the orc's lowest HP and its farthest sideways move from where it began.
    fn play(run: &mut Run, mi: usize, n: usize) -> (f64, f64) {
        let id = run.monsters[mi].id;
        let (start, mut low, mut side) = (run.monsters[mi].pos, run.monsters[mi].hp, 0.0f64);
        for _ in 0..n {
            run.step();
            let m = &run.monsters[run.monster_idx(id).unwrap()];
            low = low.min(m.hp);
            side = side.max((m.pos.y - start.y).abs());
        }
        (low, side)
    }

    fn dodge_lines_sent(debug: bool) -> usize {
        let (mut run, _) = fixture(ClassId::ElvenRanger, 80.0);
        run.debug = debug;
        run.players[0].debug = true;
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        run.players[0].tx = Some(tx);
        fire(&mut run, AbilityId::Shoot, 0.0, 80.0);
        for _ in 0..30 {
            run.step();
        }
        let mut n = 0;
        while let Ok(axum::extract::ws::Message::Binary(b)) = rx.try_recv() {
            let v: serde_json::Value = rmp_serde::from_slice(&b).unwrap();
            if v["t"] == "DebugDodge" {
                n += 1;
            }
        }
        n
    }

    #[test]
    fn dodge_lines_only_in_debug_runs() {
        assert_eq!(dodge_lines_sent(true), 1, "one line per plan in a debug run");
        assert_eq!(dodge_lines_sent(false), 0);
    }

    #[test]
    fn below_the_dodge_tier_an_orc_takes_the_arrow() {
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 80.0);
        run.smarts.tier_int[0] = 99;
        let hp = run.monsters[mi].hp;
        fire(&mut run, AbilityId::Shoot, 0.0, 80.0);
        let (low, _) = play(&mut run, mi, 60);
        assert!(low < hp, "the arrow hit");
    }

    #[test]
    fn at_the_tier_an_orc_steps_aside_and_the_arrow_misses() {
        // The stock numbers: notice 80 px at DEX 10 (84.8 at the orc's DEX 12), an orc of radius 6 and speed 52.
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 80.0);
        assert_eq!(run.monsters[mi].attrs.get(crate::defs::attributes::Attr::Dex), 12);
        let (hp, p0) = (run.monsters[mi].hp, run.monsters[mi].pos);
        fire(&mut run, AbilityId::Shoot, 0.0, 80.0);
        let need = run.monsters[mi].radius + 2.0 + run.smarts.margin;
        run.step();
        assert!(run.monsters[mi].dodge.is_some(), "it dodges");
        for _ in 0..60 {
            if run.monsters[mi].dodge.is_none() {
                break;
            }
            run.step();
        }
        let p = run.monsters[mi].pos;
        assert!(run.monsters[mi].dodge.is_none(), "the step is done");
        assert!((p.y - p0.y).abs() >= need - 0.5, "it stepped {} px sideways (needed {need})", (p.y - p0.y).abs());
        assert!((p.x - p0.x).abs() < 3.0, "and hardly along the shot: {}", p.x - p0.x);
        let (low, _) = play(&mut run, mi, 60);
        assert_eq!(low, hp, "the arrow missed");
    }

    #[test]
    fn a_shot_from_close_range_always_hits() {
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 20.0);
        let hp = run.monsters[mi].hp;
        // The arrow is spawned 6 px out and fast-forwarded: at 20 px it may hit before it is ever in flight.
        let sheet = crate::sheet::hero_sheet(ClassId::ElvenRanger, &crate::defs::loadout::Build::start(ClassId::ElvenRanger)).unwrap();
        run.players[0].sheet = sheet.clone();
        run.players[0].aim = 0.0;
        run.players[0].aim_dist = 20.0;
        crate::run::abilities::try_use(&mut run, 0, true, 1);
        let (low, _) = play(&mut run, mi, 30);
        assert!(low < hp);
    }

    #[test]
    fn busy_creatures_take_the_hit() {
        use crate::run::entities::{MonsterDash, Windup};
        let states: Vec<(&str, Box<dyn Fn(&mut Monster)>)> = vec![
            ("windup", Box::new(|m| m.ai.windup = Some(Windup { t: 9.0, aim: 0.0, alt: false, at: None, id: None }))),
            ("cast", Box::new(|m| m.ai.cast = Some((AbilityId::Shoot, 9.0)))),
            ("slam", Box::new(|m| m.slam = Some(9.0))),
            ("channel", Box::new(|m| {
                m.kit = crate::sheet::monster_kit(&[AbilityId::FireBreath], &m.attrs, &[], crate::sheet::Body { radius: m.radius }, &[]);
                m.channel = Some((AbilityId::FireBreath, 9.0, 1.0));
            })),
            ("hold", Box::new(|m| m.ai.hold = 9.0)),
        ];
        for (name, set) in states {
            let (mut run, mi) = fixture(ClassId::ElvenRanger, 80.0);
            let hp = run.monsters[mi].hp;
            set(&mut run.monsters[mi]);
            assert!(busy(&run.monsters[mi], false), "{name} is busy");
            fire(&mut run, AbilityId::Shoot, 0.0, 80.0);
            assert!(play(&mut run, mi, 60).0 < hp, "{name}: hit");
        }
        // A dash in progress (its kit-driven step is not run here: only the hook's answer).
        let (mut run, mi) = row(100.0);
        run.monsters[mi].dash = Some(MonsterDash { id: AbilityId::Pounce, dir: Vec2::new(-1.0, 0.0), left: 50.0, hit: Vec::new(), attack: true });
        fire(&mut run, AbilityId::Shoot, 0.0, 100.0);
        assert!(busy(&run.monsters[mi], false), "a dash is busy");
        assert!(!tick(&mut run, mi, super::super::DT, false) && run.monsters[mi].dodge.is_none(), "so no dodge");
        run.monsters[mi].dash = None;
        assert!(tick(&mut run, mi, super::super::DT, false), "and without the dash it dodges");
        let (run, mi) = fixture(ClassId::ElvenRanger, 80.0);
        assert!(!busy(&run.monsters[mi], false) && busy(&run.monsters[mi], true), "the boss script's answer counts");
    }

    #[test]
    fn a_slow_creature_starts_no_dodge_it_cannot_finish() {
        let (mut run, mi) = row(100.0);
        run.monsters[mi].speed = 5.0;
        let hp = run.monsters[mi].hp;
        fire(&mut run, AbilityId::Shoot, 0.0, 100.0);
        let ts = threats(&run, mi);
        assert_eq!(ts.len(), 1);
        assert!(plan(&run, mi, &ts).is_none());
        let id = run.monsters[mi].id;
        for _ in 0..60 {
            run.step();
            assert!(run.monsters[run.monster_idx(id).unwrap()].dodge.is_none());
        }
        assert!(run.monsters[mi].hp < hp);
    }

    #[test]
    fn a_creature_that_cannot_move_never_dodges() {
        let (mut run, mi) = row(100.0);
        run.apply_effect(Creature::Monster(mi), EffectKind::Entangled, Some(5.0));
        assert_eq!(run.monsters[mi].effects.speed_mul(), 0.0);
        let hp = run.monsters[mi].hp;
        fire(&mut run, AbilityId::Shoot, 0.0, 100.0);
        let ts = threats(&run, mi);
        assert_eq!(ts.len(), 1);
        assert!(plan(&run, mi, &ts).is_none());
        for _ in 0..60 {
            run.step();
            assert!(run.monsters[mi].dodge.is_none());
        }
        assert!(run.monsters[mi].hp < hp);
    }

    #[test]
    fn walls_block_the_step() {
        let wall = |run: &mut Run, mi: usize, dy: i32| {
            let (tx, ty) = Map::tile_of(run.monsters[mi].pos);
            run.layout.map.set(tx, ty + dy, Tile::Wall);
        };
        let (mut run, mi) = row(100.0);
        wall(&mut run, mi, -1);
        wall(&mut run, mi, 1);
        let hp = run.monsters[mi].hp;
        fire(&mut run, AbilityId::Shoot, 0.0, 100.0);
        assert!(plan(&run, mi, &threats(&run, mi)).is_none(), "walls both sides");
        let (low, _) = play(&mut run, mi, 60);
        assert!(low < hp, "hit");
        assert!(run.monsters[mi].dodge.is_none());

        let (mut run, mi) = row(100.0);
        wall(&mut run, mi, -1);
        let (hp, y0) = (run.monsters[mi].hp, run.monsters[mi].pos.y);
        fire(&mut run, AbilityId::Shoot, 0.0, 100.0);
        let d = plan(&run, mi, &threats(&run, mi)).expect("south is free");
        assert!(d.to.y > y0);
        let (low, _) = play(&mut run, mi, 60);
        assert_eq!(low, hp, "missed");
    }

    /// An orc that has been chasing hero 1 for a while (east or west of it), hero 0 `up` px north of it shooting
    /// south across its path.
    fn chase(east: f64) -> (Run, usize) {
        let mut run = crate::run::tests::test_run(&[ClassId::ElvenRanger, ClassId::ElvenRanger], BossId::Lich);
        run.monsters.clear();
        let at = run.players[0].pos() + Vec2::new(0.0, 100.0);
        floor_around(&mut run, at, 14);
        run.lights.fill();
        run.players[1].mv.x = at.x + east * 70.0;
        run.players[1].mv.y = at.y;
        run.players[0].mv.x = at.x;
        run.players[0].mv.y = at.y - 100.0;
        run.smarts.notice.value = 300.0;
        let id = run.spawn_enemy(EnemyType::OrcWarrior, at, None);
        let start = at;
        let mi2 = run.monster_idx(id).unwrap();
        run.monsters[mi2].ai.cd = 1e9;
        for _ in 0..12 {
            run.step();
        }
        assert!((run.monsters[mi2].pos.x - start.x) * east > 3.0, "it has been walking toward hero 1");
        (run, mi2)
    }

    #[test]
    fn a_chasing_orc_sidesteps_toward_its_heading() {
        for east in [1.0, -1.0] {
            let (mut run, mi) = chase(east);
            let p = run.monsters[mi].pos;
            let lead = p + Vec2::new(east * 3.0, 0.0);
            let from = run.players[0].pos();
            fire(&mut run, AbilityId::Shoot, from.angle_to(lead), from.dist(lead));
            assert!(!threats(&run, mi).is_empty(), "a threat");
            run.step();
            let m = &run.monsters[mi];
            let d = m.dodge.expect("it dodges");
            assert!((d.to.x - m.pos.x) * east > 0.0, "toward its heading ({east}): {:?} from {:?}", d.to, m.pos);
        }
    }

    #[test]
    fn a_phaser_never_ends_a_dodge_in_a_wall() {
        use crate::dungeon::Mover;
        let wall = |run: &mut Run, mi: usize, dy: i32| {
            let (tx, ty) = Map::tile_of(run.monsters[mi].pos);
            run.layout.map.set(tx, ty + dy, Tile::Wall);
        };
        // A wall on the north side: it walks through walls, but steps south, where it may rest.
        let (mut run, mi) = row(100.0);
        run.monsters[mi].mover = Mover::Incorporeal;
        wall(&mut run, mi, -1);
        let y0 = run.monsters[mi].pos.y;
        fire(&mut run, AbilityId::Shoot, 0.0, 100.0);
        let d = plan(&run, mi, &threats(&run, mi)).expect("south is free");
        assert!(d.to.y > y0, "south");
        for _ in 0..60 {
            run.step();
            let m = &run.monsters[mi];
            assert!(super::super::ai::can_rest(&run, mi, m.pos) || m.dodge.is_some(), "never rests in a wall");
        }
        // Walls on both sides: no dodge.
        let (mut run, mi) = row(100.0);
        run.monsters[mi].mover = Mover::Incorporeal;
        wall(&mut run, mi, -1);
        wall(&mut run, mi, 1);
        fire(&mut run, AbilityId::Shoot, 0.0, 100.0);
        assert!(plan(&run, mi, &threats(&run, mi)).is_none(), "walls both sides");
    }

    #[test]
    fn with_no_heading_it_steps_to_the_side_with_room() {
        let (mut run, mi) = row(100.0);
        let (tx, ty) = Map::tile_of(run.monsters[mi].pos);
        run.layout.map.set(tx, ty - 1, Tile::Wall);
        fire(&mut run, AbilityId::Shoot, 0.0, 100.0);
        assert!(run.monsters[mi].history.is_empty());
        let d = plan(&run, mi, &threats(&run, mi)).expect("a dodge");
        assert!(d.to.y > run.monsters[mi].pos.y, "south, where the room is");
        // The wall to the south instead.
        let (mut run, mi) = row(100.0);
        let (tx, ty) = Map::tile_of(run.monsters[mi].pos);
        run.layout.map.set(tx, ty + 1, Tile::Wall);
        run.layout.map.set(tx, ty - 2, Tile::Wall);
        fire(&mut run, AbilityId::Shoot, 0.0, 100.0);
        let d = plan(&run, mi, &threats(&run, mi)).expect("a dodge");
        assert!(d.to.y < run.monsters[mi].pos.y, "north");
    }

    #[test]
    fn the_dodge_ends_when_the_shot_is_gone() {
        let (mut run, mi) = row(110.0);
        fire(&mut run, AbilityId::Shoot, 0.0, 110.0);
        run.step();
        assert!(run.monsters[mi].dodge.is_some(), "dodging");
        let y = run.monsters[mi].pos.y;
        run.projectiles[0].dead = true;
        run.step();
        assert!(run.monsters[mi].dodge.is_none());
        assert!((run.monsters[mi].pos.y - y).abs() < 1.5, "the step was not carried on");
        let x = run.monsters[mi].pos.x;
        for _ in 0..10 {
            run.step();
        }
        assert!(run.monsters[mi].pos.x < x, "the normal AI runs: it chases the hero again");
    }

    #[test]
    fn reaction_delay_waits_before_stepping() {
        let (mut run, mi) = row(110.0);
        run.smarts.reaction = 0.1;
        let (hp, y0) = (run.monsters[mi].hp, run.monsters[mi].pos.y);
        fire(&mut run, AbilityId::Shoot, 0.0, 110.0);
        for t in 1..=8 {
            run.step();
            let moved = (run.monsters[mi].pos.y - y0).abs() > 1e-9;
            if t <= 5 {
                assert!(!moved, "tick {t}: still waiting (0.1 s)");
            }
            if t == 8 {
                assert!(moved, "and stepping by tick 8");
            }
        }
        let (low, side) = play(&mut run, mi, 60);
        assert_eq!(low, hp, "cleared with the delay");
        assert!(side > 5.0);
        // Close enough to clear without the delay, too close with it.
        for (reaction, hit) in [(0.0, false), (0.1, true)] {
            let (mut run, mi) = row(80.0);
            run.smarts.reaction = reaction;
            let hp = run.monsters[mi].hp;
            fire(&mut run, AbilityId::Shoot, 0.0, 80.0);
            assert_eq!(play(&mut run, mi, 60).0 < hp, hit, "reaction {reaction}");
        }
    }

    #[test]
    fn a_knockback_ends_a_dodge() {
        let (mut run, mi) = row(110.0);
        fire(&mut run, AbilityId::Shoot, 0.0, 110.0);
        run.step();
        assert!(run.monsters[mi].dodge.is_some());
        run.monsters[mi].knock = Vec2::new(0.0, 60.0);
        run.step();
        assert!(run.monsters[mi].dodge.is_none(), "no stale step after being knocked");
    }

    #[test]
    fn cooldowns_keep_counting_while_dodging() {
        let (mut run, mi) = row(110.0);
        run.monsters[mi].ai.cd = 5.0;
        run.monsters[mi].ai.alt_cd = 5.0;
        fire(&mut run, AbilityId::Shoot, 0.0, 110.0);
        for _ in 0..3 {
            run.step();
            assert!(run.monsters[mi].dodge.is_some(), "dodging");
        }
        let dt = 3.0 * super::super::DT;
        assert!((run.monsters[mi].ai.cd - (5.0 - dt)).abs() < 1e-9 && (run.monsters[mi].ai.alt_cd - (5.0 - dt)).abs() < 1e-9);
    }

    #[test]
    fn a_blocked_step_counts_cooldowns_once() {
        let (mut run, mi) = row(110.0);
        fire(&mut run, AbilityId::Shoot, 0.0, 110.0);
        run.step();
        let d = run.monsters[mi].dodge.expect("dodging");
        // A wall appears right against the orc on the side it steps to.
        let m = &run.monsters[mi];
        let sgn = (d.to.y - m.pos.y).signum();
        let (tx, ty) = Map::tile_of(m.pos);
        let ty = (ty as f64 + sgn) as i32;
        run.layout.map.set(tx, ty, Tile::Wall);
        let edge = if sgn > 0.0 { ty as f64 * crate::dungeon::TILE } else { (ty + 1) as f64 * crate::dungeon::TILE };
        run.monsters[mi].pos.y = edge - sgn * run.monsters[mi].radius;
        run.monsters[mi].ai.cd = 5.0;
        run.monsters[mi].ai.alt_cd = 5.0;
        run.step();
        assert!(run.monsters[mi].dodge.is_none(), "the blocked step ends the dodge");
        let dt = super::super::DT;
        assert!((run.monsters[mi].ai.cd - (5.0 - dt)).abs() < 1e-9 && (run.monsters[mi].ai.alt_cd - (5.0 - dt)).abs() < 1e-9, "counted once: {}", run.monsters[mi].ai.cd);
    }

    // ---- Bosses and companions (#220 task 6) ----

    /// An awake Lich with its disciples dead, on open floor, a Ranger `dist` px west of it on its row; `hp` set.
    fn lich_row(dist: f64, hp: f64) -> (Run, usize) {
        let (mut run, bi) = crate::run::bosses::lich::tests::lich_with_classes(&[ClassId::ElvenRanger], &[Vec2::new(-dist, 0.0)]);
        let ids: Vec<u32> = run.monsters.iter().filter(|m| m.etype == Some(EnemyType::Disciple)).map(|m| m.id).collect();
        for id in ids {
            let i = run.monster_idx(id).unwrap();
            run.kill_monster(i);
        }
        let bi = crate::run::bosses::boss_idx(&run).unwrap_or(bi);
        let at = run.monsters[bi].pos;
        floor_around(&mut run, at, 14);
        run.level.boss_mut().unwrap().awake = true;
        run.monsters[bi].hp = hp;
        run.smarts.notice.value = 300.0;
        (run, bi)
    }

    #[test]
    fn a_wounded_lich_dodges_an_arrow_by_the_same_rule() {
        let (mut run, bi) = lich_row(150.0, 100.0);
        assert!(run.smarts.can(run.monsters[bi].attrs.get(Attr::Int), Smart::Dodge), "the lich passes the Dodge tier");
        fire(&mut run, AbilityId::Shoot, 0.0, 150.0);
        run.step();
        assert!(run.monsters[bi].dodge.is_some(), "it steps aside");
        let (low, _) = play(&mut run, bi, 60);
        assert_eq!(low, 100.0, "the arrow missed");
        // Healthy, the same arrow is no threat to it and hits.
        let (mut run, bi) = lich_row(150.0, 900.0);
        fire(&mut run, AbilityId::Shoot, 0.0, 150.0);
        let (low, _) = play(&mut run, bi, 60);
        assert!(run.monsters[bi].dodge.is_none() && low < 900.0, "a small shot is no threat to a healthy lich: {low}");
    }

    #[test]
    fn a_busy_boss_takes_the_hit() {
        let (mut run, bi) = lich_row(150.0, 100.0);
        // Let its script start a cast.
        let busy_now = |run: &Run| run.level.boss().unwrap().behaviour.as_ref().unwrap().busy();
        for _ in 0..600 {
            if busy_now(&run) {
                break;
            }
            run.step();
        }
        assert!(busy_now(&run), "the lich is mid-cast");
        run.monsters[bi].hp = 100.0;
        run.projectiles.clear();
        fire(&mut run, AbilityId::Shoot, 0.0, 150.0);
        run.step();
        assert!(run.monsters[bi].dodge.is_none(), "a busy boss does not dodge");
        let (low, _) = play(&mut run, bi, 40);
        assert!(low < 100.0, "the arrow hit the casting lich: {low}");
    }

    #[test]
    fn the_dragon_almost_never_dodges() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Dragon);
        let bi = crate::run::bosses::boss_idx(&run).unwrap();
        let at = run.monsters[bi].pos;
        floor_around(&mut run, at, 14);
        run.monsters[bi].dormant = false;
        run.level.boss_mut().unwrap().awake = true;
        run.monsters[bi].hp = 50.0; // a threat by the threat test; the reach test decides
        run.players[0].mv.x = at.x - 120.0;
        run.players[0].mv.y = at.y;
        run.smarts.notice.value = 300.0;
        assert!(run.smarts.can(run.monsters[bi].attrs.get(Attr::Int), Smart::Dodge), "the dragon passes the Dodge tier");
        fire(&mut run, AbilityId::Shoot, 0.0, 120.0);
        run.step();
        assert!(run.monsters[bi].dodge.is_none(), "it cannot clear the arrow in time");
        let (low, _) = play(&mut run, bi, 40);
        assert!(low < 50.0, "the arrow hit the dragon: {low}");
    }

    #[test]
    fn the_wolf_dodges_an_enemy_bolt() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Lich);
        crate::run::ai::tests::open_floor(&mut run);
        run.monsters.clear();
        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        let (tx, ty) = Map::tile_of(run.monsters[wi].pos);
        let at = Map::center_of(tx, ty);
        run.monsters[wi].pos = at;
        floor_around(&mut run, at, 10);
        run.smarts.notice.value = 300.0;
        assert!(run.smarts.can(run.monsters[wi].attrs.get(Attr::Int), Smart::Dodge), "the wolf passes the Dodge tier");
        run.monsters[wi].ai.cd = 1e9;
        let hp = run.monsters[wi].hp;
        let from = at + Vec2::new(70.0, 0.0);
        let imp = enemy_use(&mut run, EnemyType::Imp, from, AbilityId::FireBolt, at);
        let ii = run.monster_idx(imp).unwrap();
        assert_eq!(threats(&run, wi).len(), 1, "an enemy's bolt threatens the wolf");
        assert!(threats(&run, ii).is_empty(), "and is no threat to the imp's own side");
        let (low, _) = play(&mut run, wi, 60);
        assert_eq!(low, hp, "the wolf stepped out of the bolt's way");
    }

    #[test]
    fn a_charmed_orc_dodges_by_its_new_side() {
        let (mut run, mi) = fixture(ClassId::ElvenRanger, 50.0);
        let src = Some((run.players[0].id, run.players[0].pos()));
        assert!(run.apply(Creature::Monster(mi), crate::run::effects::Apply { power: None, magical: true, source: src, ..crate::run::effects::Apply::plain(crate::defs::effects::EffectKind::Charmed, Some(10.0)) }));
        crate::run::charm::sync(&mut run);
        assert!(crate::run::charm::is_on(&run.monsters[mi]));
        fire(&mut run, AbilityId::Shoot, 0.0, 50.0);
        assert!(threats(&run, mi).is_empty(), "its new side's arrow is no threat");
        run.projectiles.clear();
        let at = run.monsters[mi].pos;
        enemy_use(&mut run, EnemyType::Imp, at + Vec2::new(60.0, 0.0), AbilityId::FireBolt, at);
        assert_eq!(threats(&run, mi).len(), 1, "an enemy's bolt is");
    }
}
