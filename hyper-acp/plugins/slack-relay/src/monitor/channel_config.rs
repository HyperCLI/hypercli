//! Slack channel configuration facts for monitor admission.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/channel-config.ts` channel
//!   enablement/config responsibility.
//! - `openclaw-git/extensions/slack/src/group-policy.ts` for allowlist/open
//!   channel policy inputs.
//!
//! HyperCLI deviation: channel configuration comes from relay environment
//! variables on `ActiveSlackRelayPolicy`, not OpenClaw account config storage.

use crate::monitor::provider::ActiveSlackRelayPolicy;

/// Returns whether a channel is explicitly allowed by HyperCLI relay config.
#[must_use]
pub fn channel_allowed(policy: &ActiveSlackRelayPolicy, channel_id: &str) -> bool {
    policy
        .allowed_channel_ids
        .iter()
        .any(|allowed| allowed == "*" || allowed.eq_ignore_ascii_case(channel_id))
}

/// Returns whether a channel is explicitly disabled by HyperCLI relay config.
#[must_use]
pub fn channel_disabled(policy: &ActiveSlackRelayPolicy, channel_id: &str) -> bool {
    policy
        .disabled_channel_ids
        .iter()
        .any(|denied| denied.eq_ignore_ascii_case(channel_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wildcard_and_disabled_channel_facts_are_case_aware() {
        let policy = ActiveSlackRelayPolicy {
            allowed_channel_ids: vec!["*".to_owned()],
            disabled_channel_ids: vec!["C1".to_owned()],
            ..ActiveSlackRelayPolicy::default()
        };
        assert!(channel_allowed(&policy, "C2"));
        assert!(channel_disabled(&policy, "c1"));
    }
}
