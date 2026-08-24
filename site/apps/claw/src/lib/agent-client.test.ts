import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { archiveAgent, createHermesAgentDeployment, createHyperAgentClient, createOpenClawAgent, deleteStoppedAgent, isAgentLifecycleStateConflictError, requestAgentStart, restoreAgent, startAgent, stopAgent, waitForAgentRunning, waitForCreatedAgentStopped } from "./agent-client";

const { deploymentsConstructor, deploymentsInstance, getSlackInstallStatus, hyperAgentConstructor, httpClientConstructor, httpClientInstance } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.hypercli.com";
  process.env.NEXT_PUBLIC_SLACK_RELAY_BASE_URL = "https://api.hypercli.com";
  return {
    deploymentsConstructor: vi.fn(),
    deploymentsInstance: {
      createOpenClaw: vi.fn(),
      createOpenClawPro: vi.fn(),
      createHermesAgent: vi.fn(),
      archive: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      setEnv: vi.fn(),
      start: vi.fn(),
      startOpenClaw: vi.fn(),
      startHermesAgent: vi.fn(),
      restore: vi.fn(),
      stop: vi.fn(),
      waitForState: vi.fn(),
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

function openClawLaunchConfig(overrides: Record<string, unknown> = {}) {
  return {
    config: {},
    image: "ghcr.io/hypercli/hypercli-openclaw:prod",
    env: {},
    secrets: { OPENCLAW_GATEWAY_TOKEN: "gw-token" },
    routes: { openclaw: { port: 18789, auth: false, prefix: "" } },
    command: [],
    entrypoint: [],
    restart: false,
    sync_root: "/home/node",
    sync_uid: null,
    sync_gid: null,
    registry_url: null,
    registry_auth: {},
    runtime_scopes: ["models:*"],
    ...overrides,
  };
}

function redactedOpenClawLaunchConfig(overrides: Record<string, unknown> = {}) {
  const launchConfig = openClawLaunchConfig(overrides);
  delete (launchConfig as Record<string, unknown>).secrets;
  delete (launchConfig as Record<string, unknown>).registry_auth;
  return launchConfig;
}

function redactedHermesLaunchConfig(overrides: Record<string, unknown> = {}) {
  return redactedOpenClawLaunchConfig({
    image: "ghcr.io/hypercli/hypercli-hermes-agent:latest",
    routes: { hermes: { port: 8642, auth: false, prefix: "" } },
    sync_root: "/home/hermes",
    sync_exclude: ["shared/**"],
    sync_uid: 10000,
    sync_gid: 10000,
    ...overrides,
  });
}

describe("agent-client", () => {
  it("classifies stale lifecycle conflicts without treating service failures as stale state", () => {
    expect(isAgentLifecycleStateConflictError({
      statusCode: 409,
      detail: "Agent storage must finish explicit restore before start",
    })).toBe(true);
    expect(isAgentLifecycleStateConflictError({
      statusCode: 503,
      detail: "Lagoon unavailable: Agent has no active Lagoon control socket",
    })).toBe(false);
    expect(isAgentLifecycleStateConflictError({
      statusCode: 409,
      detail: "Agent is cleaning up",
    })).toBe(true);
  });

  it("does not post start when its authoritative preflight is archived", async () => {
    const observed = vi.fn();
    deploymentsInstance.get.mockResolvedValue({
      id: "agent-123",
      state: "ARCHIVED",
      runtime: "openclaw",
    });

    await expect(requestAgentStart("hyper_api_test", "agent-123", undefined, observed)).rejects.toThrow(
      "Agent is archived. Restore it before starting.",
    );

    expect(observed).toHaveBeenCalledWith(expect.objectContaining({ state: "ARCHIVED" }));
    expect(deploymentsInstance.start).not.toHaveBeenCalled();
    expect(deploymentsInstance.setEnv).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ORIGIN_LOCK;
    delete process.env.NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS;
    deploymentsInstance.get.mockReset();
    deploymentsInstance.get.mockResolvedValue({
      id: "agent-123",
      state: "RUNNING",
      runtime: "openclaw",
    });
    deploymentsInstance.createOpenClaw.mockReset();
    deploymentsInstance.createOpenClawPro.mockReset();
    deploymentsInstance.createHermesAgent.mockReset();
    deploymentsInstance.archive.mockReset();
    deploymentsInstance.delete.mockReset();
    deploymentsInstance.list.mockReset();
    deploymentsInstance.setEnv.mockReset();
    deploymentsInstance.start.mockReset();
    deploymentsInstance.startOpenClaw.mockReset();
    deploymentsInstance.startHermesAgent.mockReset();
    deploymentsInstance.restore.mockReset();
    deploymentsInstance.stop.mockReset();
    deploymentsInstance.waitForState.mockReset();
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

  it("waits for CREATE admission to reach authoritative STOPPED", async () => {
    const stopped = { id: "agent-123", state: "STOPPED", launchEpoch: 4 };
    deploymentsInstance.waitForState.mockResolvedValue(stopped);

    await expect(waitForCreatedAgentStopped(deploymentsInstance as never, {
      id: "agent-123",
      launchEpoch: 4,
    })).resolves.toBe(stopped);

    expect(deploymentsInstance.waitForState).toHaveBeenCalledWith(
      "agent-123",
      ["STOPPED"],
      300_000,
      ["FAILED", "DELETED"],
      4,
    );
  });

  it("starts from the backend-stored launch contract and fences readiness to the accepted snapshot", async () => {
    const running = { id: "agent-123", state: "RUNNING", launchEpoch: 7 };
    const accepted = {
      id: "agent-123",
      state: "STARTING",
      launchEpoch: 7,
      waitRunning: vi.fn().mockResolvedValue(running),
    };
    const onAccepted = vi.fn();
    deploymentsInstance.startOpenClaw.mockResolvedValue(accepted);
    deploymentsInstance.get.mockResolvedValue({
      id: "agent-123",
      state: "STOPPED",
      runtime: "openclaw",
      launchConfig: redactedOpenClawLaunchConfig({ routes: {} }),
    });

    await expect(startAgent("hyper_api_test", "agent-123", onAccepted)).resolves.toBe(running);

    expect(deploymentsInstance.start).not.toHaveBeenCalled();
    expect(deploymentsInstance.setEnv).not.toHaveBeenCalled();
    expect(deploymentsInstance.startOpenClaw).toHaveBeenCalledWith(
      "agent-123",
      {
        launchConfig: expect.objectContaining({
          env: { OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: window.location.origin },
          routes: {},
        }),
      },
    );
    const submitted = deploymentsInstance.startOpenClaw.mock.calls[0]?.[1]?.launchConfig as Record<string, unknown>;
    expect(submitted).not.toHaveProperty("secrets");
    expect(submitted).not.toHaveProperty("registry_auth");
    expect(onAccepted).toHaveBeenCalledWith(accepted);
    expect(accepted.waitRunning).toHaveBeenCalledWith(300_000);
  });

  it("does not start when the stopped OpenClaw launch config is incomplete", async () => {
    deploymentsInstance.get.mockResolvedValue({
      id: "agent-123",
      state: "STOPPED",
      runtime: "openclaw-pro",
      launchConfig: { env: {} },
    });

    await expect(requestAgentStart("hyper_api_test", "agent-123")).rejects.toThrow(
      "OpenClaw start requires a complete launch configuration",
    );

    expect(deploymentsInstance.setEnv).not.toHaveBeenCalled();
    expect(deploymentsInstance.start).not.toHaveBeenCalled();
    expect(deploymentsInstance.startOpenClaw).not.toHaveBeenCalled();
  });

  it("passes the launch environment on start whatever runtime the agent reports", async () => {
    const accepted = { id: "agent-123", state: "RUNNING", launchEpoch: 8 };
    deploymentsInstance.get.mockResolvedValue({
      id: "agent-123",
      state: "STOPPED",
      runtime: "claude-code",
      launchConfig: redactedOpenClawLaunchConfig(),
    });
    deploymentsInstance.startOpenClaw.mockResolvedValue(accepted);

    await expect(requestAgentStart("hyper_api_test", "agent-123")).resolves.toBe(accepted);

    expect(deploymentsInstance.setEnv).not.toHaveBeenCalled();
    expect(deploymentsInstance.start).not.toHaveBeenCalled();
    expect(deploymentsInstance.startOpenClaw).toHaveBeenCalledWith(
      "agent-123",
      {
        launchConfig: expect.objectContaining({
          env: { OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: window.location.origin },
        }),
      },
    );
  });

  // Regression: managed deployments carry the Agent.runtime column default of
  // "generic", so a runtime allowlist on this injection meant no managed agent
  // ever had its origin refreshed and every agent stayed pinned to whichever
  // dashboard created it.
  it("patches the launch environment for a managed agent whose runtime is generic", async () => {
    const accepted = { id: "agent-123", state: "RUNNING", launchEpoch: 8 };
    deploymentsInstance.get.mockResolvedValue({
      id: "agent-123",
      state: "STOPPED",
      runtime: "generic",
      launchConfig: redactedOpenClawLaunchConfig(),
    });
    deploymentsInstance.startOpenClaw.mockResolvedValue(accepted);

    await expect(requestAgentStart("hyper_api_test", "agent-123")).resolves.toBe(accepted);

    expect(deploymentsInstance.setEnv).not.toHaveBeenCalled();
    expect(deploymentsInstance.startOpenClaw).toHaveBeenCalledWith(
      "agent-123",
      {
        launchConfig: expect.objectContaining({
          env: { OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: window.location.origin },
        }),
      },
    );
  });

  it("patches the launch environment on start when the agent reports no runtime at all", async () => {
    const accepted = { id: "agent-123", state: "RUNNING", launchEpoch: 8 };
    deploymentsInstance.get.mockResolvedValue({
      id: "agent-123",
      state: "STOPPED",
      launchConfig: redactedOpenClawLaunchConfig(),
    });
    deploymentsInstance.startOpenClaw.mockResolvedValue(accepted);

    await expect(requestAgentStart("hyper_api_test", "agent-123")).resolves.toBe(accepted);

    expect(deploymentsInstance.setEnv).not.toHaveBeenCalled();
    expect(deploymentsInstance.startOpenClaw).toHaveBeenCalledWith(
      "agent-123",
      {
        launchConfig: expect.objectContaining({
          env: { OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: window.location.origin },
        }),
      },
    );
  });

  it("creates hermes agents through the hermes deployment helper", async () => {
    const created = { id: "agent-hermes", state: "CREATING", runtime: "hermes-agent" };
    deploymentsInstance.createHermesAgent.mockResolvedValue(created);

    await expect(createHermesAgentDeployment("hyper_api_test", {
      name: "Hermes",
      size: "small",
      meta: { ui: { avatar: { icon_index: 3 } } },
    })).resolves.toBe(created);

    expect(deploymentsInstance.createHermesAgent).toHaveBeenCalledWith({
      name: "Hermes",
      size: "small",
      meta: { ui: { avatar: { icon_index: 3 } } },
      corsOrigins: [window.location.origin],
    });
    expect(deploymentsInstance.createOpenClaw).not.toHaveBeenCalled();
    expect(deploymentsInstance.createOpenClawPro).not.toHaveBeenCalled();
  });

  it("passes hermes CORS through corsOrigins without constructing env", async () => {
    const created = { id: "agent-hermes", state: "CREATING", runtime: "hermes-agent" };
    deploymentsInstance.createHermesAgent.mockResolvedValue(created);
    process.env.NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS = "https://control.hypercli.com";

    await expect(createHermesAgentDeployment("hyper_api_test", {
      name: "Hermes",
      env: {
        API_SERVER_CORS_ORIGINS: "https://legacy.hypercli.com",
        FOO: "bar",
      },
      corsOrigins: ["https://custom.hypercli.com"],
    })).resolves.toBe(created);

    expect(deploymentsInstance.createHermesAgent).toHaveBeenCalledWith({
      name: "Hermes",
      env: {
        API_SERVER_CORS_ORIGINS: "https://legacy.hypercli.com",
        FOO: "bar",
      },
      corsOrigins: [
        "https://legacy.hypercli.com",
        "https://custom.hypercli.com",
        "https://control.hypercli.com",
        window.location.origin,
      ],
    });
  });

  it("starts a hermes agent from its stored launch config without the OpenClaw origin env", async () => {
    const accepted = { id: "agent-hermes", state: "STARTING", runtime: "hermes-agent", launchEpoch: 9 };
    deploymentsInstance.get.mockResolvedValue({
      id: "agent-hermes",
      state: "STOPPED",
      runtime: "hermes-agent",
      launchConfig: redactedHermesLaunchConfig(),
    });
    deploymentsInstance.startHermesAgent.mockResolvedValue(accepted);

    await expect(requestAgentStart("hyper_api_test", "agent-hermes")).resolves.toBe(accepted);

    expect(deploymentsInstance.startOpenClaw).not.toHaveBeenCalled();
    expect(deploymentsInstance.startHermesAgent).toHaveBeenCalledWith(
      "agent-hermes",
      {
        launchConfig: expect.objectContaining({
          image: "ghcr.io/hypercli/hypercli-hermes-agent:latest",
          routes: { hermes: { port: 8642, auth: false, prefix: "" } },
          sync_root: "/home/hermes",
          sync_exclude: ["shared/**"],
          env: { API_SERVER_CORS_ORIGINS: window.location.origin },
          cors: { allowed_origins: [window.location.origin] },
        }),
      },
    );
    const submitted = deploymentsInstance.startHermesAgent.mock.calls[0]?.[1]?.launchConfig as Record<string, unknown>;
    expect(submitted).not.toHaveProperty("secrets");
    expect(submitted).not.toHaveProperty("registry_auth");
    expect(submitted.env).not.toHaveProperty("OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN");
  });

  it("does not start a hermes agent when the stored launch config is incomplete", async () => {
    deploymentsInstance.get.mockResolvedValue({
      id: "agent-hermes",
      state: "STOPPED",
      runtime: "hermes-agent",
      launchConfig: { env: {} },
    });

    await expect(requestAgentStart("hyper_api_test", "agent-hermes")).rejects.toThrow(
      "Hermes start requires a complete launch configuration",
    );

    expect(deploymentsInstance.startHermesAgent).not.toHaveBeenCalled();
    expect(deploymentsInstance.startOpenClaw).not.toHaveBeenCalled();
  });

  it("repairs a missing hermes image from the configured default on start", async () => {    process.env.NEXT_PUBLIC_HERMES_AGENT_IMAGE = "ghcr.io/hypercli/hypercli-hermes-agent:prod";
    const accepted = { id: "agent-hermes", state: "STARTING", runtime: "hermes-agent", launchEpoch: 10 };
    deploymentsInstance.get.mockResolvedValue({
      id: "agent-hermes",
      state: "STOPPED",
      runtime: "hermes-agent",
      launchConfig: redactedHermesLaunchConfig({ image: null }),
    });
    deploymentsInstance.startHermesAgent.mockResolvedValue(accepted);

    await expect(requestAgentStart("hyper_api_test", "agent-hermes")).resolves.toBe(accepted);

    expect(deploymentsInstance.startHermesAgent).toHaveBeenCalledWith(
      "agent-hermes",
      {
        launchConfig: expect.objectContaining({
          image: "ghcr.io/hypercli/hypercli-hermes-agent:prod",
        }),
      },
    );
    delete process.env.NEXT_PUBLIC_HERMES_AGENT_IMAGE;
  });

  it("returns an already-running accepted start without opening another wait", async () => {
    const accepted = { id: "agent-123", state: "RUNNING", launchEpoch: 8, waitRunning: vi.fn() };
    deploymentsInstance.get.mockResolvedValue({
      id: "agent-123",
      state: "STOPPED",
      runtime: "claude-code",
      launchConfig: redactedOpenClawLaunchConfig(),
    });
    deploymentsInstance.startOpenClaw.mockResolvedValue(accepted);

    await expect(startAgent("hyper_api_test", "agent-123")).resolves.toBe(accepted);
    expect(accepted.waitRunning).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous start timeout when the agent is already running", async () => {
    const timeout = new Error("Request timed out after 30 seconds");
    timeout.name = "TimeoutError";
    const running = { id: "agent-123", state: "RUNNING", launchEpoch: 8, waitRunning: vi.fn() };
    const onAccepted = vi.fn();
    deploymentsInstance.startOpenClaw.mockRejectedValue(timeout);
    deploymentsInstance.get
      .mockResolvedValueOnce({
        id: "agent-123",
        state: "STOPPED",
        runtime: "claude-code",
        launchConfig: redactedOpenClawLaunchConfig(),
      })
      .mockResolvedValue(running);

    await expect(startAgent("hyper_api_test", "agent-123", onAccepted)).resolves.toBe(running);

    expect(deploymentsInstance.get).toHaveBeenCalledWith("agent-123", {
      retries: 1,
      timeout: 2_000,
    });
    expect(onAccepted).toHaveBeenCalledWith(running);
    expect(running.waitRunning).not.toHaveBeenCalled();
  });

  it("does not accept stale stopped state after an ambiguous start timeout", async () => {
    vi.useFakeTimers();
    const timeout = new Error("Request timed out after 30 seconds");
    timeout.name = "TimeoutError";
    const stopped = {
      id: "agent-123",
      state: "STOPPED",
      launchEpoch: 8,
      launchConfig: redactedOpenClawLaunchConfig(),
    };
    const onAccepted = vi.fn();
    deploymentsInstance.startOpenClaw.mockRejectedValue(timeout);
    deploymentsInstance.get.mockResolvedValue(stopped);

    const result = expect(requestAgentStart("hyper_api_test", "agent-123", onAccepted)).rejects.toThrow(
      "The start request timed out before launch was confirmed. Check the agent status and try again.",
    );
    await vi.runAllTimersAsync();
    await result;

    expect(deploymentsInstance.get).toHaveBeenCalledTimes(5);
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("can release the mutation queue after the accepted start snapshot", async () => {
    const accepted = { id: "agent-123", state: "STARTING", launchEpoch: 8, waitRunning: vi.fn() };
    deploymentsInstance.get.mockResolvedValue({
      id: "agent-123",
      state: "STOPPED",
      runtime: "claude-code",
      launchConfig: redactedOpenClawLaunchConfig(),
    });
    deploymentsInstance.startOpenClaw.mockResolvedValue(accepted);

    await expect(requestAgentStart("hyper_api_test", "agent-123")).resolves.toBe(accepted);
    expect(accepted.waitRunning).not.toHaveBeenCalled();

    accepted.waitRunning.mockResolvedValue({ ...accepted, state: "RUNNING" });
    await expect(waitForAgentRunning(accepted as never)).resolves.toMatchObject({ state: "RUNNING" });
  });

  it("waits for canonical STOPPED after applying the accepted stop snapshot", async () => {
    const accepted = { id: "agent-123", state: "STOPPING", launchEpoch: 9 };
    const stopped = { id: "agent-123", state: "STOPPED", launchEpoch: 9 };
    const onAccepted = vi.fn();
    deploymentsInstance.stop.mockResolvedValue(accepted);
    deploymentsInstance.waitForState.mockResolvedValue(stopped);

    await expect(stopAgent("hyper_api_test", "agent-123", onAccepted)).resolves.toBe(stopped);

    expect(onAccepted).toHaveBeenCalledWith(accepted);
    expect(deploymentsInstance.waitForState).toHaveBeenCalledWith(
      "agent-123",
      ["STOPPED", "ARCHIVING", "ARCHIVED"],
      300_000,
      ["FAILED", "DELETED"],
      9,
    );
  });

  it("accepts archival progress when the stopped snapshot was missed", async () => {
    const accepted = { id: "agent-123", state: "STOPPING", launchEpoch: 9 };
    const archived = { id: "agent-123", state: "ARCHIVED", launchEpoch: 9 };
    deploymentsInstance.stop.mockResolvedValue(accepted);
    deploymentsInstance.waitForState.mockResolvedValue(archived);

    await expect(stopAgent("hyper_api_test", "agent-123")).resolves.toBe(archived);
    expect(deploymentsInstance.waitForState).toHaveBeenCalledWith(
      "agent-123",
      ["STOPPED", "ARCHIVING", "ARCHIVED"],
      300_000,
      ["FAILED", "DELETED"],
      9,
    );
  });

  it("archives a stopped agent and waits for the verified archive", async () => {
    const accepted = { id: "agent-123", state: "ARCHIVING", launchEpoch: 9 };
    const archived = { id: "agent-123", state: "ARCHIVED", launchEpoch: 9 };
    const onAccepted = vi.fn();
    deploymentsInstance.archive.mockResolvedValue(accepted);
    deploymentsInstance.waitForState.mockResolvedValue(archived);

    await expect(archiveAgent("hyper_api_test", "agent-123", onAccepted)).resolves.toBe(archived);

    expect(deploymentsInstance.archive).toHaveBeenCalledWith("agent-123");
    expect(onAccepted).toHaveBeenCalledWith(accepted);
    expect(deploymentsInstance.waitForState).toHaveBeenCalledWith(
      "agent-123",
      ["ARCHIVED"],
      300_000,
      ["FAILED", "DELETED"],
      9,
    );
  });

  it("restores an archived agent to stopped without starting compute", async () => {
    const accepted = { id: "agent-123", state: "RESTORING", launchEpoch: 9 };
    const stopped = { id: "agent-123", state: "STOPPED", launchEpoch: 9 };
    const onAccepted = vi.fn();
    deploymentsInstance.restore.mockResolvedValue(accepted);
    deploymentsInstance.waitForState.mockResolvedValue(stopped);

    await expect(restoreAgent("hyper_api_test", "agent-123", onAccepted)).resolves.toBe(stopped);

    expect(deploymentsInstance.restore).toHaveBeenCalledWith("agent-123");
    expect(deploymentsInstance.start).not.toHaveBeenCalled();
    expect(onAccepted).toHaveBeenCalledWith(accepted);
    expect(deploymentsInstance.waitForState).toHaveBeenCalledWith(
      "agent-123",
      ["STOPPED"],
      300_000,
      ["FAILED", "DELETED"],
      9,
    );
  });

  it("reconciles an ambiguous stop timeout before reporting an error", async () => {
    const timeout = new Error("signal is aborted without reason");
    timeout.name = "AbortError";
    const accepted = { id: "agent-123", state: "STOPPING", launchEpoch: 9 };
    const stopped = { id: "agent-123", state: "STOPPED", launchEpoch: 9 };
    const onAccepted = vi.fn();
    deploymentsInstance.stop.mockRejectedValue(timeout);
    deploymentsInstance.get.mockResolvedValue(accepted);
    deploymentsInstance.waitForState.mockResolvedValue(stopped);

    await expect(stopAgent("hyper_api_test", "agent-123", onAccepted)).resolves.toBe(stopped);

    expect(deploymentsInstance.get).toHaveBeenCalledWith("agent-123", {
      retries: 1,
      timeout: 2_000,
    });
    expect(onAccepted).toHaveBeenCalledWith(accepted);
    expect(deploymentsInstance.waitForState).toHaveBeenCalledWith(
      "agent-123",
      ["STOPPED", "ARCHIVING", "ARCHIVED"],
      300_000,
      ["FAILED", "DELETED"],
      9,
    );
  });

  it("reports an unconfirmed stop timeout with product-facing guidance", async () => {
    vi.useFakeTimers();
    const timeout = new Error("Request timed out after 30 seconds");
    timeout.name = "TimeoutError";
    deploymentsInstance.stop.mockRejectedValue(timeout);
    deploymentsInstance.get.mockResolvedValue({ id: "agent-123", state: "RUNNING", launchEpoch: 9 });

    const result = expect(stopAgent("hyper_api_test", "agent-123")).rejects.toThrow(
      "The stop request timed out before shutdown was confirmed. Check the agent status and try again.",
    );
    await vi.runAllTimersAsync();
    await result;

    expect(deploymentsInstance.get).toHaveBeenCalledTimes(4);
    expect(deploymentsInstance.waitForState).not.toHaveBeenCalled();
  });

  it("allows delayed STOPPING visibility after an ambiguous timeout", async () => {
    vi.useFakeTimers();
    const timeout = new Error("Request timed out after 30 seconds");
    timeout.name = "TimeoutError";
    const running = { id: "agent-123", state: "RUNNING", launchEpoch: 9 };
    const accepted = { id: "agent-123", state: "STOPPING", launchEpoch: 9 };
    const stopped = { id: "agent-123", state: "STOPPED", launchEpoch: 9 };
    deploymentsInstance.stop.mockRejectedValue(timeout);
    deploymentsInstance.get.mockResolvedValueOnce(running).mockResolvedValueOnce(accepted);
    deploymentsInstance.waitForState.mockResolvedValue(stopped);

    const result = expect(stopAgent("hyper_api_test", "agent-123")).resolves.toBe(stopped);
    await vi.runAllTimersAsync();
    await result;

    expect(deploymentsInstance.get).toHaveBeenCalledTimes(2);
  });

  it("does not reinterpret a definitive API error as a transport timeout", async () => {
    const apiError = Object.assign(new Error("Execution timeout must be positive"), { statusCode: 400 });
    deploymentsInstance.stop.mockRejectedValue(apiError);

    await expect(stopAgent("hyper_api_test", "agent-123")).rejects.toBe(apiError);

    expect(deploymentsInstance.get).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous gateway timeout response", async () => {
    const gatewayTimeout = Object.assign(new Error("Agent stop admission timed out"), { statusCode: 504 });
    const stopped = { id: "agent-123", state: "STOPPED", launchEpoch: 9 };
    deploymentsInstance.stop.mockRejectedValue(gatewayTimeout);
    deploymentsInstance.get.mockResolvedValue(stopped);

    await expect(stopAgent("hyper_api_test", "agent-123")).resolves.toBe(stopped);

    expect(deploymentsInstance.get).toHaveBeenCalledTimes(1);
  });

  it("preserves a failed reconciliation read", async () => {
    vi.useFakeTimers();
    const timeout = new Error("Request timed out after 30 seconds");
    timeout.name = "TimeoutError";
    const readError = new Error("Agent status is unavailable");
    deploymentsInstance.stop.mockRejectedValue(timeout);
    deploymentsInstance.get.mockRejectedValue(readError);

    const result = expect(stopAgent("hyper_api_test", "agent-123")).rejects.toBe(readError);
    await vi.runAllTimersAsync();
    await result;

    expect(deploymentsInstance.get).toHaveBeenCalledTimes(4);
  });

  it("deletes only an authoritative stopped agent", async () => {
    deploymentsInstance.get.mockResolvedValue({ id: "agent-123", state: "STOPPED" });
    deploymentsInstance.delete.mockResolvedValue({ ok: true, id: "agent-123" });

    await expect(deleteStoppedAgent("hyper_api_test", "agent-123")).resolves.toEqual({ ok: true, id: "agent-123" });
    expect(deploymentsInstance.delete).toHaveBeenCalledWith("agent-123");

    deploymentsInstance.get.mockResolvedValue({ id: "agent-123", state: "STOPPING" });
    await expect(deleteStoppedAgent("hyper_api_test", "agent-123")).rejects.toThrow("wait for cleanup");
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
    // The dashboard states the intent and the SDK owns the launch contract:
    // it builds the complete HYPER_SLACK_* set, including the gateway id it can
    // only know once the Backend has assigned the Agent id. A hand-built env
    // here is what shipped an Agent whose pod died at boot.
    expect(deploymentsInstance.createOpenClaw).toHaveBeenCalledWith(expect.objectContaining({
      env: { FOO: "bar" },
      slack: { relayBaseUrl: "https://api.hypercli.com" },
      config: {
        channels: {
          slack: {
            groupPolicy: "open",
            replyToMode: "all",
            replyToModeByChatType: { direct: "off" },
          },
        },
      },
    }));
    const slackCreateOptions = deploymentsInstance.createOpenClaw.mock.calls[0]?.[0] ?? {};
    for (const key of Object.keys(slackCreateOptions.env ?? {})) {
      expect(key.startsWith("HYPER_SLACK_")).toBe(false);
    }
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

  it("reconciles an ambiguous create timeout by its locally persisted name", async () => {
    vi.useFakeTimers();
    const timeout = new Error("Request timed out after 30 seconds");
    timeout.name = "TimeoutError";
    const recoveredAgent = {
      id: "agent-recovered",
      name: "clear-window-works",
      createdAt: new Date("2026-07-18T19:08:15.000Z"),
    };
    deploymentsInstance.createOpenClaw.mockRejectedValue(timeout);
    deploymentsInstance.list.mockResolvedValue([
      {
        id: "agent-unrelated",
        name: "another-agent",
        createdAt: new Date("2026-07-18T19:09:15.000Z"),
      },
      recoveredAgent,
    ]);

    const result = createOpenClawAgent("hyper_api_test", {
      name: "clear-window-works",
    });
    await vi.advanceTimersByTimeAsync(750);

    await expect(result).resolves.toBe(recoveredAgent);
    expect(deploymentsInstance.createOpenClaw).toHaveBeenCalledTimes(1);
    expect(deploymentsInstance.list).toHaveBeenCalledTimes(1);
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
