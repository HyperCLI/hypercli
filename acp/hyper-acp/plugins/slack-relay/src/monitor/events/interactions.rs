//! Slack interaction payload handling.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/events/interactions.ts`
//! - `interactions.block-actions.ts`, `interactions.modal.ts`,
//!   `interactions.shortcuts.ts`, and `modal-input-summary.ts`.
//!
//! HyperCLI deviation: this Rust plugin owns the relay/direct transport
//! boundary, but does not embed OpenClaw's plugin approval gateway or Slack Web
//! API mutation runtime. Source-shaped interaction handling here therefore
//! returns an ack plus a sanitized system-event plan for the host ACP stream.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::allowlist::resolve_slack_user_allowed;
use crate::monitor::channel_type::{classify_slack_channel, SlackMonitorChannelType};
use crate::monitor::events::SlackConnectorSystemEvent;
use crate::monitor::message_handler::prepare::DmPolicy;
use crate::monitor::message_handler::prepare_routing::build_slack_acp_session_key;
use crate::truncate::truncate_slack_text;

const SLACK_INTERACTION_EVENT_PREFIX: &str = "Slack interaction: ";
const REDACTED_INTERACTION_VALUE: &str = "[redacted]";
const SLACK_INTERACTION_EVENT_MAX_CHARS: usize = 2400;
const SLACK_INTERACTION_STRING_MAX_CHARS: usize = 160;
const SLACK_INTERACTION_ARRAY_MAX_ITEMS: usize = 64;
const SLACK_INTERACTION_COMPACT_INPUTS_MAX_ITEMS: usize = 3;
const OPENCLAW_MODAL_CALLBACK_PREFIX: &str = "openclaw:";
const SLACK_REPLY_BUTTON_ACTION_ID: &str = "openclaw:reply_button";
const SLACK_REPLY_LINK_ACTION_ID: &str = "openclaw:reply_link";
const SLACK_REPLY_SELECT_ACTION_ID: &str = "openclaw:reply_select";

/// Source-shaped Slack interaction kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackInteractionKind {
    /// Slack block action.
    BlockAction,
    /// Slack modal view submission.
    ViewSubmission,
    /// Slack modal closed event.
    ViewClosed,
    /// Slack message shortcut.
    MessageShortcut,
    /// Slack global shortcut.
    GlobalShortcut,
}

/// HTTP or Socket Mode interaction ack payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[must_use]
pub struct SlackInteractionAck {
    /// HTTP status code, or the semantic status for Socket Mode response
    /// payloads.
    pub status_code: u16,
    /// Optional ack body. Most interactions ack with an empty body.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<Value>,
}

impl SlackInteractionAck {
    /// Empty Slack interaction ack.
    pub fn empty() -> Self {
        Self {
            status_code: 200,
            body: None,
        }
    }
}

/// Routing/auth policy needed by source-shaped interaction handlers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackInteractionRoutingPolicy {
    /// Logical Slack account id.
    pub account_id: String,
    /// Allowed Slack channel ids. Empty means open channel routing.
    pub allowed_channel_ids: Vec<String>,
    /// Explicitly disabled Slack channel ids.
    pub disabled_channel_ids: Vec<String>,
    /// Direct-message policy.
    pub dm_policy: DmPolicy,
    /// Lowercase Slack sender allowlist.
    pub allow_from_lower: Vec<String>,
    /// Whether name/slug matching is enabled for sender allowlists.
    pub allow_name_matching: bool,
}

impl Default for SlackInteractionRoutingPolicy {
    fn default() -> Self {
        Self {
            account_id: "default".to_owned(),
            allowed_channel_ids: Vec::new(),
            disabled_channel_ids: Vec::new(),
            dm_policy: DmPolicy::Open,
            allow_from_lower: Vec::new(),
            allow_name_matching: false,
        }
    }
}

/// Source-shaped result for a direct Slack interaction payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlackInteractionHandling {
    /// Payload was not a Slack interaction payload this runtime handles.
    Ignored {
        /// Slack ack response.
        ack: SlackInteractionAck,
        /// Drop/ignore reason.
        reason: &'static str,
    },
    /// Payload was recognized but rejected before routing.
    Dropped {
        /// Slack ack response.
        ack: SlackInteractionAck,
        /// Drop reason.
        reason: &'static str,
    },
    /// Payload was accepted and should be delivered as an ACP system event.
    SystemEvent {
        /// Interaction kind.
        kind: SlackInteractionKind,
        /// Slack ack response.
        ack: SlackInteractionAck,
        /// Sanitized system event.
        system_event: SlackConnectorSystemEvent,
    },
}

/// Classifies direct Slack interaction payload type.
#[must_use]
pub fn classify_interaction(payload: &Value) -> Option<SlackInteractionKind> {
    match payload.get("type")?.as_str()? {
        "block_actions" => Some(SlackInteractionKind::BlockAction),
        "view_submission" => Some(SlackInteractionKind::ViewSubmission),
        "view_closed" => Some(SlackInteractionKind::ViewClosed),
        "message_action" => Some(SlackInteractionKind::MessageShortcut),
        "shortcut" => Some(SlackInteractionKind::GlobalShortcut),
        _ => None,
    }
}

