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
const nextConfigSource = readFileSync(
  resolve(process.cwd(), "next.config.ts"),
  "utf8",
);

describe("dashboard agents page release boundary", () => {
  it("does not restore consumed checkout params when async agent selection updates the route", () => {
    const routeSyncStart = pageSource.indexOf("const replaceAgentChatRoute");
    const routeSyncEnd = pageSource.indexOf("// Logs", routeSyncStart);
    const routeSync = pageSource.slice(routeSyncStart, routeSyncEnd);

    expect(routeSync).toContain("new URLSearchParams(window.location.search)");
    expect(routeSync).not.toContain("searchParams.toString()");
  });

  it("consumes the anonymous launcher query without remounting pending authentication", () => {
    const launcherQueryStart = pageSource.indexOf("if (!shouldOpenAgentLauncherFromQuery)");
    const launcherQueryEnd = pageSource.indexOf("if (!shouldOpenAgentTourFromPageEntry", launcherQueryStart);
    const launcherQueryEffect = pageSource.slice(launcherQueryStart, launcherQueryEnd);

    expect(launcherQueryEffect).toContain('params.delete("open")');
    expect(launcherQueryEffect).toContain("syncDashboardSearchParams(params)");
    expect(launcherQueryEffect).not.toContain("router.replace(");
  });

  it("keeps Schedule reachable only as a coming-soon preview while its manager is under review", () => {
    expect(pageSource).toContain("SCHEDULED_MANAGER_ENABLED,");
    expect(pageSource).toContain("SCHEDULED_MANAGER_ENABLED ? (");
    expect(pageSource).toContain("<AgentScheduledEmptyState />");
    expect(pageSource).toContain("if (SCHEDULED_MANAGER_ENABLED && chat.connected)");
    expect(pageSource).not.toContain("scheduledDisabled=");
  });

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

  it("gates private chat creation before starting a temporary session", () => {
    const startPrivateChat = pageSource.slice(
      pageSource.indexOf("const startPrivateChat"),
      pageSource.indexOf("const endPrivateChat"),
    );

    expect(startPrivateChat).toContain("if (!requestProductUse()) return;");
    expect(startPrivateChat.indexOf("requestProductUse()")).toBeLessThan(startPrivateChat.indexOf("chat.startTemporaryChat()"));
  });

  it("gates resize-and-start before lifecycle loading and transport", () => {
    const resizeAndStart = pageSource.slice(
      pageSource.indexOf("const handleResizeAndStart"),
      pageSource.indexOf("const selectedAgentHasTierOptions"),
    );

    expect(resizeAndStart.indexOf("requestProductUse()")).toBeGreaterThan(-1);
    expect(resizeAndStart.indexOf("requestProductUse()")).toBeLessThan(resizeAndStart.indexOf("setStartingId(agentId)"));
    expect(resizeAndStart.indexOf("requestProductUse()")).toBeLessThan(resizeAndStart.indexOf("agentClient.resize"));
  });

  it("gates automatic file recovery before its rename transport", () => {
    const safeRename = pageSource.slice(
      pageSource.indexOf("const renameAgentFileToSafeName"),
      pageSource.indexOf("const readAgentFileResult"),
    );

    expect(safeRename.indexOf("requestProductUse()")).toBeGreaterThan(-1);
    expect(safeRename.indexOf("requestProductUse()")).toBeLessThan(safeRename.indexOf("fileWriteBytes"));
  });

  it("keeps Shell preloading passive and authorizes before mounting transport", () => {
    const shellBoundary = pageSource.slice(
      pageSource.indexOf("const [shellAccessAgentId"),
      pageSource.indexOf("const selectedAgentPrimarySurface"),
    );

    expect(shellBoundary).toContain("preloadAgentShellTerminalRuntime()");
    expect(shellBoundary).toContain("if (!requestProductUse()) return false;");
    expect(pageSource).toContain("persistentPanelContent={shellEnabled ? (");
    expect(pageSource).toContain("const shellEnabled = shellActivated && shellAccessAgentId === selectedAgentId;");
  });

  it("does not create a replacement session after cleanup without fresh access", () => {
    const deleteSession = pageSource.slice(
      pageSource.indexOf("const deleteSession"),
      pageSource.indexOf("const createSession"),
    );

    expect(deleteSession.indexOf("chat.deleteSession(sessionKey)")).toBeLessThan(deleteSession.indexOf("requestProductUse()"));
    expect(deleteSession.indexOf("requestProductUse()")).toBeLessThan(deleteSession.indexOf("chat.createSession"));
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

describe("dashboard agents SDK lifetime boundary", () => {
  it("disposes the page-owned deployments client during unmount cleanup", () => {
    const cleanupStart = pageSource.indexOf("pageActiveRef.current = false;");
    const cleanupEnd = pageSource.indexOf("const markAgentCleanupCooldown", cleanupStart);
    const cleanup = pageSource.slice(cleanupStart, cleanupEnd);
    const invalidateRequests = cleanup.indexOf("agentDataGenerationRef.current += 1;");
    const disposeCurrent = cleanup.indexOf("currentDeployments?.dispose();");

    expect(cleanupStart).toBeGreaterThan(-1);
    expect(cleanup).toContain("deploymentsRef.current = null;");
    expect(invalidateRequests).toBeGreaterThan(-1);
    expect(disposeCurrent).toBeGreaterThan(invalidateRequests);
  });

  it("disposes the previous client only after detecting a principal change", () => {
    const principalStart = pageSource.indexOf("const nextPrincipal = isAuthenticated");
    const principalEnd = pageSource.indexOf("}, [clearAgentAvatarOverrides", principalStart);
    const principalEffect = pageSource.slice(principalStart, principalEnd);
    const samePrincipalGuard = principalEffect.indexOf(
      "if (privatePrincipalRef.current === nextPrincipal) return;",
    );
    const disposePrevious = principalEffect.indexOf("previousDeployments?.dispose();");

    expect(samePrincipalGuard).toBeGreaterThan(-1);
    expect(disposePrevious).toBeGreaterThan(samePrincipalGuard);
  });

  it("disposes a failed subscription client before scheduling replacement", () => {
    const subscriptionStart = pageSource.indexOf("void deployments.subscribe");
    const subscriptionEnd = pageSource.indexOf("return () => {", subscriptionStart);
    const subscription = pageSource.slice(subscriptionStart, subscriptionEnd);

    expect(subscription).toContain("deploymentsRef.current !== deployments");
    expect(subscription).toContain("deploymentsRef.current = null;");
    expect(subscription).toContain("deployments.dispose();");
    expect(subscription.indexOf("deployments.dispose();")).toBeLessThan(
      subscription.indexOf("retryAfterFailure"),
    );
  });
});

describe("dev agents page release boundary", () => {
  it("redirects the dev-only setup tree out of production artifacts", () => {
    expect(nextConfigSource).toContain('if (process.env.NODE_ENV !== "production") return [];');
    expect(nextConfigSource).toContain('source: "/dev/agent-setup/:path*"');
    expect(nextConfigSource).toContain('destination: "/dashboard/agents?view=overview"');
  });

  it("keeps its Schedule surface and inspector behind the shared coming-soon policy", () => {
    expect(devAgentSetupPageSource).toContain("<AgentScheduledEmptyState />");
    expect(devAgentSetupPageSource).toContain("showCronManager: SCHEDULED_MANAGER_ENABLED");
    expect(devAgentSetupPageSource).toContain("agentCronJobs: SCHEDULED_MANAGER_ENABLED ? agentCronJobsForView : []");
    expect(devAgentSetupPageSource).toMatch(/onCronRemove: SCHEDULED_MANAGER_ENABLED\s*\?/);
    expect(devAgentSetupPageSource).not.toContain("showCronManager: true");
  });

  it("does not construct or render Collection-backed Workspace surfaces", () => {
    expect(devAgentSetupPageSource).not.toContain("createWorkspacesClient");
    expect(devAgentSetupPageSource).not.toContain("SharedKnowledgePanel");
    expect(devAgentSetupPageSource).not.toContain('mainTab === "knowledge"');
  });
});
