//! The text of the log's lines: number formatting and what each fact is called.

use super::{tag_of, DeathFacts, EffectFacts, EndReason, HealFacts, HitFacts, HitOutcome};
use crate::defs::abilities::AbilityId;
use crate::run::targets::Skip;
use crate::defs::abilities;
use crate::defs::damage::{DamageType, Mult, What, MIN_RESISTANCE};
use crate::defs::effects::EffectKind;
use crate::defs::races::{race_def, Race};
use crate::run::effects::EffectOutcome;
use crate::defs::kinds::EntityKind;
use crate::run::effects::Creature;
use crate::run::Run;

/// One decimal, a trailing ".0" dropped, no negative zero: 9.0 is "9", 10.55 is "10.6", -0.04 is "0".
pub fn n1(v: f64) -> String {
    let s = format!("{:.1}", (v * 10.0).round() / 10.0);
    let s = s.strip_suffix(".0").unwrap_or(&s);
    if s == "-0" { "0".to_string() } else { s.to_string() }
}

/// A fraction as a whole percentage: 0.2 is "20 %".
pub fn pct(fraction: f64) -> String {
    format!("{} %", (fraction * 100.0).round() as i64)
}

pub fn what(w: What) -> String {
    match w {
        What::Ability(id) => abilities::def(id).name.to_string(),
        What::Attack => "attack".to_string(),
        What::Shot(_) => "shot".to_string(),
        What::Move(n) => n.to_string(),
        What::Tick(k) => effect_name(k).to_string(),
        What::Lava => "lava".to_string(),
        What::Blast => "blast".to_string(),
        What::Hazard(k) => hazard_name(k).to_string(),
        What::Unknown => "something".to_string(),
    }
}

fn hazard_name(k: EntityKind) -> &'static str {
    use EntityKind::*;
    match k {
        HolyGround => "Holy Ground",
        Roots => "Roots",
        FirePatch => "fire",
        Wizard | Paladin | Barbarian | ElvenRanger | GoblinArcher | SkeletonWarrior | SkeletonArcher | OrcWarrior | OrcArcher | Necromancer
        | RaisedSkeleton | Disciple | Mimic | Imp | Chort | Summoner | Ogre | DireWolf | Demon | Lich | Dragon | Missile | Fireball | Bolt
        | Arrow | ShadowBolt | FrostBolt | FireBreath | FireOrb | DragonFireball | FireBolt | GloomBolt | BlindOrb | SleepOrb | ChainSpark
        | Judgement | ThrownAxe | Chest | Barrel | Torch => "hazard",
    }
}

pub fn effect_name(k: EffectKind) -> &'static str {
    match k {
        EffectKind::Blind => "Blind",
        EffectKind::Sleep => "Sleep",
        EffectKind::Petrified => "Petrified",
        EffectKind::Slowed => "Slowed",
        EffectKind::Accelerated => "Accelerated",
        EffectKind::Burning => "Burning",
        EffectKind::Frozen => "Frozen",
        EffectKind::Poisoned => "Poisoned",
        EffectKind::Chilled => "Chilled",
        EffectKind::Singed => "Singed",
        EffectKind::Tainted => "Tainted",
        EffectKind::Entangled => "Entangled",
        EffectKind::Fear => "Fear",
        EffectKind::Warded => "Warded",
        EffectKind::Coated => "Coated",
    }
}

pub fn type_name(t: DamageType) -> &'static str {
    match t {
        DamageType::Physical => "physical",
        DamageType::Cold => "cold",
        DamageType::Heat => "heat",
        DamageType::Magical => "magical",
        DamageType::Poison => "poison",
    }
}

/// "Ayla ▸ Frost Shard ▸ Goblin Archer 1: 12.3 damage (HP 40 → 27.7)".
pub(super) fn hit_head(run: &Run, f: &HitFacts, target: u32) -> String {
    let by = f.dmg.why.by.map_or(String::new(), |id| format!("{} ▸ ", tag_of(run, id)));
    let target = tag_of(run, target);
    let lead = format!("{by}{} ▸ {target}", what(f.dmg.why.what));
    match f.outcome {
        HitOutcome::Dealt => format!("{lead}: {} damage (HP {} → {})", n1(f.dealt), n1(f.hp_before), n1(f.hp_after)),
        HitOutcome::Immune => format!("{lead}: no damage (immune)"),
        HitOutcome::Healed(h) => format!("{lead}: healed {} (resistance over 100 %)", n1(h)),
        HitOutcome::Shielded => format!("{lead}: no damage ({target} cannot be hurt now)"),
        HitOutcome::DebugNoLoss => format!("{lead}: {} damage (debug: no HP lost)", n1(f.taken)),
    }
}

