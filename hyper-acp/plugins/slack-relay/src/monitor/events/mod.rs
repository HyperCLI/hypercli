//! OpenClaw `monitor/events.ts` and `monitor/events/*` boundary.

pub mod agent;
pub mod assistant;
pub mod channels;
pub mod direct;
pub mod home;
pub mod interactions;
pub mod members;
pub mod messages;
pub mod pins;
pub mod reactions;

use serde_json::Value;

/// Policy needed to route non-message events without importing host runtime APIs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackEventRoutingPolicy {
    /// Logical Slack account id.
    pub account_id: String,
    /// Allowed channel ids. Empty means no allowlist restriction.
    pub allowed_channel_ids: Vec<String>,
    /// Explicitly disabled channel ids.
    pub disabled_channel_ids: Vec<String>,
    /// Current bot user id used by reaction ownership routing.
    pub bot_user_id: Option<String>,
    /// Reaction notification mode: `off`, `own`, `all`, or `allowlist`.
    pub reaction_mode: String,
    /// Reaction actor allowlist for `allowlist` mode.
    pub reaction_allowlist_lower: Vec<String>,
}

impl Default for SlackEventRoutingPolicy {
    fn default() -> Self {
        Self {
            account_id: "default".to_owned(),
            allowed_channel_ids: Vec::new(),
            disabled_channel_ids: Vec::new(),
            bot_user_id: None,
            reaction_mode: "all".to_owned(),
            reaction_allowlist_lower: Vec::new(),
        }
    }
}

/// Concrete host-side system event plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackConnectorSystemEvent {
    /// Stable session routing key.
    pub session_key: String,
    /// Stable context/dedupe key.
    pub context_key: String,
    /// User-visible event text.
    pub text: String,
}

/// Source-shaped handling action for Slack event families outside the message
/// prompt path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlackEventFamilyAction {
    /// Message edit/delete subtype should be delivered to the host system-event queue.
    MessageSubtype {
        /// Normalized event facts.
        event: messages::SlackMessageSubtypeEvent,
        /// Concrete side-effect plan.
        system_event: SlackConnectorSystemEvent,
    },
    /// Reaction event should be delivered to the host system-event queue.
    Reaction {
        /// Normalized event facts.
        event: reactions::SlackReactionEvent,
        /// Concrete side-effect plan.
        system_event: SlackConnectorSystemEvent,
    },
    /// Channel lifecycle event should refresh channel caches/config.
    Channel {
        /// Normalized event facts.
        event: channels::SlackChannelEvent,
        /// Concrete side-effect plan, when the channel is admitted by policy.
        system_event: Option<SlackConnectorSystemEvent>,
        /// Config migration required for `channel_id_changed`.
        migration: Option<SlackChannelConfigMigration>,
    },
    /// Channel membership event should refresh membership caches/config.
    Member {
        /// Normalized event facts.
        event: members::SlackMemberEvent,
        /// Concrete side-effect plan.
        system_event: SlackConnectorSystemEvent,
    },
    /// Pin event should be delivered to the host system-event queue.
    Pin {
        /// Normalized event facts.
        event: pins::SlackPinEvent,
        /// Concrete side-effect plan.
        system_event: SlackConnectorSystemEvent,
    },
    /// App Home event should route to home rendering/update logic.
    HomeOpened {
        /// Slack user id that opened App Home.
        user: Option<String>,
    },
    /// Slack assistant event should route to assistant-thread handling.
    Assistant {
        /// Slack assistant event type.
        event_type: String,
    },
    /// Slack agent event should route to agent-thread handling.
    Agent {
        /// Slack agent event type.
        event_type: String,
    },
    /// Slack interaction payload should route to interaction handling.
    Interaction {
        /// Interaction kind.
        kind: interactions::SlackInteractionKind,
        /// Sanitized system-event plan.
        system_event: SlackConnectorSystemEvent,
    },
}

/// Channel config migration requested by a channel lifecycle event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackChannelConfigMigration {
    /// Old Slack channel id.
    pub old_channel_id: String,
    /// New Slack channel id.
    pub new_channel_id: String,
}

/// Dispatches non-message Slack event families into source-shaped actions.
#[must_use]
pub fn dispatch_slack_event_family(payload: &Value) -> Option<SlackEventFamilyAction> {
    dispatch_slack_event_family_with_policy(payload, &SlackEventRoutingPolicy::default())
}

