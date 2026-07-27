import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./agent-shell-terminal-runtime", () => ({}));
vi.mock("./agent-shell-webgl-runtime", () => ({}));

describe("agent shell terminal loader", () => {
  afterEach(() => {
    document.querySelectorAll('link[rel="preconnect"][href*="shell-preconnect.test"]')
      .forEach((link) => link.remove());
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    ["https://shell-preconnect.test/ws", "https://shell-preconnect.test"],
    ["wss://shell-preconnect.test/ws", "https://shell-preconnect.test"],
    ["ws://shell-preconnect.test/ws", "http://shell-preconnect.test"],
  ])("preconnects %s through %s", async (configuredUrl, expectedOrigin) => {
    vi.stubEnv("NEXT_PUBLIC_AGENTS_WS_URL", configuredUrl);
    const { preloadAgentShellTerminalRuntime } = await import("./agent-shell-terminal-loader");

    preloadAgentShellTerminalRuntime();

    const link = document.querySelector<HTMLLinkElement>(
      `link[rel="preconnect"][href="${expectedOrigin}"]`,
    );
    expect(link).not.toBeNull();
    expect(link?.crossOrigin).toBe("anonymous");
  });
});
