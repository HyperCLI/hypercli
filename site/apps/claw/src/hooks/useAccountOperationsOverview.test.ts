import type { Agent as SdkAgent, OpenClawOperationsSnapshot } from "@hypercli.com/sdk/agents";
import type { Workspace, WorkspaceGrant, WorkspacesAPI } from "@hypercli.com/sdk/workspaces";
import { describe, expect, it, vi } from "vitest";

import { collectAccountOperationsOverview } from "./useAccountOperationsOverview";

const adminSpace: Workspace = {
  id: "space-1",
  name: "main-space",
  slug: "main-space",
  displayName: "Main Space",
  displaySlug: null,
  description: "Shared account context",
  role: "admin",
  createdAt: null,
  updatedAt: null,
};

const restrictedSpace: Workspace = {
  ...adminSpace,
  id: "space-2",
  name: "partner-space",
  slug: "partner-space",
  displayName: "Partner Space",
  role: "viewer",
};

function sdkAgent(
  id: string,
  state: string,
  operationsSnapshot?: () => Promise<OpenClawOperationsSnapshot>,
): SdkAgent {
  return { id, state, ...(operationsSnapshot ? { operationsSnapshot } : {}) } as unknown as SdkAgent;
}

function grant(agentId: string): WorkspaceGrant {
  return {
    id: `grant-${agentId}`,
    workspaceId: adminSpace.id,
    subjectType: "agent",
    subjectId: agentId,
    role: "viewer",
    displayName: agentId,
    displaySlug: null,
    isOwner: false,
    expiresAt: null,
    revokedAt: null,
  };
}

describe("collectAccountOperationsOverview", () => {
  it("normalizes recent sessions, cron jobs, and known Space access", async () => {
    const operationsSnapshot = vi.fn(async (): Promise<OpenClawOperationsSnapshot> => ({
      sessions: {
        sessions: [
          { key: "main", label: "Research thread", createdAt: 100, lastMessageAt: 500, messageCount: 4 },
          { key: "dashboard:planning", label: "Planning thread", createdAt: 100, lastMessageAt: 550, messageCount: 2 },
          { key: "agent:default:heartbeat", lastMessageAt: 800 },
          { key: "archived", label: "Old thread", createdAt: 100, lastMessageAt: 600, archived: true },
          { key: "agent:main:subagent:research", label: "Subagent", lastMessageAt: 700 },
        ],
      },
      cronJobs: [{
        id: "job-1",
        name: "Daily brief",
        schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
        payload: { kind: "agentTurn", message: "Brief the team" },
      }],
      failures: {},
      capturedAt: 1_000,
    }));
    const listGrants = vi.fn(async () => [grant("agent-1")]);

    const overview = await collectAccountOperationsOverview(
      [sdkAgent("agent-1", "RUNNING", operationsSnapshot)],
      [adminSpace, restrictedSpace],
      { listGrants } as Pick<WorkspacesAPI, "listGrants">,
    );

    expect(operationsSnapshot).toHaveBeenCalledTimes(1);
    expect(operationsSnapshot).toHaveBeenCalledWith({ timeout: 10_000 });
    expect(overview.agents["agent-1"]).toMatchObject({ dataState: "ready", capturedAt: 1_000 });
    expect(overview.agents["agent-1"]?.sessions?.map((session) => session.key)).toEqual([
      "dashboard:planning",
    ]);
    expect(overview.agents["agent-1"]?.cronJobs?.[0]).toMatchObject({ id: "job-1", schedule: "0 9 * * *", timezone: "UTC" });
    expect(overview.spaces).toEqual([
      expect.objectContaining({ workspace: adminSpace, visibility: "known", agentIds: ["agent-1"] }),
      expect.objectContaining({ workspace: restrictedSpace, visibility: "restricted", agentIds: null }),
    ]);
    expect(listGrants).toHaveBeenCalledTimes(1);
  });

  it("keeps offline, unsupported, partial, and unavailable agent states distinct", async () => {
    const offlineSnapshot = vi.fn();
    const agents = [
      sdkAgent("offline", "STOPPED", offlineSnapshot),
      sdkAgent("generic", "RUNNING"),
      sdkAgent("partial", "RUNNING", async () => ({
        sessions: { sessions: [] },
        cronJobs: null,
        failures: { cron: "Cron unavailable" },
        capturedAt: 2_000,
      })),
      sdkAgent("unavailable", "RUNNING", async () => { throw new Error("Gateway unavailable"); }),
    ];

    const overview = await collectAccountOperationsOverview(agents, [], null);

    expect(offlineSnapshot).not.toHaveBeenCalled();
    expect(overview.agents.offline?.dataState).toBe("offline");
    expect(overview.agents.generic?.dataState).toBe("not-applicable");
    expect(overview.agents.partial).toMatchObject({ dataState: "partial", sessions: [], cronJobs: null });
    expect(overview.agents.unavailable).toMatchObject({ dataState: "unavailable", sessions: null, cronJobs: null });
  });

  it("limits simultaneous gateway snapshots", async () => {
    let active = 0;
    let maxActive = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const agents = Array.from({ length: 7 }, (_, index) => sdkAgent(`agent-${index}`, "RUNNING", async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      return { sessions: { sessions: [] }, cronJobs: [], failures: {}, capturedAt: 3_000 };
    }));

    const collecting = collectAccountOperationsOverview(agents, [], null);
    await vi.waitFor(() => expect(maxActive).toBe(3));
    release?.();
    await collecting;

    expect(maxActive).toBe(3);
  });

  it("reports healthy agents before a slower gateway finishes", async () => {
    let releaseSlow: (() => void) | null = null;
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const onAgent = vi.fn();
    const fast = sdkAgent("fast", "RUNNING", async () => ({
      sessions: { sessions: [] },
      cronJobs: [],
      failures: {},
      capturedAt: 4_000,
    }));
    const slow = sdkAgent("slow", "RUNNING", async () => {
      await slowGate;
      return { sessions: { sessions: [] }, cronJobs: [], failures: {}, capturedAt: 5_000 };
    });

    const collecting = collectAccountOperationsOverview([fast, slow], [], null, { onAgent });
    await vi.waitFor(() => expect(onAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: "fast", dataState: "ready" })));
    expect(onAgent).not.toHaveBeenCalledWith(expect.objectContaining({ agentId: "slow" }));

    releaseSlow?.();
    await collecting;
    expect(onAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: "slow", dataState: "ready" }));
  });
});
