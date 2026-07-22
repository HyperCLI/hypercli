import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_CLEANUP_START_MESSAGE, createHyperAgentClient, createOpenClawAgent, startOpenClawAgent } from "./agent-client";

const { deploymentsConstructor, deploymentsInstance, getSlackInstallStatus, hyperAgentConstructor, httpClientConstructor, httpClientInstance } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.hypercli.com";
  process.env.NEXT_PUBLIC_AGENTS_URL = "https://agents.hypercli.com";
  process.env.NEXT_PUBLIC_SLACK_RELAY_BASE_URL = "https://api.hypercli.com";
  return {
    deploymentsConstructor: vi.fn(),
    deploymentsInstance: {
      createOpenClaw: vi.fn(),
      createOpenClawPro: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      startOpenClaw: vi.fn(),
    },
    getSlackInstallStatus: vi.fn(),
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
  getSlackInstallStatus,
}));
vi.mock("@hypercli.com/sdk/channels", () => ({
  buildSlackRelayApiUrl: (relayBaseUrl: string) => `${relayBaseUrl.replace(/\/+$/, "")}/slack/api/`,
  buildSlackRelayWebSocketUrl: (relayBaseUrl: string) => `${relayBaseUrl.replace(/^http/, "ws").replace(/\/+$/, "")}/slack/ws`,
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
    delete process.env.NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ORIGIN_LOCK;
    delete process.env.NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS;
    deploymentsInstance.get.mockReset();
    deploymentsInstance.createOpenClaw.mockReset();
    deploymentsInstance.createOpenClawPro.mockReset();
    deploymentsInstance.list.mockReset();
    deploymentsInstance.startOpenClaw.mockReset();
    getSlackInstallStatus.mockReset();
    getSlackInstallStatus.mockResolvedValue({
      connected: false,
      teamId: null,
      teamName: null,
      botUserId: null,
      updatedAt: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("constructs HyperAgent through the browser-safe SDK client", () => {
    const agent = createHyperAgentClient("hyper_api_test");

    expect(agent).toEqual({ marker: "agent-client" });
    expect(httpClientConstructor).toHaveBeenCalledWith("https://api.hypercli.com", "hyper_api_test");
    expect(hyperAgentConstructor).toHaveBeenCalledWith(httpClientInstance, "hyper_api_test", false, "https://api.hypercli.com/agents");
  });

  it("starts existing OpenClaw agents with their stored launch config and strips stale control UI origin locks by default", async () => {
    deploymentsInstance.get.mockResolvedValue({
      launchConfig: {
        config: {
          gateway: {
            controlUi: {
              allowedOrigins: ["https://claw.hypercli.com"],
            },
          },
        },
        image: "ghcr.io/hypercli/hypercli-openclaw:legacy",
        sync_root: "/home/ubuntu",
        sync_enabled: false,
        env: {
          OPENCLAW_GATEWAY_TOKEN: "existing-gateway-token",
          OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: "https://claw.hypercli.com",
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
      controlUiOriginLock: true,
      config: {},
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

  it("does not send an empty routes object when the saved launch config has no routes", async () => {
    deploymentsInstance.get.mockResolvedValue({
      launchConfig: {
        image: "ghcr.io/hypercli/hypercli-openclaw:prod",
        env: {
          OPENCLAW_DESKTOP_ENABLED: "0",
        },
      },
    });
    deploymentsInstance.startOpenClaw.mockResolvedValue({ id: "agent-123" });

    await startOpenClawAgent("hyper_api_test", "agent-123");

    expect(deploymentsInstance.startOpenClaw).toHaveBeenCalledWith("agent-123", expect.not.objectContaining({
      routes: expect.anything(),
    }));
  });

  it("preserves the saved desktop route when start overrides only touch env or config", async () => {
    deploymentsInstance.get.mockResolvedValue({
      launchConfig: {
        env: {
          OPENCLAW_DESKTOP_ENABLED: "1",
          FOO: "bar",
        },
        routes: {
          openclaw: { port: 18789, auth: false, prefix: "" },
          desktop: { port: 3000, auth: true, prefix: "desktop" },
        },
      },
    });
    deploymentsInstance.startOpenClaw.mockResolvedValue({ id: "agent-123" });

    await startOpenClawAgent("hyper_api_test", "agent-123", {
      config: {
        gateway: {
          controlUi: {
            requirePairing: true,
          },
        },
      },
      env: {
        EXTRA: "value",
      },
    });

    expect(deploymentsInstance.startOpenClaw).toHaveBeenCalledWith("agent-123", expect.objectContaining({
      env: {
        OPENCLAW_DESKTOP_ENABLED: "1",
        FOO: "bar",
        EXTRA: "value",
      },
      routes: {
        openclaw: { port: 18789, auth: false, prefix: "" },
        desktop: { port: 3000, auth: true, prefix: "desktop" },
      },
    }));
  });

  it("creates OpenClaw agents with origin locking on by default", async () => {
    deploymentsInstance.createOpenClaw.mockResolvedValue({ id: "agent-123" });

    await createOpenClawAgent("hyper_api_test", {
      env: { FOO: "bar" },
    });

    expect(deploymentsInstance.createOpenClaw).toHaveBeenCalledWith(expect.objectContaining({
      controlUiOriginLock: true,
      config: {},
      env: {
        FOO: "bar",
      },
    }));
  });

  it("adds hosted Slack relay launch config when the signed-in account has Slack connected", async () => {
    getSlackInstallStatus.mockResolvedValue({
      connected: true,
      teamId: "T123",
      teamName: "Test Workspace",
      botUserId: "U123",
      updatedAt: "2026-07-19T12:00:00Z",
    });
    deploymentsInstance.createOpenClaw.mockResolvedValue({ id: "agent-123" });

    await createOpenClawAgent("hyper_api_test", {
      env: { FOO: "bar" },
    });

    expect(getSlackInstallStatus).toHaveBeenCalledWith({
      relayBaseUrl: "https://api.hypercli.com",
      token: "hyper_api_test",
    });
    expect(deploymentsInstance.createOpenClaw).toHaveBeenCalledWith(expect.objectContaining({
      env: {
        FOO: "bar",
        HYPER_SLACK_APP_ENABLED: "1",
        HYPER_SLACK_RELAY_URL: "wss://api.hypercli.com/slack/ws",
        HYPER_SLACK_API_URL: "https://api.hypercli.com/slack/api/",
      },
      config: {
        channels: {
          slack: {
            enabled: true,
            mode: "relay",
            groupPolicy: "open",
            replyToMode: "all",
            replyToModeByChatType: { direct: "off" },
            botToken: { source: "env", provider: "default", id: "SLACK_BOT_TOKEN" },
            relay: {
              url: "wss://api.hypercli.com/slack/ws",
              authToken: { source: "env", provider: "default", id: "HYPER_AGENTS_API_KEY" },
            },
          },
        },
      },
    }));
  });

  it("does not replace explicit self-hosted Slack launch config", async () => {
    getSlackInstallStatus.mockResolvedValue({
      connected: true,
      teamId: "T123",
      teamName: "Test Workspace",
      botUserId: "U123",
      updatedAt: "2026-07-19T12:00:00Z",
    });
    deploymentsInstance.createOpenClaw.mockResolvedValue({ id: "agent-123" });

    await createOpenClawAgent("hyper_api_test", {
      config: {
        channels: {
          slack: {
            enabled: true,
            mode: "socket",
            botToken: "xoxb-custom",
            appToken: "xapp-custom",
          },
        },
      },
    });

    expect(deploymentsInstance.createOpenClaw).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        channels: {
          slack: {
            enabled: true,
            mode: "socket",
            botToken: "xoxb-custom",
            appToken: "xapp-custom",
          },
        },
      },
      env: {},
    }));
  });

  it("creates OpenClaw pro agents when desktop is enabled", async () => {
    deploymentsInstance.createOpenClawPro.mockResolvedValue({ id: "agent-123" });

    await createOpenClawAgent("hyper_api_test", {
      env: { OPENCLAW_DESKTOP_ENABLED: "1" },
      image: "ghcr.io/hypercli/hypercli-openclaw:pro-prod",
      openClawRoutes: { includeDesktop: true },
    });

    expect(deploymentsInstance.createOpenClawPro).toHaveBeenCalledWith(expect.objectContaining({
      controlUiOriginLock: true,
      config: {},
      image: "ghcr.io/hypercli/hypercli-openclaw:pro-prod",
      env: { OPENCLAW_DESKTOP_ENABLED: "1" },
      openClawRoutes: { includeDesktop: true },
    }));
    expect(deploymentsInstance.createOpenClaw).not.toHaveBeenCalled();
  });

  it("reconciles create spec visibility conflicts when the agent appears in the list", async () => {
    vi.useFakeTimers();
    const recoveredAgent = {
      id: "agent-recovered",
      name: "clear-window-works",
      createdAt: new Date("2026-07-18T19:08:15.000Z"),
    };
    deploymentsInstance.createOpenClawPro.mockRejectedValue({
      statusCode: 409,
      detail: "Backend agent spec not found for agent af9e6156-bef8-4777-bac6-a261bd852bc6",
    });
    deploymentsInstance.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([recoveredAgent]);

    const result = createOpenClawAgent("hyper_api_test", {
      name: "clear-window-works",
      env: { OPENCLAW_DESKTOP_ENABLED: "1" },
    });

    await vi.advanceTimersByTimeAsync(750);
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(result).resolves.toBe(recoveredAgent);
    expect(deploymentsInstance.list).toHaveBeenCalledTimes(2);
  });

  it("accepts capitalized desktop launch env values", async () => {
    deploymentsInstance.createOpenClawPro.mockResolvedValue({ id: "agent-123" });
    deploymentsInstance.createOpenClaw.mockResolvedValue({ id: "agent-456" });

    await createOpenClawAgent("hyper_api_test", {
      env: { OPENCLAW_DESKTOP_ENABLED: "True" },
    });
    expect(deploymentsInstance.createOpenClawPro).toHaveBeenCalledWith(expect.objectContaining({
      env: { OPENCLAW_DESKTOP_ENABLED: "True" },
    }));

    vi.clearAllMocks();

    await createOpenClawAgent("hyper_api_test", {
      env: { OPENCLAW_DESKTOP_ENABLED: "False" },
    });
    expect(deploymentsInstance.createOpenClaw).toHaveBeenCalledWith(expect.objectContaining({
      env: { OPENCLAW_DESKTOP_ENABLED: "False" },
    }));
    expect(deploymentsInstance.createOpenClawPro).not.toHaveBeenCalled();
  });

  it("applies configured control UI origins when the allowlist is enabled", async () => {
    const currentOrigin = window.location.origin;
    process.env.NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS = "https://feat.hypercli.com http://localhost:4003";
    deploymentsInstance.createOpenClaw.mockResolvedValue({ id: "agent-123" });

    await createOpenClawAgent("hyper_api_test", {
      config: {
        gateway: {
          controlUi: {
            allowedOrigins: ["https://claw.hypercli.com"],
            requirePairing: true,
          },
        },
      },
      env: {
        OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: "https://old.hypercli.com",
        FOO: "bar",
      },
    });

    expect(deploymentsInstance.createOpenClaw).toHaveBeenCalledWith(expect.objectContaining({
      controlUiOriginLock: true,
      config: {
        gateway: {
          controlUi: {
            allowedOrigins: [
              "https://old.hypercli.com",
              "https://claw.hypercli.com",
              "https://feat.hypercli.com",
              "http://localhost:4003",
              currentOrigin,
            ],
            requirePairing: true,
          },
        },
      },
      env: {
        FOO: "bar",
      },
    }));
  });

  it("disables the control UI origin lock when configured off", async () => {
    process.env.NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ORIGIN_LOCK = "off";
    process.env.NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS = "https://feat.hypercli.com";
    deploymentsInstance.createOpenClaw.mockResolvedValue({ id: "agent-123" });

    await createOpenClawAgent("hyper_api_test", {
      config: {
        gateway: {
          controlUi: {
            allowedOrigins: ["https://claw.hypercli.com"],
            requirePairing: true,
          },
        },
      },
      env: {
        OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: "https://old.hypercli.com",
        FOO: "bar",
      },
    });

    expect(deploymentsInstance.createOpenClaw).toHaveBeenCalledWith(expect.objectContaining({
      controlUiOriginLock: false,
      config: {
        gateway: {
          controlUi: {
            requirePairing: true,
          },
        },
      },
      env: {
        FOO: "bar",
      },
    }));
  });

  it("retries start while the agent is still cleaning up", async () => {
    vi.useFakeTimers();
    deploymentsInstance.get.mockResolvedValue({ launchConfig: {} });
    deploymentsInstance.startOpenClaw
      .mockRejectedValueOnce({
        statusCode: 409,
        detail: "Agent 'steady-pilot-engine' is still being cleaned up, try again in a moment",
      })
      .mockResolvedValueOnce({ id: "agent-123" });

    const start = startOpenClawAgent("hyper_api_test", "agent-123");

    await vi.waitFor(() => expect(deploymentsInstance.startOpenClaw).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(start).resolves.toEqual({ id: "agent-123" });
    expect(deploymentsInstance.startOpenClaw).toHaveBeenCalledTimes(2);
  });

  it("returns a friendly cleanup message after retrying cleanup conflicts", async () => {
    vi.useFakeTimers();
    deploymentsInstance.get.mockResolvedValue({ launchConfig: {} });
    deploymentsInstance.startOpenClaw.mockRejectedValue({
      statusCode: 409,
      detail: "Agent 'steady-pilot-engine' is still being cleaned up, try again in a moment",
    });

    const start = startOpenClawAgent("hyper_api_test", "agent-123");
    const expectedFailure = expect(start).rejects.toThrow(AGENT_CLEANUP_START_MESSAGE);

    await vi.waitFor(() => expect(deploymentsInstance.startOpenClaw).toHaveBeenCalledTimes(1));
    for (const delay of [2_000, 3_000, 5_000, 8_000, 12_000]) {
      await vi.advanceTimersByTimeAsync(delay);
    }

    await expectedFailure;
    expect(deploymentsInstance.startOpenClaw).toHaveBeenCalledTimes(6);
  });
});
