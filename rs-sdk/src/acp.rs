//! Async ACP (Agent Client Protocol) client for coding agents.
//!
//! Every hosted coding-agent pod runs an `acp` bridge that proxies a pod-side
//! ACP child (`opencode acp`, `claude-code acp`, ...) onto a WebSocket
//! endpoint at `/ws`. This module dials that bridge as the client side
//! (`?agent_id=<uuid>&token=<api key>`), runs the ACP `initialize` handshake,
//! and exposes one-shot session helpers: [`AcpClient::new_session`],
//! [`AcpClient::load_session`] (gated on the advertised
//! `agentCapabilities.loadSession` capability), and [`AcpClient::prompt`].
//!
//! Parity across sibling SDKs:
//!
//! - TypeScript SDK (`ts-sdk/src/acp.ts`): full client with reconnect
//!   backoff, session replay via `session/load`, pooled update listeners, and
//!   terminal-close classification.
//! - Python SDK (`sdk/hypercli/acp.py`): minimal one-shot client with the same
//!   framing and capability gate and no auto-reconnect.
//! - Rust SDK (this module): mirrors the Python client. One session per
//!   connection; reconnect policy is the caller's business.
//!
//! Retry policy (mirrors the TypeScript/Python clients):
//!
//! - Failures before a `session/prompt` frame is ever sent — dial, WS
//!   handshake, `initialize`, session setup — surface as
//!   [`AcpError::Retryable`]. Restarting the whole operation is safe because
//!   no agent work can have started.
//! - Once a `session/prompt` frame has been sent, an in-flight turn is NEVER
//!   retried: the prompt may still reach the agent, so resending risks
//!   duplicate execution. Post-send failures surface as
//!   [`AcpError::AmbiguousDelivery`]; callers must reconcile by inspecting the
//!   agent's sessions (`session/load` / `session/list`) before deciding
//!   whether to re-issue the prompt.
//! - JSON-RPC error responses from the agent surface as
//!   [`AcpError::Request`] and are terminal protocol failures (not transport
//!   noise).
//!
//! The default permission policy matches the sibling SDKs: a raw client never
//! auto-approves — inbound `session/request_permission` requests are answered
//! with the `cancelled` outcome, and unknown inbound requests get a JSON-RPC
//! `method not found` error.

use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use url::Url;

/// ACP protocol version sent in `initialize`.
pub const ACP_PROTOCOL_VERSION: u64 = 1;
/// Default WebSocket dial timeout, mirroring the Python client.
pub const DEFAULT_OPEN_TIMEOUT: Duration = Duration::from_secs(30);

const PROMPT_METHOD: &str = "session/prompt";

/// Stream of `session/update` notification params; see [`AcpClient::take_updates`].
pub type AcpUpdateReceiver = mpsc::UnboundedReceiver<Value>;

type AcpSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;
type AcpSink = SplitSink<AcpSocket, Message>;
type AcpStream = SplitStream<AcpSocket>;

