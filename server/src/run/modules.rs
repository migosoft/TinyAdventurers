//! The module layer of a creature's behaviour: what an ability brings with it. `AbilityDef.module` names
//! the module; the base AI (run/ai.rs) asks the kit's modules, in kit order, at fixed points. A hook
//! returns true when its module claimed the tick, else the base AI goes on. Giving a creature the
//! ability gives it the behaviour.

use super::effects::Creature;
use super::entities::MonsterDash;
use super::Run;
use crate::defs::abilities::{self as ab, AbilityId, Module};

/// The dash that just ended (what `tick_monster_dash` returns).
pub type DashDone = MonsterDash;

/// The modules of monster `mi`'s kit, in kit order.
fn kit_modules(run: &Run, mi: usize) -> Vec<Module> {
    run.monsters[mi].kit.iter().filter_map(|a| ab::def(a.id).module).collect()
}

/// A foe may be in sight (`seen`): Ambush vanishes, drifts and strikes.
pub fn on_sight(run: &mut Run, mi: usize, dt: f64, seen: Option<Creature>) -> bool {
    for module in kit_modules(run, mi) {
        let claimed = match module {
            Module::Ambush => super::ambush::tick(run, mi, dt, seen),
            Module::Leap | Module::Minions => false,
        };
        if claimed {
            return true;
        }
    }
    false
}

/// Where the base AI would choose its attack: Minions run a cast or start one.
pub fn on_act(run: &mut Run, mi: usize, dt: f64, seen: Option<Creature>) -> bool {
    for module in kit_modules(run, mi) {
        let claimed = match module {
            Module::Minions => super::minions::act(run, mi, dt, seen),
            Module::Leap | Module::Ambush => false,
        };
        if claimed {
            return true;
        }
    }
    false
}

/// A wind-up for ability `id` ran out. No module winds up an ability yet (`Windup.id` is None until the Leap module).
pub fn on_windup_end(_run: &mut Run, _mi: usize, _id: AbilityId, _seen: Option<Creature>) -> bool {
    false
}

/// One of the creature's dashes finished. No module reads it yet (the Leap module does; the wolf's script still handles it).
#[allow(dead_code)] // called by the Leap module's wiring (#227)
pub fn on_dash_end(_run: &mut Run, _mi: usize, _done: &DashDone) {}

/// The creature stands on ground it cannot survive (`tile`). No module claims it yet.
#[allow(dead_code)] // called by the Leap module's wiring (#227)
pub fn on_danger(_run: &mut Run, _mi: usize, _tile: u8) -> bool {
    false
}
