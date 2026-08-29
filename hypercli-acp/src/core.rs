use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::json;
use uuid::Uuid;

use crate::activity::ActivityBus;
use crate::connectors::Connector;
use crate::queue::{QueuedTurn, TurnQueue};
use crate::runtime::{runtime_error_payload, RuntimeAdapter, RuntimeError, RuntimeTurn};
use crate::sessions::SessionStore;
use crate::trace::TraceStore;
use crate::types::{
    ActivityFrame, ActivityKind, ConnectorReply, ControlResult, ControlStatus, DeliveryReceipt,
    ErrorClass, NormalizedTurn, PlatformCommand, ReplyStatus, SessionListRequest, SessionTrace,
    SessionTraceFilter, StopReason, TraceSession, TurnAccepted, TurnError, TurnTerminal,
    TurnTiming, TurnUsage,
};

const LIVENESS_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Clone)]
pub struct CoreState {
    activity: ActivityBus,
    queue: Arc<TurnQueue>,
    sessions: Arc<SessionStore>,
    trace: Option<TraceStore>,
    runtime: Arc<dyn RuntimeAdapter>,
    connectors: Arc<tokio::sync::Mutex<HashMap<String, Arc<dyn Connector>>>>,
}

impl CoreState {
    pub fn new(runtime: Arc<dyn RuntimeAdapter>) -> Self {
        Self {
            activity: ActivityBus::default(),
            queue: Arc::new(TurnQueue::default()),
            sessions: Arc::new(SessionStore::default()),
            trace: None,
            runtime,
            connectors: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }

    pub async fn with_trace(
        runtime: Arc<dyn RuntimeAdapter>,
        trace: TraceStore,
    ) -> anyhow::Result<Self> {
        let sessions = trace.load_active_sessions().await?;
        Ok(Self {
            activity: ActivityBus::default(),
            queue: Arc::new(TurnQueue::default()),
            sessions: Arc::new(SessionStore::from_bindings(sessions)),
            trace: Some(trace),
            runtime,
            connectors: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        })
    }

    pub fn activity(&self) -> ActivityBus {
        self.activity.clone()
    }

    pub fn trace(&self) -> Option<TraceStore> {
        self.trace.clone()
    }

    pub async fn register_connector(&self, connector: Arc<dyn Connector>) {
        self.connectors
            .lock()
            .await
            .insert(connector.id().to_string(), connector);
    }

    pub async fn submit_turn(&self, turn: NormalizedTurn) -> TurnAccepted {
        let queued_at = Utc::now();
        let turn_for_trace = turn.clone();
        let connector = turn.connector.clone();
        let turn_id = turn
            .turn_id
            .clone()
            .unwrap_or_else(|| format!("turn_{}", Uuid::new_v4()));
        let admission = self.queue.admit(turn, turn_id, queued_at).await;
        self.record_trace_turn_accepted(&turn_for_trace, &admission.accepted)
            .await;

        self.emit_activity(ActivityFrame {
            seq: 0,
            timestamp: Utc::now(),
            kind: ActivityKind::TurnQueued,
            connector: Some(connector),
            conversation_key: Some(admission.accepted.conversation_key.clone()),
            session_id: None,
            turn_id: Some(admission.accepted.turn_id.clone()),
            started_at: None,
            payload: Some(json!({
                "status": admission.accepted.status,
                "queued_at": admission.accepted.queued_at,
            })),
        })
        .await;

        if let Some(dispatch) = admission.dispatch {
            self.spawn_turn(dispatch);
        }
        admission.accepted
    }

    pub async fn submit_command(
        &self,
        request_id: Option<String>,
        command: PlatformCommand,
        conversation_key: Option<String>,
        turn_id: Option<String>,
    ) -> ControlResult {
        match command {
            PlatformCommand::TurnCancel => {
                let Some(conversation_key) = conversation_key else {
                    return ControlResult {
                        request_id,
                        command,
                        status: ControlStatus::NotFound,
                        message: Some("missing conversation_key".to_string()),
                    };
                };
                let queue_found = self
                    .queue
                    .cancel(&conversation_key, turn_id.as_deref())
                    .await;
                let _ = self
                    .runtime
                    .cancel_turn(&conversation_key, turn_id.as_deref())
                    .await;
                self.emit_activity_kind(
                    ActivityKind::TurnCancelled,
                    Some(conversation_key),
                    turn_id,
                    Some(json!({ "queue_found": queue_found })),
                )
                .await;
                ControlResult {
                    request_id,
                    command,
                    status: if queue_found {
                        ControlStatus::Sent
                    } else {
                        ControlStatus::NotFound
                    },
                    message: None,
                }
            }
            PlatformCommand::SessionRotate => {
                let Some(conversation_key) = conversation_key else {
                    return ControlResult {
                        request_id,
                        command,
                        status: ControlStatus::NotFound,
                        message: Some("missing conversation_key".to_string()),
                    };
                };
                let removed = self.sessions.rotate(&conversation_key).await;
                if removed.is_some() {
                    self.record_trace_session_rotated(&conversation_key, Utc::now())
                        .await;
                }
                self.emit_activity_kind(
                    ActivityKind::SessionRotated,
                    Some(conversation_key),
                    None,
                    Some(json!({ "removed_session_id": removed })),
                )
                .await;
                ControlResult {
                    request_id,
                    command,
                    status: ControlStatus::Accepted,
                    message: None,
                }
            }
            PlatformCommand::RuntimeShutdown => {
                self.emit_activity_kind(ActivityKind::RuntimeStopping, None, None, None)
                    .await;
                let result = self.runtime.shutdown().await;
                self.emit_activity_kind(
                    if result.is_ok() {
                        ActivityKind::RuntimeStopped
                    } else {
                        ActivityKind::RuntimeError
                    },
                    None,
                    None,
                    result.err().map(|err| runtime_error_payload(&err)),
                )
                .await;
                ControlResult {
                    request_id,
                    command,
                    status: ControlStatus::Accepted,
                    message: None,
                }
            }
            PlatformCommand::TurnSteer
            | PlatformCommand::RuntimeRestartAgent
            | PlatformCommand::RuntimeSwitchModel => ControlResult {
                request_id,
                command,
                status: ControlStatus::Unsupported,
                message: Some("command boundary is reserved for later lanes".to_string()),
            },
        }
    }

    fn spawn_turn(&self, queued: QueuedTurn) {
        let core = self.clone();
        tokio::spawn(async move {
            core.run_queued_turn(queued).await;
        });
    }

    async fn run_queued_turn(self, queued: QueuedTurn) {
        let conversation_key = queued.turn.conversation_key.clone();
        let turn_id = queued.turn_id.clone();
        let started_at = Utc::now();
        let existing_session_id = self.sessions.get(&conversation_key).await;

        self.record_trace_turn_started(
            &turn_id,
            &conversation_key,
            existing_session_id.as_deref(),
            started_at,
        )
        .await;
        self.emit_activity(ActivityFrame {
                seq: 0,
                timestamp: started_at,
                kind: ActivityKind::TurnStarted,
                connector: Some(queued.turn.connector.clone()),
                conversation_key: Some(conversation_key.clone()),
                session_id: existing_session_id.clone(),
                turn_id: Some(turn_id.clone()),
                started_at: Some(started_at),
                payload: Some(json!({
                    "queued_at": queued.queued_at,
                    "queue_duration_ms": started_at.signed_duration_since(queued.queued_at).num_milliseconds(),
                })),
            }).await;

        let liveness = tokio::spawn({
            let core = self.clone();
            let conversation_key = conversation_key.clone();
            let turn_id = turn_id.clone();
            let connector = queued.turn.connector.clone();
            async move {
                let mut interval = tokio::time::interval(LIVENESS_INTERVAL);
                interval.tick().await;
                loop {
                    interval.tick().await;
                    core.emit_activity(ActivityFrame {
                        seq: 0,
                        timestamp: Utc::now(),
                        kind: ActivityKind::TurnLiveness,
                        connector: Some(connector.clone()),
                        conversation_key: Some(conversation_key.clone()),
                        session_id: None,
                        turn_id: Some(turn_id.clone()),
                        started_at: Some(started_at),
                        payload: Some(json!({
                            "elapsed_ms": Utc::now().signed_duration_since(started_at).num_milliseconds(),
                        })),
                    })
                    .await;
                }
            }
        });

        let result = self.execute_turn(queued.clone()).await;
        liveness.abort();
        let completed_at = Utc::now();
        let next = self.queue.complete(&conversation_key, &turn_id).await;

        match result {
            Ok((session_id, reply, stop_reason, usage)) => {
                let mut reply_status = ReplyStatus::NoReply;
                if let Some(text) = reply {
                    let reply = ConnectorReply {
                        connector: queued.turn.connector.clone(),
                        turn_id: turn_id.clone(),
                        conversation_key: conversation_key.clone(),
                        target: queued.turn.reply_target.clone(),
                        text,
                    };
                    self.emit_activity(ActivityFrame {
                        seq: 0,
                        timestamp: Utc::now(),
                        kind: ActivityKind::TurnReplyAttempted,
                        connector: Some(queued.turn.connector.clone()),
                        conversation_key: Some(conversation_key.clone()),
                        session_id: Some(session_id.clone()),
                        turn_id: Some(turn_id.clone()),
                        started_at: Some(started_at),
                        payload: Some(json!(reply)),
                    })
                    .await;
                    reply_status = self
                        .deliver_reply(reply, Some(session_id.clone()), started_at)
                        .await;
                }

                let terminal = terminal_record(TerminalRecordInput {
                    queued: &queued,
                    session_id: Some(session_id),
                    started_at,
                    completed_at,
                    reply_status,
                    stop_reason: Some(stop_reason),
                    error: None,
                    usage,
                });
                self.record_trace_turn_terminal(&terminal, "completed")
                    .await;
                self.emit_activity(ActivityFrame {
                    seq: 0,
                    timestamp: completed_at,
                    kind: ActivityKind::TurnCompleted,
                    connector: Some(queued.turn.connector.clone()),
                    conversation_key: Some(conversation_key.clone()),
                    session_id: terminal.session_id.clone(),
                    turn_id: Some(turn_id.clone()),
                    started_at: Some(started_at),
                    payload: Some(json!(terminal)),
                })
                .await;
            }
            Err(err) => {
                let class = match err {
                    RuntimeError::Cancelled => ErrorClass::Cancelled,
                    RuntimeError::Unavailable(_) | RuntimeError::Failed(_) => ErrorClass::Runtime,
                };
                let terminal = terminal_record(TerminalRecordInput {
                    queued: &queued,
                    session_id: existing_session_id,
                    started_at,
                    completed_at,
                    reply_status: ReplyStatus::NotAttempted,
                    stop_reason: Some(match class {
                        ErrorClass::Cancelled => StopReason::Cancelled,
                        _ => StopReason::RuntimeError,
                    }),
                    error: Some(TurnError {
                        code: "runtime_error".to_string(),
                        class,
                        message: err.to_string(),
                        retryable: class == ErrorClass::Runtime,
                    }),
                    usage: None,
                });
                self.record_trace_turn_terminal(&terminal, "failed").await;
                self.emit_activity(ActivityFrame {
                    seq: 0,
                    timestamp: completed_at,
                    kind: ActivityKind::TurnFailed,
                    connector: Some(queued.turn.connector.clone()),
                    conversation_key: Some(conversation_key.clone()),
                    session_id: terminal.session_id.clone(),
                    turn_id: Some(turn_id.clone()),
                    started_at: Some(started_at),
                    payload: Some(json!(terminal)),
                })
                .await;
            }
        }

        if let Some(next) = next {
            self.spawn_turn(next);
        }
    }

    async fn execute_turn(
        &self,
        queued: QueuedTurn,
    ) -> Result<(String, Option<String>, StopReason, Option<TurnUsage>), RuntimeError> {
        let conversation_key = queued.turn.conversation_key.clone();
        let session = self
            .runtime
            .ensure_session(
                &conversation_key,
                self.sessions.get(&conversation_key).await,
            )
            .await?;
        if session.created {
            self.emit_activity_kind(
                ActivityKind::SessionCreated,
                Some(conversation_key.clone()),
                Some(queued.turn_id.clone()),
                Some(json!({ "session_id": session.session_id })),
            )
            .await;
        }
        self.sessions
            .bind(conversation_key.clone(), session.session_id.clone())
            .await;
        self.record_trace_session_bound(
            &conversation_key,
            &session.session_id,
            Some(&queued.turn.connector),
            Utc::now(),
        )
        .await;
        self.record_trace_turn_started(
            &queued.turn_id,
            &conversation_key,
            Some(&session.session_id),
            Utc::now(),
        )
        .await;
        let result = self
            .runtime
            .run_turn(RuntimeTurn {
                turn: queued.turn,
                session_id: session.session_id.clone(),
            })
            .await?;
        Ok((
            session.session_id,
            result.reply_text,
            result.stop_reason,
            result.usage,
        ))
    }

    async fn deliver_reply(
        &self,
        reply: ConnectorReply,
        session_id: Option<String>,
        started_at: DateTime<Utc>,
    ) -> ReplyStatus {
        let connector = self.connectors.lock().await.get(&reply.connector).cloned();
        let Some(connector) = connector else {
            self.emit_reply_failed(
                &reply,
                session_id,
                started_at,
                "connector_not_registered",
                "no connector registered for reply delivery",
            )
            .await;
            return ReplyStatus::Failed;
        };

        match connector.deliver_reply(reply.clone()).await {
            Ok(receipt) => {
                self.emit_reply_delivered(&reply, session_id, started_at, receipt)
                    .await;
                ReplyStatus::Delivered
            }
            Err(error) => {
                self.emit_reply_failed(
                    &reply,
                    session_id,
                    started_at,
                    "connector_delivery_failed",
                    error.message(),
                )
                .await;
                ReplyStatus::Failed
            }
        }
    }

    async fn emit_reply_delivered(
        &self,
        reply: &ConnectorReply,
        session_id: Option<String>,
        started_at: DateTime<Utc>,
        receipt: DeliveryReceipt,
    ) {
        self.emit_activity(ActivityFrame {
            seq: 0,
            timestamp: Utc::now(),
            kind: ActivityKind::TurnReplyDelivered,
            connector: Some(reply.connector.clone()),
            conversation_key: Some(reply.conversation_key.clone()),
            session_id,
            turn_id: Some(reply.turn_id.clone()),
            started_at: Some(started_at),
            payload: Some(json!(receipt)),
        })
        .await;
    }

    async fn emit_reply_failed(
        &self,
        reply: &ConnectorReply,
        session_id: Option<String>,
        started_at: DateTime<Utc>,
        code: &str,
        message: &str,
    ) {
        self.emit_activity(ActivityFrame {
            seq: 0,
            timestamp: Utc::now(),
            kind: ActivityKind::TurnReplyFailed,
            connector: Some(reply.connector.clone()),
            conversation_key: Some(reply.conversation_key.clone()),
            session_id,
            turn_id: Some(reply.turn_id.clone()),
            started_at: Some(started_at),
            payload: Some(json!({
                "code": code,
                "message": message,
                "retryable": true,
            })),
        })
        .await;
    }

    pub async fn list_sessions(&self, request: SessionListRequest) -> Vec<TraceSession> {
        let Some(trace) = &self.trace else {
            return Vec::new();
        };
        match trace
            .list_sessions(request.conversation_key.as_deref())
            .await
        {
            Ok(sessions) => sessions,
            Err(error) => {
                tracing::warn!(%error, "failed to list session trace");
                Vec::new()
            }
        }
    }

    pub async fn traceback(&self, filter: SessionTraceFilter) -> SessionTrace {
        let request_id = filter.request_id.clone();
        let conversation_key = filter.conversation_key.clone();
        let session_id = filter.session_id.clone();
        let Some(trace) = &self.trace else {
            return SessionTrace {
                request_id,
                conversation_key,
                session_id,
                sessions: Vec::new(),
                turns: Vec::new(),
                activity: Vec::new(),
            };
        };
        match trace.traceback(filter).await {
            Ok(traceback) => traceback,
            Err(error) => {
                tracing::warn!(%error, "failed to read session trace");
                SessionTrace {
                    request_id,
                    conversation_key,
                    session_id,
                    sessions: Vec::new(),
                    turns: Vec::new(),
                    activity: Vec::new(),
                }
            }
        }
    }

    async fn emit_activity(&self, frame: ActivityFrame) -> ActivityFrame {
        let frame = self.activity.emit(frame).await;
        if let Some(trace) = &self.trace {
            if let Err(error) = trace.record_activity(&frame).await {
                tracing::warn!(%error, seq = frame.seq, "failed to persist activity trace");
            }
        }
        frame
    }

    async fn emit_activity_kind(
        &self,
        kind: ActivityKind,
        conversation_key: Option<String>,
        turn_id: Option<String>,
        payload: Option<serde_json::Value>,
    ) -> ActivityFrame {
        self.emit_activity(ActivityFrame {
            seq: 0,
            timestamp: Utc::now(),
            kind,
            connector: None,
            conversation_key,
            session_id: None,
            turn_id,
            started_at: None,
            payload,
        })
        .await
    }

    async fn record_trace_turn_accepted(&self, turn: &NormalizedTurn, accepted: &TurnAccepted) {
        if let Some(trace) = &self.trace {
            if let Err(error) = trace.record_turn_accepted(turn, accepted).await {
                tracing::warn!(%error, turn_id = accepted.turn_id, "failed to persist accepted turn");
            }
        }
    }

    async fn record_trace_turn_started(
        &self,
        turn_id: &str,
        conversation_key: &str,
        session_id: Option<&str>,
        started_at: DateTime<Utc>,
    ) {
        if let Some(trace) = &self.trace {
            if let Err(error) = trace
                .record_turn_started(turn_id, conversation_key, session_id, started_at)
                .await
            {
                tracing::warn!(%error, %turn_id, "failed to persist started turn");
            }
        }
    }

    async fn record_trace_turn_terminal(&self, terminal: &TurnTerminal, status: &str) {
        if let Some(trace) = &self.trace {
            if let Err(error) = trace.record_turn_terminal(terminal, status).await {
                tracing::warn!(%error, turn_id = terminal.turn_id, "failed to persist terminal turn");
            }
        }
    }

    async fn record_trace_session_bound(
        &self,
        conversation_key: &str,
        session_id: &str,
        connector: Option<&str>,
        now: DateTime<Utc>,
    ) {
        if let Some(trace) = &self.trace {
            if let Err(error) = trace
                .record_session_bound(conversation_key, session_id, connector, now)
                .await
            {
                tracing::warn!(%error, %conversation_key, %session_id, "failed to persist session");
            }
        }
    }

    async fn record_trace_session_rotated(&self, conversation_key: &str, now: DateTime<Utc>) {
        if let Some(trace) = &self.trace {
            if let Err(error) = trace.record_session_rotated(conversation_key, now).await {
                tracing::warn!(%error, %conversation_key, "failed to persist session rotation");
            }
        }
    }
}

struct TerminalRecordInput<'a> {
    queued: &'a QueuedTurn,
    session_id: Option<String>,
    started_at: DateTime<Utc>,
    completed_at: DateTime<Utc>,
    reply_status: ReplyStatus,
    stop_reason: Option<StopReason>,
    error: Option<TurnError>,
    usage: Option<TurnUsage>,
}