/// The steps: base, multipliers, parts.
pub(super) fn hit_details(run: &Run, f: &HitFacts) -> Vec<String> {
    if f.outcome == HitOutcome::Shielded {
        return vec![];
    }
    let why = &f.dmg.why;
    let mut out = base_lines(f);
    for m in why.mults.iter().flatten() {
        out.push(match *m {
            Mult::Behind(x) => format!("from behind ×{x}"),
            Mult::Chain { jump, factor } => format!("Chain Spark jump {jump}: ×{factor:.2}"),
            Mult::Overkill { from } => format!("overkill: {} carried on from {}", n1(f.dmg.amount), tag_of(run, from)),
            Mult::Coat(s) => format!("Poison Coat +{} poison", pct(s)),
            Mult::Keystone(k, x) => format!("{} ×{x:.2}", crate::run::keystones::name(k)),
        });
    }
    out.extend(part_lines(f));
    out
}

fn base_lines(f: &HitFacts) -> Vec<String> {
    let why = &f.dmg.why;
    let Some(b) = why.base else {
        let carried = why.mults.iter().flatten().any(|m| matches!(m, Mult::Overkill { .. }));
        return vec![if carried { format!("carried on: {}", n1(f.dmg.amount)) } else { format!("base {}", n1(f.dmg.amount)) }];
    };
    let mut out = vec![];
    let mut v = b.given;
    match b.scale {
        Some(s) => {
            v = b.given * s.ratio;
            let a = s.attr.short();
            out.push(format!("base {} (given at {a} {}), your {a} {}: ×{:.2} → {}", n1(b.given), s.at, s.have, s.ratio, n1(v)));
        }
        None => out.push(format!("base {}", n1(b.given))),
    }
    if b.ability_mult != 1.0 {
        v *= b.ability_mult;
        let name = what(why.what);
        out.push(format!("{name} ×{:.2} → {}", b.ability_mult, n1(v)));
    }
    if b.mods_mult != 1.0 {
        v = (v * b.mods_mult).max(0.0);
        out.push(format!("items ×{:.2} → {}", b.mods_mult, n1(v)));
    }
    if b.keystone_mult != 1.0 {
        out.push(format!("keystones ×{:.2} → {}", b.keystone_mult, n1(b.amount())));
    }
    out
}

/// One line per type with a share: all that a viewer who cannot see the source gets.
pub(super) fn part_lines(f: &HitFacts) -> Vec<String> {
    let mut out = vec![];
    for t in DamageType::ALL {
        let share = f.dmg.split.share(t);
        if share > 0.0 {
            out.push(format!(
                "{} {}  {} × (1 − {} resist) = {}",
                type_name(t),
                pct(share),
                n1(f.dmg.amount * share),
                pct(f.res.get(t).max(MIN_RESISTANCE)),
                n1(f.parts[t as usize])
            ));
        }
    }
    out
}

/// The kinds in a bit set, named and joined.
fn kind_names(bits: u16) -> Vec<&'static str> {
    EffectKind::ALL.into_iter().filter(|k| bits & k.bit() != 0).map(effect_name).collect()
}

fn race_name(r: Race) -> &'static str {
    match r {
        Race::Human => "human",
        Race::Goblin => "goblin",
        Race::Orc => "orc",
        Race::Ogre => "ogre",
        Race::Mimic => "mimic",
        Race::Undead => "undead",
        Race::Demon => "demon",
        Race::Dragon => "dragon",
        Race::Elf => "elf",
        Race::MagicalBeast => "magical beast",
        Race::Object => "object",
    }
}

/// The race a creature's resistance to `kind` comes from, if it is its race's own value.
fn resisting_race(run: &Run, c: Creature, kind: EffectKind, r: f64) -> Option<Race> {
    let race = match c {
        Creature::Player(i) => *crate::defs::classes::races(run.players[i].class).first()?,
        Creature::Monster(i) => crate::defs::enemies::race(run.monsters[i].etype?),
    };
    (race_def(race).effect_res.get(kind) == r).then_some(race)
}

