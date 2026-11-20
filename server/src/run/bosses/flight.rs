//! A boss's flight: take-off, hovering, landing with a Smash, then a wait until the next flight. The
//! script owns what the boss does in the air; this owns the phases and their timers.

use super::{ahead, set_anim, target};
use crate::collision::walk_line;
use crate::dungeon::{Map, Mover};
use crate::math::Vec2;
use crate::run::ai::move_toward;
use crate::defs::abilities::AbilityId;
use crate::defs::kinds::Anim;
use crate::run::abilities::monster_use;
use crate::run::Run;
use rand::Rng;

/// The seconds of each phase and the wait between flights.
#[derive(Clone, Copy)]
pub struct FlightTimes {
    pub takeoff: f64,
    pub air: f64,
    pub land: f64,
    /// The wait between flights, drawn from this range (s).
    pub every: (f64, f64),
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Phase {
    Ground,
    TakeOff,
    Air,
    Land,
}

/// Whether a circle of the boss's radius at `p` stands wholly on ground its own `mover` can stand on, clear of
/// solid objects.
pub(crate) fn holds(run: &Run, bi: usize, p: Vec2) -> bool {
    let m = &run.monsters[bi];
    let r = m.radius;
    let (x0, y0) = Map::tile_of(Vec2::new(p.x - r, p.y - r));
    let (x1, y1) = Map::tile_of(Vec2::new(p.x + r - 1e-6, p.y + r - 1e-6));
    (y0..=y1).all(|y| (x0..=x1).all(|x| !run.layout.map.blocks(x, y, m.mover)))
        && !run.objects.iter().any(|o| o.blocks() && (p.x - o.pos.x).abs() < o.radius + r && (p.y - o.pos.y).abs() < o.radius + r)
}

/// The spot to land on from the boss's position: the target's, if it holds, else the nearest tile centre
/// within 12 tiles that does and that a straight flight reaches past walls and barriers (ties by scan order,
/// y then x).
fn landing_spot(run: &Run, bi: usize, use_target: bool) -> Option<Vec2> {
    if let Some((_, at, _)) = target(run, bi).filter(|_| use_target) {
        if holds(run, bi, at) {
            return Some(at);
        }
    }
    let pos = run.monsters[bi].pos;
    let (tx, ty) = Map::tile_of(pos);
    let mut best: Option<(f64, Vec2)> = None;
    for dy in -12..=12 {
        for dx in -12..=12 {
            let c = Map::center_of(tx + dx, ty + dy);
            let d = c.dist(pos);
            if best.map_or(true, |(bd, _)| d < bd) && holds(run, bi, c) && walk_line(&run.layout.map, pos, c, Mover::Dash) {
                best = Some((d, c));
            }
        }
    }
    best.map(|(_, c)| c)
}

pub struct Flight {
    pub phase: Phase,
    /// Seconds until the next flight (Ground) or left of the phase.
    pub t: f64,
    times: FlightTimes,
    /// This landing could not fly to the target: it heads for the nearest holding tile instead. Cleared on landing.
    gave_up: bool,
}

impl Flight {
    /// On the ground, the first flight in `first` seconds.
    pub fn new(times: FlightTimes, first: f64) -> Flight {
        Flight { phase: Phase::Ground, t: first, times, gave_up: false }
    }

    pub fn in_air(&self) -> bool {
        self.phase == Phase::Air
    }

    pub fn grounded(&self) -> bool {
        self.phase == Phase::Ground
    }

