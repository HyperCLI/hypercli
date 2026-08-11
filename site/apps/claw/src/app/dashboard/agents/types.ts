import type { AgentMeta } from "@/lib/avatar";
import type { SlotInventory } from "@/lib/format";

export type AgentState =
  | "CREATING"
  | "RESTORING"
  | "STARTING"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "ARCHIVING"
  | "ARCHIVED"
  | "FAILED"
  | "DELETED"
  | (string & {});
export type JsonObject = Record<string, unknown>;

export const AGENT_TRANSITIONAL_STATES: AgentState[] = ["CREATING", "RESTORING", "STARTING", "STOPPING", "ARCHIVING"];
export const AGENT_FAILURE_STATES: AgentState[] = ["FAILED"];

export function isAgentTransitionalState(state: AgentState | string | null | undefined): boolean {
  return AGENT_TRANSITIONAL_STATES.includes(state as AgentState);
}

export function isAgentFailureState(state: AgentState | string | null | undefined): boolean {
  return AGENT_FAILURE_STATES.includes(state as AgentState);
}

export function isAgentOffline(state: AgentState | string | null | undefined): boolean {
  return state?.toUpperCase() === "STOPPED" || state?.toUpperCase() === "ARCHIVED";
}

export interface Agent {
  id: string;
  name: string;
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  displayIdentity?: Record<string, unknown> | null;
  managed?: boolean | null;
  runtime?: string | null;
  gatewayId?: string | null;
  user_id: string;
  state: AgentState;
  cpu_millicores: number;
  memory_mib: number;
  hostname: string | null;
  desktopUrl?: string | null;
  started_at: string | null;
  stopped_at: string | null;
  error: string | null;
  created_at: string | null;
  updated_at: string | null;
  launchEpoch: number;
  resourcesExist: boolean;
  namespaceExists: boolean;
  launchConfig?: Record<string, unknown> | null;
  hasDesktop?: boolean;
  meta?: AgentMeta | null;
}

export interface AgentBudget {
  slots: SlotInventory;
  pooled_tpd: number;
  size_presets?: Record<string, { cpu: number; memory: number }>;
}

export interface AgentDesktopTokenResponse {
  agent_id: string;
  token: string;
  expires_at: string | null;
}

export interface LogEvent {
  event?: string;
  log?: string;
  detail?: string;
  status?: number;
}
