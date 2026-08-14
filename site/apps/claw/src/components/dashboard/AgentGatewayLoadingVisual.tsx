"use client";

import { RecoveryState } from "@hypercli/shared-ui";
import { RotateCcw } from "lucide-react";

export const GATEWAY_LOADING_TITLE = "Connecting gateway .";
export const GATEWAY_LOADING_DETAIL = "Opening the agent session";

export function AgentGatewayErrorVisual({
  title = "Try again to reconnect",
  detail = "The agent connection was interrupted. Your saved work is still available.",
  technicalDetails,
  className = "",
  actionLabel,
  onAction,
}: {
  title?: string;
  detail?: string;
  technicalDetails?: string;
  className?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className={`flex max-h-full min-h-0 flex-col items-center justify-center text-center ${className}`}>
      <RecoveryState
        presentation="panel"
        announcement="assertive"
        icon={RotateCcw}
        title={title}
        description={detail}
        technicalDetails={technicalDetails}
        primaryAction={onAction ? {
          label: actionLabel ?? "Try again",
          onAction,
          icon: RotateCcw,
        } : undefined}
        className="w-[min(38rem,calc(100vw-2rem))]"
      />
    </div>
  );
}
