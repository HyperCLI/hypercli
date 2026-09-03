//! Active Slack relay runtime that enqueues scoped Slack events for the
//! plugin-owned ACP session pool.
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

use std::path::PathBuf;
use std::time::{Duration, Instant};

use thiserror::Error;
use tokio::sync::mpsc;

use crate::client::SlackDirectClientConfig;
pub use crate::monitor::ingress::{
    default_durable_log_path, outcome_ack, recover_durable_relay_log, ActiveSlackRelayLifecycle,
    DurableSlackRelayAction, DurableSlackRelayRecord, DurableSlackRelayStore, JsonlSlackRelayStore,
    MemorySlackRelayStore, SharedSlackRelayStore,
};
pub use crate::monitor::message_dispatch_dedupe::{
    build_slack_message_dispatch_replay_key, SlackDispatchDedupeDecision, SlackDispatchDedupeState,
};
use crate::monitor::message_handler::dispatch::{
    drain_recovered_dispatches, ActiveSlackRelayState,
};
use crate::monitor::message_handler::prepare::{AllowBotsMode, DmPolicy, GroupPolicy};
use crate::monitor::reconnect_policy::{
    compute_reconnect_backoff_ms, is_non_recoverable_slack_auth_error,
};
use crate::monitor::relay_source::{run_one_connection, ActiveSlackRelayConnectionExit};
use crate::monitor::relay_source::{SlackRelayError, SlackRelaySourceConfig};
use crate::monitor::replies::SlackReplyToMode;
use crate::monitor::thread::SlackContextVisibility;
use crate::queue::SharedSlackEventQueue;
use crate::scope::SessionPolicy;

/// Environment variable for active Slack relay URL.
pub const HYPER_ACP_SLACK_RELAY_URL_ENV: &str = "HYPER_ACP_SLACK_RELAY_URL";
/// Environment variable for active Slack gateway id.
pub const HYPER_ACP_SLACK_GATEWAY_ID_ENV: &str = "HYPER_ACP_SLACK_GATEWAY_ID";
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
/// Environment variable for allowed Slack channel ids in JSON form (wins over
/// the comma-separated form when both are set). Accepts the launcher form —
/// an object mapping channel id to per-channel config (`{"C1": {"allow":
/// true, ...}}`, ids = keys whose config does not disable the channel) — or a
/// Environment variable for allowed Slack channel ids in JSON form (wins over
/// the comma-separated form). Accepts the launcher form — an object mapping
/// channel id to per-channel config — or a plain string array.
pub const HYPER_ACP_SLACK_CHANNELS_JSON_ENV: &str = "HYPER_ACP_SLACK_CHANNELS_JSON";
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
/// Environment variable for expected Slack team id in direct modes.
pub const HYPER_ACP_SLACK_TEAM_ID_ENV: &str = "HYPER_ACP_SLACK_TEAM_ID";
/// Environment variable for expected Slack API app id in direct modes.
pub const HYPER_ACP_SLACK_API_APP_ID_ENV: &str = "HYPER_ACP_SLACK_API_APP_ID";
const DEFAULT_SLACK_MEDIA_MAX_BYTES: u64 = 20 * 1024 * 1024;

/// Active Slack relay config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveSlackRelayConfig {
    /// Relay source config.
    pub relay: SlackRelaySourceConfig,
    /// Meta-only legacy ACP session id retained in `slack_meta` (set to the
    /// gateway id; durable log path seeding).
    pub session_id: String,
    /// Active admission and content policy.
    pub policy: ActiveSlackRelayPolicy,
    /// Durable accept log. If absent, the relay loop chooses a deterministic
    /// temp-file path from gateway/session ids.
    pub durable_log_path: Option<PathBuf>,
}

