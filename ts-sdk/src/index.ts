/**
 * HyperCLI SDK - TypeScript client for HyperCLI API
 */

// Main client
export { HyperCLI, type HyperCLIOptions, type SystemStatus } from './client.js';
export { BrowserHyperCLI, type BrowserHyperCLIOptions } from './browser.js';
export { BrowserJobs } from './browser-jobs.js';

// Configuration
export {
  configure,
  getApiKey,
  getAgentApiKey,
  getApiUrl,
  getAgentsApiBaseUrl,
  getAgentsWsUrl,
  getWsUrl,
  COMFYUI_IMAGE,
  DEFAULT_API_URL,
  DEFAULT_AGENTS_API_BASE_URL,
  DEFAULT_AGENTS_WS_URL,
  DEV_AGENTS_API_BASE_URL,
  DEV_AGENTS_WS_URL,
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
  type JobLifecycleEvent,
  type CreateJobOptions,
  type ListJobsOptions,
  ShellSession,
  type ShellSessionOptions,
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
  type TranscribeOptions,
  type TranscribeStreamOptions,
  type TranscriptionResult,
} from './voice.js';

// Voice streaming session
export {
  VoiceSession,
  VoiceStreamError,
  encodeBase64,
  type VoiceSessionState,
  type VoiceAudioMetadata,
  type VoiceChunkEvent,
  type VoiceSessionOptions,
  type SpeakOptions,
  type CloneSpeakOptions,
  type DesignSpeakOptions,
} from './voice-session.js';

export {
  VoiceTranscriptionSession,
  type TranscriptionStartOptions,
  type VoiceTranscriptDeltaEvent,
  type VoiceTranscriptFinalEvent,
  type VoiceTranscriptionAckEvent,
  type VoiceTranscriptionEvent,
  type VoiceTranscriptionSessionOptions,
  type VoiceTranscriptionSessionState,
} from './voice-transcription-session.js';

// User API
export { projectManagedContext, MANAGED_CONTEXT_PATHS, type ManagedContext, type ManagedContextFileResult } from './managed-context.js';
export {
  AGENT_PERSONA_PROFILES,
  DEFAULT_PERSONA_SOUL_PATH,
  DEFAULT_PERSONA_USER_PATH,
  DefaultPersonaProfile,
  HermesPersonaProfile,
  OpenClawPersonaProfile,
  resolveAgentPersonaProfile,
  type AgentPersonaFiles,
  type AgentPersonaProfile,
} from './agent-persona.js';
export type { UserUi, UpdateUserOptions } from './user.js';
export {
  UserAPI,
  isRuntimeAgent,
  runtimeAgentId,
  type User,
  type AuthMe,
  type RuntimeIdentity,
  type UserProfileImage,
} from './user.js';

