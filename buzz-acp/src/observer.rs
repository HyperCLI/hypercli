//! In-process observer bus for ACP session activity.
//!
//! This is intentionally process-local infrastructure: it lets the harness
//! collect raw ACP JSON-RPC activity and publish owner-scoped encrypted relay
//! frames without exposing a local HTTP port.

use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
};

use serde::Serialize;
use tokio::sync::broadcast;

use crate::hyper_acp;

const OBSERVER_BUFFER_CAP: usize = 1_000;

/// Best-effort metadata attached to observer events.
#[derive(Clone, Debug, Default)]
pub struct ObserverContext {
    /// Buzz channel UUID for the current turn, when channel-scoped.
    pub channel_id: Option<String>,
    /// ACP session ID associated with the current turn, once known.
    pub session_id: Option<String>,
    /// Local UUID for one prompt turn.
    pub turn_id: Option<String>,
    /// RFC3339 timestamp at which the current turn began, when known.
    pub started_at: Option<String>,
}

/// Handle used by the harness to publish local observer events.
#[derive(Clone)]
pub struct ObserverHandle {
    inner: Arc<ObserverInner>,
}

struct ObserverInner {
    tx: broadcast::Sender<ObserverEvent>,
    buffer: Mutex<VecDeque<ObserverEvent>>,
    seq: AtomicU64,
    hyper_acp: OnceLock<Arc<hyper_acp::Tap>>,
    activity_log: OnceLock<hyper_acp::LogHandle>,
    redactor: OnceLock<Arc<hyper_acp::Redactor>>,
}

fn new_observer_handle() -> ObserverHandle {
    let (tx, _) = broadcast::channel(OBSERVER_BUFFER_CAP);
    ObserverHandle {
        inner: Arc::new(ObserverInner {
            tx,
            buffer: Mutex::new(VecDeque::with_capacity(OBSERVER_BUFFER_CAP)),
            seq: AtomicU64::new(1),
            hyper_acp: OnceLock::new(),
            activity_log: OnceLock::new(),
            redactor: OnceLock::new(),
        }),
    }
}

/// Event delivered through the in-process observer bus.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserverEvent {
    /// Monotonic process-local sequence number.
    pub seq: u64,
    /// RFC3339 UTC timestamp.
    pub timestamp: String,
    /// Observer event kind, for example `acp_read` or `turn_started`.
    pub kind: String,
    /// Pool slot index for the agent process that emitted the event.
    pub agent_index: Option<usize>,
    /// Buzz channel UUID for channel-scoped events.
    pub channel_id: Option<String>,
    /// ACP session ID when known.
    pub session_id: Option<String>,
    /// Local UUID for one prompt turn.
    pub turn_id: Option<String>,
    /// RFC3339 timestamp at which the current turn began, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    /// Raw or semantic event payload.
    pub payload: serde_json::Value,
}

impl ObserverHandle {
    /// Create an in-process observer feed.
    pub fn in_process() -> Self {
        new_observer_handle()
    }

    /// Subscribe to live observer events.
    pub fn subscribe(&self) -> broadcast::Receiver<ObserverEvent> {
        self.inner.tx.subscribe()
    }

    /// Attach the hyper-acp tap. Called once at startup before the emit
    /// paths run; a second attach keeps the first and returns `false`.
    pub fn attach_hyper_acp(&self, tap: Arc<hyper_acp::Tap>) -> bool {
        self.inner.hyper_acp.set(tap).is_ok()
    }

    /// Attach the boot-scoped activity log. Called once at startup before the
    /// emit paths run; a second attach keeps the first and returns `false`.
    /// Recording is non-blocking (internal channel, drop-on-full) and works
    /// with or without the hyper-acp WS listener.
    pub fn attach_activity_log(&self, log: hyper_acp::LogHandle) -> bool {
        self.inner.activity_log.set(log).is_ok()
    }

    /// Attach the protocol-crypto redactor for the hyper-acp side-channel.
    /// Called once at startup before the emit paths run; a second attach
    /// keeps the first and returns `false`. When unset, emit performs no
    /// redaction work at all (single `OnceLock::get` check).
    pub fn attach_redactor(&self, redactor: Arc<hyper_acp::Redactor>) -> bool {
        self.inner.redactor.set(redactor).is_ok()
    }

    /// Return the current replay buffer.
    pub fn snapshot(&self) -> Vec<ObserverEvent> {
        match self.inner.buffer.lock() {
            Ok(buffer) => buffer.iter().cloned().collect(),
            Err(error) => {
                tracing::warn!(target: "observer", "observer replay buffer lock poisoned: {error}");
                Vec::new()
            }
        }
    }

    /// Emit a local observer event.
    pub fn emit(
        &self,
        kind: impl Into<String>,
        agent_index: Option<usize>,
        context: &ObserverContext,
        payload: serde_json::Value,
    ) {
        let event = ObserverEvent {
            seq: self.inner.seq.fetch_add(1, Ordering::Relaxed),
            timestamp: chrono::Utc::now().to_rfc3339(),
            kind: kind.into(),
            agent_index,
            channel_id: context.channel_id.clone(),
            session_id: context.session_id.clone(),
            turn_id: context.turn_id.clone(),
            started_at: context.started_at.clone(),
            payload,
        };

        match self.inner.buffer.lock() {
            Ok(mut buffer) => {
                if buffer.len() >= OBSERVER_BUFFER_CAP {
                    buffer.pop_front();
                }
                buffer.push_back(event.clone());
            }
            Err(error) => {
                tracing::warn!(target: "observer", "observer replay buffer lock poisoned: {error}");
            }
        }

        // Hyper-ACP side-channel: one serialization feeds the activity
        // log (boot-scoped durable record) and the live tap (unpaced local
        // WS). Both consumers are absent in the default configuration, so
        // the common path pays nothing here — relay pacing, chunk
        // coalescing, and size elision all happen downstream in lib.rs.
        let tap = self.inner.hyper_acp.get();
        let log = self.inner.activity_log.get();
        if tap.is_some() || log.is_some() {
            if let Ok(mut line) = serde_json::to_string(&event) {
                // Redact protocol-crypto material from the one serialized
                // line feeding both hyper-acp sinks; the relay broadcast
                // below keeps the original ObserverEvent.
                if let Some(redactor) = self.inner.redactor.get() {
                    redactor.redact(&mut line);
                }
                // Record first: durable capture takes priority over the
                // best-effort live broadcast.
                if let Some(log) = log {
                    log.record(line.clone());
                }
                if let Some(tap) = tap {
                    tap.publish(line);
                }
            }
        }

        let _ = self.inner.tx.send(event);
    }
}

/// Build observer context values from optional channel/session/turn IDs.
pub fn context_for(
    channel_id: Option<uuid::Uuid>,
    session_id: Option<String>,
    turn_id: Option<String>,
) -> ObserverContext {
    ObserverContext {
        channel_id: channel_id.map(|id| id.to_string()),
        session_id,
        turn_id,
        started_at: None,
    }
}

/// Attach the authoritative start timestamp to every observer frame for a turn.
pub fn context_for_turn(
    channel_id: Option<uuid::Uuid>,
    session_id: Option<String>,
    turn_id: String,
    started_at: String,
) -> ObserverContext {
    ObserverContext {
        channel_id: channel_id.map(|id| id.to_string()),
        session_id,
        turn_id: Some(turn_id),
        started_at: Some(started_at),
    }
}
