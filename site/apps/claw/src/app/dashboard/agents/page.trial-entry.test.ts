import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  resolve(process.cwd(), "src/app/dashboard/agents/page.tsx"),
  "utf8",
);

describe("dashboard Team trial entry", () => {
  it("opens authentication for an anonymous marketing handoff without opening trial activation", () => {
    const effectStart = pageSource.indexOf("if (!teamTrialEntryRequested)");
    const effectEnd = pageSource.indexOf("}, [authLoading, isAuthenticated", effectStart);
    const entryEffect = pageSource.slice(effectStart, effectEnd);

    expect(effectStart).toBeGreaterThan(-1);
    expect(entryEffect).toContain(
      'requestAuthentication({ kind: "navigate", href: DASHBOARD_VIEW_HREFS.overview });',
    );
    expect(entryEffect).not.toContain("setTrialActivationOpen(true)");
    expect(entryEffect).not.toContain("beginTeamTrial(");
  });

  it("returns authenticated visitors to Overview and consumes the handoff marker", () => {
    const effectStart = pageSource.indexOf("if (!teamTrialEntryRequested)");
    const effectEnd = pageSource.indexOf("}, [authLoading, isAuthenticated", effectStart);
    const entryEffect = pageSource.slice(effectStart, effectEnd);

    expect(entryEffect).toContain('params.delete("intent")');
    expect(entryEffect).toContain('params.delete("plan")');
    expect(entryEffect).toContain('params.set("view", "overview")');
    expect(entryEffect).toContain("syncDashboardSearchParams(params)");
  });

  it("does not replace the login handoff with the anonymous dashboard tour", () => {
    const entryStart = pageSource.indexOf("const shouldOpenAgentTourFromPageEntry");
    const entryEnd = pageSource.indexOf("const { setAgentMenu }", entryStart);
    expect(pageSource.slice(entryStart, entryEnd)).toContain("!teamTrialEntryRequested");
  });

  it("keeps the eligible Free trial banner available when the roster is empty", () => {
    expect(pageSource).toContain("canStartTrial={canStartTeamTrial}");
    expect(pageSource).toContain("hasAgents={agents.length > 0}");
    expect(pageSource).not.toContain("canStartTrial={agents.length > 0 && canStartTeamTrial}");
  });

  it("does not pass the sidebar click event as first-agent setup context", () => {
    expect(pageSource).not.toContain("onStartTrial={beginTeamTrial}");
    expect(pageSource).toContain("onStartTrial={() => beginTeamTrial()}");
  });

  it("resumes the agent creation flow after a reflected checkout", () => {
    const reflectedStart = pageSource.indexOf("const handleReflectedCheckout");
    const reflectedEnd = pageSource.indexOf("const refreshCheckoutEntitlements", reflectedStart);
    const reflectedCheckout = pageSource.slice(reflectedStart, reflectedEnd);
    const resumeStart = pageSource.indexOf("if (!resumeAgentLauncher");
    const resumeEnd = pageSource.indexOf("}, [agentsLoading", resumeStart);
    const resumeEffect = pageSource.slice(resumeStart, resumeEnd);

    expect(reflectedCheckout).toContain("setResumeAgentLauncher(true)");
    expect(resumeEffect).toContain("showAgentCreationFlow()");
  });
});
