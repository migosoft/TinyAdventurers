//! Read-only queries of the admin area: statistics, the player list and a
//! player's details, and the audit log. Days and time windows are calendar
//! days in UTC ("today" starts at 00:00 UTC; "7 days" is today and the six
//! days before). Timestamps go to the browser as Unix milliseconds.
//!
//! The history tables (`activity_days`, `runs`, `run_players`) start empty on
//! the first deployment: their numbers count from then on.

use crate::db::{self, Db};
use crate::lobby::Live;
use crate::protocol::{CharacterInfo, ClassId};
use serde::Serialize;
use sqlx::Row;
use ts_rs::TS;

/// Players per page in the admin's player list.
pub const PAGE_SIZE: u32 = 50;

#[derive(Serialize, TS)]
#[ts(export)]
pub struct AdminStats {
    pub live: LiveStats,
    pub totals: Totals,
    /// Today, the last 7 days and the last 30 days.
    pub windows: Vec<WindowStats>,
    /// Last 30 days.
    pub bosses: Vec<BossStats>,
    pub classes: Vec<ClassStats>,
    /// Characters by the number of upgrades bought.
    pub levels: Vec<LevelBucket>,
    pub top: Vec<TopCharacter>,
    /// The last 30 days, oldest first.
    pub trend: Vec<DayPoint>,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct LiveStats {
    pub online: u32,
    pub in_lobby: u32,
    pub in_run: u32,
    /// Waiting rooms that have not started yet.
    pub rooms_open: u32,
    pub runs_active: u32,
    pub players: Vec<OnlinePlayer>,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct OnlinePlayer {
    pub account_id: i32,
    pub account: String,
    pub character: Option<String>,
    pub class: Option<ClassId>,
    pub in_run: bool,
    /// Connected since (Unix ms).
    pub since: f64,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct Totals {
    pub accounts: u32,
    pub characters: u32,
    /// All XP ever earned, over all characters.
    pub total_xp: f64,
    /// Unspent coins over all characters.
    pub coins: f64,
    pub runs: u32,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct WindowStats {
    /// Days covered including today: 1, 7 or 30.
    pub days: u32,
    /// Accounts that logged in or played.
    pub active_players: u32,
    pub registrations: u32,
    pub runs: u32,
    pub victories: u32,
    pub defeats: u32,
    /// Everyone left before the end.
    pub abandoned: u32,
    pub avg_duration_s: f64,
    pub avg_party: f64,
    pub kills: u32,
    pub deaths: u32,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct BossStats {
    pub boss: String,
    pub runs: u32,
    pub victories: u32,
    pub defeats: u32,
    /// Average over won and lost runs.
    pub avg_duration_s: f64,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct ClassStats {
    pub class: ClassId,
    pub characters: u32,
    /// Times a character of this class played a run (last 30 days).
    pub played: u32,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct LevelBucket {
    pub upgrades: u32,
    pub characters: u32,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct TopCharacter {
    pub id: i32,
    pub name: String,
    pub class: ClassId,
    pub account_id: i32,
    pub account: String,
    pub total_xp: u32,
    pub coins: u32,
    pub upgrades: u32,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct DayPoint {
    /// `YYYY-MM-DD` (UTC).
    pub day: String,
    pub active_players: u32,
    pub registrations: u32,
    pub runs: u32,
    pub victories: u32,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct PlayerRow {
    pub id: i32,
    pub name: String,
    /// Unix ms.
    pub created: f64,
    /// `YYYY-MM-DD` of the last active day, if any since tracking began.
    pub last_active: Option<String>,
    pub characters: u32,
    pub online: bool,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct PlayerPage {
    pub players: Vec<PlayerRow>,
    pub total: u32,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct PlayerDetail {
    pub player: PlayerRow,
    pub characters: Vec<AdminCharacter>,
    pub runs_played: u32,
    pub active_days: u32,
    pub recent_runs: Vec<PlayerRun>,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct AdminCharacter {
    pub info: CharacterInfo,
    /// Unix ms.
    pub created: f64,
    /// Playing right now (in the lobby or a dungeon).
    pub in_use: bool,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct PlayerRun {
    #[ts(type = "number")]
    pub id: i64,
    /// Unix ms.
    pub started: f64,
    pub boss: String,
    pub outcome: String,
    pub duration_s: f64,
    pub players: u32,
    /// The character's current name (`None` if it was deleted).
    pub character: Option<String>,
    pub class: ClassId,
    pub kills: u32,
    pub xp: u32,
    pub coins: u32,
    pub survived: bool,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct AdminAction {
    #[ts(type = "number")]
    pub id: i64,
    /// Unix ms.
    pub at: f64,
    pub admin: String,
    pub action: String,
    pub target: String,
    pub detail: Option<String>,
}

fn n(r: &sqlx::postgres::PgRow, i: usize) -> u32 {
    r.get::<i64, _>(i).max(0) as u32
}

/// UTC midnight `$1` days before today, as `since` (timestamptz) and `d` (date).
const WINDOW: &str = "WITH t AS (SELECT d, d::timestamp AT TIME ZONE 'UTC' AS since FROM (SELECT (now() AT TIME ZONE 'UTC')::date - $1::int AS d) w), \
     r AS (SELECT runs.* FROM runs, t WHERE NOT debug AND started_at >= t.since)";

#[tracing::instrument(skip_all)]
pub async fn overview(db: &Db, live: Live) -> Result<AdminStats, sqlx::Error> {
    let mut windows = Vec::new();
    for days in [1u32, 7, 30] {
        windows.push(window(db, days).await?);
    }
    Ok(AdminStats {
        live: live_stats(db, live).await?,
        totals: totals(db).await?,
        windows,
        bosses: bosses(db).await?,
        classes: classes(db).await?,
        levels: levels(db).await?,
        top: top(db).await?,
        trend: trend(db).await?,
    })
}

async fn live_stats(db: &Db, live: Live) -> Result<LiveStats, sqlx::Error> {
    let ids: Vec<i32> = live.players.iter().map(|p| p.account).collect();
    let rows = sqlx::query("SELECT id, name FROM accounts WHERE id = ANY($1)").bind(&ids).fetch_all(db).await?;
    let name_of = |id: i32| rows.iter().find(|r| r.get::<i32, _>(0) == id).map_or_else(|| format!("#{id}"), |r| r.get(1));
    Ok(LiveStats {
        online: live.online,
        in_lobby: live.online - live.in_run,
        in_run: live.in_run,
        rooms_open: live.rooms_open,
        runs_active: live.runs_active,
        players: live
            .players
            .into_iter()
            .map(|p| OnlinePlayer {
                account_id: p.account,
                account: name_of(p.account),
                class: p.character.as_ref().map(|c| c.1),
                character: p.character.map(|c| c.0),
                in_run: p.in_run,
                since: p.since,
            })
            .collect(),
    })
}

async fn totals(db: &Db) -> Result<Totals, sqlx::Error> {
    let r = sqlx::query(
        "SELECT (SELECT count(*) FROM accounts), (SELECT count(*) FROM characters), \
         (SELECT coalesce(sum((progress->>'total_xp')::bigint), 0)::float8 FROM characters), \
         (SELECT coalesce(sum((progress->>'coins')::bigint), 0)::float8 FROM characters), \
         (SELECT count(*) FROM runs WHERE NOT debug)",
    )
    .fetch_one(db)
    .await?;
    Ok(Totals { accounts: n(&r, 0), characters: n(&r, 1), total_xp: r.get(2), coins: r.get(3), runs: n(&r, 4) })
}

async fn window(db: &Db, days: u32) -> Result<WindowStats, sqlx::Error> {
    let r = sqlx::query(&format!(
        "{WINDOW} SELECT \
         (SELECT count(DISTINCT account_id) FROM activity_days, t WHERE day >= t.d), \
         (SELECT count(*) FROM accounts, t WHERE created_at >= t.since), \
         (SELECT count(*) FROM r), \
         (SELECT count(*) FROM r WHERE outcome = 'victory'), \
         (SELECT count(*) FROM r WHERE outcome = 'defeat'), \
         (SELECT count(*) FROM r WHERE outcome = 'abandoned'), \
         (SELECT coalesce(avg(duration_s), 0)::float8 FROM r), \
         (SELECT coalesce(avg(players), 0)::float8 FROM r), \
         (SELECT coalesce(sum(kills), 0)::bigint FROM run_players p JOIN r ON r.id = p.run_id), \
         (SELECT count(*) FROM run_players p JOIN r ON r.id = p.run_id WHERE NOT p.survived AND NOT p.left_run)"
    ))
    .bind(days as i32 - 1)
    .fetch_one(db)
    .await?;
    Ok(WindowStats {
        days,
        active_players: n(&r, 0),
        registrations: n(&r, 1),
        runs: n(&r, 2),
        victories: n(&r, 3),
        defeats: n(&r, 4),
        abandoned: n(&r, 5),
        avg_duration_s: r.get(6),
        avg_party: r.get(7),
        kills: n(&r, 8),
        deaths: n(&r, 9),
    })
}

async fn bosses(db: &Db) -> Result<Vec<BossStats>, sqlx::Error> {
    let rows = sqlx::query(&format!(
        "{WINDOW} SELECT boss, count(*), count(*) FILTER (WHERE outcome = 'victory'), count(*) FILTER (WHERE outcome = 'defeat'), \
         coalesce(avg(duration_s) FILTER (WHERE outcome <> 'abandoned'), 0)::float8 FROM r GROUP BY boss ORDER BY boss"
    ))
    .bind(29)
    .fetch_all(db)
    .await?;
    Ok(rows.iter().map(|r| BossStats { boss: r.get(0), runs: n(r, 1), victories: n(r, 2), defeats: n(r, 3), avg_duration_s: r.get(4) }).collect())
}

async fn classes(db: &Db) -> Result<Vec<ClassStats>, sqlx::Error> {
    let owned = sqlx::query("SELECT class, count(*) FROM characters GROUP BY class").fetch_all(db).await?;
    let played = sqlx::query(&format!("{WINDOW} SELECT p.class, count(*) FROM run_players p JOIN r ON r.id = p.run_id GROUP BY p.class")).bind(29).fetch_all(db).await?;
    let count = |rows: &[sqlx::postgres::PgRow], c: ClassId| rows.iter().find(|r| r.get::<&str, _>(0) == format!("{c:?}")).map_or(0, |r| n(r, 1));
    Ok(ClassId::ALL.into_iter().map(|c| ClassStats { class: c, characters: count(&owned, c), played: count(&played, c) }).collect())
}

/// Upgrades bought, summed from the progress document.
const UPGRADES: &str = "(coalesce((progress->'upgrades'->>'damage')::int, 0) + coalesce((progress->'upgrades'->>'attack_speed')::int, 0) \
     + coalesce((progress->'upgrades'->>'move_speed')::int, 0) + coalesce((progress->'upgrades'->>'life')::int, 0) \
     + coalesce((progress->'upgrades'->>'armor')::int, 0))";

async fn levels(db: &Db) -> Result<Vec<LevelBucket>, sqlx::Error> {
    let rows = sqlx::query(&format!("SELECT lvl, count(*) FROM (SELECT {UPGRADES} AS lvl FROM characters) c GROUP BY lvl ORDER BY lvl")).fetch_all(db).await?;
    Ok(rows.iter().map(|r| LevelBucket { upgrades: r.get::<i32, _>(0).max(0) as u32, characters: n(r, 1) }).collect())
}

async fn top(db: &Db) -> Result<Vec<TopCharacter>, sqlx::Error> {
    let rows = sqlx::query(&format!(
        "SELECT c.id, c.name, c.class, a.id, a.name, coalesce((c.progress->>'total_xp')::bigint, 0) AS txp, \
         coalesce((c.progress->>'coins')::bigint, 0), {UPGRADES}::bigint \
         FROM characters c JOIN accounts a ON a.id = c.account_id ORDER BY txp DESC, c.id LIMIT 10"
    ))
    .fetch_all(db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| TopCharacter {
            id: r.get(0),
            name: r.get(1),
            class: db::class_from(r.get(2)),
            account_id: r.get(3),
            account: r.get(4),
            total_xp: n(r, 5),
            coins: n(r, 6),
            upgrades: n(r, 7),
        })
        .collect())
}

async fn trend(db: &Db) -> Result<Vec<DayPoint>, sqlx::Error> {
    let rows = sqlx::query(
        "WITH days AS (SELECT d::date AS day, d AT TIME ZONE 'UTC' AS t0, (d + interval '1 day') AT TIME ZONE 'UTC' AS t1 \
           FROM generate_series(((now() AT TIME ZONE 'UTC')::date - 29)::timestamp, (now() AT TIME ZONE 'UTC')::date::timestamp, interval '1 day') d) \
         SELECT day::text, \
           (SELECT count(*) FROM activity_days a WHERE a.day = days.day), \
           (SELECT count(*) FROM accounts WHERE created_at >= t0 AND created_at < t1), \
           (SELECT count(*) FROM runs WHERE NOT debug AND started_at >= t0 AND started_at < t1), \
           (SELECT count(*) FROM runs WHERE NOT debug AND outcome = 'victory' AND started_at >= t0 AND started_at < t1) \
         FROM days ORDER BY day",
    )
    .fetch_all(db)
    .await?;
    Ok(rows.iter().map(|r| DayPoint { day: r.get(0), active_players: n(r, 1), registrations: n(r, 2), runs: n(r, 3), victories: n(r, 4) }).collect())
}

// ------------------------------------------------------------------- players

const PLAYER_COLUMNS: &str = "a.id, a.name, (extract(epoch FROM a.created_at) * 1000)::float8, \
     (SELECT max(day)::text FROM activity_days d WHERE d.account_id = a.id), \
     (SELECT count(*) FROM characters c WHERE c.account_id = a.id)";

fn player_row(r: &sqlx::postgres::PgRow, online: &(dyn Fn(i32) -> bool + Sync)) -> PlayerRow {
    let id = r.get(0);
    PlayerRow { id, name: r.get(1), created: r.get(2), last_active: r.get(3), characters: n(r, 4), online: online(id) }
}

/// `query` matches anywhere in the name, ignoring case. `sort`: "name"
/// (default), "created" (newest first) or "active" (most recent first).
#[tracing::instrument(skip(db, online))]
pub async fn players(db: &Db, query: &str, sort: &str, page: u32, online: &(dyn Fn(i32) -> bool + Sync)) -> Result<PlayerPage, sqlx::Error> {
    let pattern = format!("%{}%", query.trim().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
    let order = match sort {
        "created" => "a.created_at DESC, a.id DESC",
        "active" => "4 DESC NULLS LAST, lower(a.name)",
        _ => "lower(a.name)",
    };
    let total = sqlx::query("SELECT count(*) FROM accounts WHERE name ILIKE $1").bind(&pattern).fetch_one(db).await?;
    let rows = sqlx::query(&format!("SELECT {PLAYER_COLUMNS} FROM accounts a WHERE a.name ILIKE $1 ORDER BY {order} LIMIT $2 OFFSET $3"))
        .bind(&pattern)
        .bind(PAGE_SIZE as i64)
        .bind(page as i64 * PAGE_SIZE as i64)
        .fetch_all(db)
        .await?;
    Ok(PlayerPage { players: rows.iter().map(|r| player_row(r, online)).collect(), total: n(&total, 0), page, page_size: PAGE_SIZE })
}

/// `in_use(account, character)`: is the character being played right now?
#[tracing::instrument(skip(db, online, in_use))]
pub async fn player(db: &Db, id: i32, online: &(dyn Fn(i32) -> bool + Sync), in_use: &(dyn Fn(i32) -> bool + Sync)) -> Result<Option<PlayerDetail>, sqlx::Error> {
    let Some(row) = sqlx::query(&format!("SELECT {PLAYER_COLUMNS} FROM accounts a WHERE a.id = $1")).bind(id).fetch_optional(db).await? else {
        return Ok(None);
    };
    let created = sqlx::query("SELECT id, (extract(epoch FROM created_at) * 1000)::float8 FROM characters WHERE account_id = $1").bind(id).fetch_all(db).await?;
    let characters = db::list_characters(db, id)
        .await?
        .iter()
        .map(|c| AdminCharacter {
            info: c.info(),
            created: created.iter().find(|r| r.get::<i32, _>(0) == c.id).map_or(0.0, |r| r.get(1)),
            in_use: in_use(c.id),
        })
        .collect();
    let counts = sqlx::query(
        "SELECT (SELECT count(*) FROM run_players p JOIN runs r ON r.id = p.run_id WHERE p.account_id = $1 AND NOT r.debug), \
         (SELECT count(*) FROM activity_days WHERE account_id = $1)",
    )
    .bind(id)
    .fetch_one(db)
    .await?;
    let runs = sqlx::query(
        "SELECT r.id, (extract(epoch FROM r.started_at) * 1000)::float8, r.boss, r.outcome, r.duration_s::float8, r.players::int, \
         c.name, p.class, p.kills, p.xp, p.coins, p.survived \
         FROM run_players p JOIN runs r ON r.id = p.run_id LEFT JOIN characters c ON c.id = p.character_id \
         WHERE p.account_id = $1 ORDER BY r.started_at DESC LIMIT 10",
    )
    .bind(id)
    .fetch_all(db)
    .await?;
    Ok(Some(PlayerDetail {
        player: player_row(&row, online),
        characters,
        runs_played: n(&counts, 0),
        active_days: n(&counts, 1),
        recent_runs: runs
            .iter()
            .map(|r| PlayerRun {
                id: r.get(0),
                started: r.get(1),
                boss: r.get(2),
                outcome: r.get(3),
                duration_s: r.get(4),
                players: r.get::<i32, _>(5).max(0) as u32,
                character: r.get(6),
                class: db::class_from(r.get(7)),
                kills: r.get::<i32, _>(8).max(0) as u32,
                xp: r.get::<i32, _>(9).max(0) as u32,
                coins: r.get::<i32, _>(10).max(0) as u32,
                survived: r.get(11),
            })
            .collect(),
    }))
}

// ----------------------------------------------------------------- audit log

pub async fn log_action(db: &Db, admin: &str, action: &str, target: &str, detail: Option<&str>) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO admin_actions (admin, action, target, detail) VALUES ($1, $2, $3, $4)").bind(admin).bind(action).bind(target).bind(detail).execute(db).await?;
    Ok(())
}

pub async fn recent_actions(db: &Db, limit: i64) -> Result<Vec<AdminAction>, sqlx::Error> {
    let rows = sqlx::query("SELECT id, (extract(epoch FROM at) * 1000)::float8, admin, action, target, detail FROM admin_actions ORDER BY id DESC LIMIT $1")
        .bind(limit)
        .fetch_all(db)
        .await?;
    Ok(rows.iter().map(|r| AdminAction { id: r.get(0), at: r.get(1), admin: r.get(2), action: r.get(3), target: r.get(4), detail: r.get(5) }).collect())
}

#[cfg(test)]
mod tests {
    //! Need PostgreSQL (`DATABASE_URL`), see `db::tests`.
    use super::*;
    use crate::db::tests::{test_db, WEEK};
    use crate::lobby::LivePlayer;
    use crate::protocol::BossId;
    use crate::run::{Award, Outcome, RunPlayerRecord, RunRecord};

    fn record(account: i32, character: i32, outcome: Outcome, debug: bool) -> RunRecord {
        RunRecord {
            boss: BossId::Demon,
            outcome,
            duration_s: 120.0,
            debug,
            players: vec![RunPlayerRecord { account: Some(account), character: Some(character), class: ClassId::Barbarian, kills: 4, damage: 10.0, healing: 0.0, xp: 50, coins: 3, survived: outcome == Outcome::Victory, left: outcome == Outcome::Abandoned }],
        }
    }

    fn win(s: &AdminStats, days: u32) -> &WindowStats {
        s.windows.iter().find(|w| w.days == days).unwrap()
    }

    #[tokio::test]
    async fn activity_counts_once_per_day_and_outlives_the_account() {
        let Some(db) = test_db().await else { return };
        let a = db::create_account(&db, "Daily", "h").await.unwrap();
        db::touch_activity(&db, a).await.unwrap();
        db::touch_activity(&db, a).await.unwrap();
        let s = overview(&db, Live::default()).await.unwrap();
        assert_eq!(win(&s, 1).active_players, 1);
        assert_eq!(s.trend.len(), 30);
        assert_eq!(s.trend.last().unwrap().active_players, 1, "today is the last point");
        db::delete_account(&db, a).await.unwrap();
        let s = overview(&db, Live::default()).await.unwrap();
        assert_eq!(win(&s, 30).active_players, 1, "history stays, anonymously");
        assert_eq!(s.totals.accounts, 0);
    }

    #[tokio::test]
    async fn windows_count_the_right_days_and_skip_debug_runs() {
        let Some(db) = test_db().await else { return };
        let a = db::create_account(&db, "Old", "h").await.unwrap();
        let b = db::create_account(&db, "New", "h").await.unwrap();
        let c = db::create_character(&db, a, "Grim", ClassId::Barbarian).await.unwrap();
        sqlx::query("UPDATE accounts SET created_at = now() - interval '10 days' WHERE id = $1").bind(a).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO activity_days VALUES ($1, (now() AT TIME ZONE 'UTC')::date - 3), ($2, (now() AT TIME ZONE 'UTC')::date)").bind(a).bind(b).execute(&db).await.unwrap();
        db::record_run(&db, &record(a, c.id, Outcome::Victory, false)).await.unwrap();
        db::record_run(&db, &record(a, c.id, Outcome::Defeat, false)).await.unwrap();
        db::record_run(&db, &record(a, c.id, Outcome::Victory, true)).await.unwrap();
        db::record_run(&db, &record(a, c.id, Outcome::Abandoned, false)).await.unwrap();
        sqlx::query("UPDATE runs SET started_at = now() - interval '5 days' WHERE outcome = 'defeat'").execute(&db).await.unwrap();
        db::bank_awards(&db, &[Award { character: c.id, xp: 70, coins: 9 }]).await.unwrap();

        let s = overview(&db, Live::default()).await.unwrap();
        let (d1, d7, d30) = (win(&s, 1), win(&s, 7), win(&s, 30));
        assert_eq!((d1.active_players, d7.active_players), (1, 2));
        assert_eq!((d1.registrations, d7.registrations, d30.registrations), (1, 1, 2));
        assert_eq!((d1.runs, d1.victories, d1.abandoned, d1.defeats), (2, 1, 1, 0), "debug run left out");
        assert_eq!((d7.runs, d7.defeats), (3, 1));
        assert_eq!((d7.kills, d7.deaths), (12, 1), "leaving the abandoned run is not a death");
        assert_eq!(s.totals.runs, 3);
        let demon = s.bosses.iter().find(|b| b.boss == "Demon").unwrap();
        assert_eq!((demon.runs, demon.victories, demon.defeats), (3, 1, 1));
        let barb = s.classes.iter().find(|c| c.class == ClassId::Barbarian).unwrap();
        assert_eq!((barb.characters, barb.played), (1, 3));
        assert_eq!(s.top[0].name, "Grim");
        assert_eq!((s.top[0].total_xp, s.top[0].coins, s.totals.total_xp), (70, 9, 70.0));
        assert_eq!(s.levels.iter().map(|l| (l.upgrades, l.characters)).collect::<Vec<_>>(), vec![(0, 1)]);
        let today = s.trend.last().unwrap();
        assert_eq!((today.runs, today.victories, today.registrations), (2, 1, 1));
    }

    #[tokio::test]
    async fn live_players_get_their_account_names() {
        let Some(db) = test_db().await else { return };
        let a = db::create_account(&db, "Onliner", "h").await.unwrap();
        let live = Live {
            online: 2,
            in_run: 1,
            rooms_open: 0,
            runs_active: 1,
            players: vec![
                LivePlayer { account: a, character: Some(("Zap".into(), ClassId::Wizard)), in_run: true, since: 1.0 },
                LivePlayer { account: 9999, character: None, in_run: false, since: 2.0 },
            ],
        };
        let s = overview(&db, live).await.unwrap();
        assert_eq!(s.live.in_lobby, 1);
        assert_eq!(s.live.players[0].account, "Onliner");
        assert_eq!(s.live.players[0].character.as_deref(), Some("Zap"));
        assert_eq!(s.live.players[1].account, "#9999", "an account deleted meanwhile");
    }

    #[tokio::test]
    async fn players_are_searched_sorted_paged_and_detailed() {
        let Some(db) = test_db().await else { return };
        for i in 0..(PAGE_SIZE + 5) {
            db::create_account(&db, &format!("Bulk{i:03}"), "h").await.unwrap();
        }
        let under = db::create_account(&db, "Under_score", "h").await.unwrap();
        db::create_account(&db, "Underxscore", "h").await.unwrap();
        let none = |_| false;
        let p = players(&db, "bulk", "name", 0, &none).await.unwrap();
        assert_eq!((p.total, p.players.len() as u32), (PAGE_SIZE + 5, PAGE_SIZE));
        assert_eq!(players(&db, "bulk", "name", 1, &none).await.unwrap().players.len(), 5);
        let p = players(&db, "under_", "name", 0, &|id| id == under).await.unwrap();
        assert_eq!(p.players.len(), 1, "_ is matched literally");
        assert!(p.players[0].online);
        assert_eq!(players(&db, "", "created", 0, &none).await.unwrap().players[0].name, "Underxscore", "newest first");

        let c = db::create_character(&db, under, "Lefty", ClassId::Assassin).await.unwrap();
        db::touch_activity(&db, under).await.unwrap();
        db::record_run(&db, &record(under, c.id, Outcome::Victory, false)).await.unwrap();
        let d = player(&db, under, &none, &|ch| ch == c.id).await.unwrap().unwrap();
        assert_eq!((d.runs_played, d.active_days, d.characters.len()), (1, 1, 1));
        assert!(d.characters[0].in_use);
        assert_eq!(d.recent_runs[0].character.as_deref(), Some("Lefty"));
        assert!(d.player.last_active.is_some());
        assert!(player(&db, 424242, &none, &none).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn admin_changes_work_on_any_account_and_are_logged() {
        let Some(db) = test_db().await else { return };
        let a = db::create_account(&db, "Victim", "old-hash").await.unwrap();
        let c = db::create_character(&db, a, "Doomed", ClassId::Paladin).await.unwrap();
        db::create_session(&db, a, b"s1", WEEK).await.unwrap();
        assert!(db::set_password(&db, a, "new-hash").await.unwrap());
        assert_eq!(db::touch_session(&db, b"s1", WEEK).await.unwrap(), None, "sessions revoked");
        assert_eq!(db::account(&db, a).await.unwrap().unwrap().password_hash, "new-hash");
        assert!(!db::set_password(&db, 424242, "x").await.unwrap());

        assert_eq!(db::delete_character_any(&db, c.id).await.unwrap(), Some((a, "Doomed".to_string())));
        assert_eq!(db::delete_character_any(&db, c.id).await.unwrap(), None);

        log_action(&db, "root", "set_password", "Victim", None).await.unwrap();
        log_action(&db, "root", "delete_character", "Doomed", Some("of account Victim")).await.unwrap();
        let log = recent_actions(&db, 10).await.unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!((log[0].action.as_str(), log[0].detail.as_deref()), ("delete_character", Some("of account Victim")), "newest first");
        assert!(log[1].at > 0.0);
    }
}
