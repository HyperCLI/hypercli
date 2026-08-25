import { describe, expect, it, vi } from "vitest";

import {
  createAgentMutationQueue,
  managedAgentHandleFromDisplayName,
  mergeAgentListAfterMutations,
  persistAgentCanonicalName,
  persistAgentDisplayName,
  shouldReplaceAgentSnapshot,
  upsertAgentSnapshot,
} from "./agent-profile-updates";

describe("managedAgentHandleFromDisplayName", () => {
  it("uses the managed display-name normalization and validation rules", () => {
    expect(managedAgentHandleFromDisplayName(" Research Assistant ")).toBe("research-assistant");
    expect(() => managedAgentHandleFromDisplayName("Assistant!")).toThrow("Display names must start");
  });
});

function updateClient() {
  return {
    update: vi.fn(async () => ({ endpoint: "managed" })),
  };
}

describe("agent profile updates", () => {
  it("serializes profile mutations for the same agent", async () => {
    const runMutation = createAgentMutationQueue();
    const operations: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runMutation("agent-1", async () => {
      operations.push("first-start");
      await firstGate;
      operations.push("first-end");
      return "first";
    });
    const second = runMutation("agent-1", async () => {
      operations.push("second-start");
      return "second";
    });

    await Promise.resolve();
    expect(operations).toEqual(["first-start"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(operations).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("preserves agent records changed while a list request was in flight", () => {
    const versionsAtRequest = new Map([["changed", 1], ["stable", 2]]);
    const currentVersions = new Map([["changed", 2], ["stable", 2], ["missing", 1]]);

    expect(mergeAgentListAfterMutations(
      [
        { id: "changed", handle: "new-handle" },
        { id: "stable", handle: "old-stable" },
        { id: "missing", handle: "new-missing" },
      ],
      [
        { id: "changed", handle: "old-handle" },
        { id: "stable", handle: "fresh-stable" },
      ],
      versionsAtRequest,
      currentVersions,
    )).toEqual([
      { id: "changed", handle: "new-handle" },
      { id: "stable", handle: "fresh-stable" },
      { id: "missing", handle: "new-missing" },
    ]);
  });

  it("uses the listed lifecycle snapshot when no local mutation raced the request", () => {
    const versions = new Map([["agent-1", 1]]);

    expect(mergeAgentListAfterMutations(
      [{ id: "agent-1", state: "RUNNING" }],
      [{ id: "agent-1", state: "STARTING" }],
      versions,
      versions,
    )).toEqual([
      { id: "agent-1", state: "STARTING" },
    ]);
  });

  it("never regresses an Agent to an older launch epoch", () => {
    const archived = { id: "agent-1", state: "ARCHIVED", launchEpoch: 5, updatedAt: null };
    const staleStopped = { id: "agent-1", state: "STOPPED", launchEpoch: 4, updatedAt: null };

    expect(shouldReplaceAgentSnapshot(archived, staleStopped)).toBe(false);
    expect(upsertAgentSnapshot([archived], staleStopped)).toEqual([archived]);
    expect(mergeAgentListAfterMutations(
      [archived],
      [staleStopped],
      new Map(),
      new Map(),
      shouldReplaceAgentSnapshot,
    )).toEqual([archived]);
  });

  it("uses updated time to order snapshots within one launch epoch", () => {
    const starting = { id: "agent-1", state: "STARTING", launchEpoch: 6, updatedAt: new Date("2026-08-13T00:00:02Z") };
    const staleStopped = { id: "agent-1", state: "STOPPED", launchEpoch: 6, updatedAt: new Date("2026-08-13T00:00:01Z") };

    expect(upsertAgentSnapshot([starting], staleStopped)).toEqual([starting]);
  });

  it("does not let a delayed exact STOPPED snapshot replace a newer dev projection", () => {
    const newerStarting = {
      id: "agent-1",
      state: "STARTING",
      launchEpoch: 7,
      updatedAt: new Date("2026-08-13T00:00:04Z"),
    };
    const delayedStopped = {
      id: "agent-1",
      state: "STOPPED",
      launchEpoch: 7,
      updatedAt: new Date("2026-08-13T00:00:03Z"),
    };

    expect(upsertAgentSnapshot([newerStarting], delayedStopped)).toEqual([newerStarting]);
  });

  it("routes canonical names through the managed endpoint", async () => {
    const client = updateClient();

    await persistAgentCanonicalName(client, { id: "managed-1", managed: true, name: "managed" }, " Managed Name ");
    await persistAgentCanonicalName(client, { id: "unknown-1", managed: null, name: "unknown" }, "Unknown Name");

    expect(client.update).toHaveBeenNthCalledWith(1, "managed-1", { name: "Managed Name" });
    expect(client.update).toHaveBeenNthCalledWith(2, "unknown-1", { name: "Unknown Name" });
  });

  it("persists managed and unknown display names as backend handles", async () => {
    const client = updateClient();

    await expect(persistAgentDisplayName(
      client,
      { id: "managed-1", managed: true, name: "managed" },
      " @Managed_Alias ",
    )).resolves.toEqual({ endpoint: "managed" });
    await expect(persistAgentDisplayName(
      client,
      { id: "unknown-1", managed: null, name: "unknown" },
      "unknown",
    )).resolves.toEqual({ endpoint: "managed" });
    await expect(persistAgentDisplayName(
      client,
      { id: "managed-2", managed: true, name: "managed" },
      "Best One In The World",
    )).resolves.toEqual({ endpoint: "managed" });

    expect(client.update).toHaveBeenNthCalledWith(1, "managed-1", { handle: "managed_alias" });
    expect(client.update).toHaveBeenNthCalledWith(2, "unknown-1", { handle: "unknown" });
    expect(client.update).toHaveBeenNthCalledWith(3, "managed-2", { handle: "best-one-in-the-world" });
  });

  it("rejects managed display names that cannot be backend handles", async () => {
    const client = updateClient();

    await expect(persistAgentDisplayName(
      client,
      { id: "managed-1", managed: true, name: "managed" },
      "Friendly Alias!",
    )).rejects.toThrow("Display names must start with a letter or number and contain 2-64 letters, numbers, spaces, underscores, or dashes.");
    expect(client.update).not.toHaveBeenCalled();
  });
});
