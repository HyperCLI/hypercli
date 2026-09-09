/**
 * Start-path regression for the new launch contract: starting an agent must
 * send NO launch_config. The backend (routes.py / lifecycle_routes.py)
 * reconstructs the launch config from the stored projection and owns any
 * normalization (e.g. the hyper-acp -> acp command rename). A client that
 * still POSTs launch_config gets a 422 (StartAgentRequest: extra="forbid").
 *
 * Unlike api.test.ts, this file does NOT mock the SDK seam: it runs the real
 * HyperCLI/Deployments against a stubbed fetch and inspects what is POSTed
 * to /deployments/:id/start. Mocking the seam here would assert nothing about
 * the wire shape, which lives inside the SDK.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSdkClient, startAgent } from "./api";

const AGENT_ID = "11111111-2222-4333-8444-555566667777";
const BASE = "https://api.hypercli.com/agents";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("./lib/credentials", () => ({
  resolveCredentials: vi.fn(async () => ({
    api_base: BASE,
    token: "test-key",
  })),
  usingDevCredentials: vi.fn(() => false),
}));

vi.mock("./lib/endpoints", () => ({
  resolveEndpoints: () => ({
    httpBase: BASE,
    apiBase: BASE,
    proxied: false,
  }),
}));

/** Owner-facing projection for a stopped opencode agent. */
const storedProjection = {
  id: AGENT_ID,
  user_id: "user-1",
  name: "code",
  runtime: "opencode",
  state: "STOPPED",
  launch_epoch: 1,
  launch_config: {
    image: "coding-agent:latest",
    env: { HYPER_ACP_WS_URL: "wss://api.agents.hypercli.com/ws" },
    routes: {},
    command: ["/usr/local/bin/acp"],
    entrypoint: [],
    restart: false,
    sync_root: "/home/node",
    sync_exclude: [],
    sync_uid: 1000,
    sync_gid: 1000,
    registry_url: null,
    runtime_scopes: [],
  },
};

interface CapturedCall {
  url: string;
  method: string;
  body?: any;
}

const calls: CapturedCall[] = [];

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchStub = vi.fn(async (input: unknown, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  calls.push({ url, method, body });
  if (method === "GET" && url === `${BASE}/deployments/${AGENT_ID}`) return json(storedProjection);
  if (method === "POST" && url === `${BASE}/deployments/${AGENT_ID}/start`) {
    return json({ ...storedProjection, state: "STARTING" });
  }
  throw new Error(`unexpected ${method} ${url}`);
});

describe("startAgent stored-config start contract", () => {
  beforeEach(() => {
    resetSdkClient();
    calls.length = 0;
    fetchStub.mockClear();
    vi.stubGlobal("fetch", fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /start without a launch_config body", async () => {
    const started = await startAgent(AGENT_ID);
    const startCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/start"));
    expect(startCall).toBeDefined();
    // StartAgentRequest accepts only dry_run; a launch_config key would 422.
    expect(startCall!.body?.launch_config).toBeUndefined();
    expect(startCall!.body?.dry_run ?? false).toBe(false);
    expect(started.state).toBe("STARTING");
  });

  it("does not fetch /secrets at start time (backend owns reconstruction)", async () => {
    await startAgent(AGENT_ID);
    const secretsCall = calls.find((c) => c.url.endsWith("/secrets"));
    expect(secretsCall).toBeUndefined();
  });
});
