//! Async ACP (Agent Client Protocol) client for coding agents.
//!
//! Connects to Backend's standard ACP v2 surface. Session creation, resume,
//! prompt admission, updates and cancellation use the standard protocol.
//! [`AcpClient::submit_prompt`] returns an accepted message ID, not completion.
//! [`AcpClient::prompt`] refuses before sending because a raw connection has no
//! platform receipt reader. Use [`crate::SessionsClient::wait_prompt_completion`]
//! with the acceptance for exact REST completion evidence, even after disconnect.
//! The client profile is the upstream experimental v2 alpha.5 draft, not stable
//! ACP. Backend runtime v1/v2 negotiation is independent of this boundary.
//!
//! Parity across sibling SDKs:
//!
//! - TypeScript SDK (`ts-sdk/src/acp.ts`): full client with reconnect
//!   backoff, session replay via `session/resume`, pooled update listeners, and
//!   terminal-close classification.
//! - Python SDK (`py-sdk/hypercli/acp.py`): minimal one-shot client with the same
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
//!   Backend's REST message history before deciding
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
pub const ACP_PROTOCOL_VERSION: u64 = 2;
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
        "ACP delivery is uncertain after session/prompt ({detail}); \
         not retrying to avoid duplicate execution — the prompt may still reach the \
         agent; inspect the platform REST session history \
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

/// Standard v2 admission identity. This is not an execution receipt.
#[derive(Debug, Clone)]
pub struct AcpPromptAcceptance {
    /// Platform session receiving the insertion.
    pub session_id: String,
    /// Required ID shared with the corresponding user-message update.
    pub message_id: String,
    /// Original standard response, including opaque metadata.
    pub raw: Value,
}

struct Pending {
    method: String,
    tx: oneshot::Sender<Result<Value, AcpError>>,
}

/// Scope guard that pops the pending-table entry if the awaiting request
/// future is dropped (caller-side cancellation). Without it, a caller-dropped
/// in-flight request would leave its entry in the table until the connection
/// dies or a response happens to arrive. On the resolve path the dispatcher
/// has already removed the entry, so the drop is a no-op.
struct PendingGuard {
    state: Arc<ConnState>,
    id: u64,
}

