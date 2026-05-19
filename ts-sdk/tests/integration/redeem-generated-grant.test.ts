import {
  TEST_API_BASE,
  TEST_AGENT_API_KEY,
  TEST_API_KEY,
  createIntegrationClient,
} from "./helpers.js";

const TEST_REDEEM_GRANT_CODE = process.env.TEST_REDEEM_GRANT_CODE?.trim() || "";
const TEST_REDEEM_GRANT_PLAN_ID = process.env.TEST_REDEEM_GRANT_PLAN_ID?.trim() || "basic";
const TEST_REDEEM_GRANT_TAG = process.env.TEST_REDEEM_GRANT_TAG?.trim() || "";

describe("TS SDK integration: externally generated grant redemption", () => {
  if (!TEST_API_KEY || !TEST_AGENT_API_KEY || !TEST_REDEEM_GRANT_CODE) {
    it.skip("requires TEST_API_KEY, TEST_AGENT_API_KEY, and TEST_REDEEM_GRANT_CODE", () => {});
    return;
  }

  it("redeems a backend-generated grant code through the TS SDK", async () => {
    expect(TEST_API_BASE).toBeTruthy();

    const client = createIntegrationClient();
    const redemption = await client.agent.redeemGrantCode(TEST_REDEEM_GRANT_CODE);

    expect(redemption.grant.planId).toBe(TEST_REDEEM_GRANT_PLAN_ID);
    expect(redemption.entitlement.planId).toBe(TEST_REDEEM_GRANT_PLAN_ID);
    if (TEST_REDEEM_GRANT_TAG) {
      expect(redemption.entitlement.tags).toContain(TEST_REDEEM_GRANT_TAG);
    }
  });
});
