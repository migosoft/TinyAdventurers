//! The four class skill trees as data (spec §9). A tree is a graph of nodes bought outward
//! from the class start; the sheet builder folds the owned nodes in through `gains`.
//! `check_buy` is the shared rule for buying (neighbour + requirements); XP is `Progress`'s.

use super::abilities::AbilityId;
use super::attributes::{Attr, Attributes};
use super::damage::DamageType;
use super::effects::{EffectKind, EffectLook, OnHit};
use super::items::ArmorClass;
use super::loadout::AbilityMod;
use super::requirements::Requirement;
use super::weapons::WeaponKind;
use crate::protocol::ClassId;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

super::enum_list::listed_enum! {
    /// One variant per node, named from the spec id without underscores (`w_a1` is `WA1`).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
    #[ts(export)]
    pub enum NodeId: u16 {
        W0 = 0,
        WA1 = 1,
        WA2 = 2,
        WA3 = 3,
        WA4 = 4,
        WA5 = 5,
        WF1 = 6,
        WF2 = 7,
        WF3 = 8,
        WF4 = 9,
        WF5 = 10,
        WF6 = 11,
        WR1 = 12,
        WR2 = 13,
        WR3 = 14,
        WR4 = 15,
        WR5 = 16,
        WB1 = 17,
        WB2 = 18,
        WB3 = 19,
        WB4 = 20,
        WB5 = 21,
        WB6 = 22,
        P0 = 23,
        PU1 = 24,
        PU2 = 25,
        PU3 = 26,
        PU4 = 27,
        PU5 = 28,
        PL1 = 29,
        PL2 = 30,
        PL3 = 31,
        PL4 = 32,
        PL5 = 33,
        PR1 = 34,
        PR2 = 35,
        PR3 = 36,
        PR4 = 37,
        PR5 = 38,
        PD1 = 39,
        PD2 = 40,
        PD3 = 41,
        PD4 = 42,
        B0 = 43,
        BU1 = 44,
        BU2 = 45,
        BU3 = 46,
        BU4 = 47,
        BU5 = 48,
        BL1 = 49,
        BL2 = 50,
        BL3 = 51,
        BL4 = 52,
        BL5 = 53,
        BR1 = 54,
        BR2 = 55,
        BR3 = 56,
        BR4 = 57,
        BR5 = 58,
        BD1 = 59,
        BD2 = 60,
        BD3 = 61,
        BD4 = 62,
        BD5 = 63,
        E0 = 64,
        EU1 = 65,
        EU2 = 66,
        EU3 = 67,
        EU4 = 68,
        EU5 = 69,
        EL1 = 70,
        EL2 = 71,
        EL3 = 72,
        EL4 = 73,
        EL5 = 74,
        ER1 = 75,
        ER2 = 76,
        ER3 = 77,
        ER4 = 78,
        ED1 = 79,
        ED2 = 80,
        ED3 = 81,
        ED4 = 82,
    }
}

super::enum_list::listed_enum! {
    /// The build-defining nodes; each is handled in one place (the sheet builder or the run).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, TS)]
    #[ts(export)]
    pub enum Keystone: u8 {
        ArcaneOverflow = 0,
        DeepWinter = 1,
        Pyromancer = 2,
        Radiant = 3,
        Unshaken = 4,
        Bulwark = 5,
        Berserker = 6,
        Juggernaut = 7,
        Unbreakable = 8,
        PackHunter = 9,
        Deadeye = 10,
        Venomancer = 11,
    }
}

/// A set of keystones (one bit each).
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub struct KeystoneSet(u16);

impl KeystoneSet {
    pub fn insert(&mut self, k: Keystone) {
        self.0 |= 1 << k as u16;
    }
    pub fn has(&self, k: Keystone) -> bool {
        self.0 & (1 << k as u16) != 0
    }
    pub fn iter(&self) -> impl Iterator<Item = Keystone> + '_ {
        Keystone::ALL.into_iter().filter(|&k| self.has(k))
    }
}

