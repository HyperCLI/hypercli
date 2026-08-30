//! Slack member channel event classification.
//!
//! Provenance: `openclaw-git/extensions/slack/src/monitor/events/members.ts`.

use serde_json::Value;

/// Member channel action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackMemberAction {
    /// `member_joined_channel`.
    Joined,
    /// `member_left_channel`.
    Left,
}

/// Normalized member event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackMemberEvent {
    /// Action.
    pub action: SlackMemberAction,
    /// Slack user id.
    pub user: String,
    /// Slack channel id.
    pub channel: String,
    /// Slack channel type when supplied.
    pub channel_type: Option<String>,
}

/// Classifies Slack member channel events.
#[must_use]
pub fn classify_member_event(event: &Value) -> Option<SlackMemberEvent> {
    let action = match event.get("type")?.as_str()? {
        "member_joined_channel" => SlackMemberAction::Joined,
        "member_left_channel" => SlackMemberAction::Left,
        _ => return None,
    };
    Some(SlackMemberEvent {
        action,
        user: event.get("user")?.as_str()?.to_owned(),
        channel: event.get("channel")?.as_str()?.to_owned(),
        channel_type: event
            .get("channel_type")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn classifies_join_and_leave() {
        assert_eq!(
            super::classify_member_event(
                &json!({"type":"member_left_channel","user":"U1","channel":"C1"})
            )
            .unwrap()
            .action,
            super::SlackMemberAction::Left
        );
    }
}
