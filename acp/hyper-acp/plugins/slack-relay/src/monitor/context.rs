//! OpenClaw `monitor/context.ts` equivalent for policy/config facts.

pub use crate::monitor::message_handler::prepare::{AllowBotsMode, DmPolicy, GroupPolicy};
pub use crate::monitor::provider::{
    ActiveSlackRelayConfig, ActiveSlackRelayControl, ActiveSlackRelayLifecycle,
    ActiveSlackRelayPolicy, HYPER_ACP_SLACK_ACCOUNT_ID_ENV, HYPER_ACP_SLACK_ALLOW_BOTS_ENV,
    HYPER_ACP_SLACK_ALLOW_FROM_ENV, HYPER_ACP_SLACK_ALLOW_NAME_MATCHING_ENV,
    HYPER_ACP_SLACK_BOT_ID_ENV, HYPER_ACP_SLACK_BOT_USER_ID_ENV, HYPER_ACP_SLACK_CHANNELS_ENV,
    HYPER_ACP_SLACK_CONTEXT_VISIBILITY_ENV, HYPER_ACP_SLACK_DIRECT_REPLY_TO_MODE_ENV,
    HYPER_ACP_SLACK_DISABLED_CHANNELS_ENV, HYPER_ACP_SLACK_DM_POLICY_ENV,
    HYPER_ACP_SLACK_DURABLE_LOG_ENV, HYPER_ACP_SLACK_GATEWAY_ID_ENV,
    HYPER_ACP_SLACK_GROUP_POLICY_ENV, HYPER_ACP_SLACK_IGNORE_OTHER_MENTIONS_ENV,
    HYPER_ACP_SLACK_MEDIA_MAX_BYTES_ENV, HYPER_ACP_SLACK_MENTION_PATTERNS_ENV,
    HYPER_ACP_SLACK_MENTION_SUBTEAMS_ENV, HYPER_ACP_SLACK_RELAY_API_URL_ENV,
    HYPER_ACP_SLACK_RELAY_URL_ENV, HYPER_ACP_SLACK_REPLY_TO_MODE_ENV,
    HYPER_ACP_SLACK_REQUIRE_MENTION_ENV, HYPER_ACP_SLACK_THREAD_HISTORY_LIMIT_ENV,
};
pub use crate::monitor::thread::SlackContextVisibility;

/// Runtime context facts consumed by OpenClaw-shaped monitor handlers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveSlackMonitorContext {
    /// Logical Slack account id.
    pub account_id: String,
    /// Meta-only legacy ACP session id (gateway id).
    pub session_id: String,
    /// Gateway id used by the relay source.
    pub gateway_id: String,
}

impl ActiveSlackMonitorContext {
    /// Builds context facts from the active relay config.
    #[must_use]
    pub fn from_config(config: &ActiveSlackRelayConfig) -> Self {
        Self {
            account_id: config.policy.account_id.clone(),
            session_id: config.session_id.clone(),
            gateway_id: config.relay.gateway_id.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::monitor::relay_source::SlackRelaySourceConfig;

    #[test]
    fn context_facts_come_from_active_config() {
        let config = ActiveSlackRelayConfig {
            relay: SlackRelaySourceConfig {
                url: "ws://relay".to_owned(),
                auth_token: "key".to_owned(),
                gateway_id: "agent:1".to_owned(),
            },
            session_id: "sess".to_owned(),
            policy: ActiveSlackRelayPolicy {
                account_id: "acct".to_owned(),
                ..ActiveSlackRelayPolicy::default()
            },
            durable_log_path: None,
        };
        let context = ActiveSlackMonitorContext::from_config(&config);
        assert_eq!(context.account_id, "acct");
        assert_eq!(context.gateway_id, "agent:1");
        assert_eq!(context.session_id, "sess");
    }
}
