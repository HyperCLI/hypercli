//! Slack DM authorization and pairing challenge helpers.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/dm-auth.ts` lines 10-67.
//! - `openclaw-git/src/security/context-visibility.ts` lines 27-76 for the
//!   shared fail-closed supplemental visibility shape used by related filters.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::SystemTime;

use crate::admission::{DmPolicy, SlackAdmissionFacts};
use crate::allowlist::{resolve_slack_allow_list_match, SlackAllowListMatchSource};
use crate::monitor::events::messages::SlackAcceptedEvent;
use crate::monitor::message_handler::dispatch::ActiveSlackRelayState;
use crate::monitor::provider::ActiveSlackRelayPolicy;
use crate::relay_source::HYPER_AGENTS_API_KEY_ENV;
use crate::reply::{
    deliver_slack_reply_payloads, SlackRelayApiProxyRequest, SlackRelayHttpSender,
    SlackReplyDeliveryTarget, SlackReplyPayload, SlackReplyToMode,
};

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

/// Durable pairing record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackPairingRecord {
    /// Slack account id.
    pub account_id: String,
    /// Slack user id.
    pub sender_id: String,
    /// Pairing code shown to the user/operator.
    pub code: String,
    /// Creation time.
    pub created_at: SystemTime,
    /// Approval state.
    pub approved: bool,
}

/// Pairing store boundary matching OpenClaw's DM auth responsibility.
pub trait SlackPairingStore {
    /// Returns an existing pairing record.
    fn get_pairing(&self, account_id: &str, sender_id: &str) -> Option<SlackPairingRecord>;
    /// Creates or returns an existing pairing challenge record.
    fn upsert_pairing_challenge(&mut self, account_id: &str, sender_id: &str)
        -> SlackPairingRecord;
    /// Approves a pairing challenge by code.
    fn approve_pairing_code(&mut self, account_id: &str, code: &str) -> Option<SlackPairingRecord>;
}

/// In-memory pairing store for tests and embedding hosts without a durable DB.
#[derive(Debug, Default, Clone)]
pub struct MemorySlackPairingStore {
    records: HashMap<(String, String), SlackPairingRecord>,
}

impl SlackPairingStore for MemorySlackPairingStore {
    fn get_pairing(&self, account_id: &str, sender_id: &str) -> Option<SlackPairingRecord> {
        self.records
            .get(&(account_id.to_owned(), sender_id.to_owned()))
            .cloned()
    }

    fn upsert_pairing_challenge(
        &mut self,
        account_id: &str,
        sender_id: &str,
    ) -> SlackPairingRecord {
        let key = (account_id.to_owned(), sender_id.to_owned());
        self.records
            .entry(key)
            .or_insert_with(|| SlackPairingRecord {
                account_id: account_id.to_owned(),
                sender_id: sender_id.to_owned(),
                code: build_pairing_code(account_id, sender_id),
                created_at: SystemTime::now(),
                approved: false,
            })
            .clone()
    }

    fn approve_pairing_code(&mut self, account_id: &str, code: &str) -> Option<SlackPairingRecord> {
        let record = self.records.values_mut().find(|record| {
            record.account_id == account_id && record.code.eq_ignore_ascii_case(code.trim())
        })?;
        record.approved = true;
        Some(record.clone())
    }
}

/// Applies OpenClaw DM authorization semantics, including pairing challenge
/// creation for `dmPolicy="pairing"`.
#[must_use]
pub fn authorize_slack_direct_message(
    input: &SlackDirectMessageAuthorizationInput,
) -> SlackDirectMessageAuthorization {
    authorize_slack_direct_message_with_pairing_store(input, None::<&mut MemorySlackPairingStore>)
}

/// Applies DM authorization with an optional pairing store.
#[must_use]
pub fn authorize_slack_direct_message_with_pairing_store<S: SlackPairingStore>(
    input: &SlackDirectMessageAuthorizationInput,
    mut pairing_store: Option<&mut S>,
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
        if pairing_store
            .as_deref()
            .and_then(|store| store.get_pairing(&input.account_id, &input.sender_id))
            .as_ref()
            .is_some_and(|record| record.approved)
        {
            return SlackDirectMessageAuthorization::Authorized {
                match_source: Some(SlackAllowListMatchSource::Id),
            };
        }
        let record = pairing_store
            .as_mut()
            .map(|store| store.upsert_pairing_challenge(&input.account_id, &input.sender_id));
        let code = record.as_ref().map_or_else(
            || build_pairing_code(&input.account_id, &input.sender_id),
            |record| record.code.clone(),
        );
        let meta = json!({
            "channel": "slack",
            "account_id": input.account_id,
            "sender_id": input.sender_id,
            "name": input.sender_name,
            "pairing_code": code,
        });
        return SlackDirectMessageAuthorization::PairingChallenge {
            text: format_pairing_challenge_text(&input.sender_id, &code),
            meta,
            sender_name: input.sender_name.clone(),
        };
    }
    SlackDirectMessageAuthorization::Unauthorized {
        allow_match_meta,
        sender_name: input.sender_name.clone(),
    }
}

/// Authorizes one active relay direct message after admission fact resolution.
pub async fn authorize_active_direct_message(
    facts: &SlackAdmissionFacts,
    policy: &ActiveSlackRelayPolicy,
    event: &SlackAcceptedEvent,
) -> SlackDirectMessageAuthorization {
    let mut transient = MemorySlackPairingStore::default();
    authorize_active_direct_message_with_pairing_store(facts, policy, event, &mut transient).await
}

