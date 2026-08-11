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
  previous: ReadonlyMap<string, Pick<Agent, "state">>,
  current: ReadonlyArray<Pick<Agent, "id" | "state">>,
): boolean {
  return current.some((agent) => {
    const previousState = previous.get(agent.id)?.state.toUpperCase();
    const currentState = agent.state.toUpperCase();
    return (previousState === "STOPPING" || previousState === "ARCHIVING" || previousState === "FAILED")
      && (currentState === "STOPPED" || currentState === "ARCHIVED");
  });
}

export function toAgentViewModel(agent: SdkAgent, avatarUrlOverride?: string | null): Agent {
  const managed = agent.managed ?? null;
  const canonicalName = agent.name?.trim() || agent.id;
  const meta: Agent["meta"] = agent.meta == null ? null : {
    ui: agent.meta.ui == null ? agent.meta.ui : {
      avatar: agent.meta.ui.avatar == null ? agent.meta.ui.avatar : {
        image: agent.meta.ui.avatar.image ?? null,
        icon_index: agent.meta.ui.avatar.icon_index ?? null,
      },
    },
  };
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
    created_at: agent.createdAt?.toISOString() ?? null,
    updated_at: agent.updatedAt?.toISOString() ?? null,
    launchEpoch: agent.launchEpoch,
    clusterId: agent.clusterId ?? null,
    launchConfig: agent.launchConfig ?? null,
    hasDesktop: agent.hasDesktop,
    meta,
  };
}
