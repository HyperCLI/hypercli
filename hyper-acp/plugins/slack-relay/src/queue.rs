//! Per-scope Slack event queue.
//!
//! Ports the buzz `EventQueue` state machine (`hyper-acp/plugins/buzz/src/
//! queue.rs`) to the Slack envelope: per-scope partitions, per-scope in-flight
//! enforcement with deadline expiry, FIFO-fair drain (`flush_next`),
//! exponential-backoff retry with dead-lettering, and push/requeue caps.
//!
//! Buzz structures deliberately NOT ported (phase 4+ concerns):
//! - cancelled-batch carryover / steer / interrupt / owner-interrupt
//!   (`MultipleEventHandling` exists here as a type-only stub)
//! - `IntoScope` Uuid back-compat trait (there is exactly one key type here)
//! - event-content helpers (`format_prompt`, thread tags, slash commands)
//!
//! # State machine
//!
//! ```text
//! State:
//!   queues:               Map<SlackSessionScope, VecDeque<QueuedSlackEvent>>
//!   in_flight_scopes:     Set<SlackSessionScope>
//!   in_flight_deadlines:  Map<SlackSessionScope, Instant>
//!   retry_after:          Map<SlackSessionScope, Instant>
//!   retry_counts:         Map<SlackSessionScope, u32>          (dead-letter after MAX_RETRIES)
//!
//!   push(event): DedupMode::Drop && in-flight → discard; per-scope cap → drop
//!                oldest; aggregate per-channel cap → drop globally-oldest.
//!   flush_next() → Option<SlackFlushBatch>: expire stuck in-flight entries,
//!                pick eligible scope with the oldest head event, drain up to
//!                MAX_BATCH_EVENTS, mark in flight with a fresh deadline.
//!   mark_complete(scope): clear in-flight + deadline + (unthrottled) retry count.
//!   requeue(batch): backoff 5s→300s with ±20% jitter; >MAX_RETRIES →
//!                dead-letter (batch returned to the caller for surfacing).
//! ```

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::config::DedupMode;
use crate::monitor::replies::SlackReplyToMode;
use crate::scope::SlackSessionScope;

/// Maximum events retained per session scope.
pub(crate) const MAX_PENDING_PER_SCOPE: usize = 500;

/// Aggregate cap on events queued across ALL scopes of one Slack channel, so
/// thread partitioning cannot multiply the admitted backlog (buzz parity).
pub(crate) const MAX_PENDING_PER_CHANNEL: usize = 500;

/// Maximum events drained into a single batch.
pub(crate) const MAX_BATCH_EVENTS: usize = 50;

/// Maximum retry attempts before a batch is dead-lettered.
pub(crate) const MAX_RETRIES: u32 = 10;

/// Base retry delay in seconds (doubled each attempt).
pub(crate) const BASE_RETRY_DELAY_SECS: u64 = 5;

/// Cap on retry delay in seconds.
pub(crate) const MAX_RETRY_DELAY_SECS: u64 = 300;

/// Buffer added to the turn budget to derive the in-flight deadline.
pub(crate) const IN_FLIGHT_DEADLINE_BUFFER_SECS: u64 = 100;

/// Default in-flight deadline: buzz's default turn budget (7200s) + buffer.
/// Phase 4 derives this from the real max-turn config via
/// [`SlackEventQueue::with_in_flight_deadline`].
pub(crate) const DEFAULT_IN_FLIGHT_DEADLINE_SECS: u64 = 7300;

/// Reply-routing facts carried by every queued event so phase 4's turn runner
/// can deliver replies/status without re-deriving them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlackReplyRouting {
    /// Slack channel id the reply posts to.
    pub channel_id: String,
    /// Slack team id when known.
    pub team_id: Option<String>,
    /// Delivered reply thread ts (`None` replies at channel level).
    pub reply_thread_ts: Option<String>,
    /// Effective reply mode for the channel type.
    pub reply_to_mode: SlackReplyToMode,
}

/// One admitted Slack event waiting in the queue.
#[derive(Debug, Clone)]
pub struct QueuedSlackEvent {
    /// Session scope resolved once at admission; queue partitions on this.
    pub scope: SlackSessionScope,
    /// Fully prepared prompt text (history bundle included).
    pub prompt_text: String,
    /// Reply routing facts for the eventual turn.
    pub reply_routing: SlackReplyRouting,
    /// Receipt instant (drives cross-scope FIFO fairness).
    pub received_at: Instant,
    /// Relay delivery id (trace correlation with the durable log).
    pub delivery_id: String,
    /// Logical dedupe key claimed at dispatch; the terminal `Commit` record is
    /// written under this key when the turn reaches a terminal state.
    pub dedupe_key: Option<String>,
    /// Slack metadata snapshot from dispatch time (carried to the `Commit`
    /// record; not interpreted by the queue).
    pub slack_meta: serde_json::Value,
}

