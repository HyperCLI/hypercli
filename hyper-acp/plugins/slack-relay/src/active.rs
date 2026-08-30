//! Active Slack relay runtime that emits canonical ACP client frames.
//!
//! Provenance:
//! - Relay connect/read/ack/reconnect/shutdown semantics are ported from
//!   `openclaw-git/extensions/slack/src/monitor/relay-source.ts` lines 37-91,
//!   93-134, 136-228, and 366-375.
//! - Durable-before-ack and logical dispatch dedupe are ported from
//!   `openclaw-git/extensions/slack/src/monitor/relay-source.ts` lines 202-228
//!   and `openclaw-git/extensions/slack/src/monitor/message-dispatch-dedupe.ts`
//!   lines 1-42.
//! - Admission facts/gates are ported from
//!   `openclaw-git/extensions/slack/src/monitor/message-handler/prepare.ts`
//!   lines 553-638 and 1243-1305.
//! - Thread/history/content/reply metadata delegates to sibling modules whose
//!   file headers cite the OpenClaw source ranges they port.
//! - Canonical ACP prompt frames use `agent-client-protocol-schema` v1
//!   `PromptRequest` and JSON-RPC wrappers, not a bespoke `turn.submit`.

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use agent_client_protocol_schema::v1::{
    ContentBlock, JsonRpcMessage, PromptRequest, Request, RequestId, TextContent,
};
use futures_util::{SinkExt, StreamExt};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async_with_config;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::AUTHORIZATION;
use tokio_tungstenite::tungstenite::protocol::{
    frame::coding::CloseCode, CloseFrame, Message, WebSocketConfig,
};

use crate::admission::{
    decide_slack_admission, resolve_slack_bot_loop_protection, AllowBotsMode, DmPolicy,
    GroupPolicy, SlackAdmissionDecision, SlackAdmissionFacts, SlackAdmissionPolicy,
    SlackMentionFacts,
};
use crate::content::{
    resolve_slack_message_content, slack_message_for_content_from_value, SlackFile,
    SlackMessageForContent,
};
use crate::dedupe::{
    build_slack_message_dispatch_replay_key, SLACK_MESSAGE_DISPATCH_DEDUPE_MEMORY_MAX_ENTRIES,
    SLACK_MESSAGE_DISPATCH_DEDUPE_TTL_MS,
};
use crate::dm::{
    authorize_slack_direct_message, build_users_info_proxy_request,
    resolve_slack_user_name_from_info, SlackDirectMessageAuthorization,
};
use crate::event::{slack_event_source, SlackEventSource};
use crate::history::{
    build_files_info_proxy_requests, fetch_slack_thread_history_via_relay,
    filter_slack_thread_history_for_visibility, format_slack_thread_history_body,
    hydrate_slack_thread_starter_media, should_seed_initial_thread_context, SlackContextVisibility,
    SlackSessionFreshness, SlackThreadHistoryMessage,
};
use crate::manager::{SERVER_SHUTDOWN_CLOSE_CODE, SERVER_SHUTDOWN_REASON};
use crate::reconnect::{compute_reconnect_backoff_ms, is_non_recoverable_slack_auth_error};
use crate::relay_source::{
    build_relay_ack, build_relay_websocket_options, build_relay_websocket_url, extract_relay_hello,
    extract_relay_slack_message_event, format_relay_close, parse_relay_frame, SlackRelayAckFrame,
    SlackRelayError, SlackRelayRouteKind, SlackRelaySourceConfig, HYPER_AGENTS_API_KEY_ENV,
};
use crate::reply::{
    deliver_slack_reply_payloads, resolve_delivered_slack_reply_thread_ts, SlackRelayHttpSender,
    SlackReplyDeliveryTarget, SlackReplyPayload, SlackReplyToMode,
};

/// Environment variable for active Slack relay URL.
pub const HYPER_ACP_SLACK_RELAY_URL_ENV: &str = "HYPER_ACP_SLACK_RELAY_URL";
/// Environment variable for active Slack gateway id.
pub const HYPER_ACP_SLACK_GATEWAY_ID_ENV: &str = "HYPER_ACP_SLACK_GATEWAY_ID";
/// Environment variable for target canonical ACP session id.
pub const HYPER_ACP_SLACK_SESSION_ID_ENV: &str = "HYPER_ACP_SLACK_SESSION_ID";
/// Environment variable for durable accept JSONL path.
pub const HYPER_ACP_SLACK_DURABLE_LOG_ENV: &str = "HYPER_ACP_SLACK_DURABLE_LOG";
/// Environment variable for logical Slack account id used by dispatch dedupe.
pub const HYPER_ACP_SLACK_ACCOUNT_ID_ENV: &str = "HYPER_ACP_SLACK_ACCOUNT_ID";
/// Environment variable for Slack bot user id.
pub const HYPER_ACP_SLACK_BOT_USER_ID_ENV: &str = "HYPER_ACP_SLACK_BOT_USER_ID";
/// Environment variable for Slack bot id.
pub const HYPER_ACP_SLACK_BOT_ID_ENV: &str = "HYPER_ACP_SLACK_BOT_ID";
/// Environment variable for DM policy: `open`, `disabled`, `allowlist`, `pairing`.
pub const HYPER_ACP_SLACK_DM_POLICY_ENV: &str = "HYPER_ACP_SLACK_DM_POLICY";
/// Environment variable for group policy: `open`, `disabled`, `allowlist`.
pub const HYPER_ACP_SLACK_GROUP_POLICY_ENV: &str = "HYPER_ACP_SLACK_GROUP_POLICY";
/// Environment variable for comma-separated allowed Slack sender ids/names.
pub const HYPER_ACP_SLACK_ALLOW_FROM_ENV: &str = "HYPER_ACP_SLACK_ALLOW_FROM";
/// Environment variable for comma-separated allowed Slack channel ids.
pub const HYPER_ACP_SLACK_CHANNELS_ENV: &str = "HYPER_ACP_SLACK_CHANNELS";
/// Environment variable for comma-separated explicitly disabled Slack channel ids.
pub const HYPER_ACP_SLACK_DISABLED_CHANNELS_ENV: &str = "HYPER_ACP_SLACK_DISABLED_CHANNELS";
/// Environment variable for room mention requirement.
pub const HYPER_ACP_SLACK_REQUIRE_MENTION_ENV: &str = "HYPER_ACP_SLACK_REQUIRE_MENTION";
/// Environment variable for ignoring messages that mention somebody else.
pub const HYPER_ACP_SLACK_IGNORE_OTHER_MENTIONS_ENV: &str = "HYPER_ACP_SLACK_IGNORE_OTHER_MENTIONS";
/// Environment variable for bot admission: `off`, `all`, `mentions`.
pub const HYPER_ACP_SLACK_ALLOW_BOTS_ENV: &str = "HYPER_ACP_SLACK_ALLOW_BOTS";
/// Environment variable for reply-to mode: `off`, `first`, `all`, `batched`.
pub const HYPER_ACP_SLACK_REPLY_TO_MODE_ENV: &str = "HYPER_ACP_SLACK_REPLY_TO_MODE";
/// Environment variable for DM reply-to override; HyperClaw relay default is `off`.
pub const HYPER_ACP_SLACK_DIRECT_REPLY_TO_MODE_ENV: &str = "HYPER_ACP_SLACK_DIRECT_REPLY_TO_MODE";
/// Environment variable for comma-separated Slack subteam/usergroup ids treated as bot mentions.
pub const HYPER_ACP_SLACK_MENTION_SUBTEAMS_ENV: &str = "HYPER_ACP_SLACK_MENTION_SUBTEAMS";
/// Environment variable for comma-separated custom mention regex patterns.
pub const HYPER_ACP_SLACK_MENTION_PATTERNS_ENV: &str = "HYPER_ACP_SLACK_MENTION_PATTERNS";
/// Environment variable for relay HTTP API base URL.
pub const HYPER_ACP_SLACK_RELAY_API_URL_ENV: &str = "HYPER_ACP_SLACK_RELAY_API_URL";
/// Environment variable for direct-message name matching parity.
pub const HYPER_ACP_SLACK_ALLOW_NAME_MATCHING_ENV: &str = "HYPER_ACP_SLACK_ALLOW_NAME_MATCHING";
/// Environment variable for Slack thread context visibility.
pub const HYPER_ACP_SLACK_CONTEXT_VISIBILITY_ENV: &str = "HYPER_ACP_SLACK_CONTEXT_VISIBILITY";
/// Environment variable for Slack initial thread history limit.
pub const HYPER_ACP_SLACK_THREAD_HISTORY_LIMIT_ENV: &str = "HYPER_ACP_SLACK_THREAD_HISTORY_LIMIT";
/// Environment variable for Slack media hydration max bytes.
pub const HYPER_ACP_SLACK_MEDIA_MAX_BYTES_ENV: &str = "HYPER_ACP_SLACK_MEDIA_MAX_BYTES";
const DEFAULT_SLACK_MEDIA_MAX_BYTES: u64 = 20 * 1024 * 1024;

/// Active Slack relay config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveSlackRelayConfig {
    /// Relay source config.
    pub relay: SlackRelaySourceConfig,
    /// Existing ACP session id that receives Slack prompts.
    pub session_id: String,
    /// Active admission and content policy.
    pub policy: ActiveSlackRelayPolicy,
    /// Durable accept log. If absent, [`run_slack_relay_to_acp_client_frames`]
    /// chooses a deterministic temp-file path from gateway/session ids.
    pub durable_log_path: Option<PathBuf>,
}

