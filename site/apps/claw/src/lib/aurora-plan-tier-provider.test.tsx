import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdkMocks = vi.hoisted(() => ({
  plans: vi.fn(),
  subscriptionSummary: vi.fn(),
}));

vi.mock("@hypercli.com/sdk/browser", () => ({
  BrowserHyperCLI: class {
    agent = {
      plans: sdkMocks.plans,
      subscriptionSummary: sdkMocks.subscriptionSummary,
    };
  },
}));

import { AuroraPlanTierProvider } from "../../../../packages/shared-ui/src/components/AuroraPlanTierProvider";
import { ThemeProvider } from "../../../../packages/shared-ui/src/components/ThemeProvider";
import { setTheme, THEME_COOKIE_NAME, THEME_FAMILY_COOKIE_NAME } from "../../../../packages/shared-ui/src/utils/theme";
import {
  notifyBillingPlanChanged,
  PLAN_TIER_COOKIE_NAME,
} from "../../../../packages/shared-ui/src/utils/plan-tier";
import { AUTH_LOGOUT_COOKIE } from "../../../../packages/shared-ui/src/utils/cookies";

function expireCookie(name: string): void {
  document.cookie = `${name}=; Path=/; Max-Age=0`;
}

function authToken(subject: string): string {
  const payload = btoa(JSON.stringify({ sub: subject, exp: Date.now() / 1000 + 300 }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `header.${payload}.signature`;
}

function currentPlan(id: string) {
  return {
    effectivePlanId: id,
    activeSubscriptions: [],
    entitlementItems: [],
    entitlements: { effectivePlanId: id },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <AuroraPlanTierProvider>
        <div>content</div>
      </AuroraPlanTierProvider>
    </ThemeProvider>,
  );
}

function renderDuplicateProviders() {
  return render(
    <ThemeProvider>
      <AuroraPlanTierProvider>
        <AuroraPlanTierProvider>
          <div>content</div>
        </AuroraPlanTierProvider>
      </AuroraPlanTierProvider>
    </ThemeProvider>,
  );
}

describe("AuroraPlanTierProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of ["auth_token", AUTH_LOGOUT_COOKIE, PLAN_TIER_COOKIE_NAME, THEME_COOKIE_NAME, THEME_FAMILY_COOKIE_NAME]) {
      expireCookie(name);
    }
    window.localStorage.clear();
    document.documentElement.setAttribute("data-theme", "aurora-dark");
    document.documentElement.setAttribute("data-color-mode", "dark");
    document.documentElement.setAttribute("data-plan-tier", "solo");
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.provider-test.hypercli.com/api";
    sdkMocks.plans.mockResolvedValue([
      { id: "solo", name: "Solo", contractVersion: "2026-08" },
      { id: "team", name: "Team", contractVersion: "2026-08" },
      { id: "pro", name: "Pro", contractVersion: "2026-08" },
    ]);
  });

  it("canonicalizes a legacy Classic request and loads its Aurora tier", async () => {
    document.cookie = `auth_token=${authToken("classic-user")}; Path=/`;
    sdkMocks.subscriptionSummary.mockResolvedValueOnce(currentPlan("solo"));
    setTheme("dark");
    renderProvider();

    await waitFor(() => expect(sdkMocks.subscriptionSummary).toHaveBeenCalledTimes(1));
    expect(document.documentElement).toHaveAttribute("data-theme", "aurora-dark");
  });

  it("runs a single sync loop when mounted more than once", async () => {
    document.cookie = `auth_token=${authToken("duplicate-mount-user")}; Path=/`;
    sdkMocks.subscriptionSummary.mockResolvedValue(currentPlan("team"));
    setTheme("aurora-dark");
    renderDuplicateProviders();

    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-plan-tier", "team"));
    const callsAfterResolve = sdkMocks.subscriptionSummary.mock.calls.length;
    expect(callsAfterResolve).toBe(1);

    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(sdkMocks.subscriptionSummary).toHaveBeenCalledTimes(callsAfterResolve);
  });

  it("resolves the authenticated tier and refreshes after billing mutations", async () => {
    document.cookie = `auth_token=${authToken("aurora-user")}; Path=/`;
    sdkMocks.subscriptionSummary.mockResolvedValueOnce(currentPlan("team"));
    setTheme("aurora-dark");
    renderProvider();

    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-plan-tier", "team"));

    sdkMocks.subscriptionSummary.mockResolvedValueOnce(currentPlan("pro"));
    notifyBillingPlanChanged();

    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-plan-tier", "enterprise"));
    expect(sdkMocks.subscriptionSummary).toHaveBeenCalledTimes(2);
    expect(document.cookie).toContain(`${PLAN_TIER_COOKIE_NAME}=`);
  });

  it("retries billing refreshes while entitlement changes propagate", async () => {
    vi.useFakeTimers();
    document.cookie = `auth_token=${authToken("propagation-user")}; Path=/`;
    sdkMocks.subscriptionSummary
      .mockResolvedValueOnce(currentPlan("solo"))
      .mockResolvedValueOnce(currentPlan("solo"))
      .mockResolvedValue(currentPlan("team"));
    setTheme("aurora-dark");
    const view = renderProvider();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sdkMocks.subscriptionSummary).toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyBillingPlanChanged();
      await Promise.resolve();
    });
    expect(sdkMocks.subscriptionSummary).toHaveBeenCalledTimes(2);
    expect(document.documentElement).toHaveAttribute("data-plan-tier", "solo");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(sdkMocks.subscriptionSummary).toHaveBeenCalledTimes(3);
    expect(document.documentElement).toHaveAttribute("data-plan-tier", "team");

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(sdkMocks.subscriptionSummary).toHaveBeenCalledTimes(3);
  });

  it("does not let an older forced response poison the snapshot cache", async () => {
    vi.useFakeTimers();
    const staleRefresh = deferred<ReturnType<typeof currentPlan>>();
    const freshRefresh = deferred<ReturnType<typeof currentPlan>>();
    document.cookie = `auth_token=${authToken("race-user")}; Path=/`;
    sdkMocks.subscriptionSummary
      .mockResolvedValueOnce(currentPlan("team"))
      .mockReturnValueOnce(staleRefresh.promise)
      .mockReturnValueOnce(freshRefresh.promise);
    setTheme("aurora-dark");
    const view = renderProvider();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(document.documentElement).toHaveAttribute("data-plan-tier", "team");

    act(() => notifyBillingPlanChanged());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      freshRefresh.resolve(currentPlan("pro"));
      await Promise.resolve();
    });
    expect(document.documentElement).toHaveAttribute("data-plan-tier", "enterprise");

    await act(async () => {
      staleRefresh.resolve(currentPlan("solo"));
      await Promise.resolve();
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(document.documentElement).toHaveAttribute("data-plan-tier", "enterprise");

    view.unmount();
  });

  it("uses an earlier successful refresh when a later retry fails", async () => {
    vi.useFakeTimers();
    const successfulRefresh = deferred<ReturnType<typeof currentPlan>>();
    const failedRetry = deferred<ReturnType<typeof currentPlan>>();
    document.cookie = `auth_token=${authToken("retry-user")}; Path=/`;
    sdkMocks.subscriptionSummary
      .mockResolvedValueOnce(currentPlan("team"))
      .mockReturnValueOnce(successfulRefresh.promise)
      .mockReturnValueOnce(failedRetry.promise);
    setTheme("aurora-dark");
    const view = renderProvider();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => notifyBillingPlanChanged());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      failedRetry.reject(new Error("network unavailable"));
      await Promise.resolve();
      successfulRefresh.resolve(currentPlan("pro"));
      await Promise.resolve();
    });

    expect(document.documentElement).toHaveAttribute("data-plan-tier", "enterprise");
    view.unmount();
  });
});