/// How an application ended, in a word: "applied", "refused", "cancelled Frozen".
fn verdict(f: &EffectFacts) -> String {
    match f.outcome {
        EffectOutcome::Added => "applied".to_string(),
        EffectOutcome::Refreshed => "refreshed".to_string(),
        EffectOutcome::Cancelled { removed } => format!("cancelled {}", kind_names(removed).join(", ")),
        EffectOutcome::StrongerOn(_) | EffectOutcome::SavedToZero | EffectOutcome::Resisted | EffectOutcome::TypeImmune(_) | EffectOutcome::InWater | EffectOutcome::NotThere => "refused".to_string(),
    }
}

/// " · Chilled" after a hit's headline, or " · Chilled refused".
pub(super) fn effect_suffix(f: &EffectFacts) -> String {
    let name = effect_name(f.kind);
    match f.outcome {
        EffectOutcome::Added | EffectOutcome::Refreshed => format!(" · {name}"),
        EffectOutcome::Cancelled { .. } | EffectOutcome::StrongerOn(_) | EffectOutcome::SavedToZero | EffectOutcome::Resisted | EffectOutcome::TypeImmune(_) | EffectOutcome::InWater | EffectOutcome::NotThere => {
            format!(" · {name} {}", verdict(f))
        }
    }
}

/// "Ayla ▸ War Cry ▸ Skeleton Warrior 1: Fear refused", or without a cause "Goblin Archer 1: Burning applied".
pub(super) fn effect_head(run: &Run, f: &EffectFacts, target: u32) -> String {
    let lead = match f.origin {
        Some((by, w)) => format!("{} ▸ {} ▸ {}", tag_of(run, by), what(w), tag_of(run, target)),
        None => tag_of(run, target),
    };
    format!("{lead}: {} {}", effect_name(f.kind), verdict(f))
}

/// The outcome line, then one line per weaker tier it replaced.
pub(super) fn effect_lines(run: &Run, f: &EffectFacts) -> Vec<String> {
    let e = effect_name(f.kind);
    let d = &f.duration;
    let mut out = vec![match f.outcome {
        EffectOutcome::NotThere => return vec![],
        EffectOutcome::Added => {
            let mut s = format!("{e}: applied, ");
            match d.save {
                Some((power, attr, save, after)) => s.push_str(&format!("{} s × (1 + (power {power} − {} {save}) / 20) = {} s", n1(d.base), attr.short(), n1(after))),
                None => s.push_str(&if d.resist.is_some_and(|(r, _)| r != 0.0) { format!("{} s", n1(d.base)) } else { format!("{} s", n1(d.secs)) }),
            }
            if let Some((r, _)) = d.resist.filter(|&(r, _)| r != 0.0) {
                s.push_str(&format!(" × (1 − {} resist) = {} s", pct(r), n1(d.secs)));
            }
            s
        }
        EffectOutcome::Refreshed => format!("{e}: refreshed to {} s", n1(f.left)),
        EffectOutcome::Cancelled { removed } => format!("{e}: cancelled {}", kind_names(removed).join(", ")),
        EffectOutcome::StrongerOn(k) => format!("{e}: refused ({} is on)", effect_name(k)),
        EffectOutcome::SavedToZero => match d.save {
            Some((power, attr, save, _)) => format!("{e}: refused (saved down to 0 s: power {power} − {} {save})", attr.short()),
            None => format!("{e}: refused (0 s)"),
        },
        EffectOutcome::Resisted => {
            let r = d.resist.map_or(1.0, |(r, _)| r);
            match resisting_race(run, f.target, f.kind, r) {
                Some(race) => format!("{e}: refused ({} resist {e} {})", race_name(race), pct(r)),
                None => format!("{e}: refused (resist {e} {})", pct(r)),
            }
        }
        EffectOutcome::TypeImmune(t) => format!("{e}: refused (immune to {})", type_name(t)),
        EffectOutcome::InWater => format!("{e}: refused (in water)"),
    }];
    out.extend(kind_names(f.replaced).into_iter().map(|w| format!("{e}: replaced {w}")));
    out
}

