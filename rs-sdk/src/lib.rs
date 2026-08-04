//! Typed Rust client for the HyperCLI managed-agent API.
//!
//! This crate intentionally covers the deployment surface needed by backend
//! providers. It does not implement ACP or a Buzz relay client.

mod client;
mod config;
mod types;

pub use client::{HyperCliClient, HyperCliError};
pub use config::{
    discover_client_config, discover_client_config_from, normalize_agents_api_base,
    remove_config_api_keys, save_api_key, write_config_values, ClientConfig, ConfigError,
    API_KEY_CONFIG_KEYS, DEFAULT_AGENTS_API_BASE,
};
pub use types::{
    AgentCapacity, AgentSize, AgentSlot, AgentSlotInventory, ApiKey, AuthMe, BuzzLaunchConfig,
    BuzzLaunchError, CreateApiKeyRequest, CreateDeploymentRequest, Deployment, DeploymentRoutes,
    EntitlementsSummary, ExecDeploymentRequest, ExecDeploymentResponse, HyperAgentCanonicalPlanId,
    HyperAgentCurrentPlan, HyperAgentEntitlement, HyperAgentEntitlementsSummary, HyperAgentPlan,
    HyperAgentPlanResources, HyperAgentSubscriptionSummary, ManagedRuntime, RouteConfig,
    SetDeploymentRouteRequest, SetDeploymentRoutesRequest, StartDeploymentRequest,
    BUZZ_RUNTIME_SCOPES,
};
