import type { AgentMeta } from "@/lib/avatar";
import type { SlotInventory } from "@/lib/format";

export type AgentState = "PENDING" | "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "FAILED";
export type JsonObject = Record<string, unknown>;

export interface Agent {
  id: string;
  name: string;
  user_id: string;
  pod_id: string | null;
  pod_name: string | null;
  state: AgentState;
  cpu_millicores: number;
  memory_mib: number;
  hostname: string | null;
  started_at: string | null;
  stopped_at: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
  openclaw_url?: string | null;
  gatewayToken?: string | null;
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

export interface AgentListItem {
  id: string;
  name: string;
  user_id: string;
  pod_id: string | null;
  pod_name: string | null;
  state: AgentState;
  cpu: number;
  memory: number;
  hostname: string | null;
  started_at: string | null;
  stopped_at: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
  openclaw_url?: string | null;
  gatewayToken?: string | null;
  meta?: AgentMeta | null;
}

export interface AgentListResponse {
  items?: AgentListItem[];
}
