import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import {
  cleanupClawAgents,
  captureStep,
  cancelActiveClawStripeSubscriptionsForTestUser,
  cancelStripeSubscription,
  deleteClawAgent,
  fetchClawSubscriptionSummary,
  fetchStripeSubscriptionIdForCheckoutSession,
  launchClawAgentAndWaitForGateway,
  completeStripeCheckout,
  loginWithPrivy,
  waitForPaidClawPlan,
} from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

function totalGrantedSlots(summary: Awaited<ReturnType<typeof fetchClawSubscriptionSummary>>): number {
  const inventory = summary?.entitlements?.slotInventory ?? summary?.slotInventory ?? {};
  return Object.values(inventory).reduce((sum, entry) => sum + Math.max(Number(entry.granted || 0), 0), 0);
}

function stripeSubscriptionIds(summary: Awaited<ReturnType<typeof fetchClawSubscriptionSummary>>): Set<string> {
  return new Set(
    (summary?.activeSubscriptions ?? [])
      .map((subscription) => subscription.stripeSubscriptionId)
      .filter((value): value is string => Boolean(value))
  );
}

function checkoutSessionIdFromUrl(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).searchParams.get("session_id");
  } catch {
    return null;
  }
}

async function waitForPlansPageReady(page: Page): Promise<void> {
  const teamPlanHeading = page.getByRole("heading", { name: "Team", exact: true }).first();

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto("/plans", { waitUntil: "domcontentloaded" });

    const state = await expect
      .poll(
        async () => {
          if (await teamPlanHeading.isVisible().catch(() => false)) {
            return "ready";
          }

          const mainText = await page
            .locator("main")
            .first()
            .textContent({ timeout: 1_000 })
            .catch(() => "");
          const headingText = await page
            .locator("h1")
            .first()
            .textContent({ timeout: 1_000 })
            .catch(() => "");
          const authState = await page
            .locator("[data-auth-flow-state]")
            .first()
            .evaluate((element) => ({
              loading: element.getAttribute("data-auth-loading"),
              authenticated: element.getAttribute("data-authenticated"),
              flowState: element.getAttribute("data-auth-flow-state"),
              error: element.getAttribute("data-auth-error"),
            }))
            .catch(() => null);
          const browserState = await page
            .evaluate(() => {
              const cookieNames = document.cookie
                .split("; ")
                .map((entry) => entry.split("=")[0])
                .filter(Boolean);
              return {
                hasClawAuthToken: Boolean(localStorage.getItem("claw_auth_token")),
                hasAppAuthToken: Boolean(localStorage.getItem("app_auth_token")),
                hasAuthCookie: cookieNames.includes("auth_token"),
                hasLogoutMarker: cookieNames.includes("hypercli_logged_out"),
              };
            })
            .catch(() => null);
          return `url=${page.url()} auth=${JSON.stringify(authState)} browser=${JSON.stringify(browserState)} h1=${headingText?.trim() || "none"} main=${mainText?.trim().slice(0, 120) || "empty"}`;
        },
        { timeout: 20_000, intervals: [500, 1_000, 2_000] }
      )
      .toBe("ready")
      .then(() => "ready" as const)
      .catch(async (error) => {
        console.log(`[agents-plans] plans page not ready attempt=${attempt}: ${error instanceof Error ? error.message : String(error)}`);
        return "not-ready" as const;
      });

    if (state === "ready") {
      return;
    }

    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  }

  await expect(teamPlanHeading).toBeVisible({ timeout: 20_000 });
}

async function waitForPlanCheckoutButton(page: Page, planCard: ReturnType<Page["locator"]>) {
  const checkoutButton = planCard.getByRole("button", { name: /purchase|add another|subscribe|upgrade/i }).first();

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    if (await checkoutButton.isVisible().catch(() => false)) {
      return checkoutButton;
    }

    const retryButton = page.getByRole("button", { name: /^retry$/i }).first();
    if (await retryButton.isVisible().catch(() => false)) {
      console.log(`[agents-plans] billing unavailable before checkout; retrying plans load attempt=${attempt}`);
      await retryButton.click();
    } else {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    }
    await page.waitForTimeout(2_000);
  }

  await expect(checkoutButton).toBeVisible({ timeout: 20_000 });
  return checkoutButton;
}