impl QueuedSlackEvent {
    /// Durable terminal-commit record for this envelope, when it was claimed
    /// under a dedupe key at dispatch time. Written exactly once per terminal
    /// outcome (turn success or dead-letter) — never for transient releases
    /// (retry backoff, interrupt-merge, held-batch).
    #[must_use]
    pub fn to_terminal_commit_record(
        &self,
    ) -> Option<crate::monitor::ingress::DurableSlackRelayRecord> {
        let dedupe_key = self.dedupe_key.clone()?;
        Some(crate::monitor::ingress::DurableSlackRelayRecord {
            delivery_id: self.delivery_id.clone(),
            dedupe_key: Some(dedupe_key),
            action: crate::monitor::ingress::DurableSlackRelayAction::Commit,
            slack_meta: self.slack_meta.clone(),
            queued_event: None,
        })
    }

    /// Serialize for the durable log.
    ///
    /// `Instant` is not serializable: receipt is stored as epoch milliseconds
    /// (reconstructed as `now - received_at.elapsed()`), so the restored age —
    /// and therefore cross-scope FIFO fairness — survives process restarts.
    #[must_use]
    pub fn to_durable_record(&self) -> DurableQueuedSlackEvent {
        let epoch_ms =
            now_epoch_millis().saturating_sub(self.received_at.elapsed().as_millis() as u64);
        DurableQueuedSlackEvent {
            scope: self.scope.clone(),
            prompt_text: self.prompt_text.clone(),
            reply_routing: self.reply_routing.clone(),
            received_at_epoch_ms: epoch_ms,
            delivery_id: self.delivery_id.clone(),
            dedupe_key: self.dedupe_key.clone(),
            slack_meta: self.slack_meta.clone(),
        }
    }
}

/// Durable (serde-only) form of [`QueuedSlackEvent`] written to the JSONL log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DurableQueuedSlackEvent {
    /// Session scope.
    pub scope: SlackSessionScope,
    /// Prepared prompt text.
    pub prompt_text: String,
    /// Reply routing facts.
    pub reply_routing: SlackReplyRouting,
    /// Receipt instant as epoch milliseconds (see [`QueuedSlackEvent::to_durable_record`]).
    pub received_at_epoch_ms: u64,
    /// Relay delivery id.
    pub delivery_id: String,
    /// Logical dedupe key for the terminal `Commit` record.
    #[serde(default)]
    pub dedupe_key: Option<String>,
    /// Slack metadata snapshot from dispatch time.
    #[serde(default)]
    pub slack_meta: serde_json::Value,
}

impl DurableQueuedSlackEvent {
    /// Rebuild the in-memory envelope, restoring `received_at` from the stored
    /// epoch age so a replayed event keeps its fairness position.
    #[must_use]
    pub fn to_queued_event(&self) -> QueuedSlackEvent {
        let age_ms = now_epoch_millis().saturating_sub(self.received_at_epoch_ms);
        let received_at = Instant::now()
            .checked_sub(Duration::from_millis(age_ms))
            .unwrap_or_else(Instant::now);
        QueuedSlackEvent {
            scope: self.scope.clone(),
            prompt_text: self.prompt_text.clone(),
            reply_routing: self.reply_routing.clone(),
            received_at,
            delivery_id: self.delivery_id.clone(),
            dedupe_key: self.dedupe_key.clone(),
            slack_meta: self.slack_meta.clone(),
        }
    }
}

fn now_epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// A batch of queued events for one scope, flushed for one agent turn.
#[derive(Debug, Clone)]
pub struct SlackFlushBatch {
    /// The single session scope every event belongs to.
    pub scope: SlackSessionScope,
    /// Events in receipt order.
    pub events: Vec<QueuedSlackEvent>,
}

/// How [`SlackEventQueue::finish`] releases an in-flight batch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueueFinish {
    /// Turn succeeded: drop the batch, clear in-flight state.
    Complete,
    /// Turn failed transiently: requeue with backoff (dead-letter past
    /// [`MAX_RETRIES`], returned to the caller).
    Retry,
    /// No turn ran (held) or the turn was interrupted: requeue at the front
    /// preserving fairness timestamps, no retry penalty.
    Preserve,
}