impl ActiveSlackRelayConfig {
    /// Reads active Slack relay config from HyperCLI env vars.
    ///
    /// # Errors
    ///
    /// Returns an error when any required value is missing or invalid.
    pub fn from_env() -> Result<Option<Self>, ActiveSlackRelayError> {
        let Some(url) = env_var_with_legacy(HYPER_ACP_SLACK_RELAY_URL_ENV) else {
            return Ok(None);
        };
        let Some(gateway_id) = env_var_with_legacy(HYPER_ACP_SLACK_GATEWAY_ID_ENV) else {
            return Err(ActiveSlackRelayError::MissingEnv(
                HYPER_ACP_SLACK_GATEWAY_ID_ENV,
            ));
        };
        let relay = SlackRelaySourceConfig::from_hyper_agents_env(url, gateway_id)?;
        // Sessions are per-conversation-scope (see `scope.rs`); the raw prompt
        // destination session id no longer exists.
        let session_id = relay.gateway_id.clone();
        let account_id = env_var_with_legacy(HYPER_ACP_SLACK_ACCOUNT_ID_ENV)
            .unwrap_or_else(|| relay.gateway_id.clone());
        let policy = build_policy_from_env(
            account_id,
            env_var_with_legacy(HYPER_ACP_SLACK_RELAY_API_URL_ENV)
                .or_else(|| derive_relay_api_base_url(&relay.url)),
        );
        let durable_log_path =
            env_var_with_legacy(HYPER_ACP_SLACK_DURABLE_LOG_ENV).map(PathBuf::from);
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
    /// Direct Slack Web API client config for direct-mode history/media hydration.
    pub direct_client_config: Option<SlackDirectClientConfig>,
    /// Reaction system-event routing mode: `off`, `own`, `all`, or `allowlist`.
    pub reaction_mode: String,
    /// Lowercase Slack user ids/names allowed to trigger reaction events.
    pub reaction_allowlist_lower: Vec<String>,
    /// Expected Slack team id for direct event filtering.
    pub expected_team_id: Option<String>,
    /// Expected Slack API app id for direct event filtering.
    pub expected_api_app_id: Option<String>,
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
            direct_client_config: None,
            reaction_mode: "all".to_owned(),
            reaction_allowlist_lower: Vec::new(),
            expected_team_id: None,
            expected_api_app_id: None,
        }
    }
}

/// Active runtime control messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveSlackRelayControl {
    /// Stop the relay loop and close the websocket with the server-shutdown reason.
    Shutdown,
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
}

/// Runs the Slack relay loop against the per-scope queue: accepted events are
/// durably logged and enqueued; uncommitted dispatches replay by re-enqueueing.
///
/// # Errors
///
/// Returns terminal local transport/configuration errors.
pub async fn run_slack_relay_with_control(
    config: ActiveSlackRelayConfig,
    queue: SharedSlackEventQueue,
    session_policy: SessionPolicy,
    store: SharedSlackRelayStore,
    control_rx: Option<mpsc::Receiver<ActiveSlackRelayControl>>,
) -> Result<(), ActiveSlackRelayError> {
    run_slack_relay_loop(config, queue, session_policy, store, control_rx).await
}

/// Resolve the durable JSONL path for a relay config.
#[must_use]
pub(crate) fn relay_durable_log_path(config: &ActiveSlackRelayConfig) -> PathBuf {
    config
        .durable_log_path
        .clone()
        .unwrap_or_else(|| default_durable_log_path(&config.relay.gateway_id, &config.session_id))
}

