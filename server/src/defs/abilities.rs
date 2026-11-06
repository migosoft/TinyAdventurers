//! The abilities as data (spec §6.3): what each one is, what it uses and its own numbers.
//! `sheet::resolve_ability` turns a def into a hero's numbers.

use super::attributes::{Attr, CHA_DMG, INT_DMG};
use super::damage::{DamageSplit, DamageType};
use super::effects::{EffectKind, EffectLook};
use super::enemies::EnemyType;
use super::kinds::EntityKind;
use super::requirements::Requirement;
use super::weapons::WeaponKind;
use crate::protocol::ClassId;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

super::enum_list::listed_enum! {
    /// Every ability any creature can have. `classes` empty: not for heroes.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
    pub enum AbilityId: u8 {
        MagicMissile = 0,
        Fireball = 1,
        /// A strike with the melee weapon; also every hero's fallback in melee.
        Strike = 2,
        HolyLight = 3,
        /// The Barbarian's dash: hurts what it touches with the melee weapon.
        Charge = 4,
        /// A shot of the ranged weapon.
        Shoot = 5,
        /// Summons or heals the Dire Wolf.
        SummonWolf = 6,
        /// A frost bolt that chills.
        FrostShard = 7,
        /// A spark that jumps on to the nearest enemies.
        ChainSpark = 8,
        /// The Paladin's holy bolt.
        Judgement = 9,
        /// A throw of the Throwing Axes.
        Hurl = 10,
        /// Three arrows in a fan.
        Volley = 11,
        /// A sword, mace or hammer strike with a holy share.
        Smite = 12,
        /// A swing all around.
        Whirl = 13,
        /// A thrust that does double from behind.
        FlankingThrust = 14,
        /// Coats the weapon in poison for a while.
        PoisonCoat = 15,
        /// A ring of frost around the Wizard that freezes.
        FrostNova = 16,
        /// A shout that frightens enemies and hastens allies.
        WarCry = 17,
        /// A hammer blow that lands after a wind-up.
        GroundSlam = 18,
        /// Hastens the party around.
        Haste = 19,
        /// Cleanses the party around and wards it.
        Purify = 20,
        /// Holy ground at the Paladin's feet that hurts enemies standing in it.
        Consecrate = 21,
        /// Roots at an aimed spot that entangle enemies standing in them.
        Entangle = 22,
        /// A strike that needs a bite weapon: the monsters' bite.
        Bite = 23,
        /// The necromancer's and the disciple's bolt of shadow.
        ShadowBolt = 24,
        /// The bolt of fire of imps, chorts and summoners.
        FireBolt = 25,
        /// The wolf's leap: a dash that crosses chasms, stops at the first foe it hits and hurts it hard.
        Pounce = 26,
        /// A swing behind the user with a tail weapon: the dragon's tail whip.
        TailWhip = 27,
        /// The dragon's channelled cone of fire, which leaves burning patches.
        FireBreath = 28,
        /// The dragon's landing: an instant blow all around.
        Smash = 29,
        /// The demon's long dash that hurts each foe it passes once.
        Swoop = 30,
        /// The demon's ring of fire orbs.
        RingOfFire = 31,
        /// The lich's burst of dark power, pushing everything away.
        Nova = 32,
        /// The lich's fan of five gloom bolts.
        GloomBolts = 33,
        /// A slow orb that blinds.
        BlindingCurse = 34,
        /// A slow orb that puts to sleep.
        SleepMist = 35,
        /// The lich's gaze that turns its target to stone.
        StoneGaze = 36,
        /// A chilling touch with a spectral weapon: the ghost's and the shade's.
        Touch = 37,
        /// The ambusher's fade from sight: Invisibility as a kit ability.
        Vanish = 38,
        /// Raises skeletons and skeleton archers to fight for the caster.
        RaiseDead = 39,
        /// Summons imps to fight for the caster.
        SummonImps = 40,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum AbilitySlot {
    Primary,
    Secondary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum AbilityCategory {
    WeaponAttack,
    Technique,
    Spell,
    Innate,
}

/// The weapon an ability strikes with, if any.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Uses {
    Melee,
    Ranged,
    Nothing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Shape {
    Swing,
    Projectile,
    Blast,
    /// An instant hit on the enemies around the user.
    Ring,
    Dash,
    /// An effect or a heal on the user and the allies around.
    SelfArea,
    /// A hazard placed at the user's feet or at an aimed spot.
    GroundArea,
    /// An effect on the user only.
    Buff,
    Summon,
    /// A channelled cone: damage pulses and burning patches over its duration.
    Breath,
    /// An effect on the target the user has locked, if it still sees it.
    Gaze,
}

/// The effect an ability applies by itself (to the user, the allies around, or the enemies a
/// ring or a hazard touches), for its `duration`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OwnEffect {
    pub kind: EffectKind,
    /// The Attribute whose value is the effect's power.
    pub power: Attr,
    pub look: EffectLook,
}

/// An ability's own numbers (those it does not take from a weapon).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OwnStats {
    pub damage: f64,
    pub cooldown: f64,
    pub range: f64,
    pub speed: f64,
    pub radius: f64,
    pub duration: f64,
    /// Its projectile or ground area; its split is `kind_split(kind)` unless `split` is set.
    pub kind: Option<EntityKind>,
    /// The split, instead of `kind_split(kind)`.
    pub split: Option<DamageSplit>,
    /// The effect it applies by itself.
    pub effects: &'static [OwnEffect],
    /// The governing Attribute's value at which `damage` is given.
    pub at: i32,
    /// A push (px) it gives at least; a weapon's push counts too, the larger wins.
    pub push: f64,
    /// The wind-up (s) before it lands, on top of its weapon's.
    pub windup: f64,
    /// How many shots one use makes; 0 means 1.
    pub count: u8,
    /// The angle (rad) between the outer two shots of a use of several.
    pub spread: f64,
    /// The minions it raises, if it is a minion summon.
    pub minions: Option<OwnMinions>,
}

/// Which minions a summon raises.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Minions {
    Undead,
    Imps,
}

