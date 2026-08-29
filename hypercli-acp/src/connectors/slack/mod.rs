mod config;
mod dedupe;
mod delivery;
mod relay;
mod types;

use async_trait::async_trait;
use chrono::Utc;
use futures_util::future::{BoxFuture, FutureExt};

use super::{
    Connector, ConnectorCapabilities, ConnectorError, ConnectorHost as CoreConnectorHost,
    ConnectorResult,
};
use crate::types::{
    ActivityFrame, ActivityKind, Actor, ActorKind, ConnectorReply,
    DeliveryReceipt as CoreDeliveryReceipt, Message, NormalizedTurn, ReplyTarget, TurnContext,
};

pub use config::{SlackRelayConfig, SlackRelayConfigError};
pub use dedupe::{LogicalDedupe, LogicalDedupeDecision};
pub use delivery::{SlackApiClient, SlackApiError};
pub use relay::{
    build_relay_websocket_request, handle_relay_frame, relay_websocket_url, run_relay_once,
    HostError, SlackRelayError,
};
pub use types::{
    NormalizedSlackTurn, RelayAckFrame, RelayFrame, SlackActivity, SlackDeliveryRequest,
    SlackMessageEvent, SlackRoute, SlackTurnSubmitResult,
};

pub const SLACK_CONNECTOR_ID: &str = "slack";

#[derive(Debug, Clone)]
pub struct SlackRelayConnector {
    config: SlackRelayConfig,
    api: SlackApiClient,
}

impl SlackRelayConnector {
    pub fn new(config: SlackRelayConfig) -> Self {
        let api = SlackApiClient::new(&config);
        Self { config, api }
    }

    pub fn config(&self) -> &SlackRelayConfig {
        &self.config
    }
}

#[async_trait]
impl Connector for SlackRelayConnector {
    fn id(&self) -> &'static str {
        SLACK_CONNECTOR_ID
    }

    fn capabilities(&self) -> ConnectorCapabilities {
        ConnectorCapabilities {
            inbound: true,
            outbound: true,
            history: false,
            chat_commands: false,
            durable_ingress: true,
            reply_receipts: true,
        }
    }

    async fn start(&mut self, host: CoreConnectorHost) -> ConnectorResult<()> {
        let config = self.config.clone();
        tokio::spawn(async move {
            let adapter = RelayHostAdapter { host };
            let mut dedupe = LogicalDedupe::default();
            loop {
                if let Err(error) = run_relay_once(&config, &adapter, &mut dedupe).await {
                    tracing::warn!(error = %error, "slack relay connector disconnected");
                    relay::ConnectorHost::emit_slack_activity(
                        &adapter,
                        SlackActivity {
                            kind: "slack.relay_disconnected",
                            delivery_id: None,
                            message: Some(error.to_string()),
                        },
                    )
                    .await;
                }
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        });
        Ok(())
    }

    async fn stop(&mut self, _host: CoreConnectorHost) -> ConnectorResult<()> {
        Ok(())
    }

    async fn deliver_reply(&self, reply: ConnectorReply) -> ConnectorResult<CoreDeliveryReceipt> {
        let (channel_id, thread_ts) = match &reply.target {
            ReplyTarget::SlackThread {
                channel_id,
                thread_ts,
                ..
            } => (channel_id.clone(), Some(thread_ts.clone())),
            ReplyTarget::SlackDm { .. } => {
                return Err(ConnectorError::new(
                    "Slack DM reply target requires a relay-provided channel_id",
                ));
            }
            other => {
                return Err(ConnectorError::new(format!(
                    "Slack connector cannot deliver to {other:?}"
                )));
            }
        };

        let receipt = self
            .api
            .post_message(SlackDeliveryRequest {
                channel_id,
                thread_ts,
                text: reply.text,
            })
            .await
            .map_err(|error| ConnectorError::new(error.to_string()))?;

        Ok(CoreDeliveryReceipt {
            connector: SLACK_CONNECTOR_ID.to_string(),
            provider: "slack".to_string(),
            message_id: receipt.message_ts,
            target: reply.target,
            delivered_at: Utc::now(),
        })
    }
}

struct RelayHostAdapter {
    host: CoreConnectorHost,
}

