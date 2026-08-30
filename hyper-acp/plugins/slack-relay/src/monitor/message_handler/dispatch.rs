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
use crate::relay_source::{
    build_relay_ack, extract_relay_hello, extract_relay_slack_message_event, parse_relay_frame,
    SlackRelayAckFrame,
};

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
#[allow(clippy::too_many_lines)]
pub async fn handle_active_slack_relay_frame(
    data: impl AsRef<[u8]>,
    config: &ActiveSlackRelayConfig,
    state: &mut ActiveSlackRelayState,
    store: &mut impl DurableSlackRelayStore,
    client_frames: &mpsc::Sender<String>,
) -> Result<ActiveSlackRelayFrameOutcome, ActiveSlackRelayError> {
    let frame = parse_relay_frame(data)?;
    if extract_relay_hello(&frame).is_some() {
        return Ok(ActiveSlackRelayFrameOutcome::Hello);
    }
    let Some(event) = extract_relay_slack_message_event(&frame) else {
        return Ok(ActiveSlackRelayFrameOutcome::Ignored);
    };
    handle_accepted_slack_event(
        event.into(),
        &SlackProviderDispatchConfig::from(config),
        state,
        store,
        client_frames,
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
#[allow(clippy::too_many_lines)]
pub async fn handle_accepted_slack_event(
    event: SlackAcceptedEvent,
    config: &SlackProviderDispatchConfig,
    state: &mut ActiveSlackRelayState,
    store: &mut impl DurableSlackRelayStore,
    client_frames: &mpsc::Sender<String>,
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
                    acp_frame: None,
                })?;
            }
            SlackDispatchDedupeDecision::DuplicateAccepted => {
                let slack_meta = build_slack_meta(&event, dedupe_key.as_deref(), None, None);
                let record = DurableSlackRelayRecord {
                    delivery_id: event.delivery_id,
                    dedupe_key: dedupe_key.clone(),
                    action: DurableSlackRelayAction::Duplicate,
                    slack_meta,
                    acp_frame: None,
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
                    acp_frame: None,
                })?;
                if let Some(key) = dedupe_key.as_deref() {
                    state.dedupe.release(key);
                    store.accept(&DurableSlackRelayRecord {
                        delivery_id: event.delivery_id.clone(),
                        dedupe_key: dedupe_key.clone(),
                        action: DurableSlackRelayAction::Release,
                        slack_meta,
                        acp_frame: None,
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
            acp_frame: None,
        };
        store.accept(&record)?;
        if let Some(key) = dedupe_key.as_deref() {
            state.dedupe.release(key);
            store.accept(&DurableSlackRelayRecord {
                delivery_id: event.delivery_id.clone(),
                dedupe_key: dedupe_key.clone(),
                action: DurableSlackRelayAction::Release,
                slack_meta: build_slack_meta(&event, dedupe_key.as_deref(), Some(reason), None),
                acp_frame: None,
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
    let frame = build_slack_session_prompt_frame(
        state.next_request_id,
        &config.session_id,
        &prompt_text,
        slack_meta.clone(),
    )?;
    state.next_request_id = state.next_request_id.saturating_add(1);
    let record = DurableSlackRelayRecord {
        delivery_id: event.delivery_id.clone(),
        dedupe_key: dedupe_key.clone(),
        action: DurableSlackRelayAction::Dispatch,
        slack_meta: slack_meta.clone(),
        acp_frame: Some(frame.clone()),
    };
    store.accept(&record)?;
    if client_frames.send(frame).await.is_err() {
        state.lifecycle.finish_turn();
        if let Some(key) = dedupe_key.as_deref() {
            state.dedupe.release(key);
            store.accept(&DurableSlackRelayRecord {
                delivery_id: event.delivery_id.clone(),
                dedupe_key: dedupe_key.clone(),
                action: DurableSlackRelayAction::Release,
                slack_meta: slack_meta.clone(),
                acp_frame: None,
            })?;
        }
        return Err(ActiveSlackRelayError::ClientFrameTransportClosed);
    }
    if let Some(key) = dedupe_key.as_deref() {
        state.dedupe.commit(key, Instant::now());
        store.accept(&DurableSlackRelayRecord {
            delivery_id: event.delivery_id.clone(),
            dedupe_key: dedupe_key.clone(),
            action: DurableSlackRelayAction::Commit,
            slack_meta: slack_meta.clone(),
            acp_frame: None,
        })?;
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
        let Some(frame) = record.acp_frame.clone() else {
            continue;
        };
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
            acp_frame: record.acp_frame.clone(),
        })?;
        if let Some(key) = record.dedupe_key {
            state.dedupe.commit(&key, Instant::now());
            store.accept(&DurableSlackRelayRecord {
                delivery_id: record.delivery_id,
                dedupe_key: Some(key),
                action: DurableSlackRelayAction::Commit,
                slack_meta: record.slack_meta,
                acp_frame: None,
            })?;
        }
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
        acp_frame: None,
    })?;
    if let Some(key) = dedupe_key.as_deref() {
        dedupe.release(key);
        store.accept(&DurableSlackRelayRecord {
            delivery_id: event.delivery_id.clone(),
            dedupe_key: dedupe_key.clone(),
            action: DurableSlackRelayAction::Release,
            slack_meta,
            acp_frame: None,
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
