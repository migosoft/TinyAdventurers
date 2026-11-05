use crate::collision::MoveState;
use crate::defs::abilities::AbilityId;
use crate::defs::damage::{Damage, Resistances};
use crate::defs::effects::OnHit;
use crate::defs::attributes::Attributes;
use crate::defs::enemies::EnemyType;
use crate::defs::races::{Race, Sight, Traits};
use crate::defs::kinds::{Anim, EntityKind};
use crate::dungeon::Mover;
use super::targets::Side;
use crate::vispoly::View;
use crate::math::Vec2;
use crate::protocol::{ClassId, InputMsg};
use axum::extract::ws::Message;
use std::collections::VecDeque;
use tokio::sync::mpsc::UnboundedSender;

/// Positions kept per monster for lag compensation (~0.5 s at 60 Hz).
pub const HISTORY_LEN: usize = 32;

pub struct Player {
    pub id: u32,
    /// Always `Friendly`.
    pub side: Side,
    pub conn: u32,
    /// Resistances (races plus adjustments; the split of its hits is its weapons', in `sheet`).
    pub res: Resistances,
    pub tx: Option<UnboundedSender<Message>>,
    pub name: String,
    pub class: ClassId,
    /// The build the hero brought, kept for the run (`run_sheet` resolves it again when its Attributes change).
    pub build: crate::defs::loadout::Build,
    /// The worn melee and ranged weapons (the melee falls back to the class starter), for `PlayerInfo`.
    pub weapons: (crate::defs::items::ItemId, Option<crate::defs::items::ItemId>),
    pub kind: EntityKind,
    /// Every number of the hero (crate::sheet): HP, speed, abilities, effect resistances.
    pub sheet: crate::sheet::Sheet,
    pub mv: MoveState,
    pub hp: f64,
    pub alive: bool,
    pub aim: f64,
    pub aim_dist: f64,
    pub cd1: f64,
    pub cd2: f64,
    pub anim: Anim,
    pub anim_start: f64,
    pub moving: bool,
    pub hurt_t: f64,
    pub inputs: VecDeque<InputMsg>,
    pub ack: u32,
    /// Seconds the client's view of other entities lags behind the server.
    pub view_lag: f64,
    pub rtt: f64,
    pub spectating: Option<u32>,
    pub dash_hit: Vec<u32>,
    pub view: View,
    pub kills: u32,
    /// Left the dungeon early (the game then treats the hero as dead).
    pub left: bool,
    pub damage: f64,
    pub healing: f64,
    /// Debug mode: takes no damage (unless `mortal`) and receives the path to the boss.
    pub debug: bool,
    /// Debug mode with immortality turned off (F9): hits and terrain hurt as in a normal run.
    pub mortal: bool,
    pub xp: u32,
    /// Coins earned this run (banked to the character like XP).
    pub coins: u32,
    /// Account and character the earned XP is banked to when the run ends.
    pub account: Option<i32>,
    pub character: Option<i32>,
    pub max_hp: f64,
    /// Falling into a chasm or drowning: seconds left until death, and how.
    pub sinking: Option<(f64, Sink)>,
    /// Centre of the last safe tile stood on (debug mode puts a fallen hero back here).
    pub last_safe: Vec2,
    /// Time since the last lava burn.
    pub burn_t: f64,
    /// What the hero sees (from the class profile) and an override of its darkvision fraction.
    pub sight: Sight,
    pub darkvision: Option<f64>,
    /// Status effects (run/effects.rs).
    pub effects: crate::run::effects::Effects,
    /// The Ranger's wolf (its monster id) while it lives.
    pub wolf: Option<u32>,
    /// Ground Slam: seconds until it lands; lost when the hero dies, sinks or is pushed.
    pub slam: Option<f64>,
}

/// How a hero is lost to the terrain (sent as `Ev::Sink { how }`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sink {
    Fall = 0,
    Drown = 1,
}

