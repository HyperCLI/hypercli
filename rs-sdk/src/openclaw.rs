//! Launch contract for hosted OpenClaw agents.
//!
//! Centralizes the image, routes, storage policy, and runtime scopes that the
//! TypeScript and Python SDKs apply in their `createOpenClaw` helpers so Rust
//! callers (desktop app, providers) build identical deployments. Nostr/Buzz
//! identity is deliberately absent here: Buzz launch wiring stays with the
//! caller so keys are generated and held locally, never persisted backend-side.

use std::collections::BTreeMap;

use crate::{AgentSize, CreateDeploymentRequest, ManagedRuntime, RouteConfig};

pub const OPENCLAW_IMAGE: &str = "ghcr.io/hypercli/hypercli-openclaw:pro-latest";
pub const OPENCLAW_SYNC_ROOT: &str = "/home/node";
pub const OPENCLAW_GATEWAY_PORT: u16 = 18789;
pub const OPENCLAW_DESKTOP_PORT: u16 = 3000;
pub const OPENCLAW_DESKTOP_PREFIX: &str = "desktop";
pub const OPENCLAW_DESKTOP_ENABLED_ENV: &str = "OPENCLAW_DESKTOP_ENABLED";

/// Runtime scopes granted to a hosted agent's scoped runtime key. Matches
/// `DEFAULT_AGENT_RUNTIME_SCOPES` in the TypeScript SDK.
pub const AGENT_RUNTIME_SCOPES: [&str; 7] = [
    "agents:none",
    "files:*",
    "flows:*",
    "models:*",
    "voice:*",
    "web:*",
    "workspaces:*",
];

/// Paths excluded from whole-root sync for hosted OpenClaw agents. Matches
/// `DEFAULT_OPENCLAW_SYNC_EXCLUDE` in the TypeScript SDK.
pub const OPENCLAW_SYNC_EXCLUDE: [&str; 9] = [
    "shared/**",
    ".openclaw/npm/**/node_modules/**",
    ".openclaw/agents/**/agent/*.sqlite.memory-reindex-*",
    ".openclaw/agents/**/agent/*.sqlite.reindex-lock.sqlite*",
    ".openclaw/browser/**/Code Cache/**",
    ".openclaw/browser/**/GPUCache/**",
    ".openclaw/browser/**/ShaderCache/**",
    ".openclaw/browser/**/GrShaderCache/**",
    ".openclaw/browser/**/optimization_guide_model_store/**",
];

/// Minimal managed launch defaults for hosted OpenClaw agents.
///
/// With `desktop` enabled this builds the `openclaw-pro` variant: desktop
/// route, `OPENCLAW_DESKTOP_ENABLED=1`, same image.
#[derive(Clone, Debug, Default)]
pub struct OpenClawLaunchConfig {
    pub desktop: bool,
}

impl OpenClawLaunchConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn desktop() -> Self {
        Self { desktop: true }
    }

    /// OpenClaw gateway route, plus the desktop route when enabled. Matches
    /// `buildOpenClawRoutes` in the TypeScript SDK.
    pub fn routes(&self) -> BTreeMap<String, RouteConfig> {
        let mut routes = BTreeMap::new();
        routes.insert(
            "openclaw".to_owned(),
            RouteConfig {
                port: OPENCLAW_GATEWAY_PORT,
                auth: false,
                prefix: Some(String::new()),
            },
        );
        if self.desktop {
            routes.insert(
                "desktop".to_owned(),
                RouteConfig {
                    port: OPENCLAW_DESKTOP_PORT,
                    auth: true,
                    prefix: Some(OPENCLAW_DESKTOP_PREFIX.to_owned()),
                },
            );
        }
        routes
    }

    /// Apply the OpenClaw defaults to a create request. Explicitly set fields
    /// win; only unset fields are filled in.
    pub fn apply_to_create(&self, request: &mut CreateDeploymentRequest) {
        request.runtime = if self.desktop {
            ManagedRuntime::OpenclawPro
        } else {
            ManagedRuntime::Openclaw
        };
        if request.image.is_none() {
            request.image = Some(OPENCLAW_IMAGE.to_owned());
        }
        if self.desktop {
            request
                .env
                .entry(OPENCLAW_DESKTOP_ENABLED_ENV.to_owned())
                .or_insert_with(|| "1".to_owned());
        }
        if request.routes.is_empty() {
            request.routes = self.routes();
        }
        if request.sync_root.is_none() {
            request.sync_root = Some(OPENCLAW_SYNC_ROOT.to_owned());
        }
        if request.sync_include.is_none() && request.sync_exclude.is_none() {
            request.sync_exclude = Some(
                OPENCLAW_SYNC_EXCLUDE
                    .iter()
                    .map(|path| (*path).to_owned())
                    .collect(),
            );
        }
        if request.runtime_scopes.is_empty() {
            request.runtime_scopes = AGENT_RUNTIME_SCOPES
                .iter()
                .map(|scope| (*scope).to_owned())
                .collect();
        }
    }
}

