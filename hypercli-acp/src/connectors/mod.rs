//! Connector boundary for HyperCLI ACP.

pub mod buzz;
pub mod commands;
pub mod slack;

use std::{fmt, sync::Arc};

use async_trait::async_trait;

use crate::core::CoreState;
use crate::types::{
    ActivityFrame, ConnectorReply, DeliveryReceipt, NormalizedCommand, NormalizedTurn, TurnAccepted,
};

pub type ConnectorResult<T> = Result<T, ConnectorError>;

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct ConnectorError {
    message: String,
}

impl ConnectorError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for ConnectorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ConnectorError {}

#[async_trait]
pub trait Connector: Send + Sync {
    fn id(&self) -> &'static str;

    fn capabilities(&self) -> ConnectorCapabilities;

    async fn start(&mut self, host: ConnectorHost) -> ConnectorResult<()>;

    async fn stop(&mut self, host: ConnectorHost) -> ConnectorResult<()>;

    async fn deliver_reply(&self, reply: ConnectorReply) -> ConnectorResult<DeliveryReceipt>;
}

#[derive(Clone)]
pub struct ConnectorHost {
    core: Arc<CoreState>,
}

impl ConnectorHost {
    pub fn new(core: Arc<CoreState>) -> Self {
        Self { core }
    }

    pub async fn submit_turn(&self, turn: NormalizedTurn) -> ConnectorResult<TurnAccepted> {
        Ok(self.core.submit_turn(turn).await)
    }

    pub async fn submit_command(
        &self,
        command: NormalizedCommand,
    ) -> ConnectorResult<crate::types::ControlResult> {
        let request_id = command.request_id.clone();
        let platform_command = command.command;
        let conversation_key = Some(command.conversation_key);
        let turn_id = command.turn_id;
        Ok(self
            .core
            .submit_command(request_id, platform_command, conversation_key, turn_id)
            .await)
    }

    pub async fn emit_activity(&self, frame: ActivityFrame) {
        self.core.activity().emit(frame).await;
    }
}

#[derive(Debug, Clone, Copy, Default, Eq, PartialEq)]
pub struct ConnectorCapabilities {
    pub inbound: bool,
    pub outbound: bool,
    pub history: bool,
    pub chat_commands: bool,
    pub durable_ingress: bool,
    pub reply_receipts: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connector_capabilities_are_explicit() {
        let caps = ConnectorCapabilities {
            inbound: true,
            outbound: true,
            history: false,
            chat_commands: true,
            durable_ingress: true,
            reply_receipts: true,
        };

        assert!(caps.inbound);
        assert!(caps.outbound);
        assert!(caps.chat_commands);
    }
}
