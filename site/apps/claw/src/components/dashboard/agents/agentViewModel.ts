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

export function agentDisplayLabel(agent: Pick<Agent, "id" | "name" | "handle" | "displayName" | "managed" | "pod_name">): string {
  const canonicalName = agent.name?.trim() || agent.pod_name?.trim() || agent.id;
  return agent.managed === false
    ? agent.displayName?.trim() || canonicalName
    : agent.handle?.trim() || canonicalName;
}

export function didAnyAgentFinishStopping(
  previous: ReadonlyMap<string, AgentState>,
  current: ReadonlyArray<Pick<Agent, "id" | "state">>,
): boolean {
  return current.some((agent) => (
    previous.get(agent.id) === "STOPPING" && agent.state === "STOPPED"
  ));
}

export function toAgentViewModel(agent: SdkAgent): Agent {
  const managed = agent.managed ?? null;
  const canonicalName = agent.name?.trim() || agent.podName?.trim() || agent.id;
  return {
    id: agent.id,
    name: canonicalName,
    handle: agent.handle ?? null,
    displayName: managed === false
      ? agent.displayName?.trim() || canonicalName
      : agent.handle?.trim() || canonicalName,
    avatarUrl: agent.avatarUrl ?? null,
    displayIdentity: agent.displayIdentity ?? null,
    managed,
    runtime: agent.runtime ?? null,
    gatewayId: agent.gatewayId ?? null,
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