/// Plans Slack interaction ack and ACP/system-event routing.
#[must_use]
pub fn handle_slack_interaction_payload(
    payload: &Value,
    policy: &SlackInteractionRoutingPolicy,
) -> SlackInteractionHandling {
    match classify_interaction(payload) {
        Some(SlackInteractionKind::BlockAction) => handle_block_action(payload, policy),
        Some(SlackInteractionKind::ViewSubmission) => {
            handle_modal_lifecycle(payload, policy, SlackInteractionKind::ViewSubmission)
        }
        Some(SlackInteractionKind::ViewClosed) => {
            handle_modal_lifecycle(payload, policy, SlackInteractionKind::ViewClosed)
        }
        Some(SlackInteractionKind::MessageShortcut) => handle_shortcut(payload, policy, true),
        Some(SlackInteractionKind::GlobalShortcut) => handle_shortcut(payload, policy, false),
        None => SlackInteractionHandling::Ignored {
            ack: SlackInteractionAck::empty(),
            reason: "not-interaction",
        },
    }
}

fn handle_block_action(
    payload: &Value,
    policy: &SlackInteractionRoutingPolicy,
) -> SlackInteractionHandling {
    let Some(action) = payload
        .get("actions")
        .and_then(Value::as_array)
        .and_then(|actions| actions.first())
        .filter(|action| action.is_object())
    else {
        return SlackInteractionHandling::Dropped {
            ack: SlackInteractionAck::empty(),
            reason: "invalid-payload",
        };
    };
    let action_id = string_field(action, "action_id").unwrap_or("unknown");
    let action_summary = summarize_action(action);
    if is_slack_reply_link_action(action_id, action) {
        return SlackInteractionHandling::Ignored {
            ack: SlackInteractionAck::empty(),
            reason: "reply-link",
        };
    }
    let user_id = read_nested_string(payload, &["user", "id"]).unwrap_or("unknown");
    let channel_id = read_nested_string(payload, &["channel", "id"])
        .or_else(|| read_nested_string(payload, &["container", "channel_id"]));
    let message_ts = read_nested_string(payload, &["message", "ts"])
        .or_else(|| read_nested_string(payload, &["container", "message_ts"]));
    let thread_ts = read_nested_string(payload, &["container", "thread_ts"])
        .or_else(|| read_nested_string(payload, &["message", "thread_ts"]));
    let auth = authorize_interaction(policy, user_id, channel_id, Some(user_id));
    if !auth.allowed {
        return SlackInteractionHandling::Dropped {
            ack: SlackInteractionAck::empty(),
            reason: auth.reason,
        };
    }

    let mut event_payload = Map::new();
    event_payload.insert("interactionType".to_owned(), json!("block_action"));
    event_payload.insert("actionId".to_owned(), json!(action_id));
    insert_optional_string(
        &mut event_payload,
        "blockId",
        string_field(action, "block_id"),
    );
    insert_summary(&mut event_payload, &action_summary);
    insert_optional_string(&mut event_payload, "userId", Some(user_id));
    insert_optional_string(
        &mut event_payload,
        "teamId",
        read_nested_string(payload, &["team", "id"]),
    );
    insert_optional_string(
        &mut event_payload,
        "triggerId",
        string_field(payload, "trigger_id"),
    );
    insert_optional_string(
        &mut event_payload,
        "responseUrl",
        string_field(payload, "response_url"),
    );
    insert_optional_string(&mut event_payload, "channelId", channel_id);
    insert_optional_string(&mut event_payload, "messageTs", message_ts);
    insert_optional_string(&mut event_payload, "threadTs", thread_ts);

    let context_key = context_key([
        Some("slack:interaction"),
        channel_id,
        message_ts,
        Some(action_id),
    ]);
    SlackInteractionHandling::SystemEvent {
        kind: SlackInteractionKind::BlockAction,
        ack: SlackInteractionAck::empty(),
        system_event: SlackConnectorSystemEvent {
            session_key: interaction_session_key(
                policy,
                read_nested_string(payload, &["team", "id"]),
                channel_id,
                auth.channel_type,
                Some(user_id),
                thread_ts,
            ),
            context_key,
            text: format_slack_interaction_system_event(&Value::Object(event_payload)),
        },
    }
}

