import { beforeEach, describe, expect, it } from "vitest";
import type { HyperAgentPlan, HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";

import {
  applyPlanTier,
  getPlanTierEnvironment,
  getPlanTierSubject,
  parseCachedPlanTier,
  resolveAccountPlanTier,
  resolveCatalogPlanTier,
  resolvePlanCatalogGeneration,
  resolvePlanTierForIdentity,
} from "../../../../packages/shared-ui/src/utils/plan-tier";

function plan(id: string, name: string, contractVersion?: string, priceUsd = 0): HyperAgentPlan {
  const canonicalId = id === "solo" || id === "team" || id === "pro" ? id : null;
  return { id, canonicalId, name, contractVersion, price: priceUsd, priceUsd } as unknown as HyperAgentPlan;
}

function summary(value: Partial<HyperAgentSubscriptionSummary>): HyperAgentSubscriptionSummary {
  return {
    effectivePlanId: "",
    activeSubscriptions: [],
    entitlementItems: [],
    entitlements: { effectivePlanId: "" },
    ...value,
  } as unknown as HyperAgentSubscriptionSummary;
}

describe("Aurora plan tier mapping", () => {
  const currentCatalog = [
    plan("solo", "Solo", "2026-08"),
    plan("team", "Team", "2026-08"),
    plan("pro", "Pro", "2026-08"),
  ];
  const futureCatalog = [
    plan("solo", "Solo"),
    plan("team", "Team"),
    plan("enterprise", "Enterprise"),
  ];
  const legacyCatalog = [
    plan("basic", "Basic"),
    plan("plus", "Plus"),
    plan("pro", "Pro"),
    plan("team", "Team"),
  ];

  it("recognizes current and legacy catalog cohorts before resolving ambiguous IDs", () => {
    expect(resolvePlanCatalogGeneration(currentCatalog)).toBe("current");
    expect(resolvePlanCatalogGeneration(futureCatalog)).toBe("current");
    expect(resolvePlanCatalogGeneration(legacyCatalog)).toBe("legacy");
    expect(resolvePlanCatalogGeneration([plan("pro", "Pro")])).toBe("unknown");
  });

  it("maps current Solo, Team, Pro, and Enterprise plans to three visual tiers", () => {
    expect(resolveCatalogPlanTier(currentCatalog[0]!, currentCatalog)).toBe("solo");
    expect(resolveCatalogPlanTier(currentCatalog[1]!, currentCatalog)).toBe("team");
    expect(resolveCatalogPlanTier(currentCatalog[2]!, currentCatalog)).toBe("enterprise");
    expect(resolveCatalogPlanTier(futureCatalog[2]!, futureCatalog)).toBe("enterprise");
  });

  it("uses the confirmed rank mapping for legacy feat catalogs", () => {
    expect(resolvePlanTierForIdentity("free", "Free", "legacy")).toBe("solo");
    expect(resolvePlanTierForIdentity("starter", "Starter", "legacy")).toBe("solo");
    expect(resolveCatalogPlanTier(legacyCatalog[0]!, legacyCatalog)).toBe("solo");
    expect(resolveCatalogPlanTier(legacyCatalog[1]!, legacyCatalog)).toBe("solo");
    expect(resolveCatalogPlanTier(legacyCatalog[2]!, legacyCatalog)).toBe("team");
    expect(resolveCatalogPlanTier(legacyCatalog[3]!, legacyCatalog)).toBe("enterprise");
  });

  it("uses the backend effective plan instead of recomputing entitlement priority", () => {
    const accountSummary = summary({
      effectivePlanId: "team",
      activeSubscriptions: [
        { planId: "team", planName: "Team", status: "active" },
      ] as never,
      entitlementItems: [
        { planId: "pro", planName: "Pro", status: "active" },
      ] as never,
    });

    expect(resolveAccountPlanTier(accountSummary, currentCatalog)).toBe("team");
  });

  it("uses canonical identities when a partial catalog has no cohort", () => {
    expect(resolvePlanTierForIdentity("team", "Team", "unknown")).toBe("team");
    expect(resolvePlanTierForIdentity("pro", "Pro", "unknown")).toBe("enterprise");
    expect(resolveAccountPlanTier(summary({ effectivePlanId: "team" }), [])).toBe("team");
  });

  it("derives visual tiers for open catalog IDs from backend order", () => {
    const customCatalog = [
      plan("hobby", "Hobby", undefined, 10),
      plan("growth", "Growth", undefined, 20),
      plan("scale", "Scale", undefined, 30),
    ];

    expect(resolveCatalogPlanTier(customCatalog[0]!, customCatalog)).toBe("solo");
    expect(resolveCatalogPlanTier(customCatalog[1]!, customCatalog)).toBe("team");
    expect(resolveCatalogPlanTier(customCatalog[2]!, customCatalog)).toBe("enterprise");
    expect(resolveCatalogPlanTier(customCatalog[0]!, [...customCatalog].reverse())).toBe("solo");
    expect(resolveCatalogPlanTier(customCatalog[2]!, [...customCatalog].reverse())).toBe("enterprise");
  });
});

describe("plan tier cache identity", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-plan-tier");
    document.body.removeAttribute("data-plan-tier");
  });

  it("extracts a stable subject from a browser auth token", () => {
    const payload = btoa(JSON.stringify({ user_id: "user-42", exp: Date.now() / 1000 + 300 })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    expect(getPlanTierSubject(`header.${payload}.signature`)).toBe("user-42");
    expect(getPlanTierSubject("invalid")).toBeNull();
  });

  it("rejects expired auth-token subjects", () => {
    const payload = btoa(JSON.stringify({ sub: "expired-user", exp: 1 })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    expect(getPlanTierSubject(`header.${payload}.signature`)).toBeNull();
  });

  it("accepts future numeric-string expiry and rejects missing expiry", () => {
    const futurePayload = btoa(JSON.stringify({ sub: "future-user", exp: String(Date.now() / 1000 + 300) }))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const missingPayload = btoa(JSON.stringify({ sub: "missing-expiry" }))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    expect(getPlanTierSubject(`header.${futurePayload}.signature`)).toBe("future-user");
    expect(getPlanTierSubject(`header.${missingPayload}.signature`)).toBeNull();
  });

  it("accepts only current, well-formed cache records", () => {
    const now = 10_000;
    const valid = JSON.stringify({
      version: 1,
      subject: "user-1",
      environment: "https://api.dev.hypercli.com",
      tier: "team",
      expiresAt: now + 1,
    });

    expect(parseCachedPlanTier(valid, now)?.tier).toBe("team");
    expect(parseCachedPlanTier(valid, now + 1)).toBeNull();
    expect(parseCachedPlanTier("not-json", now)).toBeNull();
  });

  it("normalizes API environments and applies the tier to both DOM roots", () => {
    expect(getPlanTierEnvironment("https://api.dev.hypercli.com/api", "https://agents.dev.hypercli.com"))
      .toBe("https://api.dev.hypercli.com");

    applyPlanTier("enterprise");
    expect(document.documentElement).toHaveAttribute("data-plan-tier", "enterprise");
    expect(document.body).toHaveAttribute("data-plan-tier", "enterprise");
  });
});
