//! Launch contract for hosted OpenClaw agents.
//!
//! Centralizes the image, routes, storage policy, and runtime scopes that the
//! TypeScript and Python SDKs apply in their `createOpenClaw` helpers so Rust
//! callers (desktop app, providers) build identical deployments. Nostr/Buzz
//! identity is deliberately absent here: Buzz launch wiring stays with the
//! caller so keys are generated and held locally, never persisted backend-side.

use std::collections::BTreeMap;

use crate::{AgentSize, CreateDeploymentRequest, ManagedRuntime, RouteConfig};

pub const OPENCLAW_IMAGE: &str = "ghcr.io/hypercli/hypercli-openclaw:prod";
pub const OPENCLAW_PRO_IMAGE: &str = "ghcr.io/hypercli/hypercli-openclaw:pro-prod";
pub const OPENCLAW_SYNC_ROOT: &str = "/home/node";
pub const OPENCLAW_GATEWAY_PORT: u16 = 18789;
pub const OPENCLAW_DESKTOP_PORT: u16 = 3000;
pub const OPENCLAW_DESKTOP_PREFIX: &str = "desktop";
pub const HYPER_DESKTOP_ENABLED_ENV: &str = "HYPER_DESKTOP_ENABLED";
pub const OPENCLAW_CRON_ENABLED_ENV: &str = "OPENCLAW_CRON_ENABLED";
pub const OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN_ENV: &str = "OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN";
pub const OPENCLAW_TRUSTED_PROXIES_ENV: &str = "OPENCLAW_TRUSTED_PROXIES";
pub const OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN_DEFAULT: &str = "*";
pub const HYPER_MODELS_ENV: &str = "HYPER_MODELS";
pub const HYPER_EMBEDDING_MODELS_ENV: &str = "HYPER_EMBEDDING_MODELS";
pub const OPENCLAW_MEMORY_SEARCH_ENABLED_ENV: &str = "OPENCLAW_MEMORY_SEARCH_ENABLED";
pub const OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START_ENV: &str =
    "OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START";
pub const OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH_ENV: &str = "OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH";
pub const OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_ENV: &str = "OPENCLAW_MEMORY_SEARCH_SYNC_WATCH";
pub const OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS_ENV: &str =
    "OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS";
pub const OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES_ENV: &str =
    "OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES";
pub const HYPER_WORKSPACES_BOOT_SYNC_ENV: &str = "HYPER_WORKSPACES_BOOT_SYNC";
pub const HYPER_WORKSPACES_DIR_ENV: &str = "HYPER_WORKSPACES_DIR";
pub const HYPER_WORKSPACES_SYNC_READY_ONLY_ENV: &str = "HYPER_WORKSPACES_SYNC_READY_ONLY";

/// Build the env that replaces OpenClaw `gateway.controlUi.allowedOrigins`.
pub fn openclaw_control_ui_allowed_origins_env<I, S>(origins: I) -> BTreeMap<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let origins = origins
        .into_iter()
        .map(|origin| origin.as_ref().trim().to_owned())
        .filter(|origin| !origin.is_empty())
        .collect::<Vec<_>>();
    if origins.is_empty() {
        BTreeMap::new()
    } else {
        BTreeMap::from([(
            OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN_ENV.to_owned(),
            origins.join(","),
        )])
    }
}

/// Build the env that replaces OpenClaw `gateway.trustedProxies`.
pub fn openclaw_trusted_proxies_env<I, S>(trusted_proxies: I) -> BTreeMap<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let proxies = trusted_proxies
        .into_iter()
        .map(|proxy| proxy.as_ref().trim().to_owned())
        .filter(|proxy| !proxy.is_empty())
        .collect::<Vec<_>>();
    if proxies.is_empty() {
        BTreeMap::new()
    } else {
        BTreeMap::from([(OPENCLAW_TRUSTED_PROXIES_ENV.to_owned(), proxies.join(","))])
    }
}

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
/// route, `HYPER_DESKTOP_ENABLED=1`, pro image.
#[derive(Clone, Debug, Default)]
pub struct OpenClawLaunchConfig {
    pub desktop: bool,
    pub cron_enabled: Option<bool>,
}