#[allow(clippy::too_many_lines)]
fn handle_modal_lifecycle(
    payload: &Value,
    policy: &SlackInteractionRoutingPolicy,
    kind: SlackInteractionKind,
) -> SlackInteractionHandling {
    let callback_id = read_nested_string(payload, &["view", "callback_id"]).unwrap_or("unknown");
    let private_metadata = read_nested_string(payload, &["view", "private_metadata"]);
    let metadata = parse_slack_modal_private_metadata(private_metadata);
    let plugin_interactive_data = metadata
        .plugin_interactive_data
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    if !callback_id.starts_with(OPENCLAW_MODAL_CALLBACK_PREFIX) && plugin_interactive_data.is_none()
    {
        return SlackInteractionHandling::Ignored {
            ack: SlackInteractionAck::empty(),
            reason: "unhandled-modal",
        };
    }
    let user_id = read_nested_string(payload, &["user", "id"]).unwrap_or("unknown");
    let Some(expected_user_id) = metadata.user_id.as_deref() else {
        return SlackInteractionHandling::Dropped {
            ack: SlackInteractionAck::empty(),
            reason: "missing-expected-user",
        };
    };
    let auth = authorize_interaction(
        policy,
        user_id,
        metadata.channel_id.as_deref(),
        Some(expected_user_id),
    );
    if !auth.allowed {
        return SlackInteractionHandling::Dropped {
            ack: SlackInteractionAck::empty(),
            reason: auth.reason,
        };
    }
    let view_id = read_nested_string(payload, &["view", "id"]);
    let state_values = payload
        .pointer("/view/state/values")
        .unwrap_or(&Value::Null);
    let inputs = summarize_view_state(state_values);
    let mut event_payload = Map::new();
    event_payload.insert(
        "interactionType".to_owned(),
        json!(match kind {
            SlackInteractionKind::ViewClosed => "view_closed",
            _ => "view_submission",
        }),
    );
    event_payload.insert("actionId".to_owned(), json!(format!("view:{callback_id}")));
    event_payload.insert("callbackId".to_owned(), json!(callback_id));
    insert_optional_string(&mut event_payload, "viewId", view_id);
    event_payload.insert("userId".to_owned(), json!(user_id));
    insert_optional_string(
        &mut event_payload,
        "teamId",
        read_nested_string(payload, &["team", "id"]),
    );
    insert_optional_string(
        &mut event_payload,
        "rootViewId",
        read_nested_string(payload, &["view", "root_view_id"]),
    );
    insert_optional_string(
        &mut event_payload,
        "previousViewId",
        read_nested_string(payload, &["view", "previous_view_id"]),
    );
    insert_optional_string(
        &mut event_payload,
        "externalId",
        read_nested_string(payload, &["view", "external_id"]),
    );
    insert_optional_string(
        &mut event_payload,
        "viewHash",
        read_nested_string(payload, &["view", "hash"]),
    );
    if read_nested_string(payload, &["view", "previous_view_id"]).is_some() {
        event_payload.insert("isStackedView".to_owned(), json!(true));
    }
    insert_optional_string(&mut event_payload, "privateMetadata", private_metadata);
    insert_optional_string(
        &mut event_payload,
        "routedChannelId",
        metadata.channel_id.as_deref(),
    );
    insert_optional_string(
        &mut event_payload,
        "routedChannelType",
        metadata.channel_type.as_deref(),
    );
    event_payload.insert("inputs".to_owned(), Value::Array(inputs));
    if kind == SlackInteractionKind::ViewClosed {
        event_payload.insert(
            "isCleared".to_owned(),
            json!(payload
                .get("is_cleared")
                .and_then(Value::as_bool)
                .unwrap_or(false)),
        );
    }

    let context_prefix = match kind {
        SlackInteractionKind::ViewClosed => "slack:interaction:view-closed",
        _ => "slack:interaction:view",
    };
    SlackInteractionHandling::SystemEvent {
        kind,
        ack: SlackInteractionAck::empty(),
        system_event: SlackConnectorSystemEvent {
            session_key: metadata.session_key.unwrap_or_else(|| {
                interaction_session_key(
                    policy,
                    read_nested_string(payload, &["team", "id"]),
                    metadata.channel_id.as_deref(),
                    auth.channel_type,
                    Some(user_id),
                    None,
                )
            }),
            context_key: context_key([
                Some(context_prefix),
                Some(callback_id),
                view_id,
                Some(user_id),
            ]),
            text: format_slack_interaction_system_event(&Value::Object(event_payload)),
        },
    }
}

