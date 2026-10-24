//! PostgreSQL access. Every query of the game lives here, so the storage
//! can change (or gain a cache) without touching the lobby or the API. The
//! read-only statistics queries of the admin area are in `stats.rs`.
//! Queries are checked at runtime (`sqlx::query`), so building needs no database.

use crate::progress::{Change, Progress, CURRENT_VERSION};
use crate::protocol::{CharacterInfo, ClassId};
use crate::run::{Award, RunRecord};
use sqlx::postgres::{PgConnection, PgPoolOptions};
use sqlx::{PgPool, Row};
use std::time::Duration;

pub type Db = PgPool;

pub const MAX_CHARACTERS: i64 = 8;

#[derive(Debug)]
pub enum DbError {
    /// A unique name (account or character) is already used.
    NameTaken,
    TooManyCharacters,
    Sql(#[allow(dead_code)] sqlx::Error), // read through Debug when logged
}

impl From<sqlx::Error> for DbError {
    fn from(e: sqlx::Error) -> Self {
        match &e {
            sqlx::Error::Database(d) if d.code().as_deref() == Some("23505") => DbError::NameTaken,
            _ => DbError::Sql(e),
        }
    }
}

pub struct Account {
    pub id: i32,
    pub name: String,
    pub password_hash: String,
    pub debug: bool,
}

#[derive(Debug, Clone)]
pub struct Character {
    pub id: i32,
    pub account_id: i32,
    pub name: String,
    pub class: ClassId,
    pub progress: Progress,
    /// The account's debug flag at load time.
    pub debug: bool,
}

impl Character {
    pub fn info(&self) -> CharacterInfo {
        self.progress.info(self.id, &self.name, self.class)
    }
}

fn class_name(c: ClassId) -> String {
    format!("{c:?}")
}

pub(crate) fn class_from(s: &str) -> ClassId {
    ClassId::ALL.into_iter().find(|c| class_name(*c) == s).unwrap_or(ClassId::Wizard)
}

/// Connects (retrying while the database starts up) and applies migrations.
#[tracing::instrument(skip_all)]
pub async fn connect(url: &str) -> Db {
    let mut tries = 0;
    let db = loop {
        match PgPoolOptions::new().max_connections(16).acquire_timeout(Duration::from_secs(5)).connect(url).await {
            Ok(db) => break db,
            Err(e) if tries < 30 => {
                tries += 1;
                tracing::warn!("database not reachable yet ({e}), retrying");
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            Err(e) => panic!("cannot connect to the database: {e}"),
        }
    };
    sqlx::migrate!("./migrations").run(&db).await.expect("database migrations");
    tracing::info!("database ready");
    db
}

// ------------------------------------------------------------------ accounts

#[tracing::instrument(skip_all)]
pub async fn create_account(db: &Db, name: &str, password_hash: &str) -> Result<i32, DbError> {
    let row = sqlx::query("INSERT INTO accounts (name, password_hash) VALUES ($1, $2) RETURNING id").bind(name).bind(password_hash).fetch_one(db).await?;
    Ok(row.get(0))
}

#[tracing::instrument(skip_all)]
pub async fn find_account(db: &Db, name: &str) -> Result<Option<Account>, sqlx::Error> {
    let row = sqlx::query("SELECT id, name, password_hash, debug FROM accounts WHERE lower(name) = lower($1)").bind(name).fetch_optional(db).await?;
    Ok(row.map(|r| Account { id: r.get(0), name: r.get(1), password_hash: r.get(2), debug: r.get(3) }))
}

#[tracing::instrument(skip_all)]
pub async fn account(db: &Db, id: i32) -> Result<Option<Account>, sqlx::Error> {
    let row = sqlx::query("SELECT id, name, password_hash, debug FROM accounts WHERE id = $1").bind(id).fetch_optional(db).await?;
    Ok(row.map(|r| Account { id: r.get(0), name: r.get(1), password_hash: r.get(2), debug: r.get(3) }))
}

/// Deletes the account with its sessions and characters (ON DELETE CASCADE).
#[tracing::instrument(skip_all)]
pub async fn delete_account(db: &Db, id: i32) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM accounts WHERE id = $1").bind(id).execute(db).await?;
    Ok(())
}

/// Sets a new password hash and ends all sessions of the account, in one
/// transaction. False if the account does not exist.
#[tracing::instrument(skip_all)]
pub async fn set_password(db: &Db, id: i32, password_hash: &str) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let r = sqlx::query("UPDATE accounts SET password_hash = $2 WHERE id = $1").bind(id).bind(password_hash).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM sessions WHERE account_id = $1").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(r.rows_affected() > 0)
}

