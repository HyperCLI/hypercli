//! Typed Rust client for the HyperCLI managed-agent API.
//!
//! This crate intentionally covers the deployment surface needed by backend
//! providers. It does not implement ACP or a Buzz relay client.

mod client;
mod config;
mod hermes;
mod keys;
mod runtime_auth;
mod types;

pub use client::{HyperCliClient, HyperCliError, DEFAULT_HOSTNAME_SETTLE_DELAY};
pub use config::{
    discover_agents_api_base, discover_client_config, discover_client_config_from,
    normalize_agents_api_base, remove_config_api_keys, save_api_key, write_config_values,
    ClientConfig, ConfigError, API_KEY_CONFIG_KEYS, DEFAULT_AGENTS_API_BASE,
};
pub use hermes::{
    HermesApiClient, HermesApiError, HermesCapabilities, HermesChatCompletion, HermesChatRequest,
    HermesDeletedSession, HermesDetailedHealth, HermesEventStream, HermesHealth,
    HermesLaunchConfig, HermesMessage, HermesMessageList, HermesModel, HermesModelList,
    HermesModelLock, HermesModelLockRequest, HermesOpenAiError, HermesRun, HermesRunApproval,
    HermesRunApprovalChoice, HermesRunApprovalRequest, HermesRunCreated, HermesRunRequest,
    HermesSession, HermesSessionCreateRequest, HermesSessionForkRequest, HermesSessionList,
    HermesSessionPatchRequest, HermesSseEvent, HERMES_AGENT_IMAGE, HERMES_API_PORT,
};
pub use keys::{issue_api_key_from_jwt, IssueApiKeyError, IssueApiKeyFromJwtOptions};
pub use runtime_auth::{
    NativeRuntime, RuntimeAuthError, RuntimeAuthStatus, RuntimeLoginChallenge, RuntimeLoginResult,
    RuntimeLoginSession, RuntimeShellToken,
};
pub use types::{
    canonical_deployment_name, is_agent_runtime_inactive_state, is_agent_transitional_state,
    AgentCapacity, AgentRuntimeStatus, AgentSize, AgentSlot, AgentSlotInventory, ApiKey, AuthMe,
    BuzzLaunchConfig, BuzzLaunchError, CreateApiKeyRequest, CreateDeploymentRequest,
    DeleteDeploymentResponse, Deployment, DeploymentEvent, DeploymentFileWriteResponse,
    DeploymentLaunchConfig, DeploymentListFilters, DeploymentProfileImageResponse,
    DeploymentRoutes, EntitlementsSummary, ExecDeploymentRequest, ExecDeploymentResponse,
    HyperAgentCanonicalPlanId, HyperAgentCurrentPlan, HyperAgentEntitlement,
    HyperAgentEntitlementsSummary, HyperAgentPlan, HyperAgentPlanResources,
    HyperAgentSubscriptionSummary, ManagedRuntime, Nullable, RouteConfig,
    SetDeploymentRouteRequest, SetDeploymentRoutesRequest, StartDeploymentRequest,
    UpdateDeploymentRequest, AGENT_RUNTIME_INACTIVE_STATES, AGENT_TRANSITIONAL_STATES,
    BUZZ_ACP_MAX_REPLY_NAGS, BUZZ_ACP_REPLY_GUARD_NAG, BUZZ_DEPLOYMENT_TAG, BUZZ_RUNTIME_SCOPES,
    CANONICAL_AGENT_STATES,
};
