/**
 * URL derivation: dev vs packaged.
 *
 * The contract being pinned:
 *
 * - Packaged: REST goes straight to the gateway, exactly the base the
 *   credential carries. No `/api` prefix, nothing same-origin.
 * - Dev: REST goes to the dev origin with the `/api` prefix, and the Vite
 *   proxy (keyed off PROXY_PREFIXES from this module) strips that prefix and
 *   forwards. Devtools shows proxied traffic unambiguously.
 * - In both modes `apiBase` is the real upstream — WS URLs are derived from
 *   it or come back absolute from token endpoints, and are never prefixed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_PROXY_PREFIX, PROXY_PREFIXES, resolveEndpoints } from "./endpoints";

const CREDS = { api_base: "https://api.hypercli.com/agents", token: "t" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("packaged mode", () => {
  it("calls the gateway directly, with no /api prefix", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("PROD", true);
    const ends = resolveEndpoints(CREDS);
    expect(ends.httpBase).toBe("https://api.hypercli.com/agents");
    expect(ends.apiBase).toBe("https://api.hypercli.com/agents");
    expect(ends.proxied).toBe(false);
    expect(new URL(ends.httpBase).pathname.startsWith(DEV_PROXY_PREFIX)).toBe(false);
  });

  it("trims a trailing slash from the credential base", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("PROD", true);
    expect(resolveEndpoints({ ...CREDS, api_base: "https://api.hypercli.com/agents/" }).httpBase).toBe(
      "https://api.hypercli.com/agents",
    );
  });
});

describe("dev mode", () => {
  it("serves REST same-origin under /api so proxied traffic is visible", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("PROD", false);
    vi.stubGlobal("window", { location: { origin: "http://localhost:1420" } });
    const ends = resolveEndpoints(CREDS);
    expect(ends.httpBase).toBe("http://localhost:1420/api/agents");
    expect(ends.proxied).toBe(true);
    // apiBase stays the real upstream: WS URLs derive from it and must never
    // be pointed at the dev proxy.
    expect(ends.apiBase).toBe("https://api.hypercli.com/agents");
  });

  it("defaults a path-less base to /agents", () => {
    vi.stubEnv("DEV", true);
    vi.stubGlobal("window", { location: { origin: "http://localhost:1420" } });
    const ends = resolveEndpoints({ ...CREDS, api_base: "https://api.dev.hypercli.com" });
    expect(ends.httpBase).toBe("http://localhost:1420/api/agents");
  });

  it("keeps the SDK's sibling derivations on proxied prefixes", () => {
    // The SDK derives other bases by rewriting the tail of httpBase: routines
    // swaps `/agents` for `/routines`, the agent client for `/v1`. With the
    // /api prefix preserved, each must land on a prefix vite.config.ts
    // proxies — this assertion is what keeps the two files in step.
    vi.stubEnv("DEV", true);
    vi.stubGlobal("window", { location: { origin: "http://localhost:1420" } });
    const { httpBase } = resolveEndpoints(CREDS);
    const path = new URL(httpBase).pathname;
    expect(path).toBe(`${DEV_PROXY_PREFIX}/agents`);
    for (const derived of [path.replace(/\/agents$/, "/routines"), path.replace(/\/agents$/, "/v1")]) {
      const target = derived.slice(DEV_PROXY_PREFIX.length);
      expect(
        PROXY_PREFIXES.some((prefix) => target === prefix || target.startsWith(`${prefix}/`)),
        `${derived} is derived from httpBase but no proxy entry forwards it. ` +
          "Add the upstream prefix to PROXY_PREFIXES in src/lib/endpoints.ts.",
      ).toBe(true);
    }
  });
});
