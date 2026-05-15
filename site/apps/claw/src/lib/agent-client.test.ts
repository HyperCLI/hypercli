import { describe, expect, it, vi } from "vitest";

import { createHyperAgentClient } from "./agent-client";

const { hyperCliConstructor } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.hypercli.com";
  return {
    hyperCliConstructor: vi.fn(),
  };
});

vi.mock("@hypercli.com/sdk/browser", () => ({
  BrowserHyperCLI: vi.fn(function BrowserHyperCLIMock(options) {
    hyperCliConstructor(options);
    return { agent: { marker: "agent-client" } };
  }),
}));

vi.mock("@hypercli.com/sdk/agent", () => ({}));
vi.mock("@hypercli.com/sdk/agents", () => ({
  Deployments: vi.fn(),
}));
vi.mock("@hypercli.com/sdk/http", () => ({
  HTTPClient: vi.fn(),
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
  it("constructs HyperAgent through the browser-safe SDK client", () => {
    const agent = createHyperAgentClient("hyper_api_test");

    expect(agent).toEqual({ marker: "agent-client" });
    expect(hyperCliConstructor).toHaveBeenCalledWith({
      token: "hyper_api_test",
      agentApiKey: "hyper_api_test",
      apiUrl: "https://api.hypercli.com",
    });
  });
});