impl ActiveSlackRelayConfig {
    /// Reads active Slack relay config from HyperCLI env vars.
    ///
    /// # Errors
    ///
    /// Returns an error when any required value is missing or invalid.
    pub fn from_env() -> Result<Option<Self>, ActiveSlackRelayError> {
        let Some(url) = env_var(HYPER_ACP_SLACK_RELAY_URL_ENV) else {
            return Ok(None);
        };
        let gateway_id = required_env(HYPER_ACP_SLACK_GATEWAY_ID_ENV)?;
        let session_id = required_env(HYPER_ACP_SLACK_SESSION_ID_ENV)?;
        let relay = SlackRelaySourceConfig::from_hyper_agents_env(url, gateway_id)?;
        let account_id =
            env_var(HYPER_ACP_SLACK_ACCOUNT_ID_ENV).unwrap_or_else(|| relay.gateway_id.clone());
        let policy = ActiveSlackRelayPolicy {
            account_id,
            current_bot_user_id: env_var(HYPER_ACP_SLACK_BOT_USER_ID_ENV),
            current_bot_id: env_var(HYPER_ACP_SLACK_BOT_ID_ENV),
            group_policy: parse_group_policy(env_var(HYPER_ACP_SLACK_GROUP_POLICY_ENV).as_deref()),
            dm_policy: parse_dm_policy(env_var(HYPER_ACP_SLACK_DM_POLICY_ENV).as_deref()),
            allow_from_lower: csv_env(HYPER_ACP_SLACK_ALLOW_FROM_ENV)
                .into_iter()
                .map(|value| value.to_ascii_lowercase())
                .collect(),
            allowed_channel_ids: csv_env(HYPER_ACP_SLACK_CHANNELS_ENV),
            disabled_channel_ids: csv_env(HYPER_ACP_SLACK_DISABLED_CHANNELS_ENV),
            require_mention: bool_env(HYPER_ACP_SLACK_REQUIRE_MENTION_ENV, false),
            ignore_other_mentions: bool_env(HYPER_ACP_SLACK_IGNORE_OTHER_MENTIONS_ENV, false),
            allow_bots: parse_allow_bots(env_var(HYPER_ACP_SLACK_ALLOW_BOTS_ENV).as_deref()),
            reply_to_mode: parse_reply_mode(env_var(HYPER_ACP_SLACK_REPLY_TO_MODE_ENV).as_deref()),
            direct_reply_to_mode: env_var(HYPER_ACP_SLACK_DIRECT_REPLY_TO_MODE_ENV)
                .as_deref()
                .map_or(SlackReplyToMode::Off, |value| parse_reply_mode(Some(value))),
            mention_subteam_ids: csv_env(HYPER_ACP_SLACK_MENTION_SUBTEAMS_ENV),
            mention_patterns: csv_env(HYPER_ACP_SLACK_MENTION_PATTERNS_ENV),
            relay_api_base_url: env_var(HYPER_ACP_SLACK_RELAY_API_URL_ENV)
                .or_else(|| derive_relay_api_base_url(&relay.url)),
            allow_name_matching: bool_env(HYPER_ACP_SLACK_ALLOW_NAME_MATCHING_ENV, false),
            context_visibility: parse_context_visibility(
                env_var(HYPER_ACP_SLACK_CONTEXT_VISIBILITY_ENV).as_deref(),
            ),
            thread_initial_history_limit: env_var(HYPER_ACP_SLACK_THREAD_HISTORY_LIMIT_ENV)
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(20),
            media_max_bytes: env_var(HYPER_ACP_SLACK_MEDIA_MAX_BYTES_ENV)
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(DEFAULT_SLACK_MEDIA_MAX_BYTES),
        };
        let durable_log_path = env_var(HYPER_ACP_SLACK_DURABLE_LOG_ENV).map(PathBuf::from);
        Ok(Some(Self {
            relay,
            session_id,
            policy,
            durable_log_path,
        }))
    }
}

/// Active Slack admission/content policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveSlackRelayPolicy {
    /// Logical account id for dispatch dedupe.
    pub account_id: String,
    /// Current bot user id for mention/self-message detection.
    pub current_bot_user_id: Option<String>,
    /// Current bot id for bot-loop detection.
    pub current_bot_id: Option<String>,
    /// Group channel policy.
    pub group_policy: GroupPolicy,
    /// Direct-message policy.
    pub dm_policy: DmPolicy,
    /// Lowercase allowed sender ids/names.
    pub allow_from_lower: Vec<String>,
    /// Allowed channel ids.
    pub allowed_channel_ids: Vec<String>,
    /// Explicitly disabled channel ids.
    pub disabled_channel_ids: Vec<String>,
    /// Whether room messages require a bot mention or implicit mention.
    pub require_mention: bool,
    /// Whether to ignore room messages that mention other users only.
    pub ignore_other_mentions: bool,
    /// Bot message admission mode.
    pub allow_bots: AllowBotsMode,
    /// Reply threading mode attached to metadata for downstream reply senders.
    pub reply_to_mode: SlackReplyToMode,
    /// Direct-message reply threading override.
    pub direct_reply_to_mode: SlackReplyToMode,
    /// Slack subteam/usergroup ids that count as bot mentions.
    pub mention_subteam_ids: Vec<String>,
    /// Custom mention regex patterns.
    pub mention_patterns: Vec<String>,
    /// Relay API base used for Web API-backed thread history and pairing replies.
    pub relay_api_base_url: Option<String>,
    /// Whether allowlist name/slug matching is enabled.
    pub allow_name_matching: bool,
    /// Supplemental thread context visibility.
    pub context_visibility: SlackContextVisibility,
    /// Initial history messages retained for new/stale Slack thread sessions.
    pub thread_initial_history_limit: usize,
    /// Max Slack file bytes eligible for prompt hydration.
    pub media_max_bytes: u64,
}

impl Default for ActiveSlackRelayPolicy {
    fn default() -> Self {
        Self {
            account_id: "default".to_owned(),
            current_bot_user_id: None,
            current_bot_id: None,
            group_policy: GroupPolicy::Open,
            dm_policy: DmPolicy::Open,
            allow_from_lower: Vec::new(),
            allowed_channel_ids: Vec::new(),
            disabled_channel_ids: Vec::new(),
            require_mention: false,
            ignore_other_mentions: false,
            allow_bots: AllowBotsMode::Off,
            reply_to_mode: SlackReplyToMode::All,
            direct_reply_to_mode: SlackReplyToMode::Off,
            mention_subteam_ids: Vec::new(),
            mention_patterns: Vec::new(),
            relay_api_base_url: None,
            allow_name_matching: false,
            context_visibility: SlackContextVisibility::All,
            thread_initial_history_limit: 20,
            media_max_bytes: DEFAULT_SLACK_MEDIA_MAX_BYTES,
        }
    }
}

/// OpenClaw-style durable relay lifecycle state exposed for attach/start/stop/idle tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ActiveSlackRelayLifecycle {
    attached: bool,
    running: bool,
    in_flight: usize,
}

impl ActiveSlackRelayLifecycle {
    /// Marks the relay dispatcher attached.
    pub fn attach(&mut self) {
        self.attached = true;
    }

    /// Marks the relay drain loop running.
    pub fn start(&mut self) {
        self.running = true;
    }

    /// Marks the relay drain loop stopped.
    pub fn stop(&mut self) {
        self.running = false;
    }

    /// Whether no dispatch/replay is currently being adopted.
    #[must_use]
    pub fn is_idle(&self) -> bool {
        self.in_flight == 0
    }

    /// Whether a dispatcher is attached.
    #[must_use]
    pub fn is_attached(&self) -> bool {
        self.attached
    }

    /// Whether the relay lifecycle is running.
    #[must_use]
    pub fn is_running(&self) -> bool {
        self.running
    }

    fn begin_turn(&mut self) {
        self.in_flight = self.in_flight.saturating_add(1);
    }

    fn finish_turn(&mut self) {
        self.in_flight = self.in_flight.saturating_sub(1);
    }
}

/// Active runtime control messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveSlackRelayControl {
    /// Stop the relay loop and close the websocket with the server-shutdown reason.
    Shutdown,
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

/// Durable record written before a relay ack is sent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DurableSlackRelayRecord {
    /// Delivery id.
    pub delivery_id: String,
    /// Logical dedupe key.
    pub dedupe_key: Option<String>,
    /// Processing action.
    pub action: DurableSlackRelayAction,
    /// Slack metadata used to build the ACP prompt.
    pub slack_meta: Value,
    /// Canonical ACP frame when dispatched.
    pub acp_frame: Option<String>,
}

/// Durable processing action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DurableSlackRelayAction {
    /// Logical dedupe key was reserved pending dispatch outcome.
    Claim,
    /// Event will be dispatched to ACP.
    Dispatch,
    /// Event was durably dispatched and the logical dedupe key is committed.
    Commit,
    /// Event was gated locally.
    Drop {
        /// Drop reason.
        reason: String,
    },
    /// Pending logical dedupe key was released after a gated/failed dispatch.
    Release,
    /// Uncommitted dispatch record was replayed to ACP after startup.
    Replay,
    /// Event duplicated an already claimed Slack logical message.
    Duplicate,
}

/// Durable accept store.
pub trait DurableSlackRelayStore {
    /// Accept a Slack relay record durably before acking the relay frame.
    ///
    /// # Errors
    ///
    /// Returns an error if the store cannot persist the event.
    fn accept(&mut self, record: &DurableSlackRelayRecord) -> Result<(), ActiveSlackRelayError>;
}

/// File-backed JSONL durable accept store.
#[derive(Debug)]
pub struct JsonlSlackRelayStore {
    file: File,
}