/// ACP client failure with retry-safety classification.
///
/// Use [`AcpError::is_retryable`] and [`AcpError::is_ambiguous`] to decide
/// whether an operation may be restarted from scratch. Both are false for
/// terminal protocol failures (`Request`, `Unavailable`, `Closed`,
/// `Protocol`).
#[derive(Debug, Error)]
pub enum AcpError {
    /// Pre-prompt failure: connect, handshake, `initialize`, or session setup.
    /// No `session/prompt` frame was ever sent, so restarting the whole
    /// operation from scratch cannot duplicate agent work.
    #[error("ACP pre-prompt failure (safe to retry from scratch): {0}")]
    Retryable(String),
    /// Post-prompt-send failure: the turn may still reach the agent.
    ///
    /// NEVER auto-retry on this error: the prompt may have been delivered and
    /// the agent may already be executing it, so resending risks duplicate
    /// execution. Reconcile by inspecting the agent's session state before
    /// re-issuing the prompt.
    #[error(
        "ACP connection dropped after the session/prompt frame was sent ({detail}); \
         not retrying to avoid duplicate execution — the prompt may still reach the \
         agent; inspect the agent's session state with session/load or session/list \
         before re-issuing the prompt"
    )]
    AmbiguousDelivery {
        /// Underlying transport failure text for diagnostics.
        detail: String,
    },
    /// JSON-RPC error response from the agent (terminal protocol failure).
    #[error("ACP {method} failed: code={code:?} message={message}")]
    Request {
        /// Requested JSON-RPC method that was rejected.
        method: String,
        /// JSON-RPC error code, when present.
        code: Option<i64>,
        /// JSON-RPC error message.
        message: String,
    },
    /// A capability-gated helper hit an agent that does not advertise it.
    #[error("{capability} is not available: {detail}")]
    Unavailable {
        /// Gated capability, e.g. `session/load`.
        capability: String,
        /// Why the capability is missing.
        detail: String,
    },
    /// The client was closed or a protocol violation destroyed the frame flow.
    #[error("ACP client is closed")]
    Closed,
    /// The bridge sent a frame that violates the JSON-RPC/ACP framing rules.
    #[error("ACP protocol violation: {0}")]
    Protocol(String),
}

impl AcpError {
    /// True when no `session/prompt` frame was ever sent and restarting the
    /// whole operation from scratch cannot duplicate agent work.
    pub fn is_retryable(&self) -> bool {
        matches!(self, AcpError::Retryable(_))
    }

    /// True when a `session/prompt` frame may have reached the agent. Never
    /// auto-retry on this; reconcile session state first.
    pub fn is_ambiguous(&self) -> bool {
        matches!(self, AcpError::AmbiguousDelivery { .. })
    }
}

/// End-of-turn result of one `session/prompt` exchange.
#[derive(Debug, Clone)]
pub struct AcpPromptResult {
    /// Session that ran the turn.
    pub session_id: String,
    /// Agent-reported stop reason, when present.
    pub stop_reason: Option<String>,
    /// Raw `session/prompt` result payload.
    pub raw: Value,
}

struct Pending {
    method: String,
    tx: oneshot::Sender<Result<Value, AcpError>>,
}

struct ConnState {
    pending: Mutex<HashMap<u64, Pending>>,
    /// Set once the connection can no longer deliver frames. Taking a new
    /// request after this point is pre-prompt-send by definition, so such
    /// requests fail as [`AcpError::Retryable`].
    dead: AtomicBool,
}

/// Classification of a connection-wide failure for pending requests.
enum Failure {
    /// Socket dropped/errored. Prompts in flight become ambiguous deliveries.
    Transport(String),
    /// Explicit client close.
    Closed,
    /// Malformed frame from the bridge.
    Protocol(String),
}

fn fail_pending(state: &ConnState, failure: &Failure) {
    let mut pending = state.pending.lock().unwrap();
    // Mark dead inside the same critical section as the drain so a racing
    // request either observes `dead` or lands in the drain. Never both.
    state.dead.store(true, Ordering::SeqCst);
    for (_, pending_request) in pending.drain() {
        let is_prompt = pending_request.method == PROMPT_METHOD;
        let error = match failure {
            Failure::Transport(detail) => {
                if is_prompt {
                    AcpError::AmbiguousDelivery {
                        detail: detail.clone(),
                    }
                } else {
                    AcpError::Retryable(format!("ACP WebSocket connection failed: {detail}"))
                }
            }
            Failure::Closed => {
                if is_prompt {
                    AcpError::AmbiguousDelivery {
                        detail: "client closed".to_owned(),
                    }
                } else {
                    AcpError::Closed
                }
            }
            Failure::Protocol(message) => {
                if is_prompt {
                    AcpError::AmbiguousDelivery {
                        detail: message.clone(),
                    }
                } else {
                    AcpError::Protocol(message.clone())
                }
            }
        };
        let _ = pending_request.tx.send(Err(error));
    }
}

