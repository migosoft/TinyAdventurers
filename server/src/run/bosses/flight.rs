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
use rand::RngExt;

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
/// y then x). Tiles in `skip` (ones the boss stalled on) are left out.
fn landing_spot(run: &Run, bi: usize, use_target: bool, skip: &[Vec2]) -> Option<Vec2> {
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
            if best.map_or(true, |(bd, _)| d < bd) && !skip.contains(&c) && holds(run, bi, c) && walk_line(&run.layout.map, pos, c, Mover::Dash) {
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
    /// Tiles this landing stalled on (a gap too narrow for the body, a solid object): not tried again. Cleared on landing.
    skip: Vec<Vec2>,
    /// Where the boss took off: it held the body then; the way back when no tile in reach does.
    origin: Vec2,
    /// The boss's position at the start of the previous tick over a hole: progress is the net move since then, pushes
    /// by other monsters included.
    prev: Option<Vec2>,
}

impl Flight {
    /// On the ground, the first flight in `first` seconds.
    pub fn new(times: FlightTimes, first: f64) -> Flight {
        Flight { phase: Phase::Ground, t: first, times, gave_up: false, skip: Vec::new(), origin: Vec2::ZERO, prev: None }
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
                self.origin = run.monsters[bi].pos;
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
                if !holds(run, bi, pos) && pos.dist(self.origin) >= 1.0 {
                    // Over a hole: fly to ground that holds the whole body, then land.
                    let speed = run.monsters[bi].speed;
                    // What a tick must move to count as progress: a quarter step at the speed it really has.
                    let least = speed * run.monsters[bi].effects.speed_mul() * dt * 0.25;
                    let stalled = self.prev.is_some_and(|p| p.dist(pos) < least);
                    self.prev = Some(pos);
                    match landing_spot(run, bi, !self.gave_up, &self.skip) {
                        Some(goal) => {
                            if move_toward(run, bi, goal, speed, dt) {
                                // `move_toward` stops short of the goal; it holds, so stand on it and land next tick.
                                run.monsters[bi].pos = goal;
                            } else if stalled {
                                // Hardly any progress (a barrier, a wall, an object or a too narrow gap in the way, sliding
                                // along it): drop the target as the goal, then the tile.
                                if self.gave_up {
                                    self.skip.push(goal);
                                }
                                self.gave_up = true;
                            }
                            set_anim(run, bi, Anim::Move);
                        }
                        None => {
                            // No tile in reach holds the body: back to where it took off, and if that is blocked too,
                            // stand there. The take-off spot always counts as landable, so the flight ends.
                            if move_toward(run, bi, self.origin, speed, dt) || stalled {
                                run.monsters[bi].pos = self.origin;
                            }
                            set_anim(run, bi, Anim::Move);
                        }
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
                    let pos = run.monsters[bi].pos;
                    if !holds(run, bi, pos) && pos.dist(self.origin) >= 1.0 {
                        // Moved over a hole during the landing: do not touch down, fly on to ground.
                        self.phase = Phase::Air;
                        self.t = 0.0;
                        self.prev = None;
                        return true;
                    }
                    let at = ahead(run, bi);
                    monster_use(run, bi, AbilityId::Smash, at);
                    run.monsters[bi].airborne = false;
                    self.gave_up = false;
                    self.skip.clear();
                    self.prev = None;
                    self.phase = Phase::Ground;
                    self.t = run.rng.random_range(self.times.every.0..self.times.every.1);
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

        let mut f = Flight { phase: Phase::Air, t: 1.0, times: TIMES, gave_up: false, skip: Vec::new(), origin: Vec2::ZERO, prev: None };
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

    /// `over_a_hole`, walled in: only the chasm and the floor east of it are left.
    fn walled_hole() -> (Run, usize, Flight, i32, i32) {
        let (mut run, bi, mut f) = over_a_hole(true);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.monsters[bi].pos);
        for dy in -12..=12 {
            for dx in -12..=12 {
                if !((-2..=2).contains(&dx) && (-2..=2).contains(&dy)) && !((3..=8).contains(&dx) && (-2..=2).contains(&dy)) {
                    run.layout.map.set(tx + dx, ty + dy, Tile::Wall);
                }
            }
        }
        f.origin = run.monsters[bi].pos;
        (run, bi, f, tx, ty)
    }

    /// A line of barrels across the east floor: every tile there is "reachable" on a zero-width line, but not by the body.
    fn barrel_wall(run: &mut Run, tx: i32, ty: i32) {
        let x = crate::dungeon::Map::center_of(tx + 3, ty).x;
        for i in -8..=8 {
            let y = crate::dungeon::Map::center_of(tx, ty).y + i as f64 * 16.0;
            run.spawn_object(crate::defs::kinds::EntityKind::Barrel, Vec2::new(x, y), crate::run::objects::ObjState::Barrel(crate::run::objects::Barrel::new()));
        }
    }

    #[test]
    fn it_leaves_a_tile_behind_a_solid_object_for_another() {
        let (mut run, bi, mut f, tx, ty) = walled_hole();
        barrel_wall(&mut run, tx, ty);
        // Ground to the west that holds the body: floor (dx -11..-6), chasm between it and the hole.
        for dx in -11..=-3 {
            for dy in -2..=2 {
                run.layout.map.set(tx + dx, ty + dy, if dx <= -6 { Tile::Floor } else { Tile::Chasm });
            }
        }
        assert!(holds(&run, bi, Map::center_of(tx - 9, ty)));
        f.origin = Map::center_of(tx - 9, ty);
        lands_on_ground(run, bi, f);
    }

    #[test]
    fn it_lands_at_the_take_off_spot_when_that_does_not_hold_either() {
        let (mut run, bi, mut f, tx, ty) = walled_hole();
        barrel_wall(&mut run, tx, ty);
        f.origin = run.monsters[bi].pos;
        assert!(!holds(&run, bi, f.origin));
        for _ in 0..(20.0 / DT) as usize {
            f.tick(&mut run, bi, DT, false);
            if f.grounded() {
                break;
            }
        }
        assert!(f.grounded() && !run.monsters[bi].airborne, "the flight ends within 20 s");
    }

    #[test]
    fn it_flies_back_to_where_it_took_off_when_no_ground_in_reach_holds_it() {
        let (mut run, bi, mut f, tx, ty) = walled_hole();
        for dy in -2..=2 {
            run.layout.map.set(tx + 3, ty + dy, Tile::Wall);
        }
        // The only ground is behind the wall, so no straight flight finds it; the take-off spot is there (a charm moved the boss).
        f.origin = Map::center_of(tx + 6, ty);
        assert!(landing_spot(&run, bi, false, &[]).is_none());
        lands_on_ground(run, bi, f);
    }

    #[test]
    fn it_slides_along_a_barrier_to_ground_beyond_it() {
        let (mut run, bi, f) = over_a_hole(true);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.monsters[bi].pos);
        // A barrier along the straight line to the hero's row, ending beside it: the flight slides past its end.
        for dy in -4..=0 {
            run.layout.map.set(tx + 3, ty + dy, Tile::Barrier);
        }
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
