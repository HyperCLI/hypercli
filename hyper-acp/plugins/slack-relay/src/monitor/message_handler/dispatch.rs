//! OpenClaw `monitor/message-handler/dispatch.ts` equivalent.
//!
//! Owns the active Slack relay frame pipeline: parse, hello/event routing,
//! dedupe claim, durable accept, DM auth, admission, prompt frame dispatch,
//! commit/release/drop, and durable replay.

use std::sync::Arc;
use std::time::Instant;

use agent_client_protocol_schema::v1::{
    ContentBlock, JsonRpcMessage, PromptRequest, Request, RequestId, TextContent,
};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::admission::{
    decide_slack_admission, DmPolicy, SlackAdmissionDecision, SlackAdmissionPolicy,
};
use crate::content::{slack_message_for_content_from_value, SlackMessageForContent};
use crate::dm::SlackDirectMessageAuthorization;
use crate::monitor::channel_config::{channel_allowed, channel_disabled};
use crate::monitor::dm_auth::{
    authorize_active_direct_message_with_state, maybe_send_pairing_challenge,
    MemorySlackPairingStore,
};
use crate::monitor::events::messages::{SlackAcceptedEvent, SlackAcceptedEventTransport};
use crate::monitor::ingress::{
    ActiveSlackRelayLifecycle, DurableSlackRelayAction, DurableSlackRelayRecord,
    DurableSlackRelayStore,
};
use crate::monitor::message_dispatch_dedupe::{
    build_slack_message_dispatch_replay_key, SlackDispatchDedupeDecision, SlackDispatchDedupeState,
};
use crate::monitor::message_handler::dispatch_helpers::resolve_active_bot_loop_meta;
use crate::monitor::message_handler::prepare::{
    build_active_prompt_text, build_slack_admission_inputs, has_authorized_control_command,
    SlackAdmissionFacts,
};
use crate::monitor::message_handler::prepare_routing::{
    build_slack_acp_session_key, effective_reply_to_mode, reply_mode_wire,
};
use crate::monitor::provider::{
    ActiveSlackRelayConfig, ActiveSlackRelayError, ActiveSlackRelayPolicy,
};
use crate::queue::{
    DurableQueuedSlackEvent, QueuedSlackEvent, SharedSlackEventQueue, SlackReplyRouting,
};
use crate::relay_source::{
    build_relay_ack, extract_relay_hello, extract_relay_slack_message_event, parse_relay_frame,
    SlackRelayAckFrame,
};
use crate::scope::{slack_session_scope, SessionPolicy};

/// Where an admitted Slack event is dispatched after the shared
/// parse/dedupe/durable-accept/DM-auth/admission pipeline.
#[derive(Debug, Clone, Copy)]
pub enum SlackDispatchTarget<'a> {
    /// Legacy frame splice (hyper-acp host binary): build a canonical ACP
    /// `session/prompt` frame and send it into the shared child stdin pipe.
    AcpClientFrames {
        /// Serialized client frames sink (host transport merges it).
        client_frames: &'a mpsc::Sender<String>,
    },
    /// Standalone plugin: enqueue a durable per-scope envelope for the
    /// plugin-owned ACP client pool.
    Queue {
        /// Shared per-scope event queue.
        queue: &'a SharedSlackEventQueue,
        /// Session scoping policy for scope derivation.
        session_policy: SessionPolicy,
    },
}

/// Result of processing a single relay frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActiveSlackRelayFrameOutcome {
    /// Hello frame.
    Hello,
    /// Non-Slack-message frame ignored.
    Ignored,
    /// Slack event accepted and dispatched to ACP.
    Dispatched {
        /// Relay ack.
        ack: SlackRelayAckFrame,
        /// Logical dispatch key.
        dedupe_key: Option<String>,
    },
    /// Slack event accepted durably but skipped by a gate.
    Dropped {
        /// Relay ack.
        ack: SlackRelayAckFrame,
        /// Drop reason.
        reason: &'static str,
        /// Logical dispatch key.
        dedupe_key: Option<String>,
    },
    /// Slack event accepted durably but skipped as a duplicate logical message.
    Duplicate {
        /// Relay ack.
        ack: SlackRelayAckFrame,
        /// Logical dispatch key.
        dedupe_key: String,
    },
    /// Slack event matches an in-flight logical message and is acked because
    /// the HyperClaw relay does not redeliver ack-withheld frames.
    DuplicatePending {
        /// Relay ack.
        ack: SlackRelayAckFrame,
        /// Logical dispatch key.
        dedupe_key: String,
    },
}