impl JsonlSlackRelayStore {
    /// Opens a JSONL store at `path`.
    ///
    /// # Errors
    ///
    /// Returns IO errors when the parent directory or file cannot be created.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, ActiveSlackRelayError> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        Ok(Self { file })
    }
}

impl DurableSlackRelayStore for JsonlSlackRelayStore {
    fn accept(&mut self, record: &DurableSlackRelayRecord) -> Result<(), ActiveSlackRelayError> {
        serde_json::to_writer(&mut self.file, record)?;
        self.file.write_all(b"\n")?;
        self.file.sync_data()?;
        Ok(())
    }
}

/// In-memory durable store substitute for tests and embedded callers that
/// provide durability outside this crate.
#[derive(Debug, Default)]
pub struct MemorySlackRelayStore {
    /// Accepted records.
    pub records: Vec<DurableSlackRelayRecord>,
}

impl DurableSlackRelayStore for MemorySlackRelayStore {
    fn accept(&mut self, record: &DurableSlackRelayRecord) -> Result<(), ActiveSlackRelayError> {
        self.records.push(record.clone());
        Ok(())
    }
}

#[derive(Debug, Default)]
struct DurableSlackRelayRecovery {
    committed_dedupe_keys: Vec<String>,
    replay_records: Vec<DurableSlackRelayRecord>,
}

fn recover_durable_relay_log(
    path: &Path,
) -> Result<DurableSlackRelayRecovery, ActiveSlackRelayError> {
    if !path.is_file() {
        return Ok(DurableSlackRelayRecovery::default());
    }
    let file = File::open(path)?;
    let mut committed = HashSet::new();
    let mut in_flight_dispatches: HashMap<String, DurableSlackRelayRecord> = HashMap::new();
    for line in BufReader::new(file).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let record = serde_json::from_str::<DurableSlackRelayRecord>(&line)?;
        match record.action {
            DurableSlackRelayAction::Commit => {
                if let Some(key) = record.dedupe_key {
                    committed.insert(key.clone());
                    in_flight_dispatches.remove(&key);
                }
            }
            DurableSlackRelayAction::Release => {
                if let Some(key) = record.dedupe_key {
                    committed.remove(&key);
                    in_flight_dispatches.remove(&key);
                }
            }
            DurableSlackRelayAction::Dispatch => {
                if let Some(key) = record.dedupe_key.clone() {
                    if record.acp_frame.is_some() && !committed.contains(&key) {
                        in_flight_dispatches.insert(key, record);
                    }
                }
            }
            DurableSlackRelayAction::Claim
            | DurableSlackRelayAction::Drop { .. }
            | DurableSlackRelayAction::Replay
            | DurableSlackRelayAction::Duplicate => {}
        }
    }
    Ok(DurableSlackRelayRecovery {
        committed_dedupe_keys: committed.into_iter().collect(),
        replay_records: in_flight_dispatches.into_values().collect(),
    })
}

/// Logical dispatch dedupe state.
#[derive(Debug, Default)]
pub struct SlackDispatchDedupeState {
    accepted: HashMap<String, Instant>,
    pending: HashMap<String, Instant>,
}

impl SlackDispatchDedupeState {
    /// Checks and reserves one logical dispatch key.
    #[must_use]
    pub fn check_and_reserve(&mut self, key: &str, now: Instant) -> SlackDispatchDedupeDecision {
        self.prune(now);
        if self.accepted.contains_key(key) {
            return SlackDispatchDedupeDecision::DuplicateAccepted;
        }
        if self.pending.contains_key(key) {
            return SlackDispatchDedupeDecision::DuplicatePending;
        }
        trim_oldest(&mut self.accepted);
        trim_oldest(&mut self.pending);
        self.pending.insert(key.to_owned(), now);
        SlackDispatchDedupeDecision::FirstSeen
    }

    /// Commits a pending key as accepted.
    pub fn commit(&mut self, key: &str, now: Instant) {
        self.pending.remove(key);
        trim_oldest(&mut self.accepted);
        self.accepted.insert(key.to_owned(), now);
    }

    /// Releases a pending key so a later delivery can run gates again.
    pub fn release(&mut self, key: &str) {
        self.pending.remove(key);
    }

    /// Loads an accepted key from durable state.
    pub fn load_accepted(&mut self, key: String, now: Instant) {
        trim_oldest(&mut self.accepted);
        self.accepted.insert(key, now);
    }

    fn prune(&mut self, now: Instant) {
        prune_map(&mut self.accepted, now);
        prune_map(&mut self.pending, now);
    }
}

/// Logical dedupe decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackDispatchDedupeDecision {
    /// First sighting; caller owns a pending reservation.
    FirstSeen,
    /// A previous dispatch committed this logical message.
    DuplicateAccepted,
    /// A sibling delivery is currently being processed.
    DuplicatePending,
}

fn prune_map(map: &mut HashMap<String, Instant>, now: Instant) {
    let ttl = Duration::from_millis(SLACK_MESSAGE_DISPATCH_DEDUPE_TTL_MS);
    map.retain(|_, claimed_at| now.duration_since(*claimed_at) <= ttl);
}

fn trim_oldest(map: &mut HashMap<String, Instant>) {
    if map.len() >= SLACK_MESSAGE_DISPATCH_DEDUPE_MEMORY_MAX_ENTRIES {
        if let Some(oldest) = map
            .iter()
            .min_by_key(|(_, claimed_at)| **claimed_at)
            .map(|(key, _)| key.clone())
        {
            map.remove(&oldest);
        }
    }
}