impl Minions {
    /// The enemy types it raises, the melee one first.
    pub fn raises(self) -> &'static [EnemyType] {
        match self {
            Minions::Undead => &[EnemyType::RaisedSkeleton, EnemyType::RaisedArcher],
            Minions::Imps => &[EnemyType::SummonedImp],
        }
    }
}

/// A minion summon's own numbers: how many one cast raises and how many it keeps alive, each
/// given at the governing Attribute value `OwnStats.at`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OwnMinions {
    pub kind: Minions,
    pub per_cast: f64,
    pub alive: f64,
}

/// How a weapon ability changes its weapon's numbers.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WeaponMult {
    pub damage: f64,
    /// The weapon's interval is multiplied by this (when the ability has no cooldown of its own).
    pub time: f64,
    /// The arc, instead of the weapon's.
    pub arc: Option<f64>,
    /// A non-physical share added to the weapon's split (`DamageSplit::with_shares`).
    pub share: Option<(DamageType, f64)>,
}

impl WeaponMult {
    pub const ONE: WeaponMult = WeaponMult { damage: 1.0, time: 1.0, arc: None, share: None };
}

impl AbilityDef {
    /// Heroes can have it (some class pool lists it); the rest belong to monsters.
    pub fn for_heroes(&self) -> bool {
        !self.classes.is_empty()
    }
}

#[cfg(test)]
/// Whether two names are the same once case, spaces, hyphens and apostrophes are ignored.
pub fn same_name(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.chars().filter(|c| !matches!(c, ' ' | '-' | '\'' | '\u{2019}')).flat_map(char::to_lowercase).collect::<String>();
    norm(a) == norm(b)
}

/// The behaviour that comes with an ability (run/modules.rs): giving a creature the ability gives it the
/// behaviour. The base AI asks the kit's modules at fixed points.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Module {
    /// Pounce: leaps at prey (used from Task 4 of #227 on).
    Leap,
    /// Vanish: vanish on sight, drift unseen to the straggler, warn, strike (run/ambush.rs).
    Ambush,
    /// Raise Dead, Summon Imps: raise minions when a foe is in sight (run/minions.rs).
    Minions,
}

#[derive(Debug, Clone, Copy)]
pub struct AbilityDef {
    pub id: AbilityId,
    pub name: &'static str,
    pub slot: AbilitySlot,
    pub category: AbilityCategory,
    /// Whether the ability is magic (Spell and Innate today): what an anti-magic effect or a Dispel pauses (#187).
    #[allow(dead_code)] // read by #216 (anti-magic areas)
    pub magical: bool,
    pub uses: Uses,
    /// A ranged ability: in melee a primary falls back to Strike and a secondary is blocked.
    pub ranged: bool,
    pub req: &'static [Requirement],
    pub shape: Shape,
    pub own: OwnStats,
    pub weapon_mult: WeaponMult,
    /// The half-angle (rad) of the cone "from behind" its target in which it does more; 0 = none.
    pub behind: f64,
    /// A swing aimed behind the user.
    pub backward: bool,
    /// The classes whose own pool can hold it: the class start now, the tree in plan 4.
    pub classes: &'static [ClassId],
    /// The behaviour that comes with the ability, if any.
    pub module: Option<Module>,
}