impl Player {
    /// Debug mode with immortality on: hits show but take no HP, and terrain does not kill.
    pub fn immortal(&self) -> bool {
        self.debug && !self.mortal
    }
    pub fn pos(&self) -> Vec2 {
        Vec2::new(self.mv.x, self.mv.y)
    }
    pub fn sight_now(&self) -> Sight {
        let base = Sight { darkvision: self.darkvision.unwrap_or(self.sight.darkvision), ..self.sight };
        self.effects.sight(base)
    }
    pub fn kind(&self) -> EntityKind {
        self.kind
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiState {
    Idle,
    Chase,
    Search,
    Return,
}

#[derive(Debug, Clone, Copy)]
pub struct Windup {
    pub t: f64,
    pub aim: f64,
    /// The wind-up leads to the second attack (`EnemyDef::alt`).
    pub alt: bool,
    /// What the attack aims at when that is not the seen hero.
    pub at: Option<Target>,
}

/// What a monster is after: a hero, an object (a barrel to shoot; later a
/// torch or the carriage) or a place.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Target {
    Player(u32),
    /// An ally monster (the Ranger's wolf).
    Ally(u32),
    Object(u32),
    #[allow(dead_code)] // for torches and the carriage
    Place(Vec2),
}

#[derive(Debug, Clone)]
pub struct Ai {
    pub state: AiState,
    pub target: Option<Target>,
    pub last_known: Vec2,
    pub home: Vec2,
    pub cd: f64,
    /// Cooldown of the second attack.
    pub alt_cd: f64,
    pub windup: Option<Windup>,
    pub path: Vec<Vec2>,
    pub repath_t: f64,
    pub search_t: f64,
    /// A minion ability winding up and the seconds left; it is cast whether or not a foe is still seen.
    pub cast: Option<(AbilityId, f64)>,
    pub wander_t: f64,
    pub wander_to: Option<Vec2>,
    /// Seconds the monster does nothing (mimic reveal).
    pub hold: f64,
}

impl Ai {
    pub fn new(home: Vec2) -> Self {
        Ai {
            state: AiState::Idle,
            target: None,
            last_known: home,
            home,
            cd: 0.5,
            alt_cd: 1.0,
            windup: None,
            path: Vec::new(),
            repath_t: 0.0,
            search_t: 0.0,
            cast: None,
            wander_t: 2.0,
            wander_to: None,
            hold: 0.0,
        }
    }
}

/// A monster's dash in progress (`Monster.dash`): ability `id` toward `dir` for `left` seconds, in the air
/// (it crosses chasms). `attack` is false for a dash that hurts nobody (the wolf's way back from a chasm);
/// `hit` are the ids of the foes it has hurt, each once.
#[derive(Debug, Clone)]
pub struct MonsterDash {
    pub id: crate::defs::abilities::AbilityId,
    pub dir: Vec2,
    pub left: f64,
    pub hit: Vec<u32>,
    pub attack: bool,
}

/// What makes a monster an ally of the heroes (the Ranger's wolf; run/companion.rs).
#[derive(Debug, Clone)]
pub struct Ally {
    /// The ranger's player id.
    pub owner: u32,
    /// Seconds before it may bite again after a pounce that hurt its prey (the script's own wait; the
    /// kit's cooldowns are `cds`, started only by using the ability).
    pub bite_hold: f64,
    pub prey: Option<u32>,
    pub following: bool,
    pub reach_t: f64,
    /// Centre of the last safe tile it stood on (a dash back from a chasm goes there).
    pub last_safe: Vec2,
}

pub struct Monster {
    pub id: u32,
    /// Resistances (races plus adjustments) and the split of its melee hits.
    pub res: Resistances,
    /// Its races (see defs/races.rs).
    pub races: &'static [Race],
    /// Its race traits (phasing, invisibility, knockback immunity).
    pub traits: Traits,
    /// Seconds until the Invisibility trait may be used again; counts down only while Invisible is off.
    pub invis_cd: f64,
    /// None for bosses (driven by their BossBehaviour).
    pub etype: Option<EnemyType>,
    pub kind: EntityKind,
    pub pos: Vec2,
    pub hp: f64,
    pub max_hp: f64,
    pub speed: f64,
    /// Its numbers at spawn, before any Attribute effect (crate::sheet::monster_numbers).
    pub base: crate::sheet::MonsterBase,
    pub radius: f64,
    pub sight: Sight,
    pub alive: bool,
    pub aim: f64,
    /// How far it aims an aimed ability (blasts and ground areas land there), set by `monster_use`.
    pub aim_dist: f64,
    pub anim: Anim,
    pub anim_start: f64,
    pub hurt_t: f64,
    /// The abilities it uses, resolved at spawn (empty for bosses), and their cooldowns.
    pub kit: crate::sheet::Kit,
    pub cds: super::abilities::Cooldowns,
    /// Ground Slam: seconds until it lands; lost when it dies, sinks, is pushed or frightened.
    pub slam: Option<f64>,
    /// A channelled ability in progress (Fire Breath): which, the seconds left and the seconds to its next pulse.
    /// It ends when it runs out, or when the user dies.
    pub channel: Option<(AbilityId, f64, f64)>,
    /// A dash in progress: it is in the air, so it is neither pushed nor sinking meanwhile.
    pub dash: Option<MonsterDash>,
    /// Seconds left of the wolf-bite mark (Pack Hunter).
    pub wolf_bit: f64,
    pub ai: Ai,
    /// Necromancer / lich that raised or binds this monster.
    pub owner: Option<u32>,
    pub history: VecDeque<Vec2>,
    pub is_boss: bool,
    /// Waiting until triggered: bosses before the party enters the hall, the lich's
    /// channelling disciples. Not an effect (no source, no timer); the Sleep effect is
    /// `effects` (run/effects.rs).
    pub dormant: bool,
    /// Concealed from the heroes (a mimic disguised as a chest); ends as the mimic's
    /// dormant did.
    pub hiding: bool,
    /// Walking rules: demons cross lava, other enemies avoid it.
    pub mover: Mover,
    /// Flying (the dragon): melee cannot reach it, projectiles and spells still do.
    pub airborne: bool,
    /// Knockback velocity (px/s) from a blast; the AI does not move it meanwhile.
    pub knock: Vec2,
    /// Falling into a chasm or drowning: seconds left, and how.
    pub sinking: Option<(f64, Sink)>,
    /// Time since the last lava burn.
    pub burn_t: f64,
    /// Last hero who hurt it: credited for a death by terrain.
    pub last_hit_by: Option<usize>,
    /// Status effects (run/effects.rs).
    pub effects: crate::run::effects::Effects,
    /// Its effect resistances (from its profile: races plus its `Adjust`).
    pub effect_res: crate::defs::effects::EffectResistances,
    /// Its Attributes and weight (crate::sheet::MonsterStats).
    pub attrs: Attributes,
    pub weight: f64,
    /// Set for a hero's ally: no hero attack hurts it and enemies are its foes.
    pub ally: Option<Ally>,
    /// Whom it fights for (`targets::foes`); every friend-or-foe question reads it.
    pub side: Side,
}

impl Monster {
    /// What it sees now: its sight through its effects (blindness).
    pub fn sight_now(&self) -> Sight {
        self.effects.sight(self.sight)
    }
    /// Position `ticks` simulation steps ago (lag compensation).
    pub fn pos_ago(&self, ticks: usize) -> Vec2 {
        if ticks == 0 || self.history.is_empty() {
            return self.pos;
        }
        let i = self.history.len().saturating_sub(ticks.min(self.history.len()));
        self.history[i]
    }

