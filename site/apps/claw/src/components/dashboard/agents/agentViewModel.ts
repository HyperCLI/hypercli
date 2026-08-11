import type { SdkAgent } from "@/types";
import type { Agent, AgentState } from "@/app/dashboard/agents/types";
import { displayNameFromAgentHandle } from "@/lib/agent-profile-updates";

export function normalizeAgentState(state: unknown): AgentState {
  const normalized = typeof state === "string" ? state.toUpperCase() : "";
  return normalized || "UNKNOWN";
}

export function agentDisplayLabel(agent: Pick<Agent, "id" | "name" | "handle" | "displayName" | "managed">): string {
  const canonicalName = agent.name?.trim() || agent.id;
  const handle = agent.handle?.trim();
  return agent.managed === false
    ? agent.displayName?.trim() || canonicalName
    : handle ? displayNameFromAgentHandle(handle) : canonicalName;
}

export function didAnyAgentFinishCleanup(
  previous: ReadonlyMap<string, Pick<Agent, "state" | "resourcesExist">>,
  current: ReadonlyArray<Pick<Agent, "id" | "state" | "resourcesExist">>,
): boolean {
  return current.some((agent) => {
    const previousAgent = previous.get(agent.id);
    return Boolean(previousAgent?.resourcesExist && !agent.resourcesExist);
  });
}

export function toAgentViewModel(agent: SdkAgent, avatarUrlOverride?: string | null): Agent {
  const managed = agent.managed ?? null;
  const canonicalName = agent.name?.trim() || agent.id;
  return {
    id: agent.id,
    name: canonicalName,
    handle: agent.handle ?? null,
    displayName: managed === false
      ? agent.displayName?.trim() || canonicalName
      : agent.handle?.trim()
        ? displayNameFromAgentHandle(agent.handle)
        : canonicalName,
    avatarUrl: avatarUrlOverride === undefined ? agent.avatarUrl ?? null : avatarUrlOverride,
    displayIdentity: agent.displayIdentity ?? null,
    managed,
    isLaunchable: agent.isLaunchable,
    runtime: agent.runtime ?? null,
    gatewayId: agent.gatewayId ?? null,
    user_id: agent.userId,
    state: normalizeAgentState(agent.state),
    cpu_millicores: Math.round((agent.cpu || 0) * 1000),
    memory_mib: Math.round((agent.memory || 0) * 1024),
    hostname: agent.hostname ?? null,
    desktopUrl: agent.desktopUrl,
    started_at: agent.startedAt?.toISOString() ?? null,
    stopped_at: agent.stoppedAt?.toISOString() ?? null,
    archived_at: agent.archivedAt?.toISOString() ?? null,
    reason: agent.reason ?? null,
    error: agent.error ?? null,
    message: agent.message ?? null,
    created_at: agent.createdAt?.toISOString() ?? null,
    updated_at: agent.updatedAt?.toISOString() ?? null,
    launchEpoch: agent.launchEpoch,
    agentVersion: agent.agentVersion,
    resourcesExist: agent.resourcesExist,
    namespaceExists: agent.namespaceExists,
    clusterId: agent.clusterId ?? null,
    archivedPath: agent.archivedPath ?? null,
    launchConfig: agent.launchConfig ?? null,
    hasDesktop: agent.hasDesktop,
    meta: agent.meta ?? null,
  };
}
