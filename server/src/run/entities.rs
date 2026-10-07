use crate::collision::MoveState;
use crate::defs::classes::ClassDef;
use crate::defs::progression::Modifiers;
use crate::defs::enemies::EnemyType;
use crate::defs::kinds::{Anim, EntityKind};
use crate::fov::Fov;
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
    pub tx: Option<UnboundedSender<Message>>,
    pub name: String,
    pub class: ClassId,
    pub def: ClassDef,
    pub mv: MoveState,
    pub hp: f64,
    pub alive: bool,
    pub aim: f64,
    pub aim_dist: f64,
    pub cd1: f64,
    pub cd2: f64,
    pub hidden: f64,
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
    pub fov: Fov,
    pub kills: u32,
    pub damage: f64,
    pub healing: f64,
    /// Debug mode: takes no damage and receives the path to the boss.
    pub debug: bool,
    pub xp: u32,
    /// Coins earned this run (banked to the profile like XP).
    pub coins: u32,
    /// Profile the earned XP is banked to when the run ends.
    pub token: Option<String>,
    /// Progression stat multipliers from the profile's upgrades.
    pub mods: Modifiers,
    pub max_hp: f64,
}

impl Player {
    pub fn pos(&self) -> Vec2 {
        Vec2::new(self.mv.x, self.mv.y)
    }
    pub fn kind(&self) -> EntityKind {
        self.def.kind
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
}

#[derive(Debug, Clone)]
pub struct Ai {
    pub state: AiState,
    pub target: Option<u32>,
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

pub struct Monster {
    pub id: u32,
    /// None for bosses (driven by their BossBehaviour).
    pub etype: Option<EnemyType>,
    pub kind: EntityKind,
    pub pos: Vec2,
    pub hp: f64,
    pub max_hp: f64,
    pub speed: f64,
    pub radius: f64,
    pub sight: f64,
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
    pub asleep: bool,
}

impl Monster {
    /// Position `ticks` simulation steps ago (lag compensation).
    pub fn pos_ago(&self, ticks: usize) -> Vec2 {
        if ticks == 0 || self.history.is_empty() {
            return self.pos;
        }
        let i = self.history.len().saturating_sub(ticks.min(self.history.len()));
        self.history[i]
    }
}

pub struct Projectile {
    pub id: u32,
    pub kind: EntityKind,
    pub owner: u32,
    pub from_player: bool,
    pub shot: u16,
    pub pos: Vec2,
    pub vel: Vec2,
    pub damage: f64,
    pub radius: f64,
    pub life: f64,
    pub crit: bool,
    /// Explosion radius on impact (0 = none) and its effect kind.
    pub explode_r: f64,
    pub explode_k: u8,
    /// Explode when reaching this point (fireball at cursor).
    pub target: Option<Vec2>,
    pub dead: bool,
}

/// A treasure chest. Opened once, by the first player to touch it.
pub struct Chest {
    pub id: u32,
    pub pos: Vec2,
    /// Run time when it was opened.
    pub opened: Option<f64>,
}

pub struct Hazard {
    pub id: u32,
    pub kind: EntityKind,
    pub pos: Vec2,
    pub radius: f64,
    pub life: f64,
    pub pulse_t: f64,
    pub damage: f64,
}
