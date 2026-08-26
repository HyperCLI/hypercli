// ── Re-exports from SDK ──

export type {
  Agent as SdkAgent,
  AgentTokenResponse,
  AgentShellTokenResponse,
  AgentLogsTokenResponse,
  AgentFileEntry,
  AgentDirectoryListing,
  AgentExecResult,
  AgentRouteConfig,
  AgentState,
  CreateAgentOptions,
  StartAgentOptions,
  OpenClawCreateAgentOptions,
  OpenClawStartAgentOptions,
} from "@hypercli.com/sdk/agents";
export type {
  HyperAgentPlan,
  HyperAgentCurrentPlan,
  HyperAgentModel,
} from "@hypercli.com/sdk/agent";

// ── Agent type catalog (SDK-backed) ──

export interface AgentTypePreset {
  id: string;
  name: string;
  cpu: number;
  memory: number;
}

export interface AgentTypePlan {
  id: string;
  name: string;
  price: number;
  agents: number;
  agent_type: string;
  highlighted: boolean;
}

export interface AgentTypeCatalogResponse {
  types: AgentTypePreset[];
  plans: AgentTypePlan[];
}

// ── Re-export billing types ──

export type {
  AgentPayment,
  AgentPaymentsResponse,
  AgentBillingProfileFields,
  AgentBillingProfileResponse,
  AgentBillingUser,
  AgentBillingSubscription,
} from "@/lib/billing";
