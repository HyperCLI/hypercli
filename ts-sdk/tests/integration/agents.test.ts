import { createIntegrationClient, agentsIt } from "./helpers.js";

describe("TS SDK integration: agents", () => {
  if (!process.env.TEST_AGENT_API_KEY) {
    it.skip(
      "requires TEST_AGENT_API_KEY because the deployments and agent APIs do not accept the account-level TEST_API_KEY",
      () => {},
    );
    return;
  }

  agentsIt("lists agents when an agent-scoped key is available", async () => {
    const client = createIntegrationClient();
    const result = await client.deployments.list();

    expect(Array.isArray(result.items)).toBe(true);
  });
});
