//! A character's progression, stored as one JSONB document (`characters.progress`).
//! The document is schemaless in the database: adding a field here needs no SQL
//! migration, and a structural change bumps `CURRENT_VERSION` and adds a step to
//! `from_json`. Old rows are converted when they are read and written back on the
//! next save.
//!
//! Version 2 is the character sheet's source: the Attribute points bought in the shop,
//! the skill-tree nodes, the equipment, the inventory and the loadout. Version 1 had
//! flat stat upgrades; reading one refunds every bought level as XP, once.

use crate::defs::abilities::{self, AbilitySlot};
use crate::defs::attributes::{attr_price, Attr, Attributes};
use crate::defs::items::{self, check_equip, EquipError, EquipSlot, Equipment, ItemId};
use crate::defs::loadout::{Build, Loadout};
use crate::defs::trees::{self, NodeId};
use crate::protocol::{CharacterInfo, ClassId};
use crate::sheet::{attrs_with_items, attrs_without_items, profs};
use serde::Serialize;
use serde_json::{Map, Value};

pub const CURRENT_VERSION: u32 = 2;
/// A respec costs `RESPEC_BASE` coins plus one more per `RESPEC_PER` XP spent.
pub const RESPEC_BASE: u32 = 20;
pub const RESPEC_PER: u32 = 50;

/// The v1 price of the next level of a stat (kept only to refund old purchases).
fn v1_upgrade_cost(level: u32) -> u32 {
    100 + 75 * level
}

/// The v1 level cap.
const V1_MAX_LEVEL: u64 = 10;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Progress {
    /// Document format version (see `from_json`).
    pub version: u32,
    /// Bumped on every save, so a cached copy can tell which of two is newer.
    pub rev: u64,
    /// Unspent XP.
    pub xp: u32,
    /// All XP ever earned.
    pub total_xp: u32,
    /// Unspent coins.
    pub coins: u32,
    /// Attribute points bought in the shop.
    pub bought: Attributes,
    /// Owned skill-tree nodes: sorted, without the start node.
    pub nodes: Vec<NodeId>,
    /// XP spent on the shop and the tree since the last respec.
    pub xp_spent: u32,
    pub equipment: Equipment,
    pub inventory: Vec<ItemId>,
    pub loadout: Loadout,
}

/// One change to a character, as the server applies it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Change {
    BuyAttr(Attr),
    BuyNode(NodeId),
    Respec,
    Equip(EquipSlot, Option<ItemId>),
    SetLoadout(Loadout),
    GrantItem(ItemId),
}

fn equip_message(e: EquipError) -> &'static str {
    match e {
        EquipError::WrongSlot => "That item does not fit that slot.",
        EquipError::ClassNotListed => "Your class cannot use that item.",
        EquipError::NotProficient => "You are not trained in that item.",
        EquipError::Requirement(_) => "You do not meet that item's requirements.",
    }
}

/// A non-negative integer field: missing or null reads as 0, anything else must fit.
fn uint<T: TryFrom<u64>>(obj: &Map<String, Value>, key: &str) -> Option<T> {
    match obj.get(key) {
        None | Some(Value::Null) => T::try_from(0).ok(),
        Some(v) => v.as_u64().and_then(|n| T::try_from(n).ok()),
    }
}

/// The XP a v1 document's bought stat levels cost: each stat's level counts when it is an
/// integer, capped at the old maximum; anything else counts as nothing.
fn v1_refund(value: &Value) -> u32 {
    let Some(upgrades) = value.get("upgrades").and_then(Value::as_object) else { return 0 };
    ["damage", "attack_speed", "move_speed", "life", "armor"]
        .iter()
        .filter_map(|k| upgrades.get(*k).and_then(Value::as_u64))
        .map(|level| (0..level.min(V1_MAX_LEVEL) as u32).map(v1_upgrade_cost).sum::<u32>())
        .fold(0, u32::saturating_add)
}

