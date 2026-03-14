import { describe, expect, it } from "vitest";

import { HyperCLI } from "../../src/client.js";

export const TEST_API_KEY = process.env.TEST_API_KEY?.trim() || "";
export const TEST_API_BASE =
  process.env.TEST_API_BASE?.trim() || "https://api.hypercli.com";
export const TEST_AGENT_API_KEY = process.env.TEST_AGENT_API_KEY?.trim() || "";
export const EXPECTED_TEST_EMAIL = "agent@nedos.io";

export const integrationIt = TEST_API_KEY ? it : it.skip;
export const integrationDescribe = TEST_API_KEY ? describe : describe.skip;
export const agentsIt = TEST_AGENT_API_KEY ? it : it.skip;

export function createIntegrationClient(): HyperCLI {
  if (!TEST_API_KEY) {
    throw new Error("Missing TEST_API_KEY");
  }
  return new HyperCLI({
    apiKey: TEST_API_KEY,
    apiUrl: TEST_API_BASE,
    agentApiKey: TEST_AGENT_API_KEY || undefined,
  });
}

export function expectNonEmptyString(value: unknown): void {
  expect(typeof value).toBe("string");
  expect(String(value).length).toBeGreaterThan(0);
}
