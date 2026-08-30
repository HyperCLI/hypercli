//! HyperCLI Slack relay routing helpers.
//!
//! Provenance:
//! - `hyperclaw-backend/slack-relay/app/routing.py`
//!   route token parsing lines 9-59, delivery frame construction lines 75-103,
//!   OpenClaw relay config shape lines 105-148.
//! - `hyperclaw-backend/slack-relay/app/schemas.py`
//!   `BackendResolvedAgent.slack_identity` lines 178-205.

use regex::Regex;
use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::relay_source::{SlackRelayIdentity, SlackRelayRoute, SlackRelayRouteKind};

const RESERVED_SLACK_COMMANDS: &[&str] = &[
    "help", "status", "list", "agent", "agents", "start", "stop", "create", "delete",
];

/// Backend-resolved agent subset used by relay routing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendResolvedAgent {
    /// Agent UUID.
    pub id: Uuid,
    /// Gateway id.
    pub gateway_id: String,
    /// Runtime name.
    pub runtime: String,
    /// Route handle.
    pub handle: Option<String>,
    /// Display name.
    pub display_name: Option<String>,
    /// Name.
    pub name: String,
    /// Avatar URL.
    pub avatar_url: Option<String>,
    /// Display identity.
    pub display_identity: Option<DisplayIdentity>,
}

/// Display identity subset.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisplayIdentity {
    /// Display name.
    pub display_name: Option<String>,
    /// Avatar URL.
    pub avatar_url: Option<String>,
    /// Slack override icon emoji.
    pub slack_icon_emoji: Option<String>,
    /// Channel-specific display overrides from the backend identity schema.
    pub channel_overrides: Option<DisplayIdentityChannelOverrides>,
}

/// Display identity channel overrides.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisplayIdentityChannelOverrides {
    /// Slack-specific display overrides.
    pub slack: Option<SlackDisplayIdentityOverride>,
}

/// Slack display identity override.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackDisplayIdentityOverride {
    /// Slack icon emoji.
    pub icon_emoji: Option<String>,
}

/// Relay Slack event frame.
#[derive(Debug, Clone, PartialEq)]
pub struct OpenClawRelaySlackEventFrame {
    /// Delivery id.
    pub delivery_id: String,
    /// Route.
    pub route: SlackRelayRoute,
    /// Payload.
    pub payload: Value,
}

/// Parses `agent:<uuid>` gateway ids.
///
/// # Errors
///
/// Returns an error when the prefix or UUID is invalid.
pub fn agent_uuid_from_gateway_id(gateway_id: &str) -> Result<Uuid, uuid::Error> {
    let raw = gateway_id.trim().strip_prefix("agent:").unwrap_or("");
    Uuid::parse_str(raw)
}