/// The elements of a stored list that name a known value; the others are dropped (logged).
fn read_ids<T: serde::de::DeserializeOwned>(value: Option<&Value>, what: &str) -> Vec<T> {
    let Some(value) = value else { return Vec::new() };
    let Some(list) = value.as_array() else {
        if !value.is_null() {
            tracing::warn!("progress: {what} is not a list; dropped");
        }
        return Vec::new();
    };
    list.iter()
        .filter_map(|v| match serde_json::from_value::<T>(v.clone()) {
            Ok(t) => Some(t),
            Err(_) => {
                tracing::warn!("progress: unknown {what} id {v} dropped");
                None
            }
        })
        .collect()
}

/// The stored equipment: unknown items are dropped one by one; an unreadable shape falls
/// back to the class starters.
fn read_equipment(value: Option<&Value>, class: ClassId) -> Equipment {
    let starter = || Equipment::starter(class);
    let Some(slots) = value.and_then(|v| v.get("slots")).and_then(Value::as_array).filter(|s| s.len() == EquipSlot::COUNT) else {
        tracing::warn!("progress: unreadable equipment; using the class starters");
        return starter();
    };
    let mut e = Equipment::default();
    for (slot, v) in EquipSlot::ALL.iter().zip(slots) {
        if v.is_null() {
            continue;
        }
        match serde_json::from_value::<ItemId>(v.clone()) {
            Ok(item) => e.set(*slot, Some(item)),
            Err(_) => tracing::warn!("progress: unknown item id {v} in the equipment dropped"),
        }
    }
    e
}

impl Progress {
    /// A fresh character: starter weapons, the start loadout, nothing bought.
    pub fn new(class: ClassId) -> Progress {
        Progress {
            version: CURRENT_VERSION,
            rev: 0,
            xp: 0,
            total_xp: 0,
            coins: 0,
            bought: Attributes::default(),
            nodes: Vec::new(),
            xp_spent: 0,
            equipment: Equipment::starter(class),
            inventory: Vec::new(),
            loadout: Loadout::start(class),
        }
    }

