//! Slack inbound authorization, mention, and bot-loop gates.
//!
//! Thin Rust equivalent of OpenClaw's runtime-heavy prepare path:
//! - `openclaw-git/extensions/slack/src/monitor/policy.ts` lines 2-14.
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/prepare.ts`
//!   bot/sender/channel/DM gates lines 553-638, mention gates lines 1243-1305.
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/dispatch-helpers.ts`
//!   bot-loop facts lines 19-46.

use std::collections::HashMap;
use std::fmt::Write as _;

use regex::Regex;
use serde_json::Value;

use crate::monitor::channel_type::{classify_slack_channel, is_direct_channel};
use crate::monitor::events::messages::SlackAcceptedEvent;
use crate::monitor::message_handler::prepare_content::{
    build_rendered_mention_map_for_ids, collect_unique_slack_mention_ids, extract_slack_block_text,
    resolve_slack_message_content, SlackMessageForContent,
};
use crate::monitor::message_handler::prepare_dm_history::{
    extract_thread_history, extract_thread_starter_files,
    filter_slack_thread_history_for_visibility, format_slack_thread_history_body,
    hydrate_active_thread_starter_media, should_seed_initial_thread_context,
};
use crate::monitor::message_handler::prepare_routing::effective_reply_to_mode;
use crate::monitor::provider::ActiveSlackRelayPolicy;
use crate::monitor::relay_source::{SlackRelayRouteKind, HYPER_AGENTS_API_KEY_ENV};
use crate::monitor::replies::resolve_delivered_slack_reply_thread_ts;
use crate::monitor::thread::{fetch_slack_thread_history_via_relay, SlackSessionFreshness};

pub use crate::monitor::events::messages::{
    normalize_slack_event, slack_event_source, NormalizedSlackEvent, SlackEventSource,
};

/// Group channel policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroupPolicy {
    /// Allow all channels.
    Open,
    /// Disable group/channel messages.
    Disabled,
    /// Require channel allowlist match.
    Allowlist,
}

/// Direct-message policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DmPolicy {
    /// Allow all senders.
    Open,
    /// Disable DMs.
    Disabled,
    /// Require allowlist match.
    Allowlist,
    /// Pairing store controls authorization outside this pure helper.
    Pairing,
}

/// Bot message admission mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AllowBotsMode {
    /// Drop bot-authored messages.
    Off,
    /// Allow bot-authored messages.
    All,
    /// Allow only when mentioned or bypassed.
    Mentions,
}

/// Facts about the inbound Slack message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackAdmissionFacts {
    /// Channel id.
    pub channel_id: String,
    /// Optional sender user id.
    pub user_id: Option<String>,
    /// Optional sender bot id.
    pub bot_id: Option<String>,
    /// Text body.
    pub text: String,
    /// Direct message.
    pub is_direct_message: bool,
    /// Room/channel message.
    pub is_room: bool,
    /// Native bot user id.
    pub current_bot_user_id: Option<String>,
    /// Native bot id.
    pub current_bot_id: Option<String>,
}

/// Admission policy inputs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackAdmissionPolicy {
    /// Group policy.
    pub group_policy: GroupPolicy,
    /// Whether a channel allowlist entry exists.
    pub channel_allowlist_configured: bool,
    /// Whether this channel matched allowlist.
    pub channel_allowed: bool,
    /// Whether this channel was explicitly disabled by channel config.
    pub channel_explicitly_disabled: bool,
    /// DM policy.
    pub dm_policy: DmPolicy,
    /// Lowercase allow-from entries.
    pub allow_from_lower: Vec<String>,
    /// Whether room messages require mention.
    pub require_mention: bool,
    /// Bot admission mode.
    pub allow_bots: AllowBotsMode,
    /// Whether control commands bypass mention requirement.
    pub has_authorized_control_command: bool,
    /// Whether other user mentions should be dropped.
    pub ignore_other_mentions: bool,
}