/// One-shot async ACP client; create with [`AcpClient::connect`], then run
/// [`AcpClient::initialize`].
///
/// The client fails loudly instead of reconnecting: once any transport
/// failure surfaces, in-flight requests are rejected with
/// [`AcpError::Retryable`] (pre-prompt) or [`AcpError::AmbiguousDelivery`]
/// (in-flight prompt) and the caller decides the next step. In-flight prompt
/// turns are never retried mid-turn and the client never re-dials: reconnect
/// is the caller's business.
pub struct AcpClient {
    state: Arc<ConnState>,
    outbound: Mutex<Option<mpsc::UnboundedSender<Message>>>,
    next_id: AtomicU64,
    closed: AtomicBool,
    initialize_response: Mutex<Value>,
    updates: Mutex<Option<AcpUpdateReceiver>>,
    reader: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl fmt::Debug for AcpClient {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AcpClient")
            .field("closed", &self.closed.load(Ordering::SeqCst))
            .field("down", &self.state.dead.load(Ordering::SeqCst))
            .finish_non_exhaustive()
    }
}

impl AcpClient {
    /// Dial the ACP bridge at `url`, appending `token` as a query parameter
    /// (matching the backend `/ws` auth style). The `initialize` handshake is
    /// a separate explicit step; dial failures are [`AcpError::Retryable`].
    pub async fn connect(url: &str, token: &str) -> Result<Self, AcpError> {
        let mut target = Url::parse(url)
            .map_err(|error| AcpError::Retryable(format!("ACP bridge URL is invalid: {error}")))?;
        if !token.is_empty() {
            target.query_pairs_mut().append_pair("token", token);
        }
        let (socket, _) =
            tokio::time::timeout(DEFAULT_OPEN_TIMEOUT, connect_async(target.as_str()))
                .await
                .map_err(|_| {
                    AcpError::Retryable(format!(
                        "ACP WebSocket connect exceeded {}s",
                        DEFAULT_OPEN_TIMEOUT.as_secs()
                    ))
                })?
                .map_err(|error| {
                    AcpError::Retryable(format!("ACP WebSocket connection failed: {error}"))
                })?;

        let state = Arc::new(ConnState {
            pending: Mutex::new(HashMap::new()),
            dead: AtomicBool::new(false),
        });
        let (outbound_tx, outbound_rx) = mpsc::unbounded_channel();
        let (updates_tx, updates_rx) = mpsc::unbounded_channel();
        let (sink, stream) = socket.split();
        tokio::spawn(write_loop(outbound_rx, sink, Arc::clone(&state)));
        let reader = tokio::spawn(read_loop(
            stream,
            Arc::clone(&state),
            outbound_tx.clone(),
            updates_tx,
        ));
        Ok(Self {
            state,
            outbound: Mutex::new(Some(outbound_tx)),
            next_id: AtomicU64::new(1),
            closed: AtomicBool::new(false),
            initialize_response: Mutex::new(Value::Null),
            updates: Mutex::new(Some(updates_rx)),
            reader: Mutex::new(Some(reader)),
        })
    }

    /// Run the ACP `initialize` handshake. On failure the client is closed
    /// and the error is classified: transport/handshake failures are
    /// [`AcpError::Retryable`], agent-side JSON-RPC rejections are
    /// [`AcpError::Request`].
    pub async fn initialize(&self) -> Result<Value, AcpError> {
        let response = self
            .request(
                "initialize",
                json!({
                    "protocolVersion": ACP_PROTOCOL_VERSION,
                    "clientCapabilities": {
                        "fs": {"readTextFile": false, "writeTextFile": false},
                        "terminal": false,
                    },
                    "clientInfo": {"name": "hypercli-rs-sdk", "version": env!("CARGO_PKG_VERSION")},
                }),
            )
            .await;
        match response {
            Ok(value) => {
                *self.initialize_response.lock().unwrap() = value.clone();
                Ok(value)
            }
            Err(error) => {
                self.close();
                Err(error)
            }
        }
    }

    /// Latest successful `initialize` response, `Value::Null` before then.
    pub fn initialize_response(&self) -> Value {
        self.initialize_response.lock().unwrap().clone()
    }

