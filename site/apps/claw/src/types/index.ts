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

// ── Frontend agent state (matches API snake_case responses) ──

export type AgentState = "PENDING" | "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "FAILED";

export const TRANSITIONAL_STATES: AgentState[] = ["PENDING", "STARTING", "STOPPING"];

export function isTransitionalState(state: string): boolean {
  return TRANSITIONAL_STATES.includes(state as AgentState);
}

// ── Usage types ──

export interface UsageInfo {
  tpd_limit: number;
  tpd_used: number;
  total_tokens: number;
}

export interface DayData {
  date: string;
  input_tokens: number;
  output_tokens: number;
}

export interface KeyUsageEntry {
  key_ref: string;
  key_name: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
}

// ── Agent type catalog (from /types endpoint) ──

export interface AgentTypePreset {
  id: string;
  name: string;
  cpu: number;
  memory: number;
  cpu_limit: number;
  memory_limit: number;
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