/// Dispatches non-message Slack event families into policy-aware connector actions.
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn dispatch_slack_event_family_with_policy(
    payload: &Value,
    policy: &SlackEventRoutingPolicy,
) -> Option<SlackEventFamilyAction> {
    let event = payload
        .get("event")
        .filter(|event| event.is_object())
        .unwrap_or(payload);
    if let Some(message_subtype) = messages::classify_message_subtype_event(event) {
        return Some(SlackEventFamilyAction::MessageSubtype {
            system_event: SlackConnectorSystemEvent {
                session_key: session_key(policy, &message_subtype.channel),
                context_key: message_subtype.context_key.clone(),
                text: format!(
                    "Slack message {} in {}.",
                    match message_subtype.kind {
                        messages::SlackMessageSubtypeKind::Changed => "changed",
                        messages::SlackMessageSubtypeKind::Deleted => "deleted",
                    },
                    channel_label(&message_subtype.channel, None)
                ),
            },
            event: message_subtype,
        });
    }
    if let Some(reaction) = reactions::classify_reaction_event(event) {
        if !reaction_allowed(policy, &reaction) || !channel_routable(policy, &reaction.channel) {
            return None;
        }
        let action = match reaction.action {
            reactions::SlackReactionAction::Added => "added",
            reactions::SlackReactionAction::Removed => "removed",
        };
        return Some(SlackEventFamilyAction::Reaction {
            system_event: SlackConnectorSystemEvent {
                session_key: session_key(policy, &reaction.channel),
                context_key: format!(
                    "slack:reaction:{action}:{}:{}:{}:{}",
                    reaction.channel, reaction.ts, reaction.user, reaction.reaction
                ),
                text: format!(
                    "Slack reaction {action}: :{}: by {} in {} msg {}{}",
                    reaction.reaction,
                    reaction.user,
                    channel_label(&reaction.channel, None),
                    reaction.ts,
                    reaction
                        .item_user
                        .as_deref()
                        .map(|user| format!(" from {user}"))
                        .unwrap_or_default()
                ),
            },
            event: reaction,
        });
    }
    if let Some(channel) = channels::classify_channel_event(event) {
        let action = match channel.kind {
            channels::SlackChannelEventKind::Created => Some("created"),
            channels::SlackChannelEventKind::Renamed => Some("renamed"),
            _ => None,
        };
        let system_event = action
            .filter(|_| channel_routable(policy, &channel.channel))
            .map(|action| SlackConnectorSystemEvent {
                session_key: session_key(policy, &channel.channel),
                context_key: format!("slack:channel:{action}:{}", channel.channel),
                text: format!(
                    "Slack channel {action}: {}.",
                    channel_label(&channel.channel, channel.name.as_deref())
                ),
            });
        let migration = if channel.kind == channels::SlackChannelEventKind::IdChanged {
            channel
                .old_channel
                .as_ref()
                .map(|old| SlackChannelConfigMigration {
                    old_channel_id: old.clone(),
                    new_channel_id: channel.channel.clone(),
                })
        } else {
            None
        };
        return Some(SlackEventFamilyAction::Channel {
            event: channel,
            system_event,
            migration,
        });
    }
    if let Some(member) = members::classify_member_event(event) {
        if !channel_routable(policy, &member.channel) {
            return None;
        }
        let verb = match member.action {
            members::SlackMemberAction::Joined => "joined",
            members::SlackMemberAction::Left => "left",
        };
        return Some(SlackEventFamilyAction::Member {
            system_event: SlackConnectorSystemEvent {
                session_key: session_key(policy, &member.channel),
                context_key: format!("slack:member:{verb}:{}:{}", member.channel, member.user),
                text: format!(
                    "Slack: {} {verb} {}.",
                    member.user,
                    channel_label(&member.channel, None)
                ),
            },
            event: member,
        });
    }
    if let Some(pin) = pins::classify_pin_event(event) {
        if !channel_routable(policy, &pin.channel) {
            return None;
        }
        let action = match pin.action {
            pins::SlackPinAction::Added => "added",
            pins::SlackPinAction::Removed => "removed",
        };
        return Some(SlackEventFamilyAction::Pin {
            system_event: SlackConnectorSystemEvent {
                session_key: session_key(policy, &pin.channel),
                context_key: format!(
                    "slack:pin:{action}:{}:{}",
                    pin.channel,
                    pin.message_ts.as_deref().unwrap_or("unknown")
                ),
                text: format!(
                    "Slack pin {action} in {}.",
                    channel_label(&pin.channel, None)
                ),
            },
            event: pin,
        });
    }
    if home::is_app_home_opened(event) {
        return Some(SlackEventFamilyAction::HomeOpened {
            user: event
                .get("user")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
        });
    }
    if assistant::is_assistant_event(event) {
        return Some(SlackEventFamilyAction::Assistant {
            event_type: event.get("type")?.as_str()?.to_owned(),
        });
    }
    if agent::is_agent_event(event) {
        return Some(SlackEventFamilyAction::Agent {
            event_type: event.get("type")?.as_str()?.to_owned(),
        });
    }
    if interactions::classify_interaction(payload).is_some() {
        let handling = interactions::handle_slack_interaction_payload(
            payload,
            &interactions::SlackInteractionRoutingPolicy {
                account_id: policy.account_id.clone(),
                allowed_channel_ids: policy.allowed_channel_ids.clone(),
                disabled_channel_ids: policy.disabled_channel_ids.clone(),
                ..interactions::SlackInteractionRoutingPolicy::default()
            },
        );
        if let interactions::SlackInteractionHandling::SystemEvent {
            kind, system_event, ..
        } = handling
        {
            return Some(SlackEventFamilyAction::Interaction { kind, system_event });
        }
        return None;
    }
    None
}

