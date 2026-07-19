import type { SdkAgent } from "@/types";
import type { Agent, AgentState } from "@/app/dashboard/agents/types";

export function normalizeAgentState(state: unknown): AgentState {
  const normalized = typeof state === "string" ? state.toUpperCase() : "";
  if (!normalized) return "STOPPED";
  if (normalized === "ERROR") return "FAILED";
  if (
    normalized === "PENDING" ||
    normalized === "RESTORING" ||
    normalized === "RESTORE_FAILED" ||
    normalized === "SYNCING" ||
    normalized === "SYNC_FAILED" ||
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
    handle: agent.handle ?? null,
    displayName: agent.displayName ?? null,
    avatarUrl: agent.avatarUrl ?? null,
    displayIdentity: agent.displayIdentity ?? null,
    user_id: agent.userId,
    pod_id: agent.podId || null,
    pod_name: agent.podName || null,
    state: normalizeAgentState(agent.state),
    cpu_millicores: Math.round((agent.cpu || 0) * 1000),
    memory_mib: Math.round((agent.memory || 0) * 1024),
    hostname: agent.hostname ?? null,
    desktopUrl: agent.desktopUrl,
    started_at: agent.startedAt?.toISOString() ?? null,
    stopped_at: agent.stoppedAt?.toISOString() ?? null,
    last_error: agent.lastError ?? null,
    created_at: agent.createdAt?.toISOString() ?? null,
    updated_at: agent.updatedAt?.toISOString() ?? null,
    launchConfig: agent.launchConfig ?? null,
    hasDesktop: agent.hasDesktop,
    meta: agent.meta ?? null,
  };
}
