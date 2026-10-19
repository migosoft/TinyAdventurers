use crate::collision::MoveState;
use crate::defs::damage::{Damage, DamageSplit, Resistances};
use crate::defs::attributes::Attributes;
use crate::defs::enemies::EnemyType;
use crate::defs::races::Sight;
use crate::defs::kinds::{Anim, EntityKind};
use crate::dungeon::Mover;
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
    pub conn: u32,
    /// Resistances (races plus adjustments) and the split of its melee hits.
    pub res: Resistances,
    pub melee: DamageSplit,
    pub tx: Option<UnboundedSender<Message>>,
    pub name: String,
    pub class: ClassId,
    pub kind: EntityKind,
    /// Every number of the hero (crate::sheet): HP, speed, abilities, effect responses.
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
    /// Debug mode: takes no damage and receives the path to the boss.
    pub debug: bool,
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
}

/// How a hero is lost to the terrain (sent as `Ev::Sink { how }`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sink {
    Fall = 0,
    Drown = 1,
}

impl Player {
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
    pub raise_cd: f64,
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
            raise_cd: 2.0,
            wander_t: 2.0,
            wander_to: None,
            hold: 0.0,
        }
    }
}

/// A wolf's dash: toward `dir` for `left` seconds; `attack` is false for the dash back from a chasm.
#[derive(Debug, Clone, Copy)]
pub struct WolfDash {
    pub dir: Vec2,
    pub left: f64,
    pub attack: bool,
}

/// What makes a monster an ally of the heroes (the Ranger's wolf; run/companion.rs).
#[derive(Debug, Clone)]
pub struct Ally {
    /// The ranger's player id.
    pub owner: u32,
    /// Monsters (ids) it has growled at.
    pub growled: Vec<u32>,
    pub growl_cd: f64,
    pub growl_to: Option<Vec2>,
    /// Seconds it does nothing (a growl).
    pub hold: f64,
    pub prey: Option<u32>,
    pub following: bool,
    pub reach_t: f64,
    pub dash: Option<WolfDash>,
    pub dash_cd: f64,
    /// Centre of the last safe tile it stood on (a dash back from a chasm goes there).
    pub last_safe: Vec2,
}

pub struct Monster {
    pub id: u32,
    /// Resistances (races plus adjustments) and the split of its melee hits.
    pub res: Resistances,
    pub melee: DamageSplit,
    /// None for bosses (driven by their BossBehaviour).
    pub etype: Option<EnemyType>,
    pub kind: EntityKind,
    pub pos: Vec2,
    pub hp: f64,
    pub max_hp: f64,
    pub speed: f64,
    pub radius: f64,
    pub sight: Sight,
    pub alive: bool,
    pub aim: f64,
    pub anim: Anim,
    pub anim_start: f64,
    pub hurt_t: f64,
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
    /// dormant did. The wolf growls at hiding things, never at dormant ones.
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
    /// How it takes each effect (bosses: defs/bosses.rs responses).
    pub responses: crate::defs::effects::EffectResponses,
    /// Its Attributes and weight (crate::sheet::MonsterStats).
    #[allow(dead_code)] // read from plan 1 Task 7/8
    pub attrs: Attributes,
    #[allow(dead_code)] // read from plan 1 Task 7/8
    pub weight: f64,
    /// Set for a hero's ally: no hero attack hurts it and enemies are its foes.
    pub ally: Option<Ally>,
}

impl Monster {
    pub fn is_ally(&self) -> bool {
        self.ally.is_some()
    }
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
    pub from_player: bool,
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
    /// Knockback (px) of the explosion on the heroes it hits (dragon fireballs).
    pub knock: f64,
    /// Explode when reaching this point (fireball at cursor).
    pub target: Option<Vec2>,
    pub dead: bool,
}

pub struct Hazard {
    pub id: u32,
    pub kind: EntityKind,
    pub pos: Vec2,
    pub radius: f64,
    pub life: f64,
    pub pulse_t: f64,
    pub damage: Damage,
}
