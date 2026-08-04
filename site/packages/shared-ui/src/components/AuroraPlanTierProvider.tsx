"use client";

import { BrowserHyperCLI } from "@hypercli.com/sdk/browser";
import type { HyperAgentPlan, HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";
import { useEffect, type ReactNode } from "react";

import { useTheme } from "./ThemeProvider";
import { getAuthCookieToken, hasAuthLogoutMarker, cookieUtils } from "../utils/cookies";
import {
  BILLING_PLAN_CHANGE_EVENT,
  DEFAULT_PLAN_TIER,
  applyPlanTier,
  clearCachedPlanTier,
  getPlanTierApiBaseUrl,
  getPlanTierEnvironment,
  getPlanTierSubject,
  publishPlanTier,
  readCachedPlanTier,
  resolveAccountPlanTier,
  writeCachedPlanTier,
} from "../utils/plan-tier";

interface PlanSnapshot {
  plans: HyperAgentPlan[];
  summary: HyperAgentSubscriptionSummary;
}

interface CachedSnapshot {
  expiresAt: number;
  value: PlanSnapshot;
}

const SNAPSHOT_CACHE_MS = 5 * 60 * 1000;
const snapshotCache = new Map<string, CachedSnapshot>();
const inFlightSnapshots = new Map<string, Promise<PlanSnapshot>>();
const snapshotRequestVersions = new Map<string, number>();
const snapshotAppliedVersions = new Map<string, number>();

function planSnapshotKey(subject: string, environment: string): string {
  return `${environment}:${subject}`;
}

function invalidatePlanSnapshot(subject: string, environment: string): void {
  const key = planSnapshotKey(subject, environment);
  snapshotCache.delete(key);
  inFlightSnapshots.delete(key);
  const version = (snapshotRequestVersions.get(key) ?? 0) + 1;
  snapshotRequestVersions.set(key, version);
  snapshotAppliedVersions.set(key, version);
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

function fetchPlanSnapshot(
  token: string,
  subject: string,
  environment: string,
  force: boolean,
): Promise<PlanSnapshot> {
  const key = planSnapshotKey(subject, environment);
  if (!force) {
    const inFlight = inFlightSnapshots.get(key);
    if (inFlight) return inFlight;
  }

  const cached = snapshotCache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (cached) snapshotCache.delete(key);

  const requestVersion = (snapshotRequestVersions.get(key) ?? 0) + 1;
  snapshotRequestVersions.set(key, requestVersion);
  const apiUrl = getPlanTierApiBaseUrl();
  const client = new BrowserHyperCLI({
    apiUrl,
    agentsApiBaseUrl: `${apiUrl}/agents`,
    token,
  });
  const request = Promise.all([client.agent.plans(), client.agent.subscriptionSummary()])
    .then(([plans, summary]) => {
      const value = { plans, summary };
      if (requestVersion > (snapshotAppliedVersions.get(key) ?? 0)) {
        snapshotAppliedVersions.set(key, requestVersion);
        snapshotCache.set(key, { expiresAt: Date.now() + SNAPSHOT_CACHE_MS, value });
      }
      return value;
    })
    .finally(() => {
      if (inFlightSnapshots.get(key) === request) inFlightSnapshots.delete(key);
    });

  inFlightSnapshots.set(key, request);
  return request;
}

function isUnauthenticatedFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(?:401|unauthorized)\b/i.test(message);
}

// Single-owner guard: shared-ui owns the only active sync loop. Extra mounts
// (duplicate provider trees) no-op instead of racing write/clear cycles.
let activePlanTierSyncOwner: symbol | null = null;

export function AuroraPlanTierProvider({ children }: { children: ReactNode }) {
  const { family } = useTheme();

  useEffect(() => {
    if (activePlanTierSyncOwner) return;
    const owner = Symbol("aurora-plan-tier-sync");
    activePlanTierSyncOwner = owner;

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
        const snapshot = await fetchPlanSnapshot(token, subject, environment, force);
        if (!active || lastSubject !== subject || version < latestPublishedVersion) return;
        latestPublishedVersion = version;
        const tier = resolveAccountPlanTier(snapshot.summary, snapshot.plans);
        writeCachedPlanTier(subject, environment, tier);
        publishPlanTier(tier);
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

    const timeout = window.setTimeout(() => void synchronize(true), 0);
    window.addEventListener(cookieUtils.AUTH_COOKIE_EVENT, handleAuthCookieChange as EventListener);
    window.addEventListener(BILLING_PLAN_CHANGE_EVENT, handleBillingChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (activePlanTierSyncOwner === owner) activePlanTierSyncOwner = null;
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
