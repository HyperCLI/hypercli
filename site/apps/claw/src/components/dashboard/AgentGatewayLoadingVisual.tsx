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
      aria-live="assertive"
      aria-label={`${title} ${detail}`}
      className="grid w-[min(38rem,calc(100vw-2rem))] grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 rounded-[13px] border border-destructive/35 bg-popover px-4 py-3 text-left sm:grid-cols-[auto_minmax(0,1fr)_auto]"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-destructive/35 bg-surface-low text-destructive">
        <AlertCircle aria-hidden="true" className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm font-medium leading-5 text-foreground">{title}</p>
        <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-[13px] leading-5 text-destructive">{detail}</p>
      </div>
      {onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="col-start-2 flex min-h-9 shrink-0 items-center gap-1.5 justify-self-start whitespace-nowrap rounded-[10px] border border-destructive/35 bg-destructive/10 px-3 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:col-start-3 sm:row-start-1 sm:justify-self-end"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {actionLabel ?? "Retry"}
        </button>
      ) : null}
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
