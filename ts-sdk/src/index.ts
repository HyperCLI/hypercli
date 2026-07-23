/**
 * HyperCLI SDK - TypeScript client for HyperCLI API
 */

// Main client
export { HyperCLI, type HyperCLIOptions, type SystemStatus } from './client.js';
export { BrowserHyperCLI, type BrowserHyperCLIOptions } from './browser.js';

// Configuration
export {
  configure,
  getApiKey,
  getAgentApiKey,
  getApiUrl,
  getAgentsApiBaseUrl,
  getAgentsWsUrl,
  getWsUrl,
  GHCR_IMAGES,
  COMFYUI_IMAGE,
  DEFAULT_API_URL,
  DEFAULT_AGENTS_API_BASE_URL,
  DEFAULT_AGENTS_WS_URL,
  DEV_AGENTS_API_BASE_URL,
  DEV_AGENTS_WS_URL,
  DEFAULT_WS_URL,
} from './config.js';

// Errors
export { APIError } from './errors.js';

// HTTP Client
export { HTTPClient } from './http.js';

// Billing API
export { Billing, type Balance, type Transaction } from './billing.js';

// Jobs API
export {
  Jobs,
  type Job,
  type JobListPage,
  type GPUMetrics,
  type SystemMetrics,
  type JobMetrics,
  type ExecResult,
  type CreateJobOptions,
  type ListJobsOptions,
  findJob,
  findById,
  findByHostname,
  findByIp,
  isUuid,
} from './jobs.js';

// Instances API
export {
  Instances,
  type GPUType,
  type GPUConfig,
  type Region,
  type GPUPricing,
  type PricingTier,
  type AvailableGPU,
} from './instances.js';

// Renders API
export {
  Renders,
  type Render,
  type RenderStatus,
} from './renders.js';

// Files API
export {
  Files,
  type File,
} from './files.js';

// Voice API
export {
  VoiceAPI,
  type TTSOptions,
  type CloneOptions,
  type DesignOptions,
} from './voice.js';

// User API
export {
  UserAPI,
  isRuntimeAgent,
  runtimeAgentId,
  type User,
  type AuthMe,
  type RuntimeIdentity,
} from './user.js';

// Keys API
export {
  KeysAPI,
  type ApiKey,
  type ApiKeyBaselineValue,
  type ApiKeyBaselineFamily,
  API_KEY_BASELINE_FAMILIES,
} from './keys.js';

export {
  ModelsAPI,
  type Model,
} from './models.js';

export {
  WorkspacesAPI,
  deriveWorkspacesApiBase,
  type Workspace,
  type WorkspaceAccessEntry,
  type WorkspaceAccessSnapshot,
  type WorkspaceAccessVisibility,
  type WorkspaceAgentAssociation,
  type WorkspaceFileBytes,
  type WorkspaceDownloadUrl,
  type WorkspaceFile,
  type WorkspaceGrant,
  type WorkspaceManifest,
  type WorkspaceSubjectOptions,
} from './workspaces.js';

// Logs
export {
  LogStream,
  streamLogs,
  fetchLogs,
} from './logs.js';

// HyperAgent
export {
  HyperAgent,
  type HyperAgentPlan,
  type HyperAgentCurrentPlan,
  type HyperAgentEntitlements,
  type HyperAgentEntitlementsSummary,
  type HyperAgentSubscription,
  type HyperAgentSubscriptionMutationResult,
  type HyperAgentSubscriptionSummary,
  type HyperAgentUpdateSubscriptionRequest,
  type HyperAgentModel,
  type HyperAgentUsageSummary,
  type HyperAgentUsageHistoryEntry,
  type HyperAgentUsageHistory,
  type HyperAgentKeyUsageEntry,
  type HyperAgentKeyUsage,
  type HyperAgentTypePreset,
  type HyperAgentTypePlan,
  type HyperAgentTypeCatalog,
  type HyperAgentBillingProfileFields,
  type HyperAgentBillingInfo,
  type HyperAgentBillingProfileResponse,
  type HyperAgentBillingUser,
  type HyperAgentPaymentSubscription,
  type HyperAgentPaymentEntitlement,
  type HyperAgentPayment,
  type HyperAgentPaymentsResponse,
  type HyperAgentPaymentsOptions,
  type HyperAgentGrant,
  type HyperAgentGrantRedemptionResponse,
  type HyperAgentBalanceEntitlementPurchaseRequest,
  type HyperAgentStripeCheckoutRequest,
  type HyperAgentStripeCheckoutResponse,
  type HyperAgentStripeBillingPortalFlowType,
  type HyperAgentStripeBillingPortalSessionRequest,
  type HyperAgentStripeBillingPortalSessionResponse,
  type HyperAgentX402CheckoutRequest,
  type HyperAgentX402CheckoutResponse,
  type HyperAgentBrowserX402PurchaseRequest,
  type HyperAgentX402PurchaseRequest,
  type HyperAgentX402PurchaseResponse,
} from './agent.js';

