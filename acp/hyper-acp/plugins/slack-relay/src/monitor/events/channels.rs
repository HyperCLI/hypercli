//! Slack channel lifecycle event classification.
//!
//! Provenance: `openclaw-git/extensions/slack/src/monitor/events/channels.ts`.

use serde_json::Value;

/// Supported channel lifecycle events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackChannelEventKind {
    /// Channel created.
    Created,
    /// Channel archived.
    Archived,
    /// Channel unarchived.
    Unarchived,
    /// Channel renamed.
    Renamed,
    /// Slack channel id changed.
    IdChanged,
}

/// Normalized channel lifecycle event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackChannelEvent {
    /// Kind.
    pub kind: SlackChannelEventKind,
    /// Channel id.
    pub channel: String,
    /// Channel name when present.
    pub name: Option<String>,
    /// Previous channel id for `channel_id_changed`.
    pub old_channel: Option<String>,
}

/// Classifies Slack channel lifecycle events.
#[must_use]
pub fn classify_channel_event(event: &Value) -> Option<SlackChannelEvent> {
    let kind = match event.get("type")?.as_str()? {
        "channel_created" => SlackChannelEventKind::Created,
        "channel_archive" => SlackChannelEventKind::Archived,
        "channel_unarchive" => SlackChannelEventKind::Unarchived,
        "channel_rename" => SlackChannelEventKind::Renamed,
        "channel_id_changed" => SlackChannelEventKind::IdChanged,
        _ => return None,
    };
    if kind == SlackChannelEventKind::IdChanged {
        return Some(SlackChannelEvent {
            kind,
            channel: event.get("new_channel_id")?.as_str()?.to_owned(),
            name: None,
            old_channel: event
                .get("old_channel_id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
        });
    }
    let channel_value = event.get("channel")?;
    Some(SlackChannelEvent {
        kind,
        channel: channel_value
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| channel_value.as_str())
            .unwrap_or_default()
            .to_owned(),
        name: channel_value
            .get("name")
            .or_else(|| channel_value.get("name_normalized"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        old_channel: None,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn classifies_channel_rename() {
        let event = super::classify_channel_event(
            &json!({"type":"channel_rename","channel":{"id":"C1","name":"ops"}}),
        )
        .unwrap();
        assert_eq!(event.kind, super::SlackChannelEventKind::Renamed);
        assert_eq!(event.name.as_deref(), Some("ops"));
    }

    #[test]
    fn classifies_channel_id_changed() {
        let event = super::classify_channel_event(
            &json!({"type":"channel_id_changed","old_channel_id":"COLD","new_channel_id":"CNEW"}),
        )
        .unwrap();
        assert_eq!(event.kind, super::SlackChannelEventKind::IdChanged);
        assert_eq!(event.channel, "CNEW");
        assert_eq!(event.old_channel.as_deref(), Some("COLD"));
    }
}