/// Notes that the account was active today (UTC), for the statistics.
#[tracing::instrument(skip_all)]
pub async fn touch_activity(db: &Db, account_id: i32) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO activity_days (account_id, day) VALUES ($1, (now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING").bind(account_id).execute(db).await?;
    Ok(())
}

// ------------------------------------------------------------------ sessions

/// A session lives until `idle` passes without activity (`expires_at`).
#[tracing::instrument(skip_all)]
pub async fn create_session(db: &Db, account_id: i32, id_hash: &[u8], idle: Duration) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM sessions WHERE account_id = $1 AND expires_at < now()").bind(account_id).execute(db).await?;
    sqlx::query("INSERT INTO sessions (id_hash, account_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))")
        .bind(id_hash)
        .bind(account_id)
        .bind(idle.as_secs_f64())
        .execute(db)
        .await?;
    Ok(())
}

/// The account of a live session, whose idle clock restarts with this check.
#[tracing::instrument(skip_all)]
pub async fn touch_session(db: &Db, id_hash: &[u8], idle: Duration) -> Result<Option<i32>, sqlx::Error> {
    let row = sqlx::query("UPDATE sessions SET expires_at = now() + make_interval(secs => $2) WHERE id_hash = $1 AND expires_at > now() RETURNING account_id")
        .bind(id_hash)
        .bind(idle.as_secs_f64())
        .fetch_optional(db)
        .await?;
    Ok(row.map(|r| r.get(0)))
}

/// Restarts the idle clock when a game connection ends: the player was active
/// all along, even if the connection outlasted the idle time. A session that
/// was deleted meanwhile (logout, new password) stays deleted.
#[tracing::instrument(skip_all)]
pub async fn extend_session(db: &Db, id_hash: &[u8], idle: Duration) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE sessions SET expires_at = now() + make_interval(secs => $2) WHERE id_hash = $1").bind(id_hash).bind(idle.as_secs_f64()).execute(db).await?;
    Ok(())
}

#[tracing::instrument(skip_all)]
pub async fn delete_session(db: &Db, id_hash: &[u8]) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM sessions WHERE id_hash = $1").bind(id_hash).execute(db).await?;
    Ok(())
}

// ---------------------------------------------------------------- characters

fn character_from(r: &sqlx::postgres::PgRow) -> Character {
    let class = class_from(r.get::<&str, _>("class"));
    Character {
        id: r.get("id"),
        account_id: r.get("account_id"),
        name: r.get("name"),
        class,
        progress: Progress::from_json(r.get("progress"), class),
        debug: r.get("debug"),
    }
}

#[tracing::instrument(skip_all)]
pub async fn list_characters(db: &Db, account_id: i32) -> Result<Vec<Character>, sqlx::Error> {
    let rows = sqlx::query("SELECT c.id, c.account_id, c.name, c.class, c.progress, a.debug AS debug FROM characters c JOIN accounts a ON a.id = c.account_id WHERE c.account_id = $1 ORDER BY c.id").bind(account_id).fetch_all(db).await?;
    Ok(rows.iter().map(character_from).collect())
}

/// One of the account's characters (`None` if it belongs to someone else).
#[tracing::instrument(skip_all)]
pub async fn load_character(db: &Db, account_id: i32, id: i32) -> Result<Option<Character>, sqlx::Error> {
    let row = sqlx::query("SELECT c.id, c.account_id, c.name, c.class, c.progress, a.debug AS debug FROM characters c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1 AND c.account_id = $2").bind(id).bind(account_id).fetch_optional(db).await?;
    Ok(row.as_ref().map(character_from))
}