export {
  AGENT_FILE_MAX_BYTES,
  AGENT_FILE_OPERATION_TIMEOUT_MS,
  AGENT_FILE_TRANSFER_CHUNK_BYTES,
  Deployments,
  Agent,
  OpenClawAgent,
  OpenClawProAgent,
  buildAgentConfig,
  buildBrowserDesktopUrl,
  buildOpenClawMemoryIndexEnv,
  buildOpenClawWorkspacesSyncEnv,
  buildOpenClawRoutes,
  startSlackOAuth,
  getSlackInstallStatus,
  listSlackDirectoryConversations,
  listSlackDirectoryUsers,
  attachSlackRelayAgent,
  type OpenClawModelApi,
  type OpenClawModelProviderAuthMode,
  type OpenClawSecretInput,
  type OpenClawModelCompatConfig,
  type OpenClawModelDefinitionConfig,
  type OpenClawModelProviderConfig,
  type OpenClawModelProviderPatch,
  type OpenClawMemoryIndexOptions,
  type AgentExecResult,
  type AgentTokenResponse,
  type BrowserDesktopUrlOptions,
  type SlackOAuthStartOptions,
  type SlackOAuthStartResult,
  type SlackInstallStatusOptions,
  type SlackInstallStatus,
  type SlackDirectoryOptions,
  type SlackDirectoryConversationsOptions,
  type SlackDirectoryConversation,
  type SlackDirectoryUser,
  type SlackDirectoryConversationsResult,
  type SlackDirectoryUsersResult,
  type AttachSlackRelayAgentOptions,
  type AttachSlackRelayAgentResult,
  type AgentShellTokenResponse,
  type AgentRouteConfig,
  type RegistryAuth,
  type BuildAgentConfigOptions,
  type OpenClawHeartbeatConfig,
  type OpenClawRouteOptions,
  type CreateAgentOptions,
  type OpenClawCreateAgentOptions,
  type OpenClawStartAgentOptions,
  type StartAgentOptions,
  type AgentExecOptions,
} from './agents.js';

export {
  type AgentSkillOrigin,
  type AgentSkillAvailability,
  type AgentSkillResourceAccess,
  type AgentSkillResourceEntry,
  type AgentSkillRequirements,
  type AgentSkillSummary,
  type AgentSkillDocument,
  type AgentSkillUpdate,
  type AgentSkillSearchItem,
  type AgentSkillInstallRequest,
  type AgentSkillInstallResult,
  type AgentSkillCreateRequest,
  type AgentSkillCreateResult,
  type AgentSkillRecoveryEntry,
  type AgentSkillRecoveryCandidate,
  type AgentSkillRecoverRequest,
  type AgentSkillRecoverResult,
  type AgentSkillsProviderCapabilities,
  type AgentSkillsProvider,
} from './skills.js';

export {
  type AgentChannelHealthState,
  type AgentChannelSummary,
  type AgentChannelAccountStatus,
  type AgentChannel,
  type AgentChannelGroup,
  type AgentChannelsSnapshot,
  type AgentChannelsProviderCapabilities,
  type AgentChannelListOptions,
  type AgentChannelReadOptions,
  type AgentChannelConfigurationReadRequest,
  type AgentChannelConfigurationReadResult,
  type AgentChannelUpdateRequest,
  type AgentChannelsProvider,
  type SlackInstallStatusLike,
  type SlackInstallStatusCheckOptions,
  type HostedSlackRelayChannelConfigOptions,
  type HostedSlackRelayChannelConfig,
  type HostedSlackRelayConfigPatch,
  type ConfigureHostedSlackRelayChannelOptions,
  type ConfigureHostedSlackRelayChannelResult,
  normalizeSlackRelayBaseUrl,
  buildSlackRelayApiUrl,
  buildSlackRelayWebSocketUrl,
  buildHostedSlackRelayChannelConfig,
  buildHostedSlackRelayConfigPatch,
  configureHostedSlackRelayChannel,
} from './channels.js';

export {
  OpenClawChannelsProvider,
  normalizeOpenClawChannelsSnapshot,
  normalizeOpenClawChannelsStatus,
  type OpenClawChannelsClient,
  type OpenClawChannel,
  type OpenClawChannelsDiagnostics,
  type OpenClawChannelsSnapshot,
  type OpenClawChannelSecretRefSource,
  type OpenClawChannelSecretRef,
  type OpenClawChannelSecretInput,
  type OpenClawTelegramDmPolicy,
  type OpenClawTelegramGroupPolicy,
  type OpenClawTelegramGroupConfig,
  type OpenClawTelegramAccountConfig,
  type OpenClawTelegramConfig,
  type OpenClawTelegramAccountConfigPatch,
  type OpenClawTelegramConfigPatch,
  type OpenClawWhatsAppAccountConfig,
  type OpenClawWhatsAppConfig,
  type OpenClawWhatsAppAccountConfigPatch,
  type OpenClawWhatsAppConfigPatch,
} from './openclaw/channels.js';

