import { createAgentWithAvailableTier, createIntegrationClient, agentsIt } from "./helpers.js";
import { HyperCLI } from "../../src/client.js";
import { APIError } from "../../src/errors.js";

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

    expect(Array.isArray(result)).toBe(true);
  });

  agentsIt("creates an exact-agent child key that only sees one agent", async () => {
    const client = createIntegrationClient();
    const createdA = await createAgentWithAvailableTier(client, {
      name: `ts-scope-${Math.random().toString(16).slice(2, 10)}`,
      tags: ["team=dev", "suite=ts-integration"],
    });
    const createdB = await createAgentWithAvailableTier(client, {
      name: `ts-scope-${Math.random().toString(16).slice(2, 10)}`,
      tags: ["team=ops", "suite=ts-integration"],
    });
    const agentA = await client.deployments.get(createdA.id);
    const agentB = await client.deployments.get(createdB.id);

    try {
      const child = await client.deployments.createScopedKey(agentA.id, "ts-scoped-child");
      const scoped = new HyperCLI({
        apiKey: process.env.TEST_API_KEY,
        apiUrl: process.env.TEST_API_BASE,
        agentApiKey: child.api_key,
      });

      const visible = await scoped.deployments.list();
      const ids = new Set(visible.map((agent) => agent.id));
      expect(ids.has(agentA.id)).toBe(true);
      expect(ids.has(agentB.id)).toBe(false);

      const fetched = await scoped.deployments.get(agentA.id);
      expect(fetched.id).toBe(agentA.id);

      const dryStarted = await scoped.deployments.startOpenClaw(agentA.id, { dryRun: true });
      expect(dryStarted.id).toBe(agentA.id);
      expect(dryStarted.dryRun).toBe(true);

      const deniedGet = scoped.deployments.get(agentB.id);
      await expect(deniedGet).rejects.toBeInstanceOf(APIError);
      await expect(deniedGet).rejects.toMatchObject({ statusCode: 404 });

      const deniedCreate = scoped.deployments.create({
        name: `ts-denied-${Math.random().toString(16).slice(2, 10)}`,
        size: createdA.tier,
        start: false,
      });
      await expect(deniedCreate).rejects.toBeInstanceOf(APIError);
      await expect(deniedCreate).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      await client.deployments.delete(agentA.id);
      await client.deployments.delete(agentB.id);
    }
  });
});