pub const DASH_SPEED: f64 = 300.0;
/// Vanish: the longest (s) an ambusher stays Invisible.
pub const AMBUSH_MAX_INVISIBLE: f64 = 5.0;
/// Volley: the arrows of one shot, and the angle between the outer two (30 degrees).
pub const VOLLEY_ARROWS: u8 = 3;
pub const VOLLEY_SPREAD: f64 = 30.0 * std::f64::consts::PI / 180.0;
/// Chain Spark: how many times it jumps on, how far (px) from the last target, and the factor on
/// the damage of each jump.
pub const CHAIN_JUMPS: u8 = 2;
pub const CHAIN_REACH: f64 = 48.0;
pub const CHAIN_FALLOFF: f64 = 0.7;
/// "From behind": the half-angle (60 degrees) of the cone behind a target, and the factor on a hit inside it.
pub const BEHIND_ARC: f64 = 60.0 * std::f64::consts::PI / 180.0;
pub const BEHIND_MULT: f64 = 2.0;
/// Poison Coat: the poison share added to every weapon attack, and the seconds of Poisoned it applies.
pub const COAT_SHARE: f64 = 0.3;
pub const COAT_POISON_SECS: f64 = 3.0;
/// How long (s) Smite's holy flash lasts.
pub const SMITE_FLASH: f64 = 0.3;
/// Ground Slam: the wind-up (s) before it lands, and the push (px) it gives at least.
pub const SLAM_WINDUP: f64 = 0.5;
pub const SLAM_PUSH: f64 = 24.0;
/// The wind-up (s) of the monsters' bolts, before the shot leaves (balancing).
pub const SHADOW_BOLT_WINDUP: f64 = 0.5;
pub const FIRE_BOLT_WINDUP: f64 = 0.35;
/// Fireball: the push (px) of its explosion, for every caster. A boss is never pushed.
pub const FIREBALL_PUSH: f64 = 20.0;
/// Fire Breath's half-angle (rad): the cone reaches this far to each side of the aim.
pub const BREATH_HALF_ARC: f64 = 0.38;
/// Fire Breath: the seconds between pulses, and the burning patches each pulse may leave (the
/// chance, the radius in px, the seconds they burn, the damage of a patch's pulse, and how far
/// from the user a patch lands at the nearest).
pub const BREATH_PULSE: f64 = 0.2;
pub const BREATH_PATCH_CHANCE: f64 = 0.5;
pub const BREATH_PATCH_RADIUS: f64 = 10.0;
pub const BREATH_PATCH_SECS: f64 = 3.0;
pub const BREATH_PATCH_DAMAGE: f64 = 8.0;
pub const BREATH_PATCH_NEAREST: f64 = 30.0;
/// How long (s) Frost Nova's and Purify's flashes last.
pub const NOVA_FLASH: f64 = 0.3;
/// The Magic flash's colour: icy blue, like the Frost Shard's light.
pub const NOVA_TINT: u32 = 0x78c8ff;
pub const PURIFY_FLASH: f64 = 0.3;
/// Entangle: the seconds of Entangled each pulse of the roots (every 0.5 s) renews.
pub const ENTANGLE_PULSE_SECS: f64 = 1.0;
/// Raise Dead and Summon Imps (balancing): the minions one cast raises and the most it keeps alive
/// (both at INT 10), its cooldown and wind-up (s).
pub const MINION_PER_CAST: f64 = 1.2;
pub const MINION_ALIVE: f64 = 2.4;
pub const MINION_COOLDOWN: f64 = 12.0;
pub const MINION_WINDUP: f64 = 0.7;

/// The angles (rad), relative to the aim, of the shots of one use of `count` (0 means 1) over
/// `spread`: a single shot flies straight ahead; a `spread` of a full circle or more spaces them
/// evenly all around (`TAU / count`); otherwise they fan out symmetrically, the outer two `spread` apart.
pub fn shot_offsets(count: u8, spread: f64) -> Vec<f64> {
    let n = count.max(1) as usize;
    if n == 1 {
        return vec![0.0];
    }
    if spread >= std::f64::consts::TAU {
        let step = std::f64::consts::TAU / n as f64;
        return (0..n).map(|i| i as f64 * step).collect();
    }
    let step = spread / (n - 1) as f64;
    (0..n).map(|i| (i as f64 - (n - 1) as f64 / 2.0) * step).collect()
}

/// The id of arrow `i` of a Volley that starts at `shot`: the server's rule; the client
/// reserves ids so that none is 0.
pub fn volley_shot(shot: u16, i: u8) -> u16 {
    shot.wrapping_add(i as u16)
}
/// Knockback: the push speed is multiplied by this every 1/60 s step
/// (e^-0.25, so a push is mostly over after about 0.2 s), and stops below
/// `KNOCK_MIN_SPEED` px/s. See `collision::knock_speed`.
pub const KNOCK_DECAY: f64 = 0.7788007830714049;
pub const KNOCK_MIN_SPEED: f64 = 8.0;

/// No own numbers: a weapon ability takes them all from its weapon.
const NO_OWN: OwnStats = OwnStats { damage: 0.0, cooldown: 0.0, range: 0.0, speed: 0.0, radius: 0.0, duration: 0.0, kind: None, split: None, effects: &[], at: 0, push: 0.0, windup: 0.0, count: 0, spread: 0.0, minions: None };