impl OpenClawLaunchConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn desktop() -> Self {
        Self {
            desktop: true,
            cron_enabled: None,
        }
    }

    pub fn with_cron_enabled(mut self, enabled: bool) -> Self {
        self.cron_enabled = Some(enabled);
        self
    }

    /// OpenClaw gateway route, plus the desktop route when enabled. Matches
    /// `buildOpenClawRoutes` in the TypeScript SDK.
    pub fn routes(&self) -> BTreeMap<String, RouteConfig> {
        let mut routes = BTreeMap::new();
        self.ensure_routes(&mut routes);
        routes
    }

    pub fn gateway_route() -> RouteConfig {
        RouteConfig {
            port: OPENCLAW_GATEWAY_PORT,
            auth: false,
            prefix: Some(String::new()),
            remove_headers: Some(
                [
                    "Forwarded",
                    "X-Forwarded-For",
                    "X-Forwarded-Host",
                    "X-Forwarded-Port",
                    "X-Forwarded-Proto",
                    "X-Forwarded-Server",
                    "X-Real-IP",
                ]
                .iter()
                .map(|header| header.to_string())
                .collect(),
            ),
        }
    }

    pub fn ensure_routes(&self, routes: &mut BTreeMap<String, RouteConfig>) {
        routes.insert("openclaw".to_owned(), Self::gateway_route());
        if self.desktop {
            routes.insert(
                "desktop".to_owned(),
                RouteConfig {
                    port: OPENCLAW_DESKTOP_PORT,
                    auth: true,
                    prefix: Some(OPENCLAW_DESKTOP_PREFIX.to_owned()),
                    remove_headers: None,
                },
            );
        }
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
            request.image = Some(
                if self.desktop {
                    OPENCLAW_PRO_IMAGE
                } else {
                    OPENCLAW_IMAGE
                }
                .to_owned(),
            );
        }
        if self.desktop {
            request
                .env
                .entry(HYPER_DESKTOP_ENABLED_ENV.to_owned())
                .or_insert_with(|| "1".to_owned());
        }
        request
            .env
            .entry(OPENCLAW_CRON_ENABLED_ENV.to_owned())
            .or_insert_with(|| {
                if self.cron_enabled.unwrap_or(true) {
                    "1".to_owned()
                } else {
                    "0".to_owned()
                }
            });
        request
            .env
            .entry(HYPER_MODELS_ENV.to_owned())
            .or_insert_with(|| "default-anthropic".to_owned());
        request
            .env
            .entry(HYPER_EMBEDDING_MODELS_ENV.to_owned())
            .or_insert_with(|| "qwen3-embedding-4b".to_owned());
        request
            .env
            .entry(OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN_ENV.to_owned())
            .or_insert_with(|| OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN_DEFAULT.to_owned());
        apply_openclaw_sync_env_defaults(&mut request.env);
        self.ensure_routes(&mut request.routes);
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

