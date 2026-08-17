import { expect, test } from "@playwright/test";

import {
  waitForBrowserAgentStartOrCleanup,
  waitForBrowserAgentStartOrLaunchError,
} from "./fixtures/auth";

test("final starter upload failure prevents start and cleans the created Agent", async ({ page }) => {
  let startRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/agents\/deployments\/[^/]+\/start$/.test(new URL(request.url()).pathname)) {
      startRequests += 1;
    }
  });

  const deleted: string[] = [];
  const deployments = {
    delete: async (agentId: string) => {
      deleted.push(agentId);
      return {};
    },
    get: async () => {
      throw Object.assign(new Error("Not found"), { statusCode: 404 });
    },
    stop: async () => ({}),
  };
  const created = { id: "agent-upload-failed", state: "STOPPED" };
  const startedAt = Date.now();
  const startOutcome = waitForBrowserAgentStartOrLaunchError(page, 5_000);

  await page.setContent(`
    <div role="alert" data-testid="agent-error-banner">
      Agent created, but starter files could not be uploaded after retries: Reef sync file route unavailable
    </div>
  `);

  await expect(waitForBrowserAgentStartOrCleanup(
    startOutcome,
    deployments as never,
    created,
  )).rejects.toThrow("starter files could not be uploaded after retries");

  expect(Date.now() - startedAt).toBeLessThan(2_000);
  expect(startRequests).toBe(0);
  expect(deleted).toEqual([created.id]);
});
