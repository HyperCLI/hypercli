use async_trait::async_trait;
use serde_json::json;
use thiserror::Error;

use crate::types::{NormalizedTurn, StopReason, TurnUsage};

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum RuntimeProtocol {
    CanonicalAcp,
    BuzzCompat,
    Native,
    Stub,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct RuntimePluginInfo {
    pub id: &'static str,
    pub protocol: RuntimeProtocol,
    pub canonical_baseline: bool,
    pub requires_platform_ws: bool,
}

#[derive(Debug, Clone)]
pub struct RuntimeSession {
    pub session_id: String,
    pub created: bool,
}

#[derive(Debug, Clone)]
pub struct RuntimeTurn {
    pub turn: NormalizedTurn,
    pub session_id: String,
}

#[derive(Debug, Clone)]
pub struct RuntimeTurnResult {
    pub reply_text: Option<String>,
    pub stop_reason: StopReason,
    pub usage: Option<TurnUsage>,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum RuntimeError {
    #[error("runtime unavailable: {0}")]
    Unavailable(String),
    #[error("runtime failed: {0}")]
    Failed(String),
    #[error("runtime turn cancelled")]
    Cancelled,
}

#[async_trait]
pub trait RuntimeAdapter: Send + Sync {
    fn plugin_info(&self) -> RuntimePluginInfo;

    async fn ensure_session(
        &self,
        conversation_key: &str,
        existing_session_id: Option<String>,
    ) -> Result<RuntimeSession, RuntimeError>;

    async fn run_turn(&self, turn: RuntimeTurn) -> Result<RuntimeTurnResult, RuntimeError>;

    async fn cancel_turn(
        &self,
        _conversation_key: &str,
        _turn_id: Option<&str>,
    ) -> Result<(), RuntimeError> {
        Ok(())
    }

    async fn shutdown(&self) -> Result<(), RuntimeError> {
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct StubRuntime;

#[async_trait]
impl RuntimeAdapter for StubRuntime {
    fn plugin_info(&self) -> RuntimePluginInfo {
        RuntimePluginInfo {
            id: "stub",
            protocol: RuntimeProtocol::Stub,
            canonical_baseline: false,
            requires_platform_ws: false,
        }
    }

    async fn ensure_session(
        &self,
        conversation_key: &str,
        existing_session_id: Option<String>,
    ) -> Result<RuntimeSession, RuntimeError> {
        let created = existing_session_id.is_none();
        Ok(RuntimeSession {
            session_id: existing_session_id
                .unwrap_or_else(|| format!("stub_session:{conversation_key}")),
            created,
        })
    }

    async fn run_turn(&self, turn: RuntimeTurn) -> Result<RuntimeTurnResult, RuntimeError> {
        Ok(RuntimeTurnResult {
            reply_text: turn.turn.require_reply.unwrap_or(false).then(|| {
                format!(
                    "OpenCode ACP adapter is not wired yet; accepted turn {}.",
                    turn.turn.turn_id.as_deref().unwrap_or("unknown")
                )
            }),
            stop_reason: StopReason::EndTurn,
            usage: None,
        })
    }
}

pub fn runtime_error_payload(error: &RuntimeError) -> serde_json::Value {
    json!({
        "class": "runtime",
        "message": error.to_string(),
        "retryable": !matches!(error, RuntimeError::Cancelled),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_plugin_info_is_explicit() {
        let info = StubRuntime.plugin_info();
        assert_eq!(info.id, "stub");
        assert_eq!(info.protocol, RuntimeProtocol::Stub);
        assert!(!info.canonical_baseline);
        assert!(!info.requires_platform_ws);
    }
}