#[tracing::instrument(skip_all)]
pub async fn create_character(db: &Db, account_id: i32, name: &str, class: ClassId) -> Result<Character, DbError> {
    let mut tx = db.begin().await?;
    // Lock the account row so two parallel creates cannot both pass the cap.
    let debug: bool = sqlx::query("SELECT debug FROM accounts WHERE id = $1 FOR UPDATE").bind(account_id).fetch_one(&mut *tx).await?.get(0);
    let count: i64 = sqlx::query("SELECT count(*) FROM characters WHERE account_id = $1").bind(account_id).fetch_one(&mut *tx).await?.get(0);
    if count >= MAX_CHARACTERS {
        return Err(DbError::TooManyCharacters);
    }
    let progress = Progress::new(class);
    let row = sqlx::query("INSERT INTO characters (account_id, name, class, progress) VALUES ($1, $2, $3, $4) RETURNING id")
        .bind(account_id)
        .bind(name)
        .bind(class_name(class))
        .bind(progress.to_json())
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Character { id: row.get(0), account_id, name: name.to_string(), class, progress, debug })
}

/// True if the character existed and belonged to the account.
#[tracing::instrument(skip_all)]
pub async fn delete_character(db: &Db, account_id: i32, id: i32) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM characters WHERE id = $1 AND account_id = $2").bind(id).bind(account_id).execute(db).await?;
    Ok(r.rows_affected() > 0)
}

/// Admin: deletes any character. Returns its owner and name if it existed.
#[tracing::instrument(skip_all)]
pub async fn delete_character_any(db: &Db, id: i32) -> Result<Option<(i32, String)>, sqlx::Error> {
    let row = sqlx::query("DELETE FROM characters WHERE id = $1 RETURNING account_id, name").bind(id).fetch_optional(db).await?;
    Ok(row.map(|r| (r.get(0), r.get(1))))
}

// ------------------------------------------------------------------ progress

/// The outcome of `modify`.
#[derive(Debug, PartialEq)]
pub enum Modified<E> {
    /// Changed and written; the new progress.
    Done(Progress),
    /// The change itself was refused (nothing written).
    Refused(E),
    /// The character no longer exists (or moved to another account).
    Missing,
    /// The account's debug flag is not the required one (nothing written).
    WrongKind,
}

/// Lock, change in Rust, write back: the one way progress is modified. The
/// row lock serialises concurrent changes (banking a run while buying), so
/// none is lost. With `require = Some(flag)` the account must have exactly
/// that debug flag; it is read under `FOR SHARE`, so marking or unmarking the
/// account (which takes the row `FOR UPDATE`) cannot slip in between. Lock
/// order: the account row first, then the character row.
async fn modify<E>(conn: &mut PgConnection, id: i32, require: Option<bool>, f: impl FnOnce(&mut Progress) -> Result<(), E>) -> Result<Modified<E>, sqlx::Error> {
    let Some(row) = sqlx::query("SELECT account_id FROM characters WHERE id = $1").bind(id).fetch_optional(&mut *conn).await? else {
        return Ok(Modified::Missing);
    };
    let account: i32 = row.get(0);
    let mut flag = None;
    if require.is_some() {
        flag = sqlx::query("SELECT debug FROM accounts WHERE id = $1 FOR SHARE").bind(account).fetch_optional(&mut *conn).await?.map(|r| r.get::<bool, _>(0));
        if flag.is_none() {
            return Ok(Modified::Missing);
        }
    }
    let Some(row) = sqlx::query("SELECT class, progress, account_id FROM characters WHERE id = $1 FOR UPDATE").bind(id).fetch_optional(&mut *conn).await? else {
        return Ok(Modified::Missing);
    };
    if row.get::<i32, _>(2) != account {
        return Ok(Modified::Missing);
    }
    if require.is_some() && flag != require {
        return Ok(Modified::WrongKind);
    }
    let mut p = Progress::from_json(row.get(1), class_from(row.get::<&str, _>(0)));
    if let Err(e) = f(&mut p) {
        return Ok(Modified::Refused(e));
    }
    p.version = CURRENT_VERSION;
    p.rev += 1;
    sqlx::query("UPDATE characters SET progress = $2 WHERE id = $1").bind(id).bind(p.to_json()).execute(&mut *conn).await?;
    Ok(Modified::Done(p))
}

