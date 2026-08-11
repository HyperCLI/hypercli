import {
  isAgentTransitionalState as isSdkAgentTransitionalState,
  type AgentState as SdkAgentState,
} from "@hypercli.com/sdk/agents";
import type { AgentMeta } from "@/lib/avatar";
import type { SlotInventory } from "@/lib/format";

export type AgentState = SdkAgentState;
export type JsonObject = Record<string, unknown>;

export function isAgentTransitionalState(state: AgentState | string | null | undefined): boolean {
  return typeof state === "string" && isSdkAgentTransitionalState(state);
}

export function isAgentFailureState(state: AgentState | string | null | undefined): boolean {
  return state?.toUpperCase() === "FAILED";
}

export function isAgentOffline(state: AgentState | string | null | undefined): boolean {
  const normalized = state?.toUpperCase();
  return normalized === "STOPPED" || normalized === "ARCHIVED";
}

type AgentLifecycleActionState = Pick<Agent, "state" | "isLaunchable">;

export function isAgentStartable(agent: AgentLifecycleActionState): boolean {
  if (agent.isLaunchable === false) return false;
  const state = agent.state.toUpperCase();
  return state === "STOPPED" || state === "ARCHIVED";
}

export function isAgentStoppable(agent: Pick<Agent, "state">): boolean {
  const state = agent.state.toUpperCase();
  return state === "CREATING"
    || state === "STARTING"
    || state === "RESTORING"
    || state === "RUNNING"
    || state === "FAILED";
}

export function isAgentDeletable(agent: Pick<Agent, "state">): boolean {
  return agent.state.toUpperCase() === "STOPPED";
}

export interface Agent {
  id: string;
  name: string;
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  displayIdentity?: Record<string, unknown> | null;
  managed?: boolean | null;
  isLaunchable: boolean;
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
  archived_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  launchEpoch: number;
  clusterId: string | null;
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
