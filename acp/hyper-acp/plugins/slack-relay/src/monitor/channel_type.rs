//! Slack channel type classification for monitor routing and admission.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/channel-type.ts`.
//! - `openclaw-git/extensions/slack/src/channel-type.ts`.
//!
//! HyperCLI deviation: relay payloads currently expose channel ids more
//! reliably than full Slack conversation records, so this module preserves the
//! prior id-prefix defaults while allowing explicit `channel_type` overrides.

use serde_json::Value;

/// Normalized Slack conversation kind used by monitor policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackMonitorChannelType {
    /// Direct message.
    DirectMessage,
    /// Multi-person direct message.
    MultiPersonDirectMessage,
    /// Public/private room channel.
    Room,
    /// Unknown or incomplete Slack channel record.
    Unknown,
}

/// Classifies a Slack message/payload channel using explicit fields first and
/// stable Slack id prefixes as fallback.
#[must_use]
pub fn classify_slack_channel(channel_id: &str, value: &Value) -> SlackMonitorChannelType {
    match value
        .get("channel_type")
        .or_else(|| value.get("channelType"))
        .and_then(Value::as_str)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("im" | "dm") => return SlackMonitorChannelType::DirectMessage,
        Some("mpim") => return SlackMonitorChannelType::MultiPersonDirectMessage,
        Some("channel" | "group" | "private_channel") => return SlackMonitorChannelType::Room,
        _ => {}
    }
    if channel_id.starts_with('D') {
        SlackMonitorChannelType::DirectMessage
    } else if channel_id.starts_with('G') || channel_id.starts_with('C') {
        SlackMonitorChannelType::Room
    } else {
        SlackMonitorChannelType::Unknown
    }
}

/// Whether the channel type is treated as a direct Slack conversation.
#[must_use]
pub fn is_direct_channel(channel_type: SlackMonitorChannelType) -> bool {
    matches!(channel_type, SlackMonitorChannelType::DirectMessage)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn explicit_channel_type_overrides_prefix_defaults() {
        assert_eq!(
            classify_slack_channel("C1", &json!({"channel_type":"im"})),
            SlackMonitorChannelType::DirectMessage
        );
        assert_eq!(
            classify_slack_channel("D1", &json!({})),
            SlackMonitorChannelType::DirectMessage
        );
        assert_eq!(
            classify_slack_channel("G1", &json!({"channel_type":"mpim"})),
            SlackMonitorChannelType::MultiPersonDirectMessage
        );
    }
}