/// Applies a build change and saves it; commits only when it is `Done`. A
/// debug change needs a debug account at save time.
#[tracing::instrument(skip_all)]
pub async fn update_progress(db: &Db, id: i32, change: Change, class: ClassId) -> Result<Modified<&'static str>, sqlx::Error> {
    let require = change.is_debug().then_some(true);
    let mut tx = db.begin().await?;
    let out = modify(&mut tx, id, require, |p| p.apply(class, change)).await?;
    if matches!(out, Modified::Done(_)) {
        tx.commit().await?;
    }
    Ok(out)
}

/// Banks a finished run for all its characters in one transaction. Returns
/// the new progress of each character that still exists and whose account is
/// of the run's kind (`debug_run`); the others are skipped.
#[tracing::instrument(skip_all)]
pub async fn bank_awards(db: &Db, awards: &[Award], debug_run: bool) -> Result<Vec<(i32, Progress)>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let mut out = Vec::new();
    // A fixed lock order keeps two parallel bankings from deadlocking: the
    // accounts by id first, then the characters by id.
    let mut awards = awards.to_vec();
    awards.sort_by_key(|a| a.character);
    let ids: Vec<i32> = awards.iter().map(|a| a.character).collect();
    sqlx::query("SELECT a.id, a.debug FROM accounts a JOIN characters c ON c.account_id = a.id WHERE c.id = ANY($1) ORDER BY a.id FOR SHARE OF a")
        .bind(&ids)
        .fetch_all(&mut *tx)
        .await?;
    for a in &awards {
        match modify(&mut tx, a.character, Some(debug_run), |p| -> Result<(), ()> {
            p.bank(a.xp, a.coins);
            Ok(())
        })
        .await?
        {
            Modified::Done(p) => out.push((a.character, p)),
            Modified::WrongKind => tracing::warn!(character = a.character, debug_run, "award skipped: the account's kind changed"),
            Modified::Missing | Modified::Refused(()) => {}
        }
    }
    tx.commit().await?;
    Ok(out)
}

/// What `set_account_debug` did: the flag before, and how many characters
/// were wiped. `was == on` means nothing changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DebugChange {
    pub was: bool,
    pub wiped: u32,
}

/// Admin: marks or unmarks an account as a debug account. Unmarking wipes
/// every character of the account (their progress was never earned); marking
/// keeps the progress. `None` if there is no such account. A request that
/// matches the current flag writes nothing. The account row is locked first,
/// like everywhere.
#[tracing::instrument(skip_all)]
pub async fn set_account_debug(db: &Db, id: i32, on: bool) -> Result<Option<DebugChange>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let Some(row) = sqlx::query("SELECT debug FROM accounts WHERE id = $1 FOR UPDATE").bind(id).fetch_optional(&mut *tx).await? else {
        return Ok(None);
    };
    let was: bool = row.get(0);
    if was == on {
        return Ok(Some(DebugChange { was, wiped: 0 }));
    }
    sqlx::query("UPDATE accounts SET debug = $2 WHERE id = $1").bind(id).bind(on).execute(&mut *tx).await?;
    let mut wiped = 0;
    if was {
        let rows = sqlx::query("SELECT id, class FROM characters WHERE account_id = $1 ORDER BY id").bind(id).fetch_all(&mut *tx).await?;
        for r in &rows {
            let class = class_from(r.get::<&str, _>(1));
            let reset = |p: &mut Progress| {
                let rev = p.rev;
                *p = Progress::new(class);
                p.rev = rev;
                Ok::<_, ()>(())
            };
            if matches!(modify(&mut tx, r.get(0), None, reset).await?, Modified::Done(_)) {
                wiped += 1;
            }
        }
    }
    tx.commit().await?;
    Ok(Some(DebugChange { was, wiped }))
}

// --------------------------------------------------------------- statistics