/// One sentence on what the ability does, for the character screens.
#[allow(dead_code)] // read by the progression.ts export (a test) only
pub fn text(id: AbilityId) -> &'static str {
    match id {
        AbilityId::MagicMissile => "Fast arcane bolts.",
        AbilityId::Fireball => "Explodes where it lands, hurting everything nearby and pushing the light ones back.",
        AbilityId::Strike => "A sweeping blow with your melee weapon.",
        AbilityId::HolyLight => "Heals you and the allies close to you.",
        AbilityId::Charge => "Dash toward the cursor, hitting everything in the way.",
        AbilityId::Shoot => "Shoot your ranged weapon. In melee you strike with your melee weapon instead.",
        AbilityId::SummonWolf => "Calls your Dire Wolf, or heals it while it lives.",
        AbilityId::FrostShard => "A quick bolt, mostly cold, that chills what it hits.",
        AbilityId::ChainSpark => "A bolt that jumps to up to two more enemies close by, weaker each time.",
        AbilityId::Judgement => "A bolt of holy light. In melee you strike with your weapon instead.",
        AbilityId::Hurl => "Throw an axe that spins as it flies.",
        AbilityId::Volley => "Three arrows in a fan, each weaker.",
        AbilityId::Smite => "A slow, hard swing with a holy part.",
        AbilityId::Whirl => "A swing all the way around you, weaker and slower than a strike.",
        AbilityId::FlankingThrust => "A thrust that does double damage from behind.",
        AbilityId::PoisonCoat => "For a while your weapon attacks add poison and poison what they hit.",
        AbilityId::FrostNova => "A ring of cold around you that hurts and freezes every enemy in sight.",
        AbilityId::WarCry => "A shout that frightens the enemies close to you and speeds up you and your allies.",
        AbilityId::GroundSlam => "Slam the ground after a short wind-up, hitting and pushing everything around you.",
        AbilityId::Haste => "You and the allies close to you run faster for a while.",
        AbilityId::Purify => "Clears bad effects from you and the allies close to you and wards you against curses for a moment.",
        AbilityId::Consecrate => "Holy ground under your feet that hurts enemies standing in it.",
        AbilityId::Entangle => "Vines grow where you aim and root the enemies in them.",
        AbilityId::Bite => "A snap of the jaws, a strike with a natural bite weapon.",
        AbilityId::ShadowBolt => "A slow bolt of shadow.",
        AbilityId::FireBolt => "A bolt of fire.",
        AbilityId::Pounce => "A leap that crosses chasms and hits the first enemy it reaches, hard.",
        AbilityId::TailWhip => "A lash of the tail behind the user.",
        AbilityId::FireBreath => "A cone of fire held for a moment, leaving burning patches on the ground.",
        AbilityId::Smash => "A blow all around the user that pushes everything away.",
        AbilityId::Swoop => "A long rush that hurts each enemy it passes once and pushes it hard.",
        AbilityId::RingOfFire => "Sixteen fire orbs flung out in a ring.",
        AbilityId::Nova => "A burst of dark power that hurts and pushes everything around the caster.",
        AbilityId::GloomBolts => "Five bolts of gloom in a fan.",
        AbilityId::BlindingCurse => "A slow orb that blinds what it hits.",
        AbilityId::SleepMist => "A slow orb that puts what it hits to sleep.",
        AbilityId::Touch => "A chilling touch that drains the living.",
        AbilityId::Vanish => "Fades from sight until it strikes.",
        AbilityId::RaiseDead => "Raises skeletons, half of them archers, that fight for the caster.",
        AbilityId::SummonImps => "Summons imps that fight for the caster.",
        AbilityId::StoneGaze => "A stare that turns the target to stone, if it still sees it when the gaze lands.",
    }
}

/// Does using it count as an attack (it ends Invisible)? Damage, a weapon, or a harmful own effect.
/// A self area's `damage` is the amount it heals (Holy Light), so that is no attack.
pub fn is_attack(d: &AbilityDef) -> bool {
    (d.own.damage > 0.0 && d.shape != Shape::SelfArea) || d.uses != Uses::Nothing || d.own.effects.iter().any(|e| !super::effects::def(e.kind).positive)
}

