//! Pod-side termination of ACP client capabilities for the generic transports.
//!
//! The far SDK client connecting through the backend `/ws` bridge may or may
//! not implement the client-side request surface (`fs/*`,
//! `session/request_permission`). The pod host is the sandbox where the ACP
//! child actually runs, so this module answers those requests locally inside
//! the transport instead of pumping them upstream:
//!
//! - `initialize` requests are rewritten so the CHILD always sees
//!   `fs.readTextFile=true` and `fs.writeTextFile=true`. Terminal support is
//!   NOT advertised: `terminal/*` requests pass through to the upstream
//!   client like any other unknown verb. The originally advertised
//!   capabilities are recorded for observability.
//! - `fs/read_text_file` and `fs/write_text_file` are served from the pod
//!   filesystem, jailed per session: a `session/new` request records its
//!   `cwd` against the client→agent request id, and when the agent's
//!   response (carrying the agent-assigned `sessionId`) passes through the
//!   pump, the cwd is bound to that session id. fs requests jail to their
//!   `params.sessionId` root; an unknown or missing session id falls back to
//!   this process' cwd. Canonicalized escapes outside the jail are rejected
//!   with an InvalidParams JSON-RPC error, and a rejected write creates
//!   nothing on disk (the jail verdict precedes any `create_dir_all`).
//! - `session/request_permission` passes through to the upstream client by
//!   default. Setting `HYPER_ACP_PERMISSION_MODE` to `auto` or
//!   `bypass-permissions`, or setting `HYPER_ACP_AUTO_APPROVE_PERMISSION` to a
//!   truthy value (`1`, `true`, `yes`, `on`), makes the pod answer locally with
//!   the first allow option (`allow_always` preferred over `allow_once`), or
//!   `cancelled` when the request carries no options.
//!
//! Every other frame — including unknown/exotic methods — is pumped byte
//! unchanged, because the client may implement verbs the pod does not know.
//! Pod served requests echo back the agent's own request id, which is
//! disjoint by construction from the client→agent id space.
//!
//! # Re-initialize seam (decision: pod-side replay)
//!
//! The outbound `/ws` transport keeps the ACP child alive across WebSocket
//! eras, but ACP v1 `initialize` is once-per-connection and the child's
//! stdio connection never ends — while a reconnecting client (v2 draft RFD
//! initialize-first convention) sends `initialize` again on every era. The
//! seam options were: (a) the pod answers re-initialize from a cached
//! first-response, (b) the SDK stops re-initializing (violates the v2
//! convention, rejected), (c) forward and rely on children tolerating it.
//! (c) is NOT universally safe: `codex-acp` forwards `initialize` to the
//! Codex app-server, which answers the second one with
//! `invalid_request("Already initialized")`, and `goose` re-runs its
//! handler but silently keeps the FIRST era's captured client capabilities
//! (`OnceCell::set` results discarded). So this module implements (a): the
//! first successful child `initialize` response is cached (keyed by the
//! rewritten request's id) and replayed to later-era clients verbatim when
//! their fresh request carries the same id, reserialized with the new id
//! otherwise. The per-era request rewrite still runs so the advertised
//! (pre-rewrite) client capabilities are recorded for observability, but
//! nothing pod-side consumes stored per-era client capabilities: fs
//! termination is jailed by session regardless of what the client
//! advertised (the rewrite forces `fs=true` for the child), and permission
//! auto-approval is env-gated only.

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Map, Value, json};
use tokio::sync::{Mutex, mpsc};

/// Environment variable controlling pod-local permission auto-approval.
pub const HYPER_ACP_AUTO_APPROVE_PERMISSION_ENV: &str = "HYPER_ACP_AUTO_APPROVE_PERMISSION";
/// Environment variable controlling ACP permission behavior.
pub const HYPER_ACP_PERMISSION_MODE_ENV: &str = "HYPER_ACP_PERMISSION_MODE";

/// JSON-RPC canonical error codes this terminator can emit.
const JSONRPC_INTERNAL_ERROR: i64 = -32_603;
const JSONRPC_INVALID_PARAMS: i64 = -32_602;

/// Advertised client capabilities captured on `initialize` (pre-rewrite).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AdvertisedClientCapabilities {
    /// Client claimed `fs.readTextFile`.
    pub fs_read_text_file: bool,
    /// Client claimed `fs.writeTextFile`.
    pub fs_write_text_file: bool,
    /// Client claimed terminal support.
    pub terminal: bool,
}

#[derive(Debug)]
struct PodState {
    /// Fallback jail root: this process' cwd, canonicalized at construction.
    default_jail: PathBuf,
    /// Session id → jail root, bound from passing `session/new` traffic.
    jail_roots: HashMap<String, PathBuf>,
    /// `session/new` request id → cwd, awaiting the agent's response.
    pending_sessions: HashMap<String, PathBuf>,
    advertised: Option<AdvertisedClientCapabilities>,
    /// `initialize` request id forwarded to the child, awaiting its response.
    pending_initialize_id: Option<String>,
    /// First successful child `initialize` response, replayed to clients
    /// re-initializing on later socket eras (see module doc).
    initialize_replay: Option<InitializeReplay>,
}

/// Cached child `initialize` response for re-initialize replay.
#[derive(Debug, Clone)]
struct InitializeReplay {
    /// JSON-serialized request id of the initialize the child answered.
    request_id: String,
    /// Child response frame text, verbatim.
    response_text: String,
}

impl InitializeReplay {
    /// Response text for a fresh era's initialize: verbatim when the request
    /// id matches the cached one, reserialized with the new id otherwise.
    fn response_for(&self, fresh_id: &Value) -> String {
        if id_key(fresh_id).as_deref() == Some(self.request_id.as_str()) {
            return self.response_text.clone();
        }
        let Ok(mut response) = serde_json::from_str::<Value>(&self.response_text) else {
            return self.response_text.clone();
        };
        if let Some(object) = response.as_object_mut() {
            object.insert("id".to_owned(), fresh_id.clone());
        }
        serde_json::to_string(&response).unwrap_or_else(|_| self.response_text.clone())
    }
}

/// Client→agent frame disposition from [`PodCapabilities::handle_client_frame`].
#[derive(Debug)]
pub enum ClientFrameAction<'a> {
    /// Forward the frame to the child (possibly rewritten).
    Forward(Cow<'a, str>),
    /// Answer the client directly; the frame is not child-bound.
    Respond(String),
    /// Forward remaining batch entries and answer intercepted entries locally.
    ForwardAndRespond {
        /// Batch frame containing entries that still need to reach the child.
        forward: String,
        /// Batch response frame synthesized for intercepted entries.
        response: String,
    },
}