    /// True once [`AcpClient::close`] ran or `initialize` failed.
    pub fn closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// True once the connection can no longer deliver frames. New requests
    /// made while down fail pre-send with [`AcpError::Retryable`].
    pub fn is_down(&self) -> bool {
        self.state.dead.load(Ordering::SeqCst)
    }

    /// True when the agent advertised `agentCapabilities.loadSession`.
    pub fn load_session_capable(&self) -> bool {
        self.initialize_response
            .lock()
            .unwrap()
            .get("agentCapabilities")
            .and_then(|capabilities| capabilities.get("loadSession"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }

    /// Take the `session/update` notification sink. Each item is the raw
    /// notification `params` object. Callable once; subsequent calls return
    /// `None`. The channel closes when the connection dies.
    pub fn take_updates(&self) -> Option<AcpUpdateReceiver> {
        self.updates.lock().unwrap().take()
    }

    /// Create a session with `session/new` and return its session id.
    pub async fn new_session(&self, cwd: &str) -> Result<String, AcpError> {
        let result = self
            .request("session/new", json!({"cwd": cwd, "mcpServers": []}))
            .await?;
        result
            .get("sessionId")
            .and_then(Value::as_str)
            .filter(|session_id| !session_id.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| {
                AcpError::Protocol("ACP session/new did not return sessionId".to_owned())
            })
    }

    /// Resume a session with `session/load`, gated on the advertised
    /// `agentCapabilities.loadSession` capability. When the gate fails this
    /// returns [`AcpError::Unavailable`]; the documented caller fallback is
    /// [`AcpClient::new_session`].
    pub async fn load_session(&self, cwd: &str, session_id: &str) -> Result<Value, AcpError> {
        if !self.load_session_capable() {
            return Err(AcpError::Unavailable {
                capability: "session/load".to_owned(),
                detail: "the agent did not advertise agentCapabilities.loadSession in its initialize response".to_owned(),
            });
        }
        self.request(
            "session/load",
            json!({"sessionId": session_id, "cwd": cwd, "mcpServers": []}),
        )
        .await
    }

    /// Run one prompt turn and return the end-of-turn result.
    ///
    /// Sends `session/prompt` exactly once and waits for the response. If the
    /// connection drops after the frame is sent, this returns
    /// [`AcpError::AmbiguousDelivery`]; the turn is never resent. A JSON-RPC
    /// rejection returns [`AcpError::Request`].
    pub async fn prompt(&self, session_id: &str, text: &str) -> Result<AcpPromptResult, AcpError> {
        let result = self
            .request(
                PROMPT_METHOD,
                json!({
                    "sessionId": session_id,
                    "prompt": [{"type": "text", "text": text}],
                }),
            )
            .await?;
        Ok(AcpPromptResult {
            session_id: session_id.to_owned(),
            stop_reason: result
                .get("stopReason")
                .and_then(Value::as_str)
                .map(str::to_owned),
            raw: result,
        })
    }

    /// Close the client, reject in-flight requests, and stop the read loop.
    pub fn close(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        fail_pending(&self.state, &Failure::Closed);
        // Dropping the last sender makes the write loop close the socket;
        // the read loop holds one clone and is aborted below.
        self.outbound.lock().unwrap().take();
        if let Some(reader) = self.reader.lock().unwrap().take() {
            reader.abort();
        }
    }

    /// Raw JSON-RPC escape hatch for extension methods (`_hyper/*` etc).
    pub async fn request_raw(&self, method: &str, params: Value) -> Result<Value, AcpError> {
        self.request(method, params).await
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, AcpError> {
        if self.closed() {
            return Err(AcpError::Closed);
        }
        let outbound = self
            .outbound
            .lock()
            .unwrap()
            .clone()
            .ok_or(AcpError::Closed)?;
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.state.pending.lock().unwrap();
            if self.state.dead.load(Ordering::SeqCst) {
                // The frame cannot be delivered, so nothing was (or will be)
                // sent: safe to retry from scratch even for prompts.
                return Err(AcpError::Retryable("ACP connection is down".to_owned()));
            }
            pending.insert(
                id,
                Pending {
                    method: method.to_owned(),
                    tx,
                },
            );
        }
        let frame = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        if outbound
            .send(Message::Text(frame.to_string().into()))
            .is_err()
        {
            let removed = self.state.pending.lock().unwrap().remove(&id);
            if removed.is_some() {
                return Err(if method == PROMPT_METHOD {
                    AcpError::AmbiguousDelivery {
                        detail: "outbound channel closed".to_owned(),
                    }
                } else {
                    AcpError::Retryable(
                        "ACP WebSocket connection failed: outbound channel closed".to_owned(),
                    )
                });
            }
            // The entry was already drained and failed by the connection
            // failure path; fall through and await its classified error.
        }
        rx.await
            .map_err(|_| AcpError::Retryable("ACP request was dropped".to_owned()))?
    }
}

impl Drop for AcpClient {
    fn drop(&mut self) {
        self.close();
    }
}

async fn write_loop(
    mut outbound: mpsc::UnboundedReceiver<Message>,
    mut sink: AcpSink,
    state: Arc<ConnState>,
) {
    while let Some(message) = outbound.recv().await {
        if let Err(error) = sink.send(message).await {
            fail_pending(
                &state,
                &Failure::Transport(format!("websocket send failed: {error}")),
            );
            return;
        }
    }
    // Graceful shutdown: every sender is gone (client closed or dropped).
    let _ = sink.close().await;
}

async fn read_loop(
    mut stream: AcpStream,
    state: Arc<ConnState>,
    outbound: mpsc::UnboundedSender<Message>,
    updates: mpsc::UnboundedSender<Value>,
) {
    let failure = loop {
        match stream.next().await {
            Some(Ok(Message::Text(text))) => match serde_json::from_str::<Value>(&text) {
                Ok(frame) if frame.is_object() => {
                    dispatch_frame(&frame, &state, &outbound, &updates);
                }
                Ok(_) => {
                    break Failure::Protocol("ACP bridge returned a non-object frame".to_owned())
                }
                Err(error) => {
                    break Failure::Protocol(format!("ACP bridge returned invalid JSON: {error}"));
                }
            },
            Some(Ok(Message::Binary(bytes))) => {
                match serde_json::from_str::<Value>(&String::from_utf8_lossy(&bytes)) {
                    Ok(frame) if frame.is_object() => {
                        dispatch_frame(&frame, &state, &outbound, &updates);
                    }
                    Ok(_) => {
                        break Failure::Protocol(
                            "ACP bridge returned a non-object frame".to_owned(),
                        );
                    }
                    Err(error) => {
                        break Failure::Protocol(format!(
                            "ACP bridge returned invalid JSON: {error}"
                        ));
                    }
                }
            }
            Some(Ok(Message::Ping(payload))) => {
                let _ = outbound.send(Message::Pong(payload));
            }
            Some(Ok(Message::Close(frame))) => {
                let detail = frame
                    .map(|frame| format!("code={} reason={}", frame.code, frame.reason))
                    .unwrap_or_else(|| "no close frame".to_owned());
                break Failure::Transport(format!("ACP bridge closed the connection ({detail})"));
            }
            Some(Ok(_)) => {}
            Some(Err(error)) => break Failure::Transport(error.to_string()),
            None => break Failure::Transport("ACP WebSocket closed".to_owned()),
        }
    };
    fail_pending(&state, &failure);
}

fn dispatch_frame(
    frame: &Value,
    state: &ConnState,
    outbound: &mpsc::UnboundedSender<Message>,
    updates: &mpsc::UnboundedSender<Value>,
) {
    let id = frame_id(frame);
    if let Some(id) = id.filter(|_| frame.get("result").is_some() || frame.get("error").is_some()) {
        let pending = state.pending.lock().unwrap().remove(&id);
        let Some(pending) = pending else { return };
        let outcome = if let Some(error) = frame.get("error") {
            Err(AcpError::Request {
                method: pending.method,
                code: error.get("code").and_then(Value::as_i64),
                message: error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            })
        } else {
            Ok(frame.get("result").cloned().unwrap_or(Value::Null))
        };
        let _ = pending.tx.send(outcome);
        return;
    }
    let method = frame.get("method").and_then(Value::as_str).unwrap_or("");
    if method.is_empty() {
        return;
    }
    let Some(id) = id else {
        if method == "session/update" {
            let _ = updates.send(frame.get("params").cloned().unwrap_or(Value::Null));
        }
        return;
    };
    let reply = if method == "session/request_permission" {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {"outcome": {"outcome": "cancelled"}},
        })
    } else {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {"code": -32601, "message": format!("Method not found: {method}")},
        })
    };
    let _ = outbound.send(Message::Text(reply.to_string().into()));
}

