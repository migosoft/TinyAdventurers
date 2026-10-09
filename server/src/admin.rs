//! The admin area's JSON API (`/api/admin/*`, page at `/admin`). The admin
//! logs in with `ADMIN_USER` / `ADMIN_PASSWORD` from the environment, not
//! with a game account. Without both (or with a short password) the whole
//! area answers 404.
//!
//! Admin sessions are signed tokens like the players' (`auth.rs`), in their
//! own cookie scoped to `/api/admin`, and kept in memory only: a restart
//! logs the admin out. Every change to a player is written to the audit log.

use crate::api::{self, fail, server_error, ApiResult, AppState, Credentials, PasswordConfirm};
use crate::auth::{self, AdminLogin};
use crate::db;
use crate::stats::{self, AdminAction, AdminStats, PlayerDetail, PlayerPage};
use crate::telemetry;
use axum::extract::{ConnectInfo, FromRequestParts, Path, Query, State};
use axum::http::request::Parts;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use ts_rs::TS;

const LOGIN_FAILS_PER_IP: u32 = 5;
const LOGIN_FAILS_TOTAL: u32 = 20;
const LOGIN_WINDOW: Duration = Duration::from_secs(300);

/// Default idle timeout of an admin session (`ADMIN_SESSION_MINUTES`).
pub const DEFAULT_IDLE_MINUTES: u64 = 10;

/// Requests the page makes by itself (the dashboard's auto-refresh) send this
/// header; they do not count as activity, so an open tab still times out.
pub const BACKGROUND_HEADER: &str = "x-admin-background";

pub struct AdminState {
    /// `None`: the admin area is disabled.
    login: Option<AdminLogin>,
    /// A session ends after this long without an admin action.
    idle: Duration,
    /// Session id hash -> end of the session unless the admin acts again.
    sessions: Mutex<HashMap<Vec<u8>, Instant>>,
}

impl AdminState {
    pub fn new(login: Option<AdminLogin>, idle: Duration) -> AdminState {
        AdminState { login, idle, sessions: Mutex::new(HashMap::new()) }
    }

    /// From `ADMIN_USER`, `ADMIN_PASSWORD` and `ADMIN_SESSION_MINUTES`; logs
    /// why if it stays disabled.
    pub fn from_env() -> AdminState {
        let idle = idle_timeout(std::env::var("ADMIN_SESSION_MINUTES").ok()).unwrap_or_else(|e| {
            tracing::warn!("{e}; using {DEFAULT_IDLE_MINUTES} minutes");
            Duration::from_secs(DEFAULT_IDLE_MINUTES * 60)
        });
        match AdminLogin::from_env() {
            Ok(l) => {
                tracing::info!("admin area enabled at /admin (sessions end after {} min without activity)", idle.as_secs() / 60);
                AdminState::new(Some(l), idle)
            }
            Err(e) => {
                tracing::warn!("admin area disabled: {e}");
                AdminState::new(None, idle)
            }
        }
    }

    fn name(&self) -> Option<&str> {
        self.login.as_ref().map(|l| l.name.as_str())
    }

    fn start(&self, id_hash: Vec<u8>, now: Instant) {
        self.sessions.lock().unwrap().insert(id_hash, now + self.idle);
    }

    /// True if the session is alive. An admin action (`active`) restarts its
    /// idle clock; a background request only checks it.
    fn touch(&self, id_hash: &[u8], now: Instant, active: bool) -> bool {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|_, end| *end > now);
        match sessions.get_mut(id_hash) {
            Some(end) => {
                if active {
                    *end = now + self.idle;
                }
                true
            }
            None => false,
        }
    }

    fn end(&self, id_hash: &[u8]) {
        self.sessions.lock().unwrap().remove(id_hash);
    }
}

