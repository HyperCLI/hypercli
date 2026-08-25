//! Hyper-ACP surface: a boot-scoped durable activity log plus a live
//! WebSocket stream with app-level connect auth.
//!
//! When `HYPER_ACP_LOG` names a sqlite file path, every observer event is
//! recorded durably for the current boot (WAL sqlite; see [`ActivityLog`]).
//! When `HYPER_ACP_WS_LISTEN` names a numeric `ip:port`, the harness serves
//! the **raw, unpaced, untrimmed** observer stream over a local WebSocket:
//! one serialized `ObserverEvent` JSON per text message, with the same
//! camelCase shape as `observer.rs`'s `ObserverEvent`. Both feed from the
//! single observer emit funnel in `observer.rs`, *before* the relay
//! publisher's pacing (167ms / 90-per-minute), chunk coalescing (500ms /
//! 60KB), and size elision (3KB retained leaf bytes). Relay publishing is
//! unchanged, and neither the relay observer nor one hyper-acp consumer
//! requires the other.
//!
//! Per-connection contract:
//!
//! - Optional connect auth (below), then **full-session replay**: every
//!   recorded event of the current boot session, oldest first (empty when
//!   no log is configured or the db is unavailable at connect time), then
//!   exactly one `{"type":"replay_end"}` frame, then live frames.
//! - Connect ordering closes the record/publish race: the server subscribes
//!   to the live tap, then pushes a flush barrier through the same fifo
//!   drain channel and takes the replay upper-bound snapshot only after the
//!   barrier's ack — any event recorded before the subscribe is provably
//!   durable, so replay can no longer silently miss it.
//! - A client that falls more than [`HYPER_ACP_BROADCAST_CAP`] live
//!   events behind is skipped ahead and told with one
//!   `{"type":"replay_gap","dropped":n}` frame.
//! - A slow or stalled consumer is disconnected quietly. It must never block
//!   other clients or the harness.
//!
//! App-level auth and bind rule (the platform edge route runs
//! `auth: false`, so the token IS the boundary when configured):
//!
//! - `HYPER_ACP_WS_TOKEN` (`--hyper-acp-ws-token`): when set, every
//!   connection must authenticate — either with an
//!   `Authorization: Bearer <token>` header on the upgrade request, or with
//!   a first text frame `{"type":"auth","token":"<token>"}` within
//!   [`AUTH_FRAME_TIMEOUT`]. Success is answered with exactly one
//!   `{"type":"auth_ok"}` frame; failure/timeout closes with code 4401
//!   (reason `unauthorized`) and nothing else. When unset, no auth is
//!   required at all (desktop local client compatibility) and `config.rs`
//!   restricts the bind address to loopback.
//! - `HYPER_ACP_CORS_ORIGIN` (`--hyper-acp-cors-origin`): optional
//!   comma-separated browser `Origin` allowlist enforced at the upgrade —
//!   a mismatched `Origin` gets HTTP 403; requests without an `Origin`
//!   header (server-side clients) always pass. Applied independently of the
//!   token.
//! - Logs never carry tokens, `Origin` values, or frame content.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::stream::SplitStream;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio_tungstenite::tungstenite::handshake::server as ws_handshake;
use tokio_tungstenite::tungstenite::http;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

/// Capacity of the hyper-acp live broadcast channel. A client whose
/// connection task falls this far behind receives a `replay_gap` frame and
/// is skipped ahead to the newest buffered event.
pub(crate) const HYPER_ACP_BROADCAST_CAP: usize = 4_096;

/// Per-frame write timeout for production connections. A client that stops
/// draining is disconnected quietly once a single write exceeds it.
const SEND_TIMEOUT: Duration = Duration::from_secs(5);

/// Bound on the first-frame auth wait. A connection stuck in the auth wait
/// is dropped (4401 close) once this elapses; other connections never wait.
const AUTH_FRAME_TIMEOUT: Duration = Duration::from_secs(3);

/// WebSocket close code for failed or missing first-frame auth
/// (application-level "unauthorized"; 4401 is in the private-use range).
const AUTH_CLOSE_CODE: u16 = 4401;

/// Close reason carried by the 4401 close frame. Static text; tokens and
/// frame content never appear here or anywhere in logs.
const AUTH_CLOSE_REASON: &str = "unauthorized";

/// Exact frame marking the end of the replay phase. Deliberately not an
/// `ObserverEvent` envelope, so clients can branch on it without parsing
/// observer fields.
pub(crate) const REPLAY_END_FRAME: &str = r#"{"type":"replay_end"}"#;

/// Exact auth-success frame, sent exactly once before replay starts when the
/// client authenticated via the first-frame path.
pub(crate) const AUTH_OK_FRAME: &str = r#"{"type":"auth_ok"}"#;

/// Frame sent to a client that lost live events to broadcast lag.
pub(crate) fn replay_gap_frame(dropped: u64) -> String {
    format!(r#"{{"type":"replay_gap","dropped":{dropped}}}"#)
}

/// Shared hyper-acp tap: a pre-serialized live broadcast fed exactly
/// once per observer event, at emit time. Durable replay for new
/// connections is served by [`ActivityLog`], not by this tap.
pub(crate) struct Tap {
    tx: broadcast::Sender<String>,
}

impl Tap {
    pub(crate) fn new(broadcast_cap: usize) -> Self {
        let (tx, _) = broadcast::channel(broadcast_cap.max(1));
        Self { tx }
    }

    /// Feed one pre-serialized observer event. Never blocks the caller on
    /// client behavior: the broadcast overwrites oldest frames for lagging
    /// receivers instead of applying backpressure to the harness.
    pub(crate) fn publish(&self, line: String) {
        let _ = self.tx.send(line);
    }

    pub(crate) fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }
}

/// Escaping-aware exact-substring redactor for protocol-level crypto
/// material, applied at the observer emit boundary to the one serialized
/// line feeding BOTH the live tap and the activity log; the relay path is
/// untouched (it consumes the original `ObserverEvent`). Built once at
/// startup; entries that are empty or shorter than 12 chars are dropped
/// defensively so a degenerate entry cannot over-redact the stream. No
/// regex, no per-match logging, and deliberately no `Debug`: the denylist
/// contents are secret (mirrors [`AuthPolicy`]'s discipline).
pub(crate) struct Redactor {
    /// (match, replacement) pairs, JSON-escaping-aware — see `new`.
    pairs: Vec<(String, String)>,
}

impl Redactor {
    /// Build from a raw denylist, filtering empty/<12-char entries (on the
    /// RAW form) and transforming each survivor into (match, replacement)
    /// pairs that keep the redacted line JSON-valid in both embedding forms:
    ///
    /// - An entry that parses as a JSON **array or object** (the NIP-OA auth
    ///   tag is a JSON-array string) gets two pairs: its canonical compact
    ///   serialization (its form when embedded as an actual JSON value) ⇒
    ///   the same-shape marker holder ([`redacted_shape_holder`]); and the
    ///   JSON-string-body escaping of the RAW entry text (its form when
    ///   embedded inside a string payload field) ⇒ that same holder with
    ///   `"` → `\"`, i.e. its in-string escaped form.
    /// - Every other entry (plain strings like nsec/hex/token — including
    ///   JSON-scalar parses, which are not value-form materials) gets one
    ///   pair: raw ⇒ `[redacted]`. Such strings only ever occur inside a
    ///   JSON string context, where a bare marker stays valid.
    pub(crate) fn new(denylist: Vec<String>) -> Self {
        let mut pairs = Vec::new();
        for entry in denylist {
            if entry.len() < 12 {
                continue;
            }
            match serde_json::from_str::<serde_json::Value>(&entry) {
                // Only quote-BEARING containers get redaction pairs at all.
                // A quote-free container (`[1,2,3,...]`) has identical raw and
                // string-body forms, and NO replacement text is safe in both
                // positions: bare `[redacted]` breaks JSON in value position,
                // quoted `"[redacted]"` breaks it in string position. Since
                // output-side substring redaction cannot distinguish position
                // without parsing, such entries are skip-listed (documented
                // unredactable class; unreachable for the current denylist,
                // which is alnum scalars + a quote-bearing auth tag).
                Ok(value @ (serde_json::Value::Array(_) | serde_json::Value::Object(_)))
                    if serde_json::to_string(&value)
                        .expect("value round-trip serialization")
                        .contains('"') =>
                {
                    let holder = redacted_shape_holder(&value);
                    let value_match =
                        serde_json::to_string(&value).expect("value round-trip serialization");
                    // Standalone JSON-value embedding ⇒ in-shape holder…
                    pairs.push((value_match, holder.clone()));
                    // …string-embedded occurrence ⇒ its in-string escaped form.
                    pairs.push((json_string_body(&entry), escape_quotes(&holder)));
                }
                Ok(serde_json::Value::Array(_) | serde_json::Value::Object(_)) => {
                    // Quote-free container: skip-listed (see note above).
                }
                _ => pairs.push((entry, "[redacted]".to_string())),
            }
        }
        Self { pairs }
    }

    /// Replace every occurrence of every pair's match string with its
    /// replacement, in place.
    pub(crate) fn redact(&self, line: &mut String) {
        for (match_part, replacement) in &self.pairs {
            if line.contains(match_part.as_str()) {
                *line = line.replace(match_part.as_str(), replacement);
            }
        }
    }
}

/// Same JSON shape as `value`, but holding only the redaction marker:
/// arrays → `["[redacted]"]`, objects → `{"redacted":true}`, anything else
/// (scalars — not expected among value-form denylist entries) → `null`.
fn redacted_shape_holder(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Array(_) => r#"["[redacted]"]"#.to_string(),
        serde_json::Value::Object(_) => r#"{"redacted":true}"#.to_string(),
        _ => "null".to_string(),
    }
}

/// The body of `text` as it appears inside a JSON string in a serialized
/// line: `serde_json::to_string` quoting minus the two outer quotes.
fn json_string_body(text: &str) -> String {
    let quoted = serde_json::to_string(text).expect("string serialization");
    quoted[1..quoted.len() - 1].to_string()
}

/// The in-string escaped form of a replacement marker; markers only ever
/// contain `"` as a JSON-special character.
fn escape_quotes(replacement: &str) -> String {
    replacement.replace('"', "\\\"")
}

// ---------------------------------------------------------------------------
// Boot-scoped durable activity log (HYPER_ACP_LOG)
// ---------------------------------------------------------------------------

/// Capacity of the emit-side channel feeding the drain task. Full ⇒ the
/// newest line is dropped (counted + occasionally debug-logged); the harness
/// NEVER blocks on logging.
const LOG_CHANNEL_CAP: usize = 4_096;

