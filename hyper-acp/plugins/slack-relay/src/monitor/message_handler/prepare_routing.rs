//! Slack reply routing preparation.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/prepare-routing.ts`.
//! - `openclaw-git/extensions/slack/src/account-reply-mode.ts`.
//!
//! HyperCLI deviation: direct-message reply mode defaults to `off` for relay
//! compatibility while room replies preserve the relay default.

use crate::monitor::provider::ActiveSlackRelayPolicy;
use crate::reply::SlackReplyToMode;

/// Selects the effective Slack reply mode for the inbound channel type.
#[must_use]
pub fn effective_reply_to_mode(
    policy: &ActiveSlackRelayPolicy,
    is_direct_message: bool,
) -> SlackReplyToMode {
    if is_direct_message {
        policy.direct_reply_to_mode
    } else {
        policy.reply_to_mode
    }
}

/// Serializes reply mode for Slack ACP metadata.
#[must_use]
pub fn reply_mode_wire(mode: SlackReplyToMode) -> &'static str {
    match mode {
        SlackReplyToMode::Off => "off",
        SlackReplyToMode::First => "first",
        SlackReplyToMode::All => "all",
        SlackReplyToMode::Batched => "batched",
    }
}

/// Builds a stable Slack conversation routing key for ACP session affinity.
#[must_use]
pub fn build_slack_acp_session_key(
    team_id: Option<&str>,
    channel_id: &str,
    thread_ts: Option<&str>,
    user_id: Option<&str>,
    is_direct_message: bool,
) -> String {
    let team = team_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown-team");
    let scope = if is_direct_message { "dm" } else { "thread" };
    let anchor = thread_ts
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or(user_id.map(str::trim).filter(|value| !value.is_empty()))
        .unwrap_or("root");
    format!("slack:{team}:{scope}:{channel_id}:{anchor}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_key_distinguishes_threads_and_dms() {
        assert_eq!(
            build_slack_acp_session_key(Some("T1"), "C1", Some("100.1"), Some("U1"), false),
            "slack:T1:thread:C1:100.1"
        );
        assert_eq!(
            build_slack_acp_session_key(Some("T1"), "D1", None, Some("U1"), true),
            "slack:T1:dm:D1:U1"
        );
    }
}
