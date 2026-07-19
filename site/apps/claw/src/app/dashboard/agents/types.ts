import type { AgentMeta } from "@/lib/avatar";
import type { SlotInventory } from "@/lib/format";

export type AgentState =
  | "PENDING"
  | "RESTORING"
  | "RESTORE_FAILED"
  | "SYNCING"
  | "SYNC_FAILED"
  | "STARTING"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "FAILED";
export type JsonObject = Record<string, unknown>;

export const AGENT_TRANSITIONAL_STATES: AgentState[] = ["PENDING", "RESTORING", "SYNCING", "STARTING", "STOPPING"];
export const AGENT_FAILURE_STATES: AgentState[] = ["RESTORE_FAILED", "SYNC_FAILED", "FAILED"];

export function isAgentTransitionalState(state: AgentState | string | null | undefined): boolean {
  return AGENT_TRANSITIONAL_STATES.includes(state as AgentState);
}

export function isAgentFailureState(state: AgentState | string | null | undefined): boolean {
  return AGENT_FAILURE_STATES.includes(state as AgentState);
}

export interface Agent {
  id: string;
  name: string;
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  displayIdentity?: Record<string, unknown> | null;
  user_id: string;
  pod_id: string | null;
  pod_name: string | null;
  state: AgentState;
  cpu_millicores: number;
  memory_mib: number;
  hostname: string | null;
  desktopUrl?: string | null;
  started_at: string | null;
  stopped_at: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
  launchConfig?: Record<string, unknown> | null;
  gatewayToken?: string | null;
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
  pod_id: string;
  token: string;
  expires_at: string | null;
}

export interface LogEvent {
  event?: string;
  log?: string;
  detail?: string;
  status?: number;
}
