//! Slack inbound authorization, mention, and bot-loop gates.
//!
//! Thin Rust equivalent of OpenClaw's runtime-heavy prepare path:
//! - `openclaw-git/extensions/slack/src/monitor/policy.ts` lines 2-14.
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/prepare.ts`
//!   bot/sender/channel/DM gates lines 553-638, mention gates lines 1243-1305.
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/dispatch-helpers.ts`
//!   bot-loop facts lines 19-46.

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
