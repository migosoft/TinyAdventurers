//! The text of the log's lines: number formatting and what each fact is called.

use super::{tag_of, HitFacts, HitOutcome};
use crate::defs::abilities;
use crate::defs::damage::{DamageType, Mult, What, MIN_RESISTANCE};
use crate::defs::effects::EffectKind;
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

/// The steps: base, multipliers, parts, armor.
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
        let name = match why.what {
            What::Ability(id) => abilities::def(id).name.to_string(),
            w => what(w),
        };
        out.push(format!("{name} ×{:.2} → {}", b.ability_mult, n1(v)));
    }
    if b.mods_mult != 1.0 {
        v = (v * b.mods_mult).max(0.0);
        out.push(format!("items ×{:.2} → {}", b.mods_mult, n1(v)));
    }
    if b.upgrade_mult != 1.0 {
        out.push(format!("upgrades ×{:.2} → {}", b.upgrade_mult, n1(b.amount())));
    }
    out
}

/// One line per type with a share, and a hero's armor: all that a viewer who cannot see the source gets.
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
    if f.armor > 0.0 && matches!(f.target, Creature::Player(_)) {
        let raw: f64 = f.parts.iter().sum();
        out.push(format!("armor {}: {} × (1 − {}) = {}", pct(f.armor), n1(raw), pct(f.armor), n1(f.taken)));
    }
    out
}