pub fn def(id: AbilityId) -> AbilityDef {
    use AbilityCategory as C;
    use AbilityId::*;
    use AbilitySlot::*;
    use ClassId as K;
    #[allow(clippy::too_many_arguments)]
    const fn own(damage: f64, cooldown: f64, range: f64, speed: f64, radius: f64, duration: f64, kind: Option<EntityKind>, at: i32) -> OwnStats {
        OwnStats { damage, cooldown, range, speed, radius, duration, kind, split: None, effects: &[], at, push: 0.0, windup: 0.0, count: 0, spread: 0.0, minions: None }
    }
    let base = |name: &'static str, slot, category, uses, ranged, shape, own, classes: &'static [ClassId]| AbilityDef {
        id,
        name,
        slot,
        category,
        magical: matches!(category, C::Spell | C::Innate),
        uses,
        ranged,
        req: &[],
        shape,
        own,
        weapon_mult: WeaponMult::ONE,
        behind: 0.0,
        backward: false,
        classes,
        module: None,
    };
    match id {
        MagicMissile => base("Magic Missile", Primary, C::Spell, Uses::Nothing, true, Shape::Projectile, own(12.0, 0.35, 220.0, 230.0, 3.0, 0.0, Some(EntityKind::Missile), 15), &[K::Wizard]),
        Fireball => base("Fireball", Secondary, C::Spell, Uses::Nothing, true, Shape::Blast, OwnStats { push: FIREBALL_PUSH, ..own(45.0, 6.0, 260.0, 140.0, 38.0, 0.0, Some(EntityKind::Fireball), 15) }, &[K::Wizard]),
        Strike => base("Strike", Primary, C::WeaponAttack, Uses::Melee, false, Shape::Swing, NO_OWN, &[K::Paladin, K::Barbarian]),
        HolyLight => base("Holy Light", Secondary, C::Innate, Uses::Nothing, false, Shape::SelfArea, own(35.0, 10.0, 64.0, 0.0, 64.0, 0.0, None, 14), &[K::Paladin]),
        Charge => AbilityDef {
            weapon_mult: WeaponMult { damage: 0.8, ..WeaponMult::ONE },
            ..base("Charge", Secondary, C::Technique, Uses::Melee, false, Shape::Dash, own(0.0, 5.0, 0.0, DASH_SPEED, 4.0, 0.18, None, 0), &[K::Barbarian])
        },
        Shoot => base("Shoot", Primary, C::WeaponAttack, Uses::Ranged, true, Shape::Projectile, NO_OWN, &[K::ElvenRanger]),
        FrostShard => AbilityDef {
            req: &[Requirement::Attr(Attr::Int, 14)],
            own: OwnStats { split: Some(DamageSplit::split(&[(DamageType::Cold, 0.4), (DamageType::Magical, 0.3)])), ..own(10.0, 0.5, 200.0, 200.0, 3.0, 0.0, Some(EntityKind::FrostBolt), 14) },
            ..base("Frost Shard", Primary, C::Spell, Uses::Nothing, true, Shape::Projectile, NO_OWN, &[K::Wizard])
        },
        ChainSpark => AbilityDef {
            req: &[Requirement::Attr(Attr::Int, 18)],
            ..base("Chain Spark", Primary, C::Spell, Uses::Nothing, true, Shape::Projectile, own(14.0, 0.8, 180.0, 260.0, 3.0, 0.0, Some(EntityKind::ChainSpark), 18), &[K::Wizard])
        },
        Judgement => AbilityDef {
            req: &[Requirement::Attr(Attr::Cha, 16)],
            ..base("Judgement", Primary, C::Innate, Uses::Nothing, true, Shape::Projectile, own(18.0, 0.9, 150.0, 220.0, 3.0, 0.0, Some(EntityKind::Judgement), 16), &[K::Paladin])
        },
        Hurl => AbilityDef {
            req: &[Requirement::WeaponKind(&[WeaponKind::ThrowingAxe])],
            ..base("Hurl", Primary, C::WeaponAttack, Uses::Ranged, true, Shape::Projectile, NO_OWN, &[K::Barbarian])
        },
        Volley => AbilityDef {
            req: &[Requirement::Attr(Attr::Dex, 15), Requirement::WeaponKind(&[WeaponKind::Bow, WeaponKind::Longbow])],
            weapon_mult: WeaponMult { damage: 0.6, time: 1.4, ..WeaponMult::ONE },
            own: OwnStats { count: VOLLEY_ARROWS, spread: VOLLEY_SPREAD, ..NO_OWN },
            ..base("Volley", Primary, C::WeaponAttack, Uses::Ranged, true, Shape::Projectile, NO_OWN, &[K::ElvenRanger])
        },
        Smite => AbilityDef {
            req: &[Requirement::Attr(Attr::Cha, 15), Requirement::WeaponKind(&[WeaponKind::Sword, WeaponKind::Mace, WeaponKind::Hammer])],
            weapon_mult: WeaponMult { damage: 1.4, time: 1.6, share: Some((DamageType::Magical, 0.3)), ..WeaponMult::ONE },
            ..base("Smite", Primary, C::WeaponAttack, Uses::Melee, false, Shape::Swing, NO_OWN, &[K::Paladin])
        },
        Whirl => AbilityDef {
            req: &[Requirement::Attr(Attr::Dex, 14)],
            weapon_mult: WeaponMult { damage: 0.75, time: 1.3, arc: Some(std::f64::consts::TAU), ..WeaponMult::ONE },
            ..base("Whirl", Primary, C::Technique, Uses::Melee, false, Shape::Swing, NO_OWN, &[K::Barbarian])
        },
        FlankingThrust => AbilityDef {
            req: &[Requirement::Attr(Attr::Dex, 16), Requirement::WeaponKind(&[WeaponKind::Dagger, WeaponKind::DuellingSword, WeaponKind::Katana, WeaponKind::Machete])],
            behind: BEHIND_ARC,
            ..base("Flanking Thrust", Primary, C::WeaponAttack, Uses::Melee, false, Shape::Swing, NO_OWN, &[K::ElvenRanger])
        },
        PoisonCoat => AbilityDef {
            req: &[Requirement::Attr(Attr::Wil, 15)],
            own: OwnStats { effects: &[OwnEffect { kind: EffectKind::Coated, power: Attr::Wil, look: EffectLook::Plain }], ..own(0.0, 16.0, 0.0, 0.0, 0.0, 6.0, None, 0) },
            ..base("Poison Coat", Secondary, C::Technique, Uses::Nothing, false, Shape::Buff, NO_OWN, &[K::ElvenRanger])
        },
        FrostNova => AbilityDef {
            req: &[Requirement::Attr(Attr::Int, 17)],
            own: OwnStats { split: Some(DamageSplit::pure(DamageType::Cold)), ..own(22.0, 9.0, 0.0, 0.0, 44.0, 0.0, None, 17) },
            ..base("Frost Nova", Secondary, C::Spell, Uses::Nothing, false, Shape::Ring, NO_OWN, &[K::Wizard])
        },
        WarCry => AbilityDef {
            req: &[Requirement::Attr(Attr::Str, 16)],
            own: OwnStats { effects: &[OwnEffect { kind: EffectKind::Fear, power: Attr::Str, look: EffectLook::Plain }], ..own(0.0, 12.0, 0.0, 0.0, 56.0, 3.0, None, 0) },
            ..base("War Cry", Secondary, C::Technique, Uses::Nothing, false, Shape::Ring, NO_OWN, &[K::Barbarian])
        },
        GroundSlam => AbilityDef {
            req: &[Requirement::Attr(Attr::Str, 17), Requirement::WeaponKind(&[WeaponKind::Hammer, WeaponKind::Club])],
            weapon_mult: WeaponMult { damage: 1.2, ..WeaponMult::ONE },
            ..base("Ground Slam", Secondary, C::Technique, Uses::Melee, false, Shape::Ring, OwnStats { push: SLAM_PUSH, windup: SLAM_WINDUP, ..own(0.0, 6.0, 0.0, 0.0, 34.0, 0.0, None, 0) }, &[K::Barbarian])
        },
        Haste => AbilityDef {
            req: &[Requirement::Attr(Attr::Int, 15), Requirement::Attr(Attr::Wil, 14)],
            own: OwnStats { effects: &[OwnEffect { kind: EffectKind::Accelerated, power: Attr::Int, look: EffectLook::Plain }], ..own(0.0, 14.0, 64.0, 0.0, 64.0, 4.0, None, 0) },
            ..base("Haste", Secondary, C::Spell, Uses::Nothing, false, Shape::SelfArea, NO_OWN, &[K::Wizard])
        },
        Purify => AbilityDef {
            req: &[Requirement::Attr(Attr::Wil, 14)],
            own: OwnStats { effects: &[OwnEffect { kind: EffectKind::Warded, power: Attr::Cha, look: EffectLook::Plain }], ..own(0.0, 15.0, 64.0, 0.0, 64.0, 3.0, None, 0) },
            ..base("Purify", Secondary, C::Innate, Uses::Nothing, false, Shape::SelfArea, NO_OWN, &[K::Paladin])
        },
        Consecrate => AbilityDef {
            req: &[Requirement::Attr(Attr::Cha, 15)],
            ..base("Consecrate", Secondary, C::Innate, Uses::Nothing, false, Shape::GroundArea, own(8.0, 12.0, 0.0, 0.0, 40.0, 5.0, Some(EntityKind::HolyGround), 15), &[K::Paladin])
        },
        Entangle => AbilityDef {
            req: &[Requirement::Attr(Attr::Cha, 14)],
            own: OwnStats { effects: &[OwnEffect { kind: EffectKind::Entangled, power: Attr::Cha, look: EffectLook::Vines }], ..own(0.0, 14.0, 120.0, 0.0, 36.0, 4.0, Some(EntityKind::Roots), 0) },
            ..base("Entangle", Secondary, C::Innate, Uses::Nothing, true, Shape::GroundArea, NO_OWN, &[K::ElvenRanger])
        },
        Bite => AbilityDef {
            req: &[Requirement::WeaponKind(&[WeaponKind::Bite])],
            ..base("Bite", Primary, C::WeaponAttack, Uses::Melee, false, Shape::Swing, NO_OWN, &[])
        },
        ShadowBolt => AbilityDef {
            own: OwnStats { windup: SHADOW_BOLT_WINDUP, ..own(12.0, 2.0, 180.0, 130.0, 3.0, 0.0, Some(EntityKind::ShadowBolt), 17) },
            ..base("Shadow Bolt", Primary, C::Spell, Uses::Nothing, true, Shape::Projectile, NO_OWN, &[])
        },
        FireBolt => AbilityDef {
            own: OwnStats { windup: FIRE_BOLT_WINDUP, ..own(7.0, 2.0, 150.0, 130.0, 3.0, 0.0, Some(EntityKind::FireBolt), 14) },
            ..base("Fire Bolt", Primary, C::Innate, Uses::Nothing, true, Shape::Projectile, NO_OWN, &[])
        },
        Pounce => AbilityDef {
            module: Some(Module::Leap),
            weapon_mult: WeaponMult { damage: 2.0, ..WeaponMult::ONE },
            ..base("Pounce", Secondary, C::Technique, Uses::Melee, false, Shape::Dash, OwnStats { push: 12.0, ..own(0.0, 5.0, 64.0, DASH_SPEED, 4.0, 0.0, None, 0) }, &[])
        },
        TailWhip => AbilityDef {
            req: &[Requirement::WeaponKind(&[WeaponKind::Tail])],
            backward: true,
            ..base("Tail Whip", Secondary, C::WeaponAttack, Uses::Melee, false, Shape::Swing, NO_OWN, &[])
        },
        FireBreath => AbilityDef {
            weapon_mult: WeaponMult { arc: Some(2.0 * BREATH_HALF_ARC), ..WeaponMult::ONE },
            own: OwnStats { windup: 0.8, ..own(6.0, 6.5, 115.0, 0.0, 0.0, 1.4, Some(EntityKind::FireBreath), 20) },
            ..base("Fire Breath", Secondary, C::Innate, Uses::Nothing, false, Shape::Breath, NO_OWN, &[])
        },
        Smash => AbilityDef {
            weapon_mult: WeaponMult { damage: 1.1, ..WeaponMult::ONE },
            ..base("Smash", Secondary, C::Technique, Uses::Melee, false, Shape::Ring, OwnStats { push: 36.0, ..own(0.0, 0.0, 0.0, 0.0, 40.0, 0.0, None, 0) }, &[])
        },
        Swoop => AbilityDef {
            weapon_mult: WeaponMult { damage: 1.2, ..WeaponMult::ONE },
            ..base("Swoop", Secondary, C::Technique, Uses::Melee, false, Shape::Dash, OwnStats { push: 64.0, windup: 0.15, ..own(0.0, 6.0, 0.0, 260.0, 8.0, 0.55, None, 0) }, &[])
        },
        RingOfFire => AbilityDef {
            own: OwnStats { windup: 0.5, count: 16, spread: std::f64::consts::TAU, ..own(12.0, 9.0, 231.0, 105.0, 3.0, 0.0, Some(EntityKind::FireOrb), 20) },
            ..base("Ring of Fire", Secondary, C::Innate, Uses::Nothing, true, Shape::Projectile, NO_OWN, &[])
        },
        Nova => AbilityDef {
            own: OwnStats { split: Some(DamageSplit::pure(DamageType::Magical)), push: 64.0, windup: 1.2, ..own(24.0, 10.0, 0.0, 0.0, 56.0, 0.0, None, 22) },
            ..base("Nova", Secondary, C::Spell, Uses::Nothing, false, Shape::Ring, NO_OWN, &[])
        },
        GloomBolts => AbilityDef {
            own: OwnStats { windup: 0.5, count: 5, spread: 0.8, ..own(10.0, 2.5, 280.0, 140.0, 3.0, 0.0, Some(EntityKind::GloomBolt), 22) },
            ..base("Gloom Bolts", Primary, C::Spell, Uses::Nothing, true, Shape::Projectile, NO_OWN, &[])
        },
        BlindingCurse => AbilityDef {
            own: OwnStats { effects: &[OwnEffect { kind: EffectKind::Blind, power: Attr::Int, look: EffectLook::Plain }], windup: 0.6, ..own(6.0, 10.0, 270.0, 90.0, 3.0, 3.0, Some(EntityKind::BlindOrb), 22) },
            ..base("Blinding Curse", Secondary, C::Spell, Uses::Nothing, true, Shape::Projectile, NO_OWN, &[])
        },
        SleepMist => AbilityDef {
            own: OwnStats { effects: &[OwnEffect { kind: EffectKind::Sleep, power: Attr::Int, look: EffectLook::Plain }], windup: 0.8, ..own(0.0, 14.0, 270.0, 90.0, 3.0, 4.0, Some(EntityKind::SleepOrb), 22) },
            ..base("Sleep Mist", Secondary, C::Spell, Uses::Nothing, true, Shape::Projectile, NO_OWN, &[])
        },
        Touch => AbilityDef {
            req: &[Requirement::WeaponKind(&[WeaponKind::Touch])],
            ..base("Touch", Primary, C::WeaponAttack, Uses::Melee, false, Shape::Swing, NO_OWN, &[])
        },
        Vanish => AbilityDef {
            module: Some(Module::Ambush),
            own: OwnStats { effects: &[OwnEffect { kind: EffectKind::Invisible, power: Attr::Cha, look: EffectLook::Plain }], ..own(0.0, 20.0, 0.0, 0.0, 0.0, AMBUSH_MAX_INVISIBLE, None, 10) },
            ..base("Vanish", Secondary, C::Innate, Uses::Nothing, false, Shape::Buff, NO_OWN, &[])
        },
        StoneGaze => AbilityDef {
            own: OwnStats { effects: &[OwnEffect { kind: EffectKind::Petrified, power: Attr::Int, look: EffectLook::Plain }], windup: 1.0, ..own(0.0, 18.0, 0.0, 0.0, 0.0, 3.0, None, 0) },
            ..base("Stone Gaze", Secondary, C::Spell, Uses::Nothing, false, Shape::Gaze, NO_OWN, &[])
        },
        RaiseDead | SummonImps => {
            let kind = if id == RaiseDead { Minions::Undead } else { Minions::Imps };
            AbilityDef {
                module: Some(Module::Minions),
                own: OwnStats { windup: MINION_WINDUP, minions: Some(OwnMinions { kind, per_cast: MINION_PER_CAST, alive: MINION_ALIVE }), ..own(0.0, MINION_COOLDOWN, 0.0, 0.0, 0.0, 0.0, None, 10) },
                ..base(if id == RaiseDead { "Raise Dead" } else { "Summon Imps" }, Secondary, C::Spell, Uses::Nothing, false, Shape::Summon, NO_OWN, &[])
            }
        }
        SummonWolf => base("Summon Wolf", Secondary, C::Innate, Uses::Nothing, false, Shape::Summon, own(0.0, 8.0, 0.0, 0.0, 0.0, 0.0, None, 13), &[K::ElvenRanger]),
    }
}

