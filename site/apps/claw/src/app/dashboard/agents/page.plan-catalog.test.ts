import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  resolve(process.cwd(), "src/app/dashboard/agents/page.tsx"),
  "utf8",
);

describe("dashboard agent plan catalog", () => {
  it("uses the wizard scroll region when embedded", () => {
    const catalogStart = pageSource.indexOf("function UpgradePlanCatalogContent");
    const catalogEnd = pageSource.indexOf("function UpgradePlanCatalogModal", catalogStart);
    const catalogSource = pageSource.slice(catalogStart, catalogEnd);

    expect(catalogStart).toBeGreaterThan(-1);
    expect(catalogSource).toContain("min-h-0 flex-1 px-6 pb-6");
    expect(catalogSource).toContain('embedded ? "overflow-visible" : "overflow-y-auto"');
  });

  it("does not repeat a catalog daily-token feature with different slash spacing", () => {
    const featuresStart = pageSource.indexOf("function upgradeProductFeatures");
    const featuresEnd = pageSource.indexOf("function isActiveNoSlotBillingMockEnabled", featuresStart);
    const featuresSource = pageSource.slice(featuresStart, featuresEnd);

    expect(featuresStart).toBeGreaterThan(-1);
    expect(featuresSource).toContain("tokens/day");
    expect(featuresSource).not.toContain("tokens / day");
  });

  it("keeps fallback checkout correlated with the open agent setup", () => {
    expect(pageSource).toContain(
      'openUpgradeCatalog(planId, { origin: "first-agent-setup" })',
    );
    expect(pageSource).toContain("setUpgradeCheckoutFirstAgentSetup(firstAgentSetup ?? null)");
    expect(pageSource).toContain("firstAgentSetup={upgradeCheckoutFirstAgentSetup ?? undefined}");
    expect(pageSource).toContain('openPlansPage("first-agent-setup")');
  });
});