fn frame_id(frame: &Value) -> Option<u64> {
    frame.get("id").and_then(|id| {
        id.as_u64()
            .or_else(|| id.as_i64().and_then(|value| u64::try_from(value).ok()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    type TestSocket = WebSocketStream<TcpStream>;

    async fn read_frame(socket: &mut TestSocket) -> Value {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    return serde_json::from_str(&text).unwrap();
                }
                Some(Ok(Message::Ping(payload))) => {
                    socket.send(Message::Pong(payload)).await.unwrap();
                }
                other => panic!("unexpected frame: {other:?}"),
            }
        }
    }

    async fn send_frame(socket: &mut TestSocket, frame: Value) {
        socket
            .send(Message::Text(frame.to_string().into()))
            .await
            .unwrap();
    }

    fn respond(id: u64, result: Value) -> Value {
        json!({"jsonrpc": "2.0", "id": id, "result": result})
    }

    async fn start_server<F, Fut>(handler: F) -> (String, tokio::task::JoinHandle<()>)
    where
        F: FnOnce(TestSocket) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}/ws", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let socket = accept_async(stream).await.unwrap();
            handler(socket).await;
        });
        (url, task)
    }

    fn initialize_result(load_session: bool) -> Value {
        json!({
            "protocolVersion": ACP_PROTOCOL_VERSION,
            "agentCapabilities": {"loadSession": load_session},
        })
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn happy_path_connect_initialize_sessions_prompt() {
        let prompt_count = Arc::new(AtomicUsize::new(0));
        let server_prompt_count = Arc::clone(&prompt_count);
        let (url, server) = start_server(move |mut socket| {
            let server_prompt_count = Arc::clone(&server_prompt_count);
            async move {
                let init = read_frame(&mut socket).await;
                assert_eq!(init["method"], "initialize");
                let init_id = init["id"].as_u64().unwrap();
                send_frame(&mut socket, respond(init_id, initialize_result(true))).await;

                let new = read_frame(&mut socket).await;
                assert_eq!(new["method"], "session/new");
                assert_eq!(new["params"]["cwd"], "/workspace");
                send_frame(
                    &mut socket,
                    respond(new["id"].as_u64().unwrap(), json!({"sessionId": "sess-1"})),
                )
                .await;

                let load = read_frame(&mut socket).await;
                assert_eq!(load["method"], "session/load");
                assert_eq!(load["params"]["sessionId"], "sess-1");
                send_frame(
                    &mut socket,
                    respond(load["id"].as_u64().unwrap(), json!({})),
                )
                .await;

                let prompt = read_frame(&mut socket).await;
                assert_eq!(prompt["method"], "session/prompt");
                assert_eq!(
                    prompt["params"]["prompt"],
                    json!([{"type": "text", "text": "hello agent"}])
                );
                let prompt_id = prompt["id"].as_u64().unwrap();
                server_prompt_count.fetch_add(1, Ordering::SeqCst);

                send_frame(
                    &mut socket,
                    json!({
                        "jsonrpc": "2.0",
                        "method": "session/update",
                        "params": {
                            "sessionId": "sess-1",
                            "update": {"sessionUpdate": "agent_message_chunk"},
                        },
                    }),
                )
                .await;
                send_frame(
                    &mut socket,
                    json!({
                        "jsonrpc": "2.0",
                        "id": 900,
                        "method": "session/request_permission",
                        "params": {},
                    }),
                )
                .await;
                let permission_reply = read_frame(&mut socket).await;
                assert_eq!(permission_reply["id"], 900);
                assert_eq!(
                    permission_reply["result"]["outcome"]["outcome"],
                    "cancelled"
                );
                send_frame(
                    &mut socket,
                    respond(prompt_id, json!({"stopReason": "end_turn"})),
                )
                .await;
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
        .await;

        let client = AcpClient::connect(&url, "secret-token").await.unwrap();
        let mut updates = client.take_updates().unwrap();
        client.initialize().await.unwrap();
        assert!(client.load_session_capable());
        let session_id = client.new_session("/workspace").await.unwrap();
        assert_eq!(session_id, "sess-1");
        client
            .load_session("/workspace", &session_id)
            .await
            .unwrap();

        let result = client.prompt(&session_id, "hello agent").await.unwrap();
        assert_eq!(result.stop_reason.as_deref(), Some("end_turn"));

        let update = updates.recv().await.unwrap();
        assert_eq!(update["sessionId"], "sess-1");
        assert_eq!(update["update"]["sessionUpdate"], "agent_message_chunk");

        client.close();
        assert!(client.closed());
        server.await.unwrap();
        assert_eq!(prompt_count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn connect_sends_token_as_query_param() {
        let query = Arc::new(Mutex::new(None));
        let server_query = Arc::clone(&query);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}/ws?agent_id=abc", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            #[allow(clippy::result_large_err)]
            let mut socket = tokio_tungstenite::accept_hdr_async(
                stream,
                move |request: &tokio_tungstenite::tungstenite::handshake::server::Request,
                      response| {
                    *server_query.lock().unwrap() = request.uri().query().map(str::to_owned);
                    Ok(response)
                },
            )
            .await
            .unwrap();
            let init = read_frame(&mut socket).await;
            send_frame(
                &mut socket,
                respond(init["id"].as_u64().unwrap(), initialize_result(false)),
            )
            .await;
            tokio::time::sleep(Duration::from_millis(100)).await;
        });

        let client = AcpClient::connect(&url, "secret-token").await.unwrap();
        client.initialize().await.unwrap();
        let captured = query.lock().unwrap().clone().unwrap();
        assert!(captured.contains("agent_id=abc"));
        assert!(captured.contains("token=secret-token"));
        client.close();
        server.await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn connect_failure_is_retryable() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}/ws", listener.local_addr().unwrap());
        drop(listener);
        let error = AcpClient::connect(&url, "token").await.unwrap_err();
        assert!(error.is_retryable());
        assert!(!error.is_ambiguous());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn initialize_rpc_error_is_terminal_not_retryable() {
        let (url, server) = start_server(|mut socket| async move {
            let init = read_frame(&mut socket).await;
            send_frame(
                &mut socket,
                json!({
                    "jsonrpc": "2.0",
                    "id": init["id"],
                    "error": {"code": -32000, "message": "bad auth"},
                }),
            )
            .await;
            tokio::time::sleep(Duration::from_millis(50)).await;
        })
        .await;

        let client = AcpClient::connect(&url, "token").await.unwrap();
        let error = client.initialize().await.unwrap_err();
        match &error {
            AcpError::Request {
                method,
                code,
                message,
            } => {
                assert_eq!(method, "initialize");
                assert_eq!(*code, Some(-32000));
                assert_eq!(message, "bad auth");
            }
            other => panic!("expected AcpError::Request, got {other:?}"),
        }
        assert!(!error.is_retryable());
        assert!(!error.is_ambiguous());
        // A failed initialize closes the client.
        assert!(client.closed());
        let error = client.new_session("/workspace").await.unwrap_err();
        assert!(matches!(error, AcpError::Closed));
        server.await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn pre_prompt_transport_drop_is_retryable() {
        let (url, server) = start_server(|mut socket| async move {
            let init = read_frame(&mut socket).await;
            send_frame(
                &mut socket,
                respond(init["id"].as_u64().unwrap(), initialize_result(false)),
            )
            .await;
            // Drop the socket before any session/prompt frame: restarting is safe.
        })
        .await;

        let client = AcpClient::connect(&url, "token").await.unwrap();
        client.initialize().await.unwrap();
        server.await.unwrap();
        // Give the read loop a moment to observe the close.
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(client.is_down());
        let error = client.new_session("/workspace").await.unwrap_err();
        assert!(error.is_retryable(), "expected retryable, got {error:?}");
        assert!(!error.is_ambiguous());
        client.close();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn post_prompt_send_drop_is_ambiguous_and_prompt_never_resent() {
        let prompt_count = Arc::new(AtomicUsize::new(0));
        let server_prompt_count = Arc::clone(&prompt_count);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("ws://{addr}/ws");
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let init = read_frame(&mut socket).await;
            send_frame(
                &mut socket,
                respond(init["id"].as_u64().unwrap(), initialize_result(true)),
            )
            .await;
            let new = read_frame(&mut socket).await;
            send_frame(
                &mut socket,
                respond(new["id"].as_u64().unwrap(), json!({"sessionId": "sess-1"})),
            )
            .await;
            let prompt = read_frame(&mut socket).await;
            assert_eq!(prompt["method"], "session/prompt");
            server_prompt_count.fetch_add(1, Ordering::SeqCst);
            // Drop the socket mid-turn without answering.
        });

        let client = AcpClient::connect(&url, "token").await.unwrap();
        client.initialize().await.unwrap();
        let session_id = client.new_session("/workspace").await.unwrap();
        let error = client
            .prompt(&session_id, "run the task")
            .await
            .unwrap_err();
        assert!(error.is_ambiguous(), "expected ambiguous, got {error:?}");
        assert!(!error.is_retryable());
        server.await.unwrap();

        // The client never reconnects or re-sends: a second prompt attempt is
        // classified pre-send (retryable) and no second frame ever leaves.
        tokio::time::sleep(Duration::from_millis(50)).await;
        let error = client
            .prompt(&session_id, "run the task")
            .await
            .unwrap_err();
        assert!(error.is_retryable(), "expected retryable, got {error:?}");
        assert_eq!(prompt_count.load(Ordering::SeqCst), 1);

        // And the client never re-dialed: no second connection arrives.
        drop(client);
        let listener = TcpListener::bind(addr).await.unwrap();
        let redial = tokio::time::timeout(Duration::from_millis(100), listener.accept()).await;
        assert!(redial.is_err(), "client must never re-dial");
        assert_eq!(prompt_count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn load_session_gate_falls_back_to_session_new() {
        let (url, server) = start_server(|mut socket| async move {
            let init = read_frame(&mut socket).await;
            send_frame(
                &mut socket,
                respond(init["id"].as_u64().unwrap(), initialize_result(false)),
            )
            .await;
            let new = read_frame(&mut socket).await;
            assert_eq!(new["method"], "session/new");
            send_frame(
                &mut socket,
                respond(
                    new["id"].as_u64().unwrap(),
                    json!({"sessionId": "sess-fresh"}),
                ),
            )
            .await;
            tokio::time::sleep(Duration::from_millis(100)).await;
        })
        .await;

        let client = AcpClient::connect(&url, "token").await.unwrap();
        client.initialize().await.unwrap();
        assert!(!client.load_session_capable());

        let error = client
            .load_session("/workspace", "sess-stale")
            .await
            .unwrap_err();
        match &error {
            AcpError::Unavailable { capability, detail } => {
                assert_eq!(capability, "session/load");
                assert!(detail.contains("agentCapabilities.loadSession"));
            }
            other => panic!("expected AcpError::Unavailable, got {other:?}"),
        }
        assert!(!error.is_retryable());
        assert!(!error.is_ambiguous());

        // Documented caller fallback: create a fresh session instead.
        let session_id = client.new_session("/workspace").await.unwrap();
        assert_eq!(session_id, "sess-fresh");
        client.close();
        server.await.unwrap();
    }
}
