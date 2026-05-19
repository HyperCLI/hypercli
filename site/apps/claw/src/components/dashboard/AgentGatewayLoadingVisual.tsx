"use client";

import { memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";

import { AgentLayoutAnimation } from "@/components/dashboard/AgentLayoutAnimation";

export const GATEWAY_LOADING_TITLE = "Connecting gateway .";
export const GATEWAY_LOADING_DETAIL = "Opening the agent session";

const AgentGatewayLoadingAnimation = memo(function AgentGatewayLoadingAnimation({
  animationClassName,
  showCodePhase,
}: {
  animationClassName: string;
  showCodePhase: boolean;
}) {
  return (
    <AgentLayoutAnimation
      appearance="subtle"
      className={animationClassName}
      showCodePhase={showCodePhase}
      title="Agent workspace loading"
    />
  );
});

function AgentGatewayLoadingStatus({
  title,
  detail,
  status,
  actionLabel,
  onAction,
}: {
  title: string;
  detail: string;
  status: "loading" | "error";
  actionLabel?: string;
  onAction?: () => void;
}) {
  const isError = status === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live="polite"
      aria-label={`${title} ${detail}`}
      className={`flex w-[min(300px,calc(100vw-3rem))] items-center gap-3 rounded-[13px] border bg-[#101010]/95 px-3 py-2.5 text-left shadow-[0_18px_48px_rgba(0,0,0,0.42)] ${
        isError ? "border-[#d05f5f]/35" : "border-[#282828]"
      }`}
    >
      <div className="min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${status}-${title}-${detail}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <p className="truncate text-sm font-medium leading-5 text-[#f4f4f4]">{title}</p>
            <p className={`truncate text-[13px] leading-5 ${isError ? "text-[#d98c8c]" : "text-[#5e5e5e]"}`}>{detail}</p>
          </motion.div>
        </AnimatePresence>
      </div>
      {isError && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-[10px] border border-[#d05f5f]/35 bg-[#d05f5f]/10 px-2.5 text-[11px] font-medium text-[#f4b2b2] transition-colors hover:bg-[#d05f5f]/16"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {actionLabel ?? "Retry"}
        </button>
      ) : (
        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border bg-[#151515] ${isError ? "border-[#d05f5f]/35 text-[#f4b2b2]" : "border-[#323232] text-[#f5f5f5]"}`}>
          {isError ? <AlertCircle className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
      )}
    </div>
  );
}

export function AgentGatewayLoadingVisual({
  title = GATEWAY_LOADING_TITLE,
  detail = GATEWAY_LOADING_DETAIL,
  className = "",
  animationClassName = "h-[clamp(6.5rem,24vh,10.5rem)] w-[clamp(6.5rem,24vh,10.5rem)]",
  showCodePhase = true,
  status = "loading",
  actionLabel,
  onAction,
}: {
  title?: string;
  detail?: string;
  className?: string;
  animationClassName?: string;
  showCodePhase?: boolean;
  status?: "loading" | "error";
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className={`flex max-h-full min-h-0 flex-col items-center justify-center gap-5 text-center ${className}`}>
      <AgentGatewayLoadingAnimation animationClassName={animationClassName} showCodePhase={showCodePhase} />
      <AgentGatewayLoadingStatus
        title={title}
        detail={detail}
        status={status}
        actionLabel={actionLabel}
        onAction={onAction}
      />
    </div>
  );
}