/// How new events are handled while a turn is in flight for their scope.
///
/// Type-only stub for phase 3: the queue always queues. Real steer/interrupt
/// wiring (cancel-drain + merged re-prompt) lands in phase 4.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum MultipleEventHandling {
    /// Queue new events while a turn is in flight (delivered after completion).
    #[default]
    Queue,
    /// Cancel and re-prompt, framing new events as steering messages.
    Steer,
    /// Cancel and re-prompt, framing new events as superseding the old turn.
    Interrupt,
}

/// Per-scope Slack event queue with in-flight enforcement. See module docs for
/// the state machine.
pub struct SlackEventQueue {
    queues: HashMap<SlackSessionScope, VecDeque<QueuedSlackEvent>>,
    in_flight_scopes: HashSet<SlackSessionScope>,
    in_flight_deadlines: HashMap<SlackSessionScope, Instant>,
    /// Batch size per in-flight scope (for expiry logging).
    in_flight_batch_sizes: HashMap<SlackSessionScope, usize>,
    retry_after: HashMap<SlackSessionScope, Instant>,
    retry_counts: HashMap<SlackSessionScope, u32>,
    dedup_mode: DedupMode,
    in_flight_deadline: Duration,
}

impl std::fmt::Debug for SlackEventQueue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SlackEventQueue")
            .field("queued_scopes", &self.queues.len())
            .field("in_flight_scopes", &self.in_flight_scopes.len())
            .field("dedup_mode", &self.dedup_mode)
            .finish_non_exhaustive()
    }
}

impl SlackEventQueue {
    /// Create an empty queue with the given dedup mode.
    #[must_use]
    pub fn new(dedup_mode: DedupMode) -> Self {
        Self {
            queues: HashMap::new(),
            in_flight_scopes: HashSet::new(),
            in_flight_deadlines: HashMap::new(),
            in_flight_batch_sizes: HashMap::new(),
            retry_after: HashMap::new(),
            retry_counts: HashMap::new(),
            dedup_mode,
            in_flight_deadline: Duration::from_secs(DEFAULT_IN_FLIGHT_DEADLINE_SECS),
        }
    }

    /// Set the in-flight backstop from the turn budget, preserving the 100s
    /// buffer (buzz parity: expiry must fire after a capped turn returns via
    /// `mark_complete`, not mid-turn).
    #[must_use]
    pub fn with_in_flight_deadline(mut self, max_turn_secs: u64) -> Self {
        self.in_flight_deadline =
            Duration::from_secs(max_turn_secs + IN_FLIGHT_DEADLINE_BUFFER_SECS);
        self
    }

    /// Test-only: set the in-flight deadline directly.
    #[cfg(test)]
    fn with_in_flight_deadline_duration(mut self, deadline: Duration) -> Self {
        self.in_flight_deadline = deadline;
        self
    }

    /// Push an event into its scope partition.
    ///
    /// [`DedupMode::Drop`] discards events for in-flight scopes (debug-logged).
    /// Per-scope depth is capped at [`MAX_PENDING_PER_SCOPE`] (oldest evicted);
    /// the aggregate per-channel cap [`MAX_PENDING_PER_CHANNEL`] then evicts
    /// the globally-oldest event across the channel's scopes.
    ///
    /// Returns `true` when the event was accepted.
    pub fn push(&mut self, event: QueuedSlackEvent) -> bool {
        if matches!(self.dedup_mode, DedupMode::Drop)
            && self.in_flight_scopes.contains(&event.scope)
        {
            tracing::debug!(
                scope = %event.scope.telemetry_label(),
                "dropping event for in-flight scope (drop mode)"
            );
            return false;
        }
        let scope = event.scope.clone();
        let channel_id = scope.channel_id.clone();
        let queue = self.queues.entry(scope.clone()).or_default();
        if queue.len() >= MAX_PENDING_PER_SCOPE {
            queue.pop_front();
            tracing::warn!(
                scope = %scope.telemetry_label(),
                limit = MAX_PENDING_PER_SCOPE,
                "per-scope queue depth cap reached — dropped oldest event"
            );
        }
        queue.push_back(event);
        self.enforce_channel_cap(&channel_id);
        true
    }

    /// Total queued events across every scope of one channel.
    fn channel_event_total(&self, channel_id: &str) -> usize {
        self.queues
            .iter()
            .filter(|(scope, _)| scope.channel_id == channel_id)
            .map(|(_, queue)| queue.len())
            .sum()
    }

