import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  resolve(process.cwd(), "src/app/dashboard/agents/page.tsx"),
  "utf8",
);

describe("dashboard Team trial entry", () => {
  it("preserves trial activation while authenticating a marketing handoff", () => {
    const effectStart = pageSource.indexOf("if (!teamTrialEntryRequested)");
    const effectEnd = pageSource.indexOf("}, [authLoading, pendingAuthIntent", effectStart);
    const entryEffect = pageSource.slice(effectStart, effectEnd);

    expect(effectStart).toBeGreaterThan(-1);
    expect(entryEffect).toContain(
      'requestAuthentication({ kind: "trial", presentation: "activation-dialog" });',
    );
    expect(entryEffect).not.toContain('kind: "navigate"');
    expect(entryEffect).not.toContain("setTrialActivationOpen(true)");
    expect(entryEffect).not.toContain("beginTeamTrial(");
  });

  it("consumes the handoff marker after preserving the trial continuation", () => {
    const effectStart = pageSource.indexOf("if (!teamTrialEntryRequested)");
    const effectEnd = pageSource.indexOf("}, [authLoading, pendingAuthIntent", effectStart);
    const entryEffect = pageSource.slice(effectStart, effectEnd);

    expect(entryEffect).toContain('params.delete("intent")');
    expect(entryEffect).toContain('params.delete("plan")');
    expect(entryEffect).toContain('params.set("view", "overview")');
    expect(entryEffect).toContain("syncDashboardSearchParams(params)");
  });

  it("opens trial activation after the handoff principal is authenticated", () => {
    const continuationStart = pageSource.indexOf('if (pendingAuthIntent?.kind !== "trial"');
    const continuationEnd = pageSource.indexOf("}, [activeTrial, authLoading", continuationStart);
    const continuationEffect = pageSource.slice(continuationStart, continuationEnd);

    expect(continuationStart).toBeGreaterThan(-1);
    expect(continuationEffect).toContain("setTrialActivationOpen(true)");
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
