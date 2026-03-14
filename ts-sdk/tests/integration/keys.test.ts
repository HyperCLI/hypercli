import {
  TEST_API_KEY,
  createIntegrationClient,
  expectNonEmptyString,
  integrationDescribe,
  integrationIt,
} from "./helpers.js";

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
});