/// Builds the canonical ACP `session/prompt` frame for a Slack relay event.
///
/// # Errors
///
/// Returns serialization errors from the canonical schema wrapper.
pub fn build_slack_session_prompt_frame(
    request_id: i64,
    session_id: &str,
    text: &str,
    slack_meta: Value,
) -> Result<String, ActiveSlackRelayError> {
    let mut meta = serde_json::Map::new();
    meta.insert("hypercli.slack".to_owned(), slack_meta);
    let request = PromptRequest::new(
        session_id.to_owned(),
        vec![ContentBlock::Text(
            TextContent::new(text.to_owned()).meta(meta.clone()),
        )],
    )
    .meta(meta);
    let frame = JsonRpcMessage::wrap(Request {
        id: RequestId::Number(request_id),
        method: Arc::from("session/prompt"),
        params: Some(request),
    });
    serde_json::to_string(&frame).map_err(ActiveSlackRelayError::Serialize)
}

/// Handles one relay frame through admission, dedupe, durable accept, and ACP dispatch.
///
/// # Errors
///
/// Returns parse, serialization, durable accept, or client-frame send errors.
pub async fn handle_active_slack_relay_frame(
    data: impl AsRef<[u8]>,
    config: &ActiveSlackRelayConfig,
    state: &mut ActiveSlackRelayState,
    store: &mut impl DurableSlackRelayStore,
    client_frames: &mpsc::Sender<String>,
) -> Result<ActiveSlackRelayFrameOutcome, ActiveSlackRelayError> {
    handle_active_slack_relay_frame_with_target(
        data,
        config,
        state,
        store,
        SlackDispatchTarget::AcpClientFrames { client_frames },
    )
    .await
}

/// Handles one relay frame against an explicit dispatch target.
///
/// # Errors
///
/// Returns parse, admission, durable accept, or dispatch-target errors.
pub(crate) async fn handle_active_slack_relay_frame_with_target(
    data: impl AsRef<[u8]>,
    config: &ActiveSlackRelayConfig,
    state: &mut ActiveSlackRelayState,
    store: &mut impl DurableSlackRelayStore,
    target: SlackDispatchTarget<'_>,
) -> Result<ActiveSlackRelayFrameOutcome, ActiveSlackRelayError> {
    let frame = parse_relay_frame(data)?;
    if extract_relay_hello(&frame).is_some() {
        return Ok(ActiveSlackRelayFrameOutcome::Hello);
    }
    let Some(event) = extract_relay_slack_message_event(&frame) else {
        return Ok(ActiveSlackRelayFrameOutcome::Ignored);
    };
    handle_accepted_slack_event_with_target(
        event.into(),
        &SlackProviderDispatchConfig::from(config),
        state,
        store,
        target,
    )
    .await
}

/// Transport-neutral dispatch config used after provider/source normalization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackProviderDispatchConfig {
    /// Existing ACP session id that receives Slack prompts.
    pub session_id: String,
    /// Active admission and content policy.
    pub policy: ActiveSlackRelayPolicy,
}

impl From<&ActiveSlackRelayConfig> for SlackProviderDispatchConfig {
    fn from(config: &ActiveSlackRelayConfig) -> Self {
        Self {
            session_id: config.session_id.clone(),
            policy: config.policy.clone(),
        }
    }
}

/// Handles one accepted Slack event from relay or direct Events API transport.
///
/// # Errors
///
/// Returns serialization, durable accept, or client-frame send errors.
pub async fn handle_accepted_slack_event(
    event: SlackAcceptedEvent,
    config: &SlackProviderDispatchConfig,
    state: &mut ActiveSlackRelayState,
    store: &mut impl DurableSlackRelayStore,
    client_frames: &mpsc::Sender<String>,
) -> Result<ActiveSlackRelayFrameOutcome, ActiveSlackRelayError> {
    handle_accepted_slack_event_with_target(
        event,
        config,
        state,
        store,
        SlackDispatchTarget::AcpClientFrames { client_frames },
    )
    .await
}