fn apply_openclaw_sync_env_defaults(env: &mut BTreeMap<String, String>) {
    for (key, value) in [
        (HYPER_WORKSPACES_BOOT_SYNC_ENV, "1"),
        (HYPER_WORKSPACES_DIR_ENV, "/home/node/shared"),
        (HYPER_WORKSPACES_SYNC_READY_ONLY_ENV, "1"),
        (OPENCLAW_MEMORY_SEARCH_ENABLED_ENV, "1"),
        (OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START_ENV, "0"),
        (OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH_ENV, "0"),
        (OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_ENV, "0"),
        (OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS_ENV, "30000"),
        (OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES_ENV, "0"),
    ] {
        env.entry(key.to_owned())
            .or_insert_with(|| value.to_owned());
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
        OpenClawLaunchConfig {
            desktop,
            cron_enabled: None,
        }
        .apply_to_create(&mut request);
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
        assert_eq!(
            request.env.get(HYPER_MODELS_ENV).map(String::as_str),
            Some("default-anthropic")
        );
        assert_eq!(
            request
                .env
                .get(HYPER_EMBEDDING_MODELS_ENV)
                .map(String::as_str),
            Some("qwen3-embedding-4b")
        );
        assert_eq!(
            request
                .env
                .get(HYPER_WORKSPACES_BOOT_SYNC_ENV)
                .map(String::as_str),
            Some("1")
        );
        assert_eq!(
            request
                .env
                .get(HYPER_WORKSPACES_DIR_ENV)
                .map(String::as_str),
            Some("/home/node/shared")
        );
        assert_eq!(
            request
                .env
                .get(HYPER_WORKSPACES_SYNC_READY_ONLY_ENV)
                .map(String::as_str),
            Some("1")
        );
        assert_eq!(
            request
                .env
                .get(OPENCLAW_MEMORY_SEARCH_ENABLED_ENV)
                .map(String::as_str),
            Some("1")
        );
        assert_eq!(
            request
                .env
                .get(OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES_ENV)
                .map(String::as_str),
            Some("0")
        );
        assert_eq!(
            request
                .env
                .get(OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN_ENV)
                .map(String::as_str),
            Some(OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN_DEFAULT)
        );
        assert!(!request.env.contains_key(OPENCLAW_TRUSTED_PROXIES_ENV));
        assert_eq!(request.sync_root.as_deref(), Some(OPENCLAW_SYNC_ROOT));
        assert_eq!(
            request.sync_exclude.as_ref().map(Vec::len),
            Some(OPENCLAW_SYNC_EXCLUDE.len())
        );
        let gateway = request.routes.get("openclaw").expect("gateway route");
        assert_eq!(gateway.port, OPENCLAW_GATEWAY_PORT);
        assert!(!gateway.auth);
        assert_eq!(gateway.remove_headers, Some(expected_remove_headers()));
        assert!(!request.routes.contains_key("desktop"));
        assert!(!request.env.contains_key(HYPER_DESKTOP_ENABLED_ENV));
        assert_eq!(
            request
                .env
                .get(OPENCLAW_CRON_ENABLED_ENV)
                .map(String::as_str),
            Some("1")
        );
        assert_eq!(request.runtime_scopes.len(), AGENT_RUNTIME_SCOPES.len());
    }

    #[test]
    fn openclaw_pro_adds_desktop_route_and_env() {
        let request = CreateDeploymentRequest::openclaw(None, None, true);
        assert_eq!(request.runtime, ManagedRuntime::OpenclawPro);
        assert_eq!(request.image.as_deref(), Some(OPENCLAW_PRO_IMAGE));
        let desktop = request.routes.get("desktop").expect("desktop route");
        assert_eq!(desktop.port, OPENCLAW_DESKTOP_PORT);
        assert!(desktop.auth);
        assert_eq!(desktop.prefix.as_deref(), Some(OPENCLAW_DESKTOP_PREFIX));
        assert_eq!(
            request
                .env
                .get(HYPER_DESKTOP_ENABLED_ENV)
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

    #[test]
    fn openclaw_create_can_disable_cron() {
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Openclaw);

        OpenClawLaunchConfig::new()
            .with_cron_enabled(false)
            .apply_to_create(&mut request);

        assert_eq!(
            request
                .env
                .get(OPENCLAW_CRON_ENABLED_ENV)
                .map(String::as_str),
            Some("0")
        );
    }

    #[test]
    fn explicit_gateway_env_wins_over_defaults() {
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Openclaw);
        request.env.insert(
            OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN_ENV.to_owned(),
            "https://console.example".to_owned(),
        );
        request.env.insert(
            OPENCLAW_TRUSTED_PROXIES_ENV.to_owned(),
            "10.0.0.0/8".to_owned(),
        );

        OpenClawLaunchConfig::new().apply_to_create(&mut request);

        assert_eq!(
            request
                .env
                .get(OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN_ENV)
                .map(String::as_str),
            Some("https://console.example")
        );
        assert_eq!(
            request
                .env
                .get(OPENCLAW_TRUSTED_PROXIES_ENV)
                .map(String::as_str),
            Some("10.0.0.0/8")
        );
    }

    #[test]
    fn openclaw_env_helpers_are_comma_separated_replacements() {
        assert_eq!(
            openclaw_control_ui_allowed_origins_env([
                "https://console.example",
                " tauri://localhost "
            ])
            .get(OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN_ENV)
            .map(String::as_str),
            Some("https://console.example,tauri://localhost")
        );
        assert_eq!(
            openclaw_trusted_proxies_env(["10.0.0.0/8", "", " 127.0.0.1 "])
                .get(OPENCLAW_TRUSTED_PROXIES_ENV)
                .map(String::as_str),
            Some("10.0.0.0/8,127.0.0.1")
        );
        assert!(openclaw_trusted_proxies_env([""]).is_empty());
    }

    #[test]
    fn existing_routes_keep_custom_routes_but_replace_openclaw_gateway() {
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Openclaw);
        request.routes.insert(
            "custom".to_owned(),
            RouteConfig {
                port: 8080,
                auth: true,
                prefix: Some("app".to_owned()),
                remove_headers: None,
            },
        );
        request.routes.insert(
            "openclaw".to_owned(),
            RouteConfig {
                port: 19999,
                auth: true,
                prefix: Some("wrong".to_owned()),
                remove_headers: None,
            },
        );

        OpenClawLaunchConfig::new().apply_to_create(&mut request);

        let gateway = request.routes.get("openclaw").expect("gateway route");
        assert_eq!(gateway.port, OPENCLAW_GATEWAY_PORT);
        assert!(!gateway.auth);
        assert_eq!(gateway.prefix.as_deref(), Some(""));
        assert_eq!(gateway.remove_headers, Some(expected_remove_headers()));
        assert_eq!(
            request.routes.get("custom").expect("custom route").port,
            8080
        );
    }

    impl CreateDeploymentRequest {
        fn with_defaults(mut self) -> Self {
            self.image = Some("custom/image:tag".to_owned());
            self.sync_include = Some(vec!["workspace".to_owned()]);
            OpenClawLaunchConfig::new().apply_to_create(&mut self);
            self
        }
    }

    fn expected_remove_headers() -> Vec<String> {
        [
            "Forwarded",
            "X-Forwarded-For",
            "X-Forwarded-Host",
            "X-Forwarded-Port",
            "X-Forwarded-Proto",
            "X-Forwarded-Server",
            "X-Real-IP",
        ]
        .iter()
        .map(|header| header.to_string())
        .collect()
    }
}