test.describe.serial("Agents subscription", () => {
  test("logs into Claw, purchases a paid plan, launches an agent, and connects the gateway", async ({ page }) => {
    test.setTimeout(900_000);

    let createdAgentId: string | null = null;
    let createdStripeSubscriptionId: string | null = null;
    const preCleanupStripeIds = await cancelActiveClawStripeSubscriptionsForTestUser().catch((error) => {
      console.log(`[agents-plans] pre-cleanup skipped: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    });
    console.log(`[agents-plans] pre-cleanup canceled Stripe subscriptions=${preCleanupStripeIds.length}`);
    await loginWithPrivy(page);

    try {
      const logPlanState = async (label: string) => {
        const summary = await fetchClawSubscriptionSummary(page).catch(() => null);
        console.log(
          `[agents-plans] ${label} active=${summary?.activeSubscriptionCount ?? "unknown"} grantedSlots=${totalGrantedSlots(summary)} plans=${
            summary?.activeSubscriptions
              .map((subscription) => `${subscription.planId}:${subscription.status}`)
              .join(",") || "none"
          }`
        );
      };

      await waitForPlansPageReady(page);
      if (preCleanupStripeIds.length > 0) {
        const canceledStripeIds = new Set(preCleanupStripeIds);
        await expect
          .poll(
            async () => {
              const summary = await fetchClawSubscriptionSummary(page);
              if (!summary) return -1;
              return [...stripeSubscriptionIds(summary)].filter((stripeId) => canceledStripeIds.has(stripeId)).length;
            },
            { timeout: 180_000, intervals: [1_000, 2_000, 5_000] }
          )
          .toBe(0);
      }
      await logPlanState("before-checkout");
      const beforeSummary = await fetchClawSubscriptionSummary(page);
      if (!beforeSummary) {
        throw new Error("Subscription summary was unavailable before checkout");
      }
      expect(beforeSummary.activeSubscriptionCount).toBe(0);
      expect(beforeSummary.activeEntitlementCount).toBe(0);
      expect(beforeSummary.activeSubscriptions).toHaveLength(0);
      expect(beforeSummary.subscriptions ?? []).toHaveLength(0);
      expect(totalGrantedSlots(beforeSummary)).toBe(0);
      const beforeActiveSubscriptionCount = beforeSummary?.activeSubscriptionCount ?? 0;
      const beforeGrantedSlots = totalGrantedSlots(beforeSummary);
      const beforeStripeSubscriptionIds = stripeSubscriptionIds(beforeSummary);
      let afterPurchaseSummary: Awaited<ReturnType<typeof fetchClawSubscriptionSummary>> = null;
      let checkoutCompleted = false;

      const teamCard = page.getByRole("article").filter({
        has: page.getByRole("heading", { name: "Team", exact: true }),
      }).first();
      await expect(teamCard.getByRole("heading", { name: "Team", exact: true })).toBeVisible({ timeout: 20_000 });
      const subscribeButton = await waitForPlanCheckoutButton(page, teamCard);

      const proCard = page.getByRole("article").filter({
        has: page.getByRole("heading", { name: "Pro", exact: true }),
      }).first();
      await expect(proCard.getByRole("heading", { name: "Pro", exact: true })).toBeVisible();
      await expect(proCard.getByText("$149", { exact: true })).toBeVisible();
      await expect(
        proCard.getByRole("button", { name: /purchase|add another|subscribe|upgrade/i }).first()
      ).toBeEnabled();

      await subscribeButton.click();

      await expect(page.getByRole("heading", { name: "Purchase Team", exact: true })).toBeVisible({ timeout: 20_000 });
      const payWithCardButton = page.getByRole("button", { name: /pay \$.*with card/i }).first();
      await expect(payWithCardButton).toBeVisible({ timeout: 10_000 });
      await payWithCardButton.click();

      const checkoutReturnUrl = await completeStripeCheckout(
        page,
        process.env.TEST_BASE_URL?.trim() || "http://127.0.0.1:4003"
      );
      console.log(`Agents checkout returned to: ${checkoutReturnUrl}`);
      expect(checkoutReturnUrl).not.toContain("cancelled=true");
      const checkoutSessionId = checkoutSessionIdFromUrl(checkoutReturnUrl);
      if (!checkoutSessionId) {
        throw new Error("Stripe checkout return URL did not include a session_id");
      }
      const checkoutStripeSubscriptionId = await fetchStripeSubscriptionIdForCheckoutSession(checkoutSessionId);
      if (!checkoutStripeSubscriptionId) {
        throw new Error("Stripe checkout session did not contain a subscription");
      }
      createdStripeSubscriptionId = checkoutStripeSubscriptionId;
      console.log(
        `[agents-plans] checkout session=${checkoutSessionId} stripeSubscription=${createdStripeSubscriptionId}`
      );
      await captureStep(page, "agents-07-checkout-submitted");

      await expect
        .poll(() => page.url(), { timeout: 60_000 })
        .toContain("/plans");

      await expect
        .poll(
          async () => {
            afterPurchaseSummary = await fetchClawSubscriptionSummary(page);
            const currentStripeIds = stripeSubscriptionIds(afterPurchaseSummary);
            const hasCheckoutSubscription = currentStripeIds.has(checkoutStripeSubscriptionId);
            const hasNewSubscription = [...currentStripeIds].some((stripeId) => !beforeStripeSubscriptionIds.has(stripeId));
            const currentSlots = totalGrantedSlots(afterPurchaseSummary);
            console.log(
              `[agents-plans] poll active=${afterPurchaseSummary?.activeSubscriptionCount ?? "unknown"} ` +
                `grantedSlots=${currentSlots} hasCheckoutSubscription=${hasCheckoutSubscription} ` +
                `hasNewSubscription=${hasNewSubscription}`
            );
            return hasCheckoutSubscription && currentSlots > beforeGrantedSlots;
          },
          { timeout: 180_000, intervals: [1_000, 2_000, 5_000] }
        )
        .toBeTruthy();

      expect(totalGrantedSlots(afterPurchaseSummary)).toBe(3);
      expect(afterPurchaseSummary?.slotInventory?.medium?.granted).toBe(3);
      expect(afterPurchaseSummary?.slotInventory?.medium?.available).toBe(3);
      expect(afterPurchaseSummary?.slotInventory?.small?.granted ?? 0).toBe(0);
      expect(afterPurchaseSummary?.slotInventory?.large?.granted ?? 0).toBe(0);
      expect(afterPurchaseSummary?.effectivePlanId).toBe("team");
      checkoutCompleted = true;
      console.log(
        `[agents-plans] before active=${beforeActiveSubscriptionCount} grantedSlots=${beforeGrantedSlots}; ` +
          `after active=${afterPurchaseSummary?.activeSubscriptionCount ?? "unknown"} grantedSlots=${totalGrantedSlots(afterPurchaseSummary)}`
      );
      await logPlanState("after-checkout");

      const currentPlan = await waitForPaidClawPlan(page);
      expect(currentPlan.id).toBe("team");
      await captureStep(page, "agents-08-plan-active");

      await cleanupClawAgents(page);
      const createdAgent = await launchClawAgentAndWaitForGateway(page, 360_000, { enableDesktop: checkoutCompleted });
      createdAgentId = createdAgent.id;
      expect(createdAgentId).toBeTruthy();
      expect(createdAgent.memory).toBe(4);
    } finally {
      if (createdAgentId) {
        await deleteClawAgent(page, createdAgentId).catch(() => {});
      }

      if (createdStripeSubscriptionId) {
        await cancelStripeSubscription(createdStripeSubscriptionId).catch(() => {});
      }
      await cancelActiveClawStripeSubscriptionsForTestUser().catch(() => []);
      await captureStep(page, "agents-09-plan-cleanup");
    }
  });
});
