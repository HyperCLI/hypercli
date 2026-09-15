//! Buzz-shaped ACP worker pool over the official `agent-client-protocol` SDK.
//!
//! Semantics ported from `plugins/buzz/src/pool.rs` (claim/failure/rotation
//! rules); the wire layer is the official SDK rather than buzz's hand-rolled
//! NDJSON client. Buzz-only concerns (presence, heartbeat, Nostr identity,
//! observer bus, setup mode, lazy pool) are intentionally not ported.
//!
//! # Connection sharing design
//!
//! [`ConnectionTo<Agent>`] is `Clone + Send + 'static` (SDK `jsonrpc.rs`:
//! "cheaply cloneable — all clones refer to the same underlying connection"),
//! so there is no per-worker command channel: each slot spawns one
//! `Client::builder()...connect_with(agent, |cx| ...)` task whose callback
//! ships its `cx` out through a oneshot and then parks until shutdown. Turn
//! tasks use a cloned `cx` directly (`send_request(..).block_task()` from a
//! plain tokio task — never inside a handler callback, per SDK docs).

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use agent_client_protocol::schema::v1::{
    CancelNotification, ContentBlock, InitializeRequest, NewSessionRequest, PromptRequest,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionId, SessionNotification, SessionUpdate, StopReason,
    TextContent,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, ConnectionTo};
use serde_json::Value;
use thiserror::Error;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::config::Config;
use crate::limits::SLACK_TEXT_LIMIT;
use crate::monitor::message_handler::dispatch_progress::status_text_for_update;
use crate::monitor::replies::{
    build_assistant_thread_status_operation, plan_slack_reply_deliveries,
    relay_request_for_operation, SlackRelayHttpSender, SlackReplyPayload,
};
use crate::queue::{QueuedSlackEvent, SlackFlushBatch, SlackReplyRouting};
use crate::scope::SlackSessionScope;

/// Timeout for `initialize` and `session/new` requests.
pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Grace period awaiting the cancelled prompt response after `session/cancel`.
pub(crate) const CANCEL_GRACE: Duration = Duration::from_secs(10);
/// Failures inside this window count toward the circuit breaker.
pub(crate) const CIRCUIT_BREAKER_WINDOW: Duration = Duration::from_secs(60);
/// Rapid failures that trip the breaker, pausing respawns for one window.
pub(crate) const CIRCUIT_BREAKER_THRESHOLD: usize = 3;
/// Circuit-breaker cool-off duration.
pub(crate) const CIRCUIT_BREAKER_COOLDOWN: Duration = Duration::from_secs(60);

/// User-visible line delivered when a turn fails before any reply (parity with
/// superseded frame-observer `complete_prompt_response`).
pub const AGENT_FAILURE_LINE: &str = "The agent failed before sending a Slack-visible reply.";

/// Errors surfaced when spawning or initializing a pool worker.
#[derive(Debug, Error)]
pub enum PoolError {
    /// ACP child spawn or connection setup failed.
    #[error("agent spawn failed: {0}")]
    Spawn(String),
    /// The agent failed to answer `initialize` in time or with an error.
    #[error("initialize failed: {0}")]
    Initialize(String),
}

/// Why a turn failed before producing any Slack-visible reply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnFailureKind {
    /// `session/new` failed or timed out.
    SessionNew,
    /// The `session/prompt` request errored.
    PromptError,
    /// No ACP wire activity for the idle timeout.
    IdleTimeout,
    /// The agent connection fell over mid-turn.
    ConnectionClosed,
    /// `session/cancel` was not honored within the grace window (agent wedged).
    CancelGraceExpired,
}

/// How a turn ended.
#[derive(Debug)]
pub enum TurnDisposition {
    /// The prompt completed with a stop reason.
    Completed(StopReason),
    /// The turn failed before delivering a reply.
    Failed(TurnFailureKind),
    /// The turn was interrupted; merged events become the next turn.
    Interrupted,
}