/// Mention facts resolved by caller-specific Slack/runtime lookups.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackMentionFacts {
    /// Whether native mention detection is available.
    pub can_detect_mention: bool,
    /// Whether the current bot was mentioned.
    pub was_mentioned: bool,
    /// Whether the text had any Slack mention.
    pub has_any_mention: bool,
    /// Whether implicit thread participation/reply-to-bot applies.
    pub implicit_mention: bool,
}

/// Admission decision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlackAdmissionDecision {
    /// Accept the message.
    Accept,
    /// Drop with OpenClaw-compatible reason string.
    Drop(&'static str),
}

/// Bot-loop protection facts forwarded to the channel loop guard.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackBotLoopProtectionFacts {
    /// Account/scope id.
    pub scope_id: String,
    /// Slack channel id.
    pub conversation_id: String,
    /// Sender bot id.
    pub sender_id: String,
    /// Receiver bot id.
    pub receiver_id: String,
    /// Message timestamp in milliseconds when known.
    pub now_ms: Option<u64>,
}

/// Applies OpenClaw's group policy helper.
#[must_use]
pub fn is_slack_channel_allowed_by_policy(
    group_policy: GroupPolicy,
    channel_allowlist_configured: bool,
    channel_allowed: bool,
) -> bool {
    if group_policy == GroupPolicy::Disabled {
        return false;
    }
    group_policy != GroupPolicy::Allowlist || (channel_allowlist_configured && channel_allowed)
}

/// Applies the inbound Slack gate sequence.
#[must_use]
pub fn decide_slack_admission(
    facts: &SlackAdmissionFacts,
    policy: &SlackAdmissionPolicy,
    mentions: &SlackMentionFacts,
) -> SlackAdmissionDecision {
    let is_bot_message = facts.bot_id.is_some();
    if is_bot_message
        && facts
            .user_id
            .as_deref()
            .is_some_and(|user| Some(user) == facts.current_bot_user_id.as_deref())
    {
        return SlackAdmissionDecision::Drop("self-bot-user");
    }
    if is_bot_message && policy.allow_bots == AllowBotsMode::Off {
        return SlackAdmissionDecision::Drop("bot-message");
    }
    if facts.is_direct_message && facts.user_id.as_deref().unwrap_or("").is_empty() {
        return SlackAdmissionDecision::Drop("dm-missing-user");
    }
    let sender_id = facts.user_id.as_deref().or(if is_bot_message {
        facts.bot_id.as_deref()
    } else {
        None
    });
    if sender_id.unwrap_or("").is_empty() {
        return SlackAdmissionDecision::Drop("missing-sender");
    }
    if facts.is_room
        && !is_slack_channel_allowed_by_policy(
            policy.group_policy,
            policy.channel_allowlist_configured,
            policy.channel_allowed,
        )
    {
        return SlackAdmissionDecision::Drop("channel-not-allowed");
    }
    if facts.is_room
        && policy.group_policy == GroupPolicy::Open
        && policy.channel_explicitly_disabled
    {
        return SlackAdmissionDecision::Drop("channel-not-allowed");
    }
    if facts.is_direct_message
        && !is_direct_sender_allowed(
            policy.dm_policy,
            &policy.allow_from_lower,
            sender_id.unwrap_or_default(),
        )
    {
        return SlackAdmissionDecision::Drop("dm-unauthorized");
    }

    let effective_was_mentioned = mentions.was_mentioned
        || mentions.implicit_mention
        || policy.has_authorized_control_command;
    if is_bot_message
        && policy.allow_bots == AllowBotsMode::Mentions
        && !facts.is_direct_message
        && !effective_was_mentioned
    {
        return SlackAdmissionDecision::Drop("bot-message-missing-mention");
    }
    if facts.is_room
        && policy.require_mention
        && !mentions.can_detect_mention
        && !effective_was_mentioned
    {
        return SlackAdmissionDecision::Drop("mention-detection-unavailable");
    }
    if facts.is_room
        && policy.ignore_other_mentions
        && facts.current_bot_user_id.is_some()
        && mentions.has_any_mention
        && !mentions.was_mentioned
    {
        return SlackAdmissionDecision::Drop("other-mention");
    }
    if facts.is_room && policy.require_mention && !effective_was_mentioned {
        return SlackAdmissionDecision::Drop("no-mention");
    }
    SlackAdmissionDecision::Accept
}

