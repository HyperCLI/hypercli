/**
 * Dev proxy shape: pass-through under /api only.
 *
 * In dev the webview asks for `http://localhost:1420/api/agents/...` and the
 * proxy strips `/api` and forwards upstream. This test imports the real
 * vite.config.ts and asserts that mapping, so the config cannot drift back to
 * bare-prefix proxying (devtools would no longer show what is proxied) or
 * grow dev-only logic (see AGENTS.md rule 10: proxying is fine, answering is
 * not).
 */
import { describe, expect, it } from "vitest";
import { DEV_PROXY_PREFIX, PROXY_PREFIXES } from "./src/lib/endpoints";
import config from "./vite.config";

type ProxyEntry = {
  target: string;
  changeOrigin?: boolean;
  rewrite?: (path: string) => string;
  configure?: (server: { on: (event: string, fn: (req: unknown) => void) => void }) => void;
};

async function loadProxy(): Promise<Record<string, ProxyEntry>> {
  const resolved = typeof config === "function" ? await config({ command: "serve", mode: "development" }) : config;
  return (resolved.server?.proxy ?? {}) as Record<string, ProxyEntry>;
}

describe("vite dev proxy", () => {
  it("proxies exactly the PROXY_PREFIXES under /api", async () => {
    const proxy = await loadProxy();
    expect(Object.keys(proxy)).toEqual(PROXY_PREFIXES.map((p) => `${DEV_PROXY_PREFIX}${p}`));
  });

  it("forwards to the gateway by default and rewrites /api away", async () => {
    const proxy = await loadProxy();
    for (const [mount, entry] of Object.entries(proxy)) {
      expect(entry.target).toBe("https://api.hypercli.com");
      expect(entry.changeOrigin).toBe(true);
      expect(entry.rewrite?.(`${mount}/deployments?limit=1`)).toBe(
        `${mount.slice(DEV_PROXY_PREFIX.length)}/deployments?limit=1`,
      );
    }
  });

  it("presents the upstream origin on forwarded requests", async () => {
    const proxy = await loadProxy();
    const handlers = new Map<string, (req: unknown) => void>();
    proxy[`${DEV_PROXY_PREFIX}/agents`].configure?.({
      on: (event, fn) => void handlers.set(event, fn),
    });
    const headers = new Map<string, string>();
    handlers.get("proxyReq")?.({ setHeader: (k: string, v: string) => headers.set(k, v) });
    expect(headers.get("origin")).toBe("https://api.hypercli.com");
  });
});
