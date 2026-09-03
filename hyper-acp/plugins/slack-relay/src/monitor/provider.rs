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

use std::path::PathBuf;
use std::time::{Duration, Instant};

use thiserror::Error;
use tokio::sync::mpsc;

use crate::admission::{AllowBotsMode, DmPolicy, GroupPolicy};
use crate::client::{SlackDirectClientConfig, SLACK_BOT_TOKEN_ENV};
use crate::config_schema::{SlackAccountConfig, SlackConnectorMode};
use crate::history::SlackContextVisibility;
use crate::monitor::auth::{verify_slack_signing_secret, SlackSigningError};
use crate::monitor::events::direct::{
    build_socket_mode_ack, direct_event_to_accepted_event, parse_socket_mode_frame,
    socket_mode_frame_to_accepted_event, SlackSocketModeAck, SlackSocketModeFrame,
};
use crate::monitor::events::interactions::{
    handle_slack_interaction_payload, SlackInteractionAck, SlackInteractionHandling,
    SlackInteractionRoutingPolicy,
};
pub use crate::monitor::ingress::{
    default_durable_log_path, outcome_ack, recover_durable_relay_log, ActiveSlackRelayLifecycle,
    DurableSlackRelayAction, DurableSlackRelayRecord, DurableSlackRelayStore, JsonlSlackRelayStore,
    MemorySlackRelayStore, SharedSlackRelayStore,
};
pub use crate::monitor::message_dispatch_dedupe::{
    build_slack_message_dispatch_replay_key, SlackDispatchDedupeDecision, SlackDispatchDedupeState,
};
use crate::monitor::message_handler::dispatch::{
    drain_recovered_dispatches, drain_recovered_dispatches_to_queue, handle_accepted_slack_event,
    ActiveSlackRelayFrameOutcome, ActiveSlackRelayState, SlackDispatchTarget,
    SlackProviderDispatchConfig,
};
use crate::monitor::relay_source::{run_one_connection, ActiveSlackRelayConnectionExit};
use crate::queue::SharedSlackEventQueue;
use crate::reconnect::{compute_reconnect_backoff_ms, is_non_recoverable_slack_auth_error};
use crate::relay_source::{SlackRelayError, SlackRelaySourceConfig};
use crate::reply::SlackReplyToMode;
use crate::scope::SessionPolicy;

/// Environment variable for active Slack relay URL.
pub const HYPER_ACP_SLACK_RELAY_URL_ENV: &str = "HYPER_ACP_SLACK_RELAY_URL";
/// Environment variable for Slack provider mode: `relay`, `http`, or `socket`.
pub const HYPER_ACP_SLACK_MODE_ENV: &str = "HYPER_ACP_SLACK_MODE";
/// Environment variable for Slack request signing secret in direct HTTP mode.
pub const HYPER_ACP_SLACK_SIGNING_SECRET_ENV: &str = "HYPER_ACP_SLACK_SIGNING_SECRET";
/// Environment variable for Slack app-level token in direct socket mode.
pub const HYPER_ACP_SLACK_APP_TOKEN_ENV: &str = "HYPER_ACP_SLACK_APP_TOKEN";
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
/// Environment variable for expected Slack team id in direct modes.
pub const HYPER_ACP_SLACK_TEAM_ID_ENV: &str = "HYPER_ACP_SLACK_TEAM_ID";
/// Environment variable for expected Slack API app id in direct modes.
pub const HYPER_ACP_SLACK_API_APP_ID_ENV: &str = "HYPER_ACP_SLACK_API_APP_ID";
const DEFAULT_SLACK_MEDIA_MAX_BYTES: u64 = 20 * 1024 * 1024;

/// OpenClaw-style provider transport mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackProviderMode {
    /// HyperCLI relay websocket mode.
    Relay,
    /// Direct Slack Events API HTTP mode.
    Http,
    /// Direct Slack Socket Mode boundary.
    Socket,
}

impl From<SlackProviderMode> for SlackConnectorMode {
    fn from(mode: SlackProviderMode) -> Self {
        match mode {
            SlackProviderMode::Relay => Self::Relay,
            SlackProviderMode::Http => Self::Http,
            SlackProviderMode::Socket => Self::Socket,
        }
    }
}

/// Direct Slack provider configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectSlackProviderConfig {
    /// Direct transport mode.
    pub mode: SlackProviderMode,
    /// Source-shaped account config surface.
    pub account_config: SlackAccountConfig,
    /// Bot token client config.
    pub client: SlackDirectClientConfig,
    /// Request signing secret for HTTP Events API.
    pub signing_secret: Option<String>,
    /// App-level token for Socket Mode.
    pub app_token: Option<String>,
    /// Expected Slack team id for direct event filtering.
    pub expected_team_id: Option<String>,
    /// Expected Slack API app id for direct event filtering.
    pub expected_api_app_id: Option<String>,
    /// Existing ACP session id.
    pub session_id: String,
    /// Shared admission/content policy.
    pub policy: ActiveSlackRelayPolicy,
    /// Durable accept log path.
    pub durable_log_path: Option<PathBuf>,
}

impl DirectSlackProviderConfig {
    /// Reads direct Slack provider config from env.
    ///
    /// # Errors
    ///
    /// Returns validation errors when required direct credentials are missing.
    pub fn from_env() -> Result<Option<Self>, ActiveSlackRelayError> {
        let mode = match parse_slack_provider_mode(env_var(HYPER_ACP_SLACK_MODE_ENV).as_deref()) {
            SlackProviderMode::Relay => return Ok(None),
            mode => mode,
        };
        let client = SlackDirectClientConfig::from_env()
            .map_err(|_| ActiveSlackRelayError::MissingEnv(SLACK_BOT_TOKEN_ENV))?;
        let signing_secret = env_var(HYPER_ACP_SLACK_SIGNING_SECRET_ENV);
        let app_token = env_var(HYPER_ACP_SLACK_APP_TOKEN_ENV);
        if mode == SlackProviderMode::Http && signing_secret.is_none() {
            return Err(ActiveSlackRelayError::MissingEnv(
                HYPER_ACP_SLACK_SIGNING_SECRET_ENV,
            ));
        }
        if mode == SlackProviderMode::Socket && app_token.is_none() {
            return Err(ActiveSlackRelayError::MissingEnv(
                HYPER_ACP_SLACK_APP_TOKEN_ENV,
            ));
        }
        let session_id = required_env(HYPER_ACP_SLACK_SESSION_ID_ENV)?;
        let account_id = env_var(HYPER_ACP_SLACK_ACCOUNT_ID_ENV)
            .unwrap_or_else(|| create_direct_account_id(&client.bot_token));
        let policy = build_policy_from_env(account_id, None);
        let mut account_config =
            SlackAccountConfig::new(policy.account_id.clone(), SlackConnectorMode::from(mode));
        account_config.group_policy = policy.group_policy;
        account_config.dm_policy = policy.dm_policy;
        account_config.allow_bots = policy.allow_bots;
        account_config.reply_to_mode = policy.reply_to_mode;
        account_config.direct_reply_to_mode = policy.direct_reply_to_mode;
        account_config.bot_token = Some(client.bot_token.clone());
        account_config.signing_secret.clone_from(&signing_secret);
        account_config.app_token.clone_from(&app_token);
        let durable_log_path = env_var(HYPER_ACP_SLACK_DURABLE_LOG_ENV).map(PathBuf::from);
        Ok(Some(Self {
            mode,
            account_config,
            client: client.clone(),
            signing_secret,
            app_token,
            expected_team_id: env_var(HYPER_ACP_SLACK_TEAM_ID_ENV),
            expected_api_app_id: env_var(HYPER_ACP_SLACK_API_APP_ID_ENV),
            session_id,
            policy: ActiveSlackRelayPolicy {
                direct_client_config: Some(client.clone()),
                ..policy
            },
            durable_log_path,
        }))
    }

