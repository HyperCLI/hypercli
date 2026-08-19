import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import {
  cleanupClawAgents,
  captureStep,
  deleteClawAgent,
  deleteClawAgentThroughUi,
  fetchClawSubscriptionSummary,
  launchClawAgentAndWaitForGateway,
  loginWithAdminBootstrap,
  startClawTeamTrialThroughUi,
  stopClawAgentThroughUi,
  waitForPaidClawPlan,
} from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });
test.use({ trace: "off", video: "off" });

type DeploymentTransitionFrame = {
  type?: unknown;
  agent_id?: unknown;
  [key: string]: unknown;
};

type DeploymentSocketObservation = {
  readyFrames: Array<Record<string, unknown>>;
  readySocketCount: () => number;
  transitions: DeploymentTransitionFrame[];
};

function observeDeploymentTransitions(page: Page): DeploymentSocketObservation {
  const readySockets = new Set<object>();
  const observation: DeploymentSocketObservation = {
    readyFrames: [],
    readySocketCount: () => readySockets.size,
    transitions: [],
  };
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname !== "/ws/deployments") return;
    let ready = false;
    socket.on("framereceived", ({ payload }) => {
      try {
        const frame = JSON.parse(typeof payload === "string" ? payload : payload.toString("utf8"));
        if (!frame || typeof frame !== "object") return;
        if (frame.type === "ready") {
          ready = true;
          readySockets.add(socket);
          observation.readyFrames.push(frame as Record<string, unknown>);
        } else if (ready && frame.type === "deployment.transition") {
          observation.transitions.push(frame as DeploymentTransitionFrame);
        }
      } catch {
        // Unrelated malformed frames are handled by the SDK reconnect path.
      }
    });
    socket.on("close", () => readySockets.delete(socket));
  });
  return observation;
}

function totalGrantedSlots(summary: Awaited<ReturnType<typeof fetchClawSubscriptionSummary>>): number {
  const inventory = summary?.entitlements?.slotInventory ?? summary?.slotInventory ?? {};
  return Object.values(inventory).reduce((sum, entry) => sum + Math.max(Number(entry.granted || 0), 0), 0);
}

