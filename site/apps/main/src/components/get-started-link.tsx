"use client";

import { NAV_URLS } from "@hypercli/shared-ui";
import { agentLauncherHref, agentPlanCtaHref, TEAM_TRIAL_HREF } from "@/lib/agent-links";

interface GetStartedLinkProps {
  label: string;
  className?: string;
  plan?: string;
  toAgentDashboard?: boolean;
  trial?: boolean;
}

export function GetStartedLink({ label, className, plan, toAgentDashboard, trial }: GetStartedLinkProps) {
  const href = trial
    ? TEAM_TRIAL_HREF
    : plan
      ? agentPlanCtaHref(plan)
      : toAgentDashboard
        ? agentLauncherHref()
        : NAV_URLS.agents;
  return (
    <a href={href} className={className}>
      {label}
    </a>
  );
}
