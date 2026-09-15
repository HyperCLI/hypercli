//! Slack dispatch helper facts shared by prompt emission and output delivery.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/dispatch-helpers.ts`
//!   bot-loop metadata responsibility.
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/timestamp.ts`
//!   Slack timestamp conversion behavior.
//!
//! HyperCLI deviation: helper output is serialized into
//! `_meta["hypercli.slack"].bot_loop_protection` on canonical ACP prompts.

use serde_json::{json, Value};

use crate::monitor::message_handler::prepare::{
    resolve_slack_bot_loop_protection, SlackAdmissionFacts,
};
use crate::monitor::message_handler::prepare_content::SlackMessageForContent;
use crate::monitor::provider::ActiveSlackRelayPolicy;

/// Resolves bot-loop metadata for the Slack prompt `_meta` block.
#[must_use]
pub fn resolve_active_bot_loop_meta(
    policy: &ActiveSlackRelayPolicy,
    facts: &SlackAdmissionFacts,
    message: Option<&SlackMessageForContent>,
) -> Option<Value> {
    let now_ms = message
        .and_then(|message| message.ts.as_deref())
        .and_then(slack_ts_to_millis);
    resolve_slack_bot_loop_protection(&policy.account_id, facts, now_ms).map(|facts| {
        json!({
            "scope_id": facts.scope_id,
            "conversation_id": facts.conversation_id,
            "sender_id": facts.sender_id,
            "receiver_id": facts.receiver_id,
            "now_ms": facts.now_ms,
        })
    })
}

/// Converts a Slack timestamp string into milliseconds.
#[must_use]
pub fn slack_ts_to_millis(ts: &str) -> Option<u64> {
    let (seconds, fraction) = ts.split_once('.').unwrap_or((ts, ""));
    let seconds = seconds.parse::<u64>().ok()?;
    let micros = fraction
        .chars()
        .take(6)
        .collect::<String>()
        .parse::<u64>()
        .unwrap_or(0);
    Some(seconds.saturating_mul(1000) + micros / 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slack_timestamp_truncates_to_millis() {
        assert_eq!(slack_ts_to_millis("106.123456"), Some(106_123));
        assert_eq!(slack_ts_to_millis("106"), Some(106_000));
        assert_eq!(slack_ts_to_millis("bad"), None);
    }
}
