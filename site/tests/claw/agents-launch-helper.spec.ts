import { expect, test } from "@playwright/test";

import {
  isNonFatalLaunchNotice,
  waitForBrowserAgentStartOrCleanup,
  waitForBrowserAgentStartOrLaunchError,
} from "./fixtures/auth";

function fakeDeployments(deleted: string[]) {
  return {
    delete: async (agentId: string) => {
      deleted.push(agentId);
      return {};
    },
    get: async () => {
      throw Object.assign(new Error("Not found"), { statusCode: 404 });
    },
    stop: async () => ({}),
  };
}

test("a launch error banner prevents start and cleans the created Agent", async ({ page }) => {
  let startRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/agents\/deployments\/[^/]+\/start$/.test(new URL(request.url()).pathname)) {
      startRequests += 1;
    }
  });

  const deleted: string[] = [];
  const created = { id: "agent-launch-failed", state: "STOPPED" };
  const startedAt = Date.now();
  const startOutcome = waitForBrowserAgentStartOrLaunchError(page, 5_000);

  await page.setContent(`
    <div role="alert" data-testid="agent-error-banner">
      Agent was created, but Collection assignment did not complete: Collection access is unavailable right now.
    </div>
  `);

  await expect(waitForBrowserAgentStartOrCleanup(
    startOutcome,
    fakeDeployments(deleted) as never,
    created,
  )).rejects.toThrow("Collection assignment did not complete");

  expect(Date.now() - startedAt).toBeLessThan(2_000);
  expect(startRequests).toBe(0);
  expect(deleted).toEqual([created.id]);
});

test("a starter-file notice is not a launch failure", async ({ page }) => {
  // Starter files can only be written once the deployment's pod answers, so
  // they stage alongside the start. A file that never lands is reported as a
  // warning on an Agent that is already starting — the launch must continue.
  expect(isNonFatalLaunchNotice(
    "Agent started, but one starter file could not be uploaded (AGENTS.md): 404 page not found. Add them from the agent's Files tab.",
  )).toBe(true);
  expect(isNonFatalLaunchNotice("Agent created, but starter files could not be uploaded.")).toBe(false);

  const startOutcome = waitForBrowserAgentStartOrLaunchError(page, 3_000);

  await page.setContent(`
    <div role="alert" data-testid="agent-error-banner">
      Agent started, but one starter file could not be uploaded (AGENTS.md): 404 page not found. Add them from the agent's Files tab.
    </div>
  `);

  // The banner must never resolve the launch wait; only the missing start
  // response does, and here it times out instead of reporting the notice.
  await expect(startOutcome).rejects.toThrow(/Timeout|exceeded/i);
});