/// Result shipped back to the dispatcher when a turn task ends.
#[derive(Debug)]
pub struct TurnOutcome {
    /// Slot that ran the turn.
    pub slot: usize,
    /// Worker to check back into the slot (`None` = kill + respawn the slot).
    pub worker: Option<Worker>,
    /// What happened.
    pub disposition: TurnDisposition,
    /// The batch, back (the dispatcher owns queue requeue/complete).
    pub batch: SlackFlushBatch,
}

/// Delivery facts for posting Slack replies through the relay HTTP proxy.
#[derive(Debug)]
pub struct DeliveryTarget {
    /// Relay HTTP API base URL.
    pub relay_api_base_url: String,
    /// `HYPER_AGENTS_API_KEY` bearer for the relay proxy.
    pub hyper_agents_api_key: String,
    /// Shared reqwest-backed sender (bounded 429/5xx retry built in).
    pub sender: SlackRelayHttpSender,
}

/// Shared turn context: harness config + delivery facts + agent cwd.
#[derive(Debug)]
pub struct DispatchContext {
    /// Harness configuration (idle timeout, rotation policy, mode).
    pub config: Arc<Config>,
    /// Working directory for new ACP sessions.
    pub cwd: PathBuf,
    /// Relay delivery facts.
    pub delivery: Option<DeliveryTarget>,
    /// Shared durable store: turn-terminal `Commit` records are written here
    /// (the relay loop holds a clone for dispatch-time claims).
    pub store: crate::monitor::ingress::SharedSlackRelayStore,
}

/// One pool worker. Checked out whole (buzz `OwnedAgent` pattern) so at most
/// one turn runs per worker at a time — the notification and interrupt
/// receivers can only belong to the in-flight turn.
#[derive(Debug)]
pub struct Worker {
    slot: usize,
    cx: ConnectionTo<Agent>,
    notify_rx: mpsc::UnboundedReceiver<SessionNotification>,
    interrupt_tx: mpsc::UnboundedSender<()>,
    interrupt_rx: mpsc::UnboundedReceiver<()>,
    shutdown_tx: oneshot::Sender<()>,
    connection_task: JoinHandle<()>,
    sessions: HashMap<SlackSessionScope, SessionId>,
    turn_counts: HashMap<SlackSessionScope, u64>,
}

impl Worker {
    /// Whether the child connection task is still alive.
    #[must_use]
    pub fn connection_alive(&self) -> bool {
        !self.connection_task.is_finished()
    }
}

/// Slot lifecycle.
#[derive(Debug)]
enum SlotState {
    /// Worker is checked in and ready.
    Idle(Worker),
    /// Worker is checked out running a turn.
    CheckedOut,
    /// Circuit breaker tripped: do not respawn before the stored instant.
    CoolingOff(Instant),
    /// Worker died; slot needs a respawn.
    Dead,
}

/// A single pool slot.
#[derive(Debug)]
struct Slot {
    state: SlotState,
    interrupt_tx: Option<mpsc::UnboundedSender<()>>,
    failures: VecDeque<Instant>,
}

/// Buzz-shaped worker pool: fixed-size slot vec, per-scope session ownership,
/// per-slot circuit breaker.
#[derive(Debug)]
pub struct AgentPool {
    slots: Vec<Slot>,
    /// Scope → slot that hosts its session. Busy owners hold the scope's
    /// batch rather than double-forking (buzz session-stickiness parity).
    session_owners: HashMap<SlackSessionScope, usize>,
    /// Scope → slot currently running its turn (for interrupt routing).
    in_flight: HashMap<SlackSessionScope, usize>,
}

