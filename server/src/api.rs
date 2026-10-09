//! JSON API for accounts and characters (`/api/*`). Gameplay stays on the
//! WebSocket; it is opened after login and carries the same session cookie.

use crate::auth::{self, Auth};
use crate::db::{self, Db, DbError};
use crate::lobby::SharedLobby;
use crate::protocol::{CharacterInfo, ClassId};
use crate::telemetry;
use axum::extract::{ConnectInfo, FromRequestParts, OptionalFromRequestParts, Path, State};
use axum::http::request::Parts;
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use ts_rs::TS;

#[derive(Clone)]
pub struct AppState {
    pub lobby: SharedLobby,
    pub db: Db,
    pub auth: Arc<Auth>,
    pub admin: Arc<crate::admin::AdminState>,
}

#[derive(Deserialize, TS)]
#[ts(export)]
pub struct Credentials {
    pub name: String,
    pub password: String,
}

#[derive(Deserialize, TS)]
#[ts(export)]
pub struct PasswordConfirm {
    pub password: String,
}

#[derive(Deserialize, TS)]
#[ts(export)]
pub struct NewCharacter {
    pub name: String,
    pub class: ClassId,
}

/// The logged-in account and its characters.
#[derive(Serialize, TS)]
#[ts(export)]
pub struct Me {
    pub name: String,
    pub characters: Vec<CharacterInfo>,
    pub max_characters: u32,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct ApiError {
    pub error: String,
}

pub struct Fail(StatusCode, String);

impl IntoResponse for Fail {
    fn into_response(self) -> Response {
        (self.0, Json(ApiError { error: self.1 })).into_response()
    }
}

pub(crate) fn fail(code: StatusCode, msg: impl Into<String>) -> Fail {
    Fail(code, msg.into())
}

pub(crate) fn server_error(e: impl std::fmt::Display) -> Fail {
    tracing::error!("api: {e}");
    fail(StatusCode::INTERNAL_SERVER_ERROR, "Something went wrong on the server. Please try again.")
}

impl From<sqlx::Error> for Fail {
    fn from(e: sqlx::Error) -> Self {
        server_error(e)
    }
}

pub(crate) type ApiResult<T> = Result<T, Fail>;

/// A valid session from the cookie (signature, expiry and database checked).
pub struct Session {
    pub account: i32,
    pub id_hash: Vec<u8>,
}

impl FromRequestParts<AppState> for Session {
    type Rejection = Fail;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let unauthorized = || fail(StatusCode::UNAUTHORIZED, "Please log in.");
        let cookies = parts.headers.get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok());
        let token = cookies.filter_map(auth::cookie_token).next().ok_or_else(unauthorized)?;
        let id_hash = state.auth.verify(token).ok_or_else(unauthorized)?;
        let account = db::touch_session(&state.db, &id_hash, state.auth.session_idle).await?.ok_or_else(unauthorized)?;
        Ok(Session { account, id_hash })
    }
}