/// "Burning on Goblin Archer 1 ended (water)".
pub(super) fn ended_head(run: &Run, target: u32, kind: EffectKind, why: EndReason) -> String {
    let tail = match why {
        EndReason::RanOut => "",
        EndReason::Water => " (water)",
        EndReason::Purify => " (Purify)",
    };
    format!("{} on {} ended{tail}", effect_name(kind), tag_of(run, target))
}

/// "Ayla ▸ Holy Light ▸ Ayla's wolf: healed 8 (HP 12 → 20)", or without a source "Goblin Archer 1: healed 3 (HP 1 → 4)".
pub(super) fn heal_head(run: &Run, f: &HealFacts, target: u32, hp_after: f64) -> String {
    let lead = match f.by {
        Some((by, w)) => format!("{} ▸ {} ▸ {}", tag_of(run, by), what(w), tag_of(run, target)),
        None => tag_of(run, target),
    };
    format!("{lead}: healed {} (HP {} → {})", n1(f.healed), n1(f.hp_before), n1(hp_after))
}

/// "Goblin Archer 1 died (killed by Ayla)", "Goblin Archer 1 died (Burning; credited to Ayla)", "Ayla fell (killed by Orc Warrior 1)".
pub(super) fn death_head(run: &Run, f: &DeathFacts, target: u32) -> String {
    let (name, verb) = match f.target {
        Creature::Player(_) => (tag_of(run, target), "fell"),
        Creature::Monster(_) => (tag_of(run, target), "died"),
    };
    let cause = match (f.tick, f.by) {
        (Some(k), _) => {
            let credit = f.credit.and_then(|pi| run.players.get(pi)).map(|p| format!("; credited to {}", tag_of(run, p.id)));
            format!(" ({}{})", effect_name(k), credit.unwrap_or_default())
        }
        (None, Some(by)) => format!(" (killed by {})", tag_of(run, by)),
        (None, None) => String::new(),
    };
    format!("{name} {verb}{cause}")
}

/// What a viewer who cannot see the killer is told: "Ayla fell to something unseen".
pub(super) fn death_unseen_head(run: &Run, target: Creature, id: u32) -> String {
    match target {
        Creature::Player(_) => format!("{} fell to something unseen", tag_of(run, id)),
        Creature::Monster(_) => format!("{} died to something unseen", tag_of(run, id)),
    }
}

/// Why a monster was passed over, in words; `None` for the reasons the log does not tell.
pub(super) fn skip_reason(s: Skip) -> Option<&'static str> {
    match s {
        Skip::Ally => Some("an ally"),
        Skip::Dormant => Some("it is dormant"),
        Skip::Airborne => Some("it is flying"),
        Skip::NoLineOfSight => Some("no line of sight"),
        Skip::AlreadyHit => Some("already hit"),
        Skip::Dead | Skip::Hiding | Skip::OutOfReach | Skip::OutsideArc => None,
    }
}

/// "Frost Nova did not reach Goblin Archer 1: no line of sight", or "Chain Spark did not jump to …".
pub(super) fn skip_head(run: &Run, w: What, chain: bool, target: u32, reason: &str) -> String {
    if chain {
        format!("Chain Spark did not jump to {}: {reason}", tag_of(run, target))
    } else {
        format!("{} did not reach {}: {reason}", what(w), tag_of(run, target))
    }
}

/// "Chain Spark stopped: Goblin Archer 3 is out of reach (52 > 48)".
pub(super) fn chain_stop_head(run: &Run, target: u32, d: f64) -> String {
    format!("{} stopped: {} is out of reach ({} > {})", what(What::Ability(AbilityId::ChainSpark)), tag_of(run, target), n1(d), n1(abilities::CHAIN_REACH))
}

/// The two "Too close" lines of a ranged ability next to an enemy.
pub(super) fn too_close_head(run: &Run, hero: u32, ability: AbilityId, primary: bool, target: u32) -> String {
    let (hero, name, target) = (tag_of(run, hero), abilities::def(ability).name, tag_of(run, target));
    if primary {
        format!("{hero} ▸ {name}: {target} is in melee reach, strikes instead")
    } else {
        format!("{hero} ▸ {name}: blocked, {target} is in melee reach (Too close)")
    }
}
