import { describe, expect, it, vi } from "vitest";

import {
  createAgentMutationQueue,
  mergeAgentListAfterMutations,
  persistAgentCanonicalName,
  persistAgentDisplayName,
} from "./agent-profile-updates";

function updateClient() {
  return {
    update: vi.fn(async () => ({ endpoint: "managed" })),
    updateExternalAgent: vi.fn(async () => ({ endpoint: "external" })),
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

  it("routes canonical names by explicit external provenance", async () => {
    const client = updateClient();

    await persistAgentCanonicalName(client, { id: "managed-1", managed: true, name: "managed" }, " Managed Name ");
    await persistAgentCanonicalName(client, { id: "unknown-1", managed: null, name: "unknown" }, "Unknown Name");
    await persistAgentCanonicalName(client, { id: "external-1", managed: false, name: "external" }, "External Name");

    expect(client.update).toHaveBeenNthCalledWith(1, "managed-1", { name: "Managed Name" });
    expect(client.update).toHaveBeenNthCalledWith(2, "unknown-1", { name: "Unknown Name" });
    expect(client.updateExternalAgent).toHaveBeenCalledWith("external-1", { name: "External Name" });
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

    expect(client.update).toHaveBeenNthCalledWith(1, "managed-1", { handle: "managed_alias" });
    expect(client.update).toHaveBeenNthCalledWith(2, "unknown-1", { handle: "unknown" });
    expect(client.updateExternalAgent).not.toHaveBeenCalled();
  });

  it("persists external display names through the external-agent endpoint", async () => {
    const client = updateClient();

    await expect(persistAgentDisplayName(
      client,
      { id: "external-1", managed: false, name: "external" },
      " External Alias ",
    )).resolves.toEqual({ endpoint: "external" });

    expect(client.updateExternalAgent).toHaveBeenCalledWith("external-1", { displayName: "External Alias" });
    expect(client.update).not.toHaveBeenCalled();
  });

  it("rejects managed display names that cannot be backend handles", async () => {
    const client = updateClient();

    await expect(persistAgentDisplayName(
      client,
      { id: "managed-1", managed: true, name: "managed" },
      "Friendly Alias",
    )).rejects.toThrow("Display names must start with a lowercase letter or number and contain 2-64 lowercase letters, numbers, underscores, or dashes.");
    expect(client.update).not.toHaveBeenCalled();
    expect(client.updateExternalAgent).not.toHaveBeenCalled();
  });
});