/// Normalizes an OpenClaw Slack route token.
#[must_use]
pub fn normalize_route_token(token: Option<&str>) -> Option<String> {
    let mut normalized = token.unwrap_or("").trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    for wrapper in ["`", "'", "\""] {
        if normalized.len() >= 2 && normalized.starts_with(wrapper) && normalized.ends_with(wrapper)
        {
            normalized = normalized[1..normalized.len() - 1].trim().to_owned();
        }
    }
    if normalized.starts_with('<') && normalized.ends_with('>') && normalized.contains('|') {
        normalized = normalized[1..normalized.len() - 1]
            .rsplit_once('|')
            .map_or(normalized.clone(), |(_, token)| token.trim().to_owned());
    }
    normalized = normalized.trim_matches(&['`', '\'', '"'][..]).to_owned();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

/// Splits the first normalized token from text.
#[must_use]
pub fn split_first_token(text: &str) -> (Option<String>, String) {
    let stripped = text.trim();
    if stripped.is_empty() {
        return (None, String::new());
    }
    let (first, rest) = stripped.split_once(' ').unwrap_or((stripped, ""));
    (normalize_route_token(Some(first)), rest.trim().to_owned())
}

/// Parses requested handle from Slack text.
#[must_use]
pub fn parse_requested_handle(text: &str, allow_plain_text: bool) -> (Option<String>, String) {
    let mention_re = Regex::new(r"^<@[^>]+>\s*(?s:(?P<rest>.*))$").expect("valid mention regex");
    if let Some(captures) = mention_re.captures(text.trim()) {
        return split_first_token(captures.name("rest").map_or("", |value| value.as_str()));
    }
    if allow_plain_text {
        split_first_token(text)
    } else {
        (None, text.trim().to_owned())
    }
}

/// Parses `agent <handle>` route command semantics.
#[must_use]
pub fn parse_agent_route(text: &str, allow_plain_text: bool) -> (Option<String>, String) {
    let (first, rest) = parse_requested_handle(text, allow_plain_text);
    let Some(first) = first else {
        return (None, rest);
    };
    if first == "agent" || first == "agents" {
        let (handle, route_rest) = split_first_token(&rest);
        if handle
            .as_deref()
            .is_some_and(|value| RESERVED_SLACK_COMMANDS.contains(&value))
        {
            return (None, route_rest);
        }
        return (handle, route_rest);
    }
    if RESERVED_SLACK_COMMANDS.contains(&first.as_str()) {
        return (None, rest);
    }
    (Some(first), rest)
}

/// Resolves Slack identity from backend agent fields.
#[must_use]
pub fn resolve_slack_identity(agent: &BackendResolvedAgent) -> Option<SlackRelayIdentity> {
    let username = first_nonempty([
        agent.handle.as_deref(),
        agent
            .display_identity
            .as_ref()
            .and_then(|identity| identity.display_name.as_deref()),
        agent.display_name.as_deref(),
        Some(agent.name.as_str()),
    ]);
    let icon_url = first_nonempty([
        agent
            .display_identity
            .as_ref()
            .and_then(|identity| identity.avatar_url.as_deref()),
        agent.avatar_url.as_deref(),
        None,
        None,
    ]);
    let icon_emoji = first_nonempty([
        agent
            .display_identity
            .as_ref()
            .and_then(|identity| identity.channel_overrides.as_ref())
            .and_then(|overrides| overrides.slack.as_ref())
            .and_then(|slack| slack.icon_emoji.as_deref()),
        agent
            .display_identity
            .as_ref()
            .and_then(|identity| identity.slack_icon_emoji.as_deref()),
        None,
        None,
    ]);
    if username.is_none() && icon_url.is_none() && icon_emoji.is_none() {
        None
    } else {
        Some(SlackRelayIdentity {
            username,
            icon_url,
            icon_emoji,
        })
    }
}

/// Builds a relay delivery frame using HyperCLI backend semantics.
#[must_use]
pub fn build_delivery_frame(
    agent: &BackendResolvedAgent,
    envelope: &Map<String, Value>,
    event: &Map<String, Value>,
    route_kind: SlackRelayRouteKind,
) -> OpenClawRelaySlackEventFrame {
    let team_id = stringish(envelope.get("team_id"))
        .or_else(|| stringish(event.get("team")))
        .unwrap_or_default();
    let channel_id = stringish(event.get("channel")).unwrap_or_default();
    let event_id = stringish(envelope.get("event_id")).unwrap_or_else(|| {
        let ts = event
            .get("ts")
            .map_or_else(|| "null".to_owned(), value_to_pythonish_string);
        format!("{team_id}:{channel_id}:{ts}")
    });
    let mut relay_event = event.clone();
    if !team_id.is_empty() {
        relay_event.insert("team".to_owned(), Value::String(team_id.clone()));
    }
    if relay_event.get("type").and_then(Value::as_str) == Some("app_mention") {
        relay_event.insert("type".to_owned(), Value::String("message".to_owned()));
        relay_event.remove("subtype");
    }
    OpenClawRelaySlackEventFrame {
        delivery_id: format!("slack:{team_id}:{event_id}:{}", agent.gateway_id),
        route: SlackRelayRoute {
            kind: route_kind,
            key: agent.gateway_id.clone(),
        },
        payload: json!({
            "team_id": team_id,
            "event_id": event_id,
            "event": Value::Object(relay_event),
        }),
    }
}

/// Builds OpenClaw relay config using HyperCLI's `HYPER_AGENTS_API_KEY`.
#[must_use]
pub fn openclaw_slack_relay_config(
    relay_url: &str,
    gateway_id: &str,
    installer_user_id: Option<&str>,
    allowed_channel_id: Option<&str>,
    allowed_user_id: Option<&str>,
) -> Value {
    let mut slack_config = json!({
        "mode": "relay",
        "groupPolicy": "open",
        "replyToMode": "all",
        "replyToModeByChatType": {"direct": "off"},
        "botToken": {"source": "env", "provider": "default", "id": "SLACK_BOT_TOKEN"},
        "relay": {
            "url": relay_url,
            "authToken": {"source": "env", "provider": "default", "id": "HYPER_AGENTS_API_KEY"},
            "gatewayId": gateway_id,
        },
    });
    let allowed_users: Vec<String> = [installer_user_id, allowed_user_id]
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    if !allowed_users.is_empty() {
        let mut sorted = allowed_users;
        sorted.sort();
        sorted.dedup();
        slack_config["dmPolicy"] = Value::String("allowlist".to_owned());
        slack_config["allowFrom"] = json!(sorted);
    }
    if let Some(channel) = allowed_channel_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        slack_config["groupPolicy"] = Value::String("allowlist".to_owned());
        slack_config["channels"] = json!({channel: {"allow": true, "requireMention": false}});
    }
    json!({
        "messages": {"statusReactions": {"enabled": true}},
        "channels": {"slack": slack_config},
    })
}

