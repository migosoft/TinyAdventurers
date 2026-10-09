mod admin;
mod api;
mod auth;
mod collision;
mod db;
mod defs;
mod dungeon;
#[cfg(test)]
mod export;
mod fov;
mod lobby;
mod math;
mod progress;
mod protocol;
mod run;
mod stats;
mod telemetry;
mod wire;

use api::{AppState, Session};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{MatchedPath, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::serve::ListenerExt;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use protocol::{encode, ClientMsg, ServerMsg};
use run::RunCmd;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::mpsc::unbounded_channel;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() {
    let telemetry = telemetry::init();
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "../client/dist".into());
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".into());
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set (see .env.example)");
    let secret = std::env::var("SESSION_SECRET").expect("SESSION_SECRET must be set (see .env.example)");
    let secure_cookie = std::env::var("COOKIE_SECURE").map_or(false, |v| matches!(v.as_str(), "1" | "true" | "yes"));

    let db = db::connect(&database_url).await;
    let state = AppState {
        lobby: lobby::new_shared(Some(db.clone())),
        db,
        auth: Arc::new(auth::Auth::new(secret.as_bytes(), secure_cookie)),
        admin: Arc::new(admin::AdminState::from_env()),
    };
    telemetry::observe_lobby(state.lobby.clone());

    let files = ServeDir::new(&static_dir).not_found_service(ServeFile::new(format!("{static_dir}/index.html")));
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/health", get(|| async { "OK" }))
        .route_service("/admin", ServeFile::new(format!("{static_dir}/admin.html")))
        .merge(api::routes())
        .merge(admin::routes())
        .fallback_service(files)
        .layer(axum::middleware::from_fn(cache_headers))
        .layer(TraceLayer::new_for_http().make_span_with(http_span).on_response(record_status))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await.expect("bind");
    // Disable Nagle's algorithm: small game packets must go out immediately.
    let listener = listener.tap_io(|tcp| {
        let _ = tcp.set_nodelay(true);
    });
    tracing::info!("Tiny Adventurers server on :{port}, serving {static_dir}");
    let server = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>());
    // On Ctrl-C or SIGTERM (docker stop) the server stops right away (open game
    // sockets would hold up a graceful shutdown) and buffered telemetry is flushed.
    tokio::select! {
        r = server => r.expect("server"),
        _ = shutdown_signal() => tracing::info!("shutting down"),
    }
    telemetry.shutdown();
}

async fn shutdown_signal() {
    let ctrl_c = tokio::signal::ctrl_c();
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("signal handler");
        tokio::select! {
            _ = ctrl_c => {},
            _ = term.recv() => {},
        }
    }
    #[cfg(not(unix))]
    let _ = ctrl_c.await;
}

/// One span per HTTP request, named by the matched route (not the raw path,
/// which can hold ids), so traces group well. Cookies and bodies are not recorded.
fn http_span(req: &axum::http::Request<axum::body::Body>) -> tracing::Span {
    let route = req.extensions().get::<MatchedPath>().map_or("unmatched", |p| p.as_str());
    tracing::info_span!("http", method = %req.method(), route, status = tracing::field::Empty)
}

fn record_status(res: &Response, _latency: std::time::Duration, span: &tracing::Span) {
    span.record("status", res.status().as_u16());
}

/// Vite's hashed bundles never change, so they may be cached for good. Everything
/// else (index.html, the atlas) must be revalidated, or a browser keeps running an
/// old client against a new server (wrong tile rules, prediction fighting the server).
async fn cache_headers(req: axum::extract::Request, next: axum::middleware::Next) -> axum::response::Response {
    let path = req.uri().path().to_owned();
    let mut res = next.run(req).await;
    if path == "/ws" || path == "/health" {
        return res;
    }
    let hashed = is_hashed_bundle(&path) && res.status().is_success();
    let value = if hashed { "public, max-age=31536000, immutable" } else if path.starts_with("/api/") { "no-store" } else { "no-cache" };
    res.headers_mut().insert(axum::http::header::CACHE_CONTROL, axum::http::HeaderValue::from_static(value));
    res
}