/// What a proficiency node teaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Prof {
    Weapon(WeaponKind),
    Armor(ArmorClass),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum NodeKind {
    Start,
    Attr(Attr, i32),
    Unlock(AbilityId),
    /// Works only while that ability is equipped.
    Improve(AbilityId, AbilityMod),
    Proficiency(Prof),
    /// A fraction: `0.2` is +20 %.
    Resist(DamageType, f64),
    Keystone(Keystone),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NodeDef {
    pub id: NodeId,
    pub class: ClassId,
    /// Grid coordinates; the start is (0, 0).
    pub pos: (i8, i8),
    pub kind: NodeKind,
    pub name: &'static str,
    pub text: &'static str,
    pub cost: u32,
    pub req: &'static [Requirement],
    /// Undirected: a link also joins the other node back to this one.
    pub links: &'static [NodeId],
}

#[allow(clippy::too_many_arguments)]
fn nd(id: NodeId, class: ClassId, pos: (i8, i8), kind: NodeKind, name: &'static str, text: &'static str, cost: u32, req: &'static [Requirement], links: &'static [NodeId]) -> NodeDef {
    NodeDef { id, class, pos, kind, name, text, cost, req, links }
}

/// A new node without a definition does not compile.
pub fn def(id: NodeId) -> NodeDef {
    match id {
        NodeId::W0 => nd(NodeId::W0, ClassId::Wizard, (0, 0), NodeKind::Start, "Wizard", "Where the tree starts. Always owned.", 0, &[], &[NodeId::WA1, NodeId::WF1, NodeId::WR1, NodeId::WB1]),
        NodeId::WA1 => nd(NodeId::WA1, ClassId::Wizard, (0, -1), NodeKind::Attr(Attr::Int, 1), "+1 INT", "+1 INT", 200, &[], &[NodeId::WA2]),
        NodeId::WA2 => nd(NodeId::WA2, ClassId::Wizard, (0, -2), NodeKind::Improve(AbilityId::MagicMissile, AbilityMod::Pierce(1)), "Piercing Missiles", "Magic Missile: pierces 1 enemy (overkill rule, like arrows).", 300, &[Requirement::Attr(Attr::Int, 15)], &[NodeId::WA3, NodeId::WA4]),
        NodeId::WA3 => nd(NodeId::WA3, ClassId::Wizard, (-1, -3), NodeKind::Unlock(AbilityId::ChainSpark), "Chain Spark", "Unlocks Chain Spark (primary).", 600, &[Requirement::Attr(Attr::Int, 18)], &[NodeId::WA5]),
        NodeId::WA4 => nd(NodeId::WA4, ClassId::Wizard, (1, -3), NodeKind::Attr(Attr::Int, 1), "+1 INT", "+1 INT", 300, &[], &[NodeId::WA5]),
        NodeId::WA5 => nd(NodeId::WA5, ClassId::Wizard, (0, -4), NodeKind::Keystone(Keystone::ArcaneOverflow), "Arcane Overflow", "Spell damage +15 %; spell cooldowns +10 %.", 1200, &[Requirement::Attr(Attr::Int, 18)], &[]),
        NodeId::WF1 => nd(NodeId::WF1, ClassId::Wizard, (-1, 0), NodeKind::Unlock(AbilityId::FrostShard), "Frost Shard", "Unlocks Frost Shard (primary).", 400, &[Requirement::Attr(Attr::Int, 14)], &[NodeId::WF2, NodeId::WF3]),
        NodeId::WF2 => nd(NodeId::WF2, ClassId::Wizard, (-2, -1), NodeKind::Improve(AbilityId::FrostShard, AbilityMod::DamageMul(1.2)), "Biting Cold", "Frost Shard: +20 % damage.", 350, &[], &[NodeId::WF4]),
        NodeId::WF3 => nd(NodeId::WF3, ClassId::Wizard, (-2, 1), NodeKind::Resist(DamageType::Cold, 0.2), "Cold Blood", "+20 % cold resistance.", 250, &[], &[NodeId::WF4]),
        NodeId::WF4 => nd(NodeId::WF4, ClassId::Wizard, (-3, 0), NodeKind::Unlock(AbilityId::FrostNova), "Frost Nova", "Unlocks Frost Nova (secondary).", 700, &[Requirement::Attr(Attr::Int, 17)], &[NodeId::WF5]),
        NodeId::WF5 => nd(NodeId::WF5, ClassId::Wizard, (-4, 0), NodeKind::Improve(AbilityId::FrostNova, AbilityMod::RadiusMul(1.25)), "Wide Nova", "Frost Nova: radius +25 %.", 400, &[], &[NodeId::WF6]),
        NodeId::WF6 => nd(NodeId::WF6, ClassId::Wizard, (-5, 0), NodeKind::Keystone(Keystone::DeepWinter), "Deep Winter", "Chilled or Frozen enemies take +20 % cold damage from you.", 1200, &[Requirement::Attr(Attr::Int, 17)], &[]),
        NodeId::WR1 => nd(NodeId::WR1, ClassId::Wizard, (1, 0), NodeKind::Improve(AbilityId::Fireball, AbilityMod::RadiusMul(1.2)), "Bigger Bang", "Fireball: blast radius +20 %.", 350, &[], &[NodeId::WR2, NodeId::WR3]),
        NodeId::WR2 => nd(NodeId::WR2, ClassId::Wizard, (2, -1), NodeKind::Resist(DamageType::Heat, 0.2), "Ember Skin", "+20 % heat resistance.", 250, &[], &[NodeId::WR4]),
        NodeId::WR3 => nd(NodeId::WR3, ClassId::Wizard, (2, 1), NodeKind::Improve(AbilityId::Fireball, AbilityMod::AddOnHit(OnHit { kind: EffectKind::Burning, secs: 3.0, magical: false, power: 0, look: EffectLook::Plain })), "Scorched Earth", "Fireball: the blast sets Burning (3 s) on everything it hits.", 500, &[Requirement::Attr(Attr::Int, 16)], &[NodeId::WR4]),
        NodeId::WR4 => nd(NodeId::WR4, ClassId::Wizard, (3, 0), NodeKind::Attr(Attr::Int, 1), "+1 INT", "+1 INT", 300, &[], &[NodeId::WR5]),
        NodeId::WR5 => nd(NodeId::WR5, ClassId::Wizard, (4, 0), NodeKind::Keystone(Keystone::Pyromancer), "Pyromancer", "+20 % heat damage, −20 % cold damage.", 1200, &[Requirement::Attr(Attr::Int, 17)], &[]),
        NodeId::WB1 => nd(NodeId::WB1, ClassId::Wizard, (0, 1), NodeKind::Attr(Attr::Con, 1), "+1 CON", "+1 CON", 200, &[], &[NodeId::WB2, NodeId::WB3]),
        NodeId::WB2 => nd(NodeId::WB2, ClassId::Wizard, (-1, 2), NodeKind::Attr(Attr::Wil, 1), "+1 WIL", "+1 WIL", 160, &[], &[NodeId::WB4]),
        NodeId::WB3 => nd(NodeId::WB3, ClassId::Wizard, (1, 2), NodeKind::Proficiency(Prof::Armor(ArmorClass::Light)), "Light Armor", "Proficiency: light armor.", 300, &[], &[NodeId::WB4]),
        NodeId::WB4 => nd(NodeId::WB4, ClassId::Wizard, (0, 3), NodeKind::Unlock(AbilityId::Haste), "Haste", "Unlocks Haste (secondary).", 600, &[Requirement::Attr(Attr::Int, 15), Requirement::Attr(Attr::Wil, 14)], &[NodeId::WB5, NodeId::WB6]),
        NodeId::WB5 => nd(NodeId::WB5, ClassId::Wizard, (-1, 4), NodeKind::Improve(AbilityId::Haste, AbilityMod::DurationAdd(2.0)), "Lasting Haste", "Haste: +2 s.", 350, &[], &[]),
        NodeId::WB6 => nd(NodeId::WB6, ClassId::Wizard, (1, 4), NodeKind::Attr(Attr::Dex, 1), "+1 DEX", "+1 DEX", 250, &[], &[]),
        NodeId::P0 => nd(NodeId::P0, ClassId::Paladin, (0, 0), NodeKind::Start, "Paladin", "Where the tree starts. Always owned.", 0, &[], &[NodeId::PU1, NodeId::PL1, NodeId::PR1, NodeId::PD1]),
        NodeId::PU1 => nd(NodeId::PU1, ClassId::Paladin, (0, -1), NodeKind::Attr(Attr::Cha, 1), "+1 CHA", "+1 CHA", 200, &[], &[NodeId::PU2]),
        NodeId::PU2 => nd(NodeId::PU2, ClassId::Paladin, (0, -2), NodeKind::Improve(AbilityId::HolyLight, AbilityMod::DamageMul(1.25)), "Greater Light", "Holy Light: heal +25 %.", 350, &[], &[NodeId::PU3, NodeId::PU4]),
        NodeId::PU3 => nd(NodeId::PU3, ClassId::Paladin, (-1, -3), NodeKind::Unlock(AbilityId::Judgement), "Judgement", "Unlocks Judgement (primary).", 600, &[Requirement::Attr(Attr::Cha, 16)], &[NodeId::PU5]),
        NodeId::PU4 => nd(NodeId::PU4, ClassId::Paladin, (1, -3), NodeKind::Attr(Attr::Cha, 1), "+1 CHA", "+1 CHA", 300, &[], &[NodeId::PU5]),
        NodeId::PU5 => nd(NodeId::PU5, ClassId::Paladin, (0, -4), NodeKind::Keystone(Keystone::Radiant), "Radiant", "Your innate abilities deal +20 % damage to Undead and Demons; you shed light 2 tiles.", 1200, &[Requirement::Attr(Attr::Cha, 17)], &[]),
        NodeId::PL1 => nd(NodeId::PL1, ClassId::Paladin, (-1, 0), NodeKind::Unlock(AbilityId::Purify), "Purify", "Unlocks Purify (secondary).", 500, &[Requirement::Attr(Attr::Wil, 14)], &[NodeId::PL2, NodeId::PL3]),
        NodeId::PL2 => nd(NodeId::PL2, ClassId::Paladin, (-2, -1), NodeKind::Attr(Attr::Wil, 1), "+1 WIL", "+1 WIL", 160, &[], &[NodeId::PL4]),
        NodeId::PL3 => nd(NodeId::PL3, ClassId::Paladin, (-2, 1), NodeKind::Resist(DamageType::Magical, 0.2), "Warded", "+20 % magical resistance.", 300, &[], &[NodeId::PL4]),
        NodeId::PL4 => nd(NodeId::PL4, ClassId::Paladin, (-3, 0), NodeKind::Improve(AbilityId::Purify, AbilityMod::DurationAdd(2.0)), "Lasting Ward", "Purify: ward 3 s → 5 s.", 400, &[], &[NodeId::PL5]),
        NodeId::PL5 => nd(NodeId::PL5, ClassId::Paladin, (-4, 0), NodeKind::Keystone(Keystone::Unshaken), "Unshaken", "Sleep resistance 100 %.", 1000, &[Requirement::Attr(Attr::Wil, 16)], &[]),
        NodeId::PR1 => nd(NodeId::PR1, ClassId::Paladin, (1, 0), NodeKind::Improve(AbilityId::Strike, AbilityMod::DamageMul(1.1)), "Honed Edge", "Strike: +10 % damage.", 300, &[], &[NodeId::PR2, NodeId::PR3]),
        NodeId::PR2 => nd(NodeId::PR2, ClassId::Paladin, (2, -1), NodeKind::Attr(Attr::Str, 1), "+1 STR", "+1 STR", 250, &[], &[NodeId::PR4]),
        NodeId::PR3 => nd(NodeId::PR3, ClassId::Paladin, (2, 1), NodeKind::Unlock(AbilityId::Smite), "Smite", "Unlocks Smite (primary).", 500, &[Requirement::Attr(Attr::Cha, 15)], &[NodeId::PR4]),
        NodeId::PR4 => nd(NodeId::PR4, ClassId::Paladin, (3, 0), NodeKind::Unlock(AbilityId::Consecrate), "Consecrate", "Unlocks Consecrate (secondary).", 700, &[Requirement::Attr(Attr::Cha, 15)], &[NodeId::PR5]),
        NodeId::PR5 => nd(NodeId::PR5, ClassId::Paladin, (4, 0), NodeKind::Keystone(Keystone::Bulwark), "Bulwark", "Armor weighs half for you; +10 % physical resistance.", 1200, &[Requirement::Attr(Attr::Str, 16)], &[]),
        NodeId::PD1 => nd(NodeId::PD1, ClassId::Paladin, (0, 1), NodeKind::Attr(Attr::Con, 1), "+1 CON", "+1 CON", 200, &[], &[NodeId::PD2, NodeId::PD3]),
        NodeId::PD2 => nd(NodeId::PD2, ClassId::Paladin, (-1, 2), NodeKind::Resist(DamageType::Physical, 0.1), "Steadfast", "+10 % physical resistance.", 350, &[], &[NodeId::PD4]),
        NodeId::PD3 => nd(NodeId::PD3, ClassId::Paladin, (1, 2), NodeKind::Proficiency(Prof::Weapon(WeaponKind::Spear)), "Spear", "Proficiency: spear.", 250, &[], &[NodeId::PD4]),
        NodeId::PD4 => nd(NodeId::PD4, ClassId::Paladin, (0, 3), NodeKind::Attr(Attr::Con, 1), "+1 CON", "+1 CON", 300, &[], &[]),
        NodeId::B0 => nd(NodeId::B0, ClassId::Barbarian, (0, 0), NodeKind::Start, "Barbarian", "Where the tree starts. Always owned.", 0, &[], &[NodeId::BU1, NodeId::BL1, NodeId::BR1, NodeId::BD1]),
        NodeId::BU1 => nd(NodeId::BU1, ClassId::Barbarian, (0, -1), NodeKind::Attr(Attr::Str, 1), "+1 STR", "+1 STR", 250, &[], &[NodeId::BU2]),
        NodeId::BU2 => nd(NodeId::BU2, ClassId::Barbarian, (0, -2), NodeKind::Improve(AbilityId::Strike, AbilityMod::ArcMul(1.15)), "Wide Swings", "Strike: arc +15 %.", 300, &[], &[NodeId::BU3, NodeId::BU4]),
        NodeId::BU3 => nd(NodeId::BU3, ClassId::Barbarian, (-1, -3), NodeKind::Unlock(AbilityId::Whirl), "Whirl", "Unlocks Whirl (primary).", 600, &[Requirement::Attr(Attr::Dex, 14)], &[NodeId::BU5]),
        NodeId::BU4 => nd(NodeId::BU4, ClassId::Barbarian, (1, -3), NodeKind::Attr(Attr::Str, 1), "+1 STR", "+1 STR", 300, &[], &[NodeId::BU5]),
        NodeId::BU5 => nd(NodeId::BU5, ClassId::Barbarian, (0, -4), NodeKind::Keystone(Keystone::Berserker), "Berserker", "Below 50 % HP: +25 % damage and attack speed; −10 % to every resistance.", 1200, &[Requirement::Attr(Attr::Str, 17)], &[]),
        NodeId::BL1 => nd(NodeId::BL1, ClassId::Barbarian, (-1, 0), NodeKind::Unlock(AbilityId::WarCry), "War Cry", "Unlocks War Cry (secondary).", 500, &[Requirement::Attr(Attr::Str, 16)], &[NodeId::BL2, NodeId::BL3]),
        NodeId::BL2 => nd(NodeId::BL2, ClassId::Barbarian, (-2, -1), NodeKind::Improve(AbilityId::WarCry, AbilityMod::RadiusMul(1.3)), "Thunderous", "War Cry: radius +30 %.", 350, &[], &[NodeId::BL4]),
        NodeId::BL3 => nd(NodeId::BL3, ClassId::Barbarian, (-2, 1), NodeKind::Attr(Attr::Cha, 1), "+1 CHA", "+1 CHA", 200, &[], &[NodeId::BL4]),
        NodeId::BL4 => nd(NodeId::BL4, ClassId::Barbarian, (-3, 0), NodeKind::Improve(AbilityId::Charge, AbilityMod::PushStr(4)), "Bowling Charge", "Charge: carries +4 STR for pushes.", 400, &[], &[NodeId::BL5]),
        NodeId::BL5 => nd(NodeId::BL5, ClassId::Barbarian, (-4, 0), NodeKind::Keystone(Keystone::Juggernaut), "Juggernaut", "+4 weight; Slowed, Chilled and Entangled resistance 100 %.", 1000, &[Requirement::Attr(Attr::Con, 16)], &[]),
        NodeId::BR1 => nd(NodeId::BR1, ClassId::Barbarian, (1, 0), NodeKind::Proficiency(Prof::Armor(ArmorClass::Heavy)), "Heavy Armor", "Proficiency: heavy armor.", 300, &[], &[NodeId::BR2, NodeId::BR3]),
        NodeId::BR2 => nd(NodeId::BR2, ClassId::Barbarian, (2, -1), NodeKind::Unlock(AbilityId::Hurl), "Hurl", "Unlocks Hurl (primary).", 500, &[Requirement::Attr(Attr::Dex, 13)], &[NodeId::BR4]),
        NodeId::BR3 => nd(NodeId::BR3, ClassId::Barbarian, (2, 1), NodeKind::Proficiency(Prof::Weapon(WeaponKind::Mace)), "Mace", "Proficiency: mace.", 200, &[], &[NodeId::BR4]),
        NodeId::BR4 => nd(NodeId::BR4, ClassId::Barbarian, (3, 0), NodeKind::Unlock(AbilityId::GroundSlam), "Ground Slam", "Unlocks Ground Slam (secondary).", 700, &[Requirement::Attr(Attr::Str, 17)], &[NodeId::BR5]),
        NodeId::BR5 => nd(NodeId::BR5, ClassId::Barbarian, (4, 0), NodeKind::Improve(AbilityId::GroundSlam, AbilityMod::RadiusMul(1.2)), "Aftershock", "Ground Slam: radius +20 %.", 400, &[], &[]),
        NodeId::BD1 => nd(NodeId::BD1, ClassId::Barbarian, (0, 1), NodeKind::Attr(Attr::Con, 1), "+1 CON", "+1 CON", 200, &[], &[NodeId::BD2, NodeId::BD3]),
        NodeId::BD2 => nd(NodeId::BD2, ClassId::Barbarian, (-1, 2), NodeKind::Resist(DamageType::Physical, 0.1), "Thick Hide", "+10 % physical resistance.", 300, &[], &[NodeId::BD4]),
        NodeId::BD3 => nd(NodeId::BD3, ClassId::Barbarian, (1, 2), NodeKind::Resist(DamageType::Poison, 0.2), "Iron Gut", "+20 % poison resistance.", 200, &[], &[NodeId::BD4]),
        NodeId::BD4 => nd(NodeId::BD4, ClassId::Barbarian, (0, 3), NodeKind::Attr(Attr::Con, 1), "+1 CON", "+1 CON", 300, &[], &[NodeId::BD5]),
        NodeId::BD5 => nd(NodeId::BD5, ClassId::Barbarian, (0, 4), NodeKind::Keystone(Keystone::Unbreakable), "Unbreakable", "Your CON counts +4 for every save.", 1000, &[Requirement::Attr(Attr::Con, 16)], &[]),
        NodeId::E0 => nd(NodeId::E0, ClassId::ElvenRanger, (0, 0), NodeKind::Start, "Elven Ranger", "Where the tree starts. Always owned.", 0, &[], &[NodeId::EU1, NodeId::EL1, NodeId::ER1, NodeId::ED1]),
        NodeId::EU1 => nd(NodeId::EU1, ClassId::ElvenRanger, (0, -1), NodeKind::Improve(AbilityId::SummonWolf, AbilityMod::CompanionHpMul(1.25)), "Thick Fur", "Summon Wolf: the wolf has +25 % HP.", 300, &[], &[NodeId::EU2]),
        NodeId::EU2 => nd(NodeId::EU2, ClassId::ElvenRanger, (0, -2), NodeKind::Attr(Attr::Cha, 1), "+1 CHA", "+1 CHA", 200, &[], &[NodeId::EU3, NodeId::EU4]),
        NodeId::EU3 => nd(NodeId::EU3, ClassId::ElvenRanger, (-1, -3), NodeKind::Unlock(AbilityId::Entangle), "Entangle", "Unlocks Entangle (secondary).", 600, &[Requirement::Attr(Attr::Cha, 14)], &[NodeId::EU5]),
        NodeId::EU4 => nd(NodeId::EU4, ClassId::ElvenRanger, (1, -3), NodeKind::Improve(AbilityId::SummonWolf, AbilityMod::CompanionDashCooldownAdd(-2.0)), "Swift Pounce", "Summon Wolf: the wolf's dash cooldown −2 s.", 400, &[], &[NodeId::EU5]),
        NodeId::EU5 => nd(NodeId::EU5, ClassId::ElvenRanger, (0, -4), NodeKind::Keystone(Keystone::PackHunter), "Pack Hunter", "Enemies your wolf bit in the last 2 s take +20 % damage from you.", 1000, &[Requirement::Attr(Attr::Wil, 16)], &[]),
        NodeId::EL1 => nd(NodeId::EL1, ClassId::ElvenRanger, (-1, 0), NodeKind::Attr(Attr::Dex, 1), "+1 DEX", "+1 DEX", 250, &[], &[NodeId::EL2, NodeId::EL3]),
        NodeId::EL2 => nd(NodeId::EL2, ClassId::ElvenRanger, (-2, -1), NodeKind::Improve(AbilityId::Shoot, AbilityMod::RangeMul(1.15)), "Long Shot", "Shoot: range +15 %.", 350, &[], &[NodeId::EL4]),
        NodeId::EL3 => nd(NodeId::EL3, ClassId::ElvenRanger, (-2, 1), NodeKind::Proficiency(Prof::Weapon(WeaponKind::Longbow)), "Longbow", "Proficiency: longbow.", 250, &[], &[NodeId::EL4]),
        NodeId::EL4 => nd(NodeId::EL4, ClassId::ElvenRanger, (-3, 0), NodeKind::Unlock(AbilityId::Volley), "Volley", "Unlocks Volley (primary).", 600, &[Requirement::Attr(Attr::Dex, 15)], &[NodeId::EL5]),
        NodeId::EL5 => nd(NodeId::EL5, ClassId::ElvenRanger, (-4, 0), NodeKind::Keystone(Keystone::Deadeye), "Deadeye", "Ranged hits on Slowed, Chilled, Entangled or sleeping enemies deal ×2.", 1200, &[Requirement::Attr(Attr::Dex, 18)], &[]),
        NodeId::ER1 => nd(NodeId::ER1, ClassId::ElvenRanger, (1, 0), NodeKind::Unlock(AbilityId::FlankingThrust), "Flanking Thrust", "Unlocks Flanking Thrust (primary).", 500, &[Requirement::Attr(Attr::Dex, 16)], &[NodeId::ER2, NodeId::ER3]),
        NodeId::ER2 => nd(NodeId::ER2, ClassId::ElvenRanger, (2, -1), NodeKind::Improve(AbilityId::FlankingThrust, AbilityMod::BehindArc(std::f64::consts::PI / 6.0)), "Find the Gap", "Flanking Thrust: \"behind\" widens to 90°.", 350, &[], &[NodeId::ER4]),
        NodeId::ER3 => nd(NodeId::ER3, ClassId::ElvenRanger, (2, 1), NodeKind::Proficiency(Prof::Weapon(WeaponKind::Katana)), "Katana", "Proficiency: katana.", 250, &[], &[NodeId::ER4]),
        NodeId::ER4 => nd(NodeId::ER4, ClassId::ElvenRanger, (3, 0), NodeKind::Attr(Attr::Dex, 1), "+1 DEX", "+1 DEX", 350, &[], &[]),
        NodeId::ED1 => nd(NodeId::ED1, ClassId::ElvenRanger, (0, 1), NodeKind::Unlock(AbilityId::PoisonCoat), "Poison Coat", "Unlocks Poison Coat (secondary).", 500, &[Requirement::Attr(Attr::Wil, 15)], &[NodeId::ED2, NodeId::ED3]),
        NodeId::ED2 => nd(NodeId::ED2, ClassId::ElvenRanger, (-1, 2), NodeKind::Improve(AbilityId::PoisonCoat, AbilityMod::DurationAdd(3.0)), "Lingering Venom", "Poison Coat: +3 s.", 300, &[], &[NodeId::ED4]),
        NodeId::ED3 => nd(NodeId::ED3, ClassId::ElvenRanger, (1, 2), NodeKind::Resist(DamageType::Poison, 0.2), "Forest Blood", "+20 % poison resistance.", 200, &[], &[NodeId::ED4]),
        NodeId::ED4 => nd(NodeId::ED4, ClassId::ElvenRanger, (0, 3), NodeKind::Keystone(Keystone::Venomancer), "Venomancer", "Poisoned enemies take +15 % damage from you.", 1000, &[Requirement::Attr(Attr::Wil, 16)], &[]),
    }
}

pub fn start(class: ClassId) -> NodeId {
    match class {
        ClassId::Wizard => NodeId::W0,
        ClassId::Paladin => NodeId::P0,
        ClassId::Barbarian => NodeId::B0,
        ClassId::ElvenRanger => NodeId::E0,
    }
}

/// Every node of a class's tree, the start included, in id order (the exporter and the tests read it).
#[cfg(test)]
pub fn tree(class: ClassId) -> Vec<NodeDef> {
    NodeId::ALL.into_iter().map(def).filter(|d| d.class == class).collect()
}

/// The nodes a node links to and the nodes linking to it.
pub fn neighbours(id: NodeId) -> Vec<NodeId> {
    let mut v: Vec<NodeId> = def(id).links.to_vec();
    v.extend(NodeId::ALL.into_iter().filter(|&o| def(o).links.contains(&id)));
    v
}

/// What a set of owned nodes adds up to (the sheet builder applies it).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TreeGains {
    pub attrs: Attributes,
    pub profs: Vec<Prof>,
    pub res: Vec<(DamageType, f64)>,
    pub unlocks: Vec<AbilityId>,
    pub improves: Vec<(AbilityId, AbilityMod)>,
    pub keystones: KeystoneSet,
}

