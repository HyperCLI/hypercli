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
const devAgentSetupPageSource = readFileSync(
  resolve(process.cwd(), "src/app/dev/agent-setup/agents/page.tsx"),
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

  it("gates the Collections-backed shared knowledge section behind the availability policy", () => {
    // section=knowledge renders SharedKnowledgeSection, whose content is
    // entirely Collection-scoped. While Knowledge Hub is hidden the Workspace
    // provider performs no transport, so the panel can only render permanent
    // Collection copy and a misleading "not connected" error to every visitor
    // of that direct URL. Route activation must be gated exactly like
    // section=knowledge-hub.
    expect(pageSource).toMatch(/knowledgeSectionActive\s*=\s*isAuthenticated\s*&&\s*knowledgeHubAvailable\s*&&\s*requestedSection === "knowledge"/);
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

  it("keeps active rosters account-wide and independent of Collection state while hidden", () => {
    expect(pageSource).toMatch(/!knowledgeHubAvailable\s*\?\s*accountAgents/);
    expect(pageSource).toMatch(/workspaceAgentsLoading\s*=\s*knowledgeHubAvailable\s*&&\s*isAgentRosterLoading/);
    expect(pageSource).toMatch(/agentRosterOrderScope\s*=\s*knowledgeHubAvailable\s*\?\s*selectedWorkspaceId\s*:\s*user\?\.id\s*\?\?\s*null/);
    expect(pageSource).toContain("rosterLoading={agentsLoading || workspaceAgentsLoading}");
  });

  it("withholds Collection creation and assignment hooks while Knowledge Hub is unavailable", () => {
    expect(pageSource).toContain("associateCreatedAgent={knowledgeHubAvailable ? assignAgentToCollection : undefined}");
    expect(pageSource).toMatch(/\{knowledgeHubAvailable\s*\?\s*<CollectionCreationDialog/);
    expect(pageSource).toContain("knowledgeCollectionId: knowledgeHubAvailable ? draft.knowledgeCollectionId : null");
  });

  it("withholds Collection re-selection and draft Collection ids from checkout recovery while unavailable", () => {
    // Paid checkout recovery resumes a saved first-agent setup draft. While the
    // surface is hidden it must not (a) re-select the draft's Collection, nor
    // (b) carry the draft's stale Collection id into the trial or embedded
    // checkout contexts. Both seams must gate on the release policy.
    expect(pageSource).toMatch(
      /knowledgeHubAvailable && pending\.workspaceId && selectedWorkspaceId !== pending\.workspaceId/,
    );
    const gatedDraftCollectionIds = pageSource.match(
      /knowledgeCollectionId: knowledgeHubAvailable \? firstAgentSetupDraft\.knowledgeCollectionId : null/g,
    ) ?? [];
    expect(gatedDraftCollectionIds.length).toBe(2);
    expect(pageSource).toContain(
      "workspaceId: knowledgeHubAvailable ? firstAgentSetupDraft.workspaceId ?? selectedWorkspaceId : null",
    );
  });

  it("does not pass Collection state into reachable overview or launcher surfaces while hidden", () => {
    expect(pageSource).toContain("workspaces={knowledgeHubAvailable ? workspaces : []}");
    expect(pageSource).toContain("spaceAccessClient={knowledgeHubAvailable ? workspacesClient : null}");
    expect(pageSource).toContain("draftWorkspaceId={knowledgeHubAvailable ? selectedWorkspaceId : null}");
    expect(pageSource).toContain("knowledgeCollectionsLoading={knowledgeHubAvailable && workspacesLoading}");
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

  it("does not render SharedKnowledgeSection or the Collections overview without an availability check", () => {
    // The Collection-backed Shared knowledge section renders exactly once,
    // behind mainTab === "knowledge", which only activates through the gated
    // administration routing asserted above. The Collections overview inside
    // account settings renders exactly once, behind a section check that is
    // additionally availability-gated.
    const sharedKnowledgeRender = pageSource.match(/<SharedKnowledgeSection[\s>]/g) ?? [];
    expect(sharedKnowledgeRender.length).toBe(1);
    const workspaceOverviewRender = pageSource.match(/<WorkspaceOverviewPanel[\s>]/g) ?? [];
    expect(workspaceOverviewRender.length).toBe(1);
    expect(pageSource).toMatch(/accountSettingsSection === "workspace" && knowledgeHubAvailable/);
  });
});

describe("dev agents page release boundary", () => {
  it("does not construct or render Collection-backed Workspace surfaces", () => {
    expect(devAgentSetupPageSource).not.toContain("createWorkspacesClient");
    expect(devAgentSetupPageSource).not.toContain("SharedKnowledgePanel");
    expect(devAgentSetupPageSource).not.toContain('mainTab === "knowledge"');
  });
});
