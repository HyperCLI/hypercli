//! Canonical ACP runtime protocol plugin.

use async_trait::async_trait;

use crate::runtime::{
    RuntimeAdapter, RuntimeError, RuntimePluginInfo, RuntimeProtocol, RuntimeSession, RuntimeTurn,
    RuntimeTurnResult, StubRuntime,
};

#[derive(Debug, Clone)]
pub struct CanonicalAcpRuntimePlugin {
    inner: StubRuntime,
}

impl CanonicalAcpRuntimePlugin {
    pub fn new() -> Self {
        Self { inner: StubRuntime }
    }
}

impl Default for CanonicalAcpRuntimePlugin {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl RuntimeAdapter for CanonicalAcpRuntimePlugin {
    fn plugin_info(&self) -> RuntimePluginInfo {
        RuntimePluginInfo {
            id: "canonical_acp",
            protocol: RuntimeProtocol::CanonicalAcp,
            canonical_baseline: true,
            requires_platform_ws: false,
        }
    }

    async fn ensure_session(
        &self,
        conversation_key: &str,
        existing_session_id: Option<String>,
    ) -> Result<RuntimeSession, RuntimeError> {
        self.inner
            .ensure_session(conversation_key, existing_session_id)
            .await
    }

    async fn run_turn(&self, turn: RuntimeTurn) -> Result<RuntimeTurnResult, RuntimeError> {
        self.inner.run_turn(turn).await
    }

    async fn cancel_turn(
        &self,
        conversation_key: &str,
        turn_id: Option<&str>,
    ) -> Result<(), RuntimeError> {
        self.inner.cancel_turn(conversation_key, turn_id).await
    }

    async fn shutdown(&self) -> Result<(), RuntimeError> {
        self.inner.shutdown().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_acp_plugin_is_the_baseline_runtime_protocol() {
        let info = CanonicalAcpRuntimePlugin::new().plugin_info();
        assert_eq!(info.id, "canonical_acp");
        assert_eq!(info.protocol, RuntimeProtocol::CanonicalAcp);
        assert!(info.canonical_baseline);
        assert!(!info.requires_platform_ws);
    }
}
