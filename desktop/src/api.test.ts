/**
 * `startAgent`'s OpenClaw gateway-token handling and the launch-config
 * construction both branches of START share.
 *
 * The pinned failure: the `OPENCLAW_GATEWAY_TOKEN` read used to sit in a bare
 * `catch {}`, so a transient 401/500/blocked fetch was misread as "no secret"
 * and a freshly minted token was written over a healthy one — invalidating
 * every live gateway session. Only a genuine 404 may mint.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "../../ts-sdk/src/errors.ts";
import { resetSdkClient, startAgent } from "./api";

const deployments = vi.hoisted(() => ({
  get: vi.fn(),
  secret: vi.fn(),
  setSecret: vi.fn(),
  storedLaunchConfig: vi.fn(),
  startOpenClaw: vi.fn(),
  startHermesAgent: vi.fn(),
  start: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("../../ts-sdk/src/client.ts", () => ({
  HyperCLI: class {
    deployments = deployments;
  },
}));

vi.mock("./lib/credentials", () => ({
  resolveCredentials: vi.fn(async () => ({
    api_base: "https://api.hypercli.com/agents",
    token: "test-key",
  })),
  usingDevCredentials: vi.fn(() => false),
}));

vi.mock("./lib/endpoints", () => ({
  resolveEndpoints: () => ({
    httpBase: "https://api.hypercli.com/agents",
    apiBase: "https://api.hypercli.com/agents",
    proxied: false,
  }),
}));

const openClawAgent = {
  id: "agent-1",
  name: "claw",
  runtime: "openclaw",
  state: "STOPPED",
  launchEpoch: 1,
  launchConfig: { env: { FOO: "1" } },
};

const hermesAgent = {
  id: "agent-2",
  name: "hermes",
  runtime: "hermes-agent",
  state: "STOPPED",
  launchEpoch: 3,
  launchConfig: { env: {} },
};

/** A complete START replacement config, as `storedLaunchConfig` produces. */
const storedConfig = {
  image: "openclaw:latest",
  env: { FOO: "1" },
  secrets: {},
  routes: {},
  command: [],
  entrypoint: [],
  restart: false,
  sync_root: null,
  sync_uid: null,
  sync_gid: null,
  registry_url: null,
  registry_auth: {},
  runtime_scopes: [],
};

describe("startAgent (OpenClaw) gateway token", () => {
  beforeEach(() => {
    resetSdkClient();
    vi.clearAllMocks();
    deployments.get.mockResolvedValue(openClawAgent);
    deployments.storedLaunchConfig.mockResolvedValue(structuredClone(storedConfig));
    deployments.startOpenClaw.mockResolvedValue({ ...openClawAgent, state: "STARTING" });
    deployments.setSecret.mockResolvedValue({});
  });

  it("mints and writes a token only on a genuine 404", async () => {
    deployments.secret.mockRejectedValue(new APIError(404, "secret not found"));
    await startAgent("agent-1");
    expect(deployments.setSecret).toHaveBeenCalledTimes(1);
    const [, key, minted] = deployments.setSecret.mock.calls[0];
    expect(key).toBe("OPENCLAW_GATEWAY_TOKEN");
    expect(minted).toMatch(/^[0-9a-f]{64}$/);
    // The start carries the same token it just wrote — not a second mint.
    expect(deployments.startOpenClaw).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ gatewayToken: minted }),
    );
  });

  it.each([
    ["a server error", new APIError(500, "internal")],
    ["an auth rejection", new APIError(401, "invalid api key")],
    ["a blocked fetch", new TypeError("Failed to fetch")],
  ])("aborts without touching the token when the read failed: %s", async (_why, error) => {
    deployments.secret.mockRejectedValue(error);
    await expect(startAgent("agent-1")).rejects.toThrow();
    // Above all: no fresh token may overwrite the unread, possibly healthy one.
    expect(deployments.setSecret).not.toHaveBeenCalled();
    expect(deployments.startOpenClaw).not.toHaveBeenCalled();
  });

  it("reuses the stored token without rewriting it", async () => {
    deployments.secret.mockResolvedValue({
      agent_id: "agent-1",
      key: "OPENCLAW_GATEWAY_TOKEN",
      value: "existing-token",
      launch_epoch: 1,
    });
    await startAgent("agent-1");
    expect(deployments.setSecret).not.toHaveBeenCalled();
    expect(deployments.startOpenClaw).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ gatewayToken: "existing-token" }),
    );
  });

  it("starts with the complete stored launch config, env merged not replaced", async () => {
    deployments.secret.mockResolvedValue({ value: "existing-token" });
    await startAgent("agent-1");
    const options = deployments.startOpenClaw.mock.calls[0][1];
    expect(options.launchConfig.env.FOO).toBe("1");
    expect(options.launchConfig.env.OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN).toContain("http://tauri.localhost");
    // The complete replacement keys START requires, from the typed producer.
    expect(options.launchConfig.secrets).toEqual({});
    expect(options.launchConfig.registry_auth).toEqual({});
    expect(options.launchConfig.runtime_scopes).toEqual([]);
  });
});

describe("startAgent (Hermes)", () => {
  beforeEach(() => {
    resetSdkClient();
    vi.clearAllMocks();
    deployments.get.mockResolvedValue(hermesAgent);
    deployments.storedLaunchConfig.mockResolvedValue(structuredClone(storedConfig));
    deployments.startHermesAgent.mockResolvedValue({ ...hermesAgent, state: "STARTING" });
  });

  it("hands startHermesAgent exactly what storedLaunchConfig produced", async () => {
    await startAgent("agent-2");
    expect(deployments.startHermesAgent).toHaveBeenCalledTimes(1);
    const [id, options] = deployments.startHermesAgent.mock.calls[0];
    expect(id).toBe("agent-2");
    expect(Object.keys(options)).toEqual(["launchConfig"]);
    expect(options.launchConfig).toEqual(storedConfig);
    // No gateway token is minted for Hermes.
    expect(deployments.secret).not.toHaveBeenCalled();
    expect(deployments.setSecret).not.toHaveBeenCalled();
  });
});
