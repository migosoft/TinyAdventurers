//! PostgreSQL access. Every query of the game lives here, so the storage
//! can change (or gain a cache) without touching the lobby or the API. The
//! read-only statistics queries of the admin area are in `stats.rs`.
//! Queries are checked at runtime (`sqlx::query`), so building needs no database.

use crate::progress::{Progress, CURRENT_VERSION};
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
}

#[derive(Debug, Clone)]
pub struct Character {
    pub id: i32,
    pub account_id: i32,
    pub name: String,
    pub class: ClassId,
    pub progress: Progress,
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
    let row = sqlx::query("SELECT id, name, password_hash FROM accounts WHERE lower(name) = lower($1)").bind(name).fetch_optional(db).await?;
    Ok(row.map(|r| Account { id: r.get(0), name: r.get(1), password_hash: r.get(2) }))
}

#[tracing::instrument(skip_all)]
pub async fn account(db: &Db, id: i32) -> Result<Option<Account>, sqlx::Error> {
    let row = sqlx::query("SELECT id, name, password_hash FROM accounts WHERE id = $1").bind(id).fetch_optional(db).await?;
    Ok(row.map(|r| Account { id: r.get(0), name: r.get(1), password_hash: r.get(2) }))
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
    Character {
        id: r.get("id"),
        account_id: r.get("account_id"),
        name: r.get("name"),
        class: class_from(r.get::<&str, _>("class")),
        progress: Progress::from_json(r.get("progress")),
    }
}

#[tracing::instrument(skip_all)]
pub async fn list_characters(db: &Db, account_id: i32) -> Result<Vec<Character>, sqlx::Error> {
    let rows = sqlx::query("SELECT id, account_id, name, class, progress FROM characters WHERE account_id = $1 ORDER BY id").bind(account_id).fetch_all(db).await?;
    Ok(rows.iter().map(character_from).collect())
}

/// One of the account's characters (`None` if it belongs to someone else).
#[tracing::instrument(skip_all)]
pub async fn load_character(db: &Db, account_id: i32, id: i32) -> Result<Option<Character>, sqlx::Error> {
    let row = sqlx::query("SELECT id, account_id, name, class, progress FROM characters WHERE id = $1 AND account_id = $2").bind(id).bind(account_id).fetch_optional(db).await?;
    Ok(row.as_ref().map(character_from))
}

#[tracing::instrument(skip_all)]
pub async fn create_character(db: &Db, account_id: i32, name: &str, class: ClassId) -> Result<Character, DbError> {
    let mut tx = db.begin().await?;
    // Lock the account row so two parallel creates cannot both pass the cap.
    sqlx::query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE").bind(account_id).fetch_one(&mut *tx).await?;
    let count: i64 = sqlx::query("SELECT count(*) FROM characters WHERE account_id = $1").bind(account_id).fetch_one(&mut *tx).await?.get(0);
    if count >= MAX_CHARACTERS {
        return Err(DbError::TooManyCharacters);
    }
    let progress = Progress::new();
    let row = sqlx::query("INSERT INTO characters (account_id, name, class, progress) VALUES ($1, $2, $3, $4) RETURNING id")
        .bind(account_id)
        .bind(name)
        .bind(class_name(class))
        .bind(progress.to_json())
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Character { id: row.get(0), account_id, name: name.to_string(), class, progress })
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

/// Lock, change in Rust, write back: the one way progress is modified. The
/// row lock serialises concurrent changes (banking a run while buying), so
/// none is lost. `Ok(None)` if the character no longer exists; an error from
/// `f` rolls back and is returned as `Ok(Some(Err(_)))`.
async fn modify<E>(conn: &mut PgConnection, id: i32, f: impl FnOnce(&mut Progress) -> Result<(), E>) -> Result<Option<Result<Progress, E>>, sqlx::Error> {
    let Some(row) = sqlx::query("SELECT progress FROM characters WHERE id = $1 FOR UPDATE").bind(id).fetch_optional(&mut *conn).await? else {
        return Ok(None);
    };
    let mut p = Progress::from_json(row.get(0));
    if let Err(e) = f(&mut p) {
        return Ok(Some(Err(e)));
    }
    p.version = CURRENT_VERSION;
    p.rev += 1;
    sqlx::query("UPDATE characters SET progress = $2 WHERE id = $1").bind(id).bind(p.to_json()).execute(&mut *conn).await?;
    Ok(Some(Ok(p)))
}

#[tracing::instrument(skip_all)]
pub async fn update_progress<E>(db: &Db, id: i32, f: impl FnOnce(&mut Progress) -> Result<(), E>) -> Result<Option<Result<Progress, E>>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let out = modify(&mut tx, id, f).await?;
    if matches!(out, Some(Ok(_))) {
        tx.commit().await?;
    }
    Ok(out)
}

