import {
  createAgentWithAvailableTier,
  createIntegrationClient,
  agentsIt,
} from "./helpers.js";
import { HyperCLI } from "../../src/client.js";
import { APIError } from "../../src/errors.js";
import {
  ClaudeCodeAgent,
  CodexAgent,
  DEFAULT_CLAUDE_CODE_IMAGE,
  DEFAULT_CODEX_IMAGE,
  DEFAULT_GOOSE_IMAGE,
  DEFAULT_KIMI_CODE_IMAGE,
  DEFAULT_OPENCODE_IMAGE,
  GooseAgent,
  KimiCodeAgent,
  OpenCodeAgent,
} from "../../src/agents.js";

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

  agentsIt.each([
    ["createOpenCode", "opencode", DEFAULT_OPENCODE_IMAGE, OpenCodeAgent],
    ["createCodex", "codex", DEFAULT_CODEX_IMAGE, CodexAgent],
    ["createClaudeCode", "claude-code", DEFAULT_CLAUDE_CODE_IMAGE, ClaudeCodeAgent],
    ["createGoose", "goose", DEFAULT_GOOSE_IMAGE, GooseAgent],
    ["createKimiCode", "kimi-code", DEFAULT_KIMI_CODE_IMAGE, KimiCodeAgent],
  ] as const)(
    "validates the %s hosted runtime through the live dry-run API",
    async (method, runtime, image, AgentClass) => {
      const client = createIntegrationClient();
      const preview = await client.deployments[method]({
        name: `ts-${runtime}-dry-${Math.random().toString(16).slice(2, 10)}`,
        start: false,
        dryRun: true,
        workspacesSync: true,
      });

      expect(preview).toBeInstanceOf(AgentClass);
      expect(preview.runtime).toBe(runtime);
      expect(preview.dryRun).toBe(true);
      expect(preview.launchConfig).toMatchObject({
        image,
        routes: {},
        sync_root: "/home/node",
        sync_uid: 1000,
        sync_gid: 1000,
        env: {
          HYPER_WORKSPACES_BOOT_SYNC: "1",
        },
      });
      expect(preview.launchConfig).not.toHaveProperty("sync_enabled");
      expect(preview.launchConfig?.env).not.toHaveProperty("OPENCLAW_GATEWAY_TOKEN");
    },
  );

  agentsIt("creates an exact-agent child key that only sees one agent", async () => {
    const client = createIntegrationClient();
    let createdA: { id: string; tier: string };
    let createdB: { id: string; tier: string };
    try {
      createdA = await createAgentWithAvailableTier(client, {
        name: `ts-scope-${Math.random().toString(16).slice(2, 10)}`,
        tags: ["team=dev", "suite=ts-integration"],
      });
      createdB = await createAgentWithAvailableTier(client, {
        name: `ts-scope-${Math.random().toString(16).slice(2, 10)}`,
        tags: ["team=ops", "suite=ts-integration"],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("No available entitlement slots")
        || message.includes("no connected clusters are advertising that tag")
      ) {
        console.warn(`Skipping exact-agent child key smoke: ${message}`);
        return;
      }
      throw error;
    }
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
