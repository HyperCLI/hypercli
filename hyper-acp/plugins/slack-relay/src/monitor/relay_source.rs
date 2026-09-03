//! Relay frame parsing and websocket contract helpers.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/relay-source.ts`
//!   `SlackRelaySourceConfig` lines 16-20, route kinds/max payload lines 24-25,
//!   websocket options lines 230-239, URL safety lines 241-272, JSON parsing
//!   lines 274-301, event/hello extraction lines 303-364, ack lines 366-375.
//! - `hyperclaw-backend/slack-relay/app/schemas.py` frame schema lines 8-43.

use std::env;
use std::net::IpAddr;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async_with_config;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::AUTHORIZATION;
use tokio_tungstenite::tungstenite::protocol::{
    frame::coding::CloseCode, CloseFrame, Message, WebSocketConfig,
};
use url::Url;

use crate::monitor::events::messages::normalize_slack_event;
use crate::monitor::ingress::{outcome_ack, DurableSlackRelayStore};
use crate::monitor::message_handler::dispatch::{
    handle_active_slack_relay_frame, ActiveSlackRelayState,
};
use crate::monitor::provider::{
    ActiveSlackRelayConfig, ActiveSlackRelayControl, ActiveSlackRelayError,
};
use crate::queue::SharedSlackEventQueue;
use crate::scope::SessionPolicy;

/// Close code for shutdown close frames (was `manager.rs`).
pub const SERVER_SHUTDOWN_CLOSE_CODE: u16 = 1001;
/// Close reason for shutdown close frames (was `manager.rs`).
pub const SERVER_SHUTDOWN_REASON: &str = "server_shutdown";

/// HyperCLI relay credential environment variable.
pub const HYPER_AGENTS_API_KEY_ENV: &str = "HYPER_AGENTS_API_KEY";
/// OpenClaw relay max websocket payload, 1 MiB.
pub const SLACK_RELAY_MAX_PAYLOAD_BYTES: usize = 1024 * 1024;
/// OpenClaw relay websocket handshake timeout.
pub const SLACK_RELAY_HANDSHAKE_TIMEOUT_MS: u64 = 30_000;

/// Relay source configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackRelaySourceConfig {
    /// Relay URL, accepted as http(s) or ws(s).
    pub url: String,
    /// Bearer token from `HYPER_AGENTS_API_KEY`.
    pub auth_token: String,
    /// Backend gateway id.
    pub gateway_id: String,
}

impl SlackRelaySourceConfig {
    /// Builds relay config with HyperCLI relay auth.
    ///
    /// # Errors
    ///
    /// Returns [`SlackRelayError::MissingHyperAgentsApiKey`] when the env var is
    /// missing or blank.
    pub fn from_hyper_agents_env(
        url: impl Into<String>,
        gateway_id: impl Into<String>,
    ) -> Result<Self, SlackRelayError> {
        let auth_token = env::var(HYPER_AGENTS_API_KEY_ENV)
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .ok_or(SlackRelayError::MissingHyperAgentsApiKey)?;
        Ok(Self {
            url: url.into(),
            auth_token,
            gateway_id: gateway_id.into(),
        })
    }
}

/// Websocket options matching OpenClaw's `ws` client options.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelayWebSocketOptions {
    /// Authorization header value.
    pub authorization: String,
    /// Handshake timeout in milliseconds.
    pub handshake_timeout_ms: u64,
    /// Maximum inbound frame payload.
    pub max_payload_bytes: usize,
    /// Whether websocket per-message deflate is enabled.
    pub per_message_deflate: bool,
}

/// Relay identity from a hello frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlackRelayIdentity {
    /// Slack username.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    /// Slack icon URL.
    #[serde(rename = "iconUrl", skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
    /// Slack icon emoji.
    #[serde(rename = "iconEmoji", skip_serializing_if = "Option::is_none")]
    pub icon_emoji: Option<String>,
}

/// OpenClaw relay route kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackRelayRouteKind {
    /// User-group route.
    UserGroup,
    /// Thread-affinity route.
    ThreadAffinity,
    /// Channel-default route.
    ChannelDefault,
}

/// Relay route.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlackRelayRoute {
    /// Kind.
    pub kind: SlackRelayRouteKind,
    /// Key.
    pub key: String,
}

/// Accepted Slack relay message event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SlackRelayAcceptedEvent {
    /// Delivery id.
    pub delivery_id: String,
    /// Slack team id from the relay payload when present.
    pub team_id: Option<String>,
    /// Slack message event from `payload.event`.
    pub message: Value,
    /// Full relay payload.
    pub payload: Value,
    /// Relay route.
    pub route: SlackRelayRoute,
}