// Keys API
export {
  KeysAPI,
  issueApiKeyFromJwt,
  type ApiKey,
  type CreateApiKeyOptions,
  type IssueApiKeyFromJwtOptions,
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
  parseWorkspaceTomd,
  stripWorkspaceTomdGeneratedSections,
  type WorkspaceTomdDocument,
  type WorkspaceTomdFrontmatter,
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

export {
  RoutinesAPI,
  deriveRoutinesApiBase,
  type Routine,
  type RoutineCreateOptions,
  type RoutineUpdateOptions,
} from './routines.js';

export {
  IntegrationsAPI,
  deriveIntegrationsApiBase,
  type Provider,
  type ConnectionEntry,
  type ConnectionInfo,
  type ConnectSession,
  type TokenResponse,
  type ProxyOptions,
} from './integrations.js';

export {
  RunnersAPI,
  deriveRunnersApiBase,
  type Runner,
  type RunnerMeta,
  type RunnerUiMeta,
  type RunnerUpdateOptions,
} from './runners.js';

// Logs
export {
  LogStream,
  streamLogs,
  fetchLogs,
} from './logs.js';

// HyperAgent
export {
  HyperAgent,
  HYPER_AGENT_CANONICAL_PLAN_IDS,
  hasActivePlan,
  parseHyperAgentPlanId,
  type HyperAgentCanonicalPlanId,
  type HyperAgentPlan,
  type HyperAgentCurrentPlan,
  type HyperAgentEntitlements,
  type HyperAgentEntitlementsSummary,
  type HyperAgentEntitlement,
  type HyperAgentPaymentMethodSummary,
  type HyperAgentSubscription,
  type HyperAgentSubscriptionTrial,
  type HyperAgentSubscriptionMutationResult,
  type HyperAgentSubscriptionSummary,
  type HyperAgentUpdateSubscriptionRequest,
  type HyperAgentModel,
  type HyperAgentUsageSummary,
  type HyperAgentUsageHistoryEntry,
  type HyperAgentUsageHistory,
  type HyperAgentKeyUsageEntry,
  type HyperAgentKeyUsage,
  type HyperAgentUsageMetrics,
  type HyperAgentAgentUsageEntry,
  type HyperAgentAgentUsage,
  type HyperAgentUsageReport,
  type HyperAgentTypePreset,
  type HyperAgentTypePlan,
  type HyperAgentTypeCatalog,
  type HyperAgentBillingProfileFields,
  type HyperAgentBillingInfo,
  type HyperAgentBillingProfileResponse,
  type HyperAgentBillingUser,
  type HyperAgentBillingHistory,
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
  type HyperAgentX402PurchaseRequest,
  type HyperAgentX402PurchaseResponse,
} from './agent.js';

export {
  DEFAULT_AGENT_RUNTIME_SCOPES,
  DEFAULT_OPENCLAW_IMAGE,
  DEFAULT_OPENCLAW_PRO_IMAGE,
  DEFAULT_HERMES_AGENT_IMAGE,
  DEFAULT_HERMES_AGENT_SYNC_EXCLUDE,
  DEFAULT_HERMES_AGENT_SYNC_ROOT,
  DEFAULT_HERMES_AGENT_SYNC_UID,
  DEFAULT_HERMES_AGENT_SYNC_GID,
  DEFAULT_BUZZ_AGENT_IMAGE,
  DEFAULT_OPENCODE_IMAGE,
  DEFAULT_CODEX_IMAGE,
  DEFAULT_CLAUDE_CODE_IMAGE,
  DEFAULT_GOOSE_IMAGE,
  DEFAULT_KIMI_CODE_IMAGE,
  DEFAULT_PI_IMAGE,
  DEFAULT_PI_ENV,
  DEFAULT_BUZZ_OPENCODE_IMAGE,
  DEFAULT_BUZZ_CODEX_IMAGE,
  DEFAULT_BUZZ_CLAUDE_CODE_IMAGE,
  DEFAULT_BUZZ_GOOSE_IMAGE,
  DEFAULT_BUZZ_KIMI_CODE_IMAGE,
  DEFAULT_CODING_AGENT_IMAGES,
  DEFAULT_CODING_AGENT_SYNC_INCLUDES,
  DEFAULT_BUZZ_CODING_AGENT_IMAGES,
  DEFAULT_CODING_AGENT_SYNC_ROOT,
  AGENT_FILE_MAX_BYTES,
  AGENT_FILE_WRITE_MAX_BYTES,
  AGENT_FILE_OPERATION_TIMEOUT_MS,
  AGENT_FILE_TRANSFER_CHUNK_BYTES,
  AGENT_EXEC_STDIN_MAX_BYTES,
  Deployments,
  Agent,
  RuntimeAuthClient,
  RuntimeLoginSession,
  OPENCLAW_TRUSTED_PROXIES_ENV,
  buildAgentConfig,
  buildBrowserDesktopUrl,
  buildOpenClawMemoryIndexEnv,
  buildOpenClawCronEnv,
  buildWorkspacesSyncEnv,
  buildOpenClawDesktopRoute,
  buildOpenClawTrustedProxiesEnv,
  startSlackOAuth,
  getSlackInstallStatus,
  listSlackDirectoryConversations,
  listSlackDirectoryUsers,
  attachSlackRelayAgent,
  agentSlotFromDict,
  type OpenClawModelApi,
  type OpenClawModelProviderAuthMode,
  type OpenClawSecretInput,
  type OpenClawModelCompatConfig,
  type OpenClawModelDefinitionConfig,
  type OpenClawModelProviderConfig,
  type OpenClawModelProviderPatch,
  type OpenClawMemoryIndexOptions,
  type AgentExecResult,
  type AgentMetricsResult,
  type AgentOperationTokenResponse,
  type AgentAccessIdentity,
  type AgentFileApiReadyOptions,
  type AgentFileEntry,
  type AgentFileReadOptions,
  type AgentFileReadBytesResult,
  type AgentFileTokenResponse,
  type AgentCapacity,
  type AgentSlot,
  type AgentSlotInventory,
  type AgentSlotSize,
  type AgentTokenResponse,
  type AgentEnvMutationResponse,
  type AgentSecretMutationResponse,
  type BootstrapInferenceMessage,
  type BootstrapInferenceResponseFormat,
  type BootstrapInferenceResult,
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
  type AgentShellConnectOptions,
  type AgentAcpWsTokenResponse,
  type AgentCorsConfig,
  type AgentRouteConfig,
  type AgentRoutesState,
  type SetRoutesOptions,
  type RegistryAuth,
  type AgentLaunchConfig,
  type BuildAgentConfigOptions,
  type ManagedAgentRuntime,
  type CodingAgentRuntime,
  type CodingAgent,
  type ManagedAgentCreateOptions,
  type CodingAgentCreateOptions,
  type RuntimeAuthMethod,
  type RuntimeAuthStatus,
  type RuntimeAuthLoginOptions,
  type OpenClawHeartbeatConfig,
  type OpenClawRouteOptions,
  type CreateAgentOptions,
  type StartAgentOptions,
  type LifecycleActionOptions,
  type AgentExecOptions,
  type AgentState,
  type DeploymentMetaObservedState,
  type DeploymentMetaStatus,
  AGENT_RUNTIME_INACTIVE_STATES,
  AGENT_TRANSITIONAL_STATES,
  CANONICAL_AGENT_STATES,
  isAgentRuntimeInactiveState,
  isAgentTransitionalState,
  type DeploymentEvent,
  type DeploymentSubscribeOptions,
  type AgentLogFrame,
  type AgentLogsSubscribeOptions,
  parseAgentLogFrame,
} from './agents.js';

export {
  parseControlUiAllowedOrigins,
} from './openclaw-control-ui-origin.js';

// Buzz activity transport
export {
  subscribeBuzzActivity,
  subscribeBuzzActivityRoute,
  resolveBuzzActivityRouteTarget,
  resolveBuzzOwnerFromEnv,
  buzzConversationKey,
  buzzPublicKeyHex,
  decodeBuzzSecret,
  decryptBuzzPayload,
  BuzzActivityGapError,
  BuzzActivityRouteUnavailableError,
  BUZZ_OBSERVER_EVENT_KIND,
  HYPER_ACP_ROUTE_NAME,
  type BuzzObserverFrame,
  type BuzzActivitySubscription,
  type BuzzActivityHandlers,
  type BuzzActivityRouteHandlers,
  type BuzzActivityRouteTarget,
  type BuzzEnvConfig,
  type BuzzDeploymentsClient,
  type BuzzRouteDeploymentsClient,
} from './buzz-activity.js';

// Coding-agent ACP client
export {
  CodingAgentAcpClient,
  CodingAgentAcpConnectionError,
  CodingAgentAcpReplayGapError,
  CodingAgentAcpUnavailableError,
  ACP_PROXY_UNKNOWN_SESSION_CLOSE_CODE,
  ACP_RECONNECT_DELAYS_MS,
  type CodingAgentAcpConnectOptions,
  type CodingAgentAcpProtocolVersion,
  type CodingAgentAcpTransport,
  type AcpReplayFrom,
  type CodingAgentAcpTarget,
  ACP_TURN_STARTED_METHOD,
  ACP_TURN_ENDED_METHOD,
  type CodingAgentAcpTurnId,
  type CodingAgentAcpTurnStartedEvent,
  type CodingAgentAcpTurnEndedEvent,
  type CodingAgentAcpTurnEvent,
} from './acp.js';
export { CodingAgentAcpPool, type AcpLease } from './acp-pool.js';
export { defaultAcpProxyWsUrl } from './agent-urls.js';
export {
  SessionsAPI,
  type AcpSessionListOptions,
  type AcpSessionMessage,
  type AcpSessionMessagesOptions,
  type AcpSessionPage,
  type AcpSessionParticipant,
  type AcpSessionRecord,
} from './sessions.js';
export {
  AcpTurnDriver,
  ACP_BUNDLE_FRAMING_HEADER,
  type AcpTurnBundle,
  type AcpTurnDriverOptions,
  type AcpTurnDriverState,
  type AcpTurnOutcome,
} from './acp-driver.js';

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
  normalizeSlackRelayBaseUrl,
} from './channels.js';

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
  loadTemplate,
  expandSubgraphs,
  valueMatchesType,
} from './job/comfyui.js';

export {
  GradioJob,
  type GradioJobOptions,
} from './job/gradio.js';