/// Agent→client frame disposition from [`PodCapabilities::handle_agent_frame`].
#[derive(Debug)]
pub enum AgentFrameAction<'a> {
    /// Forward the frame to the client (possibly with pod-served batch entries removed).
    Forward(Cow<'a, str>),
    /// Drop the frame because all request entries were served by the pod.
    Drop,
}

/// Pod-local ACP client-capability terminator shared by both transports.
///
/// Fast path: frames that are not `initialize` / `session/new` /
/// pod-terminated requests never touch JSON parsing here (substring gates
/// short-circuit before `serde_json`).
#[derive(Debug)]
pub struct PodCapabilities {
    state: Mutex<PodState>,
    auto_approve_permission: bool,
    /// Weak so it does not keep the child's write pump alive after shutdown;
    /// answered responses are dropped once the channel head is gone.
    child_write_tx: Option<mpsc::WeakSender<String>>,
}

impl PodCapabilities {
    /// Build the terminator, reading the auto-approve env knob and defaulting
    /// the fs jail fallback root to the current process directory.
    #[must_use]
    pub fn from_env(child_write_tx: &mpsc::Sender<String>) -> Self {
        Self::new(
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
            auto_approve_permission_from_env(),
            Some(child_write_tx.downgrade()),
        )
    }

    /// Build the terminator with explicit knobs (tests).
    #[must_use]
    pub fn new(
        default_jail: PathBuf,
        auto_approve_permission: bool,
        child_write_tx: Option<mpsc::WeakSender<String>>,
    ) -> Self {
        let default_jail = std::fs::canonicalize(&default_jail).unwrap_or(default_jail);
        Self {
            state: Mutex::new(PodState {
                default_jail,
                jail_roots: HashMap::new(),
                pending_sessions: HashMap::new(),
                advertised: None,
                pending_initialize_id: None,
                initialize_replay: None,
            }),
            auto_approve_permission,
            child_write_tx,
        }
    }

    /// Advertised capabilities as last seen on the client's `initialize`
    /// request (before the pod-side rewrite).
    pub async fn advertised_capabilities(&self) -> Option<AdvertisedClientCapabilities> {
        self.state.lock().await.advertised
    }

