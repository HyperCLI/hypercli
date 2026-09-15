//! Slack pin event classification.
//!
//! Provenance: `openclaw-git/extensions/slack/src/monitor/events/pins.ts`.

use serde_json::Value;

/// Pin action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackPinAction {
    /// `pin_added`.
    Added,
    /// `pin_removed`.
    Removed,
}

/// Normalized pin event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackPinEvent {
    /// Action.
    pub action: SlackPinAction,
    /// User.
    pub user: String,
    /// Channel.
    pub channel: String,
    /// Pinned message timestamp when present.
    pub message_ts: Option<String>,
    /// Slack pinned item type.
    pub item_type: Option<String>,
}

/// Classifies Slack pin events.
#[must_use]
pub fn classify_pin_event(event: &Value) -> Option<SlackPinEvent> {
    let action = match event.get("type")?.as_str()? {
        "pin_added" => SlackPinAction::Added,
        "pin_removed" => SlackPinAction::Removed,
        _ => return None,
    };
    Some(SlackPinEvent {
        action,
        user: event.get("user")?.as_str()?.to_owned(),
        channel: event
            .get("channel_id")
            .or_else(|| event.get("channel"))
            .and_then(Value::as_str)?
            .to_owned(),
        message_ts: event
            .get("item")
            .and_then(|item| item.get("message"))
            .and_then(|message| message.get("ts"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        item_type: event
            .get("item")
            .and_then(|item| item.get("type"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn classifies_pin_added() {
        let event = super::classify_pin_event(&json!({
            "type":"pin_added","user":"U1","channel_id":"C1",
            "item":{"message":{"ts":"1.1"}}
        }))
        .unwrap();
        assert_eq!(event.action, super::SlackPinAction::Added);
        assert_eq!(event.message_ts.as_deref(), Some("1.1"));
        assert_eq!(event.item_type.as_deref(), None);
    }
}
