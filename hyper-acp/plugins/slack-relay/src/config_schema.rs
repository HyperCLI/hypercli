//! Slack connector config/account/channel surface.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/config-schema.ts`.
//! - `openclaw-git/extensions/slack/src/accounts.ts`.
//! - `openclaw-git/extensions/slack/src/account-reply-mode.ts`.
//! - `openclaw-git/extensions/slack/src/channel-type.ts`.
//!
//! This module keeps provider configuration as data first. Environment parsing
//! in `monitor/provider.rs` is an adapter into these shapes.

use crate::admission::{AllowBotsMode, DmPolicy, GroupPolicy};
use crate::monitor::channel_type::SlackMonitorChannelType;
use crate::reply::SlackReplyToMode;

/// Connector runtime transport mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackConnectorMode {
    /// HyperCLI Slack relay websocket.
    Relay,
    /// Slack Events API HTTP callbacks.
    Http,
    /// Slack Socket Mode.
    Socket,
}

/// Slack account-level connector config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackAccountConfig {
    /// Logical Slack account id.
    pub account_id: String,
    /// Runtime mode.
    pub mode: SlackConnectorMode,
    /// Default group/channel policy.
    pub group_policy: GroupPolicy,
    /// Default direct-message policy.
    pub dm_policy: DmPolicy,
    /// Bot-message policy.
    pub allow_bots: AllowBotsMode,
    /// Default channel reply behavior.
    pub reply_to_mode: SlackReplyToMode,
    /// Default DM reply behavior.
    pub direct_reply_to_mode: SlackReplyToMode,
    /// Optional bot token secret reference/value for direct Web API mode.
    pub bot_token: Option<String>,
    /// Optional app-level token secret reference/value for Socket Mode.
    pub app_token: Option<String>,
    /// Optional user token secret reference/value for read-only Slack API calls.
    pub user_token: Option<String>,
    /// Keep user token read-only by default.
    pub user_token_read_only: bool,
    /// Optional request signing secret for HTTP Events API mode.
    pub signing_secret: Option<String>,
    /// HTTP webhook path for Events API callbacks.
    pub webhook_path: String,
    /// Relay transport config.
    pub relay: SlackRelayConfig,
    /// Whether room messages require explicit/implicit mention.
    pub require_mention: bool,
    /// Whether to ignore messages mentioning other users.
    pub ignore_other_mentions: bool,
    /// Implicit mention aliases/patterns.
    pub implicit_mentions: Vec<String>,
    /// Bot loop protection mode.
    pub bot_loop_protection: Option<String>,
    /// Whether Slack should unfurl links.
    pub unfurl_links: Option<bool>,
    /// Whether Slack should unfurl media.
    pub unfurl_media: Option<bool>,
    /// Reaction event config.
    pub reactions: SlackReactionConfig,
    /// Enabled Slack Web API action surfaces.
    pub actions: SlackActionConfig,
    /// Thread context config.
    pub thread: SlackThreadConfig,
    /// DM runtime config.
    pub dm: SlackDmConfig,
    /// Presence event config.
    pub presence_events: SlackPresenceEventsConfig,
    /// Per-channel config entries.
    pub channels: Vec<SlackChannelConfig>,
}

impl SlackAccountConfig {
    /// Creates an account config with OpenClaw-compatible defaults for active
    /// message monitoring.
    #[must_use]
    pub fn new(account_id: impl Into<String>, mode: SlackConnectorMode) -> Self {
        Self {
            account_id: account_id.into(),
            mode,
            group_policy: GroupPolicy::Open,
            dm_policy: DmPolicy::Open,
            allow_bots: AllowBotsMode::Off,
            reply_to_mode: SlackReplyToMode::All,
            direct_reply_to_mode: SlackReplyToMode::Off,
            bot_token: None,
            app_token: None,
            user_token: None,
            user_token_read_only: true,
            signing_secret: None,
            webhook_path: "/slack/events".to_owned(),
            relay: SlackRelayConfig::default(),
            require_mention: false,
            ignore_other_mentions: false,
            implicit_mentions: Vec::new(),
            bot_loop_protection: None,
            unfurl_links: None,
            unfurl_media: None,
            reactions: SlackReactionConfig::default(),
            actions: SlackActionConfig::default(),
            thread: SlackThreadConfig::default(),
            dm: SlackDmConfig::default(),
            presence_events: SlackPresenceEventsConfig::default(),
            channels: Vec::new(),
        }
    }
}

/// Relay transport config.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SlackRelayConfig {
    /// Relay websocket URL.
    pub url: Option<String>,
    /// Relay auth token/secret reference.
    pub auth_token: Option<String>,
    /// Relay gateway id.
    pub gateway_id: Option<String>,
}