fn channel_routable(policy: &SlackEventRoutingPolicy, channel: &str) -> bool {
    !policy
        .disabled_channel_ids
        .iter()
        .any(|entry| entry == channel)
        && (policy.allowed_channel_ids.is_empty()
            || policy
                .allowed_channel_ids
                .iter()
                .any(|entry| entry == channel))
}

fn reaction_allowed(
    policy: &SlackEventRoutingPolicy,
    reaction: &reactions::SlackReactionEvent,
) -> bool {
    match policy.reaction_mode.as_str() {
        "off" => false,
        "own" => policy
            .bot_user_id
            .as_deref()
            .is_some_and(|bot| reaction.item_user.as_deref() == Some(bot)),
        "allowlist" => policy
            .reaction_allowlist_lower
            .iter()
            .any(|entry| entry == "*" || entry == &reaction.user.to_ascii_lowercase()),
        _ => true,
    }
}

fn session_key(policy: &SlackEventRoutingPolicy, channel: &str) -> String {
    format!("slack:{}:{}", policy.account_id, channel)
}

fn channel_label(channel_id: &str, channel_name: Option<&str>) -> String {
    channel_name
        .filter(|name| !name.trim().is_empty())
        .map_or_else(|| channel_id.to_owned(), |name| format!("#{name}"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn dispatches_event_families_to_system_or_interaction_actions() {
        assert!(matches!(
            dispatch_slack_event_family(&json!({
                "type":"event_callback",
                "event":{"type":"message","subtype":"message_changed","channel":"C1","message":{"ts":"1.0"}}
            })),
            Some(SlackEventFamilyAction::MessageSubtype { .. })
        ));
        assert!(matches!(
            dispatch_slack_event_family(&json!({
                "type":"event_callback",
                "event":{"type":"reaction_added","user":"U1","reaction":"eyes","item":{"type":"message","channel":"C1","ts":"1.0"}}
            })),
            Some(SlackEventFamilyAction::Reaction { .. })
        ));
        assert!(matches!(
            dispatch_slack_event_family(&json!({"type":"app_home_opened","user":"U1"})),
            Some(SlackEventFamilyAction::HomeOpened { .. })
        ));
        assert!(matches!(
            dispatch_slack_event_family(&json!({
                "type":"block_actions",
                "team":{"id":"T1"},
                "user":{"id":"U1"},
                "channel":{"id":"C1"},
                "message":{"ts":"1.0"},
                "actions":[{"type":"button","action_id":"a1","value":"v1"}]
            })),
            Some(SlackEventFamilyAction::Interaction { .. })
        ));
    }
}