impl relay::ConnectorHost for RelayHostAdapter {
    fn submit_slack_turn<'a>(
        &'a self,
        turn: NormalizedSlackTurn,
    ) -> BoxFuture<'a, Result<SlackTurnSubmitResult, HostError>> {
        async move {
            let accepted = self
                .host
                .submit_turn(slack_turn_to_normalized(turn))
                .await
                .map_err(|error| HostError::new(error.to_string()))?;
            Ok(SlackTurnSubmitResult {
                durable: true,
                turn_id: Some(accepted.turn_id),
            })
        }
        .boxed()
    }

    fn emit_slack_activity<'a>(&'a self, activity: SlackActivity) -> BoxFuture<'a, ()> {
        async move {
            self.host
                .emit_activity(ActivityFrame {
                    seq: 0,
                    timestamp: Utc::now(),
                    kind: ActivityKind::ConnectorEvent,
                    connector: Some(SLACK_CONNECTOR_ID.to_string()),
                    conversation_key: None,
                    session_id: None,
                    turn_id: None,
                    started_at: None,
                    payload: Some(serde_json::json!({
                        "kind": activity.kind,
                        "delivery_id": activity.delivery_id,
                        "message": activity.message,
                    })),
                })
                .await;
        }
        .boxed()
    }
}

fn slack_turn_to_normalized(turn: NormalizedSlackTurn) -> NormalizedTurn {
    let mut metadata = serde_json::Map::new();
    metadata.insert(
        "logical_dedupe_key".to_string(),
        serde_json::Value::String(turn.logical_dedupe_key),
    );
    metadata.insert(
        "raw_event".to_string(),
        serde_json::to_value(&turn.raw_event).unwrap_or(serde_json::Value::Null),
    );
    NormalizedTurn {
        turn_id: None,
        request_id: None,
        idempotency_key: turn.idempotency_key,
        connector: SLACK_CONNECTOR_ID.to_string(),
        conversation_key: turn.conversation_key,
        sender: Actor {
            id: turn.sender_user_id.unwrap_or_else(|| "unknown".to_string()),
            display: None,
            kind: ActorKind::Human,
            role: None,
        },
        message: Message {
            text: turn.text,
            attachments: vec![],
        },
        reply_target: ReplyTarget::SlackThread {
            team_id: turn.reply_target.team_id,
            channel_id: turn.reply_target.channel_id,
            thread_ts: turn.reply_target.thread_ts,
        },
        context: TurnContext {
            source: Some(SLACK_CONNECTOR_ID.to_string()),
            history: vec![],
            metadata,
        },
        require_reply: None,
    }
}

#[cfg(test)]
mod connector_tests {
    use super::*;

    #[test]
    fn relay_turn_maps_to_core_turn_shape() {
        let turn = NormalizedSlackTurn {
            idempotency_key: "slack-event:Ev1".to_string(),
            logical_dedupe_key: "slack-message:T:C:1.2".to_string(),
            conversation_key: "slack:T:C:1.2".to_string(),
            reply_target: types::SlackReplyTarget {
                team_id: "T".to_string(),
                channel_id: "C".to_string(),
                thread_ts: "1.2".to_string(),
            },
            sender_user_id: Some("U".to_string()),
            text: "hi".to_string(),
            raw_event: SlackMessageEvent {
                event_type: "message".to_string(),
                subtype: None,
                channel: "C".to_string(),
                channel_type: Some("channel".to_string()),
                user: Some("U".to_string()),
                text: Some("hi".to_string()),
                ts: Some("1.2".to_string()),
                thread_ts: None,
                event_ts: Some("1.2".to_string()),
                parent_user_id: None,
                message: None,
                previous_message: None,
                deleted_ts: None,
                blocks: None,
                files: None,
                attachments: None,
            },
        };

        let normalized = slack_turn_to_normalized(turn);

        assert_eq!(normalized.connector, "slack");
        assert_eq!(normalized.sender.id, "U");
        assert!(matches!(
            normalized.reply_target,
            ReplyTarget::SlackThread { .. }
        ));
        assert!(normalized
            .context
            .metadata
            .get("logical_dedupe_key")
            .is_some());
    }
}
