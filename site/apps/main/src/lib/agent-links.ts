import { NAV_URLS } from "@hypercli/shared-ui";

const AGENTS_DASHBOARD_URL = `${NAV_URLS.clawDashboard}/agents`;

export const TEAM_TRIAL_HREF = `${AGENTS_DASHBOARD_URL}?intent=trial&plan=team`;

export function agentLauncherHref(planId?: string | null): string {
  const params = new URLSearchParams({ open: "agent-launcher" });
  const normalizedPlanId = planId?.trim();
  if (normalizedPlanId) params.set("plan", normalizedPlanId);
  return `${AGENTS_DASHBOARD_URL}?${params.toString()}`;
}

export function agentPlanCtaHref(planId: string): string {
  return planId.trim().toLowerCase() === "team"
    ? TEAM_TRIAL_HREF
    : agentLauncherHref(planId);
}
