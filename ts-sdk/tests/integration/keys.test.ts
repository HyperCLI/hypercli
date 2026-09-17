import {
  TEST_API_KEY,
  createIntegrationClient,
  expectNonEmptyString,
  integrationDescribe,
  integrationIt,
} from "./helpers.js";
import { HyperCLI } from "../../src/client.js";
import { APIError } from "../../src/errors.js";

integrationDescribe("TS SDK integration: keys", () => {
  integrationIt("lists API keys and finds the active test key by suffix", async () => {
    const client = createIntegrationClient();
    const keys = await client.keys.list();
    const expectedLast4 = TEST_API_KEY.slice(-4);

    expect(keys.length).toBeGreaterThan(0);

    const matchingKey = keys.find((key) => key.last4 === expectedLast4);
    expect(matchingKey).toBeDefined();
    expectNonEmptyString(matchingKey?.keyId);
    expectNonEmptyString(matchingKey?.name);
    expect(matchingKey?.apiKey).toBeNull();
    expect(matchingKey?.apiKeyPreview).toContain("****");
    expect(matchingKey?.isActive).toBe(true);
  });

  integrationIt("creates and disables a tagged API key", async () => {
    const client = createIntegrationClient();
    const name = `ts-sdk-integration-${Math.random().toString(16).slice(2, 10)}`;

    const created = await client.keys.create(name, ["jobs:self", "team=integration"]);
    expect(created.name).toBe(name);
    expect(created.apiKey).toBeTruthy();
    expect(created.tags).toContain("jobs:self");
    expect(created.tags).toContain("team=integration");

    const listed = await client.keys.get(created.keyId);
    expect(listed.apiKey).toBeNull();
    expect(listed.tags).toContain("jobs:self");

    const disabled = await client.keys.disable(created.keyId);
    expect(disabled.status).toBe("deactivated");
  });

  integrationIt("authenticates a created key against the models API", async () => {
    const client = createIntegrationClient();
    const name = `ts-sdk-models-${Math.random().toString(16).slice(2, 10)}`;
    const created = await client.keys.create(name, ["models:*"]);

    try {
      const scoped = new HyperCLI({ apiKey: created.apiKey!, apiUrl: process.env.TEST_API_BASE });
      const models = await scoped.models.list();
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((model) => model.id.length > 0)).toBe(true);
    } finally {
      await client.keys.disable(created.keyId);
    }
  });

  integrationIt("enforces api:self vs user:self on scoped keys", async () => {
    const client = createIntegrationClient();

    const apiScoped = await client.keys.create(
      `ts-api-scope-${Math.random().toString(16).slice(2, 10)}`,
      ["api:self"],
    );
    try {
      const scoped = new HyperCLI({ apiKey: apiScoped.apiKey!, apiUrl: process.env.TEST_API_BASE });
      const keys = await scoped.keys.list();
      expect(keys.some((key) => key.keyId === apiScoped.keyId)).toBe(true);

      const deniedProfile = scoped.user.get();
      await expect(deniedProfile).rejects.toBeInstanceOf(APIError);
      await expect(deniedProfile).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      await client.keys.disable(apiScoped.keyId);
    }

    const userScoped = await client.keys.create(
      `ts-user-scope-${Math.random().toString(16).slice(2, 10)}`,
      ["user:self"],
    );
    try {
      const scoped = new HyperCLI({ apiKey: userScoped.apiKey!, apiUrl: process.env.TEST_API_BASE });
      const user = await scoped.user.get();
      expect(user.userId).toBeTruthy();

      const deniedKeys = scoped.keys.list();
      await expect(deniedKeys).rejects.toBeInstanceOf(APIError);
      await expect(deniedKeys).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      await client.keys.disable(userScoped.keyId);
    }
  });
});