test.describe.serial("Agents subscription", () => {
  test("starts a trial in the UI, launches an agent, connects the gateway, and deletes it", async ({ page }) => {
    test.setTimeout(900_000);

    const deploymentSocket = observeDeploymentTransitions(page);
    let createdAgentId: string | null = null;
    let testBodyCompleted = false;
    await loginWithAdminBootstrap(page);

    // A Playwright retry reuses the bootstrapped account. If the previous
    // attempt reached deployment creation but the Agents API failed during
    // readiness/cleanup, that stopped deployment still consumes a slot. Make
    // an empty deployment inventory a precondition before asserting the
    // plan's full availability.
    await cleanupClawAgents(page);

    try {
      const logPlanState = async (label: string) => {
        const summary = await fetchClawSubscriptionSummary(page).catch(() => null);
        console.log(
          `[agents-plans] ${label} plan=${summary?.effectivePlanId ?? "unknown"} ` +
            `entitlements=${summary?.activeEntitlementCount ?? "unknown"} ` +
            `subscriptions=${summary?.activeSubscriptionCount ?? "unknown"} ` +
            `grantedSlots=${totalGrantedSlots(summary)}`
        );
      };

      await logPlanState("fresh-account");

      // The account starts with nothing and earns its plan HERE, by clicking
      // the trial offer the way a user does. It is deliberately not seeded by
      // the bootstrap and deliberately not bought through Stripe: the checkout
      // redirect cannot come back to a localhost run, and purchase is covered
      // in the billing spec. The subject of this spec is the Agent lifecycle,
      // and the trial is the shortest honest path to a plan that can launch one.
      const freshSummary = await fetchClawSubscriptionSummary(page);
      if (!freshSummary) {
        throw new Error("Subscription summary was unavailable before the trial");
      }
      expect(freshSummary.activeEntitlementCount ?? 0, "a fresh identity must start with no plan").toBe(0);
      expect(totalGrantedSlots(freshSummary)).toBe(0);

      await startClawTeamTrialThroughUi(page);
      await logPlanState("trial-active");

      // The trial is an entitlement, not a purchase, so the plan is effective
      // with zero active subscriptions. That distinction is the assertion: a
      // Stripe subscription appearing here would mean we bought something.
      const beforeSummary = await fetchClawSubscriptionSummary(page);
      if (!beforeSummary) {
        throw new Error("Subscription summary was unavailable after the trial started");
      }
      expect(beforeSummary.activeEntitlementCount, "expected the Team trial entitlement").toBeGreaterThan(0);
      expect(beforeSummary.effectivePlanId).toBe("team");
      expect(totalGrantedSlots(beforeSummary)).toBeGreaterThan(0);
      expect(beforeSummary.activeSubscriptionCount).toBe(0);
      expect(beforeSummary.activeSubscriptions).toHaveLength(0);

      const currentPlan = await waitForPaidClawPlan(page);
      expect(currentPlan.id).toBe("team");
      await captureStep(page, "agents-08-plan-active");

      await cleanupClawAgents(page);
      const createdAgent = await launchClawAgentAndWaitForGateway(page, 360_000, {
        enableDesktop: true,
        // Adopt the Agent the moment it exists, not when it is healthy: every
        // readiness failure throws out of the helper, and an Agent this spec
        // never learned about is one the `finally` cannot delete -- which is
        // what leaves the shared dev user owning a non-deleted Agent and 409s
        // the CI user teardown.
        onAgentCreated: (agentId) => {
          createdAgentId = agentId;
        },
        beforeCreate: async () => {
          await expect
            .poll(() => deploymentSocket.readySocketCount(), {
              timeout: 30_000,
              intervals: [250, 500, 1_000, 2_000],
            })
            .toBeGreaterThan(0);
          expect(deploymentSocket.readyFrames.at(-1)).toEqual({ type: "ready" });
        },
      });
      createdAgentId = createdAgent.id;
      expect(createdAgentId).toBeTruthy();
      expect(createdAgent.memory).toBe(4);

      await expect
        .poll(() => deploymentSocket.transitions.some((frame) => frame.agent_id === createdAgentId), {
          timeout: 30_000,
          intervals: [250, 500, 1_000, 2_000],
        })
        .toBe(true);
      const transition = deploymentSocket.transitions.find((frame) => frame.agent_id === createdAgentId)!;
      expect(transition.type).toBe("deployment.transition");
      expect(typeof transition.state).toBe("string");
      expect(String(transition.state).length).toBeGreaterThan(0);
      expect(Number.isInteger(transition.launch_epoch)).toBe(true);
      expect(Number(transition.launch_epoch)).toBeGreaterThanOrEqual(0);
      expect(Object.values(transition).every((value) => value === null || typeof value !== "object")).toBe(true);

      const allowedKeys = new Set([
        "type",
        "agent_id",
        "state",
        "reason",
        "error",
        "message",
        "launch_epoch",
        "resources_exist",
        "namespace_exists",
      ]);
      expect(Object.keys(transition).every((key) => allowedKeys.has(key))).toBe(true);
      expect(Object.keys(transition)).toEqual(
        expect.arrayContaining([
          "type",
          "agent_id",
          "state",
          "launch_epoch",
        ])
      );
      // Stop and delete are part of what this spec covers, so they are driven
      // from the Agent's settings page exactly as a user drives them: the
      // Danger Zone refuses to delete until the Agent is stopped, which is the
      // UI half of the precondition the Backend enforces.
      const stoppedAgent = await stopClawAgentThroughUi(page, createdAgentId);
      expect(stoppedAgent.state).toBe("STOPPED");
      await deleteClawAgentThroughUi(page, createdAgentId);
      createdAgentId = null;

      // Deleting the Agent has to hand its slot back, or the next launch on
      // this plan has nowhere to go.
      await expect
        .poll(async () => (await fetchClawSubscriptionSummary(page))?.slotInventory?.medium?.available ?? -1, {
          timeout: 120_000,
          intervals: [1_000, 2_000, 5_000],
        })
        .toBe(3);
      await logPlanState("after-delete");
      testBodyCompleted = true;
    } finally {
      const cleanupFailures: string[] = [];

      // Teardown deletes the CI user, and that fails with 409 while the user
      // still owns an Agent. A best-effort delete that swallows its error
      // therefore does not end the run's damage -- it moves it to the next
      // run. Confirm the deletion, and report a failure to delete as a
      // failure.
      //
      // This is the API backstop, never the assertion: the covered delete is
      // the UI one above, and this only runs when the test never got there.
      if (createdAgentId) {
        const leakedAgentId = createdAgentId;
        try {
          await deleteClawAgent(page, leakedAgentId);
          createdAgentId = null;
        } catch (error) {
          cleanupFailures.push(
            `agent ${leakedAgentId} was not deleted: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      await captureStep(page, "agents-09-plan-cleanup");

      if (cleanupFailures.length > 0) {
        const summary = `Agents E2E cleanup failed: ${cleanupFailures.join("; ")}`;
        // A failure here is only reported as the test's failure when nothing
        // else failed. Throwing out of `finally` over a live exception would
        // replace the root cause with the cleanup symptom.
        if (testBodyCompleted) throw new Error(summary);
        console.log(`[agents-cleanup] ${summary}`);
      }
    }
  });
});
