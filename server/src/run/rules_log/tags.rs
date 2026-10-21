//! Server-assigned creature tags: "Goblin Archer 2". A plain counter per name, no RNG, and
//! nothing the simulation reads.

use crate::defs::kinds::EntityKind;
use crate::protocol::EntSnap;
use crate::run::Run;
use std::collections::HashMap;

#[derive(Default)]
pub struct Tags {
    /// Per name (the `EntityKind` it is counted under): how many were handed out.
    next: HashMap<EntityKind, u16>,
    /// Per entity id: the kind its name comes from and its number.
    of: HashMap<u32, (EntityKind, u16)>,
}

impl Tags {
    fn take(&mut self, kind: EntityKind) -> u16 {
        let n = self.next.entry(kind).or_insert(0);
        *n += 1;
        *n
    }

    pub(super) fn spawned(&mut self, id: u32, kind: EntityKind) {
        if tag_name(kind).is_none() {
            return;
        }
        // Mimics are only ever spawned hiding (the level's chest loop in `Run::new`): a chest.
        let named = if kind == EntityKind::Mimic { EntityKind::Chest } else { kind };
        let n = self.take(named);
        self.of.insert(id, (named, n));
    }

    pub(super) fn revealed(&mut self, id: u32) {
        match self.of.get(&id) {
            Some(&(EntityKind::Chest, _)) => {}
            _ => return,
        }
        let n = self.take(EntityKind::Mimic);
        self.of.insert(id, (EntityKind::Mimic, n));
    }
}

/// The name a creature or object goes by in the log; `None` for what takes no part.
pub fn tag_name(kind: EntityKind) -> Option<&'static str> {
    use EntityKind::*;
    match kind {
        GoblinArcher => Some("Goblin Archer"),
        SkeletonWarrior => Some("Skeleton Warrior"),
        SkeletonArcher => Some("Skeleton Archer"),
        OrcWarrior => Some("Orc Warrior"),
        OrcArcher => Some("Orc Archer"),
        Necromancer => Some("Necromancer"),
        RaisedSkeleton => Some("Raised Skeleton"),
        Disciple => Some("Disciple"),
        Mimic => Some("Mimic"),
        Imp => Some("Imp"),
        Chort => Some("Chort"),
        Summoner => Some("Summoner"),
        DireWolf => Some("Dire Wolf"),
        Ogre => Some("Ogre"),
        Demon => Some("Demon"),
        Lich => Some("Lich"),
        Dragon => Some("Dragon"),
        Chest => Some("Chest"),
        Barrel => Some("Barrel"),
        Wizard | Paladin | Barbarian | ElvenRanger | Missile | Fireball | Bolt | Arrow | ShadowBolt | FrostBolt | FireBreath | FireOrb
        | DragonFireball | FireBolt | GloomBolt | BlindOrb | SleepOrb | ChainSpark | Judgement | ThrownAxe | FirePatch | HolyGround
        | Roots | Torch => None,
    }
}

pub(crate) fn tag_of(run: &Run, id: u32) -> String {
    if let Some(p) = run.players.iter().find(|p| p.id == id) {
        return p.name.clone();
    }
    if let Some(a) = run.monsters.iter().find(|m| m.id == id).and_then(|m| m.ally.as_ref()) {
        if let Some(owner) = run.players.iter().find(|p| p.id == a.owner) {
            return format!("{}'s wolf", owner.name);
        }
    }
    match run.log.tags.of.get(&id) {
        Some(&(kind, n)) => format!("{} {n}", tag_name(kind).unwrap_or("something")),
        None => "something".to_string(),
    }
}

pub(crate) fn snapshot_tags(run: &Run, ents: &[EntSnap]) -> Vec<(u32, u8, u16)> {
    ents.iter().filter_map(|e| run.log.tags.of.get(&e.0).map(|&(kind, n)| (e.0, kind as u8, n))).collect()
}

/// The `TAG_NAME` block for `defs.ts`: one entry per `EntityKind` that has a name.
pub fn export_tag_names() -> String {
    let rows: Vec<String> =
        EntityKind::ALL.iter().filter_map(|&k| tag_name(k).map(|n| format!("  {}: {:?},\n", k as u8, n))).collect();
    format!("export const TAG_NAME: Record<number, string> = {{\n{}}};\n", rows.concat())
}