#[allow(clippy::too_many_lines)]
fn handle_shortcut(
    payload: &Value,
    policy: &SlackInteractionRoutingPolicy,
    is_message_shortcut: bool,
) -> SlackInteractionHandling {
    let callback_id = string_field(payload, "callback_id").unwrap_or("");
    let user_id = read_nested_string(payload, &["user", "id"]).unwrap_or("");
    if callback_id.is_empty() || user_id.is_empty() {
        return SlackInteractionHandling::Dropped {
            ack: SlackInteractionAck::empty(),
            reason: "invalid-payload",
        };
    }
    let channel_id = if is_message_shortcut {
        read_nested_string(payload, &["channel", "id"])
    } else {
        None
    };
    if is_message_shortcut && channel_id.is_none() {
        return SlackInteractionHandling::Dropped {
            ack: SlackInteractionAck::empty(),
            reason: "missing-channel",
        };
    }
    let thread_ts = read_nested_string(payload, &["message", "thread_ts"]);
    let auth = authorize_interaction(policy, user_id, channel_id, Some(user_id));
    if !auth.allowed {
        return SlackInteractionHandling::Dropped {
            ack: SlackInteractionAck::empty(),
            reason: auth.reason,
        };
    }

    let interaction_type = if is_message_shortcut {
        "message_shortcut"
    } else {
        "global_shortcut"
    };
    let message_ts = read_nested_string(payload, &["message", "ts"])
        .or_else(|| string_field(payload, "message_ts"));
    let mut event_payload = Map::new();
    event_payload.insert("interactionType".to_owned(), json!(interaction_type));
    event_payload.insert(
        "actionId".to_owned(),
        json!(format!("shortcut:{callback_id}")),
    );
    event_payload.insert("callbackId".to_owned(), json!(callback_id));
    event_payload.insert("userId".to_owned(), json!(user_id));
    insert_optional_string(
        &mut event_payload,
        "teamId",
        read_nested_string(payload, &["team", "id"])
            .or_else(|| read_nested_string(payload, &["user", "team_id"])),
    );
    insert_optional_string(
        &mut event_payload,
        "triggerId",
        string_field(payload, "trigger_id"),
    );
    insert_optional_string(
        &mut event_payload,
        "actionTs",
        string_field(payload, "action_ts"),
    );
    insert_optional_string(&mut event_payload, "channelId", channel_id);
    insert_optional_string(
        &mut event_payload,
        "channelName",
        read_nested_string(payload, &["channel", "name"]),
    );
    insert_optional_string(&mut event_payload, "messageTs", message_ts);
    insert_optional_string(&mut event_payload, "threadTs", thread_ts);
    insert_optional_string(
        &mut event_payload,
        "messageUserId",
        read_nested_string(payload, &["message", "user"]),
    );
    insert_optional_string(
        &mut event_payload,
        "messageText",
        read_nested_string(payload, &["message", "text"]),
    );
    insert_optional_string(
        &mut event_payload,
        "responseUrl",
        string_field(payload, "response_url"),
    );

    SlackInteractionHandling::SystemEvent {
        kind: if is_message_shortcut {
            SlackInteractionKind::MessageShortcut
        } else {
            SlackInteractionKind::GlobalShortcut
        },
        ack: SlackInteractionAck::empty(),
        system_event: SlackConnectorSystemEvent {
            session_key: interaction_session_key(
                policy,
                read_nested_string(payload, &["team", "id"])
                    .or_else(|| read_nested_string(payload, &["user", "team_id"])),
                channel_id,
                auth.channel_type,
                Some(user_id),
                thread_ts,
            ),
            context_key: context_key([
                Some("slack:interaction:shortcut"),
                Some(interaction_type),
                Some(callback_id),
                channel_id,
                message_ts,
                string_field(payload, "action_ts"),
            ]),
            text: format_slack_interaction_system_event(&Value::Object(event_payload)),
        },
    }
}

