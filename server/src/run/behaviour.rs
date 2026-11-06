//! The role layer of a creature's behaviour. A creature's behaviour is role + base AI + ability
//! modules: the role (here) says whom it fights and what it does with no foe, the base AI (`BaseAi`,
//! run/ai.rs) how it moves and attacks, and the modules (run/modules.rs) what its abilities bring.

use super::entities::{AiState, Monster};
use super::perception;
use super::targets::Side;
use super::{ai, companion, modules, Run};
use crate::defs::kinds::Anim;

/// What a creature does with no orders: derived from its fields, never stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// Hostile enemies: see heroes and Friendly creatures, chase, search, return home, wander.
    Hunter,
    /// Companions: follow the leader, pick prey, fight it (run/companion.rs).
    Escort,
    /// Wild animals: calm, wander near home and fight nobody. A hit makes a fleeing one run from its
    /// attacker until it calms down; a fighting one keeps a grudge and hunts its grudge sides like a Hunter.
    Wildlife,
    /// The unrecruited knight: Neutral, stands where it was placed and does nothing.
    Waiting,
}

pub fn role(m: &Monster) -> Role {
    if m.wild.is_some() {
        Role::Wildlife
    } else if m.side == Side::Neutral {
        Role::Waiting
    } else if m.companion.is_some() {
        Role::Escort
    } else {
        Role::Hunter
    }
}

/// One tick of monster `mi`'s role, after the fear and no-act checks of `Run::step`. `active`: a hero
/// is near enough for a Hunter to think.
pub fn tick(run: &mut Run, mi: usize, dt: f64, active: bool) {
    let role = role(&run.monsters[mi]);
    // An escort first rejoins its leader (a lost one reappears, even mid-dash).
    let leader = if role == Role::Escort {
        match companion::regroup(run, mi, dt) {
            Some(pi) => Some(pi),
            None => return,
        }
    } else {
        None
    };
    // A dash in progress carries on whatever the role.
    if run.monsters[mi].dash.is_some() {
        if role == Role::Escort {
            companion::count_waits(run, mi, dt);
        }
        modules::dash_step(run, mi, dt);
        return;
    }
    match role {
        Role::Waiting => {}
        Role::Wildlife => {
            if run.layout.map.blocks_at(run.monsters[mi].pos, run.monsters[mi].mover) {
                ai::escape_terrain(run, mi, dt);
            } else if active && !wildlife_flees(run, mi, dt) {
                ai::tick_monster(run, mi, dt);
            }
        }
        Role::Escort => companion::act(run, mi, leader.expect("regroup found the leader"), dt),
        Role::Hunter => {
            if run.layout.map.blocks_at(run.monsters[mi].pos, run.monsters[mi].mover) {
                ai::escape_terrain(run, mi, dt);
            } else if active {
                ai::tick_monster(run, mi, dt);
            }
        }
    }
}