    /// Validates mode-specific provider credentials.
    ///
    /// # Errors
    ///
    /// Returns an error when required direct-mode credentials are absent.
    pub fn validate(&self) -> Result<(), ActiveSlackRelayError> {
        if self.client.bot_token.trim().is_empty() {
            return Err(ActiveSlackRelayError::MissingEnv(SLACK_BOT_TOKEN_ENV));
        }
        if self.mode == SlackProviderMode::Http
            && self.signing_secret.as_deref().unwrap_or("").is_empty()
        {
            return Err(ActiveSlackRelayError::MissingEnv(
                HYPER_ACP_SLACK_SIGNING_SECRET_ENV,
            ));
        }
        if self.mode == SlackProviderMode::Socket
            && self.app_token.as_deref().unwrap_or("").is_empty()
        {
            return Err(ActiveSlackRelayError::MissingEnv(
                HYPER_ACP_SLACK_APP_TOKEN_ENV,
            ));
        }
        Ok(())
    }
}

/// Direct Slack HTTP callback request.
#[derive(Debug, Clone, Copy)]
pub struct DirectSlackHttpEventRequest<'a> {
    /// Raw HTTP body.
    pub body: &'a [u8],
    /// `X-Slack-Request-Timestamp`.
    pub timestamp_header: Option<&'a str>,
    /// `X-Slack-Signature`.
    pub signature_header: Option<&'a str>,
    /// Current epoch seconds used for replay-window validation.
    pub now_epoch_seconds: i64,
}

/// Direct provider-owned event processing result.
#[derive(Debug, Clone, PartialEq, Eq)]
#[must_use]
pub enum DirectSlackProviderOutcome {
    /// Slack URL verification response body.
    UrlVerification {
        /// Challenge body to echo to Slack.
        challenge: String,
    },
    /// Event callback was dispatched or dropped by the shared core.
    Event(ActiveSlackRelayFrameOutcome),
    /// Direct payload is a known non-message/system event handled by a family module.
    SystemEvent(crate::monitor::events::SlackEventFamilyAction),
    /// Direct payload is a Slack interaction request.
    Interaction {
        /// Slack interaction ack/result payload for HTTP or Socket Mode.
        ack: SlackInteractionAck,
        /// Source-shaped interaction action, if routed.
        action: Option<crate::monitor::events::SlackEventFamilyAction>,
    },
    /// Direct payload was ignored.
    Ignored,
    /// Socket Mode envelope was acked and then handled by the inner outcome.
    SocketAck {
        /// Slack Socket Mode ack that must be returned on the websocket.
        ack: SlackSocketModeAck,
        /// Outcome after ack construction.
        outcome: Box<DirectSlackProviderOutcome>,
    },
}

/// Direct Slack provider input owned by HTTP/socket integration layers.
#[derive(Debug, Clone)]
pub enum DirectSlackProviderInput {
    /// Signed Events API HTTP request.
    Http {
        /// Raw request body.
        body: Vec<u8>,
        /// `X-Slack-Request-Timestamp`.
        timestamp_header: Option<String>,
        /// `X-Slack-Signature`.
        signature_header: Option<String>,
        /// Current epoch seconds for replay protection.
        now_epoch_seconds: i64,
    },
    /// Socket Mode frame with an explicit ack egress channel.
    Socket {
        /// Raw Socket Mode websocket frame.
        frame: serde_json::Value,
        /// Ack egress channel owned by the embedding websocket loop.
        ack_tx: mpsc::Sender<SlackSocketModeAck>,
    },
    /// Socket Mode frame with an egress channel for provider-sent acks.
    SocketWithAck {
        /// Raw Socket Mode websocket frame.
        frame: serde_json::Value,
        /// Ack egress channel owned by the embedding websocket loop.
        ack_tx: mpsc::Sender<SlackSocketModeAck>,
    },
    /// Provider shutdown.
    Shutdown,
}

/// Direct Slack provider lifecycle state.
#[derive(Debug, Default)]
pub struct DirectSlackProviderRuntime {
    state: ActiveSlackRelayState,
}

/// Runs a direct Slack provider lifecycle over host-supplied HTTP/socket inputs.
///
/// # Errors
///
/// Returns config validation, signing, durable store, or ACP send failures.
pub async fn run_direct_slack_provider_to_acp_client_frames(
    config: DirectSlackProviderConfig,
    mut inputs: mpsc::Receiver<DirectSlackProviderInput>,
    client_frames: mpsc::Sender<String>,
) -> Result<(), ActiveSlackRelayError> {
    config.validate()?;
    let path = config.durable_log_path.clone().unwrap_or_else(|| {
        default_durable_log_path(&format!("direct-{:?}", config.mode), &config.session_id)
    });
    let recovery = recover_durable_relay_log(&path)?;
    let mut store = JsonlSlackRelayStore::open(path)?;
    let mut runtime = DirectSlackProviderRuntime::new();
    runtime.start();
    for key in recovery.committed_dedupe_keys {
        runtime.state.dedupe.load_accepted(key, Instant::now());
    }
    drain_recovered_dispatches(
        &mut runtime.state,
        &mut store,
        &client_frames,
        recovery.replay_records,
    )
    .await?;
    while let Some(input) = inputs.recv().await {
        match input {
            DirectSlackProviderInput::Http {
                body,
                timestamp_header,
                signature_header,
                now_epoch_seconds,
            } => {
                let _outcome = runtime
                    .handle_http_event(
                        DirectSlackHttpEventRequest {
                            body: &body,
                            timestamp_header: timestamp_header.as_deref(),
                            signature_header: signature_header.as_deref(),
                            now_epoch_seconds,
                        },
                        &config,
                        &mut store,
                        &client_frames,
                    )
                    .await?;
            }
            DirectSlackProviderInput::Socket { frame, ack_tx }
            | DirectSlackProviderInput::SocketWithAck { frame, ack_tx } => {
                send_socket_ack_for_frame(&frame, &ack_tx).await?;
                let _outcome = runtime
                    .handle_socket_frame(&frame, &config, &mut store, &client_frames)
                    .await?;
            }
            DirectSlackProviderInput::Shutdown => break,
        }
    }
    runtime.stop();
    Ok(())
}