/// `ADMIN_SESSION_MINUTES`: whole minutes, 1 to 1440; unset = the default.
fn idle_timeout(value: Option<String>) -> Result<Duration, String> {
    auth::minutes_setting("ADMIN_SESSION_MINUTES", value, DEFAULT_IDLE_MINUTES, 1440)
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct AdminMe {
    pub name: String,
}

#[derive(Deserialize)]
pub struct PlayersQuery {
    q: Option<String>,
    sort: Option<String>,
    page: Option<u32>,
}

fn not_found() -> api::Fail {
    fail(StatusCode::NOT_FOUND, "Not found.")
}

/// A logged-in admin (cookie signature, expiry and the in-memory session
/// checked). Extracting it counts as activity unless the request carries
/// `BACKGROUND_HEADER`.
pub struct AdminSession {
    pub name: String,
}

impl FromRequestParts<AppState> for AdminSession {
    type Rejection = api::Fail;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let name = state.admin.name().ok_or_else(not_found)?;
        let unauthorized = || fail(StatusCode::UNAUTHORIZED, "Please log in.");
        let cookies = parts.headers.get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok());
        let token = cookies.filter_map(|c| auth::cookie_value(c, auth::ADMIN_COOKIE)).next().ok_or_else(unauthorized)?;
        let id_hash = state.auth.verify(token).ok_or_else(unauthorized)?;
        let active = !parts.headers.contains_key(BACKGROUND_HEADER);
        if !state.admin.touch(&id_hash, Instant::now(), active) {
            return Err(fail(StatusCode::UNAUTHORIZED, "Your admin session ended. Please log in again."));
        }
        Ok(AdminSession { name: name.to_string() })
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/admin/login", post(login))
        .route("/api/admin/logout", post(logout))
        .route("/api/admin/me", get(me))
        .route("/api/admin/stats", get(overview))
        .route("/api/admin/players", get(players))
        .route("/api/admin/players/{id}", get(player).delete(delete_player))
        .route("/api/admin/players/{id}/password", post(set_password))
        .route("/api/admin/characters/{id}", delete(delete_character))
        .route("/api/admin/actions", get(actions))
        .layer(axum::middleware::from_fn(api::require_json))
}

async fn login(State(state): State<AppState>, ConnectInfo(addr): ConnectInfo<SocketAddr>, Json(c): Json<Credentials>) -> ApiResult<Response> {
    let Some(admin) = state.admin.login.as_ref() else { return Err(not_found()) };
    let ip_key = format!("admin-login:{}", addr.ip());
    {
        let mut l = state.auth.limiter.lock().unwrap();
        if l.blocked(&ip_key, LOGIN_FAILS_PER_IP, LOGIN_WINDOW) || l.blocked("admin-login", LOGIN_FAILS_TOTAL, LOGIN_WINDOW) {
            return Err(fail(StatusCode::TOO_MANY_REQUESTS, "Too many attempts. Wait a few minutes and try again."));
        }
    }
    if !admin.check(&c.name, &c.password) {
        let mut l = state.auth.limiter.lock().unwrap();
        l.hit(&ip_key, LOGIN_WINDOW);
        l.hit("admin-login", LOGIN_WINDOW);
        tracing::warn!("admin login failed");
        return Err(fail(StatusCode::UNAUTHORIZED, "Wrong name or password."));
    }
    state.auth.limiter.lock().unwrap().clear(&ip_key);
    let s = state.auth.new_admin_session();
    state.admin.start(s.id_hash, Instant::now());
    tracing::info!("admin logged in");
    Ok(([(header::SET_COOKIE, state.auth.set_admin_cookie(&s.token))], Json(AdminMe { name: admin.name.clone() })).into_response())
}

async fn logout(State(state): State<AppState>, parts: axum::http::HeaderMap) -> ApiResult<Response> {
    if state.admin.login.is_none() {
        return Err(not_found());
    }
    let cookies = parts.get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok());
    if let Some(id_hash) = cookies.filter_map(|c| auth::cookie_value(c, auth::ADMIN_COOKIE)).next().and_then(|t| state.auth.verify(t)) {
        state.admin.end(&id_hash);
    }
    Ok(([(header::SET_COOKIE, state.auth.clear_admin_cookie())], StatusCode::NO_CONTENT).into_response())
}

async fn me(admin: AdminSession) -> Json<AdminMe> {
    Json(AdminMe { name: admin.name })
}

async fn overview(State(state): State<AppState>, _admin: AdminSession) -> ApiResult<Json<AdminStats>> {
    let live = state.lobby.lock().unwrap().live();
    Ok(Json(stats::overview(&state.db, live).await?))
}

async fn players(State(state): State<AppState>, _admin: AdminSession, Query(q): Query<PlayersQuery>) -> ApiResult<Json<PlayerPage>> {
    let (online, _) = state.lobby.lock().unwrap().online_ids();
    let page = stats::players(&state.db, q.q.as_deref().unwrap_or(""), q.sort.as_deref().unwrap_or("name"), q.page.unwrap_or(0), &|id| online.contains(&id)).await?;
    Ok(Json(page))
}

async fn player(State(state): State<AppState>, _admin: AdminSession, Path(id): Path<i32>) -> ApiResult<Json<PlayerDetail>> {
    let (online, playing) = state.lobby.lock().unwrap().online_ids();
    let detail = stats::player(&state.db, id, &|a| online.contains(&a), &|c| playing.contains(&c)).await?;
    detail.map(Json).ok_or_else(|| fail(StatusCode::NOT_FOUND, "No such player."))
}