fn terminal_record(input: TerminalRecordInput<'_>) -> TurnTerminal {
    let TerminalRecordInput {
        queued,
        session_id,
        started_at,
        completed_at,
        reply_status,
        stop_reason,
        error,
        usage,
    } = input;

    TurnTerminal {
        turn_id: queued.turn_id.clone(),
        conversation_key: queued.turn.conversation_key.clone(),
        connector: Some(queued.turn.connector.clone()),
        session_id,
        timing: TurnTiming {
            queued_at: queued.queued_at,
            started_at: Some(started_at),
            completed_at: Some(completed_at),
            duration_ms: Some(
                completed_at
                    .signed_duration_since(started_at)
                    .num_milliseconds(),
            ),
            queue_duration_ms: Some(
                started_at
                    .signed_duration_since(queued.queued_at)
                    .num_milliseconds(),
            ),
            last_liveness_at: None,
        },
        reply_status,
        stop_reason,
        error_class: error.as_ref().map(|err| err.class),
        error,
        usage,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use crate::runtime::StubRuntime;
    use crate::trace::TraceStore;
    use crate::types::{
        Actor, ActorKind, Message, NormalizedTurn, ReplyTarget, SessionTraceFilter,
        TurnAdmissionStatus, TurnContext,
    };

    use super::*;

    fn turn(key: &str, conversation: &str) -> NormalizedTurn {
        NormalizedTurn {
            turn_id: None,
            request_id: Some(format!("req_{key}")),
            idempotency_key: key.to_string(),
            connector: "web".to_string(),
            conversation_key: conversation.to_string(),
            sender: Actor {
                id: "u1".to_string(),
                display: Some("User".to_string()),
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
        }
    }

    #[tokio::test]
    async fn submit_turn_emits_started_before_terminal() {
        let core = CoreState::new(Arc::new(StubRuntime));
        let accepted = core.submit_turn(turn("a", "web:1")).await;
        assert_eq!(accepted.status, TurnAdmissionStatus::Accepted);

        tokio::time::sleep(Duration::from_millis(30)).await;
        let snapshot = core.activity().snapshot().await;
        let started = snapshot
            .iter()
            .position(|frame| frame.kind == ActivityKind::TurnStarted)
            .expect("turn.started");
        let terminal = snapshot
            .iter()
            .position(|frame| frame.kind == ActivityKind::TurnCompleted)
            .expect("turn.completed");
        assert!(started < terminal);

        let payload = snapshot[terminal]
            .payload
            .as_ref()
            .expect("terminal payload");
        assert!(payload.get("duration_ms").is_some());
        assert!(payload.get("usage").is_none());
    }

    #[tokio::test]
    async fn duplicate_submit_returns_existing_turn() {
        let core = CoreState::new(Arc::new(StubRuntime));
        let first = core.submit_turn(turn("a", "web:1")).await;
        let second = core.submit_turn(turn("a", "web:1")).await;
        assert_eq!(second.status, TurnAdmissionStatus::Duplicate);
        assert_eq!(first.turn_id, second.turn_id);
    }

    #[tokio::test]
    async fn traced_core_persists_turns_sessions_and_activity() {
        let trace = TraceStore::memory().expect("trace");
        let core = CoreState::with_trace(Arc::new(StubRuntime), trace)
            .await
            .expect("core");
        let accepted = core.submit_turn(turn("trace", "web:trace")).await;

        for _ in 0..20 {
            let traceback = core
                .traceback(SessionTraceFilter {
                    request_id: Some("trace_req".to_string()),
                    conversation_key: Some("web:trace".to_string()),
                    session_id: None,
                    limit: None,
                })
                .await;
            if traceback
                .turns
                .iter()
                .any(|turn| turn.status == "completed")
            {
                assert_eq!(traceback.sessions.len(), 1);
                assert_eq!(traceback.turns.len(), 1);
                assert_eq!(traceback.turns[0].turn_id, accepted.turn_id);
                assert_eq!(
                    traceback.turns[0].session_id.as_deref(),
                    Some("stub_session:web:trace")
                );
                assert!(traceback.turns[0].completed_at.is_some());
                assert!(traceback
                    .activity
                    .iter()
                    .any(|frame| frame.kind == ActivityKind::TurnCompleted));
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        panic!("turn was not traced as completed");
    }
}