/// Handles one accepted Slack event against an explicit dispatch target.
///
/// # Errors
///
/// Returns serialization, durable accept, or dispatch-target errors.
#[allow(clippy::too_many_lines)]
pub(crate) async fn handle_accepted_slack_event_with_target(
    event: SlackAcceptedEvent,
    config: &SlackProviderDispatchConfig,
    state: &mut ActiveSlackRelayState,
    store: &mut impl DurableSlackRelayStore,
    target: SlackDispatchTarget<'_>,
) -> Result<ActiveSlackRelayFrameOutcome, ActiveSlackRelayError> {
    let ack = build_relay_ack(&event.delivery_id);
    let message = slack_message_for_content_from_value(&event.message);
    let dedupe_key = build_active_dedupe_key(&config.policy.account_id, &event, message.as_ref());
    if let Some(key) = dedupe_key.as_deref() {
        match state.dedupe.check_and_reserve(key, Instant::now()) {
            SlackDispatchDedupeDecision::FirstSeen => {
                store.accept(&DurableSlackRelayRecord {
                    delivery_id: event.delivery_id.clone(),
                    dedupe_key: dedupe_key.clone(),
                    action: DurableSlackRelayAction::Claim,
                    slack_meta: build_slack_meta(&event, dedupe_key.as_deref(), None, None),
                    queued_event: None,
                })?;
            }
            SlackDispatchDedupeDecision::DuplicateAccepted => {
                let slack_meta = build_slack_meta(&event, dedupe_key.as_deref(), None, None);
                let record = DurableSlackRelayRecord {
                    delivery_id: event.delivery_id,
                    dedupe_key: dedupe_key.clone(),
                    action: DurableSlackRelayAction::Duplicate,
                    slack_meta,
                    queued_event: None,
                };
                store.accept(&record)?;
                return Ok(ActiveSlackRelayFrameOutcome::Duplicate {
                    ack,
                    dedupe_key: key.to_owned(),
                });
            }
            SlackDispatchDedupeDecision::DuplicatePending => {
                return Ok(ActiveSlackRelayFrameOutcome::DuplicatePending {
                    ack,
                    dedupe_key: key.to_owned(),
                });
            }
        }
    }

    let (facts, mentions) = build_slack_admission_inputs(&config.policy, &event, message.as_ref());
    let is_one_to_one_dm = facts.channel_id.starts_with('D');
    if facts.is_direct_message {
        match authorize_active_direct_message_with_state(&facts, &config.policy, &event, state)
            .await
        {
            SlackDirectMessageAuthorization::Authorized { .. } => {}
            SlackDirectMessageAuthorization::PairingChallenge { text, meta, .. } => {
                maybe_send_pairing_challenge(&config.policy, &facts.channel_id, &text).await;
                let slack_meta = build_slack_meta(
                    &event,
                    dedupe_key.as_deref(),
                    Some("dm-pairing-required"),
                    None,
                );
                let slack_meta = merge_slack_meta(slack_meta, &json!({"pairing": meta}));
                store.accept(&DurableSlackRelayRecord {
                    delivery_id: event.delivery_id.clone(),
                    dedupe_key: dedupe_key.clone(),
                    action: DurableSlackRelayAction::Drop {
                        reason: "dm-pairing-required".to_owned(),
                    },
                    slack_meta: slack_meta.clone(),
                    queued_event: None,
                })?;
                if let Some(key) = dedupe_key.as_deref() {
                    state.dedupe.release(key);
                    store.accept(&DurableSlackRelayRecord {
                        delivery_id: event.delivery_id.clone(),
                        dedupe_key: dedupe_key.clone(),
                        action: DurableSlackRelayAction::Release,
                        slack_meta,
                        queued_event: None,
                    })?;
                }
                return Ok(ActiveSlackRelayFrameOutcome::Dropped {
                    ack,
                    reason: "dm-pairing-required",
                    dedupe_key,
                });
            }
            SlackDirectMessageAuthorization::Disabled => {
                return drop_active_message(
                    store,
                    &mut state.dedupe,
                    &event,
                    ack,
                    dedupe_key,
                    "dm-disabled",
                );
            }
            SlackDirectMessageAuthorization::Unauthorized { .. } => {
                return drop_active_message(
                    store,
                    &mut state.dedupe,
                    &event,
                    ack,
                    dedupe_key,
                    "dm-unauthorized",
                );
            }
        }
    }
    let admission = decide_slack_admission(
        &facts,
        &SlackAdmissionPolicy {
            group_policy: config.policy.group_policy,
            channel_allowlist_configured: !config.policy.allowed_channel_ids.is_empty(),
            channel_allowed: message
                .as_ref()
                .is_some_and(|message| channel_allowed(&config.policy, &message.channel)),
            channel_explicitly_disabled: message
                .as_ref()
                .is_some_and(|message| channel_disabled(&config.policy, &message.channel)),
            dm_policy: if is_one_to_one_dm {
                DmPolicy::Open
            } else {
                config.policy.dm_policy
            },
            allow_from_lower: if is_one_to_one_dm {
                vec!["*".to_owned()]
            } else {
                config.policy.allow_from_lower.clone()
            },
            require_mention: config.policy.require_mention,
            allow_bots: config.policy.allow_bots,
            has_authorized_control_command: has_authorized_control_command(&facts.text)
                && control_command_sender_allowed(&config.policy, &facts),
            ignore_other_mentions: config.policy.ignore_other_mentions,
        },
        &mentions,
    );
    if let SlackAdmissionDecision::Drop(reason) = admission {
        let slack_meta = build_slack_meta(&event, dedupe_key.as_deref(), Some(reason), None);
        let record = DurableSlackRelayRecord {
            delivery_id: event.delivery_id.clone(),
            dedupe_key: dedupe_key.clone(),
            action: DurableSlackRelayAction::Drop {
                reason: reason.to_owned(),
            },
            slack_meta,
            queued_event: None,
        };
        store.accept(&record)?;
        if let Some(key) = dedupe_key.as_deref() {
            state.dedupe.release(key);
            store.accept(&DurableSlackRelayRecord {
                delivery_id: event.delivery_id.clone(),
                dedupe_key: dedupe_key.clone(),
                action: DurableSlackRelayAction::Release,
                slack_meta: build_slack_meta(&event, dedupe_key.as_deref(), Some(reason), None),
                queued_event: None,
            })?;
        }
        return Ok(ActiveSlackRelayFrameOutcome::Dropped {
            ack,
            reason,
            dedupe_key,
        });
    }

    let reply_to_mode = effective_reply_to_mode(&config.policy, facts.is_direct_message);
    state.lifecycle.begin_turn();
    let (prompt_text, reply_thread_ts) =
        build_active_prompt_text(&config.policy, &event, message.as_ref()).await;
    let bot_loop = resolve_active_bot_loop_meta(&config.policy, &facts, message.as_ref());
    let slack_meta = merge_slack_meta(
        build_slack_meta(
            &event,
            dedupe_key.as_deref(),
            None,
            reply_thread_ts.as_deref(),
        ),
        &json!({
            "reply_to_mode": reply_mode_wire(reply_to_mode),
            "bot_loop_protection": bot_loop,
        }),
    );
    let queued_event = match target {
        SlackDispatchTarget::AcpClientFrames { .. } => {
            let frame = build_slack_session_prompt_frame(
                state.next_request_id,
                &config.session_id,
                &prompt_text,
                slack_meta.clone(),
            )?;
            state.next_request_id = state.next_request_id.saturating_add(1);
            Value::String(frame)
        }
        SlackDispatchTarget::Queue { session_policy, .. } => {
            let scope = slack_session_scope(&event, &facts, message.as_ref(), session_policy);
            let envelope = QueuedSlackEvent {
                scope,
                prompt_text,
                reply_routing: SlackReplyRouting {
                    channel_id: facts.channel_id.clone(),
                    team_id: event.team_id.clone(),
                    reply_thread_ts,
                    reply_to_mode,
                },
                received_at: Instant::now(),
                delivery_id: event.delivery_id.clone(),
                dedupe_key: dedupe_key.clone(),
                slack_meta: slack_meta.clone(),
            };
            serde_json::to_value(envelope.to_durable_record())?
        }
    };
    let record = DurableSlackRelayRecord {
        delivery_id: event.delivery_id.clone(),
        dedupe_key: dedupe_key.clone(),
        action: DurableSlackRelayAction::Dispatch,
        slack_meta: slack_meta.clone(),
        queued_event: Some(queued_event.clone()),
    };
    store.accept(&record)?;
    match target {
        SlackDispatchTarget::AcpClientFrames { client_frames } => {
            let Value::String(frame) = queued_event else {
                return Err(ActiveSlackRelayError::Serialize(serde::ser::Error::custom(
                    "frame target produced non-string payload",
                )));
            };
            if client_frames.send(frame).await.is_err() {
                state.lifecycle.finish_turn();
                if let Some(key) = dedupe_key.as_deref() {
                    state.dedupe.release(key);
                    store.accept(&DurableSlackRelayRecord {
                        delivery_id: event.delivery_id.clone(),
                        dedupe_key: dedupe_key.clone(),
                        action: DurableSlackRelayAction::Release,
                        slack_meta: slack_meta.clone(),
                        queued_event: None,
                    })?;
                }
                return Err(ActiveSlackRelayError::ClientFrameTransportClosed);
            }
        }
        SlackDispatchTarget::Queue { queue, .. } => {
            let Ok(durable) = serde_json::from_value::<DurableQueuedSlackEvent>(queued_event)
            else {
                return Err(ActiveSlackRelayError::Serialize(serde::ser::Error::custom(
                    "queue target produced non-envelope payload",
                )));
            };
            if !queue.lock().await.push(durable.to_queued_event()) {
                state.lifecycle.finish_turn();
                return drop_active_message(
                    store,
                    &mut state.dedupe,
                    &event,
                    ack,
                    dedupe_key,
                    "queue-rejected",
                );
            }
        }
    }
    if let Some(key) = dedupe_key.as_deref() {
        state.dedupe.commit(key, Instant::now());
        if matches!(target, SlackDispatchTarget::AcpClientFrames { .. }) {
            // Legacy splice path: fire-and-forget, commit at dispatch.
            // Queue path defers the durable Commit to the turn's terminal
            // state (see pool finish handling in `plugin`).
            store.accept(&DurableSlackRelayRecord {
                delivery_id: event.delivery_id.clone(),
                dedupe_key: dedupe_key.clone(),
                action: DurableSlackRelayAction::Commit,
                slack_meta: slack_meta.clone(),
                queued_event: None,
            })?;
        }
    }
    state.lifecycle.finish_turn();
    Ok(ActiveSlackRelayFrameOutcome::Dispatched { ack, dedupe_key })
}

