import { describe, expect, it } from "vitest";

import { HyperCLI } from "../../src/client.js";
import { APIError } from "../../src/errors.js";

export const TEST_API_KEY = process.env.TEST_API_KEY?.trim() || "";
export const TEST_API_BASE =
  process.env.TEST_API_BASE?.trim() || "https://api.hypercli.com";
export const TEST_AGENT_API_KEY = process.env.TEST_AGENT_API_KEY?.trim() || "";
export const EXPECTED_TEST_EMAIL = process.env.EXPECTED_TEST_EMAIL?.trim() || "agent@nedos.io";

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

function selectAvailableTierFromBudget(budget: Record<string, any>): string {
  const slots = (budget?.slots ?? {}) as Record<string, { available?: number }>;
  for (const tier of ["large", "medium", "small"]) {
    if ((slots[tier]?.available ?? 0) > 0) {
      return tier;
    }
  }
  throw new Error("No available entitlement slots for integration agent tests");
}

export async function createAgentWithAvailableTier(
  client: HyperCLI,
  options: {
    name: string;
    tags?: string[];
  },
): Promise<{ id: string; tier: string }> {
  const budget = await client.deployments.budget();
  const tier = selectAvailableTierFromBudget(budget);
  let agentId: string | null = null;
  try {
    const agent = await client.deployments.create({
      name: options.name,
      size: tier,
      start: false,
      tags: options.tags,
    });
    agentId = agent.id;
    await client.deployments.startOpenClaw(agent.id, { dryRun: true });
    return { id: agent.id, tier };
  } catch (error) {
    if (agentId) {
      await client.deployments.delete(agentId).catch(() => {});
    }
    if (error instanceof APIError && error.statusCode === 429) {
      throw new Error(`Budget reported '${tier}' available but dry-run start was rejected for slot exhaustion`);
    }
    throw error;
  }
}

export function expectNonEmptyString(value: unknown): void {
  expect(typeof value).toBe("string");
  expect(String(value).length).toBeGreaterThan(0);
}