/// One drain transaction flushes at most this many lines…
const LOG_BATCH_LINES: usize = 256;

/// …or flushes early after this much idle time while topping up a batch.
const LOG_BATCH_IDLE: Duration = Duration::from_millis(25);

/// Bound for the graceful drain finish at shutdown; exceeded ⇒ abort.
const LOG_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);

/// Bound for EACH phase of the connect-time flush barrier: enqueueing the
/// barrier, then waiting for its ack. Exceeded ⇒ the replay snapshot
/// proceeds degraded (one debug line); a connection never hangs on a
/// saturated or wedged drain.
const FLUSH_BARRIER_TIMEOUT: Duration = Duration::from_millis(250);

/// Rows read per prepared-statement step during WS session replay.
const REPLAY_CHUNK_ROWS: i64 = 256;

/// One item in the drain fifo: a serialized event line, or a flush barrier
/// whose ack — sent right after the first `flush_batch` covering it, in fifo
/// order — proves every line accepted into the channel before it is durable.
enum LogItem {
    Line(String),
    Barrier(oneshot::Sender<()>),
}

/// Cheap, clonable emit-side handle for the activity log. `record` is fully
/// non-blocking: `try_send` into the bounded drain channel; a full channel
/// drops the line and nothing more. `flush` is the connect-time barrier a
/// replay snapshot pairs with (see below). The disabled handle (default)
/// discards for free, so the emit path pays nothing when no log is configured.
#[derive(Clone, Default)]
pub(crate) struct LogHandle {
    inner: Option<Arc<LogChannel>>,
}

struct LogChannel {
    tx: mpsc::Sender<LogItem>,
    dropped: AtomicU64,
}

impl LogHandle {
    fn enabled(tx: mpsc::Sender<LogItem>) -> Self {
        Self {
            inner: Some(Arc::new(LogChannel {
                tx,
                dropped: AtomicU64::new(0),
            })),
        }
    }

    /// Inert handle: `record` is a silent no-op. Production never needs one
    /// (a failed open simply skips the attach), but tests use it to pin the
    /// free no-op path.
    #[cfg(test)]
    pub(crate) fn disabled() -> Self {
        Self::default()
    }

    /// Whether a live drain task backs this handle.
    #[cfg(test)]
    pub(crate) fn is_enabled(&self) -> bool {
        self.inner.is_some()
    }

    /// Queue one pre-serialized observer event for durable recording.
    /// Never blocks the caller, never panics.
    pub(crate) fn record(&self, line: String) {
        let Some(channel) = &self.inner else {
            return;
        };
        match channel.tx.try_send(LogItem::Line(line)) {
            Ok(()) => {}
            Err(mpsc::error::TrySendError::Full(_)) => {
                let dropped = channel.dropped.fetch_add(1, Ordering::Relaxed) + 1;
                // Occasional, never spammy: first drop and every 512th after.
                if dropped == 1 || dropped % 512 == 0 {
                    tracing::debug!(
                        target: "hyper-acp",
                        dropped,
                        "activity log channel full — dropping newest lines"
                    );
                }
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                // Drain is down (post-shutdown); harness is exiting. No-op.
            }
        }
    }

    /// Flush barrier for the connect-time replay snapshot. Resolves once
    /// every line **accepted into** the drain channel before this call is
    /// durable (lines dropped on a full channel are lost by design and
    /// provable by nothing). Both phases — enqueueing the barrier, then the
    /// ack wait — are bounded by [`FLUSH_BARRIER_TIMEOUT`]; a saturating
    /// channel or a missed ack resolves degraded with one debug line, never
    /// a hang. Resolves immediately when disabled, or after shutdown: the
    /// drain's lossless final pass already persisted everything it accepted.
    pub(crate) async fn flush(&self) {
        let Some(channel) = &self.inner else {
            return;
        };
        let (ack_tx, ack_rx) = oneshot::channel();
        match channel
            .tx
            .send_timeout(LogItem::Barrier(ack_tx), FLUSH_BARRIER_TIMEOUT)
            .await
        {
            Ok(()) => {
                if !matches!(
                    tokio::time::timeout(FLUSH_BARRIER_TIMEOUT, ack_rx).await,
                    Ok(Ok(()))
                ) {
                    // Elapsed, or the drain dropped the ack (dead/aborted).
                    tracing::debug!(
                        target: "hyper-acp",
                        "flush barrier ack missed its bound — replay proceeds degraded"
                    );
                }
            }
            Err(mpsc::error::SendTimeoutError::Timeout(_)) => {
                tracing::debug!(
                    target: "hyper-acp",
                    "drain channel saturated — flush barrier not enqueued, replay proceeds degraded"
                );
            }
            Err(mpsc::error::SendTimeoutError::Closed(_)) => {
                // Drain shut down: the barrier is trivially satisfied.
            }
        }
    }
}

/// Read side of the activity log for one boot session: the db path plus the
/// session id, enough for a WS connection task to open its own private
/// sqlite read connection and page the session rows (sync, local, WAL).
/// Carries the live [`LogHandle`] so the connection task can run a flush
/// barrier before snapshotting the replay upper bound (see module docs).
#[derive(Clone)]
pub(crate) struct ReplaySource {
    path: PathBuf,
    session_id: String,
    log: LogHandle,
}

impl ReplaySource {
    fn open_reader(&self) -> rusqlite::Result<rusqlite::Connection> {
        rusqlite::Connection::open(&self.path)
    }

    /// Flush barrier passthrough; see [`LogHandle::flush`].
    pub(crate) async fn flush(&self) {
        self.log.flush().await;
    }
}

/// Failure opening or initializing the activity log. Never propagated past
/// startup — `lib.rs` logs it and continues with logging disabled.
#[derive(Debug, thiserror::Error)]
pub(crate) enum ActivityLogError {
    #[error("create parent directories: {0}")]
    CreateDirs(#[source] std::io::Error),
    #[error("open or initialize sqlite database: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// Boot-scoped durable activity log: one sqlite file per setup, one fresh
/// `sessions` row per boot (`id = uuid v4`), every observer event appended to
/// `events` by the drain task. Recording is via [`LogHandle`] (non-blocking);
/// WS replay reads go through [`ReplaySource`] private connections.
pub(crate) struct ActivityLog {
    handle: LogHandle,
    replay: ReplaySource,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
    drain: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl ActivityLog {
    /// Create parent dirs, open the db, initialize the schema, insert the
    /// fresh boot-session row, and spawn the drain task. Any failure is
    /// returned to the caller, which must warn and continue unlogged.
    pub(crate) fn open(path: &Path) -> Result<ActivityLog, ActivityLogError> {
        let path = path.to_path_buf();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(ActivityLogError::CreateDirs)?;
            }
        }
        let conn = rusqlite::Connection::open(&path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, started_at TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, line TEXT NOT NULL);
             CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, id);
             PRAGMA journal_mode=WAL;",
        )?;
        let session_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO sessions(id, started_at) VALUES (?1, ?2)",
            rusqlite::params![session_id, chrono::Utc::now().to_rfc3339()],
        )?;
        let (tx, rx) = mpsc::channel(LOG_CHANNEL_CAP);
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let drain = tokio::spawn(drain_loop(rx, shutdown_rx, conn, session_id.clone()));
        let handle = LogHandle::enabled(tx);
        Ok(ActivityLog {
            replay: ReplaySource {
                path,
                session_id,
                log: handle.clone(),
            },
            handle,
            shutdown: Mutex::new(Some(shutdown_tx)),
            drain: Mutex::new(Some(drain)),
        })
    }

    /// Emit-side handle to attach to the observer.
    pub(crate) fn handle(&self) -> LogHandle {
        self.handle.clone()
    }

    /// WS replay source scoped to the current boot session.
    pub(crate) fn replay_source(&self) -> ReplaySource {
        self.replay.clone()
    }

    /// Best-effort shutdown: signal the drain to flush its final batch and
    /// finish (bounded), aborting it if the bound expires. Second and later
    /// calls return immediately. Note the observer's cloned [`LogHandle`]
    /// outlives this (its `OnceLock` is never cleared), so the drain loop
    /// terminates on the explicit signal rather than sender-drop — after
    /// shutdown, late `record` calls no-op on the closed channel.
    pub(crate) async fn shutdown(&self) {
        if let Ok(mut slot) = self.shutdown.lock() {
            if let Some(signal) = slot.take() {
                let _ = signal.send(());
            }
        }
        let drain = match self.drain.lock() {
            Ok(mut slot) => slot.take(),
            Err(error) => {
                tracing::warn!(target: "hyper-acp", "drain lock poisoned: {error}");
                None
            }
        };
        if let Some(drain) = drain {
            let abort = drain.abort_handle();
            match tokio::time::timeout(LOG_SHUTDOWN_TIMEOUT, drain).await {
                Ok(Ok(())) => {}
                Ok(Err(join_error)) => {
                    tracing::debug!(
                        target: "hyper-acp",
                        "activity log drain task ended with error: {join_error}"
                    );
                }
                Err(_) => {
                    tracing::warn!(
                        target: "hyper-acp",
                        "activity log drain missed shutdown bound — aborting"
                    );
                    abort.abort();
                }
            }
        }
    }
}