/// Vite's bundles: `/assets/<name>-<8 char hash>.js|css` (game and admin page).
/// The atlas in `/assets/` has no hash and is not matched.
fn is_hashed_bundle(path: &str) -> bool {
    let Some(file) = path.strip_prefix("/assets/") else { return false };
    let Some(stem) = file.strip_suffix(".js").or_else(|| file.strip_suffix(".css")) else { return false };
    stem.rsplit_once('-').map_or(false, |(name, hash)| !name.is_empty() && hash.len() == 8 && hash.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
}

/// Browsers send cookies with cross-site WebSocket requests too, so the page
/// that opens the socket must come from this server (same host).
fn same_origin(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else { return true }; // not a browser
    let host = headers.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
    origin.split_once("://").map_or(false, |(_, o)| o.eq_ignore_ascii_case(host))
}

async fn ws_handler(ws: WebSocketUpgrade, headers: HeaderMap, State(state): State<AppState>, session: Session) -> Response {
    if !same_origin(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if let Err(e) = db::touch_activity(&state.db, session.account).await {
        tracing::error!("activity: {e}");
    }
    ws.on_upgrade(move |socket| handle_socket(socket, state, session.account))
}

#[tracing::instrument(name = "ws", skip(socket, state))]
async fn handle_socket(socket: WebSocket, state: AppState, account: i32) {
    telemetry::metrics().ws_connected(true);
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = unbounded_channel::<Message>();
    let lobby = state.lobby.clone();
    let id = lobby.lock().unwrap().connect(account, tx.clone());

    let writer = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            let close = matches!(m, Message::Close(_));
            if sink.send(m).await.is_err() || close {
                break;
            }
        }
    });

    while let Some(Ok(msg)) = stream.next().await {
        let bytes = match msg {
            Message::Binary(b) => b,
            Message::Close(_) => break,
            _ => continue,
        };
        let Some(cm) = protocol::decode(&bytes) else { continue };
        match cm {
            ClientMsg::Ping { time } => {
                let _ = tx.send(Message::Binary(encode(&ServerMsg::Pong { time }).into()));
            }
            ClientMsg::Input(_) | ClientMsg::Spectate { .. } | ClientMsg::Debug { .. } => {
                let run_tx = lobby.lock().unwrap().run_of(id);
                if let Some(run_tx) = run_tx {
                    let _ = run_tx.send(RunCmd::Msg { conn: id, msg: cm });
                }
            }
            // These need the database: query first, then lock the lobby only to apply the result.
            ClientMsg::SelectCharacter { id: character } => select_character(&state, id, character).await,
            ClientMsg::BuyUpgrade { stat } => {
                let check = lobby.lock().unwrap().can_shop(id);
                let result = match check {
                    Ok(character) => db::update_progress(&state.db, character, |p| p.buy(stat)).await.map(|r| (character, r)),
                    Err(e) => {
                        lobby.lock().unwrap().error(id, e);
                        continue;
                    }
                };
                let mut l = lobby.lock().unwrap();
                match result {
                    Ok((character, Some(Ok(p)))) => l.apply_progress(character, p),
                    Ok((_, Some(Err(e)))) => l.error(id, e),
                    Ok((_, None)) => l.error(id, "No such character."),
                    Err(e) => {
                        tracing::error!("buy upgrade: {e}");
                        l.error(id, "Something went wrong on the server. Please try again.");
                    }
                }
            }
            other => lobby.lock().unwrap().handle(id, other),
        }
    }

    lobby.lock().unwrap().disconnect(id);
    writer.abort();
    telemetry::metrics().ws_connected(false);
}

async fn select_character(state: &AppState, conn: u32, character: i32) {
    let check = state.lobby.lock().unwrap().can_select(conn);
    let account = match check {
        Ok(a) => a,
        Err(e) => return state.lobby.lock().unwrap().error(conn, e),
    };
    let loaded = db::load_character(&state.db, account, character).await;
    let mut l = state.lobby.lock().unwrap();
    match loaded {
        Ok(Some(ch)) => l.set_character(conn, ch),
        Ok(None) => l.error(conn, "No such character."),
        Err(e) => {
            tracing::error!("select character: {e}");
            l.error(conn, "Something went wrong on the server. Please try again.");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_hashed_bundles_are_cached_for_good() {
        assert!(is_hashed_bundle("/assets/index-BxY3_a9Q.js"));
        assert!(is_hashed_bundle("/assets/admin-Ab12Cd34.css"));
        assert!(!is_hashed_bundle("/assets/atlas.png"));
        assert!(!is_hashed_bundle("/assets/atlas.json"));
        assert!(!is_hashed_bundle("/admin"));
        assert!(!is_hashed_bundle("/assets/-12345678.js"));
    }

    #[test]
    fn websocket_origin_must_match_the_host() {
        let mut h = HeaderMap::new();
        h.insert(header::HOST, "game.example:8080".parse().unwrap());
        assert!(same_origin(&h), "no Origin: not a browser");
        h.insert(header::ORIGIN, "http://game.example:8080".parse().unwrap());
        assert!(same_origin(&h));
        h.insert(header::ORIGIN, "https://evil.example".parse().unwrap());
        assert!(!same_origin(&h));
        h.insert(header::ORIGIN, "null".parse().unwrap());
        assert!(!same_origin(&h));
    }
}