/// Builds OpenClaw-style admission and mention facts from a normalized relay event.
#[must_use]
pub fn build_slack_admission_inputs(
    policy: &crate::monitor::provider::ActiveSlackRelayPolicy,
    event: &SlackAcceptedEvent,
    message: Option<&SlackMessageForContent>,
) -> (SlackAdmissionFacts, SlackMentionFacts) {
    let channel_id = message
        .map(|message| message.channel.clone())
        .or_else(|| {
            event
                .message
                .get("channel")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default();
    let text = message
        .and_then(|message| message.text.clone())
        .or_else(|| {
            event
                .message
                .get("text")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default();
    let user_id = message
        .and_then(|message| message.user.clone())
        .or_else(|| {
            event
                .message
                .get("user")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        });
    let bot_id = message
        .and_then(|message| message.bot_id.clone())
        .or_else(|| {
            event
                .message
                .get("bot_id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        });
    let is_direct_message = is_direct_channel(classify_slack_channel(&channel_id, &event.message));
    let facts = SlackAdmissionFacts {
        channel_id,
        user_id,
        bot_id,
        text: text.clone(),
        is_direct_message,
        is_room: !is_direct_message,
        current_bot_user_id: policy.current_bot_user_id.clone(),
        current_bot_id: policy.current_bot_id.clone(),
    };
    let direct_mention = policy
        .current_bot_user_id
        .as_deref()
        .is_some_and(|bot_user| text_mentions_user(&text, bot_user));
    let subteam_mention = subteam_mentions_policy(&text, &policy.mention_subteam_ids);
    let pattern_mention = pattern_mentions_policy(&text, &policy.mention_patterns);
    let source_app_mention =
        slack_event_source(&event.message) == Some(SlackEventSource::AppMention);
    let was_mentioned = source_app_mention || direct_mention || subteam_mention || pattern_mention;
    let has_any_mention = Regex::new(r"(?i)<@[A-Z0-9]+(?:\|[^>]+)?>|<!subteam\^[^>]+>")
        .expect("valid mention regex")
        .is_match(&text);
    let implicit_mention = facts.is_direct_message
        || source_app_mention
        || (event.transport
            == crate::monitor::events::messages::SlackAcceptedEventTransport::Relay
            && event.route.kind == SlackRelayRouteKind::ThreadAffinity)
        || message.is_some_and(|message| {
            message
                .parent_user_id
                .as_deref()
                .is_some_and(|parent| Some(parent) == policy.current_bot_user_id.as_deref())
        });
    let mentions = SlackMentionFacts {
        can_detect_mention: policy.current_bot_user_id.is_some()
            || !policy.mention_subteam_ids.is_empty()
            || !policy.mention_patterns.is_empty(),
        was_mentioned,
        has_any_mention,
        implicit_mention,
    };
    (facts, mentions)
}

/// Whether an inbound text command is authorized to bypass mention gating.
#[must_use]
pub fn has_authorized_control_command(text: &str) -> bool {
    let stripped = text.trim();
    matches!(stripped, "/stop" | "/cancel" | "stop" | "cancel")
}

/// Builds bot-loop facts for bot-to-bot messages.
#[must_use]
pub fn resolve_slack_bot_loop_protection(
    account_id: &str,
    facts: &SlackAdmissionFacts,
    message_timestamp_ms: Option<u64>,
) -> Option<SlackBotLoopProtectionFacts> {
    let sender_bot_id = facts.bot_id.as_ref()?;
    let receiver_bot_id = facts
        .current_bot_id
        .as_ref()
        .or(facts.current_bot_user_id.as_ref())?;
    if Some(sender_bot_id.as_str()) == facts.current_bot_id.as_deref()
        || facts
            .user_id
            .as_deref()
            .is_some_and(|user| Some(user) == facts.current_bot_user_id.as_deref())
    {
        return None;
    }
    Some(SlackBotLoopProtectionFacts {
        scope_id: account_id.to_owned(),
        conversation_id: facts.channel_id.clone(),
        sender_id: sender_bot_id.clone(),
        receiver_id: receiver_bot_id.clone(),
        now_ms: message_timestamp_ms,
    })
}

fn subteam_mentions_policy(text: &str, mention_subteam_ids: &[String]) -> bool {
    if mention_subteam_ids.is_empty() {
        return false;
    }
    let mentioned =
        Regex::new(r"(?i)<!subteam\^([^>|]+)(?:\|[^>]+)?>").expect("valid subteam mention regex");
    let matches = mentioned.captures_iter(text).any(|captures| {
        captures.get(1).is_some_and(|id| {
            mention_subteam_ids
                .iter()
                .any(|configured| configured.eq_ignore_ascii_case(id.as_str()))
        })
    });
    matches
}

fn pattern_mentions_policy(text: &str, mention_patterns: &[String]) -> bool {
    mention_patterns
        .iter()
        .filter_map(|pattern| Regex::new(pattern).ok())
        .any(|pattern| pattern.is_match(text))
}

fn text_mentions_user(text: &str, user_id: &str) -> bool {
    let escaped = regex::escape(user_id);
    Regex::new(&format!(r"(?i)<@{escaped}(?:\|[^>]+)?>"))
        .expect("valid dynamic mention regex")
        .is_match(text)
}

fn is_direct_sender_allowed(
    dm_policy: DmPolicy,
    allow_from_lower: &[String],
    sender_id: &str,
) -> bool {
    match dm_policy {
        DmPolicy::Open => true,
        DmPolicy::Disabled => false,
        DmPolicy::Allowlist | DmPolicy::Pairing => allow_from_lower
            .iter()
            .any(|entry| entry == "*" || entry == &sender_id.to_ascii_lowercase()),
    }
}

#[allow(clippy::too_many_lines)]
pub(crate) async fn build_active_prompt_text(
    policy: &ActiveSlackRelayPolicy,
    event: &SlackAcceptedEvent,
    message: Option<&SlackMessageForContent>,
) -> (String, Option<String>) {
    let is_thread_reply = message.is_some_and(|message| {
        match (message.thread_ts.as_deref(), message.ts.as_deref()) {
            (Some(thread_ts), Some(ts)) => thread_ts != ts || message.parent_user_id.is_some(),
            (Some(_), None) => true,
            _ => false,
        }
    });
    let thread_starter_files = extract_thread_starter_files(&event.payload);
    let hydrated_starter_media = hydrate_active_thread_starter_media(policy, &thread_starter_files)
        .await
        .unwrap_or_default();
    let body = message.and_then(|message| {
        let rendered_mentions = build_active_rendered_mention_map(event, message);
        resolve_slack_message_content(
            message,
            is_thread_reply,
            &thread_starter_files,
            &rendered_mentions,
        )
    });
    let mut parts = Vec::new();
    if !hydrated_starter_media.is_empty() {
        parts.push(
            hydrated_starter_media
                .iter()
                .map(|media| {
                    let mut line = media.placeholder.clone();
                    if let Some(url) = media.url.as_deref() {
                        let _ = write!(line, " {url}");
                    }
                    line
                })
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }
    let mut history = extract_thread_history(&event.payload);
    if history.is_none() && is_thread_reply && policy.thread_initial_history_limit > 0 {
        if let (Some(api_base), Some(message)) = (policy.relay_api_base_url.as_deref(), message) {
            if let Some(thread_ts) = message.thread_ts.as_deref() {
                let client = reqwest::Client::new();
                let relay_api_key = std::env::var(HYPER_AGENTS_API_KEY_ENV)
                    .ok()
                    .map(|value| value.trim().to_owned())
                    .filter(|value| !value.is_empty());
                if let Some(relay_api_key) = relay_api_key {
                    if let Ok(resolution) = fetch_slack_thread_history_via_relay(
                        &client,
                        api_base,
                        &relay_api_key,
                        &message.channel,
                        thread_ts,
                        message.ts.as_deref(),
                        policy.thread_initial_history_limit,
                    )
                    .await
                    {
                        history = Some(resolution.messages);
                    }
                }
            }
        }
    }
    if let Some(history) = history {
        let should_seed = should_seed_initial_thread_context(
            is_thread_reply,
            message.and_then(|message| message.thread_ts.as_deref()),
            Some(SlackSessionFreshness::Missing),
            None,
        );
        if should_seed {
            let filtered = filter_slack_thread_history_for_visibility(
                &history,
                policy.context_visibility,
                &policy.allow_from_lower,
                policy.allow_name_matching,
                policy.current_bot_user_id.as_deref(),
                policy.current_bot_id.as_deref(),
            );
            if let Some(history_body) = format_slack_thread_history_body(
                &filtered.kept,
                message.map_or("", |message| message.channel.as_str()),
                policy.current_bot_user_id.as_deref(),
                policy.current_bot_id.as_deref(),
            ) {
                parts.push(history_body);
            }
        }
    }
    parts.push(body.map_or_else(
        || {
            event
                .message
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_owned()
        },
        |content| content.body_with_metadata,
    ));
    let prompt = parts
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let reply_thread_ts = message.and_then(|message| {
        resolve_delivered_slack_reply_thread_ts(
            effective_reply_to_mode(policy, message.channel.starts_with('D')),
            event.message.get("reply_to").and_then(Value::as_str),
            message.thread_ts.as_deref().or(message.ts.as_deref()),
        )
    });
    (prompt, reply_thread_ts)
}

fn build_active_rendered_mention_map(
    event: &SlackAcceptedEvent,
    message: &SlackMessageForContent,
) -> HashMap<String, Option<String>> {
    let mut texts = vec![
        message.text.clone(),
        extract_slack_block_text(&message.blocks),
    ];
    texts.extend(
        message
            .attachments
            .iter()
            .flat_map(|attachment| [attachment.text.clone(), attachment.fallback.clone()]),
    );
    let ids = collect_unique_slack_mention_ids(&texts);
    let names = ids
        .iter()
        .map(|id| (id.clone(), resolve_mention_name_from_payload(event, id)))
        .collect::<HashMap<_, _>>();
    build_rendered_mention_map_for_ids(ids.iter().map(String::as_str), &names)
}

fn resolve_mention_name_from_payload(event: &SlackAcceptedEvent, user_id: &str) -> Option<String> {
    [
        event.payload.get("users"),
        event.payload.get("user_profiles"),
        event.payload.get("userProfiles"),
        event.message.get("users"),
        event.message.get("user_profiles"),
    ]
    .into_iter()
    .flatten()
    .find_map(|value| {
        if let Some(map) = value.as_object() {
            return map.get(user_id).and_then(resolve_name_value);
        }
        value.as_array().and_then(|items| {
            items.iter().find_map(|item| {
                let matches_id = item
                    .get("id")
                    .or_else(|| item.get("user"))
                    .and_then(Value::as_str)
                    .is_some_and(|id| id == user_id);
                matches_id.then(|| resolve_name_value(item)).flatten()
            })
        })
    })
}

fn resolve_name_value(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .or_else(|| {
            value
                .get("profile")
                .and_then(|profile| {
                    profile
                        .get("display_name")
                        .or_else(|| profile.get("real_name"))
                        .or_else(|| profile.get("name"))
                        .and_then(Value::as_str)
                })
                .or_else(|| value.get("display_name").and_then(Value::as_str))
                .or_else(|| value.get("real_name").and_then(Value::as_str))
                .or_else(|| value.get("name").and_then(Value::as_str))
                .map(ToOwned::to_owned)
        })
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> SlackAdmissionFacts {
        SlackAdmissionFacts {
            channel_id: "C1".to_owned(),
            user_id: Some("U1".to_owned()),
            bot_id: None,
            text: "hi".to_owned(),
            is_direct_message: false,
            is_room: true,
            current_bot_user_id: Some("UBOT".to_owned()),
            current_bot_id: Some("BBOT".to_owned()),
        }
    }

    fn policy() -> SlackAdmissionPolicy {
        SlackAdmissionPolicy {
            group_policy: GroupPolicy::Open,
            channel_allowlist_configured: false,
            channel_allowed: false,
            channel_explicitly_disabled: false,
            dm_policy: DmPolicy::Open,
            allow_from_lower: vec![],
            require_mention: true,
            allow_bots: AllowBotsMode::Off,
            has_authorized_control_command: false,
            ignore_other_mentions: false,
        }
    }

    #[test]
    fn group_policy_matches_openclaw() {
        assert!(!is_slack_channel_allowed_by_policy(
            GroupPolicy::Disabled,
            true,
            true
        ));
        assert!(is_slack_channel_allowed_by_policy(
            GroupPolicy::Open,
            false,
            false
        ));
        assert!(!is_slack_channel_allowed_by_policy(
            GroupPolicy::Allowlist,
            false,
            true
        ));
        assert!(is_slack_channel_allowed_by_policy(
            GroupPolicy::Allowlist,
            true,
            true
        ));
    }

    #[test]
    fn required_mention_gate_drops_unmentioned_room() {
        assert_eq!(
            decide_slack_admission(
                &facts(),
                &policy(),
                &SlackMentionFacts {
                    can_detect_mention: true,
                    was_mentioned: false,
                    has_any_mention: false,
                    implicit_mention: false,
                },
            ),
            SlackAdmissionDecision::Drop("no-mention")
        );
    }

    #[test]
    fn authorized_control_command_bypasses_mention() {
        let mut policy = policy();
        policy.has_authorized_control_command = true;
        assert_eq!(
            decide_slack_admission(
                &facts(),
                &policy,
                &SlackMentionFacts {
                    can_detect_mention: true,
                    was_mentioned: false,
                    has_any_mention: false,
                    implicit_mention: false,
                },
            ),
            SlackAdmissionDecision::Accept
        );
    }

    #[test]
    fn open_group_policy_honors_explicit_channel_disable() {
        let mut policy = policy();
        policy.require_mention = false;
        policy.channel_explicitly_disabled = true;
        assert_eq!(
            decide_slack_admission(
                &facts(),
                &policy,
                &SlackMentionFacts {
                    can_detect_mention: true,
                    was_mentioned: false,
                    has_any_mention: false,
                    implicit_mention: false,
                },
            ),
            SlackAdmissionDecision::Drop("channel-not-allowed")
        );
    }

    #[test]
    fn bot_loop_facts_skip_current_bot_and_keep_other_bot() {
        let mut facts = facts();
        facts.user_id = None;
        facts.bot_id = Some("BOTHER".to_owned());
        assert_eq!(
            resolve_slack_bot_loop_protection("acct", &facts, Some(10))
                .unwrap()
                .receiver_id,
            "BBOT"
        );
        facts.bot_id = Some("BBOT".to_owned());
        assert!(resolve_slack_bot_loop_protection("acct", &facts, Some(10)).is_none());
    }
}
