import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHyperAgentClient, startOpenClawAgent } from "./agent-client";

const { deploymentsConstructor, deploymentsInstance, hyperAgentConstructor, httpClientConstructor, httpClientInstance } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.hypercli.com";
  return {
    deploymentsConstructor: vi.fn(),
    deploymentsInstance: {
      get: vi.fn(),
      startOpenClaw: vi.fn(),
    },
    hyperAgentConstructor: vi.fn(),
    httpClientConstructor: vi.fn(),
    httpClientInstance: { marker: "http-client" },
  };
});

vi.mock("@hypercli.com/sdk/agent", () => ({
  HyperAgent: vi.fn(function HyperAgentMock(...args) {
    hyperAgentConstructor(...args);
    return { marker: "agent-client" };
  }),
}));
vi.mock("@hypercli.com/sdk/agents", () => ({
  Deployments: vi.fn(function DeploymentsMock(...args) {
    deploymentsConstructor(...args);
    return deploymentsInstance;
  }),
}));
vi.mock("@hypercli.com/sdk/http", () => ({
  HTTPClient: vi.fn(function HTTPClientMock(...args) {
    httpClientConstructor(...args);
    return httpClientInstance;
  }),
}));

vi.mock("@hypercli/shared-ui", () => ({
  clearStoredToken: vi.fn(),
  exchangePrivyToken: vi.fn(),
  getAppToken: vi.fn(),
  getStoredToken: vi.fn(),
  isTokenExpired: vi.fn(),
  setStoredToken: vi.fn(),
}));

describe("agent-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deploymentsInstance.get.mockReset();
    deploymentsInstance.startOpenClaw.mockReset();
  });

  it("constructs HyperAgent through the browser-safe SDK client", () => {
    const agent = createHyperAgentClient("hyper_api_test");

    expect(agent).toEqual({ marker: "agent-client" });
    expect(httpClientConstructor).toHaveBeenCalledWith("https://api.hypercli.com", "hyper_api_test");
    expect(hyperAgentConstructor).toHaveBeenCalledWith(httpClientInstance, "hyper_api_test", false, "https://api.hypercli.com/agents");
  });

  it("starts existing OpenClaw agents with their stored launch config", async () => {
    deploymentsInstance.get.mockResolvedValue({
      launchConfig: {
        image: "ghcr.io/hypercli/hypercli-openclaw:legacy",
        sync_root: "/home/ubuntu",
        sync_enabled: false,
        env: {
          OPENCLAW_GATEWAY_TOKEN: "existing-gateway-token",
          FOO: "bar",
        },
        routes: {
          openclaw: { port: 18789, auth: false, prefix: "" },
        },
      },
    });
    deploymentsInstance.startOpenClaw.mockResolvedValue({ id: "agent-123" });

    await startOpenClawAgent("hyper_api_test", "agent-123", {
      env: { EXTRA: "value" },
      syncEnabled: true,
    });

    expect(deploymentsInstance.get).toHaveBeenCalledWith("agent-123");
    expect(deploymentsInstance.startOpenClaw).toHaveBeenCalledWith("agent-123", expect.objectContaining({
      image: "ghcr.io/hypercli/hypercli-openclaw:legacy",
      syncRoot: "/home/ubuntu",
      syncEnabled: true,
      env: {
        OPENCLAW_GATEWAY_TOKEN: "existing-gateway-token",
        FOO: "bar",
        EXTRA: "value",
      },
      routes: {
        openclaw: { port: 18789, auth: false, prefix: "" },
      },
    }));
  });
});
