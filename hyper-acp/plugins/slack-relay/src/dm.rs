//! Slack DM authorization and pairing challenge helpers.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/dm-auth.ts` lines 10-67.
//! - `openclaw-git/src/security/context-visibility.ts` lines 27-76 for the
//!   shared fail-closed supplemental visibility shape used by related filters.

use serde_json::{json, Value};

use crate::admission::DmPolicy;
use crate::allowlist::{resolve_slack_allow_list_match, SlackAllowListMatchSource};
use crate::reply::SlackRelayApiProxyRequest;

/// Builds one relay-authenticated `users.info` proxy request.
#[must_use]
pub fn build_users_info_proxy_request(
    relay_api_base_url: &str,
    hyper_agents_api_key: &str,
    user_id: &str,
) -> SlackRelayApiProxyRequest {
    SlackRelayApiProxyRequest {
        method: "POST".to_owned(),
        url: format!(
            "{}/slack/api/users.info",
            relay_api_base_url.trim_end_matches('/')
        ),
        authorization: format!("Bearer {hyper_agents_api_key}"),
        body: json!({ "user": user_id }),
    }
}

/// Resolves a Slack display/name from a `users.info` response.
#[must_use]
pub fn resolve_slack_user_name_from_info(response: &Value) -> Option<String> {
    let user = response.get("user").or(Some(response))?;
    user.get("profile")
        .and_then(|profile| {
            profile
                .get("display_name")
                .or_else(|| profile.get("real_name"))
                .or_else(|| profile.get("first_name"))
                .and_then(Value::as_str)
        })
        .or_else(|| user.get("real_name").and_then(Value::as_str))
        .or_else(|| user.get("name").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

/// Outcome of direct-message authorization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlackDirectMessageAuthorization {
    /// DM is authorized.
    Authorized {
        /// Matched allowlist source, when authorization came from allowlist.
        match_source: Option<SlackAllowListMatchSource>,
    },
    /// DM feature is disabled.
    Disabled,
    /// Sender is not authorized.
    Unauthorized {
        /// Audit string describing the allowlist miss.
        allow_match_meta: String,
        /// Resolved sender name, when available.
        sender_name: Option<String>,
    },
    /// Pairing mode issued a challenge and withheld the user message.
    PairingChallenge {
        /// User-visible Slack response text.
        text: String,
        /// Durable pairing metadata.
        meta: Value,
        /// Resolved sender name, when available.
        sender_name: Option<String>,
    },
}

/// DM authorization inputs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackDirectMessageAuthorizationInput {
    /// Slack account id.
    pub account_id: String,
    /// Slack sender id.
    pub sender_id: String,
    /// Lowercase allow-from list.
    pub allow_from_lower: Vec<String>,
    /// Resolved Slack display/name, when available.
    pub sender_name: Option<String>,
    /// Whether OpenClaw's dangerous name matching mode is enabled.
    pub allow_name_matching: bool,
    /// DM policy.
    pub dm_policy: DmPolicy,
    /// Whether DMs are enabled at all.
    pub dm_enabled: bool,
}

/// Applies OpenClaw DM authorization semantics, including pairing challenge
/// creation for `dmPolicy="pairing"`.
#[must_use]
pub fn authorize_slack_direct_message(
    input: &SlackDirectMessageAuthorizationInput,
) -> SlackDirectMessageAuthorization {
    if !input.dm_enabled || input.dm_policy == DmPolicy::Disabled {
        return SlackDirectMessageAuthorization::Disabled;
    }
    if input.dm_policy == DmPolicy::Open {
        return SlackDirectMessageAuthorization::Authorized { match_source: None };
    }
    let allow_match = resolve_slack_allow_list_match(
        &input.allow_from_lower,
        Some(&input.sender_id),
        input.sender_name.as_deref(),
        input.allow_name_matching,
    );
    if allow_match.allowed {
        return SlackDirectMessageAuthorization::Authorized {
            match_source: allow_match.match_source,
        };
    }
    let allow_match_meta = format_allowlist_match_meta(allow_match.match_source);
    if input.dm_policy == DmPolicy::Pairing {
        let meta = json!({
            "channel": "slack",
            "account_id": input.account_id,
            "sender_id": input.sender_id,
            "name": input.sender_name,
        });
        return SlackDirectMessageAuthorization::PairingChallenge {
            text: format_pairing_challenge_text(&input.sender_id),
            meta,
            sender_name: input.sender_name.clone(),
        };
    }
    SlackDirectMessageAuthorization::Unauthorized {
        allow_match_meta,
        sender_name: input.sender_name.clone(),
    }
}

/// Formats an OpenClaw-style pairing challenge body for a Slack DM.
#[must_use]
pub fn format_pairing_challenge_text(sender_id: &str) -> String {
    format!(
        "Slack pairing is required before this DM can control the agent.\nYour Slack user id: {sender_id}\nAsk an operator to approve this pairing request with /approve slack {sender_id}."
    )
}

fn format_allowlist_match_meta(source: Option<SlackAllowListMatchSource>) -> String {
    source.map_or_else(
        || "allowlist=no-match".to_owned(),
        |source| format!("allowlist=matched:{source:?}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(dm_policy: DmPolicy) -> SlackDirectMessageAuthorizationInput {
        SlackDirectMessageAuthorizationInput {
            account_id: "acct".to_owned(),
            sender_id: "U123".to_owned(),
            allow_from_lower: vec!["ada-lovelace".to_owned()],
            sender_name: Some("Ada Lovelace".to_owned()),
            allow_name_matching: true,
            dm_policy,
            dm_enabled: true,
        }
    }

    #[test]
    fn allowlist_uses_resolved_name_when_enabled() {
        assert_eq!(
            authorize_slack_direct_message(&input(DmPolicy::Allowlist)),
            SlackDirectMessageAuthorization::Authorized {
                match_source: Some(SlackAllowListMatchSource::Slug),
            }
        );
    }

    #[test]
    fn pairing_issues_challenge_for_unmatched_sender() {
        let mut input = input(DmPolicy::Pairing);
        input.allow_from_lower.clear();
        let result = authorize_slack_direct_message(&input);
        let SlackDirectMessageAuthorization::PairingChallenge { text, meta, .. } = result else {
            panic!("expected pairing challenge");
        };
        assert!(text.contains("Your Slack user id: U123"));
        assert_eq!(meta["channel"], "slack");
    }

    #[test]
    fn open_policy_authorizes_without_wildcard_for_hyperclaw_relay_default() {
        let mut input = input(DmPolicy::Open);
        input.allow_from_lower.clear();
        assert!(matches!(
            authorize_slack_direct_message(&input),
            SlackDirectMessageAuthorization::Authorized { .. }
        ));
    }

    #[test]
    fn user_info_request_and_name_resolution_preserve_relay_boundary() {
        let request = build_users_info_proxy_request("https://relay.example/", "key", "U123");
        assert_eq!(request.url, "https://relay.example/slack/api/users.info");
        assert_eq!(request.authorization, "Bearer key");
        assert_eq!(request.body["user"], "U123");
        assert_eq!(
            resolve_slack_user_name_from_info(
                &json!({"user":{"profile":{"display_name":"Ada"},"name":"ada_fallback"}})
            )
            .as_deref(),
            Some("Ada")
        );
    }
}
