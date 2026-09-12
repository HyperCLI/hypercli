import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentDesktopFileToken, agentDesktopUrl, resetSdkClient, setAgentDesktopEnabled } from "./api";

const fetchCalls = vi.hoisted(() => ({ fn: vi.fn() }));

const deployments = vi.hoisted(() => ({
  desktopUrl: vi.fn(),
  setEnv: vi.fn(),
  setRoute: vi.fn(),
  removeRoute: vi.fn(),
  get: vi.fn(),
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

const fileTokenResponse = {
  url: "https://agent-1.hypercli.app/_reef",
  token: "file-token-abc",
  expires_at: "2026-09-12T10:00:00Z",
};
const fileTokenExpiresEpoch = Math.floor(Date.parse(fileTokenResponse.expires_at) / 1000);

function okFileTokenResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ...fileTokenResponse, ...overrides }), { status: 201 });
}

beforeEach(() => {
  resetSdkClient();
  fetchCalls.fn.mockReset();
  vi.stubGlobal("fetch", fetchCalls.fn);
  deployments.desktopUrl.mockReset();
  deployments.desktopUrl.mockResolvedValue({
    url: "https://desktop-agent-1.hypercli.app/_jwt_auth?jwt=jwt-xyz&redirect=vnc_lite.html",
    expiresAt: new Date("2026-09-12T11:00:00Z"),
  });
  deployments.setEnv.mockReset();
  deployments.setRoute.mockReset();
  deployments.removeRoute.mockReset();
  deployments.get.mockReset();
  deployments.get.mockResolvedValue({
    id: "agent-1",
    name: "claw",
    runtime: "openclaw",
    state: "STOPPED",
    launchEpoch: 1,
    launchConfig: { env: { FOO: "1" } },
  });
});

describe("agentDesktopFileToken", () => {
  it("mints via the gateway deployment files endpoint and normalizes expiry to epoch seconds", async () => {
    fetchCalls.fn.mockResolvedValue(okFileTokenResponse());

    const result = await agentDesktopFileToken("agent-1");

    expect(result).toEqual({
      url: "https://agent-1.hypercli.app/_reef",
      token: "file-token-abc",
      expires_at: fileTokenExpiresEpoch,
    });
    const [url, init] = fetchCalls.fn.mock.calls[0];
    expect(String(url)).toContain("/deployments/agent-1/files/token");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");
  });

  it("rejects malformed payloads instead of fabricating upload credentials", async () => {
    const bad = [
      {},
      { ...fileTokenResponse, token: "" },
      { ...fileTokenResponse, expires_at: "not-a-date" },
      { ...fileTokenResponse, url: "javascript:alert(1)" },
      { ...fileTokenResponse, url: "https://agent-1.hypercli.app/other-path" },
      { ...fileTokenResponse, url: "https://user:pw@agent-1.hypercli.app/_reef" },
    ];
    for (const payload of bad) {
      fetchCalls.fn.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 201 }));
      await expect(agentDesktopFileToken("agent-1")).rejects.toThrow("invalid agent file token");
    }
  });
});

describe("agentDesktopUrl", () => {
  it("targets hyper-desktop.html carrying ft/fte/rh for the minted upload token", async () => {
    fetchCalls.fn.mockResolvedValue(okFileTokenResponse());

    const result = await agentDesktopUrl("agent-1");

    expect(deployments.desktopUrl).toHaveBeenCalledTimes(1);
    const [agentId, options] = deployments.desktopUrl.mock.calls[0];
    expect(agentId).toBe("agent-1");
    expect(options.redirect).toContain("hyper-desktop.html?");
    expect(options.resize).toBeNull();
    const redirect = new URL(options.redirect, "https://desktop.local/");
    expect(redirect.searchParams.get("rh")).toBe("https://agent-1.hypercli.app/_reef");
    expect(redirect.searchParams.get("ft")).toBe("file-token-abc");
    expect(redirect.searchParams.get("fte")).toBe(String(fileTokenExpiresEpoch));
    expect(redirect.searchParams.get("scale")).toBe("true");
    expect(result.url).toContain("desktop-agent-1.hypercli.app");
  });

  it("fails rather than opening a desktop without upload credentials", async () => {
    fetchCalls.fn.mockResolvedValue(new Response(JSON.stringify({ detail: "nope" }), { status: 500 }));

    await expect(agentDesktopUrl("agent-1")).rejects.toThrow();
    expect(deployments.desktopUrl).not.toHaveBeenCalled();
  });
});

describe("setAgentDesktopEnabled", () => {
  it("enabling writes HYPER_DESKTOP_ENABLED and the desktop route, never the Chrome-owned HYPER_PROXY_HOST", async () => {
    const agent = await setAgentDesktopEnabled("agent-1", true);

    expect(deployments.setEnv.mock.calls).toEqual([["agent-1", "HYPER_DESKTOP_ENABLED", "1"]]);
    expect(deployments.setRoute).toHaveBeenCalledWith("agent-1", "desktop", { port: 3000, auth: true, prefix: "desktop" });
    expect(deployments.removeRoute).not.toHaveBeenCalled();
    expect(agent.id).toBe("agent-1");
  });

  it("disabling writes HYPER_DESKTOP_ENABLED=0 and removes the desktop route", async () => {
    await setAgentDesktopEnabled("agent-1", false);

    expect(deployments.setEnv.mock.calls).toEqual([["agent-1", "HYPER_DESKTOP_ENABLED", "0"]]);
    expect(deployments.removeRoute).toHaveBeenCalledWith("agent-1", "desktop");
    expect(deployments.setRoute).not.toHaveBeenCalled();
  });
});