fn first_nonempty(values: [Option<&str>; 4]) -> Option<String> {
    values
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn stringish(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(value) => Some(value.clone()),
        Value::Null => None,
        other => Some(value_to_pythonish_string(other)),
    }
}

fn value_to_pythonish_string(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Null => "None".to_owned(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn route_token_parsing_matches_backend() {
        assert_eq!(
            normalize_route_token(Some(" `<foo|Agent_1>` ")),
            Some("agent_1".to_owned())
        );
        assert_eq!(
            parse_agent_route("<@BOT> agent bill run", false),
            (Some("bill".to_owned()), "run".to_owned())
        );
        assert_eq!(parse_agent_route("help me", true), (None, "me".to_owned()));
    }

    #[test]
    fn delivery_frame_rewrites_app_mention_to_message() {
        let agent = BackendResolvedAgent {
            id: Uuid::nil(),
            gateway_id: "agent:abc".to_owned(),
            runtime: "openclaw".to_owned(),
            handle: Some("bill".to_owned()),
            display_name: None,
            name: "Bill".to_owned(),
            avatar_url: None,
            display_identity: None,
        };
        let envelope = json!({"team_id":"T1","event_id":"E1"})
            .as_object()
            .unwrap()
            .clone();
        let event =
            json!({"type":"app_mention","channel":"C1","ts":"100.1","subtype":"bot_message"})
                .as_object()
                .unwrap()
                .clone();
        let frame = build_delivery_frame(
            &agent,
            &envelope,
            &event,
            SlackRelayRouteKind::ChannelDefault,
        );
        assert_eq!(frame.delivery_id, "slack:T1:E1:agent:abc");
        assert_eq!(frame.payload["event"]["type"], "message");
        assert!(frame.payload["event"].get("subtype").is_none());
    }

    #[test]
    fn relay_config_uses_hyper_agents_api_key() {
        let config = openclaw_slack_relay_config(
            "wss://relay/ws",
            "agent:abc",
            Some("U2"),
            Some("C1"),
            Some("U1"),
        );
        assert_eq!(
            config["channels"]["slack"]["relay"]["authToken"]["id"],
            "HYPER_AGENTS_API_KEY"
        );
        assert_eq!(config["channels"]["slack"]["groupPolicy"], "allowlist");
        assert_eq!(
            config["channels"]["slack"]["channels"]["C1"]["requireMention"],
            false
        );
        assert_eq!(
            config["channels"]["slack"]["allowFrom"],
            json!(["U1", "U2"])
        );
    }

    #[test]
    fn slack_identity_prefers_nested_channel_override_emoji() {
        let agent = BackendResolvedAgent {
            id: Uuid::nil(),
            gateway_id: "agent:abc".to_owned(),
            runtime: "openclaw".to_owned(),
            handle: None,
            display_name: None,
            name: "Bill".to_owned(),
            avatar_url: None,
            display_identity: Some(DisplayIdentity {
                display_name: None,
                avatar_url: None,
                slack_icon_emoji: Some(":fallback:".to_owned()),
                channel_overrides: Some(DisplayIdentityChannelOverrides {
                    slack: Some(SlackDisplayIdentityOverride {
                        icon_emoji: Some(":mag:".to_owned()),
                    }),
                }),
            }),
        };
        let identity = resolve_slack_identity(&agent).unwrap();
        assert_eq!(identity.icon_emoji.as_deref(), Some(":mag:"));
    }
}
