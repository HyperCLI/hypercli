import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_CLEANUP_START_MESSAGE, createHyperAgentClient, createOpenClawAgent, startOpenClawAgent } from "./agent-client";

const { deploymentsConstructor, deploymentsInstance, hyperAgentConstructor, httpClientConstructor, httpClientInstance } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.hypercli.com";
  process.env.NEXT_PUBLIC_AGENTS_URL = "https://agents.hypercli.com";
  return {
    deploymentsConstructor: vi.fn(),
    deploymentsInstance: {
      createOpenClaw: vi.fn(),
      createOpenClawPro: vi.fn(),
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
    delete process.env.NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ORIGIN_LOCK;
    delete process.env.NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS;
    deploymentsInstance.get.mockReset();
    deploymentsInstance.createOpenClaw.mockReset();
    deploymentsInstance.createOpenClawPro.mockReset();
    deploymentsInstance.startOpenClaw.mockReset();
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