impl Drop for PendingGuard {
    fn drop(&mut self) {
        self.state.pending.lock().unwrap().remove(&self.id);
    }
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
                    "capabilities": {},
                    "info": {"name": "hypercli-rs-sdk", "version": env!("CARGO_PKG_VERSION")},
                }),
            )
            .await;
        match response {
            Ok(value) => {
                if value["protocolVersion"].as_u64() != Some(2)
                    || !value["info"]["name"].is_string()
                    || !value["info"]["version"].is_string()
                {
                    self.close();
                    return Err(AcpError::Protocol(
                        "expected a standard ACP v2 initialize response".to_owned(),
                    ));
                }
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

    /// Compatibility name for the v2 `capabilities.session` surface. No v1
    /// `loadSession` capability or `session/load` operation is used.
    pub fn load_session_capable(&self) -> bool {
        self.initialize_response
            .lock()
            .unwrap()
            .pointer("/capabilities/session")
            .is_some_and(Value::is_object)
    }

    /// Take the `session/update` notification sink. Each item is the raw
    /// notification `params` object. Callable once; subsequent calls return
    /// `None`. The channel closes when the connection dies.
    pub fn take_updates(&self) -> Option<AcpUpdateReceiver> {
        self.updates.lock().unwrap().take()
    }

    /// Create a session with `session/new` and return its session id.
    /// Supply a concrete absolute cwd resolved by the runner/hosted runtime, or
    /// an explicit valid absolute override. Relative configuration (including
    /// runtime `~/.hypercli` paths) must be resolved on the runtime host first.
    /// The SDK validates path shape only and sends valid overrides verbatim.
    pub async fn new_session(&self, cwd: &str) -> Result<String, AcpError> {
        self.require_session_surface("session/new")?;
        validate_cwd(cwd)?;
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

    /// Resume a session by id. Kept as the v1-era name for `session/resume`
    /// (`resume_session` with replay); never substitutes a new session on
    /// failure.
    pub async fn load_session(&self, cwd: &str, session_id: &str) -> Result<Value, AcpError> {
        self.resume_session(cwd, session_id, true).await
    }

    /// Standard v2 resume; never substitutes a new session on failure.
    /// `cwd` must be the original session setup obtained from discovery or
    /// stored native setup, not a guessed cwd or a new launch default.
    pub async fn resume_session(
        &self,
        cwd: &str,
        session_id: &str,
        replay: bool,
    ) -> Result<Value, AcpError> {
        self.require_session_surface("session/resume")?;
        validate_cwd(cwd)?;
        let mut params = json!({"sessionId":session_id, "cwd":cwd, "mcpServers":[]});
        if replay {
            params["replayFrom"] = json!({"type":"start"});
        }
        self.request("session/resume", params).await
    }

    /// List the peer's standard ACP catalog. Platform discovery status and
    /// retained metadata are available separately through `client.sessions()`.
    pub async fn list_sessions(
        &self,
        cwd: Option<&str>,
        cursor: Option<&str>,
    ) -> Result<Value, AcpError> {
        self.require_session_surface("session/list")?;
        if let Some(cwd) = cwd {
            validate_cwd(cwd)?;
        }
        self.request("session/list", json!({"cwd": cwd, "cursor": cursor}))
            .await
    }

    /// Close the remote session using the baseline v2 operation. This is
    /// distinct from closing this client's transport or deleting stored history.
    pub async fn close_session(&self, session_id: &str) -> Result<Value, AcpError> {
        self.require_session_surface("session/close")?;
        self.request("session/close", json!({"sessionId": session_id}))
            .await
    }

    fn require_session_surface(&self, method: &str) -> Result<(), AcpError> {
        if self.closed() {
            return Err(AcpError::Closed);
        }
        if self.is_down() {
            return Err(AcpError::Retryable("ACP connection is down".to_owned()));
        }
        if !self.load_session_capable() {
            return Err(AcpError::Unavailable {
                capability: method.to_owned(),
                detail: "no v2 session capability advertised".to_owned(),
            });
        }
        Ok(())
    }

    /// Compatibility convenience that refuses before sending. A raw ACP socket
    /// cannot prove completion; use `submit_prompt` followed by
    /// [`crate::SessionsClient::wait_prompt_completion`] with platform credentials.
    pub async fn prompt(
        &self,
        _session_id: &str,
        _text: &str,
    ) -> Result<AcpPromptResult, AcpError> {
        Err(AcpError::Unavailable { capability: "prompt completion".to_owned(),
            detail: "ACP v2 idle is not a message receipt; use submit_prompt, take_updates and platform REST history".to_owned() })
    }

    /// Insert original blocks once and return the actual accepted message ID.
    pub async fn submit_prompt(
        &self,
        session_id: &str,
        blocks: Vec<Value>,
    ) -> Result<AcpPromptAcceptance, AcpError> {
        self.require_session_surface(PROMPT_METHOD)?;
        let result = self
            .request(
                PROMPT_METHOD,
                json!({
                    "sessionId": session_id,
                    "prompt": blocks,
                }),
            )
            .await?;
        let message_id = result["messageId"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| AcpError::AmbiguousDelivery {
                detail: "v2 prompt response did not contain a usable messageId; inspect REST history before resubmitting".to_owned(),
            })?
            .to_owned();
        Ok(AcpPromptAcceptance {
            session_id: session_id.to_owned(),
            message_id,
            raw: result,
        })
    }

    /// Queue standard cancellation after previously queued prompt writes. Success
    /// is only local enqueueing, not acknowledgment that execution has stopped.
    pub fn cancel(&self, session_id: &str) -> Result<(), AcpError> {
        self.require_session_surface("session/cancel")?;
        let outbound = self
            .outbound
            .lock()
            .unwrap()
            .as_ref()
            .cloned()
            .ok_or(AcpError::Closed)?;
        outbound.send(Message::Text(json!({"jsonrpc":"2.0", "method":"session/cancel", "params":{"sessionId":session_id}}).to_string().into()))
            .map_err(|_| AcpError::Closed)
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

    /// Raw JSON-RPC access. Callers must follow the negotiated upstream v2
    /// schema; platform metadata and private vendor methods do not belong here.
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
        let guard = PendingGuard {
            state: Arc::clone(&self.state),
            id,
        };
        let outcome = rx
            .await
            .map_err(|_| AcpError::Retryable("ACP request was dropped".to_owned()));
        drop(guard);
        outcome?
    }
}

impl Drop for AcpClient {
    fn drop(&mut self) {
        self.close();
    }
}

fn validate_cwd(cwd: &str) -> Result<(), AcpError> {
    // The runtime host may use a different OS from the client. Do not resolve,
    // normalize or substitute a local path or a guessed runtime home directory.
    let bytes = cwd.as_bytes();
    let drive_absolute = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\');
    let unc_absolute = cwd.strip_prefix("\\\\").is_some_and(|rest| {
        let mut parts = rest.split('\\');
        parts.next().is_some_and(|part| !part.is_empty())
            && parts.next().is_some_and(|part| !part.is_empty())
    });
    if !cwd.contains('\0') && (cwd.starts_with('/') || drive_absolute || unc_absolute) {
        return Ok(());
    }
    Err(AcpError::Unavailable {
        capability: "session cwd".to_owned(),
        detail: "an absolute runtime-host cwd is required".to_owned(),
    })
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
                Ok(frame) => {
                    if let Err(error) = dispatch_message(&frame, &state, &outbound, &updates) {
                        break Failure::Protocol(error);
                    }
                }
                Err(error) => {
                    break Failure::Protocol(format!("ACP bridge returned invalid JSON: {error}"));
                }
            },
            Some(Ok(Message::Binary(bytes))) => {
                match serde_json::from_str::<Value>(&String::from_utf8_lossy(&bytes)) {
                    Ok(frame) => {
                        if let Err(error) = dispatch_message(&frame, &state, &outbound, &updates) {
                            break Failure::Protocol(error);
                        }
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

fn dispatch_message(
    message: &Value,
    state: &ConnState,
    outbound: &mpsc::UnboundedSender<Message>,
    updates: &mpsc::UnboundedSender<Value>,
) -> Result<(), String> {
    let frames = match message {
        Value::Array(frames) => frames.as_slice(),
        frame => std::slice::from_ref(frame),
    };
    if frames.is_empty() || frames.iter().any(|frame| !valid_envelope(frame)) {
        return Err("ACP bridge returned an invalid JSON-RPC envelope".to_owned());
    }
    if message.is_array() {
        let (batch_outbound, mut replies) = mpsc::unbounded_channel();
        for frame in frames {
            dispatch_frame(frame, state, &batch_outbound, updates);
        }
        let mut responses = Vec::new();
        while let Ok(Message::Text(text)) = replies.try_recv() {
            responses
                .push(serde_json::from_str::<Value>(&text).expect("serialized JSON-RPC reply"));
        }
        if !responses.is_empty() {
            let _ = outbound.send(Message::Text(Value::Array(responses).to_string().into()));
        }
    } else {
        dispatch_frame(message, state, outbound, updates);
    }
    Ok(())
}

fn valid_envelope(frame: &Value) -> bool {
    if !frame.is_object() || frame.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return false;
    }
    if frame
        .get("id")
        .is_some_and(|id| !(id.is_null() || id.is_string() || id.as_i64().is_some()))
    {
        return false;
    }
    if let Some(method) = frame.get("method") {
        return method.is_string()
            && frame.get("result").is_none()
            && frame.get("error").is_none()
            && frame.get("params").is_none_or(Value::is_object);
    }
    frame.get("id").is_some()
        && (frame.get("result").is_some() != frame.get("error").is_some())
        && frame.get("error").is_none_or(|error| {
            error.get("code").and_then(Value::as_i64).is_some()
                && error.get("message").and_then(Value::as_str).is_some()
        })
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
    let Some(id) = frame
        .get("id")
        .filter(|id| id.is_null() || id.is_string() || id.as_i64().is_some())
    else {
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

    #[tokio::test]
    async fn permission_replies_preserve_upstream_request_id_types() {
        let state = ConnState {
            pending: Mutex::new(HashMap::new()),
            dead: AtomicBool::new(false),
        };
        let (outbound, mut received) = mpsc::unbounded_channel();
        let (updates, _) = mpsc::unbounded_channel();
        for id in [json!("permission-1"), json!(-17), Value::Null, json!(4)] {
            dispatch_frame(
                &json!({"jsonrpc":"2.0", "id":id,
                "method":"session/request_permission", "params":{"sessionId":"s", "options":[]}}),
                &state,
                &outbound,
                &updates,
            );
            let Message::Text(text) = received.try_recv().unwrap() else {
                panic!("expected response")
            };
            let response: Value = serde_json::from_str(&text).unwrap();
            assert_eq!(response["id"], id);
            assert_eq!(response["result"]["outcome"]["outcome"], "cancelled");
        }
    }

    #[test]
    fn decoder_validates_batches_before_dispatch_and_never_answers_notifications() {
        let state = ConnState {
            pending: Mutex::new(HashMap::new()),
            dead: AtomicBool::new(false),
        };
        let (outbound, mut received) = mpsc::unbounded_channel();
        let (updates, _) = mpsc::unbounded_channel();
        for malformed in [
            json!([]),
            json!({"jsonrpc":"2.0","id":true,"method":"x"}),
            json!({"jsonrpc":"2.0","id":1,"result":{},"error":{"code":-1,"message":"x"}}),
            json!({"id":1,"method":"x"}),
        ] {
            assert!(dispatch_message(&malformed, &state, &outbound, &updates).is_err());
        }
        dispatch_message(
            &json!([{"jsonrpc":"2.0","method":"unknown"}]),
            &state,
            &outbound,
            &updates,
        )
        .unwrap();
        assert!(received.try_recv().is_err());
        dispatch_message(
            &json!([
            {"jsonrpc":"2.0","id":"p","method":"session/request_permission","params":{}},
            {"jsonrpc":"2.0","id":-1,"method":"unknown"}]),
            &state,
            &outbound,
            &updates,
        )
        .unwrap();
        let Message::Text(text) = received.try_recv().unwrap() else {
            panic!("expected batch")
        };
        let replies: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(replies[0]["id"], "p");
        assert_eq!(replies[1]["id"], -1);
        assert_eq!(replies.as_array().unwrap().len(), 2);
    }

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

    #[tokio::test]
    async fn silent_peer_and_ignored_cancel_survive_virtual_year_until_real_evidence() {
        let (seen_tx, mut seen_rx) = mpsc::unbounded_channel();
        let (release_tx, release_rx) = oneshot::channel();
        let (finish_tx, finish_rx) = oneshot::channel();
        let (url, server) = start_server(move |mut socket| async move {
            let init = read_frame(&mut socket).await;
            send_frame(
                &mut socket,
                respond(init["id"].as_u64().unwrap(), initialize_result(true)),
            )
            .await;
            let prompt = read_frame(&mut socket).await;
            assert_eq!(prompt["method"], "session/prompt");
            seen_tx.send(()).unwrap();
            let cancel = read_frame(&mut socket).await;
            assert_eq!(cancel["method"], "session/cancel");
            assert!(cancel.get("id").is_none());
            seen_tx.send(()).unwrap();
            release_rx.await.unwrap();
            send_frame(
                &mut socket,
                json!({"jsonrpc":"2.0", "id":prompt["id"],
                "result":{"messageId":"accepted-after-silence"}}),
            )
            .await;
            finish_rx.await.unwrap();
            send_frame(
                &mut socket,
                json!({"jsonrpc":"2.0", "method":"session/update",
                "params":{"sessionId":"s", "update":{"sessionUpdate":"state_update",
                    "state":"idle"}}}),
            )
            .await;
        })
        .await;
        let client = Arc::new(AcpClient::connect(&url, "").await.unwrap());
        client.initialize().await.unwrap();
        let mut updates = client.take_updates().unwrap();
        let pending_client = Arc::clone(&client);
        let pending = tokio::spawn(async move {
            pending_client
                .submit_prompt("s", vec![json!({"type":"text", "text":"once"})])
                .await
        });
        seen_rx.recv().await.unwrap();
        client.cancel("s").unwrap();
        seen_rx.recv().await.unwrap();
        // Only the test clock advances. No execution deadline is introduced.
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(366 * 24 * 60 * 60)).await;
        assert!(!pending.is_finished());
        assert!(updates.try_recv().is_err());
        assert!(!client.is_down());
        release_tx.send(()).unwrap();
        assert_eq!(
            pending.await.unwrap().unwrap().message_id,
            "accepted-after-silence"
        );
        assert!(
            updates.try_recv().is_err(),
            "admission is not terminal evidence"
        );
        finish_tx.send(()).unwrap();
        assert_eq!(updates.recv().await.unwrap()["update"]["state"], "idle");
        server.await.unwrap();
        client.close();
    }

    #[tokio::test]
    async fn malformed_peer_frames_fail_the_real_pending_request_loudly() {
        for malformed in [
            "{",
            "[]",
            r#"{"jsonrpc":"1.0","id":1,"result":{}}"#,
            r#"{"jsonrpc":"2.0","id":{},"result":{}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{},"error":{"code":-1,"message":"both"}}"#,
        ] {
            let (url, server) = start_server(move |mut socket| async move {
                let init = read_frame(&mut socket).await;
                send_frame(
                    &mut socket,
                    respond(init["id"].as_u64().unwrap(), initialize_result(true)),
                )
                .await;
                let request = read_frame(&mut socket).await;
                assert_eq!(request["method"], "session/prompt");
                socket.send(Message::Text(malformed.into())).await.unwrap();
            })
            .await;
            let client = AcpClient::connect(&url, "").await.unwrap();
            client.initialize().await.unwrap();
            let mut updates = client.take_updates().unwrap();
            let result = client
                .submit_prompt("s", vec![json!({"type":"text", "text":"once"})])
                .await;
            // The input was already written: fail loudly while retaining
            // uncertainty about execution, rather than calling it unsent.
            assert!(
                matches!(result, Err(AcpError::AmbiguousDelivery { .. })),
                "{malformed}: {result:?}"
            );
            assert!(
                updates.try_recv().is_err(),
                "malformed input is not a terminal update"
            );
            assert!(client.is_down());
            client.close();
            server.await.unwrap();
        }
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
            "info": {"name":"fixture", "version":"2"},
            "capabilities": if load_session { json!({"session":{}}) } else { json!({}) },
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
                assert_eq!(init["params"]["protocolVersion"], 2);
                assert!(init["params"].get("clientCapabilities").is_none());
                assert!(init["params"]["info"].is_object());
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
                assert_eq!(load["method"], "session/resume");
                assert_eq!(load["params"]["replayFrom"], json!({"type":"start"}));
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
                            "update": {"sessionUpdate": "agent_message_chunk", "messageId":"reply", "content":{"type":"text", "text":"reply"}},
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
                        "params": {"sessionId":"sess-1", "title":"Read file", "options":[{"optionId":"deny", "kind":"reject_once", "name":"Deny"}]},
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
                    respond(prompt_id, json!({"messageId": "accepted"})),
                )
                .await;
                let cancel = read_frame(&mut socket).await;
                assert_eq!(cancel["method"], "session/cancel");
                assert!(cancel.get("id").is_none());
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

        let result = client
            .submit_prompt(
                &session_id,
                vec![json!({"type":"text", "text":"hello agent"})],
            )
            .await
            .unwrap();
        assert_eq!(result.message_id, "accepted");
        assert!(matches!(
            client.prompt(&session_id, "must not send").await,
            Err(AcpError::Unavailable { .. })
        ));
        client.cancel(&session_id).unwrap();

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
            .submit_prompt(
                &session_id,
                vec![json!({"type":"text", "text":"run the task"})],
            )
            .await
            .unwrap_err();
        assert!(error.is_ambiguous(), "expected ambiguous, got {error:?}");
        assert!(!error.is_retryable());
        server.await.unwrap();

        // The client never reconnects or re-sends: a second prompt attempt is
        // classified pre-send (retryable) and no second frame ever leaves.
        tokio::time::sleep(Duration::from_millis(50)).await;
        let error = client
            .submit_prompt(
                &session_id,
                vec![json!({"type":"text", "text":"run the task"})],
            )
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
    async fn dropped_in_flight_request_future_pops_the_pending_entry() {
        let (url, server) = start_server(|mut socket| async move {
            let init = read_frame(&mut socket).await;
            send_frame(
                &mut socket,
                respond(init["id"].as_u64().unwrap(), initialize_result(true)),
            )
            .await;
            let new = read_frame(&mut socket).await;
            assert_eq!(new["method"], "session/new");
            // Never answer: the caller is expected to drop the request future.
            tokio::time::sleep(Duration::from_millis(200)).await;
        })
        .await;

        let client = AcpClient::connect(&url, "token").await.unwrap();
        client.initialize().await.unwrap();
        // Timeout drops the in-flight request future mid-await.
        let timed_out =
            tokio::time::timeout(Duration::from_millis(50), client.new_session("/workspace")).await;
        assert!(timed_out.is_err());
        // The cancelled request must not linger in the pending table: the
        // awaiting future's drop pops its entry immediately.
        assert!(client.state.pending.lock().unwrap().is_empty());
        // And the connection is still usable afterwards.
        client.close();
        server.await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn load_alias_uses_standard_resume_without_fallback() {
        let (finished_tx, finished_rx) = oneshot::channel();
        let (url, server) = start_server(move |mut socket| async move {
            let init = read_frame(&mut socket).await;
            send_frame(
                &mut socket,
                respond(init["id"].as_u64().unwrap(), initialize_result(false)),
            )
            .await;
            tokio::select! {
                frame = read_frame(&mut socket) => panic!("unsupported operation emitted: {frame}"),
                _ = finished_rx => {},
            }
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
                assert_eq!(capability, "session/resume");
                assert!(detail.contains("v2 session capability"));
            }
            other => panic!("expected AcpError::Unavailable, got {other:?}"),
        }
        assert!(!error.is_retryable());
        assert!(!error.is_ambiguous());

        assert!(matches!(
            client.new_session("/workspace").await,
            Err(AcpError::Unavailable { .. })
        ));
        assert!(matches!(
            client.list_sessions(None, None).await,
            Err(AcpError::Unavailable { .. })
        ));
        assert!(matches!(
            client.close_session("sess-stale").await,
            Err(AcpError::Unavailable { .. })
        ));
        assert!(matches!(
            client.submit_prompt("sess-stale", vec![]).await,
            Err(AcpError::Unavailable { .. })
        ));
        assert!(matches!(
            client.cancel("sess-stale"),
            Err(AcpError::Unavailable { .. })
        ));
        finished_tx.send(()).unwrap();
        server.await.unwrap();
        client.close();
    }

    #[tokio::test]
    async fn standard_list_resume_close_frames_and_invalid_cwd_rejection() {
        let (url, server) = start_server(|mut socket| async move {
            let init = read_frame(&mut socket).await;
            send_frame(
                &mut socket,
                respond(init["id"].as_u64().unwrap(), initialize_result(true)),
            )
            .await;
            let list = read_frame(&mut socket).await;
            assert_eq!(list["method"], "session/list");
            assert_eq!(list["params"], json!({"cwd":null,"cursor":"opaque"}));
            send_frame(
                &mut socket,
                respond(list["id"].as_u64().unwrap(), json!({"sessions":[]})),
            )
            .await;
            let resume = read_frame(&mut socket).await;
            assert_eq!(resume["method"], "session/resume");
            assert_eq!(
                resume["params"],
                json!({"cwd":"/original", "sessionId":"same-id", "mcpServers":[]})
            );
            send_frame(
                &mut socket,
                respond(resume["id"].as_u64().unwrap(), json!({})),
            )
            .await;
            let close = read_frame(&mut socket).await;
            assert_eq!(close["method"], "session/close");
            assert_eq!(close["params"], json!({"sessionId":"same-id"}));
            send_frame(
                &mut socket,
                respond(close["id"].as_u64().unwrap(), json!({})),
            )
            .await;
        })
        .await;
        let client = AcpClient::connect(&url, "").await.unwrap();
        assert!(matches!(
            client.new_session("/original").await,
            Err(AcpError::Unavailable { .. })
        ));
        client.initialize().await.unwrap();
        for invalid in [
            "",
            "relative",
            "~/.hypercli/project",
            "./project",
            "C:relative",
            "/bad\0path",
            "\\\\host",
        ] {
            assert!(client.new_session(invalid).await.is_err());
            assert!(client
                .resume_session(invalid, "same-id", false)
                .await
                .is_err());
        }
        client.list_sessions(None, Some("opaque")).await.unwrap();
        client
            .resume_session("/original", "same-id", false)
            .await
            .unwrap();
        client.close_session("same-id").await.unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn explicit_runtime_cwd_overrides_are_sent_verbatim() {
        const PATHS: [&str; 3] = [
            "/runtime/custom root/../project",
            r"C:\Users\runner\.hypercli\project",
            r"\\runtime\share\project",
        ];
        let (url, server) = start_server(|mut socket| async move {
            let init = read_frame(&mut socket).await;
            send_frame(
                &mut socket,
                respond(init["id"].as_u64().unwrap(), initialize_result(true)),
            )
            .await;
            for cwd in PATHS {
                let new = read_frame(&mut socket).await;
                assert_eq!(new["method"], "session/new");
                assert_eq!(new["params"], json!({"cwd": cwd, "mcpServers": []}));
                send_frame(
                    &mut socket,
                    respond(
                        new["id"].as_u64().unwrap(),
                        json!({"sessionId": "original"}),
                    ),
                )
                .await;
                let resume = read_frame(&mut socket).await;
                assert_eq!(resume["method"], "session/resume");
                assert_eq!(
                    resume["params"],
                    json!({"cwd": cwd, "sessionId": "original", "mcpServers": []}),
                );
                send_frame(
                    &mut socket,
                    respond(resume["id"].as_u64().unwrap(), json!({})),
                )
                .await;
            }
        })
        .await;
        let client = AcpClient::connect(&url, "").await.unwrap();
        client.initialize().await.unwrap();
        for cwd in PATHS {
            let session_id = client.new_session(cwd).await.unwrap();
            client
                .resume_session(cwd, &session_id, false)
                .await
                .unwrap();
        }
        server.await.unwrap();
    }

    #[tokio::test]
    async fn initialize_rejects_non_v2_and_closes_without_fallback() {
        for result in [
            json!({"protocolVersion":1,"agentCapabilities":{}}),
            json!({"protocolVersion":2,"info":{"name":"fixture"}}),
        ] {
            let (url, server) = start_server(move |mut socket| async move {
                let init = read_frame(&mut socket).await;
                send_frame(&mut socket, respond(init["id"].as_u64().unwrap(), result)).await;
            })
            .await;
            let client = AcpClient::connect(&url, "").await.unwrap();
            assert!(matches!(
                client.initialize().await,
                Err(AcpError::Protocol(_))
            ));
            assert!(client.closed());
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn malformed_admission_identity_is_uncertain_not_safe_to_retry() {
        let (url, server) = start_server(|mut socket| async move {
            let init = read_frame(&mut socket).await;
            send_frame(
                &mut socket,
                respond(init["id"].as_u64().unwrap(), initialize_result(true)),
            )
            .await;
            let prompt = read_frame(&mut socket).await;
            send_frame(
                &mut socket,
                respond(
                    prompt["id"].as_u64().unwrap(),
                    json!({"stopReason":"end_turn"}),
                ),
            )
            .await;
        })
        .await;
        let client = AcpClient::connect(&url, "").await.unwrap();
        client.initialize().await.unwrap();
        let error = client
            .submit_prompt("s", vec![json!({"type":"text","text":"once"})])
            .await
            .unwrap_err();
        assert!(error.is_ambiguous());
        assert!(!error.is_retryable());
        server.await.unwrap();
    }
}
