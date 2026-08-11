"use client";

import { AgentStartupLoadingVisual } from "@/components/dashboard/AgentStartupLoadingVisual";

interface SkillsLoadingStateProps {
  title?: string;
  detail?: string;
  className?: string;
}

export function SkillsLoadingState({
  title = "Loading skills",
  detail = "Reading available app skills.",
  className = "",
}: SkillsLoadingStateProps) {
  return (
    <div className={`flex min-h-[260px] min-w-0 items-center justify-center overflow-hidden ${className}`}>
      <AgentStartupLoadingVisual
        heading="Getting skills ready"
        note="Loading the tools available to this agent."
        title={title}
        detail={detail}
      />
    </div>
  );
}