#[allow(clippy::too_many_lines)]
fn summarize_action(action: &Value) -> Map<String, Value> {
    let action_type = string_field(action, "type");
    let selected_users = unique_non_empty_strings(
        string_field(action, "selected_user")
            .into_iter()
            .chain(string_array_field(action, "selected_users"))
            .collect(),
    );
    let selected_channels = unique_non_empty_strings(
        string_field(action, "selected_channel")
            .into_iter()
            .chain(string_array_field(action, "selected_channels"))
            .collect(),
    );
    let selected_conversations = unique_non_empty_strings(
        string_field(action, "selected_conversation")
            .into_iter()
            .chain(string_array_field(action, "selected_conversations"))
            .collect(),
    );
    let mut selected_values = Vec::new();
    selected_values.extend(
        read_option_value(action.get("selected_option"))
            .into_iter()
            .map(ToOwned::to_owned),
    );
    selected_values.extend(
        read_options_values(action.get("selected_options"))
            .into_iter()
            .map(ToOwned::to_owned),
    );
    selected_values.extend(selected_users.clone());
    selected_values.extend(selected_channels.clone());
    selected_values.extend(selected_conversations.clone());
    let selected_values = unique_non_empty_owned(selected_values);
    let selected_labels = unique_non_empty_strings(
        read_option_label(action.get("selected_option"))
            .into_iter()
            .chain(read_options_labels(action.get("selected_options")))
            .collect(),
    );
    let input_value = string_field(action, "value");
    let rich_text_value = if action_type == Some("rich_text_input") {
        action.get("rich_text_value").cloned()
    } else {
        None
    };
    let rich_text_preview = rich_text_value
        .as_ref()
        .and_then(summarize_rich_text_preview);
    let input_number = if action_type == Some("number_input") {
        input_value.and_then(|value| value.parse::<f64>().ok())
    } else {
        None
    };
    let input_email = if action_type == Some("email_text_input") {
        input_value.filter(|value| value.contains('@'))
    } else {
        None
    };
    let input_url = if action_type == Some("url_text_input") {
        input_value.and_then(|value| url::Url::parse(value).ok().map(|url| url.to_string()))
    } else {
        None
    };
    let input_kind = match action_type {
        Some("number_input") => Some("number"),
        Some("email_text_input") => Some("email"),
        Some("url_text_input") => Some("url"),
        Some("rich_text_input") => Some("rich_text"),
        _ if input_value.is_some() => Some("text"),
        _ => None,
    };

    let mut summary = Map::new();
    insert_optional_string(&mut summary, "actionType", action_type);
    insert_optional_string(&mut summary, "inputKind", input_kind);
    insert_optional_string(&mut summary, "value", string_field(action, "value"));
    insert_optional_string(&mut summary, "inputValue", input_value);
    if let Some(number) = input_number.filter(|number| number.is_finite()) {
        summary.insert("inputNumber".to_owned(), json!(number));
    }
    insert_optional_string(&mut summary, "inputEmail", input_email);
    insert_optional_string(&mut summary, "inputUrl", input_url.as_deref());
    insert_optional_array(&mut summary, "selectedValues", &selected_values);
    insert_optional_array(&mut summary, "selectedUsers", &selected_users);
    insert_optional_array(&mut summary, "selectedChannels", &selected_channels);
    insert_optional_array(
        &mut summary,
        "selectedConversations",
        &selected_conversations,
    );
    insert_optional_array(&mut summary, "selectedLabels", &selected_labels);
    insert_optional_string(
        &mut summary,
        "selectedDate",
        string_field(action, "selected_date"),
    );
    insert_optional_string(
        &mut summary,
        "selectedTime",
        string_field(action, "selected_time"),
    );
    if let Some(datetime) = action.get("selected_date_time").and_then(Value::as_i64) {
        summary.insert("selectedDateTime".to_owned(), json!(datetime));
    }
    if let Some(value) = rich_text_value {
        summary.insert("richTextValue".to_owned(), value);
    }
    insert_optional_string(
        &mut summary,
        "richTextPreview",
        rich_text_preview.as_deref(),
    );
    insert_optional_string(
        &mut summary,
        "workflowTriggerUrl",
        read_nested_string(action, &["workflow", "trigger_url"]),
    );
    insert_optional_string(
        &mut summary,
        "workflowId",
        read_nested_string(action, &["workflow", "workflow_id"]),
    );
    summary
}

fn summarize_view_state(values: &Value) -> Vec<Value> {
    let Some(blocks) = values.as_object() else {
        return Vec::new();
    };
    let mut entries = Vec::new();
    for (block_id, block_value) in blocks {
        let Some(actions) = block_value.as_object() else {
            continue;
        };
        for (action_id, action) in actions {
            if !action.is_object() {
                continue;
            }
            let mut entry = Map::new();
            entry.insert("blockId".to_owned(), json!(block_id));
            entry.insert("actionId".to_owned(), json!(action_id));
            insert_summary(&mut entry, &summarize_action(action));
            entries.push(Value::Object(entry));
        }
    }
    entries
}

fn format_slack_interaction_system_event(payload: &Value) -> String {
    let sanitized = sanitize_slack_interaction_payload_value(payload, None).unwrap_or(Value::Null);
    let event_text = interaction_event_text(&sanitized);
    if event_text.len() <= SLACK_INTERACTION_EVENT_MAX_CHARS {
        return event_text;
    }
    let compact =
        sanitize_slack_interaction_payload_value(&compact_interaction_payload(&sanitized), None)
            .unwrap_or(Value::Null);
    let compact_text = interaction_event_text(&compact);
    if compact_text.len() <= SLACK_INTERACTION_EVENT_MAX_CHARS {
        return compact_text;
    }
    let mut fallback = Map::new();
    if let Some(value) = sanitized.get("interactionType") {
        fallback.insert("interactionType".to_owned(), value.clone());
    }
    fallback.insert(
        "actionId".to_owned(),
        sanitized
            .get("actionId")
            .cloned()
            .unwrap_or_else(|| json!("unknown")),
    );
    if let Some(value) = sanitized.get("userId") {
        fallback.insert("userId".to_owned(), value.clone());
    }
    if let Some(value) = sanitized
        .get("channelId")
        .or_else(|| sanitized.get("routedChannelId"))
    {
        fallback.insert("channelId".to_owned(), value.clone());
    }
    fallback.insert("payloadTruncated".to_owned(), json!(true));
    let fallback = Value::Object(fallback);
    interaction_event_text(&fallback)
}