/// The Attribute that shortens an ability's cooldown (`CD_PCT` per point from `BASELINE`):
/// INT for a spell, CHA for an innate ability, DEX for a technique and a weapon attack.
pub fn cooldown_attr(c: AbilityCategory) -> Attr {
    match c {
        AbilityCategory::Spell => Attr::Int,
        AbilityCategory::Innate => Attr::Cha,
        AbilityCategory::Technique | AbilityCategory::WeaponAttack => Attr::Dex,
    }
}

/// The Attribute that governs an ability's category (spec §5, §6.3): it scales a spell's or
/// innate ability's damage (not its cooldown, see `cooldown_attr`) and is the power of its
/// damage-type effects, with the percentage each point moves that damage by. Weapon attacks and
/// techniques have none: their numbers and power are the weapon's.
pub fn governing(c: AbilityCategory) -> Option<(Attr, f64)> {
    match c {
        AbilityCategory::Spell => Some((Attr::Int, INT_DMG)),
        AbilityCategory::Innate => Some((Attr::Cha, CHA_DMG)),
        AbilityCategory::WeaponAttack | AbilityCategory::Technique => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modules_come_with_their_ability() {
        for id in AbilityId::ALL {
            let want = match id {
                AbilityId::Pounce => Some(Module::Leap),
                AbilityId::Vanish => Some(Module::Ambush),
                AbilityId::RaiseDead | AbilityId::SummonImps => Some(Module::Minions),
                _ => None,
            };
            assert_eq!(def(id).module, want, "{id:?}");
        }
    }
    use crate::defs::classes;

    #[test]
    fn each_category_has_a_cooldown_attribute() {
        use AbilityCategory::*;
        assert_eq!([Spell, Innate, Technique, WeaponAttack].map(cooldown_attr), [Attr::Int, Attr::Cha, Attr::Dex, Attr::Dex]);
    }

    #[test]
    fn ability_magic_follows_the_table() {
        for id in AbilityId::ALL {
            let d = def(id);
            assert_eq!(d.magical, matches!(d.category, AbilityCategory::Spell | AbilityCategory::Innate), "{id:?}");
        }
    }

    #[test]
    fn touch_needs_a_touch_weapon() {
        let d = def(AbilityId::Touch);
        assert_eq!(d.req, &[Requirement::WeaponKind(&[WeaponKind::Touch])]);
        assert_eq!(d.slot, AbilitySlot::Primary);
        assert_eq!(d.shape, Shape::Swing);
        assert!(!d.for_heroes());
    }

    #[test]
    fn every_ability_has_a_text() {
        for &id in AbilityId::ALL.iter() {
            assert!(!text(id).is_empty() && text(id).ends_with('.'), "{id:?}");
        }
    }

    #[test]
    fn ability_data_is_consistent() {
        for id in AbilityId::ALL {
            let d = def(id);
            assert_eq!(d.id, id);
            let magic = matches!(d.category, AbilityCategory::Spell | AbilityCategory::Innate);
            if magic {
                assert_eq!(d.uses, Uses::Nothing, "{id:?}: a spell or innate ability uses nothing");
            }
            match d.uses {
                Uses::Melee => assert!(matches!(d.shape, Shape::Swing | Shape::Dash | Shape::Ring), "{id:?}: a melee ability swings, dashes or rings"),
                Uses::Ranged => assert_eq!(d.shape, Shape::Projectile, "{id:?}: a ranged ability shoots"),
                Uses::Nothing => {}
            }
            if matches!(d.shape, Shape::Blast | Shape::GroundArea) && d.ranged {
                assert!(d.own.range > 0.0, "{id:?}: an aimed area needs a range");
            }
            if !d.own.effects.is_empty() {
                assert!(matches!(d.shape, Shape::Ring | Shape::SelfArea | Shape::GroundArea | Shape::Buff | Shape::Projectile | Shape::Gaze), "{id:?}: an own effect needs an area, a buff, a shot or a gaze");
            }
            if magic && d.own.damage > 0.0 {
                assert!(d.own.at > 0, "{id:?}: a spell's damage is given at an Attribute value");
            }
            assert_eq!(d.own.minions.is_some(), d.shape == Shape::Summon && d.id != AbilityId::SummonWolf, "{id:?}: minions belong to the minion summons");
            let nothing = d.uses == Uses::Nothing;
            if d.req.iter().any(|r| matches!(r, Requirement::WeaponKind(_))) {
                assert!(!nothing, "{id:?}: a weapon-kind requirement needs a weapon");
            }
        }
        for c in ClassId::ALL {
            let cd = classes::def(c);
            for (id, slot) in [(cd.primary, AbilitySlot::Primary), (cd.secondary, AbilitySlot::Secondary)] {
                assert_eq!(def(id).slot, slot, "{c:?} {id:?}");
                assert!(def(id).classes.contains(&c), "{c:?} {id:?}");
            }
        }
    }

    #[test]
    fn the_minion_abilities_are_int_spells_with_the_same_numbers() {
        for (id, kind) in [(AbilityId::RaiseDead, Minions::Undead), (AbilityId::SummonImps, Minions::Imps)] {
            let d = def(id);
            assert_eq!((d.category, d.slot, d.uses, d.shape, d.ranged), (AbilityCategory::Spell, AbilitySlot::Secondary, Uses::Nothing, Shape::Summon, false));
            assert!(d.classes.is_empty());
            assert_eq!((d.own.cooldown, d.own.windup, d.own.at), (12.0, 0.7, 10));
            assert_eq!(d.own.minions, Some(OwnMinions { kind, per_cast: 1.2, alive: 2.4 }));
        }
        assert_eq!(Minions::Undead.raises(), &[EnemyType::RaisedSkeleton, EnemyType::RaisedArcher]);
        assert_eq!(Minions::Imps.raises(), &[EnemyType::SummonedImp]);
    }

    #[test]
    fn ability_names_are_unique() {
        for (i, a) in AbilityId::ALL.iter().enumerate() {
            for b in &AbilityId::ALL[i + 1..] {
                assert!(!same_name(def(*a).name, def(*b).name), "{a:?} and {b:?} share a name");
            }
        }
    }

    #[test]
    fn shot_offsets_handle_one_shot_a_fan_and_a_full_circle() {
        assert_eq!(shot_offsets(0, 0.5), vec![0.0], "0 means 1");
        assert_eq!(shot_offsets(1, 0.5), vec![0.0], "a single shot flies straight ahead");
        let fan = shot_offsets(3, 0.6);
        assert!(fan.iter().zip([-0.3, 0.0, 0.3]).all(|(a, b)| (a - b).abs() < 1e-12), "{fan:?}");
        let ring = shot_offsets(16, std::f64::consts::TAU);
        assert_eq!(ring.len(), 16);
        assert!(ring.windows(2).all(|w| (w[1] - w[0] - std::f64::consts::TAU / 16.0).abs() < 1e-12));
        assert_eq!(ring[0], 0.0);
    }

    #[test]
    fn same_name_ignores_case_spaces_hyphens_and_apostrophes() {
        assert!(same_name("Frost Nova", "frost-nova"));
        assert!(same_name("Ogre's Slam", "ogres slam"));
        assert!(!same_name("Nova", "Frost Nova"));
    }
}