impl CreateDeploymentRequest {
    /// A hosted OpenClaw agent create request with the shared launch contract
    /// applied. Pass `size` to claim a slot-sized deployment; `None` uses the
    /// plan default.
    pub fn openclaw(name: Option<String>, size: Option<AgentSize>, desktop: bool) -> Self {
        let mut request = CreateDeploymentRequest::new(if desktop {
            ManagedRuntime::OpenclawPro
        } else {
            ManagedRuntime::Openclaw
        });
        request.name = name;
        request.size = size;
        OpenClawLaunchConfig { desktop }.apply_to_create(&mut request);
        request
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openclaw_create_matches_shared_contract() {
        let request = CreateDeploymentRequest::openclaw(
            Some("test-agent".to_owned()),
            Some(AgentSize::Small),
            false,
        );
        assert_eq!(request.runtime, ManagedRuntime::Openclaw);
        assert_eq!(request.name.as_deref(), Some("test-agent"));
        assert_eq!(request.image.as_deref(), Some(OPENCLAW_IMAGE));
        assert_eq!(request.sync_root.as_deref(), Some(OPENCLAW_SYNC_ROOT));
        assert_eq!(
            request.sync_exclude.as_ref().map(Vec::len),
            Some(OPENCLAW_SYNC_EXCLUDE.len())
        );
        let gateway = request.routes.get("openclaw").expect("gateway route");
        assert_eq!(gateway.port, OPENCLAW_GATEWAY_PORT);
        assert!(!gateway.auth);
        assert!(!request.routes.contains_key("desktop"));
        assert!(!request.env.contains_key(OPENCLAW_DESKTOP_ENABLED_ENV));
        assert_eq!(request.runtime_scopes.len(), AGENT_RUNTIME_SCOPES.len());
    }

    #[test]
    fn openclaw_pro_adds_desktop_route_and_env() {
        let request = CreateDeploymentRequest::openclaw(None, None, true);
        assert_eq!(request.runtime, ManagedRuntime::OpenclawPro);
        let desktop = request.routes.get("desktop").expect("desktop route");
        assert_eq!(desktop.port, OPENCLAW_DESKTOP_PORT);
        assert!(desktop.auth);
        assert_eq!(desktop.prefix.as_deref(), Some(OPENCLAW_DESKTOP_PREFIX));
        assert_eq!(
            request
                .env
                .get(OPENCLAW_DESKTOP_ENABLED_ENV)
                .map(String::as_str),
            Some("1")
        );
    }

    #[test]
    fn explicit_fields_win_over_defaults() {
        let request = CreateDeploymentRequest::new(ManagedRuntime::Openclaw).with_defaults();
        assert_eq!(request.image.as_deref(), Some("custom/image:tag"));
        assert!(request.sync_exclude.is_none());
    }

    impl CreateDeploymentRequest {
        fn with_defaults(mut self) -> Self {
            self.image = Some("custom/image:tag".to_owned());
            self.sync_include = Some(Vec::new());
            OpenClawLaunchConfig::new().apply_to_create(&mut self);
            self
        }
    }
}
