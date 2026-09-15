import {
  createIntegrationClient,
  expectNonEmptyString,
  integrationDescribe,
  integrationIt,
} from "./helpers.js";

integrationDescribe("TS SDK integration: instances", () => {
  integrationIt("lists GPU types", async () => {
    const client = createIntegrationClient();
    const types = await client.instances.types(true);
    const entries = Object.values(types);

    expect(entries.length).toBeGreaterThan(0);

    const firstType = entries[0];
    expectNonEmptyString(firstType.id);
    expectNonEmptyString(firstType.name);
    expect(Array.isArray(firstType.configs)).toBe(true);
  });

  integrationIt("lists regions", async () => {
    const client = createIntegrationClient();
    const regions = await client.instances.regions(true);
    const entries = Object.values(regions);

    expect(entries.length).toBeGreaterThan(0);

    const firstRegion = entries[0];
    expectNonEmptyString(firstRegion.id);
    expectNonEmptyString(firstRegion.description);
    expectNonEmptyString(firstRegion.country);
  });
});
