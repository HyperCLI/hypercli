"use client";

import { memo } from "react";
import { Loader2 } from "lucide-react";

import { AgentLayoutAnimation } from "@/components/dashboard/AgentLayoutAnimation";

export const GATEWAY_LOADING_TITLE = "Connecting gateway .";
export const GATEWAY_LOADING_DETAIL = "Opening the agent session";

const AgentGatewayLoadingAnimation = memo(function AgentGatewayLoadingAnimation({
  animationClassName,
}: {
  animationClassName: string;
}) {
  return (
      <AgentLayoutAnimation
        appearance="subtle"
        className={animationClassName}
        showCodePhase
        title="Agent workspace loading"
      />
  );
});

function AgentGatewayLoadingStatus({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${title} ${detail}`}
      className="flex w-[min(300px,calc(100vw-3rem))] items-center gap-3 rounded-[13px] border border-[#282828] bg-[#101010]/95 px-3 py-2.5 text-left shadow-[0_18px_48px_rgba(0,0,0,0.42)]"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-5 text-[#f4f4f4]">{title}</p>
        <p className="truncate text-[13px] leading-5 text-[#5e5e5e]">{detail}</p>
      </div>
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[#323232] bg-[#151515] text-[#f5f5f5]">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    </div>
  );
}

export function AgentGatewayLoadingVisual({
  title = GATEWAY_LOADING_TITLE,
  detail = GATEWAY_LOADING_DETAIL,
  className = "",
  animationClassName = "h-[clamp(6.5rem,24vh,10.5rem)] w-[clamp(6.5rem,24vh,10.5rem)]",
}: {
  title?: string;
  detail?: string;
  className?: string;
  animationClassName?: string;
}) {
  return (
    <div className={`flex max-h-full min-h-0 flex-col items-center justify-center gap-5 text-center ${className}`}>
      <AgentGatewayLoadingAnimation animationClassName={animationClassName} />
      <AgentGatewayLoadingStatus title={title} detail={detail} />
    </div>
  );
}
