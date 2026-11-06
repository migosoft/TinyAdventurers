//! The role layer of a creature's behaviour. A creature's behaviour is role + base AI + ability
//! modules: the role (here) says whom it fights and what it does with no foe, the base AI (`BaseAi`,
//! run/ai.rs) how it moves and attacks, and the modules (run/modules.rs) what its abilities bring.

use super::entities::Monster;
use super::targets::Side;
use super::{ai, companion, modules, Run};

/// What a creature does with no orders: derived from its fields, never stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// Hostile enemies: see heroes and Friendly creatures, chase, search, return home, wander.
    Hunter,
    /// Companions: follow the leader, pick prey, fight it (run/companion.rs).
    Escort,
    /// Animals: calm, wander near home, ignore everyone. Nothing is Wildlife yet (#227, wildlife comes with `Monster.wild`).
    #[allow(dead_code)]
    Wildlife,
    /// The unrecruited knight: Neutral, stands where it was placed and does nothing.
    Waiting,
}

pub fn role(m: &Monster) -> Role {
    if m.side == Side::Neutral {
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
        modules::dash_step(run, mi, dt);
        return;
    }
    match role {
        Role::Waiting | Role::Wildlife => {}
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
}