impl DirectSlackProviderRuntime {
    /// Creates a direct Slack provider lifecycle runtime.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts lifecycle accounting for the direct provider.
    pub fn start(&mut self) {
        self.state.lifecycle.attach();
        self.state.lifecycle.start();
    }

    /// Stops lifecycle accounting for the direct provider.
    pub fn stop(&mut self) {
        self.state.lifecycle.stop();
    }

    /// Handles a signed Slack Events API HTTP body.
    ///
    /// # Errors
    ///
    /// Returns signing, parse, durable store, or ACP frame send errors.
    pub async fn handle_http_event(
        &mut self,
        request: DirectSlackHttpEventRequest<'_>,
        config: &DirectSlackProviderConfig,
        store: &mut impl DurableSlackRelayStore,
        client_frames: &mpsc::Sender<String>,
    ) -> Result<DirectSlackProviderOutcome, ActiveSlackRelayError> {
        handle_direct_slack_http_event_body(request, config, &mut self.state, store, client_frames)
            .await
    }

    /// Handles one Slack Socket Mode frame.
    ///
    /// # Errors
    ///
    /// Returns parse, durable store, or ACP frame send errors.
    pub async fn handle_socket_frame(
        &mut self,
        frame: &serde_json::Value,
        config: &DirectSlackProviderConfig,
        store: &mut impl DurableSlackRelayStore,
        client_frames: &mpsc::Sender<String>,
    ) -> Result<DirectSlackProviderOutcome, ActiveSlackRelayError> {
        handle_direct_slack_socket_mode_frame(frame, config, &mut self.state, store, client_frames)
            .await
    }
}

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
        let policy = build_policy_from_env(
            account_id,
            env_var(HYPER_ACP_SLACK_RELAY_API_URL_ENV)
                .or_else(|| derive_relay_api_base_url(&relay.url)),
        );
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
    /// Slack signature validation error.
    #[error(transparent)]
    SlackSigning(#[from] SlackSigningError),
    /// Websocket error.
    #[error("Slack relay websocket error: {0}")]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),
    /// ACP client frame receiver closed.
    #[error("ACP client frame transport closed")]
    ClientFrameTransportClosed,
}

/// Handles one direct Slack Events API callback through the shared message pipeline.
///
/// # Errors
///
/// Returns validation, serialization, durable accept, or client-frame send errors.
pub async fn handle_direct_slack_event_callback(
    payload: &serde_json::Value,
    config: &DirectSlackProviderConfig,
    state: &mut ActiveSlackRelayState,
    store: &mut impl DurableSlackRelayStore,
    client_frames: &mpsc::Sender<String>,
) -> Result<DirectSlackProviderOutcome, ActiveSlackRelayError> {
    config.validate()?;
    if direct_payload_mismatches_expected_ids(payload, config) {
        return Ok(DirectSlackProviderOutcome::Ignored);
    }
    if let Some(interaction) = handle_direct_slack_interaction_payload(payload, config) {
        let interaction = interaction?;
        maybe_send_interaction_system_event(&interaction, &config.session_id, client_frames)
            .await?;
        return Ok(interaction_outcome(interaction));
    }
    if let Some(action) = crate::monitor::events::dispatch_slack_event_family_with_policy(
        payload,
        &event_routing_policy(&config.policy),
    ) {
        maybe_send_system_event_action(&action, &config.session_id, client_frames).await?;
        return Ok(DirectSlackProviderOutcome::SystemEvent(action));
    }
    let Some(event) = direct_event_to_accepted_event(payload) else {
        return Ok(DirectSlackProviderOutcome::Ignored);
    };
    let dispatch_config = SlackProviderDispatchConfig {
        session_id: config.session_id.clone(),
        policy: config.policy.clone(),
    };
    handle_accepted_slack_event(event, &dispatch_config, state, store, client_frames)
        .await
        .map(DirectSlackProviderOutcome::Event)
}

/// Handles one direct Slack Socket Mode frame through the shared pipeline.
///
/// # Errors
///
/// Returns validation, serialization, durable accept, or client-frame send errors.
pub async fn handle_direct_slack_socket_mode_frame(
    frame: &serde_json::Value,
    config: &DirectSlackProviderConfig,
    state: &mut ActiveSlackRelayState,
    store: &mut impl DurableSlackRelayStore,
    client_frames: &mpsc::Sender<String>,
) -> Result<DirectSlackProviderOutcome, ActiveSlackRelayError> {
    config.validate()?;
    let Some(socket) = parse_socket_mode_frame(frame) else {
        return Ok(DirectSlackProviderOutcome::Ignored);
    };
    let ack = build_socket_mode_ack(socket.envelope_id());
    if direct_payload_mismatches_expected_ids(socket.payload(), config) {
        return Ok(DirectSlackProviderOutcome::SocketAck {
            ack,
            outcome: Box::new(DirectSlackProviderOutcome::Ignored),
        });
    }
    let payload = match socket {
        SlackSocketModeFrame::Interactive { payload, .. } => {
            let Some(interaction) = handle_direct_slack_interaction_payload(&payload, config)
            else {
                return Ok(DirectSlackProviderOutcome::SocketAck {
                    ack,
                    outcome: Box::new(DirectSlackProviderOutcome::Ignored),
                });
            };
            let interaction = interaction?;
            maybe_send_interaction_system_event(&interaction, &config.session_id, client_frames)
                .await?;
            return Ok(DirectSlackProviderOutcome::SocketAck {
                ack,
                outcome: Box::new(interaction_outcome(interaction)),
            });
        }
        SlackSocketModeFrame::EventsApi { payload, .. } => payload,
    };
    if let Some(action) = crate::monitor::events::dispatch_slack_event_family_with_policy(
        &payload,
        &event_routing_policy(&config.policy),
    ) {
        maybe_send_system_event_action(&action, &config.session_id, client_frames).await?;
        return Ok(DirectSlackProviderOutcome::SocketAck {
            ack,
            outcome: Box::new(DirectSlackProviderOutcome::SystemEvent(action)),
        });
    }
    let Some(event) = socket_mode_frame_to_accepted_event(frame) else {
        return Ok(DirectSlackProviderOutcome::SocketAck {
            ack,
            outcome: Box::new(DirectSlackProviderOutcome::Ignored),
        });
    };
    let dispatch_config = SlackProviderDispatchConfig {
        session_id: config.session_id.clone(),
        policy: config.policy.clone(),
    };
    let outcome = handle_accepted_slack_event(event, &dispatch_config, state, store, client_frames)
        .await
        .map(DirectSlackProviderOutcome::Event)?;
    Ok(DirectSlackProviderOutcome::SocketAck {
        ack,
        outcome: Box::new(outcome),
    })
}

