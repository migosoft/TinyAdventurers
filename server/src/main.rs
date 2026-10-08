mod collision;
mod defs;
mod dungeon;
#[cfg(test)]
mod export;
mod fov;
mod lobby;
mod math;
mod profiles;
mod protocol;
mod run;
mod wire;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::serve::ListenerExt;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use lobby::SharedLobby;
use protocol::{encode, ClientMsg, ServerMsg};
use run::RunCmd;
use tokio::sync::mpsc::unbounded_channel;
use tower_http::services::{ServeDir, ServeFile};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "../client/dist".into());
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".into());
    let profile_path = std::env::var("PROFILE_PATH").unwrap_or_else(|_| "profiles.json".into());
    let lobby = lobby::new_shared(profiles::ProfileStore::load(profile_path.into()));

    let files = ServeDir::new(&static_dir).not_found_service(ServeFile::new(format!("{static_dir}/index.html")));
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/health", get(|| async { "OK" }))
        .fallback_service(files)
        .layer(axum::middleware::from_fn(cache_headers))
        .with_state(lobby);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await.expect("bind");
    // Disable Nagle's algorithm: small game packets must go out immediately.
    let listener = listener.tap_io(|tcp| {
        let _ = tcp.set_nodelay(true);
    });
    tracing::info!("Tiny Adventurers server on :{port}, serving {static_dir}");
    axum::serve(listener, app).await.expect("server");
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
    let hashed = path.starts_with("/assets/index-") && res.status().is_success();
    let value = if hashed { "public, max-age=31536000, immutable" } else { "no-cache" };
    res.headers_mut().insert(axum::http::header::CACHE_CONTROL, axum::http::HeaderValue::from_static(value));
    res
}

async fn ws_handler(ws: WebSocketUpgrade, State(lobby): State<SharedLobby>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, lobby))
}

async fn handle_socket(socket: WebSocket, lobby: SharedLobby) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = unbounded_channel::<Message>();
    let id = lobby.lock().unwrap().connect(tx.clone());

    let writer = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            if sink.send(m).await.is_err() {
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
            other => lobby.lock().unwrap().handle(id, other),
        }
    }

    lobby.lock().unwrap().disconnect(id);
    writer.abort();
}
