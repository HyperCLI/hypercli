"use client";

import { NAV_URLS } from "@hypercli/shared-ui";

interface GetStartedLinkProps {
  label: string;
  className?: string;
  plan?: string;
}

export function GetStartedLink({ label, className, plan }: GetStartedLinkProps) {
  const href = plan ? `${NAV_URLS.agents}?plan=${encodeURIComponent(plan)}` : NAV_URLS.agents;
  return (
    <a href={href} className={className}>
      {label}
    </a>
  );
}
