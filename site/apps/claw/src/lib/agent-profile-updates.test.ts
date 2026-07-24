import { describe, expect, it, vi } from "vitest";

import { persistAgentCanonicalName, persistAgentDisplayName } from "./agent-profile-updates";

function updateClient() {
  return {
    update: vi.fn(async () => ({ endpoint: "managed" })),
    updateExternalAgent: vi.fn(async () => ({ endpoint: "external" })),
  };
}

describe("agent profile updates", () => {
  it("routes canonical names by explicit external provenance", async () => {
    const client = updateClient();

    await persistAgentCanonicalName(client, { id: "managed-1", managed: true, name: "managed" }, " Managed Name ");
    await persistAgentCanonicalName(client, { id: "unknown-1", managed: null, name: "unknown" }, "Unknown Name");
    await persistAgentCanonicalName(client, { id: "external-1", managed: false, name: "external" }, "External Name");

    expect(client.update).toHaveBeenNthCalledWith(1, "managed-1", { name: "Managed Name" });
    expect(client.update).toHaveBeenNthCalledWith(2, "unknown-1", { name: "Unknown Name" });
    expect(client.updateExternalAgent).toHaveBeenCalledWith("external-1", { name: "External Name" });
  });

  it("stores managed and unknown display names locally without creating an API client", async () => {
    const client = updateClient();
    const getClient = vi.fn(async () => client);
    const setManagedDisplayName = vi.fn(async () => undefined);

    await expect(persistAgentDisplayName(
      getClient,
      { id: "managed-1", managed: true, name: "managed" },
      " Managed Alias ",
      setManagedDisplayName,
    )).resolves.toBeNull();
    await persistAgentDisplayName(
      getClient,
      { id: "unknown-1", managed: null, name: "unknown" },
      "unknown",
      setManagedDisplayName,
    );

    expect(setManagedDisplayName).toHaveBeenNthCalledWith(1, "managed-1", "Managed Alias");
    expect(setManagedDisplayName).toHaveBeenNthCalledWith(2, "unknown-1", null);
    expect(getClient).not.toHaveBeenCalled();
  });

  it("persists external display names through the external-agent endpoint", async () => {
    const client = updateClient();
    const setManagedDisplayName = vi.fn();

    await expect(persistAgentDisplayName(
      async () => client,
      { id: "external-1", managed: false, name: "external" },
      " External Alias ",
      setManagedDisplayName,
    )).resolves.toEqual({ endpoint: "external" });

    expect(client.updateExternalAgent).toHaveBeenCalledWith("external-1", { displayName: "External Alias" });
    expect(client.update).not.toHaveBeenCalled();
    expect(setManagedDisplayName).not.toHaveBeenCalled();
  });

  it("rejects an unscoped managed display-name save", async () => {
    const getClient = vi.fn(async () => updateClient());

    await expect(persistAgentDisplayName(
      getClient,
      { id: "managed-1", managed: true, name: "managed" },
      "Alias",
    )).rejects.toThrow("Local display name updates are unavailable without an authenticated account session.");
    expect(getClient).not.toHaveBeenCalled();
  });
});