/// Mutable active relay state.
#[derive(Debug)]
pub struct ActiveSlackRelayState {
    pub(crate) next_request_id: i64,
    pub(crate) dedupe: SlackDispatchDedupeState,
    pub(crate) lifecycle: ActiveSlackRelayLifecycle,
    pub(crate) pairing: MemorySlackPairingStore,
}

impl Default for ActiveSlackRelayState {
    fn default() -> Self {
        Self {
            next_request_id: 1,
            dedupe: SlackDispatchDedupeState::default(),
            lifecycle: ActiveSlackRelayLifecycle::default(),
            pairing: MemorySlackPairingStore::default(),
        }
    }
}

impl ActiveSlackRelayState {
    /// Returns the current relay lifecycle snapshot.
    #[must_use]
    pub fn lifecycle(&self) -> ActiveSlackRelayLifecycle {
        self.lifecycle
    }

    /// Approves a pending Slack DM pairing code for this runtime.
    #[must_use]
    pub fn approve_pairing_code(
        &mut self,
        account_id: &str,
        code: &str,
    ) -> Option<crate::monitor::dm_auth::SlackPairingRecord> {
        crate::monitor::dm_auth::SlackPairingStore::approve_pairing_code(
            &mut self.pairing,
            account_id,
            code,
        )
    }
}

