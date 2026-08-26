import path from "node:path";

import { config as loadEnv } from "dotenv";
import { expect, test, type Page, type Route } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const TEST_BASE_URL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:4003";
const APP_ORIGIN = new URL(TEST_BASE_URL).origin;
const EXPECTED_WEBKIT_DIAGNOSTIC = "Viewport argument key \"interactive-widget\" not recognized and ignored.";

interface BrowserHygiene {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  unsuccessfulResponses: string[];
}

function trackBrowserHygiene(page: Page): BrowserHygiene {
  const hygiene: BrowserHygiene = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    unsuccessfulResponses: [],
  };
  const isAppRequest = (url: string) => new URL(url).pathname.startsWith("/agents");

  page.on("console", (message) => {
    if (message.type() === "error" && message.text() !== EXPECTED_WEBKIT_DIAGNOSTIC) {
      hygiene.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => hygiene.pageErrors.push(String(error)));
  page.on("requestfailed", (request) => {
    if (isAppRequest(request.url())) {
      hygiene.failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown failure"}`);
    }
  });
  page.on("response", (response) => {
    if (isAppRequest(response.url()) && response.status() >= 400) {
      hygiene.unsuccessfulResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  return hygiene;
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": APP_ORIGIN,
      "access-control-allow-credentials": "true",
      "vary": "Origin",
    },
    body: JSON.stringify(body),
  });
}

test("loads plan and subscription data without mobile browser errors", async ({ page }) => {
  const hygiene = trackBrowserHygiene(page);
  const requests: string[] = [];
  const requestOrigins = new Set<string>();
  const unexpectedRequests: string[] = [];

  await page.context().addCookies([{
    name: "auth_token",
    value: TEST_JWT,
    url: TEST_BASE_URL,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }]);
  await page.addInitScript((token) => {
    window.localStorage.setItem("claw_auth_token", token);
  }, TEST_JWT);

  await page.route(/\/agents(?:\/|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathName = url.pathname;
    requestOrigins.add(url.origin);
    requests.push(`${request.method()} ${pathName}`);

    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": APP_ORIGIN,
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "authorization, content-type",
          "access-control-allow-methods": "GET, OPTIONS",
          "vary": "Origin",
        },
      });
      return;
    }

    if (request.method() === "GET" && pathName.endsWith("/agents/plans")) {
      await fulfillJson(route, {
        plans: [{
          id: "pro",
          name: "Pro",
          price: 99,
          price_usd: 99,
          features: ["1 large agent"],
          models: [],
          limits: { tpd: 250_000_000, burst_tpm: 694_444, rpm: 3_472 },
          slot_grants: { large: 1 },
        }],
      });
      return;
    }

    if (request.method() === "GET" && pathName.endsWith("/agents/plans/current")) {
      await fulfillJson(route, {
        id: "pro",
        name: "Pro",
        price: 99,
        pooled_tpd: 250_000_000,
        slot_inventory: { large: { granted: 1, used: 0, available: 1 } },
      });
      return;
    }

    if (request.method() === "GET" && pathName.endsWith("/agents/subscriptions/summary")) {
      await fulfillJson(route, {
        effective_plan_id: "pro",
        current_subscription_id: "subscription-mobile",
        current_entitlement_id: "entitlement-mobile",
        pooled_tpm_limit: 173_611,
        pooled_rpm_limit: 3_472,
        pooled_tpd: 250_000_000,
        slot_inventory: { large: { granted: 1, used: 0, available: 1 } },
        active_subscription_count: 1,
        active_entitlement_count: 1,
        entitlements: {
          effective_plan_id: "pro",
          pooled_tpm_limit: 173_611,
          pooled_rpm_limit: 3_472,
          pooled_tpd: 250_000_000,
          slot_inventory: { large: { granted: 1, used: 0, available: 1 } },
          active_entitlement_count: 1,
        },
        active_subscriptions: [{
          id: "subscription-mobile",
          plan_id: "pro",
          plan_name: "Pro",
          provider: "STRIPE",
          status: "ACTIVE",
          quantity: 1,
          slot_grants: { large: 1 },
        }],
        subscriptions: [],
        user: { id: "user-mobile" },
      });
      return;
    }

    if (request.method() === "GET" && /\/agents\/?$/.test(pathName)) {
      await fulfillJson(route, []);
      return;
    }

    if (request.method() === "GET" && pathName.endsWith("/agents/deployments")) {
      await fulfillJson(route, []);
      return;
    }

    unexpectedRequests.push(`${request.method()} ${pathName}`);
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Unexpected mobile billing request" }),
    });
  });

  await page.goto("/plans", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /^plans$/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pro" })).toBeVisible();
  await expect(page.getByText(/^250M$/)).toBeVisible();
  await expect(page.getByText(/0 of 1 in use/i)).toBeVisible();
  await expect.poll(() => requests).toEqual(expect.arrayContaining([
    "GET /agents/plans",
    "GET /agents/plans/current",
    "GET /agents/subscriptions/summary",
  ]));

  expect([...requestOrigins].some((origin) => origin !== APP_ORIGIN)).toBe(true);
  expect(unexpectedRequests).toEqual([]);
  expect(hygiene.consoleErrors).toEqual([]);
  expect(hygiene.pageErrors).toEqual([]);
  expect(hygiene.failedRequests).toEqual([]);
  expect(hygiene.unsuccessfulResponses).toEqual([]);
});
