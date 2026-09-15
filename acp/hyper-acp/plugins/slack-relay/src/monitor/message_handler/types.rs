//! OpenClaw `monitor/message-handler/types.ts` equivalent.

pub use crate::monitor::events::messages::{NormalizedSlackEvent, SlackEventSource};
pub use crate::monitor::message_handler::prepare_content::{
    SlackMessageForContent, SlackResolvedMessageContent,
};

/// Stable Slack message identity used by dispatch, debounce, and history code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackMessageIdentity {
    /// Slack channel id.
    pub channel: String,
    /// Message timestamp.
    pub ts: Option<String>,
    /// Thread root timestamp.
    pub thread_ts: Option<String>,
}

impl SlackMessageIdentity {
    /// Extracts identity from portable message content.
    #[must_use]
    pub fn from_message(message: &SlackMessageForContent) -> Self {
        Self {
            channel: message.channel.clone(),
            ts: message.ts.clone(),
            thread_ts: message.thread_ts.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::monitor::message_handler::prepare_content::slack_message_for_content_from_value;

    #[test]
    fn identity_tracks_channel_message_and_thread_ts() {
        let message = slack_message_for_content_from_value(&json!({
            "type":"message","channel":"C1","ts":"2.0","thread_ts":"1.0"
        }))
        .unwrap();
        let identity = super::SlackMessageIdentity::from_message(&message);
        assert_eq!(identity.channel, "C1");
        assert_eq!(identity.ts.as_deref(), Some("2.0"));
        assert_eq!(identity.thread_ts.as_deref(), Some("1.0"));
    }
}