    /// Evict the globally-oldest queued events across a channel's scopes until
    /// aggregate depth is within [`MAX_PENDING_PER_CHANNEL`].
    fn enforce_channel_cap(&mut self, channel_id: &str) {
        while self.channel_event_total(channel_id) > MAX_PENDING_PER_CHANNEL {
            let victim = self
                .queues
                .iter()
                .filter(|(scope, queue)| scope.channel_id == channel_id && !queue.is_empty())
                .min_by_key(|(_, queue)| queue.front().expect("nonempty").received_at)
                .map(|(scope, _)| scope.clone());
            let Some(scope) = victim else { break };
            if let Some(queue) = self.queues.get_mut(&scope) {
                queue.pop_front();
                if queue.is_empty() {
                    self.queues.remove(&scope);
                }
            }
            tracing::warn!(
                limit = MAX_PENDING_PER_CHANNEL,
                "aggregate per-channel queue cap reached — dropped oldest event"
            );
        }
    }

    /// Mark a scope in flight with a fresh deadline. Returns `false` when the
    /// scope is already in flight (double-flush guard).
    pub fn mark_in_flight(&mut self, scope: &SlackSessionScope, event_count: usize) -> bool {
        if !self.in_flight_scopes.insert(scope.clone()) {
            return false;
        }
        self.in_flight_deadlines
            .insert(scope.clone(), Instant::now() + self.in_flight_deadline);
        self.in_flight_batch_sizes
            .insert(scope.clone(), event_count);
        true
    }

    /// Expire in-flight entries whose deadline passed without `mark_complete`.
    fn expire_stuck_in_flight(&mut self) {
        let now = Instant::now();
        let expired: Vec<SlackSessionScope> = self
            .in_flight_deadlines
            .iter()
            .filter(|(_, deadline)| now >= **deadline)
            .map(|(scope, _)| scope.clone())
            .collect();
        for scope in expired {
            let lost_events = self.in_flight_batch_sizes.remove(&scope).unwrap_or(0);
            tracing::error!(
                scope = %scope.telemetry_label(),
                lost_events,
                deadline_secs = self.in_flight_deadline.as_secs(),
                "BUG: in-flight scope expired without mark_complete — \
                 auto-releasing; dispatched events orphaned"
            );
            self.in_flight_scopes.remove(&scope);
            self.in_flight_deadlines.remove(&scope);
        }
    }

    /// Flush the next batch: expire stuck in-flight scopes, pick the eligible
    /// (non-empty, not in flight, not retry-throttled) scope with the oldest
    /// head event — FIFO fairness across scopes — drain up to
    /// [`MAX_BATCH_EVENTS`], and mark the scope in flight.
    ///
    /// Returns `None` when no scope is eligible. The caller MUST eventually
    /// `mark_complete` (or `requeue`) the returned batch's scope.
    pub fn flush_next(&mut self) -> Option<SlackFlushBatch> {
        self.expire_stuck_in_flight();
        let now = Instant::now();

        let scope = self
            .queues
            .iter()
            .filter(|(scope, queue)| {
                !queue.is_empty()
                    && !self.in_flight_scopes.contains(*scope)
                    && self.retry_after.get(*scope).is_none_or(|&t| t <= now)
            })
            .min_by_key(|(_, queue)| queue.front().expect("nonempty").received_at)
            .map(|(scope, _)| scope.clone())?;

        let queue = self.queues.entry(scope.clone()).or_default();
        let drain_count = MAX_BATCH_EVENTS.min(queue.len());
        let events: Vec<QueuedSlackEvent> = queue.drain(..drain_count).collect();
        if self.queues.get(&scope).is_some_and(VecDeque::is_empty) {
            self.queues.remove(&scope);
        }
        self.mark_in_flight(&scope, events.len());
        Some(SlackFlushBatch { scope, events })
    }

    /// Mark the turn for `scope` complete: clear in-flight state. When the
    /// scope is not retry-throttled, its retry counter resets (healthy scope);
    /// a throttled scope keeps its counter so backoff continues.
    pub fn mark_complete(&mut self, scope: &SlackSessionScope) {
        self.in_flight_scopes.remove(scope);
        self.in_flight_deadlines.remove(scope);
        self.in_flight_batch_sizes.remove(scope);
        let now = Instant::now();
        match self.retry_after.get(scope) {
            // Active throttle → scope was requeued; keep retry count.
            Some(&deadline) if deadline > now => {}
            // Expired or absent throttle → successful completion; reset.
            Some(_) => {
                self.retry_after.remove(scope);
                self.retry_counts.remove(scope);
            }
            None => {
                self.retry_counts.remove(scope);
            }
        }
    }