/// Banks a finished run for all its characters in one transaction. Returns
/// the new progress of each character that still exists.
#[tracing::instrument(skip_all)]
pub async fn bank_awards(db: &Db, awards: &[Award]) -> Result<Vec<(i32, Progress)>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let mut out = Vec::new();
    // A fixed lock order keeps two parallel bankings from deadlocking.
    let mut awards = awards.to_vec();
    awards.sort_by_key(|a| a.character);
    for a in &awards {
        if let Some(Ok(p)) = modify(&mut tx, a.character, |p| -> Result<(), ()> {
            p.bank(a.xp, a.coins);
            Ok(())
        })
        .await?
        {
            out.push((a.character, p));
        }
    }
    tx.commit().await?;
    Ok(out)
}

// --------------------------------------------------------------- statistics

/// Stores a finished run and its players (see `stats.rs` for the reading side).
#[tracing::instrument(skip_all)]
pub async fn record_run(db: &Db, r: &RunRecord) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let id: i64 = sqlx::query(
        "INSERT INTO runs (started_at, boss, outcome, duration_s, players, debug) \
         VALUES (now() - make_interval(secs => $1), $2, $3, $4, $5, $6) RETURNING id",
    )
    .bind(r.duration_s)
    .bind(format!("{:?}", r.boss))
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
    use crate::defs::progression::{upgrade_cost, UpgradeStat};
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
    async fn progress_changes_are_never_lost() {
        let Some(db) = test_db().await else { return };
        let a = create_account(&db, "Racer", "h").await.unwrap();
        let c = create_character(&db, a, "Speedy", ClassId::Assassin).await.unwrap();
        let other = create_character(&db, a, "Bystander", ClassId::Paladin).await.unwrap();
        bank_awards(&db, &[Award { character: c.id, xp: upgrade_cost(0) * 40, coins: 0 }]).await.unwrap();

        // 20 bankings and 10 purchases at the same time.
        let mut tasks = Vec::new();
        for _ in 0..20 {
            let db = db.clone();
            tasks.push(tokio::spawn(async move { bank_awards(&db, &[Award { character: c.id, xp: 1, coins: 2 }]).await.unwrap(); }));
        }
        for i in 0..10 {
            let db = db.clone();
            let stat = [UpgradeStat::Damage, UpgradeStat::Life][i % 2];
            tasks.push(tokio::spawn(async move { update_progress(&db, c.id, |p| p.buy(stat)).await.unwrap().unwrap().unwrap(); }));
        }
        for t in tasks {
            t.await.unwrap();
        }
        let p = load_character(&db, a, c.id).await.unwrap().unwrap().progress;
        assert_eq!(p.coins, 40);
        assert_eq!(p.total_xp, upgrade_cost(0) * 40 + 20);
        assert_eq!((p.upgrades.damage, p.upgrades.life), (5, 5));
        let spent: u32 = (0..5).map(upgrade_cost).sum::<u32>() * 2;
        assert_eq!(p.xp, p.total_xp - spent);
        assert_eq!(p.rev, 31);

        assert_eq!(load_character(&db, a, other.id).await.unwrap().unwrap().progress, Progress::new(), "other character untouched");
        // A failed purchase changes nothing.
        let rich = update_progress(&db, other.id, |p| p.buy(UpgradeStat::Armor)).await.unwrap().unwrap();
        assert!(rich.is_err());
        assert_eq!(load_character(&db, a, other.id).await.unwrap().unwrap().progress.rev, 0);
        // Banking to a deleted character is skipped.
        delete_character(&db, a, other.id).await.unwrap();
        assert!(bank_awards(&db, &[Award { character: other.id, xp: 5, coins: 0 }]).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn old_progress_documents_are_read_and_upgraded_on_save() {
        let Some(db) = test_db().await else { return };
        let a = create_account(&db, "Veteran", "h").await.unwrap();
        let c = create_character(&db, a, "Oldie", ClassId::Barbarian).await.unwrap();
        sqlx::query("UPDATE characters SET progress = '{\"xp\": 300, \"upgrades\": {\"armor\": 1}, \"future\": true}' WHERE id = $1").bind(c.id).execute(&db).await.unwrap();
        let p = load_character(&db, a, c.id).await.unwrap().unwrap().progress;
        assert_eq!((p.xp, p.upgrades.armor, p.version), (300, 1, CURRENT_VERSION));
        update_progress(&db, c.id, |p| p.buy(UpgradeStat::Armor)).await.unwrap().unwrap().unwrap();
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