/// Writes the audit row. The change itself is done by then, so a failure
/// here is logged rather than reported as a failed action.
async fn audit(state: &AppState, admin: &AdminSession, action: &str, target: &str, detail: Option<&str>) {
    telemetry::metrics().admin_action(action);
    tracing::info!(action, "admin action");
    if let Err(e) = stats::log_action(&state.db, &admin.name, action, target, detail).await {
        tracing::error!("audit log: {e}");
    }
}

async fn set_password(State(state): State<AppState>, admin: AdminSession, Path(id): Path<i32>, Json(c): Json<PasswordConfirm>) -> ApiResult<StatusCode> {
    auth::check_password(&c.password).map_err(|e| fail(StatusCode::BAD_REQUEST, e))?;
    let account = db::account(&state.db, id).await?.ok_or_else(|| fail(StatusCode::NOT_FOUND, "No such player."))?;
    let hash = api::hash(c.password).await?;
    if !db::set_password(&state.db, id, &hash).await? {
        return Err(fail(StatusCode::NOT_FOUND, "No such player."));
    }
    state.lobby.lock().unwrap().kick_account(id, "Your password was changed by an admin. Please log in again.");
    audit(&state, &admin, "set_password", &account.name, None).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_player(State(state): State<AppState>, admin: AdminSession, Path(id): Path<i32>) -> ApiResult<StatusCode> {
    let account = db::account(&state.db, id).await?.ok_or_else(|| fail(StatusCode::NOT_FOUND, "No such player."))?;
    let characters = db::list_characters(&state.db, id).await?;
    state.lobby.lock().unwrap().kick_account(id, "This account was deleted by an admin.");
    db::delete_account(&state.db, id).await?;
    let detail = format!("{} character(s)", characters.len());
    audit(&state, &admin, "delete_account", &account.name, Some(&detail)).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_character(State(state): State<AppState>, admin: AdminSession, Path(id): Path<i32>) -> ApiResult<StatusCode> {
    // Whoever plays it right now is sent back to the login first, so no
    // dungeon banks onto a character that is gone.
    {
        let mut l = state.lobby.lock().unwrap();
        if let Some(owner) = l.character_owner(id) {
            l.kick_account(owner, "Your character was deleted by an admin.");
        }
    }
    let Some((owner, name)) = db::delete_character_any(&state.db, id).await? else {
        return Err(fail(StatusCode::NOT_FOUND, "No such character."));
    };
    state.lobby.lock().unwrap().forget_character(id);
    let account = db::account(&state.db, owner).await.map_err(server_error)?.map(|a| a.name).unwrap_or_default();
    let detail = format!("of account {account}");
    audit(&state, &admin, "delete_character", &name, Some(&detail)).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn actions(State(state): State<AppState>, _admin: AdminSession) -> ApiResult<Json<Vec<AdminAction>>> {
    Ok(Json(stats::recent_actions(&state.db, 100).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sessions_end_after_the_idle_time_and_actions_restart_it() {
        let admin = AdminState::new(None, Duration::from_secs(600));
        let t0 = Instant::now();
        let min = |m: u64| t0 + Duration::from_secs(m * 60);
        admin.start(b"s".to_vec(), t0);

        assert!(admin.touch(b"s", min(9), true), "an action at minute 9");
        assert!(admin.touch(b"s", min(18), true), "alive: the clock restarted at minute 9");
        assert!(admin.touch(b"s", min(27), false), "a background refresh only checks");
        assert!(!admin.touch(b"s", min(29), false), "10 minutes after the last action it is over");
        assert!(!admin.touch(b"s", min(29), true), "and an action cannot revive it");

        admin.start(b"t".to_vec(), t0);
        admin.end(b"t");
        assert!(!admin.touch(b"t", t0, true), "logged out");
        assert!(!admin.touch(b"unknown", t0, true));
    }

    #[test]
    fn the_idle_timeout_comes_from_the_environment() {
        let mins = |v: Option<&str>| idle_timeout(v.map(String::from)).map(|d| d.as_secs() / 60);
        assert_eq!(mins(None), Ok(DEFAULT_IDLE_MINUTES));
        assert_eq!(mins(Some("")), Ok(DEFAULT_IDLE_MINUTES));
        assert_eq!(mins(Some(" 30 ")), Ok(30));
        assert_eq!(mins(Some("1")), Ok(1));
        assert_eq!(mins(Some("1440")), Ok(1440));
        for bad in ["0", "1441", "-5", "ten", "2.5"] {
            assert!(mins(Some(bad)).is_err(), "{bad}");
        }
    }
}