pub(crate) async fn drain_recovered_dispatches(
    state: &mut ActiveSlackRelayState,
    store: &mut impl DurableSlackRelayStore,
    client_frames: &mpsc::Sender<String>,
    replay_records: Vec<DurableSlackRelayRecord>,
) -> Result<(), ActiveSlackRelayError> {
    for record in replay_records {
        let frame = record.queued_event.clone().and_then(|value| {
            if let Value::String(frame) = value {
                Some(frame)
            } else {
                tracing::warn!(
                    delivery_id = %record.delivery_id,
                    "skipping legacy replay of a non-frame durable dispatch payload"
                );
                None
            }
        });
        let Some(frame) = frame else { continue };
        state.lifecycle.begin_turn();
        client_frames
            .send(frame)
            .await
            .map_err(|_| ActiveSlackRelayError::ClientFrameTransportClosed)?;
        store.accept(&DurableSlackRelayRecord {
            delivery_id: record.delivery_id.clone(),
            dedupe_key: record.dedupe_key.clone(),
            action: DurableSlackRelayAction::Replay,
            slack_meta: record.slack_meta.clone(),
            queued_event: record.queued_event.clone(),
        })?;
        if let Some(key) = record.dedupe_key {
            state.dedupe.commit(&key, Instant::now());
            store.accept(&DurableSlackRelayRecord {
                delivery_id: record.delivery_id,
                dedupe_key: Some(key),
                action: DurableSlackRelayAction::Commit,
                slack_meta: record.slack_meta,
                queued_event: None,
            })?;
        }
        state.lifecycle.finish_turn();
    }
    Ok(())
}

/// Plugin-side durable replay: uncommitted dispatches are re-enqueued into the
/// per-scope queue (as envelope objects) instead of re-emitting ACP frames.
///
/// # Errors
///
/// Returns durable-store errors; malformed envelopes are skipped with a warning.
pub(crate) async fn drain_recovered_dispatches_to_queue(
    state: &mut ActiveSlackRelayState,
    store: &mut impl DurableSlackRelayStore,
    queue: &SharedSlackEventQueue,
    replay_records: Vec<DurableSlackRelayRecord>,
) -> Result<(), ActiveSlackRelayError> {
    for record in replay_records {
        let Some(value) = record.queued_event.clone() else {
            continue;
        };
        let Ok(durable) = serde_json::from_value::<DurableQueuedSlackEvent>(value) else {
            tracing::warn!(
                delivery_id = %record.delivery_id,
                "skipping durable dispatch record that is not a queue envelope"
            );
            continue;
        };
        state.lifecycle.begin_turn();
        if !queue.lock().await.push(durable.to_queued_event()) {
            tracing::warn!(
                delivery_id = %record.delivery_id,
                "replayed envelope rejected by the event queue"
            );
        }
        store.accept(&DurableSlackRelayRecord {
            delivery_id: record.delivery_id.clone(),
            dedupe_key: record.dedupe_key.clone(),
            action: DurableSlackRelayAction::Replay,
            slack_meta: record.slack_meta.clone(),
            queued_event: record.queued_event.clone(),
        })?;
        // No durable Commit here: the queue path commits at the turn's
        // terminal state. (In-memory dedupe is left untouched too — the key
        // was already committed in-process at original dispatch time.)
        state.lifecycle.finish_turn();
    }
    Ok(())
}

fn build_active_dedupe_key(
    account_id: &str,
    event: &SlackAcceptedEvent,
    message: Option<&SlackMessageForContent>,
) -> Option<String> {
    let channel_id = message.map(|message| message.channel.as_str()).or_else(|| {
        event
            .message
            .get("channel")
            .and_then(Value::as_str)
            .map(str::trim)
    });
    let ts = message
        .and_then(|message| message.ts.as_deref())
        .or_else(|| {
            event
                .message
                .get("ts")
                .and_then(Value::as_str)
                .map(str::trim)
        });
    build_slack_message_dispatch_replay_key(account_id, channel_id, ts, event.team_id.as_deref())
}

