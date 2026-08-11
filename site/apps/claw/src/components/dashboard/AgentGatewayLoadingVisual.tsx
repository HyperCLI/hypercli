"use client";

import { AlertCircle, RefreshCw } from "lucide-react";

export const GATEWAY_LOADING_TITLE = "Connecting gateway .";
export const GATEWAY_LOADING_DETAIL = "Opening the agent session";

function AgentGatewayErrorStatus({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      aria-label={`${title} ${detail}`}
      className="flex w-[min(300px,calc(100vw-3rem))] items-center gap-3 rounded-[13px] border border-destructive/35 bg-popover px-3 py-2.5 text-left"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-5 text-foreground">{title}</p>
        <p className="truncate text-[13px] leading-5 text-destructive">{detail}</p>
      </div>
      {onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-[10px] border border-destructive/35 bg-destructive/10 px-2.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/15"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {actionLabel ?? "Retry"}
        </button>
      ) : (
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-destructive/35 bg-surface-low text-destructive">
          <AlertCircle className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

export function AgentGatewayErrorVisual({
  title = "Could not connect",
  detail = "The agent session could not be opened.",
  className = "",
  actionLabel,
  onAction,
}: {
  title?: string;
  detail?: string;
  className?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className={`flex max-h-full min-h-0 flex-col items-center justify-center text-center ${className}`}>
      <AgentGatewayErrorStatus
        title={title}
        detail={detail}
        actionLabel={actionLabel}
        onAction={onAction}
      />
    </div>
  );
}