fn sanitize_slack_interaction_payload_value(value: &Value, key: Option<&str>) -> Option<Value> {
    if key.is_some_and(is_redacted_key) {
        return value
            .as_str()
            .is_some_and(|value| !value.trim().is_empty())
            .then(|| json!(REDACTED_INTERACTION_VALUE));
    }
    match value {
        Value::Null => None,
        Value::String(text) => Some(json!(truncate_slack_text(
            text,
            SLACK_INTERACTION_STRING_MAX_CHARS
        ))),
        Value::Array(values) => {
            let mut out = values
                .iter()
                .take(SLACK_INTERACTION_ARRAY_MAX_ITEMS)
                .filter_map(|entry| sanitize_slack_interaction_payload_value(entry, None))
                .collect::<Vec<_>>();
            if values.len() > SLACK_INTERACTION_ARRAY_MAX_ITEMS {
                out.push(json!(format!(
                    "...+{} more",
                    values.len() - SLACK_INTERACTION_ARRAY_MAX_ITEMS
                )));
            }
            (!out.is_empty()).then(|| Value::Array(out))
        }
        Value::Object(map) => {
            let mut out = Map::new();
            for (entry_key, entry_value) in map {
                let Some(sanitized) =
                    sanitize_slack_interaction_payload_value(entry_value, Some(entry_key))
                else {
                    continue;
                };
                if sanitized.as_str().is_some_and(str::is_empty) {
                    continue;
                }
                if sanitized.as_array().is_some_and(Vec::is_empty) {
                    continue;
                }
                out.insert(entry_key.clone(), sanitized);
            }
            (!out.is_empty()).then(|| Value::Object(out))
        }
        _ => Some(value.clone()),
    }
}

