//! OpenClaw `monitor/message-handler/debounce-key.ts` equivalent.
//!
//! Relay and direct Slack transports both use this key as the logical
//! coalescing boundary before dispatch.

use crate::content::SlackMessageForContent;

/// Builds a stable debounce/coalescing key for one Slack logical thread target.
#[must_use]
pub fn build_slack_message_debounce_key(
    team_id: Option<&str>,
    message: &SlackMessageForContent,
) -> String {
    let team = team_id.unwrap_or("unknown-team").trim();
    let thread = message
        .thread_ts
        .as_deref()
        .or(message.ts.as_deref())
        .unwrap_or("unknown-ts")
        .trim();
    format!("slack:{team}:{}:{thread}", message.channel.trim())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::content::slack_message_for_content_from_value;

    #[test]
    fn thread_replies_coalesce_to_thread_root_key() {
        let root = slack_message_for_content_from_value(
            &json!({"type":"message","channel":"C1","ts":"100.1","text":"root"}),
        )
        .unwrap();
        let reply = slack_message_for_content_from_value(&json!({
            "type":"message","channel":"C1","ts":"101.1","thread_ts":"100.1","text":"reply"
        }))
        .unwrap();
        assert_eq!(
            super::build_slack_message_debounce_key(Some("T1"), &root),
            super::build_slack_message_debounce_key(Some("T1"), &reply)
        );
    }
}