fn handle_direct_slack_interaction_payload(
    payload: &serde_json::Value,
    config: &DirectSlackProviderConfig,
) -> Option<Result<SlackInteractionHandling, ActiveSlackRelayError>> {
    crate::monitor::events::interactions::classify_interaction(payload)?;
    Some(Ok(handle_slack_interaction_payload(
        payload,
        &interaction_routing_policy(&config.policy),
    )))
}

async fn maybe_send_interaction_system_event(
    interaction: &SlackInteractionHandling,
    session_id: &str,
    client_frames: &mpsc::Sender<String>,
) -> Result<(), ActiveSlackRelayError> {
    let SlackInteractionHandling::SystemEvent { system_event, .. } = interaction else {
        return Ok(());
    };
    send_system_event(system_event, session_id, "interaction", client_frames).await
}

async fn send_socket_ack_for_frame(
    frame: &serde_json::Value,
    ack_tx: &mpsc::Sender<SlackSocketModeAck>,
) -> Result<(), ActiveSlackRelayError> {
    let Some(socket) = parse_socket_mode_frame(frame) else {
        return Ok(());
    };
    ack_tx
        .send(build_socket_mode_ack(socket.envelope_id()))
        .await
        .map_err(|_| ActiveSlackRelayError::ClientFrameTransportClosed)
}

fn interaction_outcome(interaction: SlackInteractionHandling) -> DirectSlackProviderOutcome {
    match interaction {
        SlackInteractionHandling::SystemEvent {
            kind,
            ack,
            system_event,
        } => DirectSlackProviderOutcome::Interaction {
            ack,
            action: Some(
                crate::monitor::events::SlackEventFamilyAction::Interaction { kind, system_event },
            ),
        },
        SlackInteractionHandling::Ignored { ack, .. }
        | SlackInteractionHandling::Dropped { ack, .. } => {
            DirectSlackProviderOutcome::Interaction { ack, action: None }
        }
    }
}

fn direct_payload_mismatches_expected_ids(
    payload: &serde_json::Value,
    config: &DirectSlackProviderConfig,
) -> bool {
    let team_id = payload
        .get("team_id")
        .or_else(|| {
            payload
                .get("team")
                .and_then(|team| team.get("id").or(Some(team)))
        })
        .and_then(serde_json::Value::as_str);
    let api_app_id = payload
        .get("api_app_id")
        .and_then(serde_json::Value::as_str);
    config
        .expected_team_id
        .as_deref()
        .is_some_and(|expected| team_id != Some(expected))
        || config
            .expected_api_app_id
            .as_deref()
            .is_some_and(|expected| api_app_id != Some(expected))
}

enum DirectSlackHttpBody {
    Json(serde_json::Value),
    Interaction(serde_json::Value),
}

fn parse_direct_slack_http_body(body: &[u8]) -> Result<DirectSlackHttpBody, ActiveSlackRelayError> {
    if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(body) {
        return Ok(DirectSlackHttpBody::Json(payload));
    }
    let payload = url::form_urlencoded::parse(body)
        .find(|(key, _)| key == "payload")
        .map(|(_, value)| value.into_owned());
    if let Some(payload) = payload {
        return serde_json::from_str::<serde_json::Value>(&payload)
            .map(DirectSlackHttpBody::Interaction)
            .map_err(ActiveSlackRelayError::Serialize);
    }
    serde_json::from_slice::<serde_json::Value>(body)
        .map(DirectSlackHttpBody::Json)
        .map_err(ActiveSlackRelayError::Serialize)
}

async fn maybe_send_system_event_action(
    action: &crate::monitor::events::SlackEventFamilyAction,
    session_id: &str,
    client_frames: &mpsc::Sender<String>,
) -> Result<(), ActiveSlackRelayError> {
    let Some(system_event) = system_event_for_action(action) else {
        return Ok(());
    };
    send_system_event(system_event, session_id, "system", client_frames).await
}

async fn send_system_event(
    system_event: &crate::monitor::events::SlackConnectorSystemEvent,
    session_id: &str,
    event_family: &str,
    client_frames: &mpsc::Sender<String>,
) -> Result<(), ActiveSlackRelayError> {
    let frame = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": session_id,
            "update": {
                "sessionUpdate": "system_event",
                "content": {"type": "text", "text": system_event.text},
                "_meta": {
                    "hypercli.slack": {
                        "session_key": system_event.session_key,
                        "context_key": system_event.context_key,
                        "event_family": event_family
                    }
                }
            }
        }
    })
    .to_string();
    client_frames
        .send(frame)
        .await
        .map_err(|_| ActiveSlackRelayError::ClientFrameTransportClosed)
}

fn system_event_for_action(
    action: &crate::monitor::events::SlackEventFamilyAction,
) -> Option<&crate::monitor::events::SlackConnectorSystemEvent> {
    use crate::monitor::events::SlackEventFamilyAction;
    match action {
        SlackEventFamilyAction::MessageSubtype { system_event, .. }
        | SlackEventFamilyAction::Reaction { system_event, .. }
        | SlackEventFamilyAction::Member { system_event, .. }
        | SlackEventFamilyAction::Pin { system_event, .. }
        | SlackEventFamilyAction::Interaction { system_event, .. } => Some(system_event),
        SlackEventFamilyAction::Channel { system_event, .. } => system_event.as_ref(),
        SlackEventFamilyAction::HomeOpened { .. }
        | SlackEventFamilyAction::Assistant { .. }
        | SlackEventFamilyAction::Agent { .. } => None,
    }
}

fn event_routing_policy(
    policy: &ActiveSlackRelayPolicy,
) -> crate::monitor::events::SlackEventRoutingPolicy {
    crate::monitor::events::SlackEventRoutingPolicy {
        account_id: policy.account_id.clone(),
        allowed_channel_ids: policy.allowed_channel_ids.clone(),
        disabled_channel_ids: policy.disabled_channel_ids.clone(),
        bot_user_id: policy.current_bot_user_id.clone(),
        reaction_mode: policy.reaction_mode.clone(),
        reaction_allowlist_lower: policy.reaction_allowlist_lower.clone(),
    }
}

