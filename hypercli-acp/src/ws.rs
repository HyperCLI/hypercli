use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use http::Request;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;
use url::Url;

use crate::core::CoreState;
use crate::types::{
    ClientMessage, ControlResult, ControlStatus, PlatformCommand, ProtocolErrorBody, ServerInfo,
    ServerMessage,
};

pub fn router(core: Arc<CoreState>) -> Router {
    Router::new().route("/ws", get(ws_upgrade)).with_state(core)
}

pub async fn serve(addr: SocketAddr, core: Arc<CoreState>) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router(core)).await?;
    Ok(())
}

pub async fn connect_callback(url: Url, core: Arc<CoreState>) -> anyhow::Result<()> {
    let request = callback_request(url)?;
    let (socket, _response) = tokio_tungstenite::connect_async(request).await?;
    let (mut writer, mut reader) = socket.split();
    let (out_tx, mut out_rx) = mpsc::channel::<ServerMessage>(64);

    let write_task = tokio::spawn(async move {
        while let Some(message) = out_rx.recv().await {
            let Ok(text) = serde_json::to_string(&message) else {
                continue;
            };
            if writer
                .send(TungsteniteMessage::Text(text.into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    let activity_task = spawn_activity_forwarder(core.clone(), out_tx.clone());

    while let Some(message) = reader.next().await {
        let message = message?;
        let TungsteniteMessage::Text(text) = message else {
            continue;
        };
        match serde_json::from_str::<ClientMessage>(&text) {
            Ok(message) => {
                if out_tx
                    .send(handle_client_message(&core, message).await)
                    .await
                    .is_err()
                {
                    break;
                }
            }
            Err(err) => {
                let _ = out_tx
                    .send(ServerMessage::Error {
                        request_id: None,
                        error: ProtocolErrorBody {
                            code: "bad_message".to_string(),
                            message: err.to_string(),
                            retryable: false,
                        },
                    })
                    .await;
            }
        }
    }

    activity_task.abort();
    drop(out_tx);
    let _ = write_task.await;
    Ok(())
}

pub fn callback_request(url: Url) -> anyhow::Result<Request<()>> {
    let mut request = Request::builder().uri(url.as_str());
    if let Ok(api_key) = std::env::var("HYPER_AGENTS_API_KEY") {
        if !api_key.is_empty() {
            request = request.header(http::header::AUTHORIZATION, format!("Bearer {api_key}"));
        }
    }
    Ok(request.body(())?)
}

async fn ws_upgrade(
    State(core): State<Arc<CoreState>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    match std::env::var("HYPER_AGENTS_API_KEY") {
        Ok(api_key) if !api_key.is_empty() && !is_authorized(&headers, &api_key) => {
            (StatusCode::UNAUTHORIZED, "unauthorized").into_response()
        }
        _ => ws
            .on_upgrade(move |socket| handle_socket(core, socket))
            .into_response(),
    }
}

fn is_authorized(headers: &HeaderMap, api_key: &str) -> bool {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .is_some_and(|token| token == api_key)
}

async fn handle_socket(core: Arc<CoreState>, socket: WebSocket) {
    let (mut writer, mut reader) = socket.split();
    let (out_tx, mut out_rx) = mpsc::channel::<ServerMessage>(64);

    let write_task = tokio::spawn(async move {
        while let Some(message) = out_rx.recv().await {
            let Ok(text) = serde_json::to_string(&message) else {
                continue;
            };
            if writer.send(WsMessage::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    let activity_task = spawn_activity_forwarder(core.clone(), out_tx.clone());

    while let Some(Ok(message)) = reader.next().await {
        let WsMessage::Text(text) = message else {
            continue;
        };
        match serde_json::from_str::<ClientMessage>(&text) {
            Ok(message) => {
                if out_tx
                    .send(handle_client_message(&core, message).await)
                    .await
                    .is_err()
                {
                    break;
                }
            }
            Err(err) => {
                let _ = out_tx
                    .send(ServerMessage::Error {
                        request_id: None,
                        error: ProtocolErrorBody {
                            code: "bad_message".to_string(),
                            message: err.to_string(),
                            retryable: false,
                        },
                    })
                    .await;
            }
        }
    }

    activity_task.abort();
    drop(out_tx);
    let _ = write_task.await;
}

fn spawn_activity_forwarder(
    core: Arc<CoreState>,
    out_tx: mpsc::Sender<ServerMessage>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let sub = core.activity().subscribe().await;
        for frame in sub.replay {
            if out_tx
                .send(ServerMessage::TurnActivity(frame))
                .await
                .is_err()
            {
                return;
            }
        }
        if out_tx
            .send(ServerMessage::ActivityReplayEnd {
                next_seq: sub.next_seq,
            })
            .await
            .is_err()
        {
            return;
        }
        let mut live = sub.live;
        while let Ok(frame) = live.recv().await {
            if out_tx
                .send(ServerMessage::TurnActivity(frame))
                .await
                .is_err()
            {
                return;
            }
        }
    })
}

pub async fn handle_client_message(core: &CoreState, message: ClientMessage) -> ServerMessage {
    match message {
        ClientMessage::Hello {
            protocol_version,
            client: _,
        } => ServerMessage::HelloOk {
            protocol_version: protocol_version.min(1),
            server: ServerInfo {
                name: "hypercli-acp".to_string(),
            },
        },
        ClientMessage::TurnSubmit(turn) => {
            ServerMessage::TurnAccepted(core.submit_turn(*turn).await)
        }
        ClientMessage::TurnCancel {
            request_id,
            conversation_key,
            turn_id,
        } => ServerMessage::ControlResult(
            core.submit_command(
                request_id,
                PlatformCommand::TurnCancel,
                Some(conversation_key),
                turn_id,
            )
            .await,
        ),
        ClientMessage::TurnSteer {
            request_id,
            conversation_key: _,
            message: _,
        } => ServerMessage::ControlResult(ControlResult {
            request_id,
            command: PlatformCommand::TurnSteer,
            status: ControlStatus::Unsupported,
            message: Some("turn.steer is reserved for the runtime implementation pass".to_string()),
        }),
        ClientMessage::SessionRotate {
            request_id,
            conversation_key,
        } => ServerMessage::ControlResult(
            core.submit_command(
                request_id,
                PlatformCommand::SessionRotate,
                Some(conversation_key),
                None,
            )
            .await,
        ),
        ClientMessage::SessionList(request) => {
            let request_id = request.request_id.clone();
            ServerMessage::SessionList {
                request_id,
                sessions: core.list_sessions(request).await,
            }
        }
        ClientMessage::SessionTrace(filter) => {
            ServerMessage::SessionTrace(core.traceback(filter).await)
        }
        ClientMessage::RuntimeShutdown { request_id } => ServerMessage::ControlResult(
            core.submit_command(request_id, PlatformCommand::RuntimeShutdown, None, None)
                .await,
        ),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::http::HeaderValue;

    use crate::runtime::StubRuntime;
    use crate::trace::TraceStore;
    use crate::types::{
        Actor, ActorKind, ClientInfo, Message, NormalizedTurn, ReplyTarget, SessionListRequest,
        SessionTraceFilter, TurnContext,
    };

    use super::*;

    #[tokio::test]
    async fn hello_negotiates_protocol_one() {
        let core = CoreState::new(Arc::new(StubRuntime));
        let response = handle_client_message(
            &core,
            ClientMessage::Hello {
                protocol_version: 9,
                client: ClientInfo {
                    kind: "test".to_string(),
                    name: "unit".to_string(),
                },
            },
        )
        .await;
        assert!(matches!(
            response,
            ServerMessage::HelloOk {
                protocol_version: 1,
                ..
            }
        ));
    }

    #[test]
    fn callback_request_uses_bearer_platform_key_when_present() {
        std::env::set_var("HYPER_AGENTS_API_KEY", "runtime-key");
        let request = callback_request(Url::parse("wss://api.example.com/acp/ws").unwrap())
            .expect("callback request");
        assert_eq!(
            request
                .headers()
                .get(http::header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("Bearer runtime-key")
        );
        std::env::remove_var("HYPER_AGENTS_API_KEY");
    }

    #[tokio::test]
    async fn turn_submit_returns_ack() {
        let core = CoreState::new(Arc::new(StubRuntime));
        let response = handle_client_message(
            &core,
            ClientMessage::TurnSubmit(Box::new(NormalizedTurn {
                turn_id: None,
                request_id: Some("req_1".to_string()),
                idempotency_key: "idem_1".to_string(),
                connector: "web".to_string(),
                conversation_key: "web:thread".to_string(),
                sender: Actor {
                    id: "u1".to_string(),
                    display: None,
                    kind: ActorKind::Human,
                    role: None,
                },
                message: Message {
                    text: "hello".to_string(),
                    attachments: Vec::new(),
                },
                reply_target: ReplyTarget::None,
                context: TurnContext::default(),
                require_reply: None,
            })),
        )
        .await;

        match response {
            ServerMessage::TurnAccepted(accepted) => {
                assert_eq!(accepted.request_id.as_deref(), Some("req_1"));
            }
            other => panic!("unexpected response: {other:?}"),
        }
    }

    #[test]
    fn websocket_auth_accepts_bearer_platform_key() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_static("Bearer platform-key"),
        );

        assert!(is_authorized(&headers, "platform-key"));
        assert!(!is_authorized(&headers, "other-key"));
    }

    #[tokio::test]
    async fn session_trace_messages_return_persisted_trace() {
        let trace = TraceStore::memory().expect("trace");
        let core = CoreState::with_trace(Arc::new(StubRuntime), trace)
            .await
            .expect("core");
        let accepted = core
            .submit_turn(NormalizedTurn {
                turn_id: None,
                request_id: Some("req_trace".to_string()),
                idempotency_key: "idem_trace".to_string(),
                connector: "web".to_string(),
                conversation_key: "web:trace".to_string(),
                sender: Actor {
                    id: "u1".to_string(),
                    display: None,
                    kind: ActorKind::Human,
                    role: None,
                },
                message: Message {
                    text: "hello".to_string(),
                    attachments: Vec::new(),
                },
                reply_target: ReplyTarget::None,
                context: TurnContext::default(),
                require_reply: None,
            })
            .await;

        for _ in 0..20 {
            if let ServerMessage::SessionTrace(trace) = handle_client_message(
                &core,
                ClientMessage::SessionTrace(SessionTraceFilter {
                    request_id: Some("trace_req".to_string()),
                    conversation_key: Some("web:trace".to_string()),
                    session_id: None,
                    limit: None,
                }),
            )
            .await
            {
                if trace.turns.iter().any(|turn| turn.status == "completed") {
                    assert_eq!(trace.request_id.as_deref(), Some("trace_req"));
                    assert_eq!(trace.turns[0].turn_id, accepted.turn_id);
                    break;
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }

        match handle_client_message(
            &core,
            ClientMessage::SessionList(SessionListRequest {
                request_id: Some("list_req".to_string()),
                conversation_key: Some("web:trace".to_string()),
            }),
        )
        .await
        {
            ServerMessage::SessionList {
                request_id,
                sessions,
            } => {
                assert_eq!(request_id.as_deref(), Some("list_req"));
                assert_eq!(sessions.len(), 1);
                assert_eq!(sessions[0].session_id, "stub_session:web:trace");
            }
            other => panic!("unexpected response: {other:?}"),
        }
    }
}
