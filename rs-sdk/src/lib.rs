//! Typed Rust client for the HyperCLI managed-agent API.
//!
//! This crate intentionally covers the deployment surface needed by backend
//! providers. It does not implement ACP or a Buzz relay client.

mod billing;
mod client;
mod config;
mod files;
mod hermes;
mod instances;
mod jobs;
mod keys;
mod models;
mod openclaw;
mod renders;
mod routines;
mod runtime_auth;
mod types;
mod user;
mod workspaces;

pub use billing::{Balance, BillingClient, Transaction};
pub use client::{
    FileApiReadyOptions, HyperCliClient, HyperCliError, AGENT_FILE_READ_MAX_BYTES,
    AGENT_FILE_WRITE_MAX_BYTES, DEFAULT_HOSTNAME_SETTLE_DELAY, DEFAULT_REQUEST_TIMEOUT,
};
pub use config::{
    discover_agents_api_base, discover_client_config, discover_client_config_from,
    normalize_agents_api_base, remove_config_api_keys, save_api_key, write_config_values,
    ClientConfig, ConfigError, API_KEY_CONFIG_KEYS, DEFAULT_AGENTS_API_BASE,
};
pub use files::{File, FilesClient};
pub use hermes::{
    HermesApiClient, HermesApiError, HermesCapabilities, HermesChatCompletion, HermesChatRequest,
    HermesDeletedSession, HermesDetailedHealth, HermesEventStream, HermesHealth,
    HermesLaunchConfig, HermesMessage, HermesMessageList, HermesModel, HermesModelList,
    HermesModelLock, HermesModelLockRequest, HermesOpenAiError, HermesRun, HermesRunApproval,
    HermesRunApprovalChoice, HermesRunApprovalRequest, HermesRunCreated, HermesRunRequest,
    HermesSession, HermesSessionCreateRequest, HermesSessionForkRequest, HermesSessionList,
    HermesSessionPatchRequest, HermesSseEvent, HERMES_AGENT_IMAGE, HERMES_API_PORT,
};
pub use instances::{GpuConfig, GpuPricing, GpuType, InstancesClient, PricingTier, Region};
pub use jobs::{
    find_by_hostname, find_by_ip, is_uuid, CreateJobOptions, Job, JobExecResult, JobListFilters,
    JobListPage, JobTags, JobsClient, TERMINAL_JOB_STATES,
};
pub use keys::{issue_api_key_from_jwt, IssueApiKeyError, IssueApiKeyFromJwtOptions, KeysClient};
pub use models::{ApiModel, ModelsClient};
pub use openclaw::{
    OpenClawLaunchConfig, AGENT_RUNTIME_SCOPES, HYPER_DESKTOP_ENABLED_ENV,
    OPENCLAW_CRON_ENABLED_ENV, OPENCLAW_DESKTOP_PORT, OPENCLAW_DESKTOP_PREFIX,
    OPENCLAW_GATEWAY_PORT, OPENCLAW_IMAGE, OPENCLAW_PRO_IMAGE, OPENCLAW_SYNC_EXCLUDE,
    OPENCLAW_SYNC_ROOT,
};
pub use renders::{
    AudioToTextRequest, CreateRenderRequest, FirstLastFrameVideoRequest, ImageToImageRequest,
    ImageToVideoRequest, Render, RenderListFilters, RenderStatus, RendersClient,
    SpeakingVideoRequest, TextToImageRequest, TextToSpeechRequest, TextToVideoRequest,
};
pub use routines::{
    derive_routines_api_base, Routine, RoutineCreate, RoutinePatch, RoutinesApiClient,
    RoutinesApiError,
};
pub use runtime_auth::{
    NativeRuntime, RuntimeAuthError, RuntimeAuthMethod, RuntimeAuthStatus, RuntimeLoginChallenge,
    RuntimeLoginResult, RuntimeLoginSession, RuntimeShellToken,
};
pub use types::{
    canonical_deployment_name, is_agent_runtime_inactive_state, is_agent_transitional_state,
    AgentAccessIdentity, AgentCapacity, AgentCorsConfig, AgentDirectoryListing, AgentFileEntry,
    AgentLaunchValueMutation, AgentSize, AgentSlot, AgentSlotInventory, AgentsMe, ApiKey, AuthMe,
    BuzzLaunchConfig, BuzzLaunchError, CompleteDeploymentLaunchConfig, CreateApiKeyRequest,
    CreateDeploymentRequest, DeleteDeploymentResponse, Deployment, DeploymentAccessToken,
    DeploymentEnvironment, DeploymentEvent, DeploymentFileWriteResponse, DeploymentLaunchConfig,
    DeploymentListFilters, DeploymentLogsToken, DeploymentMeta, DeploymentMetaStatus,
    DeploymentProfileImageResponse, DeploymentRoutes, DeploymentSecret, DeploymentSecretNames,
    EntitlementsSummary, ExecDeploymentRequest, ExecDeploymentResponse, HyperAgentAgentUsage,
    HyperAgentAgentUsageEntry, HyperAgentBillingInfo, HyperAgentBillingProfileFields,
    HyperAgentBillingProfileResponse, HyperAgentBillingUser, HyperAgentCanonicalPlanId,
    HyperAgentCurrentPlan, HyperAgentEntitlement, HyperAgentEntitlementsSummary,
    HyperAgentKeyUsage, HyperAgentKeyUsageEntry, HyperAgentPayment, HyperAgentPaymentEntitlement,
    HyperAgentPaymentSubscription, HyperAgentPaymentsResponse, HyperAgentPlan,
    HyperAgentPlanResources, HyperAgentStripeBillingPortalResponse,
    HyperAgentStripeCheckoutResponse, HyperAgentSubscription, HyperAgentSubscriptionList,
    HyperAgentSubscriptionMutationResult, HyperAgentSubscriptionSummary,
    HyperAgentSubscriptionTrial, HyperAgentSubscriptionUser, HyperAgentTokenMetrics,
    HyperAgentUsageHistory, HyperAgentUsageHistoryEntry, HyperAgentUsageSummary, JobLifecycleEvent,
    LifecycleActionRequest, ManagedRuntime, Nullable, RouteConfig, RuntimeIdentity,
    SetDeploymentRouteRequest, SetDeploymentRoutesRequest, StartDeploymentRequest,
    UpdateDeploymentRequest,
    AGENT_RUNTIME_INACTIVE_STATES, AGENT_TRANSITIONAL_STATES, BUZZ_ACP_MAX_REPLY_NAGS,
    BUZZ_ACP_REPLY_GUARD_NAG, BUZZ_DEPLOYMENT_TAG, BUZZ_RUNTIME_SCOPES, CANONICAL_AGENT_STATES,
    DEFAULT_BUZZ_RUST_LOG,
};
pub use user::{ApiUser, UserClient};
pub use workspaces::{
    derive_workspaces_api_base, CreateWorkspaceGrantRequest, CreateWorkspaceRequest,
    DownloadWorkspaceFileOptions, EnsureWorkspaceOptions, EnsureWorkspaceResult,
    RegisterWorkspaceFileRequest, UpdateWorkspaceFileRequest, UpdateWorkspaceGrantRequest,
    UpdateWorkspaceRequest, UploadWorkspaceFileOptions, WaitUntilProcessedOptions, Workspace,
    WorkspaceAccessEntry, WorkspaceAccessSnapshot, WorkspaceAccessVisibility,
    WorkspaceAgentAssociation, WorkspaceDownloadUrl, WorkspaceFile, WorkspaceFileBytes,
    WorkspaceFileSearchResult, WorkspaceGrant, WorkspaceManifest, WorkspaceMarkdownFile,
    WorkspacesApiClient, WorkspacesApiError,
};