    /// Distance from a flying shot at ground point `p` to this monster's body,
    /// to compare with `radius` plus the shot's radius (mirrored in
    /// `client/src/sim/hitbox.ts` for the shot the client draws). Shots are drawn
    /// `SHOT_HEIGHT` px above their ground point and figures stand up from their
    /// feet, so a tall figure is a capsule reaching north from `pos`, not a circle.
    pub fn shot_dist(&self, p: Vec2) -> f64 {
        let lift = if self.airborne { DRAGON_LIFT } else { 0.0 };
        let reach = (self.kind.body_height() + lift - SHOT_HEIGHT - self.radius).max(0.0);
        let y = p.y.clamp(self.pos.y - reach, self.pos.y);
        p.dist(Vec2::new(self.pos.x, y))
    }
}

/// How far above their ground point projectiles are drawn (px; `GameScene`).
pub const SHOT_HEIGHT: f64 = 8.0;
/// How far a flying monster is drawn above the ground (px; the dragon's `lift` at 1.2x scale).
pub const DRAGON_LIFT: f64 = 17.0;

pub struct Projectile {
    pub id: u32,
    pub kind: EntityKind,
    pub owner: u32,
    /// The side it hurts the foes of.
    pub side: Side,
    pub shot: u16,
    pub pos: Vec2,
    pub vel: Vec2,
    pub damage: Damage,
    pub radius: f64,
    pub life: f64,
    pub crit: bool,
    /// Explosion radius on impact (0 = none) and its effect kind.
    pub explode_r: f64,
    pub explode_k: u8,
    /// Push (px) of the explosion on the foes it hits, and the STR it pushes with: the user's, taken at
    /// spawn so a shot that outlives its user still pushes.
    pub push: f64,
    pub push_str: i32,
    /// Explode when reaching this point (fireball at cursor).
    pub target: Option<Vec2>,
    pub dead: bool,
    /// How it goes on after hitting a creature.
    pub pierce: Pierce,
    /// The creatures (ids) it has already hit: never hit twice.
    pub hit: Vec<u32>,
}

/// How a shot goes on after hitting a creature. `u8::MAX` is no limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pierce {
    /// It ends at the first creature it hits.
    Never,
    /// A kill lets the rest of its damage fly on, up to `left` more times.
    Overkill { left: u8 },
    /// It passes `left` creatures with full damage, killed or not, then becomes `Pierce::from_u8(then)`;
    /// `left == u8::MAX` passes every creature.
    Through { left: u8, then: u8 },
}

impl Pierce {
    /// From `ResolvedAbility.pierce` (overkill) and `pierce_through`.
    pub fn new(overkill: u8, through: u8) -> Pierce {
        if through > 0 {
            Pierce::Through { left: through, then: overkill }
        } else {
            Pierce::from_u8(overkill)
        }
    }
    /// An overkill count: 0 is `Never`.
    pub fn from_u8(overkill: u8) -> Pierce {
        match overkill {
            0 => Pierce::Never,
            left => Pierce::Overkill { left },
        }
    }
}

/// Whose hazard it is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum HazardSide {
    /// Hurts heroes and allies (fire patches).
    Monsters,
    /// Acts on enemy monsters only, crediting the hero with entity id `owner`.
    Heroes { owner: u32 },
}

/// What a hazard does every 0.5 s to those it acts on.
#[derive(Debug, Clone, PartialEq)]
pub enum HazardPulse {
    Hurt(Damage),
    Bind(Vec<OnHit>),
}

pub struct Hazard {
    pub id: u32,
    pub kind: EntityKind,
    pub pos: Vec2,
    pub radius: f64,
    pub life: f64,
    pub pulse_t: f64,
    pub side: HazardSide,
    pub pulse: HazardPulse,
}
