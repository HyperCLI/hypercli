import { describe, expect, it } from "vitest";

import { isAgentOffline } from "@/app/dashboard/agents/types";
import { buildSdkAgent } from "@/test/factories";
import { agentDisplayLabel, didAnyAgentFinishStopping, normalizeAgentState, toAgentViewModel } from "./agentViewModel";

describe("agentViewModel", () => {
  it("maps legacy ERROR agent state to FAILED", () => {
    expect(normalizeAgentState("ERROR")).toBe("FAILED");
    expect(toAgentViewModel(buildSdkAgent({ state: "ERROR" as never })).state).toBe("FAILED");
  });

  it("preserves unknown future string states", () => {
    expect(normalizeAgentState("draining")).toBe("DRAINING");
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

  it("preserves runtime and gateway identity for surface selection", () => {
    const codingAgent = toAgentViewModel(buildSdkAgent({
      runtime: "opencode",
      gatewayId: null,
    }));
    const gatewayAgent = toAgentViewModel(buildSdkAgent({
      runtime: "openclaw",
      gatewayId: "gateway-1",
    }));

    expect(codingAgent.runtime).toBe("opencode");
    expect(codingAgent.gatewayId).toBeNull();
    expect(gatewayAgent.runtime).toBe("openclaw");
    expect(gatewayAgent.gatewayId).toBe("gateway-1");
  });

  it("detects STOPPING to STOPPED completion for slot enrichment refresh", () => {
    const previous = new Map([
      ["agent-1", "STOPPING" as const],
      ["agent-2", "RUNNING" as const],
    ]);

    expect(didAnyAgentFinishStopping(previous, [
      { id: "agent-1", state: "STOPPED" },
      { id: "agent-2", state: "RUNNING" },
    ])).toBe(true);
    expect(didAnyAgentFinishStopping(previous, [
      { id: "agent-1", state: "STOPPING" },
      { id: "agent-2", state: "RUNNING" },
    ])).toBe(false);
  });

  it("applies presentation avatar overrides without changing the SDK agent", () => {
    const sdkAgent = buildSdkAgent({ avatarUrl: "https://cdn.example.test/original.png" });

    expect(toAgentViewModel(sdkAgent, "blob:fresh-avatar").avatarUrl).toBe("blob:fresh-avatar");
    expect(toAgentViewModel(sdkAgent, null).avatarUrl).toBeNull();
    expect(sdkAgent.avatarUrl).toBe("https://cdn.example.test/original.png");
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

  it("derives friendly display names from backend handles for managed or unknown agents", () => {
    const managed = toAgentViewModel(buildSdkAgent({
      name: "research-agent",
      handle: "research-pilot",
      displayName: "ignored-backend-name",
      managed: true,
    }));
    const unknown = toAgentViewModel(buildSdkAgent({
      name: "unknown-agent",
      handle: "unknown-pilot",
      managed: null,
    }));
    const external = toAgentViewModel(buildSdkAgent({
      name: "external-agent",
      displayName: "Backend Name",
      handle: "external-handle",
      managed: false,
    }));

    expect(managed.displayName).toBe("Research Pilot");
    expect(managed.name).toBe("research-agent");
    expect(unknown.displayName).toBe("Unknown Pilot");
    expect(external.displayName).toBe("Backend Name");
    expect(agentDisplayLabel(managed)).toBe("Research Pilot");
  });

  it("falls back to the canonical name without a managed handle", () => {
    const mapped = toAgentViewModel(buildSdkAgent({
      name: "research-agent",
      handle: null,
      managed: true,
    }));

    expect(mapped.displayName).toBe("research-agent");
  });

  it("does not cross display-name fields between agent provenances", () => {
    const managed = toAgentViewModel(buildSdkAgent({
      name: null,
      podName: "managed-pod",
      handle: null,
      displayName: "external-only-name",
      managed: true,
    }));
    const external = toAgentViewModel(buildSdkAgent({
      name: "external-agent",
      handle: "external-handle",
      displayName: "   ",
      managed: false,
    }));

    expect(managed.displayName).toBe("managed-pod");
    expect(agentDisplayLabel(managed)).toBe("managed-pod");
    expect(agentDisplayLabel({
      id: "raw-managed",
      name: "canonical-managed",
      pod_name: null,
      handle: null,
      displayName: "external-only-name",
      managed: null,
    })).toBe("canonical-managed");
    expect(external.displayName).toBe("external-agent");
    expect(agentDisplayLabel(external)).toBe("external-agent");
  });
});
