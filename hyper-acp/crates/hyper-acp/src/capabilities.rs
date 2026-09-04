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
//!   default. Setting `HYPER_ACP_AUTO_APPROVE_PERMISSION` to a truthy value
//!   (`1`, `true`, `yes`, `on`) makes the pod answer locally with the first
//!   allow option (`allow_always` preferred over `allow_once`), or
//!   `cancelled` when the request carries no options.
//!
//! Every other frame — including unknown/exotic methods — is pumped byte
//! unchanged, because the client may implement verbs the pod does not know.
//! Pod served requests echo back the agent's own request id, which is
//! disjoint by construction from the client→agent id space.

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Map, Value, json};
use tokio::sync::{Mutex, mpsc};

/// Environment variable controlling pod-local permission auto-approval.
pub const HYPER_ACP_AUTO_APPROVE_PERMISSION_ENV: &str = "HYPER_ACP_AUTO_APPROVE_PERMISSION";

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
            truthy_env(HYPER_ACP_AUTO_APPROVE_PERMISSION_ENV),
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

    /// Client→agent pre-forward hook. Returns the frame to forward: the
    /// original text (borrowed) or a rewritten `initialize` payload.
    /// `session/new` requests record their `cwd` against the request id so
    /// the agent's response can bind it (see [`Self::handle_agent_frame`]);
    /// they pass through unchanged.
    pub async fn rewrite_client_frame<'a>(&self, text: &'a str) -> Cow<'a, str> {
        if !text.contains("\"initialize\"") && !text.contains("\"session/new\"") {
            return Cow::Borrowed(text);
        }
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            return Cow::Borrowed(text);
        };
        let Some(method) = value.get("method").and_then(Value::as_str) else {
            return Cow::Borrowed(text);
        };
        match method {
            "initialize" => {
                let Some((rewritten, advertised)) = rewrite_initialize(value) else {
                    return Cow::Borrowed(text);
                };
                self.state.lock().await.advertised = Some(advertised);
                match serde_json::to_string(&rewritten) {
                    Ok(frame) => Cow::Owned(frame),
                    Err(_) => Cow::Borrowed(text),
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
                Cow::Borrowed(text)
            }
            _ => Cow::Borrowed(text),
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
    /// Returns whether the frame was pod-served.
    pub async fn handle_agent_frame(self: &Arc<Self>, text: &str) -> bool {
        if !text.contains("\"id\"") {
            return false;
        }
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            return false;
        };
        let Some(id) = value.get("id") else {
            return false;
        };
        let Some(method) = value.get("method").and_then(Value::as_str) else {
            // An agent response, not a request: complete a pending
            // session/new binding if this id is being tracked. Error
            // responses (no result.sessionId) simply drop the pending entry.
            if let Some(key) = id_key(id) {
                let mut state = self.state.lock().await;
                if let Some(cwd) = state.pending_sessions.remove(&key)
                    && let Some(session_id) = value
                        .get("result")
                        .and_then(|result| result.get("sessionId"))
                        .and_then(Value::as_str)
                {
                    state.jail_roots.insert(session_id.to_owned(), cwd);
                }
            }
            return false;
        };
        let served = match method {
            "fs/read_text_file" | "fs/write_text_file" => true,
            "session/request_permission" => self.auto_approve_permission,
            _ => false,
        };
        if !served {
            return false;
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
            return true;
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
        true
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
            caps.rewrite_client_frame(&request).await,
            Cow::Borrowed(_)
        ));
        let response = json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "sessionId": session_id },
        })
        .to_string();
        assert!(!caps.handle_agent_frame(&response).await);
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
        drop(caps.rewrite_client_frame(&request).await);
        let error_response = json!({
            "jsonrpc": "2.0",
            "id": 7,
            "error": { "code": -32603, "message": "no" },
        })
        .to_string();
        assert!(!caps.handle_agent_frame(&error_response).await);
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
            drop(caps.rewrite_client_frame(&frame.to_string()).await);
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
        assert!(caps.handle_agent_frame(&fs_request).await);
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
                !caps.handle_agent_frame(&frame).await,
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
        assert!(!caps.handle_agent_frame(&permission).await);
        let auto = Arc::new(PodCapabilities::new(temp.0.clone(), true, None));
        assert!(auto.handle_agent_frame(&permission).await);
    }
}