fn compact_interaction_payload(payload: &Value) -> Value {
    let raw_inputs = payload
        .get("inputs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let compact_inputs = raw_inputs
        .iter()
        .take(SLACK_INTERACTION_COMPACT_INPUTS_MAX_ITEMS)
        .filter_map(compact_input)
        .collect::<Vec<_>>();
    let mut compact = Map::new();
    for key in [
        "interactionType",
        "actionId",
        "callbackId",
        "actionType",
        "actionTs",
        "userId",
        "teamId",
        "channelId",
        "messageTs",
        "threadTs",
        "messageUserId",
        "messageText",
        "viewId",
        "isCleared",
        "selectedValues",
        "selectedLabels",
        "selectedDate",
        "selectedTime",
        "selectedDateTime",
        "workflowId",
        "routedChannelType",
        "pluginHandled",
        "pluginNamespace",
        "pluginDuplicate",
        "pluginSystemEvent",
    ] {
        if let Some(value) = payload.get(key) {
            compact.insert(key.to_owned(), value.clone());
        }
    }
    if let Some(value) = payload.get("routedChannelId") {
        compact
            .entry("channelId".to_owned())
            .or_insert_with(|| value.clone());
    }
    if !compact_inputs.is_empty() {
        compact.insert("inputs".to_owned(), Value::Array(compact_inputs));
    }
    if raw_inputs.len() > SLACK_INTERACTION_COMPACT_INPUTS_MAX_ITEMS {
        compact.insert(
            "inputsOmitted".to_owned(),
            json!(raw_inputs.len() - SLACK_INTERACTION_COMPACT_INPUTS_MAX_ITEMS),
        );
    }
    compact.insert("payloadTruncated".to_owned(), json!(true));
    Value::Object(compact)
}

fn compact_input(input: &Value) -> Option<Value> {
    let input = input.as_object()?;
    let mut out = Map::new();
    for key in [
        "actionId",
        "blockId",
        "actionType",
        "inputKind",
        "selectedValues",
        "selectedLabels",
        "inputValue",
        "inputNumber",
        "selectedDate",
        "selectedTime",
        "selectedDateTime",
        "richTextPreview",
    ] {
        if let Some(value) = input.get(key) {
            out.insert(key.to_owned(), value.clone());
        }
    }
    Some(Value::Object(out))
}

fn interaction_event_text(payload: &Value) -> String {
    format!("{SLACK_INTERACTION_EVENT_PREFIX}{payload}")
}

fn authorize_interaction(
    policy: &SlackInteractionRoutingPolicy,
    sender_id: &str,
    channel_id: Option<&str>,
    expected_sender_id: Option<&str>,
) -> InteractionAuthorization {
    if sender_id.trim().is_empty() || sender_id == "unknown" {
        return InteractionAuthorization::denied("missing-sender");
    }
    if expected_sender_id.is_none_or(str::is_empty) {
        return InteractionAuthorization::denied("missing-expected-sender");
    }
    if expected_sender_id.is_some_and(|expected| expected != sender_id) {
        return InteractionAuthorization::denied("sender-mismatch");
    }
    let channel_type = channel_id.map(|channel| classify_slack_channel(channel, &json!({})));
    if let Some(channel) = channel_id {
        if !channel_routable(policy, channel) {
            return InteractionAuthorization::denied("channel-not-allowed");
        }
    }
    if channel_type == Some(SlackMonitorChannelType::DirectMessage)
        && policy.dm_policy == DmPolicy::Disabled
    {
        return InteractionAuthorization::denied("dm-disabled");
    }
    if !policy.allow_from_lower.is_empty()
        && !resolve_slack_user_allowed(
            Some(&policy.allow_from_lower),
            Some(sender_id),
            None,
            policy.allow_name_matching,
        )
    {
        return InteractionAuthorization::denied("sender-not-allowlisted");
    }
    InteractionAuthorization {
        allowed: true,
        reason: "allowed",
        channel_type,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct InteractionAuthorization {
    allowed: bool,
    reason: &'static str,
    channel_type: Option<SlackMonitorChannelType>,
}

impl InteractionAuthorization {
    fn denied(reason: &'static str) -> Self {
        Self {
            allowed: false,
            reason,
            channel_type: None,
        }
    }
}

fn interaction_session_key(
    policy: &SlackInteractionRoutingPolicy,
    team_id: Option<&str>,
    channel_id: Option<&str>,
    channel_type: Option<SlackMonitorChannelType>,
    user_id: Option<&str>,
    thread_ts: Option<&str>,
) -> String {
    if let Some(channel) = channel_id {
        return build_slack_acp_session_key(
            team_id,
            channel,
            thread_ts,
            user_id,
            channel_type == Some(SlackMonitorChannelType::DirectMessage),
        );
    }
    format!("slack:{}:slack-system", policy.account_id)
}

fn parse_slack_modal_private_metadata(raw: Option<&str>) -> SlackModalPrivateMetadata {
    let Some(raw) = raw.filter(|value| !value.trim().is_empty()) else {
        return SlackModalPrivateMetadata::default();
    };
    let Ok(Value::Object(parsed)) = serde_json::from_str::<Value>(raw) else {
        return SlackModalPrivateMetadata::default();
    };
    SlackModalPrivateMetadata {
        session_key: string_from_map(&parsed, "sessionKey"),
        channel_id: string_from_map(&parsed, "channelId"),
        channel_type: string_from_map(&parsed, "channelType"),
        user_id: string_from_map(&parsed, "userId"),
        plugin_interactive_data: string_from_map(&parsed, "pluginInteractiveData"),
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct SlackModalPrivateMetadata {
    session_key: Option<String>,
    channel_id: Option<String>,
    channel_type: Option<String>,
    user_id: Option<String>,
    plugin_interactive_data: Option<String>,
}

fn is_slack_reply_link_action(action_id: &str, action: &Value) -> bool {
    action_id == SLACK_REPLY_LINK_ACTION_ID
        || action_id.starts_with(&format!("{SLACK_REPLY_LINK_ACTION_ID}:"))
        || (string_field(action, "url").is_some() && is_slack_reply_action_id(action_id))
}

fn is_slack_reply_action_id(action_id: &str) -> bool {
    action_id == SLACK_REPLY_BUTTON_ACTION_ID
        || action_id == SLACK_REPLY_SELECT_ACTION_ID
        || action_id.starts_with(&format!("{SLACK_REPLY_BUTTON_ACTION_ID}:"))
        || action_id.starts_with(&format!("{SLACK_REPLY_SELECT_ACTION_ID}:"))
}

fn channel_routable(policy: &SlackInteractionRoutingPolicy, channel: &str) -> bool {
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

fn string_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn string_from_map(map: &Map<String, Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn read_nested_string<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn string_array_field<'a>(value: &'a Value, key: &str) -> Vec<&'a str> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn read_option_value(option: Option<&Value>) -> Option<&str> {
    option.and_then(|option| string_field(option, "value"))
}

fn read_option_label(option: Option<&Value>) -> Option<&str> {
    option.and_then(|option| read_nested_string(option, &["text", "text"]))
}

fn read_options_values(options: Option<&Value>) -> Vec<&str> {
    options
        .and_then(Value::as_array)
        .map(|options| {
            options
                .iter()
                .filter_map(|option| string_field(option, "value"))
                .collect()
        })
        .unwrap_or_default()
}

fn read_options_labels(options: Option<&Value>) -> Vec<&str> {
    options
        .and_then(Value::as_array)
        .map(|options| {
            options
                .iter()
                .filter_map(|option| read_nested_string(option, &["text", "text"]))
                .collect()
        })
        .unwrap_or_default()
}

fn unique_non_empty_strings(values: Vec<&str>) -> Vec<String> {
    let mut out = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if !trimmed.is_empty() && !out.iter().any(|entry| entry == trimmed) {
            out.push(trimmed.to_owned());
        }
    }
    out
}

fn unique_non_empty_owned(values: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if !trimmed.is_empty() && !out.iter().any(|entry| entry == trimmed) {
            out.push(trimmed.to_owned());
        }
    }
    out
}

fn collect_rich_text_fragments(value: &Value, out: &mut Vec<String>) {
    if let Some(text) = value.get("text").and_then(Value::as_str) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            out.push(trimmed.to_owned());
        }
    }
    if let Some(elements) = value.get("elements").and_then(Value::as_array) {
        for child in elements {
            collect_rich_text_fragments(child, out);
        }
    }
}

fn summarize_rich_text_preview(value: &Value) -> Option<String> {
    let mut fragments = Vec::new();
    collect_rich_text_fragments(value, &mut fragments);
    let joined = fragments
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!joined.is_empty()).then(|| {
        if joined.len() <= 120 {
            joined
        } else {
            truncate_slack_text(&joined, 120)
        }
    })
}