fn interaction_routing_policy(policy: &ActiveSlackRelayPolicy) -> SlackInteractionRoutingPolicy {
    SlackInteractionRoutingPolicy {
        account_id: policy.account_id.clone(),
        allowed_channel_ids: policy.allowed_channel_ids.clone(),
        disabled_channel_ids: policy.disabled_channel_ids.clone(),
        dm_policy: policy.dm_policy,
        allow_from_lower: policy.allow_from_lower.clone(),
        allow_name_matching: policy.allow_name_matching,
    }
}

/// Verifies and handles one direct Slack Events API HTTP callback body.
///
/// # Errors
///
/// Returns signing or dispatch errors.
pub async fn handle_direct_slack_http_event_body(
    request: DirectSlackHttpEventRequest<'_>,
    config: &DirectSlackProviderConfig,
    state: &mut ActiveSlackRelayState,
    store: &mut impl DurableSlackRelayStore,
    client_frames: &mpsc::Sender<String>,
) -> Result<DirectSlackProviderOutcome, ActiveSlackRelayError> {
    let secret = config
        .signing_secret
        .as_deref()
        .ok_or(ActiveSlackRelayError::MissingEnv(
            HYPER_ACP_SLACK_SIGNING_SECRET_ENV,
        ))?;
    verify_slack_signing_secret(
        secret,
        request.timestamp_header,
        request.signature_header,
        request.body,
        request.now_epoch_seconds,
    )?;
    let payload = parse_direct_slack_http_body(request.body)?;
    let payload = match payload {
        DirectSlackHttpBody::Json(payload) => payload,
        DirectSlackHttpBody::Interaction(payload) => {
            if direct_payload_mismatches_expected_ids(&payload, config) {
                return Ok(DirectSlackProviderOutcome::Interaction {
                    ack: SlackInteractionAck::empty(),
                    action: None,
                });
            }
            let Some(interaction) = handle_direct_slack_interaction_payload(&payload, config)
            else {
                return Ok(DirectSlackProviderOutcome::Interaction {
                    ack: SlackInteractionAck::empty(),
                    action: None,
                });
            };
            let interaction = interaction?;
            maybe_send_interaction_system_event(&interaction, &config.session_id, client_frames)
                .await?;
            return Ok(interaction_outcome(interaction));
        }
    };
    if let Some(crate::monitor::events::direct::SlackDirectEventEnvelope::UrlVerification {
        challenge,
    }) = crate::monitor::events::direct::parse_direct_slack_event_envelope(&payload)
    {
        return Ok(DirectSlackProviderOutcome::UrlVerification { challenge });
    }
    handle_direct_slack_event_callback(&payload, config, state, store, client_frames).await
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
    control_rx: Option<mpsc::Receiver<ActiveSlackRelayControl>>,
) -> Result<(), ActiveSlackRelayError> {
    let store = SharedSlackRelayStore::open(relay_durable_log_path(&config))?;
    run_slack_relay_loop(
        config,
        SlackRelaySink::ClientFrames(client_frames),
        store,
        control_rx,
    )
    .await
}

/// Runs the Slack relay loop against the standalone plugin's per-scope queue:
/// accepted events are durably logged and enqueued; uncommitted dispatches
/// replay by re-enqueueing instead of re-emitting frames.
///
/// # Errors
///
/// Returns terminal local transport/configuration errors.
pub async fn run_slack_relay_to_queue_with_control(
    config: ActiveSlackRelayConfig,
    queue: SharedSlackEventQueue,
    session_policy: SessionPolicy,
    store: SharedSlackRelayStore,
    control_rx: Option<mpsc::Receiver<ActiveSlackRelayControl>>,
) -> Result<(), ActiveSlackRelayError> {
    run_slack_relay_loop(
        config,
        SlackRelaySink::Queue {
            queue,
            session_policy,
        },
        store,
        control_rx,
    )
    .await
}

/// Owned dispatch sink for the relay loop.
enum SlackRelaySink {
    ClientFrames(mpsc::Sender<String>),
    Queue {
        queue: SharedSlackEventQueue,
        session_policy: SessionPolicy,
    },
}

impl SlackRelaySink {
    fn target(&self) -> SlackDispatchTarget<'_> {
        match self {
            Self::ClientFrames(client_frames) => {
                SlackDispatchTarget::AcpClientFrames { client_frames }
            }
            Self::Queue {
                queue,
                session_policy,
            } => SlackDispatchTarget::Queue {
                queue,
                session_policy: *session_policy,
            },
        }
    }
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
    sink: SlackRelaySink,
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
    match &sink {
        SlackRelaySink::ClientFrames(client_frames) => {
            drain_recovered_dispatches(
                &mut state,
                &mut store,
                client_frames,
                recovery.replay_records,
            )
            .await?;
        }
        SlackRelaySink::Queue { queue, .. } => {
            drain_recovered_dispatches_to_queue(
                &mut state,
                &mut store,
                queue,
                recovery.replay_records,
            )
            .await?;
        }
    }
    loop {
        match run_one_connection(
            &config,
            &mut state,
            &mut store,
            &mut control_rx,
            sink.target(),
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

fn env_var(name: &'static str) -> Option<String> {
    env_var_with_legacy(name)
}

fn env_var_with_legacy(name: &'static str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let legacy = name.strip_prefix("HYPER_ACP_SLACK_")?;
            let legacy_name = format!("HYPER_SLACK_{legacy}");
            std::env::var(legacy_name)
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        })
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

fn parse_slack_provider_mode(value: Option<&str>) -> SlackProviderMode {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("http" | "events" | "direct_http") => SlackProviderMode::Http,
        Some("socket" | "socket_mode" | "direct_socket") => SlackProviderMode::Socket,
        _ => SlackProviderMode::Relay,
    }
}

