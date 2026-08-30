//! Slack reaction event classification.
//!
//! Provenance: `openclaw-git/extensions/slack/src/monitor/events/reactions.ts`.
//! Runtime system-event enqueueing remains a host concern; this module owns the
//! direct/relay-neutral event facts used before that boundary.

use serde_json::Value;

/// Reaction action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackReactionAction {
    /// `reaction_added`.
    Added,
    /// `reaction_removed`.
    Removed,
}

/// Normalized reaction event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackReactionEvent {
    /// Action.
    pub action: SlackReactionAction,
    /// Acting user.
    pub user: String,
    /// Channel id for message reactions.
    pub channel: String,
    /// Message timestamp.
    pub ts: String,
    /// Emoji name.
    pub reaction: String,
    /// Author of the reacted-to message, when Slack supplies it.
    pub item_user: Option<String>,
}

/// Classifies Slack reaction events.
#[must_use]
pub fn classify_reaction_event(event: &Value) -> Option<SlackReactionEvent> {
    let action = match event.get("type")?.as_str()? {
        "reaction_added" => SlackReactionAction::Added,
        "reaction_removed" => SlackReactionAction::Removed,
        _ => return None,
    };
    let item = event.get("item")?.as_object()?;
    if item.get("type")?.as_str()? != "message" {
        return None;
    }
    Some(SlackReactionEvent {
        action,
        user: event.get("user")?.as_str()?.to_owned(),
        channel: item.get("channel")?.as_str()?.to_owned(),
        ts: item.get("ts")?.as_str()?.to_owned(),
        reaction: event.get("reaction")?.as_str()?.to_owned(),
        item_user: event
            .get("item_user")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn classifies_message_reactions() {
        let event = super::classify_reaction_event(&json!({
            "type":"reaction_added","user":"U1","reaction":"eyes",
            "item":{"type":"message","channel":"C1","ts":"1.1"}
        }))
        .unwrap();
        assert_eq!(event.action, super::SlackReactionAction::Added);
        assert_eq!(event.channel, "C1");
        assert_eq!(event.item_user.as_deref(), None);
    }
}
