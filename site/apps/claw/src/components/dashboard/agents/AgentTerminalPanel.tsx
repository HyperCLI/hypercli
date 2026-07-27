"use client";

import React from "react";
import { TabLoadingState } from "@/components/dashboard/agents/page-helpers";
import { getAgentGatewayPanelBootStatus } from "@/components/dashboard/agents/chat-boot-stage";
import type { ShellStatus } from "@/hooks/useAgentShell";

interface AgentTerminalPanelProps {
  status: ShellStatus;
  terminalReady: boolean;
  terminalError: string | null;
  shellBoxRef: React.Ref<HTMLDivElement>;
  visible?: boolean;
}

export const AgentTerminalPanel = React.memo(function AgentTerminalPanel({ status, terminalReady, terminalError, shellBoxRef, visible = true }: AgentTerminalPanelProps) {
  const ready = status === "connected" && terminalReady;
  const connecting = status === "connecting" || status === "reconnecting";
  const loadingTitle = terminalError
    ? "Unable to load shell"
    : status === "reconnecting"
      ? "Reconnecting shell"
      : connecting
        ? "Connecting shell"
        : status === "connected"
          ? "Preparing shell"
          : "Waiting for shell";
  const loadingDetail = terminalError
    ? terminalError
    : status === "reconnecting"
      ? "Restoring the terminal session."
      : connecting
        ? "Opening a terminal session."
        : status === "connected"
          ? "Attaching the terminal."
          : "The terminal will attach when the runtime is ready.";
  const bootStatus = ready ? null : getAgentGatewayPanelBootStatus({
    connected: false,
    connecting,
    loadingTitle: "Loading shell",
    loadingDetail: "Preparing the terminal session.",
    connectingTitle: loadingTitle,
    connectingDetail: loadingDetail,
    waitingTitle: loadingTitle,
    waitingDetail: loadingDetail,
  });

  return (
    <div
      className={`${visible ? "relative z-10 h-full" : "pointer-events-none absolute inset-0 h-full opacity-0"} isolate bg-background p-4 [contain:layout_paint]`}
      aria-hidden={!visible}
      inert={visible ? undefined : true}
    >
      <div ref={shellBoxRef} className={`h-full w-full ${ready ? "" : "invisible"}`} />
      {visible && !ready && (
        <div className="absolute inset-0 p-4">
          <TabLoadingState
            label={loadingTitle}
            detail={loadingDetail}
            bootStatus={bootStatus ?? undefined}
          />
        </div>
      )}
    </div>
  );
});