/// Active runtime errors.
#[derive(Debug, Error)]
pub enum ActiveSlackRelayError {
    /// Missing env var.
    #[error("{0} is required when Slack relay is enabled")]
    MissingEnv(&'static str),
    /// Relay error.
    #[error(transparent)]
    Relay(#[from] SlackRelayError),
    /// JSON serialization error.
    #[error("serialize canonical ACP session/prompt frame: {0}")]
    Serialize(#[from] serde_json::Error),
    /// IO/durable-store error.
    #[error("Slack relay durable accept IO error: {0}")]
    Io(#[from] std::io::Error),
    /// Websocket error.
    #[error("Slack relay websocket error: {0}")]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),
    /// ACP client frame receiver closed.
    #[error("ACP client frame transport closed")]
    ClientFrameTransportClosed,
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

/// Runs Slack relay and forwards accepted events as ACP client frames.
///
/// # Errors
///
/// Returns only terminal local transport/configuration errors. Relay disconnects
/// reconnect using the OpenClaw backoff constants.
pub async fn run_slack_relay_to_acp_client_frames(
    config: ActiveSlackRelayConfig,
    client_frames: mpsc::Sender<String>,
) -> Result<(), ActiveSlackRelayError> {
    run_slack_relay_to_acp_client_frames_with_control(config, client_frames, None).await
}

/// Runs Slack relay with an optional shutdown/control receiver.
///
/// # Errors
///
/// Returns terminal local transport/configuration errors.
pub async fn run_slack_relay_to_acp_client_frames_with_control(
    config: ActiveSlackRelayConfig,
    client_frames: mpsc::Sender<String>,
    mut control_rx: Option<mpsc::Receiver<ActiveSlackRelayControl>>,
) -> Result<(), ActiveSlackRelayError> {
    let path = config
        .durable_log_path
        .clone()
        .unwrap_or_else(|| default_durable_log_path(&config));
    let recovery = recover_durable_relay_log(&path)?;
    let mut store = JsonlSlackRelayStore::open(path)?;
    let mut reconnect_attempts = 0_u32;
    let mut state = ActiveSlackRelayState::default();
    state.lifecycle.attach();
    state.lifecycle.start();
    for key in recovery.committed_dedupe_keys {
        state.dedupe.load_accepted(key, Instant::now());
    }
    drain_recovered_dispatches(
        &mut state,
        &mut store,
        &client_frames,
        recovery.replay_records,
    )
    .await?;
    loop {
        match run_one_connection(
            &config,
            &client_frames,
            &mut state,
            &mut store,
            &mut control_rx,
        )
        .await
        {
            Ok(ActiveSlackRelayConnectionExit::Shutdown) => {
                state.lifecycle.stop();
                return Ok(());
            }
            Err(error) => {
                state.lifecycle.stop();
                if control_rx.as_ref().is_some_and(mpsc::Receiver::is_closed) {
                    return Err(error);
                }
                if should_stop_reconnecting_for_error(&error) {
                    return Err(error);
                }
                reconnect_attempts = reconnect_attempts.saturating_add(1);
                let delay = compute_reconnect_backoff_ms(reconnect_attempts);
                tracing_like_stderr(&format!(
                    "slack relay disconnected; reconnecting in {}s reason=\"{error}\"",
                    delay / 1000
                ));
                if sleep_or_shutdown(Duration::from_millis(delay), &mut control_rx).await {
                    return Ok(());
                }
            }
        }
    }
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

    let (facts, mentions) = build_active_admission_inputs(&config.policy, &event, message.as_ref());
    if facts.is_direct_message {
        match authorize_active_direct_message(&facts, &config.policy, &event).await {
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
            dm_policy: if facts.is_direct_message {
                DmPolicy::Open
            } else {
                config.policy.dm_policy
            },
            allow_from_lower: if facts.is_direct_message {
                vec!["*".to_owned()]
            } else {
                config.policy.allow_from_lower.clone()
            },
            require_mention: config.policy.require_mention,
            allow_bots: config.policy.allow_bots,
            has_authorized_control_command: has_authorized_control_command(&facts.text),
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
    next_request_id: i64,
    dedupe: SlackDispatchDedupeState,
    lifecycle: ActiveSlackRelayLifecycle,
}

impl Default for ActiveSlackRelayState {
    fn default() -> Self {
        Self {
            next_request_id: 1,
            dedupe: SlackDispatchDedupeState::default(),
            lifecycle: ActiveSlackRelayLifecycle::default(),
        }
    }
}

impl ActiveSlackRelayState {
    /// Returns the current relay lifecycle snapshot.
    #[must_use]
    pub fn lifecycle(&self) -> ActiveSlackRelayLifecycle {
        self.lifecycle
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActiveSlackRelayConnectionExit {
    Shutdown,
}

fn shutdown_close_code() -> CloseCode {
    if SERVER_SHUTDOWN_CLOSE_CODE == 1001 {
        CloseCode::Away
    } else {
        CloseCode::Library(SERVER_SHUTDOWN_CLOSE_CODE)
    }
}

fn close_error(frame: Option<CloseFrame>) -> ActiveSlackRelayError {
    let (code, reason) = frame.map_or((1006, Vec::new()), |frame| {
        (
            u16::from(frame.code),
            frame.reason.as_str().as_bytes().to_vec(),
        )
    });
    ActiveSlackRelayError::Relay(SlackRelayError::Accept(format_relay_close(code, &reason)))
}

async fn run_one_connection(
    config: &ActiveSlackRelayConfig,
    client_frames: &mpsc::Sender<String>,
    state: &mut ActiveSlackRelayState,
    store: &mut impl DurableSlackRelayStore,
    control_rx: &mut Option<mpsc::Receiver<ActiveSlackRelayControl>>,
) -> Result<ActiveSlackRelayConnectionExit, ActiveSlackRelayError> {
    let url = build_relay_websocket_url(&config.relay)?;
    let options = build_relay_websocket_options(&config.relay.auth_token);
    let mut request = url.into_client_request()?;
    request.headers_mut().insert(
        AUTHORIZATION,
        options
            .authorization
            .parse()
            .map_err(|error| SlackRelayError::Accept(format!("invalid auth header: {error}")))?,
    );
    let ws_config = WebSocketConfig::default()
        .max_message_size(Some(options.max_payload_bytes))
        .max_frame_size(Some(options.max_payload_bytes));
    let (socket, _) = tokio::time::timeout(
        Duration::from_millis(options.handshake_timeout_ms),
        connect_async_with_config(request, Some(ws_config), false),
    )
    .await
    .map_err(|_| {
        SlackRelayError::Accept(format!(
            "Slack relay websocket handshake timed out after {}ms",
            options.handshake_timeout_ms
        ))
    })??;
    let (mut write, mut read) = socket.split();

    loop {
        tokio::select! {
            biased;
            control = recv_control(control_rx), if control_rx.is_some() => {
                if matches!(control, Some(ActiveSlackRelayControl::Shutdown) | None) {
                    let reason = SERVER_SHUTDOWN_REASON.into();
                    write.send(Message::Close(Some(CloseFrame {
                        code: shutdown_close_code(),
                        reason,
                    }))).await?;
                    return Ok(ActiveSlackRelayConnectionExit::Shutdown);
                }
            }
            message = read.next() => {
                let Some(message) = message else {
                    return Err(close_error(None));
                };
                let message = message?;
                let data = match message {
                    Message::Text(text) => text.to_string().into_bytes(),
                    Message::Binary(bytes) => bytes.to_vec(),
                    Message::Ping(bytes) => {
                        write.send(Message::Pong(bytes)).await?;
                        continue;
                    }
                    Message::Close(frame) => return Err(close_error(frame)),
                    Message::Pong(_) | Message::Frame(_) => continue,
                };
                let outcome = handle_active_slack_relay_frame(
                    data,
                    config,
                    state,
                    store,
                    client_frames,
                )
                .await?;
                if let Some(ack) = outcome_ack(&outcome) {
                    write
                        .send(Message::Text(serde_json::to_string(ack)?.into()))
                        .await?;
                }
            }
        }
    }
}

async fn drain_recovered_dispatches(
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

async fn recv_control(
    control_rx: &mut Option<mpsc::Receiver<ActiveSlackRelayControl>>,
) -> Option<ActiveSlackRelayControl> {
    match control_rx {
        Some(rx) => rx.recv().await,
        None => None,
    }
}

async fn sleep_or_shutdown(
    duration: Duration,
    control_rx: &mut Option<mpsc::Receiver<ActiveSlackRelayControl>>,
) -> bool {
    if let Some(rx) = control_rx {
        tokio::select! {
            () = tokio::time::sleep(duration) => false,
            control = rx.recv() => matches!(control, Some(ActiveSlackRelayControl::Shutdown) | None),
        }
    } else {
        tokio::time::sleep(duration).await;
        false
    }
}

fn outcome_ack(outcome: &ActiveSlackRelayFrameOutcome) -> Option<&SlackRelayAckFrame> {
    match outcome {
        ActiveSlackRelayFrameOutcome::Dispatched { ack, .. }
        | ActiveSlackRelayFrameOutcome::Dropped { ack, .. }
        | ActiveSlackRelayFrameOutcome::Duplicate { ack, .. }
        | ActiveSlackRelayFrameOutcome::DuplicatePending { ack, .. } => Some(ack),
        ActiveSlackRelayFrameOutcome::Hello | ActiveSlackRelayFrameOutcome::Ignored => None,
    }
}

fn build_active_dedupe_key(
    account_id: &str,
    event: &crate::relay_source::SlackRelayAcceptedEvent,
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

fn build_active_admission_inputs(
    policy: &ActiveSlackRelayPolicy,
    event: &crate::relay_source::SlackRelayAcceptedEvent,
    message: Option<&SlackMessageForContent>,
) -> (SlackAdmissionFacts, SlackMentionFacts) {
    let channel_id = message
        .map(|message| message.channel.clone())
        .or_else(|| {
            event
                .message
                .get("channel")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default();
    let text = message
        .and_then(|message| message.text.clone())
        .or_else(|| {
            event
                .message
                .get("text")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default();
    let user_id = message
        .and_then(|message| message.user.clone())
        .or_else(|| {
            event
                .message
                .get("user")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        });
    let bot_id = message
        .and_then(|message| message.bot_id.clone())
        .or_else(|| {
            event
                .message
                .get("bot_id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        });
    let is_direct_message = channel_id.starts_with('D');
    let facts = SlackAdmissionFacts {
        channel_id,
        user_id,
        bot_id,
        text: text.clone(),
        is_direct_message,
        is_room: !is_direct_message,
        current_bot_user_id: policy.current_bot_user_id.clone(),
        current_bot_id: policy.current_bot_id.clone(),
    };
    let direct_mention = policy
        .current_bot_user_id
        .as_deref()
        .is_some_and(|bot_user| text_mentions_user(&text, bot_user));
    let subteam_mention = subteam_mentions_policy(&text, &policy.mention_subteam_ids);
    let pattern_mention = pattern_mentions_policy(&text, &policy.mention_patterns);
    let source_app_mention =
        slack_event_source(&event.message) == Some(SlackEventSource::AppMention);
    let was_mentioned = source_app_mention || direct_mention || subteam_mention || pattern_mention;
    let has_any_mention = Regex::new(r"(?i)<@[A-Z0-9]+(?:\|[^>]+)?>|<!subteam\\^[^>]+>")
        .expect("valid mention regex")
        .is_match(&text);
    let implicit_mention = facts.is_direct_message
        || source_app_mention
        || event.route.kind == SlackRelayRouteKind::ThreadAffinity
        || message.is_some_and(|message| {
            message
                .parent_user_id
                .as_deref()
                .is_some_and(|parent| Some(parent) == policy.current_bot_user_id.as_deref())
        });
    let mentions = SlackMentionFacts {
        can_detect_mention: policy.current_bot_user_id.is_some()
            || !policy.mention_subteam_ids.is_empty()
            || !policy.mention_patterns.is_empty(),
        was_mentioned,
        has_any_mention,
        implicit_mention,
    };
    (facts, mentions)
}

#[allow(clippy::too_many_lines)]
async fn build_active_prompt_text(
    policy: &ActiveSlackRelayPolicy,
    event: &crate::relay_source::SlackRelayAcceptedEvent,
    message: Option<&SlackMessageForContent>,
) -> (String, Option<String>) {
    let is_thread_reply = message.is_some_and(|message| {
        match (message.thread_ts.as_deref(), message.ts.as_deref()) {
            (Some(thread_ts), Some(ts)) => thread_ts != ts || message.parent_user_id.is_some(),
            (Some(_), None) => true,
            _ => false,
        }
    });
    let thread_starter_files = extract_thread_starter_files(&event.payload);
    let hydrated_starter_media = hydrate_active_thread_starter_media(policy, &thread_starter_files)
        .await
        .unwrap_or_default();
    let body = message.and_then(|message| {
        resolve_slack_message_content(
            message,
            is_thread_reply,
            &thread_starter_files,
            &HashMap::new(),
        )
    });
    let mut parts = Vec::new();
    if !hydrated_starter_media.is_empty() {
        parts.push(
            hydrated_starter_media
                .iter()
                .map(|media| {
                    let mut line = media.placeholder.clone();
                    if let Some(url) = media.url.as_deref() {
                        let _ = write!(line, " {url}");
                    }
                    line
                })
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }
    let mut history = extract_thread_history(&event.payload);
    if history.is_none() && is_thread_reply && policy.thread_initial_history_limit > 0 {
        if let (Some(api_base), Some(message)) = (policy.relay_api_base_url.as_deref(), message) {
            if let Some(thread_ts) = message.thread_ts.as_deref() {
                let client = reqwest::Client::new();
                let relay_api_key = std::env::var(HYPER_AGENTS_API_KEY_ENV)
                    .ok()
                    .map(|value| value.trim().to_owned())
                    .filter(|value| !value.is_empty());
                if let Some(relay_api_key) = relay_api_key {
                    if let Ok(resolution) = fetch_slack_thread_history_via_relay(
                        &client,
                        api_base,
                        &relay_api_key,
                        &message.channel,
                        thread_ts,
                        message.ts.as_deref(),
                        policy.thread_initial_history_limit,
                    )
                    .await
                    {
                        history = Some(resolution.messages);
                    }
                }
            }
        }
    }
    if let Some(history) = history {
        let should_seed = should_seed_initial_thread_context(
            is_thread_reply,
            message.and_then(|message| message.thread_ts.as_deref()),
            Some(SlackSessionFreshness::Missing),
            None,
        );
        if should_seed {
            let filtered = filter_slack_thread_history_for_visibility(
                &history,
                policy.context_visibility,
                &policy.allow_from_lower,
                policy.allow_name_matching,
                policy.current_bot_user_id.as_deref(),
                policy.current_bot_id.as_deref(),
            );
            if let Some(history_body) = format_slack_thread_history_body(
                &filtered.kept,
                message.map_or("", |message| message.channel.as_str()),
                policy.current_bot_user_id.as_deref(),
                policy.current_bot_id.as_deref(),
            ) {
                parts.push(history_body);
            }
        }
    }
    parts.push(body.map_or_else(
        || {
            event
                .message
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_owned()
        },
        |content| content.body_with_metadata,
    ));
    let prompt = parts
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let reply_thread_ts = message.and_then(|message| {
        resolve_delivered_slack_reply_thread_ts(
            effective_reply_to_mode(policy, message.channel.starts_with('D')),
            event.message.get("reply_to").and_then(Value::as_str),
            message.thread_ts.as_deref().or(message.ts.as_deref()),
        )
    });
    (prompt, reply_thread_ts)
}

async fn hydrate_active_thread_starter_media(
    policy: &ActiveSlackRelayPolicy,
    files: &[SlackFile],
) -> Option<Vec<crate::history::SlackHydratedMedia>> {
    if files.is_empty() {
        return None;
    }
    let api_base = policy.relay_api_base_url.as_deref()?;
    let relay_api_key = std::env::var(HYPER_AGENTS_API_KEY_ENV)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())?;
    let sender = SlackRelayHttpSender::new();
    let mut responses = Vec::new();
    for request in build_files_info_proxy_requests(api_base, &relay_api_key, files) {
        if let Ok(result) = sender.send(&request).await {
            responses.push(result.response);
        }
    }
    Some(hydrate_slack_thread_starter_media(
        files,
        &responses,
        Some(policy.media_max_bytes),
    ))
}

fn build_slack_meta(
    event: &crate::relay_source::SlackRelayAcceptedEvent,
    dedupe_key: Option<&str>,
    drop_reason: Option<&'static str>,
    reply_thread_ts: Option<&str>,
) -> Value {
    json!({
        "delivery_id": event.delivery_id,
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

fn extract_thread_history(payload: &Value) -> Option<Vec<SlackThreadHistoryMessage>> {
    let raw = payload
        .get("thread_history")
        .or_else(|| payload.get("threadHistory"))?
        .as_array()?;
    let messages = raw
        .iter()
        .filter_map(|value| {
            Some(SlackThreadHistoryMessage {
                text: value
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(ToOwned::to_owned)
                    .or_else(|| {
                        let files = value.get("files").and_then(Value::as_array)?;
                        (!files.is_empty()).then(|| {
                            format!(
                                "[attached: {}]",
                                crate::content::format_slack_file_reference_list(
                                    &parse_slack_files(files)
                                )
                            )
                        })
                    })?,
                ts: value
                    .get("ts")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                user_id: value
                    .get("user")
                    .or_else(|| value.get("user_id"))
                    .or_else(|| value.get("userId"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                bot_id: value
                    .get("bot_id")
                    .or_else(|| value.get("botId"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                sender_name: value
                    .get("sender_name")
                    .or_else(|| value.get("senderName"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                files: value
                    .get("files")
                    .and_then(Value::as_array)
                    .map(|files| parse_slack_files(files))
                    .unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
    (!messages.is_empty()).then_some(messages)
}

fn extract_thread_starter_files(payload: &Value) -> Vec<SlackFile> {
    payload
        .get("thread_starter")
        .or_else(|| payload.get("threadStarter"))
        .and_then(|starter| starter.get("files"))
        .and_then(Value::as_array)
        .map(|files| parse_slack_files(files))
        .unwrap_or_default()
}

fn parse_slack_files(files: &[Value]) -> Vec<SlackFile> {
    files
        .iter()
        .map(|file| SlackFile {
            id: file
                .get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            name: file
                .get("name")
                .or_else(|| file.get("title"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
        })
        .collect()
}

fn channel_allowed(policy: &ActiveSlackRelayPolicy, channel_id: &str) -> bool {
    policy
        .allowed_channel_ids
        .iter()
        .any(|allowed| allowed == "*" || allowed.eq_ignore_ascii_case(channel_id))
}

fn channel_disabled(policy: &ActiveSlackRelayPolicy, channel_id: &str) -> bool {
    policy
        .disabled_channel_ids
        .iter()
        .any(|denied| denied.eq_ignore_ascii_case(channel_id))
}

fn effective_reply_to_mode(
    policy: &ActiveSlackRelayPolicy,
    is_direct_message: bool,
) -> SlackReplyToMode {
    if is_direct_message {
        policy.direct_reply_to_mode
    } else {
        policy.reply_to_mode
    }
}

fn subteam_mentions_policy(text: &str, mention_subteam_ids: &[String]) -> bool {
    if mention_subteam_ids.is_empty() {
        return false;
    }
    let mentioned =
        Regex::new(r"(?i)<!subteam\^([^>|]+)(?:\|[^>]+)?>").expect("valid subteam mention regex");
    let matches = mentioned.captures_iter(text).any(|captures| {
        captures.get(1).is_some_and(|id| {
            mention_subteam_ids
                .iter()
                .any(|configured| configured.eq_ignore_ascii_case(id.as_str()))
        })
    });
    matches
}

fn pattern_mentions_policy(text: &str, mention_patterns: &[String]) -> bool {
    mention_patterns
        .iter()
        .filter_map(|pattern| Regex::new(pattern).ok())
        .any(|pattern| pattern.is_match(text))
}

fn resolve_active_bot_loop_meta(
    policy: &ActiveSlackRelayPolicy,
    facts: &SlackAdmissionFacts,
    message: Option<&SlackMessageForContent>,
) -> Option<Value> {
    let now_ms = message
        .and_then(|message| message.ts.as_deref())
        .and_then(slack_ts_to_millis);
    resolve_slack_bot_loop_protection(&policy.account_id, facts, now_ms).map(|facts| {
        json!({
            "scope_id": facts.scope_id,
            "conversation_id": facts.conversation_id,
            "sender_id": facts.sender_id,
            "receiver_id": facts.receiver_id,
            "now_ms": facts.now_ms,
        })
    })
}

fn slack_ts_to_millis(ts: &str) -> Option<u64> {
    let (seconds, fraction) = ts.split_once('.').unwrap_or((ts, ""));
    let seconds = seconds.parse::<u64>().ok()?;
    let micros = fraction
        .chars()
        .take(6)
        .collect::<String>()
        .parse::<u64>()
        .unwrap_or(0);
    Some(seconds.saturating_mul(1000) + micros / 1000)
}

fn has_authorized_control_command(text: &str) -> bool {
    let stripped = text.trim();
    matches!(stripped, "/stop" | "/cancel" | "stop" | "cancel")
}

async fn authorize_active_direct_message(
    facts: &SlackAdmissionFacts,
    policy: &ActiveSlackRelayPolicy,
    event: &crate::relay_source::SlackRelayAcceptedEvent,
) -> SlackDirectMessageAuthorization {
    let sender_id = facts
        .user_id
        .as_deref()
        .or(facts.bot_id.as_deref())
        .unwrap_or_default()
        .to_owned();
    let sender_name = resolve_active_dm_sender_name(policy, event, &sender_id).await;
    authorize_slack_direct_message(&crate::dm::SlackDirectMessageAuthorizationInput {
        account_id: policy.account_id.clone(),
        sender_id,
        allow_from_lower: policy.allow_from_lower.clone(),
        sender_name,
        allow_name_matching: policy.allow_name_matching,
        dm_policy: policy.dm_policy,
        dm_enabled: true,
    })
}

async fn resolve_active_dm_sender_name(
    policy: &ActiveSlackRelayPolicy,
    event: &crate::relay_source::SlackRelayAcceptedEvent,
    sender_id: &str,
) -> Option<String> {
    if let Some(name) = resolve_slack_sender_name_from_message(&event.message)
        .or_else(|| resolve_slack_sender_name_from_message(&event.payload))
    {
        return Some(name);
    }
    async_slack_user_name_from_relay(policy, sender_id).await
}

async fn async_slack_user_name_from_relay(
    policy: &ActiveSlackRelayPolicy,
    sender_id: &str,
) -> Option<String> {
    if sender_id.trim().is_empty() {
        return None;
    }
    let api_base = policy.relay_api_base_url.as_deref()?;
    let key = std::env::var(crate::relay_source::HYPER_AGENTS_API_KEY_ENV)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())?;
    let request = build_users_info_proxy_request(api_base, &key, sender_id);
    let response = reqwest::Client::new()
        .post(&request.url)
        .header(reqwest::header::AUTHORIZATION, request.authorization)
        .json(&request.body)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    resolve_slack_user_name_from_info(&response)
}

fn resolve_slack_sender_name_from_message(value: &Value) -> Option<String> {
    value
        .get("sender_name")
        .or_else(|| value.get("senderName"))
        .or_else(|| value.get("username"))
        .or_else(|| value.get("name"))
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .get("user_profile")
                .or_else(|| value.get("userProfile"))
                .or_else(|| value.get("profile"))
                .and_then(|profile| {
                    profile
                        .get("display_name")
                        .or_else(|| profile.get("real_name"))
                        .or_else(|| profile.get("name"))
                        .and_then(Value::as_str)
                })
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

async fn maybe_send_pairing_challenge(
    policy: &ActiveSlackRelayPolicy,
    channel_id: &str,
    text: &str,
) {
    let Some(api_base) = policy.relay_api_base_url.as_deref() else {
        return;
    };
    let Ok(key) = std::env::var(crate::relay_source::HYPER_AGENTS_API_KEY_ENV) else {
        return;
    };
    let sender = SlackRelayHttpSender::new();
    let _result = deliver_slack_reply_payloads(
        &sender,
        SlackReplyDeliveryTarget {
            relay_api_base_url: api_base,
            hyper_agents_api_key: key.trim(),
            channel: channel_id,
            reply_thread_ts: None,
            reply_to_mode: SlackReplyToMode::Off,
            text_limit: crate::reply::SLACK_TEXT_LIMIT,
        },
        &[SlackReplyPayload {
            text: Some(text.to_owned()),
            media_urls: Vec::new(),
            blocks: Vec::new(),
            is_reasoning: false,
            reply_to_id: None,
            delivery_queue_id: None,
        }],
    )
    .await;
}

fn drop_active_message(
    store: &mut impl DurableSlackRelayStore,
    dedupe: &mut SlackDispatchDedupeState,
    event: &crate::relay_source::SlackRelayAcceptedEvent,
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

fn text_mentions_user(text: &str, user_id: &str) -> bool {
    let escaped = regex::escape(user_id);
    Regex::new(&format!(r"(?i)<@{escaped}(?:\|[^>]+)?>"))
        .expect("valid dynamic mention regex")
        .is_match(text)
}

fn env_var(name: &'static str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn required_env(name: &'static str) -> Result<String, ActiveSlackRelayError> {
    env_var(name).ok_or(ActiveSlackRelayError::MissingEnv(name))
}

fn csv_env(name: &'static str) -> Vec<String> {
    env_var(name)
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn bool_env(name: &'static str, default: bool) -> bool {
    env_var(name).map_or(default, |value| {
        matches!(
            value.to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

fn parse_group_policy(value: Option<&str>) -> GroupPolicy {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("disabled") => GroupPolicy::Disabled,
        Some("allowlist") => GroupPolicy::Allowlist,
        _ => GroupPolicy::Open,
    }
}

fn parse_dm_policy(value: Option<&str>) -> DmPolicy {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("disabled") => DmPolicy::Disabled,
        Some("allowlist") => DmPolicy::Allowlist,
        Some("pairing") => DmPolicy::Pairing,
        _ => DmPolicy::Open,
    }
}

fn parse_allow_bots(value: Option<&str>) -> AllowBotsMode {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("all" | "true" | "1" | "yes" | "on") => AllowBotsMode::All,
        Some("mentions") => AllowBotsMode::Mentions,
        _ => AllowBotsMode::Off,
    }
}

fn parse_reply_mode(value: Option<&str>) -> SlackReplyToMode {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("off") => SlackReplyToMode::Off,
        Some("first") => SlackReplyToMode::First,
        Some("batched") => SlackReplyToMode::Batched,
        _ => SlackReplyToMode::All,
    }
}

fn reply_mode_wire(mode: SlackReplyToMode) -> &'static str {
    match mode {
        SlackReplyToMode::Off => "off",
        SlackReplyToMode::First => "first",
        SlackReplyToMode::All => "all",
        SlackReplyToMode::Batched => "batched",
    }
}

fn parse_context_visibility(value: Option<&str>) -> SlackContextVisibility {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("allowlist") => SlackContextVisibility::Allowlist,
        Some("allowlist_quote") => SlackContextVisibility::AllowlistQuote,
        _ => SlackContextVisibility::All,
    }
}

fn derive_relay_api_base_url(raw: &str) -> Option<String> {
    let mut url = url::Url::parse(raw).ok()?;
    match url.scheme() {
        "ws" => url.set_scheme("http").ok()?,
        "wss" => url.set_scheme("https").ok()?,
        "http" | "https" => {}
        _ => return None,
    }
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    Some(url.to_string().trim_end_matches('/').to_owned())
}

fn default_durable_log_path(config: &ActiveSlackRelayConfig) -> PathBuf {
    std::env::temp_dir()
        .join("hyper-acp-slack-relay")
        .join(format!(
            "{}-{}.jsonl",
            sanitize_path_component(&config.relay.gateway_id),
            sanitize_path_component(&config.session_id)
        ))
}

fn sanitize_path_component(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "default".to_owned()
    } else {
        sanitized
    }
}

fn tracing_like_stderr(message: &str) {
    eprintln!("{message}");
}

fn should_stop_reconnecting_for_error(error: &ActiveSlackRelayError) -> bool {
    is_non_recoverable_slack_auth_error(&error.to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::event::normalize_slack_event;
    use crate::relay_source::{SlackRelayRoute, SlackRelayRouteKind};
    use serde_json::Value;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::mpsc;

    use super::*;

    fn config(policy: ActiveSlackRelayPolicy) -> ActiveSlackRelayConfig {
        ActiveSlackRelayConfig {
            relay: SlackRelaySourceConfig {
                url: "ws://127.0.0.1/slack".to_owned(),
                auth_token: "secret".to_owned(),
                gateway_id: "agent:abc".to_owned(),
            },
            session_id: "sess".to_owned(),
            policy,
            durable_log_path: None,
        }
    }

    fn relay_frame(event: &Value) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "type": "slack_event",
            "delivery_id": "d1",
            "route": {"kind": "channel_default", "key": "agent:abc"},
            "payload": {
                "team_id": "T1",
                "event": event,
            },
        }))
        .unwrap()
    }

    fn accepted_from_raw_slack_event(
        delivery_id: &str,
        event: &Value,
    ) -> crate::relay_source::SlackRelayAcceptedEvent {
        let normalized = normalize_slack_event(event, Some("T1")).unwrap();
        crate::relay_source::SlackRelayAcceptedEvent {
            delivery_id: delivery_id.to_owned(),
            team_id: normalized.team_id,
            message: normalized.message,
            payload: json!({"team_id":"T1","event":event}),
            route: SlackRelayRoute {
                kind: SlackRelayRouteKind::ChannelDefault,
                key: "agent:abc".to_owned(),
            },
        }
    }

    fn threaded_relay_frame(event: &Value, history: &Value) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "type": "slack_event",
            "delivery_id": "d2",
            "route": {"kind": "thread_affinity", "key": "agent:abc"},
            "payload": {
                "team_id": "T1",
                "event": event,
                "thread_history": history,
                "thread_starter": {"files": [{"id": "F0", "name": "root.txt"}]},
            },
        }))
        .unwrap()
    }

    #[test]
    fn durable_log_rehydrates_only_committed_unreleased_dedupe_keys() {
        let path = std::env::temp_dir().join(format!(
            "hyper-acp-slack-dedupe-{}.jsonl",
            std::process::id()
        ));
        let committed = r#"["message","acct","T1","C1","100.100"]"#;
        let released = r#"["message","acct","T1","C1","101.100"]"#;
        let uncommitted = r#"["message","acct","T1","C1","102.100"]"#;
        let duplicate = r#"["message","acct","T1","C1","103.100"]"#;
        let lines = [
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d1".to_owned(),
                dedupe_key: Some(committed.to_owned()),
                action: DurableSlackRelayAction::Claim,
                slack_meta: json!({}),
                acp_frame: None,
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d1".to_owned(),
                dedupe_key: Some(committed.to_owned()),
                action: DurableSlackRelayAction::Commit,
                slack_meta: json!({}),
                acp_frame: None,
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d2".to_owned(),
                dedupe_key: Some(released.to_owned()),
                action: DurableSlackRelayAction::Commit,
                slack_meta: json!({}),
                acp_frame: None,
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d2".to_owned(),
                dedupe_key: Some(released.to_owned()),
                action: DurableSlackRelayAction::Release,
                slack_meta: json!({}),
                acp_frame: None,
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d3".to_owned(),
                dedupe_key: Some(uncommitted.to_owned()),
                action: DurableSlackRelayAction::Dispatch,
                slack_meta: json!({}),
                acp_frame: Some("{}".to_owned()),
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d4".to_owned(),
                dedupe_key: Some(duplicate.to_owned()),
                action: DurableSlackRelayAction::Duplicate,
                slack_meta: json!({}),
                acp_frame: None,
            })
            .unwrap(),
        ];
        fs::write(&path, format!("{}\n", lines.join("\n"))).unwrap();

        let loaded = recover_durable_relay_log(&path).unwrap();
        fs::remove_file(&path).unwrap();

        assert_eq!(loaded.committed_dedupe_keys, vec![committed.to_owned()]);
        assert_eq!(loaded.replay_records.len(), 1);
        assert_eq!(
            loaded.replay_records[0].dedupe_key.as_deref(),
            Some(uncommitted)
        );
    }

    #[test]
    fn builds_canonical_session_prompt_not_turn_submit() {
        let frame = build_slack_session_prompt_frame(
            7,
            "sess",
            "hello",
            json!({"delivery_id": "d1", "route": {"kind": "channel_default", "key": "agent:abc"}}),
        )
        .unwrap();
        let value: Value = serde_json::from_str(&frame).unwrap();
        assert_eq!(value["jsonrpc"], "2.0");
        assert_eq!(value["method"], "session/prompt");
        assert_ne!(value["method"], "turn.submit");
        assert_eq!(value["params"]["sessionId"], "sess");
        assert_eq!(value["params"]["prompt"][0]["text"], "hello");
        assert_eq!(
            value["params"]["_meta"]["hypercli.slack"]["delivery_id"],
            "d1"
        );
    }

    #[tokio::test]
    async fn active_loop_dispatches_after_durable_accept_with_metadata() {
        let policy = ActiveSlackRelayPolicy {
            account_id: "acct".to_owned(),
            current_bot_user_id: Some("UBOT".to_owned()),
            require_mention: true,
            ..ActiveSlackRelayPolicy::default()
        };
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_active_slack_relay_frame(
            relay_frame(&json!({
                "type": "message",
                "channel": "C1",
                "team": "T1",
                "user": "U1",
                "text": "<@UBOT> ship this",
                "ts": "100.100",
                "files": [{"id": "F1", "name": "brief.md"}],
            })),
            &config(policy),
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
        assert_eq!(store.records.len(), 3);
        assert_eq!(store.records[0].action, DurableSlackRelayAction::Claim);
        assert_eq!(store.records[1].action, DurableSlackRelayAction::Dispatch);
        assert_eq!(store.records[2].action, DurableSlackRelayAction::Commit);
        assert!(store.records[1].acp_frame.is_some());
        let sent = rx.recv().await.unwrap();
        assert_eq!(store.records[1].acp_frame.as_deref(), Some(sent.as_str()));
        let value: Value = serde_json::from_str(&sent).unwrap();
        assert_eq!(value["method"], "session/prompt");
        assert!(value["params"]["prompt"][0]["text"]
            .as_str()
            .unwrap()
            .contains("[Slack file: brief.md (fileId: F1)]"));
        assert_eq!(
            value["params"]["_meta"]["hypercli.slack"]["dedupe_key"],
            r#"["message","acct","T1","C1","100.100"]"#
        );
    }

    #[tokio::test]
    async fn active_loop_accepts_non_dm_app_mention_as_explicit_mention() {
        let policy = ActiveSlackRelayPolicy {
            account_id: "acct".to_owned(),
            current_bot_user_id: Some("UBOT".to_owned()),
            require_mention: true,
            ..ActiveSlackRelayPolicy::default()
        };
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_active_slack_relay_frame(
            relay_frame(&json!({
                "type": "app_mention",
                "channel": "C1",
                "channel_type": "channel",
                "team": "T1",
                "user": "U1",
                "text": "ship this",
                "ts": "100.101",
            })),
            &config(policy),
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
        let sent = rx.recv().await.unwrap();
        let value: Value = serde_json::from_str(&sent).unwrap();
        assert_eq!(value["method"], "session/prompt");
        assert!(value["params"]["prompt"][0]["text"]
            .as_str()
            .unwrap()
            .contains("ship this"));
    }

    #[tokio::test]
    async fn raw_slack_message_and_app_mention_share_active_core_path() {
        let policy = ActiveSlackRelayPolicy {
            current_bot_user_id: Some("UBOT".to_owned()),
            require_mention: true,
            ..ActiveSlackRelayPolicy::default()
        };
        for (delivery_id, event) in [
            (
                "raw-message",
                json!({
                    "type": "message",
                    "channel": "C1",
                    "user": "U1",
                    "text": "<@UBOT> from message",
                    "ts": "110.001",
                }),
            ),
            (
                "raw-app-mention",
                json!({
                    "type": "app_mention",
                    "channel": "C1",
                    "channel_type": "channel",
                    "user": "U1",
                    "text": "from app mention",
                    "ts": "110.002",
                }),
            ),
        ] {
            let event = accepted_from_raw_slack_event(delivery_id, &event);
            let message = slack_message_for_content_from_value(&event.message);
            let (facts, mentions) =
                build_active_admission_inputs(&policy, &event, message.as_ref());
            let admission = decide_slack_admission(
                &facts,
                &SlackAdmissionPolicy {
                    group_policy: policy.group_policy,
                    channel_allowlist_configured: false,
                    channel_allowed: false,
                    channel_explicitly_disabled: false,
                    dm_policy: policy.dm_policy,
                    allow_from_lower: policy.allow_from_lower.clone(),
                    require_mention: policy.require_mention,
                    allow_bots: policy.allow_bots,
                    has_authorized_control_command: false,
                    ignore_other_mentions: policy.ignore_other_mentions,
                },
                &mentions,
            );
            assert_eq!(admission, SlackAdmissionDecision::Accept);
            let (prompt, _) = build_active_prompt_text(&policy, &event, message.as_ref()).await;
            assert!(prompt.contains("from "));
        }
    }

    #[tokio::test]
    async fn active_loop_hydrates_thread_starter_media_via_relay() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = vec![0_u8; 4096];
            let read = socket.read(&mut buffer).await.unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]);
            assert!(request.contains("POST /slack/api/files.info HTTP/1.1"));
            assert!(request.to_ascii_lowercase().contains("authorization:"));
            assert!(request.contains("Bearer key"));
            let body = r#"{"ok":true,"file":{"id":"F0","name":"root.png","url_private_download":"https://files.example/root.png","size":1024}}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        std::env::set_var(HYPER_AGENTS_API_KEY_ENV, "key");
        let policy = ActiveSlackRelayPolicy {
            relay_api_base_url: Some(format!("http://{addr}")),
            media_max_bytes: 2048,
            ..ActiveSlackRelayPolicy::default()
        };
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        handle_active_slack_relay_frame(
            threaded_relay_frame(
                &json!({
                    "type": "message",
                    "channel": "C1",
                    "user": "U1",
                    "text": "latest",
                    "ts": "104.001",
                    "thread_ts": "100.000",
                    "parent_user_id": "UBOT",
                }),
                &json!([]),
            ),
            &config(policy),
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        let sent = rx.recv().await.unwrap();
        server.await.unwrap();
        let value: Value = serde_json::from_str(&sent).unwrap();
        let text = value["params"]["prompt"][0]["text"].as_str().unwrap();
        assert!(
            text.contains("[Slack file: root.png (fileId: F0)]"),
            "{text}"
        );
        assert!(text.contains("https://files.example/root.png"), "{text}");
        std::env::remove_var(HYPER_AGENTS_API_KEY_ENV);
    }

    #[tokio::test]
    async fn active_loop_acks_dropped_dm_after_durable_record() {
        let policy = ActiveSlackRelayPolicy {
            dm_policy: DmPolicy::Allowlist,
            allow_from_lower: vec!["u2".to_owned()],
            ..ActiveSlackRelayPolicy::default()
        };
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_active_slack_relay_frame(
            relay_frame(&json!({
                "type": "message",
                "channel": "D1",
                "user": "U1",
                "text": "secret",
                "ts": "101.100",
            })),
            &config(policy),
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        assert_eq!(
            outcome,
            ActiveSlackRelayFrameOutcome::Dropped {
                ack: build_relay_ack("d1"),
                reason: "dm-unauthorized",
                dedupe_key: Some(r#"["message","default","T1","D1","101.100"]"#.to_owned()),
            }
        );
        assert_eq!(store.records[0].action, DurableSlackRelayAction::Claim);
        assert_eq!(
            store.records[1].action,
            DurableSlackRelayAction::Drop {
                reason: "dm-unauthorized".to_owned()
            }
        );
        assert_eq!(store.records[2].action, DurableSlackRelayAction::Release);
        assert!(rx.try_recv().is_err());

        let retry = handle_active_slack_relay_frame(
            relay_frame(&json!({
                "type": "message",
                "channel": "D1",
                "user": "U1",
                "text": "secret",
                "ts": "101.100",
            })),
            &config(ActiveSlackRelayPolicy {
                dm_policy: DmPolicy::Open,
                allow_from_lower: vec!["*".to_owned()],
                ..ActiveSlackRelayPolicy::default()
            }),
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        assert!(matches!(
            retry,
            ActiveSlackRelayFrameOutcome::Dispatched { .. }
        ));
        assert!(rx.recv().await.is_some());
    }

    #[tokio::test]
    async fn default_open_dm_dispatches_and_uses_direct_reply_off() {
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_active_slack_relay_frame(
            relay_frame(&json!({
                "type": "message",
                "channel": "D1",
                "user": "U1",
                "text": "dm ping",
                "ts": "101.200",
                "thread_ts": "101.000",
            })),
            &config(ActiveSlackRelayPolicy::default()),
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
        let sent = rx.recv().await.unwrap();
        let value: Value = serde_json::from_str(&sent).unwrap();
        assert_eq!(
            value["params"]["_meta"]["hypercli.slack"]["reply_to_mode"],
            "off"
        );
        assert_eq!(
            value["params"]["_meta"]["hypercli.slack"]["reply_thread_ts"],
            "101.000"
        );
    }

    #[tokio::test]
    async fn open_policy_honors_disabled_channel_and_acks_drop() {
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_active_slack_relay_frame(
            relay_frame(&json!({
                "type": "message",
                "channel": "C1",
                "user": "U1",
                "text": "room ping",
                "ts": "101.300",
            })),
            &config(ActiveSlackRelayPolicy {
                disabled_channel_ids: vec!["C1".to_owned()],
                ..ActiveSlackRelayPolicy::default()
            }),
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        assert_eq!(
            outcome,
            ActiveSlackRelayFrameOutcome::Dropped {
                ack: build_relay_ack("d1"),
                reason: "channel-not-allowed",
                dedupe_key: Some(r#"["message","default","T1","C1","101.300"]"#.to_owned()),
            }
        );
        assert_eq!(
            store.records[1].action,
            DurableSlackRelayAction::Drop {
                reason: "channel-not-allowed".to_owned()
            }
        );
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn active_loop_dedupes_logical_slack_twins() {
        let (tx, mut rx) = mpsc::channel(2);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let config = config(ActiveSlackRelayPolicy {
            account_id: "acct".to_owned(),
            ..ActiveSlackRelayPolicy::default()
        });
        let event = json!({
            "type": "message",
            "channel": "C1",
            "user": "U1",
            "text": "hi",
            "ts": "102.100",
        });
        let first = handle_active_slack_relay_frame(
            relay_frame(&event),
            &config,
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        let second = handle_active_slack_relay_frame(
            relay_frame(&event),
            &config,
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        assert!(matches!(
            first,
            ActiveSlackRelayFrameOutcome::Dispatched { .. }
        ));
        assert!(matches!(
            second,
            ActiveSlackRelayFrameOutcome::Duplicate { .. }
        ));
        assert!(rx.recv().await.is_some());
        assert!(rx.try_recv().is_err());
        assert_eq!(store.records.len(), 4);
        assert_eq!(store.records[0].action, DurableSlackRelayAction::Claim);
        assert_eq!(store.records[1].action, DurableSlackRelayAction::Dispatch);
        assert_eq!(store.records[2].action, DurableSlackRelayAction::Commit);
        assert_eq!(store.records[3].action, DurableSlackRelayAction::Duplicate);
    }

    #[tokio::test]
    async fn duplicate_pending_is_acked_for_non_redelivering_hyperclaw_relay() {
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let pending = r#"["message","acct","T1","C1","102.200"]"#;
        assert_eq!(
            state.dedupe.check_and_reserve(pending, Instant::now()),
            SlackDispatchDedupeDecision::FirstSeen
        );
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_active_slack_relay_frame(
            relay_frame(&json!({
                "type": "message",
                "channel": "C1",
                "user": "U1",
                "text": "hi",
                "ts": "102.200",
            })),
            &config(ActiveSlackRelayPolicy {
                account_id: "acct".to_owned(),
                ..ActiveSlackRelayPolicy::default()
            }),
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        assert_eq!(
            outcome,
            ActiveSlackRelayFrameOutcome::DuplicatePending {
                ack: build_relay_ack("d1"),
                dedupe_key: pending.to_owned(),
            }
        );
        assert_eq!(outcome_ack(&outcome), Some(&build_relay_ack("d1")));
        assert!(rx.try_recv().is_err());
        assert!(store.records.is_empty());
    }

    #[tokio::test]
    async fn subteam_and_custom_mentions_satisfy_required_mention() {
        for (text, policy) in [
            (
                "<!subteam^S0AGENTS|agents> triage",
                ActiveSlackRelayPolicy {
                    require_mention: true,
                    mention_subteam_ids: vec!["S0AGENTS".to_owned()],
                    ..ActiveSlackRelayPolicy::default()
                },
            ),
            (
                "bill triage",
                ActiveSlackRelayPolicy {
                    require_mention: true,
                    mention_patterns: vec![r"\bbill\b".to_owned()],
                    ..ActiveSlackRelayPolicy::default()
                },
            ),
        ] {
            let (tx, mut rx) = mpsc::channel(1);
            let mut state = ActiveSlackRelayState::default();
            let mut store = MemorySlackRelayStore::default();
            let outcome = handle_active_slack_relay_frame(
                relay_frame(&json!({
                    "type": "message",
                    "channel": "C1",
                    "user": "U1",
                    "text": text,
                    "ts": format!("103.{}", store.records.len()),
                })),
                &config(policy),
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
        }
    }

    #[tokio::test]
    async fn active_loop_unrolls_thread_history_and_reply_metadata() {
        let policy = ActiveSlackRelayPolicy {
            current_bot_id: Some("B1".to_owned()),
            current_bot_user_id: Some("UBOT".to_owned()),
            reply_to_mode: SlackReplyToMode::All,
            ..ActiveSlackRelayPolicy::default()
        };
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_active_slack_relay_frame(
            threaded_relay_frame(
                &json!({
                    "type": "message",
                    "channel": "C1",
                    "user": "U1",
                    "text": "latest",
                    "ts": "104.000",
                    "thread_ts": "100.000",
                    "parent_user_id": "UBOT",
                    "files": [{"id": "F0", "name": "root.txt"}, {"id": "F2", "name": "delta.txt"}],
                }),
                &json!([
                    {"ts": "100.000", "bot_id": "B1", "files": [{"id": "FH", "name": "history.pdf"}]},
                    {"text": "prior user", "ts": "101.000", "user": "U1", "sender_name": "Ada"}
                ]),
            ),
            &config(policy),
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
        let sent = rx.recv().await.unwrap();
        let value: Value = serde_json::from_str(&sent).unwrap();
        let text = value["params"]["prompt"][0]["text"].as_str().unwrap();
        assert!(text.contains("[attached: history.pdf (fileId: FH)]"));
        assert!(text.contains("Ada (user)"));
        assert!(text.contains("[Slack file: delta.txt (fileId: F2)]"));
        assert!(!text.contains("root.txt (fileId: F0)"));
        assert_eq!(
            value["params"]["_meta"]["hypercli.slack"]["reply_thread_ts"],
            "100.000"
        );
    }

    #[tokio::test]
    async fn durable_accept_failure_blocks_ack_and_dispatch() {
        #[derive(Debug)]
        struct FailingStore;

        impl DurableSlackRelayStore for FailingStore {
            fn accept(
                &mut self,
                _record: &DurableSlackRelayRecord,
            ) -> Result<(), ActiveSlackRelayError> {
                Err(ActiveSlackRelayError::Relay(SlackRelayError::Accept(
                    "boom".to_owned(),
                )))
            }
        }

        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let error = handle_active_slack_relay_frame(
            relay_frame(&json!({
                "type": "message",
                "channel": "C1",
                "user": "U1",
                "text": "hi",
                "ts": "105.000",
            })),
            &config(ActiveSlackRelayPolicy::default()),
            &mut state,
            &mut FailingStore,
            &tx,
        )
        .await
        .unwrap_err();
        assert!(matches!(
            error,
            ActiveSlackRelayError::Relay(SlackRelayError::Accept(_))
        ));
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn lifecycle_attaches_starts_and_returns_to_idle_after_dispatch_and_replay() {
        let (tx, mut rx) = mpsc::channel(2);
        let mut state = ActiveSlackRelayState::default();
        state.lifecycle.attach();
        state.lifecycle.start();
        assert!(state.lifecycle().is_attached());
        assert!(state.lifecycle().is_running());
        assert!(state.lifecycle().is_idle());

        let mut store = MemorySlackRelayStore::default();
        handle_active_slack_relay_frame(
            relay_frame(&json!({
                "type": "message",
                "channel": "C1",
                "user": "U1",
                "text": "hi",
                "ts": "105.100",
            })),
            &config(ActiveSlackRelayPolicy::default()),
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        assert!(state.lifecycle().is_idle());
        assert!(rx.recv().await.is_some());

        drain_recovered_dispatches(
            &mut state,
            &mut store,
            &tx,
            vec![DurableSlackRelayRecord {
                delivery_id: "d-replay".to_owned(),
                dedupe_key: Some(r#"["message","acct","T1","C1","105.101"]"#.to_owned()),
                action: DurableSlackRelayAction::Dispatch,
                slack_meta: json!({}),
                acp_frame: Some(
                    json!({"jsonrpc":"2.0","id":1,"method":"session/prompt"}).to_string(),
                ),
            }],
        )
        .await
        .unwrap();
        assert!(state.lifecycle().is_idle());
        assert!(rx.recv().await.is_some());
        state.lifecycle.stop();
        assert!(!state.lifecycle().is_running());
    }

    #[tokio::test]
    async fn bot_loop_protection_is_attached_to_slack_meta() {
        let policy = ActiveSlackRelayPolicy {
            current_bot_id: Some("B_SELF".to_owned()),
            allow_bots: AllowBotsMode::All,
            ..ActiveSlackRelayPolicy::default()
        };
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        handle_active_slack_relay_frame(
            relay_frame(&json!({
                "type": "message",
                "channel": "C1",
                "bot_id": "B_OTHER",
                "text": "bot update",
                "ts": "106.123456",
            })),
            &config(policy),
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        let sent = rx.recv().await.unwrap();
        let value: Value = serde_json::from_str(&sent).unwrap();
        let loop_meta = &value["params"]["_meta"]["hypercli.slack"]["bot_loop_protection"];
        assert_eq!(loop_meta["sender_id"], "B_OTHER");
        assert_eq!(loop_meta["receiver_id"], "B_SELF");
        assert_eq!(loop_meta["now_ms"], 106_123);
    }

    #[test]
    fn nonrecoverable_slack_auth_errors_stop_reconnect_loop() {
        let invalid = ActiveSlackRelayError::Relay(SlackRelayError::Accept(
            "Slack API rejected auth.test: invalid_auth".to_owned(),
        ));
        let transient = ActiveSlackRelayError::Relay(SlackRelayError::Accept(
            "socket closed before hello".to_owned(),
        ));
        assert!(should_stop_reconnecting_for_error(&invalid));
        assert!(!should_stop_reconnecting_for_error(&transient));
    }
}
