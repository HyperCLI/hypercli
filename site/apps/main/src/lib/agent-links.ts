import { NAV_URLS } from "@hypercli/shared-ui";

const AGENTS_DASHBOARD_URL = `${NAV_URLS.clawDashboard}/agents`;

export function agentTrialHref(planId: string): string {
  const params = new URLSearchParams({ intent: "trial", plan: planId.trim().toLowerCase() });
  return `${AGENTS_DASHBOARD_URL}?${params.toString()}`;
}

export const TEAM_TRIAL_HREF = agentTrialHref("team");

export function agentLauncherHref(planId?: string | null): string {
  const params = new URLSearchParams({ open: "agent-launcher" });
  const normalizedPlanId = planId?.trim();
  if (normalizedPlanId) params.set("plan", normalizedPlanId);
  return `${AGENTS_DASHBOARD_URL}?${params.toString()}`;
}

export function agentPlanCtaHref(planId: string): string {
  const normalizedPlanId = planId.trim().toLowerCase();
  return normalizedPlanId === "team"
    ? agentTrialHref(normalizedPlanId)
    : agentLauncherHref(normalizedPlanId);
}
