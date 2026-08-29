//! Buzz connector normalization.

use async_trait::async_trait;

use super::commands::platform_command_from_chat;
use super::{Connector, ConnectorCapabilities, ConnectorError, ConnectorHost, ConnectorResult};
use crate::types::{
    Actor, ActorKind, ActorRole, ConnectorReply, DeliveryReceipt, Message, NormalizedCommand,
    NormalizedTurn, ReplyTarget, TurnContext,
};

pub const BUZZ_CONNECTOR_ID: &str = "buzz";

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct BuzzConnectorConfig {
    pub agent_pubkey_hex: String,
    pub owner_pubkey_hex: Option<String>,
    pub stream_message_kind: u32,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct BuzzConnector {
    config: BuzzConnectorConfig,
}

impl BuzzConnector {
    pub fn new(config: BuzzConnectorConfig) -> Self {
        Self { config }
    }

    pub fn normalize_event(&self, event: BuzzInboundEvent) -> BuzzNormalized {
        normalize_buzz_event(&self.config, event)
    }
}

#[async_trait]
impl Connector for BuzzConnector {
    fn id(&self) -> &'static str {
        BUZZ_CONNECTOR_ID
    }

    fn capabilities(&self) -> ConnectorCapabilities {
        ConnectorCapabilities {
            inbound: true,
            outbound: true,
            history: false,
            chat_commands: true,
            durable_ingress: false,
            reply_receipts: false,
        }
    }

    async fn start(&mut self, _host: ConnectorHost) -> ConnectorResult<()> {
        Ok(())
    }

    async fn stop(&mut self, _host: ConnectorHost) -> ConnectorResult<()> {
        Ok(())
    }

    async fn deliver_reply(&self, reply: ConnectorReply) -> ConnectorResult<DeliveryReceipt> {
        Err(ConnectorError::new(format!(
            "Buzz delivery is not wired yet for turn {}",
            reply.turn_id
        )))
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct BuzzInboundEvent {
    pub channel_id: String,
    pub event_id: String,
    pub kind: u32,
    pub content: String,
    pub sender_pubkey_hex: String,
    pub tags: Vec<BuzzTag>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct BuzzTag {
    pub values: Vec<String>,
}

impl BuzzTag {
    pub fn parse(values: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            values: values.into_iter().map(Into::into).collect(),
        }
    }

    fn is_pubkey_tag_for(&self, pubkey_hex: &str) -> bool {
        self.values.first().map(String::as_str) == Some("p")
            && self.values.get(1).map(String::as_str) == Some(pubkey_hex)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum BuzzNormalized {
    Command(NormalizedCommand),
    Turn(NormalizedTurn),
}

pub fn conversation_key(channel_id: &str) -> String {
    format!("buzz:{channel_id}")
}

pub fn normalize_buzz_event(
    config: &BuzzConnectorConfig,
    event: BuzzInboundEvent,
) -> BuzzNormalized {
    let conversation_key = conversation_key(&event.channel_id);
    let is_owner = config
        .owner_pubkey_hex
        .as_deref()
        .map(|owner| owner == event.sender_pubkey_hex)
        .unwrap_or(false);
    let sender = Actor {
        id: event.sender_pubkey_hex.clone(),
        display: None,
        kind: ActorKind::Human,
        role: is_owner.then_some(ActorRole::Owner),
    };

    if is_owner
        && is_agent_mentioned(&event, &config.agent_pubkey_hex)
        && event.kind == config.stream_message_kind
    {
        if let Some(command) = platform_command_from_chat(&event.content) {
            return BuzzNormalized::Command(NormalizedCommand {
                command,
                connector: BUZZ_CONNECTOR_ID.to_string(),
                conversation_key,
                actor: sender,
                request_id: None,
                reason: Some("buzz_chat_command".to_string()),
                native_event_id: Some(event.event_id),
                turn_id: None,
                payload: None,
            });
        }
    }

    BuzzNormalized::Turn(NormalizedTurn {
        turn_id: None,
        request_id: None,
        idempotency_key: buzz_idempotency_key(&event),
        connector: BUZZ_CONNECTOR_ID.to_string(),
        conversation_key,
        sender,
        message: Message {
            text: event.content,
            attachments: vec![],
        },
        reply_target: ReplyTarget::BuzzChannel {
            channel_id: event.channel_id,
        },
        context: TurnContext::default(),
        require_reply: None,
    })
}

fn is_agent_mentioned(event: &BuzzInboundEvent, agent_pubkey_hex: &str) -> bool {
    event
        .tags
        .iter()
        .any(|tag| tag.is_pubkey_tag_for(agent_pubkey_hex))
}

fn buzz_idempotency_key(event: &BuzzInboundEvent) -> String {
    format!(
        "buzz:{}:{}:{}",
        event.channel_id, event.kind, event.event_id
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::PlatformCommand;

    const STREAM_MESSAGE_KIND: u32 = 9;

    fn config() -> BuzzConnectorConfig {
        BuzzConnectorConfig {
            agent_pubkey_hex: "agent".to_string(),
            owner_pubkey_hex: Some("owner".to_string()),
            stream_message_kind: STREAM_MESSAGE_KIND,
        }
    }

    fn event(content: &str) -> BuzzInboundEvent {
        BuzzInboundEvent {
            channel_id: "channel-1".to_string(),
            event_id: "event-1".to_string(),
            kind: STREAM_MESSAGE_KIND,
            content: content.to_string(),
            sender_pubkey_hex: "owner".to_string(),
            tags: vec![BuzzTag::parse(["p", "agent"])],
        }
    }

    #[test]
    fn owner_shutdown_mention_normalizes_to_runtime_command() {
        let normalized = normalize_buzz_event(&config(), event(" !shutdown "));

        match normalized {
            BuzzNormalized::Command(command) => {
                assert_eq!(command.command, PlatformCommand::RuntimeShutdown);
                assert_eq!(command.conversation_key, "buzz:channel-1");
                assert_eq!(command.actor.role, Some(ActorRole::Owner));
            }
            BuzzNormalized::Turn(_) => panic!("expected command"),
        }
    }

    #[test]
    fn owner_cancel_mention_normalizes_to_conversation_command() {
        let normalized = normalize_buzz_event(&config(), event("!cancel"));

        match normalized {
            BuzzNormalized::Command(command) => {
                assert_eq!(command.command, PlatformCommand::TurnCancel);
                assert_eq!(command.conversation_key, "buzz:channel-1");
            }
            BuzzNormalized::Turn(_) => panic!("expected command"),
        }
    }

    #[test]
    fn non_owner_command_text_remains_turn() {
        let mut inbound = event("!cancel");
        inbound.sender_pubkey_hex = "not-owner".to_string();

        let normalized = normalize_buzz_event(&config(), inbound);

        match normalized {
            BuzzNormalized::Turn(turn) => {
                assert_eq!(turn.message.text, "!cancel");
                assert_eq!(turn.sender.role, None);
            }
            BuzzNormalized::Command(_) => panic!("non-owner command text must remain a turn"),
        }
    }

    #[test]
    fn command_without_agent_mention_remains_turn() {
        let mut inbound = event("!rotate");
        inbound.tags.clear();

        let normalized = normalize_buzz_event(&config(), inbound);

        assert!(matches!(normalized, BuzzNormalized::Turn(_)));
    }
}
