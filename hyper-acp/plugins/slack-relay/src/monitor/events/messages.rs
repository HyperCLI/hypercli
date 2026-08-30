//! Protocol-agnostic Slack event normalization.
//!
//! Relay websocket frames and direct Slack app Events API callbacks both feed
//! raw Slack `message` / `app_mention` objects through this module before
//! admission/content handling.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/events/messages.ts` for the
//!   message-family event boundary.
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/prepare.ts`
//!   for the intentional `app_mention` handling path shared with messages.
//! - HyperCLI deviation: relay frames are normalized before the ACP prompt
//!   boundary, so this module only owns protocol-agnostic Slack event facts.

use serde_json::Value;

use crate::relay_source::{SlackRelayAcceptedEvent, SlackRelayRoute};

/// Slack event source understood by the core admission/content path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackEventSource {
    /// Slack `message` event.
    Message,
    /// Slack `app_mention` event for non-DM channels.
    AppMention,
}

/// Normalized Slack event facts independent of transport protocol.
#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedSlackEvent {
    /// Source event kind.
    pub source: SlackEventSource,
    /// Slack team id.
    pub team_id: Option<String>,
    /// Raw Slack message-like event object.
    pub message: Value,
}

/// Source transport that delivered a Slack event into the shared core.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackAcceptedEventTransport {
    /// HyperCLI Slack relay websocket transport.
    Relay,
    /// Direct Slack Events API HTTP callback.
    DirectHttp,
    /// Direct Slack Socket Mode `events_api` frame.
    DirectSocket,
}

/// Transport-neutral Slack event accepted by provider/source layers.
#[derive(Debug, Clone, PartialEq)]
pub struct SlackAcceptedEvent {
    /// Transport source.
    pub transport: SlackAcceptedEventTransport,
    /// Durable delivery id.
    pub delivery_id: String,
    /// Slack team id.
    pub team_id: Option<String>,
    /// Normalized Slack message-like event object.
    pub message: Value,
    /// Original envelope/payload.
    pub payload: Value,
    /// Route/session affinity.
    pub route: SlackRelayRoute,
}

/// Supported Slack message subtype system event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackMessageSubtypeKind {
    /// `message_changed`.
    Changed,
    /// `message_deleted`.
    Deleted,
}

/// Normalized edit/delete message subtype event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackMessageSubtypeEvent {
    /// Subtype kind.
    pub kind: SlackMessageSubtypeKind,
    /// Channel id.
    pub channel: String,
    /// Message timestamp affected by the subtype.
    pub message_ts: String,
    /// Sender/user id when Slack supplies one.
    pub sender_id: Option<String>,
    /// Stable OpenClaw-shaped system-event context key.
    pub context_key: String,
}

impl From<SlackRelayAcceptedEvent> for SlackAcceptedEvent {
    fn from(event: SlackRelayAcceptedEvent) -> Self {
        Self {
            transport: SlackAcceptedEventTransport::Relay,
            delivery_id: event.delivery_id,
            team_id: event.team_id,
            message: event.message,
            payload: event.payload,
            route: event.route,
        }
    }
}

/// Classifies Slack `message_changed` / `message_deleted` subtypes before the
/// prompt path, matching OpenClaw's subtype-handler split.
#[must_use]
pub fn classify_message_subtype_event(event: &Value) -> Option<SlackMessageSubtypeEvent> {
    if event.get("type")?.as_str()? != "message" {
        return None;
    }
    let subtype = event.get("subtype")?.as_str()?;
    match subtype {
        "message_changed" => {
            let channel = event.get("channel")?.as_str()?.to_owned();
            let changed = event.get("message");
            let previous = event.get("previous_message");
            let message_ts = changed
                .and_then(|message| message.get("ts"))
                .or_else(|| previous.and_then(|message| message.get("ts")))
                .or_else(|| event.get("event_ts"))
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_owned();
            let sender_id = changed
                .and_then(|message| message.get("user"))
                .or_else(|| previous.and_then(|message| message.get("user")))
                .or_else(|| changed.and_then(|message| message.get("bot_id")))
                .or_else(|| previous.and_then(|message| message.get("bot_id")))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            Some(SlackMessageSubtypeEvent {
                kind: SlackMessageSubtypeKind::Changed,
                context_key: format!("slack:message:changed:{channel}:{message_ts}"),
                channel,
                message_ts,
                sender_id,
            })
        }
        "message_deleted" => {
            let channel = event.get("channel")?.as_str()?.to_owned();
            let previous = event.get("previous_message");
            let message_ts = event
                .get("deleted_ts")
                .or_else(|| event.get("event_ts"))
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_owned();
            let sender_id = previous
                .and_then(|message| message.get("user"))
                .or_else(|| previous.and_then(|message| message.get("bot_id")))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            Some(SlackMessageSubtypeEvent {
                kind: SlackMessageSubtypeKind::Deleted,
                context_key: format!("slack:message:deleted:{channel}:{message_ts}"),
                channel,
                message_ts,
                sender_id,
            })
        }
        _ => None,
    }
}

/// Normalizes a raw Slack message-like event.
#[must_use]
pub fn normalize_slack_event(
    message: &Value,
    team_id_hint: Option<&str>,
) -> Option<NormalizedSlackEvent> {
    let record = message.as_object()?;
    let source = match record.get("type")?.as_str()? {
        "message" => SlackEventSource::Message,
        "app_mention" => SlackEventSource::AppMention,
        _ => return None,
    };
    let message = if source == SlackEventSource::Message {
        match record.get("subtype").and_then(Value::as_str) {
            Some("message_changed" | "message_deleted") => return None,
            _ => message,
        }
    } else {
        message
    };
    let record = message.as_object()?;
    let channel = record.get("channel").and_then(Value::as_str)?;
    if source == SlackEventSource::AppMention
        && (channel.starts_with('D')
            || matches!(
                record.get("channel_type").and_then(Value::as_str),
                Some("im" | "mpim")
            ))
    {
        return None;
    }
    let team_id = team_id_hint
        .or_else(|| record.get("team").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    Some(NormalizedSlackEvent {
        source,
        team_id,
        message: message.clone(),
    })
}

/// Returns the normalized source of a raw Slack event.
#[must_use]
pub fn slack_event_source(message: &Value) -> Option<SlackEventSource> {
    normalize_slack_event(message, None).map(|event| event.source)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn raw_message_and_app_mention_feed_same_normalizer() {
        let message = normalize_slack_event(
            &json!({"type":"message","team":"T1","channel":"C1","text":"hi"}),
            None,
        )
        .unwrap();
        assert_eq!(message.source, SlackEventSource::Message);
        assert_eq!(message.team_id.as_deref(), Some("T1"));

        let mention = normalize_slack_event(
            &json!({"type":"app_mention","channel":"C1","text":"hi"}),
            Some("T2"),
        )
        .unwrap();
        assert_eq!(mention.source, SlackEventSource::AppMention);
        assert_eq!(mention.team_id.as_deref(), Some("T2"));
    }

    #[test]
    fn message_changed_and_deleted_are_not_prompt_dispatched() {
        assert!(normalize_slack_event(
            &json!({
                "type":"message",
                "subtype":"message_changed",
                "channel":"C1",
                "message":{"type":"message","channel":"C1","ts":"2.0","text":"edited"}
            }),
            Some("T1"),
        )
        .is_none());
        assert!(normalize_slack_event(
            &json!({"type":"message","subtype":"message_deleted","channel":"C1","deleted_ts":"1.0"}),
            Some("T1"),
        )
        .is_none());
    }

    #[test]
    fn message_subtypes_are_classified_for_system_events() {
        let changed = classify_message_subtype_event(&json!({
            "type":"message",
            "subtype":"message_changed",
            "channel":"C1",
            "message":{"ts":"2.0","user":"U2"},
            "previous_message":{"ts":"1.0","user":"U1"}
        }))
        .unwrap();
        assert_eq!(changed.kind, SlackMessageSubtypeKind::Changed);
        assert_eq!(changed.message_ts, "2.0");
        assert_eq!(changed.context_key, "slack:message:changed:C1:2.0");

        let deleted = classify_message_subtype_event(&json!({
            "type":"message",
            "subtype":"message_deleted",
            "channel":"C1",
            "deleted_ts":"1.0",
            "previous_message":{"user":"U1"}
        }))
        .unwrap();
        assert_eq!(deleted.kind, SlackMessageSubtypeKind::Deleted);
        assert_eq!(deleted.sender_id.as_deref(), Some("U1"));
    }

    #[test]
    fn raw_dm_app_mentions_are_rejected_like_openclaw() {
        assert!(normalize_slack_event(
            &json!({"type":"app_mention","channel":"D1","channel_type":"im"}),
            Some("T1"),
        )
        .is_none());
        assert!(normalize_slack_event(
            &json!({"type":"app_mention","channel":"C1","channel_type":"mpim"}),
            Some("T1"),
        )
        .is_none());
    }

    #[test]
    fn relay_event_converts_to_transport_neutral_shape() {
        let event = SlackAcceptedEvent::from(SlackRelayAcceptedEvent {
            delivery_id: "d1".to_owned(),
            team_id: Some("T1".to_owned()),
            message: json!({"type":"message","channel":"C1","ts":"1.0"}),
            payload: json!({"event": {"type":"message"}}),
            route: crate::relay_source::SlackRelayRoute {
                kind: crate::relay_source::SlackRelayRouteKind::ThreadAffinity,
                key: "C1:1.0".to_owned(),
            },
        });
        assert_eq!(event.transport, SlackAcceptedEventTransport::Relay);
        assert_eq!(event.delivery_id, "d1");
    }
}
