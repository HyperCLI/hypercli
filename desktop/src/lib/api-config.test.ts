/**
 * Configuration guards.
 *
 * The failure this suite exists to prevent: the app launching, rendering a
 * perfectly healthy-looking empty state, and never telling anyone that its
 * requests were blocked. None of the checks below need the network — they
 * assert that the *configuration* the packaged build ships with can express
 * every call the app makes.
 *
 * What this cannot cover: whether a remote host allows our origin at runtime.
 * That is a live property of the server. See AGENTS.md rule 5 for the probe.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HyperCLI } from "../../../ts-sdk/src/client.ts";
import {
  mergeControlUiAllowedOrigins,
  normalizeControlUiOrigin,
  originLockStatus,
  parseControlUiAllowedOrigins,
} from "./origin-lock";
import { APIError } from "../../../ts-sdk/src/errors.ts";
import { classifyConnectionError, httpStatusOf } from "./connection-errors";

const GATEWAY = "https://api.hypercli.com/agents";

// ---------------------------------------------------------------------------
// CSP connect-src must cover every host the app can contact.
// ---------------------------------------------------------------------------

function connectSrc(): string[] {
  const conf = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "src-tauri", "tauri.conf.json"), "utf8"),
  );
  const directive = String(conf.app.security.csp)
    .split(";")
    .map((part: string) => part.trim())
    .find((part: string) => part.startsWith("connect-src"));
  if (!directive) throw new Error("tauri.conf.json has no connect-src directive");
  return directive.split(/\s+/).slice(1);
}

/** CSP host-source matching, including the single leading `*.` wildcard. */
function permitted(url: string, sources: string[]): boolean {
  const target = new URL(url);
  return sources.some((source) => {
    if (!source.includes("://")) return false;
    const [scheme, rest] = source.split("://");
    if (`${scheme}:` !== target.protocol) return false;
    if (rest === target.host) return true;
    if (rest.startsWith("*.")) {
      const suffix = rest.slice(1); // ".hypercli.app"
      return target.host.endsWith(suffix) && target.host.length > suffix.length;
    }
    return false;
  });
}

/**
 * Every distinct egress the packaged webview performs, with the code that
 * performs it. Add a row here when you add a call to a new host — that is the
 * point of the test.
 */
const EGRESS: Array<{ what: string; url: string; via: string }> = [
  { what: "deployments / routines / plans / usage", url: `${GATEWAY}/deployments`, via: "api.ts sdk()" },
  { what: "agent inference + models", url: "https://api.agents.hypercli.com/v1/models", via: "ts-sdk agent.ts resolveHyperAgentBaseUrl" },
  { what: "agent file operations (Reef)", url: "https://example-agent.hypercli.app/_reef/list", via: "ts-sdk agents.ts fetchReef" },
  { what: "deployment events socket", url: "wss://api.agents.hypercli.com/ws/deployments", via: "ts-sdk deployments.subscribe" },
  { what: "agent logs socket", url: "wss://api.agents.hypercli.com/ws/logs/x", via: "api.ts agentLogsUrl" },
  { what: "agent shell socket", url: "wss://api.agents.hypercli.com/ws/shell/x", via: "api.ts agentShellUrl" },
  { what: "ACP bridge socket", url: "wss://api.agents.hypercli.com/ws", via: "api.ts acpConnectTarget" },
  { what: "OpenClaw runtime gateway socket", url: "wss://example-agent.hypercli.app", via: "ts-sdk OpenClawAgent.gatewayUrlFromHostname" },
  { what: "Hermes runtime API (fetch + SSE)", url: "https://example-agent.hypercli.app/v1/runs", via: "ts-sdk HermesSessionClient.streamSessionChat" },
];

describe("CSP connect-src", () => {
  const sources = connectSrc();

  it.each(EGRESS)("permits $what", ({ url, via }) => {
    expect(
      permitted(url, sources),
      `${url} is contacted by ${via} but no connect-src entry permits it. ` +
        "In the packaged build this fails as a bare 'TypeError: Failed to fetch' " +
        "with no console the user can reach. Add the host to tauri.conf.json.",
    ).toBe(true);
  });

  it("permits the Tauri IPC channel", () => {
    expect(sources).toContain("ipc:");
    expect(sources).toContain("http://ipc.localhost");
  });
});

// ---------------------------------------------------------------------------
// The SDK must honour the base URL we hand it.
// ---------------------------------------------------------------------------

describe("SDK URL derivation", () => {
  // Constructed exactly as api.ts does it, with credentials from Rust.
  const client = new HyperCLI({
    apiKey: "test-key",
    agentApiKey: "test-key",
    agentsApiBaseUrl: GATEWAY,
    apiUrl: "https://api.hypercli.com",
  });

  it("keeps deployments on the gateway", () => {
    expect(client.deployments.agentApiBase).toBe(GATEWAY);
  });

  it("keeps the agent control plane on the gateway", () => {
    expect(client.agent.controlBaseUrl).toBe(GATEWAY);
  });

  it("documents where the inference base actually points", () => {
    // resolveHyperAgentBaseUrl discards the base we passed and rewrites onto
    // the backing service. That is fine functionally - /v1 is an authenticated,
    // CORS-enabled route on both hosts and works from the packaged webview - but
    // it means the SDK, not this app, decides the host. Pinned so a future SDK
    // bump that moves it fails here rather than in a shipped build.
    expect(client.agent.baseUrl).toBe("https://api.agents.hypercli.com/v1");
  });
});

// ---------------------------------------------------------------------------
// Empty must never be indistinguishable from broken.
// ---------------------------------------------------------------------------

