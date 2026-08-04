"use client";

import { NAV_URLS } from "@hypercli/shared-ui";

interface GetStartedLinkProps {
  label: string;
  className?: string;
  plan?: string;
  toAgentDashboard?: boolean;
}

export function GetStartedLink({ label, className, plan, toAgentDashboard }: GetStartedLinkProps) {
  const baseHref = toAgentDashboard ? `${NAV_URLS.clawDashboard}/agents/` : NAV_URLS.agents;
  const href = plan ? `${baseHref}?plan=${encodeURIComponent(plan)}` : baseHref;
  return (
    <a href={href} className={className}>
      {label}
    </a>
  );
}