async fn run_slack_relay_loop(
    config: ActiveSlackRelayConfig,
    queue: SharedSlackEventQueue,
    session_policy: SessionPolicy,
    mut store: SharedSlackRelayStore,
    mut control_rx: Option<mpsc::Receiver<ActiveSlackRelayControl>>,
) -> Result<(), ActiveSlackRelayError> {
    let recovery = recover_durable_relay_log(store.path())?;
    let mut reconnect_attempts = 0_u32;
    let mut state = ActiveSlackRelayState::default();
    state.lifecycle.attach();
    state.lifecycle.start();
    for key in recovery.committed_dedupe_keys {
        state.dedupe.load_accepted(key, Instant::now());
    }
    drain_recovered_dispatches(&mut state, &mut store, &queue, recovery.replay_records).await?;
    loop {
        match run_one_connection(
            &config,
            &mut state,
            &mut store,
            &mut control_rx,
            &queue,
            session_policy,
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

async fn sleep_or_shutdown(
    delay: Duration,
    control_rx: &mut Option<mpsc::Receiver<ActiveSlackRelayControl>>,
) -> bool {
    if let Some(rx) = control_rx {
        tokio::select! {
            () = tokio::time::sleep(delay) => false,
            _ = rx.recv() => true,
        }
    } else {
        tokio::time::sleep(delay).await;
        false
    }
}

fn env_var(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// Read a `HYPER_ACP_SLACK_*` env var with `HYPER_SLACK_*` legacy fallback.
fn env_var_with_legacy(name: &str) -> Option<String> {
    env_var(name).or_else(|| {
        let legacy = name.strip_prefix("HYPER_ACP_SLACK_")?;
        env_var(&format!("HYPER_SLACK_{legacy}"))
    })
}

fn csv_env(name: &str) -> Vec<String> {
    env_var(name)
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// Read a JSON channel-allowlist env var. Accepts the launcher form
/// (`{"C1": {"allow": true, ...}}` / `{"C2": {"enabled": true}}`) where ids
/// are the keys whose config does not disable the channel, or a plain string
/// Read a JSON channel-allowlist env var. Accepts the launcher form
/// (`{"C1": {"allow": true, ...}}` / `{"C2": {"enabled": true}}`) where ids
/// are the keys whose config does not disable the channel, or a plain string
/// array. Malformed values warn and fall back to `None` so CSV applies.
fn json_env(name: &str) -> Option<Vec<String>> {
    let raw = env_var(name)?;
    match serde_json::from_str(&raw) {
        Ok(serde_json::Value::Array(items)) => Some(
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_owned)
                .collect(),
        ),
        Ok(serde_json::Value::Object(channels)) => Some(
            channels
                .into_iter()
                .filter(|(_, config)| {
                    config.get("allow").and_then(serde_json::Value::as_bool) != Some(false)
                        && config.get("enabled").and_then(serde_json::Value::as_bool) != Some(false)
                })
                .map(|(id, _)| id)
                .collect(),
        ),
        _ => {
            tracing::warn!("{name} is not a JSON channel allowlist; ignoring: {raw}");
            None
        }
    }
}

fn bool_env(name: &str, default: bool) -> bool {
    env_var(name)
        .as_deref()
        .map(str::to_ascii_lowercase)
        .map_or(default, |value| {
            matches!(value.as_str(), "1" | "true" | "yes" | "on")
        })
}

pub(crate) fn build_policy_from_env(
    account_id: String,
    relay_api_base_url: Option<String>,
) -> ActiveSlackRelayPolicy {
    ActiveSlackRelayPolicy {
        account_id,
        current_bot_user_id: env_var(HYPER_ACP_SLACK_BOT_USER_ID_ENV),
        current_bot_id: env_var(HYPER_ACP_SLACK_BOT_ID_ENV),
        group_policy: parse_group_policy_with_default(
            env_var(HYPER_ACP_SLACK_GROUP_POLICY_ENV).as_deref(),
            GroupPolicy::Allowlist,
        ),
        dm_policy: parse_dm_policy_with_default(
            env_var(HYPER_ACP_SLACK_DM_POLICY_ENV).as_deref(),
            DmPolicy::Pairing,
        ),
        allow_from_lower: csv_env(HYPER_ACP_SLACK_ALLOW_FROM_ENV)
            .into_iter()
            .map(|value| value.to_ascii_lowercase())
            .collect(),
        allowed_channel_ids: json_env(HYPER_ACP_SLACK_CHANNELS_JSON_ENV)
            .unwrap_or_else(|| csv_env(HYPER_ACP_SLACK_CHANNELS_ENV)),
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
        relay_api_base_url,
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
        direct_client_config: SlackDirectClientConfig::from_env().ok(),
        reaction_mode: env_var("HYPER_ACP_SLACK_REACTION_MODE").unwrap_or_else(|| "all".to_owned()),
        reaction_allowlist_lower: csv_env("HYPER_ACP_SLACK_REACTION_ALLOWLIST")
            .into_iter()
            .map(|value| value.to_ascii_lowercase())
            .collect(),
        expected_team_id: env_var(HYPER_ACP_SLACK_TEAM_ID_ENV),
        expected_api_app_id: env_var(HYPER_ACP_SLACK_API_APP_ID_ENV),
    }
}

fn parse_group_policy_with_default(value: Option<&str>, default: GroupPolicy) -> GroupPolicy {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("disabled") => GroupPolicy::Disabled,
        Some("allowlist") => GroupPolicy::Allowlist,
        Some("open") => GroupPolicy::Open,
        _ => default,
    }
}

fn parse_dm_policy_with_default(value: Option<&str>, default: DmPolicy) -> DmPolicy {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("disabled") => DmPolicy::Disabled,
        Some("allowlist") => DmPolicy::Allowlist,
        Some("pairing") => DmPolicy::Pairing,
        Some("open") => DmPolicy::Open,
        _ => default,
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

fn parse_context_visibility(value: Option<&str>) -> SlackContextVisibility {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("allowlist") => SlackContextVisibility::Allowlist,
        Some("allowlist_quote") => SlackContextVisibility::AllowlistQuote,
        _ => SlackContextVisibility::All,
    }
}

pub(crate) fn derive_relay_api_base_url(raw: &str) -> Option<String> {
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

fn tracing_like_stderr(message: &str) {
    eprintln!("{message}");
}

fn should_stop_reconnecting_for_error(error: &ActiveSlackRelayError) -> bool {
    is_non_recoverable_slack_auth_error(&error.to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::monitor::events::messages::normalize_slack_event;
    use crate::monitor::message_handler::dispatch::{
        handle_active_slack_relay_frame, ActiveSlackRelayFrameOutcome,
    };
    use crate::monitor::message_handler::prepare::{
        build_active_prompt_text, build_slack_admission_inputs,
    };
    use crate::monitor::message_handler::prepare::{
        decide_slack_admission, SlackAdmissionDecision, SlackAdmissionPolicy,
    };
    use crate::monitor::message_handler::prepare_content::slack_message_for_content_from_value;
    use crate::monitor::relay_source::{
        build_relay_ack, SlackRelayRoute, SlackRelayRouteKind, HYPER_AGENTS_API_KEY_ENV,
    };
    use crate::queue::{
        DurableQueuedSlackEvent, QueueFinish, QueuedSlackEvent, SharedSlackEventQueue,
        SlackEventQueue,
    };
    use crate::scope::SessionPolicy;
    use serde_json::{json, Value};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

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

    fn shared_queue() -> SharedSlackEventQueue {
        std::sync::Arc::new(tokio::sync::Mutex::new(SlackEventQueue::new(
            crate::config::DedupMode::Queue,
        )))
    }

    fn dispatched_envelope(store: &MemorySlackRelayStore, index: usize) -> QueuedSlackEvent {
        serde_json::from_value::<DurableQueuedSlackEvent>(
            store.records[index].queued_event.clone().unwrap(),
        )
        .unwrap()
        .to_queued_event()
    }

    async fn drain_event_count(queue: &SharedSlackEventQueue) -> usize {
        let mut guard = queue.lock().await;
        let mut drained = 0;
        while let Some(batch) = guard.flush_next() {
            drained += batch.events.len();
            let _finished = guard.finish(batch, QueueFinish::Complete);
        }
        drained
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
    ) -> crate::monitor::relay_source::SlackRelayAcceptedEvent {
        let normalized = normalize_slack_event(event, Some("T1")).unwrap();
        crate::monitor::relay_source::SlackRelayAcceptedEvent {
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
                queued_event: None,
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d1".to_owned(),
                dedupe_key: Some(committed.to_owned()),
                action: DurableSlackRelayAction::Commit,
                slack_meta: json!({}),
                queued_event: None,
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d2".to_owned(),
                dedupe_key: Some(released.to_owned()),
                action: DurableSlackRelayAction::Commit,
                slack_meta: json!({}),
                queued_event: None,
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d2".to_owned(),
                dedupe_key: Some(released.to_owned()),
                action: DurableSlackRelayAction::Release,
                slack_meta: json!({}),
                queued_event: None,
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d3".to_owned(),
                dedupe_key: Some(uncommitted.to_owned()),
                action: DurableSlackRelayAction::Dispatch,
                slack_meta: json!({}),
                queued_event: Some(Value::String("{}".to_owned())),
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d4".to_owned(),
                dedupe_key: Some(duplicate.to_owned()),
                action: DurableSlackRelayAction::Duplicate,
                slack_meta: json!({}),
                queued_event: None,
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

    #[tokio::test]
    async fn active_loop_dispatches_after_durable_accept_with_metadata() {
        let policy = ActiveSlackRelayPolicy {
            account_id: "acct".to_owned(),
            current_bot_user_id: Some("UBOT".to_owned()),
            require_mention: true,
            ..ActiveSlackRelayPolicy::default()
        };
        let queue = shared_queue();
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
            &queue,
            SessionPolicy::Thread,
        )
        .await
        .unwrap();
        assert!(matches!(
            outcome,
            ActiveSlackRelayFrameOutcome::Dispatched { .. }
        ));
        assert_eq!(store.records.len(), 2);
        assert_eq!(store.records[0].action, DurableSlackRelayAction::Claim);
        assert_eq!(store.records[1].action, DurableSlackRelayAction::Dispatch);
        assert!(store.records[1].queued_event.is_some());
        let event = dispatched_envelope(&store, 1);
        assert!(event
            .prompt_text
            .contains("[Slack file: brief.md (fileId: F1)]"));
        assert_eq!(
            event.slack_meta["dedupe_key"],
            json!(r#"["message","acct","T1","C1","100.100"]"#)
        );
        assert_eq!(queue.lock().await.queued_event_count(&event.scope), 1);
    }

    #[tokio::test]
    async fn relay_event_prepares_scoped_prompt_envelope() {
        let policy = ActiveSlackRelayPolicy {
            account_id: "acct".to_owned(),
            current_bot_user_id: Some("UBOT".to_owned()),
            require_mention: true,
            relay_api_base_url: Some("https://relay.example".to_owned()),
            ..ActiveSlackRelayPolicy::default()
        };
        let queue = shared_queue();
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_active_slack_relay_frame(
            relay_frame(&json!({
                "type": "message",
                "channel": "C1",
                "team": "T1",
                "user": "U1",
                "text": "<@UBOT> summarize this",
                "ts": "100.100",
            })),
            &config(policy),
            &mut state,
            &mut store,
            &queue,
            SessionPolicy::Thread,
        )
        .await
        .unwrap();
        assert!(matches!(
            outcome,
            ActiveSlackRelayFrameOutcome::Dispatched { .. }
        ));
        let event = dispatched_envelope(&store, 1);
        assert!(event.prompt_text.contains("summarize this"));
        assert_eq!(event.slack_meta["message"]["channel"], json!("C1"));
    }

    #[tokio::test]
    async fn active_loop_accepts_non_dm_app_mention_as_explicit_mention() {
        let policy = ActiveSlackRelayPolicy {
            account_id: "acct".to_owned(),
            current_bot_user_id: Some("UBOT".to_owned()),
            require_mention: true,
            ..ActiveSlackRelayPolicy::default()
        };
        let queue = shared_queue();
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
            &queue,
            SessionPolicy::Thread,
        )
        .await
        .unwrap();
        assert!(matches!(
            outcome,
            ActiveSlackRelayFrameOutcome::Dispatched { .. }
        ));
        let event = dispatched_envelope(&store, 1);
        assert!(event.prompt_text.contains("ship this"));
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
            let event = crate::monitor::events::messages::SlackAcceptedEvent::from(
                accepted_from_raw_slack_event(delivery_id, &event),
            );
            let message = slack_message_for_content_from_value(&event.message);
            let (facts, mentions) = build_slack_admission_inputs(&policy, &event, message.as_ref());
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
    #[allow(clippy::await_holding_lock)]
    async fn active_loop_hydrates_thread_starter_media_via_relay() {
        let _env = crate::test_env_lock();
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
            let body = r#"{"ok":true,"file":{"id":"F0","name":"root.png","url_private_download":"https://files.slack.com/root.png","size":1024}}"#;
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
        let queue = shared_queue();
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
            &queue,
            SessionPolicy::Thread,
        )
        .await
        .unwrap();
        server.await.unwrap();
        let event = dispatched_envelope(&store, 1);
        let text = &event.prompt_text;
        assert!(
            text.contains("[Slack file: root.png (fileId: F0)]"),
            "{text}"
        );
        assert!(text.contains("https://files.slack.com/root.png"), "{text}");
        std::env::remove_var(HYPER_AGENTS_API_KEY_ENV);
    }

    #[tokio::test]
    async fn active_loop_acks_dropped_dm_after_durable_record() {
        let policy = ActiveSlackRelayPolicy {
            dm_policy: DmPolicy::Allowlist,
            allow_from_lower: vec!["u2".to_owned()],
            ..ActiveSlackRelayPolicy::default()
        };
        let queue = shared_queue();
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
            &queue,
            SessionPolicy::Thread,
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
        assert_eq!(drain_event_count(&queue).await, 0);

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
            &queue,
            SessionPolicy::Thread,
        )
        .await
        .unwrap();
        assert!(matches!(
            retry,
            ActiveSlackRelayFrameOutcome::Dispatched { .. }
        ));
        assert_eq!(drain_event_count(&queue).await, 1);
    }

    #[tokio::test]
    async fn default_open_dm_dispatches_and_uses_direct_reply_off() {
        let queue = shared_queue();
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
            &queue,
            SessionPolicy::Thread,
        )
        .await
        .unwrap();
        assert!(matches!(
            outcome,
            ActiveSlackRelayFrameOutcome::Dispatched { .. }
        ));
        let event = dispatched_envelope(&store, 1);
        assert_eq!(event.slack_meta["reply_to_mode"], json!("off"));
        assert_eq!(event.slack_meta["reply_thread_ts"], json!("101.000"));
    }

    #[tokio::test]
    async fn open_policy_honors_disabled_channel_and_acks_drop() {
        let queue = shared_queue();
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
            &queue,
            SessionPolicy::Thread,
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
        assert_eq!(drain_event_count(&queue).await, 0);
    }

    #[tokio::test]
    async fn active_loop_dedupes_logical_slack_twins() {
        let queue = shared_queue();
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
            &queue,
            SessionPolicy::Thread,
        )
        .await
        .unwrap();
        let second = handle_active_slack_relay_frame(
            relay_frame(&event),
            &config,
            &mut state,
            &mut store,
            &queue,
            SessionPolicy::Thread,
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
        assert_eq!(store.records.len(), 3);
        assert_eq!(store.records[0].action, DurableSlackRelayAction::Claim);
        assert_eq!(store.records[1].action, DurableSlackRelayAction::Dispatch);
        assert_eq!(store.records[2].action, DurableSlackRelayAction::Duplicate);
        assert_eq!(drain_event_count(&queue).await, 1);
    }

    #[tokio::test]
    async fn duplicate_pending_is_acked_for_non_redelivering_hyperclaw_relay() {
        let queue = shared_queue();
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
            &queue,
            SessionPolicy::Thread,
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
        assert_eq!(drain_event_count(&queue).await, 0);
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
            let queue = shared_queue();
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
                &queue,
                SessionPolicy::Thread,
            )
            .await
            .unwrap();
            assert!(matches!(
                outcome,
                ActiveSlackRelayFrameOutcome::Dispatched { .. }
            ));
            assert_eq!(drain_event_count(&queue).await, 1);
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
        let queue = shared_queue();
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
            &queue,
            SessionPolicy::Thread,
        )
        .await
        .unwrap();
        assert!(matches!(
            outcome,
            ActiveSlackRelayFrameOutcome::Dispatched { .. }
        ));
        let event = dispatched_envelope(&store, 1);
        let text = &event.prompt_text;
        assert!(text.contains("[attached: history.pdf (fileId: FH)]"));
        assert!(text.contains("Ada (user)"));
        assert!(text.contains("[Slack file: delta.txt (fileId: F2)]"));
        assert!(!text.contains("root.txt (fileId: F0)"));
        assert_eq!(event.slack_meta["reply_thread_ts"], json!("100.000"));
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

        let queue = shared_queue();
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
            &queue,
            SessionPolicy::Thread,
        )
        .await
        .unwrap_err();
        assert!(matches!(
            error,
            ActiveSlackRelayError::Relay(SlackRelayError::Accept(_))
        ));
        assert_eq!(drain_event_count(&queue).await, 0);
    }

    #[tokio::test]
    async fn lifecycle_attaches_starts_and_returns_to_idle_after_dispatch_and_replay() {
        let queue = shared_queue();
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
            &queue,
            SessionPolicy::Thread,
        )
        .await
        .unwrap();
        assert!(state.lifecycle().is_idle());

        let replayed = QueuedSlackEvent {
            scope: crate::scope::SlackSessionScope {
                team_id: "T1".to_owned(),
                channel_id: "C1".to_owned(),
                thread_ts: Some("105.101".to_owned()),
                is_dm: false,
            },
            prompt_text: "replayed prompt".to_owned(),
            reply_routing: crate::queue::SlackReplyRouting {
                channel_id: "C1".to_owned(),
                team_id: Some("T1".to_owned()),
                reply_thread_ts: Some("105.101".to_owned()),
                reply_to_mode: SlackReplyToMode::All,
            },
            received_at: Instant::now(),
            delivery_id: "d-replay".to_owned(),
            dedupe_key: Some(r#"["message","acct","T1","C1","105.101"]"#.to_owned()),
            slack_meta: json!({}),
        };
        drain_recovered_dispatches(
            &mut state,
            &mut store,
            &queue,
            vec![DurableSlackRelayRecord {
                delivery_id: "d-replay".to_owned(),
                dedupe_key: replayed.dedupe_key.clone(),
                action: DurableSlackRelayAction::Dispatch,
                slack_meta: json!({}),
                queued_event: Some(serde_json::to_value(replayed.to_durable_record()).unwrap()),
            }],
        )
        .await
        .unwrap();
        assert!(state.lifecycle().is_idle());
        // Original dispatch + replayed envelope both sit in the queue; the
        // replay wrote only a Replay marker (no Commit).
        assert!(store
            .records
            .iter()
            .any(|record| record.action == DurableSlackRelayAction::Replay));
        assert!(!store
            .records
            .iter()
            .any(|record| record.action == DurableSlackRelayAction::Commit));
        assert_eq!(drain_event_count(&queue).await, 2);
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
        let queue = shared_queue();
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
            &queue,
            SessionPolicy::Thread,
        )
        .await
        .unwrap();
        let event = dispatched_envelope(&store, 1);
        let loop_meta = &event.slack_meta["bot_loop_protection"];
        assert_eq!(loop_meta["sender_id"], "B_OTHER");
        assert_eq!(loop_meta["receiver_id"], "B_SELF");
        assert_eq!(loop_meta["now_ms"], 106_123);
    }

    #[test]
    fn allowed_channels_read_csv_env() {
        let _env = crate::test_env_lock();
        std::env::remove_var(HYPER_ACP_SLACK_CHANNELS_JSON_ENV);
        std::env::set_var(HYPER_ACP_SLACK_CHANNELS_ENV, " C1, C2 ,C3 ");
        let policy = build_policy_from_env("acct".to_owned(), None);
        std::env::remove_var(HYPER_ACP_SLACK_CHANNELS_ENV);
        assert_eq!(policy.allowed_channel_ids, vec!["C1", "C2", "C3"]);
    }

    #[test]
    fn allowed_channels_json_env_wins_over_csv() {
        let _env = crate::test_env_lock();
        std::env::set_var(HYPER_ACP_SLACK_CHANNELS_ENV, "Ccsv");
        std::env::set_var(HYPER_ACP_SLACK_CHANNELS_JSON_ENV, r#"["C1","C2"]"#);
        let policy = build_policy_from_env("acct".to_owned(), None);
        std::env::remove_var(HYPER_ACP_SLACK_CHANNELS_ENV);
        std::env::remove_var(HYPER_ACP_SLACK_CHANNELS_JSON_ENV);
        assert_eq!(policy.allowed_channel_ids, vec!["C1", "C2"]);
    }

    #[test]
    fn allowed_channels_json_object_form_uses_keys_and_filters_disabled() {
        let _env = crate::test_env_lock();
        std::env::remove_var(HYPER_ACP_SLACK_CHANNELS_ENV);
        std::env::set_var(
            HYPER_ACP_SLACK_CHANNELS_JSON_ENV,
            r#"{"C1":{"allow":true,"requireMention":false},"C2":{"enabled":true},"C3":{"allow":false},"C4":{"enabled":false},"C5":"legacy-true"}"#,
        );
        let policy = build_policy_from_env("acct".to_owned(), None);
        std::env::remove_var(HYPER_ACP_SLACK_CHANNELS_JSON_ENV);
        let mut ids = policy.allowed_channel_ids;
        ids.sort();
        assert_eq!(ids, vec!["C1", "C2", "C5"]);
    }

    #[test]
    fn malformed_channels_json_falls_back_to_csv() {
        let _env = crate::test_env_lock();
        std::env::set_var(HYPER_ACP_SLACK_CHANNELS_ENV, "Ccsv");
        std::env::set_var(HYPER_ACP_SLACK_CHANNELS_JSON_ENV, "not-json");
        let policy = build_policy_from_env("acct".to_owned(), None);
        std::env::remove_var(HYPER_ACP_SLACK_CHANNELS_ENV);
        std::env::remove_var(HYPER_ACP_SLACK_CHANNELS_JSON_ENV);
        assert_eq!(policy.allowed_channel_ids, vec!["Ccsv"]);
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