impl OptionalFromRequestParts<AppState> for Session {
    type Rejection = Fail;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Option<Self>, Self::Rejection> {
        match <Session as FromRequestParts<AppState>>::from_request_parts(parts, state).await {
            Ok(s) => Ok(Some(s)),
            Err(Fail(StatusCode::UNAUTHORIZED, _)) => Ok(None),
            Err(e) => Err(e),
        }
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/register", post(register))
        .route("/api/login", post(login))
        .route("/api/logout", post(logout))
        .route("/api/account", delete(delete_account))
        .route("/api/me", get(me))
        .route("/api/characters", post(create_character))
        .route("/api/characters/{id}", delete(delete_character))
        .layer(axum::middleware::from_fn(require_json))
}

/// State-changing requests must be JSON. Together with the SameSite=Strict
/// cookie this keeps other sites from submitting forms against the API.
pub(crate) async fn require_json(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let json = req.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map_or(false, |v| v.starts_with("application/json"));
    if req.method() != Method::GET && !json {
        return fail(StatusCode::UNSUPPORTED_MEDIA_TYPE, "Expected JSON.").into_response();
    }
    next.run(req).await
}

const LOGIN_FAILS_PER_NAME: u32 = 5;
const LOGIN_NAME_WINDOW: Duration = Duration::from_secs(30);
const LOGIN_FAILS_PER_IP: u32 = 20;
const LOGIN_IP_WINDOW: Duration = Duration::from_secs(300);
const REGISTRATIONS_PER_IP: u32 = 10;
const REGISTER_WINDOW: Duration = Duration::from_secs(3600);

pub(crate) async fn hash(password: String) -> ApiResult<String> {
    tokio::task::spawn_blocking(move || auth::hash_password(&password)).await.map_err(server_error)
}

async fn verify(password: String, hash: Option<String>) -> ApiResult<bool> {
    tokio::task::spawn_blocking(move || auth::verify_password(&password, hash.as_deref())).await.map_err(server_error)
}

/// Starts a session for the account and answers with its data and the cookie.
async fn logged_in(state: &AppState, account: i32, name: String) -> ApiResult<Response> {
    let s = state.auth.new_session();
    db::create_session(&state.db, account, &s.id_hash, state.auth.session_idle).await?;
    if let Err(e) = db::touch_activity(&state.db, account).await {
        tracing::error!("activity: {e}");
    }
    let me = me_of(state, account, name).await?;
    Ok(([(header::SET_COOKIE, state.auth.set_cookie(&s.token))], Json(me)).into_response())
}

async fn me_of(state: &AppState, account: i32, name: String) -> ApiResult<Me> {
    let characters = db::list_characters(&state.db, account).await?.iter().map(|c| c.info()).collect();
    Ok(Me { name, characters, max_characters: db::MAX_CHARACTERS as u32 })
}

async fn register(State(state): State<AppState>, ConnectInfo(addr): ConnectInfo<SocketAddr>, Json(c): Json<Credentials>) -> ApiResult<Response> {
    let name = c.name.trim().to_string();
    auth::check_name(&name).map_err(|e| fail(StatusCode::BAD_REQUEST, e))?;
    auth::check_password(&c.password).map_err(|e| fail(StatusCode::BAD_REQUEST, e))?;
    let ip_key = format!("reg:{}", addr.ip());
    if state.auth.limiter.lock().unwrap().blocked(&ip_key, REGISTRATIONS_PER_IP, REGISTER_WINDOW) {
        return Err(fail(StatusCode::TOO_MANY_REQUESTS, "Too many new accounts from here. Try again later."));
    }
    let hash = hash(c.password).await?;
    let account = match db::create_account(&state.db, &name, &hash).await {
        Ok(id) => id,
        Err(DbError::NameTaken) => return Err(fail(StatusCode::CONFLICT, "That name is already taken.")),
        Err(e) => return Err(server_error(format!("{e:?}"))),
    };
    state.auth.limiter.lock().unwrap().hit(&ip_key, REGISTER_WINDOW);
    telemetry::metrics().registration();
    tracing::info!("account {account} registered");
    logged_in(&state, account, name).await
}

/// Checks a password with throttling: a name or an address that keeps
/// guessing wrong is paused for a while.
async fn check_login(state: &AppState, ip: &str, name: &str, password: String) -> ApiResult<Option<db::Account>> {
    let name_key = format!("login:{}", name.to_lowercase());
    let ip_key = format!("login-ip:{ip}");
    {
        let mut l = state.auth.limiter.lock().unwrap();
        if l.blocked(&name_key, LOGIN_FAILS_PER_NAME, LOGIN_NAME_WINDOW) || l.blocked(&ip_key, LOGIN_FAILS_PER_IP, LOGIN_IP_WINDOW) {
            return Err(fail(StatusCode::TOO_MANY_REQUESTS, "Too many attempts. Wait a moment and try again."));
        }
    }
    let account = db::find_account(&state.db, name).await?;
    let ok = verify(password, account.as_ref().map(|a| a.password_hash.clone())).await?;
    let mut l = state.auth.limiter.lock().unwrap();
    if ok {
        l.clear(&name_key);
        Ok(account)
    } else {
        l.hit(&name_key, LOGIN_NAME_WINDOW);
        l.hit(&ip_key, LOGIN_IP_WINDOW);
        Ok(None)
    }
}

async fn login(State(state): State<AppState>, ConnectInfo(addr): ConnectInfo<SocketAddr>, Json(c): Json<Credentials>) -> ApiResult<Response> {
    let name = c.name.trim();
    let checked = check_login(&state, &addr.ip().to_string(), name, c.password).await;
    let m = telemetry::metrics();
    let Some(account) = checked.inspect_err(|e| if e.0 == StatusCode::TOO_MANY_REQUESTS { m.login("throttled") })? else {
        m.login("fail");
        return Err(fail(StatusCode::UNAUTHORIZED, "Wrong name or password."));
    };
    m.login("ok");
    logged_in(&state, account.id, account.name).await
}

async fn logout(State(state): State<AppState>, session: Option<Session>) -> ApiResult<Response> {
    if let Some(s) = session {
        db::delete_session(&state.db, &s.id_hash).await?;
        state.lobby.lock().unwrap().kick_account(s.account, "You logged out.");
    }
    Ok(([(header::SET_COOKIE, state.auth.clear_cookie())], StatusCode::NO_CONTENT).into_response())
}

async fn delete_account(State(state): State<AppState>, ConnectInfo(addr): ConnectInfo<SocketAddr>, session: Session, Json(c): Json<PasswordConfirm>) -> ApiResult<Response> {
    let account = db::account(&state.db, session.account).await?.ok_or_else(|| fail(StatusCode::UNAUTHORIZED, "Please log in."))?;
    if check_login(&state, &addr.ip().to_string(), &account.name, c.password).await?.is_none() {
        return Err(fail(StatusCode::FORBIDDEN, "Wrong password."));
    }
    state.lobby.lock().unwrap().kick_account(account.id, "This account was deleted.");
    db::delete_account(&state.db, account.id).await?;
    tracing::info!("account {} deleted", account.id);
    Ok(([(header::SET_COOKIE, state.auth.clear_cookie())], StatusCode::NO_CONTENT).into_response())
}

async fn me(State(state): State<AppState>, session: Session) -> ApiResult<Json<Me>> {
    let account = db::account(&state.db, session.account).await?.ok_or_else(|| fail(StatusCode::UNAUTHORIZED, "Please log in."))?;
    Ok(Json(me_of(&state, account.id, account.name).await?))
}

async fn create_character(State(state): State<AppState>, session: Session, Json(c): Json<NewCharacter>) -> ApiResult<(StatusCode, Json<CharacterInfo>)> {
    let name = c.name.trim();
    auth::check_name(name).map_err(|e| fail(StatusCode::BAD_REQUEST, e))?;
    match db::create_character(&state.db, session.account, name, c.class).await {
        Ok(ch) => Ok((StatusCode::CREATED, Json(ch.info()))),
        Err(DbError::NameTaken) => Err(fail(StatusCode::CONFLICT, "That name is already taken.")),
        Err(DbError::TooManyCharacters) => Err(fail(StatusCode::CONFLICT, format!("An account can have at most {} characters.", db::MAX_CHARACTERS))),
        Err(e) => Err(server_error(format!("{e:?}"))),
    }
}

async fn delete_character(State(state): State<AppState>, session: Session, Path(id): Path<i32>) -> ApiResult<StatusCode> {
    if state.lobby.lock().unwrap().character_busy(id) {
        return Err(fail(StatusCode::CONFLICT, "That character is in a dungeon right now."));
    }
    if !db::delete_character(&state.db, session.account, id).await? {
        return Err(fail(StatusCode::NOT_FOUND, "No such character."));
    }
    state.lobby.lock().unwrap().forget_character(id);
    Ok(StatusCode::NO_CONTENT)
}
