import {
  createIntegrationClient,
  integrationDescribe,
  integrationIt,
} from "./helpers.js";

integrationDescribe("TS SDK integration: billing", () => {
  integrationIt("reads account balance", async () => {
    const client = createIntegrationClient();
    const balance = await client.billing.balance();

    expect(Number(balance.total)).toBeGreaterThanOrEqual(0);
    expect(Number(balance.available)).toBeGreaterThanOrEqual(0);
    expect(Number(balance.rewards)).toBeGreaterThanOrEqual(0);
    expect(Number(balance.paid)).toBeGreaterThanOrEqual(0);
  });
});