impl AgentPool {
    /// Create a pool with `slots` dead slots; workers spawn lazily via
    /// [`respawn_needed_slots`](Self::respawn_needed_slots).
    #[must_use]
    pub fn new(slots: usize) -> Self {
        let slots = (0..slots)
            .map(|_| Slot {
                state: SlotState::Dead,
                interrupt_tx: None,
                failures: VecDeque::new(),
            })
            .collect();
        Self {
            slots,
            session_owners: HashMap::new(),
            in_flight: HashMap::new(),
        }
    }

    /// Respawn every slot that needs it (dead, or cool-off elapsed).
    pub async fn respawn_needed_slots(&mut self, ctx: &DispatchContext) {
        for index in 0..self.slots.len() {
            let needs_spawn = match &self.slots[index].state {
                SlotState::Dead => true,
                SlotState::CoolingOff(until) => Instant::now() >= *until,
                SlotState::Idle(_) | SlotState::CheckedOut => false,
            };
            if !needs_spawn {
                continue;
            }
            match spawn_worker(index, ctx).await {
                Ok(worker) => {
                    self.slots[index].interrupt_tx = Some(worker.interrupt_tx.clone());
                    self.slots[index].state = SlotState::Idle(worker);
                    tracing::info!(slot = index, "slack-acp pool: worker spawned");
                }
                Err(error) => {
                    tracing::warn!(slot = index, "slack-acp pool: spawn failed: {error}");
                    self.record_failure(index);
                }
            }
        }
    }

    /// Claim an idle worker for `scope`: prefer the scope's owner slot; a busy
    /// (or dead) owner holds the batch (`None`) rather than re-routing (buzz
    /// rule). Falls back to any idle slot and records ownership.
    #[must_use]
    pub fn claim(&mut self, scope: &SlackSessionScope) -> Option<Worker> {
        if let Some(&owner) = self.session_owners.get(scope) {
            if let Some(slot) = self.slots.get_mut(owner) {
                if let SlotState::Idle(_) = slot.state {
                    if let SlotState::Idle(worker) =
                        std::mem::replace(&mut slot.state, SlotState::CheckedOut)
                    {
                        if worker.connection_alive() {
                            self.in_flight.insert(scope.clone(), owner);
                            return Some(worker);
                        }
                        // Dead handle: drop it; respawn on the next maintenance pass.
                        slot.state = SlotState::Dead;
                    }
                }
            }
            // Owner busy or dead — hold.
            return None;
        }
        // Pass 2: any idle slot with a live connection.
        for index in 0..self.slots.len() {
            if let SlotState::Idle(_) = self.slots[index].state {
                if let SlotState::Idle(worker) =
                    std::mem::replace(&mut self.slots[index].state, SlotState::CheckedOut)
                {
                    if worker.connection_alive() {
                        self.session_owners.insert(scope.clone(), index);
                        self.in_flight.insert(scope.clone(), index);
                        return Some(worker);
                    }
                    self.slots[index].state = SlotState::Dead;
                    return None;
                }
            }
        }
        None
    }

    /// Check a finished worker back into its slot.
    pub fn checkin(&mut self, worker: Worker) {
        let slot = worker.slot;
        self.slots[slot].interrupt_tx = Some(worker.interrupt_tx.clone());
        self.slots[slot].state = SlotState::Idle(worker);
    }

    /// Mark a scope's turn over in the in-flight ledger.
    pub fn clear_in_flight(&mut self, scope: &SlackSessionScope) {
        self.in_flight.remove(scope);
    }

    /// Scopes with a turn in flight (interrupt routing candidates).
    #[must_use]
    pub fn in_flight_scopes(&self) -> Vec<SlackSessionScope> {
        self.in_flight.keys().cloned().collect()
    }