    /// Terminal-state release of an in-flight batch: the chosen release mode
    /// runs, then in-flight state is dropped (structurally fused so no path
    /// can requeue without releasing).
    ///
    /// Returns the batch when [`QueueFinish::Retry`] dead-lettered it (the
    /// caller then writes the terminal durable `Commit` for those events).
    pub fn finish(&mut self, batch: SlackFlushBatch, mode: QueueFinish) -> Option<SlackFlushBatch> {
        let scope = batch.scope.clone();
        let dead = match mode {
            QueueFinish::Complete => None,
            QueueFinish::Retry => self.requeue(batch),
            QueueFinish::Preserve => {
                self.requeue_preserve_timestamps(batch);
                None
            }
        };
        self.mark_complete(&scope);
        dead
    }

    /// Re-queue a failed batch at the FRONT of its scope partition, preserving
    /// original `received_at` (fairness position); the retry delay comes from
    /// exponential backoff (5s→300s, ±20% jitter), not timestamp resets.
    ///
    /// After [`MAX_RETRIES`] attempts the batch is dead-lettered: ERROR-logged
    /// and RETURNED to the caller (so a failure notice can be posted to the
    /// channel); otherwise returns `None`.
    ///
    /// Does NOT clear in-flight state — the caller must `mark_complete` too.
    pub fn requeue(&mut self, batch: SlackFlushBatch) -> Option<SlackFlushBatch> {
        let scope = batch.scope.clone();
        let attempt = {
            let count = self.retry_counts.entry(scope.clone()).or_insert(0);
            *count += 1;
            *count
        };

        if attempt > MAX_RETRIES {
            tracing::error!(
                scope = %scope.telemetry_label(),
                attempt,
                events = batch.events.len(),
                "dead-lettering batch after {MAX_RETRIES} retries"
            );
            self.retry_counts.remove(&scope);
            // Clear stale backoff so fresh traffic on this scope is not
            // throttled by the discarded poison batch.
            self.retry_after.remove(&scope);
            return Some(batch);
        }

        let base_secs = BASE_RETRY_DELAY_SECS.saturating_mul(1u64 << (attempt - 1).min(6));
        let capped_secs = base_secs.min(MAX_RETRY_DELAY_SECS);
        let jitter = {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos();
            0.8 + (f64::from(nanos) / f64::from(u32::MAX)) * 0.4
        };
        let delay = Duration::from_secs_f64(capped_secs as f64 * jitter);

        tracing::warn!(
            scope = %scope.telemetry_label(),
            attempt,
            max = MAX_RETRIES,
            delay_secs = delay.as_secs_f64(),
            events = batch.events.len(),
            "requeueing failed batch with backoff"
        );

        let queue = self.queues.entry(scope.clone()).or_default();
        for event in batch.events.into_iter().rev() {
            queue.push_front(event);
        }
        while queue.len() > MAX_PENDING_PER_SCOPE {
            queue.pop_back();
            tracing::warn!(
                scope = %scope.telemetry_label(),
                limit = MAX_PENDING_PER_SCOPE,
                "requeue overflow — dropped newest event to enforce cap"
            );
        }
        let channel_id = scope.channel_id.clone();
        self.retry_after.insert(scope, Instant::now() + delay);
        self.enforce_channel_cap(&channel_id);
        None
    }

    /// Re-queue a flushed batch without penalty: original `received_at`
    /// preserved and NO retry throttle. Used when a batch could not run at all
    /// (no agent available / scope worker busy) — buzz `requeue_preserve_timestamps`.
    ///
    /// Does NOT clear in-flight state — the caller must `mark_complete` too.
    pub fn requeue_preserve_timestamps(&mut self, batch: SlackFlushBatch) {
        let scope = batch.scope.clone();
        let queue = self.queues.entry(scope.clone()).or_default();
        for event in batch.events.into_iter().rev() {
            queue.push_front(event);
        }
        while queue.len() > MAX_PENDING_PER_SCOPE {
            queue.pop_back();
            tracing::warn!(
                scope = %scope.telemetry_label(),
                limit = MAX_PENDING_PER_SCOPE,
                "requeue_preserve overflow — dropped newest event to enforce cap"
            );
        }
        let channel_id = scope.channel_id.clone();
        self.enforce_channel_cap(&channel_id);
    }

    /// Whether any scope has pending events that are not in flight and not
    /// retry-throttled. Expires stuck in-flight entries as a side effect.
    pub fn has_flushable_work(&mut self) -> bool {
        self.expire_stuck_in_flight();
        let now = Instant::now();
        self.queues.iter().any(|(scope, queue)| {
            !queue.is_empty()
                && !self.in_flight_scopes.contains(scope)
                && self.retry_after.get(scope).is_none_or(|&t| t <= now)
        })
    }