/// Ack frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlackRelayAckFrame {
    /// Frame type.
    #[serde(rename = "type")]
    pub frame_type: String,
    /// Delivery id.
    pub delivery_id: String,
}

/// Hello extraction result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackRelayHello {
    /// Optional normalized identity.
    pub identity: Option<SlackRelayIdentity>,
}

/// Relay errors.
#[derive(Debug, Error)]
pub enum SlackRelayError {
    /// Missing HyperCLI relay key.
    #[error("HYPER_AGENTS_API_KEY is required for Slack relay auth")]
    MissingHyperAgentsApiKey,
    /// Invalid URL.
    #[error("Slack relay URL is invalid: {0}")]
    InvalidUrl(#[from] url::ParseError),
    /// Unsupported URL scheme.
    #[error("Slack relay URL must use http(s) or ws(s): {0}")]
    InvalidScheme(String),
    /// Plaintext websocket to non-local host.
    #[error("Slack relay URL uses plaintext ws:// for non-local host \"{0}\"")]
    PlaintextRemote(String),
    /// Missing websocket path.
    #[error("Slack relay URL must include its websocket path: {0}")]
    MissingPath(String),
    /// Malformed JSON frame.
    #[error("Slack relay received malformed JSON frame")]
    MalformedFrame(#[source] serde_json::Error),
    /// Durable accept failure.
    #[error("Slack relay event durable accept failed: {0}")]
    Accept(String),
}

/// Builds websocket options.
#[must_use]
pub fn build_relay_websocket_options(auth_token: &str) -> RelayWebSocketOptions {
    RelayWebSocketOptions {
        authorization: format!("Bearer {auth_token}"),
        handshake_timeout_ms: SLACK_RELAY_HANDSHAKE_TIMEOUT_MS,
        max_payload_bytes: SLACK_RELAY_MAX_PAYLOAD_BYTES,
        per_message_deflate: false,
    }
}

/// Builds a relay websocket URL with safety checks.
///
/// # Errors
///
/// Errors on invalid scheme, remote plaintext `ws://`, or missing path.
pub fn build_relay_websocket_url(
    config: &SlackRelaySourceConfig,
) -> Result<String, SlackRelayError> {
    let mut url = Url::parse(&config.url)?;
    match url.scheme() {
        "http" => url.set_scheme("ws").expect("valid scheme"),
        "https" => url.set_scheme("wss").expect("valid scheme"),
        "ws" | "wss" => {}
        _ => return Err(SlackRelayError::InvalidScheme(config.url.clone())),
    }
    if url.scheme() == "ws" && !is_local_relay_host(url.host_str().unwrap_or_default()) {
        return Err(SlackRelayError::PlaintextRemote(
            url.host_str().unwrap_or_default().to_owned(),
        ));
    }
    if url.path().is_empty() || url.path() == "/" {
        return Err(SlackRelayError::MissingPath(config.url.clone()));
    }
    url.query_pairs_mut()
        .append_pair("gateway_id", &config.gateway_id);
    Ok(url.to_string())
}

/// Parses raw frame data as JSON.
///
/// # Errors
///
/// Returns malformed-frame error for invalid JSON.
pub fn parse_relay_frame(data: impl AsRef<[u8]>) -> Result<Value, SlackRelayError> {
    serde_json::from_slice(data.as_ref()).map_err(SlackRelayError::MalformedFrame)
}

/// Extracts a relay hello frame.
#[must_use]
pub fn extract_relay_hello(frame: &Value) -> Option<SlackRelayHello> {
    let record = frame.as_object()?;
    if record.get("type")?.as_str()? != "hello" {
        return None;
    }
    Some(SlackRelayHello {
        identity: extract_relay_identity(record),
    })
}

/// Extracts a relay Slack message event.
#[must_use]
pub fn extract_relay_slack_message_event(frame: &Value) -> Option<SlackRelayAcceptedEvent> {
    let record = frame.as_object()?;
    if record.get("type")?.as_str()? != "slack_event" {
        return None;
    }
    let delivery_id = nonempty_string(record.get("delivery_id")?)?;
    let route_record = record.get("route")?.as_object()?;
    let kind = match route_record.get("kind")?.as_str()? {
        "user_group" => SlackRelayRouteKind::UserGroup,
        "thread_affinity" => SlackRelayRouteKind::ThreadAffinity,
        "channel_default" => SlackRelayRouteKind::ChannelDefault,
        _ => return None,
    };
    let key = nonempty_string(route_record.get("key")?)?;
    let payload = record.get("payload")?;
    let payload_record = payload.as_object()?;
    let message = payload_record.get("event")?;
    let team_id_hint = payload_record
        .get("team_id")
        .and_then(Value::as_str)
        .or_else(|| message.as_object()?.get("team").and_then(Value::as_str));
    let normalized = normalize_slack_event(message, team_id_hint)?;
    Some(SlackRelayAcceptedEvent {
        delivery_id,
        team_id: normalized.team_id,
        message: normalized.message,
        payload: payload.clone(),
        route: SlackRelayRoute { kind, key },
    })
}

/// Handles one frame and returns an ack only after durable accept succeeds.
///
/// # Errors
///
/// Propagates parse and accept errors.
pub fn handle_relay_frame_after_durable_accept(
    data: impl AsRef<[u8]>,
    mut accept_relay_event: impl FnMut(SlackRelayAcceptedEvent) -> Result<(), SlackRelayError>,
) -> Result<Option<SlackRelayAckFrame>, SlackRelayError> {
    let frame = parse_relay_frame(data)?;
    if extract_relay_hello(&frame).is_some() {
        return Ok(None);
    }
    let Some(event) = extract_relay_slack_message_event(&frame) else {
        return Ok(None);
    };
    let delivery_id = event.delivery_id.clone();
    accept_relay_event(event)?;
    Ok(Some(build_relay_ack(&delivery_id)))
}

/// Builds an ack frame.
#[must_use]
pub fn build_relay_ack(delivery_id: &str) -> SlackRelayAckFrame {
    SlackRelayAckFrame {
        frame_type: "ack".to_owned(),
        delivery_id: delivery_id.to_owned(),
    }
}

/// Formats a relay close reason.
#[must_use]
pub fn format_relay_close(code: u16, reason: &[u8]) -> String {
    let text = String::from_utf8_lossy(reason);
    if text.is_empty() {
        format!("Slack relay websocket closed ({code})")
    } else {
        format!("Slack relay websocket closed ({code} {text})")
    }
}

/// One websocket connection exit reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveSlackRelayConnectionExit {
    /// Shutdown was requested through the provider control channel.
    Shutdown,
}

/// Runs one relay websocket connection until shutdown or disconnect.
///
/// # Errors
///
/// Returns websocket, relay, durable ingress, or ACP frame transport errors.
pub async fn run_one_connection(
    config: &ActiveSlackRelayConfig,
    state: &mut ActiveSlackRelayState,
    store: &mut impl DurableSlackRelayStore,
    control_rx: &mut Option<mpsc::Receiver<ActiveSlackRelayControl>>,
    queue: &SharedSlackEventQueue,
    session_policy: SessionPolicy,
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
                    data, config, state, store, queue, session_policy,
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

async fn recv_control(
    control_rx: &mut Option<mpsc::Receiver<ActiveSlackRelayControl>>,
) -> Option<ActiveSlackRelayControl> {
    match control_rx {
        Some(rx) => rx.recv().await,
        None => None,
    }
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

fn is_local_relay_host(hostname: &str) -> bool {
    let normalized = hostname
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if normalized == "localhost" || normalized == "::1" {
        return true;
    }
    matches!(normalized.parse::<IpAddr>(), Ok(IpAddr::V4(addr)) if addr.octets()[0] == 127)
}

fn extract_relay_identity(record: &serde_json::Map<String, Value>) -> Option<SlackRelayIdentity> {
    let identity = record
        .get("slack_identity")
        .or_else(|| record.get("slackIdentity"))?
        .as_object()?;
    let username = normalized_optional_string(identity.get("username"));
    let icon_url = normalized_optional_string(identity.get("icon_url"))
        .or_else(|| normalized_optional_string(identity.get("iconUrl")));
    let icon_emoji = normalized_optional_string(identity.get("icon_emoji"))
        .or_else(|| normalized_optional_string(identity.get("iconEmoji")));
    if username.is_none() && icon_url.is_none() && icon_emoji.is_none() {
        return None;
    }
    Some(SlackRelayIdentity {
        username,
        icon_url,
        icon_emoji,
    })
}

fn normalized_optional_string(value: Option<&Value>) -> Option<String> {
    value?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn nonempty_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn config(url: &str) -> SlackRelaySourceConfig {
        SlackRelaySourceConfig {
            url: url.to_owned(),
            auth_token: "secret".to_owned(),
            gateway_id: "agent:abc".to_owned(),
        }
    }

    #[test]
    fn relay_url_converts_and_sets_gateway_id() {
        assert_eq!(
            build_relay_websocket_url(&config("https://relay.example.com/ws?x=1")).unwrap(),
            "wss://relay.example.com/ws?x=1&gateway_id=agent%3Aabc"
        );
        assert_eq!(
            build_relay_websocket_url(&config("http://localhost/ws")).unwrap(),
            "ws://localhost/ws?gateway_id=agent%3Aabc"
        );
    }

    #[test]
    fn relay_url_enforces_safety_checks() {
        assert!(matches!(
            build_relay_websocket_url(&config("ftp://relay.example.com/ws")),
            Err(SlackRelayError::InvalidScheme(_))
        ));
        assert!(matches!(
            build_relay_websocket_url(&config("ws://relay.example.com/ws")),
            Err(SlackRelayError::PlaintextRemote(_))
        ));
        assert!(matches!(
            build_relay_websocket_url(&config("https://relay.example.com/")),
            Err(SlackRelayError::MissingPath(_))
        ));
        assert!(build_relay_websocket_url(&config("ws://127.0.0.1/ws")).is_ok());
    }

    #[test]
    fn websocket_options_match_openclaw() {
        let options = build_relay_websocket_options("abc");
        assert_eq!(options.authorization, "Bearer abc");
        assert_eq!(options.handshake_timeout_ms, 30_000);
        assert_eq!(options.max_payload_bytes, 1024 * 1024);
        assert!(!options.per_message_deflate);
    }

    #[test]
    fn extracts_hello_identity() {
        let frame = json!({"type":"hello","slack_identity":{"username":" bot ","icon_url":"","iconEmoji":":robot:"}});
        assert_eq!(
            extract_relay_hello(&frame).unwrap().identity,
            Some(SlackRelayIdentity {
                username: Some("bot".to_owned()),
                icon_url: None,
                icon_emoji: Some(":robot:".to_owned()),
            })
        );
    }

    #[test]
    fn extracts_message_and_non_dm_app_mention_events() {
        let frame = json!({"type":"slack_event","delivery_id":"d1","route":{"kind":"channel_default","key":"agent:abc"},"payload":{"event":{"type":"message","channel":"C1","text":"hi"}}});
        assert_eq!(
            extract_relay_slack_message_event(&frame)
                .unwrap()
                .delivery_id,
            "d1"
        );
        let app_mention = json!({"type":"slack_event","delivery_id":"d2","route":{"kind":"channel_default","key":"agent:abc"},"payload":{"event":{"type":"app_mention","channel":"C1"}}});
        assert_eq!(
            extract_relay_slack_message_event(&app_mention)
                .unwrap()
                .delivery_id,
            "d2"
        );
        let dm_app_mention = json!({"type":"slack_event","delivery_id":"d3","route":{"kind":"channel_default","key":"agent:abc"},"payload":{"event":{"type":"app_mention","channel":"D1","channel_type":"im"}}});
        assert!(extract_relay_slack_message_event(&dm_app_mention).is_none());
        let file_shared = json!({"type":"slack_event","delivery_id":"d4","route":{"kind":"channel_default","key":"agent:abc"},"payload":{"event":{"type":"file_shared","channel":"C1"}}});
        assert!(extract_relay_slack_message_event(&file_shared).is_none());
    }

    #[test]
    fn durable_accept_precedes_ack() {
        let frame = br#"{"type":"slack_event","delivery_id":"d1","route":{"kind":"channel_default","key":"agent:abc"},"payload":{"event":{"type":"message","channel":"C1"}}}"#;
        let mut accepted = false;
        let ack = handle_relay_frame_after_durable_accept(frame, |event| {
            accepted = true;
            assert_eq!(event.delivery_id, "d1");
            Ok(())
        })
        .unwrap();
        assert!(accepted);
        assert_eq!(ack, Some(build_relay_ack("d1")));
    }

    #[test]
    fn accept_failure_produces_no_ack() {
        let frame = br#"{"type":"slack_event","delivery_id":"d1","route":{"kind":"channel_default","key":"agent:abc"},"payload":{"event":{"type":"message","channel":"C1"}}}"#;
        let err = handle_relay_frame_after_durable_accept(frame, |_event| {
            Err(SlackRelayError::Accept("boom".to_owned()))
        })
        .unwrap_err();
        assert!(matches!(err, SlackRelayError::Accept(_)));
    }
}