    /// Client→agent pre-forward hook. Frames that need no pod action come
    /// back as [`ClientFrameAction::Forward`] with the original text
    /// (borrowed) or a rewritten payload:
    ///
    /// - `initialize` requests are rewritten (fs capabilities for the child)
    ///   and forwarded; their ids are tracked so a successful child response
    ///   becomes the re-initialize replay cache. When the cache exists
    ///   (later socket era, same long-lived child), the frame is NOT
    ///   child-bound: the cached response comes back as
    ///   [`ClientFrameAction::Respond`] with the fresh request's id.
    /// - `session/new` requests record their `cwd` against the request id so
    ///   the agent's response can bind it (see [`Self::handle_agent_frame`]);
    ///   they pass through unchanged.
    pub async fn handle_client_frame<'a>(&self, text: &'a str) -> ClientFrameAction<'a> {
        if !text.contains("\"initialize\"") && !text.contains("\"session/new\"") {
            return ClientFrameAction::Forward(Cow::Borrowed(text));
        }
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            return ClientFrameAction::Forward(Cow::Borrowed(text));
        };
        if let Value::Array(values) = value {
            return self.handle_client_batch(text, values).await;
        }
        let Some(method) = value.get("method").and_then(Value::as_str) else {
            return ClientFrameAction::Forward(Cow::Borrowed(text));
        };
        match method {
            "initialize" => {
                let Some((rewritten, advertised)) = rewrite_initialize(value.clone()) else {
                    return ClientFrameAction::Forward(Cow::Borrowed(text));
                };
                let mut state = self.state.lock().await;
                state.advertised = Some(advertised);
                // Re-initialize replay: the child was already initialized on
                // an earlier era and must not see a second `initialize`.
                if let Some(replay) = &state.initialize_replay
                    && let Some(id) = value.get("id")
                {
                    return ClientFrameAction::Respond(replay.response_for(id));
                }
                if let Some(id) = value.get("id").and_then(id_key) {
                    state.pending_initialize_id = Some(id);
                }
                drop(state);
                match serde_json::to_string(&rewritten) {
                    Ok(frame) => ClientFrameAction::Forward(Cow::Owned(frame)),
                    Err(_) => ClientFrameAction::Forward(Cow::Borrowed(text)),
                }
            }
            "session/new" => {
                // Session ids are agent-assigned, so the cwd cannot be bound
                // yet: record it against the request id and let the agent's
                // response (which carries the sessionId) bind it.
                let id = value.get("id").and_then(id_key);
                let cwd = value
                    .get("params")
                    .and_then(|params| params.get("cwd"))
                    .and_then(Value::as_str)
                    .map(PathBuf::from);
                if let (Some(id), Some(cwd)) = (id, cwd) {
                    let cwd = std::fs::canonicalize(&cwd).unwrap_or(cwd);
                    self.state.lock().await.pending_sessions.insert(id, cwd);
                }
                ClientFrameAction::Forward(Cow::Borrowed(text))
            }
            _ => ClientFrameAction::Forward(Cow::Borrowed(text)),
        }
    }

    async fn handle_client_batch<'a>(
        &self,
        text: &'a str,
        values: Vec<Value>,
    ) -> ClientFrameAction<'a> {
        let mut forwarded = Vec::with_capacity(values.len());
        let mut responses = Vec::new();
        let mut changed = false;
        let mut forwarded_requires_response = false;

        for value in values {
            let Some(method) = value.get("method").and_then(Value::as_str) else {
                forwarded.push(value);
                continue;
            };
            let requires_response = value.get("id").is_some();
            match method {
                "initialize" => {
                    let Some((rewritten, advertised)) = rewrite_initialize(value.clone()) else {
                        forwarded_requires_response |= requires_response;
                        forwarded.push(value);
                        continue;
                    };
                    let mut state = self.state.lock().await;
                    state.advertised = Some(advertised);
                    if let Some(replay) = &state.initialize_replay
                        && let Some(id) = value.get("id")
                        && let Ok(response) =
                            serde_json::from_str::<Value>(&replay.response_for(id))
                    {
                        responses.push(response);
                        changed = true;
                        continue;
                    }
                    if let Some(id) = value.get("id").and_then(id_key) {
                        state.pending_initialize_id = Some(id);
                    }
                    changed = true;
                    forwarded_requires_response |= requires_response;
                    forwarded.push(rewritten);
                }
                "session/new" => {
                    self.track_session_new(&value).await;
                    forwarded_requires_response |= requires_response;
                    forwarded.push(value);
                }
                _ => {
                    forwarded_requires_response |= requires_response;
                    forwarded.push(value);
                }
            }
        }

        if !responses.is_empty() && forwarded_requires_response {
            let Ok(forward) = serde_json::to_string(&forwarded) else {
                return ClientFrameAction::Forward(Cow::Borrowed(text));
            };
            return ClientFrameAction::ForwardAndRespond {
                forward,
                response: Value::Array(responses).to_string(),
            };
        }

        if !changed {
            return ClientFrameAction::Forward(Cow::Borrowed(text));
        }

        match (forwarded.is_empty(), responses.is_empty()) {
            (false, true) => serde_json::to_string(&forwarded)
                .map_or(ClientFrameAction::Forward(Cow::Borrowed(text)), |frame| {
                    ClientFrameAction::Forward(Cow::Owned(frame))
                }),
            (true, false) => ClientFrameAction::Respond(Value::Array(responses).to_string()),
            (false, false) => {
                let Ok(forward) = serde_json::to_string(&forwarded) else {
                    return ClientFrameAction::Forward(Cow::Borrowed(text));
                };
                ClientFrameAction::ForwardAndRespond {
                    forward,
                    response: Value::Array(responses).to_string(),
                }
            }
            (true, true) => ClientFrameAction::Forward(Cow::Borrowed(text)),
        }
    }

    async fn track_session_new(&self, value: &Value) {
        let id = value.get("id").and_then(id_key);
        let cwd = value
            .get("params")
            .and_then(|params| params.get("cwd"))
            .and_then(Value::as_str)
            .map(PathBuf::from);
        if let (Some(id), Some(cwd)) = (id, cwd) {
            let cwd = std::fs::canonicalize(&cwd).unwrap_or(cwd);
            self.state.lock().await.pending_sessions.insert(id, cwd);
        }
    }

    /// Child→client hook. Two duties:
    ///
    /// - Agent→client requests the pod serves (`fs/*`, optionally
    ///   `session/request_permission`) are answered locally: a response
    ///   echoing the agent's request id is computed in a spawned task (so
    ///   slow fs answers never block the child stdout pump) and written
    ///   straight into the child's stdin. Such frames must NOT be forwarded
    ///   upstream.
    /// - Agent responses to a pending `session/new` bind the recorded cwd to
    ///   the agent-assigned session id for the per-session fs jail. These
    ///   frames always pass through upstream untouched.
    ///
    /// Returns whether to forward, rewrite, or drop the frame.
    pub async fn handle_agent_frame<'a>(self: &Arc<Self>, text: &'a str) -> AgentFrameAction<'a> {
        if !text.contains("\"id\"") {
            return AgentFrameAction::Forward(Cow::Borrowed(text));
        }
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            return AgentFrameAction::Forward(Cow::Borrowed(text));
        };
        if let Value::Array(values) = value {
            return self.handle_agent_batch(text, values).await;
        }
        let Some(id) = value.get("id") else {
            return AgentFrameAction::Forward(Cow::Borrowed(text));
        };
        let Some(method) = value.get("method").and_then(Value::as_str) else {
            // An agent response, not a request: cache a successful child
            // `initialize` response for later-era re-initialize replay, and
            // complete a pending session/new binding if this id is being
            // tracked. Error responses (no result.sessionId) simply drop the
            // pending entry; an errored `initialize` is never cached.
            if let Some(key) = id_key(id) {
                let mut state = self.state.lock().await;
                if state.pending_initialize_id.as_deref() == Some(key.as_str()) {
                    state.pending_initialize_id = None;
                    if value.get("result").is_some() {
                        state.initialize_replay = Some(InitializeReplay {
                            request_id: key.clone(),
                            response_text: text.to_owned(),
                        });
                    }
                }
                if let Some(cwd) = state.pending_sessions.remove(&key)
                    && let Some(session_id) = value
                        .get("result")
                        .and_then(|result| result.get("sessionId"))
                        .and_then(Value::as_str)
                {
                    state.jail_roots.insert(session_id.to_owned(), cwd);
                }
            }
            return AgentFrameAction::Forward(Cow::Borrowed(text));
        };
        let served = match method {
            "fs/read_text_file" | "fs/write_text_file" => true,
            "session/request_permission" => self.auto_approve_permission,
            _ => false,
        };
        if !served {
            return AgentFrameAction::Forward(Cow::Borrowed(text));
        }
        let params = value.get("params").cloned();
        let id = id.clone();
        let method = method.to_owned();
        let caps = Arc::clone(self);
        let Some(child_write) = self
            .child_write_tx
            .as_ref()
            .and_then(mpsc::WeakSender::upgrade)
        else {
            tracing::debug!(method, "pod capability request served after child shutdown");
            return AgentFrameAction::Drop;
        };
        tokio::spawn(async move {
            let response = caps.handle_request(&method, params).await.map_or_else(
                |(code, message)| {
                    json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": code, "message": message },
                    })
                },
                |result| json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            );
            if child_write.send(response.to_string()).await.is_err() {
                tracing::debug!(
                    method,
                    "pod capability response dropped: child stdin closed"
                );
            }
        });
        AgentFrameAction::Drop
    }

    async fn handle_agent_batch<'a>(
        self: &Arc<Self>,
        text: &'a str,
        values: Vec<Value>,
    ) -> AgentFrameAction<'a> {
        let mut forwarded = Vec::with_capacity(values.len());
        let mut served = Vec::new();

        for value in values {
            let Some(id) = value.get("id") else {
                forwarded.push(value);
                continue;
            };
            let Some(method) = value.get("method").and_then(Value::as_str) else {
                let response_text = value.to_string();
                self.observe_agent_response(id, &value, &response_text)
                    .await;
                forwarded.push(value);
                continue;
            };
            let should_serve = match method {
                "fs/read_text_file" | "fs/write_text_file" => true,
                "session/request_permission" => self.auto_approve_permission,
                _ => false,
            };
            if should_serve {
                served.push((id.clone(), method.to_owned(), value.get("params").cloned()));
            } else {
                forwarded.push(value);
            }
        }

        let served_empty = served.is_empty();
        if served_empty {
            return AgentFrameAction::Forward(Cow::Borrowed(text));
        }

        self.spawn_batch_responses(served);

        if forwarded.is_empty() {
            AgentFrameAction::Drop
        } else {
            serde_json::to_string(&forwarded)
                .map_or(AgentFrameAction::Forward(Cow::Borrowed(text)), |frame| {
                    AgentFrameAction::Forward(Cow::Owned(frame))
                })
        }
    }

    async fn observe_agent_response(&self, id: &Value, value: &Value, response_text: &str) {
        if let Some(key) = id_key(id) {
            let mut state = self.state.lock().await;
            if state.pending_initialize_id.as_deref() == Some(key.as_str()) {
                state.pending_initialize_id = None;
                if value.get("result").is_some() {
                    state.initialize_replay = Some(InitializeReplay {
                        request_id: key.clone(),
                        response_text: response_text.to_owned(),
                    });
                }
            }
            if let Some(cwd) = state.pending_sessions.remove(&key)
                && let Some(session_id) = value
                    .get("result")
                    .and_then(|result| result.get("sessionId"))
                    .and_then(Value::as_str)
            {
                state.jail_roots.insert(session_id.to_owned(), cwd);
            }
        }
    }

    fn spawn_batch_responses(self: &Arc<Self>, served: Vec<(Value, String, Option<Value>)>) {
        let Some(child_write) = self
            .child_write_tx
            .as_ref()
            .and_then(mpsc::WeakSender::upgrade)
        else {
            tracing::debug!("pod capability batch served after child shutdown");
            return;
        };
        let caps = Arc::clone(self);
        tokio::spawn(async move {
            let mut responses = Vec::with_capacity(served.len());
            for (id, method, params) in served {
                let response = caps.handle_request(&method, params).await.map_or_else(
                    |(code, message)| {
                        json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": { "code": code, "message": message },
                        })
                    },
                    |result| json!({ "jsonrpc": "2.0", "id": id, "result": result }),
                );
                responses.push(response);
            }
            if child_write
                .send(Value::Array(responses).to_string())
                .await
                .is_err()
            {
                tracing::debug!("pod capability batch response dropped: child stdin closed");
            }
        });
    }

    async fn handle_request(
        self: &Arc<Self>,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, (i64, String)> {
        match method {
            "fs/read_text_file" => self.read_text_file(params).await,
            "fs/write_text_file" => self.write_text_file(params).await,
            "session/request_permission" => Ok(Self::permission_auto_approve(params.as_ref())),
            _ => Err((
                JSONRPC_INVALID_PARAMS,
                format!("pod does not terminate method {method}"),
            )),
        }
    }

    // -- fs -----------------------------------------------------------------

    /// Jail root for an fs request: the session's bound root, falling back to
    /// the process-cwd default for an unknown or missing session id.
    async fn jail_root(&self, session_id: Option<&str>) -> PathBuf {
        let state = self.state.lock().await;
        session_id
            .and_then(|id| state.jail_roots.get(id).cloned())
            .unwrap_or_else(|| state.default_jail.clone())
    }

    /// Resolve `path` against the session's jail root and reject canonical
    /// escapes. The jail verdict always comes first: for write targets
    /// (`create_parents`) the nearest existing ancestor is canonicalized and
    /// checked, and parent directories are created only after the verdict
    /// passes, so a rejected write leaves nothing behind on disk.
    async fn jail_path(
        &self,
        session_id: Option<&str>,
        path: &str,
        create_parents: bool,
    ) -> Result<PathBuf, (i64, String)> {
        let jail_root = self.jail_root(session_id).await;
        let joined = if Path::new(path).is_absolute() {
            PathBuf::from(path)
        } else {
            jail_root.join(path)
        };
        let canonical_jail = tokio::fs::canonicalize(&jail_root)
            .await
            .unwrap_or(jail_root);
        if !create_parents {
            let canonical = tokio::fs::canonicalize(&joined).await.map_err(|error| {
                (
                    JSONRPC_INVALID_PARAMS,
                    format!("path {path} does not resolve: {error}"),
                )
            })?;
            if !canonical.starts_with(&canonical_jail) {
                return Err((
                    JSONRPC_INVALID_PARAMS,
                    format!("path {path} escapes the agent workspace jail"),
                ));
            }
            return Ok(canonical);
        }
        // Write target: the file itself may not exist yet. Canonicalize the
        // deepest existing ancestor instead, jail-check it, and only then
        // create the missing tail.
        let mut ancestor = joined.as_path();
        let mut missing: Vec<&std::ffi::OsStr> = Vec::new();
        let canonical_ancestor = loop {
            if let Ok(canonical) = tokio::fs::canonicalize(ancestor).await {
                break canonical;
            }
            let Some((name, parent)) = ancestor.file_name().zip(ancestor.parent()) else {
                return Err((
                    JSONRPC_INVALID_PARAMS,
                    format!("path {path} does not resolve"),
                ));
            };
            missing.push(name);
            ancestor = parent;
        };
        if !canonical_ancestor.starts_with(&canonical_jail) {
            return Err((
                JSONRPC_INVALID_PARAMS,
                format!("path {path} escapes the agent workspace jail"),
            ));
        }
        let mut resolved = canonical_ancestor;
        for component in missing.iter().rev() {
            resolved.push(component);
        }
        if let Some(parent) = resolved.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|error| {
                (
                    JSONRPC_INTERNAL_ERROR,
                    format!("create parent dir: {error}"),
                )
            })?;
        }
        Ok(resolved)
    }

    async fn read_text_file(&self, params: Option<Value>) -> Result<Value, (i64, String)> {
        let params = params.ok_or((JSONRPC_INVALID_PARAMS, "missing params".to_owned()))?;
        let path = param_str(&params, "path")?;
        let session_id = params.get("sessionId").and_then(Value::as_str);
        let line = params.get("line").and_then(Value::as_u64);
        let limit = params.get("limit").and_then(Value::as_u64);
        let canonical = self.jail_path(session_id, &path, false).await?;
        let content = tokio::fs::read_to_string(&canonical)
            .await
            .map_err(|error| (JSONRPC_INTERNAL_ERROR, format!("read: {error}")))?;
        Ok(json!({ "content": slice_lines(&content, line, limit) }))
    }

    async fn write_text_file(&self, params: Option<Value>) -> Result<Value, (i64, String)> {
        let params = params.ok_or((JSONRPC_INVALID_PARAMS, "missing params".to_owned()))?;
        let path = param_str(&params, "path")?;
        let content = param_str(&params, "content")?;
        let session_id = params.get("sessionId").and_then(Value::as_str);
        let canonical = self.jail_path(session_id, &path, true).await?;
        tokio::fs::write(&canonical, &content)
            .await
            .map_err(|error| (JSONRPC_INTERNAL_ERROR, format!("write: {error}")))?;
        Ok(json!({}))
    }

    // -- permission -----------------------------------------------------------

    /// Auto-approval: pick the first `allow_always` option, else the first
    /// `allow_once`, else the first option; `cancelled` when no options.
    fn permission_auto_approve(params: Option<&Value>) -> Value {
        let options = params
            .and_then(|params| params.get("options"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let option_id = pick_option(&options, "allow_always")
            .or_else(|| pick_option(&options, "allow_once"))
            .or_else(|| options.first().and_then(option_id));
        match option_id {
            Some(option_id) => {
                json!({ "outcome": { "outcome": "selected", "optionId": option_id } })
            }
            None => json!({ "outcome": { "outcome": "cancelled" } }),
        }
    }
}

fn option_id(option: &Value) -> Option<String> {
    option
        .get("optionId")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn pick_option(options: &[Value], kind: &str) -> Option<String> {
    options
        .iter()
        .find(|option| option.get("kind").and_then(Value::as_str) == Some(kind))
        .and_then(option_id)
}

fn param_str(params: &Value, name: &str) -> Result<String, (i64, String)> {
    params
        .get(name)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or((
            JSONRPC_INVALID_PARAMS,
            format!("missing string param {name}"),
        ))
}

/// Canonical map key for a JSON-RPC id: string and number ids stay distinct
/// (`"1"` maps to `"\"1\""`, `1` to `"1"`).
fn id_key(id: &Value) -> Option<String> {
    if id.is_string() || id.is_number() {
        Some(id.to_string())
    } else {
        None
    }
}

/// Apply a `line` (1-based) / `limit` (max lines) slice to file content.
fn slice_lines(content: &str, line: Option<u64>, limit: Option<u64>) -> String {
    if line.is_none() && limit.is_none() {
        return content.to_owned();
    }
    let start = line.map_or(0, |line| line.saturating_sub(1));
    let start = usize::try_from(start).unwrap_or(usize::MAX);
    let lines: Vec<&str> = content.split('\n').collect();
    let end = match limit {
        Some(limit) => start.saturating_add(usize::try_from(limit).unwrap_or(usize::MAX)),
        None => lines.len(),
    }
    .min(lines.len());
    let start = start.min(end);
    lines[start..end].join("\n")
}

/// Rewrite an `initialize` frame so the child always sees fs read/write
/// support (terminal is left untouched — the pod no longer terminates it).
/// Returns the rewritten frame plus the advertised (pre-rewrite) capability
/// flags; `None` when no rewrite was possible.
fn rewrite_initialize(value: Value) -> Option<(Value, AdvertisedClientCapabilities)> {
    let mut value = value;
    let params = value.get_mut("params")?.as_object_mut()?;
    let client_capabilities = params
        .entry("clientCapabilities".to_owned())
        .or_insert_with(|| json!({}));
    if !client_capabilities.is_object() {
        return None;
    }
    let advertised_caps = client_capabilities.clone();
    let map: &mut Map<String, Value> = client_capabilities.as_object_mut()?;
    let advertised = AdvertisedClientCapabilities {
        fs_read_text_file: advertised_caps
            .pointer("/fs/readTextFile")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        fs_write_text_file: advertised_caps
            .pointer("/fs/writeTextFile")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        terminal: advertised_caps
            .get("terminal")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    };
    let fs = map.entry("fs".to_owned()).or_insert_with(|| json!({}));
    if let Some(fs) = fs.as_object_mut() {
        fs.insert("readTextFile".to_owned(), json!(true));
        fs.insert("writeTextFile".to_owned(), json!(true));
    }
    Some((value, advertised))
}

fn truthy_env(name: &str) -> bool {
    std::env::var(name).is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

fn auto_approve_permission_from_env() -> bool {
    if truthy_env(HYPER_ACP_AUTO_APPROVE_PERMISSION_ENV) {
        return true;
    }
    std::env::var(HYPER_ACP_PERMISSION_MODE_ENV).is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "auto" | "bypass-permissions" | "bypasspermissions"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Unique per-test directory under the system temp dir.
    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!("hyper-acp-caps-{name}-{nanos}"));
            std::fs::create_dir_all(&root).unwrap();
            Self(std::fs::canonicalize(root).unwrap())
        }

        fn child(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            drop(std::fs::remove_dir_all(&self.0));
        }
    }

    fn session_new_frame(id: &Value, cwd: &Path) -> String {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "session/new",
            "params": { "cwd": cwd, "mcpServers": [] },
        })
        .to_string()
    }

    async fn bind_session(caps: &Arc<PodCapabilities>, id: &Value, cwd: &Path, session_id: &str) {
        let request = session_new_frame(id, cwd);
        assert!(matches!(
            caps.handle_client_frame(&request).await,
            ClientFrameAction::Forward(Cow::Borrowed(_))
        ));
        let response = json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "sessionId": session_id },
        })
        .to_string();
        assert!(matches!(
            caps.handle_agent_frame(&response).await,
            AgentFrameAction::Forward(_)
        ));
    }

    #[test]
    fn slice_lines_honors_line_and_limit() {
        let content = "a\nb\nc\nd\n";
        assert_eq!(slice_lines(content, None, None), "a\nb\nc\nd\n");
        assert_eq!(slice_lines(content, Some(2), None), "b\nc\nd\n");
        assert_eq!(slice_lines(content, Some(2), Some(2)), "b\nc");
        assert_eq!(slice_lines(content, None, Some(2)), "a\nb");
        assert_eq!(slice_lines(content, Some(99), Some(5)), "");
    }

    #[test]
    fn initialize_rewrite_sets_fs_caps_only_and_preserves_fields() {
        let frame = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": 1,
                "clientCapabilities": {
                    "fs": {"readTextFile": false},
                    "custom": "kept"
                },
                "clientInfo": {"name": "sdk", "version": "0"},
            },
        });
        let (rewritten, advertised) = rewrite_initialize(frame).unwrap();
        assert_eq!(rewritten["params"]["protocolVersion"], json!(1));
        assert_eq!(rewritten["params"]["clientInfo"]["name"], json!("sdk"));
        assert_eq!(
            rewritten["params"]["clientCapabilities"]["fs"]["readTextFile"],
            json!(true)
        );
        assert_eq!(
            rewritten["params"]["clientCapabilities"]["fs"]["writeTextFile"],
            json!(true)
        );
        // Terminal support is NOT advertised to the child.
        assert!(
            rewritten["params"]["clientCapabilities"]
                .get("terminal")
                .is_none()
        );
        assert_eq!(
            rewritten["params"]["clientCapabilities"]["custom"],
            json!("kept")
        );
        assert!(!advertised.fs_read_text_file);
        assert!(!advertised.fs_write_text_file);
        assert!(!advertised.terminal);
    }

    fn initialize_frame(id: &Value) -> String {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "initialize",
            "params": { "protocolVersion": 1, "clientCapabilities": {} },
        })
        .to_string()
    }

    async fn answer_initialize_from_child(caps: &Arc<PodCapabilities>, id: &Value) {
        let response = json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": 1,
                "agentCapabilities": { "loadSession": true },
                "agentInfo": { "name": "fake-acp", "version": "0" },
            },
        })
        .to_string();
        assert!(matches!(
            caps.handle_agent_frame(&response).await,
            AgentFrameAction::Forward(_)
        ));
    }

    #[tokio::test]
    async fn reinitialize_is_answered_from_the_cached_child_response() {
        let caps = Arc::new(PodCapabilities::new(PathBuf::from("/tmp"), false, None));
        let first = initialize_frame(&json!(1));

        // First era: the initialize is rewritten and forwarded, and its id
        // is tracked for the child response.
        let ClientFrameAction::Forward(rewritten) = caps.handle_client_frame(&first).await else {
            panic!("first initialize must forward");
        };
        assert_eq!(
            rewritten.parse::<Value>().unwrap()["params"]["clientCapabilities"]["fs"]["readTextFile"],
            json!(true)
        );
        answer_initialize_from_child(&caps, &json!(1)).await;

        // Later era, same request id (fresh client connection): the child
        // sees nothing and the cached response is replayed verbatim.
        let second = initialize_frame(&json!(1));
        let ClientFrameAction::Respond(response) = caps.handle_client_frame(&second).await else {
            panic!("re-initialize must be answered from cache");
        };
        let parsed: Value = response.parse().unwrap();
        assert_eq!(parsed["id"], json!(1));
        assert_eq!(parsed["result"]["protocolVersion"], json!(1));
        assert_eq!(
            parsed["result"]["agentCapabilities"]["loadSession"],
            json!(true)
        );

        // Later era, different request id: the replay swaps the id and keeps
        // the result payload intact.
        let third = initialize_frame(&json!("re-1"));
        let ClientFrameAction::Respond(response) = caps.handle_client_frame(&third).await else {
            panic!("re-initialize must be answered from cache");
        };
        let parsed: Value = response.parse().unwrap();
        assert_eq!(parsed["id"], json!("re-1"));
        assert_eq!(
            parsed["result"]["agentCapabilities"]["loadSession"],
            json!(true)
        );
    }

    #[tokio::test]
    async fn batched_initialize_rewrites_and_mixed_replay_is_not_split() {
        let caps = Arc::new(PodCapabilities::new(PathBuf::from("/tmp"), false, None));
        let first = json!([
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": { "protocolVersion": 1, "clientCapabilities": {} },
            },
            {"jsonrpc": "2.0", "id": 2, "method": "session/load", "params": {"sessionId": "s1"}}
        ])
        .to_string();

        let ClientFrameAction::Forward(rewritten) = caps.handle_client_frame(&first).await else {
            panic!("initial batch must forward");
        };
        let parsed: Value = rewritten.parse().unwrap();
        assert_eq!(
            parsed[0]["params"]["clientCapabilities"]["fs"]["readTextFile"],
            json!(true)
        );
        assert_eq!(parsed[1]["method"], json!("session/load"));

        let child_response = json!([
            {
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "protocolVersion": 1,
                    "agentCapabilities": { "loadSession": true },
                    "agentInfo": { "name": "fake-acp", "version": "0" },
                },
            },
            {"jsonrpc": "2.0", "id": 2, "result": {"sessionId": "s1"}}
        ])
        .to_string();
        assert!(matches!(
            caps.handle_agent_frame(&child_response).await,
            AgentFrameAction::Forward(_)
        ));

        let second = json!([
            {
                "jsonrpc": "2.0",
                "id": "fresh-init",
                "method": "initialize",
                "params": { "protocolVersion": 1, "clientCapabilities": {} },
            },
            {"jsonrpc": "2.0", "id": 3, "method": "session/load", "params": {"sessionId": "s1"}}
        ])
        .to_string();
        let ClientFrameAction::ForwardAndRespond { forward, response } =
            caps.handle_client_frame(&second).await
        else {
            panic!("mixed replay/pass-through request batch must forward and respond");
        };
        let forwarded: Value = forward.parse().unwrap();
        assert_eq!(forwarded.as_array().unwrap().len(), 1);
        assert_eq!(forwarded[0]["id"], json!(3));
        let parsed: Value = response.parse().unwrap();
        let responses = parsed.as_array().unwrap();
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0]["id"], json!("fresh-init"));
        assert!(responses[0].get("result").is_some());
    }

    #[tokio::test]
    async fn client_batch_with_only_observation_side_effects_preserves_raw_bytes() {
        let temp = TestDir::new("client-observation-batch");
        let caps = Arc::new(PodCapabilities::new(temp.0.clone(), false, None));
        let frame = format!(
            r#"[{{"jsonrpc":"2.0","id":7,"method":"session/new","params":{{"cwd":"{}"}}}},{{"jsonrpc":"2.0","method":"initialized"}}]"#,
            temp.0.display()
        );

        let ClientFrameAction::Forward(forwarded) = caps.handle_client_frame(&frame).await else {
            panic!("observation-only batch must forward");
        };
        assert!(matches!(forwarded, Cow::Borrowed(_)));
        assert_eq!(forwarded.as_ref(), frame);
        assert!(caps.state.lock().await.pending_sessions.contains_key("7"));
    }

    #[tokio::test]
    async fn agent_batch_with_only_observation_side_effects_preserves_raw_bytes() {
        let caps = Arc::new(PodCapabilities::new(PathBuf::from("/tmp"), false, None));
        let initialize = initialize_frame(&json!(1));
        assert!(matches!(
            caps.handle_client_frame(&initialize).await,
            ClientFrameAction::Forward(_)
        ));
        let frame = r#"[{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"fake-acp","version":"0"},"agentCapabilities":{}}},{"jsonrpc":"2.0","id":2,"result":{"ok":true}}]"#;

        let AgentFrameAction::Forward(forwarded) = caps.handle_agent_frame(frame).await else {
            panic!("observation-only agent batch must forward");
        };
        assert!(matches!(forwarded, Cow::Borrowed(_)));
        assert_eq!(forwarded.as_ref(), frame);
        assert!(caps.state.lock().await.initialize_replay.is_some());
    }

    #[tokio::test]
    async fn reinitialize_forwards_until_the_first_response_is_cached() {
        let caps = Arc::new(PodCapabilities::new(PathBuf::from("/tmp"), false, None));

        // No cache yet: even a second initialize forwards (first response
        // never arrived).
        let frame = initialize_frame(&json!(1));
        assert!(matches!(
            caps.handle_client_frame(&frame).await,
            ClientFrameAction::Forward(_)
        ));
        assert!(matches!(
            caps.handle_client_frame(&frame).await,
            ClientFrameAction::Forward(_)
        ));

        // An errored initialize is never cached.
        let error = r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"boom"}}"#;
        assert!(matches!(
            caps.handle_agent_frame(error).await,
            AgentFrameAction::Forward(_)
        ));
        assert!(matches!(
            caps.handle_client_frame(&frame).await,
            ClientFrameAction::Forward(_)
        ));

        answer_initialize_from_child(&caps, &json!(1)).await;
        assert!(matches!(
            caps.handle_client_frame(&frame).await,
            ClientFrameAction::Respond(_)
        ));
    }

    #[test]
    fn permission_auto_approve_prefers_allow_always() {
        let result = PodCapabilities::permission_auto_approve(Some(&json!({
            "options": [
                {"optionId": "o1", "kind": "reject_once", "name": "no"},
                {"optionId": "o2", "kind": "allow_once", "name": "once"},
                {"optionId": "o3", "kind": "allow_always", "name": "always"},
            ],
        })));
        assert_eq!(result["outcome"]["outcome"], json!("selected"));
        assert_eq!(result["outcome"]["optionId"], json!("o3"));

        let cancelled = PodCapabilities::permission_auto_approve(Some(&json!({ "options": [] })));
        assert_eq!(cancelled["outcome"]["outcome"], json!("cancelled"));
    }

    #[tokio::test]
    async fn jail_path_rejects_escapes() {
        let temp = TestDir::new("escapes");
        let caps = PodCapabilities::new(temp.0.clone(), false, None);
        assert!(
            caps.jail_path(None, "../../etc/passwd", false)
                .await
                .is_err()
        );
        assert!(caps.jail_path(None, "/etc/passwd", false).await.is_err());
        std::fs::write(temp.child("ok.txt"), "hi").unwrap();
        assert!(caps.jail_path(None, "ok.txt", false).await.is_ok());
    }

    #[tokio::test]
    async fn rejected_write_creates_nothing_outside_the_jail() {
        let temp = TestDir::new("write-escape");
        let outside = temp.child("outside");
        std::fs::create_dir_all(&outside).unwrap();
        let jail = temp.child("jail");
        std::fs::create_dir_all(&jail).unwrap();
        let caps = PodCapabilities::new(jail.clone(), false, None);

        let error = caps
            .jail_path(None, "../outside/newdir/evil.txt", true)
            .await
            .unwrap_err();
        assert_eq!(error.0, JSONRPC_INVALID_PARAMS);
        assert!(!outside.join("newdir").exists());
        assert!(!outside.join("newdir/evil.txt").exists());

        let error = caps
            .jail_path(None, "../../somewhere-else/evil.txt", true)
            .await
            .unwrap_err();
        assert_eq!(error.0, JSONRPC_INVALID_PARAMS);
        assert!(!temp.0.join("somewhere-else").exists());
    }

    #[tokio::test]
    async fn allowed_write_creates_parents_inside_the_jail() {
        let temp = TestDir::new("write-ok");
        let caps = PodCapabilities::new(temp.0.clone(), false, None);
        let resolved = caps
            .jail_path(None, "new/sub/file.txt", true)
            .await
            .unwrap();
        assert_eq!(resolved, temp.child("new/sub/file.txt"));
        assert!(temp.child("new/sub").is_dir());
    }

    #[tokio::test]
    async fn fs_jail_is_per_session() {
        let temp = TestDir::new("per-session");
        let default_jail = temp.child("default");
        let jail_one = temp.child("one");
        let jail_two = temp.child("two");
        for dir in [&default_jail, &jail_one, &jail_two] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::write(jail_one.join("a.txt"), "one").unwrap();
        std::fs::write(jail_two.join("b.txt"), "two").unwrap();
        std::fs::write(default_jail.join("d.txt"), "default").unwrap();

        let caps = Arc::new(PodCapabilities::new(default_jail.clone(), false, None));
        // Numeric and string request ids both correlate.
        bind_session(&caps, &json!(1), &jail_one, "s1").await;
        bind_session(&caps, &json!("req-2"), &jail_two, "s2").await;

        // Each session reads only its own root.
        assert_eq!(
            caps.jail_path(Some("s1"), "a.txt", false).await.unwrap(),
            jail_one.join("a.txt")
        );
        assert!(caps.jail_path(Some("s1"), "b.txt", false).await.is_err());
        assert_eq!(
            caps.jail_path(Some("s2"), "b.txt", false).await.unwrap(),
            jail_two.join("b.txt")
        );
        // The default jail itself does not leak into a bound session.
        assert!(caps.jail_path(Some("s1"), "d.txt", false).await.is_err());
        // A second session/new for the same id rebinds the jail.
        bind_session(&caps, &json!(3), &jail_two, "s1").await;
        assert_eq!(
            caps.jail_path(Some("s1"), "b.txt", false).await.unwrap(),
            jail_two.join("b.txt")
        );
    }

    #[tokio::test]
    async fn unknown_session_id_falls_back_to_process_cwd_jail() {
        let temp = TestDir::new("unknown-session");
        std::fs::write(temp.child("d.txt"), "default").unwrap();
        let caps = PodCapabilities::new(temp.0.clone(), false, None);

        // Unknown session ids and missing session ids both use the default.
        assert_eq!(
            caps.jail_path(Some("nope"), "d.txt", false).await.unwrap(),
            temp.child("d.txt")
        );
        assert_eq!(
            caps.jail_path(None, "d.txt", false).await.unwrap(),
            temp.child("d.txt")
        );
    }

    #[tokio::test]
    async fn session_new_error_response_does_not_bind() {
        let temp = TestDir::new("session-error");
        let caps = Arc::new(PodCapabilities::new(temp.0.clone(), false, None));
        let request = session_new_frame(&json!(7), &temp.0);
        drop(caps.handle_client_frame(&request).await);
        let error_response = json!({
            "jsonrpc": "2.0",
            "id": 7,
            "error": { "code": -32603, "message": "no" },
        })
        .to_string();
        assert!(matches!(
            caps.handle_agent_frame(&error_response).await,
            AgentFrameAction::Forward(_)
        ));
        assert!(caps.state.lock().await.jail_roots.is_empty());
        assert!(caps.state.lock().await.pending_sessions.is_empty());
    }

    #[tokio::test]
    async fn session_new_without_cwd_or_id_is_not_tracked() {
        let temp = TestDir::new("session-untracked");
        let caps = Arc::new(PodCapabilities::new(temp.0.clone(), false, None));
        for frame in [
            json!({"jsonrpc": "2.0", "method": "session/new", "params": {"cwd": "/tmp"}}),
            json!({"jsonrpc": "2.0", "id": 1, "method": "session/new", "params": {"mcpServers": []}}),
        ] {
            drop(caps.handle_client_frame(&frame.to_string()).await);
        }
        assert!(caps.state.lock().await.pending_sessions.is_empty());
    }

    #[tokio::test]
    async fn write_text_file_uses_the_bound_session_jail() {
        let temp = TestDir::new("write-handler");
        let default_jail = temp.child("default");
        let jail = temp.child("session");
        std::fs::create_dir_all(&default_jail).unwrap();
        std::fs::create_dir_all(&jail).unwrap();
        let caps = Arc::new(PodCapabilities::new(default_jail.clone(), false, None));
        bind_session(&caps, &json!(1), &jail, "s1").await;

        caps.write_text_file(Some(json!({
            "sessionId": "s1",
            "path": "note/deep/file.txt",
            "content": "hello",
        })))
        .await
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(jail.join("note/deep/file.txt")).unwrap(),
            "hello"
        );
        assert!(!default_jail.join("note").exists());

        let result = caps
            .read_text_file(Some(json!({
                "sessionId": "s1",
                "path": "note/deep/file.txt",
            })))
            .await
            .unwrap();
        assert_eq!(result["content"], json!("hello"));
    }

    #[tokio::test]
    async fn fs_requests_are_served_and_terminal_verbs_pass_through() {
        let temp = TestDir::new("served-methods");
        let caps = Arc::new(PodCapabilities::new(temp.0.clone(), false, None));
        let fs_request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "fs/read_text_file",
            "params": {"sessionId": "s1", "path": "x"},
        })
        .to_string();
        assert!(matches!(
            caps.handle_agent_frame(&fs_request).await,
            AgentFrameAction::Drop
        ));
        for method in [
            "terminal/create",
            "terminal/new",
            "terminal/output",
            "terminal/wait_for_exit",
            "terminal/kill",
            "terminal/release",
            "hypercli.experimental/raw",
        ] {
            let frame = json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": method,
                "params": {},
            })
            .to_string();
            assert!(
                matches!(
                    caps.handle_agent_frame(&frame).await,
                    AgentFrameAction::Forward(_)
                ),
                "{method} must pass through upstream"
            );
        }
        // Permission only gets served when the env knob is on.
        let permission = json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "session/request_permission",
            "params": {"options": []},
        })
        .to_string();
        assert!(matches!(
            caps.handle_agent_frame(&permission).await,
            AgentFrameAction::Forward(_)
        ));
        let auto = Arc::new(PodCapabilities::new(temp.0.clone(), true, None));
        assert!(matches!(
            auto.handle_agent_frame(&permission).await,
            AgentFrameAction::Drop
        ));
    }

    #[tokio::test]
    async fn mixed_fs_and_pass_through_agent_batch_forwards_and_answers_locally() {
        let temp = TestDir::new("batch-fs-read");
        std::fs::write(temp.child("note.txt"), "one\ntwo\nthree").unwrap();
        let (tx, mut rx) = mpsc::channel(1);
        let caps = Arc::new(PodCapabilities::new(
            temp.0.clone(),
            false,
            Some(tx.downgrade()),
        ));
        let frame = json!([
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "fs/read_text_file",
                "params": {"path": "note.txt", "line": 2, "limit": 1},
            },
            {"jsonrpc": "2.0", "id": 2, "method": "terminal/output", "params": {}}
        ])
        .to_string();

        let AgentFrameAction::Forward(forwarded) = caps.handle_agent_frame(&frame).await else {
            panic!("mixed agent batch must forward pass-through entries");
        };
        let forwarded: Value = forwarded.parse().unwrap();
        assert_eq!(forwarded.as_array().unwrap().len(), 1);
        assert_eq!(forwarded[0]["id"], json!(2));
        let response = rx.recv().await.unwrap();
        let parsed: Value = response.parse().unwrap();
        let responses = parsed.as_array().unwrap();
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0]["id"], json!(1));
        assert_eq!(responses[0]["result"]["content"], json!("two"));
    }

    #[tokio::test]
    async fn pure_batched_fs_read_text_file_returns_one_batch_response() {
        let temp = TestDir::new("batch-fs-read-pure");
        std::fs::write(temp.child("note.txt"), "one\ntwo\nthree").unwrap();
        let (tx, mut rx) = mpsc::channel(1);
        let caps = Arc::new(PodCapabilities::new(
            temp.0.clone(),
            false,
            Some(tx.downgrade()),
        ));
        let frame = json!([
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "fs/read_text_file",
                "params": {"path": "note.txt", "line": 2, "limit": 1},
            },
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "fs/read_text_file",
                "params": {"path": "note.txt", "line": 3, "limit": 1},
            }
        ])
        .to_string();

        assert!(matches!(
            caps.handle_agent_frame(&frame).await,
            AgentFrameAction::Drop
        ));

        let response = rx.recv().await.unwrap();
        let response: Value = response.parse().unwrap();
        assert_eq!(response.as_array().unwrap().len(), 2);
        assert_eq!(response[0]["id"], json!(1));
        assert_eq!(response[0]["result"]["content"], json!("two"));
        assert_eq!(response[1]["id"], json!(2));
        assert_eq!(response[1]["result"]["content"], json!("three"));
    }
}