fn create_direct_account_id(bot_token: &str) -> String {
    crate::client::create_slack_token_cache_key(bot_token)
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

    use crate::admission::{decide_slack_admission, SlackAdmissionDecision, SlackAdmissionPolicy};
    use crate::content::slack_message_for_content_from_value;
    use crate::event::normalize_slack_event;
    use crate::monitor::message_handler::dispatch::{
        build_slack_session_prompt_frame, handle_active_slack_relay_frame,
        ActiveSlackRelayFrameOutcome,
    };
    use crate::monitor::message_handler::prepare::{
        build_active_prompt_text, build_slack_admission_inputs,
    };
    use crate::relay_source::{
        build_relay_ack, SlackRelayRoute, SlackRelayRouteKind, HYPER_AGENTS_API_KEY_ENV,
    };
    use serde_json::{json, Value};
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

    fn plan_output_reply_proxy_from_prompt(
        prompt_frame: String,
    ) -> Vec<crate::monitor::message_handler::dispatch_streaming::SlackAcpOutputDelivery> {
        let prompt_value: Value = serde_json::from_str(&prompt_frame).unwrap();
        let prompt_id = prompt_value["id"].clone();
        let mut output_state =
            crate::monitor::message_handler::dispatch_streaming::SlackAcpOutputState::default();
        let output_config =
            crate::monitor::message_handler::dispatch_streaming::SlackAcpOutputConfig {
                relay_api_base_url: Some("https://relay.example".to_owned()),
                hyper_agents_api_key: Some("relay-key".to_owned()),
                text_limit: crate::monitor::replies::SLACK_TEXT_LIMIT,
                reply_to_mode: SlackReplyToMode::All,
                direct_client_config: None,
            };
        output_state
            .process_frame(
                &output_config,
                &crate::monitor::message_handler::dispatch_streaming::SlackAcpObservedFrame {
                    direction: crate::monitor::message_handler::dispatch_streaming::SlackAcpFrameDirection::ClientToAgent,
                    text: prompt_frame,
                },
            )
            .unwrap();
        output_state
            .process_frame(
                &output_config,
                &crate::monitor::message_handler::dispatch_streaming::SlackAcpObservedFrame {
                    direction: crate::monitor::message_handler::dispatch_streaming::SlackAcpFrameDirection::AgentToClient,
                    text: json!({
                        "jsonrpc":"2.0",
                        "method":"session/update",
                        "params":{
                            "sessionId":"sess",
                            "update":{
                                "sessionUpdate":"agent_message_chunk",
                                "content":{"type":"text","text":"Summary ready"}
                            }
                        }
                    })
                    .to_string(),
                },
            )
            .unwrap();
        output_state
            .process_frame(
                &output_config,
                &crate::monitor::message_handler::dispatch_streaming::SlackAcpObservedFrame {
                    direction: crate::monitor::message_handler::dispatch_streaming::SlackAcpFrameDirection::AgentToClient,
                    text: json!({"jsonrpc":"2.0","id":prompt_id,"result":{"stopReason":"end_turn"}})
                        .to_string(),
                },
            )
            .unwrap()
    }

    fn direct_config(mode: SlackProviderMode) -> DirectSlackProviderConfig {
        DirectSlackProviderConfig {
            mode,
            account_config: SlackAccountConfig::new("acct", SlackConnectorMode::from(mode)),
            client: SlackDirectClientConfig {
                bot_token: "xoxb-direct".to_owned(),
                api_base_url: "https://slack.example/api".to_owned(),
            },
            signing_secret: (mode == SlackProviderMode::Http).then(|| "secret".to_owned()),
            app_token: (mode == SlackProviderMode::Socket).then(|| "xapp-direct".to_owned()),
            expected_team_id: None,
            expected_api_app_id: None,
            session_id: "sess".to_owned(),
            policy: ActiveSlackRelayPolicy::default(),
            durable_log_path: None,
        }
    }

    #[test]
    fn provider_mode_env_validates_http_socket_and_relay_credentials() {
        let _env = crate::test_env_lock();
        std::env::set_var(HYPER_ACP_SLACK_MODE_ENV, "http");
        std::env::set_var(crate::client::SLACK_BOT_TOKEN_ENV, "xoxb-direct");
        std::env::set_var(HYPER_ACP_SLACK_SIGNING_SECRET_ENV, "signing");
        std::env::set_var(HYPER_ACP_SLACK_SESSION_ID_ENV, "sess");
        let http = DirectSlackProviderConfig::from_env().unwrap().unwrap();
        assert_eq!(http.mode, SlackProviderMode::Http);
        assert_eq!(http.client.bot_token, "xoxb-direct");
        assert_eq!(http.signing_secret.as_deref(), Some("signing"));

        std::env::set_var(HYPER_ACP_SLACK_MODE_ENV, "socket");
        std::env::remove_var(HYPER_ACP_SLACK_SIGNING_SECRET_ENV);
        std::env::set_var(HYPER_ACP_SLACK_APP_TOKEN_ENV, "xapp-direct");
        let socket = DirectSlackProviderConfig::from_env().unwrap().unwrap();
        assert_eq!(socket.mode, SlackProviderMode::Socket);
        assert_eq!(socket.app_token.as_deref(), Some("xapp-direct"));
        assert_eq!(socket.policy.group_policy, GroupPolicy::Allowlist);
        assert_eq!(socket.policy.dm_policy, DmPolicy::Pairing);

        std::env::set_var(HYPER_ACP_SLACK_MODE_ENV, "relay");
        std::env::remove_var(crate::client::SLACK_BOT_TOKEN_ENV);
        std::env::set_var(
            HYPER_ACP_SLACK_RELAY_URL_ENV,
            "wss://relay.example/slack/ws",
        );
        std::env::set_var(HYPER_ACP_SLACK_GATEWAY_ID_ENV, "agent:abc");
        std::env::set_var(HYPER_AGENTS_API_KEY_ENV, "relay-key");
        assert!(DirectSlackProviderConfig::from_env().unwrap().is_none());
        let relay = ActiveSlackRelayConfig::from_env().unwrap().unwrap();
        assert_eq!(relay.relay.auth_token, "relay-key");
        assert_eq!(
            relay.policy.relay_api_base_url.as_deref(),
            Some("https://relay.example")
        );

        std::env::remove_var(HYPER_ACP_SLACK_MODE_ENV);
        std::env::remove_var(HYPER_ACP_SLACK_APP_TOKEN_ENV);
        std::env::remove_var(HYPER_ACP_SLACK_RELAY_URL_ENV);
        std::env::remove_var(HYPER_ACP_SLACK_GATEWAY_ID_ENV);
        std::env::remove_var(HYPER_AGENTS_API_KEY_ENV);
        std::env::remove_var(HYPER_ACP_SLACK_SESSION_ID_ENV);
    }

    #[test]
    fn provider_env_reads_legacy_hyper_slack_names() {
        let _env = crate::test_env_lock();
        std::env::remove_var(HYPER_ACP_SLACK_MODE_ENV);
        std::env::remove_var(HYPER_ACP_SLACK_APP_TOKEN_ENV);
        std::env::remove_var(HYPER_ACP_SLACK_SESSION_ID_ENV);
        std::env::set_var("HYPER_SLACK_MODE", "socket");
        std::env::set_var(crate::client::SLACK_BOT_TOKEN_ENV, "xoxb-direct");
        std::env::set_var("HYPER_SLACK_APP_TOKEN", "xapp-legacy");
        std::env::set_var("HYPER_SLACK_SESSION_ID", "sess");
        let config = DirectSlackProviderConfig::from_env().unwrap().unwrap();
        assert_eq!(config.mode, SlackProviderMode::Socket);
        assert_eq!(config.app_token.as_deref(), Some("xapp-legacy"));
        std::env::remove_var("HYPER_SLACK_MODE");
        std::env::remove_var(crate::client::SLACK_BOT_TOKEN_ENV);
        std::env::remove_var("HYPER_SLACK_APP_TOKEN");
        std::env::remove_var("HYPER_SLACK_SESSION_ID");
    }

    #[test]
    fn active_state_pairing_approval_is_callable() {
        let mut state = ActiveSlackRelayState::default();
        let input = crate::monitor::dm_auth::SlackDirectMessageAuthorizationInput {
            account_id: "acct".to_owned(),
            sender_id: "U123".to_owned(),
            allow_from_lower: Vec::new(),
            sender_name: None,
            allow_name_matching: false,
            dm_policy: DmPolicy::Pairing,
            dm_enabled: true,
        };
        let first = crate::monitor::dm_auth::authorize_slack_direct_message_with_pairing_store(
            &input,
            Some(&mut state.pairing),
        );
        let crate::monitor::dm_auth::SlackDirectMessageAuthorization::PairingChallenge {
            meta, ..
        } = first
        else {
            panic!("expected pairing challenge");
        };
        let code = meta["pairing_code"].as_str().unwrap();
        assert!(state.approve_pairing_code("acct", code).is_some());
    }

    #[tokio::test]
    async fn direct_event_callback_dispatches_through_shared_pipeline() {
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_direct_slack_event_callback(
            &json!({
                "type":"event_callback",
                "team_id":"T1",
                "event_id":"EvDirect1",
                "event":{"type":"app_mention","channel":"C1","user":"U1","text":"<@B1> hi","ts":"200.1"}
            }),
            &direct_config(SlackProviderMode::Http),
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        assert!(matches!(
            outcome,
            DirectSlackProviderOutcome::Event(ActiveSlackRelayFrameOutcome::Dispatched { .. })
        ));
        let sent = rx.recv().await.unwrap();
        let value: Value = serde_json::from_str(&sent).unwrap();
        assert_eq!(value["method"], "session/prompt");
        assert_eq!(
            value["params"]["_meta"]["hypercli.slack"]["delivery_id"],
            "EvDirect1"
        );
        assert!(store
            .records
            .iter()
            .any(|record| matches!(record.action, DurableSlackRelayAction::Dispatch)));
    }

    #[tokio::test]
    async fn direct_event_callback_gates_expected_team_and_app_id() {
        let (tx, _rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let mut config = direct_config(SlackProviderMode::Http);
        config.expected_team_id = Some("T1".to_owned());
        config.expected_api_app_id = Some("A1".to_owned());
        let outcome = handle_direct_slack_event_callback(
            &json!({
                "type":"event_callback",
                "team_id":"T2",
                "api_app_id":"A1",
                "event_id":"EvWrongTeam",
                "event":{"type":"app_mention","channel":"C1","user":"U1","text":"<@B1> hi","ts":"200.2"}
            }),
            &config,
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        assert_eq!(outcome, DirectSlackProviderOutcome::Ignored);
    }

    #[tokio::test]
    async fn direct_non_message_events_emit_system_event_frame() {
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let mut config = direct_config(SlackProviderMode::Http);
        config.policy.account_id = "acct".to_owned();
        let outcome = handle_direct_slack_event_callback(
            &json!({
                "type":"event_callback",
                "team_id":"T1",
                "event_id":"EvReaction",
                "event":{
                    "type":"reaction_added",
                    "user":"U1",
                    "reaction":"eyes",
                    "item_user":"UBOT",
                    "item":{"type":"message","channel":"C1","ts":"100.1"}
                }
            }),
            &config,
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        assert!(matches!(
            outcome,
            DirectSlackProviderOutcome::SystemEvent(
                crate::monitor::events::SlackEventFamilyAction::Reaction { .. }
            )
        ));
        let sent = rx.recv().await.unwrap();
        let value: Value = serde_json::from_str(&sent).unwrap();
        assert_eq!(value["method"], "session/update");
        assert_eq!(value["params"]["update"]["sessionUpdate"], "system_event");
        assert!(value["params"]["update"]["content"]["text"]
            .as_str()
            .unwrap()
            .contains("Slack reaction added"));
    }

    #[tokio::test]
    async fn signed_direct_http_event_body_dispatches_through_provider() {
        let body = br#"{"type":"event_callback","team_id":"T1","event_id":"EvSigned","event":{"type":"message","channel":"C1","user":"U1","text":"hi","ts":"201.1"}}"#;
        let ts = "1700000000";
        let signature = slack_test_signature("secret", ts, body);
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_direct_slack_http_event_body(
            DirectSlackHttpEventRequest {
                body,
                timestamp_header: Some(ts),
                signature_header: Some(&signature),
                now_epoch_seconds: 1_700_000_000,
            },
            &direct_config(SlackProviderMode::Http),
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        assert!(matches!(
            outcome,
            DirectSlackProviderOutcome::Event(ActiveSlackRelayFrameOutcome::Dispatched { .. })
        ));
        let sent = rx.recv().await.unwrap();
        assert!(sent.contains("EvSigned"));
    }

    #[tokio::test]
    async fn signed_form_encoded_direct_http_interaction_emits_system_event() {
        let interaction = json!({
            "type":"block_actions",
            "team":{"id":"T1"},
            "user":{"id":"U1"},
            "trigger_id":"trigger-secret",
            "response_url":"https://hooks.slack.example/response",
            "channel":{"id":"C1"},
            "message":{"ts":"250.1","thread_ts":"250.0"},
            "actions":[{
                "type":"button",
                "action_id":"ship",
                "block_id":"controls",
                "value":"approved",
                "text":{"type":"plain_text","text":"Ship"}
            }]
        });
        let mut serializer = url::form_urlencoded::Serializer::new(String::new());
        serializer.append_pair("payload", &interaction.to_string());
        let body = serializer.finish();
        let ts = "1700000000";
        let signature = slack_test_signature("secret", ts, body.as_bytes());
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_direct_slack_http_event_body(
            DirectSlackHttpEventRequest {
                body: body.as_bytes(),
                timestamp_header: Some(ts),
                signature_header: Some(&signature),
                now_epoch_seconds: 1_700_000_000,
            },
            &direct_config(SlackProviderMode::Http),
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        assert!(matches!(
            outcome,
            DirectSlackProviderOutcome::Interaction {
                ack: SlackInteractionAck {
                    status_code: 200,
                    body: None
                },
                action: Some(
                    crate::monitor::events::SlackEventFamilyAction::Interaction {
                        kind:
                            crate::monitor::events::interactions::SlackInteractionKind::BlockAction,
                        ..
                    }
                )
            }
        ));
        let sent = rx.recv().await.unwrap();
        let value: Value = serde_json::from_str(&sent).unwrap();
        assert_eq!(value["method"], "session/update");
        assert_eq!(value["params"]["update"]["sessionUpdate"], "system_event");
        assert_eq!(
            value["params"]["update"]["_meta"]["hypercli.slack"]["event_family"],
            "interaction"
        );
        let text = value["params"]["update"]["content"]["text"]
            .as_str()
            .unwrap();
        assert!(text.contains("\"interactionType\":\"block_action\""));
        assert!(text.contains("\"actionId\":\"ship\""));
        assert!(text.contains("[redacted]"));
        assert!(!text.contains("trigger-secret"));
        assert!(store.records.is_empty());
    }

    #[tokio::test]
    async fn direct_socket_mode_frame_dispatches_through_provider() {
        let (tx, mut rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_direct_slack_socket_mode_frame(
            &json!({
                "type":"events_api",
                "envelope_id":"EnvDirectSocket",
                "payload":{
                    "type":"event_callback",
                    "team_id":"T1",
                    "event":{"type":"message","channel":"C1","user":"U1","text":"hi","ts":"202.1"}
                }
            }),
            &direct_config(SlackProviderMode::Socket),
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        assert!(matches!(
            outcome,
            DirectSlackProviderOutcome::SocketAck {
                outcome,
                ..
            } if matches!(*outcome, DirectSlackProviderOutcome::Event(ActiveSlackRelayFrameOutcome::Dispatched { .. }))
        ));
        let sent = rx.recv().await.unwrap();
        assert!(sent.contains("EnvDirectSocket"));
    }

    #[tokio::test]
    async fn direct_http_url_verification_returns_response_outcome() {
        let body = br#"{"type":"url_verification","challenge":"challenge-1"}"#;
        let ts = "1700000000";
        let signature = slack_test_signature("secret", ts, body);
        let (tx, _rx) = mpsc::channel(1);
        let mut state = ActiveSlackRelayState::default();
        let mut store = MemorySlackRelayStore::default();
        let outcome = handle_direct_slack_http_event_body(
            DirectSlackHttpEventRequest {
                body,
                timestamp_header: Some(ts),
                signature_header: Some(&signature),
                now_epoch_seconds: 1_700_000_000,
            },
            &direct_config(SlackProviderMode::Http),
            &mut state,
            &mut store,
            &tx,
        )
        .await
        .unwrap();
        assert_eq!(
            outcome,
            DirectSlackProviderOutcome::UrlVerification {
                challenge: "challenge-1".to_owned()
            }
        );
    }

    #[tokio::test]
    async fn direct_provider_lifecycle_loop_dispatches_socket_inputs() {
        let (input_tx, input_rx) = mpsc::channel(2);
        let (frame_tx, mut frame_rx) = mpsc::channel(1);
        let (ack_tx, mut ack_rx) = mpsc::channel(1);
        let mut config = direct_config(SlackProviderMode::Socket);
        config.durable_log_path = Some(std::env::temp_dir().join(format!(
            "hyper-acp-slack-direct-loop-{}.jsonl",
            std::process::id()
        )));
        drop(fs::remove_file(config.durable_log_path.as_ref().unwrap()));
        let task = tokio::spawn(run_direct_slack_provider_to_acp_client_frames(
            config.clone(),
            input_rx,
            frame_tx,
        ));
        input_tx
            .send(DirectSlackProviderInput::Socket {
                frame: json!({
                    "type":"events_api",
                    "envelope_id":"EnvLoop",
                    "payload":{
                        "type":"event_callback",
                        "team_id":"T1",
                        "event":{"type":"message","channel":"C1","user":"U1","text":"hi","ts":"303.1"}
                    }
                }),
                ack_tx,
            })
            .await
            .unwrap();
        input_tx
            .send(DirectSlackProviderInput::Shutdown)
            .await
            .unwrap();
        let ack = ack_rx.recv().await.unwrap();
        assert_eq!(ack.envelope_id, "EnvLoop");
        let sent = frame_rx.recv().await.unwrap();
        assert!(sent.contains("EnvLoop"));
        task.await.unwrap().unwrap();
        drop(fs::remove_file(config.durable_log_path.as_ref().unwrap()));
    }

    fn slack_test_signature(secret: &str, ts: &str, body: &[u8]) -> String {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;

        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(b"v0:");
        mac.update(ts.as_bytes());
        mac.update(b":");
        mac.update(body);
        let digest = mac.finalize().into_bytes();
        let mut hex = String::with_capacity(digest.len() * 2);
        for byte in digest {
            use std::fmt::Write as _;
            write!(&mut hex, "{byte:02x}").unwrap();
        }
        format!("v0={hex}")
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
        assert!(store.records[1].queued_event.is_some());
        let sent = rx.recv().await.unwrap();
        assert_eq!(
            store.records[1].queued_event,
            Some(Value::String(sent.clone()))
        );
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
    async fn relay_event_prepares_acp_prompt_and_output_reply_proxy() {
        let policy = ActiveSlackRelayPolicy {
            account_id: "acct".to_owned(),
            current_bot_user_id: Some("UBOT".to_owned()),
            require_mention: true,
            relay_api_base_url: Some("https://relay.example".to_owned()),
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
                "text": "<@UBOT> summarize this",
                "ts": "100.100",
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

        let prompt_frame = rx.recv().await.unwrap();
        let prompt_value: Value = serde_json::from_str(&prompt_frame).unwrap();
        assert_eq!(prompt_value["method"], "session/prompt");
        assert!(prompt_value["params"]["prompt"][0]["text"]
            .as_str()
            .unwrap()
            .contains("summarize this"));
        assert_eq!(
            prompt_value["params"]["_meta"]["hypercli.slack"]["message"]["channel"],
            "C1"
        );
        let deliveries = plan_output_reply_proxy_from_prompt(prompt_frame);
        let crate::monitor::message_handler::dispatch_streaming::SlackAcpOutputDelivery::Reply(
            reply,
        ) = &deliveries[0]
        else {
            panic!("expected Slack reply delivery");
        };
        assert_eq!(
            reply.request.as_ref().unwrap().url,
            "https://relay.example/slack/api/chat.postMessage"
        );
        let request = reply.request.as_ref().unwrap();
        assert_eq!(request.authorization, "Bearer relay-key");
        assert_eq!(request.body["channel"], "C1");
        assert_eq!(request.body["thread_ts"], "100.100");
        assert_eq!(request.body["text"], "Summary ready");
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
                queued_event: Some(Value::String(
                    json!({"jsonrpc":"2.0","id":1,"method":"session/prompt"}).to_string(),
                )),
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