/// Drain loop: batch up to [`LOG_BATCH_LINES`] lines per transaction, or
/// flush early after [`LOG_BATCH_IDLE`] with nothing new queued. On sender
/// drop or the shutdown signal, the loop drains everything still queued
/// (lossless hand-off — a fired shutdown must never discard pending events),
/// then exits.
///
/// Db errors never stop the drain: a wedged database must not wedge the
/// emit path. The error streak is warned on at the 1st and 8th consecutive
/// failure only; batches keep running (and keep failing fast) regardless.
async fn drain_loop(
    mut rx: mpsc::Receiver<LogItem>,
    mut shutdown: oneshot::Receiver<()>,
    mut conn: rusqlite::Connection,
    session_id: String,
) {
    let mut batch: Vec<String> = Vec::with_capacity(LOG_BATCH_LINES);
    let mut consecutive_errors: u32 = 0;
    let mut shutdown_fired = false;
    loop {
        if shutdown_fired {
            // Final lossless pass: pull everything still queued without
            // sleeping, flushing in batch-sized transactions, then exit.
            match rx.try_recv() {
                Ok(LogItem::Line(line)) => {
                    batch.push(line);
                    if batch.len() == LOG_BATCH_LINES {
                        flush_batch(&mut conn, &session_id, &mut batch, &mut consecutive_errors);
                    }
                }
                Ok(LogItem::Barrier(ack)) => {
                    flush_batch(&mut conn, &session_id, &mut batch, &mut consecutive_errors);
                    let _ = ack.send(());
                }
                Err(_) => {
                    flush_batch(&mut conn, &session_id, &mut batch, &mut consecutive_errors);
                    return;
                }
            }
            continue;
        }
        tokio::select! {
            maybe = rx.recv() => match maybe {
                Some(LogItem::Line(line)) => batch.push(line),
                Some(LogItem::Barrier(ack)) => {
                    flush_batch(&mut conn, &session_id, &mut batch, &mut consecutive_errors);
                    let _ = ack.send(());
                    continue;
                }
                None => break,
            },
            _ = &mut shutdown => { shutdown_fired = true; continue; }
        }
        // Top up the batch until full or briefly idle; a fired shutdown or a
        // closed channel during top-up stops queuing and exits below. A
        // barrier flushes what precedes it immediately — bounded connect
        // latency beats batch efficiency here — then topping up resumes.
        let mut channel_closed = false;
        let idle = tokio::time::sleep(LOG_BATCH_IDLE);
        tokio::pin!(idle);
        while batch.len() < LOG_BATCH_LINES {
            tokio::select! {
                maybe = rx.recv() => match maybe {
                    Some(LogItem::Line(line)) => batch.push(line),
                    Some(LogItem::Barrier(ack)) => {
                        flush_batch(&mut conn, &session_id, &mut batch, &mut consecutive_errors);
                        let _ = ack.send(());
                    }
                    None => { channel_closed = true; break; }
                },
                _ = &mut shutdown => { shutdown_fired = true; break; }
                _ = &mut idle => break,
            }
        }
        flush_batch(&mut conn, &session_id, &mut batch, &mut consecutive_errors);
        if channel_closed {
            return;
        }
    }
    flush_batch(&mut conn, &session_id, &mut batch, &mut consecutive_errors);
}

/// Append one batch in a single transaction. Never fails the loop.
fn flush_batch(
    conn: &mut rusqlite::Connection,
    session_id: &str,
    batch: &mut Vec<String>,
    consecutive_errors: &mut u32,
) {
    if batch.is_empty() {
        return;
    }
    let result = (|| -> rusqlite::Result<()> {
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare("INSERT INTO events(session_id, line) VALUES (?1, ?2)")?;
            for line in batch.iter() {
                stmt.execute(rusqlite::params![session_id, line])?;
            }
        }
        tx.commit()
    })();
    match result {
        Ok(()) => *consecutive_errors = 0,
        Err(error) => {
            *consecutive_errors += 1;
            if *consecutive_errors == 1 || *consecutive_errors == 8 {
                tracing::warn!(
                    target: "hyper-acp",
                    error = %error,
                    streak = *consecutive_errors,
                    "activity log write failed — drain keeps running"
                );
            }
        }
    }
    batch.clear();
}

/// App-level connect auth policy for the hyper-acp WebSocket.
///
/// No `Debug` impl: the token is a secret and must never reach logs.
#[derive(Clone, Default)]
pub(crate) struct AuthPolicy {
    /// Connect token. `Some` requires every client to authenticate (bearer
    /// header or first-frame `{"type":"auth","token":…}`); `None` disables
    /// auth entirely (desktop local client compatibility).
    pub(crate) token: Option<String>,
    /// Browser `Origin` allowlist. Empty disables the CORS check; requests
    /// without an `Origin` header always pass.
    pub(crate) cors_origins: Vec<String>,
}

/// Bind the hyper-acp listener and spawn the accept loop. Returns the
/// bound address (useful with port 0 in tests) and the accept-loop task.
/// `replay` is the boot-session log source; `None` ⇒ empty replay phase.
///
/// The bind-address rule (loopback, or any numeric address when a token is
/// set) is enforced in `config.rs`; the debug_assert here is a tripwire for
/// future callers that bypass config validation.
pub(crate) async fn bind_and_spawn(
    addr: SocketAddr,
    tap: Arc<Tap>,
    auth: AuthPolicy,
    replay: Option<ReplaySource>,
) -> std::io::Result<(SocketAddr, tokio::task::JoinHandle<()>)> {
    debug_assert!(addr.ip().is_loopback() || auth.token.is_some());
    let listener = TcpListener::bind(addr).await?;
    let bound = listener.local_addr()?;
    // One startup line; per-frame content is never logged.
    tracing::info!(%bound, "hyper-acp ws listening");
    let task = tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _peer)) => {
                    tokio::spawn(serve_connection(
                        stream,
                        tap.clone(),
                        auth.clone(),
                        replay.clone(),
                        SEND_TIMEOUT,
                    ));
                }
                Err(error) => {
                    tracing::debug!(target: "hyper-acp", "accept failed: {error}");
                }
            }
        }
    });
    Ok((bound, task))
}

/// Serve one hyper-acp client: optional CORS/token auth, full-session
/// replay from the activity log, one [`REPLAY_END_FRAME`] marker, then live
/// frames until close, lag-skip, or write stall. Exits quietly — every
/// failure/receival path just returns, and all client waits live inside
/// this per-connection task.
pub(crate) async fn serve_connection<S>(
    stream: S,
    tap: Arc<Tap>,
    auth: AuthPolicy,
    replay: Option<ReplaySource>,
    send_timeout: Duration,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    // The upgrade callback inspects the HTTP request BEFORE the upgrade
    // completes: CORS is enforced here (rejection writes the 403 response
    // and the handshake then fails gracefully), and a matching bearer header
    // is recorded so the connection skips the first-frame auth below.
    let bearer_ok = Arc::new(AtomicBool::new(false));
    let callback = {
        let bearer_ok = bearer_ok.clone();
        let token = auth.token.clone();
        let cors_origins = auth.cors_origins.clone();
        // The Err-variant shape is mandated by tungstenite's AcceptCallback.
        #[allow(clippy::result_large_err)]
        move |request: &ws_handshake::Request,
              response: ws_handshake::Response|
              -> Result<ws_handshake::Response, ws_handshake::ErrorResponse> {
            if !cors_origins.is_empty() {
                if let Some(origin) = request.headers().get(http::header::ORIGIN) {
                    let allowed = origin
                        .to_str()
                        .map(|value| origin_allowed(&cors_origins, value))
                        .unwrap_or(false);
                    if !allowed {
                        return Err(forbidden_response());
                    }
                }
            }
            if let (Some(token), Some(header)) = (
                token.as_deref(),
                request.headers().get(http::header::AUTHORIZATION),
            ) {
                if bearer_matches(header, token) {
                    bearer_ok.store(true, Ordering::Relaxed);
                }
            }
            Ok(response)
        }
    };
    let ws = match tokio_tungstenite::accept_hdr_async(stream, callback).await {
        Ok(ws) => ws,
        Err(error) => {
            // A CORS rejection has already written its response; this log
            // carries no header values.
            tracing::debug!(target: "hyper-acp", "handshake failed: {error}");
            return;
        }
    };
    let (mut sink, mut incoming) = ws.split();

    // Token auth, phase two: a connection without a matching bearer header
    // must authenticate with its FIRST text frame, bounded by the auth wait.
    if let Some(token) = auth.token.as_deref() {
        if !bearer_ok.load(Ordering::Relaxed) {
            match first_frame_auth(&mut incoming, token).await {
                FirstFrameAuth::Ok => {
                    if !send_frame(&mut sink, AUTH_OK_FRAME.to_string(), send_timeout).await {
                        return;
                    }
                }
                FirstFrameAuth::Dropped => return,
                FirstFrameAuth::Failed(reason) => {
                    // Single auth-failure log, static reason only.
                    tracing::debug!(target: "hyper-acp", "auth failed: {reason}");
                    let close = Message::Close(Some(CloseFrame {
                        code: AUTH_CLOSE_CODE.into(),
                        reason: AUTH_CLOSE_REASON.into(),
                    }));
                    let _ = tokio::time::timeout(send_timeout, sink.send(close)).await;
                    return;
                }
            }
        }
    }

    // Subscribe BEFORE replaying, so an event emitted during the replay
    // phase lands in the live receiver, the activity log, or both. The
    // replay/live overlap is deduplicated by clients on (timestamp, seq).
    let mut rx = tap.subscribe();

    if let Some(source) = &replay {
        // Flush barrier: emit records to the log BEFORE publishing to the
        // tap, and a row lags the live broadcast by up to the drain batch
        // latency — an event recorded just before the subscribe above would
        // otherwise be invisible to both this receiver (published already)
        // and the replay snapshot (not yet durable). The barrier proves
        // everything recorded pre-subscribe is on disk (bounded; degraded
        // paths are logged, never a hang).
        source.flush().await;
        if !stream_session_replay(&mut sink, source, send_timeout).await {
            return;
        }
    }
    if !send_frame(&mut sink, REPLAY_END_FRAME.to_string(), send_timeout).await {
        return;
    }

    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(line) => {
                        if !send_frame(&mut sink, line, send_timeout).await {
                            return;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(dropped)) => {
                        tracing::debug!(
                            target: "hyper-acp",
                            dropped,
                            "client lagged — skipping ahead"
                        );
                        if !send_frame(&mut sink, replay_gap_frame(dropped), send_timeout).await {
                            return;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => return,
                }
            }
            frame = incoming.next() => {
                match frame {
                    Some(Ok(Message::Close(_))) | None => return,
                    // Ping/pong are handled by tungstenite; any other inbound
                    // frame carries no meaning for this read-only stream.
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        tracing::debug!(target: "hyper-acp", "read failed: {error}");
                        return;
                    }
                }
            }
        }
    }
}

/// One bounded write. Returns `false` when the connection is finished —
/// write failure, close, or a stalled client hitting the send timeout.
async fn send_frame<S>(
    sink: &mut futures_util::stream::SplitSink<WebSocketStream<S>, Message>,
    line: String,
    send_timeout: Duration,
) -> bool
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    match tokio::time::timeout(send_timeout, sink.send(Message::Text(line.into()))).await {
        Ok(Ok(())) => true,
        Ok(Err(error)) => {
            tracing::debug!(target: "hyper-acp", "write failed: {error}");
            false
        }
        Err(_) => {
            tracing::debug!(target: "hyper-acp", "write stalled — disconnecting client");
            false
        }
    }
}