describe("failure is never silent", () => {
  it("classifies a blocked fetch as a configuration problem, not an outage", () => {
    const issue = classifyConnectionError(new TypeError("Failed to fetch"), {
      operation: "Load agents",
      url: `${GATEWAY}/deployments`,
    });
    expect(issue.kind).toBe("blocked");
    expect(issue.host).toBe("api.hypercli.com");
    // The user must be told which host, since the browser will not say.
    expect(issue.detail).toContain("api.hypercli.com");
  });

  it("distinguishes an expired credential from a blocked request", () => {
    const issue = classifyConnectionError(Object.assign(new Error("Unauthorized"), { status: 401 }), {
      operation: "Load agents",
      url: `${GATEWAY}/deployments`,
    });
    expect(issue.kind).toBe("auth");
    expect(issue.action?.kind).toBe("open-settings");
  });

  it("gives every issue a stable id so a reconnect loop reports once", () => {
    const context = { operation: "Load agents", url: `${GATEWAY}/deployments` };
    const first = classifyConnectionError(new TypeError("Failed to fetch"), context);
    const second = classifyConnectionError(new TypeError("Failed to fetch"), context);
    expect(first.id).toBe(second.id);
  });

  it("reads an SDK APIError status distinctly: 404 is not found, 401 is auth", () => {
    // api.ts startAgent treats only 404 as "no gateway secret yet"; any other
    // status must abort the start. That decision is only sound if the SDK's
    // APIError (which carries `statusCode`, not `status`) classifies cleanly.
    const notFound = new APIError(404, "secret OPENCLAW_GATEWAY_TOKEN not found");
    expect(httpStatusOf(notFound)).toBe(404);
    const unauthorized = new APIError(401, "invalid api key");
    expect(httpStatusOf(unauthorized)).toBe(401);
    const context = { operation: "Read agent secret", url: `${GATEWAY}/deployments/x/secrets/y` };
    expect(classifyConnectionError(unauthorized, context).kind).toBe("auth");
    expect(classifyConnectionError(notFound, context).kind).not.toBe("auth");
  });
});

// ---------------------------------------------------------------------------
// OpenClaw control-UI origin lock.
// ---------------------------------------------------------------------------

describe("control-UI origin lock", () => {
  const locked = (origin: string) => ({ env: { OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: origin } });

  it("reads the list form the shared parser accepts", () => {
    expect(parseControlUiAllowedOrigins("http://localhost:1420 http://tauri.localhost")).toEqual([
      "http://localhost:1420",
      "http://tauri.localhost",
    ]);
    expect(parseControlUiAllowedOrigins('["https://a.example","https://b.example"]')).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("rejects origins whose scheme cannot be recorded", () => {
    // Tauri serves macOS and Linux from tauri://localhost. It is in the SDK's
    // origin allowlist, recorded verbatim (URL.origin cannot represent it), so
    // a restart does authorise the packaged app on any platform.
    expect(normalizeControlUiOrigin("tauri://localhost")).toBe("tauri://localhost");
    expect(normalizeControlUiOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeControlUiOrigin("http://tauri.localhost")).toBe("http://tauri.localhost");
  });

  it("locks the packaged app out of an agent that was started from dev", () => {
    // The exact scenario observed on a live agent: started from `tauri dev`,
    // so the packaged app is refused until it is restarted.
    const status = originLockStatus(locked("http://localhost:1420"), "http://tauri.localhost");
    expect(status.locked).toBe(true);
    expect(status.authorized).toBe(false);
    expect(status.expressible).toBe(true); // so "Restart agent" is a real fix
  });

  it("authorises the app that started the agent", () => {
    expect(originLockStatus(locked("http://tauri.localhost"), "http://tauri.localhost").authorized).toBe(true);
  });

  it("accepts any origin present in a multi-origin lock", () => {
    const status = originLockStatus(
      locked("http://localhost:1420 http://tauri.localhost"),
      "http://tauri.localhost",
    );
    expect(status.authorized).toBe(true);
  });

  it("reports macOS/Linux as fixable by restart like every other shell", () => {
    // `tauri://localhost` is expressible now, so a restart authorises the
    // packaged macOS/Linux shell exactly the way it always did on Windows.
    const status = originLockStatus(locked("http://tauri.localhost"), "tauri://localhost");
    expect(status.authorized).toBe(false);
    expect(status.expressible).toBe(true);
  });

  it("treats an agent with no lock as open", () => {
    expect(originLockStatus({ env: {} }, "http://tauri.localhost").authorized).toBe(true);
    expect(originLockStatus(null, "http://tauri.localhost").authorized).toBe(true);
  });

  it("merges every origin this app can have, so starting from one place keeps the others", () => {
    // startAgent states its three origins; the SDK merges them with whatever
    // is already recorded, in first-seen order.
    expect(mergeControlUiAllowedOrigins(
      ["http://tauri.localhost", "tauri://localhost", "http://localhost:1420"],
      "https://console.hypercli.com http://tauri.localhost",
    )).toEqual([
      "http://tauri.localhost",
      "tauri://localhost",
      "http://localhost:1420",
      "https://console.hypercli.com",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The events socket must carry its credential in the URL.
// ---------------------------------------------------------------------------

// The dial is `Deployments.subscribe()` (ts-sdk agents.ts), which mints the
// events token and sets `?token=` on the returned `ws_url` itself. The app
// used to do this in lib/agent-events.ts — that module is gone, and the
// credential-in-URL coverage moved to the SDK with it.
