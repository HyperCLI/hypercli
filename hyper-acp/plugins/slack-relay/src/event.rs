//! Protocol-agnostic Slack event normalization.
//!
//! Relay websocket frames and a future direct Slack app connector should both
//! feed raw Slack Events API `message` / `app_mention` objects through this
//! module before admission/content handling.

use serde_json::Value;

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
}