    /// Reads a stored document. A version-1 document is converted (its bought levels are
    /// refunded as XP, once: the result is version 2). Unknown node/item ids are dropped
    /// (logged) while the rest stays; a document that is not readable at all starts fresh
    /// rather than locking the character out.
    pub fn from_json(value: Value, class: ClassId) -> Progress {
        let Some(obj) = value.as_object() else {
            tracing::error!("unreadable progress document: not an object");
            return Progress::new(class);
        };
        let (Some(version), Some(rev), Some(xp), Some(total_xp), Some(coins), Some(xp_spent)) =
            (uint::<u32>(obj, "version"), uint::<u64>(obj, "rev"), uint::<u32>(obj, "xp"), uint::<u32>(obj, "total_xp"), uint::<u32>(obj, "coins"), uint::<u32>(obj, "xp_spent"))
        else {
            tracing::error!("unreadable progress document: a number field is not a number");
            return Progress::new(class);
        };
        let mut p = Progress { rev, xp, total_xp, coins, ..Progress::new(class) };
        if version < 2 {
            p.xp = p.xp.saturating_add(v1_refund(&value));
            return p;
        }
        p.version = version;
        p.xp_spent = xp_spent;
        p.bought = match obj.get("bought") {
            None | Some(Value::Null) => Attributes::default(),
            Some(v) => serde_json::from_value(v.clone()).unwrap_or_else(|e| {
                tracing::warn!("progress: unreadable bought Attributes ({e}); dropped");
                Attributes::default()
            }),
        };
        let start = trees::start(class);
        let mut nodes: Vec<NodeId> = read_ids(obj.get("nodes"), "node");
        nodes.retain(|&n| {
            let ok = n != start && trees::def(n).class == class;
            if !ok {
                tracing::warn!("progress: node {n:?} is not part of this class's tree; dropped");
            }
            ok
        });
        nodes.sort();
        nodes.dedup();
        p.nodes = nodes;
        p.equipment = read_equipment(obj.get("equipment"), class);
        p.inventory = read_ids(obj.get("inventory"), "item");
        p.loadout = match obj.get("loadout") {
            Some(v) => serde_json::from_value(v.clone()).unwrap_or_else(|e| {
                tracing::warn!("progress: unreadable loadout ({e}); using the class start");
                Loadout::start(class)
            }),
            None => Loadout::start(class),
        };
        p
    }

    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).expect("progress to json")
    }

    /// Banks what a run earned.
    pub fn bank(&mut self, xp: u32, coins: u32) {
        self.xp = self.xp.saturating_add(xp);
        self.total_xp = self.total_xp.saturating_add(xp);
        self.coins = self.coins.saturating_add(coins);
    }

    /// What the sheet is built from.
    pub fn build(&self, _class: ClassId) -> Build {
        Build { extra: self.bought, nodes: self.nodes.clone(), equipment: self.equipment, loadout: self.loadout, own: Vec::new() }
    }

    /// The XP price of the next point of each Attribute (items do not count).
    pub fn attr_prices(&self, class: ClassId) -> [u32; 6] {
        let attrs = attrs_without_items(class, &self.build(class));
        Attr::ALL.map(|a| attr_price(a, attrs.get(a)))
    }

    /// The coins a respec costs now.
    pub fn respec_price(&self) -> u32 {
        RESPEC_BASE + self.xp_spent / RESPEC_PER
    }

    fn spend(&mut self, cost: u32) -> Result<(), &'static str> {
        if self.xp < cost {
            return Err("Not enough XP.");
        }
        self.xp -= cost;
        self.xp_spent = self.xp_spent.saturating_add(cost);
        Ok(())
    }

    pub fn buy_attr(&mut self, class: ClassId, a: Attr) -> Result<(), &'static str> {
        let price = self.attr_prices(class)[a as usize];
        self.spend(price)?;
        self.bought.add(a, 1);
        Ok(())
    }

    pub fn buy_node(&mut self, class: ClassId, n: NodeId) -> Result<(), &'static str> {
        trees::check_buy(class, &self.nodes, n, &attrs_with_items(class, &self.build(class)))?;
        self.spend(trees::def(n).cost)?;
        self.nodes.push(n);
        self.nodes.sort();
        Ok(())
    }

    /// Refunds all XP spent on the shop and the tree for coins, and resets both and the
    /// loadout. Items stay, except those the build can no longer wear (they go to the
    /// inventory).
    pub fn respec(&mut self, class: ClassId) -> Result<(), &'static str> {
        let price = self.respec_price();
        if self.coins < price {
            return Err("Not enough coins.");
        }
        self.coins -= price;
        self.xp = self.xp.saturating_add(self.xp_spent);
        self.xp_spent = 0;
        self.bought = Attributes::default();
        self.nodes.clear();
        self.loadout = Loadout::start(class);
        let attrs = attrs_without_items(class, &self.build(class));
        let profs = profs(class, &self.nodes);
        for slot in EquipSlot::ALL {
            if let Some(item) = self.equipment.get(slot) {
                if check_equip(class, &profs, slot, item, &attrs).is_err() {
                    self.equipment.set(slot, None);
                    self.inventory.push(item);
                }
            }
        }
        Ok(())
    }

    /// Moves an item from the inventory into `slot` (the slot's old item goes back), or,
    /// with `None`, the slot's item into the inventory.
    pub fn equip(&mut self, class: ClassId, slot: EquipSlot, item: Option<ItemId>) -> Result<(), &'static str> {
        if let Some(item) = item {
            let Some(at) = self.inventory.iter().position(|&i| i == item) else {
                return Err("That item is not in your inventory.");
            };
            let attrs = attrs_without_items(class, &self.build(class));
            check_equip(class, &profs(class, &self.nodes), slot, item, &attrs).map_err(equip_message)?;
            self.inventory.remove(at);
        }
        if let Some(old) = self.equipment.get(slot) {
            self.inventory.push(old);
        }
        self.equipment.set(slot, item);
        Ok(())
    }

    /// Stores any pick whose ability fits its slot; the rest is checked by the sheet.
    pub fn set_loadout(&mut self, l: Loadout) -> Result<(), &'static str> {
        if abilities::def(l.primary.ability).slot != AbilitySlot::Primary || abilities::def(l.secondary.ability).slot != AbilitySlot::Secondary {
            return Err("That ability does not fit that slot.");
        }
        self.loadout = l;
        Ok(())
    }

    /// Adds an item to the inventory (loot, the shop, debug).
    pub fn grant_item(&mut self, class: ClassId, item: ItemId) -> Result<(), &'static str> {
        let d = items::def(item);
        if !items::hero_can_hold(&d) || !d.classes.contains(&class) {
            return Err("Your class cannot use that item.");
        }
        self.inventory.push(item);
        Ok(())
    }

    pub fn apply(&mut self, class: ClassId, c: Change) -> Result<(), &'static str> {
        match c {
            Change::BuyAttr(a) => self.buy_attr(class, a),
            Change::BuyNode(n) => self.buy_node(class, n),
            Change::Respec => self.respec(class),
            Change::Equip(slot, item) => self.equip(class, slot, item),
            Change::SetLoadout(l) => self.set_loadout(l),
            Change::GrantItem(item) => self.grant_item(class, item),
        }
    }

    pub fn info(&self, id: i32, name: &str, class: ClassId) -> CharacterInfo {
        CharacterInfo {
            id,
            name: name.to_string(),
            class,
            xp: self.xp,
            total_xp: self.total_xp,
            coins: self.coins,
            bought: self.bought,
            nodes: self.nodes.clone(),
            equipment: self.equipment,
            inventory: self.inventory.clone(),
            loadout: self.loadout,
            xp_spent: self.xp_spent,
            respec_price: self.respec_price(),
            prices: self.attr_prices(class),
            sheet: crate::sheet::summary(class, &self.build(class)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities::AbilityId;
    use crate::defs::loadout::{Pick, Source};
    use crate::sheet::hero_sheet;
    use serde_json::json;

    const W: ClassId = ClassId::Wizard;

    #[test]
    fn v1_refund_is_exact_and_happens_once() {
        let v1 = json!({ "version": 1, "xp": 40, "total_xp": 2000, "coins": 7, "upgrades": { "damage": 2, "life": 1 } });
        let p = Progress::from_json(v1, ClassId::Paladin);
        assert_eq!(p.xp, 40 + (100 + 175) + 100);
        assert_eq!((p.version, p.xp_spent, p.coins, p.total_xp), (2, 0, 7, 2000));
        assert_eq!(p.equipment, Equipment::starter(ClassId::Paladin));
        assert_eq!(p.loadout, Loadout::start(ClassId::Paladin));
        assert_eq!(Progress::from_json(p.to_json(), ClassId::Paladin), p, "no second refund");
    }

    #[test]
    fn odd_v1_documents_refund_what_they_can() {
        let p = Progress::from_json(json!({ "upgrades": { "armor": 50, "damage": "lots", "speed": 3, "life": -2, "move_speed": 1.5 } }), W);
        assert_eq!(p.xp, (0..10).map(|l| 100 + 75 * l).sum::<u32>(), "armor capped at 10; the rest ignored");
        assert_eq!(Progress::from_json(json!({}), W), Progress::new(W));
        assert_eq!(Progress::from_json(json!("a string"), W), Progress::new(W));
        assert_eq!(Progress::from_json(json!({ "upgrades": "many" }), W), Progress::new(W));
        assert_eq!(Progress::from_json(json!({ "xp": "lots" }), W), Progress::new(W));
        let future = Progress::from_json(json!({ "xp": 40, "talents": [1, 2], "upgrades": { "life": 2 } }), W);
        assert_eq!(future.xp, 40 + 100 + 175, "a pre-versioning document with an unknown field");
    }

    #[test]
    fn stale_ids_are_dropped_not_the_document() {
        let mut p = Progress::new(W);
        p.bank(5000, 30);
        p.buy_node(W, NodeId::WA2).unwrap();
        let mut v = p.to_json();
        v["nodes"].as_array_mut().unwrap().push(json!("NoSuchNode"));
        v["inventory"] = json!(["NoSuchItem", "Knife"]);
        v["equipment"]["slots"][4] = json!("NoSuchRing");
        let q = Progress::from_json(v, W);
        assert_eq!((q.xp, q.coins, q.nodes.clone(), q.inventory.clone()), (p.xp, 30, vec![NodeId::WA2], vec![ItemId::Knife]));
        assert_eq!(q.equipment, p.equipment);
        assert_eq!(q.xp_spent, p.xp_spent);
    }

    #[test]
    fn unreadable_equipment_and_loadout_fall_back_to_the_start() {
        let mut p = Progress::new(W);
        p.bank(100, 1);
        let mut v = p.to_json();
        v["equipment"] = json!("broken");
        v["loadout"] = json!({ "primary": "Nope" });
        let q = Progress::from_json(v, W);
        assert_eq!(q.equipment, Equipment::starter(W));
        assert_eq!(q.loadout, Loadout::start(W));
        assert_eq!((q.xp, q.coins), (100, 1));
    }

    #[test]
    fn nodes_of_another_class_or_the_start_are_dropped() {
        let mut v = Progress::new(W).to_json();
        v["nodes"] = json!(["WA3", "B0", "W0", "BU2", "WA2", "WA2", "WA1"]);
        assert_eq!(Progress::from_json(v, W).nodes, vec![NodeId::WA2, NodeId::WA3]);
    }

    #[test]
    fn a_removed_node_is_dropped_and_its_xp_stays_spent() {
        let mut v = Progress::new(W).to_json();
        v["nodes"] = json!(["WA1", "WA2"]);
        v["xp_spent"] = json!(500);
        v["xp"] = json!(0);
        let mut q = Progress::from_json(v, W);
        assert_eq!(q.nodes, vec![NodeId::WA2]);
        assert_eq!(q.xp_spent, 500);
        q.bank(0, 100);
        q.respec(W).unwrap();
        assert_eq!(q.xp, 500);

        let mut v = Progress::new(W).to_json();
        v["nodes"] = json!(["WA4", "WA5"]);
        let q = Progress::from_json(v, W);
        assert_eq!(q.nodes, vec![NodeId::WA5]);
        assert!(hero_sheet(W, &q.build(W)).is_ok());
    }

    #[test]
    fn the_shop_charges_by_the_formula_and_ignores_items() {
        let mut p = Progress::new(W);
        p.bank(1000, 0);
        assert_eq!(p.attr_prices(W)[Attr::Int as usize], 225);
        p.buy_attr(W, Attr::Int).unwrap();
        assert_eq!((p.xp, p.xp_spent, p.bought.get(Attr::Int)), (775, 225, 1));
        assert_eq!(p.attr_prices(W)[Attr::Int as usize], 250);
        // A ring adding INT does not change the next price.
        p.grant_item(W, ItemId::RingOfInsight).unwrap();
        p.equip(W, EquipSlot::Ring1, Some(ItemId::RingOfInsight)).unwrap();
        assert_eq!(p.attr_prices(W)[Attr::Int as usize], 250);
        p.buy_attr(W, Attr::Int).unwrap();
        assert_eq!((p.xp, p.xp_spent), (525, 475));
        // Not enough XP: nothing changes.
        let before = p.clone();
        p.xp = 10;
        let mut poor = p.clone();
        assert_eq!(poor.buy_attr(W, Attr::Int), Err("Not enough XP."));
        assert_eq!(poor, p);
        assert_eq!(before.bought.get(Attr::Int), 2);
    }

    #[test]
    fn buying_nodes() {
        let mut p = Progress::new(W);
        p.bank(3000, 0);
        assert_eq!(p.buy_node(W, NodeId::WA3), Err("Buy a neighbouring node first."));
        assert_eq!(p.buy_node(W, NodeId::B0), Err("That node is not in your tree."));
        p.buy_node(W, NodeId::WA2).unwrap();
        assert_eq!((p.xp, p.xp_spent), (2700, 300));
        assert_eq!(p.buy_node(W, NodeId::WA2), Err("You already have that node."));
        p.buy_node(W, NodeId::WB3).unwrap();
        assert_eq!(p.nodes, vec![NodeId::WA2, NodeId::WB3]);
        p.buy_attr(W, Attr::Int).unwrap();
        p.buy_attr(W, Attr::Int).unwrap();
        assert_eq!(p.xp_spent, 300 + 300 + 475);
        // WA3 needs INT 18: class 15 + two shop points = 17; a ring of insight makes it 18.
        let before = p.clone();
        assert_eq!(p.buy_node(W, NodeId::WA3), Err("A requirement of that node is not met."));
        assert_eq!(p, before);
        p.grant_item(W, ItemId::RingOfInsight).unwrap();
        p.equip(W, EquipSlot::Ring1, Some(ItemId::RingOfInsight)).unwrap();
        p.buy_node(W, NodeId::WA3).unwrap();
        assert!(p.nodes.contains(&NodeId::WA3));
        assert_eq!(p.nodes, { let mut s = p.nodes.clone(); s.sort(); s });
        // Not enough XP.
        p.xp = 0;
        let before = p.clone();
        assert_eq!(p.buy_node(W, NodeId::WA5), Err("Not enough XP."));
        assert_eq!(p, before);
    }

    #[test]
    fn respec_refunds_resets_and_charges() {
        let mut p = Progress::new(W);
        p.bank(5000, 100);
        p.buy_attr(W, Attr::Int).unwrap();
        p.buy_attr(W, Attr::Int).unwrap();
        for n in [NodeId::WA2, NodeId::WB3] {
            p.buy_node(W, n).unwrap();
        }
        p.set_loadout(Loadout { primary: Pick { ability: AbilityId::MagicMissile, source: Source::Own }, secondary: Pick { ability: AbilityId::Haste, source: Source::Own } }).unwrap();
        assert_eq!(p.xp_spent, 475 + 600);
        let price = p.respec_price();
        assert_eq!(price, 20 + 1075 / 50);
        p.respec(W).unwrap();
        assert_eq!((p.xp, p.xp_spent, p.coins), (5000, 0, 100 - price));
        assert_eq!((p.bought, p.nodes.clone(), p.loadout), (Attributes::default(), vec![], Loadout::start(W)));
        assert_eq!(p.respec_price(), 20);

        // Too few coins: nothing changes.
        p.buy_node(W, NodeId::WA2).unwrap();
        p.coins = 19;
        let before = p.clone();
        assert_eq!(p.respec(W), Err("Not enough coins."));
        assert_eq!(p, before);
    }

    #[test]
    fn respec_unequips_what_no_longer_fits() {
        let c = ClassId::Barbarian;
        let mut p = Progress::new(c);
        p.bank(1000, 50);
        p.buy_node(c, NodeId::BR1).unwrap();
        p.grant_item(c, ItemId::PlateArmor).unwrap();
        p.equip(c, EquipSlot::Armor, Some(ItemId::PlateArmor)).unwrap();
        assert!(hero_sheet(c, &p.build(c)).is_ok());
        p.respec(c).unwrap();
        assert_eq!((p.equipment.get(EquipSlot::Armor), p.inventory.clone()), (None, vec![ItemId::PlateArmor]));
        assert_eq!(p.equipment.get(EquipSlot::Melee), Some(ItemId::GreatAxe), "the proper weapon stays");
        assert!(hero_sheet(c, &p.build(c)).is_ok());
    }

    #[test]
    fn equip_moves_items_between_inventory_and_slots() {
        let mut p = Progress::new(W);
        p.grant_item(W, ItemId::Knife).unwrap();
        assert_eq!(p.inventory, vec![ItemId::Knife]);
        p.equip(W, EquipSlot::Melee, Some(ItemId::Knife)).unwrap();
        assert_eq!((p.equipment.get(EquipSlot::Melee), p.inventory.clone()), (Some(ItemId::Knife), vec![ItemId::RedStaff]));
        p.equip(W, EquipSlot::Melee, None).unwrap();
        assert_eq!((p.equipment.get(EquipSlot::Melee), p.inventory.clone()), (None, vec![ItemId::RedStaff, ItemId::Knife]));
        assert_eq!(p.equip(W, EquipSlot::Ring1, Some(ItemId::BandOfVigor)), Err("That item is not in your inventory."));
        p.grant_item(W, ItemId::LeatherArmor).unwrap();
        let before = p.clone();
        assert_eq!(p.equip(W, EquipSlot::Armor, Some(ItemId::LeatherArmor)), Err("You are not trained in that item."));
        assert_eq!(p.equip(W, EquipSlot::Ring1, Some(ItemId::LeatherArmor)), Err("That item does not fit that slot."));
        assert_eq!(p, before);
        // An empty slot, emptied again: nothing happens.
        p.equip(W, EquipSlot::Ring2, None).unwrap();
        assert_eq!(p, before);
    }

    #[test]
    fn grant_item_refuses_what_the_class_cannot_use() {
        let mut p = Progress::new(ClassId::Paladin);
        assert_eq!(p.grant_item(ClassId::Paladin, ItemId::RedStaff), Err("Your class cannot use that item."));
        assert_eq!(p.grant_item(ClassId::Paladin, ItemId::Bite), Err("Your class cannot use that item."), "natural weapon");
        assert!(p.inventory.is_empty());
    }

    #[test]
    fn set_loadout_refuses_only_the_wrong_slot() {
        let mut p = Progress::new(W);
        let pick = |ability| Pick { ability, source: Source::Own };
        let start = Loadout::start(W);
        assert_eq!(p.set_loadout(Loadout { primary: pick(AbilityId::Fireball), ..start }), Err("That ability does not fit that slot."));
        assert_eq!(p.loadout, start);
        let locked = Loadout { primary: pick(AbilityId::FrostShard), ..start };
        assert_eq!(p.set_loadout(locked), Ok(()));
        assert_eq!(p.loadout, locked);
    }

    #[test]
    fn apply_dispatches() {
        let mut p = Progress::new(W);
        p.bank(500, 0);
        p.apply(W, Change::BuyAttr(Attr::Wil)).unwrap();
        p.apply(W, Change::BuyNode(NodeId::WA2)).unwrap();
        p.apply(W, Change::GrantItem(ItemId::Knife)).unwrap();
        p.apply(W, Change::Equip(EquipSlot::Melee, Some(ItemId::Knife))).unwrap();
        p.apply(W, Change::SetLoadout(Loadout::start(W))).unwrap();
        assert_eq!(p.apply(W, Change::Respec), Err("Not enough coins."));
    }

    #[test]
    fn banking_saturates() {
        let mut p = Progress::new(W);
        p.bank(u32::MAX, u32::MAX);
        p.bank(5, 5);
        assert_eq!((p.xp, p.total_xp, p.coins), (u32::MAX, u32::MAX, u32::MAX));
    }

    #[test]
    fn json_roundtrip() {
        let mut p = Progress::new(ClassId::Barbarian);
        p.bank(900, 20);
        p.buy_attr(ClassId::Barbarian, Attr::Str).unwrap();
        p.buy_node(ClassId::Barbarian, NodeId::BR1).unwrap();
        p.grant_item(ClassId::Barbarian, ItemId::Knife).unwrap();
        p.rev = 7;
        assert_eq!(Progress::from_json(p.to_json(), ClassId::Barbarian), p);
    }
}
