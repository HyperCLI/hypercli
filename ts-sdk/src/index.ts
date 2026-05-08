/**
 * HyperCLI SDK - TypeScript client for HyperCLI API
 */

// Main client
export { HyperCLI, type HyperCLIOptions } from './client.js';
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
  type User,
  type AuthMe,
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
  type HyperAgentX402CheckoutRequest,
  type HyperAgentX402CheckoutResponse,
  type HyperAgentBrowserX402PurchaseRequest,
  type HyperAgentX402PurchaseRequest,
  type HyperAgentX402PurchaseResponse,
} from './agent.js';

export {
  Deployments,
  Agent,
  OpenClawAgent,
  buildAgentConfig,
  buildOpenClawRoutes,
  type OpenClawModelApi,
  type OpenClawModelProviderAuthMode,
  type OpenClawSecretInput,
  type OpenClawModelCompatConfig,
  type OpenClawModelDefinitionConfig,
  type OpenClawModelProviderConfig,
  type OpenClawModelProviderPatch,
  type AgentExecResult,
  type AgentTokenResponse,
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
  type ChatEvent,
  type ChatAttachment,
  type BrowserChatAttachment,
  type GatewayChatAttachmentPayload,
  type GatewayChatToolCall,
  type GatewayChatMessageSummary,
  type GatewayEventHandler,
  normalizeChatAttachments,
  extractGatewayChatThinking,
  extractGatewayChatMediaUrls,
  extractGatewayChatToolCalls,
  normalizeGatewayChatMessage,
} from './openclaw/gateway.js';