    /// Record a slot failure whose worker will not come back (kill + respawn):
    /// trip the circuit breaker after `CIRCUIT_BREAKER_THRESHOLD` failures
    /// inside one `CIRCUIT_BREAKER_WINDOW`, cooling off before respawn.
    pub fn record_failure(&mut self, slot: usize) {
        let entry = &mut self.slots[slot];
        let now = Instant::now();
        while entry
            .failures
            .front()
            .is_some_and(|then| now.duration_since(*then) > CIRCUIT_BREAKER_WINDOW)
        {
            entry.failures.pop_front();
        }
        entry.failures.push_back(now);
        if entry.failures.len() >= CIRCUIT_BREAKER_THRESHOLD {
            tracing::warn!(
                slot,
                failures = entry.failures.len(),
                "slack-acp pool: circuit breaker tripped; slot cooling off for 60s"
            );
            entry.failures.clear();
            entry.state = SlotState::CoolingOff(now + CIRCUIT_BREAKER_COOLDOWN);
        } else {
            entry.state = SlotState::Dead;
        }
    }

    /// Send an interrupt (cancel + merged re-prompt) to the worker running
    /// `scope`, if any. Returns `true` when the signal was delivered.
    #[must_use]
    pub fn interrupt(&self, scope: &SlackSessionScope) -> bool {
        let Some(&slot) = self.in_flight.get(scope) else {
            return false;
        };
        self.slots[slot]
            .interrupt_tx
            .as_ref()
            .is_some_and(|tx| tx.send(()).is_ok())
    }

    /// Ask all checked-in workers to shut down (dropping `cx`/killing the
    /// child happens when the connection-task callback returns).
    pub async fn shutdown_all(&mut self) {
        for slot in &mut self.slots {
            if let SlotState::Idle(worker) = std::mem::replace(&mut slot.state, SlotState::Dead) {
                let _ignored = worker.shutdown_tx.send(());
                let _ignored =
                    tokio::time::timeout(Duration::from_secs(5), worker.connection_task).await;
            }
        }
    }

    /// Count of slots with an idle worker (tests + diagnostics).
    #[cfg(test)]
    fn idle_count(&self) -> usize {
        self.slots
            .iter()
            .filter(|slot| matches!(slot.state, SlotState::Idle(_)))
            .count()
    }
}

/// Spawn a worker child and initialize it. The `connect_with` callback ships
/// its `cx` out through a oneshot and then parks until shutdown (see module
/// docs for the sharing design).
async fn spawn_worker(slot: usize, ctx: &DispatchContext) -> Result<Worker, PoolError> {
    let agent = AcpAgent::new(
        AcpAgentConfig::new(&ctx.config.agent_command).args(ctx.config.agent_args.clone()),
    );
    let (cx_tx, cx_rx) = oneshot::channel();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (notify_tx, notify_rx) = mpsc::unbounded_channel();
    let (interrupt_tx, interrupt_rx) = mpsc::unbounded_channel();

    let connection_task = tokio::spawn(async move {
        let result = Client
            .builder()
            .on_receive_notification(
                async move |notification: SessionNotification, _cx| {
                    let _ignored = notify_tx.send(notification);
                    Ok(())
                },
                agent_client_protocol::on_receive_notification!(),
            )
            .on_receive_request(
                async move |request: RequestPermissionRequest, responder, _connection| {
                    // YOLO: auto-approve by selecting the first option (buzz parity).
                    if let Some(option) = request.options.first() {
                        responder.respond(RequestPermissionResponse::new(
                            RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                                option.option_id.clone(),
                            )),
                        ))
                    } else {
                        responder.respond(RequestPermissionResponse::new(
                            RequestPermissionOutcome::Cancelled,
                        ))
                    }
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_with(agent, move |cx: ConnectionTo<Agent>| async move {
                let _ignored = cx_tx.send(cx.clone());
                // Park until shutdown; returning tears down the connection and
                // terminates the child process.
                let _ignored = shutdown_rx.await;
                drop(cx);
                Ok(())
            })
            .await;
        if let Err(error) = result {
            tracing::debug!(slot, "slack-acp worker connection ended: {error}");
        }
    });

    let cx = cx_rx
        .await
        .map_err(|_| PoolError::Spawn("connection task died before handing out cx".to_owned()))?;

    initialize(&cx).await?;

    Ok(Worker {
        slot,
        cx,
        notify_rx,
        interrupt_tx,
        interrupt_rx,
        shutdown_tx,
        connection_task,
        sessions: HashMap::new(),
        turn_counts: HashMap::new(),
    })
}

