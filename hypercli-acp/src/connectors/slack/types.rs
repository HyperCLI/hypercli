use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RelayFrame {
    Hello {
        #[serde(default)]
        gateway_id: Option<String>,
        #[serde(default)]
        slack_identity: Option<Value>,
    },
    SlackEvent {
        delivery_id: String,
        payload: SlackEventPayload,
        #[serde(default)]
        route: Option<SlackRoute>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct SlackEventPayload {
    #[serde(default)]
    pub team_id: Option<String>,
    #[serde(default)]
    pub enterprise_id: Option<String>,
    #[serde(default)]
    pub event_id: Option<String>,
    pub event: SlackMessageEvent,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct SlackRoute {
    pub kind: String,
    #[serde(flatten)]
    pub extra: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct SlackMessageEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(default)]
    pub subtype: Option<String>,
    pub channel: String,
    #[serde(default)]
    pub channel_type: Option<String>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub ts: Option<String>,
    #[serde(default)]
    pub thread_ts: Option<String>,
    #[serde(default)]
    pub event_ts: Option<String>,
    #[serde(default)]
    pub parent_user_id: Option<String>,
    #[serde(default)]
    pub message: Option<Value>,
    #[serde(default)]
    pub previous_message: Option<Value>,
    #[serde(default)]
    pub deleted_ts: Option<String>,
    #[serde(default)]
    pub blocks: Option<Value>,
    #[serde(default)]
    pub files: Option<Value>,
    #[serde(default)]
    pub attachments: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct RelayAckFrame {
    #[serde(rename = "type")]
    pub frame_type: &'static str,
    pub delivery_id: String,
}

impl RelayAckFrame {
    pub fn new(delivery_id: impl Into<String>) -> Self {
        Self {
            frame_type: "ack",
            delivery_id: delivery_id.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedSlackTurn {
    pub idempotency_key: String,
    pub logical_dedupe_key: String,
    pub conversation_key: String,
    pub reply_target: SlackReplyTarget,
    pub sender_user_id: Option<String>,
    pub text: String,
    pub raw_event: SlackMessageEvent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackReplyTarget {
    pub team_id: String,
    pub channel_id: String,
    pub thread_ts: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackTurnSubmitResult {
    pub durable: bool,
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackDeliveryRequest {
    pub channel_id: String,
    pub thread_ts: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryReceipt {
    pub provider: &'static str,
    pub channel_id: String,
    pub message_ts: Option<String>,
    pub thread_ts: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackActivity {
    pub kind: &'static str,
    pub delivery_id: Option<String>,
    pub message: Option<String>,
}

impl SlackActivity {
    pub fn new(kind: &'static str) -> Self {
        Self {
            kind,
            delivery_id: None,
            message: None,
        }
    }
}