/// Stores a finished run and its players (see `stats.rs` for the reading side).
#[tracing::instrument(skip_all)]
pub async fn record_run(db: &Db, r: &RunRecord) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let id: i64 = sqlx::query(
        "INSERT INTO runs (started_at, level, boss, outcome, duration_s, players, debug) \
         VALUES (now() - make_interval(secs => $1), $2, $3, $4, $5, $6, $7) RETURNING id",
    )
    .bind(r.duration_s)
    .bind(format!("{:?}", r.level))
    .bind(r.boss.map(|b| format!("{b:?}")))
    .bind(r.outcome.as_str())
    .bind(r.duration_s as f32)
    .bind(r.players.len() as i16)
    .bind(r.debug)
    .fetch_one(&mut *tx)
    .await?
    .get(0);
    for p in &r.players {
        sqlx::query(
            "INSERT INTO run_players (run_id, account_id, character_id, class, kills, damage, healing, xp, coins, survived, left_run) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        )
        .bind(id)
        .bind(p.account)
        .bind(p.character)
        .bind(class_name(p.class))
        .bind(p.kills as i32)
        .bind(p.damage as f32)
        .bind(p.healing as f32)
        .bind(p.xp as i32)
        .bind(p.coins as i32)
        .bind(p.survived)
        .bind(p.left)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

#[cfg(test)]
pub mod tests {
    //! These tests need PostgreSQL: they run when `DATABASE_URL` is set (each
    //! test creates its own throwaway database) and pass vacuously otherwise.
    use super::*;
    use crate::defs::attributes::Attr;
    use crate::defs::items::ItemId;
    use sqlx::Executor;

    pub const WEEK: Duration = Duration::from_secs(7 * 24 * 3600);

    pub async fn test_db() -> Option<Db> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let admin = PgPoolOptions::new().max_connections(1).connect(&url).await.expect("test database server");
        let name = format!("ta_test_{:016x}", rand::random::<u64>());
        admin.execute(format!("CREATE DATABASE {name}").as_str()).await.expect("create test database");
        let base = url.rsplit_once('/').map_or(url.as_str(), |(b, _)| b);
        Some(connect(&format!("{base}/{name}")).await)
    }

    #[tokio::test]
    async fn names_are_unique_ignoring_case() {
        let Some(db) = test_db().await else { return };
        let a = create_account(&db, "Hero", "h").await.unwrap();
        assert!(matches!(create_account(&db, "hERO", "h").await, Err(DbError::NameTaken)));
        assert_eq!(find_account(&db, "HERO").await.unwrap().unwrap().id, a);
        create_character(&db, a, "Merlin", ClassId::Wizard).await.unwrap();
        assert!(matches!(create_character(&db, a, "merlin", ClassId::Paladin).await, Err(DbError::NameTaken)));
    }

    #[tokio::test]
    async fn characters_are_capped_and_owned() {
        let Some(db) = test_db().await else { return };
        let a = create_account(&db, "Owner", "h").await.unwrap();
        let b = create_account(&db, "Other", "h").await.unwrap();
        for i in 0..MAX_CHARACTERS {
            create_character(&db, a, &format!("Char{i}"), ClassId::ALL[i as usize % 4]).await.unwrap();
        }
        assert!(matches!(create_character(&db, a, "OneTooMany", ClassId::Wizard).await, Err(DbError::TooManyCharacters)));
        let list = list_characters(&db, a).await.unwrap();
        assert_eq!(list.len(), MAX_CHARACTERS as usize);
        assert_eq!(list[1].class, ClassId::Paladin);
        assert!(load_character(&db, b, list[0].id).await.unwrap().is_none(), "not b's character");
        assert!(!delete_character(&db, b, list[0].id).await.unwrap());
        assert!(delete_character(&db, a, list[0].id).await.unwrap());
    }

    #[tokio::test]
    async fn the_class_check_takes_the_ranger_and_refuses_the_assassin() {
        let Some(db) = test_db().await else { return };
        let a = create_account(&db, "Archer", "h").await.unwrap();
        let c = create_character(&db, a, "Ranger", ClassId::ElvenRanger).await.unwrap();
        assert_eq!(c.class, ClassId::ElvenRanger);
        let old = sqlx::query("INSERT INTO characters (account_id, name, class) VALUES ($1, 'Old', 'Assassin')").bind(a).execute(&db).await;
        assert!(old.is_err(), "the CHECK constraint no longer allows Assassin");
    }

    fn done(m: Modified<&'static str>) -> Progress {
        match m {
            Modified::Done(p) => p,
            other => panic!("expected Done, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn debug_changes_need_a_debug_account_at_save_time() {
        let Some(db) = test_db().await else { return };
        let a = create_account(&db, "Cheater", "h").await.unwrap();
        let c = create_character(&db, a, "Sneak", ClassId::Wizard).await.unwrap();
        let w = ClassId::Wizard;
        let before = load_character(&db, a, c.id).await.unwrap().unwrap().progress;
        assert_eq!(update_progress(&db, c.id, Change::GrantItem(ItemId::Knife), w).await.unwrap(), Modified::WrongKind);
        let after = load_character(&db, a, c.id).await.unwrap().unwrap().progress;
        assert_eq!((after.rev, after.inventory.clone()), (before.rev, before.inventory.clone()), "nothing written");

        bank_awards(&db, &[Award { character: c.id, xp: 10_000, coins: 0 }], false).await.unwrap();
        done(update_progress(&db, c.id, Change::BuyAttr(Attr::Wil), w).await.unwrap());

        assert_eq!(set_account_debug(&db, a, true).await.unwrap(), Some(DebugChange { was: false, wiped: 0 }));
        let p = done(update_progress(&db, c.id, Change::GrantItem(ItemId::Knife), w).await.unwrap());
        assert!(p.inventory.contains(&ItemId::Knife));

        delete_character(&db, a, c.id).await.unwrap();
        assert_eq!(update_progress(&db, c.id, Change::GrantItem(ItemId::Knife), w).await.unwrap(), Modified::Missing);
        assert_eq!(update_progress(&db, c.id, Change::BuyAttr(Attr::Wil), w).await.unwrap(), Modified::Missing);
    }

    #[tokio::test]
    async fn bank_skips_characters_whose_account_kind_differs() {
        let Some(db) = test_db().await else { return };
        let n = create_account(&db, "Normal", "h").await.unwrap();
        let d = create_account(&db, "Dbg", "h").await.unwrap();
        set_account_debug(&db, d, true).await.unwrap();
        let cn = create_character(&db, n, "Plain", ClassId::Paladin).await.unwrap();
        let cd = create_character(&db, d, "Tester", ClassId::Paladin).await.unwrap();
        assert!(!cn.debug && cd.debug, "create_character fills the flag");
        let awards = [Award { character: cn.id, xp: 10, coins: 1 }, Award { character: cd.id, xp: 20, coins: 2 }];

        let out = bank_awards(&db, &awards, true).await.unwrap();
        assert_eq!(out.iter().map(|(id, _)| *id).collect::<Vec<_>>(), vec![cd.id]);
        let (pn, pd) = (load_character(&db, n, cn.id).await.unwrap().unwrap().progress, load_character(&db, d, cd.id).await.unwrap().unwrap().progress);
        assert_eq!((pn.xp, pd.xp, pd.coins), (0, 20, 2));

        let out = bank_awards(&db, &awards, false).await.unwrap();
        assert_eq!(out.iter().map(|(id, _)| *id).collect::<Vec<_>>(), vec![cn.id]);
        assert_eq!(load_character(&db, n, cn.id).await.unwrap().unwrap().progress.xp, 10);
    }

    #[tokio::test]
    async fn unmarking_wipes_every_character_and_marking_keeps_progress() {
        let Some(db) = test_db().await else { return };
        let a = create_account(&db, "Flip", "h").await.unwrap();
        let c1 = create_character(&db, a, "One", ClassId::Wizard).await.unwrap();
        let c2 = create_character(&db, a, "Two", ClassId::Barbarian).await.unwrap();
        assert_eq!(set_account_debug(&db, a, true).await.unwrap(), Some(DebugChange { was: false, wiped: 0 }));
        assert!(account(&db, a).await.unwrap().unwrap().debug);
        for c in [&c1, &c2] {
            bank_awards(&db, &[Award { character: c.id, xp: 50, coins: 5 }], true).await.unwrap();
            done(update_progress(&db, c.id, Change::GrantItem(ItemId::Knife), c.class).await.unwrap());
        }
        let before: Vec<Progress> = list_characters(&db, a).await.unwrap().into_iter().map(|c| c.progress).collect();
        assert!(before.iter().all(|p| p.xp == 50 && p.inventory.contains(&ItemId::Knife)));
        assert_eq!(set_account_debug(&db, a, true).await.unwrap(), Some(DebugChange { was: true, wiped: 0 }), "marking again keeps the progress");
        let same: Vec<Progress> = list_characters(&db, a).await.unwrap().into_iter().map(|c| c.progress).collect();
        assert_eq!(same, before);

        assert_eq!(set_account_debug(&db, a, false).await.unwrap(), Some(DebugChange { was: true, wiped: 2 }));
        assert!(!account(&db, a).await.unwrap().unwrap().debug);
        for (c, old) in list_characters(&db, a).await.unwrap().iter().zip(&before) {
            let fresh = Progress::new(c.class);
            let p = &c.progress;
            assert_eq!((p.xp, p.total_xp), (0, 0));
            assert_eq!((&p.coins, &p.inventory, &p.nodes, &p.bought), (&fresh.coins, &fresh.inventory, &fresh.nodes, &fresh.bought));
            assert!(p.rev > old.rev);
        }
        assert_eq!(set_account_debug(&db, a, false).await.unwrap(), Some(DebugChange { was: false, wiped: 0 }));
        assert_eq!(set_account_debug(&db, 9999, true).await.unwrap(), None);
    }

    #[tokio::test]
    async fn loaded_characters_carry_the_account_flag() {
        let Some(db) = test_db().await else { return };
        let a = create_account(&db, "Flagged", "h").await.unwrap();
        let c = create_character(&db, a, "Marked", ClassId::Wizard).await.unwrap();
        assert!(!load_character(&db, a, c.id).await.unwrap().unwrap().debug);
        assert!(!list_characters(&db, a).await.unwrap()[0].debug);
        set_account_debug(&db, a, true).await.unwrap();
        assert!(load_character(&db, a, c.id).await.unwrap().unwrap().debug);
        assert!(list_characters(&db, a).await.unwrap()[0].debug);
    }

    #[tokio::test]
    async fn progress_changes_are_never_lost() {
        let Some(db) = test_db().await else { return };
        let a = create_account(&db, "Racer", "h").await.unwrap();
        let c = create_character(&db, a, "Speedy", ClassId::ElvenRanger).await.unwrap();
        let other = create_character(&db, a, "Bystander", ClassId::Paladin).await.unwrap();
        bank_awards(&db, &[Award { character: c.id, xp: 10_000, coins: 0 }], false).await.unwrap();

        // 20 bankings and 10 purchases at the same time.
        let mut tasks = Vec::new();
        for _ in 0..20 {
            let db = db.clone();
            tasks.push(tokio::spawn(async move { bank_awards(&db, &[Award { character: c.id, xp: 1, coins: 2 }], false).await.unwrap(); }));
        }
        for i in 0..10 {
            let db = db.clone();
            let attr = [Attr::Dex, Attr::Wil][i % 2];
            tasks.push(tokio::spawn(async move { done(update_progress(&db, c.id, Change::BuyAttr(attr), ClassId::ElvenRanger).await.unwrap()); }));
        }
        for t in tasks {
            t.await.unwrap();
        }
        let p = load_character(&db, a, c.id).await.unwrap().unwrap().progress;
        assert_eq!(p.coins, 40);
        assert_eq!(p.total_xp, 10_000 + 20);
        assert_eq!((p.bought.get(Attr::Dex), p.bought.get(Attr::Wil)), (5, 5));
        assert_eq!(p.xp, p.total_xp - p.xp_spent);
        assert!(p.xp_spent > 0);
        assert_eq!(p.rev, 31);

        assert_eq!(load_character(&db, a, other.id).await.unwrap().unwrap().progress, Progress::new(ClassId::Paladin), "other character untouched");
        // A failed purchase changes nothing.
        let rich = update_progress(&db, other.id, Change::BuyAttr(Attr::Str), ClassId::Paladin).await.unwrap();
        assert!(matches!(rich, Modified::Refused(_)));
        assert_eq!(load_character(&db, a, other.id).await.unwrap().unwrap().progress.rev, 0);
        // Banking to a deleted character is skipped.
        delete_character(&db, a, other.id).await.unwrap();
        assert!(bank_awards(&db, &[Award { character: other.id, xp: 5, coins: 0 }], false).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn old_progress_documents_are_read_and_upgraded_on_save() {
        let Some(db) = test_db().await else { return };
        let a = create_account(&db, "Veteran", "h").await.unwrap();
        let c = create_character(&db, a, "Oldie", ClassId::Barbarian).await.unwrap();
        sqlx::query("UPDATE characters SET progress = '{\"xp\": 300, \"upgrades\": {\"armor\": 1}, \"future\": true}' WHERE id = $1").bind(c.id).execute(&db).await.unwrap();
        let p = load_character(&db, a, c.id).await.unwrap().unwrap().progress;
        assert_eq!((p.xp, p.version), (300 + 100, CURRENT_VERSION), "the v1 level is refunded");
        done(update_progress(&db, c.id, Change::BuyAttr(Attr::Str), ClassId::Barbarian).await.unwrap());
        let again = load_character(&db, a, c.id).await.unwrap().unwrap().progress;
        assert_eq!(again.xp, 400 - again.xp_spent, "read twice, refunded once");
        let v: i64 = sqlx::query("SELECT (progress->>'version')::bigint FROM characters WHERE id = $1").bind(c.id).fetch_one(&db).await.unwrap().get(0);
        assert_eq!(v, CURRENT_VERSION as i64);
    }

    #[tokio::test]
    async fn sessions_end_with_logout_and_account_deletion() {
        let Some(db) = test_db().await else { return };
        let a = create_account(&db, "Leaver", "h").await.unwrap();
        create_character(&db, a, "Ghost", ClassId::Wizard).await.unwrap();
        create_session(&db, a, b"one", WEEK).await.unwrap();
        create_session(&db, a, b"two", WEEK).await.unwrap();
        assert_eq!(touch_session(&db, b"one", WEEK).await.unwrap(), Some(a));
        delete_session(&db, b"one").await.unwrap();
        assert_eq!(touch_session(&db, b"one", WEEK).await.unwrap(), None);
        assert_eq!(touch_session(&db, b"two", WEEK).await.unwrap(), Some(a));

        delete_account(&db, a).await.unwrap();
        assert_eq!(touch_session(&db, b"two", WEEK).await.unwrap(), None);
        let left: i64 = sqlx::query("SELECT count(*) FROM characters").fetch_one(&db).await.unwrap().get(0);
        assert_eq!(left, 0, "characters deleted with the account");
        assert!(find_account(&db, "Leaver").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn sessions_end_when_idle_and_activity_restarts_the_clock() {
        let Some(db) = test_db().await else { return };
        let a = create_account(&db, "Idler", "h").await.unwrap();
        let left = |id: &'static [u8]| {
            let db = db.clone();
            async move { sqlx::query("SELECT extract(epoch FROM expires_at - now())::float8 FROM sessions WHERE id_hash = $1").bind(id).fetch_one(&db).await.unwrap().get::<f64, _>(0) }
        };
        create_session(&db, a, b"s", Duration::from_secs(60)).await.unwrap();
        assert!((left(b"s").await - 60.0).abs() < 5.0);
        // Activity moves the end forward by the idle time from now.
        assert_eq!(touch_session(&db, b"s", WEEK).await.unwrap(), Some(a));
        assert!((left(b"s").await - WEEK.as_secs_f64()).abs() < 5.0);

        // Idle too long: over, and checking it does not revive it.
        sqlx::query("UPDATE sessions SET expires_at = now() - interval '1 second'").execute(&db).await.unwrap();
        assert_eq!(touch_session(&db, b"s", WEEK).await.unwrap(), None);
        // The end of a game connection does: the player was active all along.
        extend_session(&db, b"s", WEEK).await.unwrap();
        assert_eq!(touch_session(&db, b"s", WEEK).await.unwrap(), Some(a));
        // But not a deleted session (logout, new password).
        delete_session(&db, b"s").await.unwrap();
        extend_session(&db, b"s", WEEK).await.unwrap();
        assert_eq!(touch_session(&db, b"s", WEEK).await.unwrap(), None);
    }
}
