import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";

test("plans crypto checkout posts to the concrete agents x402 plan route", async ({ page }) => {
  await page.context().addCookies([
    {
      name: "auth_token",
      value: TEST_JWT,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.addInitScript((token) => {
    window.localStorage.setItem("claw_auth_token", token);

    const provider = {
      isMetaMask: true,
      on: () => {},
      request: async ({ method }: { method: string; params?: unknown[] }) => {
        if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
        if (method === "eth_chainId") return "0x2105";
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "wallet_addEthereumChain") return null;
        if (method === "eth_accounts") return ["0x1111111111111111111111111111111111111111"];
        throw new Error(`Unhandled ethereum method: ${method}`);
      },
    };

    Object.defineProperty(window, "ethereum", {
      configurable: true,
      value: provider,
    });
  }, TEST_JWT);

  let x402Path: string | null = null;

  await page.route("**/agents/**", async (route) => {
    const url = new URL(route.request().url());
    const pathName = url.pathname;

    if (pathName.endsWith("/agents/plans")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          plans: [
            {
              id: "5aiu",
              name: "Pro",
              price: 100,
              aiu: 5,
              agents: 1,
              features: ["1 large agent"],
              models: ["kimi-k2.5"],
              highlighted: true,
              limits: { tpd: 250000000, burst_tpm: 694444, rpm: 3472 },
            },
          ],
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/plans/current")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "free",
          name: "Free",
          price: 0,
          pooled_tpd: 0,
          slot_inventory: {},
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/subscriptions/summary")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          effective_plan_id: "free",
          current_subscription_id: null,
          current_entitlement_id: null,
          pooled_tpm_limit: 0,
          pooled_rpm_limit: 0,
          pooled_tpd: 0,
          slot_inventory: {},
          active_subscription_count: 0,
          active_entitlement_count: 0,
          entitlements: {
            effective_plan_id: "free",
            pooled_tpm_limit: 0,
            pooled_rpm_limit: 0,
            pooled_tpd: 0,
            slot_inventory: {},
            active_entitlement_count: 0,
          },
          active_subscriptions: [],
          subscriptions: [],
          user: { id: "user-1" },
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/x402/5aiu")) {
      x402Path = pathName;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          plan_id: "5aiu",
          expires_at: "2026-05-19T12:00:00Z",
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/plans", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: /purchase pro/i }).click();
  await page.getByRole("button", { name: "USDC" }).click();
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await expect(page.getByText(/\$100 USDC on Base/i)).toBeVisible();
  await page.getByRole("button", { name: "Pay $100 with USDC" }).click();

  await expect.poll(() => x402Path).toBe("/agents/x402/5aiu");
  await expect(page.getByText(/Entitlement Active!/i)).toBeVisible();
});