export {
  type AgentConnectorSetupMode,
  type AgentConnectorAuthorizationProtocol,
  type AgentConnectorAuthorizationRequest,
  type AgentConnectorAuthorizationResult,
  type AgentRuntimeDescriptor,
  type AgentConnectorDescriptor,
  type AgentConnectorListOptions,
  type AgentConnectorSetupRequest,
  type AgentConnectorRuntimeSetupResult,
  type AgentConnectorSetupState,
  type AgentConnectorSetupStatus,
  type AgentConnectorSetupStatusRequest,
  type AgentConnectorsProvider,
} from './connectors.js';

export {
  OpenClawConnectorsProvider,
  normalizeOpenClawConnectors,
  type OpenClawConnectorsClient,
} from './openclaw/connectors.js';

// Job helpers
export {
  BaseJob,
  type BaseJobOptions,
} from './job/base.js';

export {
  ComfyUIJob,
  DEFAULT_OBJECT_INFO,
  findNode,
  findNodes,
  applyParams,
  applyGraphModes,
  graphToApi,
} from './job/comfyui.js';

export {
  GradioJob,
  type GradioJobOptions,
} from './job/gradio.js';

// x402 pay-per-use
export {
  X402Client,
  type X402Signer,
  type X402JobLaunch,
  type X402FlowCreate,
  type FlowCatalogItem,
  type X402CreateJobOptions,
  type X402CreateFlowOptions,
} from './x402.js';

export {
  GatewayClient,
  type GatewayOptions,
  type GatewayEvent,
  type GatewayProtocolErrorCode,
  type GatewayProtocolErrorInfo,
  type ChatEvent,
  type GatewayEphemeralChatOptions,
  type GatewayEphemeralChatSession,
  type GatewaySessionsListResult,
  type GatewayAbortSignal,
  type ChatAttachment,
  type BrowserChatAttachment,
  type GatewayChatAttachmentPayload,
  type GatewayChatToolCall,
  type GatewayChatMessageSummary,
  type GatewayEventHandler,
  type GatewayMessageActionParams,
  type GatewaySendParams,
  type GatewaySendResult,
  type GatewayPluginState,
  type GatewayPluginCatalogInstallAction,
  type GatewayPluginCatalogEntry,
  type GatewayPluginsListResult,
  type GatewayPluginsInstallParams,
  type GatewayPluginsInstallResult,
  type GatewayPluginsSetEnabledParams,
  type GatewayPluginsSetEnabledResult,
  type GatewayPluginsUninstallParams,
  type GatewayPluginsUninstallResult,
  type GatewayPluginsRefreshResult,
  type GatewayToolProfileId,
  type GatewayToolSource,
  type GatewayToolRisk,
  type GatewayToolsCatalogParams,
  type GatewayToolCatalogProfile,
  type GatewayToolCatalogEntry,
  type GatewayToolCatalogGroup,
  type GatewayToolsCatalogResult,
  type GatewayToolsEffectiveParams,
  type GatewayToolsEffectiveEntry,
  type GatewayToolsEffectiveGroup,
  type GatewayToolsEffectiveNotice,
  type GatewayToolsEffectiveResult,
  type GatewayToolsInvokeParams,
  type GatewayToolsInvokeError,
  type GatewayToolsInvokeResult,
  type GatewayCommandSource,
  type GatewayCommandScope,
  type GatewayCommandCategory,
  type GatewayCommandArgChoice,
  type GatewayCommandArg,
  type GatewayCommandEntry,
  type GatewayCommandsListParams,
  type GatewayCommandsListResult,
  type ChannelsStartParams,
  type ChannelsStartResult,
  type ChannelsStopParams,
  type ChannelsStopResult,
  type OpenClawConfigReloadKind,
  type OpenClawConfigSchemaLookupChild,
  type OpenClawConfigSchemaLookupResult,
  type OpenClawSlackRelayOptions,
  type ChannelsStatusParams,
  type ChannelCredentialStatus,
  type ChannelAccountSnapshot,
  type ChannelUiMeta,
  type ChannelEventLoopHealth,
  type ChannelsStatusResult,
  NodeServer,
  type NodeCommandHandler,
  type NodeServerOptions,
  normalizeChatAttachments,
  extractGatewayChatThinking,
  extractGatewayChatMediaUrls,
  extractGatewayChatToolCalls,
  normalizeGatewayChatMessage,
  isOpenClawGatewayMethodUnsupported,
} from './openclaw/gateway.js';

export * from './openclaw/slack.js';
export * from './openclaw/whatsapp.js';
