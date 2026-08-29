//! HyperCLI platform `/ws` control-plane plugin.

use std::net::SocketAddr;
use std::sync::Arc;

use url::Url;

use crate::core::CoreState;
use crate::ws;

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum PlatformWsMode {
    Inbound { bind: SocketAddr },
    Outbound { callback_url: Url },
}

#[derive(Debug, Clone)]
pub struct PlatformWsControlPlane {
    mode: PlatformWsMode,
}

impl PlatformWsControlPlane {
    pub fn inbound(bind: SocketAddr) -> Self {
        Self {
            mode: PlatformWsMode::Inbound { bind },
        }
    }

    pub fn outbound(callback_url: Url) -> Self {
        Self {
            mode: PlatformWsMode::Outbound { callback_url },
        }
    }

    pub fn mode(&self) -> &PlatformWsMode {
        &self.mode
    }

    pub async fn run(self, core: Arc<CoreState>) -> anyhow::Result<()> {
        match self.mode {
            PlatformWsMode::Inbound { bind } => ws::serve(bind, core).await,
            PlatformWsMode::Outbound { callback_url } => {
                ws::connect_callback(callback_url, core).await
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};

    use super::*;

    #[test]
    fn platform_ws_supports_outbound_callback_mode() {
        let url = Url::parse("wss://api.example.com/acp/ws").unwrap();
        let plugin = PlatformWsControlPlane::outbound(url.clone());
        assert_eq!(
            plugin.mode(),
            &PlatformWsMode::Outbound { callback_url: url }
        );
    }

    #[test]
    fn platform_ws_supports_inbound_listener_mode() {
        let bind = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8787);
        let plugin = PlatformWsControlPlane::inbound(bind);
        assert_eq!(plugin.mode(), &PlatformWsMode::Inbound { bind });
    }
}