/// A `Flee` animal that has been hit runs from its attacker; true while it does. It runs at least
/// `WILD_MIN_FLEE`; after that it calms down (no fright, Idle again) when the attacker is gone, out of
/// its sight or beyond `calm_dist`. While the attacker is out of sight it runs from where it was last seen.
fn wildlife_flees(run: &mut Run, mi: usize, dt: f64) -> bool {
    let Some(w) = run.monsters[mi].wild.filter(|w| w.scare.is_some()) else { return false };
    let (pos, sight) = (run.monsters[mi].pos, run.monsters[mi].sight_now());
    let attacker = ai::living_pos(run, w.scare.expect("filtered")).filter(|&p| perception::sees(run, sight, pos, p));
    let from = attacker.unwrap_or(w.scare_from);
    let min_flee = w.min_flee - dt;
    let calm = min_flee <= 0.0 && (attacker.is_none() || pos.dist(from) > w.calm_dist);
    if let Some(w) = run.monsters[mi].wild.as_mut() {
        w.min_flee = min_flee;
        w.scare_from = from;
        if calm {
            w.scare = None;
        }
    }
    if calm {
        let m = &mut run.monsters[mi];
        m.ai.state = AiState::Idle;
        m.ai.target = None;
        m.ai.path.clear();
        ai::set_anim(run, mi, Anim::Idle);
        return false;
    }
    ai::flee_from(run, mi, from, dt);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::enemies::EnemyType;
    use crate::math::Vec2;
    use crate::protocol::{BossId, ClassId};
    use crate::run::entities::Companion;
    use crate::run::targets::Side;
    use crate::run::tests::test_run;

    #[test]
    fn roles_follow_the_fields() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        let orc = run.spawn_enemy(EnemyType::OrcWarrior, Vec2::new(100.0, 100.0), None);
        let orc = run.monster_idx(orc).unwrap();
        assert_eq!(role(&run.monsters[orc]), Role::Hunter);

        let knight = run.spawn_enemy(EnemyType::Knight, Vec2::new(120.0, 100.0), None);
        let ki = run.monster_idx(knight).unwrap();
        run.monsters[ki].side = Side::Neutral;
        assert_eq!(role(&run.monsters[ki]), Role::Waiting);
        let hero = run.players[0].id;
        let m = &mut run.monsters[ki];
        m.side = Side::Friendly;
        m.companion = Some(Companion { escort: &crate::defs::companions::KNIGHT_ESCORT, leader: hero, recruiter: hero, summoned: false, prey: None, following: false, reach_t: 0.0 });
        assert_eq!(role(&run.monsters[ki]), Role::Escort);

        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        assert_eq!(role(&run.monsters[wi]), Role::Escort);
    }

    // ---- Wildlife (#227) ----

    use crate::defs::abilities::AbilityId;
    use crate::defs::damage::{Damage, What};
    use crate::run::effects::Creature;
    use crate::run::entities::AiState;
    use crate::run::Run;

    /// A lone Paladin on open floor, no monsters but the boss.
    fn arena() -> (Run, Vec2) {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        crate::run::ai::tests::open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos();
        (run, at)
    }

    fn spawn(run: &mut Run, t: EnemyType, at: Vec2) -> usize {
        let id = run.spawn_enemy(t, at, None);
        run.monster_idx(id).unwrap()
    }

    fn steps(run: &mut Run, n: usize) {
        for _ in 0..n {
            run.step();
        }
    }

    /// A one-point hit from hero 0.
    fn hero_hit(run: &mut Run, mi: usize, amount: f64) {
        run.hurt_monster(mi, Damage::physical(amount), false, Some(0));
    }

    /// A hit from the orc `oi`, as its Strike would land.
    fn orc_hit(run: &mut Run, mi: usize, oi: usize, amount: f64) {
        let dmg = Damage::physical(amount).by(run.monsters[oi].id, What::Ability(AbilityId::Strike));
        run.hurt_monster(mi, dmg, false, None);
    }

    #[test]
    fn a_wild_animal_is_wildlife_and_neutral() {
        let (mut run, at) = arena();
        for t in [EnemyType::Bunny, EnemyType::Deer, EnemyType::Stag, EnemyType::Boar] {
            let mi = spawn(&mut run, t, at + Vec2::new(40.0, 0.0));
            assert_eq!(role(&run.monsters[mi]), Role::Wildlife, "{t:?}");
            assert_eq!(run.monsters[mi].side, Side::Neutral, "{t:?}");
        }
    }

    #[test]
    fn a_calm_animal_wanders_near_home_and_ignores_everyone() {
        let (mut run, at) = arena();
        let boar = spawn(&mut run, EnemyType::Boar, at + Vec2::new(40.0, 0.0));
        let home = run.monsters[boar].pos;
        let orc = spawn(&mut run, EnemyType::OrcWarrior, at + Vec2::new(60.0, 0.0));
        run.monsters[orc].dormant = true;
        let (hero_hp, orc_hp) = (run.players[0].hp, run.monsters[orc].hp);
        let mut moved = false;
        for _ in 0..300 {
            run.step();
            moved |= run.monsters[boar].pos.dist(home) > 1.0;
            // The wander picks home +- 24 px per axis: up to 33.9 px on the diagonal.
            assert!(run.monsters[boar].pos.dist(home) <= 34.0, "stays near home");
        }
        assert!(moved, "it wanders");
        assert_eq!((run.players[0].hp, run.monsters[orc].hp), (hero_hp, orc_hp), "it attacks no one");
        assert_eq!(run.monsters[boar].hp, run.monsters[boar].max_hp);
        assert_eq!(run.monsters[boar].grudge, Default::default());
    }

    #[test]
    fn a_hit_bunny_flees_then_calms_down() {
        let (mut run, at) = arena();
        let bunny = spawn(&mut run, EnemyType::Bunny, at + Vec2::new(20.0, 0.0));
        let hero = run.players[0].id;
        // A hit that does not kill it: the bunny has 5 HP.
        hero_hit(&mut run, bunny, 1.0);
        assert!(run.monsters[bunny].alive);
        assert_eq!(run.monsters[bunny].wild.unwrap().scare, Some(hero));
        assert_eq!(run.monsters[bunny].grudge, Default::default(), "a fleeing animal holds no grudge");
        assert!(!run.monsters[bunny].effects.has(crate::defs::effects::EffectKind::Fear), "no Fear icon");
        let start = run.monsters[bunny].pos;
        steps(&mut run, 10);
        assert!(run.monsters[bunny].pos.dist(at) > start.dist(at), "it runs from the hero");
        assert!(run.monsters[bunny].wild.unwrap().scare.is_some(), "still running");
        steps(&mut run, 180);
        assert_eq!(run.monsters[bunny].wild.unwrap().scare, None, "calm again");
        assert!(run.monsters[bunny].pos.dist(at) > 60.0, "far from the hero");
        assert!(matches!(run.monsters[bunny].ai.state, AiState::Idle));
    }

    #[test]
    fn a_deer_hit_from_afar_still_runs_for_the_minimum_time() {
        let (mut run, at) = arena();
        // The hero stands 150 px away (the floor is 8 tiles = 128 px wide each way, so move the hero left).
        run.players[0].mv.x = at.x - 100.0;
        let hero = run.players[0].pos();
        let deer = spawn(&mut run, EnemyType::Deer, hero + Vec2::new(110.0, 0.0));
        run.monsters[deer].sight = crate::defs::races::Sight { vision: 20.0, darkvision: 1.0 };
        hero_hit(&mut run, deer, 5.0);
        let d0 = run.monsters[deer].pos.dist(hero);
        assert!(d0 > crate::defs::enemies::WILD_CALM_DIST);
        steps(&mut run, 20);
        assert!(run.monsters[deer].wild.unwrap().scare.is_some(), "not calmed at once");
        assert!(run.monsters[deer].pos.dist(hero) > d0, "it moves away from the hero");
        steps(&mut run, 60);
        assert!(run.monsters[deer].wild.unwrap().scare.is_some(), "still running at 1.33 s");
        steps(&mut run, 20);
        assert_eq!(run.monsters[deer].wild.unwrap().scare, None, "calm after the minimum, far away");
    }

    #[test]
    fn a_deer_hit_in_melee_calms_down_once_far_enough_after_the_minimum() {
        let (mut run, at) = arena();
        let deer = spawn(&mut run, EnemyType::Deer, at + Vec2::new(10.0, 0.0));
        hero_hit(&mut run, deer, 5.0);
        steps(&mut run, 85);
        assert!(run.monsters[deer].wild.unwrap().scare.is_some(), "the minimum has not passed");
        steps(&mut run, 120);
        assert_eq!(run.monsters[deer].wild.unwrap().scare, None);
        assert!(run.monsters[deer].pos.dist(at) > 48.0, "it is far enough");
    }

    #[test]
    fn a_hit_with_no_attacker_scares_nothing() {
        let (mut run, at) = arena();
        let bunny = spawn(&mut run, EnemyType::Bunny, at + Vec2::new(20.0, 0.0));
        run.hurt_monster(bunny, Damage::physical(1.0), false, None);
        assert_eq!(run.monsters[bunny].wild.unwrap().scare, None);
    }

    #[test]
    fn a_hit_bunny_flees_again_on_a_new_hit() {
        // Written with a deer, which survives the first hit.
        let (mut run, at) = arena();
        let deer = spawn(&mut run, EnemyType::Deer, at + Vec2::new(20.0, 0.0));
        hero_hit(&mut run, deer, 5.0);
        steps(&mut run, 240);
        assert_eq!(run.monsters[deer].wild.unwrap().scare, None, "calm");
        hero_hit(&mut run, deer, 5.0);
        assert!(run.monsters[deer].alive);
        assert_eq!(run.monsters[deer].wild.unwrap().scare, Some(run.players[0].id), "a new hit, a new flight");
    }

    #[test]
    fn a_deer_survives_a_hero_strike_and_flees() {
        let (mut run, at) = arena();
        let orc = spawn(&mut run, EnemyType::OrcWarrior, at + Vec2::new(60.0, 0.0));
        run.monsters[orc].dormant = true;
        let strike = run.monsters[orc].kit.get(AbilityId::Strike).unwrap().damage;
        let deer = spawn(&mut run, EnemyType::Deer, at + Vec2::new(70.0, 0.0));
        orc_hit(&mut run, deer, orc, strike);
        assert!(run.monsters[deer].alive, "an orc's strike leaves it alive");
        assert_eq!(run.monsters[deer].wild.unwrap().scare, Some(run.monsters[orc].id));
        let before = run.monsters[deer].pos.dist(run.monsters[orc].pos);
        steps(&mut run, 20);
        assert!(run.monsters[deer].pos.dist(run.monsters[orc].pos) > before + 10.0, "running from the orc");
        assert_eq!(run.monsters[deer].grudge, Default::default());
    }

    #[test]
    fn a_boar_hit_by_a_hero_hunts_the_heroes_and_the_wolf_and_ignores_enemies() {
        let (mut run, at) = arena();
        let boar = spawn(&mut run, EnemyType::Boar, at + Vec2::new(40.0, 0.0));
        let orc = spawn(&mut run, EnemyType::OrcWarrior, at + Vec2::new(46.0, 0.0));
        run.monsters[orc].dormant = true;
        hero_hit(&mut run, boar, 1.0);
        assert!(run.monsters[boar].grudge.heroes && !run.monsters[boar].grudge.enemies);
        // The orc is nearer, yet the boar picks the hero.
        assert_eq!(crate::run::ai::find_visible_foe(&run, boar), Some(Creature::Player(0)));
        // Without the hero, the wolf is the foe.
        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        run.monsters[wi].pos = at + Vec2::new(30.0, 0.0);
        run.players[0].alive = false;
        assert_eq!(crate::run::ai::find_visible_foe(&run, boar), Some(Creature::Monster(wi)));
        run.players[0].alive = true;
        run.monsters[wi].alive = false;
        // It fights: the hero is hurt, the orc is not.
        let (hero_hp, orc_hp) = (run.players[0].hp, run.monsters[orc].hp);
        steps(&mut run, 180);
        assert!(run.players[0].hp < hero_hp, "the boar gores the hero");
        assert_eq!(run.monsters[orc].hp, orc_hp, "the orc is left alone");
    }

    #[test]
    fn a_boar_hit_by_an_orc_fights_the_orc_and_leaves_the_heroes_alone() {
        let (mut run, at) = arena();
        let boar = spawn(&mut run, EnemyType::Boar, at + Vec2::new(40.0, 0.0));
        let orc = spawn(&mut run, EnemyType::OrcWarrior, at + Vec2::new(60.0, 0.0));
        run.monsters[orc].dormant = true;
        orc_hit(&mut run, boar, orc, 1.0);
        assert!(run.monsters[boar].grudge.enemies && !run.monsters[boar].grudge.heroes);
        // The hero is nearer, yet the boar picks the orc.
        assert_eq!(crate::run::ai::find_visible_foe(&run, boar), Some(Creature::Monster(orc)));
        let (hero_hp, orc_hp) = (run.players[0].hp, run.monsters[orc].hp);
        steps(&mut run, 180);
        assert!(run.monsters[orc].hp < orc_hp, "the boar gores the orc");
        assert_eq!(run.players[0].hp, hero_hp, "the hero is left alone");
    }

    #[test]
    fn a_grudging_boar_that_loses_its_foe_goes_home_and_wanders() {
        let (mut run, at) = arena();
        let boar = spawn(&mut run, EnemyType::Boar, at + Vec2::new(20.0, 0.0));
        let home = run.monsters[boar].pos;
        hero_hit(&mut run, boar, 1.0);
        steps(&mut run, 30);
        assert!(matches!(run.monsters[boar].ai.state, AiState::Chase), "it hunts the hero");
        // The hero is gone: out of the boar's sight, but near enough to keep the cove awake.
        run.players[0].mv.x = home.x + 140.0;
        run.players[0].mv.y = home.y;
        let seen = |run: &Run| crate::run::ai::find_visible_foe(run, boar).is_some();
        assert!(!seen(&run), "the hero is out of its sight");
        let mut states = std::collections::HashSet::new();
        for _ in 0..900 {
            run.step();
            states.insert(std::mem::discriminant(&run.monsters[boar].ai.state));
        }
        assert!(states.contains(&std::mem::discriminant(&AiState::Search)), "it searched");
        assert!(states.contains(&std::mem::discriminant(&AiState::Return)), "it walked home");
        assert!(matches!(run.monsters[boar].ai.state, AiState::Idle), "and is calm again");
        assert!(run.monsters[boar].pos.dist(home) <= 32.0, "at home: {:?}", run.monsters[boar].pos.dist(home));
        assert!(run.monsters[boar].grudge.heroes, "the grudge stays");
    }

    #[test]
    fn a_bunny_pays_nothing() {
        let (mut run, at) = arena();
        let bunny = spawn(&mut run, EnemyType::Bunny, at + Vec2::new(20.0, 0.0));
        let (kills, xp, coins) = (run.players[0].kills, run.players[0].xp, run.players[0].coins);
        run.events.clear();
        hero_hit(&mut run, bunny, 50.0);
        assert!(!run.monsters[bunny].alive);
        assert_eq!((run.players[0].kills, run.players[0].xp, run.players[0].coins), (kills, xp, coins));
        let events: Vec<_> = run.events.iter().map(|(e, _)| e.clone()).collect();
        assert!(events.iter().any(|e| matches!(e, crate::protocol::Ev::Died { .. })));
        assert!(!events.iter().any(|e| matches!(e, crate::protocol::Ev::Msg { .. })), "no message");
    }

    #[test]
    fn a_grudging_boar_pays_xp_and_a_kill_but_no_coins() {
        let (mut run, at) = arena();
        let boar = spawn(&mut run, EnemyType::Boar, at + Vec2::new(20.0, 0.0));
        let (kills, xp, coins) = (run.players[0].kills, run.players[0].xp, run.players[0].coins);
        hero_hit(&mut run, boar, 1.0);
        hero_hit(&mut run, boar, 500.0);
        assert!(!run.monsters[boar].alive);
        assert_eq!((run.players[0].kills, run.players[0].xp, run.players[0].coins), (kills + 1, xp + 3, coins));
    }

    #[test]
    fn a_boar_killed_by_an_orc_pays_nothing() {
        let (mut run, at) = arena();
        let boar = spawn(&mut run, EnemyType::Boar, at + Vec2::new(20.0, 0.0));
        let orc = spawn(&mut run, EnemyType::OrcWarrior, at + Vec2::new(60.0, 0.0));
        run.monsters[orc].dormant = true;
        hero_hit(&mut run, boar, 1.0);
        let (kills, xp) = (run.players[0].kills, run.players[0].xp);
        orc_hit(&mut run, boar, orc, 500.0);
        assert!(!run.monsters[boar].alive);
        assert_eq!((run.players[0].kills, run.players[0].xp), (kills, xp));
    }

    #[test]
    fn a_grudging_boar_knocked_into_a_chasm_gives_the_kill() {
        use crate::dungeon::{Map, Tile};
        let (mut run, at) = arena();
        let boar = spawn(&mut run, EnemyType::Boar, at + Vec2::new(20.0, 0.0));
        let calm = spawn(&mut run, EnemyType::Boar, at + Vec2::new(20.0, 30.0));
        hero_hit(&mut run, boar, 1.0);
        let (tx, ty) = Map::tile_of(run.monsters[boar].pos);
        let (cx, cy) = Map::tile_of(run.monsters[calm].pos);
        run.layout.map.set(tx, ty, Tile::Chasm);
        run.layout.map.set(cx, cy, Tile::Chasm);
        run.monsters[calm].last_hit_by = Some(0);
        let (kills, xp) = (run.players[0].kills, run.players[0].xp);
        steps(&mut run, 120);
        assert!(run.monsters.iter().all(|m| m.is_boss), "both fell");
        assert_eq!((run.players[0].kills, run.players[0].xp), (kills + 1, xp + 3), "only the grudging boar counts");
    }

    #[test]
    fn a_sinking_wild_animal_is_no_target() {
        let (mut run, at) = arena();
        let bunny = spawn(&mut run, EnemyType::Bunny, at + Vec2::new(20.0, 0.0));
        let rule = crate::run::targets::Rule { at: run.monsters[bunny].pos, reach: 60.0, plus_radius: true, arc: None, los: false, skip_hiding: false, skip_dormant: false, skip_airborne: false, skip_invisible: false, skip_calm: false, passes: None };
        let user = crate::run::targets::stance(&run, Creature::Player(0));
        assert!(crate::run::targets::check(&run, &user, Creature::Monster(bunny), run.monsters[bunny].pos, &rule, &[]).is_ok());
        run.monsters[bunny].sinking = Some((1.0, crate::run::entities::Sink::Fall));
        assert_eq!(crate::run::targets::check(&run, &user, Creature::Monster(bunny), run.monsters[bunny].pos, &rule, &[]), Err(crate::run::targets::Skip::Dead));
    }
}
