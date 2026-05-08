import type { SdkAgent } from "@/types";
import type { Agent, AgentState } from "@/app/dashboard/agents/types";

export function normalizeAgentState(state: unknown): AgentState {
  const normalized = typeof state === "string" ? state.toUpperCase() : "";
  if (!normalized) return "STOPPED";
  if (normalized === "ERROR") return "FAILED";
  if (
    normalized === "PENDING" ||
    normalized === "STARTING" ||
    normalized === "RUNNING" ||
    normalized === "STOPPING" ||
    normalized === "STOPPED" ||
    normalized === "FAILED"
  ) {
    return normalized;
  }
  return "FAILED";
}

export function toAgentViewModel(agent: SdkAgent): Agent {
  return {
    id: agent.id,
    name: agent.name ?? agent.id,
    user_id: agent.userId,
    pod_id: agent.podId || null,
    pod_name: agent.podName || null,
    state: normalizeAgentState(agent.state),
    cpu_millicores: Math.round((agent.cpu || 0) * 1000),
    memory_mib: Math.round((agent.memory || 0) * 1024),
    hostname: agent.hostname ?? null,
    started_at: agent.startedAt?.toISOString() ?? null,
    stopped_at: agent.stoppedAt?.toISOString() ?? null,
    last_error: agent.lastError ?? null,
    created_at: agent.createdAt?.toISOString() ?? null,
    updated_at: agent.updatedAt?.toISOString() ?? null,
    meta: agent.meta ?? null,
  };
}
