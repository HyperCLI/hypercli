import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHyperAgentClient, createOpenClawAgent, startOpenClawAgent } from "./agent-client";

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
      start: vi.fn(),
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
    deploymentsInstance.start.mockReset();
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

  it("starts with the backend-stored launch contract and no public-config replay", async () => {
    deploymentsInstance.start.mockResolvedValue({ id: "agent-123" });

    await startOpenClawAgent("hyper_api_test", "agent-123");

    expect(deploymentsInstance.get).not.toHaveBeenCalled();
    expect(deploymentsInstance.startOpenClaw).not.toHaveBeenCalled();
    expect(deploymentsInstance.start).toHaveBeenCalledWith("agent-123");
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

  it("retries generated names when the backend reports a collision", async () => {
    deploymentsInstance.createOpenClaw
      .mockRejectedValueOnce({
        statusCode: 409,
        detail: "Agent 'bright-atlas-anchor' already exists",
      })
      .mockResolvedValueOnce({ id: "agent-123" });

    await expect(createOpenClawAgent("hyper_api_test", {
      name: "bright-atlas-anchor",
    })).resolves.toEqual({ id: "agent-123" });

    const attemptedNames = deploymentsInstance.createOpenClaw.mock.calls.map(([options]) => options.name);
    expect(attemptedNames).toHaveLength(2);
    expect(attemptedNames[0]).toBe("bright-atlas-anchor");
    expect(attemptedNames[1]).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    expect(new Set(attemptedNames).size).toBe(2);
  });

  it("strips stale creation correlation and ports before the first create request", async () => {
    deploymentsInstance.createOpenClaw.mockResolvedValueOnce({ id: "agent-123" });

    await expect(createOpenClawAgent("hyper_api_test", {
      name: "bright-atlas-anchor",
      start: false,
      meta: {
        ui: {
          avatar: { image: "/avatars/otter.svg", icon_index: 3 },
          creation_id: "setup-compat",
        },
      },
      ports: [{ port: 3000 }],
    } as unknown as Parameters<typeof createOpenClawAgent>[1])).resolves.toEqual({ id: "agent-123" });

    expect(deploymentsInstance.createOpenClaw).toHaveBeenCalledOnce();
    expect(deploymentsInstance.createOpenClaw).toHaveBeenCalledWith(expect.objectContaining({
      name: "bright-atlas-anchor",
      meta: {
        ui: {
          avatar: { image: "/avatars/otter.svg", icon_index: 3 },
        },
      },
    }));
    expect(deploymentsInstance.createOpenClaw.mock.calls[0]?.[0]).not.toHaveProperty("ports");
  });

  it("does not retry unrelated validation failures", async () => {
    const validationError = {
      statusCode: 422,
      detail: "Unknown agent size",
      responseText: JSON.stringify({ detail: "Unknown agent size" }),
    };
    deploymentsInstance.createOpenClaw.mockRejectedValue(validationError);

    await expect(createOpenClawAgent("hyper_api_test", {
      name: "bright-atlas-anchor",
      size: "invalid",
    })).rejects.toBe(validationError);

    expect(deploymentsInstance.createOpenClaw).toHaveBeenCalledTimes(1);
    expect(deploymentsInstance.list).not.toHaveBeenCalled();
  });

  it("does not replace a user-entered name when it conflicts", async () => {
    const collision = {
      statusCode: 409,
      detail: "Agent 'my-custom-agent' already exists",
    };
    deploymentsInstance.createOpenClaw.mockRejectedValue(collision);

    await expect(createOpenClawAgent("hyper_api_test", {
      name: "my-custom-agent",
    })).rejects.toBe(collision);
    expect(deploymentsInstance.createOpenClaw).toHaveBeenCalledOnce();
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

});