pub fn gains(nodes: &[NodeId]) -> TreeGains {
    let mut g = TreeGains::default();
    for &n in nodes {
        match def(n).kind {
            NodeKind::Start => {}
            NodeKind::Attr(a, v) => g.attrs.add(a, v),
            NodeKind::Unlock(a) => g.unlocks.push(a),
            NodeKind::Improve(a, m) => g.improves.push((a, m)),
            NodeKind::Proficiency(p) => g.profs.push(p),
            NodeKind::Resist(t, v) => g.res.push((t, v)),
            NodeKind::Keystone(k) => g.keystones.insert(k),
        }
    }
    g
}

/// Whether `node` can be bought now, apart from its XP (checked by `Progress`). A weapon
/// requirement never blocks buying (spec §9); only Attributes (with items) do.
pub fn check_buy(class: ClassId, owned: &[NodeId], node: NodeId, attrs_with_items: &Attributes) -> Result<(), &'static str> {
    let d = def(node);
    if d.class != class {
        return Err("That node is not in your tree.");
    }
    let s = start(class);
    if node == s || owned.contains(&node) {
        return Err("You already have that node.");
    }
    if !neighbours(node).iter().any(|&n| n == s || owned.contains(&n)) {
        return Err("Buy a neighbouring node first.");
    }
    let met = d.req.iter().all(|r| match r {
        Requirement::Attr(..) => r.met(attrs_with_items, None),
        Requirement::WeaponKind(_) => true,
    });
    if !met {
        return Err("A requirement of that node is not met.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities as ab;

    #[test]
    fn trees_have_the_spec_sizes_and_totals() {
        for (c, n, xp) in [(ClassId::Wizard, 22, 10360), (ClassId::Paladin, 19, 9060), (ClassId::Barbarian, 20, 9200), (ClassId::ElvenRanger, 18, 8600)] {
            let t = tree(c);
            assert_eq!(t.iter().filter(|d| d.kind != NodeKind::Start).count(), n, "{c:?}");
            assert_eq!(t.iter().map(|d| d.cost).sum::<u32>(), xp, "{c:?}");
            assert_eq!(def(start(c)).cost, 0);
        }
    }

    #[test]
    fn every_node_is_reachable_and_stays_in_its_class() {
        for c in [ClassId::Wizard, ClassId::Paladin, ClassId::Barbarian, ClassId::ElvenRanger] {
            let mut seen = vec![start(c)];
            let mut i = 0;
            while i < seen.len() {
                for n in neighbours(seen[i]) {
                    assert_eq!(def(n).class, c, "{:?} links across classes", seen[i]);
                    if !seen.contains(&n) {
                        seen.push(n);
                    }
                }
                i += 1;
            }
            assert_eq!(seen.len(), tree(c).len(), "{c:?}: unreachable nodes");
        }
    }

    #[test]
    fn positions_are_unique_per_class_and_the_start_is_at_the_origin() {
        for c in [ClassId::Wizard, ClassId::Paladin, ClassId::Barbarian, ClassId::ElvenRanger] {
            let t = tree(c);
            assert_eq!(def(start(c)).pos, (0, 0));
            for (i, a) in t.iter().enumerate() {
                for b in &t[i + 1..] {
                    assert_ne!(a.pos, b.pos, "{:?} and {:?} share a position", a.id, b.id);
                }
            }
        }
    }

    #[test]
    fn unlocks_and_improves_name_abilities_of_the_class() {
        for d in NodeId::ALL.into_iter().map(def) {
            match d.kind {
                NodeKind::Unlock(a) => {
                    assert!(ab::def(a).classes.contains(&d.class), "{:?}", d.id);
                    let cd = super::super::classes::def(d.class);
                    assert!(a != cd.primary && a != cd.secondary, "{:?} unlocks a start ability", d.id);
                }
                NodeKind::Improve(a, _) => assert!(ab::def(a).classes.contains(&d.class), "{:?}", d.id),
                _ => {}
            }
        }
    }

    #[test]
    fn ids_and_defs_agree() {
        for id in NodeId::ALL {
            assert_eq!(def(id).id, id);
        }
    }

    #[test]
    fn gains_add_up() {
        let g = gains(&[NodeId::WA1, NodeId::WA4, NodeId::WF3, NodeId::WA3, NodeId::WA2, NodeId::WA5]);
        assert_eq!(g.attrs.get(Attr::Int), 2);
        assert_eq!(g.res, vec![(DamageType::Cold, 0.2)]);
        assert_eq!(g.unlocks, vec![AbilityId::ChainSpark]);
        assert_eq!(g.improves, vec![(AbilityId::MagicMissile, AbilityMod::Pierce(1))]);
        assert!(g.keystones.has(Keystone::ArcaneOverflow) && !g.keystones.has(Keystone::Pyromancer));
        assert_eq!(g.keystones.iter().collect::<Vec<_>>(), vec![Keystone::ArcaneOverflow]);
    }

    #[test]
    fn buying_needs_a_neighbour_and_the_requirements() {
        let int15 = Attributes::new(8, 14, 12, 15, 13, 10);
        assert_eq!(check_buy(ClassId::Wizard, &[], NodeId::WA1, &int15), Ok(()), "next to the start");
        assert!(check_buy(ClassId::Wizard, &[], NodeId::WA2, &int15).is_err(), "no owned neighbour");
        assert_eq!(check_buy(ClassId::Wizard, &[NodeId::WA1], NodeId::WA2, &int15), Ok(()));
        assert!(check_buy(ClassId::Wizard, &[NodeId::WA1, NodeId::WA2], NodeId::WA3, &int15).is_err(), "INT 18");
        assert!(check_buy(ClassId::Wizard, &[NodeId::WA1], NodeId::WA1, &int15).is_err(), "owned");
        assert!(check_buy(ClassId::Paladin, &[], NodeId::WA1, &int15).is_err(), "other class");
        assert!(check_buy(ClassId::Wizard, &[], NodeId::W0, &int15).is_err(), "the start is owned");
        // A weapon requirement never blocks buying: Hurl (needs throwing axes) with a Great Axe.
        let barb = Attributes::new(15, 13, 14, 8, 12, 10);
        assert_eq!(check_buy(ClassId::Barbarian, &[NodeId::BR1], NodeId::BR2, &barb), Ok(()));
    }
}