    /// Whether any scope currently has an in-flight batch.
    #[must_use]
    pub fn has_in_flight(&self) -> bool {
        !self.in_flight_scopes.is_empty()
    }

    /// Whether this scope currently has an in-flight batch.
    #[must_use]
    pub fn is_scope_in_flight(&self, scope: &SlackSessionScope) -> bool {
        self.in_flight_scopes.contains(scope)
    }

    /// Number of pending (not flushed) events for a scope.
    #[must_use]
    pub fn queued_event_count(&self, scope: &SlackSessionScope) -> usize {
        self.queues.get(scope).map_or(0, VecDeque::len)
    }

    /// Number of scopes with pending (not flushed) events.
    #[must_use]
    pub fn pending_scope_count(&self) -> usize {
        self.queues
            .values()
            .filter(|queue| !queue.is_empty())
            .count()
    }

    /// Test-only: seed the retry counter for a scope.
    #[cfg(test)]
    fn set_retry_count_for_test(&mut self, scope: &SlackSessionScope, count: u32) {
        self.retry_counts.insert(scope.clone(), count);
    }
}

/// Shared queue handle threaded through the relay loop and the flush consumer.
pub type SharedSlackEventQueue = std::sync::Arc<tokio::sync::Mutex<SlackEventQueue>>;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::monitor::ingress::{
        recover_durable_relay_log, DurableSlackRelayStore, SharedSlackRelayStore,
    };
    use crate::scope::SessionPolicy;

    fn scope(channel: &str, thread_ts: Option<&str>) -> SlackSessionScope {
        SlackSessionScope {
            team_id: "T1".to_owned(),
            channel_id: channel.to_owned(),
            thread_ts: thread_ts.map(str::to_owned),
            is_dm: false,
        }
    }

    fn envelope(scope: SlackSessionScope, prompt: &str, delivery_id: &str) -> QueuedSlackEvent {
        QueuedSlackEvent {
            reply_routing: SlackReplyRouting {
                channel_id: scope.channel_id.clone(),
                team_id: Some(scope.team_id.clone()),
                reply_thread_ts: scope.thread_ts.clone(),
                reply_to_mode: SlackReplyToMode::All,
            },
            scope,
            prompt_text: prompt.to_owned(),
            received_at: Instant::now(),
            delivery_id: delivery_id.to_owned(),
            dedupe_key: Some(format!("test-key-{delivery_id}")),
            slack_meta: serde_json::json!({"origin": "test"}),
        }
    }

    #[test]
    fn per_scope_serialization_blocks_second_flush_while_in_flight() {
        let mut queue = SlackEventQueue::new(DedupMode::Queue);
        let a = scope("C1", Some("100.100"));
        queue.push(envelope(a.clone(), "a1", "d1"));
        queue.push(envelope(a.clone(), "a2", "d2"));

        let batch = queue.flush_next().expect("first flush");
        assert_eq!(batch.scope, a);
        assert_eq!(batch.events.len(), 2);
        assert_eq!(batch.events[0].prompt_text, "a1");
        assert!(
            queue.flush_next().is_none(),
            "in-flight scope must not re-flush"
        );

        queue.mark_complete(&a);
        assert!(queue.flush_next().is_none(), "scope partition drained");
    }

    #[test]
    fn in_flight_scope_does_not_starve_other_scopes() {
        let mut queue = SlackEventQueue::new(DedupMode::Queue);
        let a = scope("C1", Some("100.100"));
        let b = scope("C1", Some("100.200"));
        queue.push(envelope(a.clone(), "a1", "d1"));
        queue.push(envelope(b.clone(), "b1", "d2"));

        let first = queue.flush_next().expect("first flush");
        assert_eq!(first.scope, a);
        let second = queue.flush_next().expect("other scope still flushable");
        assert_eq!(second.scope, b);
    }

    #[test]
    fn flush_is_fifo_fair_across_scopes() {
        let mut queue = SlackEventQueue::new(DedupMode::Queue);
        let a = scope("C1", Some("100.100"));
        let b = scope("C2", Some("100.200"));
        let mut late = envelope(b.clone(), "b-newer", "d2");
        // Force deterministic receipt order: a first, then b.
        let first = envelope(a.clone(), "a-older", "d1");
        late.received_at = first.received_at + Duration::from_millis(1);
        queue.push(late);
        queue.push(first);

        let flushed = queue.flush_next().expect("flush");
        assert_eq!(flushed.scope, a, "oldest head event wins across scopes");
    }

    fn durable_temp_path(name: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "slack-queue-{name}-{}-{nanos}.jsonl",
            std::process::id()
        ))
    }

    #[test]
    fn finish_modes_release_in_flight_state() {
        for mode in [
            QueueFinish::Complete,
            QueueFinish::Retry,
            QueueFinish::Preserve,
        ] {
            let mut queue = SlackEventQueue::new(DedupMode::Queue);
            let a = scope("C1", Some("100.100"));
            queue.push(envelope(a.clone(), "a1", "d1"));
            let batch = queue.flush_next().expect("flush");
            assert!(queue.is_scope_in_flight(&a));
            let _dead = queue.finish(batch, mode);
            assert!(
                !queue.is_scope_in_flight(&a),
                "finish({mode:?}) must release in-flight state"
            );
        }
    }

    #[test]
    fn dead_lettered_batch_commits_and_stops_replaying() {
        let path = durable_temp_path("dead-letter");
        let mut queue = SlackEventQueue::new(DedupMode::Queue);
        let a = scope("C1", Some("100.100"));

        // Simulate dispatch: claimed envelope with a dedupe key writes its
        // Dispatch record (enqueue side), then the turn runs.
        let event = envelope(a.clone(), "poison", "d-poison");
        let mut store = SharedSlackRelayStore::open(&path).expect("store opens");
        let envelope_value = serde_json::to_value(event.to_durable_record()).unwrap();
        store
            .accept(&crate::monitor::ingress::DurableSlackRelayRecord {
                delivery_id: event.delivery_id.clone(),
                dedupe_key: event.dedupe_key.clone(),
                action: crate::monitor::ingress::DurableSlackRelayAction::Dispatch,
                slack_meta: event.slack_meta.clone(),
                queued_event: Some(envelope_value),
            })
            .unwrap();
        queue.push(event);

        // Turn fails until the retry budget is exhausted: dead-letter.
        let batch = queue.flush_next().expect("flush");
        queue.set_retry_count_for_test(&a, MAX_RETRIES);
        let dead = queue
            .finish(batch, QueueFinish::Retry)
            .expect("retry budget exhausted → dead-letter");
        assert_eq!(dead.events.len(), 1);

        // Pool-side behavior on dead-letter: terminal commit per event.
        for event in &dead.events {
            store
                .accept(&event.to_terminal_commit_record().expect("has dedupe key"))
                .unwrap();
        }

        let recovery = recover_durable_relay_log(&path).expect("recover");
        assert!(
            recovery.replay_records.is_empty(),
            "dead-letter poisons are committed — no infinite cross-restart retry"
        );
        assert!(!recovery.committed_dedupe_keys.is_empty());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn transient_retry_stays_uncommitted_and_replays_after_crash() {
        let path = durable_temp_path("transient-retry");
        let mut queue = SlackEventQueue::new(DedupMode::Queue);
        let a = scope("C1", Some("100.100"));
        let event = envelope(a.clone(), "flaky", "d-flaky");
        let mut store = SharedSlackRelayStore::open(&path).expect("store opens");
        store
            .accept(&crate::monitor::ingress::DurableSlackRelayRecord {
                delivery_id: event.delivery_id.clone(),
                dedupe_key: event.dedupe_key.clone(),
                action: crate::monitor::ingress::DurableSlackRelayAction::Dispatch,
                slack_meta: event.slack_meta.clone(),
                queued_event: Some(serde_json::to_value(event.to_durable_record()).unwrap()),
            })
            .unwrap();
        queue.push(event);

        let batch = queue.flush_next().expect("flush");
        let dead = queue.finish(batch, QueueFinish::Retry);
        assert!(
            dead.is_none(),
            "first failure is transient, not dead-letter"
        );

        // Crash during the backoff window: the envelope replays next boot.
        let recovery = recover_durable_relay_log(&path).expect("recover");
        assert_eq!(recovery.replay_records.len(), 1);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn dedup_drop_mode_discards_during_in_flight() {
        let mut queue = SlackEventQueue::new(DedupMode::Drop);
        let a = scope("C1", Some("100.100"));
        assert!(queue.push(envelope(a.clone(), "a1", "d1")));
        let _batch = queue.flush_next().expect("flush");
        assert!(
            !queue.push(envelope(a.clone(), "a2", "d2")),
            "in-flight drop"
        );
        queue.mark_complete(&a);
        assert!(!queue.has_flushable_work());
    }

    #[test]
    fn flush_next_batches_up_to_max_batch_events() {
        let mut queue = SlackEventQueue::new(DedupMode::Queue);
        let a = scope("C1", Some("100.100"));
        for i in 0..(MAX_BATCH_EVENTS + 7) {
            let mut event = envelope(a.clone(), "p", "d");
            event.prompt_text = format!("p{i}");
            queue.push(event);
        }
        let batch = queue.flush_next().expect("flush");
        assert_eq!(batch.events.len(), MAX_BATCH_EVENTS);
        queue.mark_complete(&a);
        let rest = queue.flush_next().expect("remainder flush");
        assert_eq!(rest.events.len(), 7);
    }

    #[test]
    fn requeue_applies_backoff_then_dead_letters_after_max_retries() {
        let mut queue = SlackEventQueue::new(DedupMode::Queue);
        let a = scope("C1", Some("100.100"));
        queue.push(envelope(a.clone(), "a1", "d1"));
        let batch = queue.flush_next().expect("flush");
        queue.mark_complete(&a);

        queue.set_retry_count_for_test(&a, MAX_RETRIES);
        let dead_lettered = queue
            .requeue(batch)
            .expect("attempt past MAX_RETRIES dead-letters");
        assert_eq!(dead_lettered.events.len(), 1);
        assert_eq!(
            queue.queued_event_count(&a),
            0,
            "dead-lettered, not requeued"
        );
    }

    #[test]
    fn requeued_batch_waits_for_backoff_then_refreshes() {
        let mut queue = SlackEventQueue::new(DedupMode::Queue);
        let a = scope("C1", Some("100.100"));
        queue.push(envelope(a.clone(), "a1", "d1"));
        let batch = queue.flush_next().expect("flush");
        queue.mark_complete(&a);
        assert!(queue.requeue(batch).is_none(), "first failure requeues");

        assert!(
            queue.flush_next().is_none(),
            "retry backoff throttles flush"
        );
        // Force expiry of the throttle and confirm the events return, still in
        // original order and only once.
        queue.retry_after.insert(
            a.clone(),
            Instant::now()
                .checked_sub(Duration::from_millis(1))
                .expect("clock sanity"),
        );
        let retry = queue.flush_next().expect("throttle expired");
        assert_eq!(retry.events.len(), 1);
        assert_eq!(retry.events[0].prompt_text, "a1");
    }

    #[test]
    fn expired_in_flight_scope_auto_recovers_for_flush() {
        let mut queue =
            SlackEventQueue::new(DedupMode::Queue).with_in_flight_deadline_duration(Duration::ZERO);
        let a = scope("C1", Some("100.100"));
        queue.push(envelope(a.clone(), "a1", "d1"));
        let batch = queue.flush_next().expect("flush");
        drop(batch);
        assert!(queue.is_scope_in_flight(&a));

        // Deadline is zero; the next queue interaction must expire it.
        queue.push(envelope(a.clone(), "a2", "d2"));
        assert!(
            queue.has_flushable_work(),
            "expired in-flight must not block"
        );
        let recovered = queue.flush_next().expect("flush after expiry");
        assert_eq!(recovered.scope, a);
    }

    #[test]
    fn envelope_durable_round_trip_preserves_fairness_position() {
        let original = envelope(scope("C1", Some("100.100")), "hello agent", "d9");
        let durable = original.to_durable_record();
        let value = serde_json::to_value(&durable).expect("serialize");
        let restored: DurableQueuedSlackEvent = serde_json::from_value(value).expect("parse");
        assert_eq!(restored, durable);

        let rebuilt = restored.to_queued_event();
        assert_eq!(rebuilt.scope, original.scope);
        assert_eq!(rebuilt.prompt_text, original.prompt_text);
        assert_eq!(rebuilt.reply_routing, original.reply_routing);
        assert_eq!(rebuilt.delivery_id, original.delivery_id);
        assert!(
            rebuilt.received_at <= original.received_at + Duration::from_secs(5),
            "restored receipt should approximate the original age"
        );
    }

    #[test]
    fn scope_partitioning_matches_session_policy_shapes() {
        // Guard the queue/scope contract phase 4 relies on: distinct thread
        // scopes of one channel partition independently.
        let t1 = scope("C1", Some("100.100"));
        let t2 = scope("C1", Some("100.200"));
        assert_ne!(t1, t2);
        let channel_scoped = scope("C1", None);
        let _ = SessionPolicy::Thread;
        assert_ne!(t1, channel_scoped);
    }
}