async fn initialize(cx: &ConnectionTo<Agent>) -> Result<(), PoolError> {
    let response = tokio::time::timeout(
        REQUEST_TIMEOUT,
        cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
            .block_task(),
    )
    .await
    .map_err(|_| PoolError::Initialize("timed out after 30s".to_owned()))?
    .map_err(|error| PoolError::Initialize(error.to_string()))?;
    tracing::info!(agent_info = ?response.agent_info, "slack-acp: worker agent initialized");
    Ok(())
}

/// Whether a completed session should rotate: over-capacity stop reasons
/// always rotate; count-based rotation only when the knob is non-zero.
#[must_use]
pub fn should_rotate_session(
    stop_reason: StopReason,
    turn_count: u64,
    max_turns_per_session: u32,
) -> bool {
    if matches!(
        stop_reason,
        StopReason::MaxTokens | StopReason::MaxTurnRequests
    ) {
        return true;
    }
    max_turns_per_session > 0 && turn_count >= u64::from(max_turns_per_session)
}

/// Run one turn for a flushed batch on a checked-out worker.
///
/// On success: deliver the buffered reply + `Idle` status, apply rotation.
/// On failure: deliver the failure line; the dispatcher requeues/dead-letters
/// and respawns the slot when the worker comes back as `None`.
#[allow(clippy::too_many_lines)]
pub async fn run_turn(
    mut worker: Worker,
    batch: SlackFlushBatch,
    ctx: Arc<DispatchContext>,
) -> TurnOutcome {
    let slot = worker.slot;
    let scope = batch.scope.clone();
    let routing = batch
        .events
        .last()
        .expect("batches are non-empty")
        .reply_routing
        .clone();
    let prompt_text = batch
        .events
        .iter()
        .map(|event: &QueuedSlackEvent| event.prompt_text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    let session_id = match ensure_session(&mut worker, &scope, &ctx).await {
        Ok(session_id) => session_id,
        Err(kind) => {
            deliver_failure_line(&ctx, &routing).await;
            return TurnOutcome {
                slot,
                worker: None,
                disposition: TurnDisposition::Failed(kind),
                batch,
            };
        }
    };

    let cx = worker.cx.clone();
    let request = PromptRequest::new(
        session_id.clone(),
        vec![ContentBlock::Text(TextContent::new(prompt_text))],
    );
    let id_for_receive = session_id.clone();
    let mut prompt = tokio::spawn(async move { cx.send_request(request).block_task().await });

    // Drain interrupts signalled while the worker sat idle (or from a
    // previous turn's grace window): they must not cancel the fresh turn.
    while worker.interrupt_rx.try_recv().is_ok() {}

    let idle_timeout = Duration::from_secs(ctx.config.idle_timeout_secs.max(1));
    let idle = tokio::time::sleep(idle_timeout);
    tokio::pin!(idle);

    let mut buffered = String::new();
    let mut prompted_cancel = false;
    let mut interrupted = false;

    let disposition = loop {
        tokio::select! {
            result = &mut prompt => {
                break match result {
                    Ok(Ok(_response)) if interrupted => TurnDisposition::Interrupted,
                    Ok(Ok(_response)) if prompted_cancel => {
                        TurnDisposition::Failed(TurnFailureKind::IdleTimeout)
                    }
                    Ok(Ok(response)) => {
                        deliver_reply(&ctx, &routing, &buffered).await;
                        deliver_idle_status(&ctx, &routing).await;
                        TurnDisposition::Completed(response.stop_reason)
                    }
                    Ok(Err(error)) if interrupted => {
                        tracing::debug!("prompt errored after interrupt: {error}");
                        TurnDisposition::Interrupted
                    }
                    Ok(Err(error)) => {
                        tracing::warn!(scope = %scope.telemetry_label(), "session/prompt failed: {error}");
                        deliver_failure_line(&ctx, &routing).await;
                        deliver_idle_status(&ctx, &routing).await;
                        TurnDisposition::Failed(TurnFailureKind::PromptError)
                    }
                    Err(join) => {
                        tracing::warn!(scope = %scope.telemetry_label(), "prompt task ended: {join}");
                        deliver_failure_line(&ctx, &routing).await;
                        deliver_idle_status(&ctx, &routing).await;
                        TurnDisposition::Failed(TurnFailureKind::PromptError)
                    }
                };
            }
            notification = worker.notify_rx.recv() => {
                let Some(notification) = notification else {
                    deliver_failure_line(&ctx, &routing).await;
                    deliver_idle_status(&ctx, &routing).await;
                    prompt.abort();
                    break TurnDisposition::Failed(TurnFailureKind::ConnectionClosed);
                };
                // Wire activity resets the idle clock; once a cancel is
                // outstanding the grace window is absolute (buzz parity).
                let reset_for = if prompted_cancel || interrupted {
                    CANCEL_GRACE
                } else {
                    idle_timeout
                };
                idle.as_mut().reset(tokio::time::Instant::now() + reset_for);
                if notification.session_id != id_for_receive {
                    tracing::debug!(
                        scope = %scope.telemetry_label(),
                        "session/update for non-turn session ignored"
                    );
                    continue;
                }
                handle_session_update(&ctx, &routing, &notification.update, &mut buffered).await;
            }
            Some(()) = worker.interrupt_rx.recv(), if !interrupted && !prompted_cancel => {
                interrupted = true;
                tracing::info!(scope = %scope.telemetry_label(), "interrupting turn (merged re-prompt next)");
                send_cancel(&worker.cx, &session_id);
                idle.as_mut().reset(tokio::time::Instant::now() + CANCEL_GRACE);
            }
            () = &mut idle => {
                if prompted_cancel {
                    // Agent ignored the idle-timeout cancel: wedged, kill slot.
                    prompt.abort();
                    deliver_failure_line(&ctx, &routing).await;
                    deliver_idle_status(&ctx, &routing).await;
                    break TurnDisposition::Failed(TurnFailureKind::CancelGraceExpired);
                }
                if interrupted {
                    // Interrupt cancel grace expired: reuse the session anyway
                    // (the merged next turn re-prompts on it).
                    prompt.abort();
                    break TurnDisposition::Interrupted;
                }
                prompted_cancel = true;
                tracing::warn!(
                    scope = %scope.telemetry_label(),
                    idle_secs = idle_timeout.as_secs(),
                    "turn idle timeout; sending session/cancel"
                );
                send_cancel(&worker.cx, &session_id);
                idle.as_mut().reset(tokio::time::Instant::now() + CANCEL_GRACE);
            }
        }
    };

    // Rotation/invalidation bookkeeping (buzz rules; see `should_rotate_session`).
    match &disposition {
        TurnDisposition::Completed(stop_reason) => {
            let count = {
                let entry = worker.turn_counts.entry(scope.clone()).or_insert(0);
                *entry += 1;
                *entry
            };
            if should_rotate_session(*stop_reason, count, ctx.config.max_turns_per_session) {
                tracing::info!(
                    scope = %scope.telemetry_label(),
                    stop_reason = ?stop_reason,
                    turns = count,
                    "rotating ACP session for scope"
                );
                worker.sessions.remove(&scope);
                worker.turn_counts.remove(&scope);
            }
        }
        TurnDisposition::Failed(kind) => {
            worker.sessions.remove(&scope);
            worker.turn_counts.remove(&scope);
            match kind {
                TurnFailureKind::SessionNew
                | TurnFailureKind::IdleTimeout
                | TurnFailureKind::ConnectionClosed
                | TurnFailureKind::CancelGraceExpired => {
                    return TurnOutcome {
                        slot,
                        worker: None,
                        disposition,
                        batch,
                    };
                }
                TurnFailureKind::PromptError => {}
            }
        }
        TurnDisposition::Interrupted => {}
    }

    TurnOutcome {
        slot,
        worker: Some(worker),
        disposition,
        batch,
    }
}

/// Send `session/cancel` (fire-and-forget notification; the agent's response
/// arrives as the pending prompt's `Cancelled` stop reason).
fn send_cancel(cx: &ConnectionTo<Agent>, session_id: &SessionId) {
    if let Err(error) = cx.send_notification(CancelNotification::new(session_id.clone())) {
        tracing::warn!("failed to send session/cancel: {error}");
    }
}

/// Reuse the scope's session on this worker or create one (`session/new`).
async fn ensure_session(
    worker: &mut Worker,
    scope: &SlackSessionScope,
    ctx: &DispatchContext,
) -> Result<SessionId, TurnFailureKind> {
    if let Some(session_id) = worker.sessions.get(scope) {
        return Ok(session_id.clone());
    }
    let cx = worker.cx.clone();
    let request = NewSessionRequest::new(ctx.cwd.clone());
    let created = tokio::time::timeout(REQUEST_TIMEOUT, cx.send_request(request).block_task())
        .await
        .map_err(|_| TurnFailureKind::SessionNew)?
        .map_err(|error| {
            tracing::warn!(scope = %scope.telemetry_label(), "session/new failed: {error}");
            TurnFailureKind::SessionNew
        })?;
    tracing::info!(
        scope = %scope.telemetry_label(),
        session_id = %created.session_id,
        "slack-acp: ACP session created"
    );
    worker
        .sessions
        .insert(scope.clone(), created.session_id.clone());
    Ok(created.session_id)
}

/// Update the turn's reply buffer or post assistant status updates.
async fn handle_session_update(
    ctx: &DispatchContext,
    routing: &SlackReplyRouting,
    update: &SessionUpdate,
    buffered: &mut String,
) {
    match update {
        SessionUpdate::AgentMessageChunk(chunk) => {
            if let ContentBlock::Text(text) = &chunk.content {
                if !buffered.is_empty() && !buffered.ends_with('\n') {
                    buffered.push('\n');
                }
                buffered.push_str(&text.text);
            }
        }
        SessionUpdate::AgentThoughtChunk(_) => {
            // Thought chunks never render; still tickle the status line.
            deliver_status(ctx, routing, "Thinking").await;
        }
        other => {
            let value = serde_json::to_value(other).unwrap_or(Value::Null);
            deliver_status(ctx, routing, status_text_for_update(&value)).await;
        }
    }
}

/// Post an assistant-thread status line; gated on a reply thread ts (parity
/// with `SlackOutputTurn::plan_status`) and relay delivery facts.
async fn deliver_status(ctx: &DispatchContext, routing: &SlackReplyRouting, status: &str) {
    let Some(delivery) = ctx.delivery.as_ref() else {
        return;
    };
    let Some(thread_ts) = routing.reply_thread_ts.as_deref() else {
        return;
    };
    let operation = build_assistant_thread_status_operation(&routing.channel_id, thread_ts, status);
    let Some(request) = relay_request_for_operation(
        &delivery.relay_api_base_url,
        &delivery.hyper_agents_api_key,
        &operation,
    ) else {
        return;
    };
    if let Err(error) = delivery.sender.send(&request).await {
        tracing::warn!("slack status delivery failed: {error}");
    }
}

/// Terminal `Idle` status after a turn (parity with `complete_prompt_response`).
async fn deliver_idle_status(ctx: &DispatchContext, routing: &SlackReplyRouting) {
    deliver_status(ctx, routing, "Idle").await;
}

/// Reply delivery through relay-proxy planning (chunk/mrkdwn + bounded retry).
async fn deliver_reply(ctx: &DispatchContext, routing: &SlackReplyRouting, buffered: &str) {
    deliver_text(ctx, routing, buffered).await;
}

/// Failure line delivery when a turn produced no Slack-visible reply.
async fn deliver_failure_line(ctx: &DispatchContext, routing: &SlackReplyRouting) {
    deliver_text(ctx, routing, AGENT_FAILURE_LINE).await;
}

async fn deliver_text(ctx: &DispatchContext, routing: &SlackReplyRouting, text: &str) {
    if text.trim().is_empty() {
        return;
    }
    let Some(delivery) = ctx.delivery.as_ref() else {
        tracing::warn!(
            bytes = text.len(),
            "slack reply undeliverable: no relay delivery config (logged only)"
        );
        return;
    };
    let payload = SlackReplyPayload {
        text: Some(text.to_owned()),
        media_urls: Vec::new(),
        blocks: Vec::new(),
        is_reasoning: false,
        reply_to_id: None,
        delivery_queue_id: None,
    };
    let deliveries = plan_slack_reply_deliveries(
        &delivery.relay_api_base_url,
        &delivery.hyper_agents_api_key,
        &routing.channel_id,
        routing.reply_thread_ts.as_deref(),
        routing.reply_to_mode,
        std::slice::from_ref(&payload),
        SLACK_TEXT_LIMIT,
    );
    for delivery_plan in deliveries {
        let Some(request) = delivery_plan.request else {
            tracing::warn!("slack reply delivery missing relay request; skipped");
            continue;
        };
        if let Err(error) = delivery.sender.send(&request).await {
            tracing::warn!("slack reply delivery failed: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_triggers_on_stop_reasons() {
        assert!(should_rotate_session(StopReason::MaxTokens, 1, 0));
        assert!(should_rotate_session(StopReason::MaxTurnRequests, 1, 0));
        assert!(!should_rotate_session(StopReason::EndTurn, 1, 0));
        assert!(!should_rotate_session(StopReason::Cancelled, 1, 0));
    }

    #[test]
    fn rotation_triggers_on_turn_count_cap_only_when_enabled() {
        assert!(!should_rotate_session(StopReason::EndTurn, 5, 0));
        assert!(should_rotate_session(StopReason::EndTurn, 5, 5));
        assert!(should_rotate_session(StopReason::EndTurn, 6, 5));
        assert!(!should_rotate_session(StopReason::EndTurn, 4, 5));
    }

    #[test]
    fn circuit_breaker_trips_after_rapid_failures_and_cools_down() {
        let mut pool = AgentPool::new(1);
        pool.record_failure(0);
        pool.record_failure(0);
        assert!(matches!(pool.slots[0].state, SlotState::Dead));
        pool.record_failure(0);
        assert!(matches!(pool.slots[0].state, SlotState::CoolingOff(_)));
    }

    #[test]
    fn failure_ledger_prunes_stale_entries() {
        let mut pool = AgentPool::new(1);
        pool.slots[0].failures.push_back(
            Instant::now()
                .checked_sub(Duration::from_secs(120))
                .expect("clock sanity"),
        );
        pool.record_failure(0);
        assert_eq!(pool.slots[0].failures.len(), 1);
        assert!(matches!(pool.slots[0].state, SlotState::Dead));
    }

    #[test]
    fn pool_starts_dead_and_claim_returns_none() {
        let mut pool = AgentPool::new(2);
        assert_eq!(pool.idle_count(), 0);
        let scope = SlackSessionScope {
            team_id: "T1".to_owned(),
            channel_id: "C1".to_owned(),
            thread_ts: None,
            is_dm: false,
        };
        assert!(pool.claim(&scope).is_none());
    }
}