fn insert_summary(target: &mut Map<String, Value>, summary: &Map<String, Value>) {
    for (key, value) in summary {
        target.insert(key.clone(), value.clone());
    }
}

fn insert_optional_string(target: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        target.insert(key.to_owned(), json!(value));
    }
}

fn insert_optional_array(target: &mut Map<String, Value>, key: &str, values: &[String]) {
    if !values.is_empty() {
        target.insert(key.to_owned(), json!(values));
    }
}

fn context_key<'a>(parts: impl IntoIterator<Item = Option<&'a str>>) -> String {
    parts
        .into_iter()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join(":")
}

fn is_redacted_key(key: &str) -> bool {
    matches!(
        key,
        "triggerId" | "responseUrl" | "workflowTriggerUrl" | "privateMetadata" | "viewHash"
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn classifies_source_shaped_interactions() {
        assert_eq!(
            classify_interaction(&json!({"type":"block_actions"})),
            Some(SlackInteractionKind::BlockAction)
        );
        assert_eq!(
            classify_interaction(&json!({"type":"view_submission"})),
            Some(SlackInteractionKind::ViewSubmission)
        );
        assert_eq!(
            classify_interaction(&json!({"type":"message_action"})),
            Some(SlackInteractionKind::MessageShortcut)
        );
    }

    #[test]
    fn block_action_builds_sanitized_system_event() {
        let handled = handle_slack_interaction_payload(
            &json!({
                "type":"block_actions",
                "team":{"id":"T1"},
                "user":{"id":"U1"},
                "trigger_id":"secret-trigger",
                "response_url":"https://hooks.slack.example/response",
                "channel":{"id":"C1"},
                "message":{"ts":"100.1","thread_ts":"99.9"},
                "actions":[{
                    "type":"static_select",
                    "action_id":"choose",
                    "block_id":"b1",
                    "selected_option":{"value":"v1","text":{"text":"Label"}}
                }]
            }),
            &SlackInteractionRoutingPolicy::default(),
        );
        let SlackInteractionHandling::SystemEvent {
            kind, system_event, ..
        } = handled
        else {
            panic!("expected system event");
        };
        assert_eq!(kind, SlackInteractionKind::BlockAction);
        assert_eq!(system_event.session_key, "slack:T1:thread:C1:99.9");
        assert!(system_event.context_key.contains("choose"));
        assert!(system_event.text.contains("\"selectedLabels\":[\"Label\"]"));
        assert!(system_event.text.contains(REDACTED_INTERACTION_VALUE));
        assert!(!system_event.text.contains("secret-trigger"));
    }

    #[test]
    fn modal_submission_requires_source_metadata_and_sender_binding() {
        let handled = handle_slack_interaction_payload(
            &json!({
                "type":"view_submission",
                "team":{"id":"T1"},
                "user":{"id":"U1"},
                "view":{
                    "id":"V1",
                    "callback_id":"openclaw:form",
                    "private_metadata":"{\"userId\":\"U1\",\"channelId\":\"D1\",\"channelType\":\"im\"}",
                    "state":{"values":{"b1":{"a1":{"type":"plain_text_input","value":"hello"}}}}
                }
            }),
            &SlackInteractionRoutingPolicy::default(),
        );
        let SlackInteractionHandling::SystemEvent {
            kind, system_event, ..
        } = handled
        else {
            panic!("expected system event");
        };
        assert_eq!(kind, SlackInteractionKind::ViewSubmission);
        assert_eq!(system_event.session_key, "slack:T1:dm:D1:U1");
        assert!(system_event
            .context_key
            .starts_with("slack:interaction:view"));
        assert!(system_event.text.contains("\"inputValue\":\"hello\""));
        assert!(!system_event.text.contains("private_metadata"));
    }

    #[test]
    fn shortcut_builds_message_shortcut_event() {
        let handled = handle_slack_interaction_payload(
            &json!({
                "type":"message_action",
                "callback_id":"summarize",
                "team":{"id":"T1"},
                "user":{"id":"U1"},
                "channel":{"id":"C1","name":"triage"},
                "message":{"ts":"100.2","thread_ts":"100.0","user":"U2","text":"long thread"},
                "action_ts":"200.1"
            }),
            &SlackInteractionRoutingPolicy::default(),
        );
        let SlackInteractionHandling::SystemEvent {
            kind, system_event, ..
        } = handled
        else {
            panic!("expected system event");
        };
        assert_eq!(kind, SlackInteractionKind::MessageShortcut);
        assert_eq!(
            system_event.context_key,
            "slack:interaction:shortcut:message_shortcut:summarize:C1:100.2:200.1"
        );
        assert!(system_event
            .text
            .contains("\"messageText\":\"long thread\""));
    }
}
