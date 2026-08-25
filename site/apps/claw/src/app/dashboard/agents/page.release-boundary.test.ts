import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The dashboard agents page is a large client component that is impractical to
// render in a unit test. These source-level assertions guard the release
// boundary contract: unstable Knowledge Hub and Members surfaces must be
// logically hidden from navigation callbacks and route activation while their
// availability is disabled, without deleting their implementations.
//
// If a test here fails after intentionally re-enabling a surface, update the
// expectation to match the new release policy.

const pageSource = readFileSync(
  resolve(process.cwd(), "src/app/dashboard/agents/page.tsx"),
  "utf8",
);

describe("dashboard agents page release boundary", () => {
  it("gates Knowledge Hub route activation behind the availability policy", () => {
    // The page must not activate the knowledge-hub section from a direct URL
    // unless the release policy allows it.
    expect(pageSource).toContain('isDashboardReleaseSurfaceAvailable("knowledge-hub")');
    expect(pageSource).toMatch(/knowledgeHubSectionActive\s*=\s*isAuthenticated\s*&&\s*knowledgeHubAvailable/);
  });

  it("gates Members route activation behind the availability policy", () => {
    expect(pageSource).toContain('isDashboardReleaseSurfaceAvailable("members")');
    expect(pageSource).toMatch(/membersSectionActive\s*=\s*isAuthenticated\s*&&\s*membersAvailable/);
  });

  it("gates the Members settings section behind the availability policy", () => {
    // The settings section resolver must not resolve "members" while disabled;
    // this is enforced inside resolveSettingsSectionId, but the page must also
    // use that resolver rather than reading the raw query value.
    expect(pageSource).toContain("resolveSettingsSectionId(searchParams.get(\"settings\"))");
  });

  it("normalizes disabled surface query params before rendering", () => {
    // The page must call the release-boundary normalizer and replace the URL
    // so direct /dashboard/agents?section=knowledge-hub or ?section=members
    // links do not leave stale query state behind.
    expect(pageSource).toContain("normalizeDashboardReleaseSearchParams(searchParams)");
    expect(pageSource).toMatch(/router\.replace\(`\/dashboard\/agents\$\{query\s*\?\s*`\?\$\{query\}`\s*:\s*""\}`/);
  });

  it("does not let anonymous route cleanup preserve Knowledge Hub collection parameters", () => {
    expect(pageSource).toMatch(/"section",\s*"collectionId",\s*"domainId",\s*"settings"/);
  });

  it("withholds Knowledge Hub callbacks from AccountOperationsHome while the surface is unavailable", () => {
    // The page must pass undefined for onOpenCollection/onOpenKnowledge when
    // knowledge-hub is unavailable so the buttons render disabled instead of
    // silently doing nothing.
    expect(pageSource).toMatch(/onOpenCollection=\{knowledgeHubAvailable\s*\?\s*openActivityCollection\s*:\s*undefined\}/);
    expect(pageSource).toMatch(/onOpenKnowledge=\{knowledgeHubAvailable\s*\?\s*openKnowledgeHub\s*:\s*undefined\}/);
  });

  it("withholds Members callbacks from workspace surfaces while the surface is unavailable", () => {
    // Sidebar, empty-state, and settings surfaces must not expose Members
    // callbacks when the surface is disabled.
    expect(pageSource).toMatch(/onOpenMembers=\{membersAvailable\s*\?\s*openMembersTab\s*:\s*undefined\}/);
  });

  it("does not render KnowledgeHub or MembersSection without an availability check", () => {
    // mainTab can only become "knowledge-hub" or "members" through gated
    // callbacks, but the page must not contain an unconditional render of
    // those panels.
    const knowledgeHubRender = pageSource.match(/<KnowledgeHub[\s>]/g) ?? [];
    const membersSectionRender = pageSource.match(/<MembersSection[\s>]/g) ?? [];
    // KnowledgeHub is rendered exactly once (behind mainTab === "knowledge-hub").
    expect(knowledgeHubRender.length).toBe(1);
    // MembersSection is rendered twice: once for mainTab === "members" and
    // once for accountSettingsSection === "members".
    expect(membersSectionRender.length).toBe(2);
  });
});
