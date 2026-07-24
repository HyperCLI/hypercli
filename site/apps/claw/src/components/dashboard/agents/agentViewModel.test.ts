import { describe, expect, it } from "vitest";

import { isAgentOffline } from "@/app/dashboard/agents/types";
import { buildSdkAgent } from "@/test/factories";
import { agentDisplayLabel, normalizeAgentState, toAgentViewModel } from "./agentViewModel";

describe("agentViewModel", () => {
  it("maps legacy ERROR agent state to FAILED", () => {
    expect(normalizeAgentState("ERROR")).toBe("FAILED");
    expect(toAgentViewModel(buildSdkAgent({ state: "ERROR" as never })).state).toBe("FAILED");
  });

  it("maps unknown string states to FAILED instead of inventing an unsupported state", () => {
    expect(normalizeAgentState("crashed")).toBe("FAILED");
  });

  it("keeps missing state as STOPPED", () => {
    expect(normalizeAgentState(null)).toBe("STOPPED");
  });

  it("classifies only stopped agents as offline", () => {
    expect(isAgentOffline("STOPPED")).toBe(true);
    expect(isAgentOffline("stopped")).toBe(true);
    expect(isAgentOffline("RUNNING")).toBe(false);
    expect(isAgentOffline("STARTING")).toBe(false);
    expect(isAgentOffline("FAILED")).toBe(false);
    expect(isAgentOffline(null)).toBe(false);
  });

  it("preserves launch config for runtime settings", () => {
    const launchConfig = {
      image: "ghcr.io/hypercli/hypercli-openclaw:prod",
      env: { FOO: "bar" },
    };

    expect(toAgentViewModel(buildSdkAgent({ launchConfig })).launchConfig).toEqual(launchConfig);
  });

  it("preserves distinct names and explicit management provenance", () => {
    const mapped = toAgentViewModel(buildSdkAgent({
      name: "research-agent",
      displayName: "Research Pilot",
      managed: false,
    }));

    expect(mapped.name).toBe("research-agent");
    expect(mapped.displayName).toBe("Research Pilot");
    expect(mapped.managed).toBe(false);
  });

  it("overlays local display names only for managed or unknown agents", () => {
    const managed = toAgentViewModel(buildSdkAgent({
      name: "research-agent",
      displayName: "research-agent",
      managed: true,
    }), { managedDisplayName: "Research Pilot" });
    const unknown = toAgentViewModel(buildSdkAgent({
      name: "unknown-agent",
      managed: null,
    }), { managedDisplayName: "Unknown Pilot" });
    const external = toAgentViewModel(buildSdkAgent({
      name: "external-agent",
      displayName: "Backend Name",
      managed: false,
    }), { managedDisplayName: "Local Name" });

    expect(managed.displayName).toBe("Research Pilot");
    expect(managed.name).toBe("research-agent");
    expect(unknown.displayName).toBe("Unknown Pilot");
    expect(external.displayName).toBe("Backend Name");
    expect(agentDisplayLabel(managed)).toBe("Research Pilot");
  });

  it("ignores blank local aliases", () => {
    const mapped = toAgentViewModel(buildSdkAgent({
      name: "research-agent",
      managed: true,
    }), { managedDisplayName: "   " });

    expect(mapped.displayName).toBe("research-agent");
  });
});