    /// One tick. `acting`: the script is mid-action (no take-off, no landing meanwhile). True while the
    /// flight takes over the turn.
    pub fn tick(&mut self, run: &mut Run, bi: usize, dt: f64, acting: bool) -> bool {
        self.t -= dt;
        match self.phase {
            Phase::Ground => {
                if self.t > 0.0 || acting {
                    return false;
                }
                self.phase = Phase::TakeOff;
                self.t = self.times.takeoff;
                set_anim(run, bi, Anim::TakeOff);
                true
            }
            Phase::TakeOff => {
                if self.t <= 0.0 {
                    self.phase = Phase::Air;
                    self.t = self.times.air;
                    run.monsters[bi].airborne = true;
                    set_anim(run, bi, Anim::Idle);
                }
                true
            }
            Phase::Air => {
                // Lands once the flight is over and an action under way has ended.
                if self.t > 0.0 || acting {
                    return false;
                }
                let pos = run.monsters[bi].pos;
                if !holds(run, bi, pos) {
                    // Over a hole: fly to ground that holds the whole body, then land.
                    match landing_spot(run, bi, !self.gave_up) {
                        Some(goal) => {
                            let speed = run.monsters[bi].speed;
                            if move_toward(run, bi, goal, speed, dt) {
                                // `move_toward` stops short of the goal; it holds, so stand on it and land next tick.
                                run.monsters[bi].pos = goal;
                            } else if run.monsters[bi].pos.dist(pos) < speed * dt * 0.25 {
                                // Hardly any progress (a barrier, a wall or an object in the way, sliding along it): drop
                                // the target as the goal.
                                self.gave_up = true;
                            }
                            set_anim(run, bi, Anim::Move);
                        }
                        None => set_anim(run, bi, Anim::Idle),
                    }
                    return true;
                }
                self.phase = Phase::Land;
                self.t = self.times.land;
                set_anim(run, bi, Anim::Land);
                true
            }
            Phase::Land => {
                if self.t <= 0.0 {
                    if !holds(run, bi, run.monsters[bi].pos) {
                        // Moved over a hole during the landing: do not touch down, fly on to ground.
                        self.phase = Phase::Air;
                        self.t = 0.0;
                        return true;
                    }
                    let at = ahead(run, bi);
                    monster_use(run, bi, AbilityId::Smash, at);
                    run.monsters[bi].airborne = false;
                    self.gave_up = false;
                    self.phase = Phase::Ground;
                    self.t = run.rng.gen_range(self.times.every.0..self.times.every.1);
                    set_anim(run, bi, Anim::Idle);
                }
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::damage::What;
    use crate::dungeon::Tile;
    use crate::protocol::{BossId, ClassId};
    use crate::run::bosses::boss_idx;
    use crate::run::tests::test_run;
    use crate::run::DT;

    const TIMES: FlightTimes = FlightTimes { takeoff: 0.5, air: 3.5, land: 0.6, every: (10.0, 12.0) };

    fn dragon_run() -> (Run, usize) {
        let mut run = test_run(&[ClassId::Paladin], BossId::Dragon);
        let bi = boss_idx(&run).unwrap();
        run.monsters[bi].dormant = false;
        run.monsters[bi].aim = 0.0;
        let at = run.monsters[bi].pos;
        run.players[0].mv.x = at.x + 20.0;
        run.players[0].mv.y = at.y;
        (run, bi)
    }

    fn ticks(f: &mut Flight, run: &mut Run, bi: usize, secs: f64, acting: bool) {
        for _ in 0..(secs / DT).ceil() as usize {
            f.tick(run, bi, DT, acting);
        }
    }

    #[test]
    fn a_flight_runs_its_four_phases() {
        let (mut run, bi) = dragon_run();
        let mut f = Flight::new(TIMES, 0.0);
        assert!(f.tick(&mut run, bi, DT, false), "the take-off takes the turn");
        assert_eq!(f.phase, Phase::TakeOff);
        assert_eq!(run.monsters[bi].anim, Anim::TakeOff);
        assert!(!run.monsters[bi].airborne);
        ticks(&mut f, &mut run, bi, 0.5 + DT, false);
        assert_eq!(f.phase, Phase::Air);
        assert!(f.in_air() && run.monsters[bi].airborne);
        assert_eq!(run.monsters[bi].anim, Anim::Idle);
        assert!(!f.tick(&mut run, bi, DT, false), "in the air the script has the turn");
        ticks(&mut f, &mut run, bi, 3.5 + DT, false);
        assert_eq!(f.phase, Phase::Land);
        assert_eq!(run.monsters[bi].anim, Anim::Land);
        assert!(run.monsters[bi].airborne, "still up while landing");
        let hp = run.players[0].hp;
        ticks(&mut f, &mut run, bi, 0.6 + DT, false);
        assert!(f.grounded() && !run.monsters[bi].airborne);
        assert!(run.players[0].hp < hp, "the landing smash hits");
        assert_eq!(run.last_hit.clone().expect("a hit").why.what, What::Ability(AbilityId::Smash));
        assert!((10.0..12.0).contains(&f.t), "next flight in 10-12 s: {}", f.t);
    }

    #[test]
    fn acting_holds_take_off_and_landing() {
        let (mut run, bi) = dragon_run();
        let mut f = Flight::new(TIMES, 0.0);
        ticks(&mut f, &mut run, bi, 1.0, true);
        assert!(f.grounded() && f.t <= 0.0, "no take-off while acting");
        assert!(f.tick(&mut run, bi, DT, false));
        assert_eq!(f.phase, Phase::TakeOff);

        let mut f = Flight { phase: Phase::Air, t: 1.0, times: TIMES, gave_up: false };
        ticks(&mut f, &mut run, bi, 2.0, true);
        assert!(f.in_air(), "no landing while acting");
        f.tick(&mut run, bi, DT, false);
        assert_eq!(f.phase, Phase::Land);
    }

    /// A dragon in the air with its time up, over a 5 x 5 block of chasm, and a hero on floor beyond.
    fn over_a_hole(hero_alive: bool) -> (Run, usize, Flight) {
        over_a_hole_with(hero_alive, |tx, ty| crate::dungeon::Map::center_of(tx + 6, ty))
    }

    fn over_a_hole_with(hero_alive: bool, hero_at: impl Fn(i32, i32) -> Vec2) -> (Run, usize, Flight) {
        let (mut run, bi) = dragon_run();
        run.objects.clear();
        let (tx, ty) = crate::dungeon::Map::tile_of(run.monsters[bi].pos);
        for dy in -2..=2 {
            for dx in -2..=2 {
                run.layout.map.set(tx + dx, ty + dy, Tile::Chasm);
            }
        }
        for dy in -2..=2 {
            for dx in 3..=8 {
                run.layout.map.set(tx + dx, ty + dy, Tile::Floor);
            }
        }
        let far = hero_at(tx, ty);
        run.players[0].mv.x = far.x;
        run.players[0].mv.y = far.y;
        if !hero_alive {
            run.players[0].hp = 0.0;
            run.players[0].alive = false;
        }
        run.monsters[bi].airborne = true;
        let mut f = Flight::new(TIMES, 100.0);
        f.phase = Phase::Air;
        f.t = 0.0;
        (run, bi, f)
    }

    fn lands_on_ground(mut run: Run, bi: usize, mut f: Flight) {
        let mut landing = false;
        for _ in 0..(20.0 / DT) as usize {
            f.tick(&mut run, bi, DT, false);
            let pos = run.monsters[bi].pos;
            if run.monsters[bi].anim == Anim::Land {
                landing = true;
                assert!(holds(&run, bi, pos), "it begins to land over ground that holds it");
            }
            if f.grounded() {
                break;
            }
        }
        assert!(landing && f.grounded(), "it lands within 20 s");
        assert!(!run.monsters[bi].airborne);
        assert!(holds(&run, bi, run.monsters[bi].pos));
    }

    #[test]
    fn it_does_not_land_over_a_hole() {
        let (run, bi, f) = over_a_hole(true);
        assert!(!holds(&run, bi, run.monsters[bi].pos), "it starts over the hole");
        lands_on_ground(run, bi, f);
    }

    #[test]
    fn it_lands_without_a_target() {
        let (run, bi, f) = over_a_hole(false);
        assert!(target(&run, bi).is_none(), "nobody to aim for");
        lands_on_ground(run, bi, f);
    }

    #[test]
    fn it_lands_at_once_on_ground() {
        let (mut run, bi) = dragon_run();
        run.objects.clear();
        assert!(holds(&run, bi, run.monsters[bi].pos));
        run.monsters[bi].airborne = true;
        let mut f = Flight::new(TIMES, 100.0);
        f.phase = Phase::Air;
        f.t = 0.0;
        assert!(f.tick(&mut run, bi, DT, false));
        assert_eq!(f.phase, Phase::Land, "the landing starts on the first tick after the time is up");
        assert_eq!(run.monsters[bi].anim, Anim::Land);
    }

    #[test]
    fn a_landing_that_ends_over_a_hole_goes_back_up() {
        // Something other than the flight moved the boss over a chasm during the landing.
        let (mut run, bi, mut f) = over_a_hole(true);
        f.phase = Phase::Land;
        f.t = 0.3;
        run.events.clear();
        assert!(!holds(&run, bi, run.monsters[bi].pos), "it starts the landing over the hole");
        let mut smashes = 0;
        let mut grounded_at = None;
        for _ in 0..(20.0 / DT) as usize {
            f.tick(&mut run, bi, DT, false);
            let pos = run.monsters[bi].pos;
            assert!(run.monsters[bi].airborne || holds(&run, bi, pos), "never on the ground over a hole");
            smashes = run.events.iter().filter(|e| matches!(e.0, crate::protocol::Ev::Boom { .. })).count();
            if f.grounded() {
                grounded_at = Some(pos);
                break;
            }
        }
        let at = grounded_at.expect("it lands within 20 s");
        assert!(holds(&run, bi, at) && !run.monsters[bi].airborne);
        assert_eq!(smashes, 1, "one Smash, at the real touchdown");
    }

    #[test]
    fn it_lands_beside_a_hero_standing_where_it_only_just_fits() {
        // 18 px from the chasm's east edge; the dragon's radius is 17.
        let edge = |tx: i32| (tx + 3) as f64 * crate::dungeon::TILE;
        let (run, bi, f) = over_a_hole_with(true, |tx, ty| Vec2::new(edge(tx) + 18.0, crate::dungeon::Map::center_of(tx, ty).y));
        lands_on_ground(run, bi, f);
    }

    #[test]
    fn it_lands_when_the_straight_flight_to_the_hero_is_blocked() {
        let (mut run, bi, f) = over_a_hole(true);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.monsters[bi].pos);
        for dy in -4..=4 {
            // A barrier blocks every mover but not sight, so the hero stays the target.
            run.layout.map.set(tx + 4, ty + dy, Tile::Barrier);
        }
        assert!(target(&run, bi).is_some(), "the hero is seen across the barrier");
        lands_on_ground(run, bi, f);
    }
}
