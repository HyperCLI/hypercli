"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent as SdkAgent } from "@hypercli.com/sdk/agents";
import type {
  Workspace,
  WorkspaceGrant,
  WorkspacesAPI,
} from "@hypercli.com/sdk/workspaces";

import type { CronJob } from "@/components/dashboard/agentViewTypes";
import type { OpenClawSessionRecord } from "@/lib/openclaw-session-sdk-surface";

export type AgentOperationsDataState =
  | "loading"
  | "ready"
  | "partial"
  | "deferred"
  | "offline"
  | "not-applicable"
  | "unavailable";

export type AgentOperationsSnapshot = {
  agentId: string;
  dataState: AgentOperationsDataState;
  sessions: OpenClawSessionRecord[] | null;
  cronJobs: CronJob[] | null;
  failures: Partial<Record<"sessions" | "cron", string>>;
  capturedAt: number | null;
};

export type SpaceAccessSnapshot = {
  workspace: Workspace;
  visibility: "loading" | "known" | "restricted" | "unavailable";
  agentIds: string[] | null;
};

export type AccountOperationsOverview = {
  agents: Record<string, AgentOperationsSnapshot>;
  spaces: SpaceAccessSnapshot[];
  capturedAt: number;
};

type SpaceAccessClient = Pick<WorkspacesAPI, "listGrants">;

type AccountOperationsProgress = {
  onAgent?: (snapshot: AgentOperationsSnapshot) => void;
  onSpace?: (snapshot: SpaceAccessSnapshot) => void;
};

const MAX_CONCURRENT_SPACE_REQUESTS = 4;

function grantIsActive(grant: WorkspaceGrant, now: number): boolean {
  if (grant.revokedAt) return false;
  if (!grant.expiresAt) return true;
  const expiresAt = Date.parse(grant.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt > now;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await task(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return output;
}

function idleAgentSnapshot(agent: SdkAgent): AgentOperationsSnapshot {
  if (agent.state !== "RUNNING") {
    return {
      agentId: agent.id,
      dataState: "offline",
      sessions: null,
      cronJobs: null,
      failures: {},
      capturedAt: null,
    };
  }
  return {
    agentId: agent.id,
    dataState: "deferred",
    sessions: null,
    cronJobs: null,
    failures: {},
    capturedAt: null,
  };
}

export function createIdleAccountOperationsOverview(
  agents: readonly SdkAgent[],
  workspaces: readonly Workspace[],
): AccountOperationsOverview {
  return {
    agents: Object.fromEntries(agents.map((agent) => [agent.id, idleAgentSnapshot(agent)])),
    spaces: workspaces.map((workspace) => ({
      workspace,
      visibility: workspace.role?.toLowerCase() === "admin" ? "loading" : "restricted",
      agentIds: null,
    })),
    capturedAt: 0,
  };
}

async function collectSpaceAccess(
  workspace: Workspace,
  client: SpaceAccessClient | null,
): Promise<SpaceAccessSnapshot> {
  if (workspace.role?.toLowerCase() !== "admin") {
    return { workspace, visibility: "restricted", agentIds: null };
  }
  if (!client) return { workspace, visibility: "unavailable", agentIds: null };

  try {
    const grants = await client.listGrants(workspace.slug || workspace.id);
    const now = Date.now();
    return {
      workspace,
      visibility: "known",
      agentIds: Array.from(new Set(grants
        .filter((grant) => grant.subjectType === "agent" && grantIsActive(grant, now))
        .map((grant) => grant.subjectId))),
    };
  } catch {
    return { workspace, visibility: "unavailable", agentIds: null };
  }
}

export async function collectAccountOperationsOverview(
  agents: readonly SdkAgent[],
  workspaces: readonly Workspace[],
  spaceAccessClient: SpaceAccessClient | null,
  progress: AccountOperationsProgress = {},
): Promise<AccountOperationsOverview> {
  // Account Home is intentionally REST-only. Opening the overview must not
  // hydrate secrets or acquire gateway transports for the whole Agent roster.
  const agentSnapshots = agents.map((agent) => idleAgentSnapshot(agent));
  for (const snapshot of agentSnapshots) progress.onAgent?.(snapshot);
  const spaceSnapshots = await mapWithConcurrency(
    workspaces,
    MAX_CONCURRENT_SPACE_REQUESTS,
    async (workspace) => {
      const snapshot = await collectSpaceAccess(workspace, spaceAccessClient);
      progress.onSpace?.(snapshot);
      return snapshot;
    },
  );
  return {
    agents: Object.fromEntries(agentSnapshots.map((snapshot) => [snapshot.agentId, snapshot])),
    spaces: spaceSnapshots,
    capturedAt: Date.now(),
  };
}

export function useAccountOperationsOverview(
  agents: readonly SdkAgent[],
  workspaces: readonly Workspace[],
  spaceAccessClient: SpaceAccessClient | null,
) {
  const [overview, setOverview] = useState<AccountOperationsOverview>(() => (
    createIdleAccountOperationsOverview(agents, workspaces)
  ));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!hasLoadedRef.current) setLoading(true);
    else setRefreshing(true);
    try {
      const next = await collectAccountOperationsOverview(agents, workspaces, spaceAccessClient, {
        onAgent: (snapshot) => {
          if (requestId !== requestRef.current) return;
          setOverview((current) => ({
            ...current,
            agents: { ...current.agents, [snapshot.agentId]: snapshot },
            capturedAt: Math.max(current.capturedAt, snapshot.capturedAt ?? 0),
          }));
          setLoading(false);
        },
        onSpace: (snapshot) => {
          if (requestId !== requestRef.current) return;
          setOverview((current) => ({
            ...current,
            spaces: current.spaces.map((space) => (
              space.workspace.id === snapshot.workspace.id ? snapshot : space
            )),
          }));
        },
      });
      if (requestId !== requestRef.current) return;
      setOverview(next);
      hasLoadedRef.current = true;
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [agents, spaceAccessClient, workspaces]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      hasLoadedRef.current = false;
      setOverview(createIdleAccountOperationsOverview(agents, workspaces));
      setLoading(true);
      setRefreshing(false);
      void refresh();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      requestRef.current += 1;
    };
  }, [agents, refresh, workspaces]);

  return { overview, loading, refreshing, refresh };
}