fn build_slack_meta(
    event: &SlackAcceptedEvent,
    dedupe_key: Option<&str>,
    drop_reason: Option<&'static str>,
    reply_thread_ts: Option<&str>,
) -> Value {
    let message = slack_message_for_content_from_value(&event.message);
    let channel = message
        .as_ref()
        .map(|message| message.channel.as_str())
        .or_else(|| event.message.get("channel").and_then(Value::as_str))
        .unwrap_or("unknown");
    let is_direct_message = channel.starts_with('D');
    let session_key = build_slack_acp_session_key(
        event.team_id.as_deref(),
        channel,
        message
            .as_ref()
            .and_then(|message| message.thread_ts.as_deref())
            .or_else(|| message.as_ref().and_then(|message| message.ts.as_deref())),
        message.as_ref().and_then(|message| message.user.as_deref()),
        is_direct_message,
    );
    json!({
        "delivery_id": event.delivery_id,
        "transport": slack_transport_wire(event.transport),
        "session_key": session_key,
        "team_id": event.team_id,
        "route": event.route,
        "message": event.message,
        "payload": event.payload,
        "dedupe_key": dedupe_key,
        "drop_reason": drop_reason,
        "reply_thread_ts": reply_thread_ts,
    })
}

fn merge_slack_meta(mut base: Value, extra: &Value) -> Value {
    if let (Some(base), Some(extra)) = (base.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            base.insert(key.clone(), value.clone());
        }
    }
    base
}

fn drop_active_message(
    store: &mut impl DurableSlackRelayStore,
    dedupe: &mut SlackDispatchDedupeState,
    event: &SlackAcceptedEvent,
    ack: SlackRelayAckFrame,
    dedupe_key: Option<String>,
    reason: &'static str,
) -> Result<ActiveSlackRelayFrameOutcome, ActiveSlackRelayError> {
    let slack_meta = build_slack_meta(event, dedupe_key.as_deref(), Some(reason), None);
    store.accept(&DurableSlackRelayRecord {
        delivery_id: event.delivery_id.clone(),
        dedupe_key: dedupe_key.clone(),
        action: DurableSlackRelayAction::Drop {
            reason: reason.to_owned(),
        },
        slack_meta: slack_meta.clone(),
        queued_event: None,
    })?;
    if let Some(key) = dedupe_key.as_deref() {
        dedupe.release(key);
        store.accept(&DurableSlackRelayRecord {
            delivery_id: event.delivery_id.clone(),
            dedupe_key: dedupe_key.clone(),
            action: DurableSlackRelayAction::Release,
            slack_meta,
            queued_event: None,
        })?;
    }
    Ok(ActiveSlackRelayFrameOutcome::Dropped {
        ack,
        reason,
        dedupe_key,
    })
}

fn slack_transport_wire(transport: SlackAcceptedEventTransport) -> &'static str {
    match transport {
        SlackAcceptedEventTransport::Relay => "relay",
        SlackAcceptedEventTransport::DirectHttp => "direct_http",
        SlackAcceptedEventTransport::DirectSocket => "direct_socket",
    }
}

fn control_command_sender_allowed(
    policy: &ActiveSlackRelayPolicy,
    facts: &SlackAdmissionFacts,
) -> bool {
    if facts.is_direct_message {
        return true;
    }
    let sender_id = facts
        .user_id
        .as_deref()
        .or(facts.bot_id.as_deref())
        .unwrap_or_default()
        .to_ascii_lowercase();
    !sender_id.is_empty()
        && policy
            .allow_from_lower
            .iter()
            .any(|entry| entry == "*" || entry == &sender_id)
}