/// Authorizes one active relay direct message using the runtime pairing store.
pub async fn authorize_active_direct_message_with_state(
    facts: &SlackAdmissionFacts,
    policy: &ActiveSlackRelayPolicy,
    event: &SlackAcceptedEvent,
    state: &mut ActiveSlackRelayState,
) -> SlackDirectMessageAuthorization {
    authorize_active_direct_message_with_pairing_store(facts, policy, event, &mut state.pairing)
        .await
}

async fn authorize_active_direct_message_with_pairing_store<S: SlackPairingStore>(
    facts: &SlackAdmissionFacts,
    policy: &ActiveSlackRelayPolicy,
    event: &SlackAcceptedEvent,
    pairing_store: &mut S,
) -> SlackDirectMessageAuthorization {
    let sender_id = facts
        .user_id
        .as_deref()
        .or(facts.bot_id.as_deref())
        .unwrap_or_default()
        .to_owned();
    let sender_name = resolve_active_dm_sender_name(policy, event, &sender_id).await;
    authorize_slack_direct_message_with_pairing_store(
        &SlackDirectMessageAuthorizationInput {
            account_id: policy.account_id.clone(),
            sender_id,
            allow_from_lower: policy.allow_from_lower.clone(),
            sender_name,
            allow_name_matching: policy.allow_name_matching,
            dm_policy: policy.dm_policy,
            dm_enabled: true,
        },
        Some(pairing_store),
    )
}

/// Sends a pairing challenge response through the relay API proxy when possible.
pub async fn maybe_send_pairing_challenge(
    policy: &ActiveSlackRelayPolicy,
    channel_id: &str,
    text: &str,
) {
    let Some(api_base) = policy.relay_api_base_url.as_deref() else {
        return;
    };
    let Ok(key) = std::env::var(HYPER_AGENTS_API_KEY_ENV) else {
        return;
    };
    let sender = SlackRelayHttpSender::new();
    let _result = deliver_slack_reply_payloads(
        &sender,
        SlackReplyDeliveryTarget {
            relay_api_base_url: api_base,
            hyper_agents_api_key: key.trim(),
            channel: channel_id,
            reply_thread_ts: None,
            reply_to_mode: SlackReplyToMode::Off,
            text_limit: crate::reply::SLACK_TEXT_LIMIT,
        },
        &[SlackReplyPayload {
            text: Some(text.to_owned()),
            media_urls: Vec::new(),
            blocks: Vec::new(),
            is_reasoning: false,
            reply_to_id: None,
            delivery_queue_id: None,
        }],
    )
    .await;
}

async fn resolve_active_dm_sender_name(
    policy: &ActiveSlackRelayPolicy,
    event: &SlackAcceptedEvent,
    sender_id: &str,
) -> Option<String> {
    if let Some(name) = resolve_slack_sender_name_from_message(&event.message)
        .or_else(|| resolve_slack_sender_name_from_message(&event.payload))
    {
        return Some(name);
    }
    async_slack_user_name_from_relay(policy, sender_id).await
}

async fn async_slack_user_name_from_relay(
    policy: &ActiveSlackRelayPolicy,
    sender_id: &str,
) -> Option<String> {
    if sender_id.trim().is_empty() {
        return None;
    }
    let api_base = policy.relay_api_base_url.as_deref()?;
    let key = std::env::var(HYPER_AGENTS_API_KEY_ENV)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())?;
    let request = build_users_info_proxy_request(api_base, &key, sender_id);
    let response = reqwest::Client::new()
        .post(&request.url)
        .header(reqwest::header::AUTHORIZATION, request.authorization)
        .json(&request.body)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    resolve_slack_user_name_from_info(&response)
}

fn resolve_slack_sender_name_from_message(value: &Value) -> Option<String> {
    value
        .get("sender_name")
        .or_else(|| value.get("senderName"))
        .or_else(|| value.get("username"))
        .or_else(|| value.get("name"))
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .get("user_profile")
                .or_else(|| value.get("userProfile"))
                .or_else(|| value.get("profile"))
                .and_then(|profile| {
                    profile
                        .get("display_name")
                        .or_else(|| profile.get("real_name"))
                        .or_else(|| profile.get("name"))
                        .and_then(Value::as_str)
                })
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

/// Formats an OpenClaw-style pairing challenge body for a Slack DM.
#[must_use]
pub fn format_pairing_challenge_text(sender_id: &str, code: &str) -> String {
    format!(
        "Slack pairing is required before this DM can control the agent.\nYour Slack user id: {sender_id}\nPairing code: {code}\nAsk an operator to approve this pairing request with /approve slack {code}."
    )
}

fn build_pairing_code(account_id: &str, sender_id: &str) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(account_id.as_bytes());
    hasher.update(b":");
    hasher.update(sender_id.as_bytes());
    let bytes = hasher.finalize();
    format!("{:02x}{:02x}{:02x}", bytes[0], bytes[1], bytes[2]).to_ascii_uppercase()
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
        assert!(text.contains("/approve slack"));
        assert!(meta.get("pairing_code").is_some());
        assert_eq!(meta["channel"], "slack");
    }

    #[test]
    fn pairing_store_roundtrip_approves_without_rechallenge() {
        let mut input = input(DmPolicy::Pairing);
        input.allow_from_lower.clear();
        let mut store = MemorySlackPairingStore::default();
        let first = authorize_slack_direct_message_with_pairing_store(&input, Some(&mut store));
        let SlackDirectMessageAuthorization::PairingChallenge { meta, .. } = first else {
            panic!("expected challenge");
        };
        let code = meta["pairing_code"].as_str().unwrap().to_owned();
        assert!(store.approve_pairing_code("acct", &code).is_some());
        assert!(matches!(
            authorize_slack_direct_message_with_pairing_store(&input, Some(&mut store)),
            SlackDirectMessageAuthorization::Authorized { .. }
        ));
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
