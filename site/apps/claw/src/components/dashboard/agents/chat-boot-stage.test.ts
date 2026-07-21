import { describe, expect, it } from "vitest";

import {
  getAgentChatBootStatus,
  getAgentGatewayPanelBootStatus,
  stabilizeAgentChatBootStatus,
} from "./chat-boot-stage";

const baseInput = {
  agentState: "RUNNING" as const,
  isSelectedRunning: true,
  gatewayConnected: false,
  ready: false,
  connected: false,
  connecting: false,
  hydrating: false,
  error: null,
};

describe("getAgentChatBootStatus", () => {
  it("keeps lifecycle startup ahead of gateway readiness", () => {
    expect(getAgentChatBootStatus({
      ...baseInput,
      agentState: "STARTING",
      gatewayConnected: true,
      ready: true,
      connected: true,
    })).toMatchObject({
      status: "loading",
      phase: "booting",
      title: "Booting agent",
      stage: "agent",
    });
  });

  it("shows restore and shared knowledge sync phases before gateway readiness", () => {
    expect(getAgentChatBootStatus({
      ...baseInput,
      agentState: "RESTORING",
      gatewayConnected: true,
      ready: true,
      connected: true,
    })).toMatchObject({
      status: "loading",
      phase: "restoring",
      title: "Restoring files",
      stage: "runtime",
    });

    expect(getAgentChatBootStatus({
      ...baseInput,
      agentState: "SYNCING",
      gatewayConnected: true,
      ready: true,
      connected: true,
    })).toMatchObject({
      status: "loading",
      phase: "syncing",
      title: "Syncing shared knowledge",
      stage: "runtime",
    });
  });

  it("shows init-container failure states directly", () => {
    expect(getAgentChatBootStatus({
      ...baseInput,
      agentState: "RESTORE_FAILED",
      isSelectedRunning: false,
    })).toMatchObject({
      status: "error",
      title: "Restore failed",
    });

    expect(getAgentChatBootStatus({
      ...baseInput,
      agentState: "SYNC_FAILED",
      isSelectedRunning: false,
    })).toMatchObject({
      status: "error",
      title: "Sync failed",
    });
  });

  it("moves connected transport into workspace hydration before chat is ready", () => {
    expect(getAgentChatBootStatus({
      ...baseInput,
      gatewayConnected: true,
      ready: false,
      connected: false,
      connecting: true,
    })).toMatchObject({
      status: "loading",
      phase: "workspace",
      title: "Loading workspace",
      stage: "complete",
    });
  });

  it("returns ready only after chat is connected", () => {
    expect(getAgentChatBootStatus({
      ...baseInput,
      gatewayConnected: true,
      ready: true,
      connected: true,
    })).toEqual({ status: "ready" });
  });

  it("keeps a running agent in the gateway stage when reconnecting", () => {
    expect(getAgentChatBootStatus(baseInput)).toMatchObject({
      status: "loading",
      phase: "gateway",
      title: "Waiting for gateway",
      stage: "gateway",
    });
  });

  it("falls back to the stopped empty state when the selected agent is not running", () => {
    expect(getAgentChatBootStatus({
      ...baseInput,
      agentState: "STOPPED",
      isSelectedRunning: false,
    })).toEqual({ status: "stopped" });
  });

  it("surfaces gateway errors as an explicit retryable stage", () => {
    expect(getAgentChatBootStatus({
      ...baseInput,
      error: "Gateway handshake failed",
    })).toMatchObject({
      status: "error",
      phase: "error",
      title: "Could not connect",
      detail: "Gateway handshake failed",
      stage: "gateway",
    });
  });

  it("does not regress from workspace hydration back to gateway during transient updates", () => {
    const workspace = getAgentChatBootStatus({
      ...baseInput,
      gatewayConnected: true,
      connecting: true,
    });
    const gateway = getAgentChatBootStatus({
      ...baseInput,
      connecting: true,
    });

    expect(stabilizeAgentChatBootStatus(workspace, gateway)).toBe(workspace);
  });
});

describe("getAgentGatewayPanelBootStatus", () => {
  it("returns a consistent loading status for connected panels that are still reading data", () => {
    expect(getAgentGatewayPanelBootStatus({
      connected: true,
      loading: true,
      loadingTitle: "Loading integrations",
      loadingDetail: "Reading available capabilities.",
      connectingDetail: "Opening integrations.",
      waitingDetail: "Waiting for gateway.",
    })).toMatchObject({
      status: "loading",
      phase: "workspace",
      title: "Loading integrations",
      stage: "complete",
    });
  });

  it("returns a consistent gateway wait status for disconnected panels", () => {
    expect(getAgentGatewayPanelBootStatus({
      connected: false,
      connecting: false,
      loadingTitle: "Loading files",
      loadingDetail: "Reading files.",
      connectingDetail: "Opening files.",
      waitingDetail: "Start the gateway.",
    })).toMatchObject({
      status: "loading",
      phase: "gateway",
      title: "Waiting for gateway",
      detail: "Start the gateway.",
      stage: "gateway",
    });
  });
});
