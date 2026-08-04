"use client";

import { useEffect, type ReactNode } from "react";

import { useTheme } from "./ThemeProvider";
import { getAuthCookieToken, hasAuthLogoutMarker, cookieUtils } from "../utils/cookies";
import {
  BILLING_PLAN_CHANGE_EVENT,
  DEFAULT_PLAN_TIER,
  applyPlanTier,
  clearCachedPlanTier,
  getPlanTierEnvironment,
  getPlanTierSubject,
  publishPlanTier,
  readCachedPlanTier,
  resolveAccountPlanTier,
  writeCachedPlanTier,
} from "../utils/plan-tier";
import { claimPlanTierProviderMount, invalidatePlanTierSnapshot, requestPlanTierSnapshot } from "../utils/plan-tier-sync-machine";

function invalidatePlanSnapshot(subject: string, environment: string): void {
  invalidatePlanTierSnapshot(subject, environment);
}

function availableAuthToken(): string | null {
  const candidates = [getAuthCookieToken()];
  try {
    if (typeof window !== "undefined") {
      candidates.push(
        window.localStorage.getItem("claw_auth_token"),
        window.localStorage.getItem("app_auth_token"),
      );
    }
  } catch {
    // Cookies can still provide the active session when storage is unavailable.
  }

  for (const candidate of candidates) {
    if (candidate && getPlanTierSubject(candidate)) return candidate;
  }
  return null;
}

function isUnauthenticatedFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(?:401|unauthorized)\b/i.test(message);
}

// The sync machine owns the lifecycle: exactly one mounted instance runs
// effects; later mounts render children but no-op until ownership frees.
export function AuroraPlanTierProvider({ children }: { children: ReactNode }) {
  const { family } = useTheme();

  useEffect(() => {
    const releaseMount = claimPlanTierProviderMount();
    if (!releaseMount) return;

    let active = true;
    let requestVersion = 0;
    let latestPublishedVersion = 0;
    let billingRefreshTimers: number[] = [];
    let lastSubject: string | null = null;
    const environment = getPlanTierEnvironment();

    const synchronize = async (force = false) => {
      if (family !== "aurora") return;
      const version = ++requestVersion;
      const token = availableAuthToken();

      if (!token || hasAuthLogoutMarker()) {
        latestPublishedVersion = version;
        if (lastSubject) invalidatePlanSnapshot(lastSubject, environment);
        lastSubject = null;
        clearCachedPlanTier();
        applyPlanTier(DEFAULT_PLAN_TIER);
        return;
      }

      const subject = getPlanTierSubject(token);
      if (!subject) {
        latestPublishedVersion = version;
        if (lastSubject) invalidatePlanSnapshot(lastSubject, environment);
        lastSubject = null;
        clearCachedPlanTier();
        applyPlanTier(DEFAULT_PLAN_TIER);
        return;
      }
      if (lastSubject && lastSubject !== subject) invalidatePlanSnapshot(lastSubject, environment);
      lastSubject = subject;

      const cachedTier = readCachedPlanTier(subject, environment);
      if (cachedTier) publishPlanTier(cachedTier);
      else applyPlanTier(DEFAULT_PLAN_TIER);

      try {
        const snapshot = await requestPlanTierSnapshot({ token, subject, environment, force });
        if (!active || lastSubject !== subject || version < latestPublishedVersion) return;
        latestPublishedVersion = version;
        const tier = resolveAccountPlanTier(snapshot.summary, snapshot.plans);
        // Change-only writes: idempotent publishes keep remount loops from
        // churning the cookie or re-notifying listeners.
        if (tier !== cachedTier) writeCachedPlanTier(subject, environment, tier);
        if (typeof document !== "undefined" && document.documentElement.getAttribute("data-plan-tier") !== tier) {
          publishPlanTier(tier);
        }
      } catch (error) {
        if (!active || version !== requestVersion) return;
        if (isUnauthenticatedFailure(error)) {
          latestPublishedVersion = version;
          lastSubject = null;
          invalidatePlanSnapshot(subject, environment);
          clearCachedPlanTier();
          applyPlanTier(DEFAULT_PLAN_TIER);
        } else if (!cachedTier) {
          applyPlanTier(DEFAULT_PLAN_TIER);
        }
      }
    };

    const handleAuthCookieChange = (event: Event) => {
      const name = (event as CustomEvent<{ name?: string }>).detail?.name;
      if (name === "auth_token" || name === "hypercli_logged_out") void synchronize(true);
    };
    const handleBillingChange = () => {
      for (const timer of billingRefreshTimers) window.clearTimeout(timer);
      const token = availableAuthToken();
      const subject = token ? getPlanTierSubject(token) : null;
      if (subject) invalidatePlanSnapshot(subject, environment);
      if (family !== "aurora") return;
      void synchronize(true);
      billingRefreshTimers = [
        window.setTimeout(() => void synchronize(true), 1_500),
        window.setTimeout(() => void synchronize(true), 4_500),
        window.setTimeout(() => void synchronize(true), 12_000),
      ];
    };
    const handleFocus = () => void synchronize(true);
    const handlePageShow = () => void synchronize(true);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void synchronize(false);
    };

    const timeout = window.setTimeout(() => void synchronize(false), 0);
    window.addEventListener(cookieUtils.AUTH_COOKIE_EVENT, handleAuthCookieChange as EventListener);
    window.addEventListener(BILLING_PLAN_CHANGE_EVENT, handleBillingChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      releaseMount();
      active = false;
      requestVersion += 1;
      if (lastSubject) invalidatePlanSnapshot(lastSubject, environment);
      window.clearTimeout(timeout);
      for (const timer of billingRefreshTimers) window.clearTimeout(timer);
      window.removeEventListener(cookieUtils.AUTH_COOKIE_EVENT, handleAuthCookieChange as EventListener);
      window.removeEventListener(BILLING_PLAN_CHANGE_EVENT, handleBillingChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [family]);

  return children;
}
