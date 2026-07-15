"use client";

import { AgentGatewayLoadingVisual } from "@/components/dashboard/AgentGatewayLoadingVisual";

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
      <AgentGatewayLoadingVisual
        title={title}
        detail={detail}
        animationClassName="h-[clamp(5.5rem,20vh,8rem)] w-[clamp(5.5rem,20vh,8rem)]"
        className="gap-4"
      />
    </div>
  );
}
