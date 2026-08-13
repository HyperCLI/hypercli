import { expect, test } from "@playwright/test";

import {
  waitForBrowserAgentStartOrCleanup,
  waitForBrowserAgentStartOrLaunchError,
} from "./fixtures/auth";

test("starter upload 503 fails immediately without start and cleans the created Agent", async ({ page }) => {
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
    stop: async () => ({}),
  };
  const created = { id: "agent-upload-failed", state: "STOPPED" };
  const startedAt = Date.now();
  const startOutcome = waitForBrowserAgentStartOrLaunchError(page, 5_000);

  await page.setContent(`
    <div role="alert" data-testid="agent-error-banner">
      Agent created, but starter files could not be uploaded: API Error 503: Reef sync file route unavailable
    </div>
  `);

  await expect(waitForBrowserAgentStartOrCleanup(
    startOutcome,
    deployments as never,
    created,
  )).rejects.toThrow("API Error 503: Reef sync file route unavailable");

  expect(Date.now() - startedAt).toBeLessThan(2_000);
  expect(startRequests).toBe(0);
  expect(deleted).toEqual([created.id]);
});