/// Reaction notification config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackReactionConfig {
    /// `off`, `own`, `all`, or `allowlist`.
    pub mode: String,
    /// Reaction actor allowlist.
    pub allowlist: Vec<String>,
    /// Optional acknowledgement reaction.
    pub ack_reaction: Option<String>,
}

impl Default for SlackReactionConfig {
    fn default() -> Self {
        Self {
            mode: "all".to_owned(),
            allowlist: Vec::new(),
            ack_reaction: None,
        }
    }
}

/// Slack action surface config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackActionConfig {
    /// Enable reaction actions.
    pub reactions: bool,
    /// Enable message read/send/update actions.
    pub messages: bool,
    /// Enable pin actions.
    pub pins: bool,
    /// Enable search actions.
    pub search: bool,
    /// Enable permission inspection actions.
    pub permissions: bool,
    /// Enable member info lookup.
    pub member_info: bool,
    /// Enable channel info lookup.
    pub channel_info: bool,
    /// Enable emoji list lookup.
    pub emoji_list: bool,
}

impl Default for SlackActionConfig {
    fn default() -> Self {
        Self {
            reactions: true,
            messages: true,
            pins: true,
            search: false,
            permissions: false,
            member_info: true,
            channel_info: true,
            emoji_list: false,
        }
    }
}

/// Thread context config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackThreadConfig {
    /// `thread` or `channel`.
    pub history_scope: String,
    /// Whether child replies inherit parent message context.
    pub inherit_parent: bool,
    /// Initial history limit for new/stale sessions.
    pub initial_history_limit: usize,
}

impl Default for SlackThreadConfig {
    fn default() -> Self {
        Self {
            history_scope: "thread".to_owned(),
            inherit_parent: true,
            initial_history_limit: 20,
        }
    }
}

/// Direct-message config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackDmConfig {
    /// Whether one-to-one DMs are enabled.
    pub enabled: bool,
    /// Whether MPIM/group DMs are enabled.
    pub group_enabled: bool,
    /// Allowed MPIM/group DM channel ids.
    pub group_channels: Vec<String>,
}

impl Default for SlackDmConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            group_enabled: true,
            group_channels: Vec::new(),
        }
    }
}

/// Presence event config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackPresenceEventsConfig {
    /// `off`, `auto`, or `on`.
    pub mode: String,
}

impl Default for SlackPresenceEventsConfig {
    fn default() -> Self {
        Self {
            mode: "auto".to_owned(),
        }
    }
}

/// Per-channel config entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackChannelConfig {
    /// Slack channel id or configured key.
    pub key: String,
    /// Slack channel type.
    pub channel_type: SlackMonitorChannelType,
    /// Explicit enabled/disabled state.
    pub enabled: bool,
    /// Optional per-channel reply override.
    pub reply_to_mode: Option<SlackReplyToMode>,
    /// Optional per-channel mention requirement.
    pub require_mention: Option<bool>,
    /// Optional per-channel bot-message policy.
    pub allow_bots: Option<AllowBotsMode>,
    /// Per-channel user allowlist.
    pub users: Vec<String>,
    /// Per-channel presence config.
    pub presence_events: Option<SlackPresenceEventsConfig>,
}

/// Effective channel config after applying account defaults and channel entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackEffectiveChannelConfig {
    /// Slack channel type.
    pub channel_type: SlackMonitorChannelType,
    /// Whether messages from this channel may enter the monitor.
    pub enabled: bool,
    /// Effective reply mode.
    pub reply_to_mode: SlackReplyToMode,
}

/// Resolves account/channel config into a single effective value.
#[must_use]
pub fn resolve_effective_channel_config(
    account: &SlackAccountConfig,
    channel: Option<&SlackChannelConfig>,
) -> SlackEffectiveChannelConfig {
    let channel_type = channel.map_or(SlackMonitorChannelType::Room, |channel| {
        channel.channel_type
    });
    let is_dm = matches!(channel_type, SlackMonitorChannelType::DirectMessage);
    SlackEffectiveChannelConfig {
        channel_type,
        enabled: channel.is_none_or(|channel| channel.enabled),
        reply_to_mode: channel
            .and_then(|channel| channel.reply_to_mode)
            .unwrap_or(if is_dm {
                account.direct_reply_to_mode
            } else {
                account.reply_to_mode
            }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_defaults_and_channel_override_match_runtime_policy() {
        let account = SlackAccountConfig::new("acct", SlackConnectorMode::Socket);
        let channel = SlackChannelConfig {
            key: "D1".to_owned(),
            channel_type: SlackMonitorChannelType::DirectMessage,
            enabled: true,
            reply_to_mode: None,
            require_mention: None,
            allow_bots: None,
            users: Vec::new(),
            presence_events: None,
        };
        let effective = resolve_effective_channel_config(&account, Some(&channel));
        assert_eq!(effective.reply_to_mode, SlackReplyToMode::Off);
        assert!(effective.enabled);
    }
}