/// Stream the full current-boot-session replay from the activity log,
/// oldest first, in bounded chunks. Rusqlite is sync — acceptable for a
/// local sqlite WAL; the runtime gets a yield between chunks. The snapshot
/// is bounded at the session's max row id as of connect, so live appends
/// arriving mid-replay cannot extend it forever (the client already
/// receives those via the broadcast and dedups on (timestamp, seq)).
///
/// Returns `false` only when the client went away mid-replay. An
/// unavailable/uninitialized db logs a debug line and replays nothing —
/// the connection still gets the marker and live frames.
async fn stream_session_replay<S>(
    sink: &mut futures_util::stream::SplitSink<WebSocketStream<S>, Message>,
    source: &ReplaySource,
    send_timeout: Duration,
) -> bool
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let conn = match source.open_reader() {
        Ok(conn) => conn,
        Err(error) => {
            tracing::debug!(target: "hyper-acp", "replay source unavailable: {error}");
            return true;
        }
    };
    let max_id: i64 = match conn.query_row(
        "SELECT COALESCE(MAX(id), 0) FROM events WHERE session_id = ?1",
        rusqlite::params![source.session_id],
        |row| row.get(0),
    ) {
        Ok(max_id) => max_id,
        Err(error) => {
            tracing::debug!(target: "hyper-acp", "replay snapshot failed: {error}");
            return true;
        }
    };
    let mut after_id: i64 = 0;
    while after_id < max_id {
        // One scoped, freshly prepared statement per chunk: `Statement` is
        // !Send and must not live across the yield/send awaits below. The
        // re-prepare cost is trivial against a local sqlite.
        let chunk: Vec<(i64, String)> = {
            let mut stmt = match conn.prepare(
                "SELECT id, line FROM events \
                 WHERE session_id = ?1 AND id > ?2 AND id <= ?3 \
                 ORDER BY id LIMIT ?4",
            ) {
                Ok(stmt) => stmt,
                Err(error) => {
                    tracing::debug!(target: "hyper-acp", "replay query failed: {error}");
                    return true;
                }
            };
            let mapped = stmt.query_map(
                rusqlite::params![source.session_id, after_id, max_id, REPLAY_CHUNK_ROWS],
                |row| Ok((row.get(0)?, row.get(1)?)),
            );
            match mapped {
                Ok(rows) => rows.filter_map(|row| row.ok()).collect(),
                Err(error) => {
                    tracing::debug!(target: "hyper-acp", "replay read failed: {error}");
                    return true;
                }
            }
        };
        if chunk.is_empty() {
            break;
        }
        // Yield between chunks so a long replay never hogs the executor.
        tokio::task::yield_now().await;
        for (id, line) in chunk {
            after_id = id;
            if !send_frame(sink, line, send_timeout).await {
                return false;
            }
        }
    }
    true
}

/// Outcome of the first-frame token check.
enum FirstFrameAuth {
    /// The client sent a valid `{"type":"auth","token":…}` frame.
    Ok,
    /// The client closed or disconnected before any auth frame — drop quietly.
    Dropped,
    /// Auth failed; the payload is a static, log-safe reason.
    Failed(&'static str),
}

/// Wait up to [`AUTH_FRAME_TIMEOUT`] for the client's first text frame to be
/// exactly `{"type":"auth","token":"<token>"}`.
async fn first_frame_auth<S>(
    incoming: &mut SplitStream<WebSocketStream<S>>,
    token: &str,
) -> FirstFrameAuth
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    match tokio::time::timeout(AUTH_FRAME_TIMEOUT, incoming.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => {
            if auth_frame_matches(text.as_str(), token) {
                FirstFrameAuth::Ok
            } else {
                FirstFrameAuth::Failed("bad auth frame")
            }
        }
        Ok(Some(Ok(Message::Close(_)))) | Ok(None) => FirstFrameAuth::Dropped,
        Ok(Some(Ok(_))) => FirstFrameAuth::Failed("non-text first frame"),
        // A transport/protocol error means the close below may not even be
        // deliverable; treat like a dropped connection.
        Ok(Some(Err(_))) => FirstFrameAuth::Dropped,
        Err(_) => FirstFrameAuth::Failed("no auth frame within 3s"),
    }
}

/// The first-frame auth shape: a JSON object with `type == "auth"` and
/// `token` equal to the configured token. Extra keys are tolerated; the two
/// checks above are the whole contract.
fn auth_frame_matches(text: &str, token: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return false;
    };
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("type").and_then(|v| v.as_str()) == Some("auth")
        && object.get("token").and_then(|v| v.as_str()) == Some(token)
}

/// Header must be exactly `Bearer <token>`: case-insensitive scheme, exactly
/// one separating space, case-sensitive token compare. `split_once(' ')`
/// leaves any extra space inside `credential`, which then fails `== token`.
fn bearer_matches(header: &http::HeaderValue, token: &str) -> bool {
    let Ok(value) = header.to_str() else {
        return false;
    };
    let Some((scheme, credential)) = value.split_once(' ') else {
        return false;
    };
    scheme.eq_ignore_ascii_case("bearer") && credential == token
}

/// Exact-match check of a request `Origin` against the configured allowlist,
/// after trimming and removing any single trailing `/` from both sides (the
/// configured entries and the header value), so `https://app.example/` in
/// config and `https://app.example` in the request match.
fn origin_allowed(origins: &[String], origin: &str) -> bool {
    let candidate = strip_one_trailing_slash(origin.trim());
    origins
        .iter()
        .any(|entry| strip_one_trailing_slash(entry) == candidate)
}

fn strip_one_trailing_slash(value: &str) -> &str {
    value.strip_suffix('/').unwrap_or(value)
}

