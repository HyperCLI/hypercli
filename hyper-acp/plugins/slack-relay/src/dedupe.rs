//! Logical Slack message dispatch dedupe.
//!
//! Provenance: `openclaw-git/extensions/slack/src/monitor/message-dispatch-dedupe.ts`
//! lines 1-21 and `buildSlackMessageDispatchReplayKey` lines 29-42.

/// Logical dedupe TTL: 24 hours.
pub const SLACK_MESSAGE_DISPATCH_DEDUPE_TTL_MS: u64 = 24 * 60 * 60 * 1000;
/// In-memory dedupe entry cap.
pub const SLACK_MESSAGE_DISPATCH_DEDUPE_MEMORY_MAX_ENTRIES: usize = 20_000;
/// Durable state entry cap.
pub const SLACK_MESSAGE_DISPATCH_DEDUPE_STATE_MAX_ENTRIES: usize = 20_000;
/// Dedupe namespace.
pub const SLACK_MESSAGE_DISPATCH_DEDUPE_NAMESPACE: &str = "global";
/// Dedupe namespace prefix.
pub const SLACK_MESSAGE_DISPATCH_DEDUPE_NAMESPACE_PREFIX: &str = "slack.message-dispatch-dedupe";
/// Dedupe state plugin id.
pub const SLACK_MESSAGE_DISPATCH_DEDUPE_STATE_PLUGIN_ID: &str = "slack-message-dispatch-dedupe";

/// Builds the permanent logical message replay key.
#[must_use]
pub fn build_slack_message_dispatch_replay_key(
    account_id: &str,
    channel_id: Option<&str>,
    ts: Option<&str>,
    team_id: Option<&str>,
) -> Option<String> {
    let channel_id = channel_id?.trim();
    let ts = ts?.trim();
    if channel_id.is_empty() || ts.is_empty() {
        return None;
    }
    let team_id = team_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    serde_json::to_string(&["message", account_id, team_id, channel_id, ts]).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_key_matches_openclaw_shape() {
        assert_eq!(
            build_slack_message_dispatch_replay_key(
                "acct",
                Some(" C1 "),
                Some(" 100.1 "),
                Some(" T1 ")
            )
            .unwrap(),
            r#"["message","acct","T1","C1","100.1"]"#
        );
        assert!(
            build_slack_message_dispatch_replay_key("acct", Some(""), Some("100.1"), None)
                .is_none()
        );
    }
}
