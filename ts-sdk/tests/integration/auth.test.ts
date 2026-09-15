import {
  EXPECTED_TEST_EMAIL,
  createIntegrationClient,
  expectNonEmptyString,
  integrationDescribe,
  integrationIt,
} from "./helpers.js";

integrationDescribe("TS SDK integration: auth", () => {
  integrationIt("fetches the current user for the test API key", async () => {
    const client = createIntegrationClient();
    const user = await client.user.get();

    expectNonEmptyString(user.userId);
    expect(user.email).toBe(EXPECTED_TEST_EMAIL);
    expect(user.isActive).toBe(true);
    expect(user.createdAt).toBeTruthy();
  });
});