/// 403 with a short plain body, returned from the upgrade callback; the
/// status must be non-success for tungstenite to treat it as a rejection.
fn forbidden_response() -> ws_handshake::ErrorResponse {
    const BODY: &str = "origin not allowed";
    http::Response::builder()
        .status(http::StatusCode::FORBIDDEN)
        .header(http::header::CONTENT_TYPE, "text/plain")
        .header(http::header::CONTENT_LENGTH, BODY.len())
        .body(Some(BODY.to_string()))
        .expect("static 403 response builds")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::observer::{ObserverContext, ObserverHandle};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    /// Token used across the auth tests (never a real secret).
    const TEST_TOKEN: &str = "test-token-abc123";

    fn handle_with_tap(broadcast_cap: usize) -> (ObserverHandle, Arc<Tap>) {
        let handle = ObserverHandle::in_process();
        let tap = Arc::new(Tap::new(broadcast_cap));
        assert!(handle.attach_hyper_acp(tap.clone()));
        (handle, tap)
    }

    /// Unique per-test scratch dir under the OS temp dir (hermetic sqlite).
    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            Self(
                std::env::temp_dir()
                    .join(format!("buzz-acp-hyper-acp-test-{}", uuid::Uuid::new_v4())),
            )
        }

        fn db_path(&self) -> PathBuf {
            self.0.join("activity.db")
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Open a fresh boot-scoped log in the scratch dir and attach it to the
    /// observer; emit flows to log + tap from here on.
    fn open_log(handle: &ObserverHandle, dir: &TestDir) -> ActivityLog {
        let log = ActivityLog::open(&dir.db_path()).expect("open activity log");
        assert!(handle.attach_activity_log(log.handle()));
        log
    }

    /// All session rows for the boot session of `log`, oldest first.
    fn read_lines(dir: &TestDir, log: &ActivityLog) -> Vec<String> {
        let conn = rusqlite::Connection::open(dir.db_path()).expect("open db read connection");
        let mut stmt = conn
            .prepare("SELECT line FROM events WHERE session_id = ?1 ORDER BY id")
            .expect("prepare read");
        stmt.query_map(rusqlite::params![log.replay_source().session_id], |row| {
            row.get(0)
        })
        .expect("query lines")
        .collect::<Result<Vec<String>, _>>()
        .expect("row decode")
    }

    fn emit_n(handle: &ObserverHandle, n: u64) {
        for i in 0..n {
            handle.emit(
                "test_event",
                None,
                &ObserverContext::default(),
                serde_json::json!({ "i": i }),
            );
        }
    }

    fn frame_seq(frame: &serde_json::Value) -> u64 {
        frame.get("seq").and_then(|v| v.as_u64()).expect("seq")
    }

    async fn next_text<S>(ws: &mut WebSocketStream<S>) -> String
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    {
        let message = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .expect("timed out waiting for hyper-acp frame")
            .expect("hyper-acp stream closed early")
            .expect("hyper-acp frame error");
        message.to_text().expect("expected text frame").to_string()
    }

    fn token_auth() -> AuthPolicy {
        AuthPolicy {
            token: Some(TEST_TOKEN.to_string()),
            cors_origins: vec![],
        }
    }

    /// Spin a real loopback listener on an ephemeral port. The accept-task
    /// handle is intentionally detached (the test runtime cleans it up).
    async fn listen(tap: Arc<Tap>, auth: AuthPolicy, replay: Option<ReplaySource>) -> SocketAddr {
        bind_and_spawn("127.0.0.1:0".parse().unwrap(), tap, auth, replay)
            .await
            .expect("bind hyper-acp listener")
            .0
    }

    /// Build a client upgrade request with extra HTTP headers (`Origin`,
    /// `Authorization`). The base request comes from tungstenite's
    /// `IntoClientRequest`, so all mandatory WS handshake headers are present.
    fn client_request(
        url: &str,
        headers: &[(http::header::HeaderName, &str)],
    ) -> http::Request<()> {
        let mut request = url
            .to_string()
            .into_client_request()
            .expect("valid client request");
        for (name, value) in headers {
            request.headers_mut().insert(
                name.clone(),
                http::HeaderValue::from_str(value).expect("header value"),
            );
        }
        request
    }

    /// Send a first-frame `{"type":"auth","token":…}` on an upgraded client.
    async fn send_auth_frame<S>(ws: &mut WebSocketStream<S>, token: &str)
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    {
        ws.send(Message::Text(
            serde_json::json!({ "type": "auth", "token": token })
                .to_string()
                .into(),
        ))
        .await
        .expect("send auth frame");
    }

    /// The next received message must be the 4401 `unauthorized` close —
    /// meaning the server sent nothing (no replay, no auth_ok) first. The
    /// 7s guard covers the production 3s auth wait for the timeout test.
    async fn expect_unauthorized_close<S>(ws: &mut WebSocketStream<S>)
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    {
        let message = tokio::time::timeout(Duration::from_secs(7), ws.next())
            .await
            .expect("4401 close must arrive")
            .expect("stream ended before the close frame")
            .expect("frame read error");
        match message {
            Message::Close(Some(frame)) => {
                assert_eq!(u16::from(frame.code), 4401, "close code");
                assert_eq!(frame.reason.as_str(), "unauthorized");
            }
            other => panic!("expected 4401 close, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn tap_receives_events_immediately_and_in_order() {
        let (handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
        let mut rx = tap.subscribe();
        emit_n(&handle, 5);

        // Live broadcast: every event is already there without any wait —
        // the tap is synchronous at emit, with none of the relay pacing.
        for expected_seq in 1..=5u64 {
            let line = rx.try_recv().expect("event should be buffered already");
            let frame: serde_json::Value = serde_json::from_str(&line).expect("valid json");
            assert_eq!(frame_seq(&frame), expected_seq);
            assert_eq!(
                frame.get("kind").and_then(|v| v.as_str()),
                Some("test_event")
            );
            // camelCase envelope, same shape as ObserverEvent; optional
            // startedAt is absent when unset.
            assert!(frame.get("agentIndex").is_some());
            assert!(frame.get("channelId").is_some());
            assert!(frame.get("startedAt").is_none());
        }
        assert!(matches!(
            rx.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        ));
    }

    #[tokio::test]
    async fn attach_hyper_acp_is_single_shot() {
        let handle = ObserverHandle::in_process();
        assert!(handle.attach_hyper_acp(Arc::new(Tap::new(8))));
        assert!(!handle.attach_hyper_acp(Arc::new(Tap::new(8))));
    }

    #[tokio::test]
    async fn attach_activity_log_is_single_shot() {
        let handle = ObserverHandle::in_process();
        assert!(handle.attach_activity_log(LogHandle::disabled()));
        assert!(!handle.attach_activity_log(LogHandle::disabled()));
    }

    #[tokio::test]
    async fn ws_replay_then_marker_then_live_to_two_clients() {
        let dir = TestDir::new();
        let (handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
        let log = open_log(&handle, &dir);
        emit_n(&handle, 3);
        // Barrier: replay reads from disk, so the drain must be finished.
        log.shutdown().await;
        let bound = listen(tap, AuthPolicy::default(), Some(log.replay_source())).await;

        let url = format!("ws://{bound}");
        let (mut client_a, _) = tokio_tungstenite::connect_async(&url)
            .await
            .expect("client A connects");
        let (mut client_b, _) = tokio_tungstenite::connect_async(&url)
            .await
            .expect("client B connects while A is attached");

        for client in [&mut client_a, &mut client_b] {
            for expected_seq in 1..=3u64 {
                let frame: serde_json::Value =
                    serde_json::from_str(&next_text(client).await).expect("valid json");
                assert_eq!(frame_seq(&frame), expected_seq);
            }
            assert_eq!(next_text(client).await, REPLAY_END_FRAME);
        }

        // A live event reaches both clients after the marker.
        emit_n(&handle, 1);
        for client in [&mut client_a, &mut client_b] {
            let frame: serde_json::Value =
                serde_json::from_str(&next_text(client).await).expect("valid json");
            assert_eq!(frame_seq(&frame), 4);
        }
    }

    #[tokio::test]
    async fn never_reading_client_stalls_nobody() {
        let (handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
        let bound = listen(tap, AuthPolicy::default(), None).await;
        let url = format!("ws://{bound}");

        // Client A completes the handshake and is then never polled again.
        let (client_a, _) = tokio_tungstenite::connect_async(&url)
            .await
            .expect("client A connects");
        // Keep A alive but unread for the rest of the test.
        let _keep_a = client_a;

        let (mut client_b, _) = tokio_tungstenite::connect_async(&url)
            .await
            .expect("client B connects behind a stalled A");
        assert_eq!(next_text(&mut client_b).await, REPLAY_END_FRAME);

        emit_n(&handle, 100);
        let collect = async {
            for expected_seq in 1..=100u64 {
                let frame: serde_json::Value =
                    serde_json::from_str(&next_text(&mut client_b).await).expect("valid json");
                assert_eq!(frame_seq(&frame), expected_seq);
            }
        };
        tokio::time::timeout(Duration::from_secs(3), collect)
            .await
            .expect("stalled peer must not slow a live client");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn lagged_client_gets_gap_then_live_frames() {
        // A tiny in-memory duplex forces deterministic backpressure: the
        // server cannot clear its write queue faster than the client reads
        // because the client simply stops reading.
        let (client_io, server_io) = tokio::io::duplex(64);
        let (handle, tap) = handle_with_tap(4);
        emit_n(&handle, 2);

        let server_tap = tap.clone();
        let server = tokio::spawn(async move {
            serve_connection(
                server_io,
                server_tap,
                AuthPolicy::default(),
                None,
                Duration::from_secs(5),
            )
            .await;
        });
        let (mut client, _) = tokio_tungstenite::client_async("ws://127.0.0.1/", client_io)
            .await
            .expect("client handshake");

        // No log configured: the replay phase is empty and the very first
        // frame is the marker. By the time it arrives the connection task
        // definitely holds its live receiver, because subscribe happens
        // first.
        assert_eq!(next_text(&mut client).await, REPLAY_END_FRAME);

        // Current-thread runtime plus a synchronous publish loop: the
        // connection task cannot interleave, so all 30 events overflow its
        // 4-frame broadcast buffer before it is scheduled again.
        emit_n(&handle, 30);

        let mut saw_gap = false;
        let mut live_after_gap = 0usize;
        for _ in 0..16 {
            let line = tokio::time::timeout(Duration::from_secs(4), async {
                next_text(&mut client).await
            })
            .await
            .expect("frames must keep arriving after a lag skip");
            let frame: serde_json::Value = serde_json::from_str(&line).expect("valid json");
            if frame.get("type").and_then(|v| v.as_str()) == Some("replay_gap") {
                let dropped = frame.get("dropped").and_then(|v| v.as_u64()).unwrap_or(0);
                assert!(dropped >= 1, "gap frame must report dropped events");
                saw_gap = true;
            } else if saw_gap {
                assert!(
                    frame.get("seq").is_some(),
                    "live frame after gap is an ObserverEvent"
                );
                live_after_gap += 1;
            }
            if saw_gap && live_after_gap >= 4 {
                break;
            }
        }
        assert!(
            saw_gap,
            "lagging client must receive exactly one replay_gap"
        );
        assert_eq!(
            live_after_gap, 4,
            "lagged client is skipped ahead to live frames"
        );
        server.abort();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn stalled_client_task_exits_quietly() {
        let (client_io, server_io) = tokio::io::duplex(64);
        let dir = TestDir::new();
        let (_handle, tap) = handle_with_tap(4);

        // One large recorded line, durable before the connection is served.
        let log = ActivityLog::open(&dir.db_path()).expect("open activity log");
        log.handle().record("x".repeat(4096));
        log.shutdown().await;

        let server = tokio::spawn(serve_connection(
            server_io,
            tap.clone(),
            AuthPolicy::default(),
            Some(log.replay_source()),
            Duration::from_millis(50),
        ));
        let (client, _) = tokio_tungstenite::client_async("ws://127.0.0.1/", client_io)
            .await
            .expect("client handshake");
        // Handshake done; never read again. The 4KB replay frame cannot fit
        // the 64-byte in-memory buffer, so the connection task stalls on its
        // first write and must give up via the send timeout.
        let _keep_unread = client;
        tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .expect("stalled client must not hang the connection task")
            .expect("connection task panicked");
    }

    // --- app-level connect auth ---

    #[tokio::test]
    async fn bearer_header_goes_straight_to_replay_without_auth_ok() {
        let dir = TestDir::new();
        let (handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
        let log = open_log(&handle, &dir);
        emit_n(&handle, 2);
        log.shutdown().await;
        let bound = listen(tap, token_auth(), Some(log.replay_source())).await;
        let url = format!("ws://{bound}");

        // Exact `Bearer <token>` header: replay starts immediately.
        let bearer = format!("Bearer {TEST_TOKEN}");
        let request = client_request(&url, &[(http::header::AUTHORIZATION, bearer.as_str())]);
        let (mut ws, _) = tokio_tungstenite::connect_async(request)
            .await
            .expect("bearer client connects");
        for expected_seq in 1..=2u64 {
            let line = next_text(&mut ws).await;
            assert_ne!(
                line, AUTH_OK_FRAME,
                "bearer path must not emit auth_ok frames"
            );
            let frame: serde_json::Value = serde_json::from_str(&line).expect("valid json");
            assert_eq!(frame_seq(&frame), expected_seq);
        }
        assert_eq!(next_text(&mut ws).await, REPLAY_END_FRAME);

        // The scheme is case-insensitive.
        let bearer = format!("bEaReR {TEST_TOKEN}");
        let request = client_request(&url, &[(http::header::AUTHORIZATION, bearer.as_str())]);
        let (mut ws, _) = tokio_tungstenite::connect_async(request)
            .await
            .expect("mixed-case bearer scheme connects");
        assert_ne!(next_text(&mut ws).await, AUTH_OK_FRAME);

        // A wrong bearer simply does not skip first-frame auth — the frame
        // path is still available on the same connection.
        let request = client_request(
            &url,
            &[(http::header::AUTHORIZATION, "Bearer not-the-token")],
        );
        let (mut ws, _) = tokio_tungstenite::connect_async(request)
            .await
            .expect("wrong bearer still upgrades");
        send_auth_frame(&mut ws, TEST_TOKEN).await;
        assert_eq!(next_text(&mut ws).await, AUTH_OK_FRAME);
        for expected_seq in 1..=2u64 {
            let frame: serde_json::Value =
                serde_json::from_str(&next_text(&mut ws).await).expect("valid json");
            assert_eq!(frame_seq(&frame), expected_seq);
        }
        assert_eq!(next_text(&mut ws).await, REPLAY_END_FRAME);
    }

    #[tokio::test]
    async fn first_frame_auth_grants_auth_ok_replay_and_live_to_two_clients() {
        let dir = TestDir::new();
        let (handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
        let log = open_log(&handle, &dir);
        emit_n(&handle, 2);
        log.shutdown().await;
        let bound = listen(tap, token_auth(), Some(log.replay_source())).await;
        let url = format!("ws://{bound}");

        let mut clients = Vec::new();
        for _ in 0..2 {
            let (mut ws, _) = tokio_tungstenite::connect_async(&url)
                .await
                .expect("client connects without auth header");
            send_auth_frame(&mut ws, TEST_TOKEN).await;
            clients.push(ws);
        }

        // auth_ok first, THEN the full-session replay, THEN exactly one
        // replay_end.
        for ws in &mut clients {
            assert_eq!(next_text(ws).await, AUTH_OK_FRAME);
            for expected_seq in 1..=2u64 {
                let frame: serde_json::Value =
                    serde_json::from_str(&next_text(ws).await).expect("valid json");
                assert_eq!(frame_seq(&frame), expected_seq);
            }
            assert_eq!(next_text(ws).await, REPLAY_END_FRAME);
        }

        // Live frames flow to both authenticated clients.
        emit_n(&handle, 1);
        for ws in &mut clients {
            let frame: serde_json::Value =
                serde_json::from_str(&next_text(ws).await).expect("valid json");
            assert_eq!(frame_seq(&frame), 3);
        }
    }

    #[tokio::test]
    async fn empty_replay_emits_exactly_one_replay_end_after_auth_ok() {
        let (_handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
        let bound = listen(tap, token_auth(), None).await;
        let url = format!("ws://{bound}");

        let (mut ws, _) = tokio_tungstenite::connect_async(&url)
            .await
            .expect("client connects");
        send_auth_frame(&mut ws, TEST_TOKEN).await;

        assert_eq!(next_text(&mut ws).await, AUTH_OK_FRAME);
        assert_eq!(next_text(&mut ws).await, REPLAY_END_FRAME);
        let extra = tokio::time::timeout(Duration::from_millis(500), ws.next()).await;
        assert!(
            extra.is_err(),
            "empty replay must emit no frame after replay_end"
        );
    }

    #[tokio::test]
    async fn wrong_token_first_frame_closes_4401_without_replay_leak() {
        let dir = TestDir::new();
        let (handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
        // Non-empty recorded session: nothing may reach the wire before a
        // successful auth.
        let log = open_log(&handle, &dir);
        emit_n(&handle, 1);
        log.shutdown().await;
        let bound = listen(tap, token_auth(), Some(log.replay_source())).await;
        let url = format!("ws://{bound}");

        let (mut ws, _) = tokio_tungstenite::connect_async(&url)
            .await
            .expect("client connects");
        send_auth_frame(&mut ws, "wrong-token").await;
        // The very first thing the client reads is the close frame itself.
        expect_unauthorized_close(&mut ws).await;
    }

    #[tokio::test]
    async fn missing_auth_frame_within_timeout_closes_4401() {
        let (_handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
        let bound = listen(tap, token_auth(), None).await;
        let url = format!("ws://{bound}");

        let (mut ws, _) = tokio_tungstenite::connect_async(&url)
            .await
            .expect("client connects");
        // Stay silent past the production 3s auth wait; the helper's 7s
        // outer timeout covers it.
        expect_unauthorized_close(&mut ws).await;
    }

    #[tokio::test]
    async fn malformed_or_wrong_type_first_frame_closes_4401() {
        let (_handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
        let bound = listen(tap, token_auth(), None).await;
        let url = format!("ws://{bound}");

        for payload in [
            "not json".to_string(),
            format!(r#"{{"type":"other","token":"{TEST_TOKEN}"}}"#),
            r#"{"type":"auth"}"#.to_string(),
            r#""auth""#.to_string(),
        ] {
            let (mut ws, _) = tokio_tungstenite::connect_async(&url)
                .await
                .expect("client connects");
            ws.send(Message::Text(payload.into()))
                .await
                .expect("send payload");
            expect_unauthorized_close(&mut ws).await;
        }
    }

    // --- CORS origin allowlist ---

    fn cors_auth() -> AuthPolicy {
        AuthPolicy {
            token: None,
            cors_origins: vec![
                "https://console.hypercli.com".to_string(),
                // Trailing slash is tolerated on either side of the compare.
                "https://app.example.com/".to_string(),
            ],
        }
    }

    #[tokio::test]
    async fn cors_allows_listed_slash_normalized_and_missing_origins() {
        let (_handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
        let bound = listen(tap, cors_auth(), None).await;
        let url = format!("ws://{bound}");

        // No Origin header: server-side clients always pass the CORS check.
        let (mut ws, _) = tokio_tungstenite::connect_async(&url)
            .await
            .expect("origin-less client connects");
        assert_eq!(next_text(&mut ws).await, REPLAY_END_FRAME);

        // Listed origin, and the trailing-slash config entry matching the
        // slash-less browser Origin value.
        for origin in ["https://console.hypercli.com", "https://app.example.com"] {
            let request = client_request(&url, &[(http::header::ORIGIN, origin)]);
            let (mut ws, _) = tokio_tungstenite::connect_async(request)
                .await
                .unwrap_or_else(|error| panic!("origin {origin} must be allowed: {error}"));
            assert_eq!(next_text(&mut ws).await, REPLAY_END_FRAME);
        }
    }

    #[tokio::test]
    async fn cors_rejects_unlisted_origin_with_http_403_then_listener_survives() {
        let (_handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
        let bound = listen(tap, cors_auth(), None).await;
        let url = format!("ws://{bound}");

        let request = client_request(&url, &[(http::header::ORIGIN, "https://evil.example")]);
        let error = tokio_tungstenite::connect_async(request)
            .await
            .expect_err("unlisted origin must be rejected");
        match error {
            tokio_tungstenite::tungstenite::Error::Http(response) => {
                assert_eq!(response.status(), http::StatusCode::FORBIDDEN);
            }
            other => panic!("expected HTTP 403 rejection, got {other:?}"),
        }

        // The accept loop is unaffected by a rejected handshake.
        let (mut ws, _) = tokio_tungstenite::connect_async(&url)
            .await
            .expect("listener still serves after a 403 rejection");
        assert_eq!(next_text(&mut ws).await, REPLAY_END_FRAME);
    }

    #[tokio::test]
    async fn cors_runs_before_and_independently_of_token_auth() {
        let (_handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
        let bound = listen(
            tap,
            AuthPolicy {
                token: Some(TEST_TOKEN.to_string()),
                cors_origins: vec!["https://console.hypercli.com".to_string()],
            },
            None,
        )
        .await;
        let url = format!("ws://{bound}");
        let bearer = format!("Bearer {TEST_TOKEN}");

        // Valid bearer but unlisted Origin: CORS wins and the upgrade fails.
        let request = client_request(
            &url,
            &[
                (http::header::ORIGIN, "https://evil.example"),
                (http::header::AUTHORIZATION, bearer.as_str()),
            ],
        );
        let error = tokio_tungstenite::connect_async(request)
            .await
            .expect_err("bad Origin rejected even with a valid token");
        assert!(matches!(
            error,
            tokio_tungstenite::tungstenite::Error::Http(_)
        ));

        // Listed Origin + bearer: both checks pass, straight to replay.
        let request = client_request(
            &url,
            &[
                (http::header::ORIGIN, "https://console.hypercli.com"),
                (http::header::AUTHORIZATION, bearer.as_str()),
            ],
        );
        let (mut ws, _) = tokio_tungstenite::connect_async(request)
            .await
            .expect("listed origin plus bearer connects");
        assert_eq!(next_text(&mut ws).await, REPLAY_END_FRAME);
    }

    // --- activity log persistence ---

    #[tokio::test]
    async fn activity_log_roundtrip_records_all_lines_for_boot_session() {
        let dir = TestDir::new();
        let log = ActivityLog::open(&dir.db_path()).expect("open activity log");
        let session_id = log.replay_source().session_id.clone();

        let handle = log.handle();
        for i in 0..750u32 {
            handle.record(format!("line-{i}"));
        }
        log.shutdown().await;

        let conn = rusqlite::Connection::open(dir.db_path()).expect("open db");
        let sessions: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .expect("count sessions");
        assert_eq!(sessions, 1, "exactly one boot session per open");
        let stored_session: String = conn
            .query_row("SELECT id FROM sessions", [], |row| row.get(0))
            .expect("read boot session id");
        assert_eq!(stored_session, session_id);

        let lines = read_lines(&dir, &log);
        assert_eq!(lines.len(), 750, "every recorded line persisted");
        for (i, line) in lines.iter().enumerate() {
            assert_eq!(line, &format!("line-{i}"), "row {i} out of order");
        }
    }

    #[tokio::test]
    async fn activity_log_two_boots_two_sessions() {
        let dir = TestDir::new();

        let first = ActivityLog::open(&dir.db_path()).expect("open boot one");
        let first_session = first.replay_source().session_id.clone();
        let first_handle = first.handle();
        for i in 0..3u32 {
            first_handle.record(format!("boot-one-{i}"));
        }
        first.shutdown().await;

        let second = ActivityLog::open(&dir.db_path()).expect("open boot two");
        let second_session = second.replay_source().session_id.clone();
        let second_handle = second.handle();
        for i in 0..2u32 {
            second_handle.record(format!("boot-two-{i}"));
        }
        second.shutdown().await;

        assert_ne!(first_session, second_session, "fresh session per boot");

        let conn = rusqlite::Connection::open(dir.db_path()).expect("open db");
        let sessions: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .expect("count sessions");
        assert_eq!(sessions, 2, "same file holds one session row per boot");

        let count_for = |session: &str| -> i64 {
            conn.query_row(
                "SELECT COUNT(*) FROM events WHERE session_id = ?1",
                rusqlite::params![session],
                |row| row.get(0),
            )
            .expect("count events for session")
        };
        assert_eq!(count_for(&first_session), 3);
        assert_eq!(count_for(&second_session), 2);
    }

    #[tokio::test]
    async fn activity_log_open_failure_disables_without_panic() {
        let dir = TestDir::new();
        std::fs::create_dir_all(&dir.0).expect("create scratch dir");
        // A file where a directory must be: parent creation fails.
        std::fs::write(dir.0.join("not-a-dir"), b"x").expect("seed blocker file");
        let bogus = dir.0.join("not-a-dir").join("activity.db");
        assert!(
            ActivityLog::open(&bogus).is_err(),
            "bogus path must fail to open"
        );

        // The disabled handle is inert, and emit still broadcasts live.
        let handle = ObserverHandle::in_process();
        let tap = Arc::new(Tap::new(8));
        assert!(handle.attach_hyper_acp(tap.clone()));
        let log = LogHandle::disabled();
        assert!(!log.is_enabled());
        assert!(handle.attach_activity_log(log));

        let mut rx = tap.subscribe();
        emit_n(&handle, 3);
        for _ in 0..3 {
            rx.try_recv().expect("live event should flow without a log");
        }
        assert!(matches!(
            rx.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        ));
    }

    #[tokio::test]
    async fn shutdown_flushes_pending_lines() {
        let dir = TestDir::new();
        let log = ActivityLog::open(&dir.db_path()).expect("open activity log");
        let handle = log.handle();
        for i in 0..700u32 {
            handle.record(format!("line-{i}"));
        }
        // Shutdown right after the last record: the drain must still persist
        // everything before exiting.
        log.shutdown().await;

        let lines = read_lines(&dir, &log);
        assert_eq!(lines.len(), 700, "shutdown flushed all pending lines");
        for (i, line) in lines.iter().enumerate() {
            assert_eq!(line, &format!("line-{i}"), "row {i} out of order");
        }
    }

    #[tokio::test]
    async fn ws_replays_full_session_from_disk() {
        // More recorded frames than the retired 500-entry memory ring ever
        // held: replay now comes from disk, for the whole boot session.
        const RECORDED: u64 = 600;
        let dir = TestDir::new();
        let (handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
        let log = open_log(&handle, &dir);
        emit_n(&handle, RECORDED);
        log.shutdown().await;

        let bound = listen(tap, token_auth(), Some(log.replay_source())).await;
        let url = format!("ws://{bound}");

        let (mut ws, _) = tokio_tungstenite::connect_async(&url)
            .await
            .expect("client connects");
        send_auth_frame(&mut ws, TEST_TOKEN).await;

        assert_eq!(next_text(&mut ws).await, AUTH_OK_FRAME);
        for expected_seq in 1..=RECORDED {
            let line = tokio::time::timeout(Duration::from_secs(10), next_text(&mut ws))
                .await
                .expect("full replay must stream");
            let frame: serde_json::Value = serde_json::from_str(&line).expect("valid json");
            assert_eq!(frame_seq(&frame), expected_seq);
        }
        assert_eq!(next_text(&mut ws).await, REPLAY_END_FRAME);

        // Live frames keep flowing after the disk replay.
        emit_n(&handle, 1);
        let frame: serde_json::Value =
            serde_json::from_str(&next_text(&mut ws).await).expect("valid json");
        assert_eq!(frame_seq(&frame), RECORDED + 1);
    }

    #[tokio::test]
    async fn ws_replay_ends_empty_when_no_log() {
        // No activity log configured: replay phase is empty but the
        // exactly-one replay_end contract still holds (desktop local mode).
        let (_handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
        let bound = listen(tap, AuthPolicy::default(), None).await;
        let url = format!("ws://{bound}");

        let (mut ws, _) = tokio_tungstenite::connect_async(&url)
            .await
            .expect("client connects");
        assert_eq!(next_text(&mut ws).await, REPLAY_END_FRAME);
        let extra = tokio::time::timeout(Duration::from_millis(500), ws.next()).await;
        assert!(
            extra.is_err(),
            "no-log replay must end after the single marker"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn ws_replay_covers_events_recorded_but_unflushed_at_subscribe() {
        let dir = TestDir::new();
        let log = ActivityLog::open(&dir.db_path()).expect("open activity log");
        // Record with the drain never scheduled (current-thread runtime, no
        // await since open): the line is queued in the channel, provably not
        // yet a row. Without the flush barrier the connect-time snapshot
        // could miss it, and the live publish had already happened before a
        // receiver could exist — the record/before-subscribe race hole.
        log.handle().record("unflushed-at-subscribe".to_string());
        // Precondition, checked through a second read connection: at the
        // moment the handshake below starts, the row is absent from sqlite.
        {
            let conn = rusqlite::Connection::open(dir.db_path()).expect("second read connection");
            let rows: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM events WHERE session_id = ?1",
                    rusqlite::params![log.replay_source().session_id],
                    |row| row.get(0),
                )
                .expect("count events");
            assert_eq!(rows, 0, "line must still be queued, not durable");
        }

        let (client_io, server_io) = tokio::io::duplex(8 * 1024);
        let tap = Arc::new(Tap::new(8));
        let server = tokio::spawn(serve_connection(
            server_io,
            tap,
            token_auth(),
            Some(log.replay_source()),
            Duration::from_secs(5),
        ));
        let (mut ws, _) = tokio_tungstenite::client_async("ws://127.0.0.1/", client_io)
            .await
            .expect("client handshake");
        send_auth_frame(&mut ws, TEST_TOKEN).await;

        assert_eq!(next_text(&mut ws).await, AUTH_OK_FRAME);
        // The flush barrier between subscribe and snapshot must make the
        // still-queued line part of the disk replay…
        assert_eq!(next_text(&mut ws).await, "unflushed-at-subscribe");
        // …exactly once, before the single replay_end marker.
        assert_eq!(next_text(&mut ws).await, REPLAY_END_FRAME);
        server.abort();
        log.shutdown().await;
    }

    #[tokio::test]
    async fn ws_replay_handles_exact_chunk_boundaries() {
        // Replay pages 256 rows per statement; exact multiples of the page
        // size are the dup/hole hunting ground at page edges.
        for recorded in [256u64, 512] {
            let dir = TestDir::new();
            let (handle, tap) = handle_with_tap(HYPER_ACP_BROADCAST_CAP);
            let log = open_log(&handle, &dir);
            emit_n(&handle, recorded);
            log.shutdown().await;

            let bound = listen(tap, AuthPolicy::default(), Some(log.replay_source())).await;
            let url = format!("ws://{bound}");
            let (mut ws, _) = tokio_tungstenite::connect_async(&url)
                .await
                .expect("client connects");
            for expected_seq in 1..=recorded {
                let frame: serde_json::Value =
                    serde_json::from_str(&next_text(&mut ws).await).expect("valid json");
                assert_eq!(
                    frame_seq(&frame),
                    expected_seq,
                    "hole or dup at seq {expected_seq} of {recorded}"
                );
            }
            assert_eq!(next_text(&mut ws).await, REPLAY_END_FRAME);
            // No phantom chunk frame follows an exact-multiple replay.
            let extra = tokio::time::timeout(Duration::from_millis(300), ws.next()).await;
            assert!(
                extra.is_err(),
                "no frame may follow replay_end ({recorded} recorded rows)"
            );
        }
    }

    #[tokio::test]
    async fn record_after_log_shutdown_is_a_noop() {
        let dir = TestDir::new();
        let log = ActivityLog::open(&dir.db_path()).expect("open activity log");
        let handle = log.handle();
        handle.record("before".to_string());
        log.shutdown().await;

        // Post-shutdown record: silent no-op — no panic, nothing new durable.
        handle.record("after".to_string());
        handle.record(String::new());
        // Flush barrier on the drained-off channel resolves immediately —
        // the lossless shutdown pass already persisted everything accepted,
        // and the connect path must never hang once logging is down.
        for _ in 0..8 {
            tokio::time::timeout(Duration::from_millis(100), handle.flush())
                .await
                .expect("post-shutdown flush barrier resolves immediately");
        }
        // A never-enabled (disabled) handle's barrier is equally instant.
        tokio::time::timeout(Duration::from_millis(100), LogHandle::disabled().flush())
            .await
            .expect("disabled-handle flush barrier resolves immediately");

        let lines = read_lines(&dir, &log);
        assert_eq!(lines, ["before"], "post-shutdown records must not land");
    }

    // --- protocol-crypto redaction ---

    /// Assert a serialized stream/log line contains none of the materials and
    /// at least `min_redactions` `[redacted]` markers. Test materials only —
    /// never print the material itself in a failure message.
    fn assert_crypto_free(frame: &str, materials: &[&str], min_redactions: usize) {
        for material in materials {
            assert!(
                !frame.contains(material),
                "frame leaks a denylisted material: {frame}"
            );
        }
        assert!(
            frame.matches("[redacted]").count() >= min_redactions,
            "frame must show redaction markers: {frame}"
        );
    }

    #[tokio::test]
    async fn redactor_replaces_each_material_and_is_used_by_both_sinks() {
        // Unit behavior: every material replaced, every occurrence replaced,
        // benign text untouched, empty/<12-char entries never over-redact.
        let hex_like = "aa".repeat(32);
        let redactor = Redactor::new(vec![
            hex_like.clone(),
            "nsec1testmaterialtestmaterial".to_string(),
            "ws-token-material-123".to_string(),
            "auth-tag-material-456".to_string(),
            String::new(),
            "short".to_string(), // dropped: < 12
            "1".repeat(11),      // dropped: < 12
        ]);
        let mut line = format!(
            "k={hex_like} k2={hex_like} n=nsec1testmaterialtestmaterial \
             t=ws-token-material-123 g=auth-tag-material-456 keep=short benign 11111111111"
        );
        redactor.redact(&mut line);
        assert_eq!(
            line.matches("[redacted]").count(),
            5,
            "5 occurrences replaced"
        );
        assert!(
            line.contains("keep=short"),
            "<12-char entry must not redact"
        );
        assert!(
            line.contains("11111111111"),
            "11-char entry must not redact"
        );
        assert!(line.contains("benign"), "benign text untouched");

        // F9: a quote-bearing value-form entry (a real NIP-OA auth tag is a
        // JSON-array string) must be caught in BOTH embedding forms, and
        // both replacement forms must preserve line JSON validity.
        let auth_tag = r#"["auth","npub1redactortestredactortest","{\"k\":\"v\"}"]"#;
        let tag_redactor = Redactor::new(vec![auth_tag.to_string()]);
        // Embedded as an actual array value in the payload ⇒ canonical
        // value-form match, in-shape array holder.
        let mut value_line = serde_json::to_string(&serde_json::json!({
            "kind": "prompt",
            "tag": serde_json::from_str::<serde_json::Value>(auth_tag).expect("tag parses"),
        }))
        .expect("serialize value line");
        tag_redactor.redact(&mut value_line);
        let parsed: serde_json::Value =
            serde_json::from_str(&value_line).expect("value line must stay valid JSON");
        assert_eq!(parsed["tag"], serde_json::json!(["[redacted]"]));
        assert!(!value_line.contains("npub1redactortestredactortest"));
        // Embedded as text inside a string payload field ⇒ escaped-body
        // match, escaped-holder replacement.
        let mut string_line = serde_json::to_string(&serde_json::json!({
            "kind": "prompt",
            "note": format!("saw tag {auth_tag} here"),
        }))
        .expect("serialize string line");
        tag_redactor.redact(&mut string_line);
        let parsed: serde_json::Value =
            serde_json::from_str(&string_line).expect("string line must stay valid JSON");
        assert_eq!(
            parsed["note"],
            serde_json::json!("saw tag [\"[redacted]\"] here")
        );
        assert!(!string_line.contains("npub1redactortestredactortest"));
        assert!(!string_line.contains(r#"[\"auth\"]"#), "escaped body gone");

        // Both sinks: one redacted serialization feeds tap AND log.
        let dir = TestDir::new();
        let handle = ObserverHandle::in_process();
        let tap = Arc::new(Tap::new(8));
        assert!(handle.attach_hyper_acp(tap.clone()));
        let log = ActivityLog::open(&dir.db_path()).expect("open activity log");
        assert!(handle.attach_activity_log(log.handle()));
        assert!(handle.attach_redactor(Arc::new(Redactor::new(vec![
            "both-sinks-secret-99".to_string()
        ]))));
        // Single-shot, like the tap/log attachments.
        assert!(!handle.attach_redactor(Arc::new(Redactor::new(vec![]))));

        let mut rx = tap.subscribe();
        handle.emit(
            "test_event",
            None,
            &ObserverContext::default(),
            serde_json::json!({ "m": "both-sinks-secret-99", "ok": "plain" }),
        );
        let live = rx.try_recv().expect("live line from tap");
        assert_crypto_free(&live, &["both-sinks-secret-99"], 1);
        assert!(live.contains("plain"));

        log.shutdown().await;
        let lines = read_lines(&dir, &log);
        assert_eq!(lines.len(), 1);
        assert_crypto_free(&lines[0], &["both-sinks-secret-99"], 1);
    }

    #[tokio::test]
    async fn ws_stream_and_log_never_contain_crypto() {
        use clap::Parser as _;
        use nostr::ToBech32 as _;

        // Real Config from CLI args (fixed test key = secp256k1 scalar 1, ws
        // token) — the exact materials wiring lib.rs startup uses. The auth
        // tag is passed explicitly: crate tests deliberately avoid mutating
        // shared env state (see config.rs test-module note).
        const TEST_HEX: &str = "0000000000000000000000000000000000000000000000000000000000000001";
        const WS_TOKEN: &str = "hyper-acp-ws-token-9f8e7d6c5b4a";
        // Realistic quote-bearing NIP-OA form: a JSON-ARRAY string — the
        // encoding that escaped raw-substring matching pre-F9.
        const AUTH_TAG: &str =
            r#"["auth","npub1integ3tag9integ3tag9integ3tag9d4c8e0","{\"con\":\"beta\"}"]"#;

        let args = crate::config::CliArgs::try_parse_from([
            "buzz-acp",
            "--private-key",
            TEST_HEX,
            "--hyper-acp-ws-token",
            WS_TOKEN,
        ])
        .expect("parse test args");
        let config = crate::config::Config::from_args(args).expect("test config");
        let nsec = config
            .keys
            .secret_key()
            .to_bech32()
            .expect("nsec for test key");
        let hex = config.keys.secret_key().to_secret_hex();
        let denylist = crate::hyper_acp_redact_denylist(
            &config.keys,
            config.hyper_acp_ws_token.as_deref(),
            Some(AUTH_TAG.to_string()),
        );
        assert!(denylist.iter().any(|entry| entry == AUTH_TAG));
        let redactor = Arc::new(Redactor::new(denylist));

        let dir = TestDir::new();
        let handle = ObserverHandle::in_process();
        assert!(handle.attach_redactor(redactor));
        let tap = Arc::new(Tap::new(HYPER_ACP_BROADCAST_CAP));
        assert!(handle.attach_hyper_acp(tap.clone()));
        let log = ActivityLog::open(&dir.db_path()).expect("open activity log");
        assert!(handle.attach_activity_log(log.handle()));
        // Relay-facing receiver: must carry the ORIGINAL payloads.
        let mut relay_rx = handle.subscribe();

        // Pre-connect event, covered by the disk replay (F1 barrier), with
        // each material embedded in a DIFFERENT payload field — the auth tag
        // additionally in BOTH embedding forms (array value + string text).
        handle.emit(
            "prompt",
            None,
            &ObserverContext::default(),
            serde_json::json!({
                "embedded_nsec": format!("leak {nsec} tail"),
                "embedded_hex": hex,
                "embedded_token": format!("prefix {WS_TOKEN}"),
                "auth_tag_note": format!("tag={AUTH_TAG} end"),
                "auth_tag_value": serde_json::from_str::<serde_json::Value>(AUTH_TAG)
                    .expect("auth tag parses as a JSON array"),
            }),
        );

        // The ws token doubles as the connect token, exactly like production.
        let bound = listen(
            tap,
            AuthPolicy {
                token: Some(WS_TOKEN.to_string()),
                cors_origins: vec![],
            },
            Some(log.replay_source()),
        )
        .await;
        let url = format!("ws://{bound}");
        let (mut ws, _) = tokio_tungstenite::connect_async(&url)
            .await
            .expect("client connects");
        send_auth_frame(&mut ws, WS_TOKEN).await;
        assert_eq!(next_text(&mut ws).await, AUTH_OK_FRAME);

        // Materials include the tag's escaped string-body form — neither the
        // raw nor the escaped fragment may survive anywhere.
        let tag_body = json_string_body(AUTH_TAG);
        let materials = [
            hex.as_str(),
            nsec.as_str(),
            WS_TOKEN,
            AUTH_TAG,
            tag_body.as_str(),
        ];
        let replay_frame = next_text(&mut ws).await;
        serde_json::from_str::<serde_json::Value>(&replay_frame)
            .expect("replay frame must stay valid JSON after redaction");
        // 5 markers: nsec, hex, token + tag in both embedding forms.
        assert_crypto_free(&replay_frame, &materials, 5);
        assert_eq!(next_text(&mut ws).await, REPLAY_END_FRAME);

        // Live frames after the marker are redacted by the same path.
        handle.emit(
            "prompt",
            None,
            &ObserverContext::default(),
            serde_json::json!({
                "tok": format!("x {WS_TOKEN} y"),
                "key": nsec,
            }),
        );
        let live_frame = next_text(&mut ws).await;
        serde_json::from_str::<serde_json::Value>(&live_frame)
            .expect("live frame must stay valid JSON after redaction");
        assert_crypto_free(&live_frame, &materials, 2);

        // The sqlite session rows are redacted identically and stay valid.
        log.shutdown().await;
        let lines = read_lines(&dir, &log);
        assert_eq!(lines.len(), 2, "two boot-session rows recorded");
        for line in &lines {
            serde_json::from_str::<serde_json::Value>(line)
                .expect("sqlite row must stay valid JSON after redaction");
        }
        assert_crypto_free(&lines[0], &materials, 5);
        assert_crypto_free(&lines[1], &materials, 2);

        // The relay path is untouched: original payloads, materials intact.
        let relay_first = relay_rx.try_recv().expect("relay event one");
        assert_eq!(
            relay_first.payload["embedded_token"],
            serde_json::json!(format!("prefix {WS_TOKEN}"))
        );
        assert_eq!(
            relay_first.payload["embedded_nsec"],
            serde_json::json!(format!("leak {nsec} tail"))
        );
        assert_eq!(
            relay_first.payload["auth_tag_value"],
            serde_json::from_str::<serde_json::Value>(AUTH_TAG).expect("tag parses")
        );
        let relay_second = relay_rx.try_recv().expect("relay event two");
        assert_eq!(
            relay_second.payload["tok"],
            serde_json::json!(format!("x {WS_TOKEN} y"))
        );
    }

    #[tokio::test]
    async fn redaction_applies_when_only_log_attached() {
        // No WS listener: the durable sink alone must still record redacted.
        let dir = TestDir::new();
        let handle = ObserverHandle::in_process();
        let log = ActivityLog::open(&dir.db_path()).expect("open activity log");
        assert!(handle.attach_activity_log(log.handle()));
        assert!(handle.attach_redactor(Arc::new(Redactor::new(vec![
            "log-only-secret-material".to_string()
        ]))));
        handle.emit(
            "test_event",
            None,
            &ObserverContext::default(),
            serde_json::json!({ "m": "log-only-secret-material!" }),
        );
        log.shutdown().await;

        let lines = read_lines(&dir, &log);
        assert_eq!(lines.len(), 1);
        assert_crypto_free(&lines[0], &["log-only-secret-material"], 1);
    }

    #[test]
    fn redactor_filters_short_junk_and_shapes_object_entries() {
        // Short "[redacted]"-ish junk stays filtered by the <12-char rule:
        // a redactor holding only such entries changes nothing, so marker
        // text already present in a line is never mangled.
        let junk = Redactor::new(vec!["[redacted]".to_string(), String::new()]);
        let mut line = "pre [redacted] post, with no materials in it".to_string();
        let before = line.clone();
        junk.redact(&mut line);
        assert_eq!(line, before, "short junk entries must never over-redact");

        // A 12+ char entry containing {} braces parses as a JSON object ⇒
        // object-shape replacement in both embedding forms, JSON stays valid.
        let entry = r#"{"note":"0123456789abcdef"}"#;
        let redactor = Redactor::new(vec![entry.to_string()]);
        let mut value_line = serde_json::to_string(&serde_json::json!({
            "embedded": serde_json::from_str::<serde_json::Value>(entry).expect("object entry"),
        }))
        .expect("serialize value line");
        redactor.redact(&mut value_line);
        let parsed: serde_json::Value =
            serde_json::from_str(&value_line).expect("value line stays valid JSON");
        assert_eq!(parsed["embedded"], serde_json::json!({"redacted": true}));

        let mut string_line = serde_json::to_string(&serde_json::json!({
            "embedded_text": format!("x {entry} y"),
        }))
        .expect("serialize string line");
        redactor.redact(&mut string_line);
        let parsed: serde_json::Value =
            serde_json::from_str(&string_line).expect("string line stays valid JSON");
        assert_eq!(
            parsed["embedded_text"],
            serde_json::json!("x {\"redacted\":true} y")
        );
    }

    #[test]
    fn redactor_quote_free_containers_are_skip_listed() {
        // A quote-free container like [1,2,3,...] has identical raw and
        // string-body forms, and no replacement text is safe in both value and
        // string position. Entry is therefore skip-listed: nothing is redacted,
        // and critically neither embedding's JSON validity is corrupted.
        let entry = "[1,2,3,4,5,6,7,8,9,10]"; // 22 chars, parses as Array, zero quotes
        let redactor = Redactor::new(vec![entry.to_string()]);

        let mut string_line = serde_json::to_string(&serde_json::json!({
            "embedded_text": format!("code {entry} end"),
        }))
        .expect("serialize string line");
        let string_before = string_line.clone();
        redactor.redact(&mut string_line);
        assert_eq!(string_line, string_before, "string context untouched");
        serde_json::from_str::<serde_json::Value>(&string_line).expect("stays valid JSON");

        let mut value_line = serde_json::to_string(&serde_json::json!({
            "embedded": serde_json::from_str::<serde_json::Value>(entry).expect("array entry"),
        }))
        .expect("serialize value line");
        let value_before = value_line.clone();
        redactor.redact(&mut value_line);
        assert_eq!(value_line, value_before, "value context untouched");
        serde_json::from_str::<serde_json::Value>(&value_line).expect("stays valid JSON");
    }
}
