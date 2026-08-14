import type { Agent as SdkAgent } from "@hypercli.com/sdk/agents";
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
  operationsSnapshot?: () => Promise<unknown>,
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
  it("keeps the whole RUNNING roster REST-only while collecting known Space access", async () => {
    const operationsSnapshots = Array.from({ length: 7 }, () => vi.fn(async () => ({
      sessions: { sessions: [] },
      cronJobs: [],
      failures: {},
      capturedAt: 1_000,
    })));
    const listGrants = vi.fn(async () => [grant("agent-1")]);

    const overview = await collectAccountOperationsOverview(
      operationsSnapshots.map((snapshot, index) => sdkAgent(`agent-${index + 1}`, "RUNNING", snapshot)),
      [adminSpace, restrictedSpace],
      { listGrants } as Pick<WorkspacesAPI, "listGrants">,
    );

    for (const operationsSnapshot of operationsSnapshots) {
      expect(operationsSnapshot).not.toHaveBeenCalled();
    }
    expect(Object.values(overview.agents)).toHaveLength(7);
    expect(Object.values(overview.agents)).toEqual(expect.arrayContaining([
      expect.objectContaining({ dataState: "deferred", sessions: null, cronJobs: null }),
    ]));
    expect(overview.spaces).toEqual([
      expect.objectContaining({ workspace: adminSpace, visibility: "known", agentIds: ["agent-1"] }),
      expect.objectContaining({ workspace: restrictedSpace, visibility: "restricted", agentIds: null }),
    ]);
    expect(listGrants).toHaveBeenCalledTimes(1);
  });

  it("keeps offline Agents distinct without inspecting gateway capabilities", async () => {
    const offlineSnapshot = vi.fn();
    const runningSnapshot = vi.fn();
    const agents = [
      sdkAgent("offline", "STOPPED", offlineSnapshot),
      sdkAgent("generic", "RUNNING"),
      sdkAgent("openclaw", "RUNNING", runningSnapshot),
    ];

    const overview = await collectAccountOperationsOverview(agents, [], null);

    expect(offlineSnapshot).not.toHaveBeenCalled();
    expect(runningSnapshot).not.toHaveBeenCalled();
    expect(overview.agents.offline?.dataState).toBe("offline");
    expect(overview.agents.generic?.dataState).toBe("deferred");
    expect(overview.agents.openclaw?.dataState).toBe("deferred");
  });

  it("reports Agent roster state synchronously without waiting on Space REST requests", async () => {
    const spaceGate = new Promise<WorkspaceGrant[]>(() => undefined);
    const onAgent = vi.fn();
    void collectAccountOperationsOverview(
      [sdkAgent("agent-1", "RUNNING", vi.fn())],
      [adminSpace],
      { listGrants: vi.fn(() => spaceGate) } as Pick<WorkspacesAPI, "listGrants">,
      { onAgent },
    );

    expect(onAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: "agent-1", dataState: "deferred" }));
  });
});