pub use crate::output::{
    run_slack_acp_output_to_replies, SlackAcpFrameDirection, SlackAcpObservedFrame,
    SlackAcpOutputConfig, SlackAcpOutputDelivery, SlackAcpOutputError, SlackAcpOutputState,
    SlackStatusDelivery,
};

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::json;
    use tokio::sync::Mutex;

    use super::*;
    use crate::config::DedupMode;
    use crate::monitor::ingress::{recover_durable_relay_log, MemorySlackRelayStore};
    use crate::queue::{SlackEventQueue, SlackFlushBatch};

    fn test_config() -> ActiveSlackRelayConfig {
        ActiveSlackRelayConfig {
            relay: crate::monitor::relay_source::SlackRelaySourceConfig {
                url: "ws://127.0.0.1/slack".to_owned(),
                auth_token: "secret".to_owned(),
                gateway_id: "agent:abc".to_owned(),
            },
            session_id: "plugin-owned".to_owned(),
            policy: ActiveSlackRelayPolicy::default(),
            durable_log_path: None,
        }
    }

    fn relay_frame(event: &Value) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "type": "slack_event",
            "delivery_id": "d1",
            "route": {"kind": "channel_default", "key": "agent:abc"},
            "payload": {"team_id": "T1", "event": event},
        }))
        .unwrap()
    }

    fn shared_queue(mode: DedupMode) -> SharedSlackEventQueue {
        Arc::new(Mutex::new(SlackEventQueue::new(mode)))
    }

    #[tokio::test]
    async fn queue_target_enqueues_scoped_envelope_with_durable_record() {
        let queue = shared_queue(DedupMode::Queue);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_active_slack_relay_frame_with_target(
            relay_frame(&json!({
                "type": "message",
                "channel": "C1",
                "user": "U1",
                "text": "hi",
                "ts": "105.000",
                "thread_ts": "100.000",
            })),
            &test_config(),
            &mut state,
            &mut store,
            SlackDispatchTarget::Queue {
                queue: &queue,
                session_policy: SessionPolicy::Thread,
            },
        )
        .await
        .unwrap();

        assert!(matches!(
            outcome,
            ActiveSlackRelayFrameOutcome::Dispatched { .. }
        ));
        let guard = queue.lock().await;
        let scope = crate::scope::SlackSessionScope {
            team_id: "T1".to_owned(),
            channel_id: "C1".to_owned(),
            thread_ts: Some("100.000".to_owned()),
            is_dm: false,
        };
        assert_eq!(guard.queued_event_count(&scope), 1);
        let dispatch = store
            .records
            .iter()
            .find(|record| record.action == DurableSlackRelayAction::Dispatch)
            .expect("dispatch record");
        let durable: DurableQueuedSlackEvent =
            serde_json::from_value(dispatch.queued_event.clone().expect("envelope payload"))
                .expect("envelope parses");
        assert_eq!(durable.scope, scope);
        assert!(durable.prompt_text.contains("hi"));
        assert_eq!(durable.reply_routing.channel_id, "C1");
        assert_eq!(durable.delivery_id, "d1");
    }

    #[tokio::test]
    async fn queue_target_dm_event_scopes_to_conversation() {
        let queue = shared_queue(DedupMode::Queue);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_active_slack_relay_frame_with_target(
            relay_frame(&json!({
                "type": "message",
                "channel": "D9",
                "channel_type": "im",
                "user": "U1",
                "text": "ping",
                "ts": "105.000",
            })),
            &test_config(),
            &mut state,
            &mut store,
            SlackDispatchTarget::Queue {
                queue: &queue,
                session_policy: SessionPolicy::Thread,
            },
        )
        .await
        .unwrap();

        assert!(matches!(
            outcome,
            ActiveSlackRelayFrameOutcome::Dispatched { .. }
        ));
        let guard = queue.lock().await;
        let scope = crate::scope::SlackSessionScope {
            team_id: "T1".to_owned(),
            channel_id: "D9".to_owned(),
            thread_ts: None,
            is_dm: true,
        };
        assert_eq!(guard.queued_event_count(&scope), 1);
    }

    #[tokio::test]
    async fn recovered_dispatches_reenqueue_into_queue() {
        let queue = shared_queue(DedupMode::Queue);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        state.lifecycle.attach();
        state.lifecycle.start();

        let scope = crate::scope::SlackSessionScope {
            team_id: "T1".to_owned(),
            channel_id: "C1".to_owned(),
            thread_ts: Some("100.000".to_owned()),
            is_dm: false,
        };
        let envelope = QueuedSlackEvent {
            scope: scope.clone(),
            prompt_text: "recovered prompt".to_owned(),
            reply_routing: SlackReplyRouting {
                channel_id: "C1".to_owned(),
                team_id: Some("T1".to_owned()),
                reply_thread_ts: Some("100.000".to_owned()),
                reply_to_mode: crate::monitor::replies::SlackReplyToMode::All,
            },
            received_at: Instant::now(),
            delivery_id: "d9".to_owned(),
            dedupe_key: Some(r#"["message","acct","T1","C1","105.000"]"#.to_owned()),
            slack_meta: serde_json::json!({"origin": "test"}),
        };
        let replay = vec![DurableSlackRelayRecord {
            delivery_id: "d9".to_owned(),
            dedupe_key: Some(r#"["message","acct","T1","C1","105.000"]"#.to_owned()),
            action: DurableSlackRelayAction::Dispatch,
            slack_meta: json!({}),
            queued_event: Some(serde_json::to_value(envelope.to_durable_record()).unwrap()),
        }];

        drain_recovered_dispatches_to_queue(&mut state, &mut store, &queue, replay)
            .await
            .unwrap();

        let mut guard = queue.lock().await;
        assert_eq!(guard.queued_event_count(&scope), 1);
        let SlackFlushBatch {
            scope: flushed,
            events,
        } = guard.flush_next().expect("replayed event flushes");
        assert_eq!(flushed, scope);
        assert_eq!(events[0].prompt_text, "recovered prompt");
        drop(guard);
        assert!(store
            .records
            .iter()
            .any(|record| record.action == DurableSlackRelayAction::Replay));
        assert!(
            !store
                .records
                .iter()
                .any(|record| record.action == DurableSlackRelayAction::Commit),
            "queue replay must NOT commit — the terminal commit lands at turn end"
        );
    }

    fn durable_temp_path(name: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "slack-dispatch-{name}-{}-{nanos}.jsonl",
            std::process::id()
        ))
    }

    #[tokio::test]
    async fn queue_target_writes_dispatch_without_commit_until_turn_end() {
        let path = durable_temp_path("crash-enqueue");
        let store_handle =
            crate::monitor::ingress::SharedSlackRelayStore::open(&path).expect("store opens");
        let mut store = store_handle.clone();
        let queue = shared_queue(DedupMode::Queue);
        let mut state = ActiveSlackRelayState::default();

        let outcome = handle_active_slack_relay_frame_with_target(
            relay_frame(&json!({
                "type": "message",
                "channel": "C1",
                "user": "U1",
                "text": "hi",
                "ts": "105.000",
                "thread_ts": "100.000",
            })),
            &test_config(),
            &mut state,
            &mut store,
            SlackDispatchTarget::Queue {
                queue: &queue,
                session_policy: SessionPolicy::Thread,
            },
        )
        .await
        .unwrap();
        assert!(matches!(
            outcome,
            ActiveSlackRelayFrameOutcome::Dispatched { .. }
        ));

        // Crash right after enqueue: nothing completes the turn.
        drop(queue);
        drop(store_handle);

        let recovery = recover_durable_relay_log(&path).expect("recover");
        assert_eq!(
            recovery.replay_records.len(),
            1,
            "uncommitted queue dispatch replays after crash"
        );

        // Boot 2: replay re-enqueues and writes only the Replay marker (no Commit);
        // a second crash before the turn ends must replay AGAIN.
        let queue2 = shared_queue(DedupMode::Queue);
        let mut store2 =
            crate::monitor::ingress::SharedSlackRelayStore::open(&path).expect("reopen");
        let mut state2 = ActiveSlackRelayState::default();
        state2.lifecycle.attach();
        state2.lifecycle.start();
        drain_recovered_dispatches_to_queue(
            &mut state2,
            &mut store2,
            &queue2,
            recovery.replay_records,
        )
        .await
        .unwrap();
        let scope = crate::scope::SlackSessionScope {
            team_id: "T1".to_owned(),
            channel_id: "C1".to_owned(),
            thread_ts: Some("100.000".to_owned()),
            is_dm: false,
        };
        assert_eq!(
            queue2.lock().await.queued_event_count(&scope),
            1,
            "replayed envelope lands back in the queue"
        );
        drop(queue2);
        drop(store2);
        let recovery2 = recover_durable_relay_log(&path).expect("recover again");
        assert_eq!(
            recovery2.replay_records.len(),
            1,
            "replay alone does not suppress future replays"
        );

        // Turn completes: pool writes the terminal Commit; boot 3 replays nothing.
        let mut store3 =
            crate::monitor::ingress::SharedSlackRelayStore::open(&path).expect("reopen");
        let commit = recovery2.replay_records[0]
            .queued_event
            .clone()
            .and_then(|value| serde_json::from_value::<DurableQueuedSlackEvent>(value).ok())
            .expect("envelope in replay record")
            .to_queued_event()
            .to_terminal_commit_record()
            .expect("envelope carries a dedupe key");
        store3.accept(&commit).unwrap();
        let recovery3 = recover_durable_relay_log(&path).expect("recover third");
        for key in recovery3.committed_dedupe_keys {
            assert!(!key.is_empty());
        }
        assert!(
            recovery3.replay_records.is_empty(),
            "completed turns are not replayed"
        );
        std::fs::remove_file(&path).ok();
    }

    #[tokio::test]
    async fn legacy_frame_target_commits_at_dispatch() {
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_active_slack_relay_frame(
            relay_frame(&json!({
                "type": "message",
                "channel": "C1",
                "user": "U1",
                "text": "hi",
                "ts": "105.000",
            })),
            &test_config(),
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        assert!(matches!(
            outcome,
            ActiveSlackRelayFrameOutcome::Dispatched { .. }
        ));
        assert!(rx.recv().await.is_some());
        let actions: Vec<DurableSlackRelayAction> = store
            .records
            .iter()
            .map(|record| record.action.clone())
            .collect();
        assert_eq!(
            actions,
            vec![
                DurableSlackRelayAction::Claim,
                DurableSlackRelayAction::Dispatch,
                DurableSlackRelayAction::Commit,
            ],
            "legacy splice path keeps fire-and-forget commit-at-dispatch"
        );
    }

    #[tokio::test]
    async fn legacy_replay_skips_envelope_payloads() {
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let replay = vec![DurableSlackRelayRecord {
            delivery_id: "d-env".to_owned(),
            dedupe_key: None,
            action: DurableSlackRelayAction::Dispatch,
            slack_meta: json!({}),
            queued_event: Some(json!({"scope": {"team_id": "T1"}})),
        }];
        drain_recovered_dispatches(&mut state, &mut store, &tx, replay)
            .await
            .unwrap();
        assert!(
            rx.try_recv().is_err(),
            "envelope must not hit the frame pipe"
        );
    }
}
